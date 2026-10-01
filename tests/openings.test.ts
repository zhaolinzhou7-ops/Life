/**
 * 布局体系：用户要的是"按正常谱路推演、多走几步"，不是两三步就完。
 * 这里锁死数据本身：要求的体系都在、每套走得够深、每一手合法、
 * 变化从主线分出去也走得通、每一手都有说明和评分。
 * 引擎层面的结论（谱上着法亏多少、延伸是不是首选）由 tools/build-openings.ts 生成时核对。
 */
import { describe, expect, it } from 'vitest';
import { OPENINGS, SYSTEM_ORDER, moveNote } from '../src/xiangqi/openings';
import { applyMove, initialBoard, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';

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

describe('布局体系', () => {
  it('用户点名的体系都在：过宫炮、士角炮、飞相局、巡河炮、屏风马、单提马，以及屏风马破急进中兵、牛头滚', () => {
    const names = OPENINGS.map((o) => `${o.system} ${o.name}`).join(' ');
    for (const n of ['过宫炮', '士角炮', '飞相', '巡河炮', '屏风马', '单提马', '急进中兵', '牛头滚']) expect(names, n).toContain(n);
  });

  it('每一套都归到一个体系，体系有固定的排列顺序', () => {
    for (const o of OPENINGS) expect(SYSTEM_ORDER, `${o.id} 的体系 ${o.system}`).toContain(o.system);
    expect(new Set(OPENINGS.map((o) => o.id)).size).toBe(OPENINGS.length);
  });

  it('主线走得够深：至少 12 个回合（24 手），不是两三步就完', () => {
    for (const o of OPENINGS) expect(o.moves.length, o.name).toBeGreaterThanOrEqual(24);
  });

  it('主线每一手都合法，前面是人写的定式、后面是引擎延伸', () => {
    for (const o of OPENINGS) {
      expect(typeof walk(o.moves.map((m) => m.t)), `${o.name}：${walk(o.moves.map((m) => m.t))}`).toBe('object');
      expect(o.moves[0].book, o.name).toBe(true);
      // 定式在前、延伸在后：book 标记不会在延伸之后又出现
      const firstEngine = o.moves.findIndex((m) => !m.book);
      expect(firstEngine, `${o.name} 没有引擎延伸`).toBeGreaterThan(0);
      expect(o.moves.slice(firstEngine).some((m) => m.book), o.name).toBe(false);
    }
  });

  it('变化从主线分出去也走得通，而且也走够深', () => {
    for (const o of OPENINGS) {
      for (const v of o.variations) {
        expect(v.at, `${o.name} · ${v.name}`).toBeGreaterThanOrEqual(1);
        expect(v.at, `${o.name} · ${v.name}`).toBeLessThan(o.moves.length);
        expect(v.moves.length, `${o.name} · ${v.name}`).toBeGreaterThanOrEqual(8);
        const r = walk([...o.moves.slice(0, v.at).map((m) => m.t), ...v.moves.map((m) => m.t)]);
        expect(typeof r, `${o.name} · ${v.name}：${r}`).toBe('object');
        // 变化的第一手和主线那一手不一样，不然就不是变化
        expect(v.moves[0].t, `${o.name} · ${v.name}`).not.toBe(o.moves[v.at].t);
      }
    }
  });

  it('每一手都有说明和局面分；收尾有一句局面判断', () => {
    for (const o of OPENINGS) {
      for (const m of [...o.moves, ...o.variations.flatMap((v) => v.moves)]) {
        expect(m.why.length, `${o.name} ${m.t}`).toBeGreaterThan(1);
        expect(Number.isFinite(m.ev), `${o.name} ${m.t}`).toBe(true);
      }
      expect(o.final, o.name).toMatch(/^走到这里：/);
      expect(o.final, o.name).not.toMatch(/(红方|黑方)均势/);
      expect(o.idea.length && o.breaks.length, o.name).toBeTruthy();
    }
  });

  it('谱上不被引擎认可的着法会标出来（江湖攻法的特征着），说明里带上引擎的意见', () => {
    const flagged = OPENINGS.flatMap((o) => o.moves.filter((m) => m.loss && m.best));
    for (const m of flagged) expect(moveNote(m)).toContain(m.best!);
  });

  it('主线不会一边倒：走完十几个回合，局面分在两个马炮以内（布局谱不是让子棋）', () => {
    for (const o of OPENINGS) expect(Math.abs(o.moves[o.moves.length - 1].ev), o.name).toBeLessThan(900);
  });
});
