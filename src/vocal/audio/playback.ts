/**
 * 录音回放。
 *
 * 把采集到的 Float32Array 装回 AudioBuffer 再播——因为我们存的是原始 PCM，
 * 所以回放、跳转、局部试听都不需要解码，指哪打哪。
 * 复盘时「点一个红色的音，只听那半秒」就是靠这个实现的。
 */

import { audioCtx, masterGain } from './context';

export class Playback {
  private buffer: AudioBuffer | null = null;
  private src: AudioBufferSourceNode | null = null;
  private startedAt = 0;
  private offset = 0;
  private endTimer = 0;
  playing = false;
  onEnd: (() => void) | null = null;

  /** 装载一段录音 */
  load(samples: Float32Array, sampleRate: number): void {
    this.stop();
    const c = audioCtx();
    // 有些浏览器不允许创建低于 3000Hz 的 buffer，实际设备不会出现，防一手
    const sr = Math.max(3000, sampleRate);
    const buf = c.createBuffer(1, Math.max(1, samples.length), sr);
    // 用 set 而不是 copyToChannel：后者在类型上要求 Float32Array<ArrayBuffer>，
    // 而我们的样本可能来自任意 ArrayBufferLike，set 没有这个约束
    buf.getChannelData(0).set(samples);
    this.buffer = buf;
  }

  get duration(): number {
    return this.buffer?.duration ?? 0;
  }

  /** 从 from 秒开始播；给了 dur 就只播这一小段（复盘时试听单个音） */
  play(from = 0, dur?: number): void {
    if (!this.buffer) return;
    this.stop();
    const c = audioCtx();
    const src = c.createBufferSource();
    src.buffer = this.buffer;
    const g = c.createGain();
    g.gain.value = 1;
    src.connect(g).connect(masterGain());
    const start = Math.max(0, Math.min(from, this.buffer.duration));
    const length = dur === undefined ? undefined : Math.max(0.05, dur);
    src.start(0, start, length);
    this.src = src;
    this.startedAt = c.currentTime;
    this.offset = start;
    this.playing = true;

    const runFor = (length ?? this.buffer.duration - start) * 1000 + 60;
    this.endTimer = window.setTimeout(() => {
      this.playing = false;
      this.onEnd?.();
    }, runFor);
  }

  /** 当前播放位置（秒） */
  positionNow(): number {
    if (!this.playing) return this.offset;
    return this.offset + (audioCtx().currentTime - this.startedAt);
  }

  stop(): void {
    clearTimeout(this.endTimer);
    if (this.src) {
      try {
        this.src.stop();
      } catch {
        // 已停止
      }
      this.src.disconnect();
      this.src = null;
    }
    this.playing = false;
  }

  dispose(): void {
    this.stop();
    this.buffer = null;
  }
}

/** 把录音导出成 WAV（用户想自己留一份时用），16bit PCM */
export function toWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const view = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  view.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}
