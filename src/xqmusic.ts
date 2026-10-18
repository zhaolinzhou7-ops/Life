/**
 * 象棋对局配乐的"演奏"部分：把 xqcompose.ts 作出来的音符用 Web Audio 现场合成（不用一个音频文件）。
 *
 * 每种乐器一个音色：箫和笛是吹管（正弦叠加 + 颤音 + 气声），古筝、琵琶、古琴、西域拨弦是拨弦（Karplus-Strong），
 * 马头琴是弓弦（锯齿波 + 共鸣峰 + 渐入的颤音 + 滑音），编钟、驼铃、木鱼是模态敲击（几个不成谐波的衰减正弦），
 * 鼓和马蹄是噪声 + 低频冲击。每一盘开局挑一种曲风、随机移调和速度，每 16 小节重写一段旋律。
 */
import { musicCore, outputLevel, startSong, stopBgm } from './gamesfx';
import { STYLES, composeCycle, newPiece, pickStyle, type NoteEv, type Piece, type StyleDef } from './xqcompose';

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const LAST_KEY = 'xq-bgm-last';

let piece: Piece | null = null;
let byStep = new Map<number, NoteEv[]>();
let stepDur = 0.4;
let looped = false;

function index(ev: NoteEv[]) {
  const m = new Map<number, NoteEv[]>();
  for (const e of ev) {
    const arr = m.get(e.step);
    if (arr) arr.push(e);
    else m.set(e.step, [e]);
  }
  byStep = m;
}

/**
 * 开一首：id 不给就随机挑一种（不和上一盘重复）。返回这一首是什么（显示"本盘配乐：草原 · 牧歌，D 宫调"用）。
 */
export function startXqMusic(id?: string): { style: StyleDef; key: string; bpm: number } | null {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch {
    // 隐私模式读不到也没关系
  }
  const style = (id && STYLES.find((s) => s.id === id)) || pickStyle(last, Math.random);
  try {
    localStorage.setItem(LAST_KEY, style.id);
  } catch {
    // 同上
  }
  piece = newPiece(style);
  index(composeCycle(piece));
  stepDur = 60 / piece.bpm / 2;
  looped = false;
  const p = piece;
  startSong({
    stepDur,
    steps: p.steps,
    play(step, when) {
      // 一轮放完：重写一轮（B 段每轮换，主题两轮一换）
      if (step === 0) {
        if (looped && piece === p) index(composeCycle(p));
        looped = true;
      }
      for (const e of byStep.get(step) ?? []) render(e, when);
    },
  });
  return { style, key: p.key, bpm: p.bpm };
}

/** 换下一种曲风（对局里点 🎵） */
export function nextXqMusic(): { style: StyleDef; key: string; bpm: number } | null {
  const i = piece ? STYLES.indexOf(piece.style) : -1;
  return startXqMusic(STYLES[(i + 1) % STYLES.length].id);
}

export function currentXqMusic(): { style: StyleDef; key: string; bpm: number } | null {
  return piece ? { style: piece.style, key: piece.key, bpm: piece.bpm } : null;
}

export function stopXqMusic() {
  stopBgm();
  piece = null;
}

// ───────────────────────── 音色 ─────────────────────────

type Core = NonNullable<ReturnType<typeof musicCore>>;

/** 拨弦缓存：同一个音高、同一种弦，留两份不同的随机激励轮着用（每个音现算太费手机） */
const ksCache = new Map<string, AudioBuffer[]>();
function ksBuffer(core: Core, freq: number, dur: number, damp: number, bright: number): AudioBuffer {
  const key = `${Math.round(freq * 4)}|${damp}|${bright}|${Math.round(dur * 4)}`;
  const got = ksCache.get(key);
  if (got && got.length >= 2) return got[Math.floor(Math.random() * got.length)];
  const c = core.c;
  const n = Math.max(2, Math.round(c.sampleRate / freq));
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(n);
  // 激励：亮的弦用白噪声，暗的弦先平滑一下（像用指肚拨）
  let prev = 0;
  for (let i = 0; i < n; i++) {
    const r = Math.random() * 2 - 1;
    prev = prev * (1 - bright) + r * bright;
    ring[i] = prev;
  }
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % n];
    ring[idx] = (cur + nxt) * 0.5 * damp;
    d[i] = cur;
    idx = (idx + 1) % n;
  }
  ksCache.set(key, [...(got ?? []), buf]);
  if (ksCache.size > 400) ksCache.delete(ksCache.keys().next().value!);
  return buf;
}

function pluckAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, damp = 0.997, bright = 0.9, slideFrom?: number) {
  const c = core.c;
  const src = c.createBufferSource();
  src.buffer = ksBuffer(core, freq, Math.min(4, dur), damp, bright);
  if (slideFrom) {
    // 吟猱 / 滑音：先从低一点的音起，再滑到正音
    src.playbackRate.setValueAtTime(slideFrom / freq, when);
    src.playbackRate.linearRampToValueAtTime(1, when + 0.14);
  }
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(core.outAt(pan));
  src.start(when);
}

/** 吹管：两路正弦微失谐 + 颤音 + 一点气声；bright 越大越像笛子 */
function windAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, bright: number) {
  const c = core.c;
  const g = c.createGain();
  const atk = bright > 0.5 ? 0.03 : 0.07;
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + atk);
  g.gain.setValueAtTime(vol, Math.max(when + atk, when + dur - 0.08));
  g.gain.linearRampToValueAtTime(0, when + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * (bright > 0.5 ? 5 : 3);
  const vib = c.createOscillator();
  vib.frequency.value = bright > 0.5 ? 5.8 : 5;
  const vibG = c.createGain();
  vibG.gain.setValueAtTime(0, when);
  vibG.gain.linearRampToValueAtTime(freq * 0.007, when + Math.min(0.4, dur * 0.5));
  vib.connect(vibG);
  const types: OscillatorType[] = bright > 0.5 ? ['triangle', 'sine'] : ['sine', 'sine'];
  types.forEach((t, i) => {
    const o = c.createOscillator();
    o.type = t;
    o.frequency.value = freq;
    o.detune.value = i ? 4 : 0;
    vibG.connect(o.frequency);
    o.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  });
  vib.start(when);
  vib.stop(when + dur + 0.05);
  // 气声：带通噪声，跟着音头出一下
  noiseAt(core, when, Math.min(0.25, dur), vol * (bright > 0.5 ? 0.12 : 0.2), 0, freq * 2, pan);
  lp.connect(g).connect(core.outAt(pan));
}

/** 马头琴：锯齿波过共鸣峰，慢起音，颤音晚一点才出来，可以从下方滑上来 */
function bowAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, slideFrom?: number) {
  const c = core.c;
  const o = c.createOscillator();
  o.type = 'sawtooth';
  if (slideFrom) {
    o.frequency.setValueAtTime(slideFrom, when);
    o.frequency.exponentialRampToValueAtTime(freq, when + 0.16);
  } else o.frequency.setValueAtTime(freq, when);
  const vib = c.createOscillator();
  vib.frequency.value = 5.4;
  const vibG = c.createGain();
  vibG.gain.setValueAtTime(0, when);
  vibG.gain.linearRampToValueAtTime(freq * 0.012, when + Math.min(0.6, dur * 0.7));
  vib.connect(vibG).connect(o.frequency);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = Math.min(3200, freq * 3.5);
  const body = c.createBiquadFilter();
  body.type = 'peaking';
  body.frequency.value = 850;
  body.Q.value = 1.2;
  body.gain.value = 5;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.12);
  g.gain.setValueAtTime(vol * 0.9, Math.max(when + 0.12, when + dur - 0.12));
  g.gain.linearRampToValueAtTime(0, when + dur);
  o.connect(lp).connect(body).connect(g).connect(core.outAt(pan));
  o.start(when);
  o.stop(when + dur + 0.05);
  vib.start(when);
  vib.stop(when + dur + 0.05);
}

/** 持续音（低音长鸣 / 笙）：几路失谐的三角波，慢进慢出 */
function padAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, cutoff: number) {
  const c = core.c;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + Math.min(1.2, dur * 0.3));
  g.gain.setValueAtTime(vol, Math.max(when + 0.1, when + dur * 0.7));
  g.gain.linearRampToValueAtTime(0, when + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = cutoff;
  for (const det of [-6, 0, 6]) {
    const o = c.createOscillator();
    o.type = 'triangle';
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
  lp.connect(g).connect(core.outAt(pan));
}

/** 模态敲击：[频率, 振幅, 衰减秒] */
function strikeAt(core: Core, when: number, partials: [number, number, number][], vol: number, pan: number) {
  const c = core.c;
  const dst = core.outAt(pan);
  const j = 1 + (Math.random() - 0.5) * 0.01;
  for (const [f, a, dec] of partials) {
    const o = c.createOscillator();
    o.frequency.value = f * j;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(a * vol, when + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
    o.connect(g).connect(dst);
    o.start(when);
    o.stop(when + dec + 0.02);
  }
}

function noiseAt(core: Core, when: number, dur: number, vol: number, hp: number, bp: number, pan: number) {
  const c = core.c;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (hp) {
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    node.connect(f);
    node = f;
  }
  if (bp) {
    const f = c.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = bp;
    f.Q.value = 1.4;
    node.connect(f);
    node = f;
  }
  const g = c.createGain();
  g.gain.value = vol;
  node.connect(g).connect(core.outAt(pan));
  src.start(when);
}

function thumpAt(core: Core, when: number, f0: number, f1: number, dec: number, vol: number, pan: number) {
  const c = core.c;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(f1, when + dec * 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dec);
  o.connect(g).connect(core.outAt(pan));
  o.start(when);
  o.stop(when + dec + 0.05);
}

const jitter = () => (Math.random() - 0.5) * 0.014;

/** 一个音符：按乐器出声 */
function render(e: NoteEv, when0: number) {
  const core = musicCore();
  if (!core) return;
  const when = Math.max(core.c.currentTime, when0 + (e.inst === 'hoof' || e.inst === 'hat' ? 0 : jitter()));
  const dur = e.len * stepDur;
  const f = e.midi !== undefined ? mtof(e.midi) : 0;
  const v = e.vol;
  const p = e.pan;
  switch (e.inst) {
    case 'xiao':
    case 'dizi': {
      const bright = e.inst === 'dizi' ? 0.8 : 0.2;
      let t = when;
      if (e.grace !== undefined) {
        windAt(core, mtof(e.grace), t, 0.07, v * 0.8, p, bright);
        t += 0.06;
      }
      windAt(core, f, t, Math.max(0.12, dur * 0.94 - (t - when)), v, p, bright);
      break;
    }
    case 'zheng':
      pluckAt(core, f, when, Math.max(1.2, dur * 1.6), v, p, 0.996, 0.85, e.slideFrom ? mtof(e.slideFrom) : undefined);
      break;
    case 'pipa': {
      // 长音用轮指撑住
      if (dur >= 0.55) {
        const n = Math.max(2, Math.round(dur / 0.07));
        for (let i = 0; i < n; i++) pluckAt(core, f, when + i * 0.07, 0.35, v * (i === 0 ? 1.3 : 0.7), p, 0.993, 0.95);
      } else pluckAt(core, f, when, 0.8, v, p, 0.994, 0.95);
      break;
    }
    case 'qin':
      pluckAt(core, f, when, Math.max(2, dur * 2), v * 1.1, p, 0.9985, 0.35, e.slideFrom ? mtof(e.slideFrom) : undefined);
      break;
    case 'oud':
      pluckAt(core, f, when, Math.max(0.9, dur * 1.3), v, p, 0.995, 1, e.slideFrom ? mtof(e.slideFrom) : undefined);
      break;
    case 'harm':
      strikeAt(core, when, [[f, 1, 2.6], [f * 2, 0.25, 1.4]], v, p);
      break;
    case 'morin':
      bowAt(core, f, when, Math.max(0.2, dur * 0.97), v * 0.9, p, e.slideFrom ? mtof(e.slideFrom) : undefined);
      break;
    case 'drone':
      padAt(core, f, when, dur, v, p, 700);
      break;
    case 'sheng':
      padAt(core, f, when, dur, v, p, 1800);
      break;
    case 'bell':
      // 编钟：一组不成谐波的分音，余音长
      strikeAt(core, when, [[f, 1, 3.4], [f * 2.76, 0.42, 2.1], [f * 5.4, 0.2, 1.1], [f * 8.93, 0.08, 0.5]], v * 1.1, p);
      break;
    case 'camel':
      // 驼铃：一摇响两三下
      for (let i = 0; i < 3; i++) strikeAt(core, when + i * 0.21 + Math.random() * 0.03, [[1320, 1, 0.9], [3480, 0.45, 0.5], [5200, 0.2, 0.3]], v * (1 - i * 0.25), p);
      break;
    case 'wood':
      strikeAt(core, when, [[820, 1, 0.09], [1490, 0.45, 0.05]], v, p);
      break;
    case 'hoof':
      thumpAt(core, when, 140, 70, 0.09, v, p);
      noiseAt(core, when, 0.04, v * 0.6, 0, 700, p);
      break;
    case 'drumLo':
      thumpAt(core, when, 110, 55, 0.28, v, p);
      break;
    case 'drumHi':
      noiseAt(core, when, 0.06, v, 0, 2600, p);
      thumpAt(core, when, 420, 300, 0.05, v * 0.5, p);
      break;
    case 'taiko':
      thumpAt(core, when, 150, 48, 0.42, v, p);
      noiseAt(core, when, 0.09, v * 0.3, 0, 260, p);
      break;
    case 'hat':
      noiseAt(core, when, 0.03, v, 7000, 0, p);
      break;
    case 'gliss':
      (e.run ?? []).forEach((m, i) => pluckAt(core, mtof(m), when + i * 0.045, 0.9, v * (0.7 + i * 0.06), p, 0.996, 0.85));
      break;
  }
}

// 开发期测试钩子：界面测试挨个放七种曲风，量输出电平（测试机听不见，只能量）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__xqMusic = {
    styles: () => STYLES.map((s) => s.id),
    start: (id?: string) => startXqMusic(id)?.style.id ?? null,
    current: () => currentXqMusic()?.style.id ?? null,
    level: () => outputLevel(),
  };
}
