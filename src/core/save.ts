import type { Difficulty } from './economy';

/** 每张地图每个难度的进度：是否通关、最高到达波次 */
export interface LevelProgress {
  completed: boolean;
  bestWave: number;
}

interface SaveData {
  progress: Record<string, Partial<Record<Difficulty, LevelProgress>>>;
  /** 无尽模式每张地图每个难度的最高波数 */
  endless?: Record<string, Partial<Record<Difficulty, number>>>;
}

const KEY = 'td3d-save-v1';

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return JSON.parse(raw) as SaveData;
  } catch {
    // 存档损坏时重置
  }
  return { progress: {} };
}

let data = load();

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    // 隐私模式下可能失败，忽略
  }
}

export function getProgress(mapId: string, diff: Difficulty): LevelProgress {
  return data.progress[mapId]?.[diff] ?? { completed: false, bestWave: 0 };
}

export function recordResult(mapId: string, diff: Difficulty, wave: number, won: boolean) {
  const cur = getProgress(mapId, diff);
  const next: LevelProgress = {
    completed: cur.completed || won,
    bestWave: Math.max(cur.bestWave, wave),
  };
  (data.progress[mapId] ??= {})[diff] = next;
  persist();
}

export function getEndlessBest(mapId: string, diff: Difficulty): number {
  return data.endless?.[mapId]?.[diff] ?? 0;
}

/** 记录无尽模式成绩，返回是否创造新纪录 */
export function recordEndless(mapId: string, diff: Difficulty, wave: number): boolean {
  const cur = getEndlessBest(mapId, diff);
  ((data.endless ??= {})[mapId] ??= {})[diff] = Math.max(cur, wave);
  persist();
  return wave > cur;
}
