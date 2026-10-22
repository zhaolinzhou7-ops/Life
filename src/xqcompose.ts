/**
 * 象棋对局配乐的"作曲"部分：纯计算，不碰音频（单元测试能直接测）。
 *
 * 用户原话："对局音乐希望能丰富一点，不要每次都是那几种。可以多加一些不同调的和弦，比如山水的感觉、草原的感觉等，
 * 不一定要完全照搬，主要是能让人耳目一新，每次下棋的感觉都不一样。"
 * 后来又说："音乐不够好听。"
 *
 * 第一版的旋律是在音阶上随机游走、每小节随便挑一个节奏型——一句一句听着都对，连起来没有方向，记不住。
 * 这一版按"写一首小曲"的办法来：
 *   - **节奏有动机**：一句四小节用同一个节奏型打底（第一、三小节一样），句尾一个长音收住、留一口气；
 *   - **旋律有走向**：每句先往上走到一个高点、再落下来（拱形），小步为主；跳进之后反方向级进回来；
 *     强拍落在这一小节和声的稳定音上（根音、五度、三度），弱拍才走经过音；不连续三次同一个音；
 *   - **曲式能记住**：一轮 16 小节是 A A' B A''——A' 的前两小节原样重复 A 的动机，A'' 把动机和 A' 的落音原样再来一遍。
 *     上句停在属音悬着（问），下句落回主音（答）；B 段换高一点的音区、换节奏；
 *   - **有呼应**：主旋律在句尾拉长音的时候，伴奏乐器把这一句的尾巴轻轻应一遍；
 *   - **慢下来、疏一点**：下棋要想，背景音乐不能催人；鼓和镲少用、轻用。
 * 七种曲风：山水、草原、江南、竹林、大漠、月夜、江湖——调式、乐器、节拍、速度、伴奏织体各不相同；
 * 每盘随机挑一种（不和上一盘重复），随机移调、速度上下浮动；主题两轮一换，B 段每轮重写。
 * 调式用的是中国五声的五种调式（宫商角徵羽），大漠用带增二度的西域调式。
 */

/** 乐器（演奏层按这个名字合成音色） */
export type InstId =
  | 'xiao' // 箫：柔、气声
  | 'dizi' // 笛：亮、带倚音
  | 'zheng' // 古筝：拨弦
  | 'pipa' // 琵琶：拨弦 + 轮指
  | 'qin' // 古琴：低沉拨弦，余音长
  | 'harm' // 古琴泛音：清亮的高音
  | 'morin' // 马头琴：弓弦，滑音
  | 'drone' // 低音持续（呼麦 / 低音弦的感觉）
  | 'bell' // 编钟 / 铃
  | 'sheng' // 笙：和声铺底
  | 'oud' // 西域拨弦（热瓦普的感觉）
  | 'hoof' // 马蹄
  | 'wood' // 木鱼 / 梆子
  | 'drumLo' // 手鼓低音
  | 'drumHi' // 手鼓高音
  | 'taiko' // 大鼓
  | 'camel' // 驼铃
  | 'gliss'; // 古筝刮奏（一串上行）

export interface NoteEv {
  /** 这一轮里第几步（一步 = 一个八分音符 / 六八拍的一个八分） */
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
  /** 从这个音滑上来（马头琴、古琴的吟猱） */
  slideFrom?: number;
  /** 古筝刮奏：要走的那一串音 */
  run?: number[];
  /** 主旋律（伴奏里也可能用同一件乐器，比如大漠的西域拨弦） */
  lead?: boolean;
  /** 呼应：伴奏把主旋律句尾应一遍 */
  echo?: boolean;
}

export interface StyleDef {
  id: string;
  name: string;
  /** 一句话：这首是什么感觉、用了什么乐器 */
  desc: string;
  /** 调式：相对主音的半音 */
  mode: number[];
  /** 调式名（显示用）："羽调" */
  modeName: string;
  /** 主音（MIDI）和随机移调的范围 */
  tonic: number;
  keyShift: [number, number];
  bpm: [number, number];
  /** 一小节几步：8 = 四四拍的八分音符，6 = 六八拍 */
  stepsPerBar: number;
  /** 句中小节的节奏型（一小节里每个音几步，负数是休止）：一句里第一、三小节用同一个 */
  rhythms: number[][];
  /** 句尾小节的节奏型：最后一个音是长音（或者长音后面留一口气） */
  cadences: number[][];
  /** 跳进的倾向（0～1），草原的长调跳得多 */
  leap: number;
  /** 旋律乐器、比主音高几个八度 */
  lead: InstId;
  leadOct: number;
  /** 句中可以用的和声根音（调式里的第几个音）：每句第二、三小节从这里挑 */
  colors: number[];
  /** 每小节的伴奏 */
  accomp: (a: AccArgs) => NoteEv[];
  /** 句尾拉长音时，哪件乐器把这一句的尾巴应一遍；比旋律低（-1）还是高（+1）一个八度 */
  echo?: { inst: InstId; oct: number; vol: number };
  /** 旋律的点缀：倚音 / 滑音的几率 */
  ornament: number;
  /** 混响多湿（0～1）、主旋律的回声多少（0～1） */
  wet: number;
  delay: number;
  /**
   * 这一曲风整体的音量：按离线渲染量出来的短时响度（400 毫秒窗的 90 分位）拉齐到同一个电平。
   * 不按平均响度拉：竹林、月夜音少，平均下来很轻，按平均拉齐每个音就比别的曲风响一大截。
   */
  gain: number;
}

export interface AccArgs {
  bar: number;
  /** 句子里第几小节（0～3） */
  inPhrase: number;
  /** A 段（安静一点）还是 B 段（满一点） */
  section: 'A' | 'B';
  /** 这一小节的根音（MIDI，低音区） */
  root: number;
  /** 主音（MIDI，低音区） */
  tonic: number;
  /** 根音上方的纯五度（调式里没有就用纯四度） */
  fifth: number;
  steps: number;
  /** 乐句的最后一小节 */
  cadence: boolean;
  rng: () => number;
  /** 调式里从根音往上的音（刮奏、分解用） */
  scaleFrom: (midi: number, n: number) => number[];
}

const at = (step: number, inst: InstId, len: number, vol: number, pan = 0, midi?: number): NoteEv => ({ step, inst, len, vol, pan, midi });

/** 宫商角徵羽五种调式 + 西域 */
export const MODES = {
  gong: [0, 2, 4, 7, 9],
  shang: [0, 2, 5, 7, 10],
  jue: [0, 3, 5, 8, 10],
  zhi: [0, 2, 5, 7, 9],
  yu: [0, 3, 5, 7, 10],
  xiyu: [0, 1, 4, 5, 7, 8, 10],
};

/** 四四拍，句中：四分音符为主，带一点附点和八分 */
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
/** 四四拍，句尾：长音收住 */
const C44 = [[8], [6, -2], [2, 6], [3, 1, 4], [2, 2, 4], [4, 4]];
/** 慢曲（竹林、月夜）：音少、长 */
const R44_SLOW = [
  [4, 4],
  [6, 2],
  [2, 6],
  [3, 1, 4],
  [4, 2, 2],
];
const C44_SLOW = [[8], [6, -2], [4, -4]];
/** 六八拍 */
const R68 = [
  [3, 3],
  [2, 1, 3],
  [3, 2, 1],
  [2, 1, 2, 1],
  [1, 1, 1, 3],
];
const C68 = [[6], [3, 3], [2, 1, 3]];

export const STYLES: StyleDef[] = [
  {
    id: 'shanshui',
    name: '山水 · 溪山',
    desc: '箫和古筝，羽调，慢——山间溪水边下棋',
    mode: MODES.yu,
    modeName: '羽调',
    tonic: 57,
    keyShift: [-2, 3],
    bpm: [58, 66],
    stepsPerBar: 8,
    rhythms: R44,
    cadences: C44,
    leap: 0.2,
    lead: 'xiao',
    leadOct: 1,
    colors: [2, 3, 4],
    ornament: 0.25,
    echo: { inst: 'zheng', oct: 0, vol: 0.05 },
    wet: 0.42,
    delay: 0.22,
    gain: 1,
    accomp: ({ root, fifth, steps, cadence, section, scaleFrom }) => {
      // 古筝：根音—五度—八度的分解，B 段多拨两下
      const out = [at(0, 'zheng', 6, 0.075, -0.3, root), at(3, 'zheng', 3, 0.045, 0.3, fifth + 12)];
      if (section === 'B') out.push(at(5, 'zheng', 3, 0.04, -0.15, root + 12), at(6, 'zheng', 2, 0.035, 0.2, fifth + 12));
      if (cadence) out.push({ ...at(steps - 2, 'gliss', 2, 0.04, 0), run: scaleFrom(root + 12, 6) });
      return out;
    },
  },
  {
    id: 'caoyuan',
    name: '草原 · 牧歌',
    desc: '马头琴、低音长鸣和马蹄声，宫调，大跳——天苍苍野茫茫',
    mode: MODES.gong,
    modeName: '宫调',
    tonic: 50,
    keyShift: [-2, 4],
    bpm: [78, 88],
    stepsPerBar: 6,
    rhythms: R68,
    cadences: C68,
    leap: 0.45,
    lead: 'morin',
    leadOct: 1,
    colors: [1, 3, 4],
    ornament: 0.35,
    echo: { inst: 'pipa', oct: -1, vol: 0.035 },
    wet: 0.45,
    delay: 0.12,
    gain: 1.43,
    accomp: ({ bar, tonic, root, fifth, steps, section, cadence }) => {
      const out: NoteEv[] = [];
      // 低音长鸣：主音 + 五度，两小节一换，像草原上的风（轻，不能糊住旋律）
      if (bar % 2 === 0) out.push(at(0, 'drone', steps * 2, 0.022, -0.2, tonic + 12), at(0, 'drone', steps * 2, 0.016, 0.2, tonic + 19));
      // 马蹄：B 段才跑起来（哒—哒哒），句尾勒马
      if (section === 'B' && !cadence) for (const s of [0, 2, 3, 5]) out.push(at(s, 'hoof', 1, s === 0 || s === 3 ? 0.06 : 0.04, s < 3 ? -0.35 : 0.35));
      out.push(at(0, 'pipa', 3, 0.045, -0.25, root + 12), at(3, 'pipa', 3, 0.032, 0.25, fifth + 12));
      return out;
    },
  },
  {
    id: 'jiangnan',
    name: '江南 · 水乡',
    desc: '笛子、琵琶、古筝分解和弦，徵调——小桥流水',
    mode: MODES.zhi,
    modeName: '徵调',
    tonic: 55,
    keyShift: [-3, 3],
    bpm: [68, 76],
    stepsPerBar: 8,
    rhythms: R44,
    cadences: C44,
    leap: 0.15,
    lead: 'dizi',
    leadOct: 1,
    colors: [1, 3, 4],
    ornament: 0.4,
    echo: { inst: 'pipa', oct: -1, vol: 0.04 },
    wet: 0.36,
    delay: 0.18,
    gain: 1.19,
    accomp: ({ root, fifth, cadence, steps, section, scaleFrom }) => {
      const out: NoteEv[] = [];
      // 古筝分解：根、五、八、五，流水一样；A 段每小节前半，B 段整小节
      const arp = [root, fifth, root + 12, fifth + 12, root + 24, fifth + 12, root + 12, fifth];
      const upto = section === 'B' ? steps : 4;
      for (let s = 0; s < upto; s += 2) out.push(at(s, 'zheng', 2, s === 0 ? 0.06 : 0.035, s % 4 === 0 ? -0.3 : 0.25, arp[s]));
      if (cadence) out.push({ ...at(steps - 3, 'gliss', 3, 0.035, 0.1), run: scaleFrom(root + 12, 7) });
      return out;
    },
  },
  {
    id: 'zhulin',
    name: '竹林 · 禅',
    desc: '古琴、泛音和木鱼，商调，很慢很疏——竹林里一盏茶',
    mode: MODES.shang,
    modeName: '商调',
    tonic: 50,
    keyShift: [-2, 3],
    bpm: [50, 56],
    stepsPerBar: 8,
    rhythms: R44_SLOW,
    cadences: C44_SLOW,
    leap: 0.25,
    lead: 'qin',
    leadOct: 1,
    colors: [2, 3, 4],
    ornament: 0.3,
    echo: { inst: 'harm', oct: 1, vol: 0.04 },
    wet: 0.5,
    delay: 0.1,
    gain: 3.2,
    accomp: ({ bar, root, fifth, steps }) => {
      const out: NoteEv[] = [];
      // 木鱼：两小节敲一下，很轻
      if (bar % 2 === 0) out.push(at(0, 'wood', 1, 0.035, 0.3));
      // 笙：根音和五度轻轻铺着
      if (bar % 2 === 0) out.push(at(0, 'sheng', steps * 2, 0.014, -0.3, root + 12), at(0, 'sheng', steps * 2, 0.011, 0.3, fifth + 12));
      return out;
    },
  },
  {
    id: 'damo',
    name: '大漠 · 驼铃',
    desc: '西域拨弦、手鼓和驼铃，带增二度的西域调式——丝路上的商队',
    mode: MODES.xiyu,
    modeName: '西域调式',
    tonic: 50,
    keyShift: [-2, 3],
    bpm: [80, 88],
    stepsPerBar: 8,
    rhythms: R44,
    cadences: C44,
    leap: 0.2,
    lead: 'oud',
    leadOct: 1,
    // 西域调式半音多，和声只在主音、四度、五度上走，免得撞
    colors: [3, 4],
    ornament: 0.3,
    echo: { inst: 'zheng', oct: 0, vol: 0.035 },
    wet: 0.4,
    delay: 0.2,
    gain: 2.76,
    accomp: ({ bar, tonic, root, steps, section }) => {
      // 手鼓：咚 哒 . 哒 咚 . 哒 .（中东的马克苏姆节奏），轻
      const out: NoteEv[] = [];
      const pat: [number, InstId][] =
        section === 'B'
          ? [
              [0, 'drumLo'],
              [2, 'drumHi'],
              [3, 'drumHi'],
              [4, 'drumLo'],
              [6, 'drumHi'],
            ]
          : [
              [0, 'drumLo'],
              [3, 'drumHi'],
              [4, 'drumLo'],
            ];
      for (const [s, k] of pat) if (s < steps) out.push(at(s, k, 1, k === 'drumLo' ? 0.028 : 0.026, k === 'drumLo' ? 0 : 0.3));
      if (bar % 4 === 0) out.push(at(0, 'camel', 4, 0.03, -0.4));
      if (bar % 2 === 0) out.push(at(0, 'drone', steps * 2, 0.012, -0.15, tonic + 12));
      out.push(at(0, 'oud', 2, 0.04, -0.3, root + 12));
      return out;
    },
  },
  {
    id: 'yueye',
    name: '月夜 · 编钟',
    desc: '编钟、笙的和声，角调，很静——月下对弈',
    mode: MODES.jue,
    modeName: '角调',
    tonic: 47,
    keyShift: [-3, 2],
    bpm: [54, 60],
    stepsPerBar: 8,
    rhythms: R44_SLOW,
    cadences: C44_SLOW,
    leap: 0.3,
    lead: 'bell',
    leadOct: 2,
    colors: [1, 2, 3],
    ornament: 0.1,
    echo: { inst: 'qin', oct: -1, vol: 0.05 },
    wet: 0.5,
    delay: 0.15,
    gain: 1.55,
    accomp: ({ root, fifth, steps, cadence, scaleFrom }) => {
      const out = [at(0, 'sheng', steps, 0.016, -0.35, root + 12), at(0, 'sheng', steps, 0.012, 0.35, fifth + 12), at(0, 'qin', 6, 0.05, -0.2, root)];
      if (cadence) out.push({ ...at(steps - 2, 'gliss', 2, 0.03, 0.2), run: scaleFrom(root + 24, 5) });
      return out;
    },
  },
  {
    id: 'jianghu',
    name: '江湖 · 侠客',
    desc: '笛子、琵琶和大鼓，宫调——刀光剑影的一盘',
    mode: MODES.gong,
    modeName: '宫调',
    tonic: 50,
    keyShift: [-2, 4],
    bpm: [86, 94],
    stepsPerBar: 8,
    rhythms: R44,
    cadences: C44,
    leap: 0.25,
    lead: 'dizi',
    leadOct: 1,
    colors: [1, 3, 4],
    ornament: 0.3,
    echo: { inst: 'pipa', oct: -1, vol: 0.04 },
    wet: 0.32,
    delay: 0.14,
    gain: 1.24,
    accomp: ({ root, fifth, steps, cadence, section, inPhrase, scaleFrom }) => {
      const out: NoteEv[] = [];
      // 大鼓只在句首敲，B 段第三拍补一下
      if (inPhrase === 0) out.push(at(0, 'taiko', 1, 0.1, 0));
      if (section === 'B') out.push(at(4, 'drumLo', 1, 0.05, 0));
      out.push(at(0, 'pipa', 2, 0.05, -0.3, root + 12), at(3, 'pipa', 2, 0.035, -0.3, root + 12), at(6, 'pipa', 2, 0.035, -0.3, fifth + 12));
      if (cadence) out.push({ ...at(steps - 3, 'gliss', 3, 0.035, 0.1), run: scaleFrom(root + 12, 7) });
      return out;
    },
  },
];

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

/** 这一盘的曲子：曲风 + 调高 + 速度 + 当前这一轮的音符 */
export interface Piece {
  style: StyleDef;
  /** 移调之后的主音（MIDI） */
  tonic: number;
  bpm: number;
  /** 调名，如"D 宫调" */
  key: string;
  /** 一轮多少步 */
  steps: number;
  rng: () => number;
  /** A 段的材料（动机、两种落音、和声），两轮一换 */
  theme: Theme | null;
  cycle: number;
}

interface Theme {
  /** 第一句（4 小节，停在属音）；前两小节就是动机 */
  a: MelNote[];
  /** 答句的后两小节（落回主音） */
  answer: MelNote[];
  /** 两句的和声根音（调式第几个音），每小节一个 */
  progA: number[];
  progAns: number[];
}

const NAMES = ['C', '#C', 'D', 'bE', 'E', 'F', '#F', 'G', 'bA', 'A', 'bB', 'B'];
const BARS = 16;

/** 调式里第 k 个音（可以跨八度、可以是负数）→ MIDI */
export function degMidi(mode: number[], tonic: number, k: number): number {
  const n = mode.length;
  const oct = Math.floor(k / n);
  return tonic + 12 * oct + mode[((k % n) + n) % n];
}

/** 挑一种曲风：不和上一盘重复 */
export function pickStyle(lastId: string | null, rng: () => number): StyleDef {
  const pool = STYLES.filter((s) => s.id !== lastId);
  return pool[Math.floor(rng() * pool.length)];
}

export function newPiece(style: StyleDef, seed = Math.floor(Math.random() * 2 ** 31)): Piece {
  const rng = rngOf(seed);
  const shift = style.keyShift[0] + Math.floor(rng() * (style.keyShift[1] - style.keyShift[0] + 1));
  const tonic = style.tonic + shift;
  const bpm = Math.round(style.bpm[0] + rng() * (style.bpm[1] - style.bpm[0]));
  return { style, tonic, bpm, key: `${NAMES[tonic % 12]} ${style.modeName}`, steps: BARS * style.stepsPerBar, rng, theme: null, cycle: 0 };
}

/** 属音在调式里是第几个音（有纯五度用纯五度；角调没有，用小六度那个；都没有就用中间那个） */
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
function strength(step: number, spb: number): number {
  const s = step % spb;
  if (s === 0) return 3;
  if (spb === 8) return s === 4 ? 2 : s % 2 === 0 ? 1 : 0;
  return s === 3 ? 2 : 0;
}

/** 按节奏型把几个小节铺成音符的位置（还没有音高） */
function slotsOf(rhythms: number[][], startStep: number, spb: number): { step: number; len: number }[] {
  const out: { step: number; len: number }[] = [];
  rhythms.forEach((rh, b) => {
    let s = startStep + b * spb;
    for (const d of rh) {
      if (d > 0) out.push({ step: s, len: d });
      s += Math.abs(d);
    }
  });
  return out;
}

/**
 * 给一串位置配音高：拱形（从 start 往上走到 peak，再落到 end），小步为主、跳进之后反向级进，
 * 强拍落稳定音，不连着三次同一个音。end 是最后一个音的音阶位置（落音）。
 */
function pitchLine(
  slots: { step: number; len: number }[],
  o: {
    style: StyleDef;
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
  const { style, rng } = o;
  const n = style.mode.length;
  const spb = style.stepsPerBar;
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
    const stable = stablePcs(style.mode, o.rootAt(sl.step));
    const st = strength(sl.step, spb);
    let best = prev;
    let bestCost = Infinity;
    for (let cand = prev - 4; cand <= prev + 4; cand++) {
      if (cand < o.lo || cand > o.hi) continue;
      const move = cand - prev;
      const mag = Math.abs(move);
      let cost = Math.abs(cand - target);
      // 级进最好；隔一个音（五声里是三度、四度）也顺；再大是跳进，草原的长调才多跳
      cost += mag === 0 ? 0.9 : mag === 1 ? 0 : mag === 2 ? 0.45 : mag === 3 ? 1.6 - style.leap * 1.2 : 2.6 - style.leap * 1.4;
      // 连着三次同一个音不要（最后一个音是定死的落音：前一个已经是落音，这里就不能再是）；来回晃（5 6 5 6）也少一点
      if (mag === 0 && prev2 === prev) continue;
      if (i === N - 2 && cand === o.end && prev === o.end) continue;
      if (mag > 0 && cand === prev2) cost += 0.35;
      // 剩下几个音要能一步步走到落音：离落音太远就得往回收，免得最后两三个大跳硬落下去
      const remain = N - 1 - i;
      cost += Math.max(0, Math.abs(cand - o.end) - remain * 1.4) * 1.3;
      // 跳进之后往回走
      if (Math.abs(lastMove) >= 2 && move !== 0 && Math.sign(move) === Math.sign(lastMove)) cost += 1.6;
      // 强拍落稳定音
      const pc = ((style.mode[((cand % n) + n) % n] % 12) + 12) % 12;
      if (!stable.has(pc)) cost += st === 3 ? 2.4 : st === 2 ? 1.2 : st === 1 ? 0.3 : 0;
      // 和根音、和主音（低音长鸣）差半音、三全音的音（西域调式里才有）：一带而过是西域味，拉长了刺耳
      const rootPc = style.mode[((o.rootAt(sl.step) % n) + n) % n];
      for (const ref of [rootPc, 0]) {
        const iv = (((pc - ref) % 12) + 12) % 12;
        if (iv === 1 || iv === 11 || iv === 6) cost += sl.len >= 2 ? 1.6 : 0.4;
      }
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

/** 一句往上走多高：音少的句子（竹林、月夜一句才四五个音）走不了太高，不然只能大跳上去 */
const reach = (want: number, notes: number) => Math.max(0, Math.min(want, Math.ceil(notes / 2)));

/** 节奏动机一样的那种句子：[r1, r2, r1, 句尾]（六八拍、慢曲同理） */
function phraseRhythm(style: StyleDef, rng: () => number): number[][] {
  const ok = (r: number[]) => r.reduce((a, x) => a + Math.abs(x), 0) === style.stepsPerBar;
  const rs = style.rhythms.filter(ok);
  const cs = style.cadences.filter(ok);
  const r1 = pick(rs, rng);
  let r2 = pick(rs, rng);
  if (r2 === r1 && rs.length > 1) r2 = pick(rs, rng);
  return [r1, r2, r1, pick(cs, rng)];
}

/**
 * 作一轮（16 小节）：A（问句，停在属音）A'（动机重复 + 答句，落回主音）B（换音区、换节奏，停在属音）
 * A''（动机 + 答句原样再来）。主题两轮一换；B 段每轮重写。返回这一轮的全部音符（旋律 + 呼应 + 伴奏）。
 */
export function composeCycle(p: Piece): NoteEv[] {
  const { style, rng } = p;
  const spb = style.stepsPerBar;
  const n = style.mode.length;
  const base = n * style.leadOct; // 旋律中心：主音高 leadOct 个八度
  const fi = fifthIdx(style.mode);
  const lo = base - 3;
  const hi = base + n + 2;
  const prog = (half: boolean, first?: number) => [first ?? 0, pick(style.colors, rng), pick(style.colors, rng), half ? fi : 0];
  /** from 往上三个音里，挑一个是这个根音上稳定音的 */
  const pickStable = (from: number, rootDeg: number, r: () => number) => {
    const stable = stablePcs(style.mode, rootDeg);
    const ok = [from, from + 1, from + 2].filter((d) => stable.has(style.mode[((d % n) + n) % n]));
    return ok.length ? pick(ok, r) : from;
  };

  if (!p.theme || p.cycle % 2 === 0) {
    const progA = prog(true);
    const progAns = [0, progA[1], pick(style.colors, rng), 0];
    const rootA = (s: number) => progA[Math.floor(s / spb) % 4];
    // 起音落在第一小节和声的稳定音上
    const start = pickStable(base, progA[0], rng);
    const aSlots = slotsOf(phraseRhythm(style, rng), 0, spb);
    const a = pitchLine(aSlots, { style, rng, start, peak: start + reach(base + 2 + Math.floor(rng() * 3) - start, aSlots.length), end: base + fi, lo, hi, rootAt: rootA });
    // 答句：接在动机（前两小节）后面，落回主音
    const motif = a.filter((x) => x.step < 2 * spb);
    const ansRh = [pick(style.rhythms.filter((r) => r.reduce((s, x) => s + Math.abs(x), 0) === spb), rng), pick(style.cadences.filter((r) => r.reduce((s, x) => s + Math.abs(x), 0) === spb), rng)];
    const rootAns = (s: number) => progAns[Math.floor(s / spb) % 4];
    const from = motif[motif.length - 1].deg;
    const answer = pitchLine(slotsOf(ansRh, 2 * spb, spb), {
      style,
      rng,
      start: from,
      // 答句是往下落的：起点已经比主音高就不再往上走，低的话先抬一点
      peak: from > base + 1 ? from : base + 2,
      end: base,
      lo,
      hi,
      rootAt: rootAns,
      prev: motif.map((x) => x.deg),
    });
    p.theme = { a, answer, progA, progAns };
  }
  const th = p.theme;
  // B 段：高一点的音区，自己的节奏和和声，停在属音（或高八度的主音）
  const progB = prog(true, pick(style.colors, rng));
  const rootB = (s: number) => progB[Math.floor(s / spb) % 4];
  const bStart = pickStable(base + 2, progB[0], rng);
  const bSlots = slotsOf(phraseRhythm(style, rng), 8 * spb, spb);
  const b = pitchLine(bSlots, {
    style,
    rng,
    start: bStart,
    peak: bStart + reach(base + n + Math.floor(rng() * 2) - bStart, bSlots.length),
    end: base + fi,
    lo: base,
    hi: base + n + 3,
    rootAt: rootB,
  });

  const motif = th.a.filter((x) => x.step < 2 * spb);
  const shift = (xs: MelNote[], d: number) => xs.map((x) => ({ ...x, step: x.step + d }));
  const mel: MelNote[] = [...th.a, ...shift(motif, 4 * spb), ...shift(th.answer, 4 * spb), ...b, ...shift(motif, 12 * spb), ...shift(th.answer, 12 * spb)];
  // 每小节的和声根音
  const roots = [...th.progA, ...th.progAns, ...progB, ...th.progAns];

  const ev: NoteEv[] = [];
  const last = mel.length - 1;
  mel.forEach((x, i) => {
    const midi = degMidi(style.mode, p.tonic, x.deg);
    const bar = Math.floor(x.step / spb);
    const inPhrase = bar % 4;
    // 力度：句子中间（高点附近）略强，小节头略重，句尾长音收一点
    const accent = x.step % spb === 0 ? 1.08 : 1;
    const arch = 0.9 + 0.12 * Math.sin((Math.PI * (inPhrase + (x.step % spb) / spb)) / 4);
    const e: NoteEv = { step: x.step, inst: style.lead, midi, len: x.len, vol: 0.1 * accent * arch * (0.94 + rng() * 0.12), pan: 0.12, lead: true };
    // 点缀：倚音（从上方邻音带一下）、滑音（从下方滑上来）——只给不在句尾的长一点的音
    const nextIsCadence = i === last || Math.floor(mel[i + 1].step / spb) % 4 === 3;
    if (x.len >= 2 && !nextIsCadence && rng() < style.ornament) {
      if (style.lead === 'morin' || style.lead === 'qin') e.slideFrom = degMidi(style.mode, p.tonic, x.deg - 1);
      else if (style.lead !== 'bell') e.grace = degMidi(style.mode, p.tonic, x.deg + 1);
    }
    ev.push(e);
  });

  // 呼应：每句最后一个长音拉着的时候，伴奏把这句的最后三个音轻轻应一遍
  if (style.echo) {
    const echo = style.echo;
    for (let ph = 0; ph < 4; ph++) {
      const inPh = mel.filter((x) => Math.floor(x.step / spb / 4) === ph);
      const tail = inPh[inPh.length - 1];
      if (!tail || tail.len < 3) continue;
      const src = inPh.slice(-4, -1);
      let s = tail.step + Math.min(2, tail.len - 2);
      for (const x of src) {
        const len = Math.max(1, Math.min(2, x.len));
        if (s + len > (ph + 1) * 4 * spb) break;
        ev.push({ step: s, inst: echo.inst, midi: degMidi(style.mode, p.tonic, x.deg) + 12 * echo.oct, len, vol: echo.vol, pan: -0.35, echo: true });
        s += len;
      }
    }
  }

  // 伴奏：每小节按这一曲风的织体
  for (let bar = 0; bar < BARS; bar++) {
    const rootDeg = roots[bar];
    const root = degMidi(style.mode, p.tonic - 12, rootDeg);
    const acc = style.accomp({
      bar,
      inPhrase: bar % 4,
      section: bar >= 8 && bar < 12 ? 'B' : 'A',
      root,
      tonic: p.tonic - 12,
      fifth: fifthAbove(style.mode, p.tonic, root),
      steps: spb,
      cadence: bar % 4 === 3,
      rng,
      scaleFrom: (m, k) => {
        // 从 m 附近的调式音往上 k 个
        const rel = m - p.tonic;
        let d = Math.floor((rel / 12) * n);
        while (degMidi(style.mode, p.tonic, d) < m) d++;
        return Array.from({ length: k }, (_, i) => degMidi(style.mode, p.tonic, d + i));
      },
    });
    for (const a of acc) ev.push({ ...a, step: bar * spb + a.step });
  }
  p.cycle++;
  return ev.sort((x, y) => x.step - y.step);
}
