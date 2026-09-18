/**
 * 合成「假唱」——测试与验收共用。
 *
 * 可以按参考旋律唱一遍，并注入指定的毛病（整体偏低、高音塌、
 * 长音飘、抢拍拖拍、漏唱……）。因为毛病是我们自己放进去的，
 * 所以能直接断言「分析层有没有把它找出来」。
 */

import { midiToFreq } from '../src/vocal/dsp/notes';
import type { Reference } from '../src/vocal/analysis/types';

export const SR = 48000;

/**
 * 固定种子的伪随机（mulberry32），保证测试可复现。
 *
 * 这里不能用教科书上那个 `x = (x*1103515245 + 12345) & 0x7fffffff`：
 * JS 的数字是双精度浮点，那个乘法结果超过 2^53 会丢低位，
 * 生成的序列带系统性偏向。用它去合成「随机漂移」，
 * 合出来的其实是「稳定跑偏」——测试就测错了东西。
 * mulberry32 用 Math.imul 做真正的 32 位乘法，没有这个问题。
 */
export function rng(seed: number): () => number {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 类人声的激励：谐波按 1/k 衰减，比纯正弦更接近真嗓子，也更难测 */
export function voiceSample(phase: number, harmonics = 14): number {
  let v = 0;
  for (let k = 1; k <= harmonics; k++) v += Math.sin(phase * k) / k;
  return v * 0.5;
}

export interface SingOpts {
  /** 整体音高偏移（音分），正 = 唱高 */
  bias?: number;
  /** 高音区额外偏移（音分），只作用于最高的 20% 音符 */
  highBias?: number;
  /** 每个音的随机音高误差幅度（音分） */
  pitchJitter?: number;
  /** 起音统一延迟（秒） */
  delay?: number;
  /** 起音随机抖动幅度（秒，±） */
  timeJitter?: number;
  /** 比例为 lateRate 的音符额外晚 lateBy 秒 */
  lateRate?: number;
  lateBy?: number;
  /** 漏唱比例 */
  missRate?: number;
  /** 长音内部音高漂移幅度（音分） */
  drift?: number;
  /** 音量 */
  amp?: number;
  seed?: number;
  /** 录音开头的空白（秒），模拟真实的启动时差 */
  leadSilence?: number;
  sr?: number;
}

/** 按参考旋律「唱」一遍 */
export function singReference(ref: Reference, o: SingOpts = {}): Float32Array {
  const sr = o.sr ?? SR;
  const lead = o.leadSilence ?? 0;
  const total = Math.round((ref.totalSec + lead + 1) * sr);
  const buf = new Float32Array(total);
  const rand = rng(o.seed ?? 7);
  const amp = o.amp ?? 0.28;

  const pitches = ref.notes.map((n) => n.midi).sort((a, b) => a - b);
  const hiThresh = pitches[Math.floor(pitches.length * 0.8)] ?? 999;

  for (const note of ref.notes) {
    if (o.missRate && rand() < o.missRate) continue;

    let cents = o.bias ?? 0;
    if (o.highBias && note.midi >= hiThresh) cents += o.highBias;
    if (o.pitchJitter) cents += (rand() * 2 - 1) * o.pitchJitter;

    let start = note.start + lead + (o.delay ?? 0);
    if (o.timeJitter) start += (rand() * 2 - 1) * o.timeJitter;
    if (o.lateRate && rand() < o.lateRate) start += o.lateBy ?? 0.25;
    // 唱满时值的 88%，留一点换气空档，和真人唱法一致
    const dur = note.dur * 0.88;
    if (start < 0) start = 0;

    const from = Math.round(start * sr);
    const len = Math.round(dur * sr);
    let phase = 0;
    let driftVal = 0;
    for (let i = 0; i < len; i++) {
      const idx = from + i;
      if (idx >= total) break;
      if (o.drift) {
        // 慢速随机游走，模拟长音撑不住往下掉/飘
        driftVal += (rand() * 2 - 1) * o.drift * 0.004;
        driftVal = Math.max(-o.drift, Math.min(o.drift, driftVal));
      }
      const m = note.midi + (cents + driftVal) / 100;
      phase += (2 * Math.PI * midiToFreq(m)) / sr;
      const fade = Math.min(1, i / (0.025 * sr), (len - i) / (0.025 * sr));
      buf[idx] += amp * fade * voiceSample(phase);
    }
  }
  return buf;
}
