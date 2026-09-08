/**
 * 局面合法性校验：这个子**这辈子能不能走到这一格**。
 *
 * 加这道闸门是因为吃过一次大亏：生成器里士只判了「在不在九宫」（9 格），
 * 但士只能沿斜线走，一辈子只能落在 5 个交叉点上；象同理只有 7 个象位。
 * 结果 45%~80% 的局面摆着走不到的士象，懂棋的人一眼就看出是假的。
 *
 * 教训是「规则引擎接受这个局面」≠「这个局面能在真实对局里出现」——
 * rules.ts 只管走法合法，不管初始摆位合不合理。所以必须单独校验。
 *
 * 用法：入库前跑一遍，或 node validate.mjs < any.json
 */
import type { Board, Color, PType } from '../src/xiangqi/rules';

const eq = (l: readonly (readonly [number, number])[], x: number, y: number) =>
  l.some(([a, b]) => a === x && b === y);

/** 士只能落在九宫的五个斜线交叉点 */
const ADVISOR: Record<Color, readonly (readonly [number, number])[]> = {
  r: [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]],
  b: [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]],
};
/** 象只能落在本方七个象位（象不过河） */
const ELEPHANT: Record<Color, readonly (readonly [number, number])[]> = {
  r: [[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]],
  b: [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]],
};

export function canStand(t: PType, c: Color, x: number, y: number): boolean {
  switch (t) {
    case 'K':
      return x >= 3 && x <= 5 && (c === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
    case 'A':
      return eq(ADVISOR[c], x, y);
    case 'E':
      return eq(ELEPHANT[c], x, y);
    case 'P':
      // 兵不能退回自己底线；没过河时只能待在原始的偶数纵线上
      if (c === 'r') return y <= 6 && (y <= 4 || x % 2 === 0);
      return y >= 3 && (y >= 5 || x % 2 === 0);
    default:
      return true; // 车马炮哪儿都能到
  }
}

/** 返回所有不合法的摆位说明；空数组 = 这个局面能在真实对局里出现 */
export function checkBoard(b: Board): string[] {
  const errs: string[] = [];
  let rk = 0;
  let bk = 0;
  const count: Record<string, number> = {};
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const p = b[y][x];
      if (!p) continue;
      if (p.t === 'K') p.c === 'r' ? rk++ : bk++;
      const key = p.c + p.t;
      count[key] = (count[key] ?? 0) + 1;
      if (!canStand(p.t, p.c, x, y)) errs.push(`${p.c}${p.t}(${x},${y}) 走不到这一格`);
    }
  }
  if (rk !== 1) errs.push(`红帅数量 ${rk}`);
  if (bk !== 1) errs.push(`黑将数量 ${bk}`);
  // 子力数量不能超过开局配置
  const MAX: Record<PType, number> = { K: 1, A: 2, E: 2, H: 2, R: 2, C: 2, P: 5 };
  for (const c of ['r', 'b'] as Color[]) {
    for (const t of Object.keys(MAX) as PType[]) {
      const n = count[c + t] ?? 0;
      if (n > MAX[t]) errs.push(`${c}${t} 有 ${n} 个，超过 ${MAX[t]}`);
    }
  }
  return errs;
}

export const isValidBoard = (b: Board): boolean => checkBoard(b).length === 0;
