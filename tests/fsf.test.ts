/**
 * 专业引擎（Fairy-Stockfish）的接线层：坐标、分数、info 行、着法表。
 * 引擎本体在浏览器里跑（界面测试覆盖），这里锁死的是两边对接的口径——
 * 口径错一点，教练就会把"红方被杀"读成"红方杀人"。
 */
import { describe, expect, it } from 'vitest';
import { FSF_SCALE, linesToMoveScores, moveToUci, parseInfo, toOurScore, uciToMove } from '../src/xiangqi/fsf';
import { analyze, resetEngine } from '../src/xiangqi/ai';
import { initialBoard, legalMoves } from '../src/xiangqi/rules';
import { fromFen, moveToText } from '../src/xiangqi/notation';
import { engineProblem } from '../src/xiangqi/deepcoach';

describe('坐标', () => {
  it('a1 是红方左下角，第 10 行是黑方底线', () => {
    // 红方右马 (7,9) 跳到 (6,7)：马二进三 = h1g3
    const m = { fx: 7, fy: 9, tx: 6, ty: 7 };
    expect(moveToUci(m)).toBe('h1g3');
    expect(moveToText(initialBoard(), m)).toBe('马二进三');
    // 黑方左车 (0,0) → a10
    expect(moveToUci({ fx: 0, fy: 0, tx: 0, ty: 1 })).toBe('a10a9');
  });

  it('开局所有合法着法来回转换不失真', () => {
    for (const c of ['r', 'b'] as const) {
      for (const m of legalMoves(initialBoard(), c)) expect(uciToMove(moveToUci(m))).toEqual(m);
    }
  });

  it('乱七八糟的输入返回 null', () => {
    for (const s of ['', 'z1a2', 'a11a1', 'a0a1', '(none)']) expect(uciToMove(s)).toBeNull();
  });
});

describe('分数', () => {
  it('厘兵分按比例换到我们的口径（车≈1000）', () => {
    expect(toOurScore(870, null).score).toBe(Math.round(870 * FSF_SCALE));
    expect(Math.abs(toOurScore(870, null).score - 1000)).toBeLessThan(20);
  });

  it('杀棋分和自家引擎同一个口径：mate 3 = 3 步杀，mate -2 = 2 步被杀', () => {
    expect(toOurScore(null, 3).mateIn).toBe(3);
    expect(toOurScore(null, -2).mateIn).toBe(-2);
    expect(toOurScore(null, 3).score).toBeGreaterThan(40000);
    expect(toOurScore(null, -2).score).toBeLessThan(-40000);
    // 快杀比慢杀分高；早被杀比晚被杀分低
    expect(toOurScore(null, 1).score).toBeGreaterThan(toOurScore(null, 3).score);
    expect(toOurScore(null, -1).score).toBeLessThan(toOurScore(null, -3).score);
  });

  it('自家引擎在同一个杀局里算出的分数，和换算后的引擎分数落在同一档', () => {
    // 红方一步杀：自家引擎的首选分数应该和 mate 1 换算出来的一样
    const b = fromFen('3k5/9/9/9/9/9/9/9/3R5/3RK4 w')!.board;
    resetEngine();
    const a = analyze(b, 'r', { maxDepth: 3, timeMs: 30000, jitter: 0 }).moves;
    if (a[0].mateIn === 1) expect(a[0].score).toBe(toOurScore(null, 1).score);
  });
});

describe('info 行', () => {
  it('解析深度、第几条、分数、主变', () => {
    const l = parseInfo('info depth 11 seldepth 15 multipv 2 score cp -565 nodes 600254 nps 199951 time 3002 pv h1h3 f5e3 f1e2')!;
    expect(l.depth).toBe(11);
    expect(l.multipv).toBe(2);
    expect(l.score).toBe(Math.round(-565 * FSF_SCALE));
    expect(l.pv).toEqual(['h1h3', 'f5e3', 'f1e2']);
    expect(l.bound).toBe(false);
  });

  it('杀棋和上下界', () => {
    expect(parseInfo('info depth 9 multipv 1 score mate -3 nodes 1 pv a1a2')!.mateIn).toBe(-3);
    expect(parseInfo('info depth 9 multipv 1 score cp 20 lowerbound nodes 1 pv a1a2')!.bound).toBe(true);
  });

  it('没有主变的行不算', () => {
    expect(parseInfo('info depth 5 currmove h1g3 currmovenumber 1')).toBeNull();
    expect(parseInfo('info string NNUE evaluation disabled')).toBeNull();
  });
});

describe('着法表：前几名精确，其余只知道上限', () => {
  const b = initialBoard();
  const lines = [
    parseInfo('info depth 12 multipv 1 score cp 20 pv h1g3 h10g8')!,
    parseInfo('info depth 12 multipv 2 score cp 15 pv g1e3 h10g8')!,
  ];
  const t = linesToMoveScores(lines, b, 'r');

  it('全部合法着法都在表里，前两名精确、按名次排', () => {
    expect(t.length).toBe(legalMoves(b, 'r').length);
    expect(moveToText(b, t[0].move)).toBe('马二进三');
    expect(moveToText(b, t[1].move)).toBe('相三进五');
    expect(t[0].bound).toBeUndefined();
    expect(t[0].pv.length).toBe(2);
  });

  it('其余着法标成上限，分数不高于最后一名精确分', () => {
    for (const x of t.slice(2)) {
      expect(x.bound).toBe(true);
      expect(x.score).toBeLessThanOrEqual(t[1].score);
    }
  });

  it('引擎给出不合法的着法（数据错位）就丢掉，不让它混进教练的判断', () => {
    const bad = [parseInfo('info depth 3 multipv 1 score cp 0 pv a1a9')!];
    expect(linesToMoveScores(bad, b, 'r').every((x) => x.bound)).toBe(true);
  });
});

describe('"问题在哪"只从引擎主变里说', () => {
  it('引擎说这一手没亏（差距在"良"以内），就没有问题可讲——哪怕静态兑子觉得会丢子', () => {
    const b = initialBoard();
    const m = { fx: 7, fy: 9, tx: 6, ty: 7 };
    const r = engineProblem(b, m, 'r', { move: m, score: 10, pv: [m] }, { move: m, score: 40 });
    expect(r).toBeNull();
  });

  it('对方第一手就吃子：点名吃了什么', () => {
    const b = fromFen('4k4/4r4/9/9/9/9/4R4/9/9/3K5 w')!.board;
    const m = { fx: 4, fy: 6, tx: 4, ty: 2 };
    const reply = { fx: 4, fy: 1, tx: 4, ty: 2 };
    const r = engineProblem(b, m, 'r', { move: m, score: -900, pv: [m, reply] }, { move: { fx: 4, fy: 6, tx: 4, ty: 1 }, score: 900 })!;
    expect(r.problem).toContain('吃掉你的车');
  });

  it('走完被杀：说几步杀', () => {
    const b = initialBoard();
    const m = { fx: 7, fy: 9, tx: 6, ty: 7 };
    const r = engineProblem(b, m, 'r', { move: m, score: -49996, mateIn: -2, pv: [m] }, { move: m, score: 0 })!;
    expect(r.problem).toContain('2 步杀');
  });
});
