/**
 * 麦克风采集 + 实时音高检测。
 * 检测算法为 McLeod 风格的归一化自相关（NSDF）+ 抛物线插值，
 * 纯 TypeScript 实现，无任何依赖。检测范围 C2(65Hz) ~ C6(1047Hz)。
 */

export interface PitchResult {
  freq: number; // 基频（Hz）
  midi: number; // 连续 MIDI 音高（可带小数）
  clarity: number; // 0~1，越高越像清晰的乐音
  rms: number; // 音量
}

const FMIN = 65;
const FMAX = 1050;
const RMS_GATE = 0.01; // 低于此音量视为没在唱
const CLARITY_GATE = 0.8;

export const freqToMidi = (f: number) => 69 + 12 * Math.log2(f / 440);
export const midiToFreq = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const SOLFEGE = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti'];

/** MIDI → 音名，如 60 → C4 */
export function midiToName(m: number): string {
  const r = Math.round(m);
  return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

/** MIDI → 唱名（按 C 大调），如 60 → do */
export function midiToSolfege(m: number): string {
  const r = Math.round(m);
  return SOLFEGE[((r % 12) + 12) % 12];
}

/** 对时域波形做一次音高检测；检测不到（安静/噪声）返回 null */
export function detectPitch(buf: Float32Array, sampleRate: number): PitchResult | null {
  const n = buf.length;
  let rms = 0;
  for (let i = 0; i < n; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / n);
  if (rms < RMS_GATE) return null;

  const minLag = Math.floor(sampleRate / FMAX);
  const maxLag = Math.min(Math.floor(sampleRate / FMIN), n - 2);

  // NSDF：nsdf[lag] = 2*Σx[i]x[i+lag] / Σ(x[i]² + x[i+lag]²)
  const nsdf = new Float32Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let ac = 0;
    let norm = 0;
    for (let i = 0, j = lag; j < n; i++, j++) {
      ac += buf[i] * buf[j];
      norm += buf[i] * buf[i] + buf[j] * buf[j];
    }
    nsdf[lag] = norm > 0 ? (2 * ac) / norm : 0;
  }

  // 找局部峰值，取第一个达到全局峰值 90% 的峰（MPM 的取峰策略）
  const peaks: number[] = [];
  let best = 0;
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (nsdf[lag] > nsdf[lag - 1] && nsdf[lag] >= nsdf[lag + 1] && nsdf[lag] > 0.3) {
      peaks.push(lag);
      if (nsdf[lag] > best) best = nsdf[lag];
    }
  }
  if (!peaks.length || best < CLARITY_GATE) return null;

  let chosen = -1;
  for (const p of peaks) {
    if (nsdf[p] >= best * 0.9) {
      chosen = p;
      break;
    }
  }
  if (chosen < 0) return null;

  // 抛物线插值细化峰位置
  const a = nsdf[chosen - 1];
  const b = nsdf[chosen];
  const c = nsdf[chosen + 1];
  const denom = a - 2 * b + c;
  const shift = denom !== 0 ? (0.5 * (a - c)) / denom : 0;
  const period = chosen + Math.max(-0.5, Math.min(0.5, shift));
  const freq = sampleRate / period;
  if (freq < FMIN || freq > FMAX) return null;

  return { freq, midi: freqToMidi(freq), clarity: b, rms };
}

/** 麦克风：负责授权、采集与逐帧检测 */
export class Mic {
  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
    private analyser: AnalyserNode,
    private buf: Float32Array<ArrayBuffer>,
  ) {}

  /** 请求麦克风权限并接入分析器；授权失败会抛异常 */
  static async create(ctx: AudioContext): Promise<Mic> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // 回声消除开着可以滤掉 App 自己播放的伴奏；关掉自动增益避免音量被抹平
        echoCancellation: true,
        noiseSuppression: false,
        autoGainControl: false,
      },
    });
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    src.connect(analyser);
    return new Mic(ctx, stream, analyser, new Float32Array(analyser.fftSize));
  }

  /**
   * 最近一帧的音量（RMS），与音高无关。
   * 嘶音这类无调练习检测不到基频，只能靠它判断有没有在发声。
   */
  lastLevel = 0;

  /** 读当前帧音高；没在唱返回 null */
  read(): PitchResult | null {
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (let i = 0; i < this.buf.length; i++) s += this.buf[i] * this.buf[i];
    this.lastLevel = Math.sqrt(s / this.buf.length);
    return detectPitch(this.buf, this.ctx.sampleRate);
  }

  dispose() {
    for (const t of this.stream.getTracks()) t.stop();
  }
}
