/**
 * 棋局存档：把下过的棋整盘存下来，之后随时能翻出来复盘。
 *
 * 之前的版本只能"下完立刻复盘"，关掉就再也找不回来了。这不行——
 * 学棋的人往往是过两天回头看才想明白，而且"最近棋局"这个入口
 * 本来就是首页的一级功能。
 *
 * 存法：只存**起始局面 + 着法序列**，不存每一步的棋盘。
 * 一盘 60 手压缩成 240 个字符，三十盘也不到 10KB，localStorage 完全吃得下；
 * 要看第 N 手的局面，重放一遍就有了，比存 60 个棋盘快也省。
 */
import { applyMove, type Board, type Color, type Move } from './rules';
import { fromFen, toFen } from './notation';
import type { ErrTag } from './teach';

const KEY = 'xq-archive';
/**
 * 最多留多少盘。一盘连复盘结论不到 1KB，五百盘四百来 KB，localStorage 吃得下。
 * 原来只留 40 盘、第 41 盘进来最早那盘就悄悄没了——下了两三个月的棋，回头想看开头那几盘就找不到了。
 * 真满了（配额不够）才从最老的删起，而且列表里会说一声（droppedCount）。
 */
export const MAX_GAMES = 500;
const DROPPED_KEY = 'xq-archive-dropped';

export interface ArchivedReview {
  blunders: number;
  mistakes: number;
  avgLoss: number;
  /** 各类错误各犯了几次，错误画像就靠这个 */
  tags: Partial<Record<ErrTag, number>>;
  /** 你最该改的那一手：第几手、记谱、亏了多少 */
  worstPly?: number;
  worstText?: string;
  worstLoss?: number;
  /** 一句话总结，列表里直接显示 */
  headline?: string;
  /** 你这盘的准确率 / 对手的准确率（0～100） */
  accuracy?: number;
  foeAccuracy?: number;
}

export interface ArchivedGame {
  id: string;
  /** 本地日期 YYYY-MM-DD */
  d: string;
  ts: number;
  /** 起始局面（让子局不是标准开局，所以必须存） */
  fen: string;
  /** 着法序列，每手 4 个字符：起点 x、起点 y、终点 x、终点 y */
  moves: string;
  /** 你执哪一方 */
  side: Color;
  result: 'win' | 'loss' | 'draw';
  /** 难度名，如"初级" */
  level: string;
  rival?: string;
  /** 复盘分析结果。没复盘过就没有这一项 */
  review?: ArchivedReview;
}

// ───────────────────────── 着法的紧凑编码 ─────────────────────────

/** 一手棋 → 4 个字符。坐标都是 0..9，直接用数字字符 */
export function encodeMoves(moves: Move[]): string {
  return moves.map((m) => `${m.fx}${m.fy}${m.tx}${m.ty}`).join('');
}

/** 4 个字符 → 一手棋。长度不对或有非数字就当作存档损坏，返回已经解出来的部分 */
export function decodeMoves(s: string): Move[] {
  const out: Move[] = [];
  for (let i = 0; i + 4 <= s.length; i += 4) {
    const n = [s[i], s[i + 1], s[i + 2], s[i + 3]].map((c) => Number(c));
    if (n.some((v) => !Number.isInteger(v) || v < 0 || v > 9)) break;
    out.push({ fx: n[0], fy: n[1], tx: n[2], ty: n[3] });
  }
  return out;
}

/** 把一盘棋重放成每一手之前的局面序列（boards[i] = 走第 i 手之前） */
export function replay(start: Board, moves: Move[]): Board[] {
  const out: Board[] = [start];
  let cur = start;
  for (const m of moves) {
    cur = applyMove(cur, m);
    out.push(cur);
  }
  return out;
}

/** 从存档还原出起始局面和着法。存档坏了返回 null，上层显示"这局读不出来" */
export function openGame(g: ArchivedGame): { start: Board; startColor: Color; moves: Move[] } | null {
  const parsed = fromFen(g.fen);
  if (!parsed) return null;
  return { start: parsed.board, startColor: parsed.toMove, moves: decodeMoves(g.moves) };
}

// ───────────────────────── 存取 ─────────────────────────

function load(): ArchivedGame[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const d = JSON.parse(raw);
    return Array.isArray(d) ? (d as ArchivedGame[]) : [];
  } catch {
    // 隐私模式 / 存档损坏：当成没有历史，别让首页崩掉
    return [];
  }
}

/**
 * 写回去。超过上限、或者手机存储配额满了写不进去，从最老的删起，删了几盘记下来（列表里会说）。
 * 原来写不进去就"静默放弃"——刚下完的那一盘就这么没了。
 */
function store(list: ArchivedGame[]) {
  let keep = list.slice(0, MAX_GAMES);
  let dropped = list.length - keep.length;
  for (;;) {
    try {
      localStorage.setItem(KEY, JSON.stringify(keep));
      break;
    } catch {
      if (keep.length <= 1) return;
      const cut = Math.max(1, Math.ceil(keep.length / 10));
      keep = keep.slice(0, keep.length - cut);
      dropped += cut;
    }
  }
  if (dropped > 0) {
    try {
      localStorage.setItem(DROPPED_KEY, String(droppedCount() + dropped));
    } catch {
      /* 记不下就不说了 */
    }
  }
}

/** 因为存不下、删掉了的最老的棋一共几盘（列表底下说一声，建议先备份） */
export function droppedCount(): number {
  try {
    return Number(localStorage.getItem(DROPPED_KEY) ?? 0) || 0;
  } catch {
    return 0;
  }
}

/** 最近的棋局，新的在前 */
export function listGames(limit = MAX_GAMES): ArchivedGame[] {
  return load().slice(0, limit);
}

export function getGame(id: string): ArchivedGame | undefined {
  return load().find((g) => g.id === id);
}

export function gameCount(): number {
  return load().length;
}

/** 同一毫秒里连存多盘时用来区分的序号 */
let seq = 0;

/**
 * 生成一个在现有存档里**保证不重复**的 id。
 *
 * 上一版是「时间戳 + 一个随机数」。同一毫秒里存两盘棋的概率看着很低，
 * 但随机空间只有 1296，二十盘就有一成几的碰撞率——而碰撞的后果很严重：
 * setGameReview 会把复盘结论写到另一盘棋上，用户点开"最近棋局"看到的
 * 是别的对局的分析。这种 bug 在界面上完全看不出来，只会让人觉得
 * "这软件的复盘是瞎说的"。所以直接和现有 id 对一遍，撞了就换。
 */
function freshId(list: ArchivedGame[], ts: number): string {
  const used = new Set(list.map((g) => g.id));
  for (;;) {
    const id = `g${ts.toString(36)}-${(seq++).toString(36)}`;
    if (!used.has(id)) return id;
  }
}

/** 存一盘棋，返回它的 id */
export function archiveGame(g: Omit<ArchivedGame, 'id' | 'd' | 'ts'>): string {
  const list = load();
  const ts = Date.now();
  const id = freshId(list, ts);
  list.unshift({ ...g, id, ts, d: new Date().toLocaleDateString('sv') });
  store(list);
  return id;
}

/** 复盘算完之后，把结论回填到那一盘上 */
export function setGameReview(id: string, review: ArchivedReview) {
  const list = load();
  const g = list.find((x) => x.id === id);
  if (!g) return;
  g.review = review;
  store(list);
}

export function clearArchive() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 清不掉也无所谓 */
  }
}

/** 从当前棋盘存一盘：调用方只有 Board 和 Move[]，这里负责转成存档格式 */
export function archiveFromBoard(
  start: Board,
  startColor: Color,
  moves: Move[],
  meta: { side: Color; result: ArchivedGame['result']; level: string; rival?: string },
): string {
  return archiveGame({ fen: toFen(start, startColor), moves: encodeMoves(moves), ...meta });
}
