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

/** 中文语音报牌（碰/杠/胡/将军…），不可用时静默跳过。
 *  voice 可指定角色音色（pitch/rate），实现不同人物不同嗓音。 */
export function speak(text: string, voice?: { pitch: number; rate: number }) {
  if (muted) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    u.rate = voice?.rate ?? 1.15;
    u.pitch = voice?.pitch ?? 1.15;
    u.volume = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* 无 TTS 环境 */
  }
}

/** 杠：重型三连击 + 低频轰鸣 + 金属泛音（强打击感） */
export function sfxGangHeavy() {
  sfxKnock(true);
  // 低频冲击
  tone(58, 0.5, { type: 'sine', vol: 0.42, slide: 0.55 });
  noise(0.25, { vol: 0.3, lp: 1200 });
  // 三连金属敲击
  [0, 0.09, 0.18].forEach((d, i) => {
    tone(330 + i * 110, 0.22, { type: 'triangle', vol: 0.3, delay: 0.04 + d });
    noise(0.06, { vol: 0.16, hp: 2600, delay: 0.04 + d });
  });
  // 收尾镲片
  noise(0.55, { vol: 0.16, hp: 5200, delay: 0.22 });
}

/** 胡牌大奖：锣 + 上行琶音 + 掌声式白噪 */
export function sfxWinBig() {
  tone(165, 1.8, { type: 'sine', vol: 0.45, slide: 0.62 });
  noise(0.7, { vol: 0.2, lp: 1000 });
  [523, 659, 784, 1047, 1319].forEach((f, i) => pluck(f, 1.2, 0.22, 0.1 + i * 0.085));
  noise(0.9, { vol: 0.12, hp: 3800, delay: 0.35 });
}

/** 吃子/绝杀：破空斩击 */
export function sfxSlash() {
  noise(0.22, { vol: 0.3, hp: 1800 });
  tone(880, 0.18, { type: 'sawtooth', vol: 0.16, slide: 0.35 });
  tone(140, 0.3, { type: 'sine', vol: 0.34, slide: 0.5, delay: 0.05 });
}

// ---------------- 背景音乐 ----------------

export type BgmStyle = 'guqin' | 'majiang';

// ======= 作曲式 BGM：多轨 8 小节循环 + 音频时钟精确调度 =======

/** 音名→频率（A4=440） */
function nf(semiFromA4: number): number {
  return 440 * 2 ** (semiFromA4 / 12);
}
// 记谱辅助：A 小调五声 A C D E G。数字为相对 A4 的半音
const N = {
  A2: nf(-24), C3: nf(-21), D3: nf(-19), E3: nf(-17), G3: nf(-14),
  A3: nf(-12), C4: nf(-9), D4: nf(-7), E4: nf(-5), G4: nf(-2),
  A4: nf(0), C5: nf(3), D5: nf(5), E5: nf(7), G5: nf(10), A5: nf(12),
  D2: nf(-31), F2: nf(-28), G2: nf(-26), C2: nf(-33),
  F4: nf(-4), F5: nf(8),
};

/** 箫/笛类吹管音色：双正弦微失谐 + 颤音 + 低通，柔起音 */
function flute(freq: number, when: number, dur: number, vol = 0.12) {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + 0.06);
  g.gain.setValueAtTime(vol, when + dur - 0.1);
  g.gain.linearRampToValueAtTime(0, when + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * 3.2;
  const vib = c.createOscillator();
  vib.frequency.value = 5.2;
  const vibG = c.createGain();
  vibG.gain.value = freq * 0.006;
  vib.connect(vibG);
  for (const det of [0, 3]) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = freq;
    o.detune.value = det;
    vibG.connect(o.frequency);
    o.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
  vib.start(when);
  vib.stop(when + dur + 0.05);
  lp.connect(g).connect(out());
}

/** 定时打击乐 */
function kickAt(when: number, vol = 0.3) {
  const c = ctx!;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(120, when);
  o.frequency.exponentialRampToValueAtTime(42, when + 0.12);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.16);
  o.connect(g).connect(out());
  o.start(when);
  o.stop(when + 0.2);
}
function noiseAt(when: number, dur: number, vol: number, hp = 0, bp = 0) {
  const c = ctx!;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = c.createBufferSource();
  src.buffer = buf;
  let node: AudioNode = src;
  if (hp) { const f = c.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  if (bp) { const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = bp; f.Q.value = 1.2; node.connect(f); node = f; }
  const g = c.createGain();
  g.gain.value = vol;
  node.connect(g).connect(out());
  src.start(when);
}
/** 定时拨弦（用于旋律轨） */
function pluckAt(freq: number, when: number, dur = 1.2, vol = 0.14) {
  pluck(freq, dur, vol, Math.max(0, when - ctx!.currentTime));
}
/** 古筝滑音：快速上行五声音阶跑动 */
function glissAt(when: number, base: number[], vol = 0.1) {
  base.forEach((f, i) => pluckAt(f, when + i * 0.045, 0.8, vol * (0.7 + i * 0.06)));
}

interface Song {
  stepDur: number; // 八分音符时长（秒）
  steps: number; // 循环步数
  play: (step: number, when: number) => void;
}

/** 象棋《溪山对弈》：66bpm，箫主旋律 + 古筝分解 + 低音持续 */
function songXiqi(): Song {
  const stepDur = 60 / 66 / 2;
  // 8 小节主旋律（每步一个八分音符；0 = 休止；负 = 延音略过）
  const mel = [
    N.A4, 0, N.C5, N.D5, N.E5, 0, N.D5, N.C5,
    N.A4, 0, 0, 0, N.G4, N.A4, 0, 0,
    N.C5, 0, N.D5, N.C5, N.A4, 0, N.G4, N.E4,
    N.G4, 0, N.A4, 0, 0, 0, 0, 0,
    N.E4, 0, N.G4, N.A4, N.C5, 0, N.D5, N.E5,
    N.D5, 0, N.C5, N.D5, N.C5, 0, N.A4, N.G4,
    N.A4, 0, N.C5, N.A4, N.G4, 0, N.E4, N.G4,
    N.A4, 0, 0, 0, 0, 0, 0, 0,
  ];
  // 每小节根音（古筝低音 + 分解）
  const roots = [N.A3, N.A3, N.G3, N.A3, N.C4, N.D4, N.G3, N.A3];
  return {
    stepDur,
    steps: 64,
    play(step, when) {
      const bar = Math.floor(step / 8);
      const inBar = step % 8;
      // 古筝：每小节 1、4、6 步分解和弦
      const r = roots[bar];
      if (inBar === 0) pluckAt(r / 2, when, 2.4, 0.12);
      if (inBar === 3) pluckAt(r * 1.5, when, 1.6, 0.08);
      if (inBar === 5) pluckAt(r * 2, when, 1.6, 0.07);
      // 箫主旋律
      const m = mel[step];
      if (m > 0) {
        // 计算延音：数到下一个非 0
        let len = 1;
        for (let k = step + 1; k < 64 && mel[k] === 0 && len < 6; k++) len++;
        flute(m, when, stepDur * len * 0.92, 0.1);
      }
      // 尾小节古筝滑音收束
      if (step === 60) glissAt(when, [N.A3, N.C4, N.D4, N.E4, N.G4, N.A4], 0.07);
    },
  };
}

/** 麻将《锦官夜宴》：104bpm，鼓组 + 弹拨低音 + 笛子主旋律 + 古筝滑音过门 */
function songJinguan(): Song {
  const stepDur = 60 / 104 / 2;
  const mel = [
    N.D5, 0, N.F5, N.G5, N.A5, 0, N.G5, N.F5,
    N.D5, 0, N.C5, N.D5, 0, 0, 0, 0,
    N.D5, 0, N.F5, N.G5, N.F5, 0, N.D5, N.C5,
    N.D5, 0, 0, 0, N.A4, N.C5, N.D5, 0,
    N.F5, 0, N.G5, N.A5, N.G5, 0, N.F5, N.D5,
    N.C5, 0, N.D5, N.F5, N.D5, 0, 0, 0,
    N.A4, 0, N.C5, N.D5, N.F5, 0, N.D5, N.C5,
    N.D5, 0, 0, 0, 0, 0, 0, 0,
  ];
  const bass = [N.D3, N.D3, N.F2 * 2, N.F2 * 2, N.C3, N.C3, N.G2 * 2, N.D3];
  return {
    stepDur,
    steps: 64,
    play(step, when) {
      const bar = Math.floor(step / 8);
      const inBar = step % 8;
      // 鼓组
      if (inBar === 0 || inBar === 5) kickAt(when, 0.26);
      if (inBar === 2 || inBar === 6) noiseAt(when, 0.08, 0.12, 0, 1800); // 小军鼓
      noiseAt(when, 0.03, inBar % 2 === 0 ? 0.05 : 0.028, 6500); // 踩镲
      // 弹拨低音
      if (inBar === 0 || inBar === 3 || inBar === 6) pluckAt(bass[bar], when, 0.6, 0.15);
      // 笛子主旋律
      const m = mel[step];
      if (m > 0) {
        let len = 1;
        for (let k = step + 1; k < 64 && mel[k] === 0 && len < 4; k++) len++;
        flute(m, when, stepDur * len * 0.9, 0.085);
      }
      // 过门：第 8 小节古筝上行滑音
      if (step === 57) glissAt(when, [N.D4, N.F4, N.G4, N.A4, N.C5, N.D5, N.F5], 0.08);
    },
  };
}

let schedTimer = 0;
let songStep = 0;
let nextTime = 0;
let curSong: Song | null = null;

export function startBgm(style: BgmStyle) {
  stopBgm();
  const c = ac();
  if (!c) return;
  curSong = style === 'guqin' ? songXiqi() : songJinguan();
  songStep = 0;
  nextTime = c.currentTime + 0.1;
  // 音频时钟 lookahead 调度：不受主线程卡顿影响，节奏严丝合缝
  schedTimer = window.setInterval(() => {
    if (!curSong || !ctx) return;
    while (nextTime < ctx.currentTime + 0.3) {
      if (!muted) curSong.play(songStep % curSong.steps, nextTime);
      nextTime += curSong.stepDur;
      songStep++;
    }
  }, 90);
}

export function stopBgm() {
  clearInterval(schedTimer);
  schedTimer = 0;
  curSong = null;
}
