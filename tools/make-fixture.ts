/**
 * 生成 UI 测试用的「假唱」音频。
 *
 * Chromium 支持用一个 WAV 文件冒充麦克风输入
 * （--use-file-for-fake-audio-capture），所以我们可以在真实浏览器里
 * 跑完整的「录音 → 分析 → 出报告」流程，而不需要真人对着话筒唱。
 *
 * 生成的几段音频里故意注入了已知的毛病（比如整体偏低 45 音分），
 * 这样 UI 测试就能断言「应用确实把这个问题找出来了」。
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { midiToFreq } from '../src/vocal/dsp/notes';
import { buildReference, SONG_BY_ID } from '../src/vocal/songs/library';
import type { Reference } from '../src/vocal/analysis/types';

const SR = 48000;

function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

/** 谐波丰富的激励，比纯正弦更接近人声 */
function voice(phase: number): number {
  let v = 0;
  for (let k = 1; k <= 14; k++) v += Math.sin(phase * k) / k;
  return v * 0.5;
}

interface Opts {
  /** 整体音高偏移（音分） */
  bias?: number;
  /** 每个音的随机误差（音分） */
  jitter?: number;
  /** 起音随机抖动（秒） */
  timeJitter?: number;
  amp?: number;
  seed?: number;
  /** 录音开始到伴奏开始之间的空白（秒），模拟真实的启动时差 */
  leadSilence?: number;
}

function sing(ref: Reference, o: Opts = {}): Float32Array {
  const lead = o.leadSilence ?? 0;
  const total = Math.round((ref.totalSec + lead + 1.2) * SR);
  const buf = new Float32Array(total);
  const rand = rng(o.seed ?? 11);
  const amp = o.amp ?? 0.26;

  for (const note of ref.notes) {
    let cents = o.bias ?? 0;
    if (o.jitter) cents += (rand() * 2 - 1) * o.jitter;
    let start = note.start + lead;
    if (o.timeJitter) start += (rand() * 2 - 1) * o.timeJitter;
    const dur = note.dur * 0.88;
    const from = Math.round(Math.max(0, start) * SR);
    const len = Math.round(dur * SR);
    let phase = 0;
    for (let i = 0; i < len; i++) {
      const idx = from + i;
      if (idx >= total) break;
      phase += (2 * Math.PI * midiToFreq(note.midi + cents / 100)) / SR;
      const fade = Math.min(1, i / (0.025 * SR), (len - i) / (0.025 * SR));
      buf[idx] += amp * fade * voice(phase);
    }
  }
  return buf;
}

function silence(sec: number): Float32Array {
  return new Float32Array(Math.round(sec * SR));
}

/** 写 16bit 单声道 WAV —— Chromium 的假麦克风只吃这个格式 */
function writeWav(path: string, samples: Float32Array): void {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), 44 + i * 2);
  }
  writeFileSync(path, buf);
  console.log(`${path}  ${(n / SR).toFixed(1)}s  ${(buf.length / 1024).toFixed(0)}KB`);
}

const dir = process.argv[2] ?? 'node_modules/.cache/vocal-fixtures';
mkdirSync(dir, { recursive: true });

const star = buildReference(SONG_BY_ID.get('star')!);

// 整体偏低 45 音分——UI 测试会断言应用把这个问题找出来
writeWav(`${dir}/flat.wav`, sing(star, { bias: -45, jitter: 12, leadSilence: 0.4 }));
// 唱得准的一版
writeWav(`${dir}/good.wav`, sing(star, { jitter: 8, timeJitter: 0.03, leadSilence: 0.4 }));
// 没声音：用来测「录音质量把关」在真实界面上的表现
writeWav(`${dir}/silent.wav`, silence(12));
