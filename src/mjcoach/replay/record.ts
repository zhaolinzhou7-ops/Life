/**
 * 牌谱记录。
 *
 * 存什么：**种子 + 动作序列**，不存每一步的完整局面。
 * 因为引擎是确定性的，这两样东西就能把整局牌逐张重放出来，
 * 存局面快照反而又大又容易和引擎版本对不上。
 * 一局牌的牌谱通常不到 2KB，存一百局也就一两百 KB，localStorage 完全够。
 *
 * 另外单独记一份「决策点」：玩家每次出牌/定缺/换三张时，
 * 当时的最优解是什么、他选了什么、差多少。这部分是复盘和出题的原料，
 * 重放时再算一遍也行，但那样每次打开复盘都要重算几十次分析，不值得。
 */

import type { Action } from '../rules/engine';
import { MahjongEngine, replay } from '../rules/engine';
import { getVariant, type RuleConfig } from '../rules/config';
import type { TileId } from '../rules/tiles';
import type { Severity } from '../analysis/efficiency';

/** 决策类型，和训练题型一一对应 */
export type DecisionKind = 'swap' | 'lack' | 'discard' | 'peng' | 'gang' | 'hu' | 'pass';

export const DECISION_NAME: Record<DecisionKind, string> = {
  swap: '换三张',
  lack: '定缺',
  discard: '出牌',
  peng: '碰',
  gang: '杠',
  hu: '胡',
  pass: '放弃',
};

/** 一个被记录下来的决策点 */
export interface DecisionRecord {
  /** 在动作日志里的下标，复盘时用它把牌局倒回这一刻 */
  index: number;
  turnIndex: number;
  kind: DecisionKind;
  seat: number;
  /** 玩家实际选择（出牌是牌 id，定缺是花色，换三张是三张牌） */
  chose: number | number[];
  /** 系统认为的最优选择 */
  best: number | number[];
  /** 差多少分 */
  loss: number;
  severity: Severity;
  /** 当时的向听数 */
  shanten: number;
  /** 选择之后的进张 */
  ukeire: number;
  /** 最优选择的进张 */
  bestUkeire: number;
  /** 一句话结论，复盘列表直接显示 */
  headline: string;
  /** 详细分析（结构化，给教学层和 AI 用） */
  detail: Record<string, unknown>;
}

export interface GameRecord {
  id: string;
  /** 用哪套规则打的 */
  configId: string;
  seed: number;
  /** 完整动作日志 */
  actions: Action[];
  /** 玩家坐哪 */
  heroSeat: number;
  /** 对手档位 */
  aiLevels: string[];
  /** 教学模式 */
  mode: string;
  startedAt: number;
  endedAt: number;
  /** 最终得分 */
  scores: number[];
  /** 玩家是否胡牌、胡了几次、几番 */
  heroWon: boolean;
  heroFan: number;
  heroWinNames: string[];
  /** 是否流局 */
  exhausted: boolean;
  /** 玩家的所有决策点 */
  decisions: DecisionRecord[];
}

export interface RecorderOptions {
  config: RuleConfig;
  seed: number;
  heroSeat: number;
  aiLevels: string[];
  mode: string;
}

/**
 * 记录器：跟着牌局走，把动作和决策点攒起来。
 * 它只负责「记」，不负责「判」——判断在 analyze.ts 里做，职责分开。
 */
export class Recorder {
  readonly record: GameRecord;

  constructor(opts: RecorderOptions) {
    this.record = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      configId: opts.config.id,
      seed: opts.seed,
      actions: [],
      heroSeat: opts.heroSeat,
      aiLevels: opts.aiLevels,
      mode: opts.mode,
      startedAt: Date.now(),
      endedAt: 0,
      scores: [],
      heroWon: false,
      heroFan: 0,
      heroWinNames: [],
      exhausted: false,
      decisions: [],
    };
  }

  /** 每应用一个动作就调一次 */
  onAction(a: Action) {
    this.record.actions.push(a);
  }

  /** 玩家做了一个值得记的决策 */
  onDecision(d: Omit<DecisionRecord, 'index'>) {
    this.record.decisions.push({ ...d, index: this.record.actions.length });
  }

  finish(engine: MahjongEngine) {
    const r = this.record;
    r.endedAt = Date.now();
    r.scores = engine.players.map((p) => p.score);
    const hero = engine.players[r.heroSeat];
    r.heroWon = hero.won;
    r.heroFan = hero.wins.reduce((a, w) => Math.max(a, w.score.fan), 0);
    r.heroWinNames = Array.from(new Set(hero.wins.flatMap((w) => w.score.names)));
    r.exhausted = engine.result?.exhausted ?? false;
    return r;
  }
}

/** 把牌谱倒回第 n 个动作之前的局面 */
export function rewind(rec: GameRecord, index: number): MahjongEngine {
  return replay(getVariant(rec.configId), rec.seed, rec.actions, index);
}

/** 完整重放到结束 */
export function replayAll(rec: GameRecord): MahjongEngine {
  return replay(getVariant(rec.configId), rec.seed, rec.actions);
}

/** 一局的时长（秒） */
export const durationOf = (rec: GameRecord): number =>
  Math.max(0, Math.round((rec.endedAt - rec.startedAt) / 1000));

// ==================== 本地存档 ====================

const KEY = 'mjcoach-games-v1';
/** 最多存多少局。超了就丢最早的——复盘只关心最近的牌 */
const MAX_GAMES = 60;

function safeGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function safeSet(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 隐私模式写不进去，忽略即可，不能让界面崩 */
  }
}

export function loadGames(): GameRecord[] {
  const list = safeGet<GameRecord[]>(KEY, []);
  return Array.isArray(list) ? list : [];
}

export function saveGame(rec: GameRecord) {
  const list = loadGames();
  list.unshift(rec);
  safeSet(KEY, list.slice(0, MAX_GAMES));
}

export function getGame(id: string): GameRecord | null {
  return loadGames().find((g) => g.id === id) ?? null;
}

export function clearGames() {
  safeSet(KEY, []);
}

/** 牌谱导出：方便用户把一局发给别人看，或者我们收集疑难局面 */
export function exportGame(rec: GameRecord): string {
  return JSON.stringify({ v: 1, ...rec });
}

export function importGame(text: string): GameRecord | null {
  try {
    const o = JSON.parse(text) as GameRecord & { v?: number };
    if (!o.seed || !Array.isArray(o.actions)) return null;
    return o;
  } catch {
    return null;
  }
}

/** 把牌谱里玩家的某类决策挑出来，训练系统按类型出题要用 */
export function decisionsOfKind(games: GameRecord[], kind: DecisionKind): { game: GameRecord; decision: DecisionRecord }[] {
  const out: { game: GameRecord; decision: DecisionRecord }[] = [];
  for (const g of games) for (const d of g.decisions) if (d.kind === kind) out.push({ game: g, decision: d });
  return out;
}

export type { TileId };
