/**
 * 重采样与信号预处理。
 *
 * 音高检测不需要 48kHz：人声基频最高也就 1100Hz 上下，16kHz 足够，
 * 而采样率降到 1/3，自相关的计算量就降到 1/3。但直接抽samples 会混叠
 * （高频折回来变成假的低频，音高检测会被带跑），所以必须先低通再抽样。
 */

/** 二阶 Butterworth 低通（双线性变换），返回新数组，不改原始数据 */
export function lowpass(x: Float32Array, sampleRate: number, cutoff: number): Float32Array {
  const fc = Math.min(cutoff, sampleRate * 0.45);
  const w0 = (2 * Math.PI * fc) / sampleRate;
  const cosw = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * Math.SQRT1_2); // Q = 1/√2，最大平坦
  const b0 = (1 - cosw) / 2;
  const b1 = 1 - cosw;
  const b2 = (1 - cosw) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cosw;
  const a2 = 1 - alpha;
  const n = x.length;
  const y = new Float32Array(n);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < n; i++) {
    const xi = x[i];
    const yi = (b0 * xi + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

/** 一阶高通，用来去掉直流偏置和空调/手机震动那类几十赫兹以下的低频垃圾 */
export function highpass(x: Float32Array, sampleRate: number, cutoff = 50): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoff);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  const n = x.length;
  const y = new Float32Array(n);
  let prevX = 0;
  let prevY = 0;
  for (let i = 0; i < n; i++) {
    const yi = a * (prevY + x[i] - prevX);
    prevX = x[i];
    prevY = yi;
    y[i] = yi;
  }
  return y;
}

/** 线性插值重采样（调用前请先低通）。目标率 >= 源率时原样返回副本 */
export function resample(x: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (dstRate >= srcRate) return x.slice();
  const ratio = srcRate / dstRate;
  const n = Math.floor(x.length / ratio);
  const y = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const i1 = Math.min(x.length - 1, i0 + 1);
    const f = p - i0;
    y[i] = x[i0] * (1 - f) + x[i1] * f;
  }
  return y;
}

/** 低通 + 抽样，一步到位地降到目标采样率 */
export function downsampleTo(x: Float32Array, srcRate: number, dstRate: number): Float32Array {
  if (dstRate >= srcRate) return x.slice();
  return resample(lowpass(x, srcRate, dstRate * 0.45), srcRate, dstRate);
}

/** 整段 RMS */
export function rmsOf(x: Float32Array, from = 0, to = x.length): number {
  let s = 0;
  const n = Math.max(1, to - from);
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / n);
}

/** 线性幅度 → dBFS（0 dB = 满刻度）。给一个下限免得 log(0) */
export const toDb = (amp: number) => 20 * Math.log10(Math.max(1e-7, amp));
