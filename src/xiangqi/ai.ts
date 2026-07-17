/** 象棋 AI：带 alpha-beta 剪枝的极大极小搜索 */
import {
  applyMove,
  legalMoves,
  type Board,
  type Color,
  type Move,
  type PType,
  ROWS,
  COLS,
} from './rules';

const VAL: Record<PType, number> = { K: 100000, R: 900, C: 450, H: 400, E: 200, A: 200, P: 100 };

/** 位置奖励（从红方视角，y 越小越靠敌方） */
function posBonus(t: PType, x: number, y: number, c: Color): number {
  let b = 0;
  const ry = c === 'r' ? y : ROWS - 1 - y; // 归一到红方视角
  const cx = Math.abs(x - 4);
  if (t === 'P') {
    b += (9 - ry) * 8; // 越靠前越好
    if (ry <= 4) b += 15; // 过河
    b += (4 - cx) * 2;
  } else if (t === 'H' || t === 'C') {
    b += (4 - cx) * 3 + (ry <= 6 ? 6 : 0);
  } else if (t === 'R') {
    b += (4 - cx) * 2;
  }
  return b;
}

/** 从红方视角评估局面 */
function evaluate(b: Board): number {
  let s = 0;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (!p) continue;
      const v = VAL[p.t] + posBonus(p.t, x, y, p.c);
      s += p.c === 'r' ? v : -v;
    }
  return s;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const MATE = 900000;

/** 走子排序：吃子优先（被吃子价值高优先） */
function ordered(b: Board, moves: Move[]): Move[] {
  return moves
    .map((m) => {
      const cap = b[m.ty][m.tx];
      return { m, s: cap ? VAL[cap.t] : 0 };
    })
    .sort((a, z) => z.s - a.s)
    .map((o) => o.m);
}

function negamax(b: Board, color: Color, depth: number, alpha: number, beta: number): number {
  const moves = legalMoves(b, color);
  if (moves.length === 0) return -MATE - depth; // 被将死/困毙
  if (depth === 0) {
    const e = evaluate(b);
    return color === 'r' ? e : -e;
  }
  let best = -Infinity;
  for (const m of ordered(b, moves)) {
    const nb = applyMove(b, m);
    const val = -negamax(nb, other(color), depth - 1, -beta, -alpha);
    if (val > best) best = val;
    if (val > alpha) alpha = val;
    if (alpha >= beta) break;
  }
  return best;
}

/** 为 color 选出最佳走子 */
export function bestMove(b: Board, color: Color, depth = 4): Move | null {
  const moves = ordered(b, legalMoves(b, color));
  if (moves.length === 0) return null;
  let best: Move | null = null;
  let bestVal = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;
  for (const m of moves) {
    const nb = applyMove(b, m);
    const val = -negamax(nb, other(color), depth - 1, -beta, -alpha) + (Math.random() * 2 - 1);
    if (val > bestVal) {
      bestVal = val;
      best = m;
    }
    if (val > alpha) alpha = val;
  }
  return best;
}
