/**
 * 自适应复习（间隔重复）
 *
 * 目标是解决「今天学了，明天忘了，再重新学」。做法是 Leitner 盒 + 递增间隔，
 * 但针对儿童做了三处调整，和成人的 SM-2 不一样：
 *
 *  1. **答错不清零。** 成人算法里答错常常直接回到第一天，对孩子太挫败，
 *     而且真实情况往往是走神而不是不会。这里只退一盒，让它当天再出现一次。
 *  2. **错误按环节分开记。** 同一个词，「看图认不出」和「听不出来」是两种
 *     薄弱点，处方完全不同（前者加图片配对，后者加听力输入）。合并成一个
 *     错误率就把这个信息丢了。
 *  3. **掌握不等于不再见。** 判定为 mastered 之后只是把间隔拉长，
 *     词仍然会在故事和游戏里复现——「使用场景复现」比单纯的卡片复习更牢。
 */

import type { ResultTag, WordMemory } from '../types';
import { DAY_MS, clamp } from './util';

/** 每一盒对应的复习间隔（天）。第 0 盒当天再出一次 */
export const INTERVALS = [0, 1, 2, 4, 8, 16];
export const MAX_BOX = INTERVALS.length - 1;

export function newMemory(wordId: string, now: number): WordMemory {
  return {
    wordId,
    box: 0,
    streak: 0,
    seen: 0,
    correct: 0,
    wrong: 0,
    lastSeenAt: now,
    dueAt: now,
    errors: { recognize: 0, listen: 0, speak: 0, use: 0 },
    firstLearnedAt: now,
    mastered: false,
  };
}

export type Stage = 'recognize' | 'listen' | 'speak' | 'use';

/**
 * 记一次作答，返回新的记忆状态（不改入参）。
 *
 * hinted=true 时即使答对也不升盒：用提示答出来的，说明还没真会。
 */
export function applyResult(
  mem: WordMemory,
  result: ResultTag,
  stage: Stage,
  now: number,
  hinted = false,
): WordMemory {
  const m: WordMemory = { ...mem, errors: { ...mem.errors } };
  m.seen += 1;
  m.lastSeenAt = now;

  if (result === 'right') {
    m.correct += 1;
    if (hinted) {
      // 靠提示答对：不升盒，但也不罚，当天稍后再来一次
      m.dueAt = now + 10 * 60 * 1000;
    } else {
      m.streak += 1;
      m.box = clamp(m.box + 1, 0, MAX_BOX);
      m.dueAt = now + INTERVALS[m.box] * DAY_MS;
    }
  } else if (result === 'close') {
    // 接近正确（跟读不够准、说漏一个词）：算尝试过，不升不降，当天再见一次
    m.correct += 0;
    m.dueAt = now + 15 * 60 * 1000;
  } else if (result === 'wrong') {
    m.wrong += 1;
    m.streak = 0;
    m.errors[stage] += 1;
    m.box = clamp(m.box - 1, 0, MAX_BOX);
    m.dueAt = now; // 立刻重新排队，本次学习里就会再出现
  } else {
    // skip：不算错，但也要尽快再见一次。反复跳过会被薄弱点检测抓到
    m.dueAt = now + 30 * 60 * 1000;
  }

  // §19：连续正确 3 次且进到高盒，才算掌握，之后复习频率大幅下降
  m.mastered = m.streak >= 3 && m.box >= 4;
  return m;
}

/** 到期该复习的词，按「逾期最久」排前面 */
export function dueWords(mems: WordMemory[], now: number, limit = 999): WordMemory[] {
  return mems
    .filter((m) => m.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt)
    .slice(0, limit);
}

/** 已掌握的词 */
export function masteredWords(mems: WordMemory[]): WordMemory[] {
  return mems.filter((m) => m.mastered);
}

/** 正在学、还没掌握的词 */
export function learningWords(mems: WordMemory[]): WordMemory[] {
  return mems.filter((m) => !m.mastered);
}

/**
 * 这个词现在有多「危险」（0~1，越高越该重点练）。
 *
 * 逾期越久越危险，错得越多越危险，但已掌握的会被大幅压低——
 * 掌握过的词偶尔错一次不该立刻把它拉回重点训练。
 */
export function riskOf(m: WordMemory, now: number): number {
  const overdueDays = Math.max(0, (now - m.dueAt) / DAY_MS);
  const errRate = m.seen ? m.wrong / m.seen : 0;
  let r = clamp(overdueDays / 8, 0, 0.5) + errRate * 0.5;
  if (m.mastered) r *= 0.35;
  return clamp(r, 0, 1);
}

/**
 * 预测「明天还记得吗」。
 *
 * 不用任何遗忘曲线公式去算一个假的百分比——我们没有数据支撑那种精度。
 * 这里只给三档，且判据是看得见的：盒号 + 连续正确 + 距离上次多久。
 */
export function retentionBand(m: WordMemory, now: number): 'solid' | 'fading' | 'shaky' {
  const days = (now - m.lastSeenAt) / DAY_MS;
  if (m.mastered && days < INTERVALS[MAX_BOX]) return 'solid';
  if (m.box >= 2 && m.streak >= 1 && days < INTERVALS[m.box] + 2) return 'fading';
  return 'shaky';
}
