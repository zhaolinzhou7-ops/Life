/**
 * 学习计划的装配层
 *
 * 把「画像 → 薄弱点 → 处方 → 今日任务」这条链串起来，
 * 让界面层只需要问一句「今天做什么」。
 *
 * 任务按天缓存：同一天重进不重新生成。这不是性能考虑，是产品考虑——
 * 「今天要做的事」中途变了，孩子和家长都会困惑。
 * 只有跨天，或者家长改了设置（时长、难度、目标、是否允许语音），才会重算。
 */

import type { ChildData } from './store';
import type { DailyMission } from './types';
import { detectWeakness, mergePrescriptions, type Weakness } from './engine/weakness';
import { generateMission } from './engine/mission';
import { dayKey } from './engine/util';

export function currentWeaknesses(data: ChildData, now = Date.now()): Weakness[] {
  return detectWeakness(data.profile.english, data.memories, now);
}

/** 设置指纹。变了就得重算今天的任务 */
function settingsKey(data: ChildData): string {
  const s = data.profile.settings;
  return `${s.dailyMinutes}|${s.difficulty}|${s.goal}|${s.allowVoice ? 1 : 0}`;
}

export function ensureMission(data: ChildData, date = dayKey(), now = Date.now()): DailyMission {
  const cached = data.mission;
  const key = settingsKey(data);
  if (cached && cached.date === date && cached.childId === data.profile.id) {
    // 用 seed 的低位藏设置指纹，避免为此多存一个字段
    if ((cached as DailyMission & { settingsKey?: string }).settingsKey === key) return cached;
  }

  const weaknesses = currentWeaknesses(data, now);
  const mission = generateMission({
    profile: data.profile,
    memories: data.memories,
    prescription: weaknesses.length ? mergePrescriptions(weaknesses) : undefined,
    date,
    now,
  });
  // 已经完成过的步骤，跨设置重算后保持完成状态，不让孩子重做
  if (cached && cached.date === date) {
    for (const s of mission.steps) {
      const old = cached.steps.find((x) => x.id === s.id);
      if (old?.done) s.done = true;
    }
  }
  (mission as DailyMission & { settingsKey?: string }).settingsKey = key;
  data.mission = mission;
  return mission;
}

/** 今天还没做完的第一步 */
export function nextStep(m: DailyMission) {
  return m.steps.find((s) => !s.done);
}

export function allDone(m: DailyMission): boolean {
  return m.steps.length > 0 && m.steps.every((s) => s.done);
}
