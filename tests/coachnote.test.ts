/**
 * 教练讲解：关键一手、教练小结。
 * 用户原话："再增加详细教练讲解。"——讲解只用谱上已有的东西拼（局面分、每一手自己的讲解），不编。
 */
import { describe, expect, it } from 'vitest';
import { evWords, keyMove, keyTag, lineSummary, withKey } from '../src/xiangqi/coachnote';
import { OPENINGS } from '../src/xiangqi/openings';

const mv = (t: string, ev: number, why = `${t}的说明。`) => ({ t, why, ev });

describe('关键一手', () => {
  it('找局面变化最大的那一手，按走棋方算好坏', () => {
    // 红先：红走完 +30，黑走一手亏到 +400（黑的错着），红再走 +420
    const ms = [mv('炮二平五', 30), mv('卒5进1', 400), mv('炮五进四', 420)];
    const k = keyMove(ms, 20, 'r')!;
    expect(k.i).toBe(1);
    expect(k.swing).toBeLessThan(0); // 对黑方来说变坏了
    expect(evWords(k.before)).toBe('均势');
    expect(evWords(k.after)).toContain('红方');
  });

  it('分数没有明显变化、或者说法没变的线，不硬找关键一手', () => {
    expect(keyMove([mv('a', 20), mv('b', 40), mv('c', 10)], 0, 'r')).toBeNull();
    // 变了 1.2 个兵但都还是"红方大优"
    expect(keyMove([mv('a', 1500), mv('b', 1620)], 1500, 'b')).toBeNull();
  });

  it('杀棋分不会把"赢定以后多走一步"当成关键', () => {
    const ms = [mv('a', 300), mv('b', 1200), mv('c', 30000)];
    const k = keyMove(ms, 0, 'r')!;
    expect(k.i).toBe(1);
  });

  it('讲解里那一手前面标上 ⭐，别的手不动', () => {
    const ms = [mv('炮二平五', 30), mv('卒5进1', 400), mv('炮五进四', 420)];
    const out = withKey(ms, 20, 'r');
    expect(out[1].why).toContain('⭐');
    expect(out[1].why).toContain('黑方');
    expect(out[0].why).toBe(ms[0].why);
    expect(keyTag(keyMove(ms, 20, 'r')!, 'b')).toContain('从「均势」变成');
  });
});

describe('教练小结', () => {
  it('错着：说清楚哪一手、引擎更想走什么、关键在哪、最后谁好', () => {
    const ms = [
      mv('车九进一', 200, '出直车。引擎更想走 <b>兵七进一</b>，这一手差约 2.1 个兵。'),
      mv('象3进5', 220),
      mv('马八进九', 600, '跳边马，捉炮。'),
    ];
    const s = lineSummary({ kind: 'trap', moves: ms, evBefore: 0, firstMover: 'r', ply0: 12 });
    for (const x of ['教练小结', '第 7 回合', '车九进一', '兵七进一', '2.1 个兵', '走到最后']) expect(s, x).toContain(x);
  });

  it('他不按套路走：说出原来谱上是哪一手', () => {
    const s = lineSummary({ kind: 'dev', moves: [mv('马二进三', -150), mv('车9平8', -160)], evBefore: -180, firstMover: 'r', ply0: 4, mainMove: '马八进七' });
    expect(s).toContain('没按套路走');
    expect(s).toContain('马八进七');
  });

  it('每一套布局的每一条变化都配得出小结，没有空话（都有"走到最后"）', () => {
    for (const o of OPENINGS) {
      for (const v of o.variations) {
        const s = lineSummary({ kind: v.kind ?? 'var', moves: v.moves, evBefore: v.at ? o.moves[v.at - 1].ev : 0, firstMover: v.at % 2 === 0 ? 'r' : 'b', ply0: v.at });
        expect(s, `${o.name} ${v.name}`).toContain('走到最后');
      }
    }
  });
});
