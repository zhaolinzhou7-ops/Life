/**
 * 题目内容：一眼必胜的不出、杀法不按名字考。
 * 用户原话："题目分类没必要细究到底叫闷宫还是马后炮""题库里还是有太多一眼就能看出来的必胜残局
 * （比如对方只剩老将，或者只剩士和老将），这种题就别再出了"。
 */
import { describe, expect, it } from 'vitest';
import { allPuzzles, byKind, combos, defenseless, loadPuzzles } from '../src/xiangqi/puzzles';
import { allEndgames, loadLibrary, obviousWin } from '../src/xiangqi/library';
import raw from '../src/xiangqi/puzzles.json';

describe('一眼必胜的题不出', () => {
  it('对方只剩将（士象）：认得出来', () => {
    expect(defenseless('4k4/4a4/9/9/9/9/9/9/4A4/3RK4 w')).toBe(true); // 对方只剩将和一个士
    expect(defenseless('3k5/9/9/9/9/9/9/9/9/3RK4 w')).toBe(true); // 光将
    expect(defenseless('3k5/9/9/9/9/9/9/9/2p6/3RK4 w')).toBe(false); // 对方还有个卒
    // 轮到黑走：看红方有没有子
    expect(defenseless('3k5/9/9/9/9/9/9/9/9/3AK4 b')).toBe(true);
  });

  it('加载以后题库里一道都没有；原来有几百道', async () => {
    await loadPuzzles();
    const before = (raw as { fen: string }[]).filter((p) => defenseless(p.fen)).length;
    expect(before).toBeGreaterThan(300);
    expect(allPuzzles().filter((p) => defenseless(p.fen))).toEqual([]);
  });

  it('杀法题还够练：实战局面里的杀（组合里的杀棋归进来），每一档难度都有', async () => {
    await loadPuzzles();
    const mate = byKind('mate');
    expect(mate.length).toBeGreaterThanOrEqual(60);
    expect(mate.some((p) => p.rating < 1000)).toBe(true);
    expect(mate.some((p) => p.rating > 1600)).toBe(true);
    // 组合里的杀棋：题型变成杀法，组合列表里照样有
    expect(mate.some((p) => p.themes?.includes('杀'))).toBe(true);
    expect(combos().length).toBeGreaterThanOrEqual(90);
    for (const k of ['tactic', 'safety', 'endgame', 'opening'] as const) expect(byKind(k).length, k).toBeGreaterThanOrEqual(100);
  });
});

describe('一眼必胜的残局不出', () => {
  const pos = (fen: string, target = 'win') => ({ fen, you: 'r' as const, target });
  it('对方没子、你有车或者两个以上进攻子、或者对方是光将：不出', () => {
    expect(obviousWin(pos('3k5/4a4/5a3/9/9/9/9/9/9/3RK4 w'))).toBe(true); // 单车对双士
    expect(obviousWin(pos('3k5/9/9/9/9/9/4P4/9/9/4K4 w'))).toBe(true); // 单兵对光将
    expect(obviousWin(pos('3akab2/9/9/9/9/9/9/9/2H1P4/4K4 w'))).toBe(true); // 马兵对士象
    expect(obviousWin(pos('3k5/4a4/9/9/9/9/9/9/2H6/4K4 w'))).toBe(false); // 单马对单士：技术残局，留着
    expect(obviousWin(pos('3k5/4a4/9/9/9/9/9/9/2H6/4K4 w', 'draw'))).toBe(false); // 守和的不管
    expect(obviousWin(pos('3k5/4a4/2r6/9/9/9/9/9/3R5/4K4 w'))).toBe(false); // 对方还有车
  });

  it('残局库加载以后：要赢的局面里一个都没有；守和的都留着', async () => {
    await loadLibrary();
    const eg = allEndgames();
    expect(eg.filter((e) => obviousWin(e))).toEqual([]);
    expect(eg.filter((e) => e.target === 'win').length).toBeGreaterThanOrEqual(40);
    expect(eg.filter((e) => e.target === 'draw').length).toBeGreaterThanOrEqual(150);
  });
});
