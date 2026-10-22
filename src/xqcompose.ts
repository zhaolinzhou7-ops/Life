/**
 * 象棋对局配乐的"作曲"部分：纯计算，不碰音频（单元测试能直接测）。
 *
 * 用户三次的原话：
 *   1. "对局音乐希望能丰富一点，不要每次都是那几种……比如山水的感觉、草原的感觉等……每次下棋的感觉都不一样。"
 *   2. "音乐不够好听。"
 *   3. "有点太单调了，而且没有那种琴棋书画的意境……类似于禅意的那种音乐。它不单单是只有一种音调或一种乐器，得丰富一些……
 *      有杀伐果断的音乐，也有横扫千军的，类似于在棋局走向不同的时候都会有音调的变化：刚开始、胶着、或者快结束的时候，
 *      分别都是不一样的。层次得丰富一些。"
 *
 * 第三版是**跟着棋局走的配乐**（游戏配乐里叫"动态配乐"：分层增减 + 按段落切换）：
 *   - **七种情绪**，按局势挑（moodFor）：开局 · 静（琴箫和鸣，溪水鸟鸣）、中局 · 行云流水、胶着 · 暗流（古筝摇指、
 *     堂鼓心跳）、攻杀 · 十面埋伏（琵琶扫弦、战鼓）、占优 · 横扫千军（笛子高亢、古筝跑动、大鼓）、劣势 · 风萧萧、
 *     残局 · 落子无声（古琴泛音、磬）。只在一句（四小节）唱完时换，听着是曲子往下走，不是硬切；
 *     将军了、吃大子了，攻杀的那一段最多一小节就进来；
 *   - **同一种情绪里也分层**：强度（intensity）越高，加进来的声部越多（支声、心跳鼓、扫弦加花）；
 *   - **四种乐队**，每盘随机一种：高山流水、江南丝竹、禅院松风、塞上曲。乐器**轮流对答**——这一句古琴，
 *     下一句箫接过去吹同一个主题；骨干音上还有第二件乐器跟着（中国音乐的"支声"）；
 *   - **自然声**（演奏层合成）：溪水、鸟鸣、松风、细雨，安静的段落才有；
 *   - **点缀**：将军——战鼓"咚、哒哒"带一声锣；吃掉车马炮——琵琶扫一下；终局赢、输、和各有一句收尾。
 * 每种情绪有自己的主题（A A' B A''），这盘棋第二次回到这种情绪时主题再现——一盘棋听下来有几个记得住的旋律。
 *
 * 第四版（用户原话："已经好很多了，把整体层次再丰富一些。音乐混搭。"）：**中西混搭、层层叠上去**——
 *   - 民乐领奏，底下加西洋 / 现代的几层（fusionBar）：弦乐群或合成器铺底、钢琴或竖琴分解和弦、大提琴或拨弦低音的低音线、
 *     有的乐队再加一点轻律动（底鼓、边击、沙锤）；攻杀里弦乐跳弓、定音鼓和琵琶扫弦、战鼓叠在一起；
 *   - 主旋律轮换里混进钢琴、大提琴：古琴一句、箫一句、钢琴一句；
 *   - B 句加一条**对位旋律**（多是大提琴，比主旋律低一个八度、节奏更宽，自己有起伏）；
 *   - 按段落递进叠层：A 句疏、A' 加分解和弦、B 句最满（对位 + 全部混搭声部）、A'' 回来也满；B 句末尾一阵镲的渐强过门。
 * 调式用中国五声的五种（宫商角徵羽）：同一个主音上换调式，开局羽调清幽、占优宫调明亮、劣势羽调低沉。
 */

/** 乐器（演奏层按这个名字合成音色） */
export type InstId =
  | 'xiao' // 箫：柔、气声
  | 'dizi' // 笛：亮、带倚音
  | 'zheng' // 古筝：拨弦
  | 'pipa' // 琵琶：拨弦，长音轮指
  | 'qin' // 古琴：低沉拨弦，余音长
  | 'harm' // 古琴泛音：清亮的高音
  | 'erhu' // 二胡：弓弦，揉弦、滑音
  | 'morin' // 马头琴：低一点的弓弦
  | 'drone' // 低音持续
  | 'sheng' // 笙：和声铺底
  | 'bell' // 编钟
  | 'qing' // 磬：寺院里的钵磬
  | 'wood' // 木鱼
  | 'tanggu' // 堂鼓：紧一点的中鼓
  | 'dagu' // 大鼓：战鼓
  | 'gong' // 锣
  | 'bo' // 钹：轻轻一下
  | 'saofu' // 琵琶扫弦：一把和弦（run 里是这几个音）
  | 'trem' // 古筝摇指：一个音上快速反复
  | 'gliss' // 古筝刮奏（一串上行）
  // ── 混搭进来的西洋 / 现代乐器 ──
  | 'piano' // 钢琴
  | 'harp' // 竖琴
  | 'strings' // 弦乐群（长音铺底）
  | 'spicc' // 弦乐跳弓（短促的八分音符）
  | 'cello' // 大提琴
  | 'bass' // 低音（拨弦）
  | 'pad' // 合成器长音（禅院用，像远处的空气）
  | 'timp' // 定音鼓（时值两步以上是滚奏）
  | 'kick' // 轻律动：底鼓
  | 'rim' // 轻律动：边击
  | 'shaker' // 轻律动：沙锤
  | 'swell'; // 镲的渐强（段落之间的过门）

export interface NoteEv {
  /** 这一句里第几步（一步 = 一个八分音符）；点缀（stinger）里可以是小数 */
  step: number;
  inst: InstId;
  /** MIDI 音高（打击乐没有） */
  midi?: number;
  /** 时值（步） */
  len: number;
  vol: number;
  pan: number;
  /** 倚音：先快速带一下这个音再到正音 */
  grace?: number;
  /** 从这个音滑上来（马头琴、二胡、古琴的吟猱） */
  slideFrom?: number;
  /** 刮奏、扫弦：要走的那几个音 */
  run?: number[];
  /** 主旋律 */
  lead?: boolean;
  /** 呼应：伴奏把主旋律句尾应一遍 */
  echo?: boolean;
  /** 支声：跟着主旋律骨干音的第二件乐器 */
  second?: boolean;
  /** 对位旋律：主旋律之外另一条自己的旋律（多是大提琴） */
  counter?: boolean;
  /** 混搭进来的那几层（铺底、分解和弦、低音线、律动） */
  layer?: boolean;
}

export type Mood = 'serene' | 'flow' | 'tense' | 'battle' | 'triumph' | 'peril' | 'endgame';

export interface AccArgs {
  /** 这一句里第几小节（0～3） */
  bar: number;
  /** 这一种情绪的主题里第几句（0 A，1 A'，2 B，3 A''） */
  idx: number;
  /** 这一小节的根音（MIDI，低音区） */
  root: number;
  /** 主音（MIDI，低音区） */
  tonic: number;
  /** 根音上方的纯五度（调式里没有就用纯四度） */
  fifth: number;
  steps: number;
  /** 句子的最后一小节 */
  cadence: boolean;
  /** 刚换到这种情绪的第一句（攻杀的第一句开头来一声锣） */
  first: boolean;
  /** 强度 0～1：越高加进来的声部越多 */
  intensity: number;
  rng: () => number;
  /** 调式里从 midi 往上的 k 个音（刮奏、跑动用） */
  scaleFrom: (midi: number, k: number) => number[];
}

export interface MoodDef {
  /** 显示用 */
  name: string;
  /** 速度：这盘基准速度的几倍 */
  tempo: number;
  rhythms: number[][];
  cadences: number[][];
  leap: number;
  /** 句中可以用的和声根音（调式里第几个音） */
  colors: number[];
  ornament: number;
  /** 混响、回声、自然声的多少（0～1） */
  wet: number;
  delay: number;
  amb: number;
  /** 强度到这么高，支声（第二件乐器跟骨干音）才进来 */
  secondAt: number;
  /** 句尾长音时伴奏应一遍（安静的段落才有） */
  echo: boolean;
  accomp: (a: AccArgs) => NoteEv[];
}

const at = (step: number, inst: InstId, len: number, vol: number, pan = 0, midi?: number): NoteEv => ({ step, inst, len, vol, pan, midi });

/** 宫商角徵羽五种调式 */
export const MODES = {
  gong: [0, 2, 4, 7, 9],
  shang: [0, 2, 5, 7, 10],
  jue: [0, 3, 5, 8, 10],
  zhi: [0, 2, 5, 7, 9],
  yu: [0, 3, 5, 7, 10],
};

const R44 = [
  [2, 2, 2, 2],
  [3, 1, 2, 2],
  [2, 1, 1, 2, 2],
  [2, 2, 1, 1, 2],
  [4, 2, 2],
  [3, 1, 4],
  [2, 1, 1, 4],
  [1, 1, 2, 4],
];
const C44 = [[8], [6, -2], [2, 6], [3, 1, 4], [2, 2, 4], [4, 4]];
const R44_SLOW = [
  [4, 4],
  [6, 2],
  [2, 6],
  [3, 1, 4],
  [4, 2, 2],
  [2, 2, 4],
];
const C44_SLOW = [[8], [6, -2], [4, -4]];

/** 七种情绪：段落的速度、节奏、伴奏织体、效果。伴奏按强度加声部 */
export const MOODS: Record<Mood, MoodDef> = {
  serene: {
    name: '开局 · 静',
    tempo: 0.92,
    rhythms: R44_SLOW,
    cadences: C44_SLOW,
    leap: 0.25,
    colors: [2, 3, 4],
    ornament: 0.25,
    wet: 0.48,
    delay: 0.2,
    amb: 1,
    secondAt: 0.55,
    echo: true,
    accomp: ({ bar, root, fifth, cadence, intensity, scaleFrom }) => {
      // 古筝疏疏地拨根音、五度；古琴两小节一个低音；强度上来笙轻轻铺上
      const out = [at(0, 'zheng', 6, 0.055, -0.3, root + 12), at(3, 'zheng', 3, 0.035, 0.3, fifth + 12)];
      if (bar % 2 === 0) out.push(at(0, 'qin', 8, 0.05, -0.15, root));
      if (intensity > 0.35) out.push(at(0, 'sheng', 8, 0.011, 0.25, root + 12), at(0, 'sheng', 8, 0.009, -0.25, fifth + 12));
      if (cadence) out.push({ ...at(6, 'gliss', 2, 0.032, 0.1), run: scaleFrom(root + 12, 6) });
      return out;
    },
  },
  flow: {
    name: '中局 · 行云流水',
    tempo: 1,
    rhythms: R44,
    cadences: C44,
    leap: 0.2,
    colors: [1, 3, 4],
    ornament: 0.35,
    wet: 0.4,
    delay: 0.18,
    amb: 0.45,
    secondAt: 0.4,
    echo: true,
    accomp: ({ bar, idx, root, fifth, cadence, steps, intensity, scaleFrom }) => {
      const out: NoteEv[] = [at(0, 'qin', 4, 0.05, -0.15, root)];
      // 古筝流水分解（A、A' 两句）：强度低时半小节，高时整小节；B 和 A'' 换成钢琴 / 竖琴分解（混搭那几层）
      const arp = [root + 12, fifth + 12, root + 24, fifth + 12, root + 24, fifth + 24, root + 24, fifth + 12];
      const upto = idx >= 2 ? 0 : intensity > 0.55 ? steps : 4;
      for (let s = 0; s < upto; s += 1) if (s % 2 === 0 || intensity > 0.75) out.push(at(s, 'zheng', 2, s === 0 ? 0.05 : 0.028, s % 4 === 0 ? -0.3 : 0.25, arp[s]));
      if (intensity > 0.4) out.push(at(0, 'sheng', 8, 0.011, 0.3, root + 12), at(0, 'sheng', 8, 0.009, -0.3, fifth + 12));
      if (intensity > 0.6 && bar % 2 === 0) out.push(at(0, 'tanggu', 1, 0.03, 0.1));
      if (cadence) out.push({ ...at(5, 'gliss', 3, 0.03, 0.1), run: scaleFrom(root + 12, 7) });
      return out;
    },
  },
  tense: {
    name: '胶着 · 暗流',
    tempo: 0.96,
    rhythms: [
      [4, 4],
      [3, 1, 4],
      [2, 2, 4],
      [6, 2],
      [2, 2, 2, 2],
    ],
    cadences: [[8], [6, -2], [4, 4]],
    leap: 0.15,
    // 底下是主音的持续音（摇指 + 长鸣），旋律的和声也压在主音上，句尾才到属音
    colors: [0],
    ornament: 0.2,
    wet: 0.36,
    delay: 0.26,
    amb: 0.25,
    secondAt: 0.5,
    echo: false,
    accomp: ({ bar, tonic, root, fifth, steps, intensity }) => {
      // 古筝摇指压着主音和五度，像水底下的暗流；堂鼓"咚—咚"心跳，越胶着越响
      const out: NoteEv[] = [at(0, 'trem', steps, 0.018 + 0.022 * intensity, -0.25, tonic + 12), at(0, 'trem', steps, 0.012 + 0.016 * intensity, 0.25, fifth + 12)];
      if (bar % 2 === 0) out.push(at(0, 'drone', steps * 2, 0.012, 0, tonic + 12));
      if (intensity > 0.25) out.push(at(0, 'tanggu', 1, 0.03 + 0.04 * intensity, 0), at(1, 'tanggu', 1, 0.02 + 0.025 * intensity, 0));
      if (intensity > 0.6) out.push(at(6, 'pipa', 1, 0.035, 0.3, root + 12));
      return out;
    },
  },
  battle: {
    name: '攻杀 · 十面埋伏',
    tempo: 1.3,
    rhythms: [
      [1, 1, 2, 2, 2],
      [2, 1, 1, 2, 2],
      [2, 2, 1, 1, 2],
      [1, 1, 1, 1, 2, 2],
      [3, 1, 2, 2],
      [2, 2, 2, 2],
    ],
    cadences: [
      [2, 2, 4],
      [3, 1, 4],
      [4, 4],
      [1, 1, 2, 4],
    ],
    leap: 0.3,
    colors: [3, 4, 1],
    ornament: 0.15,
    wet: 0.24,
    delay: 0.08,
    amb: 0,
    secondAt: 0.4,
    echo: false,
    accomp: ({ bar, root, fifth, first, intensity }) => {
      // 琵琶扫弦（3+3+2 的重音），战鼓一、三拍，堂鼓密打，句首一声钹；刚杀进来那一句先来一声锣
      const chord = [root + 12, fifth + 12, root + 24];
      const out: NoteEv[] = [
        { ...at(0, 'saofu', 2, 0.06, -0.2), run: chord },
        { ...at(3, 'saofu', 2, 0.045, -0.2), run: chord },
        { ...at(6, 'saofu', 2, 0.045, -0.2), run: chord },
        at(0, 'dagu', 1, 0.08 + 0.05 * intensity, 0),
        at(4, 'dagu', 1, 0.06 + 0.04 * intensity, 0),
        at(0, 'qin', 4, 0.045, -0.1, root),
      ];
      if (intensity > 0.5) for (const s of [1, 3, 5, 7]) out.push(at(s, 'tanggu', 1, 0.022 + 0.02 * intensity, 0.15));
      if (intensity > 0.7) out.push({ ...at(5, 'saofu', 1, 0.03, -0.2), run: chord });
      if (bar === 0 && (first || intensity > 0.8)) out.push(at(0, 'bo', 4, 0.022, 0.2));
      if (bar === 0 && first) out.push(at(0, 'gong', 8, 0.05, -0.1));
      return out;
    },
  },
  triumph: {
    name: '占优 · 横扫千军',
    tempo: 1.15,
    rhythms: [
      [2, 2, 2, 2],
      [3, 1, 2, 2],
      [2, 1, 1, 2, 2],
      [1, 1, 2, 2, 2],
      [4, 2, 2],
      [2, 2, 4],
    ],
    cadences: C44,
    leap: 0.3,
    colors: [1, 3, 4],
    ornament: 0.3,
    wet: 0.34,
    delay: 0.15,
    amb: 0.15,
    secondAt: 0.3,
    echo: false,
    accomp: ({ bar, root, fifth, steps, cadence, intensity, scaleFrom }) => {
      // 古筝一路往上跑，笙铺满和声，大鼓开拍、堂鼓第三拍，句首一声钹
      const run = scaleFrom(root + 12, steps);
      const out: NoteEv[] = run.map((m, s) => at(s, 'zheng', 1, s === 0 ? 0.04 : 0.024, s % 2 ? 0.3 : -0.3, m));
      out.push(at(0, 'sheng', 8, 0.012, 0.3, root + 12), at(0, 'sheng', 8, 0.01, -0.3, fifth + 12), at(0, 'sheng', 8, 0.008, 0, root + 24));
      out.push(at(0, 'dagu', 1, 0.07, 0), at(4, 'tanggu', 1, 0.045, 0.1), at(0, 'qin', 4, 0.045, -0.1, root));
      if (bar === 0 && intensity > 0.5) out.push(at(0, 'bo', 4, 0.02, 0.2));
      if (cadence) out.push({ ...at(5, 'gliss', 3, 0.035, 0.1), run: scaleFrom(root + 24, 7) });
      return out;
    },
  },
  peril: {
    name: '劣势 · 风萧萧',
    tempo: 0.86,
    rhythms: [
      [4, 4],
      [6, 2],
      [3, 1, 4],
      [2, 6],
      [4, 2, 2],
    ],
    cadences: [[8], [6, -2]],
    leap: 0.2,
    colors: [3, 2, 4],
    ornament: 0.3,
    wet: 0.46,
    delay: 0.2,
    amb: 0.7,
    secondAt: 0.7,
    echo: true,
    accomp: ({ bar, tonic, root, steps, intensity }) => {
      // 低音长鸣压着，古琴低音一下一下，远处一声堂鼓
      const out: NoteEv[] = [at(0, 'qin', 6, 0.05, -0.15, root)];
      if (bar % 2 === 0) out.push(at(0, 'drone', steps * 2, 0.016, 0, tonic + 12), at(0, 'tanggu', 1, 0.028, 0.2));
      if (intensity > 0.6) out.push(at(0, 'trem', steps, 0.016, 0.3, tonic + 12));
      return out;
    },
  },
  endgame: {
    name: '残局 · 落子无声',
    tempo: 0.9,
    rhythms: R44_SLOW,
    cadences: C44_SLOW,
    leap: 0.25,
    colors: [2, 3, 4],
    ornament: 0.25,
    wet: 0.5,
    delay: 0.22,
    amb: 0.6,
    secondAt: 0.8,
    echo: true,
    accomp: ({ bar, root, fifth, cadence, intensity }) => {
      // 子少了，声音也少：古琴两小节一个低音，句首一声磬，句尾一个泛音
      const out: NoteEv[] = [];
      if (bar % 2 === 0) out.push(at(0, 'qin', 8, 0.05, -0.15, root));
      if (bar === 0) out.push(at(0, 'qing', 8, 0.028, 0.3, root + 36));
      if (intensity > 0.5) out.push(at(0, 'sheng', 8, 0.01, 0.25, fifth + 12));
      if (cadence) out.push(at(6, 'harm', 4, 0.035, 0.2, root + 36));
      return out;
    },
  },
};

/** 一盘棋的乐队：每种情绪用哪种调式、谁吹主旋律（轮流）、谁跟骨干音；自然声 */
export interface Palette {
  id: string;
  name: string;
  /** 一句话：用了什么、什么意境 */
  desc: string;
  tonic: number;
  keyShift: [number, number];
  bpm: [number, number];
  modes: Record<Mood, number[]>;
  leads: Record<Mood, InstId[]>;
  second: Record<Mood, InstId>;
  /** 自然声：溪水、松风、细雨、鸟鸣（0～1） */
  amb: { stream: number; wind: number; rain: number; birds: number };
  /** 混搭：这一队配哪些西洋 / 现代声部 */
  fusion: Fusion;
  /** 整体音量（各乐队响度拉齐用） */
  gain: number;
}

/**
 * 混搭的几层。用户原话："已经好很多了，把整体层次再丰富一些。音乐混搭。"
 * 民乐领奏，底下是西洋的弦乐、钢琴、大提琴，有的再加一点现代的轻律动——"新民乐"那种中西混搭。
 */
export interface Fusion {
  /** 铺底：弦乐群，还是合成器长音（禅院） */
  pad: 'strings' | 'pad';
  /** 分解和弦：钢琴还是竖琴 */
  arp: 'piano' | 'harp';
  /** 低音线：大提琴还是拨弦低音 */
  bass: 'cello' | 'bass';
  /** 对位旋律用什么 */
  counter: InstId;
  /** 中局、攻杀、占优里有没有轻律动（底鼓、边击、沙锤） */
  groove: boolean;
}

const { gong, shang, jue, zhi, yu } = MODES;

export const PALETTES: Palette[] = [
  {
    id: 'gaoshan',
    name: '高山流水',
    desc: '古琴与箫一问一答，古筝如流水，溪声鸟鸣',
    tonic: 57,
    keyShift: [-2, 3],
    bpm: [58, 66],
    modes: { serene: yu, flow: zhi, tense: shang, battle: yu, triumph: gong, peril: yu, endgame: shang },
    leads: {
      serene: ['qin', 'xiao', 'piano'],
      flow: ['xiao', 'piano', 'zheng'],
      tense: ['qin', 'cello'],
      battle: ['pipa', 'dizi'],
      triumph: ['dizi', 'zheng', 'piano'],
      peril: ['xiao', 'cello'],
      endgame: ['qin', 'piano'],
    },
    second: { serene: 'zheng', flow: 'sheng', tense: 'sheng', battle: 'dizi', triumph: 'sheng', peril: 'qin', endgame: 'zheng' },
    amb: { stream: 1, wind: 0.15, rain: 0, birds: 0.7 },
    fusion: { pad: 'strings', arp: 'piano', bass: 'cello', counter: 'cello', groove: false },
    gain: 1,
  },
  {
    id: 'jiangnan',
    name: '江南丝竹',
    desc: '笛子、二胡、琵琶、古筝，细雨小桥',
    tonic: 55,
    keyShift: [-3, 3],
    bpm: [62, 70],
    modes: { serene: zhi, flow: gong, tense: yu, battle: yu, triumph: gong, peril: yu, endgame: zhi },
    leads: {
      serene: ['dizi', 'piano', 'zheng'],
      flow: ['dizi', 'erhu', 'piano'],
      tense: ['erhu', 'pipa'],
      battle: ['pipa', 'dizi'],
      triumph: ['dizi', 'pipa'],
      peril: ['erhu', 'cello'],
      endgame: ['erhu', 'piano'],
    },
    second: { serene: 'sheng', flow: 'zheng', tense: 'sheng', battle: 'erhu', triumph: 'sheng', peril: 'zheng', endgame: 'sheng' },
    amb: { stream: 0.45, wind: 0, rain: 0.8, birds: 0.3 },
    fusion: { pad: 'strings', arp: 'harp', bass: 'bass', counter: 'erhu', groove: true },
    gain: 1,
  },
  {
    id: 'chanyuan',
    name: '禅院松风',
    desc: '古琴、箫、编钟和磬，松风入耳',
    tonic: 50,
    keyShift: [-2, 3],
    bpm: [52, 60],
    modes: { serene: shang, flow: yu, tense: shang, battle: yu, triumph: gong, peril: jue, endgame: shang },
    leads: {
      serene: ['qin', 'xiao', 'piano'],
      flow: ['xiao', 'piano', 'qin'],
      tense: ['qin', 'cello'],
      battle: ['pipa', 'dizi'],
      triumph: ['zheng', 'dizi'],
      peril: ['xiao', 'cello'],
      endgame: ['qin', 'piano'],
    },
    second: { serene: 'bell', flow: 'sheng', tense: 'sheng', battle: 'dizi', triumph: 'sheng', peril: 'qin', endgame: 'bell' },
    amb: { stream: 0.2, wind: 1, rain: 0, birds: 0.5 },
    fusion: { pad: 'pad', arp: 'piano', bass: 'cello', counter: 'cello', groove: false },
    gain: 1,
  },
  {
    id: 'saishang',
    name: '塞上曲',
    desc: '马头琴、二胡、笛子，长风万里',
    tonic: 52,
    keyShift: [-2, 3],
    bpm: [60, 68],
    modes: { serene: yu, flow: gong, tense: yu, battle: gong, triumph: gong, peril: yu, endgame: yu },
    leads: {
      serene: ['xiao', 'morin', 'cello'],
      flow: ['erhu', 'dizi', 'piano'],
      tense: ['morin', 'pipa', 'cello'],
      battle: ['pipa', 'dizi'],
      triumph: ['dizi', 'erhu'],
      peril: ['morin', 'cello'],
      endgame: ['xiao', 'erhu', 'piano'],
    },
    second: { serene: 'sheng', flow: 'zheng', tense: 'sheng', battle: 'erhu', triumph: 'sheng', peril: 'qin', endgame: 'zheng' },
    amb: { stream: 0, wind: 0.9, rain: 0, birds: 0.2 },
    fusion: { pad: 'strings', arp: 'harp', bass: 'cello', counter: 'cello', groove: true },
    gain: 1,
  },
];

/** 各乐器吹旋律时比"旋律中心"高低几个八度：古琴、马头琴、大提琴低一个八度，编钟高一个 */
const LEAD_OCT: Partial<Record<InstId, number>> = { qin: -1, morin: -1, cello: -1, bell: 1 };

/** 可复现的随机数（同一个种子作出同一首，测试用；实际每盘种子随机） */
export function rngOf(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 旋律里的一个音：步、时值、音阶位置 */
export interface MelNote {
  step: number;
  len: number;
  deg: number;
}

interface Theme {
  /** 第一句（4 小节，停在属音）；前两小节就是动机 */
  a: MelNote[];
  /** 答句的后两小节（落回主音），步数从第 2 小节算起 */
  answer: MelNote[];
  progA: number[];
  progAns: number[];
}

interface MoodState {
  theme: Theme | null;
  /** 主题里下一句是第几句（0～3） */
  idx: number;
  /** 唱完了几轮（两轮换一个主题） */
  cycle: number;
  /** 主旋律轮到哪件乐器 */
  turn: number;
}

/** 这一盘的配乐：乐队、调高、速度、每种情绪的主题 */
export interface Score {
  palette: Palette;
  /** 移调之后的主音（MIDI） */
  tonic: number;
  /** 基准速度（每种情绪再乘自己的倍数） */
  bpm: number;
  /** 调名，如"D 调" */
  key: string;
  rng: () => number;
  moods: Partial<Record<Mood, MoodState>>;
  /** 上一句是什么情绪（换情绪时第一句要知道） */
  last: Mood | null;
}

/** 一句：四小节的音符（步从 0 算起）和这一句的速度 */
export interface Phrase {
  mood: Mood;
  bpm: number;
  steps: number;
  notes: NoteEv[];
  /** 这一句主旋律是哪件乐器 */
  lead: InstId;
}

const NAMES = ['C', '#C', 'D', 'bE', 'E', 'F', '#F', 'G', 'bA', 'A', 'bB', 'B'];
export const SPB = 8;
const BARS = 4;

/** 调式里第 k 个音（可以跨八度、可以是负数）→ MIDI */
export function degMidi(mode: number[], tonic: number, k: number): number {
  const n = mode.length;
  const oct = Math.floor(k / n);
  return tonic + 12 * oct + mode[((k % n) + n) % n];
}

/** 挑一种乐队：不和上一盘重复 */
export function pickPalette(lastId: string | null, rng: () => number): Palette {
  const pool = PALETTES.filter((s) => s.id !== lastId);
  return pool[Math.floor(rng() * pool.length)];
}

export function newScore(palette: Palette, seed = Math.floor(Math.random() * 2 ** 31)): Score {
  const rng = rngOf(seed);
  const shift = palette.keyShift[0] + Math.floor(rng() * (palette.keyShift[1] - palette.keyShift[0] + 1));
  const tonic = palette.tonic + shift;
  const bpm = Math.round(palette.bpm[0] + rng() * (palette.bpm[1] - palette.bpm[0]));
  return { palette, tonic, bpm, key: `${NAMES[tonic % 12]} 调`, rng, moods: {}, last: null };
}

/** 属音在调式里是第几个音（有纯五度用纯五度；角调没有，用小六度那个） */
export function fifthIdx(mode: number[]): number {
  const i = mode.indexOf(7);
  return i >= 0 ? i : mode.indexOf(8) >= 0 ? mode.indexOf(8) : Math.floor(mode.length / 2);
}

/** 根音上方的纯五度（调式里没有就用纯四度、再没有就用八度），MIDI */
function fifthAbove(mode: number[], tonic: number, root: number): number {
  const pcs = new Set(mode.map((x) => (tonic + x) % 12));
  if (pcs.has((root + 7) % 12)) return root + 7;
  if (pcs.has((root + 5) % 12)) return root + 5;
  return root + 12;
}

/**
 * 这个根音上的稳定音（相对主音的半音，0～11）：根音、五度、三度（调式里有哪个算哪个）。
 * 强拍上的旋律音尽量落在这里面，和低音不打架。
 */
export function stablePcs(mode: number[], rootDeg: number): Set<number> {
  const n = mode.length;
  const rootPc = mode[((rootDeg % n) + n) % n];
  const out = new Set<number>();
  for (const iv of [0, 7, 3, 4]) {
    const pc = (rootPc + iv) % 12;
    if (mode.includes(pc)) out.add(pc);
  }
  if (out.size < 2) for (const iv of [5, 9]) if (mode.includes((rootPc + iv) % 12)) out.add((rootPc + iv) % 12);
  return out;
}

/** 一步在小节里有多"重"：小节头 3，半小节 2，拍上 1，拍后 0 */
function strength(step: number): number {
  const s = step % SPB;
  if (s === 0) return 3;
  return s === 4 ? 2 : s % 2 === 0 ? 1 : 0;
}

/** 按节奏型把几个小节铺成音符的位置（还没有音高） */
function slotsOf(rhythms: number[][], startStep: number): { step: number; len: number }[] {
  const out: { step: number; len: number }[] = [];
  rhythms.forEach((rh, b) => {
    let s = startStep + b * SPB;
    for (const d of rh) {
      if (d > 0) out.push({ step: s, len: d });
      s += Math.abs(d);
    }
  });
  return out;
}

/**
 * 给一串位置配音高：拱形（从 start 往上走到 peak，再落到 end），小步为主、跳进之后反向级进，
 * 强拍落稳定音，不连着三次同一个音，最后一步步收进落音 end。
 */
function pitchLine(
  slots: { step: number; len: number }[],
  o: {
    mode: number[];
    leap: number;
    rng: () => number;
    start: number;
    peak: number;
    end: number;
    lo: number;
    hi: number;
    /** 第几步的和声根音（调式第几个音） */
    rootAt: (step: number) => number;
    /** 前面已经有的音（接着写的时候，用它判断级进 / 跳进） */
    prev?: number[];
  },
): MelNote[] {
  const { mode, rng } = o;
  const n = mode.length;
  const N = slots.length;
  const hist = [...(o.prev ?? [])];
  const out: MelNote[] = [];
  const peakAt = 0.45 + rng() * 0.2;
  const contour = (t: number) => (t <= peakAt ? o.start + (o.peak - o.start) * (t / peakAt) : o.peak + (o.end - o.peak) * ((t - peakAt) / (1 - peakAt)));
  slots.forEach((sl, i) => {
    if (i === N - 1) {
      out.push({ ...sl, deg: o.end });
      hist.push(o.end);
      return;
    }
    if (i === 0 && !hist.length) {
      out.push({ ...sl, deg: o.start });
      hist.push(o.start);
      return;
    }
    const prev = hist[hist.length - 1];
    const prev2 = hist.length >= 2 ? hist[hist.length - 2] : undefined;
    const lastMove = prev2 === undefined ? 0 : prev - prev2;
    const target = contour(N > 1 ? i / (N - 1) : 0);
    const stable = stablePcs(mode, o.rootAt(sl.step));
    const st = strength(sl.step);
    let best = prev;
    let bestCost = Infinity;
    for (let cand = prev - 4; cand <= prev + 4; cand++) {
      if (cand < o.lo || cand > o.hi) continue;
      const move = cand - prev;
      const mag = Math.abs(move);
      // 连着三次同一个音不要（最后一个音是定死的落音：前一个已经是落音，这里就不能再是）
      if (mag === 0 && prev2 === prev) continue;
      if (i === N - 2 && cand === o.end && prev === o.end) continue;
      let cost = Math.abs(cand - target);
      // 级进最好；隔一个音（五声里是三度、四度）也顺；再大是跳进
      cost += mag === 0 ? 0.9 : mag === 1 ? 0 : mag === 2 ? 0.45 : mag === 3 ? 1.6 - o.leap * 1.2 : 2.6 - o.leap * 1.4;
      // 来回晃（5 6 5 6）少一点
      if (mag > 0 && cand === prev2) cost += 0.35;
      // 剩下几个音要能一步步走到落音：离落音太远就得往回收，免得最后两三个大跳硬落下去
      cost += Math.max(0, Math.abs(cand - o.end) - (N - 1 - i) * 1.4) * 1.3;
      // 跳进之后往回走
      if (Math.abs(lastMove) >= 2 && move !== 0 && Math.sign(move) === Math.sign(lastMove)) cost += 1.6;
      // 强拍落稳定音
      const pc = mode[((cand % n) + n) % n];
      if (!stable.has(pc)) cost += st === 3 ? 2.4 : st === 2 ? 1.2 : st === 1 ? 0.3 : 0;
      // 倒数第二个音：离落音一两步，级进收进去
      if (i === N - 2) {
        const d = Math.abs(cand - o.end);
        cost += d === 0 ? 0.8 : d <= 1 ? 0 : d === 2 ? 0.5 : 2;
      }
      cost += rng() * 0.7;
      if (cost < bestCost) {
        bestCost = cost;
        best = cand;
      }
    }
    out.push({ ...sl, deg: best });
    hist.push(best);
  });
  return out;
}

const pick = <T,>(arr: T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)];

/** 一句往上走多高：音少的句子（慢段落一句才四五个音）走不了太高，不然只能大跳上去 */
const reach = (want: number, notes: number) => Math.max(0, Math.min(want, Math.ceil(notes / 2)));

/** 节奏动机一样的那种句子：[r1, r2, r1, 句尾] */
function phraseRhythm(def: MoodDef, rng: () => number): number[][] {
  const r1 = pick(def.rhythms, rng);
  let r2 = pick(def.rhythms, rng);
  if (r2 === r1 && def.rhythms.length > 1) r2 = pick(def.rhythms, rng);
  return [r1, r2, r1, pick(def.cadences, rng)];
}

/**
 * 局势 → 情绪和强度。下棋的人自己的视角：evalMe 正是你占优（车≈1000）。
 */
export interface MusicCtx {
  /** 走了几步（半回合） */
  plies: number;
  /** 盘面上还剩多少子力（开局 = 1） */
  material: number;
  /** 引擎对你这一方的评分；还不知道就是 null */
  evalMe: number | null;
  /** 最近四步里将了几次军 */
  checks: number;
  /** 最近四步里吃掉了几个车马炮 */
  bigCaptures: number;
  /** 你正被将军，或者对方有杀 */
  danger: boolean;
  /** 多少步没吃子了 */
  quiet: number;
  /** 棋下完了 */
  over?: boolean;
}

export function moodFor(c: MusicCtx): { mood: Mood; intensity: number } {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  if (c.over) return { mood: 'serene', intensity: 0.1 };
  const ev = c.evalMe ?? 0;
  const fight = c.checks >= 1 || c.danger || c.bigCaptures >= 2;
  // 你大优还在将军、吃子：横扫千军，越杀越响
  if (fight && !c.danger && c.evalMe !== null && ev >= 450) return { mood: 'triumph', intensity: clamp(0.6 + 0.1 * c.checks + 0.1 * c.bigCaptures) };
  // 将军、被杀、兑子（四步里吃掉两个车马炮）：杀伐果断。只吃一个子不算——中局里换子是常事，不能一吃子就打鼓
  if (fight) return { mood: 'battle', intensity: clamp(0.45 + 0.15 * c.checks + 0.1 * c.bigCaptures + (c.danger ? 0.25 : 0)) };
  // 大优 / 大劣：横扫千军 / 风萧萧
  if (c.evalMe !== null && ev >= 450) return { mood: 'triumph', intensity: clamp(0.4 + (ev - 450) / 1500) };
  if (c.evalMe !== null && ev <= -450) return { mood: 'peril', intensity: clamp(0.4 + (-ev - 450) / 1500) };
  // 子少了：残局
  if (c.material <= 0.38) return { mood: 'endgame', intensity: clamp(0.3 + Math.abs(ev) / 1200) };
  // 开局：子都在，走了没几步
  if (c.plies < 16 && c.material >= 0.9) return { mood: 'serene', intensity: clamp(0.15 + c.plies / 30) };
  // 胶着：下了好一阵、分差不大、好久没吃子
  if (c.plies >= 24 && Math.abs(ev) < 200 && c.quiet >= 8) return { mood: 'tense', intensity: clamp(0.3 + (c.quiet - 8) / 24) };
  return { mood: 'flow', intensity: clamp(0.3 + c.plies / 120) };
}

/** 这一种情绪的主题：A 句（停在属音）+ 答句（接在动机后面落回主音） */
function makeTheme(sc: Score, mood: Mood): Theme {
  const def = MOODS[mood];
  const mode = sc.palette.modes[mood];
  const rng = sc.rng;
  const n = mode.length;
  const base = n; // 旋律中心：主音高一个八度
  const fi = fifthIdx(mode);
  const lo = base - 3;
  const hi = base + n + 2;
  const progA = [0, pick(def.colors, rng), pick(def.colors, rng), fi];
  const progAns = [0, progA[1], pick(def.colors, rng), 0];
  const rootA = (s: number) => progA[Math.floor(s / SPB) % BARS];
  const start = pickStable(mode, base, progA[0], rng);
  const aSlots = slotsOf(phraseRhythm(def, rng), 0);
  const a = pitchLine(aSlots, { mode, leap: def.leap, rng, start, peak: start + reach(base + 2 + Math.floor(rng() * 3) - start, aSlots.length), end: base + fi, lo, hi, rootAt: rootA });
  const motif = a.filter((x) => x.step < 2 * SPB);
  const from = motif[motif.length - 1].deg;
  const answer = pitchLine(slotsOf([pick(def.rhythms, rng), pick(def.cadences, rng)], 2 * SPB), {
    mode,
    leap: def.leap,
    rng,
    start: from,
    // 答句是往下落的：起点已经比主音高就不再往上走，低的话先抬一点
    peak: from > base + 1 ? from : base + 2,
    end: base,
    lo,
    hi,
    rootAt: (s) => progAns[Math.floor(s / SPB) % BARS],
    prev: motif.map((x) => x.deg),
  });
  return { a, answer, progA, progAns };
}

/** from 往上三个音里，挑一个是这个根音上稳定音的 */
function pickStable(mode: number[], from: number, rootDeg: number, rng: () => number): number {
  const n = mode.length;
  const stable = stablePcs(mode, rootDeg);
  const ok = [from, from + 1, from + 2].filter((d) => stable.has(mode[((d % n) + n) % n]));
  return ok.length ? pick(ok, rng) : from;
}

/**
 * 作下一句（四小节）。同一种情绪里按 A、A'、B、A'' 往下走（主题两轮一换，B 每次新写）；
 * 刚换到这种情绪时从 A 起，主题再现。主旋律乐器一句一换（古琴一句、箫接一句）。
 */
export function composePhrase(sc: Score, mood: Mood, intensity: number): Phrase {
  const def = MOODS[mood];
  const pal = sc.palette;
  const mode = pal.modes[mood];
  const rng = sc.rng;
  const n = mode.length;
  const base = n;
  const fi = fifthIdx(mode);
  const first = sc.last !== mood;
  const ms = (sc.moods[mood] ??= { theme: null, idx: 0, cycle: 0, turn: 0 });
  if (first) ms.idx = 0;
  if (!ms.theme || (ms.idx === 0 && ms.cycle % 2 === 0 && !first)) ms.theme = makeTheme(sc, mood);
  const th = ms.theme;
  const motif = th.a.filter((x) => x.step < 2 * SPB);
  let mel: MelNote[];
  let roots: number[];
  if (ms.idx === 0) {
    mel = th.a;
    roots = th.progA;
  } else if (ms.idx === 2) {
    // B：高一点的音区，自己的节奏和和声，停在属音
    roots = [pick(def.colors, rng), pick(def.colors, rng), pick(def.colors, rng), fi];
    const bStart = pickStable(mode, base + 2, roots[0], rng);
    const slots = slotsOf(phraseRhythm(def, rng), 0);
    mel = pitchLine(slots, {
      mode,
      leap: def.leap,
      rng,
      start: bStart,
      peak: bStart + reach(base + n + Math.floor(rng() * 2) - bStart, slots.length),
      end: base + fi,
      lo: base,
      hi: base + n + 3,
      rootAt: (s) => roots[Math.floor(s / SPB) % BARS],
    });
  } else {
    // A' / A''：动机原样，再接答句落回主音
    mel = [...motif, ...th.answer];
    roots = th.progAns;
  }
  const idx = ms.idx;
  ms.idx = (ms.idx + 1) % 4;
  if (ms.idx === 0) ms.cycle++;
  const leads = pal.leads[mood];
  const lead = leads[ms.turn % leads.length];
  ms.turn++;
  sc.last = mood;

  const ev: NoteEv[] = [];
  const oct = 12 * (LEAD_OCT[lead] ?? 0);
  const last = mel.length - 1;
  mel.forEach((x, i) => {
    const midi = degMidi(mode, sc.tonic, x.deg) + oct;
    const bar = Math.floor(x.step / SPB);
    // 力度：句子中间（高点附近）略强，小节头略重；强度高一点整体也响一点
    const accent = x.step % SPB === 0 ? 1.08 : 1;
    const arch = 0.9 + 0.12 * Math.sin((Math.PI * (bar + (x.step % SPB) / SPB)) / 4);
    const e: NoteEv = { step: x.step, inst: lead, midi, len: x.len, vol: 0.1 * accent * arch * (0.94 + rng() * 0.12) * (0.92 + 0.16 * intensity), pan: 0.12, lead: true };
    // 点缀：倚音（从上方邻音带一下）、滑音（从下方滑上来）——不给句尾那几个音
    const nearEnd = i === last || Math.floor(mel[i + 1].step / SPB) === BARS - 1;
    if (x.len >= 2 && !nearEnd && rng() < def.ornament) {
      if (lead === 'qin' || lead === 'erhu' || lead === 'morin') e.slideFrom = degMidi(mode, sc.tonic, x.deg - 1) + oct;
      else if (lead !== 'bell' && lead !== 'zheng') e.grace = degMidi(mode, sc.tonic, x.deg + 1) + oct;
    }
    ev.push(e);
  });

  // 段落递进：A 疏，A' 加一点，B 最满（对位旋律、全部混搭声部），A'' 回来也满
  const lift = Math.min(1, intensity + [0, 0.08, 0.22, 0.14][idx]);
  // 对位旋律：B 句（强度高时 A'' 也有）主旋律底下另一条自己的旋律；有它就不要支声，免得太挤
  const counterAt = COUNTER_AT[mood];
  const withCounter = counterAt !== undefined && lift >= counterAt && (idx === 2 || (idx === 3 && lift >= 0.65));
  if (withCounter) {
    const ci: InstId = pal.fusion.counter === lead ? 'cello' : pal.fusion.counter;
    for (const x of counterLine(mode, roots, rng)) ev.push({ step: x.step, inst: ci, midi: degMidi(mode, sc.tonic, x.deg), len: x.len, vol: ci === 'cello' ? 0.05 : 0.04, pan: -0.4, counter: true });
  }

  // 支声：第二件乐器跟着旋律的骨干音（小节头、半小节）走，低一个八度（编钟高一个）
  const sec = pal.second[mood];
  if (intensity >= def.secondAt && sec !== lead && !withCounter) {
    const anchors = mel.filter((x) => strength(x.step) >= 2);
    anchors.forEach((x, i) => {
      const next = anchors[i + 1]?.step ?? BARS * SPB;
      const len = Math.max(1, Math.min(4, next - x.step));
      const so = sec === 'bell' ? 12 : sec === 'dizi' ? 0 : -12;
      ev.push({ step: x.step, inst: sec, midi: degMidi(mode, sc.tonic, x.deg) + so, len, vol: sec === 'sheng' ? 0.016 : 0.034, pan: -0.35, second: true });
    });
  }

  // 呼应：句尾长音拉着的时候，伴奏把这句的最后三个音轻轻应一遍
  const tail = mel[last];
  if (def.echo && tail.len >= 3) {
    const echoInst: InstId = sec !== lead && sec !== 'sheng' ? sec : lead === 'zheng' ? 'qin' : 'zheng';
    let s = tail.step + Math.min(2, tail.len - 2);
    for (const x of mel.slice(-4, -1)) {
      const len = Math.max(1, Math.min(2, x.len));
      if (s + len > BARS * SPB) break;
      ev.push({ step: s, inst: echoInst, midi: degMidi(mode, sc.tonic, x.deg) - (echoInst === 'qin' ? 12 : 0), len, vol: 0.04, pan: -0.35, echo: true });
      s += len;
    }
  }

  // 伴奏：每小节按这种情绪的织体
  for (let bar = 0; bar < BARS; bar++) {
    const root = degMidi(mode, sc.tonic - 12, roots[bar]);
    const acc = def.accomp({
      bar,
      idx,
      root,
      tonic: sc.tonic - 12,
      fifth: fifthAbove(mode, sc.tonic, root),
      steps: SPB,
      cadence: bar === BARS - 1,
      first: first && bar === 0,
      intensity,
      rng,
      scaleFrom: (m, k) => {
        // 从 m 附近的调式音往上 k 个
        let d = Math.floor(((m - sc.tonic) / 12) * n);
        while (degMidi(mode, sc.tonic, d) < m) d++;
        return Array.from({ length: k }, (_, i) => degMidi(mode, sc.tonic, d + i));
      },
    });
    for (const a of acc) ev.push({ ...a, step: bar * SPB + a.step });
    for (const a of fusionBar(mood, pal.fusion, bar, root, fifthAbove(mode, sc.tonic, root), degMidi(mode, sc.tonic, roots[bar] + 2), idx, lift, first && bar === 0))
      ev.push({ ...a, step: bar * SPB + a.step, layer: true });
  }
  return { mood, bpm: sc.bpm * def.tempo, steps: BARS * SPB, notes: ev.sort((x, y) => x.step - y.step), lead };
}

/** 对位旋律在这种情绪里强度到多少才进来（攻杀太满、残局太疏，都不加） */
const COUNTER_AT: Partial<Record<Mood, number>> = { serene: 0.45, flow: 0.4, tense: 0.6, triumph: 0.4, peril: 0.5 };

/**
 * 对位旋律：比主旋律低一个八度、节奏更宽（主旋律走八分音符时它拉长音），自己有起伏、句尾落在根音上。
 * 和主旋律一样的写法（拱形、强拍稳定音、级进收住），用同一套和声。
 */
function counterLine(mode: number[], roots: number[], rng: () => number): MelNote[] {
  const rh = [pick(COUNTER_R, rng), pick(COUNTER_R, rng), pick(COUNTER_R, rng), pick(COUNTER_C, rng)];
  const slots = slotsOf(rh, 0);
  const n = mode.length;
  const start = pickStable(mode, 0, roots[0], rng);
  return pitchLine(slots, {
    mode,
    leap: 0.2,
    rng,
    start,
    peak: start + reach(2 + Math.floor(rng() * 2), slots.length),
    end: roots[BARS - 1] === 0 ? 0 : fifthIdx(mode),
    lo: -3,
    hi: n + 1,
    rootAt: (st) => roots[Math.floor(st / SPB) % BARS],
  });
}
const COUNTER_R = [
  [4, 4],
  [2, 2, 4],
  [6, 2],
  [3, 1, 4],
  [8],
  [4, 2, 2],
];
const COUNTER_C = [[8], [4, 4], [6, -2]];

/**
 * 混搭的那几层（每小节）：弦乐 / 合成器铺底、钢琴 / 竖琴分解和弦、大提琴 / 低音线、轻律动、定音鼓、镲的渐强。
 * lift 是加上段落递进之后的强度；root 是低音区的根音，fifth 它上面的五度（或四度），color 是根音往上两个调式音。
 */
function fusionBar(mood: Mood, fz: Fusion, bar: number, root: number, fifth: number, color: number, idx: number, lift: number, first: boolean): NoteEv[] {
  const out: NoteEv[] = [];
  const pad = fz.pad;
  const arp = fz.arp;
  const av = arp === 'piano' ? 0.02 : 0.026;
  const bass: InstId = fz.bass;
  const bv = bass === 'cello' ? 0.026 : 0.04;
  const groove = (kicks: number[], rims: number[], shaker: boolean) => {
    for (const s of kicks) out.push(at(s, 'kick', 1, s === 0 ? 0.05 : 0.032, 0));
    for (const s of rims) out.push(at(s, 'rim', 1, 0.018, 0.15));
    if (shaker) for (let s = 0; s < SPB; s++) out.push(at(s, 'shaker', 1, s % 2 ? 0.008 : 0.005, -0.25));
  };
  switch (mood) {
    case 'serene':
      // 弦乐两小节一个长和弦，很轻；A'、A'' 钢琴 / 竖琴四分音符慢慢分解；强度上来大提琴托一个低音
      if (lift > 0.3 && bar % 2 === 0) out.push(at(0, pad, 16, 0.01, -0.4, root + 12), at(0, pad, 16, 0.008, 0.4, fifth + 12));
      if (lift > 0.6 && bar % 2 === 0) out.push(at(0, pad, 16, 0.006, 0, color + 12));
      if (idx === 1 || idx === 3) [root + 12, fifth + 12, root + 24, color + 12].forEach((m, k) => out.push(at(k * 2, arp, 2, k ? av * 0.8 : av, 0.35, m)));
      if (lift > 0.55 && bar % 2 === 0) out.push(at(0, bass, bass === 'cello' ? 16 : 6, bv * 0.8, -0.1, root));
      break;
    case 'flow': {
      // 弦乐每小节一个和弦；B、A'' 钢琴 / 竖琴八分分解（接古筝的班）；低音一、三拍；有律动的乐队加底鼓、边击、沙锤
      if (lift > 0.25) out.push(at(0, pad, 8, 0.009, -0.4, root + 12), at(0, pad, 8, 0.008, 0.4, fifth + 12), at(0, pad, 8, 0.006, 0, root + 24));
      if (idx >= 2) {
        const pat = [root + 12, fifth + 12, root + 24, fifth + 12, color + 12, fifth + 12, root + 24, fifth + 12];
        pat.forEach((m, s) => {
          if (s % 2 === 0 || lift > 0.5) out.push(at(s, arp, 2, s === 0 ? av : av * 0.75, 0.3, m));
        });
      }
      if (lift > 0.3) {
        out.push(at(0, bass, 3, bv, -0.05, root), at(4, bass, 3, bv * 0.8, -0.05, fifth));
        if (lift > 0.6) out.push(at(6, bass, 2, bv * 0.6, -0.05, root + 12));
      }
      if (fz.groove && lift > 0.45) groove([0, 5], [2, 6], true);
      break;
    }
    case 'tense':
      // 低音区的弦乐 / 合成器压着，强度上来钢琴在低音区敲八分的固定音型（电影里那种悬着的感觉），大提琴长音
      if (bar % 2 === 0) out.push(at(0, pad, 16, 0.011, -0.3, root + 12), at(0, pad, 16, 0.009, 0.3, fifth + 12));
      if (lift > 0.5) [root + 12, fifth + 12, root + 24, fifth + 12, root + 12, fifth + 12, root + 24, fifth + 12].forEach((m, s) => out.push(at(s, arp, 1, s % 4 === 0 ? 0.016 : 0.011, 0.25, m)));
      if (lift > 0.3 && bar % 2 === 0) out.push(at(0, 'cello', 16, 0.022, -0.1, root));
      if (idx === 2 && bar === BARS - 1 && lift > 0.55) out.push(at(4, 'swell', 4, 0.014, 0));
      break;
    case 'battle': {
      // 弦乐跳弓八分音符（3+3+2 重音）、低音一路八分往前推、定音鼓每小节一下；杀进来的第一句先来一阵滚奏
      if (lift > 0.35)
        [root + 12, root + 12, fifth + 12, root + 12, root + 24, root + 12, fifth + 12, root + 12].forEach((m, s) => out.push(at(s, 'spicc', 1, s === 0 || s === 3 || s === 6 ? 0.024 : 0.016, -0.3, m)));
      for (let s = 0; s < SPB; s++) out.push(at(s, bass === 'bass' ? 'bass' : 'spicc', 1, s % 2 ? bv * 0.55 : bv * 0.8, 0, root));
      out.push(first ? at(0, 'timp', 2, 0.06, 0, root) : at(0, 'timp', 1, 0.05, 0, root));
      if (lift > 0.7) out.push(at(0, 'strings', 8, 0.007, 0.35, root + 24), at(0, 'strings', 8, 0.006, -0.35, fifth + 24));
      if (fz.groove && lift > 0.6) groove([0, 4], [2, 6], false);
      break;
    }
    case 'triumph':
      // 弦乐铺满（根、五、八、加一个色彩音），钢琴 / 竖琴一、三拍敲和弦，低音跳着走，句首定音鼓；有律动的乐队加鼓点
      out.push(at(0, pad, 8, 0.01, -0.4, root + 12), at(0, pad, 8, 0.009, 0.4, fifth + 12), at(0, pad, 8, 0.007, 0, root + 24), at(0, pad, 8, 0.006, 0.2, color + 12));
      for (const s of [0, 4]) for (const m of [root + 12, fifth + 12, root + 24]) out.push(at(s, arp, 3, av * 0.85, 0.25, m));
      out.push(at(0, bass, 2, bv, 0, root), at(3, bass, 1, bv * 0.7, 0, root), at(4, bass, 2, bv * 0.85, 0, fifth), at(6, bass, 2, bv * 0.7, 0, root + 12));
      if (bar === 0) out.push(at(0, 'timp', 1, 0.05, 0, root));
      if (fz.groove) groove([0, 4], [2, 6], lift > 0.55);
      if (idx === 2 && bar === BARS - 1 && lift > 0.55) out.push(at(4, 'swell', 4, 0.016, 0));
      break;
    case 'peril':
      // 低音区弦乐压着，高处一根细细的弦（强度高时），大提琴每小节一个长音，钢琴偶尔一个低音
      if (bar % 2 === 0) out.push(at(0, pad, 16, 0.012, -0.3, root + 12), at(0, pad, 16, 0.01, 0.3, fifth + 12));
      if (lift > 0.6 && bar % 2 === 0) out.push(at(0, pad, 16, 0.004, 0.1, root + 36));
      out.push(at(0, 'cello', 8, 0.022, -0.1, root));
      if (lift > 0.5) out.push(at(0, arp, 3, 0.018, 0.3, root + 12), at(5, arp, 3, 0.014, 0.3, fifth + 12));
      break;
    case 'endgame':
      // 合成器 / 弦乐很轻地铺一下，钢琴像水滴，一两个高音
      if (lift > 0.4 && bar % 2 === 0) out.push(at(0, pad, 16, 0.008, -0.3, root + 12), at(0, pad, 16, 0.007, 0.3, fifth + 12));
      if (bar % 2 === 0) out.push(at(0, arp, 4, 0.016, 0.35, root + 24));
      if (lift > 0.5) out.push(at(4, arp, 4, 0.012, 0.35, fifth + 24));
      break;
  }
  return out;
}

export type StingerKind = 'check' | 'capture' | 'win' | 'loss' | 'draw';

/**
 * 点缀：将军、吃掉车马炮、终局。步可以是小数（马上响，不等下一句）。
 * 用的是当前情绪的调式，和正在放的曲子在一个调上。
 */
export function stinger(sc: Score, kind: StingerKind): NoteEv[] {
  const mood = sc.last ?? 'serene';
  const mode = sc.palette.modes[mood];
  const t = sc.tonic;
  const lo = t - 12;
  const fifth = fifthAbove(mode, t, lo);
  const run = (from: number, k: number) => {
    const n = mode.length;
    let d = Math.floor(((from - t) / 12) * n);
    while (degMidi(mode, t, d) < from) d++;
    return Array.from({ length: k }, (_, i) => degMidi(mode, t, d + i));
  };
  switch (kind) {
    case 'check':
      // 战鼓"咚、哒哒"，一声锣
      return [at(0, 'dagu', 1, 0.11, 0), at(0.5, 'tanggu', 1, 0.06, 0.15), at(1, 'tanggu', 1, 0.07, -0.15), at(0, 'gong', 6, 0.05, 0)];
    case 'capture':
      // 琵琶扫一下
      return [{ ...at(0, 'saofu', 2, 0.07, -0.2), run: [lo + 12, fifth + 12, lo + 24] }, at(0, 'tanggu', 1, 0.05, 0.1)];
    case 'win':
      // 古筝刮上去，一声锣，笛子吹一个长长的主音
      return [{ ...at(0, 'gliss', 2, 0.05, 0.1), run: run(t, 9) }, at(1.5, 'gong', 8, 0.06, 0), at(1.5, 'dagu', 1, 0.09, 0), at(2, 'dizi', 8, 0.09, 0.1, t + 24), at(2, 'sheng', 10, 0.016, -0.2, t + 12)];
    case 'loss':
      // 古琴三个音慢慢落下来，远处一声锣
      return [at(0, 'qin', 3, 0.07, -0.1, degMidi(mode, t, 2)), at(2, 'qin', 3, 0.065, -0.1, degMidi(mode, t, 1)), at(4, 'qin', 8, 0.07, -0.1, t), at(4, 'gong', 8, 0.035, 0)];
    case 'draw':
      // 编钟两声：主音、五度
      return [at(0, 'bell', 6, 0.08, 0.1, t + 24), at(2, 'bell', 6, 0.06, -0.1, fifth + 24)];
  }
}
