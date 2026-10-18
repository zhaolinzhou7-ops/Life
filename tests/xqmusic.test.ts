/**
 * 象棋对局配乐（作曲部分）。用户原话："对局音乐希望能丰富一点，不要每次都是那几种……
 * 比如山水的感觉、草原的感觉等……每次下棋的感觉都不一样。"
 */
import { describe, expect, it } from 'vitest';
import { STYLES, composeCycle, newPiece, pickStyle, rngOf } from '../src/xqcompose';

const pc = (m: number, tonic: number) => (((m - tonic) % 12) + 12) % 12;

describe('配乐：曲风', () => {
  it('七种曲风：山水、草原、江南、竹林、大漠、月夜、江湖，调式和乐器各不相同', () => {
    expect(STYLES.map((s) => s.name.split(' ')[0])).toEqual(['山水', '草原', '江南', '竹林', '大漠', '月夜', '江湖']);
    expect(new Set(STYLES.map((s) => s.lead)).size).toBeGreaterThanOrEqual(6);
    expect(new Set(STYLES.map((s) => s.mode.join(','))).size).toBeGreaterThanOrEqual(5);
    expect(STYLES.find((s) => s.id === 'caoyuan')!.stepsPerBar).toBe(6); // 草原是六八拍的跑马节奏
  });

  it('挑曲风不和上一盘重复，七种都挑得到', () => {
    const rng = rngOf(7);
    const seen = new Set<string>();
    let last: string | null = null;
    for (let i = 0; i < 200; i++) {
      const s = pickStyle(last, rng);
      expect(s.id).not.toBe(last);
      seen.add(s.id);
      last = s.id;
    }
    expect(seen.size).toBe(STYLES.length);
  });
});

describe('配乐：作曲', () => {
  for (const style of STYLES) {
    it(`${style.name}：旋律全在调式里、音域合理，问句之后落回主音`, () => {
      for (const seed of [1, 2, 3]) {
        const p = newPiece(style, seed);
        const ev = composeCycle(p);
        const lead = ev.filter((e) => e.lead && e.midi !== undefined);
        expect(lead.length).toBeGreaterThan(16);
        for (const e of lead) {
          expect(style.mode).toContain(pc(e.midi!, p.tonic));
          expect(e.midi!).toBeGreaterThanOrEqual(40);
          expect(e.midi!).toBeLessThanOrEqual(100);
        }
        for (const e of ev) {
          expect(e.step).toBeGreaterThanOrEqual(0);
          expect(e.step).toBeLessThan(p.steps);
        }
        // 第 8 小节、第 16 小节的最后一个旋律音落在主音上（答句、尾句收住）
        const spb = style.stepsPerBar;
        for (const end of [8 * spb, 16 * spb]) {
          const last = lead.filter((e) => e.step < end).pop()!;
          expect(pc(last.midi!, p.tonic)).toBe(0);
        }
      }
    });
  }

  it('同一种曲风，每盘的调高 / 速度 / 旋律都不一样', () => {
    const s = STYLES[0];
    const a = newPiece(s, 11);
    const b = newPiece(s, 12);
    const ma = composeCycle(a).filter((e) => e.lead).map((e) => e.midi);
    const mb = composeCycle(b).filter((e) => e.lead).map((e) => e.midi);
    expect(ma.join()).not.toBe(mb.join());
    const keys = new Set(Array.from({ length: 30 }, (_, i) => newPiece(s, 100 + i).key));
    expect(keys.size).toBeGreaterThan(2);
  });

  it('一轮放完重写：B 段每轮换；主题两轮一换', () => {
    const s = STYLES[2];
    const p = newPiece(s, 5);
    const c1 = composeCycle(p);
    const c2 = composeCycle(p);
    const c3 = composeCycle(p);
    const spb = s.stepsPerBar;
    const lead = (c: typeof c1, from: number, to: number) =>
      c.filter((e) => e.lead && e.step >= from * spb && e.step < to * spb).map((e) => `${e.step}:${e.midi}`).join();
    // 主题动机（第 1～2 小节）第二轮不变、第三轮换新
    expect(lead(c2, 0, 2)).toBe(lead(c1, 0, 2));
    expect(lead(c3, 0, 2)).not.toBe(lead(c1, 0, 2));
    // B 段（第 9～12 小节）每轮都重写
    expect(lead(c2, 8, 12)).not.toBe(lead(c1, 8, 12));
  });
});
