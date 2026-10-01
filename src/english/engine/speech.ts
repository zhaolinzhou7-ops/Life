/**
 * 跟读判定
 *
 * 输入是语音识别给的文本，不是音频。这一点决定了能力边界，必须诚实面对：
 * 我们**没有**音素级的发音评估能力，浏览器的 Web Speech API 只给转写文本。
 * 所以这里绝不产出「/θ/ 准确率 93.71%」这种数字——那是编的。
 *
 * 能诚实做到的是四件事（§12）：
 *   · 有没有说出目标词
 *   · 说出来的是不是接近（辅音骨架对上了但元音飘）
 *   · 有没有漏词
 *   · 完不完整
 *
 * 判定结果只有三档，对孩子只呈现一句鼓励：
 *   right —— "Perfect!"
 *   close —— "Almost! Listen again."
 *   wrong —— "Good try! Let's listen together."
 *
 * similarity 这个 0~1 的数存在结构体里，但只供引擎和家长端做趋势统计，
 * 任何儿童端视图都不允许把它渲染出来。
 */

import type { SpeechJudgement } from '../types';
import { ALMOST, PRAISE, TRY_AGAIN, pick } from '../data/phrases';

/** 去标点、转小写、压空格。识别结果经常带句号和大写 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 英语里不承载信息的词。判断「说出目标词了吗」时不该被这些稀释 */
const STOP = new Set(['a', 'an', 'the', 'is', 'are', 'am', 'it', 'this', 'that', 'to', 'of', 'and', 'my', 'i']);

export function contentWords(s: string): string[] {
  return normalize(s)
    .split(' ')
    .filter((w) => w && !STOP.has(w));
}

/**
 * 辅音骨架。
 *
 * 孩子（以及中文母语者）最常出错的是元音和 th/v/r 这几个音，辅音框架通常是对的。
 * 拿掉元音再比，就能把「说对了词但元音飘」和「说的根本不是这个词」分开——
 * 前者该说 "Almost!"，后者该重新听一遍。这是 close 和 wrong 的分界依据。
 */
export function skeleton(w: string): string {
  return w
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/^kn/, 'n')
    .replace(/^wr/, 'r')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/ck/g, 'k')
    .replace(/qu/g, 'kw')
    .replace(/x/g, 'ks')
    .replace(/c([eiy])/g, 's$1')
    .replace(/c/g, 'k')
    .replace(/z/g, 's')
    .replace(/v/g, 'f')
    .replace(/[aeiou]+/g, '')
    .replace(/(.)\1+/g, '$1');
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = cur;
  }
  return prev[b.length];
}

/** 0~1 的字符串相似度 */
export function ratio(a: string, b: string): number {
  const max = Math.max(a.length, b.length);
  if (!max) return 1;
  return 1 - levenshtein(a, b) / max;
}

/** 两个词像不像。先看原文，再看辅音骨架，取高的那个 */
export function wordSimilar(a: string, b: string): number {
  const direct = ratio(a, b);
  const sa = skeleton(a);
  const sb = skeleton(b);
  if (!sa && !sb) return direct;
  const skel = ratio(sa, sb);
  // 骨架相同但元音不同，最多给到 0.8：说明词对了但没说准
  return Math.max(direct, skel * 0.8);
}

export interface JudgeOptions {
  /** 目标句/词 */
  target: string;
  /** 识别到的文本。空字符串表示没听到 */
  heard: string;
  /** 可接受的备选答案（例如 "red" 也接受 "a red ball"） */
  accept?: string[];
  /** 随机种子，让鼓励语不总是同一句 */
  seed?: number;
  /** 这是第几次尝试。第二次起判定会放宽一点，避免卡在同一题上 */
  attempt?: number;
}

/**
 * 判定一次跟读。
 *
 * 判据和阈值写在这里，是为了能被测试钉死——
 * tests/english-engine.test.ts 里有一批真实孩子会说出来的句子做用例。
 */
export function judgeSpeech(opt: JudgeOptions): SpeechJudgement {
  const seed = opt.seed ?? Date.now();
  const heard = normalize(opt.heard);
  const attempt = opt.attempt ?? 1;

  if (!heard) {
    return {
      tag: 'wrong',
      similarity: 0,
      feedback: 'I did not hear you. Let\'s try again!',
      retry: true,
      note: '没有听到声音',
    };
  }

  // 目标可以有多个说法，取匹配最好的那个
  const targets = [opt.target, ...(opt.accept ?? [])].map(normalize).filter(Boolean);
  let best = { sim: 0, coverage: 0, quality: 0, missing: [] as string[], target: targets[0] ?? '' };

  for (const t of targets) {
    const tWords = contentWords(t);
    const hWords = contentWords(heard);
    const pool = hWords.length ? hWords : normalize(heard).split(' ');

    const missing: string[] = [];
    let hit = 0;
    // quality 是命中的那些词「说得多准」的平均值。
    // coverage 回答「说到了吗」，quality 回答「说准了吗」——
    // 这两个必须分开，否则 three/tree 这种「词对了音不准」就没法和
    // 完全说对区分，close 这一档形同虚设。
    let qSum = 0;
    for (const tw of tWords) {
      let bestWord = 0;
      for (const hw of pool) bestWord = Math.max(bestWord, wordSimilar(tw, hw));
      if (bestWord >= 0.72) {
        hit += 1;
        qSum += bestWord;
      } else {
        missing.push(tw);
      }
    }
    const coverage = tWords.length ? hit / tWords.length : ratio(t, heard);
    const quality = hit ? qSum / hit : ratio(t, heard);
    const sim = Math.max(ratio(t, heard), coverage * quality);
    if (sim > best.sim) best = { sim, coverage, quality, missing, target: t };
  }

  const { sim, coverage, quality, missing } = best;

  // 说了一大堆额外的话，但目标词都在里面：对孩子来说这是好事，不扣分
  const extra = contentWords(heard).length - contentWords(best.target).length;

  let tag: SpeechJudgement['tag'];
  if (coverage >= 0.999 && quality >= 0.86) tag = 'right';
  else if (coverage >= 0.5 || sim >= 0.55) tag = 'close';
  else tag = 'wrong';

  // 第二次尝试起，close 直接放行。反复卡在同一个词上会让孩子失去兴趣，
  // 而且这个词本来就会进复习队列，明天还会再见。
  if (tag === 'close' && attempt >= 2) tag = 'right';

  let note: string | undefined;
  if (missing.length && missing.length < contentWords(best.target).length) {
    note = `漏了：${missing.join(' / ')}`;
  } else if (tag === 'close') {
    note = '词对了，发音还差一点';
  } else if (tag === 'wrong') {
    note = '说的和目标词差得比较远';
  } else if (extra > 2) {
    note = '说得比要求的还多';
  }

  const feedback =
    tag === 'right' ? pick(PRAISE, seed) : tag === 'close' ? pick(ALMOST, seed) : pick(TRY_AGAIN, seed);

  return {
    tag,
    similarity: Math.round(sim * 100) / 100,
    feedback,
    retry: tag !== 'right',
    heard,
    note,
  };
}
