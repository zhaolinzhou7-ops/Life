/**
 * 音高检测（Pitch Detection 层）。
 *
 * 算法是 McLeod Pitch Method：归一化平方差函数 NSDF + 按「第一个够高的峰」
 * 取周期 + 抛物线插值。相比裸自相关，它对八度错误鲁棒得多——这点对唱歌很关键，
 * 因为八度判错会让「你唱低了 12 个半音」这种离谱结论出现在用户面前。
 *
 * 自相关走 FFT（见 fft.ts），所以整段录音离线分析也很快。
 *
 * 检测范围 C2(65Hz) ~ D6(1175Hz)，覆盖绝大多数人声。
 */

import { FFT, autocorrelation } from './fft';
import { freqToMidi } from './notes';
import { downsampleTo, highpass } from './resample';

/** 音高检测用的内部采样率：人声基频不超过 1.2kHz，16k 完全够且快 */
export const PITCH_RATE = 16000;
/** 帧移 10ms —— 唱歌的音符最短也有 100ms 上下，10ms 足够画出滑音细节 */
export const HOP_SEC = 0.01;
/** 分析窗 64ms：要装得下 4 个周期的最低音（65Hz）才测得准 */
const WIN = 1024;
const F_MIN = 65;
const F_MAX = 1175;

/** 判定「在发声」的清晰度门槛。分强弱两档做迟滞，避免边界帧疯狂闪烁 */
const CLARITY_STRONG = 0.72;
const CLARITY_WEAK = 0.5;
/** 绝对音量地板（约 -48 dBFS）。比这还小的基本是环境底噪 */
const RMS_FLOOR = 0.004;

export interface PitchFrame {
  /** 帧中心时间（秒） */
  t: number;
  /** 基频 Hz，0 表示这一帧没测到音高 */
  f0: number;
  /** 连续 MIDI 音高（带小数），0 表示没测到 */
  midi: number;
  /** 0~1，波形有多像一个规整的乐音 */
  clarity: number;
  /** 该帧音量（线性 RMS） */
  rms: number;
  /** 是否判定为「在唱」 */
  voiced: boolean;
}

export interface PitchTrack {
  frames: PitchFrame[];
  /** 帧移（秒） */
  hop: number;
  /** 录音总时长（秒） */
  duration: number;
  /** 估计的环境底噪（线性 RMS），用于报告录音质量 */
  noiseFloor: number;
}

/**
 * 对一帧波形做 NSDF 音高检测。
 * 这是最内层的热点函数，所有缓冲都从外面传进来复用。
 */
function frameF0(
  x: Float32Array,
  sampleRate: number,
  fft: FFT,
  ac: Float64Array,
  nsdf: Float64Array,
  prefix: Float64Array,
  scratch: { re: Float64Array; im: Float64Array },
): { f0: number; clarity: number } {
  const n = x.length;
  autocorrelation(x, n, fft, ac, scratch);

  // m[τ] = Σ(x[i]² + x[i+τ]²)，用平方的前缀和 O(1) 求出来
  prefix[0] = 0;
  for (let i = 0; i < n; i++) prefix[i + 1] = prefix[i] + x[i] * x[i];
  const total = prefix[n];
  if (total <= 0) return { f0: 0, clarity: 0 };

  const minLag = Math.max(2, Math.floor(sampleRate / F_MAX));
  const maxLag = Math.min(n - 2, Math.floor(sampleRate / F_MIN));
  if (maxLag <= minLag) return { f0: 0, clarity: 0 };

  for (let t = 0; t <= maxLag; t++) {
    const m = prefix[n - t] + (total - prefix[t]);
    nsdf[t] = m > 1e-12 ? (2 * ac[t]) / m : 0;
  }

  // MPM 取峰：先跳过 τ=0 那个平凡的大峰（一路正值），
  // 然后在每段「正值区间」里取最高点作为候选峰。
  let i = 1;
  while (i <= maxLag && nsdf[i] > 0) i++;
  let globalMax = -1;
  const keys: number[] = [];
  while (i <= maxLag) {
    while (i <= maxLag && nsdf[i] <= 0) i++;
    if (i > maxLag) break;
    let best = i;
    while (i <= maxLag && nsdf[i] > 0) {
      if (nsdf[i] > nsdf[best]) best = i;
      i++;
    }
    if (best >= minLag) {
      keys.push(best);
      if (nsdf[best] > globalMax) globalMax = nsdf[best];
    }
  }
  if (!keys.length || globalMax < CLARITY_WEAK) return { f0: 0, clarity: Math.max(0, globalMax) };

  // 取第一个达到全局峰 90% 的峰。「第一个」这一步就是 MPM 防八度错的关键：
  // 真周期的整数倍处也会出现同样高的峰，取最早的那个才是基频而不是次谐波。
  const thresh = globalMax * 0.9;
  let lag = keys[0];
  for (const k of keys) {
    if (nsdf[k] >= thresh) {
      lag = k;
      break;
    }
  }

  // 抛物线插值细化峰位置，把分辨率从「整采样点」提到亚采样点
  const a = nsdf[lag - 1];
  const b = nsdf[lag];
  const c = nsdf[lag + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = lag + Math.max(-0.5, Math.min(0.5, shift));
  const f0 = sampleRate / period;
  if (f0 < F_MIN || f0 > F_MAX) return { f0: 0, clarity: b };
  return { f0, clarity: Math.min(1, b) };
}

/** 取一组数的中位数（会改动传入数组的顺序，调用方自备副本） */
function median(a: number[]): number {
  if (!a.length) return 0;
  a.sort((x, y) => x - y);
  const h = a.length >> 1;
  return a.length % 2 ? a[h] : (a[h - 1] + a[h]) / 2;
}

/** 取分位数（0~1），用于估底噪与动态范围 */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const a = [...values].sort((x, y) => x - y);
  const idx = Math.max(0, Math.min(a.length - 1, Math.round(p * (a.length - 1))));
  return a[idx];
}

/**
 * 对整段录音做音高跟踪。纯计算，不碰 DOM，可以直接在 Worker 或 Node 里跑。
 */
export function trackPitch(samples: Float32Array, sampleRate: number): PitchTrack {
  const duration = samples.length / sampleRate;
  // 先掐掉 50Hz 以下（直流偏置、手持震动、空调声），再降到 16k
  const x = downsampleTo(highpass(samples, sampleRate, 50), sampleRate, PITCH_RATE);
  const sr = Math.min(sampleRate, PITCH_RATE);
  const hopSamples = Math.max(1, Math.round(HOP_SEC * sr));
  const win = Math.min(WIN, Math.max(256, 1 << Math.round(Math.log2(sr * 0.064))));

  const fftSize = 1 << Math.ceil(Math.log2(win * 2));
  const fft = new FFT(fftSize);
  const scratch = { re: new Float64Array(fftSize), im: new Float64Array(fftSize) };
  const ac = new Float64Array(win);
  const nsdf = new Float64Array(win);
  const prefix = new Float64Array(win + 1);
  const buf = new Float32Array(win);

  const frames: PitchFrame[] = [];
  const rmsAll: number[] = [];

  for (let start = 0; start + win <= x.length; start += hopSamples) {
    buf.set(x.subarray(start, start + win));
    let s = 0;
    for (let i = 0; i < win; i++) s += buf[i] * buf[i];
    const rms = Math.sqrt(s / win);
    rmsAll.push(rms);

    let f0 = 0;
    let clarity = 0;
    if (rms >= RMS_FLOOR) {
      const r = frameF0(buf, sr, fft, ac, nsdf, prefix, scratch);
      f0 = r.f0;
      clarity = r.clarity;
    }
    frames.push({
      t: (start + win / 2) / sr,
      f0,
      midi: f0 > 0 ? freqToMidi(f0) : 0,
      clarity,
      rms,
      voiced: false,
    });
  }

  // 底噪：取音量的 10 分位数当环境噪声水平。
  // 用分位数而不是最小值，是因为录音里总有那么一两帧异常安静。
  const noiseFloor = percentile(rmsAll, 0.1);
  // 门限要同时满足两个约束，缺一个都会出事：
  //   · 不低于绝对地板，否则纯底噪也会被当成在唱；
  //   · 不高于响处的 6%，否则「整段都在唱、没有安静段」的录音里
  //     10 分位数本身就很响，门限会飙到把全部人声一起挡掉。
  const loud = percentile(rmsAll, 0.9);
  const rmsGate = Math.max(RMS_FLOOR, Math.min(noiseFloor * 2.5, loud * 0.06));

  decideVoicing(frames, rmsGate);
  fixOctaveJumps(frames);
  smoothMidi(frames);

  return { frames, hop: HOP_SEC, duration, noiseFloor };
}

/**
 * 判定每帧是否「在唱」。
 * 用强/弱两个清晰度门槛做迟滞：已经在唱的帧用低门槛留住，
 * 还没开唱的帧用高门槛才认。不然元音之间的过渡会被切得七零八落。
 */
function decideVoicing(frames: PitchFrame[], rmsGate: number): void {
  let on: boolean = false;
  for (const f of frames) {
    const gate: number = on ? CLARITY_WEAK : CLARITY_STRONG;
    on = f.f0 > 0 && f.clarity >= gate && f.rms >= rmsGate;
    f.voiced = on;
  }
  // 反向再扫一遍，补回起音那几帧（起音总是从弱到强，正向扫会漏掉开头）
  on = false;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    const gate: number = on ? CLARITY_WEAK : CLARITY_STRONG;
    on = f.f0 > 0 && f.clarity >= gate && f.rms >= rmsGate;
    if (on) f.voiced = true;
  }
  // 少于 4 帧（40ms）的孤立发声段是噪声，不是音符
  let i = 0;
  while (i < frames.length) {
    if (!frames[i].voiced) {
      i++;
      continue;
    }
    let j = i;
    while (j < frames.length && frames[j].voiced) j++;
    if (j - i < 4) for (let k = i; k < j; k++) frames[k].voiced = false;
    i = j;
  }
}

/**
 * 修八度跳变：拿本帧和邻域中位数比，如果差一个八度、
 * 而且加减 12 半音后离中位数明显更近，就认定是八度误判并纠正。
 * 要求「明显更近」（4 个半音以上）是为了不误伤真正的八度跳跃演唱。
 */
function fixOctaveJumps(frames: PitchFrame[]): void {
  const R = 10; // ±100ms 邻域
  const fixed: number[] = [];
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].voiced) {
      fixed.push(0);
      continue;
    }
    const nb: number[] = [];
    for (let j = Math.max(0, i - R); j <= Math.min(frames.length - 1, i + R); j++) {
      if (j !== i && frames[j].voiced) nb.push(frames[j].midi);
    }
    if (nb.length < 5) {
      fixed.push(frames[i].midi);
      continue;
    }
    const med = median(nb);
    const cur = frames[i].midi;
    let best = cur;
    let bestD = Math.abs(cur - med);
    for (const cand of [cur - 12, cur + 12]) {
      const d = Math.abs(cand - med);
      if (d < bestD - 4) {
        best = cand;
        bestD = d;
      }
    }
    fixed.push(best);
  }
  for (let i = 0; i < frames.length; i++) {
    if (frames[i].voiced && fixed[i] > 0) frames[i].midi = fixed[i];
  }
}

/** 5 点中值滤波，去掉单帧毛刺又不会把滑音抹平（均值滤波就会） */
function smoothMidi(frames: PitchFrame[]): void {
  const out = new Float64Array(frames.length);
  for (let i = 0; i < frames.length; i++) {
    if (!frames[i].voiced) continue;
    const w: number[] = [];
    for (let j = Math.max(0, i - 2); j <= Math.min(frames.length - 1, i + 2); j++) {
      if (frames[j].voiced) w.push(frames[j].midi);
    }
    out[i] = median(w);
  }
  for (let i = 0; i < frames.length; i++) if (frames[i].voiced) frames[i].midi = out[i];
}
