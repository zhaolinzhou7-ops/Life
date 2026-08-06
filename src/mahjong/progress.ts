/** 麻将战绩与段位：跨局累计，存 localStorage，给对局一个长期目标 */

const KEY = 'mj-progress-v1';

export interface Progress {
  /** 累计净得分（可负） */
  total: number;
  /** 段位积分（只涨不跌到 0 以下，赢得多涨得快） */
  points: number;
  games: number;
  wins: number;
  /** 当前连胡局数 */
  streak: number;
  bestStreak: number;
  /** 单局最高番 */
  bestFan: number;
  /** 见过的番型 */
  seen: string[];
}

const EMPTY: Progress = {
  total: 0,
  points: 0,
  games: 0,
  wins: 0,
  streak: 0,
  bestStreak: 0,
  bestFan: 0,
  seen: [],
};

export const RANK_NAMES = ['初入茶馆', '街边散客', '茶馆常客', '巷口好手', '锦城老炮', '一方高手', '川渝名宿', '麻坛宗师'] as const;

export const RANKS = [
  { name: '初入茶馆', need: 0 },
  { name: '街边散客', need: 40 },
  { name: '茶馆常客', need: 110 },
  { name: '巷口好手', need: 220 },
  { name: '锦城老炮', need: 400 },
  { name: '一方高手', need: 660 },
  { name: '川渝名宿', need: 1000 },
  { name: '麻坛宗师', need: 1500 },
] as const;

export interface RankInfo {
  index: number;
  name: string;
  /** 到下一段还差多少分；已满级为 0 */
  toNext: number;
  /** 本段进度 0..1 */
  ratio: number;
  max: boolean;
}

export function rankOf(points: number): RankInfo {
  let i = 0;
  for (let k = 0; k < RANKS.length; k++) if (points >= RANKS[k].need) i = k;
  const max = i === RANKS.length - 1;
  const base = RANKS[i].need;
  const next = max ? base : RANKS[i + 1].need;
  return {
    index: i,
    name: RANKS[i].name,
    toNext: max ? 0 : next - points,
    ratio: max ? 1 : (points - base) / Math.max(1, next - base),
    max,
  };
}

export function load(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY, seen: [] };
    const p = JSON.parse(raw) as Partial<Progress>;
    return { ...EMPTY, ...p, seen: Array.isArray(p.seen) ? p.seen : [] };
  } catch {
    return { ...EMPTY, seen: [] };
  }
}

function save(p: Progress) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式下写不进去，忽略 */
  }
}

export interface RoundOutcome {
  /** 本局净得分 */
  delta: number;
  won: boolean;
  fan: number;
  /** 本局胡出的番型名 */
  names: string[];
  /** 场次倍率：新手 1 / 高手 2 / 大师 3，影响段位积分 */
  stake: number;
}

export interface ProgressDelta {
  before: Progress;
  after: Progress;
  rankBefore: RankInfo;
  rankAfter: RankInfo;
  levelUp: boolean;
  /** 本局新解锁的番型 */
  newNames: string[];
  gainedPoints: number;
}

/** 结算一局并写回；返回前后对比，供结算界面做动画 */
export function commit(o: RoundOutcome): ProgressDelta {
  const before = load();
  const after: Progress = { ...before, seen: before.seen.slice() };

  after.total += o.delta;
  after.games += 1;
  if (o.won) {
    after.wins += 1;
    after.streak = before.streak + 1;
    after.bestStreak = Math.max(after.bestStreak, after.streak);
    after.bestFan = Math.max(after.bestFan, o.fan);
  } else {
    after.streak = 0;
  }

  // 段位积分：赢了给底分 + 番数加成 + 连胜加成；输了给一点参与分，不倒扣
  let gained = 2;
  if (o.won) gained = Math.round((6 + Math.min(30, o.fan) + Math.min(10, after.streak * 2)) * o.stake);
  else gained = Math.round(2 * o.stake);
  after.points = Math.max(0, before.points + gained);

  const newNames = o.names.filter((n) => !before.seen.includes(n));
  for (const n of newNames) after.seen.push(n);

  save(after);
  const rankBefore = rankOf(before.points);
  const rankAfter = rankOf(after.points);
  return {
    before,
    after,
    rankBefore,
    rankAfter,
    levelUp: rankAfter.index > rankBefore.index,
    newNames,
    gainedPoints: gained,
  };
}

export function reset() {
  save({ ...EMPTY, seen: [] });
}
