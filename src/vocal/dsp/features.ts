/**
 * 特征提取（Feature Extraction 层）。
 *
 * 这里只算「从一段普通手机录音里能可靠拿到」的东西：音量、动态、
 * 频谱亮度/噪声度、以及 Jitter/Shimmer 这类微扰动的帧级近似。
 *
 * ⚠️ 边界（很重要）：这些是**信号指标**，不是生理诊断。
 * 谱平坦度高不等于「声带闭合不好」，Jitter 大不等于「嗓子有病」——
 * 录音设备、房间、距离、伴奏漏音都会显著改变这些数字。
 * 产品里任何地方引用它们，都必须带上「基于本次录音的算法指标」这个前缀。
 */

import { FFT, hann } from './fft';
import type { PitchTrack } from './pitch';
import { percentile } from './pitch';
import { toDb } from './resample';

export interface AudioFeatures {
  /** 录音时长（秒） */
  duration: number;
  /** 有声帧占比 0~1 */
  voicedRatio: number;
  /** 发声总时长（秒） */
  voicedSec: number;

  /** 峰值电平 dBFS */
  peakDb: number;
  /** 有声段平均电平 dBFS */
  meanDb: number;
  /** 动态范围：有声段 95 分位 − 10 分位（dB）。太小说明从头到尾一个劲儿 */
  dynamicRangeDb: number;
  /** 削波样本占比（爆音） */
  clipRatio: number;
  /** 粗略信噪比 dB：有声段电平 − 底噪电平 */
  snrDb: number;

  /** 谱质心均值（Hz）：听感上的「亮/暗」 */
  centroidHz: number;
  /** 谱平坦度 0~1：越接近 1 越像噪声（气声/环境噪声多） */
  flatness: number;

  /** Jitter 类指标（%）：相邻帧基频周期的相对波动。颤音会抬高它 */
  jitterPct: number;
  /** Shimmer 类指标（%）：相邻帧幅度的相对波动 */
  shimmerPct: number;
  /** 上面两项基于多长的持续音算出来的（秒）；太短则不可信 */
  perturbationBasisSec: number;
}

/** 空录音时的零值，省得各处判空 */
export const EMPTY_FEATURES: AudioFeatures = {
  duration: 0,
  voicedRatio: 0,
  voicedSec: 0,
  peakDb: -99,
  meanDb: -99,
  dynamicRangeDb: 0,
  clipRatio: 0,
  snrDb: 0,
  centroidHz: 0,
  flatness: 0,
  jitterPct: 0,
  shimmerPct: 0,
  perturbationBasisSec: 0,
};

const SPEC_WIN = 2048;

/**
 * 在音高轨迹的基础上补齐声学特征。
 * 频谱类特征在原始采样率上算（降采样会砍掉高频，谱质心就不对了）。
 */
export function extractFeatures(
  samples: Float32Array,
  sampleRate: number,
  track: PitchTrack,
): AudioFeatures {
  if (!samples.length || !track.frames.length) {
    return { ...EMPTY_FEATURES, duration: samples.length / sampleRate };
  }

  // ---- 时域：峰值与削波 ----
  let peak = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i++) {
    const a = Math.abs(samples[i]);
    if (a > peak) peak = a;
    if (a >= 0.985) clipped++;
  }

  const voiced = track.frames.filter((f) => f.voiced);
  const voicedRms = voiced.map((f) => f.rms);
  const voicedSec = voiced.length * track.hop;

  const meanRms = voicedRms.length ? voicedRms.reduce((a, b) => a + b, 0) / voicedRms.length : 0;
  const p95 = percentile(voicedRms, 0.95);
  const p10 = percentile(voicedRms, 0.1);

  // ---- 频域：谱质心与谱平坦度（只在有声帧上统计） ----
  const fft = new FFT(SPEC_WIN);
  const win = hann(SPEC_WIN);
  const re = new Float64Array(SPEC_WIN);
  const im = new Float64Array(SPEC_WIN);
  const binHz = sampleRate / SPEC_WIN;
  const loBin = Math.max(1, Math.floor(50 / binHz));
  const hiBin = Math.min(SPEC_WIN / 2 - 1, Math.floor(Math.min(8000, sampleRate / 2) / binHz));

  let centSum = 0;
  let flatSum = 0;
  let specCount = 0;
  // 最多取 200 帧做频谱统计：再多对均值没有影响，但会明显拖慢长录音
  const step = Math.max(1, Math.ceil(voiced.length / 200));
  for (let vi = 0; vi < voiced.length; vi += step) {
    const center = Math.round(voiced[vi].t * sampleRate);
    const start = center - SPEC_WIN / 2;
    if (start < 0 || start + SPEC_WIN > samples.length) continue;
    for (let i = 0; i < SPEC_WIN; i++) {
      re[i] = samples[start + i] * win[i];
      im[i] = 0;
    }
    fft.forward(re, im);

    let wsum = 0;
    let wfreq = 0;
    let logSum = 0;
    let linSum = 0;
    let bins = 0;
    for (let b = loBin; b <= hiBin; b++) {
      const p = re[b] * re[b] + im[b] * im[b];
      const mag = Math.sqrt(p);
      wsum += mag;
      wfreq += mag * b * binHz;
      logSum += Math.log(p + 1e-20);
      linSum += p + 1e-20;
      bins++;
    }
    if (wsum > 1e-9 && bins > 0) {
      centSum += wfreq / wsum;
      // 谱平坦度 = 几何均值 / 算术均值
      flatSum += Math.exp(logSum / bins) / (linSum / bins);
      specCount++;
    }
  }

  // ---- 微扰动：只在「持续音」上算 ----
  const pert = perturbation(track);

  const noiseDb = toDb(track.noiseFloor);
  const meanDb = toDb(meanRms);

  return {
    duration: track.duration,
    voicedRatio: voiced.length / track.frames.length,
    voicedSec,
    peakDb: toDb(peak),
    meanDb,
    dynamicRangeDb: voicedRms.length >= 10 ? Math.max(0, toDb(p95) - toDb(p10)) : 0,
    clipRatio: clipped / samples.length,
    snrDb: Math.max(0, meanDb - noiseDb),
    centroidHz: specCount ? centSum / specCount : 0,
    flatness: specCount ? flatSum / specCount : 0,
    jitterPct: pert.jitter,
    shimmerPct: pert.shimmer,
    perturbationBasisSec: pert.basisSec,
  };
}

/**
 * Jitter / Shimmer 类指标。
 *
 * 严格定义要按「逐个基音周期」测，我们只有 10ms 一帧的轨迹，
 * 所以这是帧级近似——数值不能和临床软件的读数直接比较，
 * 只适合在同一个人、同一套设备上做纵向对比。
 *
 * 只在「持续音」段上算：音高本来就在动的地方（滑音、跳进）算出来没意义。
 */
function perturbation(track: PitchTrack): { jitter: number; shimmer: number; basisSec: number } {
  const f = track.frames;
  let jNum = 0;
  let jDen = 0;
  let sNum = 0;
  let sDen = 0;
  let count = 0;

  let i = 0;
  while (i < f.length) {
    if (!f[i].voiced) {
      i++;
      continue;
    }
    let j = i;
    while (j < f.length && f[j].voiced) j++;
    const runLen = j - i;
    // 至少 0.3 秒的连续发声才参与统计
    if (runLen >= 30) {
      for (let k = i + 1; k < j; k++) {
        // 跳过明显在移动的部分（半音以上的帧间跳变 = 换音，不是抖动）
        if (Math.abs(f[k].midi - f[k - 1].midi) > 1) continue;
        const t1 = 1 / f[k - 1].f0;
        const t2 = 1 / f[k].f0;
        jNum += Math.abs(t2 - t1);
        jDen += t2;
        sNum += Math.abs(f[k].rms - f[k - 1].rms);
        sDen += f[k].rms;
        count++;
      }
    }
    i = j;
  }

  return {
    jitter: jDen > 0 ? (jNum / jDen) * 100 : 0,
    shimmer: sDen > 0 ? (sNum / sDen) * 100 : 0,
    basisSec: count * track.hop,
  };
}
