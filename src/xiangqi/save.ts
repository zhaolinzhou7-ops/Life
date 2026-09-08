/**
 * 象棋学习进度的本地存档。
 *
 * 结构上对齐 sing/save.ts（同一个 App 里的另一套训练系统），
 * 一律 localStorage、读写都吞异常——隐私模式下也不能把界面搞崩。
 *
 * 关键设计：**五维分开记分**。一个人可能杀法很好、残局是白痴，
 * 只给一个总分就看不出该练什么，雷达图才是有用的诊断。
 */

import type { Puzzle } from './puzzles';

const KEY = 'xq-save';

/** 五个能力维度。顺序就是课程的优先级：先不漏着，再算得清，最后才是布局 */
export type Dim = 'safety' | 'mate' | 'tactic' | 'endgame' | 'opening';

export const DIMS: Dim[] = ['safety', 'mate', 'tactic', 'endgame', 'opening'];

export const DIM_INFO: Record<Dim, { name: string; emoji: string; desc: string }> = {
  safety: { name: '眼力', emoji: '👁', desc: '看不看得见对方的威胁，会不会白送子' },
  mate: { name: '杀法', emoji: '⚔️', desc: '认不认得杀棋图形，算不算得清强制着法' },
  tactic: { name: '战术', emoji: '🎯', desc: '捉双、牵制、闪击这些赢子手段' },
  endgame: { name: '残局', emoji: '🏁', desc: '少子局面能不能走出正确结果' },
  opening: { name: '布局', emoji: '📖', desc: '开局有没有章法，知不知道自己在干什么' },
};

/** 段位表：贴中国棋友的说法，比裸分数有体感 */
export const RANKS: { min: number; name: string; desc: string }[] = [
  { min: 0, name: '入门', desc: '会走子，规则清楚' },
  { min: 900, name: '新手', desc: '能下完一盘，但常漏着' },
  { min: 1100, name: '初级', desc: '棋友级，会简单杀法' },
  { min: 1300, name: '中级', desc: '公园中上水平' },
  { min: 1500, name: '高级', desc: '公园高手 / 网络业 2-3' },
  { min: 1700, name: '准专业', desc: '业 4-5' },
  { min: 1900, name: '专业级', desc: '——' },
];

export function rankOf(r: number) {
  let hit = RANKS[0];
  for (const x of RANKS) if (r >= x.min) hit = x;
  return hit;
}

export interface Rating {
  /** 当前分 */
  r: number;
  /** 做过多少题，用来估置信度：题少时分数不准，要说清楚 */
  n: number;
}

/** 错题卡：间隔重复用。box 决定下次多久之后再出现 */
export interface SrsCard {
  id: string;
  /** 下次该练的日子（自 1970 起的天数） */
  due: number;
  /** 0..4，对应间隔 1/3/7/21/60 天 */
  box: number;
  /** 一共错过几次 */
  wrong: number;
}

export const SRS_INTERVALS = [1, 3, 7, 21, 60];

export interface AssessRecord {
  d: string;
  overall: number;
  dims: Record<Dim, number>;
}

export interface GameRecord {
  d: string;
  won: boolean;
  blunders: number;
  mistakes: number;
  avgLoss: number;
}

interface SaveData {
  ratings: Record<Dim, Rating>;
  /** 有没有做过测评。没测过就不知道该从哪一阶段开始 */
  assessed: boolean;
  history: AssessRecord[];
  /** 课程进度 */
  stage: number;
  doneLessons: string[];
  /** 打卡 */
  lastDate: string;
  streak: number;
  /** 错题本 */
  srs: SrsCard[];
  /** 每道题做对过几次，避免反复出同一道已经烂熟的题 */
  solved: Record<string, number>;
  games: GameRecord[];
  /**
   * 你自己实战里的漏着，做成题存下来。
   *
   * 这是整套系统里最针对你个人的一块：题库里的题是通用的，
   * 而这些是**你真的走错过**的局面。同一个坑掉第二次才是真的没长进。
   */
  own: Puzzle[];
  ownSeq: number;
}

const EMPTY_RATINGS = (): Record<Dim, Rating> => ({
  safety: { r: 1200, n: 0 },
  mate: { r: 1200, n: 0 },
  tactic: { r: 1200, n: 0 },
  endgame: { r: 1200, n: 0 },
  opening: { r: 1200, n: 0 },
});

const EMPTY = (): SaveData => ({
  ratings: EMPTY_RATINGS(),
  assessed: false,
  history: [],
  stage: 1,
  doneLessons: [],
  lastDate: '',
  streak: 0,
  srs: [],
  solved: {},
  games: [],
  own: [],
  ownSeq: 0,
});

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      return {
        ...EMPTY(),
        ...d,
        ratings: { ...EMPTY_RATINGS(), ...(d.ratings ?? {}) },
      };
    }
  } catch {
    // 隐私模式或存档损坏：当作新用户，别让界面崩掉
  }
  return EMPTY();
}

function store(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // 写不进去就算了，功能不依赖它
  }
}

export const today = () => new Date().toLocaleDateString('sv');
export const todayNum = () => Math.floor(Date.now() / 86400000);

// ---------------- 评分 ----------------

export function getRatings(): Record<Dim, Rating> {
  return load().ratings;
}

/** 总分：五维加权。眼力和杀法权重高，因为它们才是输棋的主因 */
export function overallOf(rs: Record<Dim, Rating>): number {
  const W: Record<Dim, number> = { safety: 1.3, mate: 1.2, tactic: 1, endgame: 1, opening: 0.7 };
  let s = 0;
  let w = 0;
  for (const d of DIMS) {
    s += rs[d].r * W[d];
    w += W[d];
  }
  return Math.round(s / w);
}

/** 置信区间：做的题越多越准。题少时必须明说，不然会误导 */
export function confidenceOf(rs: Record<Dim, Rating>): number {
  const n = DIMS.reduce((a, d) => a + rs[d].n, 0);
  if (n <= 0) return 400;
  return Math.round(Math.max(45, 400 / Math.sqrt(n)));
}

/** 最弱的一维，课程从这里切入 */
export function weakestDim(rs: Record<Dim, Rating>): Dim {
  return DIMS.reduce((a, d) => (rs[d].r < rs[a].r ? d : a), DIMS[0]);
}

export function setRatings(rs: Record<Dim, Rating>) {
  const d = load();
  d.ratings = rs;
  store(d);
}

/** Elo 更新：K 随做题量递减，前几题动得快、后面稳下来 */
export function updateRating(dim: Dim, puzzleRating: number, correct: boolean): Rating {
  const d = load();
  const cur = d.ratings[dim];
  const expect = 1 / (1 + 10 ** ((puzzleRating - cur.r) / 400));
  const k = cur.n < 5 ? 120 : cur.n < 15 ? 70 : cur.n < 40 ? 40 : 24;
  const next = {
    r: Math.round(Math.max(500, Math.min(2400, cur.r + k * ((correct ? 1 : 0) - expect)))),
    n: cur.n + 1,
  };
  d.ratings[dim] = next;
  store(d);
  return next;
}

export function isAssessed(): boolean {
  return load().assessed;
}

export function recordAssessment(dims: Record<Dim, number>) {
  const d = load();
  d.assessed = true;
  for (const k of DIMS) d.ratings[k] = { r: dims[k], n: Math.max(d.ratings[k].n, 6) };
  d.history.push({ d: today(), overall: overallOf(d.ratings), dims });
  if (d.history.length > 60) d.history.shift();
  store(d);
}

export function getHistory(): AssessRecord[] {
  return load().history;
}

// ---------------- 打卡 ----------------

/** 完成一次训练：推进连续天数。同一天重复练不重复计数 */
export function checkIn(): { streak: number; isNew: boolean } {
  const d = load();
  const t = today();
  if (d.lastDate === t) return { streak: d.streak, isNew: false };
  const y = new Date(Date.now() - 86400000).toLocaleDateString('sv');
  d.streak = d.lastDate === y ? d.streak + 1 : 1;
  d.lastDate = t;
  store(d);
  return { streak: d.streak, isNew: true };
}

export function getStreak(): { streak: number; lastDate: string } {
  const d = load();
  return { streak: d.streak, lastDate: d.lastDate };
}

// ---------------- 错题本（间隔重复） ----------------

/** 做错了就进错题本；已经在本子里的往回退一格，说明还没记住 */
export function markWrong(id: string) {
  const d = load();
  const c = d.srs.find((x) => x.id === id);
  if (c) {
    c.box = Math.max(0, c.box - 1);
    c.wrong++;
    c.due = todayNum() + SRS_INTERVALS[c.box];
  } else {
    d.srs.push({ id, box: 0, wrong: 1, due: todayNum() + SRS_INTERVALS[0] });
  }
  store(d);
}

/** 做对了：错题本里的往前进一格，满格就毕业移出 */
export function markRight(id: string) {
  const d = load();
  d.solved[id] = (d.solved[id] ?? 0) + 1;
  const i = d.srs.findIndex((x) => x.id === id);
  if (i >= 0) {
    const c = d.srs[i];
    c.box++;
    if (c.box >= SRS_INTERVALS.length) d.srs.splice(i, 1); // 毕业
    else c.due = todayNum() + SRS_INTERVALS[c.box];
  }
  store(d);
}

/** 今天该复习的错题 */
export function dueCards(limit = 10): SrsCard[] {
  const t = todayNum();
  return load()
    .srs.filter((c) => c.due <= t)
    .sort((a, b) => a.due - b.due || b.wrong - a.wrong)
    .slice(0, limit);
}

/** 不看到期时间，按"错得最多"排出来的错题（用户主动提前练时用） */
export function allDueSoon(limit = 10): SrsCard[] {
  return load()
    .srs.slice()
    .sort((a, b) => b.wrong - a.wrong || a.due - b.due)
    .slice(0, limit);
}

export function srsCount(): { total: number; due: number } {
  const d = load();
  const t = todayNum();
  return { total: d.srs.length, due: d.srs.filter((c) => c.due <= t).length };
}

export function solvedCount(id: string): number {
  return load().solved[id] ?? 0;
}

export function totalSolved(): number {
  const s = load().solved;
  let n = 0;
  for (const k in s) n += s[k];
  return n;
}

// ---------------- 课程 ----------------

export function getProgress(): { stage: number; doneLessons: string[] } {
  const d = load();
  return { stage: d.stage, doneLessons: d.doneLessons };
}

export function completeLesson(id: string, stage: number) {
  const d = load();
  if (!d.doneLessons.includes(id)) d.doneLessons.push(id);
  d.stage = Math.max(d.stage, stage);
  store(d);
}

export function setStage(stage: number) {
  const d = load();
  d.stage = stage;
  store(d);
}

// ---------------- 对局记录 ----------------

export function recordGame(g: Omit<GameRecord, 'd'>) {
  const d = load();
  d.games.push({ ...g, d: today() });
  if (d.games.length > 200) d.games.shift();
  store(d);
}

export function getGames(): GameRecord[] {
  return load().games;
}

// ---------------- 实战漏着 → 错题本 ----------------

/**
 * 把实战里走错的一手存成题，并直接排进错题本。
 * 已经存过同一个局面就不重复存（同一盘复盘两次不该刷出两道题）。
 */
export function addOwnPuzzle(p: Omit<Puzzle, 'id'>): string | null {
  const d = load();
  if (d.own.some((x) => x.fen === p.fen)) return null;
  const id = `own-${d.ownSeq++}`;
  d.own.push({ ...p, id });
  // 只留最近 200 道，别让存档无限涨
  if (d.own.length > 200) d.own.shift();
  d.srs.push({ id, box: 0, wrong: 1, due: todayNum() + SRS_INTERVALS[0] });
  store(d);
  return id;
}

export function getOwnPuzzles(): Puzzle[] {
  return load().own;
}

// ---------------- 导出 / 导入 ----------------
// localStorage 说清就清，几个月的进度不能说没就没。

export function exportSave(): string {
  return JSON.stringify(load());
}

export function importSave(text: string): boolean {
  try {
    const d = JSON.parse(text) as Partial<SaveData>;
    if (!d || typeof d !== 'object' || !d.ratings) return false;
    store({ ...EMPTY(), ...d, ratings: { ...EMPTY_RATINGS(), ...d.ratings } });
    return true;
  } catch {
    return false;
  }
}

export function resetSave() {
  store(EMPTY());
}
