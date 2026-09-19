/**
 * 初次测评
 *
 * 目标不是「考出一个分数」，是在三分钟内、在孩子不觉得自己在被考的前提下，
 * 判断出：他听得懂多少、愿不愿意开口、认不认字。
 *
 * 所以（§7）：
 *  · 4~6 岁全程不出现需要阅读的文字。屏幕上是图，声音是题，操作是点和说。
 *  · 7 岁以上才加入看词选图，判断认读能力。这是唯一带文字的题型。
 *  · 题目从最简单开始，连错两题就停。让孩子带着「我会」的感觉结束，
 *    而不是被越来越难的题目一路问到懵。
 *
 * 出题顺序是固定的阶梯（tier 1 → 2 → 3），不是随机抽。
 * 随机会让两个孩子做到难度差很远的卷子，结果不可比。
 */

import type { AssessAnswer, AssessItem, EnglishProfile, LevelId } from '../types';
import { distractors, getWord, pointPrompt } from '../data/vocab';
import { clamp, rng, shuffle } from './util';
import { initialProfile, levelOf } from './profile';

/** 每一层用哪些词出题。选的都是最典型、图最好认的 */
const TIER_WORDS: Record<1 | 2 | 3, string[]> = {
  1: ['w-apple', 'w-cat', 'w-red', 'w-dog', 'w-mom'],
  2: ['w-banana', 'w-yellow', 'w-three', 'w-eat', 'w-rabbit'],
  3: ['w-elephant', 'w-hungry', 'w-brother', 'w-wash', 'w-flower'],
};

function optionsFor(wordId: string, rnd: () => number): AssessItem['options'] {
  const w = getWord(wordId);
  if (!w) return [];
  const others = distractors(w, 2, rnd);
  return shuffle([w, ...others], rnd).map((x) => ({ wordId: x.id, emoji: x.emoji, label: x.en }));
}

/**
 * 出一套测评题。
 *
 * 题量控制在 8~11 题：再多，四五岁的孩子会坐不住，后面的数据反而不可信。
 */
export function buildAssessment(age: number, seed = 1): AssessItem[] {
  const rnd = rng(seed);
  const items: AssessItem[] = [];
  const canRead = age >= 7;

  const add = (kind: AssessItem['kind'], wordId: string, tier: 1 | 2 | 3) => {
    const w = getWord(wordId);
    if (!w) return;
    const prompt =
      kind === 'listen-pick'
        ? pointPrompt(w)
        : kind === 'say'
          ? `Say: ${w.en}.`
          : `Which one is "${w.en}"?`;
    const promptZh =
      kind === 'listen-pick' ? '听一听，点出对的那张图' : kind === 'say' ? '跟我说一遍' : '哪个是这个词？';
    items.push({
      id: `as-${kind}-${wordId}`,
      kind,
      prompt,
      promptZh,
      wordId,
      options: kind === 'say' ? [{ wordId: w.id, emoji: w.emoji, label: w.en }] : optionsFor(wordId, rnd),
      tier,
    });
  };

  // 第一层：三道听音点图，建立「我会」的感觉
  add('listen-pick', TIER_WORDS[1][0], 1);
  add('listen-pick', TIER_WORDS[1][1], 1);
  add('listen-pick', TIER_WORDS[1][2], 1);
  // 跟读一道，看愿不愿意开口
  add('say', TIER_WORDS[1][3], 1);

  // 第二层
  add('listen-pick', TIER_WORDS[2][0], 2);
  add('listen-pick', TIER_WORDS[2][2], 2);
  add('say', TIER_WORDS[2][1], 2);

  // 第三层
  add('listen-pick', TIER_WORDS[3][0], 3);
  add('say', TIER_WORDS[3][1], 3);

  // 认读只给 7 岁以上。给 5 岁孩子看英文单词，测到的是「他不认识字」，
  // 这件事我们本来就知道，问了只会打击他。
  if (canRead) {
    add('pick-word', TIER_WORDS[1][4], 1);
    add('pick-word', TIER_WORDS[2][3], 2);
  }

  return items;
}

/** 连错两题就该停了。返回 true 表示可以提前结束 */
export function shouldStop(answers: AssessAnswer[]): boolean {
  if (answers.length < 4) return false;
  const last2 = answers.slice(-2);
  return last2.length === 2 && last2.every((a) => a.result === 'wrong' || a.result === 'skip');
}

export interface AssessOutcome {
  profile: EnglishProfile;
  level: LevelId;
  /** 给家长看的一段话，说明判断依据 */
  report: string;
  /** 答对率，只在家长端内部使用 */
  accuracy: number;
}

/**
 * 给测评结果定级。
 *
 * 不同题型喂给不同维度：听音点图 → 听力和词汇；跟读 → 口语和发音；
 * 看词选图 → 认读。跳过跟读不扣发音分，只记「还不愿意开口」这个行为，
 * 因为「不说」和「说不对」是两件事。
 */
export function scoreAssessment(age: number, items: AssessItem[], answers: AssessAnswer[]): AssessOutcome {
  const p = initialProfile(age);
  const byId = new Map(items.map((i) => [i.id, i]));

  const bucket = {
    listen: { got: 0, max: 0 },
    say: { got: 0, max: 0, skipped: 0 },
    read: { got: 0, max: 0 },
  };

  for (const a of answers) {
    const it = byId.get(a.itemId);
    if (!it) continue;
    // 难题答对更有说服力，所以按 tier 加权
    const weight = it.tier;
    const score = a.result === 'right' ? 1 : a.result === 'close' ? 0.6 : 0;
    // 用了提示的正确要打折：那更像「跟着做」而不是「会」
    const got = score * (a.hinted ? 0.5 : 1) * weight;

    if (it.kind === 'listen-pick') {
      bucket.listen.got += got;
      bucket.listen.max += weight;
    } else if (it.kind === 'say') {
      bucket.say.max += weight;
      if (a.result === 'skip') bucket.say.skipped += 1;
      else bucket.say.got += got;
    } else {
      bucket.read.got += got;
      bucket.read.max += weight;
    }
  }

  const pct = (b: { got: number; max: number }) => (b.max ? b.got / b.max : 0);

  const lis = pct(bucket.listen);
  const say = pct(bucket.say);
  const read = bucket.read.max ? pct(bucket.read) : -1;

  if (bucket.listen.max) {
    p.listening = clamp(12 + lis * 78, 8, 95);
    p.vocabulary = clamp(10 + lis * 72, 8, 92);
    p.comprehension = clamp(10 + lis * 68, 8, 90);
  }
  if (bucket.say.max) {
    // 全部跳过：口语给低值，但明确是「没开口」，不是「说不对」
    const allSkipped = bucket.say.skipped >= Math.ceil(bucket.say.max / 2);
    p.speaking = allSkipped ? clamp(p.speaking - 6, 5, 100) : clamp(10 + say * 74, 8, 92);
    p.pronunciation = allSkipped ? clamp(p.pronunciation - 4, 5, 100) : clamp(10 + say * 70, 8, 90);
    p.sentence = clamp(6 + say * 55, 5, 85);
    p.participation.attempts += bucket.say.max - bucket.say.skipped;
    p.participation.skips += bucket.say.skipped;
    p.participation.voluntarySpeak += Math.max(0, Math.round((bucket.say.max - bucket.say.skipped) * say));
  }
  if (read >= 0) {
    p.reading = clamp(6 + read * 76, 5, 92);
  } else {
    p.reading = age >= 7 ? 12 : 5;
  }
  p.retention = clamp((p.listening + p.vocabulary) / 2 - 6, 5, 90);

  const level = levelOf(p);

  const total = answers.length;
  const rightCount = answers.filter((a) => a.result === 'right').length;
  const accuracy = total ? rightCount / total : 0;

  const lines: string[] = [];
  lines.push(`一共 ${total} 题，答对 ${rightCount} 题。`);
  if (bucket.listen.max) {
    lines.push(
      lis >= 0.75
        ? '听音找图基本都能点对，听力有底子。'
        : lis >= 0.4
          ? '简单的词能听出来，稍难一点的还需要图片帮忙。'
          : '目前主要靠图片理解，听到单词还对不上意思。',
    );
  }
  if (bucket.say.max) {
    if (bucket.say.skipped >= Math.ceil(bucket.say.max / 2)) {
      lines.push('跟读环节大多没有开口。这很常见，接下来会从"听 + 指"开始，不急着让他说。');
    } else {
      lines.push(say >= 0.7 ? '愿意跟读，而且说得清楚。' : '愿意开口，发音还在模仿阶段。');
    }
  }
  if (read >= 0) {
    lines.push(read >= 0.6 ? '能认出学过的单词，可以开始接触简单阅读。' : '暂时还认不出英文单词，先不安排认读内容。');
  } else {
    lines.push('这个年龄段没有安排认字题目，先把听和说打好。');
  }

  return { profile: p, level, report: lines.join(''), accuracy };
}
