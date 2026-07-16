/**
 * 参考音与伴奏旋律合成：全部用 Web Audio 振荡器 + 包络实时生成,
 * 不加载任何音频文件。与麦克风共用同一个 AudioContext。
 */

import { midiToFreq } from './pitch';
import type { SongNote } from './songs';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

/** 共享的 AudioContext（麦克风与合成器共用） */
export function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** 需在用户手势中调用以解锁音频 */
export function resumeAudio() {
  const c = audioCtx();
  if (c.state === 'suspended') void c.resume();
}

/**
 * 播一个柔和的"八音盒"音色单音。
 * @param when 相对当前的延迟（秒） @returns 该音的结束时间（ctx 时间）
 */
export function playTone(midi: number, dur = 0.8, when = 0, vol = 0.3): number {
  const c = audioCtx();
  const t0 = c.currentTime + when;
  const f = midiToFreq(midi);
  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(vol, t0 + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  g.connect(master!);

  // 基波 + 弱二次谐波，接近八音盒/口琴的柔和感
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

/** 简短的成功/失败提示音 */
export function playCue(ok: boolean) {
  if (ok) {
    playTone(84, 0.15, 0, 0.2);
    playTone(88, 0.25, 0.08, 0.2);
  } else {
    playTone(52, 0.3, 0, 0.18);
  }
}

/**
 * 旋律播放器：一次性把整首歌调度到 AudioContext 时间线上，
 * 通过 beatNow() 查询当前进行到第几拍（用于卷帘滚动与打分对齐）。
 */
export class MelodyPlayer {
  private startTime = 0; // ctx 时间
  private secPerBeat = 0.5;
  private gains: GainNode[] = [];
  private oscs: OscillatorNode[] = [];
  private endTimer = 0;
  playing = false;

  /**
   * @param leadInBeats 前奏空拍（给用户准备）
   * @param volume 伴奏音量（0 表示静音伴奏、只走进度）
   */
  play(
    notes: SongNote[],
    bpm: number,
    transpose: number,
    leadInBeats: number,
    volume: number,
    onEnd?: () => void,
  ) {
    this.stop();
    const c = audioCtx();
    this.secPerBeat = 60 / bpm;
    this.startTime = c.currentTime + 0.05;
    this.playing = true;

    let beat = leadInBeats;
    let totalBeats = leadInBeats;
    for (const n of notes) totalBeats += n.d;

    for (const n of notes) {
      if (n.m > 0 && volume > 0.001) {
        const t0 = this.startTime + beat * this.secPerBeat;
        const dur = Math.max(0.15, n.d * this.secPerBeat * 0.95);
        const f = midiToFreq(n.m + transpose);
        const g = c.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(volume, t0 + 0.025);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        g.connect(master!);
        const o1 = c.createOscillator();
        o1.type = 'sine';
        o1.frequency.value = f;
        o1.connect(g);
        const g2 = c.createGain();
        g2.gain.value = 0.22;
        g2.connect(g);
        const o2 = c.createOscillator();
        o2.type = 'sine';
        o2.frequency.value = f * 2;
        o2.connect(g2);
        o1.start(t0);
        o2.start(t0);
        o1.stop(t0 + dur + 0.05);
        o2.stop(t0 + dur + 0.05);
        this.gains.push(g);
        this.oscs.push(o1, o2);
      }
      beat += n.d;
    }

    const totalSec = (totalBeats + 2) * this.secPerBeat;
    this.endTimer = window.setTimeout(() => {
      this.playing = false;
      onEnd?.();
    }, totalSec * 1000);
  }

  /** 当前进行到的拍数（前奏期间为 0 ~ leadInBeats） */
  beatNow(): number {
    if (!this.playing) return 0;
    return (audioCtx().currentTime - this.startTime) / this.secPerBeat;
  }

  stop() {
    clearTimeout(this.endTimer);
    for (const o of this.oscs) {
      try {
        o.stop();
      } catch {
        // 已停止的忽略
      }
    }
    for (const g of this.gains) g.disconnect();
    this.oscs = [];
    this.gains = [];
    this.playing = false;
  }
}
