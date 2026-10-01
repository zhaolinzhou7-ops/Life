/**
 * 残局阶梯：5 / 10 / 15 / 20 步杀，一档一档往上。
 * 锁死数据：局面读得出、轮到攻方、解法每一手合法而且最后将死、
 * 标的步数和解法长度对得上、每档都有足够的题、按子力体系归类。
 * "这是最快的杀法"由 tools/gen-mate-ladder.ts 生成时让皮卡鱼长时间复核。
 */
import { describe, expect, it } from 'vitest';
import data from '../src/xiangqi/mateladder.json';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, legalMoves, statusAfter, type Color } from '../src/xiangqi/rules';

type Item = { id: string; name: string; category: string; fen: string; you: Color; mateIn: number; line: string[]; tier: number };
const LADDER = data as unknown as Item[];

describe('残局阶梯', () => {
  it('四档都有题，越往上越少但不至于空着', () => {
    const by: Record<number, number> = {};
    for (const x of LADDER) by[x.tier] = (by[x.tier] ?? 0) + 1;
    expect(by[5] ?? 0).toBeGreaterThanOrEqual(20);
    expect(by[10] ?? 0).toBeGreaterThanOrEqual(12);
    expect(by[15] ?? 0).toBeGreaterThanOrEqual(6);
    expect(by[20] ?? 0).toBeGreaterThanOrEqual(4);
  });

  it('步数落在档位的范围里', () => {
    const range: Record<number, [number, number]> = { 5: [4, 7], 10: [8, 12], 15: [13, 17], 20: [18, 26] };
    for (const x of LADDER) {
      const [lo, hi] = range[x.tier];
      expect(x.mateIn, x.id).toBeGreaterThanOrEqual(lo);
      expect(x.mateIn, x.id).toBeLessThanOrEqual(hi);
    }
  });

  it('解法每一手合法、最后一手将死、步数和标的最快步数一样', () => {
    for (const x of LADDER) {
      const p = fromFen(x.fen);
      expect(p, x.id).not.toBeNull();
      expect(p!.toMove, x.id).toBe(x.you);
      let b = p!.board;
      let c = p!.toMove;
      for (const t of x.line) {
        const m = textToMove(b, c, t, legalMoves(b, c));
        expect(m, `${x.id} ${t}`).not.toBeNull();
        b = applyMove(b, m!);
        c = c === 'r' ? 'b' : 'r';
      }
      expect(statusAfter(b, c), x.id).not.toBe('playing');
      // 示范解法正好是标的最快步数：步数对不上的题说明"最快几步"本身说不准，不收
      expect(x.line.length, x.id).toBe(x.mateIn * 2 - 1);
    }
  });

  it('按子力体系归类，局面不重复', () => {
    for (const x of LADDER) expect(['兵类', '马类', '炮类', '车类', '组合'], x.id).toContain(x.category);
    expect(new Set(LADDER.map((x) => x.fen)).size).toBe(LADDER.length);
    expect(new Set(LADDER.map((x) => x.id)).size).toBe(LADDER.length);
  });
});
