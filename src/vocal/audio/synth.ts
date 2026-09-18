/**
 * 参考音与伴奏合成。
 *
 * 全部用振荡器实时生成，不加载任何音频文件——这既是版权上的干净做法
 * （没有任何录音制品），也让「移调/变速」变成改两个数的事。
 */

import { midiToFreq } from '../dsp/notes';
import type { Reference } from '../analysis/types';
import { audioCtx, masterGain } from './context';

/** 一个柔和的单音（基波 + 弱二次谐波，接近八音盒/电钢的听感） */
export function playTone(midi: number, dur = 0.8, when = 0, vol = 0.3): number {
  const c = audioCtx();
  const t0 = c.currentTime + when;
  const f = midiToFreq(midi);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(masterGain());

  const o1 = c.createOscillator();
  o1.type = 'sine';
  o1.frequency.value = f;
  o1.connect(g);

  const g2 = c.createGain();
  g2.gain.value = 0.25;
  g2.connect(g);
  const o2 = c.createOscillator();
  o2.type = 'sine';
  o2.frequency.value = f * 2;
  o2.connect(g2);

  o1.start(t0);
  o2.start(t0);
  o1.stop(t0 + dur + 0.05);
  o2.stop(t0 + dur + 0.05);
  return t0 + dur;
}

/** 节拍器的「哒」：短噪声脉冲，重拍更亮 */
export function playClick(when = 0, accent = false): void {
  const c = audioCtx();
  const t0 = c.currentTime + when;
  const g = c.createGain();
  g.gain.setValueAtTime(accent ? 0.25 : 0.14, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06);
  g.connect(masterGain());
  const o = c.createOscillator();
  o.type = 'square';
  o.frequency.value = accent ? 1600 : 1100;
  o.connect(g);
  o.start(t0);
  o.stop(t0 + 0.07);
}

/** 连续滑音示范（音高跟踪练习用）。返回停止函数 */
export function playGlide(points: { midi: number; at: number }[], vol = 0.22): () => void {
  const c = audioCtx();
  const t0 = c.currentTime + 0.03;
  const total = points[points.length - 1].at;
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.08);
  g.gain.setValueAtTime(vol, t0 + total - 0.12);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + total);
  g.connect(masterGain());

  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(midiToFreq(points[0].midi), t0);
  // 指数插值才符合听感——音高是对数的
  for (const p of points.slice(1)) {
    o.frequency.exponentialRampToValueAtTime(midiToFreq(p.midi), t0 + p.at);
  }
  o.connect(g);
  o.start(t0);
  o.stop(t0 + total + 0.05);
  return () => {
    try {
      o.stop();
    } catch {
      // 已停止
    }
    g.disconnect();
  };
}

/**
 * 伴奏播放器。
 *
 * 一次性把整段旋律挂到 AudioContext 的时间线上（比用 setTimeout 逐个触发精确得多），
 * 界面通过 timeNow() 查询「现在演到第几秒」，和 Reference 里的秒数是同一把尺子。
 */
export class Accompaniment {
  private startTime = 0;
  private nodes: { osc: OscillatorNode[]; gains: GainNode[] } = { osc: [], gains: [] };
  private endTimer = 0;
  private duration = 0;
  playing = false;

  /**
   * @param volume 0 表示静音伴奏（考试模式可以只走进度不出声）
   * @param withClicks 前奏期间是否打节拍
   * @returns 参考时间轴 t=0 对应的 AudioContext 时刻
   */
  play(ref: Reference, volume = 0.18, withClicks = true, onEnd?: () => void): number {
    this.stop();
    const c = audioCtx();
    this.startTime = c.currentTime + 0.12; // 留一点调度余量，避免第一个音被截
    this.playing = true;
    this.duration = ref.totalSec;

    if (volume > 0.001) {
      for (const n of ref.playback) {
        const t0 = this.startTime + n.start;
        const dur = Math.max(0.12, n.dur * 0.92);
        const f = midiToFreq(n.midi);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(volume, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(masterGain());

        const o1 = c.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = f;
        o1.connect(g);
        const g2 = c.createGain();
        g2.gain.value = 0.2;
        g2.connect(g);
        const o2 = c.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 2;
        o2.connect(g2);

        o1.start(t0);
        o2.start(t0);
        o1.stop(t0 + dur + 0.05);
        o2.stop(t0 + dur + 0.05);
        this.nodes.osc.push(o1, o2);
        this.nodes.gains.push(g, g2);
      }
    }

    // 前奏打拍：让用户知道什么时候该进
    if (withClicks && ref.bpm) {
      const spb = 60 / ref.bpm;
      const firstNote = ref.notes[0]?.start ?? ref.totalSec;
      const beats = Math.max(0, Math.floor(firstNote / spb));
      for (let b = 0; b < Math.min(beats, 8); b++) {
        playClick(this.startTime - c.currentTime + b * spb, b % 4 === 0);
      }
    }

    this.endTimer = window.setTimeout(
      () => {
        this.playing = false;
        onEnd?.();
      },
      (ref.totalSec + 0.4) * 1000,
    );
    return this.startTime;
  }

  /** 当前进行到参考时间轴的第几秒（前奏期间是小于第一个音起点的正数） */
  timeNow(): number {
    if (!this.playing) return 0;
    return audioCtx().currentTime - this.startTime;
  }

  get totalSec(): number {
    return this.duration;
  }

  stop(): void {
    clearTimeout(this.endTimer);
    for (const o of this.nodes.osc) {
      try {
        o.stop();
      } catch {
        // 已停止的忽略
      }
    }
    for (const g of this.nodes.gains) g.disconnect();
    this.nodes = { osc: [], gains: [] };
    this.playing = false;
  }
}

/** 节拍器：训练模式用，返回停止函数 */
export function startMetronome(bpm: number, beatsPerBar = 4, onBeat?: (beat: number) => void): () => void {
  const spb = 60 / bpm;
  let beat = 0;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    playClick(0, beat % beatsPerBar === 0);
    onBeat?.(beat);
    beat++;
    timer = window.setTimeout(tick, spb * 1000);
  };
  let timer = window.setTimeout(tick, 0);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
