/**
 * 象棋对局配乐（作曲部分）。用户三次的原话：
 *   "对局音乐希望能丰富一点，不要每次都是那几种……每次下棋的感觉都不一样。"
 *   "音乐不够好听。"
 *   "有点太单调了，而且没有那种琴棋书画的意境……有杀伐果断的音乐，也有横扫千军的……刚开始、胶着、或者快结束的时候，
 *    分别都是不一样的。层次得丰富一些。另外，人的声音也很傻。"
 */
import { describe, expect, it } from 'vitest';
import { MOODS, PALETTES, composePhrase, moodFor, newScore, pickPalette, rngOf, stinger, type Mood, type MusicCtx, type NoteEv } from '../src/xqcompose';
import { CHARACTERS } from '../src/characters';

const MOOD_IDS = Object.keys(MOODS) as Mood[];
const ctx = (x: Partial<MusicCtx>): MusicCtx => ({ plies: 30, material: 0.7, evalMe: 50, checks: 0, bigCaptures: 0, danger: false, quiet: 2, ...x });

describe('配乐跟着棋局走：局势 → 情绪', () => {
  it('开局静、中局行云流水、胶着、攻杀、占优、劣势、残局，各对得上', () => {
    expect(moodFor(ctx({ plies: 4, material: 1, evalMe: null })).mood).toBe('serene');
    expect(moodFor(ctx({ plies: 22, material: 0.8, evalMe: 60, quiet: 3 })).mood).toBe('flow');
    expect(moodFor(ctx({ plies: 40, material: 0.7, evalMe: 30, quiet: 14 })).mood).toBe('tense');
    expect(moodFor(ctx({ checks: 1 })).mood).toBe('battle');
    expect(moodFor(ctx({ bigCaptures: 2 })).mood).toBe('battle'); // 兑子
    expect(moodFor(ctx({ bigCaptures: 1 })).mood).toBe('flow'); // 只吃一个子：中局里的常事，不打鼓
    expect(moodFor(ctx({ checks: 2, evalMe: 900 })).mood).toBe('triumph'); // 大优还在将军：横扫千军
    expect(moodFor(ctx({ danger: true, evalMe: 900 })).mood).toBe('battle'); // 大优但被将：还是杀
    expect(moodFor(ctx({ danger: true })).mood).toBe('battle');
    expect(moodFor(ctx({ evalMe: 800 })).mood).toBe('triumph');
    expect(moodFor(ctx({ evalMe: -800 })).mood).toBe('peril');
    expect(moodFor(ctx({ plies: 90, material: 0.25, evalMe: 100 })).mood).toBe('endgame');
    expect(moodFor(ctx({ over: true, checks: 3 })).mood).toBe('serene');
  });

  it('越紧越响：将军、吃子、被杀叠在一起，攻杀的强度更高；胶着越久越紧', () => {
    const one = moodFor(ctx({ checks: 1 })).intensity;
    const many = moodFor(ctx({ checks: 2, bigCaptures: 2, danger: true })).intensity;
    expect(many).toBeGreaterThan(one);
    expect(moodFor(ctx({ plies: 60, quiet: 30, evalMe: 0 })).intensity).toBeGreaterThan(moodFor(ctx({ plies: 60, quiet: 9, evalMe: 0 })).intensity);
    for (const c of [ctx({}), ctx({ checks: 4, bigCaptures: 4, danger: true }), ctx({ evalMe: 9000 })]) {
      const i = moodFor(c).intensity;
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(1);
    }
  });

  it('攻杀快、劣势和残局慢：七种情绪速度不一样', () => {
    expect(MOODS.battle.tempo).toBeGreaterThan(MOODS.flow.tempo);
    expect(MOODS.triumph.tempo).toBeGreaterThan(MOODS.flow.tempo);
    expect(MOODS.peril.tempo).toBeLessThan(MOODS.flow.tempo);
    expect(MOODS.endgame.tempo).toBeLessThan(MOODS.flow.tempo);
    expect(MOODS.serene.amb).toBeGreaterThan(MOODS.battle.amb); // 安静的段落才有溪水鸟鸣
  });
});

describe('四种乐队，乐器丰富、轮流对答', () => {
  it('高山流水、江南丝竹、禅院松风、塞上曲；每种都有自然声；挑乐队不和上一盘重复', () => {
    expect(PALETTES.map((p) => p.name)).toEqual(['高山流水', '江南丝竹', '禅院松风', '塞上曲']);
    for (const p of PALETTES) expect(p.amb.stream + p.amb.wind + p.amb.rain + p.amb.birds).toBeGreaterThan(0.5);
    const rng = rngOf(3);
    let last: string | null = null;
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const p = pickPalette(last, rng);
      expect(p.id).not.toBe(last);
      seen.add(p.id);
      last = p.id;
    }
    expect(seen.size).toBe(PALETTES.length);
  });

  it('一盘棋里用到的乐器至少八种（不是"只有一种乐器"）', () => {
    for (const p of PALETTES) {
      const sc = newScore(p, 9);
      const used = new Set<string>();
      for (const m of MOOD_IDS) for (let k = 0; k < 4; k++) for (const e of composePhrase(sc, m, 0.8).notes) used.add(e.inst);
      expect(used.size, p.name).toBeGreaterThanOrEqual(8);
    }
  });

  it('主旋律一句一换乐器（古琴一句、箫接一句）', () => {
    const sc = newScore(PALETTES[0], 5);
    const leads = Array.from({ length: 4 }, () => composePhrase(sc, 'serene', 0.4).lead);
    expect(new Set(leads).size).toBe(2);
    expect(leads[0]).not.toBe(leads[1]);
  });

  it('同一种情绪里分层：强度越高，伴奏声部越多', () => {
    for (const m of ['flow', 'tense', 'battle'] as Mood[]) {
      const lo = composePhrase(newScore(PALETTES[1], 4), m, 0.1).notes.filter((e) => !e.lead).length;
      const hi = composePhrase(newScore(PALETTES[1], 4), m, 0.95).notes.filter((e) => !e.lead).length;
      expect(hi, m).toBeGreaterThan(lo);
    }
  });

  it('攻杀有扫弦和战鼓，占优有大鼓和古筝跑动，胶着有摇指和心跳鼓，开局和残局没有鼓', () => {
    const insts = (m: Mood) => new Set(composePhrase(newScore(PALETTES[0], 2), m, 0.8).notes.map((e) => e.inst));
    expect(insts('battle').has('saofu')).toBe(true);
    expect(insts('battle').has('dagu')).toBe(true);
    expect(insts('triumph').has('dagu')).toBe(true);
    expect(insts('tense').has('trem')).toBe(true);
    expect(insts('tense').has('tanggu')).toBe(true);
    for (const m of ['serene', 'endgame'] as Mood[]) for (const d of ['dagu', 'tanggu', 'bo']) expect(insts(m).has(d as never), `${m} ${d}`).toBe(false);
  });

  it('每种情绪有自己的主题：A\' 原样重复 A 的动机；离开再回来，主题再现', () => {
    const sc = newScore(PALETTES[2], 8);
    const motif = (ns: NoteEv[]) => ns.filter((e) => e.lead && e.step < 16).map((e) => `${e.step}:${e.midi! % 12}`).join();
    const a = composePhrase(sc, 'flow', 0.5);
    const a2 = composePhrase(sc, 'flow', 0.5);
    expect(motif(a2.notes)).toBe(motif(a.notes));
    composePhrase(sc, 'battle', 0.8);
    const back = composePhrase(sc, 'flow', 0.5);
    expect(motif(back.notes)).toBe(motif(a.notes));
  });
});

describe('配乐：好不好听的几条硬规矩', () => {
  for (const p of PALETTES)
    for (const m of MOOD_IDS) {
      it(`${p.name} · ${MOODS[m].name}：小步为主、不三连同音、句尾级进收住、强拍协和、主旋律和伴奏不撞半音`, () => {
        let moves = 0;
        let steps = 0;
        let cads = 0;
        let cadStep = 0;
        let strong = 0;
        let ok = 0;
        for (let seed = 1; seed <= 10; seed++) {
          const sc = newScore(p, seed);
          const mode = p.modes[m];
          const n = mode.length;
          const deg = (x: number) => {
            const rel = x - sc.tonic;
            return Math.floor(rel / 12) * n + mode.indexOf(((rel % 12) + 12) % 12);
          };
          for (let k = 0; k < 4; k++) {
            const ph = composePhrase(sc, m, 0.7);
            const lead = ph.notes.filter((e) => e.lead);
            for (const e of lead) {
              expect(mode).toContain((((e.midi! - sc.tonic) % 12) + 12) % 12);
              expect(e.midi!).toBeGreaterThanOrEqual(40);
              expect(e.midi!).toBeLessThanOrEqual(100);
            }
            for (let i = 1; i < lead.length; i++) {
              const d = deg(lead[i].midi!) - deg(lead[i - 1].midi!);
              moves++;
              if (Math.abs(d) <= 1) steps++;
              if (i >= 2) expect(d === 0 && deg(lead[i - 1].midi!) === deg(lead[i - 2].midi!), '三连同音').toBe(false);
            }
            cads++;
            if (Math.abs(deg(lead[lead.length - 1].midi!) - deg(lead[lead.length - 2].midi!)) <= 2) cadStep++;
            expect(lead[lead.length - 1].len).toBeGreaterThanOrEqual(3); // 句尾是长音
            for (const e of lead) {
              if (e.step % 8) continue;
              const bar = Math.floor(e.step / 8);
              const bass = ph.notes.filter((x) => !x.lead && !x.echo && !x.second && x.midi !== undefined && Math.floor(x.step / 8) === bar).sort((a, b) => a.midi! - b.midi!)[0];
              if (!bass) continue;
              strong++;
              if ([0, 3, 4, 5, 7, 8, 9].includes((((e.midi! - bass.midi!) % 12) + 12) % 12)) ok++;
            }
            for (const e of lead)
              for (const x of ph.notes) {
                if (x.lead || x.midi === undefined || !(x.step < e.step + e.len && e.step < x.step + x.len)) continue;
                const iv = (((e.midi! - x.midi!) % 12) + 12) % 12;
                expect(iv === 1 || iv === 11 || iv === 6, '半音、三全音').toBe(false);
              }
          }
        }
        expect(steps / moves).toBeGreaterThan(0.75);
        expect(cadStep / cads).toBeGreaterThan(0.9);
        expect(ok / Math.max(1, strong)).toBeGreaterThan(0.85);
      });
    }
});

describe('点缀、台词', () => {
  it('将军、吃大子、赢、输、和都有一句点缀；将军是战鼓加锣', () => {
    const sc = newScore(PALETTES[0], 1);
    for (const k of ['check', 'capture', 'win', 'loss', 'draw'] as const) expect(stinger(sc, k).length, k).toBeGreaterThan(0);
    const check = new Set(stinger(sc, 'check').map((e) => e.inst));
    expect(check.has('dagu') && check.has('gong')).toBe(true);
  });

  it('象棋里的台词是下棋的话，不是麻将的（用户原话："人的声音也很傻"）', () => {
    for (const ch of CHARACTERS) {
      const all = Object.values(ch.xq).flat();
      expect(all.length).toBeGreaterThanOrEqual(12);
      for (const line of all) expect(line, ch.name).not.toMatch(/[碰杠胡牌张钱]/);
    }
  });
});
