/**
 * 布局变招大扩充（openingvars.json，tools/expand-openings.ts 生成，界面按需加载）。
 * 用户原话："多增加一些布局后的变招，每一步变招的意义讲清楚。"
 * 这里锁死数据：每套都有变招、每条变招从主线分得出去也走得通、每一手都讲了意义、
 * 变招和错着分得清（变招的第一手引擎不说它差，错着的第一手引擎说它亏），人写的定式说明不被覆盖。
 */
import { describe, expect, it } from 'vitest';
import data from '../src/xiangqi/openingvars.json';
import { OPENINGS, loadOpeningExtras, moveNote, type LineMove, type Variation } from '../src/xiangqi/openings';
import { applyMove, initialBoard, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';

type Extras = Record<string, { main: (LineMove | null)[]; vars: (LineMove | null)[][]; extra: Variation[] }>;
const X = data as unknown as Extras;

function walk(texts: string[]): { b: Board; c: Color } | string {
  let b = initialBoard();
  let c: Color = 'r';
  for (let i = 0; i < texts.length; i++) {
    const m = textToMove(b, c, texts[i], legalMoves(b, c));
    if (!m) return `第 ${i + 1} 手 ${texts[i]} 走不通`;
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return { b, c };
}

describe('布局变招大扩充', () => {
  it('二十套布局都有，每套至少 5 条变招', () => {
    for (const o of OPENINGS) {
      const d = X[o.id];
      expect(d, o.id).toBeTruthy();
      expect(d.main.length, o.id).toBe(o.moves.length);
      expect(d.vars.length, o.id).toBe(o.variations.length);
      expect(d.extra.filter((x) => x.kind === 'alt').length, o.name).toBeGreaterThanOrEqual(5);
    }
  });

  it('每条变招、错着从主线分得出去，往下每一手都合法，第一手和主线不同', () => {
    for (const o of OPENINGS) {
      for (const v of X[o.id].extra) {
        expect(['alt', 'trap'], v.name).toContain(v.kind);
        expect(v.at, v.name).toBeGreaterThanOrEqual(1);
        expect(v.at, v.name).toBeLessThan(o.moves.length);
        expect(v.moves.length, `${o.name} · ${v.name}`).toBeGreaterThanOrEqual(v.kind === 'alt' ? 8 : 4);
        const r = walk([...o.moves.slice(0, v.at).map((m) => m.t), ...v.moves.map((m) => m.t)]);
        expect(typeof r, `${o.name} · ${v.name}：${r}`).toBe('object');
        expect(v.moves[0].t, `${o.name} · ${v.name}`).not.toBe(o.moves[v.at].t);
        expect(v.name, v.name).toContain(v.moves[0].t);
        expect(v.final, v.name).toMatch(/^走到这里：/);
      }
    }
  });

  it('每一手都讲了意义：干了什么之外，至少有一半的手说了防什么、攻什么或引擎怎么看', () => {
    let deep = 0;
    let all = 0;
    for (const o of OPENINGS) {
      for (const m of [...X[o.id].extra.flatMap((v) => v.moves), ...X[o.id].main.filter(Boolean)] as LineMove[]) {
        expect(m.why.length, `${o.name} ${m.t}`).toBeGreaterThanOrEqual(3); // 最短的是"兑马。""吃掉车。"这种，吃子兑子本身就是意义
        expect(m.why, `${o.name} ${m.t}`).toMatch(/。$/);
        expect(Number.isFinite(m.ev), `${o.name} ${m.t}`).toBe(true);
        all++;
        if (/目的：|接下来|引擎/.test(m.why)) deep++;
      }
    }
    expect(deep / all).toBeGreaterThan(0.5);
  });

  it('变招和错着分得清：变招的第一手引擎不说它差，错着的第一手引擎说出该走什么', () => {
    for (const o of OPENINGS) {
      for (const v of X[o.id].extra) {
        if (v.kind === 'alt') expect(v.moves[0].why, `${o.name} · ${v.name}`).not.toContain('引擎更想走');
        else {
          expect(v.moves[0].why, `${o.name} · ${v.name}`).toContain('引擎更想走');
          expect(v.name).toContain('错着');
        }
      }
    }
  });

  it('讲解里的措辞没有"捉住卒和卒""捉住马、卒、卒"、退回来的马不叫盘头马、引擎的意见不重复挂', () => {
    for (const o of OPENINGS) {
      for (const m of [...X[o.id].extra.flatMap((v) => v.moves), ...(X[o.id].main.filter(Boolean) as LineMove[])]) {
        expect(m.why).not.toMatch(/捉住([车马炮兵卒])和\1/);
        for (const [, list] of m.why.matchAll(/同时捉住([^，。（]+)/g)) {
          const names = list.split(/、|和/).map((x) => x.replace(/^[两三四五]个/, ''));
          expect(new Set(names).size, `${o.name} ${m.t}：${list}`).toBe(names.length);
        }
        if (m.t.includes('退')) expect(m.why).not.toMatch(/^盘头马/);
        expect(m.loss, `${o.name} ${m.t}`).toBeUndefined();
      }
    }
  });

  it('加载以后：变化多了，人写的定式说明一字不改，换了讲解的手不再重复挂引擎意见', async () => {
    const before = OPENINGS.map((o) => ({ n: o.variations.length, book: o.moves.filter((m) => m.book).map((m) => m.why) }));
    await loadOpeningExtras();
    OPENINGS.forEach((o, i) => {
      expect(o.variations.length, o.id).toBeGreaterThan(before[i].n);
      expect(o.moves.filter((m) => m.book).map((m) => m.why), o.id).toEqual(before[i].book);
      o.moves.forEach((m, k) => {
        if (X[o.id].main[k] && !m.book) {
          expect(m.why).toBe(X[o.id].main[k]!.why);
          expect(moveNote(m)).toBe(m.why);
        }
      });
    });
    // 再加载一次不会重复加
    const n = OPENINGS.map((o) => o.variations.length);
    await loadOpeningExtras();
    expect(OPENINGS.map((o) => o.variations.length)).toEqual(n);
  });
});
