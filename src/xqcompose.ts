/**
 * 象棋对局配乐的"作曲"部分：纯计算，不碰音频（单元测试能直接测）。
 *
 * 用户原话："对局音乐希望能丰富一点，不要每次都是那几种。可以多加一些不同调的和弦，比如山水的感觉、草原的感觉等，
 * 不一定要完全照搬，主要是能让人耳目一新，每次下棋的感觉都不一样。"
 *
 * 原来只有一首写死的《溪山对弈》（A 羽调五声、箫 + 古筝），每盘都是它。现在：
 *   - 七种曲风：山水、草原、江南、竹林、大漠、月夜、江湖——调式、乐器、节拍、速度、伴奏织体各不相同；
 *   - 每盘随机挑一种（不和上一盘重复），再随机移调（同一曲风这盘 D 调、下盘 G 调）、速度上下浮动；
 *   - 旋律当场作：按调式在音阶上走（小步为主、偶尔跳进，草原跳得多），乐句有问有答——
 *     上句停在"属"音上悬着，下句落回主音；动机重复再变化（A A' B A''），听得出是一首曲子而不是乱弹；
 *   - 每 16 小节一轮：副歌（B 段）每轮重写、主题小变，两轮之后整首换新主题——下一整盘棋也不会听腻。
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
  | 'hat' // 小镲
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
  /** 节奏型：一小节里每个音几步，负数是休止 */
  rhythms: number[][];
  /** 跳进的倾向（0～1），草原的长调跳得多 */
  leap: number;
  /** 旋律乐器、比主音高几个八度 */
  lead: InstId;
  leadOct: number;
  /** 每小节的根音走向（调式里的第几个音），每句挑一种 */
  progressions: number[][];
  /** 每小节的伴奏 */
  accomp: (a: AccArgs) => NoteEv[];
  /** 旋律的点缀：倚音 / 滑音 / 轮指的几率 */
  ornament: number;
}

export interface AccArgs {
  bar: number;
  /** 这一小节的根音（MIDI，低音区） */
  root: number;
  /** 主音（MIDI，低音区） */
  tonic: number;
  /** 根音上方纯五度（调式里没有就用最近的音） */
  fifth: number;
  steps: number;
  /** 乐句的最后一小节 */
  cadence: boolean;
  /** 这一轮的第一小节 */
  first: boolean;
  rng: () => number;
  /** 调式里从根音往上的音（两个八度，刮奏用） */
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

const R44 = [
  [2, 1, 1, 2, 2],
  [3, 1, 2, 2],
  [2, 2, 4],
  [1, 1, 2, 4],
  [4, 2, 2],
  [2, 1, 1, 4],
  [3, 1, 4],
  [6, 2],
];
const R44_SPARSE = [
  [4, -2, 2],
  [6, -2],
  [2, -2, 4],
  [8],
  [3, 1, -4],
  [4, 4],
];
const R68 = [
  [3, 3],
  [2, 1, 3],
  [1, 1, 1, 3],
  [3, 2, 1],
  [6],
  [2, 1, 2, 1],
  [4, 2],
];

export const STYLES: StyleDef[] = [
  {
    id: 'shanshui',
    name: '山水 · 溪山',
    desc: '箫和古筝，羽调，慢——山间溪水边下棋',
    mode: MODES.yu,
    modeName: '羽调',
    tonic: 57,
    keyShift: [-2, 3],
    bpm: [62, 72],
    stepsPerBar: 8,
    rhythms: [...R44, ...R44_SPARSE],
    leap: 0.2,
    lead: 'xiao',
    leadOct: 1,
    progressions: [
      [0, 0, 3, 0],
      [0, 4, 3, 0],
      [0, 2, 3, 0],
      [3, 2, 4, 0],
    ],
    ornament: 0.25,
    accomp: ({ root, fifth, steps, cadence, scaleFrom }) => {
      const out = [at(0, 'zheng', 6, 0.12, -0.3, root), at(3, 'zheng', 3, 0.075, 0.3, fifth + 12), at(5, 'zheng', 3, 0.065, -0.15, root + 24)];
      if (steps === 8) out.push(at(6, 'zheng', 2, 0.05, 0.2, fifth + 12));
      if (cadence) out.push({ ...at(steps - 2, 'gliss', 2, 0.07, 0), run: scaleFrom(root + 12, 6) });
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
    bpm: [88, 100],
    stepsPerBar: 6,
    rhythms: R68,
    leap: 0.45,
    lead: 'morin',
    leadOct: 1,
    progressions: [
      [0, 0, 3, 0],
      [0, 3, 0, 3],
      [0, 4, 3, 0],
      [0, 2, 3, 0],
    ],
    ornament: 0.35,
    accomp: ({ bar, tonic, root, fifth, steps, rng }) => {
      const out: NoteEv[] = [];
      // 低音长鸣：主音 + 五度，两小节一换，像草原上的风
      if (bar % 2 === 0) out.push(at(0, 'drone', steps * 2, 0.05, -0.2, tonic - 12), at(0, 'drone', steps * 2, 0.035, 0.2, tonic - 5));
      // 马蹄：哒—哒哒、哒—哒哒（六八拍的跑马节奏），偶尔空一小节像勒马
      if (rng() > 0.12) for (const s of [0, 2, 3, 5]) out.push(at(s, 'hoof', 1, s === 0 || s === 3 ? 0.14 : 0.09, s < 3 ? -0.35 : 0.35));
      out.push(at(0, 'pipa', 3, 0.06, -0.25, root), at(3, 'pipa', 3, 0.045, -0.25, fifth));
      return out;
    },
  },
  {
    id: 'jiangnan',
    name: '江南 · 水乡',
    desc: '笛子、琵琶轮指、古筝分解和弦，徵调——小桥流水',
    mode: MODES.zhi,
    modeName: '徵调',
    tonic: 55,
    keyShift: [-3, 3],
    bpm: [74, 84],
    stepsPerBar: 8,
    rhythms: R44,
    leap: 0.15,
    lead: 'dizi',
    leadOct: 1,
    progressions: [
      [0, 3, 1, 0],
      [0, 1, 3, 0],
      [0, 4, 3, 0],
      [3, 4, 1, 0],
    ],
    ornament: 0.4,
    accomp: ({ root, fifth, cadence, steps, scaleFrom }) => {
      const out: NoteEv[] = [];
      // 古筝分解：根、五、八、五……流水一样不断
      const arp = [root, fifth, root + 12, fifth + 12, root + 24, fifth + 12, root + 12, fifth];
      for (let s = 0; s < steps; s += 1) if (s % 2 === 0 || s === 7) out.push(at(s, 'zheng', 2, s === 0 ? 0.09 : 0.055, s % 4 === 0 ? -0.3 : 0.25, arp[s]));
      if (cadence) out.push({ ...at(steps - 3, 'gliss', 3, 0.06, 0.1), run: scaleFrom(root + 12, 7) });
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
    bpm: [52, 60],
    stepsPerBar: 8,
    rhythms: R44_SPARSE,
    leap: 0.25,
    lead: 'qin',
    leadOct: 1,
    progressions: [
      [0, 0, 3, 0],
      [0, 3, 2, 0],
      [3, 0, 4, 0],
    ],
    ornament: 0.3,
    accomp: ({ bar, root, fifth, cadence, steps }) => {
      const out: NoteEv[] = [at(0, 'wood', 1, bar % 2 ? 0.05 : 0.08, 0.3)];
      if (bar % 2 === 0) out.push(at(0, 'sheng', steps * 2, 0.018, -0.3, root), at(0, 'sheng', steps * 2, 0.014, 0.3, fifth));
      if (cadence) out.push(at(steps - 2, 'harm', 4, 0.06, 0.2, root + 36));
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
    bpm: [88, 98],
    stepsPerBar: 8,
    rhythms: R44,
    leap: 0.2,
    lead: 'oud',
    leadOct: 1,
    progressions: [
      [0, 0, 1, 0],
      [0, 3, 1, 0],
      [0, 4, 3, 0],
    ],
    ornament: 0.3,
    accomp: ({ bar, tonic, root, steps }) => {
      // 手鼓：咚 哒 . 哒 咚 . 哒 .（中东的马克苏姆节奏）
      const out: NoteEv[] = [];
      for (const [s, k] of [
        [0, 'drumLo'],
        [2, 'drumHi'],
        [3, 'drumHi'],
        [4, 'drumLo'],
        [6, 'drumHi'],
      ] as [number, InstId][])
        if (s < steps) out.push(at(s, k, 1, k === 'drumLo' ? 0.2 : 0.09, k === 'drumLo' ? 0 : 0.3));
      if (bar % 4 === 0) out.push(at(0, 'camel', 4, 0.06, -0.4));
      if (bar % 2 === 0) out.push(at(0, 'drone', steps * 2, 0.04, -0.15, tonic - 12));
      out.push(at(0, 'oud', 2, 0.07, -0.3, root), at(5, 'oud', 1, 0.05, -0.3, root + 12));
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
    bpm: [56, 64],
    stepsPerBar: 8,
    rhythms: [...R44_SPARSE, [4, 4], [2, 2, 4]],
    leap: 0.3,
    lead: 'bell',
    leadOct: 2,
    progressions: [
      [0, 2, 3, 0],
      [0, 3, 4, 0],
      [2, 3, 1, 0],
    ],
    ornament: 0.1,
    accomp: ({ root, fifth, steps, cadence, scaleFrom }) => {
      const out = [at(0, 'sheng', steps, 0.022, -0.35, root + 12), at(0, 'sheng', steps, 0.018, 0.35, fifth + 12), at(0, 'qin', 6, 0.07, -0.2, root)];
      if (cadence) out.push({ ...at(steps - 2, 'gliss', 2, 0.05, 0.2), run: scaleFrom(root + 24, 5) });
      return out;
    },
  },
  {
    id: 'jianghu',
    name: '江湖 · 侠客',
    desc: '笛子、琵琶和大鼓，宫调，快——刀光剑影的一盘',
    mode: MODES.gong,
    modeName: '宫调',
    tonic: 50,
    keyShift: [-2, 4],
    bpm: [100, 112],
    stepsPerBar: 8,
    rhythms: R44,
    leap: 0.25,
    lead: 'dizi',
    leadOct: 1,
    progressions: [
      [0, 4, 3, 0],
      [0, 3, 4, 0],
      [3, 4, 1, 3],
    ],
    ornament: 0.3,
    accomp: ({ root, fifth, steps, cadence, scaleFrom }) => {
      const out: NoteEv[] = [at(0, 'taiko', 1, 0.24, 0), at(4, 'drumLo', 1, 0.16, 0)];
      for (let s = 1; s < steps; s += 2) out.push(at(s, 'hat', 1, 0.035, 0.35));
      out.push(at(0, 'pipa', 2, 0.08, -0.3, root), at(3, 'pipa', 2, 0.06, -0.3, root), at(6, 'pipa', 2, 0.06, -0.3, fifth));
      if (cadence) out.push({ ...at(steps - 3, 'gliss', 3, 0.07, 0.1), run: scaleFrom(root + 12, 7) });
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
  /** 主题（A 段）的动机，两轮一换 */
  motif: Motif | null;
  cycle: number;
}

interface Motif {
  /** 前两小节：每个音的（步、时值、音阶位置） */
  notes: { step: number; len: number; deg: number }[];
  prog: number[];
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
  return { style, tonic, bpm, key: `${NAMES[tonic % 12]} ${style.modeName}`, steps: BARS * style.stepsPerBar, rng, motif: null, cycle: 0 };
}

/** 五度在调式里是第几个音（宫商徵羽是第 3 个；角调没有纯五度，用小六度那个；西域是第 4 个） */
function fifthIdx(mode: number[]): number {
  const i = mode.indexOf(7);
  return i >= 0 ? i : mode.indexOf(8) >= 0 ? mode.indexOf(8) : Math.floor(mode.length / 2);
}

/** 一小节的节奏：从这一曲风的节奏型里挑 */
function rhythmOf(style: StyleDef, rng: () => number): number[] {
  const r = style.rhythms[Math.floor(rng() * style.rhythms.length)];
  const sum = r.reduce((a, x) => a + Math.abs(x), 0);
  return sum === style.stepsPerBar ? r : [style.stepsPerBar];
}

/**
 * 写一句旋律（若干小节）：在音阶上走，小步为主、按曲风偶尔跳进；最后一个音落在 end（音阶位置）上。
 * start：从哪个音阶位置出发；lo/hi：音域。
 */
function writeLine(
  style: StyleDef,
  rng: () => number,
  bars: number,
  startStep: number,
  start: number,
  end: number,
  lo: number,
  hi: number,
): { step: number; len: number; deg: number }[] {
  const out: { step: number; len: number; deg: number }[] = [];
  let deg = start;
  const n = style.mode.length;
  for (let b = 0; b < bars; b++) {
    const rh = rhythmOf(style, rng);
    let s = startStep + b * style.stepsPerBar;
    // 最后一小节里最后一个发声的音（后面可能还跟着休止）：落音落在它上面
    let lastSounding = -1;
    rh.forEach((d, i) => {
      if (d > 0) lastSounding = i;
    });
    rh.forEach((d, i) => {
      const last = b === bars - 1 && i === lastSounding;
      if (d < 0) {
        s += -d;
        return;
      }
      if (last) deg = end;
      else if (!(b === 0 && i === 0)) {
        const r = rng();
        const mag = r < 1 - style.leap ? (rng() < 0.65 ? 1 : 2) : 3 + Math.floor(rng() * (n > 5 ? 3 : 2));
        let dir = rng() < 0.5 ? -1 : 1;
        // 往目标那边拉一点：句子越往后越要靠近落音
        const left = (bars - b) * 2;
        if (Math.abs(end - deg) > left) dir = end > deg ? 1 : -1;
        deg += dir * mag;
        if (deg < lo) deg = lo + (lo - deg);
        if (deg > hi) deg = hi - (deg - hi);
      }
      out.push({ step: s, len: d, deg });
      s += d;
    });
  }
  return out;
}

/**
 * 作一轮（16 小节）：A（问句，停在属音）A'（答句，落回主音）B（换个音区的新句子）A''（再落回主音，带点缀）。
 * 主题两轮一换；B 段每轮重写。返回这一轮的全部音符（旋律 + 伴奏）。
 */
export function composeCycle(p: Piece): NoteEv[] {
  const { style, rng } = p;
  const spb = style.stepsPerBar;
  const n = style.mode.length;
  const base = n * style.leadOct; // 旋律中心：主音高一个八度
  const fifth = base + fifthIdx(style.mode);
  if (!p.motif || p.cycle % 2 === 0) {
    const prog = style.progressions[Math.floor(rng() * style.progressions.length)];
    p.motif = { notes: writeLine(style, rng, 2, 0, base + (rng() < 0.5 ? 0 : 2), base + 1 + Math.floor(rng() * 3), base - 2, base + n + 2), prog };
  }
  const motif = p.motif;
  const shiftMotif = (startStep: number, dk: number) => motif.notes.map((x) => ({ step: startStep + x.step, len: x.len, deg: x.deg + dk }));
  const lastDeg = motif.notes[motif.notes.length - 1].deg;
  const mel: { step: number; len: number; deg: number }[] = [
    // A：动机 + 问句（停在属音）
    ...shiftMotif(0, 0),
    ...writeLine(style, rng, 2, 2 * spb, lastDeg, fifth, base - 2, base + n + 2),
    // A'：动机 + 答句（落回主音）
    ...shiftMotif(4 * spb, 0),
    ...writeLine(style, rng, 2, 6 * spb, lastDeg, base, base - 2, base + n + 2),
    // B：高一个音区的新句子，停在属音
    ...writeLine(style, rng, 4, 8 * spb, base + 2 + Math.floor(rng() * 2), fifth + (rng() < 0.5 ? 0 : n), base, base + 2 * n),
    // A''：动机移高一个音再回来，落回主音
    ...shiftMotif(12 * spb, rng() < 0.5 ? 1 : 0),
    ...writeLine(style, rng, 2, 14 * spb, lastDeg, base, base - 2, base + n + 2),
  ];
  const ev: NoteEv[] = [];
  const leadPan = 0.18;
  for (const x of mel) {
    const midi = degMidi(style.mode, p.tonic, x.deg);
    const e: NoteEv = { step: x.step, inst: style.lead, midi, len: x.len, vol: 0.1 * (0.85 + rng() * 0.3), pan: leadPan, lead: true };
    // 点缀：倚音（从上方邻音带一下）、滑音（从下方滑上来）
    if (x.len >= 2 && rng() < style.ornament) {
      if (style.lead === 'morin' || style.lead === 'qin') e.slideFrom = degMidi(style.mode, p.tonic, x.deg - 1);
      else e.grace = degMidi(style.mode, p.tonic, x.deg + 1);
    }
    ev.push(e);
  }
  // 伴奏：每小节按这一曲风的织体，根音按走向（四小节一句）
  const fi = fifthIdx(style.mode);
  for (let bar = 0; bar < BARS; bar++) {
    const prog = bar >= 8 && bar < 12 ? style.progressions[(style.progressions.indexOf(motif.prog) + 1) % style.progressions.length] : motif.prog;
    const rootDeg = prog[bar % 4];
    const root = degMidi(style.mode, p.tonic - 12, rootDeg);
    const fifthMidi = degMidi(style.mode, p.tonic - 12, rootDeg + fi);
    const acc = style.accomp({
      bar,
      root,
      tonic: p.tonic - 12,
      fifth: fifthMidi,
      steps: spb,
      cadence: bar % 4 === 3,
      first: bar === 0,
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
  return ev.sort((a, b) => a.step - b.step);
}
