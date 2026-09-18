/**
 * 换三张分析。
 *
 * 换三张是开局第一个决策，也是最容易被随手点掉的一步。
 * 它和定缺是连着的：换出去的三张，通常就是你打算缺的那一门，
 * 换完之后手牌会变成什么样，直接决定这一局好不好打。
 *
 * 评分思路：
 *   换出三张之后，手上只剩 10 张（还没换回来），
 *   这时候看剩下这 10 张的向听数和进张数——这才是你真正的底子。
 *   换回来的三张是别人给的，谁也预测不了，所以不去猜它，
 *   只用「剩下的牌好不好」来判断，这是能算清楚的部分。
 *
 * 另外要看两件事：
 *   1. 别把成形的面子换出去（新手常见错误）
 *   2. 优先换掉「打算缺的那门」，换三张和定缺要连着想
 */

import type { RuleConfig } from '../rules/config';
import {
  RANK_COUNT, SUIT_NAMES, suitOf, tilesName,
  type Counts, type Suit, type TileId,
} from '../rules/tiles';
import { decompose, shanten, ukeire } from './shanten';
import { analyzeLack } from './dingque';
import { suitCohesion } from './efficiency';

export interface SwapOption {
  tiles: TileId[];
  text: string;
  suit: Suit;
  /** 换出之后剩下 10 张的向听数 */
  shantenAfter: number;
  /** 换出之后的进张 */
  ukeireAfter: number;
  /** 拆掉了几副现成面子 */
  brokenMelds: number;
  /** 拆掉了几个搭子 */
  brokenPartials: number;
  /** 这三张是不是同一门里最没用的 */
  isolatedCount: number;
  score: number;
  rank: number;
  reasons: string[];
}

export interface SwapAnalysis {
  options: SwapOption[];
  best: SwapOption;
  /** 推荐换出的那一门，通常也就是建议缺的门 */
  recommendSuit: Suit;
  /** 和定缺建议是否一致 */
  matchesLackAdvice: boolean;
  verdict: string;
  margin: number;
}

function scoreOption(cfg: RuleConfig, hand: Counts, tiles: TileId[], seen?: Counts): Omit<SwapOption, 'rank'> {
  const before = decompose(hand);
  const rest = hand.slice();
  for (const t of tiles) rest[t]--;
  const after = decompose(rest);

  const meldsBefore = before.filter((b) => b.kind === 'shunzi' || b.kind === 'kezi').length;
  const meldsAfter = after.filter((b) => b.kind === 'shunzi' || b.kind === 'kezi').length;
  const partsBefore = before.filter((b) => ['duizi', 'liangmian', 'kanzhang', 'bianzhang'].includes(b.kind)).length;
  const partsAfter = after.filter((b) => ['duizi', 'liangmian', 'kanzhang', 'bianzhang'].includes(b.kind)).length;

  const allowSeven = cfg.win.sevenPairs;
  const sh = shanten(rest, 0, allowSeven);
  const uk = ukeire(rest, 0, allowSeven, -1, seen);
  const suit = suitOf(tiles[0]);
  const isolated = tiles.filter((t) => before.some((b) => b.kind === 'gudan' && b.tiles[0] === t)).length;

  const brokenMelds = Math.max(0, meldsBefore - meldsAfter);
  const brokenPartials = Math.max(0, partsBefore - partsAfter);

  // 拆面子是重罪，拆搭子是轻罪，换孤张有奖励
  const score =
    -sh * 60 + uk.total * 1.8 - brokenMelds * 50 - brokenPartials * 14 + isolated * 10;

  const reasons: string[] = [];
  if (brokenMelds > 0) reasons.push(`会拆掉 ${brokenMelds} 副现成面子，代价很大`);
  else if (brokenPartials > 0) reasons.push(`会拆掉 ${brokenPartials} 个搭子`);
  if (isolated === 3) reasons.push('三张都是孤张，换出去一点不亏');
  else if (isolated > 0) reasons.push(`其中 ${isolated} 张是孤张`);
  reasons.push(`换完剩下的牌还差 ${sh} 张听牌，进张 ${uk.total} 张`);

  return {
    tiles,
    text: tilesName(tiles),
    suit: suit as Suit,
    shantenAfter: sh,
    ukeireAfter: uk.total,
    brokenMelds,
    brokenPartials,
    isolatedCount: isolated,
    score,
    reasons,
  };
}

/** 枚举所有「同花色三张」的换法并打分 */
export function analyzeSwap(cfg: RuleConfig, hand: Counts, seen?: Counts): SwapAnalysis {
  const count = cfg.swap.count;
  const options: SwapOption[] = [];

  for (const s of cfg.tiles.suits) {
    const tiles: TileId[] = [];
    for (let r = 0; r < RANK_COUNT; r++) {
      const t = s * RANK_COUNT + r;
      for (let i = 0; i < hand[t]; i++) tiles.push(t);
    }
    if (tiles.length < count) continue;
    const combo = (start: number, cur: TileId[]) => {
      if (cur.length === count) {
        options.push({ ...scoreOption(cfg, hand, [...cur], seen), rank: 0 });
        return;
      }
      for (let i = start; i < tiles.length; i++) {
        if (i > start && tiles[i] === tiles[i - 1]) continue; // 同张去重
        cur.push(tiles[i]);
        combo(i + 1, cur);
        cur.pop();
      }
    };
    combo(0, []);
  }

  options.sort((a, b) => b.score - a.score);
  options.forEach((o, i) => (o.rank = i + 1));
  const best = options[0];
  const margin = options.length > 1 ? Math.round(best.score - options[1].score) : 0;

  const lackAdvice = analyzeLack(cfg, hand, [], seen);
  const matches = best.suit === lackAdvice.best.suit;

  let verdict = `建议换出 ${best.text}`;
  if (best.isolatedCount === count) verdict += '——这三张互相不搭界，是全手最没用的牌。';
  else if (best.brokenMelds === 0) verdict += '——不会动到已经成形的牌。';
  else verdict += '——虽然会动到搭子，但这是当前最省的换法。';
  if (matches) verdict += `换完正好可以缺${SUIT_NAMES[best.suit]}，两步连着走。`;
  else verdict += `注意：这手牌更适合缺${lackAdvice.best.name}，换牌和定缺的方向要想清楚。`;

  return { options, best, recommendSuit: best.suit, matchesLackAdvice: matches, verdict, margin };
}

/** 评价用户真实换的三张 */
export function judgeSwap(cfg: RuleConfig, hand: Counts, chosen: TileId[], seen?: Counts): {
  analysis: SwapAnalysis;
  chosenOption: SwapOption;
  /** 在所有换法里排第几 */
  rank: number;
  total: number;
  /** 百分位，0 = 最好 */
  percentile: number;
  loss: number;
  correct: boolean;
} {
  const analysis = analyzeSwap(cfg, hand, seen);
  const key = [...chosen].sort((a, b) => a - b).join(',');
  const found = analysis.options.find((o) => [...o.tiles].sort((a, b) => a - b).join(',') === key);
  const chosenOption = found ?? { ...scoreOption(cfg, hand, [...chosen], seen), rank: analysis.options.length + 1 };
  const loss = Math.round(analysis.best.score - chosenOption.score);
  return {
    analysis,
    chosenOption,
    rank: chosenOption.rank,
    total: analysis.options.length,
    percentile: analysis.options.length > 1 ? (chosenOption.rank - 1) / (analysis.options.length - 1) : 0,
    loss,
    correct: chosenOption.rank === 1 || loss < 12,
  };
}

/** 换三张之前先看看各门的家底，UI 上直接展示 */
export function swapOverview(hand: Counts): { suit: Suit; name: string; count: number; melds: number; partials: number; isolated: number }[] {
  return [0, 1, 2].map((s) => {
    const c = suitCohesion(hand, s);
    return { suit: s as Suit, name: SUIT_NAMES[s], ...c };
  });
}
