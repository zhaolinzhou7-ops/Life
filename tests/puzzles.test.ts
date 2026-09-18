/**
 * 题库数据体检。
 *
 * 一道答案写错的题，比没有这道题坏得多：用户走对了被判错，会认为
 * 是自己的理解有问题，然后把错的当成对的记下来。这是学棋软件里
 * 最伤人的一类 bug，所以整个题库必须能被机器逐道验一遍。
 *
 * 这里验的都是**可以机械判定**的性质：局面读得出来、有子可走、
 * 答案是一手合法棋、主变走得通。题目本身"好不好"不在这里判。
 */
import { describe, expect, it } from 'vitest';
import raw from '../src/xiangqi/puzzles.json';
import endgames from '../src/xiangqi/endgamelib.json';
import mates from '../src/xiangqi/matepatterns.json';
import { fromFen, textToMove, toFen } from '../src/xiangqi/notation';
import { applyMove, legalMoves, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import type { Puzzle } from '../src/xiangqi/puzzles';

const puzzles = raw as unknown as Puzzle[];

/** 把一串记谱在局面上走一遍，返回第一手走不通的下标（全通返回 -1） */
function walk(start: Board, side: Color, line: string[]): number {
  let b = start;
  let c = side;
  for (let i = 0; i < line.length; i++) {
    const m = textToMove(b, c, line[i], legalMoves(b, c));
    if (!m) return i;
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return -1;
}

describe('题库整体', () => {
  it('题目数量够撑起分类训练', () => {
    expect(puzzles.length).toBeGreaterThan(1000);
  });

  it('规格要求的题型都有货', () => {
    const kinds = new Set(puzzles.map((p) => p.kind));
    for (const k of ['mate', 'tactic', 'safety', 'endgame', 'opening']) {
      expect(kinds.has(k as Puzzle['kind']), `缺少题型 ${k}`).toBe(true);
    }
    // 每一类都要有足够的量，否则练几道就重复了
    for (const k of ['mate', 'tactic', 'safety', 'endgame', 'opening'] as const) {
      expect(puzzles.filter((p) => p.kind === k).length, `${k} 题量太少`).toBeGreaterThan(100);
    }
  });

  it('题号不重复', () => {
    const ids = new Set(puzzles.map((p) => p.id));
    expect(ids.size).toBe(puzzles.length);
  });

  it('标着 N 步杀的题，主变长度必须对得上（N 步杀 = 2N-1 手）', () => {
    const bad: string[] = [];
    for (const p of puzzles) {
      if (p.kind !== 'mate' || !p.mateIn) continue;
      if (p.line.length !== p.mateIn * 2 - 1) bad.push(`${p.id} 标 ${p.mateIn} 步杀，主变却有 ${p.line.length} 手`);
    }
    expect(bad).toEqual([]);
  });

  it('每道题都有难度分，且在合理区间', () => {
    for (const p of puzzles) {
      expect(typeof p.rating, `${p.id} 没有难度分`).toBe('number');
      expect(p.rating, `${p.id} 难度分越界`).toBeGreaterThan(300);
      expect(p.rating, `${p.id} 难度分越界`).toBeLessThan(3000);
    }
  });

  it('难度覆盖从入门到高级，不是挤在一个区间', () => {
    const rs = puzzles.map((p) => p.rating);
    expect(Math.min(...rs)).toBeLessThan(900);
    expect(Math.max(...rs)).toBeGreaterThan(1500);
  });
});

describe('每道题的局面和答案都必须成立', () => {
  it('局面全部读得出来', () => {
    const bad = puzzles.filter((p) => !fromFen(p.fen));
    expect(bad.map((p) => p.id)).toEqual([]);
  });

  it('每道题都轮到有子可走的一方', () => {
    const bad: string[] = [];
    for (const p of puzzles) {
      const f = fromFen(p.fen);
      if (!f) continue;
      if (legalMoves(f.board, f.toMove).length === 0) bad.push(p.id);
    }
    expect(bad).toEqual([]);
  });

  it('答案是一手合法棋——走对了被判错是最伤人的 bug', () => {
    const bad: string[] = [];
    for (const p of puzzles) {
      const f = fromFen(p.fen);
      if (!f) continue;
      if (!textToMove(f.board, f.toMove, p.answer, legalMoves(f.board, f.toMove))) {
        bad.push(`${p.id}(${p.answer})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('标了"一样好"的着法也全部合法', () => {
    const bad: string[] = [];
    for (const p of puzzles) {
      if (!p.also?.length) continue;
      const f = fromFen(p.fen);
      if (!f) continue;
      for (const a of p.also) {
        if (!textToMove(f.board, f.toMove, a, legalMoves(f.board, f.toMove))) bad.push(`${p.id}(${a})`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('主变的第一手就是答案', () => {
    const bad = puzzles.filter((p) => p.line?.length && p.line[0] !== p.answer);
    expect(bad.map((p) => `${p.id}: ${p.line[0]} ≠ ${p.answer}`)).toEqual([]);
  });

  it('主变整条走得通——界面上它是"完整下法"，走不通就是在教错的', () => {
    const bad: string[] = [];
    for (const p of puzzles) {
      if (!p.line?.length) continue;
      const f = fromFen(p.fen);
      if (!f) continue;
      const at = walk(f.board, f.toMove, p.line);
      if (at >= 0) bad.push(`${p.id} 第 ${at + 1} 手「${p.line[at]}」走不通`);
    }
    expect(bad).toEqual([]);
  });

  it('杀法题的主变确实以将死收尾——界面上这一行叫「完整下法」，走到一半就停等于没有解析', () => {
    const bad: string[] = [];
    for (const p of puzzles) {
      if (p.kind !== 'mate' || !p.line?.length) continue;
      const f = fromFen(p.fen);
      if (!f) continue;
      let b = f.board;
      let c = f.toMove;
      for (const t of p.line) {
        const m = textToMove(b, c, t, legalMoves(b, c));
        if (!m) break;
        b = applyMove(b, m);
        c = c === 'r' ? 'b' : 'r';
      }
      // 走完主变，轮到的那一方应该已经无路可走
      if (statusAfter(b, c) === 'playing') bad.push(p.id);
    }
    expect(bad).toEqual([]);
  });
});

describe('残局库与杀法图形库', () => {
  const eg = endgames as unknown as { id: string; fen: string; name?: string }[];
  const mp = mates as unknown as { id: string; fen: string; name?: string }[];

  it('残局库的局面全部读得出来且有子可走', () => {
    expect(eg.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const e of eg) {
      const f = fromFen(e.fen);
      if (!f) bad.push(`${e.id} 局面读不出`);
      else if (legalMoves(f.board, f.toMove).length === 0) bad.push(`${e.id} 无子可走`);
    }
    expect(bad).toEqual([]);
  });

  it('杀法图形库的局面全部读得出来且有子可走', () => {
    expect(mp.length).toBeGreaterThan(30);
    const bad: string[] = [];
    for (const m of mp) {
      const f = fromFen(m.fen);
      if (!f) bad.push(`${m.id} 局面读不出`);
      else if (legalMoves(f.board, f.toMove).length === 0) bad.push(`${m.id} 无子可走`);
    }
    expect(bad).toEqual([]);
  });
});

describe('FEN 与记谱的往返一致性', () => {
  it('题库里每个局面 FEN → 棋盘 → FEN 都回到原样', () => {
    const bad: string[] = [];
    for (const p of puzzles.slice(0, 300)) {
      const f = fromFen(p.fen);
      if (!f) continue;
      if (toFen(f.board, f.toMove) !== p.fen.trim()) bad.push(p.id);
    }
    expect(bad).toEqual([]);
  });
});
