/**
 * 嗓音状态分析：判断你是在「唱」还是在「喊」。
 *
 * 这是训练营最重要的一环——唱高音伤不伤嗓，本人当下往往感觉不出来，
 * 等到嗓子哑了已经晚了。这里用几个能从麦克风直接测到的信号做实时预警：
 *
 *  1. 抖         音高在小范围内快速晃 → 声带在硬扛，撑不住
 *  2. 破音       音高突然跳掉一大截又回来 → 换声点没过去
 *  3. 越唱越响   音越高、音量涨得越猛 → 典型的「用喊代替唱」
 *  4. 发虚       有音量但波形不成调 → 漏气，声带没合上
 *
 * 这几条都不需要复杂的声学模型，但组合起来对「费嗓」的判断相当准。
 */

import type { PitchResult } from './pitch';

export interface StrainState {
  /** 0~1，越大越费嗓 */
  level: number;
  /** 当前最该提醒的一句话，没问题时为 null */
  tip: string | null;
  /** 细分标记，用于界面显示 */
  wobble: boolean;
  crack: boolean;
  pushing: boolean;
  breathy: boolean;
}

interface Sample {
  t: number;
  midi: number;
  rms: number;
  clarity: number;
}

const WINDOW = 0.6; // 分析窗口（秒）
const CRACK_JUMP = 2.5; // 判定为破音的音高跳变（半音）
const CRACK_HOLD = 1.2; // 破音提示保持时间（秒）

export class StrainMeter {
  private samples: Sample[] = [];
  private t = 0;
  private crackAt = -99;
  /** 本轮练习开始时的音高/音量基线，用来判断「越唱越响」 */
  private baseMidi = 0;
  private baseRms = 0;
  private baseCount = 0;
  private smooth = 0;

  /** 每条练习开始时调用，重置基线 */
  reset() {
    this.samples = [];
    this.crackAt = -99;
    this.baseMidi = 0;
    this.baseRms = 0;
    this.baseCount = 0;
    this.smooth = 0;
  }

  /** 每帧调用一次。p 为 null 表示这一帧没在发声 */
  push(p: PitchResult | null, dt: number) {
    this.t += dt;
    if (!p) {
      // 静音时窗口自然老化，但不清空基线
      this.trim();
      this.smooth *= Math.max(0, 1 - dt * 2);
      return;
    }

    // 破音检测：跟上一帧比跳了一大截
    const prev = this.samples[this.samples.length - 1];
    if (prev && this.t - prev.t < 0.12 && Math.abs(p.midi - prev.midi) > CRACK_JUMP) {
      this.crackAt = this.t;
    }

    this.samples.push({ t: this.t, midi: p.midi, rms: p.rms, clarity: p.clarity });
    this.trim();

    // 前 0.8 秒的发声当作基线（练习都是从舒适音区起头的）
    if (this.baseCount < 40 && this.t < 1.6) {
      this.baseMidi = (this.baseMidi * this.baseCount + p.midi) / (this.baseCount + 1);
      this.baseRms = (this.baseRms * this.baseCount + p.rms) / (this.baseCount + 1);
      this.baseCount++;
    }
  }

  private trim() {
    const cutoff = this.t - WINDOW;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
  }

  /** 读取当前状态 */
  read(): StrainState {
    const s = this.samples;
    const crack = this.t - this.crackAt < CRACK_HOLD;

    if (s.length < 6) {
      // 样本不够，只保留破音结论
      const level = crack ? 0.75 : this.smooth * 0.9;
      this.smooth = level;
      return { level, tip: crack ? '破音了——降回去两个音，别硬顶' : null, wobble: false, crack, pushing: false, breathy: false };
    }

    // 1) 抖：窗口内音高标准差
    const mean = s.reduce((a, b) => a + b.midi, 0) / s.length;
    const variance = s.reduce((a, b) => a + (b.midi - mean) ** 2, 0) / s.length;
    const sd = Math.sqrt(variance);
    const wobble = sd > 0.45;

    // 2) 越唱越响：音升高的同时音量涨得比音高快得多
    const rms = s.reduce((a, b) => a + b.rms, 0) / s.length;
    const semisUp = this.baseCount > 8 ? mean - this.baseMidi : 0;
    const loudRatio = this.baseRms > 0.001 ? rms / this.baseRms : 1;
    // 往上唱 12 个半音，音量涨到 1.8 倍以内算正常；超出越多越像在喊
    const allowed = 1 + Math.max(0, semisUp) * 0.07;
    const pushing = semisUp > 2 && loudRatio > allowed + 0.5;

    // 3) 发虚：有音量但波形清晰度低
    const clarity = s.reduce((a, b) => a + b.clarity, 0) / s.length;
    const breathy = clarity < 0.9 && rms > 0.02;

    // 综合：取各分量的加权最大值，再做时间平滑，避免指示灯乱闪
    const raw = Math.max(
      crack ? 0.85 : 0,
      Math.min(1, (sd - 0.2) / 0.6),
      pushing ? Math.min(1, 0.45 + (loudRatio - allowed) * 0.35) : 0,
      breathy ? 0.4 : 0,
    );
    this.smooth += (raw - this.smooth) * 0.12;
    const level = Math.max(0, Math.min(1, this.smooth));

    // 提示语按严重程度排序，一次只说一句，说人话
    let tip: string | null = null;
    if (crack) tip = '破音了——降回去两个音，别硬顶';
    else if (pushing) tip = '有点在喊了。同样的音高，试着唱得更小声';
    else if (wobble) tip = '声音在抖，说明嗓子在硬撑。深吸一口气再来';
    else if (breathy) tip = '气漏了，声音发虚。嘴唇再收一点';

    return { level, tip, wobble, crack, pushing, breathy };
  }

  /** 这一轮整体表现是否轻松（结算用） */
  verdict(peakLevel: number): { text: string; ok: boolean } {
    if (peakLevel < 0.35) return { text: '全程轻松，嗓子状态很好 👍', ok: true };
    if (peakLevel < 0.6) return { text: '基本轻松，个别高音略紧', ok: true };
    if (peakLevel < 0.8) return { text: '有点费嗓了，下次起音降低两个半音', ok: false };
    return { text: '这轮唱得太用力，明天减量，别硬练', ok: false };
  }
}

/** 把 0~1 的紧张度映射成颜色（绿→黄→红） */
export function strainColor(level: number): string {
  if (level < 0.35) return '#66bb6a';
  if (level < 0.6) return '#ffd54f';
  if (level < 0.8) return '#ff8a65';
  return '#ef5350';
}

export function strainLabel(level: number): string {
  if (level < 0.35) return '轻松';
  if (level < 0.6) return '略紧';
  if (level < 0.8) return '偏费嗓';
  return '在喊了';
}
