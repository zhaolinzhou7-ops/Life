import type { Difficulty } from '../core/economy';

/** 对局内一方的实时/最终战况快照。 */
export interface StatPayload {
  wave: number;
  lives: number;
  maxLives: number;
  gold: number;
  /** 是否已结束本方对局 */
  over: boolean;
  /** 结束时是否通关（顶住全部波次） */
  won: boolean;
}

/** 点对点消息协议（房主与访客之间）。 */
export type NetMsg =
  | { t: 'hello'; name: string }
  | { t: 'config'; mapId: string; diff: Difficulty; seed: number; hostName: string }
  | { t: 'stat'; s: StatPayload }
  | { t: 'bye' };
