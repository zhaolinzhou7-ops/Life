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

// ---------------- 语音 ----------------
// 浏览器自带 TTS 机械感重，做三件事压一压：挑系统里最好的中文嗓、
// 每句加轻微的音高/语速抖动（真人不会两句一模一样）、把关键时刻交给音效而不是念字。

let voiceCache: SpeechSynthesisVoice[] | null = null;
/** 已知音质较好的中文嗓，按优先级排 */
const GOOD_ZH = ['Tingting', 'Ting-Ting', 'Sinji', 'Yu-shu', 'Li-mu', 'Yu Shu', 'Meijia', 'Google 普通话', 'Microsoft Xiaoxiao', 'Microsoft Yunxi', 'Microsoft Huihui'];

function zhVoices(): SpeechSynthesisVoice[] {
  if (voiceCache && voiceCache.length) return voiceCache;
  try {
    const all = speechSynthesis.getVoices();
    const zh = all.filter((v) => /^zh/i.test(v.lang));
    zh.sort((a, b) => {
      const rank = (v: SpeechSynthesisVoice) => {
        const i = GOOD_ZH.findIndex((n) => v.name.includes(n));
        return (i < 0 ? 50 : i) + (v.localService ? 0 : 20) + (/zh-CN|zh_CN/i.test(v.lang) ? 0 : 5);
      };
      return rank(a) - rank(b);
    });
    voiceCache = zh;
    return zh;
  } catch {
    return [];
  }
}

try {
  speechSynthesis.addEventListener?.('voiceschanged', () => {
    voiceCache = null;
  });
} catch {
  /* 无 TTS 环境 */
}

export interface VoiceProfile {
  pitch: number;
  rate: number;
  /** 用中文嗓列表里的第几个（不同角色尽量不同嗓） */
  slot?: number;
}

export function speak(text: string, voice?: VoiceProfile) {
  if (muted) return;
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'zh-CN';
    const zh = zhVoices();
    if (zh.length) u.voice = zh[Math.min(zh.length - 1, voice?.slot ?? 0)];
    // 抖动：同一个人每次说话也略有不同，能明显减轻"复读机"感
    const j = () => (Math.random() - 0.5) * 0.12;
    u.rate = Math.max(0.5, Math.min(2, (voice?.rate ?? 1.05) + j()));
    u.pitch = Math.max(0, Math.min(2, (voice?.pitch ?? 1.05) + j()));
    u.volume = 0.9;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch {
    /* 无 TTS 环境 */
  }
}

// ---------------- 对局音效 ----------------

/** 掷骰子：骨头在瓷碗里翻滚 */
export function sfxDice() {
  for (let i = 0; i < 9; i++) {
    const d = i * 0.055 + Math.random() * 0.03;
    noise(0.05, { vol: 0.15 - i * 0.011, hp: 1400, delay: d });
    tone(500 + Math.random() * 700, 0.05, { type: 'triangle', vol: 0.08, delay: d });
  }
  tone(220, 0.3, { type: 'sine', vol: 0.16, slide: 0.7, delay: 0.55 });
}

/** 码牌/发牌：一串密集的牌碰撞 */
export function sfxDeal() {
  for (let i = 0; i < 14; i++) {
    const d = i * 0.042;
    noise(0.045, { vol: 0.11, hp: 1900, delay: d });
    tone(360 + Math.random() * 240, 0.05, { type: 'square', vol: 0.05, delay: d });
  }
}

/** 甩牌：破风 + 落桌 */
export function sfxThrow() {
  noise(0.13, { vol: 0.14, hp: 2200 });
  sfxKnock();
}

/** 金币入账 */
export function sfxCoin(n = 1) {
  for (let i = 0; i < n; i++) {
    const d = i * 0.07;
    tone(1180, 0.16, { type: 'triangle', vol: 0.13, delay: d });
    tone(1760, 0.13, { type: 'sine', vol: 0.09, delay: d + 0.02 });
  }
}

/** 心跳：听牌后别人摸打时的紧张感 */
export function sfxHeartbeat() {
  tone(62, 0.16, { type: 'sine', vol: 0.34, slide: 0.7 });
  tone(58, 0.2, { type: 'sine', vol: 0.26, slide: 0.7, delay: 0.19 });
}

/** 倒计时滴答（最后几秒） */
export function sfxTick(urgent = false) {
  tone(urgent ? 1500 : 1050, 0.05, { type: 'square', vol: urgent ? 0.13 : 0.07 });
}

/** 结算号角：铜管齐奏 + 锣 */
export function sfxFanfare() {
  tone(146, 2.2, { type: 'sine', vol: 0.4, slide: 0.6 });
  noise(0.8, { vol: 0.18, lp: 1200 });
  const chord = [392, 494, 587, 784];
  chord.forEach((f, i) => {
    tone(f, 1.0, { type: 'sawtooth', vol: 0.09, delay: 0.05 + i * 0.03 });
    tone(f, 1.0, { type: 'triangle', vol: 0.07, delay: 0.05 + i * 0.03 });
  });
  [784, 988, 1175, 1568].forEach((f, i) => pluck(f, 1.4, 0.18, 0.5 + i * 0.09));
  noise(1.1, { vol: 0.11, hp: 4200, delay: 0.5 });
}

/** 段位提升 */
export function sfxLevelUp() {
  [523, 659, 784, 1047, 1319, 1568].forEach((f, i) => {
    tone(f, 0.5, { type: 'triangle', vol: 0.16, delay: i * 0.075 });
    pluck(f * 2, 0.7, 0.1, i * 0.075);
  });
  noise(1.0, { vol: 0.1, hp: 5000, delay: 0.3 });
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

/** 铺底长音（弦乐/笙式持续音），给曲子撑出厅堂感 */
function padAt(freq: number, when: number, dur: number, vol = 0.05) {
  const c = ctx!;
  const g = c.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(vol, when + dur * 0.35);
  g.gain.linearRampToValueAtTime(0, when + dur);
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = freq * 4;
  for (const det of [-7, 0, 7]) {
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = freq;
    o.detune.value = det;
    o.connect(lp);
    o.start(when);
    o.stop(when + dur + 0.05);
  }
  lp.connect(g).connect(out());
}

/** 琵琶轮指：一个音上的快速反复，长音不空 */
function tremoloAt(freq: number, when: number, dur: number, vol = 0.07) {
  const n = Math.max(2, Math.round(dur / 0.075));
  for (let i = 0; i < n; i++) pluckAt(freq, when + i * 0.075, 0.35, vol * (i === 0 ? 1.4 : 0.75));
}

/** 大鼓重音 */
function taikoAt(when: number, vol = 0.34) {
  const c = ctx!;
  const o = c.createOscillator();
  o.frequency.setValueAtTime(150, when);
  o.frequency.exponentialRampToValueAtTime(48, when + 0.22);
  const g = c.createGain();
  g.gain.setValueAtTime(vol, when);
  g.gain.exponentialRampToValueAtTime(0.001, when + 0.4);
  o.connect(g).connect(out());
  o.start(when);
  o.stop(when + 0.45);
  noiseAt(when, 0.09, vol * 0.3, 0, 260);
}

/** BGM 强度：0=平稳 1=紧张（牌墙见底/多家听牌时切） */
let bgmIntensity = 0;
export function setBgmIntensity(level: 0 | 1) {
  bgmIntensity = level;
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
      const hot = bgmIntensity === 1;

      // 鼓组：紧张时加密并加重
      if (inBar === 0) taikoAt(when, hot ? 0.4 : 0.3);
      if (inBar === 5) kickAt(when, hot ? 0.32 : 0.24);
      if (hot && inBar === 3) kickAt(when, 0.2);
      if (inBar === 2 || inBar === 6) noiseAt(when, 0.08, hot ? 0.16 : 0.12, 0, 1800); // 小军鼓
      noiseAt(when, 0.03, inBar % 2 === 0 ? 0.05 : 0.028, 6500); // 踩镲
      if (hot) noiseAt(when + stepDur / 2, 0.025, 0.035, 7200); // 十六分踩镲

      // 弹拨低音 + 铺底
      if (inBar === 0 || inBar === 3 || inBar === 6) pluckAt(bass[bar], when, 0.6, 0.15);
      if (inBar === 0) padAt(bass[bar] * 2, when, stepDur * 8, hot ? 0.055 : 0.038);

      // 笛子主旋律；长音改用琵琶轮指托住，不再空一拍
      const m = mel[step];
      if (m > 0) {
        let len = 1;
        for (let k = step + 1; k < 64 && mel[k] === 0 && len < 4; k++) len++;
        flute(m, when, stepDur * len * 0.9, 0.085);
        if (len >= 3) tremoloAt(m * 2, when + stepDur * 0.6, stepDur * (len - 0.6), 0.045);
      }

      // 过门：第 8 小节古筝上行滑音
      if (step === 57) glissAt(when, [N.D4, N.F4, N.G4, N.A4, N.C5, N.D5, N.F5], 0.08);
      // 循环起点敲一记锣，段落感更强
      if (step === 0) noiseAt(when, 1.2, 0.07, 0, 420);
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
