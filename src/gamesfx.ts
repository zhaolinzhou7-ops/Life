/** 棋牌类共享音效引擎：Web Audio 实时合成 + 中文语音报牌 + 背景音乐（零音频文件） */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let muted = localStorage.getItem('life-mute') === '1';

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;
      master.connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function isMuted() {
  return muted;
}
export function setMuted(m: boolean) {
  muted = m;
  localStorage.setItem('life-mute', m ? '1' : '0');
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 1, ctx.currentTime, 0.02);
  if (m) try { speechSynthesis.cancel(); } catch { /* 忽略 */ }
}

/** 首次用户手势时解锁音频 */
export function unlockAudio() {
  ac();
}

const out = () => master!;

// ---------------- 基础合成 ----------------

/** 简单振荡音 */
function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; delay?: number } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const o = c.createOscillator();
  o.type = opts.type ?? 'sine';
  o.frequency.setValueAtTime(freq, t0);
  if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * opts.slide), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(opts.vol ?? 0.2, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out());
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** 噪声爆发（敲击/摩擦） */
function noise(dur: number, opts: { vol?: number; lp?: number; hp?: number; delay?: number } = {}) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (opts.lp) {
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = opts.lp;
    node.connect(f);
    node = f;
  }
  if (opts.hp) {
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = opts.hp;
    node.connect(f);
    node = f;
  }
  const g = c.createGain();
  g.gain.value = opts.vol ?? 0.25;
  node.connect(g).connect(out());
  src.start(t0);
}

/** 古筝/琵琶式拨弦（Karplus-Strong 简化版） */
function pluck(freq: number, dur = 1.2, vol = 0.16, delay = 0) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + delay;
  const N = Math.round(c.sampleRate / freq);
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  const ring = new Float32Array(N);
  for (let i = 0; i < N; i++) ring[i] = Math.random() * 2 - 1;
  let idx = 0;
  for (let i = 0; i < len; i++) {
    const cur = ring[idx];
    const nxt = ring[(idx + 1) % N];
    const v = (cur + nxt) * 0.4985; // 衰减
    d[i] = cur;
    ring[idx] = v;
    idx = (idx + 1) % N;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(out());
  src.start(t0);
}

// ---------------- 事件音效 ----------------

/** 木质轻点（选中） */
export function sfxTap() {
  tone(880, 0.06, { type: 'triangle', vol: 0.12 });
  noise(0.03, { vol: 0.08, lp: 3000 });
}
/** 棋子/麻将落桌：厚实木质敲击 */
export function sfxKnock(strong = false) {
  tone(strong ? 150 : 190, 0.12, { type: 'sine', vol: strong ? 0.5 : 0.35, slide: 0.5 });
  noise(0.05, { vol: strong ? 0.3 : 0.2, lp: 2400 });
}
/** 吃子/碰撞：双击 + 滑擦 */
export function sfxCapture() {
  sfxKnock(true);
  noise(0.16, { vol: 0.2, lp: 1800, delay: 0.05 });
  tone(120, 0.18, { type: 'sine', vol: 0.3, slide: 0.6, delay: 0.05 });
}
/** 摸牌轻响 */
export function sfxDraw() {
  noise(0.04, { vol: 0.1, hp: 1500 });
  tone(660, 0.05, { type: 'triangle', vol: 0.06 });
}
/** 警示（将军） */
export function sfxAlert() {
  tone(740, 0.14, { type: 'square', vol: 0.12 });
  tone(988, 0.2, { type: 'square', vol: 0.12, delay: 0.12 });
}
/** 碰：双重打击 */
export function sfxPeng() {
  sfxKnock(true);
  tone(392, 0.16, { type: 'triangle', vol: 0.28, delay: 0.04 });
  tone(523, 0.2, { type: 'triangle', vol: 0.24, delay: 0.1 });
}
/** 杠：更沉的三连 */
export function sfxGang() {
  sfxKnock(true);
  tone(262, 0.2, { type: 'triangle', vol: 0.3, delay: 0.05 });
  tone(330, 0.2, { type: 'triangle', vol: 0.26, delay: 0.13 });
  tone(392, 0.26, { type: 'triangle', vol: 0.26, delay: 0.21 });
}
/** 胡牌：锣 + 上行琶音 */
export function sfxWin() {
  // 锣
  tone(180, 1.4, { type: 'sine', vol: 0.4, slide: 0.7 });
  noise(0.5, { vol: 0.16, lp: 900 });
  // 琶音
  [523, 659, 784, 1047].forEach((f, i) => pluck(f, 1.0, 0.2, 0.12 + i * 0.09));
}
/** 失利 */
export function sfxLose() {
  [392, 330, 262, 196].forEach((f, i) => tone(f, 0.3, { type: 'triangle', vol: 0.18, delay: i * 0.16 }));
}

/** 中文语音报牌（碰/杠/胡/将军…），不可用时静默跳过 */
export function speak(text: string) {
  if (muted) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = 1.15;
    u.pitch = 1.15;
    u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* 无 TTS 环境 */
  }
}

// ---------------- 背景音乐 ----------------

export type BgmStyle = 'guqin' | 'majiang';
let bgmTimer = 0;
let bgmBeat = 0;

/** 宫商角徵羽五声音阶（C 宫） */
const PENTA = [261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33, 659.25, 784.0, 880.0];

export function startBgm(style: BgmStyle) {
  stopBgm();
  const c = ac();
  if (!c) return;
  bgmBeat = 0;
  if (style === 'guqin') {
    // 古琴慢板：每 1.7s 一到两声拨弦，空灵
    bgmTimer = window.setInterval(() => {
      if (muted) return;
      const n = PENTA[Math.floor(Math.random() * PENTA.length)];
      pluck(n / 2, 2.2, 0.1);
      if (Math.random() < 0.4) pluck(n, 1.8, 0.07, 0.35);
    }, 1700);
  } else {
    // 麻将馆节奏：96bpm，底鼓 + 木鱼 + 偶发拨弦
    const beatDur = 60 / 96 / 2; // 八分音符
    bgmTimer = window.setInterval(() => {
      if (muted) return;
      const b = bgmBeat++ % 8;
      if (b === 0 || b === 4) tone(70, 0.18, { type: 'sine', vol: 0.24, slide: 0.5 }); // 底鼓
      if (b === 2 || b === 6) { noise(0.03, { vol: 0.1, hp: 4000 }); tone(1200, 0.04, { type: 'square', vol: 0.05 }); } // 木鱼/镲
      else noise(0.02, { vol: 0.04, hp: 6000 });
      if (b === 0 && Math.random() < 0.5) {
        const base = Math.floor(Math.random() * 5);
        pluck(PENTA[base], 0.8, 0.09, beatDur);
        pluck(PENTA[(base + 2) % PENTA.length], 0.8, 0.07, beatDur * 3);
      }
    }, beatDur * 1000);
  }
}

export function stopBgm() {
  clearInterval(bgmTimer);
  bgmTimer = 0;
}
