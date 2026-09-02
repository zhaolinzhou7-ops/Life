/**
 * 四川麻将 AI：向听数 + 进张数决策。
 *
 * 原来的实现只判断「打这张能不能立刻听牌」，不能听就退回邻牌启发式，
 * 于是整局都在原地磨牌、不往和牌方向走——这就是"傻"的根源。
 * 这版按真人打法来：先算每种打法之后的向听数（还差几张才听牌），
 * 向听相同再比进张数（能让手牌前进的牌还剩多少张，会扣掉场上已见的）。
 */
import { suitOf, rankOf, waitingTiles, type Counts, type TileId } from './rules';

// ---------------- 向听数 ----------------

/**
 * 按花色拆分 + 记忆化的向听数。
 *
 * 直接对 27 张牌做深搜要 0.28ms，而一次出牌决策要算近 400 次向听
 * （14 种打法 × 27 种进张），加起来每步 100ms+，手机上会明显卡顿。
 * 三门花色互不影响，所以改成：每门单独算出「恰好 s 个面子时最多几个搭子」，
 * 再把三门组合起来。单门只有 9 个牌位，且结果可以按牌型缓存，命中率极高。
 */

/** 单门分析结果：[有无将×5 + 面子数] -> 最多搭子数，-1 表示凑不出 */
const suitCache = new Map<number, Int8Array>();

function analyzeSuit(a: Counts, off: number): Int8Array {
  // 用五进制把这门的 9 个数字编成一个整数当缓存键（每位 0..4）
  let key = 0;
  for (let i = 8; i >= 0; i--) key = key * 5 + a[off + i];
  const hit = suitCache.get(key);
  if (hit) return hit;

  const res = new Int8Array(10).fill(-1);
  const w = new Int8Array(9);
  for (let i = 0; i < 9; i++) w[i] = a[off + i];

  const dfs = (i: number, sets: number, parts: number, pair: boolean) => {
    while (i < 9 && w[i] === 0) i++;
    if (i >= 9) {
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
    w[i]--; dfs(i, sets, parts, pair); w[i]++; // 孤张丢掉
  };
  dfs(0, 0, 0, false);

  if (suitCache.size > 200000) suitCache.clear();
  suitCache.set(key, res);
  return res;
}

/**
 * 标准型向听数：8 - 2×面子 - 搭子(含将)，面子+搭子最多 5 组。
 * meldCount 是已经碰/杠出去的面子数。
 */
function shantenStd(c: Counts, meldCount: number): number {
  const t0 = analyzeSuit(c, 0);
  const t1 = analyzeSuit(c, 9);
  const t2 = analyzeSuit(c, 18);
  let best = 8;
  // pairSuit = -1 表示没将，0/1/2 表示将在哪一门
  for (let pairSuit = -1; pairSuit < 3; pairSuit++) {
    const b0 = pairSuit === 0 ? 5 : 0;
    const b1 = pairSuit === 1 ? 5 : 0;
    const b2 = pairSuit === 2 ? 5 : 0;
    const maxSets = 4 - meldCount;
    for (let s0 = 0; s0 <= maxSets; s0++) {
      const p0 = t0[b0 + s0];
      if (p0 < 0) continue;
      for (let s1 = 0; s0 + s1 <= maxSets; s1++) {
        const p1 = t1[b1 + s1];
        if (p1 < 0) continue;
        for (let s2 = 0; s0 + s1 + s2 <= maxSets; s2++) {
          const p2 = t2[b2 + s2];
          if (p2 < 0) continue;
          const m = s0 + s1 + s2 + meldCount;
          let p = p0 + p1 + p2 + (pairSuit >= 0 ? 1 : 0);
          if (m + p > 5) p = 5 - m;
          if (p < 0) p = 0;
          let sh = 8 - 2 * m - p;
          if (m + p === 5 && pairSuit < 0) sh += 1; // 凑齐五组却没将
          if (sh < best) best = sh;
        }
      }
    }
  }
  return best;
}

/** 七对向听数（必须门清） */
function shantenPairs(c: Counts): number {
  let pairs = 0;
  let kinds = 0;
  for (let t = 0; t < 27; t++) {
    if (c[t] > 0) kinds++;
    if (c[t] >= 2) pairs++;
  }
  let sh = 6 - pairs;
  if (kinds < 7) sh += 7 - kinds; // 种类不够，还得先摸出新种类
  return sh;
}

/** 综合向听数：-1 表示已经和牌 */
export function shanten(c: Counts, meldCount: number, concealed: boolean): number {
  let s = shantenStd(c, meldCount);
  if (concealed && meldCount === 0) s = Math.min(s, shantenPairs(c));
  return s;
}

/** 缺门牌一张都不能留，算向听时先把缺门当成必须打掉的废牌 */
function lackPenalty(c: Counts, lack: number): number {
  let n = 0;
  for (let r = 0; r < 9; r++) n += c[lack * 9 + r];
  return n;
}

// ---------------- 定缺 ----------------

/**
 * 定缺：不是简单选张数最少的一门，而是选「打掉这门之后剩下的牌最接近听牌」的那门。
 * 有时候某门虽然张数多，但全是孤张，反而该缺。
 */
export function chooseLack(c: Counts): number {
  let best = 0;
  let bestScore = Infinity;
  for (let s = 0; s < 3; s++) {
    const rest = c.slice();
    let n = 0;
    for (let r = 0; r < 9; r++) {
      n += rest[s * 9 + r];
      rest[s * 9 + r] = 0;
    }
    // 主要看剩下两门的向听数，其次才看要打掉多少张
    const sh = shantenStd(rest, 0);
    const score = sh * 10 + n;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

// ---------------- 出牌 ----------------

/** 单张牌的搭子价值，用作同向听同进张时的最后一档比较 */
function tileValue(c: Counts, t: TileId): number {
  const r = rankOf(t);
  let v = 0;
  if (c[t] >= 2) v += 6 * (c[t] - 1);
  const s = suitOf(t);
  const at = (rr: number) => (rr >= 1 && rr <= 9 ? c[s * 9 + rr - 1] : 0);
  v += (at(r - 1) + at(r + 1)) * 3;
  v += (at(r - 2) + at(r + 2)) * 1.2;
  v += 1 - Math.abs(5 - r) * 0.12;
  return v;
}

/**
 * 进张数：还能让向听数前进的牌，场上一共还剩多少张。
 * seen 是已经看得见的牌（自己手牌 + 所有人的弃牌和副露），真人也是这么数张的。
 */
function ukeire(c: Counts, meldCount: number, concealed: boolean, lack: number, cur: number, seen?: Counts): number {
  let total = 0;
  for (let t = 0; t < 27; t++) {
    if (suitOf(t) === lack) continue;
    const used = seen ? seen[t] : c[t];
    if (used >= 4) continue;
    c[t]++;
    const sh = shanten(c, meldCount, concealed);
    c[t]--;
    if (sh < cur) total += 4 - used;
  }
  return total;
}

/**
 * 选择要打的牌。
 * 规则上必须先打光缺门；之后按「向听数最小 → 进张最多 → 搭子价值最低」挑。
 * sloppy 是失误率，新手场用来模拟看走眼。
 */
export function chooseDiscard(
  c: Counts,
  lack: number,
  noMelds = true,
  sloppy = 0,
  meldCount = 0,
  seen?: Counts,
): TileId {
  if (sloppy > 0 && Math.random() < sloppy) {
    const cand: TileId[] = [];
    for (let t = 0; t < 27; t++) if (c[t] > 0 && suitOf(t) !== lack) cand.push(t);
    if (cand.length) return cand[Math.floor(Math.random() * cand.length)];
  }

  // 缺门必须先走：同为缺门时打最没用的那张
  if (lackPenalty(c, lack) > 0) {
    let best = -1;
    let bestVal = Infinity;
    for (let t = 0; t < 27; t++) {
      if (c[t] > 0 && suitOf(t) === lack) {
        const v = tileValue(c, t);
        if (v < bestVal) { bestVal = v; best = t; }
      }
    }
    return best;
  }

  const concealed = noMelds;
  let best = -1;
  let bestSh = 99;
  let bestUke = -1;
  let bestVal = Infinity;

  for (let t = 0; t < 27; t++) {
    if (c[t] === 0) continue;
    c[t]--;
    const sh = shanten(c, meldCount, concealed);
    // 已经听牌就直接比听口宽度，比通用进张更准
    let uke: number;
    if (sh === 0) {
      const waits = waitingTiles(c, concealed, lack);
      uke = 0;
      for (const wt of waits) uke += 4 - (seen ? seen[wt] : c[wt]);
      uke += 1000; // 能听牌的打法绝对优先
    } else {
      uke = ukeire(c, meldCount, concealed, lack, sh, seen);
    }
    const v = tileValue(c, t);
    c[t]++;

    if (sh < bestSh || (sh === bestSh && (uke > bestUke || (uke === bestUke && v < bestVal)))) {
      bestSh = sh;
      bestUke = uke;
      bestVal = v;
      best = t;
    }
  }
  return best >= 0 ? best : firstTile(c);
}

function firstTile(c: Counts): TileId {
  for (let t = 0; t < 27; t++) if (c[t] > 0) return t;
  return 0;
}

// ---------------- 碰 / 杠 ----------------

/**
 * 是否碰：碰掉之后向听数不能变差。
 * 原来这里近乎抛硬币，经常碰出一手废牌——那是最显"傻"的动作之一。
 */
export function wantPeng(c: Counts, t: TileId, lack: number, pengCount: number, meldCount = 0): boolean {
  if (suitOf(t) === lack) return false;
  if (c[t] < 2) return false;
  const concealed = meldCount === 0;
  const before = shanten(c, meldCount, concealed);
  c[t] -= 2;
  const after = shanten(c, meldCount + 1, false); // 碰完就不再门清
  c[t] += 2;
  if (after < before) return true; // 碰了更近，一定碰
  if (after > before) return false; // 碰了更远，不碰
  // 持平：做对对胡或边张时碰划算
  const r = rankOf(t);
  return pengCount >= 1 || r <= 2 || r >= 8;
}

/** 是否明杠：缺门不杠；杠了不能让向听变差（杠出去少一张，可能拆掉搭子） */
export function wantGang(t: TileId, lack: number, c?: Counts, meldCount = 0): boolean {
  if (suitOf(t) === lack) return false;
  if (!c) return true;
  if (c[t] < 3) return false;
  const before = shanten(c, meldCount, meldCount === 0);
  c[t] -= 3;
  const after = shanten(c, meldCount + 1, false);
  c[t] += 3;
  return after <= before;
}
