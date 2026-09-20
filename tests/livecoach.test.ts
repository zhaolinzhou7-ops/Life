/**
 * 教练模式测试。
 *
 * 这一版重点锁死用户反馈的两个真问题：
 *   1. **推荐了又说不行** —— 教练推荐 A，照着走 A，它又跳出来说 A 有风险。
 *      根因是报警和推荐用了两个不同的裁判。现在只有引擎一个裁判，
 *      而且"引擎首选永不报警"是一条硬规则，这里用测试钉死。
 *   2. **只盯着谁被吃** —— 一手位置很差但不丢子的棋，原来一句话都不说。
 *      现在用引擎分差判，位置亏也拦得住。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import {
  HINT_LEVELS,
  checkMove,
  getHintLevel,
  judgeMove,
  setHintLevel,
  shouldWarn,
  warnText,
  type MoveVerdict,
} from '../src/xiangqi/livecoach';
import { analyze, resetEngine } from '../src/xiangqi/ai';
import { initialBoard, legalMoves, type Board, type Move } from '../src/xiangqi/rules';
import { bare, board, mv, put } from './helpers';

const verdict = (over: Partial<MoveVerdict> = {}): MoveVerdict => ({
  loss: 0,
  rank: 2,
  risk: null,
  mateNext: false,
  fromEngine: true,
  ...over,
});

/** 真跑一次引擎分析，测试要用真实数据而不是编的 */
const analyzeReal = (b: Board, c: 'r' | 'b' = 'r') => {
  resetEngine();
  // 深度封顶、时间给足：时间封顶的话并行跑测试时 CPU 被抢，
  // 搜到的层数每次不一样，分数跟着变，断言就会时红时绿
  return analyze(b, c, { maxDepth: 4, timeMs: 30000, jitter: 0 }).moves;
};

beforeEach(() => {
  memStore.clear();
  memStore.full = false;
});

describe('提示档位', () => {
  it('四个档位，和规格一一对应', () => {
    expect(HINT_LEVELS.map((h) => h.name)).toEqual(['关闭', '轻提示', '标准提示', '教学提示']);
  });

  it('默认是标准提示（读不到存档时 Number(null) 会变成 0，那是"关闭"档）', () => {
    expect(getHintLevel()).toBe(2);
  });

  it('设置能存能读，垃圾值退回默认', () => {
    setHintLevel(3);
    expect(getHintLevel()).toBe(3);
    memStore.setItem('xq-hint-level', '乱写');
    expect(getHintLevel()).toBe(2);
  });
});

describe('引擎首选永不报警——这是最伤信任的那个 bug', () => {
  it('rank=1 时任何档位、任何亏损都不开口', () => {
    for (const lv of [1, 2, 3] as const) {
      expect(shouldWarn(lv, verdict({ rank: 1, loss: 0 }))).toBe(false);
      expect(shouldWarn(lv, verdict({ rank: 1, loss: 900 }))).toBe(false);
    }
  });

  it('真跑一遍引擎：把它自己的首选喂回去，一定不报警', () => {
    const b = initialBoard();
    const a = analyzeReal(b);
    const best = a[0].move;
    for (const lv of [1, 2, 3] as const) {
      expect(checkMove(lv, b, best, 'r', a), `${lv} 档对引擎首选报了警`).toBeNull();
    }
  });

  it('引擎前三名的着法，标准档也不该报警（它们都是能推荐的手）', () => {
    const b = initialBoard();
    const a = analyzeReal(b);
    for (const s of a.slice(0, 3)) {
      const v = judgeMove(b, s.move, 'r', a);
      expect(v.loss).toBeLessThan(250);
      expect(shouldWarn(2, v)).toBe(false);
    }
  });
});

describe('judgeMove：用引擎的口径判', () => {
  it('分析里有这一手就给出名次和分差', () => {
    const b = initialBoard();
    const a = analyzeReal(b);
    const v = judgeMove(b, a[0].move, 'r', a);
    expect(v.fromEngine).toBe(true);
    expect(v.rank).toBe(1);
    expect(v.loss).toBe(0);
  });

  it('越靠后的着法分差越大', () => {
    const b = initialBoard();
    const a = analyzeReal(b);
    const first = judgeMove(b, a[0].move, 'r', a);
    const last = judgeMove(b, a[a.length - 1].move, 'r', a);
    expect(last.loss).toBeGreaterThanOrEqual(first.loss);
    expect(last.rank).toBeGreaterThan(first.rank);
  });

  it('分析对应的是别的局面时，宁可当作没有引擎数据', () => {
    // 拿开局的分析去判另一个局面的着法。要挑一手**开局不可能出现**的：
    // (4,6) 在开局是兵，只能走到 (4,5)，所以 (4,6)→(4,3) 一定不在表里。
    // （顺带说明为什么真正的护栏在 index.ts 那边是比对 FEN：
    //   光靠"这一手在不在表里"会撞车——不同局面完全可能有同样坐标的着法。）
    const a = analyzeReal(initialBoard());
    const other = bare();
    put(other, 4, 6, 'R');
    const v = judgeMove(other, mv(4, 6, 4, 3), 'r', a);
    expect(v.fromEngine).toBe(false);
    expect(v.loss).toBe(0);
  });

  it('没有引擎数据时仍然算得出静态风险，不至于完全哑掉', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const v = judgeMove(b, mv(4, 6, 3, 4), 'r', null);
    expect(v.fromEngine).toBe(false);
    expect(v.risk).not.toBeNull();
    expect(shouldWarn(2, v)).toBe(true);
  });

  it('杀棋分不会算出天文数字的分差', () => {
    const a = [
      { move: mv(0, 0, 0, 1), score: 49990, pv: [] },
      { move: mv(1, 1, 1, 2), score: -20, pv: [] },
    ];
    const v = judgeMove(initialBoard(), mv(1, 1, 1, 2), 'r', a as never);
    expect(v.loss).toBeLessThanOrEqual(2000);
  });
});

describe('门槛：档位越高开口越多', () => {
  it('轻提示只管丢马炮以上，标准管一个马，教学连位置亏也说', () => {
    expect(shouldWarn(1, verdict({ loss: 300 }))).toBe(false);
    expect(shouldWarn(2, verdict({ loss: 300 }))).toBe(true);
    expect(shouldWarn(3, verdict({ loss: 150 }))).toBe(true);
    expect(shouldWarn(2, verdict({ loss: 150 }))).toBe(false);
  });

  it('关闭档什么都不说', () => {
    expect(shouldWarn(0, verdict({ loss: 2000, mateNext: true }))).toBe(false);
  });

  it('走完被一步将死，任何开着的档位都拦', () => {
    for (const lv of [1, 2, 3] as const) expect(shouldWarn(lv, verdict({ mateNext: true, loss: 0 }))).toBe(true);
  });

  it('档位越高开口只多不少', () => {
    for (const loss of [150, 300, 600, 1200]) {
      const on = ([0, 1, 2, 3] as const).map((lv) => shouldWarn(lv, verdict({ loss })));
      const first = on.indexOf(true);
      if (first >= 0) expect(on.slice(first).every(Boolean)).toBe(true);
    }
  });
});

describe('不丢子但位置差的一手，也要说得出话——这是"只盯着少子"的正面回答', () => {
  it('没有任何子受威胁，但引擎说亏了分，照样开口', () => {
    const v = verdict({ loss: 400, rank: 7, risk: null });
    expect(shouldWarn(2, v)).toBe(true);
    const t = warnText(2, v);
    expect(t).toContain('位置');
    expect(t).not.toContain('被吃');
  });

  it('有具体丢子的时候还是点名那个子', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const v = judgeMove(b, mv(4, 6, 3, 4), 'r', null);
    expect(warnText(2, v)).toContain('马');
  });

  it('轻提示档只给一句模糊提醒，不泄露是哪个子', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const v = judgeMove(b, mv(4, 6, 3, 4), 'r', null);
    expect(warnText(1, v)).not.toContain('马');
  });
});

describe('checkMove：对局里的完整一次判断', () => {
  it('关闭档直接放行', () => {
    expect(checkMove(0, initialBoard(), mv(1, 7, 4, 7), 'r', null)).toBeNull();
  });

  it('开局的正常一手不拦', () => {
    const b = initialBoard();
    const a = analyzeReal(b);
    for (const lv of [1, 2, 3] as const) {
      expect(checkMove(lv, b, mv(1, 7, 4, 7), 'r', a)).toBeNull();
    }
  });

  it('同一个局面、同一手棋，答案永远一样', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const a = checkMove(2, b, mv(4, 6, 3, 4), 'r', null);
    const c = checkMove(2, b, mv(4, 6, 3, 4), 'r', null);
    expect(JSON.stringify(a)).toBe(JSON.stringify(c));
  });

  it('把一整个局面的所有着法过一遍：被拦下的都不是引擎前三名', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . p . . . .',
      '. . r . . . . . .',
      '. . . . . . . . .',
      '. . . . H . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    const a = analyzeReal(b);
    const top3 = new Set(a.slice(0, 3).map((s) => `${s.move.fx},${s.move.fy},${s.move.tx},${s.move.ty}`));
    for (const m of legalMoves(b, 'r') as Move[]) {
      const v = checkMove(2, b, m, 'r', a);
      if (v) {
        const key = `${m.fx},${m.fy},${m.tx},${m.ty}`;
        expect(top3.has(key), `引擎前三名的 ${key} 被报警了`).toBe(false);
      }
    }
  });
});
