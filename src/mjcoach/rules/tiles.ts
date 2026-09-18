/**
 * 牌的表示。整个教练系统只认这一套编码，别处不许再发明第二套。
 *
 * 四川麻将只用万/条/筒三门，没有字牌和花牌，所以一张牌就是 0..26 的整数：
 *   id = suit * 9 + (rank - 1)，suit 0=万 1=条 2=筒，rank 1..9
 * 一手牌用长度 27 的计数数组（Counts）表示，每格 0..4 张。
 * 计数数组比「牌的数组」好用得多：判胡、算向听都是在计数上做递归消去。
 */

export type TileId = number;
/** 0=万 1=条 2=筒 */
export type Suit = 0 | 1 | 2;
/** 长度 27 的计数数组 */
export type Counts = number[];

export const SUIT_COUNT = 3;
export const RANK_COUNT = 9;
export const TILE_KINDS = SUIT_COUNT * RANK_COUNT; // 27

export const SUIT_NAMES = ['万', '条', '筒'] as const;
/** 口语里的叫法，解说文案用得上 */
export const SUIT_ALIAS = ['万子', '条子（索）', '筒子（饼）'] as const;

export const suitOf = (t: TileId): Suit => Math.floor(t / RANK_COUNT) as Suit;
export const rankOf = (t: TileId): number => (t % RANK_COUNT) + 1;
export const tileOf = (suit: number, rank: number): TileId => suit * RANK_COUNT + (rank - 1);
export const tileName = (t: TileId): string => `${rankOf(t)}${SUIT_NAMES[suitOf(t)]}`;

/** 一串牌的可读名字：3万 4万 5万 */
export const tilesName = (ts: readonly TileId[]): string => ts.map(tileName).join(' ');

/** 是否幺九（1/9）。四川麻将没有字牌，边张价值低主要就体现在这里 */
export const isTerminal = (t: TileId): boolean => rankOf(t) === 1 || rankOf(t) === 9;

export function emptyCounts(): Counts {
  return new Array(TILE_KINDS).fill(0);
}

export function toCounts(tiles: readonly TileId[]): Counts {
  const c = emptyCounts();
  for (const t of tiles) c[t]++;
  return c;
}

/** 计数数组 → 升序牌数组 */
export function toTiles(c: Counts): TileId[] {
  const out: TileId[] = [];
  for (let t = 0; t < TILE_KINDS; t++) for (let i = 0; i < c[t]; i++) out.push(t);
  return out;
}

export const countTotal = (c: Counts): number => c.reduce((a, b) => a + b, 0);

/** 某门在手里有几张 */
export function suitCount(c: Counts, suit: number): number {
  let n = 0;
  for (let r = 0; r < RANK_COUNT; r++) n += c[suit * RANK_COUNT + r];
  return n;
}

/** 手里还有没有这门牌（定缺判断的核心） */
export function hasSuit(c: Counts, suit: number): boolean {
  if (suit < 0) return false;
  for (let r = 0; r < RANK_COUNT; r++) if (c[suit * RANK_COUNT + r] > 0) return true;
  return false;
}

/**
 * 解析牌面简写，写测试用例和题库时省事得多：
 *   "123m 456s 789p" → 万 123 / 条 456 / 筒 789
 * m/w=万, s/t=条, p=筒。也接受 "3万4万" 这种中文写法。
 */
export function parseHand(text: string): TileId[] {
  const out: TileId[] = [];
  const suitByLetter: Record<string, number> = { m: 0, w: 0, s: 1, t: 1, p: 2, b: 2 };
  // 中文写法：数字 + 万/条/筒
  const zh = /([1-9])\s*([万条筒])/g;
  let m: RegExpExecArray | null;
  let matchedZh = false;
  while ((m = zh.exec(text))) {
    matchedZh = true;
    out.push(tileOf(SUIT_NAMES.indexOf(m[2] as (typeof SUIT_NAMES)[number]), Number(m[1])));
  }
  if (matchedZh) return out.sort((a, b) => a - b);
  // 简写：数字串 + 后缀字母
  const re = /([1-9]+)\s*([a-zA-Z])/g;
  while ((m = re.exec(text))) {
    const suit = suitByLetter[m[2].toLowerCase()];
    if (suit === undefined) throw new Error(`未知花色后缀：${m[2]}`);
    for (const ch of m[1]) out.push(tileOf(suit, Number(ch)));
  }
  return out.sort((a, b) => a - b);
}

/** parseHand 的计数版 */
export const parseCounts = (text: string): Counts => toCounts(parseHand(text));

/** 反向：把手牌写成 "123m456s" 简写，存牌谱和出题时用 */
export function formatHand(tiles: readonly TileId[]): string {
  const letters = ['m', 's', 'p'];
  const bySuit: string[][] = [[], [], []];
  for (const t of [...tiles].sort((a, b) => a - b)) bySuit[suitOf(t)].push(String(rankOf(t)));
  return bySuit
    .map((ranks, s) => (ranks.length ? ranks.join('') + letters[s] : ''))
    .filter(Boolean)
    .join(' ');
}

/** 副露：四川麻将没有吃，只有碰和三种杠 */
export type MeldKind = 'peng' | 'gang' | 'angang' | 'bugang';

export interface Meld {
  kind: MeldKind;
  tile: TileId;
  /** 牌是从谁那里来的（暗杠为自己） */
  from: number;
}

/** 这个副露占用几张牌 */
export const meldSize = (m: Meld): number => (m.kind === 'peng' ? 3 : 4);

export const meldName = (m: Meld): string =>
  ({ peng: '碰', gang: '明杠', angang: '暗杠', bugang: '补杠' })[m.kind];

/**
 * 可复现的随机数（xorshift32）。
 * 牌局必须能按种子完整重放，所以从洗牌到 AI 的每一次随机都走这里，
 * 不许直接用 Math.random——否则复盘出来的牌局和当时打的不是同一局。
 */
export class Rng {
  private s: number;
  constructor(seed: number) {
    // 0 是 xorshift 的不动点，必须避开
    this.s = seed >>> 0 || 0x9e3779b9;
  }
  /** [0,1) */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 0x100000000;
  }
  /** [0,n) 整数 */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(arr.length)];
  }
  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }
}

export const randomSeed = (): number => (Math.random() * 0xffffffff) >>> 0;
