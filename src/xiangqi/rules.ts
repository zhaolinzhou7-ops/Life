/** 中国象棋规则引擎：棋盘、走子生成、将军/将死判定 */

export type Color = 'r' | 'b';
export type PType = 'K' | 'A' | 'E' | 'H' | 'R' | 'C' | 'P';

export interface Piece {
  t: PType;
  c: Color;
}

export interface Move {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
}

/** 棋盘 board[y][x]，y 0..9（0=黑方底线，9=红方底线），x 0..8 */
export type Board = (Piece | null)[][];

export const COLS = 9;
export const ROWS = 10;

export function initialBoard(): Board {
  const b: Board = Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
  const back: PType[] = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R'];
  for (let x = 0; x < COLS; x++) {
    b[0][x] = { t: back[x], c: 'b' };
    b[9][x] = { t: back[x], c: 'r' };
  }
  b[2][1] = { t: 'C', c: 'b' };
  b[2][7] = { t: 'C', c: 'b' };
  b[7][1] = { t: 'C', c: 'r' };
  b[7][7] = { t: 'C', c: 'r' };
  for (let x = 0; x < COLS; x += 2) {
    b[3][x] = { t: 'P', c: 'b' };
    b[6][x] = { t: 'P', c: 'r' };
  }
  return b;
}

export function cloneBoard(b: Board): Board {
  return b.map((row) => row.map((p) => (p ? { t: p.t, c: p.c } : null)));
}

const inBoard = (x: number, y: number) => x >= 0 && x < COLS && y >= 0 && y < ROWS;
const inPalace = (x: number, y: number, c: Color) =>
  x >= 3 && x <= 5 && (c === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
const ownSide = (y: number, c: Color) => (c === 'r' ? y >= 5 : y <= 4);

/** 生成某颜色某棋子的伪合法走子（不含王安全性检查） */
function pieceMoves(b: Board, x: number, y: number, out: Move[]) {
  const p = b[y][x]!;
  const c = p.c;
  const push = (tx: number, ty: number) => {
    if (!inBoard(tx, ty)) return;
    const d = b[ty][tx];
    if (!d || d.c !== c) out.push({ fx: x, fy: y, tx, ty });
  };

  switch (p.t) {
    case 'K': {
      const steps = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ];
      for (const [dx, dy] of steps) {
        const tx = x + dx;
        const ty = y + dy;
        if (inPalace(tx, ty, c)) push(tx, ty);
      }
      break;
    }
    case 'A': {
      const steps = [
        [1, 1],
        [1, -1],
        [-1, 1],
        [-1, -1],
      ];
      for (const [dx, dy] of steps) {
        const tx = x + dx;
        const ty = y + dy;
        if (inPalace(tx, ty, c)) push(tx, ty);
      }
      break;
    }
    case 'E': {
      const steps = [
        [2, 2],
        [2, -2],
        [-2, 2],
        [-2, -2],
      ];
      for (const [dx, dy] of steps) {
        const tx = x + dx;
        const ty = y + dy;
        if (!inBoard(tx, ty) || !ownSide(ty, c)) continue; // 不过河
        if (b[y + dy / 2][x + dx / 2]) continue; // 塞象眼
        push(tx, ty);
      }
      break;
    }
    case 'H': {
      const legs = [
        [1, 0, 2, 1],
        [1, 0, 2, -1],
        [-1, 0, -2, 1],
        [-1, 0, -2, -1],
        [0, 1, 1, 2],
        [0, 1, -1, 2],
        [0, -1, 1, -2],
        [0, -1, -1, -2],
      ];
      for (const [lx, ly, dx, dy] of legs) {
        if (b[y + ly]?.[x + lx]) continue; // 蹩马腿
        push(x + dx, y + dy);
      }
      break;
    }
    case 'R': {
      const dirs = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ];
      for (const [dx, dy] of dirs) {
        let tx = x + dx;
        let ty = y + dy;
        while (inBoard(tx, ty)) {
          const d = b[ty][tx];
          if (!d) {
            out.push({ fx: x, fy: y, tx, ty });
          } else {
            if (d.c !== c) out.push({ fx: x, fy: y, tx, ty });
            break;
          }
          tx += dx;
          ty += dy;
        }
      }
      break;
    }
    case 'C': {
      const dirs = [
        [0, 1],
        [0, -1],
        [1, 0],
        [-1, 0],
      ];
      for (const [dx, dy] of dirs) {
        let tx = x + dx;
        let ty = y + dy;
        let jumped = false;
        while (inBoard(tx, ty)) {
          const d = b[ty][tx];
          if (!jumped) {
            if (!d) out.push({ fx: x, fy: y, tx, ty });
            else jumped = true;
          } else if (d) {
            if (d.c !== c) out.push({ fx: x, fy: y, tx, ty });
            break;
          }
          tx += dx;
          ty += dy;
        }
      }
      break;
    }
    case 'P': {
      const fwd = c === 'r' ? -1 : 1;
      push(x, y + fwd);
      const crossed = c === 'r' ? y <= 4 : y >= 5;
      if (crossed) {
        push(x - 1, y);
        push(x + 1, y);
      }
      break;
    }
  }
}

export function findKing(b: Board, c: Color): [number, number] | null {
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (p && p.t === 'K' && p.c === c) return [x, y];
    }
  return null;
}

/** 将帅对脸：同列且中间无子 */
function kingsFacing(b: Board): boolean {
  const rk = findKing(b, 'r');
  const bk = findKing(b, 'b');
  if (!rk || !bk || rk[0] !== bk[0]) return false;
  const x = rk[0];
  const y0 = Math.min(rk[1], bk[1]) + 1;
  const y1 = Math.max(rk[1], bk[1]);
  for (let y = y0; y < y1; y++) if (b[y][x]) return false;
  return true;
}

function pseudoMoves(b: Board, c: Color): Move[] {
  const out: Move[] = [];
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (p && p.c === c) pieceMoves(b, x, y, out);
    }
  return out;
}

export function applyMove(b: Board, m: Move): Board {
  const nb = cloneBoard(b);
  nb[m.ty][m.tx] = nb[m.fy][m.fx];
  nb[m.fy][m.fx] = null;
  return nb;
}

/** 该颜色的王是否被将军（从王位置反向扫描，快速） */
export function isInCheck(b: Board, c: Color): boolean {
  const king = findKing(b, c);
  if (!king) return true;
  const [kx, ky] = king;
  const enemy: Color = c === 'r' ? 'b' : 'r';

  // 直线：车 / 将帅对脸（第一个子），炮（隔一个子的第二个子）
  const dirs = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ];
  for (const [dx, dy] of dirs) {
    let x = kx + dx;
    let y = ky + dy;
    let seen = 0;
    while (inBoard(x, y)) {
      const p = b[y][x];
      if (p) {
        seen++;
        if (seen === 1) {
          if (p.c === enemy && (p.t === 'R' || p.t === 'K')) return true;
        } else {
          if (p.c === enemy && p.t === 'C') return true;
          break;
        }
      }
      x += dx;
      y += dy;
    }
  }

  // 马：枚举能跳到王位置的 8 个马位，检查蹩马腿
  const horse = [
    [1, 2],
    [-1, 2],
    [1, -2],
    [-1, -2],
    [2, 1],
    [2, -1],
    [-2, 1],
    [-2, -1],
  ];
  for (const [dx, dy] of horse) {
    const hx = kx + dx;
    const hy = ky + dy;
    if (!inBoard(hx, hy)) continue;
    const p = b[hy][hx];
    if (!p || p.c !== enemy || p.t !== 'H') continue;
    // 马腿：紧邻马、朝王方向的直线格
    const leg = Math.abs(dy) === 2 ? b[hy - dy / 2][hx] : b[hy][hx - dx / 2];
    if (!leg) return true;
  }

  // 兵：敌兵向前一步吃到王，或过河后横吃
  const fwd = enemy === 'r' ? -1 : 1; // 敌兵前进方向
  const pp = b[ky - fwd]?.[kx];
  if (pp && pp.c === enemy && pp.t === 'P') return true;
  for (const sx of [kx - 1, kx + 1]) {
    const sp = b[ky]?.[sx];
    if (sp && sp.c === enemy && sp.t === 'P') {
      const crossed = enemy === 'r' ? ky <= 4 : ky >= 5;
      if (crossed) return true;
    }
  }
  return false;
}

/** 合法走子：走后自己不被将军且不对脸 */
export function legalMoves(b: Board, c: Color): Move[] {
  const out: Move[] = [];
  for (const m of pseudoMoves(b, c)) {
    const nb = applyMove(b, m);
    if (!isInCheck(nb, c) && !kingsFacing(nb)) out.push(m);
  }
  return out;
}

export type Status = 'playing' | 'red-win' | 'black-win';

/** 走子后判断对方是否被将死/困毙 */
export function statusAfter(b: Board, toMove: Color): Status {
  const moves = legalMoves(b, toMove);
  if (moves.length > 0) return 'playing';
  // 无合法走子：将死或困毙，均判负
  return toMove === 'r' ? 'black-win' : 'red-win';
}

export const PTYPE_NAME: Record<PType, [string, string]> = {
  // [红字, 黑字]
  K: ['帅', '将'],
  A: ['仕', '士'],
  E: ['相', '象'],
  H: ['马', '马'],
  R: ['车', '车'],
  C: ['炮', '砲'],
  P: ['兵', '卒'],
};
