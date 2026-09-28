/**
 * AI 第一步：牌面分析。
 *
 * 核心指标是**最少手数**（minHands）——把手上的牌拆成合法牌型，最少要出几次
 * 才能走完。斗地主的本质就是抢手数：能把 17 张拆成 6 手的人，多半赢得过
 * 拆成 9 手的人。后面的候选评价全部建立在"出完这手之后，剩下的牌手数变成几"
 * 上面，所以这一层必须又准又快。
 *
 * 拆牌是个组合爆炸问题（20 张牌的拆法非常多），这里用
 * "先枚举连牌，剩下的用贴牌公式估" + 记忆化 + 节点预算 的做法：
 * 保证**任何手牌都能在固定时间内算完**，AI 绝不会因为想太久而卡死。
 */
import {
  MAX_CHAIN_RANK,
  RANK_2,
  RANK_3,
  RANK_JOKER_BIG,
  RANK_JOKER_SMALL,
  countByRank,
  type Card,
  type Rank,
} from '../cards';

/** 计数表：下标就是 rank，3..17 有效。用定长数组而不是 Map，拆牌递归里快很多 */
export type RankCounts = number[];

export const EMPTY_COUNTS = (): RankCounts => new Array(18).fill(0);

export function toCounts(cards: readonly Card[]): RankCounts {
  const c = EMPTY_COUNTS();
  for (const card of cards) c[card.rank]++;
  return c;
}

export const countsTotal = (c: RankCounts) => c.reduce((a, b) => a + b, 0);

/** 一段连牌：从 from 到 to，每个点数取 per 张 */
export interface Chain {
  per: 1 | 2 | 3;
  from: Rank;
  to: Rank;
}

/** 枚举手上所有可能的连牌（单顺 ≥5、连对 ≥3、三顺 ≥2），2 和王不参与 */
export function enumerateChains(c: RankCounts): Chain[] {
  const out: Chain[] = [];
  const minLen = { 1: 5, 2: 3, 3: 2 } as const;
  for (const per of [1, 2, 3] as const) {
    for (let from = RANK_3; from <= MAX_CHAIN_RANK; from++) {
      if (c[from] < per) continue;
      for (let to = from + minLen[per] - 1; to <= MAX_CHAIN_RANK; to++) {
        let okRun = true;
        for (let r = from; r <= to; r++) {
          if (c[r] < per) {
            okRun = false;
            break;
          }
        }
        if (!okRun) break;
        out.push({ per, from, to });
      }
    }
  }
  return out;
}

export function removeChain(c: RankCounts, chain: Chain): RankCounts {
  const next = c.slice();
  for (let r = chain.from; r <= chain.to; r++) next[r] -= chain.per;
  return next;
}

/**
 * 不再拆连牌时的手数估算。
 *
 * 规则：炸弹和王炸各算一手（而且通常留着不拆）；三张可以贴一张单或一对，
 * 所以先让三张把散牌吃掉；剩下的对子和单牌各算一手。
 */
function baseHands(c: RankCounts): number {
  let bombs = 0;
  let triples = 0;
  let pairs = 0;
  let singles = 0;
  for (let r = RANK_3; r <= RANK_2; r++) {
    if (c[r] === 4) bombs++;
    else if (c[r] === 3) triples++;
    else if (c[r] === 2) pairs++;
    else if (c[r] === 1) singles++;
  }
  const jokers = (c[RANK_JOKER_SMALL] ? 1 : 0) + (c[RANK_JOKER_BIG] ? 1 : 0);
  // 大小王凑齐是王炸，算一手；只有一张就是一张单牌
  const jokerHands = jokers === 2 ? 1 : jokers;

  let hands = bombs + triples + pairs + singles + jokerHands;
  // 三带一 / 三带二：每个三张能顺手带走一手
  let carry = triples;
  const takeSingles = Math.min(carry, singles);
  hands -= takeSingles;
  carry -= takeSingles;
  hands -= Math.min(carry, pairs);
  return hands;
}

/** 节点预算：超过就用当前估值返回。宁可估得糙一点，也不能让 AI 卡住 */
const NODE_BUDGET = 12000;
const MAX_CHAIN_DEPTH = 4;

/**
 * 最少手数。
 * 结果会被缓存：同一副手牌在一步棋里会被问很多次（每个候选都要算一遍）。
 */
export function minHands(counts: RankCounts): number {
  const memo = new Map<string, number>();
  let nodes = 0;

  function search(c: RankCounts, depth: number): number {
    const key = c.join(',');
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = baseHands(c);
    if (depth < MAX_CHAIN_DEPTH && nodes < NODE_BUDGET) {
      for (const chain of enumerateChains(c)) {
        if (nodes++ > NODE_BUDGET) break;
        const sub = 1 + search(removeChain(c, chain), depth + 1);
        if (sub < best) best = sub;
      }
    }
    memo.set(key, best);
    return best;
  }

  return search(counts, 0);
}

const handsCache = new Map<string, number>();

/** 带全局缓存的最少手数（同一副牌反复问时非常值） */
export function minHandsCached(counts: RankCounts): number {
  const key = counts.join(',');
  const hit = handsCache.get(key);
  if (hit !== undefined) return hit;
  const v = minHands(counts);
  // 缓存无限涨会吃内存，到量就整体清掉（牌局之间本来也不该共享太多）
  if (handsCache.size > 20000) handsCache.clear();
  handsCache.set(key, v);
  return v;
}

/** 手牌结构画像，AI 决策和「为什么这么出」的解释都从这里取数 */
export interface HandAnalysis {
  counts: RankCounts;
  total: number;
  /** 最少手数 */
  hands: number;
  singles: Rank[];
  pairs: Rank[];
  triples: Rank[];
  bombs: Rank[];
  hasRocket: boolean;
  /** 能拉出来的最长连牌，用于判断"我有没有顺子" */
  chains: Chain[];
  /** 控制牌：2 和王，这些牌能抢回出牌权 */
  controls: Rank[];
  /** 大牌数量（A 以上） */
  bigCards: number;
  /** 综合强度，越大越好。用于叫分和"敢不敢跟" */
  strength: number;
}

export function analyzeHand(cards: readonly Card[]): HandAnalysis {
  const counts = toCounts(cards);
  const singles: Rank[] = [];
  const pairs: Rank[] = [];
  const triples: Rank[] = [];
  const bombs: Rank[] = [];
  for (let r = RANK_3; r <= RANK_2; r++) {
    if (counts[r] === 1) singles.push(r);
    else if (counts[r] === 2) pairs.push(r);
    else if (counts[r] === 3) triples.push(r);
    else if (counts[r] === 4) bombs.push(r);
  }
  const hasRocket = counts[RANK_JOKER_SMALL] > 0 && counts[RANK_JOKER_BIG] > 0;
  const controls: Rank[] = [];
  if (counts[RANK_2] > 0) for (let i = 0; i < counts[RANK_2]; i++) controls.push(RANK_2);
  if (counts[RANK_JOKER_SMALL]) controls.push(RANK_JOKER_SMALL);
  if (counts[RANK_JOKER_BIG]) controls.push(RANK_JOKER_BIG);

  const total = countsTotal(counts);
  const hands = minHandsCached(counts);
  let bigCards = 0;
  for (let r = 14; r <= RANK_JOKER_BIG; r++) bigCards += counts[r];

  // 强度：手数越少越强，炸弹和大牌是硬实力
  const strength =
    -hands * 6 + bombs.length * 9 + (hasRocket ? 12 : 0) + bigCards * 2 + controls.length * 1.5;

  return {
    counts,
    total,
    hands,
    singles,
    pairs,
    triples,
    bombs,
    hasRocket,
    chains: enumerateChains(counts),
    controls,
    bigCards,
    strength,
  };
}

/** 叫分建议：0..3。只看自己 17 张牌，和真人的判断依据一致 */
export function suggestBid(cards: readonly Card[]): number {
  const a = analyzeHand(cards);
  // 17 张牌拆成 8 手以内算好牌；炸弹、王炸、2 都是加分项
  let score = 0;
  score += Math.max(0, 9 - a.hands) * 1.6;
  score += a.bombs.length * 2.4;
  score += a.hasRocket ? 3 : 0;
  score += (a.counts[RANK_JOKER_BIG] ? 1.2 : 0) + (a.counts[RANK_JOKER_SMALL] ? 0.8 : 0);
  score += a.counts[RANK_2] * 0.9;
  score += a.counts[14] * 0.4;
  if (score >= 7.2) return 3;
  if (score >= 5.4) return 2;
  if (score >= 3.6) return 1;
  return 0;
}

/** 把点数计数表还原成具体的牌（从手牌里挑），用于候选生成 */
export function pickByRanks(hand: readonly Card[], want: Map<Rank, number>): Card[] {
  const byRank = new Map<Rank, Card[]>();
  for (const c of hand) {
    const list = byRank.get(c.rank);
    if (list) list.push(c);
    else byRank.set(c.rank, [c]);
  }
  const out: Card[] = [];
  for (const [rank, n] of want) {
    const list = byRank.get(rank) ?? [];
    if (list.length < n) throw new Error(`手牌里没有 ${n} 张 ${rank}`);
    out.push(...list.slice(0, n));
  }
  return out;
}

/** 手牌里某点数还有几张 */
export const countOf = (cards: readonly Card[], rank: Rank) => countByRank(cards).get(rank) ?? 0;
