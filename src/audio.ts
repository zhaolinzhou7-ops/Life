/**
 * 程序化音效：全部用 Web Audio API 合成，不加载任何音频文件。
 * 浏览器要求首次用户手势后才能出声，故 initAudio() 需在点击时调用。
 */

const MUTE_KEY = 'td3d-muted';

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = (() => {
  try {
    return localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    return false;
  }
})();

function ac(): AudioContext {
  if (!ctx) {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.45;
    master.connect(ctx.destination);
  }
  return ctx;
}

/** 在用户手势中调用以解锁/恢复音频 */
export function initAudio() {
  const c = ac();
  if (c.state === 'suspended') void c.resume();
}

export function isMuted() {
  return muted;
}

export function toggleMute(): boolean {
  muted = !muted;
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
  } catch {
    // 忽略隐私模式写入失败
  }
  if (!muted) initAudio();
  return muted;
}

interface Note {
  f: number; // 频率
  t?: OscillatorType; // 波形
  d: number; // 时长（秒）
  g?: number; // 峰值音量
  slide?: number; // 滑到的目标频率
  delay?: number; // 相对起始的延迟
}

function play(notes: Note[]) {
  if (muted) return;
  const c = ac();
  if (c.state === 'suspended') void c.resume();
  const now = c.currentTime;
  for (const n of notes) {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = n.t ?? 'sine';
    const start = now + (n.delay ?? 0);
    osc.frequency.setValueAtTime(n.f, start);
    if (n.slide) osc.frequency.exponentialRampToValueAtTime(Math.max(1, n.slide), start + n.d);
    const peak = n.g ?? 0.3;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + n.d);
    osc.connect(gain);
    gain.connect(master!);
    osc.start(start);
    osc.stop(start + n.d + 0.03);
  }
}

// 高频事件（开火/击杀）节流，避免叠成噪音
const throttles: Record<string, number> = {};
function throttled(key: string, gap: number, notes: Note[]) {
  if (muted) return;
  const t = ac().currentTime;
  if (t - (throttles[key] ?? -1) < gap) return;
  throttles[key] = t;
  play(notes);
}

export const Sfx = {
  click: () => play([{ f: 520, t: 'square', d: 0.05, g: 0.1 }]),
  build: () =>
    play([
      { f: 330, t: 'square', d: 0.08, g: 0.18 },
      { f: 494, t: 'square', d: 0.12, g: 0.18, delay: 0.07 },
    ]),
  upgrade: () =>
    play([
      { f: 523, t: 'square', d: 0.08, g: 0.16 },
      { f: 659, t: 'square', d: 0.08, g: 0.16, delay: 0.07 },
      { f: 784, t: 'square', d: 0.12, g: 0.16, delay: 0.14 },
    ]),
  sell: () => play([{ f: 420, t: 'sine', d: 0.12, g: 0.16, slide: 250 }]),

  fireArrow: () => throttled('fire', 0.05, [{ f: 900, t: 'square', d: 0.05, g: 0.05, slide: 480 }]),
  fireCannon: () => throttled('fire', 0.06, [{ f: 150, t: 'sawtooth', d: 0.13, g: 0.11, slide: 65 }]),
  fireFrost: () => throttled('fire', 0.05, [{ f: 680, t: 'sine', d: 0.09, g: 0.05, slide: 1150 }]),
  fireBolt: () => throttled('fire', 0.05, [{ f: 1250, t: 'square', d: 0.07, g: 0.06, slide: 280 }]),

  kill: () => throttled('kill', 0.03, [{ f: 300, t: 'square', d: 0.08, g: 0.1, slide: 150 }]),
  boss: () => play([{ f: 120, t: 'sawtooth', d: 0.45, g: 0.24, slide: 55 }]),
  loseLife: () => play([{ f: 220, t: 'sawtooth', d: 0.18, g: 0.2, slide: 95 }]),

  waveStart: () =>
    play([
      { f: 392, t: 'square', d: 0.1, g: 0.16 },
      { f: 523, t: 'square', d: 0.14, g: 0.16, delay: 0.1 },
    ]),
  reward: () =>
    play([
      { f: 523, d: 0.1, g: 0.18 },
      { f: 659, d: 0.1, g: 0.18, delay: 0.09 },
      { f: 784, d: 0.1, g: 0.18, delay: 0.18 },
      { f: 1047, d: 0.18, g: 0.18, delay: 0.27 },
    ]),
  victory: () =>
    play([
      { f: 523, d: 0.14, g: 0.24 },
      { f: 659, d: 0.14, g: 0.24, delay: 0.14 },
      { f: 784, d: 0.14, g: 0.24, delay: 0.28 },
      { f: 1047, d: 0.32, g: 0.24, delay: 0.42 },
    ]),
  defeat: () =>
    play([
      { f: 440, t: 'sawtooth', d: 0.2, g: 0.22, slide: 300 },
      { f: 300, t: 'sawtooth', d: 0.22, g: 0.22, slide: 200, delay: 0.18 },
      { f: 170, t: 'sawtooth', d: 0.5, g: 0.22, slide: 100, delay: 0.38 },
    ]),
};
