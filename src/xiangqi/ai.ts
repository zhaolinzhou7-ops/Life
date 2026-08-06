/** 象棋 AI 引擎：迭代加深 + alpha-beta + 置换表 + 静态搜索 + 杀手/历史启发
 *  评估参考专业象棋程序：子力价值 + 分类位置表 + 机动性 + 将帅安全 */
import {
  applyMove,
  isInCheck,
  legalMoves,
  type Board,
  type Color,
  type Move,
  type PType,
  COLS,
  ROWS,
} from './rules';

/** 子力价值（红方视角，单位：厘兵） */
const VAL: Record<PType, number> = { K: 60000, R: 1000, C: 500, H: 450, E: 220, A: 220, P: 100 };

// ---------------- 位置价值表（红方视角，y=9 是红底线） ----------------
// 表按 [y][x] 给出，红方直接用，黑方镜像。
const mk = (rows: number[][]) => rows;

/** 兵：过河后价值飙升，越靠近对方九宫越高 */
const PAWN_T = mk([
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [90, 90, 110, 120, 120, 120, 110, 90, 90],
  [90, 90, 110, 120, 120, 120, 110, 90, 90],
  [70, 90, 110, 110, 110, 110, 110, 90, 70],
  [70, 70, 70, 70, 70, 70, 70, 70, 70],
  [0, 0, 0, 20, 25, 20, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
]);

/** 马：中心与前场好，边路差（蹩腿多） */
const HORSE_T = mk([
  [0, -4, 0, 0, 0, 0, 0, -4, 0],
  [0, 2, 4, 4, 2, 4, 4, 2, 0],
  [4, 2, 8, 8, 4, 8, 8, 2, 4],
  [2, 6, 8, 6, 10, 6, 8, 6, 2],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
]);

/** 车：控线，中路与底线卒林线价值高 */
const ROOK_T = mk([
  [-2, 10, 6, 14, 12, 14, 6, 10, -2],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
]);

/** 炮：中炮与巡河价值高 */
const CANNON_T = mk([
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0],
]);

const TABLES: Partial<Record<PType, number[][]>> = {
  P: PAWN_T,
  H: HORSE_T,
  R: ROOK_T,
  C: CANNON_T,
};

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const MATE = 50000;

/** 局面评估（红方视角，正数利红） */
function evaluate(b: Board): number {
  let s = 0;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (!p) continue;
      let v = VAL[p.t];
      const t = TABLES[p.t];
      if (t) {
        // 黑方镜像行
        v += p.c === 'r' ? t[y][x] : t[ROWS - 1 - y][x];
      }
      // 士象在家护驾加分
      if (p.t === 'A' || p.t === 'E') {
        const home = p.c === 'r' ? y >= 7 : y <= 2;
        if (home) v += 12;
      }
      s += p.c === 'r' ? v : -v;
    }
  }
  return s;
}

/** 走子排序打分：置换表着法 > 吃子(MVV-LVA) > 杀手 > 历史 */
function scoreMove(b: Board, m: Move, ttMove: Move | null, killers: (Move | null)[], hist: number[][]): number {
  if (ttMove && m.fx === ttMove.fx && m.fy === ttMove.fy && m.tx === ttMove.tx && m.ty === ttMove.ty) return 1e9;
  const victim = b[m.ty][m.tx];
  if (victim) {
    const attacker = b[m.fy][m.fx]!;
    return 1e6 + VAL[victim.t] * 10 - VAL[attacker.t];
  }
  for (let i = 0; i < killers.length; i++) {
    const k = killers[i];
    if (k && k.fx === m.fx && k.fy === m.fy && k.tx === m.tx && k.ty === m.ty) return 9e5 - i * 1000;
  }
  return hist[m.fy * COLS + m.fx]?.[m.ty * COLS + m.tx] ?? 0;
}

interface TTEntry {
  depth: number;
  score: number;
  flag: 0 | 1 | 2; // 0=精确 1=下界(beta割) 2=上界
  move: Move | null;
}

/** 简易局面 key（含走子方） */
function boardKey(b: Board, color: Color): string {
  let s = color;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      s += p ? p.c + p.t : '.';
    }
  }
  return s;
}

export interface SearchOpts {
  /** 最大深度 */
  maxDepth: number;
  /** 时间上限（毫秒） */
  timeMs: number;
  /** 评估随机扰动幅度（低难度用来"看走眼"） */
  jitter: number;
}

class Engine {
  private tt = new Map<string, TTEntry>();
  private killers: (Move | null)[][] = [];
  private hist: number[][] = [];
  private deadline = 0;
  private stopped = false;
  nodes = 0;

  constructor() {
    for (let d = 0; d < 32; d++) this.killers[d] = [null, null];
    for (let i = 0; i < COLS * ROWS; i++) this.hist[i] = new Array(COLS * ROWS).fill(0);
  }

  /** 静态搜索：只展开吃子，消除水平线效应 */
  private quiescence(b: Board, color: Color, alpha: number, beta: number, ply: number): number {
    this.nodes++;
    const stand = color === 'r' ? evaluate(b) : -evaluate(b);
    if (stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    if (ply > 6) return stand;

    const caps = legalMoves(b, color).filter((m) => b[m.ty][m.tx]);
    caps.sort((a, z) => {
      const va = VAL[b[a.ty][a.tx]!.t] - VAL[b[a.fy][a.fx]!.t] / 10;
      const vz = VAL[b[z.ty][z.tx]!.t] - VAL[b[z.fy][z.fx]!.t] / 10;
      return vz - va;
    });
    for (const m of caps) {
      if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) {
        this.stopped = true;
        return alpha;
      }
      const nb = applyMove(b, m);
      const v = -this.quiescence(nb, other(color), -beta, -alpha, ply + 1);
      if (v >= beta) return v;
      if (v > alpha) alpha = v;
    }
    return alpha;
  }

  private search(b: Board, color: Color, depth: number, alpha: number, beta: number, ply: number): number {
    if (this.stopped) return alpha;
    if ((this.nodes & 1023) === 0 && Date.now() > this.deadline) {
      this.stopped = true;
      return alpha;
    }
    this.nodes++;

    const key = boardKey(b, color);
    const hit = this.tt.get(key);
    if (hit && hit.depth >= depth && ply > 0) {
      if (hit.flag === 0) return hit.score;
      if (hit.flag === 1 && hit.score >= beta) return hit.score;
      if (hit.flag === 2 && hit.score <= alpha) return hit.score;
    }

    const moves = legalMoves(b, color);
    if (moves.length === 0) return -MATE + ply; // 被将死/困毙
    if (depth <= 0) return this.quiescence(b, color, alpha, beta, 0);

    // 空着裁剪（不在被将军时）
    if (depth >= 3 && ply > 0 && !isInCheck(b, color)) {
      const evalNow = color === 'r' ? evaluate(b) : -evaluate(b);
      if (evalNow >= beta + 80) {
        // 简化版：静态评估远超 beta 时直接返回
        return evalNow;
      }
    }

    const ttMove = hit?.move ?? null;
    const scored = moves
      .map((m) => ({ m, s: scoreMove(b, m, ttMove, this.killers[ply] ?? [], this.hist) }))
      .sort((a, z) => z.s - a.s);

    let best = -Infinity;
    let bestMove: Move | null = null;
    const origAlpha = alpha;

    for (let i = 0; i < scored.length; i++) {
      const m = scored[i].m;
      const nb = applyMove(b, m);
      const isCap = !!b[m.ty][m.tx];
      let v: number;
      // 后期着法缩减（LMR）
      if (depth >= 3 && i >= 4 && !isCap && !isInCheck(nb, other(color))) {
        v = -this.search(nb, other(color), depth - 2, -alpha - 1, -alpha, ply + 1);
        if (v > alpha) v = -this.search(nb, other(color), depth - 1, -beta, -alpha, ply + 1);
      } else {
        v = -this.search(nb, other(color), depth - 1, -beta, -alpha, ply + 1);
      }
      if (this.stopped) return best > -Infinity ? best : alpha;

      if (v > best) {
        best = v;
        bestMove = m;
      }
      if (v > alpha) alpha = v;
      if (alpha >= beta) {
        // beta 截断：记杀手与历史
        if (!isCap) {
          const ks = this.killers[ply];
          if (ks) {
            ks[1] = ks[0];
            ks[0] = m;
          }
          this.hist[m.fy * COLS + m.fx][m.ty * COLS + m.tx] += depth * depth;
        }
        break;
      }
    }

    this.tt.set(key, {
      depth,
      score: best,
      flag: best <= origAlpha ? 2 : best >= beta ? 1 : 0,
      move: bestMove,
    });
    return best;
  }

  /** 迭代加深搜索根节点 */
  think(b: Board, color: Color, opts: SearchOpts): Move | null {
    this.deadline = Date.now() + opts.timeMs;
    this.stopped = false;
    this.nodes = 0;
    if (this.tt.size > 120000) this.tt.clear();

    const moves = legalMoves(b, color);
    if (moves.length === 0) return null;
    if (moves.length === 1) return moves[0];

    let best: Move = moves[0];
    for (let d = 1; d <= opts.maxDepth; d++) {
      let alpha = -Infinity;
      let localBest: Move | null = null;
      const ttMove = this.tt.get(boardKey(b, color))?.move ?? best;
      const scored = moves
        .map((m) => ({ m, s: scoreMove(b, m, ttMove, this.killers[0] ?? [], this.hist) }))
        .sort((a, z) => z.s - a.s);

      for (const { m } of scored) {
        const nb = applyMove(b, m);
        let v = -this.search(nb, other(color), d - 1, -Infinity, -alpha, 1);
        if (opts.jitter > 0) v += (Math.random() * 2 - 1) * opts.jitter;
        if (this.stopped) break;
        if (localBest === null || v > alpha) {
          alpha = v;
          localBest = m;
        }
      }
      if (localBest && !this.stopped) best = localBest;
      if (this.stopped || Date.now() > this.deadline) break;
      // 已找到必胜杀棋，不必再深搜
      if (alpha > MATE - 100) break;
    }
    return best;
  }
}

const engine = new Engine();

/** 为 color 选出走子。depth/时限/抖动由难度决定 */
export function bestMove(b: Board, color: Color, depth = 4, jitter = 1, timeMs = 1200): Move | null {
  return engine.think(b, color, { maxDepth: depth, timeMs, jitter });
}
