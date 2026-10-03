/**
 * 江湖布局的变化（trickvars.json，tools/expand-tricks.ts 生成，界面按需加载）。
 * 用户原话："再增加详细教练讲解，江湖布局多一些变化。"
 * 锁死数据：每条套路都有变化、从破解谱分得出去每一手都合法、每一手都讲了意义、三种变化分得清，
 * 破解谱/上当谱里引擎延伸的那几手换成了讲意义的说明，人写的不动。
 */
import { describe, expect, it } from 'vitest';
import data from '../src/xiangqi/trickvars.json';
import { TRICKS, lineEvs, loadTrickExtras, refuteLine, trapLine, trickVars, walkMoves, type TrickVar } from '../src/xiangqi/tricks';
import { keyMove } from '../src/xiangqi/coachnote';

type X = Record<string, { refuteWhy: (string | null)[]; trapWhy: (string | null)[]; vars: TrickVar[] }>;
const D = data as unknown as X;

describe('江湖布局的变化', () => {
  it('每条套路都有：他不按套路走至少 3 条，加上另一种破法、你走错了一共至少 8 条', () => {
    for (const t of TRICKS) {
      const vs = D[t.id]?.vars ?? [];
      expect(vs.filter((v) => v.kind === 'dev').length, t.name).toBeGreaterThanOrEqual(3);
      expect(vs.length, t.name).toBeGreaterThanOrEqual(8);
    }
  });

  it('从破解谱分得出去，往下每一手都合法；第一手和谱上那一手不一样', () => {
    for (const t of TRICKS) {
      const R = refuteLine(t);
      for (const v of D[t.id].vars) {
        expect(['dev', 'alt', 'wrong'], v.name).toContain(v.kind);
        expect(v.at, v.name).toBeLessThan(R.length);
        const line = [...t.pre, t.trick.t, ...R.slice(0, v.at).map((s) => s.t), ...v.moves.map((m) => m.t)];
        expect(walkMoves(line), `${t.name} · ${v.name}`).not.toBeNull();
        expect(v.moves[0].t, v.name).not.toBe(R[v.at].t);
        expect(v.name, v.name).toContain(v.moves[0].t);
        expect(v.final, v.name).toMatch(/^走到这里：/);
        // 谁走那一手：他改走的是设套方，另一种破法、你走错了的是破解方
        const mover = (t.pre.length + 1 + v.at) % 2 === 0 ? 'r' : 'b';
        expect(mover === t.by, `${t.name} · ${v.name}`).toBe(v.kind === 'dev');
      }
    }
  });

  it('每一手都讲了意义，多数手说了目的、引擎意见或接下来怎么走', () => {
    let all = 0;
    let rich = 0;
    for (const t of TRICKS) {
      for (const v of D[t.id].vars) {
        for (const m of v.moves) {
          expect(m.why.length, `${t.name} ${v.name} ${m.t}`).toBeGreaterThanOrEqual(3);
          expect(Number.isFinite(m.ev)).toBe(true);
          expect(m.why).not.toMatch(/捉住([车马炮兵卒])和\1/);
          all++;
          if (/目的：|接下来|引擎/.test(m.why)) rich++;
        }
      }
    }
    expect(rich / all).toBeGreaterThan(0.4);
  });

  it('另一种破法的第一手引擎不说它差；你走错了的第一手（人写的常见错着除外）引擎说出该走什么', () => {
    for (const t of TRICKS) {
      for (const v of D[t.id].vars) {
        if (v.kind === 'alt') expect(v.moves[0].why, v.name).not.toContain('引擎更想走');
        if (v.kind === 'wrong' && !v.note) expect(v.moves[0].why, v.name).toContain('引擎更想走');
      }
    }
  });

  it('加载以后：破解谱、上当谱里引擎延伸的那几手换了新讲解，人写的一字不改', async () => {
    const before = TRICKS.map((t) => ({ r: refuteLine(t).map((s) => s.why), tr: trapLine(t).map((s) => s.why) }));
    await loadTrickExtras();
    TRICKS.forEach((t, i) => {
      const R = refuteLine(t);
      R.forEach((s, k) => {
        if (k < t.refute.length) expect(s.why).toBe(before[i].r[k]);
        else if (D[t.id].refuteWhy[k]) expect(s.why).toBe(D[t.id].refuteWhy[k]);
      });
      trapLine(t).forEach((s, k) => {
        if (k < t.trap.length) expect(s.why).toBe(before[i].tr[k]);
      });
      expect(trickVars(t.id).length).toBe(D[t.id].vars.length);
    });
  });

  it('上当谱上找得出"关键一手"（邪门着之后局面变化最大的那一手，多半就是上当的那一手）', () => {
    let found = 0;
    for (const t of TRICKS) {
      const evs = lineEvs(t, 'trap');
      const from = t.pre.length + 1;
      if (keyMove(evs.slice(from).map((ev) => ({ ev })), evs[from - 1], t.by === 'r' ? 'b' : 'r')) found++;
    }
    expect(found).toBeGreaterThanOrEqual(8);
  });
});
