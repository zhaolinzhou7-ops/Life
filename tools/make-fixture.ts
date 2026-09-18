import { writeFileSync, mkdirSync } from 'node:fs';
import { buildReference, SONG_BY_ID } from '../src/vocal/songs/library';
import { SR, singReference } from './fake-singer';

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
writeWav(`${dir}/flat.wav`, singReference(star, { bias: -45, pitchJitter: 12, leadSilence: 0.4 }));
// 唱得准的一版
writeWav(`${dir}/good.wav`, singReference(star, { pitchJitter: 8, timeJitter: 0.03, leadSilence: 0.4 }));
// 没声音：用来测「录音质量把关」在真实界面上的表现
writeWav(`${dir}/silent.wav`, silence(12));
