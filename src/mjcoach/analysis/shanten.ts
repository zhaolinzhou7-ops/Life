/**
 * 向听数与进张：整个教学系统的计算地基。
 *
 * 「为什么该打这张」最后都要落到两个数上：
 *   向听数——还差几张才听牌（越小越接近胡）
 *   进张数——能让向听前进的牌，场上还剩多少张（越大越容易摸到）
 * 学会这两个数，打牌就从背口诀变成了算账，这也是本产品和普通麻将游戏的分界线。
 *
 * 算法沿用本仓库麻将 AI 里那套「按花色拆分 + 记忆化」的做法：
 * 三门互不影响，每门单独算出「恰好 s 副面子时最多几个搭子」，再组合。
 * 单门只有 9 个牌位，结果可以按牌型缓存，命中率极高——
 * 一次舍牌分析要算几百次向听，直接对 27 位做深搜手机上会卡。
 */

import {
  RANK_COUNT, TILE_KINDS, rankOf, suitOf,
  type Counts, type Meld, type TileId,
} from '../rules/tiles';

// ==================== 单门分析（带缓存） ====================

/** [有将?5:0 + 面子数] -> 最多搭子数；-1 = 这个面子数凑不出来 */
const suitCache = new Map<number, Int8Array>();

function analyzeSuit(c: Counts, off: number): Int8Array {
  // 用五进制把这门的 9 个数字编成整数当缓存键（每位 0..4）
  let key = 0;
  for (let i = RANK_COUNT - 1; i >= 0; i--) key = key * 5 + c[off + i];
  const hit = suitCache.get(key);
  if (hit) return hit;

  const res = new Int8Array(10).fill(-1);
  const w = new Int8Array(RANK_COUNT);
  for (let i = 0; i < RANK_COUNT; i++) w[i] = c[off + i];

  const dfs = (i: number, sets: number, parts: number, pair: boolean) => {
    while (i < RANK_COUNT && w[i] === 0) i++;
    if (i >= RANK_COUNT) {
      const k = (pair ? 5 : 0) + Math.min(sets, 4);
      const pv = Math.min(parts, 4);
      if (pv > res[k]) res[k] = pv;
      return;
    }
    if (w[i] >= 3) { w[i] -= 3; dfs(i, sets + 1, parts, pair); w[i] += 3; }
    if (i <= 6 && w[i + 1] > 0 && w[i + 2] > 0) {
      w[i]--; w[i + 1]--; w[i + 2]--; dfs(i, sets + 1, parts, pair); w[i]++; w[i + 1]++; w[i + 2]++;
    }
    if (w[i] >= 2) {
      if (!pair) { w[i] -= 2; dfs(i, sets, parts, true); w[i] += 2; }
      w[i] -= 2; dfs(i, sets, parts + 1, pair); w[i] += 2;
    }
    if (i <= 7 && w[i + 1] > 0) { w[i]--; w[i + 1]--; dfs(i, sets, parts + 1, pair); w[i]++; w[i + 1]++; }
    if (i <= 6 && w[i + 2] > 0) { w[i]--; w[i + 2]--; dfs(i, sets, parts + 1, pair); w[i]++; w[i + 2]++; }
    w[i]--; dfs(i, sets, parts, pair); w[i]++; // 这张当废牌丢掉
  };
  dfs(0, 0, 0, false);

  if (suitCache.size > 200000) suitCache.clear();
  suitCache.set(key, res);
  return res;
}

/**
 * 标准型向听：8 - 2×面子 - 搭子（含将），面子 + 搭子最多 5 组。
 * meldCount 是已经碰/杠出去的副数。
 */
export function shantenStandard(c: Counts, meldCount: number): number {
  const t = [analyzeSuit(c, 0), analyzeSuit(c, 9), analyzeSuit(c, 18)];
  let best = 8;
  for (let pairSuit = -1; pairSuit < 3; pairSuit++) {
    const b = [pairSuit === 0 ? 5 : 0, pairSuit === 1 ? 5 : 0, pairSuit === 2 ? 5 : 0];
    const maxSets = 4 - meldCount;
    for (let s0 = 0; s0 <= maxSets; s0++) {
      const p0 = t[0][b[0] + s0];
      if (p0 < 0) continue;
      for (let s1 = 0; s0 + s1 <= maxSets; s1++) {
        const p1 = t[1][b[1] + s1];
        if (p1 < 0) continue;
        for (let s2 = 0; s0 + s1 + s2 <= maxSets; s2++) {
          const p2 = t[2][b[2] + s2];
          if (p2 < 0) continue;
          const m = s0 + s1 + s2 + meldCount;
          let p = p0 + p1 + p2 + (pairSuit >= 0 ? 1 : 0);
          if (m + p > 5) p = 5 - m;
          if (p < 0) p = 0;
          let sh = 8 - 2 * m - p;
          if (m + p === 5 && pairSuit < 0) sh += 1; // 五组齐了却没将，还得拆一组做将
          if (sh < best) best = sh;
        }
      }
    }
  }
  return best;
}

/** 七对向听（必须门清） */
export function shantenSevenPairs(c: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (c[t] > 0) kinds++;
    if (c[t] >= 2) pairs++;
  }
  let sh = 6 - pairs;
  if (kinds < 7) sh += 7 - kinds; // 种类不够，还得先摸出新品种
  return sh;
}

/** 综合向听。-1 = 已经和牌，0 = 听牌 */
export function shanten(c: Counts, meldCount: number, allowSevenPairs: boolean): number {
  let s = shantenStandard(c, meldCount);
  if (allowSevenPairs && meldCount === 0) s = Math.min(s, shantenSevenPairs(c));
  return s;
}

/**
 * 带缺门的向听：缺门牌迟早要打光，算的时候先当它们不存在。
 * 不这么算的话，一手「缺门牌凑成的顺子」会被算成面子，向听数虚低，
 * 教出来的舍牌全是错的。
 */
export function shantenWithLack(c: Counts, meldCount: number, allowSevenPairs: boolean, lack: number): number {
  if (lack < 0) return shanten(c, meldCount, allowSevenPairs);
  const work = c.slice();
  for (let r = 0; r < RANK_COUNT; r++) work[lack * RANK_COUNT + r] = 0;
  // 去掉缺门牌之后手牌变少，标准公式本身就会把「还差几张」算高，
  // 不需要再额外加惩罚——加了就是重复计算，会让所有含缺门的手牌看起来一样烂。
  return shanten(work, meldCount, allowSevenPairs);
}

/** 手上还剩几张缺门牌：向听之外的独立信号，用来提醒「这些迟早要打光」 */
export function lackLeft(c: Counts, lack: number): number {
  if (lack < 0) return 0;
  let n = 0;
  for (let r = 0; r < RANK_COUNT; r++) n += c[lack * RANK_COUNT + r];
  return n;
}

// ==================== 进张 ====================

export interface UkeireResult {
  /** 能让向听前进的牌 */
  tiles: TileId[];
  /** 这些牌在场上还剩的总张数 */
  total: number;
  detail: { tile: TileId; left: number }[];
}

/**
 * 进张：摸到哪些牌能让向听数减少，这些牌还剩几张。
 * seen 是「看得见的牌」（自己手牌 + 全场弃牌 + 全场副露），
 * 真人数牌数的就是这个；不扣掉已见的话，算出来的进张是纸上谈兵。
 */
export function ukeire(
  c: Counts,
  meldCount: number,
  allowSevenPairs: boolean,
  lack: number,
  seen?: Counts,
): UkeireResult {
  const cur = shantenWithLack(c, meldCount, allowSevenPairs, lack);
  const detail: { tile: TileId; left: number }[] = [];
  let total = 0;
  const work = c.slice();
  for (let t = 0; t < TILE_KINDS; t++) {
    if (lack >= 0 && suitOf(t) === lack) continue;
    const used = seen ? seen[t] : work[t];
    const left = 4 - used;
    if (left <= 0) continue;
    work[t]++;
    const sh = shantenWithLack(work, meldCount, allowSevenPairs, lack);
    work[t]--;
    if (sh < cur) {
      detail.push({ tile: t, left });
      total += left;
    }
  }
  return { tiles: detail.map((d) => d.tile), total, detail };
}

// ==================== 手牌结构分解 ====================

export type BlockKind = 'shunzi' | 'kezi' | 'duizi' | 'liangmian' | 'kanzhang' | 'bianzhang' | 'gudan';

export const BLOCK_NAME: Record<BlockKind, string> = {
  shunzi: '顺子',
  kezi: '刻子',
  duizi: '对子',
  liangmian: '两面搭子',
  kanzhang: '坎张搭子',
  bianzhang: '边张搭子',
  gudan: '孤张',
};

export const BLOCK_DESC: Record<BlockKind, string> = {
  shunzi: '三张连着的牌，已经成形',
  kezi: '三张一样的牌，已经成形',
  duizi: '两张一样，摸第三张成刻子，也可以留着当将',
  liangmian: '像 34 条这样，两头都能接（2 条和 5 条都行），进张最多',
  kanzhang: '像 35 条这样中间缺一张，只等 4 条，进张少一半',
  bianzhang: '像 12 条这样只能接 3 条，进张最少，能换就换',
  gudan: '孤零零一张，暂时没用',
};

export interface Block {
  kind: BlockKind;
  tiles: TileId[];
  /** 搭子还差哪几张才成面子 */
  waits: TileId[];
}

/**
 * 把手牌拆成看得懂的结构，教学面板直接用。
 * 挑「面子最多 → 搭子最多 → 两面优先」的那种拆法，跟人脑的看法一致。
 */
export function decompose(c: Counts, lack = -1): Block[] {
  const work = c.slice();
  let best: Block[] = [];
  let bestScore = -1;

  const score = (bs: Block[]) =>
    bs.reduce(
      (n, b) =>
        n +
        ({ shunzi: 100, kezi: 100, duizi: 22, liangmian: 25, kanzhang: 18, bianzhang: 14, gudan: 0 }[b.kind]),
      0,
    );

  const dfs = (start: number, acc: Block[]) => {
    let i = start;
    while (i < TILE_KINDS && work[i] === 0) i++;
    if (i >= TILE_KINDS) {
      const s = score(acc);
      if (s > bestScore) {
        bestScore = s;
        best = acc.map((b) => ({ ...b, tiles: [...b.tiles], waits: [...b.waits] }));
      }
      return;
    }
    const r = rankOf(i);
    const sameSuit = (d: number) => r + d <= RANK_COUNT && work[i + d] > 0;

    if (work[i] >= 3) {
      work[i] -= 3;
      acc.push({ kind: 'kezi', tiles: [i, i, i], waits: [] });
      dfs(i, acc);
      acc.pop();
      work[i] += 3;
    }
    if (r <= 7 && sameSuit(1) && sameSuit(2)) {
      work[i]--; work[i + 1]--; work[i + 2]--;
      acc.push({ kind: 'shunzi', tiles: [i, i + 1, i + 2], waits: [] });
      dfs(i, acc);
      acc.pop();
      work[i]++; work[i + 1]++; work[i + 2]++;
    }
    if (work[i] >= 2) {
      work[i] -= 2;
      acc.push({ kind: 'duizi', tiles: [i, i], waits: [i] });
      dfs(i, acc);
      acc.pop();
      work[i] += 2;
    }
    if (r <= 8 && sameSuit(1)) {
      work[i]--; work[i + 1]--;
      // 12 只能等 3，89 只能等 7，其余两头都行
      const waits: TileId[] = [];
      if (r >= 2) waits.push(i - 1);
      if (r + 2 <= RANK_COUNT) waits.push(i + 2);
      acc.push({ kind: waits.length === 2 ? 'liangmian' : 'bianzhang', tiles: [i, i + 1], waits });
      dfs(i, acc);
      acc.pop();
      work[i]++; work[i + 1]++;
    }
    if (r <= 7 && sameSuit(2)) {
      work[i]--; work[i + 2]--;
      acc.push({ kind: 'kanzhang', tiles: [i, i + 2], waits: [i + 1] });
      dfs(i, acc);
      acc.pop();
      work[i]++; work[i + 2]++;
    }
    work[i]--;
    acc.push({ kind: 'gudan', tiles: [i], waits: [] });
    dfs(i, acc);
    acc.pop();
    work[i]++;
  };

  dfs(0, []);
  if (lack >= 0) {
    // 缺门的块单独标出来，教学上要先讲「这些迟早要打光」
    return best.sort((a, b) => Number(suitOf(a.tiles[0]) === lack) - Number(suitOf(b.tiles[0]) === lack));
  }
  return best;
}

/** 手牌结构的白话摘要，给教练开口用 */
export function describeStructure(blocks: Block[]): string {
  const g = new Map<BlockKind, number>();
  for (const b of blocks) g.set(b.kind, (g.get(b.kind) ?? 0) + 1);
  const parts: string[] = [];
  const order: BlockKind[] = ['shunzi', 'kezi', 'duizi', 'liangmian', 'kanzhang', 'bianzhang', 'gudan'];
  for (const k of order) {
    const n = g.get(k);
    if (n) parts.push(`${n} 个${BLOCK_NAME[k]}`);
  }
  return parts.join('、') || '空手';
}

/** 面子数（已成形的） */
export const meldBlocks = (blocks: Block[]): Block[] =>
  blocks.filter((b) => b.kind === 'shunzi' || b.kind === 'kezi');

/** 搭子数（差一张成面子的） */
export const partialBlocks = (blocks: Block[]): Block[] =>
  blocks.filter((b) => b.kind === 'duizi' || b.kind === 'liangmian' || b.kind === 'kanzhang' || b.kind === 'bianzhang');

/** 已副露的面子数 */
export const meldCountOf = (melds: Meld[]): number => melds.length;
