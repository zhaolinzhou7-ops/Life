/**
 * 象棋对局配乐（作曲部分）。用户原话："对局音乐希望能丰富一点，不要每次都是那几种……
 * 比如山水的感觉、草原的感觉等……每次下棋的感觉都不一样。"后来又说："音乐不够好听。"
 */
import { describe, expect, it } from 'vitest';
import { STYLES, composeCycle, newPiece, pickStyle, rngOf, type NoteEv, type Piece } from '../src/xqcompose';

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

/** 一首曲子连写两轮，按句子分析主旋律 */
function lines(id: string, seeds = 24) {
  const st = STYLES.find((s) => s.id === id)!;
  const out: { p: Piece; ev: NoteEv[]; lead: NoteEv[]; deg: (m: number) => number }[] = [];
  for (let seed = 1; seed <= seeds; seed++) {
    const p = newPiece(st, seed);
    const n = st.mode.length;
    const deg = (m: number) => {
      const rel = m - p.tonic;
      return Math.floor(rel / 12) * n + st.mode.indexOf(((rel % 12) + 12) % 12);
    };
    for (let c = 0; c < 2; c++) {
      const ev = composeCycle(p);
      out.push({ p, ev, lead: ev.filter((e) => e.lead), deg });
    }
  }
  return out;
}

describe('配乐：好不好听的几条硬规矩（用户原话："音乐不够好听"）', () => {
  // 第一版的旋律是随机游走、每小节随便挑节奏：一句一句听着都对，连起来没有方向，记不住
  for (const st of STYLES) {
    it(`${st.name}：小步为主、跳进之后往回走、不连着三个同音、句尾级进收住`, () => {
      let moves = 0;
      let steps = 0;
      let leaps = 0;
      let fixed = 0;
      let cads = 0;
      let cadStep = 0;
      for (const { lead, deg } of lines(st.id)) {
        for (let i = 1; i < lead.length; i++) {
          const d = deg(lead[i].midi!) - deg(lead[i - 1].midi!);
          moves++;
          if (Math.abs(d) <= 1) steps++;
          if (i >= 2) {
            const d0 = deg(lead[i - 1].midi!) - deg(lead[i - 2].midi!);
            expect(d === 0 && d0 === 0, '连着三个同音').toBe(false);
            if (Math.abs(d0) >= 3) {
              leaps++;
              if (d === 0 || Math.sign(d) !== Math.sign(d0)) fixed++;
            }
          }
        }
        const spb = st.stepsPerBar;
        for (const end of [4, 8, 12, 16]) {
          const ns = lead.filter((e) => e.step < end * spb);
          cads++;
          if (Math.abs(deg(ns[ns.length - 1].midi!) - deg(ns[ns.length - 2].midi!)) <= 2) cadStep++;
          // 句尾是长音（至少三个八分），留得住
          expect(ns[ns.length - 1].len).toBeGreaterThanOrEqual(3);
        }
      }
      expect(steps / moves).toBeGreaterThan(0.72);
      expect(fixed / Math.max(1, leaps)).toBeGreaterThan(0.6);
      expect(cadStep / cads).toBeGreaterThan(0.95);
    });

    it(`${st.name}：小节头的旋律音和低音协和；主旋律和伴奏不打架`, () => {
      let strong = 0;
      let ok = 0;
      let overlap = 0;
      let clash = 0;
      for (const { ev, lead } of lines(st.id, 12)) {
        const spb = st.stepsPerBar;
        for (const e of lead) {
          if (e.step % spb !== 0) continue;
          const bar = Math.floor(e.step / spb);
          const bass = ev.filter((x) => !x.lead && !x.echo && x.midi !== undefined && Math.floor(x.step / spb) === bar).sort((a, b) => a.midi! - b.midi!)[0];
          if (!bass) continue;
          strong++;
          if ([0, 3, 4, 5, 7, 8, 9].includes((((e.midi! - bass.midi!) % 12) + 12) % 12)) ok++;
        }
        for (const e of lead)
          for (const x of ev) {
            if (x.lead || x.midi === undefined || !(x.step < e.step + e.len && e.step < x.step + x.len)) continue;
            overlap++;
            const iv = (((e.midi! - x.midi!) % 12) + 12) % 12;
            if (iv === 1 || iv === 11 || iv === 6) clash++;
          }
      }
      expect(ok / strong).toBeGreaterThan(0.8);
      // 五声调式里没有半音，一次都不该撞；西域调式的半音是它的味道，一带而过可以，但要少
      expect(clash / overlap).toBeLessThanOrEqual(st.mode.length === 5 ? 0 : 0.1);
    });
  }

  it('一句的第一、三小节节奏一样（节奏动机），A\' 原样重复动机，A\'\' 原样再现 A\'', () => {
    for (const st of STYLES) {
      const spb = st.stepsPerBar;
      const { lead } = lines(st.id, 1)[0];
      const rhythm = (bar: number) => lead.filter((e) => Math.floor(e.step / spb) === bar).map((e) => `${e.step - bar * spb}:${e.len}`).join();
      const notes = (from: number, to: number, shift: number) =>
        lead.filter((e) => e.step >= from * spb && e.step < to * spb).map((e) => `${e.step - shift * spb}:${e.midi}`).join();
      expect(rhythm(2), st.id).toBe(rhythm(0));
      expect(rhythm(10), st.id).toBe(rhythm(8));
      expect(notes(4, 6, 4), st.id).toBe(notes(0, 2, 0));
      expect(notes(12, 16, 12), st.id).toBe(notes(4, 8, 4));
    }
  });

  it('句尾拉长音时，伴奏把这句的尾巴应一遍（呼应）', () => {
    for (const st of STYLES) {
      const { ev } = lines(st.id, 1)[0];
      expect(ev.filter((e) => e.echo).length, st.id).toBeGreaterThan(0);
    }
  });

  it('下棋要想，背景音乐不能催人：都比第一版慢', () => {
    for (const st of STYLES) expect(st.bpm[1], st.id).toBeLessThanOrEqual(st.stepsPerBar === 6 ? 90 : 94);
  });
});
