import { describe, expect, it } from 'vitest';
import { analyze, resetEngine } from '../src/xiangqi/ai';
import { judgeMove, shouldWarn, warnText } from '../src/xiangqi/livecoach';
import { deepFacts } from '../src/xiangqi/deepcoach';
import { offlineText, verifyExplanation } from '../src/xiangqi/llm';
import { applyMove, initialBoard, legalMoves } from '../src/xiangqi/rules';
import { moveRisk } from '../src/xiangqi/teach';

describe('不丢子但位置差的一手，教练也要说得出话', () => {
  it('开局里找一手"不丢子但引擎明显不喜欢"的棋，教练能拦住并讲清楚', async () => {
    resetEngine();
    let b = initialBoard();
    for (const m of [[1,7,4,7],[7,2,4,2],[1,9,2,7],[7,0,6,2]] as const) {
      b = applyMove(b, { fx: m[0], fy: m[1], tx: m[2], ty: m[3] });
    }
    const a = analyze(b, 'r', { maxDepth: 6, timeMs: 1500, jitter: 0 }).moves;

    // 找一手：静态兑子看不出任何问题（不丢子），但引擎认为明显差
    const target = a.find((s) => {
      const loss = a[0].score - s.score;
      return loss >= 150 && !moveRisk(b, s.move, 'r');
    });
    expect(target, '这个局面里没有"不丢子但位置差"的着法，换个局面再测').toBeTruthy();

    const v = judgeMove(b, target!.move, 'r', a);
    expect(v.risk, '这一手本来就不该有静态风险').toBeNull();
    expect(v.fromEngine).toBe(true);
    expect(shouldWarn(3, v), '教学档应该拦下这种位置亏').toBe(true);

    // 话里不能是"你的某个子会被吃"，而应该说位置
    const t = warnText(2, v);
    expect(t).toContain('位置');

    // 深度解读要给出"差在哪"，而不是一句"这手不好"
    const facts = await deepFacts(b, target!.move, 'r', { ply: 4, analysis: a });
    // 不丢子的一手没有"具体会发生什么"可讲，但**梯次和名次必须有**——
    // 那正是"从全局看"该给的东西：这个局面有哪些选择、你排第几
    expect(facts.tiers!.length).toBeGreaterThan(3);
    expect(facts.place, '必须查得到自己这一手排第几').toBeTruthy();
    expect(facts.place!.rank).toBeGreaterThan(1);
    expect(facts.reason, '要说清首选好在哪').toBeTruthy();
    const text = offlineText(facts);
    expect(verifyExplanation(text, facts).ok).toBe(true);
  }, 60000);

  it('引擎首选在任何档位都不会被拦——照着推荐走不该挨骂', () => {
    resetEngine();
    const b = initialBoard();
    const a = analyze(b, 'r', { maxDepth: 5, timeMs: 900, jitter: 0 }).moves;
    for (const lv of [1, 2, 3] as const) {
      expect(shouldWarn(lv, judgeMove(b, a[0].move, 'r', a))).toBe(false);
    }
  }, 40000);

  it('整盘局面扫一遍：凡是被拦下的，引擎分差都真的够大', () => {
    resetEngine();
    const b = initialBoard();
    const a = analyze(b, 'r', { maxDepth: 5, timeMs: 900, jitter: 0 }).moves;
    for (const m of legalMoves(b, 'r')) {
      const v = judgeMove(b, m, 'r', a);
      if (shouldWarn(2, v) && v.fromEngine && !v.mateNext) {
        expect(v.loss).toBeGreaterThanOrEqual(250);
        expect(v.rank).toBeGreaterThan(1);
      }
    }
  }, 40000);
});
