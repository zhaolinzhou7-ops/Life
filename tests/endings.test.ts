/**
 * 将死之外的结局：重复局面、长将、自然限着、无进攻子力。
 * 原来的对局只认将死——来回走同样几步，棋永远下不完。
 */
import { describe, expect, it } from 'vitest';
import {
  MOVE_LIMIT,
  drawOrForfeit,
  noAttackers,
  pliesSinceCapture,
  repetitionState,
  type PlyRecord,
} from '../src/xiangqi/endings';
import { fromFen } from '../src/xiangqi/notation';
import { initialBoard } from '../src/xiangqi/rules';

const rec = (key: string, mover: 'r' | 'b', check = false, capture = false): PlyRecord => ({ key, mover, check, capture });

/** A→B→A→B→A…：红走到 B，黑走回 A */
function cycle(n: number, redChecks: boolean, blackChecks = false): PlyRecord[] {
  const out: PlyRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rec(i % 2 === 0 ? 'B' : 'A', i % 2 === 0 ? 'r' : 'b', i % 2 === 0 ? redChecks : blackChecks));
  }
  return out;
}

describe('重复局面', () => {
  it('同一局面第三次出现才判，第二次只是计数', () => {
    expect(repetitionState('A', cycle(2, false)).count).toBe(2);
    expect(drawOrForfeit(initialBoard(), 'A', cycle(2, false))).toBeNull();
    expect(repetitionState('A', cycle(4, false)).count).toBe(3);
  });

  it('双方都没将军：作和', () => {
    const end = drawOrForfeit(initialBoard(), 'A', cycle(4, false));
    expect(end).toEqual({ winner: null, reason: 'repetition' });
  });

  it('一方每一步都在将军、另一方没有：长将方判负', () => {
    const end = drawOrForfeit(initialBoard(), 'A', cycle(4, true));
    expect(end).toEqual({ winner: 'b', reason: 'perpetual-check' });
  });

  it('双方都在将军：互将，作和', () => {
    const end = drawOrForfeit(initialBoard(), 'A', cycle(4, true, true));
    expect(end?.winner).toBeNull();
  });

  it('循环里有一步没将军，就不算长将', () => {
    const p = cycle(4, true);
    p[2] = { ...p[2], check: false };
    expect(repetitionState('A', p).perpetual).toBeNull();
  });

  it('第二次出现时就能看出谁在长将——对局里拿它提前警告', () => {
    expect(repetitionState('A', cycle(2, true)).perpetual).toBe('r');
  });
});

describe('自然限着', () => {
  it('从最后一次吃子往后数', () => {
    const p = [rec('x1', 'r', false, true), rec('x2', 'b'), rec('x3', 'r')];
    expect(pliesSinceCapture(p)).toBe(2);
  });

  it('满 60 回合没吃子作和，差一步不作和', () => {
    const p: PlyRecord[] = [];
    for (let i = 0; i < MOVE_LIMIT - 1; i++) p.push(rec(`k${i}`, i % 2 ? 'b' : 'r'));
    expect(drawOrForfeit(initialBoard(), 'start', p)).toBeNull();
    p.push(rec('last', 'b'));
    expect(drawOrForfeit(initialBoard(), 'start', p)).toEqual({ winner: null, reason: 'move-limit' });
  });
});

describe('无进攻子力', () => {
  it('只剩将士象：和', () => {
    const b = fromFen('3aka3/9/4b4/9/9/9/9/4B4/4A4/3K5 w')!.board;
    expect(noAttackers(b)).toBe(true);
    expect(drawOrForfeit(b, 'x', [rec('y', 'r')])).toEqual({ winner: null, reason: 'no-attackers' });
  });

  it('还有一个兵就不算', () => {
    const b = fromFen('3aka3/9/4b4/9/9/9/4P4/4B4/4A4/3K5 w')!.board;
    expect(noAttackers(b)).toBe(false);
  });
});
