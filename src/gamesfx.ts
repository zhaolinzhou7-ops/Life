/**
 * 棋牌类共享音效引擎：Web Audio 实时合成 + 人声合成 + 背景音乐（零音频文件）。
 *
 * 关于「质感」：原来所有声源直连 destination，是纯干声——听着像电子琴而不像
 * 屋里有人在打牌。这版建了正经的总线：
 *
 *   声源 ──┬─────────────────────────┐
 *          └→ 混响送出 → 卷积混响 ──┤
 *                                    ├→ 总线压缩 → 主音量 → 输出
 *
 * 三件事撑起质感：卷积混响给空间，总线压缩把零散的音头胶合成一体，
 * 立体声声位让左右家的牌声从两侧来。
 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
/** 所有声源的汇入点 */
let busIn: GainNode | null = null;
/** 混响送出量 */
let revSend: GainNode | null = null;

/**
 * 程序生成的房间脉冲响应：早期反射 + 指数衰减噪声尾。
 * 不用音频文件也能有真实的空间感；左右声道用不同随机序列，混响自带宽度。
 */
function makeRoomIR(c: AudioContext, seconds = 1.5, decay = 3.4): AudioBuffer {
  const len = Math.floor(c.sampleRate * seconds);
  const buf = c.createBuffer(2, len, c.sampleRate);
  // 早期反射：几个离散回声，是「房间大小」的主要听觉线索
  const early = [
    [0.007, 0.5], [0.013, 0.42], [0.021, 0.34],
    [0.031, 0.28], [0.043, 0.22], [0.059, 0.18],
  ];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const t = i / len;
      // 扩散尾：随机噪声按指数衰减，高频衰减更快（空气吸收）
      d[i] = (Math.random() * 2 - 1) * (1 - t) ** decay;
    }
    for (const [delaySec, amp] of early) {
      const idx = Math.floor(delaySec * c.sampleRate * (ch ? 1.07 : 1)); // 左右稍错开
      if (idx < len) d[idx] += amp * (ch ? -1 : 1);
    }
    // 简单一阶低通，去掉尾巴上的沙沙感
    let prev = 0;
    for (let i = 0; i < len; i++) {
      prev = prev * 0.62 + d[i] * 0.38;
      d[i] = prev;
    }
  }
  return buf;
}

let muted = localStorage.getItem('life-mute') === '1';

function ac(): AudioContext | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
      master = ctx.createGain();
      master.gain.value = muted ? 0 : 1;

      // 总线压缩：把散落的音头压在一起，听起来是「一件作品」而不是一堆采样
      const glue = ctx.createDynamicsCompressor();
      glue.threshold.value = -20;
      glue.knee.value = 14;
      glue.ratio.value = 3;
      glue.attack.value = 0.005;
      glue.release.value = 0.18;

      busIn = ctx.createGain();
      busIn.gain.value = 1;

      const conv = ctx.createConvolver();
      conv.buffer = makeRoomIR(ctx);
      const revReturn = ctx.createGain();
      revReturn.gain.value = 0.85;
      revSend = ctx.createGain();
      revSend.gain.value = 0.2; // 干湿比：牌桌不是教堂，湿一点点就够

      busIn.connect(glue);                 // 干声
      busIn.connect(revSend);
      revSend.connect(conv).connect(revReturn).connect(glue); // 湿声

      glue.connect(master).connect(ctx.destination);
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/** 调整混响量：0 干 / 0.35 偏湿 */
export function setReverb(amount: number) {
  if (revSend && ctx) revSend.gain.setTargetAtTime(Math.max(0, Math.min(0.6, amount)), ctx.currentTime, 0.05);
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

const out = () => busIn!;

/**
 * 带声位的输出点：pan −1 左 / 0 中 / +1 右。
 * 左右家打牌的声音从对应方向来，比全部居中真实得多。
 */
function outAt(pan?: number): AudioNode {
  if (!pan) return busIn!;
  const p = ctx!.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(busIn!);
  return p;
}

// ---------------- 基础合成 ----------------

/** 简单振荡音 */
function tone(freq: number, dur: number, opts: { type?: OscillatorType; vol?: number; slide?: number; delay?: number; pan?: number } = {}) {
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
  o.connect(g).connect(outAt(opts.pan));
  o.start(t0);
  o.stop(t0 + dur + 0.05);
}

/** 噪声爆发（敲击/摩擦） */
function noise(dur: number, opts: { vol?: number; lp?: number; hp?: number; delay?: number; pan?: number } = {}) {
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
  node.connect(g).connect(outAt(opts.pan));
  src.start(t0);
}

/** 古筝/琵琶式拨弦（Karplus-Strong 简化版） */
function pluck(freq: number, dur = 1.2, vol = 0.16, delay = 0, pan = 0) {
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
  src.connect(g).connect(outAt(pan));
  src.start(t0);
}

// ---------------- 模态合成 ----------------

/**
 * 模态合成：真实物体被敲击时响的是它自己的一组固有频率（模态），
 * 每个模态振幅不同、衰减速度不同。用「正弦 + 噪声」永远像电子音，
 * 换成几个衰减正弦叠加，立刻听得出是牌、是木头、还是玉石。
 *
 * @param partials [频率, 振幅, 衰减秒数][]
 */
function modal(
  partials: [number, number, number][],
  opts: { vol?: number; delay?: number; pan?: number; detune?: number } = {},
) {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime + (opts.delay ?? 0);
  const vol = opts.vol ?? 1;
  const dst = outAt(opts.pan);
  // 每次敲击的频率微抖：同一副牌每张听起来也略有差别，这点差别很关键
  const jitter = 1 + (Math.random() - 0.5) * (opts.detune ?? 0.03);
  for (const [f, a, dec] of partials) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = f * jitter;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(a * vol, t0 + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    o.connect(g).connect(dst);
    o.start(t0);
    o.stop(t0 + dec + 0.02);
  }
}

// ---------------- 事件音效 ----------------

/** 木质轻点（选中） */
export function sfxTap(pan?: number) {
  modal([[1180, 0.05, 0.06], [2360, 0.03, 0.04]], { pan });
  noise(0.02, { vol: 0.05, hp: 2600, pan });
}

/**
 * 牌/棋子落桌：接触瞬态 + 牌体模态 + 桌面木头的低频体腔。
 * 这是整局里出现最频繁的声音，它的质感基本决定了整个游戏的听感。
 */
export function sfxKnock(strong = false, pan?: number) {
  const k = strong ? 1.45 : 1;
  // 接触瞬态：很短的高频噪声，是「硬物相碰」的线索
  noise(0.014, { vol: 0.16 * k, hp: 3000, pan });
  noise(0.05, { vol: 0.1 * k, lp: 1600, pan });
  // 牌体模态（象牙/胶木质感）
  modal(
    [
      [196, 0.30 * k, 0.13],
      [742, 0.13 * k, 0.085],
      [1265, 0.085 * k, 0.06],
      [2180, 0.05 * k, 0.04],
      [3310, 0.028 * k, 0.028],
    ],
    { pan, detune: 0.05 },
  );
  // 桌面低频体腔：手指能感到的那一下"闷响"
  tone(112, 0.11, { type: 'sine', vol: 0.2 * k, slide: 0.62, pan });
}
/** 吃子：硬碰撞 + 被推开的拖擦 */
export function sfxCapture() {
  sfxKnock(true);
  modal([[520, 0.1, 0.09], [880, 0.06, 0.06]], { delay: 0.03 });
  noise(0.17, { vol: 0.13, lp: 1500, delay: 0.05 }); // 棋子被扫出去的摩擦
  tone(118, 0.2, { type: 'sine', vol: 0.24, slide: 0.6, delay: 0.05 });
}
/** 摸牌：牌从墙上抽出的轻擦 + 一点牌体共鸣 */
export function sfxDraw(pan?: number) {
  noise(0.055, { vol: 0.075, hp: 1900, pan });
  modal([[860, 0.045, 0.05], [1520, 0.025, 0.035]], { pan, detune: 0.06 });
}
/** 警示（将军） */
export function sfxAlert() {
  tone(740, 0.14, { type: 'square', vol: 0.12 });
  tone(988, 0.2, { type: 'square', vol: 0.12, delay: 0.12 });
}
/** 碰：两张牌几乎同时拍下，错开 25ms 才有"啪嗒"的双击感 */
export function sfxPeng(pan?: number) {
  sfxKnock(true, pan);
  sfxKnock(false, pan);
  modal([[440, 0.11, 0.13], [660, 0.07, 0.1]], { delay: 0.025, pan });
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

// ---------------- 人声合成（共振峰） ----------------
// 浏览器 TTS 念「碰/杠/胡」机械感最重，这里改用源-滤波器模型自己合成：
// 声门脉冲串（带颤音与随机抖动）过三个共振峰带通，再加辅音噪声起头。
// 出来的是有肉感的人声元音，不是电子音，也不依赖任何音频文件。

/** 元音共振峰 [F1,F2,F3]（成年男声基准） */
const VOWELS: Record<string, [number, number, number]> = {
  a: [730, 1090, 2440],
  e: [530, 1840, 2480],
  i: [270, 2290, 3010],
  o: [570, 840, 2410],
  u: [300, 870, 2240],
  // 「碰 pèng」的韵腹偏央
  eng: [500, 1400, 2400],
  // 「杠 gàng」
  ang: [700, 1150, 2500],
};

export interface VoiceTone {
  /** 基频（男声 ~110，女声 ~210） */
  f0: number;
  /** 声道长度缩放：女声/童声 >1，男声 1 */
  formantScale: number;
}

export const TONE_MALE: VoiceTone = { f0: 112, formantScale: 1 };
export const TONE_MALE_OLD: VoiceTone = { f0: 96, formantScale: 0.96 };
export const TONE_FEMALE: VoiceTone = { f0: 208, formantScale: 1.16 };

/** 声门脉冲串：比方波更接近真实声带，泛音丰富且能做抖动 */
function glottal(c: AudioContext, when: number, dur: number, f0: number, bend: number) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / c.sampleRate;
    const k = t / dur;
    // 声调曲线 + 颤音 + 微抖（真人不会是恒定音高）
    const f = f0 * (1 + bend * k) * (1 + Math.sin(t * 2 * Math.PI * 5.4) * 0.014 + (Math.random() - 0.5) * 0.008);
    phase += f / c.sampleRate;
    if (phase >= 1) phase -= 1;
    // Rosenberg 型声门波：开相上升、闭相快速回落
    const op = 0.62;
    let v: number;
    if (phase < op) v = 3 * (phase / op) ** 2 - 2 * (phase / op) ** 3;
    else v = 1 - ((phase - op) / (1 - op)) ** 2;
    d[i] = (v - 0.5) * 2;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.start(when);
  return src;
}

/**
 * 合成一个音节。
 * @param vowel  VOWELS 里的韵母
 * @param onset  起头辅音：'p' 爆破 / 'g' 软腭 / 'h' 送气 / '' 无
 * @param bend   声调：阴平 0、去声 -0.18、阳平 +0.14
 */
function syllable(vowel: keyof typeof VOWELS, onset: 'p' | 'g' | 'h' | '', tone: VoiceTone, when: number, dur: number, vol: number, bend: number) {
  const c = ac();
  if (!c) return;
  const F = VOWELS[vowel];

  // 辅音起头
  if (onset) {
    const hp = onset === 'h' ? 1200 : onset === 'p' ? 900 : 1600;
    const nd = onset === 'h' ? 0.09 : 0.035;
    noise(nd, { vol: vol * (onset === 'h' ? 0.5 : 0.75), hp, delay: Math.max(0, when - c.currentTime) });
  }
  const t0 = when + (onset ? (onset === 'h' ? 0.06 : 0.03) : 0);

  const src = glottal(c, t0, dur, tone.f0, bend);
  const env = c.createGain();
  env.gain.setValueAtTime(0, t0);
  env.gain.linearRampToValueAtTime(vol, t0 + 0.035);
  env.gain.setValueAtTime(vol, t0 + dur * 0.6);
  env.gain.exponentialRampToValueAtTime(0.0008, t0 + dur);

  // 三个共振峰并联
  const sum = c.createGain();
  sum.gain.value = 1;
  const gains = [1, 0.55, 0.22];
  const qs = [9, 11, 13];
  F.forEach((f, i) => {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f * tone.formantScale;
    bp.Q.value = qs[i];
    const gg = c.createGain();
    gg.gain.value = gains[i];
    src.connect(bp).connect(gg).connect(sum);
  });
  // 高频衰减，去掉电子味
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 3600;
  sum.connect(lp).connect(env).connect(out());
  src.stop(t0 + dur + 0.05);
}

/** 报「碰」（去声） */
export function voicePeng(tone: VoiceTone = TONE_MALE) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  syllable('eng', 'p', tone, c.currentTime + 0.01, 0.3, 0.5, -0.16);
}

/** 报「杠」（去声，更沉更长） */
export function voiceGang(tone: VoiceTone = TONE_MALE) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  syllable('ang', 'g', tone, c.currentTime + 0.01, 0.38, 0.55, -0.2);
}

/** 报「胡」（阳平，上扬） */
export function voiceHu(tone: VoiceTone = TONE_MALE) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  syllable('u', 'h', tone, c.currentTime + 0.01, 0.42, 0.55, 0.16);
}

/** 报「自摸」（去声 + 阴平，两个音节） */
export function voiceZimo(tone: VoiceTone = TONE_MALE) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const t = c.currentTime + 0.01;
  syllable('i', '', tone, t, 0.2, 0.42, -0.14);
  syllable('o', '', tone, t + 0.22, 0.34, 0.5, 0.02);
}

/** 角色的一声短应答（代替念整句台词，台词仍以气泡显示） */
export function voiceGrunt(tone: VoiceTone = TONE_MALE) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  const v = (['a', 'e', 'o'] as const)[Math.floor(Math.random() * 3)];
  syllable(v, '', tone, c.currentTime + 0.01, 0.16 + Math.random() * 0.1, 0.3, (Math.random() - 0.5) * 0.3);
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

/** 甩牌：破风 + 落桌（带声位，听得出是哪家打的） */
export function sfxThrow(pan?: number) {
  noise(0.11, { vol: 0.11, hp: 2400, pan });
  sfxKnock(false, pan);
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

/** 杠：三张拍下 + 低频轰鸣，是全局最重的一下 */
export function sfxGangHeavy(pan?: number) {
  sfxKnock(true, pan);
  // 低频冲击
  tone(56, 0.55, { type: 'sine', vol: 0.34, slide: 0.55, pan });
  noise(0.22, { vol: 0.16, lp: 1100, pan });
  // 三连牌体模态
  [0, 0.075, 0.15].forEach((d, i) => {
    modal(
      [[300 + i * 95, 0.16, 0.12], [900 + i * 180, 0.08, 0.07], [1900 + i * 240, 0.04, 0.045]],
      { delay: 0.03 + d, pan, detune: 0.05 },
    );
  });
  // 收尾镲片
  noise(0.5, { vol: 0.1, hp: 5200, delay: 0.2, pan });
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
function flute(freq: number, when: number, dur: number, vol = 0.12, pan = 0) {
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
  lp.connect(g).connect(outAt(pan));
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
function noiseAt(when: number, dur: number, vol: number, hp = 0, bp = 0, pan = 0) {
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
  node.connect(g).connect(outAt(pan));
  src.start(when);
}
/** 定时拨弦（用于旋律轨） */
function pluckAt(freq: number, when: number, dur = 1.2, vol = 0.14, pan = 0) {
  pluck(freq, dur, vol, Math.max(0, when - ctx!.currentTime), pan);
}
/** 古筝滑音：快速上行五声音阶跑动 */
function glissAt(when: number, base: number[], vol = 0.1) {
  base.forEach((f, i) => pluckAt(f, when + i * 0.045, 0.8, vol * (0.7 + i * 0.06)));
}

/** 力度抖动：±15%。同一句每次听起来略有不同，才不像复读 */
const vel = () => 0.85 + Math.random() * 0.3;
/** 落点抖动：±8ms，人手不可能踩得死准 */
const swing = () => (Math.random() - 0.5) * 0.016;

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
      if (inBar === 0) pluckAt(r / 2, when + swing(), 2.4, 0.12 * vel(), -0.28);
      if (inBar === 3) pluckAt(r * 1.5, when + swing(), 1.6, 0.08 * vel(), 0.3);
      if (inBar === 5) pluckAt(r * 2, when + swing(), 1.6, 0.07 * vel(), -0.18);
      // 箫主旋律（略偏右，与古筝分开）
      const m = mel[step];
      if (m > 0) {
        // 计算延音：数到下一个非 0
        let len = 1;
        for (let k = step + 1; k < 64 && mel[k] === 0 && len < 6; k++) len++;
        flute(m, when + swing(), stepDur * len * 0.92, 0.1 * vel(), 0.18);
      }
      // 尾小节古筝滑音收束
      if (step === 60) glissAt(when, [N.A3, N.C4, N.D4, N.E4, N.G4, N.A4], 0.07);
    },
  };
}

/** 铺底长音（弦乐/笙式持续音），给曲子撑出厅堂感 */
function padAt(freq: number, when: number, dur: number, vol = 0.05, pan = 0) {
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
  lp.connect(g).connect(outAt(pan));
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

      // 鼓组居中撑住地基；军鼓与踩镲各偏一侧，声场才不会挤成一条线
      if (inBar === 0) taikoAt(when, (hot ? 0.4 : 0.3) * vel());
      if (inBar === 5) kickAt(when, (hot ? 0.32 : 0.24) * vel());
      if (hot && inBar === 3) kickAt(when, 0.2 * vel());
      if (inBar === 2 || inBar === 6) noiseAt(when + swing(), 0.08, (hot ? 0.16 : 0.12) * vel(), 0, 1800, -0.25);
      noiseAt(when, 0.03, (inBar % 2 === 0 ? 0.05 : 0.028) * vel(), 6500, 0, 0.35); // 踩镲偏右
      if (hot) noiseAt(when + stepDur / 2, 0.025, 0.035, 7200, 0, 0.35);

      // 弹拨低音偏左、铺底做宽
      if (inBar === 0 || inBar === 3 || inBar === 6) pluckAt(bass[bar], when + swing(), 0.6, 0.15 * vel(), -0.3);
      if (inBar === 0) {
        padAt(bass[bar] * 2, when, stepDur * 8, hot ? 0.032 : 0.022, -0.55);
        padAt(bass[bar] * 2.01, when, stepDur * 8, hot ? 0.032 : 0.022, 0.55); // 双声道微失谐 = 宽
      }

      // 笛子主旋律偏右，长音用琵琶轮指托住
      const m = mel[step];
      if (m > 0) {
        let len = 1;
        for (let k = step + 1; k < 64 && mel[k] === 0 && len < 4; k++) len++;
        flute(m, when + swing(), stepDur * len * 0.9, 0.085 * vel(), 0.22);
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
