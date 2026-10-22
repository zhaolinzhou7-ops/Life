/**
 * 象棋对局配乐的"演奏"部分：把 xqcompose.ts 作出来的音符用 Web Audio 现场合成（不用一个音频文件）。
 *
 * 每种乐器一个音色：箫和笛是吹管（几个谐波 + 起音时音高略低再到位 + 晚一点出来的颤音 + 气声，笛子多一层笛膜的沙），
 * 古筝、琵琶、古琴、西域拨弦是拨弦（Karplus-Strong），马头琴是弓弦（柔一点的锯齿谐波、两把弦微失谐、慢起音），
 * 编钟、驼铃、木鱼是模态敲击（几个不成谐波的衰减正弦），鼓和马蹄是噪声 + 低频冲击。
 *
 * 用户原话"音乐不够好听"之后加了一条**配乐总线**（第一版所有音直接进效果器总线，只有一点点小房间混响）：
 *   - 大厅混响（两秒多的尾巴，越往后越暗），每种曲风湿度不同——竹林、月夜最湿；
 *   - 主旋律送一路回声（附点四分，往后越来越暗），句尾长音底下有余韵；
 *   - 低切 + 压一点低频：第一版低音长鸣、手鼓的低频占了大漠 87%、竹林 64% 的能量，糊住了旋律；
 *   - 高频轻轻压一点，拨弦的"沙"不扎耳朵；
 *   - 每种曲风按实测响度拉齐（第一版最响和最轻差 13 dB）。
 * 实时和离线渲染（生成试听、测试量音色）走的是同一套音色和总线。
 */
import { musicCore, outputLevel, startSong, stopBgm } from './gamesfx';
import { STYLES, composeCycle, newPiece, pickStyle, type NoteEv, type Piece, type StyleDef } from './xqcompose';

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const LAST_KEY = 'xq-bgm-last';

/** 配乐整体电平（各曲风的 gain 在这上面乘） */
const MUSIC_LEVEL = 0.9;

/** 出声的地方：实时（对局里）或离线渲染（生成试听、测试） */
interface Core {
  c: BaseAudioContext;
  /** kind = lead 的另外送一路回声 */
  outAt: (pan: number, kind?: 'lead' | 'acc') => AudioNode;
}

// ───────────────────────── 配乐总线 ─────────────────────────

interface Bus {
  /** 干声入口 */
  dry: AudioNode;
  /** 回声入口（只给主旋律） */
  dly: AudioNode;
  out: GainNode;
}

const irCache = new WeakMap<BaseAudioContext, AudioBuffer>();

/** 大厅混响的脉冲响应：预延迟 + 几个早期反射 + 指数衰减的扩散尾，越往后越暗（高频被空气吃掉） */
function hallIR(c: BaseAudioContext): AudioBuffer {
  const got = irCache.get(c);
  if (got) return got;
  const sr = c.sampleRate;
  const rt = 2.6; // 衰减 60 dB 用的秒数
  const len = Math.floor(sr * 3);
  const pre = Math.floor(sr * 0.022);
  const buf = c.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sr;
      const env = Math.exp((-6.9 * t) / rt);
      // 一阶低通，系数随时间变大：尾巴越来越暗
      const a = 0.25 + 0.6 * Math.min(1, t / rt);
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] = lp * env * 1.6;
    }
    for (const [ms, amp] of [
      [11, 0.32],
      [19, 0.24],
      [29, 0.2],
      [41, 0.15],
      [57, 0.11],
    ]) {
      const i = pre + Math.floor((ms / 1000) * sr * (ch ? 1.09 : 1));
      if (i < len) d[i] += amp * (ch ? -1 : 1);
    }
  }
  irCache.set(c, buf);
  return buf;
}

function biquad(c: BaseAudioContext, type: BiquadFilterType, f: number, q = 0.7, gain = 0): BiquadFilterNode {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  b.gain.value = gain;
  return b;
}

/** 一首曲子的总线：EQ → 输出；EQ 之后送混响；主旋律另送回声（回声再进混响） */
function makeBus(c: BaseAudioContext, dest: AudioNode, style: StyleDef, stepDur: number): Bus {
  const dry = c.createGain();
  const hp = biquad(c, 'highpass', 75, 0.6);
  const lowShelf = biquad(c, 'lowshelf', 220, 0.7, -3);
  const highShelf = biquad(c, 'highshelf', 8000, 0.7, -1.5);
  const out = c.createGain();
  out.gain.value = MUSIC_LEVEL * style.gain;
  dry.connect(hp).connect(lowShelf).connect(highShelf).connect(out);
  out.connect(dest);

  const conv = c.createConvolver();
  conv.buffer = hallIR(c);
  const revSend = c.createGain();
  revSend.gain.value = style.wet;
  const revHp = biquad(c, 'highpass', 260, 0.6);
  highShelf.connect(revSend).connect(conv).connect(revHp).connect(out);

  // 回声：附点四分（三个八分），反馈 0.28，每过一遍更暗
  const dly = c.createGain();
  dly.gain.value = style.delay;
  const d = c.createDelay(3);
  d.delayTime.value = Math.min(2.5, stepDur * 3);
  const fb = c.createGain();
  fb.gain.value = 0.28;
  const dLp = biquad(c, 'lowpass', 2600, 0.5);
  dly.connect(d).connect(dLp).connect(fb).connect(d);
  dLp.connect(out);
  dLp.connect(revSend);
  return { dry, dly, out };
}

function coreOf(c: BaseAudioContext, bus: Bus): Core {
  return {
    c,
    outAt: (pan, kind) => {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(bus.dry);
      if (kind === 'lead') p.connect(bus.dly);
      return p;
    },
  };
}

// ───────────────────────── 实时播放 ─────────────────────────

let piece: Piece | null = null;
let byStep = new Map<number, NoteEv[]>();
let stepDur = 0.4;
let looped = false;
let live: { c: BaseAudioContext; bus: Bus; core: Core } | null = null;

function index(ev: NoteEv[]) {
  const m = new Map<number, NoteEv[]>();
  for (const e of ev) {
    const arr = m.get(e.step);
    if (arr) arr.push(e);
    else m.set(e.step, [e]);
  }
  byStep = m;
}

/** 换曲子：旧总线淡出再断开（还在响的余音不要一刀切断） */
function retireLive() {
  if (!live) return;
  const { c, bus } = live;
  bus.out.gain.setTargetAtTime(0, c.currentTime, 0.15);
  setTimeout(() => bus.out.disconnect(), 1500);
  live = null;
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
  retireLive();
  const mc = musicCore();
  if (mc) {
    const bus = makeBus(mc.c, mc.outAt(0), style, stepDur);
    live = { c: mc.c, bus, core: coreOf(mc.c, bus) };
  }
  startSong({
    stepDur,
    steps: p.steps,
    play(step, when) {
      // 一轮放完：重写一轮（B 段每轮换，主题两轮一换）
      if (step === 0) {
        if (looped && piece === p) index(composeCycle(p));
        looped = true;
      }
      if (live) for (const e of byStep.get(step) ?? []) render(live.core, e, when, stepDur);
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
  retireLive();
  piece = null;
}

// ───────────────────────── 音色 ─────────────────────────

/** 谐波表做成的波形（每个上下文、每种谐波表一份） */
const waveCache = new WeakMap<BaseAudioContext, Map<string, PeriodicWave>>();
function wave(c: BaseAudioContext, harmonics: number[]): PeriodicWave {
  let m = waveCache.get(c);
  if (!m) waveCache.set(c, (m = new Map()));
  const k = harmonics.join(',');
  let w = m.get(k);
  if (!w) {
    const real = new Float32Array(harmonics.length + 1);
    const imag = new Float32Array(harmonics.length + 1);
    harmonics.forEach((a, i) => (imag[i + 1] = a));
    w = c.createPeriodicWave(real, imag);
    m.set(k, w);
  }
  return w;
}

/** 一段循环用的白噪声（每个上下文一份；气声、笛膜、鼓皮从这里切） */
const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuf(c: BaseAudioContext): AudioBuffer {
  let b = noiseCache.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(c, b);
  }
  return b;
}

/** 拨弦缓存：同一个音高、同一种弦，留两份不同的随机激励轮着用（每个音现算太费手机） */
const ksCache = new Map<string, AudioBuffer[]>();
function ksBuffer(core: Core, freq: number, dur: number, damp: number, bright: number): AudioBuffer {
  const key = `${core.c.sampleRate}|${Math.round(freq * 4)}|${damp}|${bright}|${Math.round(dur * 4)}`;
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

function pluckAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, damp = 0.997, bright = 0.75, slideFrom?: number, kind?: 'lead' | 'acc') {
  const c = core.c;
  const src = c.createBufferSource();
  src.buffer = ksBuffer(core, freq, Math.min(4, dur), damp, bright);
  if (slideFrom) {
    // 吟猱 / 滑音：先从低一点的音起，再滑到正音
    src.playbackRate.setValueAtTime(slideFrom / freq, when);
    src.playbackRate.linearRampToValueAtTime(1, when + 0.14);
  }
  // 琴体：把激励带出来的最高那点沙去掉
  const body = biquad(c, 'lowpass', Math.min(10000, freq * 14), 0.5);
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(body).connect(g).connect(core.outAt(pan, kind));
  src.start(when);
}

/** 箫 / 笛 */
function windAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, dizi: boolean, kind?: 'lead' | 'acc') {
  const c = core.c;
  const end = when + dur;
  const atk = dizi ? 0.035 : 0.07;
  const rel = dizi ? 0.1 : 0.16;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + atk);
  // 长音中间略微鼓一下再收，像一口气
  if (dur > 0.6) g.gain.linearRampToValueAtTime(vol * 1.06, when + dur * 0.45);
  g.gain.linearRampToValueAtTime(vol * 0.92, Math.max(when + atk + 0.01, end - rel));
  g.gain.linearRampToValueAtTime(0, end);
  const lp = biquad(c, 'lowpass', Math.min(dizi ? 8000 : 5000, freq * (dizi ? 7 : 4)), 0.6);
  // 颤音：先直吹，三分之一秒以后才慢慢揉出来
  const vib = c.createOscillator();
  vib.frequency.value = dizi ? 5.8 : 5.0;
  const vibG = c.createGain();
  vibG.gain.setValueAtTime(0, when);
  vibG.gain.setValueAtTime(0, when + Math.min(0.3, dur * 0.4));
  vibG.gain.linearRampToValueAtTime(freq * (dizi ? 0.006 : 0.005), when + Math.min(0.75, dur * 0.8));
  vib.connect(vibG);
  const harm = dizi ? [1, 0.38, 0.2, 0.11, 0.05, 0.03] : [1, 0.14, 0.05, 0.02];
  [0, 4].forEach((det, i) => {
    const o = c.createOscillator();
    o.setPeriodicWave(wave(c, harm));
    // 起音时音高略低一点再到位（吹上去的那一下）
    o.frequency.setValueAtTime(freq * 0.988, when);
    o.frequency.linearRampToValueAtTime(freq, when + 0.07);
    o.detune.value = det;
    vibG.connect(o.frequency);
    const og = c.createGain();
    og.gain.value = i ? 0.35 : 0.75;
    o.connect(og).connect(lp);
    o.start(when);
    o.stop(end + 0.05);
  });
  vib.start(when);
  vib.stop(end + 0.05);
  lp.connect(g).connect(core.outAt(pan, kind));
  // 气声：音头一口，后面一直有一点点；笛子多一层笛膜的沙
  const n = c.createBufferSource();
  n.buffer = noiseBuf(c);
  n.loop = true;
  const nb = biquad(c, 'bandpass', dizi ? 3400 : Math.min(2600, freq * 2.2), dizi ? 2.5 : 1.2);
  const ng = c.createGain();
  const breath = vol * (dizi ? 0.09 : 0.16);
  ng.gain.setValueAtTime(0, when);
  ng.gain.linearRampToValueAtTime(breath * 2.2, when + 0.03);
  ng.gain.linearRampToValueAtTime(breath, when + 0.18);
  ng.gain.setValueAtTime(breath, Math.max(when + 0.19, end - rel));
  ng.gain.linearRampToValueAtTime(0, end);
  n.connect(nb).connect(ng).connect(core.outAt(pan, kind));
  n.start(when, Math.random() * 1.5);
  n.stop(end + 0.05);
}

/** 马头琴：两把微失谐的弓弦，谐波比锯齿波柔，慢起音，颤音晚一点才出来，可以从下方滑上来 */
function bowAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, slideFrom?: number, kind?: 'lead' | 'acc') {
  const c = core.c;
  const end = when + dur;
  const harm = Array.from({ length: 14 }, (_, i) => 1 / (i + 1) ** 1.35);
  const lp = biquad(c, 'lowpass', Math.min(2600, freq * 5), 0.5);
  const body = biquad(c, 'peaking', 1100, 1, 2);
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.16);
  if (dur > 0.8) g.gain.linearRampToValueAtTime(vol * 1.08, when + dur * 0.5);
  g.gain.linearRampToValueAtTime(vol * 0.9, Math.max(when + 0.17, end - 0.2));
  g.gain.linearRampToValueAtTime(0, end);
  const vib = c.createOscillator();
  vib.frequency.value = 5.3;
  const vibG = c.createGain();
  vibG.gain.setValueAtTime(0, when);
  vibG.gain.setValueAtTime(0, when + Math.min(0.35, dur * 0.4));
  vibG.gain.linearRampToValueAtTime(freq * 0.009, when + Math.min(0.9, dur * 0.85));
  vib.connect(vibG);
  for (const det of [-5, 5]) {
    const o = c.createOscillator();
    o.setPeriodicWave(wave(c, harm));
    if (slideFrom) {
      o.frequency.setValueAtTime(slideFrom, when);
      o.frequency.exponentialRampToValueAtTime(freq, when + 0.18);
    } else o.frequency.setValueAtTime(freq, when);
    o.detune.value = det;
    vibG.connect(o.frequency);
    const og = c.createGain();
    og.gain.value = 0.5;
    o.connect(og).connect(lp);
    o.start(when);
    o.stop(end + 0.05);
  }
  vib.start(when);
  vib.stop(end + 0.05);
  lp.connect(body).connect(g).connect(core.outAt(pan, kind));
}

/** 持续音（低音长鸣 / 笙）：几路微失谐的簧片音色，慢进慢出 */
function padAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, cutoff: number, reed: boolean) {
  const c = core.c;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + Math.min(1.4, dur * 0.3));
  g.gain.setValueAtTime(vol, Math.max(when + 0.1, when + dur * 0.7));
  g.gain.linearRampToValueAtTime(0, when + dur);
  const lp = biquad(c, 'lowpass', cutoff, 0.5);
  const harm = reed ? [1, 0.55, 0.35, 0.22, 0.13, 0.08] : [1, 0.12, 0.04];
  for (const det of [-6, 0, 6]) {
    const o = c.createOscillator();
    o.setPeriodicWave(wave(c, harm));
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
  lp.connect(g).connect(core.outAt(pan));
}

/** 模态敲击：[频率, 振幅, 衰减秒] */
function strikeAt(core: Core, when: number, partials: [number, number, number][], vol: number, pan: number, kind?: 'lead' | 'acc') {
  const c = core.c;
  const dst = core.outAt(pan, kind);
  const j = 1 + (Math.random() - 0.5) * 0.008;
  for (const [f, a, dec] of partials) {
    if (f > 16000) continue;
    const o = c.createOscillator();
    o.frequency.value = f * j;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(a * vol, when + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
    o.connect(g).connect(dst);
    o.start(when);
    o.stop(when + dec + 0.02);
  }
}

/** 一下噪声（马蹄、手鼓的皮声）：从循环噪声里切一段，带通 */
function noiseAt(core: Core, when: number, dur: number, vol: number, bp: number, q: number, pan: number) {
  const c = core.c;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  const f = biquad(c, 'bandpass', bp, q);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + dur);
  src.connect(f).connect(g).connect(core.outAt(pan));
  src.start(when, Math.random() * 1.5);
  src.stop(when + dur + 0.02);
}

function thumpAt(core: Core, when: number, f0: number, f1: number, dec: number, vol: number, pan: number) {
  const c = core.c;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(f0, when);
  o.frequency.exponentialRampToValueAtTime(f1, when + dec * 0.6);
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, when + dec);
  o.connect(g).connect(core.outAt(pan));
  o.start(when);
  o.stop(when + dec + 0.05);
}

const jitter = () => (Math.random() - 0.5) * 0.016;

/** 一个音符：按乐器出声 */
function render(core: Core, e: NoteEv, when0: number, stepDur: number) {
  const perc = e.inst === 'hoof' || e.inst === 'drumLo' || e.inst === 'drumHi' || e.inst === 'taiko';
  const when = Math.max(core.c.currentTime, when0 + (perc ? jitter() * 0.4 : jitter()));
  const dur = e.len * stepDur;
  const f = e.midi !== undefined ? mtof(e.midi) : 0;
  const v = e.vol;
  const p = e.pan;
  const kind = e.lead ? 'lead' : 'acc';
  switch (e.inst) {
    case 'xiao':
    case 'dizi': {
      const dizi = e.inst === 'dizi';
      let t = when;
      if (e.grace !== undefined) {
        windAt(core, mtof(e.grace), t, 0.085, v * 0.75, p, dizi, kind);
        t += 0.07;
      }
      // 吹管连着吹：每个音比时值略长一点点，和下一个音接上
      windAt(core, f, t, Math.max(0.14, dur * 1.02 - (t - when)), v, p, dizi, kind);
      break;
    }
    case 'zheng':
      pluckAt(core, f, when, Math.max(1.4, dur * 1.8), v, p, 0.9965, 0.7, e.slideFrom ? mtof(e.slideFrom) : undefined, kind);
      break;
    case 'pipa': {
      // 长音用轮指撑住（轮得轻一点）
      if (dur >= 0.7 && e.lead) {
        const n = Math.max(2, Math.round(dur / 0.08));
        for (let i = 0; i < n; i++) pluckAt(core, f, when + i * 0.08, 0.4, v * (i === 0 ? 1.2 : 0.55), p, 0.993, 0.8, undefined, kind);
      } else pluckAt(core, f, when, 1.0, v, p, 0.995, 0.8, undefined, kind);
      break;
    }
    case 'qin':
      // 拨弦当主旋律衰减得快，比吹管、弓弦显得轻：主旋律提一点
      pluckAt(core, f, when, Math.max(2.2, dur * 2), v * (e.lead ? 1.6 : 1.2), p, 0.9988, 0.35, e.slideFrom ? mtof(e.slideFrom) : undefined, kind);
      break;
    case 'oud':
      pluckAt(core, f, when, Math.max(1, dur * 1.4), v * (e.lead ? 1.5 : 1), p, 0.9955, 0.85, e.slideFrom ? mtof(e.slideFrom) : undefined, kind);
      break;
    case 'harm':
      strikeAt(core, when, [[f, 1, 2.8], [f * 2, 0.2, 1.4]], v, p, kind);
      break;
    case 'morin':
      bowAt(core, f, when, Math.max(0.25, dur * 1.0), v * 0.85, p, e.slideFrom ? mtof(e.slideFrom) : undefined, kind);
      break;
    case 'drone':
      padAt(core, f, when, dur, v, p, 500, false);
      break;
    case 'sheng':
      padAt(core, f, when, dur, v, p, 2000, true);
      break;
    case 'bell':
      // 编钟：一组不成谐波的分音，余音长；高分音收着一点，不刺
      strikeAt(core, when, [[f, 1, 3.6], [f * 2.76, 0.3, 2.0], [f * 5.4, 0.1, 0.9], [f * 8.93, 0.035, 0.4]], v * 1.1, p, kind);
      break;
    case 'camel':
      // 驼铃：一摇响两三下
      for (let i = 0; i < 3; i++) strikeAt(core, when + i * 0.22 + Math.random() * 0.03, [[1180, 1, 0.8], [3120, 0.3, 0.45], [4700, 0.1, 0.25]], v * (1 - i * 0.25), p);
      break;
    case 'wood':
      strikeAt(core, when, [[760, 1, 0.12], [1380, 0.35, 0.06]], v, p);
      break;
    case 'hoof':
      thumpAt(core, when, 210, 120, 0.08, v, p);
      noiseAt(core, when, 0.05, v * 0.35, 900, 1.5, p);
      break;
    case 'drumLo':
      thumpAt(core, when, 150, 90, 0.26, v, p);
      noiseAt(core, when, 0.04, v * 0.25, 600, 1, p);
      break;
    case 'drumHi':
      noiseAt(core, when, 0.07, v, 2200, 2, p);
      thumpAt(core, when, 380, 300, 0.06, v * 0.4, p);
      break;
    case 'taiko':
      thumpAt(core, when, 105, 52, 0.6, v, p);
      noiseAt(core, when, 0.1, v * 0.25, 300, 1, p);
      break;
    case 'gliss':
      (e.run ?? []).forEach((m, i) => pluckAt(core, mtof(m), when + i * 0.05, 1.0, v * (0.7 + i * 0.06), p, 0.996, 0.7));
      break;
  }
}

// ───────────────────────── 离线渲染 ─────────────────────────

/**
 * 离线渲染一段（seconds 秒）：不用实时播放，生成试听文件、量音色用。返回双声道采样。
 */
export async function renderXqMusic(id: string, seconds: number, seed?: number): Promise<{ sampleRate: number; l: Float32Array; r: Float32Array; key: string; bpm: number }> {
  const style = STYLES.find((s) => s.id === id) ?? STYLES[0];
  const sr = 44100;
  const c = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
  // 和实时一样过一道总线压缩
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.knee.value = 14;
  glue.ratio.value = 3;
  glue.attack.value = 0.005;
  glue.release.value = 0.18;
  glue.connect(c.destination);
  const pc = newPiece(style, seed);
  const sd = 60 / pc.bpm / 2;
  const core = coreOf(c, makeBus(c, glue, style, sd));
  for (let cyc = 0; cyc * pc.steps * sd < seconds; cyc++) {
    for (const e of composeCycle(pc)) {
      const t = 0.1 + (cyc * pc.steps + e.step) * sd;
      if (t < seconds - 0.2) render(core, e, t, sd);
    }
  }
  const buf = await c.startRendering();
  return { sampleRate: sr, l: buf.getChannelData(0), r: buf.getChannelData(1), key: pc.key, bpm: pc.bpm };
}

// 开发期测试钩子：界面测试挨个放七种曲风，量输出电平（测试机听不见，只能量）
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__xqMusic = {
    styles: () => STYLES.map((s) => s.id),
    start: (id?: string) => startXqMusic(id)?.style.id ?? null,
    current: () => currentXqMusic()?.style.id ?? null,
    level: () => outputLevel(),
    /** 离线渲染成 16 位 WAV（base64），生成试听用 */
    wav: async (id: string, seconds: number, seed?: number) => {
      const r = await renderXqMusic(id, seconds, seed);
      const n = r.l.length;
      const bytes = new Uint8Array(44 + n * 4);
      const dv = new DataView(bytes.buffer);
      const str = (o: number, t: string) => [...t].forEach((ch, i) => dv.setUint8(o + i, ch.charCodeAt(0)));
      str(0, 'RIFF');
      dv.setUint32(4, 36 + n * 4, true);
      str(8, 'WAVEfmt ');
      dv.setUint32(16, 16, true);
      dv.setUint16(20, 1, true);
      dv.setUint16(22, 2, true);
      dv.setUint32(24, r.sampleRate, true);
      dv.setUint32(28, r.sampleRate * 4, true);
      dv.setUint16(32, 4, true);
      dv.setUint16(34, 16, true);
      str(36, 'data');
      dv.setUint32(40, n * 4, true);
      for (let i = 0; i < n; i++) {
        dv.setInt16(44 + i * 4, Math.max(-1, Math.min(1, r.l[i])) * 32767, true);
        dv.setInt16(46 + i * 4, Math.max(-1, Math.min(1, r.r[i])) * 32767, true);
      }
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return { b64: btoa(bin), key: r.key, bpm: r.bpm };
    },
  };
}
