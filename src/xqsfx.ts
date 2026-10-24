/**
 * 象棋对局的特效音：开局鼓点、吃子、吃车那一声"锵"、将军、绝杀。
 *
 * 用户原话："设计一些3D出场动画，吃子特效，包括将军，开局，绝杀等，另外吃车有一句响亮的音效。"
 * 之前用户嫌过机器念字"傻"（配乐第三版去掉了人声），所以这里一句话都不念，全用锣鼓：
 * 戏台上"锵"的那一下——大鼓垫底、大锣定音、铙钹炸开——就是中国人耳朵里"好！"的声音。
 *
 * 都是现场合成（零音频文件），走 gamesfx 的总线（同一个混响、同一个压缩），静音时不出声。
 *
 *   堂鼓  正弦从 95Hz 往下滑 + 鼓皮噪声                 "咚"
 *   大锣  一组不成谐波的泛音，敲下去音高往下弯，尾巴长   "哐——"
 *   小锣  高一些，音高往上挑                           "当"
 *   铙钹  高通噪声 + 几个很高的金属泛音，炸开再散        "锵"
 *   木裂  几下很短的高频敲击 + 一点噪声                 棋子被打碎
 *   呼啸  带通噪声扫频                                 横幅飞进来
 */
import type { PType } from './xiangqi/rules';
import { isMuted, musicCore } from './gamesfx';

type Core = NonNullable<ReturnType<typeof musicCore>>;

function core(): Core | null {
  if (isMuted()) return null;
  return musicCore();
}

/** 一段白噪声（每个上下文一份） */
const noiseBufs = new WeakMap<BaseAudioContext, AudioBuffer>();
function noiseBuf(c: BaseAudioContext): AudioBuffer {
  let b = noiseBufs.get(c);
  if (!b) {
    b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseBufs.set(c, b);
  }
  return b;
}

/** 一组衰减正弦（模态合成）：[频率, 振幅, 衰减秒]；bend：起音后 0.4 秒内音高变到几倍 */
function partials(k: Core, t0: number, list: [number, number, number][], pan = 0, bend = 1) {
  const { c } = k;
  const dst = k.outAt(pan);
  for (const [f, a, dec] of list) {
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f, t0);
    if (bend !== 1) o.frequency.exponentialRampToValueAtTime(f * bend, t0 + 0.4);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(a, t0 + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
    o.connect(g).connect(dst);
    o.start(t0);
    o.stop(t0 + dec + 0.05);
  }
}

/** 一下噪声：滤波 + 指数衰减 */
function noiseHit(k: Core, t0: number, dur: number, vol: number, f: { hp?: number; lp?: number; bp?: number; q?: number; attack?: number; sweep?: [number, number] } = {}, pan = 0) {
  const { c } = k;
  const src = c.createBufferSource();
  src.buffer = noiseBuf(c);
  let node: AudioNode = src;
  const filt = (type: BiquadFilterType, freq: number, q = 0.7) => {
    const b = c.createBiquadFilter();
    b.type = type;
    b.frequency.setValueAtTime(freq, t0);
    b.Q.value = q;
    node.connect(b);
    node = b;
    return b;
  };
  if (f.hp) filt('highpass', f.hp);
  if (f.lp) filt('lowpass', f.lp);
  if (f.bp) {
    const b = filt('bandpass', f.bp, f.q ?? 1.2);
    if (f.sweep) {
      b.frequency.setValueAtTime(f.sweep[0], t0);
      b.frequency.exponentialRampToValueAtTime(f.sweep[1], t0 + dur);
    }
  }
  const g = c.createGain();
  const a = f.attack ?? 0.002;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + a);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  node.connect(g).connect(k.outAt(pan));
  src.start(t0, Math.random() * 1.5);
  src.stop(t0 + dur + 0.05);
}

/** 堂鼓"咚" */
function taiko(k: Core, t0: number, vol: number, pitch = 1, pan = 0) {
  const { c } = k;
  const o = c.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(95 * pitch, t0);
  o.frequency.exponentialRampToValueAtTime(44 * pitch, t0 + 0.32);
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.55);
  o.connect(g).connect(k.outAt(pan));
  o.start(t0);
  o.stop(t0 + 0.6);
  // 鼓皮：低通噪声的一下
  noiseHit(k, t0, 0.12, vol * 0.45, { lp: 900 }, pan);
  // 鼓腔的一点泛音
  partials(k, t0, [[180 * pitch, vol * 0.18, 0.18], [265 * pitch, vol * 0.08, 0.12]], pan);
}

/** 大锣"哐——"：音高往下弯 */
function bigGong(k: Core, t0: number, vol: number, base = 128, len = 2.6) {
  partials(
    k,
    t0,
    [
      [base, vol * 0.5, len],
      [base * 1.48, vol * 0.32, len * 0.8],
      [base * 2.11, vol * 0.24, len * 0.62],
      [base * 2.63, vol * 0.16, len * 0.5],
      [base * 3.37, vol * 0.11, len * 0.4],
      [base * 4.18, vol * 0.08, len * 0.3],
      [base * 5.9, vol * 0.05, len * 0.22],
    ],
    0,
    0.93,
  );
  noiseHit(k, t0, 0.35, vol * 0.25, { bp: base * 6, q: 0.8 });
}

/** 小锣"当"：音高往上挑 */
function smallGong(k: Core, t0: number, vol: number, base = 560, pan = 0) {
  partials(
    k,
    t0,
    [
      [base, vol * 0.42, 0.9],
      [base * 1.52, vol * 0.2, 0.6],
      [base * 2.4, vol * 0.12, 0.42],
      [base * 3.3, vol * 0.06, 0.3],
    ],
    pan,
    1.06,
  );
}

/** 铙钹"锵" */
function cymbal(k: Core, t0: number, vol: number, len = 1.3) {
  noiseHit(k, t0, len, vol * 0.55, { hp: 3200, attack: 0.001 }, -0.25);
  noiseHit(k, t0, len * 0.9, vol * 0.45, { hp: 3600, attack: 0.001 }, 0.25);
  noiseHit(k, t0, 0.2, vol * 0.5, { bp: 2400, q: 0.9 });
  partials(k, t0, [
    [3150, vol * 0.08, len * 0.5],
    [4380, vol * 0.07, len * 0.42],
    [5620, vol * 0.05, len * 0.35],
    [7230, vol * 0.04, len * 0.3],
  ]);
}

/**
 * 棋子相碰的"嗒"：用户原话"吃子时的碰撞声也调整一下，参考其他象棋软件那种很悦耳、清脆的声音"。
 * 原来是几下高通噪声叠出来的"裂"，听着毛、刺。实物棋子是一块硬木（或象牙）小圆饼，敲上去响的是它自己的几个固有频率：
 * 一下极短的接触声 + 两三千赫的几个泛音（很快衰减，所以"脆"）+ 棋盘底下一点木腔（所以"实"），没有毛刺的噪声尾巴。
 * bright：音高倍数（大子稍低、小子稍高）
 */
function clack(k: Core, t0: number, vol: number, bright = 1, pan = 0) {
  const j = 1 + (Math.random() - 0.5) * 0.04; // 每一下都略有不同
  const b = bright * j;
  noiseHit(k, t0, 0.004, vol * 0.5, { hp: 3200 }, pan);
  partials(
    k,
    t0,
    [
      [1180 * b, vol * 0.16, 0.07],
      [2360 * b, vol * 0.34, 0.05],
      [3610 * b, vol * 0.2, 0.038],
      [5170 * b, vol * 0.09, 0.024],
      [7020 * b, vol * 0.04, 0.016],
    ],
    pan,
  );
  // 棋盘的木腔：一点低频，让声音落得实
  partials(k, t0, [[255, vol * 0.13, 0.09], [510, vol * 0.06, 0.07]], pan);
}

/** 吃子的"啪嗒"：走过去的子先撞上被吃的子，紧跟着被吃的子被撞开（第二下轻一点、高一点） */
function clackPair(k: Core, t0: number, vol: number, bright = 1) {
  const pan = (Math.random() - 0.5) * 0.3;
  clack(k, t0, vol, bright, pan);
  clack(k, t0 + 0.036 + Math.random() * 0.01, vol * 0.55, bright * 1.12, pan + 0.15);
  // 被撞开的子在盘上滑一下（很轻）
  noiseHit(k, t0 + 0.05, 0.12, vol * 0.05, { lp: 1400, attack: 0.03 }, pan);
}

/** 呼啸（横幅飞进来） */
function whoosh(k: Core, t0: number, dur: number, vol: number, up = true) {
  noiseHit(k, t0, dur, vol, { bp: 800, q: 1.4, attack: dur * 0.7, sweep: up ? [400, 3200] : [3000, 300] });
}

// ───────────────────────── 对局里的几个时刻 ─────────────────────────

/** 开局：一串由慢到快的堂鼓，最后"锵"一下 */
export function xqSfxOpening() {
  const k = core();
  if (!k) return;
  const t0 = k.c.currentTime + 0.05;
  const hits = [0, 0.34, 0.6, 0.79, 0.92, 1.01, 1.08, 1.14];
  hits.forEach((d, i) => taiko(k, t0 + d, 0.22 + i * 0.05, 1 + (i % 2) * 0.06, i % 2 ? 0.2 : -0.2));
  const bang = t0 + 1.26;
  taiko(k, bang, 0.62, 0.9);
  bigGong(k, bang, 0.42, 150, 2.2);
  cymbal(k, bang, 0.42, 1.1);
}

let landAt = 0;
/** 入场时棋子落定：很轻的一下木头声（一排排落下来时最多十来声，挤在一起的只响一次） */
export function xqSfxLand() {
  const k = core();
  if (!k) return;
  const now = k.c.currentTime;
  if (now - landAt < 0.07) return;
  landAt = now;
  partials(k, now, [[620 + Math.random() * 160, 0.06, 0.07], [1650 + Math.random() * 300, 0.035, 0.045]], (Math.random() - 0.5) * 0.6);
  noiseHit(k, now, 0.025, 0.05, { hp: 2600 });
}

/** 走一步棋：落子"嗒"一声（清脆、短，一盘棋要听上百次，不能吵） */
export function xqSfxMove() {
  const k = core();
  if (!k) return;
  clack(k, k.c.currentTime + 0.005, 0.42, 0.96, (Math.random() - 0.5) * 0.25);
}

/**
 * 吃子。先是清脆的"啪嗒"（两子相碰、被吃的子撞开）；马炮再加一记堂鼓、一下小镲；
 * **吃车：响亮的一声"锵——"**：呼啸冲过去，堂鼓压底、大锣、铙钹一起炸开，再补一记回响的鼓。
 * voiced：紧跟着还要喊"吃车！"——锣镲收一点，别把人声盖住
 */
export function xqSfxCapture(victim: PType, voiced = false) {
  const k = core();
  if (!k) return;
  const t0 = k.c.currentTime + 0.01;
  const v = voiced ? 0.8 : 1;
  if (victim === 'R') {
    // 音量留了余量：响是响在锣和镲拖得长、几样一起炸，不是把峰值顶到削波
    whoosh(k, t0, 0.16, 0.14);
    const bang = t0 + 0.12;
    clackPair(k, bang, 0.6, 0.9);
    taiko(k, bang, 0.62, 0.85);
    bigGong(k, bang, 0.42 * v, 168, 2.8);
    cymbal(k, bang, 0.46 * v, 1.6);
    taiko(k, bang + 0.26, 0.32, 0.8);
    smallGong(k, bang + 0.26, 0.16 * v, 620);
    return;
  }
  if (victim === 'H' || victim === 'C') {
    clackPair(k, t0, 0.6, 0.94);
    taiko(k, t0 + 0.02, 0.42, 1.05);
    cymbal(k, t0 + 0.02, 0.16 * v, 0.55);
    return;
  }
  clackPair(k, t0, 0.55, 1.02);
}

/** 将军：呼啸 + 一记堂鼓 + 小锣"当" */
export function xqSfxCheck() {
  const k = core();
  if (!k) return;
  const t0 = k.c.currentTime + 0.02;
  whoosh(k, t0, 0.22, 0.16);
  taiko(k, t0 + 0.2, 0.6, 1);
  smallGong(k, t0 + 0.2, 0.34, 560);
  cymbal(k, t0 + 0.2, 0.18, 0.5);
}

/**
 * 绝杀："咚——咚——锵！"。你赢：锵之后小锣一串往上走；你输：只有低沉的大锣和一记闷鼓。
 */
export function xqSfxMate(win: boolean) {
  const k = core();
  if (!k) return;
  const t0 = k.c.currentTime + 0.05;
  taiko(k, t0, 0.7, 0.9);
  taiko(k, t0 + 0.46, 0.75, 0.86);
  const bang = t0 + 0.92;
  if (win) {
    taiko(k, bang, 0.9, 0.8);
    bigGong(k, bang, 0.6, 150, 3.2);
    cymbal(k, bang, 0.6, 1.8);
    [0.5, 0.68, 0.84, 0.98].forEach((d, i) => smallGong(k, bang + d, 0.18 + i * 0.03, 560 * Math.pow(1.122, i), i % 2 ? 0.3 : -0.3));
  } else {
    taiko(k, bang, 0.8, 0.7);
    bigGong(k, bang, 0.5, 98, 3.6);
    noiseHit(k, bang, 1.4, 0.12, { lp: 500 });
  }
}
