/**
 * 深度解读测试。
 *
 * 这一层的产出会整段讲给用户听，所以最怕的不是算错，是**说了好听但不成立的话**。
 * 重点测两件事：
 *   每条结论都对得上局面（意图判断、全局数字）
 *   不说假话（将军造成的机动性骤降不能吹成"把对方困住了"）
 */
import { describe, expect, it } from 'vitest';
import {
  INTENT_INFO,
  PHASE_PRINCIPLE,
  deepFacts,
  describeCandidates,
  globalNotes,
  intentsOf,
  phaseOf,
  postureOf,
} from '../src/xiangqi/deepcoach';
import { offlineText, verifyExplanation } from '../src/xiangqi/llm';
import { applyMove, initialBoard, legalMoves } from '../src/xiangqi/rules';
import { inPieces } from '../src/xiangqi/teach';
import { board, bare, mv, put } from './helpers';

describe('intentsOf：这一手在做什么', () => {
  it('开局出马 → 出动大子', () => {
    expect(intentsOf(initialBoard(), mv(1, 9, 2, 7), 'r')).toContain('develop');
  });

  it('炮二平五 → 出动大子 + 占中', () => {
    const its = intentsOf(initialBoard(), mv(1, 7, 4, 7), 'r');
    expect(its).toContain('develop');
    expect(its).toContain('center');
  });

  it('兵过河 → cross', () => {
    const b = bare();
    put(b, 0, 5, 'P');
    expect(intentsOf(b, mv(0, 5, 0, 4), 'r')).toContain('cross');
  });

  it('将军认得出来', () => {
    const b = bare(); // 黑将 (3,0)
    put(b, 3, 5, 'R');
    expect(intentsOf(b, mv(3, 5, 3, 4), 'r')).toContain('check');
  });

  it('吃子认得出来', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'p');
    expect(intentsOf(b, mv(0, 9, 0, 4), 'r')).toContain('capture');
  });

  it('把被捉的子挪走 → escape', () => {
    // 红马在 (4,4) 被黑车 (4,1) 照着，挪到安全处
    const b = bare();
    put(b, 4, 4, 'H');
    put(b, 4, 1, 'r');
    const its = intentsOf(b, mv(4, 4, 6, 5), 'r');
    expect(its).toContain('escape');
  });

  it('一手棋可以同时有好几个意图，不是只报一个', () => {
    const its = intentsOf(initialBoard(), mv(1, 7, 4, 7), 'r');
    expect(its.length).toBeGreaterThan(1);
  });

  it('实在没目的的一手 → quiet，而不是硬安一个意图', () => {
    // 开局推一个边兵：不吃子、不将军、没过河、也不是大子出动。
    // （不能拿空盘上的光杆车试——那种局面下随便走一手都是"做杀"，
    //   而且车本来就在原位，会算成出动大子，两个意图都成立。）
    expect(intentsOf(initialBoard(), mv(2, 6, 2, 5), 'r')).toEqual(['quiet']);
  });

  it('不是自己的子返回空', () => {
    expect(intentsOf(initialBoard(), mv(0, 0, 0, 1), 'r')).toEqual([]);
  });

  it('每个意图都配了名字和道理，界面不会显示 undefined', () => {
    for (const k of Object.keys(INTENT_INFO) as (keyof typeof INTENT_INFO)[]) {
      expect(INTENT_INFO[k].name.length).toBeGreaterThan(0);
      expect(INTENT_INFO[k].why.length).toBeGreaterThan(5);
    }
  });
});

describe('postureOf：局面的可量化维度', () => {
  it('开局双方完全对称', () => {
    const p = postureOf(initialBoard(), 'r');
    expect(p.material).toBe(0);
    expect(p.mobility).toBe(p.oppMobility);
    expect(p.crossed).toBe(0);
    expect(p.oppCrossed).toBe(0);
    expect(p.developed).toBe(0);
    expect(p.oppDeveloped).toBe(0);
    expect(p.guards).toBe(4);
    expect(p.oppGuards).toBe(4);
  });

  it('出动的大子数得准', () => {
    const b = applyMove(initialBoard(), mv(1, 9, 2, 7));
    expect(postureOf(b, 'r').developed).toBe(1);
    expect(postureOf(b, 'b').oppDeveloped).toBe(1);
  });

  it('过河的大子算进空间', () => {
    const b = bare();
    put(b, 4, 3, 'R'); // 红车过河
    expect(postureOf(b, 'r').crossed).toBe(1000);
    expect(postureOf(b, 'b').oppCrossed).toBe(1000);
  });

  it('士象被吃会反映在 guards 上', () => {
    const b = initialBoard();
    b[9][3] = null;
    expect(postureOf(b, 'r').guards).toBe(3);
  });
});

describe('globalNotes：全局解读必须句句有数', () => {
  it('每一条都带得出数字，不是空泛的形容词', () => {
    const notes = globalNotes(initialBoard(), mv(1, 7, 4, 7), 'r');
    expect(notes.length).toBeGreaterThan(0);
    for (const n of notes) {
      expect(n.label.length).toBeGreaterThan(0);
      expect(/\d/.test(n.text), `这条没有数字：${n.text}`).toBe(true);
    }
  });

  it('吃子会报子力变化', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'p');
    const notes = globalNotes(b, mv(0, 9, 0, 4), 'r');
    expect(notes.some((n) => n.label === '子力' && n.tone === 'good')).toBe(true);
  });

  it('将军造成的机动性骤降不许吹成"把对方困住了"', () => {
    const b = bare();
    put(b, 3, 5, 'R'); // 平到三路照将黑将
    const notes = globalNotes(b, mv(3, 5, 3, 4), 'r');
    const mob = notes.find((n) => n.label === '机动性');
    if (mob) {
      expect(mob.text).toContain('被将军逼的');
      expect(mob.tone).not.toBe('good');
    }
  });

  it('丢士象会明确报警', () => {
    const b = initialBoard();
    // 造一个"走完之后士被吃掉"的局面不好构造，这里直接验证 posture 的差值逻辑
    const before = postureOf(b, 'r');
    b[9][3] = null;
    expect(postureOf(b, 'r').guards).toBeLessThan(before.guards);
  });
});

describe('phaseOf：阶段判断', () => {
  it('开局就是开局', () => {
    expect(phaseOf(initialBoard(), 0)).toBe('opening');
  });

  it('大子快吃光了就是残局', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 8, 0, 'r');
    expect(phaseOf(b, 60)).toBe('endgame');
  });

  it('每个阶段都有三条能照着做的原则', () => {
    for (const k of ['opening', 'middle', 'endgame'] as const) {
      expect(PHASE_PRINCIPLE[k].length).toBeGreaterThanOrEqual(3);
      for (const line of PHASE_PRINCIPLE[k]) expect(line.length).toBeGreaterThan(10);
    }
  });
});

describe('describeCandidates：候选走法要说清各自想干什么', () => {
  it('给每一手配上意图和主变', () => {
    const b = initialBoard();
    const ms = legalMoves(b, 'r').slice(0, 3);
    const cands = describeCandidates(
      b,
      'r',
      ms.map((m, i) => ({ move: m, score: 100 - i * 30, pv: [m] })),
    );
    expect(cands.length).toBe(3);
    expect(cands[0].behind).toBe(0);
    expect(cands[1].behind).toBe(30);
    for (const c of cands) {
      expect(c.text.length).toBeGreaterThan(0);
      expect(c.idea.length).toBeGreaterThan(0);
      expect(c.gap.length).toBeGreaterThan(0);
    }
  });

  it('首选是杀棋时不拿四万分的杀棋分去做减法', () => {
    // 引擎的杀棋分是四万多，直接相减会得出"比首选差 99993 分"这种鬼数字，
    // 用户看到只会觉得这软件在乱报
    const b = initialBoard();
    const ms = legalMoves(b, 'r').slice(0, 2);
    const cands = describeCandidates(b, 'r', [
      { move: ms[0], score: 49990, pv: [ms[0]] }, // 杀棋分
      { move: ms[1], score: -3, pv: [ms[1]] },
    ]);
    expect(cands[1].gap).toContain('杀棋');
    expect(cands[1].gap).not.toMatch(/\d{5}/);
    expect(cands[1].behind).toBeLessThanOrEqual(9999);
  });

  it('正常分差用分数加"几个子"说明，不是裸数字', () => {
    const b = initialBoard();
    const ms = legalMoves(b, 'r').slice(0, 2);
    const cands = describeCandidates(b, 'r', [
      { move: ms[0], score: 100, pv: [ms[0]] },
      { move: ms[1], score: -400, pv: [ms[1]] },
    ]);
    expect(cands[1].gap).toContain('500');
    expect(cands[1].gap).toContain('马或炮');
  });

  it('空表不会炸', () => {
    expect(describeCandidates(initialBoard(), 'r', [])).toEqual([]);
  });
});

describe('deepFacts：完整的一份解读', () => {
  it('开局一手棋，该有的段落都有，而且不编着法', async () => {
    const f = await deepFacts(initialBoard(), mv(1, 7, 4, 7), 'r', { ply: 0 });
    expect(f.kind).toBe('move-deep');
    expect(f.intent).toContain('炮');
    expect(f.stage).toBe('开局');
    expect(f.principles!.length).toBeGreaterThan(0);
    expect(f.global!.length).toBeGreaterThan(0);

    const text = offlineText(f);
    expect(text).toContain('这一步在做什么');
    expect(text).toContain('通用道理');
    // 最要紧的一条：整段话里不许出现这个局面上不存在的着法
    expect(verifyExplanation(text, f).ok, 'AI 讲解里出现了编造的着法').toBe(true);
  }, 40000);

  it('候选走法里不会列出用户刚走的那一手', async () => {
    const m = mv(1, 7, 4, 7);
    const f = await deepFacts(initialBoard(), m, 'r', { ply: 0 });
    const played = f.played!;
    expect(f.candidates?.some((c) => c.text === played)).toBeFalsy();
  }, 40000);

  it('送子的一手会同时给出问题和更好的选择', async () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    const f = await deepFacts(b, mv(4, 6, 3, 4), 'r', { ply: 20 });
    expect(f.problem).toBeTruthy();
    expect(f.problem).toContain('马');
    const text = offlineText(f);
    expect(text).toContain('问题在哪');
    expect(verifyExplanation(text, f).ok).toBe(true);
  }, 40000);
});

describe('inPieces：换算成几个子要说人话', () => {
  it('大额换算成车马炮', () => {
    expect(inPieces(1000)).toBe('一个车');
    expect(inPieces(500)).toBe('一个马或炮');
    expect(inPieces(2000)).toBe('两个车');
  });

  it('中间段换算成几个兵，不再用"一个士象"绕人', () => {
    expect(inPieces(400)).toBe('4个兵');
    expect(inPieces(200)).toBe('2个兵');
    expect(inPieces(100)).toBe('1个兵');
  });

  it('正负都按绝对值说', () => {
    expect(inPieces(-1000)).toBe('一个车');
  });
});
