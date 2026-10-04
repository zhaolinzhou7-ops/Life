/**
 * 私教的每日任务：排得对、一天之内不变、做完打勾、不排重复无效的东西。
 * 用户原话："每天把私教任务做完，棋艺就能稳步提升；而不是像现在这样总做些重复无效的内容，效率太低了。"
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { STAGES, dailyPlan, type TrainInput } from '../src/xiangqi/curriculum';
import { lastWeek, localDay, markTask, recentFocus, todayPlan, todayProgress } from '../src/xiangqi/daytasks';

const DIMS = ['safety', 'mate', 'tactic', 'endgame', 'opening'] as const;
function input(over: Partial<TrainInput> = {}): TrainInput {
  const r = Object.fromEntries(DIMS.map((d) => [d, { r: 1300 }])) as TrainInput['ratings'];
  r.safety = { r: 1100 };
  r.mate = { r: 1200 };
  const by = Object.fromEntries(DIMS.map((d) => [d, 0])) as TrainInput['loss']['by'];
  return {
    stage: STAGES[1],
    ratings: r,
    loss: { by, games: 0, total: 0 },
    accuracy: () => null,
    dueCount: 0,
    daysSinceQuiz: 2,
    play: { r: 1300, n: 5 },
    assessed: true,
    day: 1,
    ...over,
  };
}

describe('每日任务怎么排', () => {
  it('第一次来（没测过、没下过）：只有测评和下一盘', () => {
    const p = dailyPlan(input({ assessed: false, play: null }));
    expect(p.map((b) => b.kind)).toEqual(['assess', 'game']);
  });

  it('平常一天：错题（有到期才有）→ 私教课 → 专项 → 一项轮换 → 实战，四五项、半小时上下', () => {
    const p = dailyPlan(input({ dueCount: 4, lesson: { title: '先看对方', step: 1, label: '眼力题', kind: 'drill', dim: 'safety' } }));
    expect(p.map((b) => b.id)).toEqual(['srs', 'lesson', 'focus', 'extra', 'game']);
    const min = p.reduce((a, b) => a + b.minutes, 0);
    expect(min).toBeGreaterThanOrEqual(20);
    expect(min).toBeLessThanOrEqual(45);
    expect(new Set(p.map((b) => b.id)).size).toBe(p.length);
  });

  it('不再排白花时间的：热身简单题、认杀法图形', () => {
    for (let d = 0; d < 7; d++) {
      for (const st of STAGES) {
        const kinds = dailyPlan(input({ stage: st, day: d })).map((b) => b.kind as string);
        expect(kinds).not.toContain('warmup');
        expect(kinds).not.toContain('mate-shape');
      }
    }
  });

  it('没有到期的错题就不出错题这一项', () => {
    expect(dailyPlan(input()).map((b) => b.id)).not.toContain('srs');
  });

  it('私教课这一步是带练一盘：不再另排实战', () => {
    const p = dailyPlan(input({ lesson: { title: 'x', step: 3, label: '带练一盘', kind: 'game' } }));
    expect(p.filter((b) => b.kind === 'game' || b.id === 'lesson').map((b) => b.id)).toEqual(['lesson']);
  });

  // 平常这一天专项该练哪一维（阶段2的重点里分最低的）
  const base = () => dailyPlan(input()).find((b) => b.id === 'focus')!.dim!;

  it('专项练该练的那一维；私教课正在练这一维，就换别的一维', () => {
    const d = base();
    const p = dailyPlan(input({ lesson: { title: 'x', step: 1, label: 'y', kind: 'drill', dim: d } }));
    expect(p.find((b) => b.id === 'focus')!.dim).not.toBe(d);
  });

  it('同一维连练三天、正确率也到七成了：换一维，不在一处原地打转', () => {
    const d = base();
    const acc = () => ({ acc: 0.8, n: 20 });
    expect(dailyPlan(input({ recentFocus: [d, d, d], accuracy: acc })).find((b) => b.id === 'focus')!.dim).not.toBe(d);
    // 正确率还低：接着练
    const low = () => ({ acc: 0.5, n: 20 });
    expect(dailyPlan(input({ recentFocus: [d, d, d], accuracy: low })).find((b) => b.id === 'focus')!.dim).toBe(d);
    // 只连了两天：接着练
    expect(dailyPlan(input({ recentFocus: [d, d], accuracy: acc })).find((b) => b.id === 'focus')!.dim).toBe(d);
  });

  it('难度跟着正确率走：太顺加难、太难降难', () => {
    expect(dailyPlan(input({ accuracy: () => ({ acc: 0.9, n: 20 }) })).find((b) => b.id === 'focus')!.ratingBias).toBeGreaterThan(0);
    expect(dailyPlan(input({ accuracy: () => ({ acc: 0.4, n: 20 }) })).find((b) => b.id === 'focus')!.ratingBias).toBeLessThan(0);
  });

  it('隔了一周没小测：这一天的轮换是小测；有到期的布局复习（阶段3起）排布局复习', () => {
    expect(dailyPlan(input({ daysSinceQuiz: 8 })).find((b) => b.id === 'extra')!.kind).toBe('quiz');
    expect(dailyPlan(input({ stage: STAGES[2], openingDue: 2 })).find((b) => b.id === 'extra')!.kind).toBe('opening');
  });
});

describe('今天的清单：一天之内不变，做完打勾', () => {
  beforeEach(() => localStorage.clear());
  const T = new Date(2026, 9, 4, 9, 0).getTime();

  it('同一天里拿到的是同一份清单，第二天重新排，前一天收进记录', () => {
    let n = 0;
    const build = () => {
      n++;
      return dailyPlan(input());
    };
    const a = todayPlan(build, T);
    const b = todayPlan(build, T + 3600_000);
    expect(n).toBe(1);
    expect(b.blocks).toEqual(a.blocks);
    markTask('focus', T + 7200_000);
    expect(todayProgress(T + 7200_000)).toEqual({ done: 1, total: a.blocks.length });
    const next = todayPlan(build, T + 86400_000);
    expect(n).toBe(2);
    expect(next.done).toEqual([]);
    const f = a.blocks.find((x) => x.id === 'focus')!.dim;
    expect(next.hist[next.hist.length - 1]).toMatchObject({ d: localDay(T), done: 1, focus: f });
    expect(recentFocus()).toEqual([f]);
  });

  it('打勾只打今天的、不重复打', () => {
    todayPlan(() => dailyPlan(input()), T);
    markTask('focus', T);
    markTask('focus', T);
    markTask('game', T + 86400_000); // 第二天的勾打不到昨天的清单上
    expect(todayProgress(T)!.done).toBe(1);
  });

  it('最近七天：做完的、做了一些的、没做的分得清', () => {
    const p = todayPlan(() => dailyPlan(input()), T);
    for (const b of p.blocks) markTask(b.id, T);
    const w = lastWeek(T);
    expect(w).toHaveLength(7);
    expect(w[6]).toMatchObject({ d: localDay(T), full: true });
    expect(w[0].any).toBe(false);
  });
});
