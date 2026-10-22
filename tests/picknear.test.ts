/**
 * 出题：没做过的先出，宁难勿易。
 * 用户原话："不要太多重复……低级题目太多"。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w';
const R = [850, 950, 1050, 1300, 1350, 1450, 1700, 1900];
vi.mock('../src/xiangqi/puzzles.json', () => ({
  default: R.map((rating) => ({ id: `t${rating}`, kind: 'tactic', fen: FEN, answer: '炮二平五', rating })),
}));

const { loadPuzzles, pickNear } = await import('../src/xiangqi/puzzles');
const { firstAttempt } = await import('../src/xiangqi/save');

describe('pickNear', () => {
  beforeEach(async () => {
    localStorage.clear();
    await loadPuzzles();
  });

  it('同样差一两百分，先出难一点的那道（比你低的题按 1.6 倍算远）', () => {
    // 1200 分：1050（低 150）和 1350（高 150）一样近，1300（高 100）最近
    expect(pickNear('tactic', 1200, new Set(), 1)?.rating).toBe(1300);
    expect(pickNear('tactic', 1200, new Set(['t1300']), 1)?.rating).toBe(1350);
    // 低 150 按 240 算，比高 250 的那道还近一点：差得不多时也不是一味出难的
    expect(pickNear('tactic', 1200, new Set(['t1300', 't1350']), 1)?.rating).toBe(1050);
  });

  it('这一段的新题做完了，往上够（再难三百分以内），不回头出简单的', () => {
    for (const id of ['t1050', 't1300', 't1350', 't1450']) firstAttempt(id);
    expect(pickNear('tactic', 1200, new Set(), 1)?.rating).toBe(1700);
  });

  it('上下都没新题了：先出做得最早的旧题，不出低三百分以上的新题', () => {
    for (const id of ['t1050', 't1300', 't1350', 't1450', 't1700']) firstAttempt(id);
    const p = pickNear('tactic', 1200, new Set())!;
    expect(['t1050', 't1300', 't1350', 't1450', 't1700']).toContain(p.id);
  });

  it('什么都没有了才出简单的新题', () => {
    expect(pickNear('tactic', 2600, new Set(), 1)?.rating).toBe(1900);
    const ex = new Set(R.filter((r) => r > 900).map((r) => `t${r}`));
    expect(pickNear('tactic', 1200, ex, 1)?.rating).toBe(850);
  });
});
