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

/**
 * 天天象棋的业余级别——用来给测评一个起点，也给你一个能对上号的参照。
 *
 * 说明白：本 App 的分数是**内部刻度**，由题目难度（引擎要搜几层才找得到）
 * 定出来的，和天天象棋的等级分不是一回事，两者不能换算。
 * 这里只用你自报的级别决定"第一题出多难"，测几题之后就完全以实际表现为准。
 */
export const TT_LEVELS: { id: string; name: string; seed: number; desc: string }[] = [
  { id: 'none', name: '没怎么玩过', seed: 900, desc: '规则知道，实战不多' },
  { id: 'y13', name: '业 1-3', seed: 1050, desc: '能下完整局' },
  { id: 'y45', name: '业 4-5', seed: 1200, desc: '有基本战术意识' },
  { id: 'y67', name: '业 6-7', seed: 1350, desc: '公园里能赢大多数人' },
  { id: 'y89', name: '业 8-9', seed: 1500, desc: '本地强手' },
  { id: 'pro', name: '专业级以上', seed: 1600, desc: '受过系统训练' },
];

export const ttLevelById = (id: string) => TT_LEVELS.find((l) => l.id === id);

/**
 * 段位表：贴中国棋友的说法，比裸分数有体感。
 *
 * 这里**故意不写"业几"**。原来写了，而且和上面的 TT_LEVELS 互相打架——
 * 段位表说 1500 分约等于"业 2-3"，自报表却说"业 6-7"只值 1350 分，
 * 等于自己声称业 2-3 比业 6-7 强。各家平台的"业 N"根本不是一把尺子，
 * 硬写就一定会错。所以段位只描述**你能做到什么**，
 * 要和天天象棋对照的话走 ttNear()，那边只有一份数据，不会再打架。
 */
export const RANKS: { min: number; name: string; desc: string }[] = [
  { min: 0, name: '入门', desc: '会走子，规则清楚' },
  { min: 900, name: '新手', desc: '能下完一盘，但常漏着' },
  { min: 1100, name: '初级', desc: '会简单杀法，不太送子了' },
  { min: 1300, name: '中级', desc: '有战术意识，残局能走出结果' },
  { min: 1500, name: '高级', desc: '公园里少有对手，算得清三五步' },
  { min: 1700, name: '准专业', desc: '布局成体系，中局有计划' },
  { min: 1900, name: '专业级', desc: '受过系统训练的水平' },
];

export function rankOf(r: number) {
  let hit = RANKS[0];
  for (const x of RANKS) if (r >= x.min) hit = x;
  return hit;
}

/**
 * 这个分数大概相当于天天象棋的哪一档。
 *
 * 直接拿 TT_LEVELS 的起点分做最近邻，不另抄一份对照表——
 * 两份对照表迟早会对不上，上一版就是这么错的。
 * 说明里也要讲清楚这只是个粗对照：两边的尺子本来就不是同一把。
 */
export function ttNear(r: number) {
  let hit = TT_LEVELS[0];
  for (const l of TT_LEVELS) if (Math.abs(l.seed - r) < Math.abs(hit.seed - r)) hit = l;
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
  /** 自报的天天象棋级别（TT_LEVELS 的 id），只用来给测评定起点 */
  declared?: string;
  /**
   * 题目难度的自校准修正值（题号 -> 偏移分）。
   *
   * 这是难度问题的**根本解**。题库里的难度是引擎算的——"引擎要搜几层"、
   * "正解在浅层排第几"，衡量的都是机器的难度。但人和机器卡壳的地方根本不一样：
   * 一个吃子战术引擎 1 层就看穿，人可能盯半天；一个安静的好棋人一眼看出，
   * 引擎要搜很深。所以再怎么调引擎指标，都不可能对齐人的感受。
   *
   * 正经的谜题平台是靠**真实做题结果**来定难度的。这里照做：你每做一题，
   * 除了更新你的分，也按 Elo 反过来修正这道题的分——做对了它变简单，
   * 做错了它变难。做得越多，整个题库就越贴合你真实的难点。
   *
   * 单人 App 反而是最理想的场景：不需要"平均人"的难度，只需要对你准。
   */
  puzzleAdj: Record<string, number>;
  /** 残局与杀法图形的完成记录 */
  clearedEndgames: string[];
  clearedMates: string[];
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
  clearedEndgames: [],
  clearedMates: [],
  puzzleAdj: {},
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

/** 题目难度的自校准上限：允许纠偏，但不让单次异常把题的难度带跑 */
const ADJ_CAP = 320;
/** 题目一侧的 K 值。比人一侧小得多——一次做对做错的信息量有限 */
const PUZZLE_K = 40;

/** 这道题对你而言的实际难度（基准分 + 自校准修正） */
export function effectiveRating(id: string, base: number): number {
  const adj = load().puzzleAdj[id] ?? 0;
  return Math.round(base + adj);
}

export function getAdj(id: string): number {
  return load().puzzleAdj[id] ?? 0;
}

/**
 * 反过来修正题目难度：你做对了说明它比标称简单，做错了说明比标称难。
 * 和 updateRating 是同一次 Elo 的两边。
 */
export function calibratePuzzle(id: string, base: number, userRating: number, correct: boolean) {
  const d = load();
  const cur = d.puzzleAdj[id] ?? 0;
  const pr = base + cur;
  // 从题目视角看：题"赢"了（你做错）就该加分
  const expect = 1 / (1 + 10 ** ((userRating - pr) / 400));
  const next = cur + PUZZLE_K * ((correct ? 0 : 1) - expect);
  d.puzzleAdj[id] = Math.round(Math.max(-ADJ_CAP, Math.min(ADJ_CAP, next)));
  store(d);
}

/** 已经被你的成绩校准过的题目数 */
export function calibratedCount(): number {
  return Object.keys(load().puzzleAdj).length;
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

export function getDeclared(): string | undefined {
  return load().declared;
}

export function setDeclared(id: string) {
  const d = load();
  d.declared = id;
  store(d);
}

/** 测评的起始估计：自报过级别就用它，没报就用中间值 */
export function seedRating(): number {
  const id = load().declared;
  if (!id) return 1200;
  return ttLevelById(id)?.seed ?? 1200;
}

// ---------------- 残局 / 杀法图形完成记录 ----------------

export function markEndgameCleared(id: string) {
  const d = load();
  if (!d.clearedEndgames.includes(id)) d.clearedEndgames.push(id);
  store(d);
}

export function markMateCleared(id: string) {
  const d = load();
  if (!d.clearedMates.includes(id)) d.clearedMates.push(id);
  store(d);
}

export function getCleared(): { endgames: string[]; mates: string[] } {
  const d = load();
  return { endgames: d.clearedEndgames, mates: d.clearedMates };
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

/**
 * 清掉指向已经不存在的题目的复习卡。
 *
 * 题库会变——修数据时删掉过错题，自己实战抓的题也会被 200 道上限挤掉。
 * 卡还留着的话，首页会显示"12 道待复习"而点进去只有 8 道。
 * save.ts 不能反过来 import 题库（会成环），所以由上层把"这题还在不在"传进来。
 */
export function pruneSrs(exists: (id: string) => boolean): number {
  const d = load();
  const before = d.srs.length;
  d.srs = d.srs.filter((c) => exists(c.id));
  if (d.srs.length !== before) store(d);
  return before - d.srs.length;
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

/**
 * 实战表现：比做题分数更靠谱的水平指标，而且**没有天花板**。
 *
 * 做题分数受题库难度上限限制（强手会被低估），但"每盘漏几次、平均亏多少分"
 * 是从你真实对局里量出来的，多强都能测。国际象棋平台评估水平也主要看这个。
 *
 * 注意这个数只跟你自己比才有意义——它是相对本引擎 6 层判断的口径，
 * 不能拿去和别的软件比。看它随时间往下走，就是在涨棋。
 */
export function playStats(recent = 10): {
  games: number;
  blundersPerGame: number;
  mistakesPerGame: number;
  avgLoss: number;
  winRate: number;
  /** 和更早的对局比，平均亏损降了多少（正数=在进步） */
  trend: number | null;
} | null {
  const g = load().games;
  if (!g.length) return null;
  const last = g.slice(-recent);
  const n = last.length;
  const sum = (f: (x: GameRecord) => number) => last.reduce((a, x) => a + f(x), 0);
  let trend: number | null = null;
  if (g.length >= recent * 2) {
    const prev = g.slice(-recent * 2, -recent);
    const prevAvg = prev.reduce((a, x) => a + x.avgLoss, 0) / prev.length;
    trend = Math.round(prevAvg - sum((x) => x.avgLoss) / n);
  }
  return {
    games: n,
    blundersPerGame: Math.round((sum((x) => x.blunders) / n) * 10) / 10,
    mistakesPerGame: Math.round((sum((x) => x.mistakes) / n) * 10) / 10,
    avgLoss: Math.round(sum((x) => x.avgLoss) / n),
    winRate: Math.round((sum((x) => (x.won ? 1 : 0)) / n) * 100),
    trend,
  };
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
  // 只留最近 200 道，别让存档无限涨。丢掉题的同时**必须把它的复习卡一起丢掉**，
  // 否则错题本里会留下一堆指向不存在题目的卡：界面上数字有、点进去是空的。
  if (d.own.length > 200) {
    const gone = d.own.shift();
    if (gone) d.srs = d.srs.filter((c) => c.id !== gone.id);
  }
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
