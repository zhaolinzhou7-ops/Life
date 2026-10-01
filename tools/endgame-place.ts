/**
 * 残局随机摆子（gen-endgames、gen-counterkill 共用）：士只能在九宫的五个点、象只能在七个点、
 * 兵只能在能走到的格子，将帅不照面。
 */
import { kingsFacing, type Board, type Color, type PType } from '../src/xiangqi/rules';

export interface GroupSpec {
  name: string;
  category: '兵类' | '马类' | '炮类' | '车类' | '组合';
  /** 进攻方的进攻子力：R 车 H 马 C 炮 P 兵（过了河） */
  att: string;
  /** 进攻方自己的士象（炮类要有炮架，常带士） */
  attGuard?: string;
  /** 守方的全部子力（进攻子 + 士象），空串 = 光将 */
  def: string;
  /** 练法：进攻（要赢/判断能不能赢）、防守（要守和）、两种都要 */
  you: 'att' | 'def' | 'both';
}

// ───────────────────────── 随机摆子 ─────────────────────────

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];

/** 黑方（上方）视角的合法格；红方镜像 y → 9-y */
export const BLACK_ADVISOR = [
  [3, 0],
  [5, 0],
  [4, 1],
  [3, 2],
  [5, 2],
];
export const BLACK_ELEPHANT = [
  [2, 0],
  [6, 0],
  [0, 2],
  [4, 2],
  [8, 2],
  [2, 4],
  [6, 4],
];
export const mirror = (sq: number[][]) => sq.map(([x, y]) => [x, 9 - y]);

export function empty(): Board {
  return Array.from({ length: 10 }, () => Array(9).fill(null));
}

/** 过了河的兵：在对方半场任意格（红兵 y≤4，黑卒 y≥5）。偏向高兵，少量低兵、底兵 */
export function pawnSquares(c: Color): number[][] {
  const out: number[][] = [];
  for (let x = 0; x < 9; x++)
    for (let y = 0; y < 10; y++) {
      const crossed = c === 'r' ? y <= 4 : y >= 5;
      if (!crossed) continue;
      // 底兵（老兵）只留很小的概率：它基本没用，题里多了没意思
      const bottom = c === 'r' ? y === 0 : y === 9;
      const w = bottom ? 1 : 4;
      for (let i = 0; i < w; i++) out.push([x, y]);
    }
  return out;
}
/** 守方的卒：没过河也行（守方的卒只是陪衬） */
function defPawnSquares(c: Color): number[][] {
  const out: number[][] = [];
  for (let x = 0; x < 9; x++)
    for (let y = 0; y < 10; y++) {
      const ok = c === 'r' ? (y <= 4 || ((y === 5 || y === 6) && x % 2 === 0)) : y >= 5 || ((y === 3 || y === 4) && x % 2 === 0);
      if (ok) out.push([x, y]);
    }
  return out;
}

export function palace(c: Color): number[][] {
  const ys = c === 'r' ? [7, 8, 9] : [0, 1, 2];
  const out: number[][] = [];
  for (const y of ys) for (let x = 3; x <= 5; x++) out.push([x, y]);
  return out;
}

export function place(b: Board, c: Color, t: PType, squares: number[][]): boolean {
  const free = squares.filter(([x, y]) => !b[y][x]);
  if (!free.length) return false;
  const [x, y] = pick(free);
  b[y][x] = { t, c };
  return true;
}

function anywhere(): number[][] {
  const out: number[][] = [];
  for (let x = 0; x < 9; x++) for (let y = 0; y < 10; y++) out.push([x, y]);
  return out;
}

/** 按一组的子力随机摆一个局面。attacker 是进攻方颜色 */
export function randomPosition(g: GroupSpec, attacker: Color): Board | null {
  const defender: Color = attacker === 'r' ? 'b' : 'r';
  const b = empty();
  const adv = (c: Color) => (c === 'b' ? BLACK_ADVISOR : mirror(BLACK_ADVISOR));
  const ele = (c: Color) => (c === 'b' ? BLACK_ELEPHANT : mirror(BLACK_ELEPHANT));
  if (!place(b, attacker, 'K', palace(attacker))) return null;
  if (!place(b, defender, 'K', palace(defender))) return null;
  for (const ch of g.def) {
    const t = ch as PType;
    const ok =
      t === 'A' ? place(b, defender, 'A', adv(defender)) : t === 'E' ? place(b, defender, 'E', ele(defender)) : t === 'P' ? place(b, defender, 'P', defPawnSquares(defender)) : place(b, defender, t, anywhere());
    if (!ok) return null;
  }
  for (const ch of g.attGuard ?? '') {
    const t = ch as PType;
    if (!(t === 'A' ? place(b, attacker, 'A', adv(attacker)) : place(b, attacker, 'E', ele(attacker)))) return null;
  }
  for (const ch of g.att) {
    const t = ch as PType;
    if (!(t === 'P' ? place(b, attacker, 'P', pawnSquares(attacker)) : place(b, attacker, t, anywhere()))) return null;
  }
  if (kingsFacing(b)) return null;
  return b;
}

