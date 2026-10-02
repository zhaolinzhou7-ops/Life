/**
 * 绝地反杀：红先，黑方下一步就能杀红，红方只有连将（或者最多两步闲着的连杀）抢先杀死黑方。
 * 用户原话："要那种形势很危急的：我是红棋，对方是黑棋且下一步就能绝杀我，
 * 而我必须通过连续将军或者连环杀法，最后绝地反杀。"
 * 这里把每一关都按规则走一遍；"只有这一路能活"由 tools/gen-counterkill.ts 让皮卡鱼核对。
 */
import { describe, expect, it } from 'vitest';
import data from '../src/xiangqi/counterkill.json';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { PIECE_VALUE } from '../src/xiangqi/teach';

type Item = { id: string; fen: string; mateIn: number; line: string[]; allChecks: boolean; quiet: number; threat: string[]; chapter: number; rating: number; seeDepth: number };
const CK = data as unknown as Item[];
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
const mated = (b: Board, c: Color) => isInCheck(b, c) && legal(b, c).length === 0;
const mat = (b: Board, c: Color) => b.flat().reduce((s, p) => s + (p && p.c === c && p.t !== 'K' ? PIECE_VALUE[p.t] : 0), 0);

describe('绝地反杀', () => {
  // 用户原话："你现在做的残局有点太简单了（包括闯关模式），深度还需要再深入一些。"
  it('六章都有关；两步杀不收了，六步以上的长杀占了一大块', () => {
    const by: Record<number, number> = {};
    for (const x of CK) by[x.chapter] = (by[x.chapter] ?? 0) + 1;
    for (const n of [1, 2, 3, 4, 5, 6]) expect(by[n] ?? 0, `第 ${n} 章`).toBeGreaterThanOrEqual(5);
    expect(CK.every((x) => x.mateIn >= 3)).toBe(true);
    expect(CK.filter((x) => x.mateIn >= 6).length).toBeGreaterThanOrEqual(Math.round(CK.length * 0.35));
    expect(Math.max(...CK.map((x) => x.mateIn))).toBeGreaterThanOrEqual(12);
    expect(CK.length).toBeGreaterThanOrEqual(150);
  });

  // 注意：连将杀引擎有"将军延伸"，浅算几层就能看见，所以这个数不随步数变大——它只给难度加一点分，不拿来分章
  it('每一关都记了"引擎浅算几层才看得见"', () => {
    for (const x of CK) expect(x.seeDepth, x.id).toBeGreaterThanOrEqual(3);
  });

  it('形势危急：红先、红方没被将军、子力不比黑方多，而且黑方真有一步杀', () => {
    for (const x of CK) {
      const p = fromFen(x.fen)!;
      expect(p.toMove, x.id).toBe('r');
      expect(isInCheck(p.board, 'r'), x.id).toBe(false);
      expect(mat(p.board, 'r'), x.id).toBeLessThanOrEqual(mat(p.board, 'b'));
      expect(x.threat.length, x.id).toBeGreaterThan(0);
      for (const t of x.threat) {
        const m = textToMove(p.board, 'b', t, legal(p.board, 'b'));
        expect(m, `${x.id} 黑方的杀着 ${t}`).not.toBeNull();
        expect(mated(applyMove(p.board, m!), 'r'), `${x.id} ${t} 真能杀`).toBe(true);
      }
    }
  });

  it('解法：红方步步将军（最多三步闲着），最后一手把黑将死，步数和标的一样', () => {
    for (const x of CK) {
      const p = fromFen(x.fen)!;
      let b = p.board;
      let c: Color = 'r';
      let quiet = 0;
      for (const t of x.line) {
        const m = textToMove(b, c, t, legal(b, c));
        expect(m, `${x.id} ${t}`).not.toBeNull();
        b = applyMove(b, m!);
        if (c === 'r' && !isInCheck(b, 'b')) quiet++;
        c = c === 'r' ? 'b' : 'r';
      }
      expect(mated(b, 'b'), x.id).toBe(true);
      expect(x.line.length, x.id).toBe(x.mateIn * 2 - 1);
      expect(quiet, x.id).toBe(x.quiet);
      expect(quiet, x.id).toBeLessThanOrEqual(3);
      expect(x.allChecks, x.id).toBe(quiet === 0);
    }
  });

  it('章按步数分：3 / 4 / 5 / 6–7 / 8–9 / 10 步以上；章内由易到难', () => {
    const ch = (n: number) => (n <= 3 ? 1 : n === 4 ? 2 : n === 5 ? 3 : n <= 7 ? 4 : n <= 9 ? 5 : 6);
    for (const x of CK) expect(x.chapter, x.id).toBe(ch(x.mateIn));
    for (let i = 1; i < CK.length; i++) {
      if (CK[i].chapter === CK[i - 1].chapter) expect(CK[i].rating, CK[i].id).toBeGreaterThanOrEqual(CK[i - 1].rating);
      else expect(CK[i].chapter).toBeGreaterThan(CK[i - 1].chapter);
    }
    expect(new Set(CK.map((x) => x.fen)).size).toBe(CK.length);
  });
});
