/**
 * 间隔复习引擎
 *
 * 和"每天背 50 个单词"的区别在于两点：
 *
 * 1. **复习什么由数据决定**，不是由日期决定。每个词的下一次复习时间来自
 *    它自己的表现：错过几次、上次隔了多久、这次反应快不快。
 *
 * 2. **"记住了"分五级**。认识一个词和能在对话里用出来，中间差着四步。
 *    产品里到处写着的"已掌握 N 词"如果指的是第一级，那就是在骗用户。
 *    所以升级规则写死在下面，每一级都要求一种不同的、更难的证据：
 *
 *      1 认识    ← 见过一次
 *      2 熟悉    ← 中英对照选对
 *      3 会理解  ← 听音选对（不看文字）
 *      4 会使用  ← 能填进句子里
 *      5 熟练使用 ← 在对话/写作里**自己**用出来过两次（没有提示）
 *
 *    第 5 级刻意做得很难拿：它是这个产品唯一敢说"你会用这个词"的依据。
 *
 * 算法本身是 SM-2 的简化版。没有照搬 Anki 的全部参数，因为这里的复习
 * 不只是"翻卡片"——同一个词可能以听力题、造句题、对话的形式出现，
 * 硬套一套针对卡片设计的参数没有意义。
 */

import type { Mastery, UserVocab, VocabItem } from '../types';
import { VOCAB, VOCAB_MAP } from '../data/vocab';

export const DAY = 24 * 60 * 60 * 1000;

/** 一次复习的结果。practice 决定了这次能证明什么，从而决定掌握度能升到几级 */
export type PracticeKind =
  | 'recognize' // 中英对照，能证明"熟悉"
  | 'listen' // 听音辨义，能证明"会理解"
  | 'produce' // 造句/填空，能证明"会使用"
  | 'spontaneous'; // 对话或写作里自己用出来，通往"熟练使用"

/** 每种练习最高能把掌握度推到几级。做对一道对照题不能证明你会用 */
const CEILING: Record<PracticeKind, Mastery> = {
  recognize: 2,
  listen: 3,
  produce: 4,
  spontaneous: 5,
};

export function freshVocab(word: string, now = Date.now()): UserVocab {
  return {
    word,
    mastery: 1,
    reviews: 0,
    errorCount: 0,
    lastReview: now,
    nextReview: now + DAY, // 新学的词第二天就该再见一面
    ease: 2.5,
    intervalDays: 1,
    spontaneousUses: 0,
    contexts: [],
  };
}

/**
 * 由"对不对"和"快不快"推出评分。
 *
 * 反应时间是真实测出来的（从题目渲染到提交），不是估的。阈值的依据是：
 * 一个真正熟的词，认出意思通常在 3 秒内；超过 8 秒基本是"想起来的"而不是
 * "记得的"，这种词下次该早点再见。
 */
export type Grade = 'again' | 'hard' | 'good' | 'easy';

export function gradeOf(correct: boolean, elapsedMs: number): Grade {
  if (!correct) return 'again';
  if (elapsedMs > 8000) return 'hard';
  if (elapsedMs < 3000) return 'easy';
  return 'good';
}

export interface ReviewOutcome {
  vocab: UserVocab;
  /** 掌握度变了没有，界面上要给出反馈 */
  masteryChanged: boolean;
  /** 下一次复习在几天后 */
  intervalDays: number;
}

/**
 * 记一次复习，返回更新后的词条。
 *
 * 纯函数：给同样的输入一定得到同样的输出，不读时钟以外的任何东西。
 * 这样才能测，也才能在出问题时复现。
 */
export function review(
  prev: UserVocab,
  kind: PracticeKind,
  correct: boolean,
  elapsedMs: number,
  now = Date.now(),
  context?: string,
): ReviewOutcome {
  const v: UserVocab = { ...prev, contexts: [...prev.contexts] };
  const grade = gradeOf(correct, elapsedMs);
  const before = v.mastery;

  v.reviews += 1;
  v.lastReview = now;
  v.lastElapsedMs = elapsedMs;
  if (context && !v.contexts.includes(context)) v.contexts.push(context);

  if (grade === 'again') {
    v.errorCount += 1;
    v.ease = Math.max(1.3, v.ease - 0.2);
    v.intervalDays = 0;
    // 答错就退一级。退到 1 为止——"见过"这件事不会因为答错而消失
    v.mastery = Math.max(1, v.mastery - 1) as Mastery;
    v.nextReview = now + 10 * 60 * 1000; // 十分钟后本次训练内再考一次
    return { vocab: v, masteryChanged: v.mastery !== before, intervalDays: 0 };
  }

  if (kind === 'spontaneous') v.spontaneousUses += 1;

  // 升级：一次只升一级，且不能超过这种练习能证明的上限
  const ceiling = CEILING[kind];
  if (v.mastery < ceiling) {
    // 升到第 5 级还要额外条件：自己用出来过两次。只做对题目升不上去
    if (ceiling === 5 && v.spontaneousUses < 2) {
      v.mastery = Math.max(v.mastery, 4) as Mastery;
    } else {
      v.mastery = (v.mastery + 1) as Mastery;
    }
  }

  if (grade === 'hard') {
    v.ease = Math.max(1.3, v.ease - 0.15);
    v.intervalDays = Math.max(1, Math.round(v.intervalDays * 1.2));
  } else {
    if (grade === 'easy') v.ease = Math.min(3.0, v.ease + 0.1);
    v.intervalDays =
      v.intervalDays <= 0 ? 1 : v.intervalDays === 1 ? 3 : Math.round(v.intervalDays * v.ease * (grade === 'easy' ? 1.3 : 1));
  }
  v.intervalDays = Math.min(180, v.intervalDays);
  v.nextReview = now + v.intervalDays * DAY;

  return { vocab: v, masteryChanged: v.mastery !== before, intervalDays: v.intervalDays };
}

/** 到期该复习的词 */
export function due(all: Record<string, UserVocab>, now = Date.now()): UserVocab[] {
  return Object.values(all).filter((v) => v.nextReview <= now);
}

/**
 * 今天最值得复习什么。
 *
 * 第 12 节的要求：系统自己决定，而不是"每天固定 50 个"。
 * 排序依据全部是真实记录下来的量：
 *   · 逾期越久越该复习（忘得越多）
 *   · 错得越多越该复习
 *   · 掌握度越低越该复习
 *   · 和用户目标相关的词优先（学了马上能用上，才记得住）
 */
export function pickReview(
  all: Record<string, UserVocab>,
  limit: number,
  opts: { tags?: string[]; now?: number } = {},
): UserVocab[] {
  const now = opts.now ?? Date.now();
  const tags = new Set(opts.tags ?? []);
  const score = (v: UserVocab): number => {
    const overdueDays = Math.max(0, (now - v.nextReview) / DAY);
    const item = VOCAB_MAP[v.word];
    const relevant = item && tags.size ? item.tags.some((t) => tags.has(t)) : false;
    return (
      Math.min(overdueDays, 30) * 2 + // 逾期
      v.errorCount * 3 + // 错误史
      (5 - v.mastery) * 2 + // 掌握度
      (relevant ? 4 : 0)
    );
  };
  return due(all, now)
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}

/**
 * 今天该学哪些新词。
 *
 * 只在复习量不大的时候才加新词——已经欠了一屁股债还继续借，是背单词
 * App 最常见的设计错误，也是用户放弃的主要原因之一。
 */
export function pickNew(
  all: Record<string, UserVocab>,
  limit: number,
  opts: { tags?: string[]; levels?: string[] } = {},
): VocabItem[] {
  const known = new Set(Object.keys(all));
  const tags = opts.tags ?? [];
  const levels = new Set(opts.levels ?? []);
  const pool = VOCAB.filter((v) => !known.has(v.word));
  const score = (v: VocabItem): number =>
    (tags.length && v.tags.some((t) => tags.includes(t)) ? 3 : 0) + (levels.size === 0 || levels.has(v.level) ? 2 : 0);
  return pool
    .slice()
    .sort((a, b) => score(b) - score(a))
    .slice(0, Math.max(0, limit));
}

/**
 * 从一段自由表达里找出"自己用出来"的目标词。
 *
 * 这是升到第 5 级的唯一途径，所以判定必须严格：
 * 必须是用户**没有被提示**的情况下写出来的，而且要整词匹配——
 * 光包含字母序列不算（"a bit" 不能被 "arbiter" 匹配上）。
 */
export function spontaneousHits(text: string, candidates: string[]): string[] {
  const low = ' ' + text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ').trim() + ' ';
  return candidates.filter((w) => low.includes(` ${w.toLowerCase()} `));
}

/** 掌握度分布，进步页要用 */
export function masteryBreakdown(all: Record<string, UserVocab>): Record<Mastery, number> {
  const out = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } as Record<Mastery, number>;
  for (const v of Object.values(all)) out[v.mastery] = (out[v.mastery] ?? 0) + 1;
  return out;
}

/**
 * "会用"的词数。
 *
 * 界面上只展示这个数，不展示"认识 N 词"——后者是个很容易做大、
 * 但对用户没有意义的数字。
 */
export const usableCount = (all: Record<string, UserVocab>): number =>
  Object.values(all).filter((v) => v.mastery >= 4).length;
