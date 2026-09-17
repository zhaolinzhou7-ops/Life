/**
 * AI 唱歌教练 · 算法层测试。
 *
 * 全部用合成音频跑，不需要麦克风也不需要浏览器：
 *   node_modules/.bin/esbuild tools/vocal-test.ts --bundle --platform=node --format=esm \
 *     --outfile=node_modules/.cache/vocal-test.mjs && node node_modules/.cache/vocal-test.mjs
 * 或直接 `npm run test:vocal`。
 */

import { FFT, autocorrelation } from '../src/vocal/dsp/fft';
import { trackPitch, PITCH_RATE } from '../src/vocal/dsp/pitch';
import { midiToFreq, freqToMidi, midiToName } from '../src/vocal/dsp/notes';
import { analyzePerformance } from '../src/vocal/analysis/performance';
import { buildReference, SONG_BY_ID } from '../src/vocal/songs/library';
import type { Finding, Reference } from '../src/vocal/analysis/types';

// ---------------------------------------------------------------- 测试框架

let passed = 0;
let failed = 0;
const failures: string[] = [];
let group = '';

function describe(name: string, fn: () => void) {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
  fn();
}

function ok(cond: boolean, name: string, detail = '') {
  if (cond) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  } else {
    failed++;
    failures.push(`${group} → ${name}${detail ? `  (${detail})` : ''}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? `  ${detail}` : ''}`);
  }
}

function near(actual: number, expect: number, tol: number, name: string, unit = '') {
  const d = Math.abs(actual - expect);
  ok(d <= tol, name, `期望 ${expect.toFixed(2)}${unit}，实测 ${actual.toFixed(2)}${unit}，差 ${d.toFixed(2)}（容差 ${tol}）`);
}

// ---------------------------------------------------------------- 合成音频

const SR = 48000; // 模拟真实麦克风采样率

/** 类人声的激励：谐波按 1/k 衰减，比纯正弦更接近真嗓子，也更难测 */
function voiceSample(phase: number, harmonics = 14): number {
  let v = 0;
  for (let k = 1; k <= harmonics; k++) v += Math.sin(phase * k) / k;
  return v * 0.5;
}

interface ToneOpts {
  /** 起始 MIDI 音高 */
  midi: number;
  /** 终止 MIDI（滑音用），默认与起始相同 */
  toMidi?: number;
  sec: number;
  amp?: number;
  /** 颤音深度（半音）与频率（Hz） */
  vibrato?: { depth: number; rate: number };
  /** 纯正弦而不是谐波丰富的人声 */
  pure?: boolean;
  sr?: number;
}

/** 生成一段音，支持滑音与颤音 */
function tone(o: ToneOpts): Float32Array {
  const sr = o.sr ?? SR;
  const n = Math.round(o.sec * sr);
  const out = new Float32Array(n);
  const amp = o.amp ?? 0.3;
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const p = n > 1 ? i / (n - 1) : 0;
    let m = o.midi + (o.toMidi !== undefined ? (o.toMidi - o.midi) * p : 0);
    if (o.vibrato) m += o.vibrato.depth * Math.sin((2 * Math.PI * o.vibrato.rate * i) / sr);
    phase += (2 * Math.PI * midiToFreq(m)) / sr;
    // 起止加 20ms 淡入淡出，避免咔哒声污染检测
    const fade = Math.min(1, (i / sr) / 0.02, ((n - 1 - i) / sr) / 0.02);
    out[i] = amp * fade * (o.pure ? Math.sin(phase) : voiceSample(phase));
  }
  return out;
}

function silence(sec: number, sr = SR): Float32Array {
  return new Float32Array(Math.round(sec * sr));
}

function noise(sec: number, amp = 0.02, sr = SR): Float32Array {
  const n = Math.round(sec * sr);
  const out = new Float32Array(n);
  let seed = 12345;
  for (let i = 0; i < n; i++) {
    // 固定种子的线性同余，保证测试可复现
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((seed / 0x7fffffff) * 2 - 1) * amp;
  }
  return out;
}

function concat(...parts: Float32Array[]): Float32Array {
  const n = parts.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(n);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

function mix(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(Math.max(a.length, b.length));
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) + (b[i] ?? 0);
  return out;
}

/** 削波（爆音）：超过阈值直接砍平 */
function clip(x: Float32Array, level = 0.5): Float32Array {
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = Math.max(-level, Math.min(level, x[i] * 3));
  return out;
}

/** 有声帧音高的中位数 */
function medianMidi(x: Float32Array, sr = SR): number {
  const tr = trackPitch(x, sr);
  const v = tr.frames.filter((f) => f.voiced).map((f) => f.midi).sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : 0;
}

function voicedRatio(x: Float32Array, sr = SR): number {
  const tr = trackPitch(x, sr);
  return tr.frames.length ? tr.frames.filter((f) => f.voiced).length / tr.frames.length : 0;
}

// ---------------------------------------------------------------- FFT

describe('FFT', () => {
  const n = 64;
  const fft = new FFT(n);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let i = 0; i < n; i++) re[i] = Math.cos((2 * Math.PI * 5 * i) / n);
  fft.forward(re, im);
  let peak = 0;
  let peakBin = 0;
  for (let i = 0; i < n / 2; i++) {
    const mag = Math.hypot(re[i], im[i]);
    if (mag > peak) {
      peak = mag;
      peakBin = i;
    }
  }
  ok(peakBin === 5, '正变换把 5 周期余弦放在第 5 个频点', `峰在 bin ${peakBin}`);

  // 往返：FFT → IFFT 应该还原原信号
  const src = new Float64Array(n);
  for (let i = 0; i < n; i++) src[i] = Math.sin(i * 0.7) + 0.3 * Math.cos(i * 2.1);
  const r2 = Float64Array.from(src);
  const i2 = new Float64Array(n);
  fft.forward(r2, i2);
  fft.inverse(r2, i2);
  let maxErr = 0;
  for (let i = 0; i < n; i++) maxErr = Math.max(maxErr, Math.abs(r2[i] - src[i]));
  ok(maxErr < 1e-9, 'FFT → IFFT 往返无损', `最大误差 ${maxErr.toExponential(2)}`);

  // 自相关：周期信号的自相关应在整周期处出现峰
  const N = 512;
  const sig = new Float32Array(N);
  const period = 40;
  for (let i = 0; i < N; i++) sig[i] = Math.sin((2 * Math.PI * i) / period);
  const f2 = new FFT(1024);
  const out = new Float64Array(N);
  autocorrelation(sig, N, f2, out, { re: new Float64Array(1024), im: new Float64Array(1024) });
  let bestLag = 0;
  for (let t = 10; t < 200; t++) if (out[t] > out[bestLag] || bestLag === 0) bestLag = t;
  ok(Math.abs(bestLag - period) <= 1, '自相关峰落在信号周期上', `周期 ${period}，峰在 lag ${bestLag}`);
});

// ---------------------------------------------------------------- 音高检测

describe('音高检测 · 基础准确性', () => {
  for (const name of ['C3', 'A3', 'C4', 'E4', 'A4', 'C5', 'A5']) {
    const midi = { C3: 48, A3: 57, C4: 60, E4: 64, A4: 69, C5: 72, A5: 81 }[name]!;
    const got = medianMidi(tone({ midi, sec: 1.2 }));
    near(got, midi, 0.25, `${name}（人声谐波）测得准`, ' 半音');
  }
  const pure = medianMidi(tone({ midi: 67, sec: 1, pure: true }));
  near(pure, 67, 0.2, '纯正弦 G4 测得准', ' 半音');

  // 低采样率输入（部分设备是 16k）也要能work
  const lowSr = medianMidi(tone({ midi: 60, sec: 1, sr: 16000 }), 16000);
  near(lowSr, 60, 0.3, '16kHz 输入同样测得准', ' 半音');
});

describe('音高检测 · 八度不出错', () => {
  // 八度错误是最要命的失败模式：会告诉用户「你低了 12 个半音」
  for (const midi of [45, 50, 55, 60, 65, 70, 75, 80]) {
    const got = medianMidi(tone({ midi, sec: 1 }));
    const err = Math.abs(got - midi);
    ok(err < 1, `${midiToName(midi)} 没有八度误判`, `实测 ${got.toFixed(2)}（${midiToName(got)}）`);
  }
});

describe('音高检测 · 唱法变化', () => {
  const vib = medianMidi(tone({ midi: 64, sec: 2, vibrato: { depth: 0.5, rate: 5.5 } }));
  near(vib, 64, 0.35, '颤音的中心音高仍然正确', ' 半音');

  // 滑音：从 C4 滑到 G4，轨迹应该单调上行并覆盖整个区间
  const tr = trackPitch(tone({ midi: 60, toMidi: 67, sec: 2 }), SR);
  const v = tr.frames.filter((f) => f.voiced);
  const first = v.slice(0, 10).reduce((a, b) => a + b.midi, 0) / 10;
  const last = v.slice(-10).reduce((a, b) => a + b.midi, 0) / 10;
  near(first, 60, 0.6, '滑音起点是 C4', ' 半音');
  near(last, 67, 0.6, '滑音终点是 G4', ' 半音');
  let rises = 0;
  for (let i = 1; i < v.length; i++) if (v[i].midi >= v[i - 1].midi - 0.05) rises++;
  ok(rises / (v.length - 1) > 0.9, '滑音轨迹基本单调上行', `${((rises / (v.length - 1)) * 100).toFixed(0)}% 的帧不下降`);
});

describe('音高检测 · 异常输入', () => {
  ok(voicedRatio(silence(1)) === 0, '纯静音不产生任何有声帧');
  ok(trackPitch(silence(1), SR).frames.length > 0, '静音也照常产出帧（不崩）');

  const noiseRatio = voicedRatio(noise(1.5, 0.05));
  ok(noiseRatio < 0.12, '白噪声几乎不被误判成唱歌', `有声帧占比 ${(noiseRatio * 100).toFixed(1)}%`);

  const quiet = medianMidi(tone({ midi: 60, sec: 1, amp: 0.012 }));
  near(quiet, 60, 0.4, '音量很小（约 -45dBFS）仍测得出音高', ' 半音');

  const tooQuiet = voicedRatio(tone({ midi: 60, sec: 1, amp: 0.001 }));
  ok(tooQuiet < 0.2, '音量低到接近底噪时不硬报音高', `有声帧占比 ${(tooQuiet * 100).toFixed(1)}%`);

  const clipped = medianMidi(clip(tone({ midi: 60, sec: 1, amp: 0.4 })));
  near(clipped, 60, 0.5, '爆音（削波）后音高仍然可用', ' 半音');

  const noisy = medianMidi(mix(tone({ midi: 62, sec: 1.2, amp: 0.25 }), noise(1.2, 0.03)));
  near(noisy, 62, 0.5, '带环境底噪也能测准', ' 半音');

  const short = trackPitch(tone({ midi: 60, sec: 0.08 }), SR);
  ok(short.frames.length >= 0, '极短录音不崩', `${short.frames.length} 帧`);

  const empty = trackPitch(new Float32Array(0), SR);
  ok(empty.frames.length === 0 && empty.duration === 0, '空录音返回空结果');
});

describe('音高检测 · 分段', () => {
  // 唱—停—唱：中间的静音应该把两段隔开
  const seq = concat(tone({ midi: 60, sec: 0.8 }), silence(0.5), tone({ midi: 67, sec: 0.8 }));
  const tr = trackPitch(seq, SR);
  const segs: { from: number; to: number }[] = [];
  let cur: { from: number; to: number } | null = null;
  for (const f of tr.frames) {
    if (f.voiced && !cur) cur = { from: f.t, to: f.t };
    else if (f.voiced && cur) cur.to = f.t;
    else if (!f.voiced && cur) {
      segs.push(cur);
      cur = null;
    }
  }
  if (cur) segs.push(cur);
  ok(segs.length === 2, '唱—停—唱被正确切成两段', `切出 ${segs.length} 段`);
  const perf = trackPitch(tone({ midi: 60, sec: 10 }), SR);
  ok(perf.frames.length > 900, '10 秒录音产出约千帧（帧移 10ms）', `${perf.frames.length} 帧`);
});

describe('音高检测 · 性能', () => {
  const long = tone({ midi: 62, sec: 60 });
  const t0 = Date.now();
  const tr = trackPitch(long, SR);
  const ms = Date.now() - t0;
  ok(ms < 8000, '60 秒录音能在 8 秒内分析完', `${ms}ms，${tr.frames.length} 帧`);
  ok(PITCH_RATE === 16000 && freqToMidi(440) === 69, '常量与换算自洽');
});


// ---------------------------------------------------------------- 模拟演唱

/** 可复现的伪随机，保证测试每次跑出同样的结果 */
function rng(seed: number) {
  let x = seed;
  return () => {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    return x / 0x7fffffff;
  };
}

interface SingOpts {
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
}

/** 按参考旋律「唱」一遍，可注入各种典型毛病 */
function singReference(ref: Reference, o: SingOpts = {}): Float32Array {
  const sr = SR;
  const total = Math.round((ref.totalSec + 1) * sr);
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

    let start = note.start + (o.delay ?? 0);
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

const star = SONG_BY_ID.get('star')!;
const amazing = SONG_BY_ID.get('amazing')!;

const kinds = (fs: Finding[]) => fs.map((f) => f.kind);

describe('整首分析 · 唱得准的情况', () => {
  const ref = buildReference(star);
  const { report } = analyzePerformance(singReference(ref), SR, ref);

  ok(!report.quality.blocked, '录音质量检查通过', report.quality.summary);
  ok(report.intonation.accuracy.score !== null, '给得出音准分');
  ok((report.intonation.accuracy.score ?? 0) >= 88, '唱准了就该拿高分', `音准 ${report.intonation.accuracy.score}，平均偏差 ${report.intonation.accuracy.raw} 音分`);
  ok((report.intonation.hitRate.score ?? 0) >= 85, '命中率高', `${report.intonation.hitRate.raw}%`);
  ok((report.overall ?? 0) >= 80, '综合分合理', `${report.overall}`);
  ok(kinds(report.findings).includes('clean') || report.findings[0].severity < 0.35, '不该报出严重问题', `首要发现：${report.findings[0].title}`);
  ok(report.intonation.notes.length === ref.notes.length, '逐音复盘覆盖每一个目标音', `${report.intonation.notes.length} 个`);
  const green = report.intonation.notes.filter((n) => n.level === 'green').length;
  ok(green > ref.notes.length * 0.8, '绝大多数音标成绿色', `${green}/${ref.notes.length} 绿`);
  ok(report.sections.length === ref.sections.length, '段落小结逐段给出', `${report.sections.length} 段`);
});

describe('整首分析 · 整体偏低', () => {
  const ref = buildReference(star);
  const { report } = analyzePerformance(singReference(ref, { bias: -45 }), SR, ref);
  const f = report.findings.find((x) => x.kind === 'flat');
  ok(!!f, '识别出「整体偏低」', f?.title);
  ok((report.intonation.bias ?? 0) < -30, '偏差方向与幅度正确', `bias = ${report.intonation.bias} 音分`);
  ok((report.intonation.accuracy.score ?? 100) < 80, '音准分相应下降', `${report.intonation.accuracy.score}`);
  ok(!!f && f.evidence.includes('%'), '证据里带比例，不是空话', f?.evidence.slice(0, 40));

  const sharp = analyzePerformance(singReference(ref, { bias: +50 }), SR, ref).report;
  ok(kinds(sharp.findings).includes('sharp'), '反过来偏高也认得出', sharp.findings[0]?.title);
});

describe('整首分析 · 高音区偏低', () => {
  const ref = buildReference(amazing);
  const { report } = analyzePerformance(singReference(ref, { highBias: -80 }), SR, ref);
  ok(kinds(report.findings).includes('highNoteFlat'), '识别出高音区偏低',
    report.findings.find((x) => x.kind === 'highNoteFlat')?.title);
  const hi = report.intonation.highNotes;
  ok(hi.score !== null && (hi.raw ?? 0) < -40, '高音指标反映了这件事', hi.why);
  // 低音区没动，所以整体偏差应该明显小于高音区偏差
  ok(Math.abs(report.intonation.bias ?? 0) < 60, '没有把高音的问题摊到整首歌上', `整体 bias ${report.intonation.bias}`);
});

describe('整首分析 · 长音不稳', () => {
  const ref = buildReference(amazing);
  const { report } = analyzePerformance(singReference(ref, { drift: 90 }), SR, ref);
  ok(kinds(report.findings).includes('unstableLongNote'), '识别出长音飘',
    report.findings.find((x) => x.kind === 'unstableLongNote')?.title);
  ok((report.intonation.stability.raw ?? 0) > 30, '稳定性指标数值合理', `±${report.intonation.stability.raw} 音分`);
});

describe('整首分析 · 漏唱', () => {
  const ref = buildReference(star);
  const { report } = analyzePerformance(singReference(ref, { missRate: 0.35, seed: 3 }), SR, ref);
  ok(kinds(report.findings).includes('miss'), '识别出漏唱',
    report.findings.find((x) => x.kind === 'miss')?.title);
  const missed = report.intonation.notes.filter((n) => n.level === 'miss').length;
  ok(missed >= 6, '漏唱的音被标成 miss', `${missed} 个`);
});

describe('节奏分析', () => {
  const ref = buildReference(star);

  // 1) 整体延迟 = 设备延迟，应该被识别成系统性偏移而不是「拖拍」
  const delayed = analyzePerformance(singReference(ref, { delay: 0.2 }), SR, ref).report;
  const rd = delayed.rhythm!;
  near(rd.systematicOffset, 0.2, 0.06, '整体延迟被识别成系统性偏移', ' 秒');
  ok((rd.timing.score ?? 0) >= 70, '扣掉系统偏移后节奏分不受牵连', `节奏 ${rd.timing.score}，why: ${rd.timing.why.slice(0, 50)}`);
  ok(rd.timing.why.includes('设备延迟') || Math.abs(rd.systematicOffset * 1000) <= 120, '大偏移会提示可能是设备延迟');

  // 2) 忽快忽慢
  const jitter = analyzePerformance(singReference(ref, { timeJitter: 0.16, seed: 11 }), SR, ref).report;
  ok((jitter.rhythm!.steadiness.raw ?? 0) > 60, '抖动大时离散度显著上升', `±${jitter.rhythm!.steadiness.raw} 毫秒`);
  ok(kinds(jitter.findings).includes('unsteady'), '识别出节奏忽快忽慢');

  // 3) 部分音拖拍
  // 校准过延迟的用户：可以放心地说「你拖拍了」
  const drag = analyzePerformance(singReference(ref, { lateRate: 0.5, lateBy: 0.3, seed: 5 }), SR, ref, {
    calibrated: true,
  }).report;
  ok(drag.rhythm!.dragCount > drag.rhythm!.rushCount, '校准后能分辨出确实是拖拍',
    `抢 ${drag.rhythm!.rushCount} / 拖 ${drag.rhythm!.dragCount} / 准 ${drag.rhythm!.onTimeCount}`);
  ok(kinds(drag.findings).some((k) => k === 'drag' || k === 'unsteady'), '报出节奏类问题');

  // 没校准过、而且整体偏移很大：必须拒绝下「抢拍/拖拍」的结论
  const uncal = analyzePerformance(singReference(ref, { delay: 0.25 }), SR, ref).report;
  ok(!uncal.rhythm!.absoluteTrustworthy, '未校准 + 大偏移 → 标记为不可信');
  ok(!kinds(uncal.findings).includes('drag'), '这种情况下不报拖拍');
  ok(!!uncal.rhythm!.notice && uncal.rhythm!.notice.includes('校准'), '提示用户去做延迟校准',
    (uncal.rhythm!.notice ?? '').slice(0, 50));
  ok((uncal.rhythm!.steadiness.score ?? 0) >= 80, '一致性指标不受延迟影响，照常给分',
    `稳定性 ${uncal.rhythm!.steadiness.score}`);

  // 4) 准点演唱
  const tight = analyzePerformance(singReference(ref), SR, ref).report;
  ok((tight.rhythm!.timing.score ?? 0) >= 80, '节奏准时拿高分', `${tight.rhythm!.timing.score}，偏差 ${tight.rhythm!.timing.raw}ms`);
  ok(tight.rhythm!.onTimeCount > tight.rhythm!.rushCount + tight.rhythm!.dragCount, '准点音符占多数');
});

describe('节奏分析 · 没有可靠节拍时必须降级', () => {
  const ref = buildReference(star);
  const noBeat: Reference = { ...ref, beatReliable: false, bpm: null };
  const { report } = analyzePerformance(singReference(ref), SR, noBeat);
  const rh = report.rhythm!;
  ok(rh.degraded, '标记为降级分析');
  ok(!!rh.notice && rh.notice.includes('基础节奏分析'), '给出规定的提示语', rh.notice ?? '');
  ok(rh.timing.score === null, '不输出入拍偏差分数');
  ok(rh.rushCount === 0 && rh.dragCount === 0, '不编造抢拍/拖拍次数');
  ok(rh.steadiness.score === null, '基础统计不折算成分数', rh.steadiness.why.slice(0, 40));
});

describe('自由演唱（没有目标旋律）', () => {
  const clip = concat(
    tone({ midi: 57, sec: 1.5 }),
    silence(0.3),
    tone({ midi: 62, sec: 2.0 }),
    silence(0.3),
    tone({ midi: 69, sec: 1.5 }),
  );
  const { report } = analyzePerformance(clip, SR, null, 'free');
  ok(report.intonation.accuracy.score === null, '不给音准分（没有目标可比）');
  ok(!!report.intonation.accuracy.unavailable, '明确说明为什么评不了', report.intonation.accuracy.unavailable);
  ok(report.intonation.stability.score !== null, '稳定性仍然可评', report.intonation.stability.why);
  ok(report.intonation.range !== null, '音域仍然测得出',
    report.intonation.range ? `${midiToName(report.intonation.range.lo)}~${midiToName(report.intonation.range.hi)}` : '');
  ok(report.overall === null, '自由演唱不给综合分');
  ok(report.voice.longestNoteSec > 1.5, '长音持续时间可观测', `${report.voice.longestNoteSec} 秒`);
});

describe('录音质量把关', () => {
  const ref = buildReference(star);

  const silent = analyzePerformance(silence(6), SR, ref).report;
  ok(silent.quality.blocked, '没声音的录音被拦住');
  ok(silent.quality.issues.some((i) => i.kind === 'silent'), '指出是「没检测到人声」');
  ok(silent.quality.issues.every((i) => i.fix.length > 5), '每条问题都给了怎么办', silent.quality.issues[0]?.fix);

  const short = analyzePerformance(tone({ midi: 60, sec: 1.0 }), SR, ref).report;
  ok(short.quality.blocked && short.quality.issues.some((i) => i.kind === 'tooShort'), '太短的录音被拦住');

  const quiet = analyzePerformance(singReference(ref, { amp: 0.0025 }), SR, ref).report;
  ok(quiet.quality.issues.some((i) => i.kind === 'tooQuiet'), '音量过低被指出',
    quiet.quality.issues.find((i) => i.kind === 'tooQuiet')?.message);

  const loud = clip(singReference(ref, { amp: 0.9 }), 0.999);
  const clipped = analyzePerformance(loud, SR, ref).report;
  ok(clipped.quality.issues.some((i) => i.kind === 'clipping'), '爆音被指出',
    clipped.quality.issues.find((i) => i.kind === 'clipping')?.message);

  const noisy = analyzePerformance(mix(singReference(ref, { amp: 0.08 }), noise(20, 0.05)), SR, ref).report;
  ok(noisy.quality.issues.some((i) => i.kind === 'noisy' || i.kind === 'tooQuiet'), '环境噪声大被指出');

  const good = analyzePerformance(singReference(ref), SR, ref).report;
  ok(!good.quality.blocked, '正常录音不误报');
});

describe('指标的自我约束', () => {
  const ref = buildReference(star);
  const { report } = analyzePerformance(singReference(ref, { bias: -30 }), SR, ref);
  const metrics = [
    report.intonation.accuracy,
    report.intonation.hitRate,
    report.intonation.stability,
    report.intonation.highNotes,
    report.rhythm!.timing,
    report.rhythm!.steadiness,
  ];
  ok(metrics.every((m) => m.why.length > 8), '每个指标都带「为什么是这个结果」');
  ok(metrics.every((m) => m.score === null || (m.score >= 0 && m.score <= 100)), '分数都在 0~100 内');
  ok(metrics.every((m) => m.score !== null || !!m.unavailable), '评不了的指标必须写明原因');
  ok(metrics.every((m) => m.score === null || m.raw !== null), '有分数就必须有支撑它的原始量');
  ok(report.findings.every((f) => f.title.length > 4 && f.evidence.length > 10), '每条发现都有标题和证据');
  ok(report.findings.every((f) => /\d/.test(f.title) || f.kind === 'clean'), '发现的标题里带具体数字',
    report.findings.map((f) => f.title).join(' | ').slice(0, 80));
});

describe('分段与乐句', () => {
  const ref = buildReference(SONG_BY_ID.get('jingle')!);
  ok(ref.sections.length >= 3, '铃儿响叮当拆出多个段落', ref.sections.map((s) => s.name).join(' → '));
  const intro = ref.sections.find((s) => s.kind === 'intro');
  ok(!!intro && intro.from === intro.to, '纯伴奏前奏不计入评分目标');
  ok(ref.playback.length > ref.notes.length, '伴奏音符比要唱的音多（含前奏）',
    `伴奏 ${ref.playback.length} / 要唱 ${ref.notes.length}`);
  ok(ref.phrases.length >= 4, '乐句切分正常', `${ref.phrases.length} 句`);
  ok(ref.notes.every((n) => n.section >= 0 && n.section < ref.sections.length), '每个音都归属到段落');
  ok(ref.phrases.every((p) => p.endSec > p.startSec), '乐句时间范围有效');

  // 分段练习：只练副歌
  const chorusIdx = ref.sections.findIndex((s) => s.kind === 'chorus');
  const only = buildReference(SONG_BY_ID.get('jingle')!, { sectionOnly: chorusIdx });
  ok(only.notes.length > 0 && only.notes.length < ref.notes.length, '只练副歌时目标音变少',
    `${only.notes.length} / ${ref.notes.length}`);
  ok(only.title.includes('副歌'), '标题标出练的是哪一段', only.title);

  // 移调
  const up3 = buildReference(star, { transpose: 3 });
  const base = buildReference(star);
  ok(up3.notes[0].midi - base.notes[0].midi === 3, '移调正确作用到目标音高');
});


// ---------------------------------------------------------------- 汇总

console.log(`\n${'─'.repeat(60)}`);
if (failed === 0) {
  console.log(`\x1b[32m全部通过：${passed} 项\x1b[0m`);
} else {
  console.log(`\x1b[31m失败 ${failed} 项\x1b[0m，通过 ${passed} 项`);
  for (const f of failures) console.log(`  \x1b[31m·\x1b[0m ${f}`);
  process.exitCode = 1;
}
