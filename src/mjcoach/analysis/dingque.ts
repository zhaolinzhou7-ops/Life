/**
 * 定缺分析。
 *
 * 这是四川麻将最该教、也最常被教错的一步。
 * 到处都能看到的说法是「哪门少就缺哪门」——这句话对一半。
 * 真正要比的是：**打掉这门之后，剩下两门离听牌还有多远**。
 *
 * 常见的反例：
 *   万：1 4 7 9（四张，全是孤张）
 *   条：3 4 5（三张，已经是一副顺子）
 * 按张数该缺条，但缺了条就毁掉一副现成面子，剩下一堆孤张万，明显更差。
 *
 * 所以这里的做法是：对每一门做一次「假设缺它」的完整推演，
 * 比较剩下两门的向听数和进张数，再把张数、面子损失、孤张数作为解释材料输出。
 */

import type { RuleConfig } from '../rules/config';
import {
  RANK_COUNT, SUIT_NAMES, TILE_KINDS, tilesName,
  type Counts, type Meld, type Suit,
} from '../rules/tiles';
import { shanten, ukeire } from './shanten';
import { suitCohesion } from './efficiency';

export interface LackOption {
  suit: Suit;
  name: string;
  /** 这门有几张 */
  count: number;
  /** 这门里已经成形的面子数（缺了就毁掉） */
  melds: number;
  /** 这门里的搭子数 */
  partials: number;
  /** 这门里的孤张数（缺了不心疼） */
  isolated: number;
  /** 缺这门之后，剩下两门的向听数 */
  shantenAfter: number;
  /** 缺这门之后的进张张数 */
  ukeireAfter: number;
  /** 综合评分，越大越该缺 */
  score: number;
  /** 排第几（1 = 最推荐） */
  rank: number;
  /** 给用户看的短理由 */
  reasons: string[];
  /** 这门具体是哪些牌 */
  tilesText: string;
}

export interface LackAnalysis {
  options: LackOption[];
  best: LackOption;
  /** 第一名和第二名差多少，差得少说明怎么选都行 */
  margin: number;
  /** 一句话结论 */
  verdict: string;
}

export function analyzeLack(cfg: RuleConfig, hand: Counts, melds: Meld[] = [], seen?: Counts): LackAnalysis {
  const allowSeven = cfg.win.sevenPairs && melds.length === 0;
  const opts: LackOption[] = [];

  for (const suit of cfg.tiles.suits) {
    const rest = hand.slice();
    for (let r = 0; r < RANK_COUNT; r++) rest[suit * RANK_COUNT + r] = 0;
    const coh = suitCohesion(hand, suit);
    const sh = shanten(rest, melds.length, allowSeven);
    const uk = ukeire(rest, melds.length, allowSeven, suit, seen);

    /*
     * 评分的排序是有讲究的：
     *   1. 缺完之后还差几张听牌（向听）——主项，权重压倒一切
     *   2. 毁掉了几副现成面子——拆一副顺子比多打两张散牌疼得多
     *   3. 要打掉几张牌——每张都要占一轮，开局会被动
     *   4. 进张宽度——只当同分时的参考
     *
     * 进张这一项**故意压得很低**，因为它在这里不公平：
     * 缺张数多的那门，剩下的牌就多，块也多，进张天然更大。
     * 早一版给它权重 2，结果每手牌都推荐「缺张数最少的那门」，
     * 恰恰就是我们想纠正的那个错误说法。所以它只配当个零头。
     */
    const score =
      -sh * 100 -
      coh.melds * 30 -
      coh.partials * 8 -
      coh.count * 2 +
      coh.isolated * 5 +
      uk.total * 0.35;

    const reasons: string[] = [];
    reasons.push(`这门 ${coh.count} 张`);
    if (coh.melds > 0) reasons.push(`已经有 ${coh.melds} 副面子，缺掉可惜`);
    if (coh.partials > 0) reasons.push(`有 ${coh.partials} 个搭子`);
    if (coh.isolated >= 2) reasons.push(`${coh.isolated} 张是孤张，打掉不心疼`);
    reasons.push(`缺它之后还差 ${sh} 张听牌，进张 ${uk.total} 张`);

    const tiles: number[] = [];
    for (let r = 0; r < RANK_COUNT; r++) {
      const t = suit * RANK_COUNT + r;
      for (let i = 0; i < hand[t]; i++) tiles.push(t);
    }

    opts.push({
      suit,
      name: SUIT_NAMES[suit],
      count: coh.count,
      melds: coh.melds,
      partials: coh.partials,
      isolated: coh.isolated,
      shantenAfter: sh,
      ukeireAfter: uk.total,
      score,
      rank: 0,
      reasons,
      tilesText: tiles.length ? tilesName(tiles) : '一张也没有',
    });
  }

  opts.sort((a, b) => b.score - a.score);
  opts.forEach((o, i) => (o.rank = i + 1));
  const margin = opts.length > 1 ? Math.round(opts[0].score - opts[1].score) : 0;

  const best = opts[0];
  let verdict: string;
  if (margin >= 45) {
    verdict = `建议缺${best.name}，而且差距明显——另外两门都比它更值得留。`;
  } else if (margin >= 15) {
    verdict = `建议缺${best.name}，比第二选择${opts[1].name}好一些。`;
  } else {
    verdict = `缺${best.name}或${opts[1].name}都行，这手牌怎么选差别不大，别纠结。`;
  }

  return { options: opts, best, margin, verdict };
}

/**
 * 张数最少的那门（很多人以为这就是答案）。
 * 教学时专门拿它和真正的推荐做对比——让用户看见「少不等于该缺」。
 */
export function fewestSuit(hand: Counts): Suit {
  let best: Suit = 0;
  let bestN = Infinity;
  for (let s = 0; s < 3; s++) {
    let n = 0;
    for (let r = 0; r < RANK_COUNT; r++) n += hand[s * RANK_COUNT + r];
    if (n < bestN) { bestN = n; best = s as Suit; }
  }
  return best;
}

/** 定缺之后要打掉多少张牌才干净——新手最容易低估这个代价 */
export function lackCost(hand: Counts, suit: number): { tiles: number; turns: string } {
  let n = 0;
  for (let r = 0; r < RANK_COUNT; r++) n += hand[suit * RANK_COUNT + r];
  const turns = n <= 2 ? '一两轮就能打干净' : n <= 4 ? '大约要三四轮' : `要打 ${n} 轮，开局会比较被动`;
  return { tiles: n, turns };
}

/** 检查一次真实的定缺选择，给出评价 */
export function judgeLack(cfg: RuleConfig, hand: Counts, chosen: number, seen?: Counts): {
  analysis: LackAnalysis;
  chosenOption: LackOption;
  correct: boolean;
  /** 和最优选择差多少分 */
  loss: number;
} {
  const analysis = analyzeLack(cfg, hand, [], seen);
  const chosenOption = analysis.options.find((o) => o.suit === chosen)!;
  const loss = Math.round(analysis.best.score - chosenOption.score);
  return { analysis, chosenOption, correct: chosenOption.rank === 1 || loss < 15, loss };
}

/** 汇总一句话：这手牌各门的样子 */
export function suitSummary(hand: Counts): string {
  const parts: string[] = [];
  for (let s = 0; s < 3; s++) {
    const tiles: number[] = [];
    for (let r = 0; r < RANK_COUNT; r++) {
      const t = s * RANK_COUNT + r;
      for (let i = 0; i < hand[t]; i++) tiles.push(t);
    }
    parts.push(`${SUIT_NAMES[s]}：${tiles.length ? tilesName(tiles) : '无'}`);
  }
  void TILE_KINDS;
  return parts.join('　');
}
