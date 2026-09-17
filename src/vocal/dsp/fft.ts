/**
 * 迭代式 radix-2 复数 FFT，纯 TypeScript，无依赖。
 *
 * 为什么需要它：音高检测要算自相关。逐个 lag 暴力算是 O(N²)，
 * 一段 60 秒的录音有 6000 帧，暴力法要跑十几秒；走 FFT 是 O(N log N)，
 * 同样的活儿零点几秒就完了。离线分析整段录音全靠它。
 */

export class FFT {
  readonly n: number;
  private cosT: Float64Array;
  private sinT: Float64Array;
  private rev: Uint32Array;

  constructor(n: number) {
    if (n < 2 || (n & (n - 1)) !== 0) throw new Error(`FFT 长度必须是 2 的幂，收到 ${n}`);
    this.n = n;
    const half = n >>> 1;
    this.cosT = new Float64Array(half);
    this.sinT = new Float64Array(half);
    for (let i = 0; i < half; i++) {
      this.cosT[i] = Math.cos((2 * Math.PI * i) / n);
      this.sinT[i] = Math.sin((2 * Math.PI * i) / n);
    }
    // 位反转置换表：预先算好，避免每帧重复算
    const bits = Math.round(Math.log2(n));
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let x = i;
      let r = 0;
      for (let b = 0; b < bits; b++) {
        r = (r << 1) | (x & 1);
        x >>>= 1;
      }
      this.rev[i] = r >>> 0;
    }
  }

  /** 原地正向 FFT。re/im 长度必须等于 n */
  forward(re: Float64Array, im: Float64Array): void {
    const n = this.n;
    const rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i];
        re[i] = re[j];
        re[j] = t;
        t = im[i];
        im[i] = im[j];
        im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >>> 1;
      const step = n / size;
      for (let i = 0; i < n; i += size) {
        for (let j = i, k = 0; j < i + half; j++, k += step) {
          const l = j + half;
          const c = this.cosT[k];
          const s = this.sinT[k];
          const tre = re[l] * c + im[l] * s;
          const tim = -re[l] * s + im[l] * c;
          re[l] = re[j] - tre;
          im[l] = im[j] - tim;
          re[j] += tre;
          im[j] += tim;
        }
      }
    }
  }

  /** 原地逆向 FFT（含 1/n 归一）。用「交换实虚部跑正变换」的恒等式实现 */
  inverse(re: Float64Array, im: Float64Array): void {
    this.forward(im, re);
    const inv = 1 / this.n;
    for (let i = 0; i < this.n; i++) {
      re[i] *= inv;
      im[i] *= inv;
    }
  }
}

/**
 * 用 FFT 算一段信号的自相关 r[τ] = Σ x[i]·x[i+τ]，τ = 0..N-1。
 *
 * 做法是标准的 Wiener–Khinchin：补零到 2N 做 FFT，取功率谱，再逆变换。
 * 补零是必须的——不补零算出来的是循环自相关，尾巴会绕回来污染结果。
 *
 * @param out 长度至少 N 的输出缓冲
 * @param scratch 两条长度 2N 的复用缓冲（re, im），避免每帧新建数组
 */
export function autocorrelation(
  x: Float32Array,
  n: number,
  fft: FFT,
  out: Float64Array,
  scratch: { re: Float64Array; im: Float64Array },
): void {
  const m = fft.n; // = 2N（或更大的 2 的幂）
  const { re, im } = scratch;
  re.fill(0);
  im.fill(0);
  for (let i = 0; i < n; i++) re[i] = x[i];
  fft.forward(re, im);
  // 功率谱：|X|²，虚部清零
  for (let i = 0; i < m; i++) {
    const p = re[i] * re[i] + im[i] * im[i];
    re[i] = p;
    im[i] = 0;
  }
  fft.inverse(re, im);
  for (let t = 0; t < n; t++) out[t] = re[t];
}

/** 汉宁窗（预计算一次反复用） */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
  return w;
}
