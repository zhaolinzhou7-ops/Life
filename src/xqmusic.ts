/**
 * 象棋对局配乐的"演奏"部分：把 xqcompose.ts 作出来的句子用 Web Audio 现场合成（不用一个音频文件），
 * 并且**跟着棋局走**：对局每走一步把局势告诉这里（setXqMusicState），一句唱完挑下一句的情绪；
 * 将军、吃大子、终局当场来一下点缀（xqStinger / xqMusicEnd）。
 *
 * 乐器：箫和笛是吹管（几个谐波 + 起音时音高略低再到位 + 晚一点出来的颤音 + 气声，笛子多一层笛膜的沙），
 * 古筝、琵琶、古琴是拨弦（Karplus-Strong；扫弦是几根弦错开一点拨，摇指是一个音上快速反复），
 * 二胡、马头琴是弓弦（二胡鼻音重、揉弦深、滑音多），笙和低音长鸣是簧片铺底，
 * 编钟、磬、木鱼、锣、钹是模态敲击（几个不成谐波的衰减正弦），堂鼓、大鼓是低频冲击 + 鼓皮的噪声。
 *
 * 自然声（安静的段落才有，越紧张越淡出去）：溪水（两层带通噪声慢慢起伏 + 一个个"咕嘟"的小气泡）、
 * 松风（带通噪声，中心频率和音量慢慢漂）、细雨（高通噪声 + 稀疏的雨滴）、鸟鸣（几声啾啾、几声颤音）。
 *
 * 配乐总线：大厅混响（两秒半的尾巴，越往后越暗）+ 主旋律附点四分的回声 + 低切、低频压一点、高频略压；
 * 混响和回声的多少跟着情绪变（攻杀干一点、利一点，开局和残局湿一点、远一点）。
 * 实时和离线渲染（生成试听、测试量音色）走的是同一套音色、自然声和总线。
 */
import { isMuted, musicCore, outputLevel, startSong, stopBgm, type Song } from './gamesfx';
import { MOODS, PALETTES, SPB, composePhrase, moodFor, newScore, pickPalette, stinger, type Mood, type MusicCtx, type NoteEv, type Palette, type Phrase, type Score, type StingerKind } from './xqcompose';

const mtof = (m: number) => 440 * 2 ** ((m - 69) / 12);
const LAST_KEY = 'xq-bgm-last';

/** 配乐整体电平（各乐队的 gain 在这上面乘） */
const MUSIC_LEVEL = 0.9;
/**
 * 各情绪的电平：按离线渲染量出来的短时响度（400 毫秒窗的 90 分位）定。
 * 开局、中局、胶着、劣势、残局拉到差不多一样响（约 −21 dB），攻杀、占优比它们响三个分贝上下——杀伐、横扫千军本来就该满一点。
 */
const MOOD_GAIN: Record<Mood, number> = { serene: 1.15, flow: 1.12, tense: 1.35, battle: 1.65, triumph: 1.55, peril: 1.25, endgame: 1.2 };
/** 自然声各层的电平（乘乐队的自然声配比和情绪的自然声多少） */
const AMB_LEVEL = { stream: 0.03, wind: 0.045, rain: 0.018 };

/** 出声的地方：实时（对局里）或离线渲染（生成试听、测试） */
interface Core {
  c: BaseAudioContext;
  /** kind = lead 的另外送一路回声 */
  outAt: (pan: number, kind?: 'lead' | 'acc') => AudioNode;
}

// ───────────────────────── 配乐总线 ─────────────────────────

interface Bus {
  dry: AudioNode;
  dly: GainNode;
  delay: DelayNode;
  rev: GainNode;
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

/** 总线：EQ → 输出；EQ 之后送混响；主旋律另送回声（回声再进混响） */
function makeBus(c: BaseAudioContext, dest: AudioNode, palette: Palette): Bus {
  const dry = c.createGain();
  const hp = biquad(c, 'highpass', 75, 0.6);
  const lowShelf = biquad(c, 'lowshelf', 220, 0.7, -3);
  const highShelf = biquad(c, 'highshelf', 8000, 0.7, -1.5);
  const out = c.createGain();
  out.gain.value = MUSIC_LEVEL * palette.gain;
  dry.connect(hp).connect(lowShelf).connect(highShelf).connect(out);
  out.connect(dest);

  const conv = c.createConvolver();
  conv.buffer = hallIR(c);
  const rev = c.createGain();
  rev.gain.value = 0.4;
  const revHp = biquad(c, 'highpass', 260, 0.6);
  highShelf.connect(rev).connect(conv).connect(revHp).connect(out);

  // 回声：附点四分（三个八分），反馈 0.28，每过一遍更暗
  const dly = c.createGain();
  dly.gain.value = 0.15;
  const delay = c.createDelay(3);
  delay.delayTime.value = 1.2;
  const fb = c.createGain();
  fb.gain.value = 0.28;
  const dLp = biquad(c, 'lowpass', 2600, 0.5);
  dly.connect(delay).connect(dLp).connect(fb).connect(delay);
  dLp.connect(out);
  dLp.connect(rev);
  return { dry, dly, delay, rev, out };
}

/** 换情绪：混响、回声、电平慢慢过去（一两秒），不要一下子变 */
function busMood(bus: Bus, mood: Mood, palette: Palette, stepDur: number, when: number) {
  const def = MOODS[mood];
  bus.rev.gain.setTargetAtTime(def.wet, when, 1.2);
  bus.dly.gain.setTargetAtTime(def.delay, when, 1.2);
  bus.delay.delayTime.setTargetAtTime(Math.min(2.5, stepDur * 3), when, 0.5);
  bus.out.gain.setTargetAtTime(MUSIC_LEVEL * palette.gain * MOOD_GAIN[mood], when, 1.5);
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

// ───────────────────────── 自然声 ─────────────────────────

/** 溪水、松风、细雨三层底子（循环噪声过滤波器，音量慢慢起伏），加上随机的气泡、雨滴、鸟鸣 */
class Ambience {
  private srcs: AudioBufferSourceNode[] = [];
  private lfos: OscillatorNode[] = [];
  readonly stream: GainNode;
  readonly wind: GainNode;
  readonly rain: GainNode;
  private windBp: BiquadFilterNode;
  /** 现在各层多响（给气泡、雨滴、鸟鸣定多密） */
  lv = { stream: 0, wind: 0, rain: 0, birds: 0 };

  constructor(
    private c: BaseAudioContext,
    private dest: AudioNode,
  ) {
    const noise = () => {
      const s = c.createBufferSource();
      s.buffer = noiseBuf(c);
      s.loop = true;
      s.start(c.currentTime, Math.random() * 1.5);
      this.srcs.push(s);
      return s;
    };
    const lfo = (f: number, depth: number, param: AudioParam) => {
      const o = c.createOscillator();
      o.frequency.value = f;
      const g = c.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      this.lfos.push(o);
    };
    // 溪水：两层带通，各自慢慢起伏
    this.stream = c.createGain();
    this.stream.gain.value = 0;
    for (const [f, q, rate] of [
      [520, 0.9, 0.17],
      [1500, 1.3, 0.23],
    ]) {
      const bp = biquad(c, 'bandpass', f, q);
      const g = c.createGain();
      g.gain.value = 0.6;
      lfo(rate, 0.3, g.gain);
      noise().connect(bp).connect(g).connect(this.stream);
    }
    // 松风：带通的中心频率和音量都慢慢漂，像一阵一阵的风过松林
    this.wind = c.createGain();
    this.wind.gain.value = 0;
    this.windBp = biquad(c, 'bandpass', 480, 0.8);
    lfo(0.05, 180, this.windBp.frequency);
    const wg = c.createGain();
    wg.gain.value = 0.7;
    lfo(0.09, 0.3, wg.gain);
    noise().connect(this.windBp).connect(wg).connect(this.wind);
    // 细雨：高通噪声，很轻
    this.rain = c.createGain();
    this.rain.gain.value = 0;
    noise().connect(biquad(c, 'highpass', 2500, 0.6)).connect(biquad(c, 'lowpass', 8000, 0.6)).connect(this.rain);
    for (const g of [this.stream, this.wind, this.rain]) g.connect(dest);
  }

  /** 换情绪：各层慢慢到新的音量（两三秒） */
  set(palette: Palette, mood: Mood, when: number) {
    const k = MOODS[mood].amb;
    this.lv = { stream: palette.amb.stream * k, wind: palette.amb.wind * k, rain: palette.amb.rain * k, birds: palette.amb.birds * k };
    this.stream.gain.setTargetAtTime(AMB_LEVEL.stream * this.lv.stream, when, 2.5);
    this.wind.gain.setTargetAtTime(AMB_LEVEL.wind * this.lv.wind, when, 2.5);
    this.rain.gain.setTargetAtTime(AMB_LEVEL.rain * this.lv.rain, when, 2.5);
  }

  /** 每一步调一次：按各层的多少，随机冒几个气泡、落几滴雨、偶尔一只鸟 */
  tick(when: number, stepDur: number) {
    const c = this.c;
    const poisson = (lambda: number) => {
      let n = 0;
      let p = Math.exp(-lambda);
      let s = p;
      const u = Math.random();
      while (u > s && n < 8) {
        n++;
        p *= lambda / n;
        s += p;
      }
      return n;
    };
    // 溪水里的小气泡："咕嘟"——一个往上滑的短正弦
    for (let i = poisson(1.8 * this.lv.stream); i > 0; i--) {
      const t = when + Math.random() * stepDur;
      const f0 = 650 + Math.random() * 1200;
      const o = c.createOscillator();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * (1.3 + Math.random() * 0.5), t + 0.04);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.006 * this.lv.stream, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      const p = c.createStereoPanner();
      p.pan.value = Math.random() * 1.2 - 0.6;
      o.connect(g).connect(p).connect(this.dest);
      o.start(t);
      o.stop(t + 0.08);
    }
    // 雨滴：一下短短的"嗒"
    for (let i = poisson(1.5 * this.lv.rain); i > 0; i--) {
      const t = when + Math.random() * stepDur;
      const o = c.createOscillator();
      o.frequency.value = 1700 + Math.random() * 1600;
      const g = c.createGain();
      g.gain.setValueAtTime(0.004 * this.lv.rain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
      const p = c.createStereoPanner();
      p.pan.value = Math.random() * 1.6 - 0.8;
      o.connect(g).connect(p).connect(this.dest);
      o.start(t);
      o.stop(t + 0.04);
    }
    // 鸟鸣：平均十几秒一只
    if (Math.random() < 0.03 * this.lv.birds) this.bird(when + Math.random() * stepDur);
  }

  /** 一只鸟：要么几声往下滑的"啾"，要么一串很快的颤音 */
  private bird(t0: number) {
    const c = this.c;
    const p = c.createStereoPanner();
    p.pan.value = Math.random() * 1.4 - 0.7;
    const lp = biquad(c, 'lowpass', 6500, 0.5);
    lp.connect(p).connect(this.dest);
    const trill = Math.random() < 0.4;
    const n = trill ? 6 + Math.floor(Math.random() * 5) : 2 + Math.floor(Math.random() * 3);
    const f = (trill ? 3800 : 2600) + Math.random() * 900;
    let t = t0;
    for (let i = 0; i < n; i++) {
      const d = trill ? 0.035 : 0.09 + Math.random() * 0.05;
      const o = c.createOscillator();
      o.frequency.setValueAtTime(trill ? f : f * 1.12, t);
      o.frequency.exponentialRampToValueAtTime(trill ? f * 1.08 : f * 0.82, t + d);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.007, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(lp);
      o.start(t);
      o.stop(t + d + 0.01);
      t += d + (trill ? 0.025 : 0.06 + Math.random() * 0.05);
    }
  }

  stop(when: number) {
    for (const g of [this.stream, this.wind, this.rain]) g.gain.setTargetAtTime(0, when, 0.3);
    for (const s of this.srcs) s.stop(when + 1.5);
    for (const o of this.lfos) o.stop(when + 1.5);
  }
}

// ───────────────────────── 实时播放 ─────────────────────────

interface Live {
  c: BaseAudioContext;
  bus: Bus;
  core: Core;
  amb: Ambience;
}

let score: Score | null = null;
let live: Live | null = null;
let song: Song | null = null;
/** 正在放的这一句 */
let cur: { start: number; len: number; byStep: Map<number, NoteEv[]>; phrase: Phrase; stepDur: number } | null = null;
let lastStep = 0;
/** 局势要的情绪（一句唱完才换） */
let target: { mood: Mood; intensity: number } = { mood: 'serene', intensity: 0.2 };

/** 换曲子 / 停：旧总线淡出再断开（还在响的余音不要一刀切断） */
function retireLive() {
  if (!live) return;
  const { c, bus, amb } = live;
  bus.out.gain.setTargetAtTime(0, c.currentTime, 0.15);
  amb.stop(c.currentTime);
  setTimeout(() => bus.out.disconnect(), 1500);
  live = null;
}

function beginPhrase(step: number, when: number) {
  if (!score || !live) return;
  const ph = composePhrase(score, target.mood, target.intensity);
  const stepDur = 60 / ph.bpm / 2;
  const byStep = new Map<number, NoteEv[]>();
  for (const e of ph.notes) {
    const arr = byStep.get(e.step);
    if (arr) arr.push(e);
    else byStep.set(e.step, [e]);
  }
  cur = { start: step, len: ph.steps, byStep, phrase: ph, stepDur };
  // 下一步起按这一句的速度走（调度器每走一步读一次 stepDur）
  if (song) song.stepDur = stepDur;
  busMood(live.bus, ph.mood, score.palette, stepDur, when);
  live.amb.set(score.palette, ph.mood, when);
}

export interface MusicInfo {
  palette: Palette;
  key: string;
  bpm: number;
}

/**
 * 开一盘的配乐：id 不给就随机挑一种乐队（不和上一盘重复）。从"开局 · 静"起。
 */
export function startXqMusic(id?: string): MusicInfo | null {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_KEY);
  } catch {
    // 隐私模式读不到也没关系
  }
  const palette = (id && PALETTES.find((s) => s.id === id)) || pickPalette(last, Math.random);
  try {
    localStorage.setItem(LAST_KEY, palette.id);
  } catch {
    // 同上
  }
  // 换乐队时局势不变（中局点 🎵 换一种，还是中局的情绪）；新开一盘才从开局起
  if (!id || !score) target = { mood: 'serene', intensity: 0.2 };
  score = newScore(palette);
  retireLive();
  cur = null;
  const mc = musicCore();
  if (mc) {
    const bus = makeBus(mc.c, mc.outAt(0), palette);
    live = { c: mc.c, bus, core: coreOf(mc.c, bus), amb: new Ambience(mc.c, bus.dry) };
  }
  song = {
    stepDur: 60 / score.bpm / 2,
    steps: 1e9,
    play(step, when) {
      lastStep = step;
      if (!cur || step >= cur.start + cur.len) beginPhrase(step, when);
      if (!cur || !live) return;
      for (const e of cur.byStep.get(step - cur.start) ?? []) render(live.core, e, when, cur.stepDur);
      live.amb.tick(when, cur.stepDur);
    },
  };
  startSong(song);
  return { palette, key: score.key, bpm: score.bpm };
}

/** 换下一种乐队（对局里点 🎵） */
export function nextXqMusic(): MusicInfo | null {
  const i = score ? PALETTES.indexOf(score.palette) : -1;
  return startXqMusic(PALETTES[(i + 1) % PALETTES.length].id);
}

export function currentXqMusic(): (MusicInfo & { mood: Mood | null }) | null {
  return score ? { palette: score.palette, key: score.key, bpm: score.bpm, mood: cur?.phrase.mood ?? null } : null;
}

/**
 * 局势变了（每走一步、引擎算出新的评分时调一次）。一句唱完按新的局势挑情绪；
 * 要杀进来了（将军、吃大子、被杀）就不等这一句唱完——最多再等一小节。
 */
export function setXqMusicState(ctx: MusicCtx) {
  target = moodFor(ctx);
  if (cur && target.mood === 'battle' && cur.phrase.mood !== 'battle') {
    const into = lastStep - cur.start + 1;
    cur.len = Math.min(cur.len, Math.ceil(into / SPB) * SPB);
  }
}

/** 点缀：将军、吃掉车马炮。马上响，和正在放的曲子在一个调上 */
export function xqStinger(kind: StingerKind) {
  if (!score || !live || isMuted()) return;
  const sd = cur?.stepDur ?? 60 / score.bpm / 2;
  const now = live.c.currentTime + 0.03;
  for (const e of stinger(score, kind)) render(live.core, e, now + e.step * sd, sd);
}

/** 下完了：收尾的一句，然后回到很静的开局情绪 */
export function xqMusicEnd(result: 'win' | 'loss' | 'draw') {
  xqStinger(result);
  target = { mood: 'serene', intensity: 0.1 };
}

export function stopXqMusic() {
  stopBgm();
  retireLive();
  score = null;
  cur = null;
  song = null;
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

/** 一段循环用的白噪声（每个上下文一份；气声、笛膜、鼓皮、自然声从这里切） */
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

/**
 * 弓弦：二胡（鼻音重——两个共鸣峰、揉弦深、起弓快）或马头琴（柔一点、低一点）。
 * 两把微失谐的弦，颤音晚一点才出来，可以从下方滑上来。
 */
function bowAt(core: Core, freq: number, when: number, dur: number, vol: number, pan: number, erhu: boolean, slideFrom?: number, kind?: 'lead' | 'acc') {
  const c = core.c;
  const end = when + dur;
  const harm = Array.from({ length: 14 }, (_, i) => 1 / (i + 1) ** (erhu ? 1.15 : 1.35));
  const lp = biquad(c, 'lowpass', Math.min(erhu ? 4500 : 2600, freq * (erhu ? 7 : 5)), 0.5);
  const body = biquad(c, 'peaking', erhu ? 950 : 1100, 1.1, erhu ? 4 : 2);
  const body2 = biquad(c, 'peaking', 2600, 2, erhu ? 3 : 0);
  const atk = erhu ? 0.09 : 0.16;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + atk);
  if (dur > 0.8) g.gain.linearRampToValueAtTime(vol * 1.08, when + dur * 0.5);
  g.gain.linearRampToValueAtTime(vol * 0.9, Math.max(when + atk + 0.01, end - 0.18));
  g.gain.linearRampToValueAtTime(0, end);
  const vib = c.createOscillator();
  vib.frequency.value = erhu ? 6 : 5.3;
  const vibG = c.createGain();
  vibG.gain.setValueAtTime(0, when);
  vibG.gain.setValueAtTime(0, when + Math.min(0.25, dur * 0.35));
  vibG.gain.linearRampToValueAtTime(freq * (erhu ? 0.012 : 0.009), when + Math.min(0.8, dur * 0.8));
  vib.connect(vibG);
  for (const det of [-5, 5]) {
    const o = c.createOscillator();
    o.setPeriodicWave(wave(c, harm));
    if (slideFrom) {
      o.frequency.setValueAtTime(slideFrom, when);
      o.frequency.exponentialRampToValueAtTime(freq, when + (erhu ? 0.12 : 0.18));
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
  lp.connect(body).connect(body2).connect(g).connect(core.outAt(pan, kind));
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
function strikeAt(core: Core, when: number, partials: [number, number, number][], vol: number, pan: number, kind?: 'lead' | 'acc', attack = 0.004) {
  const c = core.c;
  const dst = core.outAt(pan, kind);
  const j = 1 + (Math.random() - 0.5) * 0.008;
  for (const [f, a, dec] of partials) {
    if (f > 16000) continue;
    const o = c.createOscillator();
    o.frequency.value = f * j;
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(a * vol, when + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dec);
    o.connect(g).connect(dst);
    o.start(when);
    o.stop(when + dec + 0.02);
  }
}

/** 一下噪声（鼓皮、钹）：从循环噪声里切一段，带通 */
function noiseAt(core: Core, when: number, dur: number, vol: number, bp: number, q: number, pan: number) {
  const c = core.c;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  const f = biquad(c, 'bandpass', bp, q);
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.003);
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
const DRUMS = new Set(['tanggu', 'dagu', 'gong', 'bo', 'wood']);

/** 一个音符：按乐器出声 */
function render(core: Core, e: NoteEv, when0: number, stepDur: number) {
  const when = Math.max(core.c.currentTime, when0 + (DRUMS.has(e.inst) ? jitter() * 0.4 : jitter()));
  const dur = e.len * stepDur;
  const f = e.midi !== undefined ? mtof(e.midi) : 0;
  const v = e.vol;
  const p = e.pan;
  const kind = e.lead ? 'lead' : 'acc';
  const slide = e.slideFrom ? mtof(e.slideFrom) : undefined;
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
      pluckAt(core, f, when, Math.max(1.4, dur * 1.8), v * (e.lead ? 1.4 : 1), p, 0.9965, 0.7, slide, kind);
      break;
    case 'pipa': {
      // 主旋律的长音用轮指撑住（轮得轻一点）
      if (dur >= 0.6 && e.lead) {
        const n = Math.max(2, Math.round(dur / 0.075));
        for (let i = 0; i < n; i++) pluckAt(core, f, when + i * 0.075, 0.4, v * (i === 0 ? 1.3 : 0.6), p, 0.993, 0.8, undefined, kind);
      } else pluckAt(core, f, when, 1.0, v * (e.lead ? 1.3 : 1), p, 0.995, 0.8, undefined, kind);
      break;
    }
    case 'saofu':
      // 扫弦：几根弦错开十几毫秒依次拨响，像一把扫下去
      (e.run ?? []).forEach((m, i) => pluckAt(core, mtof(m), when + i * 0.016, 0.7, v * (1 - i * 0.12), p, 0.994, 0.85));
      break;
    case 'trem': {
      // 古筝摇指：一个音上快速反复，音量起伏
      const n = Math.max(2, Math.round(dur / 0.09));
      for (let i = 0; i < n; i++) pluckAt(core, f, when + i * 0.09, 0.45, v * (0.6 + 0.4 * Math.sin((Math.PI * i) / n)), p, 0.994, 0.6);
      break;
    }
    case 'qin':
      // 古琴音色暗、衰减得快，当主旋律时比吹管、弓弦轻七八个分贝（离线量的）：主旋律提上来
      pluckAt(core, f, when, Math.max(2.2, dur * 2), v * (e.lead ? 3 : 1.2), p, 0.9988, 0.35, slide, kind);
      break;
    case 'harm':
      strikeAt(core, when, [[f, 1, 2.8], [f * 2, 0.2, 1.4]], v, p, kind);
      break;
    case 'erhu':
    case 'morin':
      bowAt(core, f, when, Math.max(0.25, dur * 1.0), v * 0.85, p, e.inst === 'erhu', slide, kind);
      break;
    case 'drone':
      padAt(core, f, when, dur, v, p, 500, false);
      break;
    case 'sheng':
      padAt(core, f, when, Math.max(dur, 0.4), v, p, 2000, true);
      break;
    case 'bell':
      // 编钟：一组不成谐波的分音，余音长；高分音收着一点，不刺
      strikeAt(core, when, [[f, 1, 3.6], [f * 2.76, 0.3, 2.0], [f * 5.4, 0.1, 0.9], [f * 8.93, 0.035, 0.4]], v * 1.1, p, kind);
      break;
    case 'qing':
      // 磬（钵）：两个靠得很近的分音相互"拍"着，余音很长
      strikeAt(core, when, [[f, 1, 5], [f * 1.004, 0.6, 5], [f * 2.71, 0.35, 3], [f * 5.15, 0.12, 1.6]], v, p, kind, 0.008);
      break;
    case 'wood':
      strikeAt(core, when, [[760, 1, 0.12], [1380, 0.35, 0.06]], v, p);
      break;
    case 'tanggu':
      // 堂鼓：紧一点的中鼓，"哒"
      thumpAt(core, when, 230, 150, 0.2, v, p);
      noiseAt(core, when, 0.06, v * 0.35, 1200, 1, p);
      break;
    case 'dagu':
      // 大鼓：战鼓，"咚"
      thumpAt(core, when, 115, 55, 0.55, v, p);
      noiseAt(core, when, 0.09, v * 0.25, 380, 1, p);
      break;
    case 'gong': {
      // 锣：低沉的几个分音，音高略往上走，后面一片铜声慢慢散开
      strikeAt(core, when, [[150, 1, 3.4], [222, 0.5, 2.6], [305, 0.35, 2.1], [446, 0.18, 1.5], [630, 0.08, 1.1]], v, p, undefined, 0.02);
      noiseAt(core, when, 1.4, v * 0.12, 900, 0.7, p);
      break;
    }
    case 'bo':
      // 钹：一片噪声加几个金属分音，轻轻一下
      noiseAt(core, when, 1.1, v, 5200, 0.6, p);
      strikeAt(core, when, [[3150, 0.4, 0.7], [4630, 0.3, 0.5], [6070, 0.2, 0.4]], v * 0.5, p);
      break;
    case 'gliss':
      (e.run ?? []).forEach((m, i) => pluckAt(core, mtof(m), when + i * 0.05, 1.0, v * (0.7 + i * 0.06), p, 0.996, 0.7));
      break;
  }
}

// ───────────────────────── 离线渲染 ─────────────────────────

/** 演示用的一盘棋：每段一种情绪、几句、段首可以来一下点缀 */
export interface DemoSeg {
  mood: Mood;
  intensity: number;
  phrases: number;
  stinger?: StingerKind;
}

/** 一盘棋大致的走向：开局 → 中局 → 胶着 → 杀进来（将军）→ 占优 → 残局 → 赢了 */
export const DEMO_PLAN: DemoSeg[] = [
  { mood: 'serene', intensity: 0.2, phrases: 2 },
  { mood: 'flow', intensity: 0.45, phrases: 2 },
  { mood: 'tense', intensity: 0.6, phrases: 2 },
  { mood: 'battle', intensity: 0.75, phrases: 2, stinger: 'check' },
  { mood: 'triumph', intensity: 0.6, phrases: 2, stinger: 'capture' },
  { mood: 'endgame', intensity: 0.4, phrases: 1 },
  { mood: 'serene', intensity: 0.1, phrases: 1, stinger: 'win' },
];

/**
 * 离线渲染一段：按 plan 一段段往下走（和实时一样的作曲、音色、自然声、总线），生成试听、量音色用。
 * marks 是每段从第几秒开始。
 */
export async function renderXqMusic(
  paletteId: string,
  plan: DemoSeg[],
  seed?: number,
): Promise<{ sampleRate: number; l: Float32Array; r: Float32Array; key: string; bpm: number; marks: { t: number; mood: Mood }[] }> {
  const palette = PALETTES.find((s) => s.id === paletteId) ?? PALETTES[0];
  const sc = newScore(palette, seed);
  // 先把每一句作出来，算出总长
  const segs: { seg: DemoSeg; phs: Phrase[] }[] = plan.map((seg) => ({ seg, phs: Array.from({ length: seg.phrases }, () => composePhrase(sc, seg.mood, seg.intensity)) }));
  let total = 0.3;
  for (const s of segs) for (const ph of s.phs) total += ph.steps * (60 / ph.bpm / 2);
  total += 5;
  const sr = 44100;
  const c = new OfflineAudioContext(2, Math.ceil(sr * total), sr);
  // 和实时一样过一道总线压缩
  const glue = c.createDynamicsCompressor();
  glue.threshold.value = -20;
  glue.knee.value = 14;
  glue.ratio.value = 3;
  glue.attack.value = 0.005;
  glue.release.value = 0.18;
  glue.connect(c.destination);
  const bus = makeBus(c, glue, palette);
  const core = coreOf(c, bus);
  const amb = new Ambience(c, bus.dry);
  const marks: { t: number; mood: Mood }[] = [];
  let t = 0.3;
  for (const { seg, phs } of segs) {
    marks.push({ t, mood: seg.mood });
    phs.forEach((ph, k) => {
      const sd = 60 / ph.bpm / 2;
      busMood(bus, ph.mood, palette, sd, t);
      amb.set(palette, ph.mood, t);
      if (k === 0 && seg.stinger) for (const e of stinger(sc, seg.stinger)) render(core, e, t + e.step * sd, sd);
      for (const e of ph.notes) render(core, e, t + e.step * sd, sd);
      for (let s = 0; s < ph.steps; s++) amb.tick(t + s * sd, sd);
      t += ph.steps * sd;
    });
  }
  amb.stop(t + 1);
  const buf = await c.startRendering();
  return { sampleRate: sr, l: buf.getChannelData(0), r: buf.getChannelData(1), key: sc.key, bpm: sc.bpm, marks };
}

// 开发期测试钩子：界面测试挨个放、读电平；离线渲染成 16 位 PCM，分块取走做试听
if (import.meta.env.DEV && typeof window !== 'undefined') {
  let pcm: Uint8Array | null = null;
  (window as unknown as Record<string, unknown>).__xqMusic = {
    palettes: () => PALETTES.map((s) => s.id),
    start: (id?: string) => startXqMusic(id)?.palette.id ?? null,
    current: () => currentXqMusic(),
    level: () => outputLevel(),
    /** 强行把局势设成某种情绪（界面测试挨个听） */
    mood: (m: Mood, intensity = 0.7) => {
      target = { mood: m, intensity };
      if (cur) cur.len = Math.min(cur.len, lastStep - cur.start + 1);
    },
    stinger: (k: StingerKind) => xqStinger(k),
    /** 离线渲染一段（默认一盘棋的走向），存成 16 位双声道 PCM；返回长度和每段的起点 */
    render: async (id: string, seed?: number, plan?: DemoSeg[]) => {
      const r = await renderXqMusic(id, plan ?? DEMO_PLAN, seed);
      const n = r.l.length;
      pcm = new Uint8Array(n * 4);
      const dv = new DataView(pcm.buffer);
      for (let i = 0; i < n; i++) {
        dv.setInt16(i * 4, Math.max(-1, Math.min(1, r.l[i])) * 32767, true);
        dv.setInt16(i * 4 + 2, Math.max(-1, Math.min(1, r.r[i])) * 32767, true);
      }
      return { bytes: pcm.length, sampleRate: r.sampleRate, key: r.key, bpm: r.bpm, marks: r.marks };
    },
    /** 取走 PCM 的第 i 块（base64） */
    chunk: (i: number, size: number) => {
      if (!pcm) return '';
      const part = pcm.subarray(i * size, (i + 1) * size);
      let bin = '';
      for (let k = 0; k < part.length; k += 0x8000) bin += String.fromCharCode(...part.subarray(k, k + 0x8000));
      return btoa(bin);
    },
  };
}
