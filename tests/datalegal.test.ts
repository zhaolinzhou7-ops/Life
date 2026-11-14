/**
 * 所有带局面的数据：局面本身能不能出现、每一步是不是合法着法。
 *
 * 用户截图（测评 · 残局"找出杀棋"）：题目局面里黑将已经被红车照着、却轮到红方走——
 * 第一手就能把将吃掉，吃了还判"不对"。这种局面在真实对局里不可能出现（上一手黑方不能把自己的将留在被将军的地方），
 * 原来的体检只查了子摆得对不对、着法合不合法，没查"不该走的一方是不是正被将军"。
 *
 * 这里每个局面查：
 *   - 子摆得对（士象兵走得到的格子、数量不超、各一个将帅）；
 *   - 不该走的一方没有被将军（含将帅对脸）；
 *   - 该走的一方有棋可走（不是已经被将死 / 困毙）；
 *   - 答案、同样对的着法、主变每一步、每一步里"也算对"的着法、实战走错的那手、对方的威胁着法，都是合法着法。
 */
import { describe, expect, it } from 'vitest';
import { applyMove, initialBoard, isInCheck, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { checkPosition } from '../tools/validate-positions';
import puzzles from '../src/xiangqi/puzzles.json';
import mates from '../src/xiangqi/matepatterns.json';
import endgames from '../src/xiangqi/endgamelib.json';
import counterkill from '../src/xiangqi/counterkill.json';
import games from '../src/xiangqi/games.json';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

interface Row {
  id: string;
  fen: string;
  answer?: string;
  also?: string[];
  line?: string[];
  ok?: string[][];
  blunder?: string;
  threat?: string[] | number;
}

/** 局面本身的毛病（空数组 = 没毛病） */
export function positionProblems(fen: string): string[] {
  const p = fromFen(fen);
  if (!p) return ['FEN 读不出来'];
  const errs = checkPosition(p.board, p.toMove);
  if (!errs.length && !legalOf(p.board, p.toMove).length) errs.push('该走的一方已经无棋可走');
  return errs;
}

/** 着法的毛病：答案、主变、也算对的、实战错着、威胁 */
function moveProblems(r: Row): string[] {
  const p = fromFen(r.fen);
  if (!p) return [];
  const out: string[] = [];
  const legal0 = legalOf(p.board, p.toMove);
  for (const t of [r.answer, ...(r.also ?? []), r.blunder].filter((x): x is string => !!x))
    if (!textToMove(p.board, p.toMove, t, legal0)) out.push(`第一手 ${t} 不合法`);
  if (Array.isArray(r.threat))
    for (const t of r.threat) if (!textToMove(p.board, other(p.toMove), t, legalOf(p.board, other(p.toMove)))) out.push(`威胁 ${t} 不合法`);
  let b = p.board;
  let c = p.toMove;
  for (let i = 0; i < (r.line?.length ?? 0); i++) {
    const legal = legalOf(b, c);
    // ok[k] 是解题方第 k 步"也算对"的着法
    if (i % 2 === 0) for (const t of r.ok?.[i / 2] ?? []) if (!textToMove(b, c, t, legal)) out.push(`第 ${i / 2 + 1} 步也算对的 ${t} 不合法`);
    const m = textToMove(b, c, r.line![i], legal);
    if (!m) {
      out.push(`主变第 ${i + 1} 手 ${r.line![i]} 不合法`);
      break;
    }
    b = applyMove(b, m);
    c = other(c);
  }
  return out;
}

const SOURCES: [string, Row[]][] = [
  ['题库', puzzles as Row[]],
  ['杀法图形', mates as unknown as Row[]],
  ['实用残局', endgames as unknown as Row[]],
  ['绝地反杀', counterkill as unknown as Row[]],
];

describe('数据里的局面都能出现、着法都合法', () => {
  for (const [name, rows] of SOURCES) {
    it(`${name}（${rows.length} 个局面）`, () => {
      const bad: string[] = [];
      for (const r of rows) {
        const e = [...positionProblems(r.fen), ...moveProblems(r)];
        if (e.length) bad.push(`${r.id}：${e.join('；')}`);
      }
      expect(bad).toEqual([]);
    });
  }

  it(`示范对局（${games.length} 盘）从开局一手手走得通`, () => {
    const bad: string[] = [];
    for (const g of games as { id: string; moves: { t: string }[] }[]) {
      let b = initialBoard();
      let c: Color = 'r';
      for (let i = 0; i < g.moves.length; i++) {
        const m = textToMove(b, c, g.moves[i].t, legalOf(b, c));
        if (!m) {
          bad.push(`${g.id} 第 ${i + 1} 手 ${g.moves[i].t}`);
          break;
        }
        b = applyMove(b, m);
        c = other(c);
      }
    }
    expect(bad).toEqual([]);
  });

  it('截图那一局（黑将被车照着却轮到红走）认得出来', () => {
    expect(positionProblems('3a1ab2/9/2R2k3/9/9/9/5C3/2r6/4K4/9 w').join()).toMatch(/正被将军/);
    // 将帅对脸也算
    expect(positionProblems('4k4/9/9/9/9/9/9/9/9/4K4 w').join()).toMatch(/正被将军/);
    expect(positionProblems('3k5/9/9/9/9/9/9/9/9/4K4 w')).toEqual([]);
  });
});
