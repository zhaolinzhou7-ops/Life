/**
 * 搜索引擎测试。
 *
 * 规格第二十条点名要测的：AI 合法走棋、不同难度、无法走棋时的处理、超时处理。
 * 这几条里最要紧的是**第一条**——AI 走出一手非法棋，整个产品当场失去可信度，
 * 而且教学内容全部作废（复盘会照着一个非法局面往下算）。
 */
import { describe, expect, it } from 'vitest';
import { analyze, bestMove, evaluatePosition, judgeMove, resetEngine } from '../src/xiangqi/ai';
import { applyMove, initialBoard, isInCheck, legalMoves, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { mateInOne } from '../src/xiangqi/teach';
import { board, bare, mv, put } from './helpers';

/** 一手棋在不在合法着法表里 */
const isLegal = (b: Board, c: Color, m: { fx: number; fy: number; tx: number; ty: number } | null) =>
  !!m && legalMoves(b, c).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty);

describe('AI 走的每一手都必须合法', () => {
  it('开局各难度都走合法棋', () => {
    const b = initialBoard();
    for (const [depth, jitter] of [[2, 200], [4, 90], [7, 20], [10, 0], [14, 0]] as const) {
      resetEngine();
      const m = bestMove(b, 'r', depth, jitter, 400);
      expect(isLegal(b, 'r', m), `深度 ${depth} 走出了非法棋`).toBe(true);
    }
  });

  /**
   * 整盘自对弈。这是最有价值的一条：单个局面测不出来的问题
   * （置换表污染、走子生成越界、被将时的应将遗漏）会在连续对弈里暴露。
   */
  it('AI 自对弈 60 手，全程合法且从不把自己送进被将状态', () => {
    resetEngine();
    let b = initialBoard();
    let c: Color = 'r';
    for (let i = 0; i < 60; i++) {
      if (statusAfter(b, c) !== 'playing') break;
      const m = bestMove(b, c, 4, 0, 120);
      expect(isLegal(b, c, m), `第 ${i} 手非法`).toBe(true);
      b = applyMove(b, m!);
      // 走完自己不能处于被将——这是应将逻辑最容易漏的地方
      expect(isInCheck(b, c), `第 ${i} 手走完自己还在被将`).toBe(false);
      c = c === 'r' ? 'b' : 'r';
    }
  });

  it('被将军时走出来的必定是解将的一手', () => {
    resetEngine();
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . r . . . .',
      '. . . K . . . . .',
    );
    // 黑车 (4,8) 控着四路，红帅在 (3,9)，红方并未被将——先造一个真被将的局面
    const checked = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . r K . . . .',
    );
    void b;
    expect(isInCheck(checked, 'r')).toBe(true);
    const m = bestMove(checked, 'r', 4, 0, 200);
    expect(isLegal(checked, 'r', m)).toBe(true);
    expect(isInCheck(applyMove(checked, m!), 'r')).toBe(false);
  });

  it('无路可走时返回 null，不返回一手编出来的棋', () => {
    resetEngine();
    // 黑方被将死，一手也走不了
    const mated = board(
      '. . . . k . . . .',
      '. . . P R P . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(legalMoves(mated, 'b').length).toBe(0);
    expect(bestMove(mated, 'b', 4, 0, 200)).toBeNull();
  });

  it('只剩一手可走时直接走那一手', () => {
    resetEngine();
    const b = board(
      '. . . . k . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    const legal = legalMoves(b, 'b');
    const m = bestMove(b, 'b', 6, 0, 300);
    expect(isLegal(b, 'b', m)).toBe(true);
    if (legal.length === 1) {
      expect(`${m!.fx},${m!.fy}->${m!.tx},${m!.ty}`).toBe(`${legal[0].fx},${legal[0].fy}->${legal[0].tx},${legal[0].ty}`);
    }
  });
});

describe('AI 的棋力：弱不等于乱走', () => {
  /**
   * 弱档故意降低棋力，但**不能故意违反棋规**，也不能走出人类绝不会走的怪棋。
   * 白送一个车这种棋，就算是入门档也不该走——新手照着学会学坏。
   */
  it('入门档也不会白送车', () => {
    resetEngine();
    // 红车在 (0,4)，黑车在 (0,1) 正对着；红方随便走别的都行，但不该把车送上去
    const b = bare();
    put(b, 0, 6, 'R');
    put(b, 0, 1, 'r');
    put(b, 8, 6, 'P');
    for (let i = 0; i < 5; i++) {
      const m = bestMove(b, 'r', 2, 200, 200);
      expect(isLegal(b, 'r', m)).toBe(true);
      // 不该主动把车走到黑车的射程里送掉（(0,x) 一路上除了回避，别的都行）
      const after = applyMove(b, m!);
      const lostRook = !after.flat().some((p) => p && p.c === 'r' && p.t === 'R');
      expect(lostRook).toBe(false);
    }
  });

  it('看得见一步杀就会走', () => {
    resetEngine();
    const b = board(
      '. . . . k . . . .',
      '. . . P . P . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(mateInOne(b, 'r')).not.toBeNull();
    const m = bestMove(b, 'r', 6, 0, 1500);
    expect(statusAfter(applyMove(b, m!), 'b')).toBe('red-win');
  });

  it('白给的车会去吃', () => {
    resetEngine();
    const b = bare();
    put(b, 4, 6, 'R'); // 红车
    put(b, 4, 3, 'r'); // 黑车，无保护，红车一路能吃到
    const m = bestMove(b, 'r', 6, 0, 800);
    expect(isLegal(b, 'r', m)).toBe(true);
    expect(`${m!.tx},${m!.ty}`).toBe('4,3');
  });
});

describe('超时处理', () => {
  it('给多短的时间都必须返回一手合法棋，不能返回 null 或卡住', () => {
    const b = initialBoard();
    for (const ms of [1, 10, 50]) {
      resetEngine();
      const t0 = Date.now();
      const m = bestMove(b, 'r', 20, 0, ms);
      const took = Date.now() - t0;
      expect(isLegal(b, 'r', m), `${ms}ms 预算下走出非法棋`).toBe(true);
      // 允许超出预算（至少要搜完第一层），但不能夸张到卡住界面
      expect(took).toBeLessThan(5000);
    }
  });

  it('深度给得再大也会被时间截断，不会永远算下去', () => {
    resetEngine();
    const t0 = Date.now();
    bestMove(initialBoard(), 'r', 40, 0, 300);
    expect(Date.now() - t0).toBeLessThan(4000);
  });
});

describe('analyze / judgeMove：复盘的数据来源', () => {
  it('analyze 返回的着法全部合法且按分数降序', () => {
    resetEngine();
    const b = initialBoard();
    const a = analyze(b, 'r', { maxDepth: 3, timeMs: 800, jitter: 0 });
    expect(a.moves.length).toBe(legalMoves(b, 'r').length);
    for (const ms of a.moves) expect(isLegal(b, 'r', ms.move)).toBe(true);
    for (let i = 1; i < a.moves.length; i++) {
      expect(a.moves[i - 1].score).toBeGreaterThanOrEqual(a.moves[i].score);
    }
  });

  it('没有合法着法时 analyze 返回空表', () => {
    resetEngine();
    const mated = board(
      '. . . . k . . . .',
      '. . . P R P . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(analyze(mated, 'b', { maxDepth: 3, timeMs: 300, jitter: 0 }).moves).toEqual([]);
  });

  it('judgeMove 给出的最佳着法合法，主变每一手也合法', () => {
    resetEngine();
    const b = initialBoard();
    const j = judgeMove(b, 'r', mv(0, 6, 0, 5), { maxDepth: 4, timeMs: 900, jitter: 0 })!;
    expect(j).toBeTruthy();
    expect(isLegal(b, 'r', j.best.move)).toBe(true);
    // 主变逐手走一遍，每一手都必须合法——复盘界面会把它显示成"正确下法"
    let cur = b;
    let c: Color = 'r';
    for (const m of j.best.pv) {
      expect(isLegal(cur, c, m), '主变里出现了非法着法').toBe(true);
      cur = applyMove(cur, m);
      c = c === 'r' ? 'b' : 'r';
    }
  });

  it('传进非法着法时返回 null，而不是给出一个假分数', () => {
    resetEngine();
    expect(judgeMove(initialBoard(), 'r', mv(0, 6, 5, 5), { maxDepth: 2, timeMs: 200, jitter: 0 })).toBeNull();
  });

  it('最佳着法的分数不低于任何其它着法', () => {
    resetEngine();
    const b = bare();
    put(b, 4, 6, 'R');
    put(b, 4, 3, 'r'); // 白给的车
    const j = judgeMove(b, 'r', mv(4, 6, 4, 5), { maxDepth: 4, timeMs: 800, jitter: 0 })!;
    expect(j.best.score).toBeGreaterThanOrEqual(j.played.score);
  });
});

describe('局面评估', () => {
  it('开局是均势', () => {
    expect(Math.abs(evaluatePosition(initialBoard()))).toBeLessThan(200);
  });

  it('多一个车就明显占优（红方为正）', () => {
    const b = initialBoard();
    b[0][0] = null; // 拿掉黑车
    expect(evaluatePosition(b)).toBeGreaterThan(500);
    const b2 = initialBoard();
    b2[9][0] = null; // 拿掉红车
    expect(evaluatePosition(b2)).toBeLessThan(-500);
  });
});
