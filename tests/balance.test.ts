/**
 * 题目值不值得练（src/xiangqi/balance.ts）：大劣的、对等没下头的不出。
 * 用户原话："自己这边只剩一两个马，对方还有两个车，或者一车一炮一马，这种残局基本没法下了，把这类题目换掉。
 * 还有一些局面太势均力敌、没什么下头的题目，比如对方一个车我也一个车、对方一个马我也一个马，这些也都全部取消掉。"
 */
import { describe, expect, it } from 'vitest';
import { endgameUnfit, evenSparse, forceOf, hopeless, unfit } from '../src/xiangqi/balance';
import { fromFen } from '../src/xiangqi/notation';
import puzzles from '../src/xiangqi/puzzles.json';
import endgames from '../src/xiangqi/endgamelib.json';

const board = (fen: string) => fromFen(fen)!.board;

describe('大劣', () => {
  it('两个马对两个车、两个马对车马炮：红方没法下', () => {
    expect(hopeless(board('3k5/9/9/9/9/9/9/2r3r2/3NN4/4K4 w'), 'r')).toBe(true);
    expect(hopeless(board('3k5/9/9/9/9/9/9/2r1n1c2/3NN4/4K4 w'), 'r')).toBe(true);
    // 少一个马不算大劣
    expect(hopeless(board('3k5/9/9/9/9/9/9/2r1n4/3RN4/4K4 w'), 'r')).toBe(false);
  });

  it('只剩一两个子还差一个车：引擎说守得住也不出', () => {
    expect(unfit({ fen: '3k5/9/9/9/9/9/9/2r1c4/3N5/4K4 w', line: ['马六进七'], ev: 0, goal: 'only' })).toBe('hopeless');
  });

  it('少子反而能赢（有杀、大优）的照出：以少胜多', () => {
    expect(unfit({ fen: '3k5/9/9/9/9/9/9/2r3r2/3NN4/4K4 w', line: [], ev: 3000, goal: 'mate' })).toBeNull();
    expect(unfit({ fen: '3k5/9/9/9/9/9/9/2r3r2/3NN4/4K4 w', line: [], ev: 600, goal: 'win' })).toBeNull();
  });

  it('子多的中局：开头少子、正解把子吃回来的照出', () => {
    // 红方少一个车；车九进九吃回黑车，走完以后子力一样
    const fen = 'r1bakab1r/9/1cn4c1/2p1p1p1p/9/9/2P1P1P1P/1C5C1/9/RNBAKAB2 w';
    expect(hopeless(board(fen), 'r')).toBe(true);
    expect(unfit({ fen, line: ['车九进九'], ev: 0, goal: 'only' })).toBeNull();
    // 正解吃不回来（主变里没有吃子）：大劣
    expect(unfit({ fen, line: ['炮二平五'], ev: -100, goal: 'only' })).toBe('hopeless');
  });
});

describe('对等没下头', () => {
  it('车对车、马对马、马对炮是对等的；车对马炮不是', () => {
    expect(evenSparse(board('3k5/9/9/9/9/9/9/2r6/3R5/4K4 w'))).toBe(true);
    expect(evenSparse(board('3k5/9/9/9/9/9/9/2n6/3N5/4K4 w'))).toBe(true);
    expect(evenSparse(board('3k5/9/9/9/9/9/9/2c6/3N5/4K4 w'))).toBe(true);
    expect(evenSparse(board('3k5/9/9/9/9/9/9/2n1c4/3R5/4K4 w'))).toBe(false);
  });

  it('对等的和棋不出；对等但有杀、能赢的照出', () => {
    const fen = '3k5/9/9/9/9/9/9/2r6/3R5/4K4 w';
    expect(unfit({ fen, line: [], ev: 10, goal: 'only' })).toBe('even');
    expect(unfit({ fen, line: [], ev: 3000, goal: 'mate' })).toBeNull();
    expect(unfit({ fen, line: [], ev: 900, goal: 'win' })).toBeNull();
  });

  it('实用残局：对等的和棋、守方只剩光杆对车炮的，都不出', () => {
    expect(endgameUnfit({ fen: '3k5/9/9/9/9/9/9/2r6/3R5/4K4 w', you: 'r', target: 'draw' })).toBe('even');
    expect(endgameUnfit({ fen: '3k5/9/9/9/9/9/9/2r6/3R1P3/4K4 w', you: 'r', target: 'win' })).toBeNull();
    expect(endgameUnfit({ fen: '3k5/9/9/9/9/9/9/2r1c4/9/3AKA3 w', you: 'r', target: 'draw' })).toBe('hopeless');
  });

  it('子力分：过河兵算两个', () => {
    expect(forceOf(board('3k5/9/9/9/4P4/9/9/9/9/4K4 w'), 'r').pts).toBe(2);
    expect(forceOf(board('3k5/9/9/9/9/4P4/9/9/9/4K4 w'), 'r').pts).toBe(1);
  });
});

describe('题库、实用残局里已经清干净（tools/prune-lopsided.ts）', () => {
  it('题库里没有大劣、对等没下头的题', () => {
    const bad = (puzzles as Parameters<typeof unfit>[0][] & { id: string }[]).filter((p) => unfit(p)).map((p) => (p as { id: string }).id);
    expect(bad).toEqual([]);
  });
  it('实用残局里没有', () => {
    const bad = (endgames as unknown as { id: string; fen: string; you: 'r' | 'b'; target: string }[]).filter((e) => endgameUnfit(e)).map((e) => e.id);
    expect(bad).toEqual([]);
  });
});
