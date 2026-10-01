/**
 * 表现分析：把一次学习的结果写回能力画像和记忆状态
 *
 * 这一层是整个「动态学习引擎」的闭环点。没有它，学习计划就是永久固定的，
 * 孩子进步了还在做同样的题，退步了也没人发现。
 *
 * 两条设计原则：
 *
 * 1. **慢涨快跌不对称。** 答对提升幅度小于答错下降幅度的一半。
 *    一次蒙对不该让系统认为孩子会了——但连续错应该很快被察觉。
 *    这个不对称是故意的，宁可把内容排简单一点。
 *
 * 2. **用了提示的正确不算数。** 提示下答对只记「尝试过」，不加能力值。
 *    否则系统会以为孩子会了，越排越难，孩子越做越挫败。
 */

import type { ChildProfile, SessionRecord, SkillId, WordMemory } from '../types';
import { applyResult, newMemory } from './review';
import { levelOf } from './profile';
import { clamp } from './util';

/** 答对的涨幅。乘上这个系数，越靠近 100 涨得越慢 */
const GAIN = 2.2;
/** 答错的跌幅 */
const LOSS = 4.0;

function bump(v: number, delta: number): number {
  // 越接近满分越难涨，越接近 0 越难跌，避免画像跑到极端后再也调不回来
  const room = delta > 0 ? (100 - v) / 100 : v / 100;
  return clamp(v + delta * (0.35 + 0.65 * room), 2, 100);
}

export interface AnalyzeResult {
  profile: ChildProfile;
  memories: WordMemory[];
  /** 这次学习的一句话总结，用于完成页和家长端 */
  summary: string;
  /** 能力值的变化，用于家长端展示趋势 */
  deltas: Partial<Record<SkillId, number>>;
}

export function analyzeSession(
  profile: ChildProfile,
  memories: WordMemory[],
  session: SessionRecord,
  now = Date.now(),
): AnalyzeResult {
  const p: ChildProfile = {
    ...profile,
    english: { ...profile.english, participation: { ...profile.english.participation } },
    settings: { ...profile.settings },
  };
  const before: Record<string, number> = { ...p.english } as unknown as Record<string, number>;

  const memMap = new Map(memories.map((m) => [m.wordId, m]));

  let right = 0;
  let wrong = 0;
  let close = 0;
  let skipped = 0;

  for (const act of session.activities) {
    for (const o of act.outcomes) {
      // —— 词记忆 ——
      if (o.wordId) {
        const cur = memMap.get(o.wordId) ?? newMemory(o.wordId, now);
        memMap.set(o.wordId, applyResult(cur, o.result, o.stage ?? 'recognize', o.at || now, o.hinted));
      }

      // —— 能力值 ——
      const skill = o.skill;
      const cur = p.english[skill];
      if (typeof cur === 'number') {
        if (o.result === 'right') {
          right += 1;
          // 提示下答对不加分，只记参与
          if (!o.hinted) p.english[skill] = bump(cur, GAIN);
        } else if (o.result === 'close') {
          close += 1;
          p.english[skill] = bump(cur, GAIN * 0.3);
        } else if (o.result === 'wrong') {
          wrong += 1;
          p.english[skill] = bump(cur, -LOSS);
        } else {
          skipped += 1;
          // 跳过不扣能力值，但会被参与度记录抓到
        }
      }

      // —— 参与行为 ——
      const sig = p.english.participation;
      if (o.result === 'skip') sig.skips += 1;
      else sig.attempts += 1;
      if (o.hinted) sig.hintsUsed += 1;
      if (o.skill === 'speaking' || o.skill === 'pronunciation') {
        if (o.result !== 'skip') {
          if (o.hinted) sig.promptedSpeak += 1;
          else sig.voluntarySpeak += 1;
        }
      }
      sig.updatedAt = now;
    }
  }

  // 记得住不看单次作答，看「隔了几天还答对」。这里用盒号的整体分布近似
  const mems = [...memMap.values()];
  if (mems.length >= 3) {
    const avgBox = mems.reduce((a, m) => a + m.box, 0) / mems.length;
    const target = clamp(avgBox * 18, 5, 95);
    // 慢慢向目标靠，避免单次学习把这一项拉得太剧烈
    p.english.retention = clamp(p.english.retention * 0.82 + target * 0.18, 2, 100);
  }

  p.level = levelOf(p.english);

  const deltas: Partial<Record<SkillId, number>> = {};
  for (const k of ['listening', 'speaking', 'pronunciation', 'vocabulary', 'comprehension', 'reading', 'sentence', 'retention'] as SkillId[]) {
    const d = (p.english[k] as number) - (before[k] ?? 0);
    if (Math.abs(d) >= 0.1) deltas[k] = Math.round(d * 10) / 10;
  }

  const total = right + wrong + close + skipped;
  const summary =
    total === 0
      ? '这次没有作答记录。'
      : `答对 ${right} 题，接近 ${close} 题，答错 ${wrong} 题，跳过 ${skipped} 题；新学 ${session.newWords.length} 个词，复习 ${session.reviewWords.length} 个词。`;

  return { profile: p, memories: mems, summary, deltas };
}

/** 更新连续学习天数。跨一天算连续，跨两天以上断掉 */
export function updateStreak(profile: ChildProfile, today: string, daysSinceLast: number): ChildProfile {
  if (profile.lastStudyDate === today) return profile;
  const streak = profile.lastStudyDate && daysSinceLast === 1 ? profile.streak + 1 : 1;
  return { ...profile, streak, lastStudyDate: today };
}
