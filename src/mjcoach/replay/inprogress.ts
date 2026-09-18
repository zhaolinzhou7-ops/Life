/**
 * 未打完的牌局。
 *
 * 手机上一个误触、一次刷新、一条来电，牌局就没了——对学习软件来说
 * 这比对游戏更伤：那一局的决策记录全丢，复盘和训练都拿不到素材。
 *
 * 好在引擎是确定性的：存下种子 + 动作日志，就能把牌局重放到中断的那一步，
 * 接着打。每应用一个动作就存一次，一局不到 2KB，存起来不心疼。
 */

import type { Action } from '../rules/engine';
import type { DecisionRecord } from './record';

export interface InProgressGame {
  configId: string;
  seed: number;
  aiLevels: string[];
  mode: string;
  actions: Action[];
  decisions: DecisionRecord[];
  startedAt: number;
  savedAt: number;
}

const KEY = 'mjcoach-inprogress-v1';

export function saveInProgress(g: Omit<InProgressGame, 'savedAt'>) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...g, savedAt: Date.now() }));
  } catch {
    /* 存不下就存不下，牌照打 */
  }
}

export function loadInProgress(): InProgressGame | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const g = JSON.parse(raw) as InProgressGame;
    if (!g || typeof g.seed !== 'number' || !Array.isArray(g.actions)) return null;
    // 太久之前的就别提了，用户早忘了那局在打什么
    if (Date.now() - g.savedAt > 3 * 86400000) return null;
    return g;
  } catch {
    return null;
  }
}

export function clearInProgress() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 忽略 */
  }
}
