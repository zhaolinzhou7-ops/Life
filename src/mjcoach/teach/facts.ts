/**
 * 结构化分析结果（Structured Facts）。
 *
 * 这是整个教学架构里最重要的一道闸门：
 *
 *   真实牌局 → 规则引擎 → 局面分析 → 牌效率/概率/合法动作
 *            → **结构化分析结果（本文件）** → AI 教学层 → 自然语言
 *
 * 教学层（不管是本地模板还是真的语言模型）**只能看到这个对象**，
 * 看不到引擎内部，也看不到别人的手牌。这样做有两个好处：
 *   1. AI 不可能「脑补」牌局——它手上只有算好的事实，编不出别的
 *   2. 解释一定和真实牌局一致，因为数字都是规则引擎算出来的
 *
 * 另外每条事实都带 `known` 标记。问到没有的信息时，教学层必须回答
 * 「当前信息不足，无法确定」，而不是猜一个。
 */

import type { MahjongEngine } from '../rules/engine';
import {
  SUIT_NAMES, tileName, tilesName,
  type Counts, type Meld, type TileId,
} from '../rules/tiles';
import { analyzeDiscards, fanPotential, lossOf, severityOf, type DiscardAnalysis, type DiscardOption, type Severity } from '../analysis/efficiency';
import { describeStructure, decompose, shantenWithLack, type Block } from '../analysis/shanten';
import { readOpponent, stanceAdvice, type OpponentRead } from '../analysis/defense';
import { analyzeLack, type LackAnalysis } from '../analysis/dingque';
import { analyzeSwap, type SwapAnalysis } from '../analysis/swap';

export interface HeroFacts {
  seat: number;
  handText: string;
  hand: Counts;
  melds: Meld[];
  meldsText: string;
  lack: number;
  lackName: string;
  lackLeft: number;
  shanten: number;
  /** 向听数的白话说法 */
  shantenText: string;
  ting: boolean;
  waits: TileId[];
  waitsText: string;
  blocks: Block[];
  structureText: string;
  score: number;
  won: boolean;
  fanPotential: { qingyise: number; duidui: number; qidui: number };
}

export interface OpponentFacts {
  seat: number;
  name: string;
  discardsText: string;
  lackName: string;
  meldCount: number;
  tingGuess: boolean;
  tingConfidence: number;
  outOfPlay: boolean;
  score: number;
}

export interface SituationFacts {
  /** 事实是在哪一刻拍下来的 */
  phase: string;
  turnIndex: number;
  wallLeft: number;
  configName: string;
  hero: HeroFacts;
  opponents: OpponentFacts[];
  /** 攻守建议 */
  stance: { stance: 'attack' | 'balance' | 'defend'; text: string };
  /** 舍牌分析（turn 阶段才有） */
  discards: DiscardAnalysis | null;
  /** 定缺分析（lack 阶段才有） */
  lackAnalysis: LackAnalysis | null;
  /** 换三张分析（swap 阶段才有） */
  swapAnalysis: SwapAnalysis | null;
  reads: OpponentRead[];
}

const SEAT_LABEL = ['你', '下家', '对家', '上家'];

export function seatName(heroSeat: number, seat: number, players = 4): string {
  return SEAT_LABEL[(seat - heroSeat + players) % players];
}

/** 向听数说人话 */
export function shantenText(sh: number, ting: boolean): string {
  if (sh < 0) return '已经成胡牌了';
  if (ting || sh === 0) return '已经听牌';
  if (sh === 1) return '还差 1 张就听牌（一向听）';
  return `还差 ${sh} 张才听牌`;
}

/**
 * 从引擎抽取事实。
 * 只用玩家视角看得见的信息：自己的手牌、所有人的弃牌和副露、牌墙张数。
 * 别人的手牌一个字都不带——教练不能作弊，不然教出来的判断在真实对局里用不了。
 */
export function extractFacts(engine: MahjongEngine, heroSeat: number): SituationFacts {
  const cfg = engine.cfg;
  const p = engine.players[heroSeat];
  const seen = engine.seenBy(heroSeat);
  const round = Math.max(...engine.players.map((q) => q.discards.length));

  const reads: OpponentRead[] = engine.players
    .filter((q) => q.seat !== heroSeat)
    .map((q) =>
      readOpponent({
        seat: q.seat,
        discards: q.discards,
        lack: q.lack,
        meldCount: q.melds.length,
        outOfPlay: q.outOfPlay,
        round,
      }),
    );

  const allowSeven = cfg.win.sevenPairs && p.melds.length === 0;
  const sh = shantenWithLack(p.hand, p.melds.length, allowSeven, p.lack);
  const waits = engine.waits(heroSeat);
  const blocks = decompose(p.hand, p.lack);
  let lackLeft = 0;
  if (p.lack >= 0) for (let r = 0; r < 9; r++) lackLeft += p.hand[p.lack * 9 + r];

  const handTiles: TileId[] = [];
  for (let t = 0; t < 27; t++) for (let i = 0; i < p.hand[t]; i++) handTiles.push(t);

  const hero: HeroFacts = {
    seat: heroSeat,
    hand: p.hand.slice(),
    handText: tilesName(handTiles),
    melds: p.melds,
    meldsText: p.melds.length
      ? p.melds.map((m) => `${{ peng: '碰', gang: '明杠', angang: '暗杠', bugang: '补杠' }[m.kind]}${tileName(m.tile)}`).join('、')
      : '没有碰杠',
    lack: p.lack,
    lackName: p.lack >= 0 ? SUIT_NAMES[p.lack] : '还没定缺',
    lackLeft,
    shanten: sh,
    shantenText: shantenText(sh, waits.length > 0),
    ting: waits.length > 0,
    waits,
    waitsText: waits.length ? tilesName(waits) : '还没听牌',
    blocks,
    structureText: describeStructure(blocks),
    score: p.score,
    won: p.won,
    fanPotential: fanPotential(cfg, p.hand, p.melds, p.lack),
  };

  const opponents: OpponentFacts[] = engine.players
    .filter((q) => q.seat !== heroSeat)
    .map((q) => {
      const r = reads.find((x) => x.seat === q.seat)!;
      return {
        seat: q.seat,
        name: seatName(heroSeat, q.seat, engine.players.length),
        discardsText: q.discards.length ? tilesName(q.discards) : '还没打过牌',
        lackName: q.lack >= 0 ? SUIT_NAMES[q.lack] : '未知',
        meldCount: q.melds.length,
        tingGuess: r.ting,
        tingConfidence: r.tingConfidence,
        outOfPlay: q.outOfPlay,
        score: q.score,
      };
    });

  const isTurn = engine.phase === 'turn' && engine.turn === heroSeat;
  const discards = isTurn
    ? analyzeDiscards({
        cfg, hand: p.hand, melds: p.melds, lack: p.lack,
        seen, reads, wallLeft: engine.wallLeft,
        legal: engine.legalDiscards(heroSeat),
      })
    : null;

  return {
    phase: engine.phase,
    turnIndex: engine.turnIndex,
    wallLeft: engine.wallLeft,
    configName: cfg.name,
    hero,
    opponents,
    stance: stanceAdvice(sh, reads, engine.wallLeft),
    discards,
    lackAnalysis: engine.phase === 'lack' ? analyzeLack(cfg, p.hand, p.melds, seen) : null,
    swapAnalysis: engine.phase === 'swap' ? analyzeSwap(cfg, p.hand, seen) : null,
    reads,
  };
}

/** 一次具体决策的对照事实：你选了什么 vs 最优是什么 */
export interface DecisionFacts {
  kind: 'discard' | 'lack' | 'swap' | 'peng' | 'gang';
  chosenText: string;
  bestText: string;
  same: boolean;
  loss: number;
  severity: Severity;
  chosen?: DiscardOption;
  best?: DiscardOption;
  /** 具体差在哪，每条都是一个可以直接念出来的事实 */
  diffs: string[];
}

export function compareDiscard(analysis: DiscardAnalysis, chosenTile: TileId): DecisionFacts {
  const chosen = analysis.options.find((o) => o.tile === chosenTile) ?? analysis.best;
  const best = analysis.best;
  const loss = lossOf(best, chosen);
  const diffs: string[] = [];

  if (best.tile !== chosen.tile) {
    if (best.shanten < chosen.shanten) {
      diffs.push(`打 ${best.name} 之后${shantenText(best.shanten, best.ting)}，打 ${chosen.name} 则${shantenText(chosen.shanten, chosen.ting)}`);
    }
    if (best.ting && !chosen.ting) {
      diffs.push(`打 ${best.name} 直接听牌，听 ${tilesName(best.waits)}`);
    }
    if (best.ukeire > chosen.ukeire) {
      diffs.push(`进张：${best.name} 能摸 ${best.ukeire} 张有效牌，${chosen.name} 只有 ${chosen.ukeire} 张`);
    }
    if (chosen.danger > best.danger + 0.15) {
      diffs.push(`危险度：${chosen.name} ${chosen.dangerReason}，${best.name} 安全一些`);
    }
    if (chosen.role !== '多余牌' && chosen.role !== '孤张') {
      diffs.push(`${chosen.name} 在你手里是${chosen.role}，打掉它等于自己拆自己的牌`);
    }
  }

  return {
    kind: 'discard',
    chosenText: chosen.name,
    bestText: best.name,
    same: best.tile === chosen.tile,
    loss,
    severity: severityOf(loss),
    chosen,
    best,
    diffs,
  };
}

export function compareLack(analysis: LackAnalysis, chosen: number): DecisionFacts {
  const c = analysis.options.find((o) => o.suit === chosen)!;
  const b = analysis.best;
  const loss = Math.round(b.score - c.score);
  const diffs: string[] = [];
  if (c.suit !== b.suit) {
    diffs.push(`缺${b.name}之后${shantenText(b.shantenAfter, b.shantenAfter === 0)}，缺${c.name}则${shantenText(c.shantenAfter, c.shantenAfter === 0)}`);
    if (c.melds > b.melds) diffs.push(`${c.name}里已经有 ${c.melds} 副成形的面子，缺掉等于自己拆牌`);
    if (b.isolated > c.isolated) diffs.push(`${b.name}里有 ${b.isolated} 张孤张，打出去一点不可惜`);
    diffs.push(`进张：缺${b.name}后能摸 ${b.ukeireAfter} 张，缺${c.name}后 ${c.ukeireAfter} 张`);
  }
  return {
    kind: 'lack',
    chosenText: `缺${c.name}`,
    bestText: `缺${b.name}`,
    same: c.suit === b.suit,
    loss,
    severity: severityOf(loss),
    diffs,
  };
}

export function compareSwap(analysis: SwapAnalysis, chosen: TileId[]): DecisionFacts {
  const key = [...chosen].sort((a, b) => a - b).join(',');
  const c = analysis.options.find((o) => [...o.tiles].sort((a, b) => a - b).join(',') === key) ?? analysis.options[analysis.options.length - 1];
  const b = analysis.best;
  const loss = Math.round(b.score - c.score);
  const diffs: string[] = [];
  if (c !== b) {
    if (c.brokenMelds > 0) diffs.push(`换出 ${c.text} 会拆掉 ${c.brokenMelds} 副已经成形的面子`);
    else if (c.brokenPartials > b.brokenPartials) diffs.push(`换出 ${c.text} 会拆掉 ${c.brokenPartials} 个搭子`);
    if (b.isolatedCount > c.isolatedCount) diffs.push(`${b.text} 这三张在手里是孤张，换出去不影响牌型`);
    diffs.push(`换完之后：${b.text} 剩下的牌${shantenText(b.shantenAfter, false)}，${c.text} 则${shantenText(c.shantenAfter, false)}`);
  }
  return {
    kind: 'swap',
    chosenText: c.text,
    bestText: b.text,
    same: c === b || c.rank === 1,
    loss,
    severity: severityOf(loss),
    diffs,
  };
}
