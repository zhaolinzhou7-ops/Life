/**
 * 舍牌分析：把「打哪张好」拆成能讲出口的几个数。
 *
 * 排序标准（和真人高手的思路一致，从硬到软）：
 *   1. 规则允许吗（有缺门牌就只能打缺门，这是硬约束，不是选择）
 *   2. 打完之后向听数是多少（越小越好，这一条权重最大）
 *   3. 进张有多宽（同样向听，能摸的牌越多越好）
 *   4. 打出去有多危险（别人听牌时才开始起作用）
 *   5. 番型潜力（清一色/对对胡这种能翻倍的，值得牺牲一点点效率）
 *
 * 教学的关键是：**每一项都要留下可解释的痕迹**，不能只给一个总分。
 * 用户问「为什么」的时候，我们要能说出「因为打它之后进张从 12 张掉到 4 张」。
 */

import type { RuleConfig } from '../rules/config';
import {
  RANK_COUNT, TILE_KINDS, rankOf, suitOf, tileName,
  type Counts, type Meld, type TileId,
} from '../rules/tiles';
import { waitingTiles } from '../rules/win';
import {
  decompose, lackLeft, shantenWithLack, ukeire,
  type Block,
} from './shanten';
import { dangerOf, type OpponentRead } from './defense';

export interface DiscardOption {
  tile: TileId;
  name: string;
  /** 打出这张之后的向听数 */
  shanten: number;
  /** 打出这张之后的进张张数 */
  ukeire: number;
  ukeireTiles: TileId[];
  /** 打出后是否听牌 */
  ting: boolean;
  /** 听牌时听哪些张 */
  waits: TileId[];
  /** 听牌时最大番数 */
  tingFan: number;
  /** 危险度 0（绝对安全）~ 1（极可能点炮） */
  danger: number;
  dangerReason: string;
  /** 这张牌在手里的结构角色 */
  role: string;
  /** 综合评分，越大越该打 */
  score: number;
  /** 是缺门牌吗 */
  isLack: boolean;
}

export interface DiscardAnalysis {
  options: DiscardOption[];
  best: DiscardOption;
  /** 当前（打牌前）的向听数 */
  currentShanten: number;
  blocks: Block[];
  /** 手上还剩几张缺门牌 */
  lackLeft: number;
  /** 规则是否把选择限制死了（只能打缺门） */
  forced: boolean;
}

export interface EvalContext {
  cfg: RuleConfig;
  hand: Counts;
  melds: Meld[];
  lack: number;
  /** 看得见的牌（含自己手牌） */
  seen?: Counts;
  /** 对手的听牌情报，用于危险度 */
  reads?: OpponentRead[];
  /** 牌墙剩余，用于「该攻该守」 */
  wallLeft?: number;
  /** 合法的舍牌范围（引擎给），不传则按规则自行推算 */
  legal?: TileId[];
}

/** 这张牌在手牌结构里扮演什么角色，用来解释「为什么它可以走」 */
function roleOf(blocks: Block[], tile: TileId): string {
  const hit = blocks.find((b) => b.tiles.includes(tile));
  if (!hit) return '多余牌';
  const names: Record<string, string> = {
    shunzi: '已成顺子的一张',
    kezi: '已成刻子的一张',
    duizi: '对子的一张',
    liangmian: '两面搭子的一张',
    kanzhang: '坎张搭子的一张',
    bianzhang: '边张搭子的一张',
    gudan: '孤张',
  };
  return names[hit.kind] ?? '多余牌';
}

/**
 * 番型潜力：这手牌离清一色/对对胡还有多远。
 * 只做粗判断——教学上要的是「你这手有做大牌的苗头」，不是精确期望值。
 */
export function fanPotential(cfg: RuleConfig, hand: Counts, melds: Meld[], lack: number): { qingyise: number; duidui: number; qidui: number } {
  const bySuit = [0, 0, 0];
  for (let t = 0; t < TILE_KINDS; t++) bySuit[suitOf(t)] += hand[t];
  for (const m of melds) bySuit[suitOf(m.tile)] += m.kind === 'peng' ? 3 : 4;
  const total = bySuit.reduce((a, b) => a + b, 0) || 1;
  let qingyise = 0;
  for (let s = 0; s < 3; s++) {
    if (s === lack) continue;
    qingyise = Math.max(qingyise, bySuit[s] / total);
  }
  let pairs = 0;
  let triplets = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    if (hand[t] >= 2) pairs++;
    if (hand[t] >= 3) triplets++;
  }
  triplets += melds.length;
  const duidui = Math.min(1, (triplets * 2 + pairs) / 8);
  const qidui = melds.length === 0 ? Math.min(1, pairs / 7) : 0;
  return {
    qingyise: cfg.fan.table.some((f) => f.id === 'qingyise' && f.enabled) ? qingyise : 0,
    duidui: cfg.fan.table.some((f) => f.id === 'duidui' && f.enabled) ? duidui : 0,
    qidui: cfg.fan.table.some((f) => f.id === 'qidui' && f.enabled) ? qidui : 0,
  };
}

/** 逐张评估「打它会怎样」 */
export function analyzeDiscards(ctx: EvalContext): DiscardAnalysis {
  const { cfg, hand, melds, lack } = ctx;
  const allowSeven = cfg.win.sevenPairs && melds.length === 0;
  const meldCount = melds.length;
  const blocks = decompose(hand, lack);
  const currentShanten = shantenWithLack(hand, meldCount, allowSeven, lack);
  const left = lackLeft(hand, lack);

  // 合法舍牌：有缺门牌时只能打缺门，这是规则不是偏好
  let legal = ctx.legal;
  if (!legal) {
    const mustLack = cfg.lack.enabled && cfg.lack.discardLackFirst && lack >= 0 && left > 0;
    legal = [];
    for (let t = 0; t < TILE_KINDS; t++) {
      if (hand[t] === 0) continue;
      if (mustLack && suitOf(t) !== lack) continue;
      legal.push(t);
    }
  }

  const pot = fanPotential(cfg, hand, melds, lack);
  const work = hand.slice();
  const options: DiscardOption[] = [];

  for (const t of legal) {
    if (work[t] === 0) continue;
    work[t]--;
    const sh = shantenWithLack(work, meldCount, allowSeven, lack);
    const uk = ukeire(work, meldCount, allowSeven, lack, ctx.seen);
    const waits = sh === 0 ? waitingTiles(cfg, work, melds, lack) : [];
    let tingFan = 0;
    if (waits.length) {
      for (const w of waits) {
        work[w]++;
        // 只看牌型番，自摸/杠上花那些要碰运气的不算进去
        const s = evalFanQuick(cfg, work, melds, lack, w);
        work[w]--;
        tingFan = Math.max(tingFan, s);
      }
    }
    const dg = dangerOf(t, ctx.reads ?? [], ctx.seen);
    const isLack = lack >= 0 && suitOf(t) === lack;

    // 进张数按「听牌张」在听牌时更准：听牌之后关心的是听口宽度
    const width = sh === 0 ? waits.reduce((n, w) => n + Math.max(0, 4 - (ctx.seen ? ctx.seen[w] : work[w])), 0) : uk.total;

    // 综合评分。向听是主项，其余都是调味
    let score = -sh * 100 + width * 3;
    if (sh === 0) score += 60 + Math.min(40, tingFan * 4); // 能听牌绝对优先，番大再加一点
    score -= dg.value * dangerWeight(sh, ctx.wallLeft ?? 40) * 100;
    if (isLack) score += 500; // 缺门必须先走，给个压倒性权重
    // 番型潜力：打掉这张会不会破坏清一色/对对胡的苗头
    if (pot.qingyise > 0.6 && !isLack) {
      const mainSuit = mainSuitOf(hand, melds, lack);
      if (suitOf(t) !== mainSuit) score += 12;
      else score -= 10;
    }
    if (pot.duidui > 0.7 && hand[t] >= 2) score -= 12;

    options.push({
      tile: t,
      name: tileName(t),
      shanten: sh,
      ukeire: uk.total,
      ukeireTiles: uk.tiles,
      ting: sh === 0 && waits.length > 0,
      waits,
      tingFan,
      danger: dg.value,
      dangerReason: dg.reason,
      role: roleOf(blocks, t),
      score,
      isLack,
    });
    work[t]++;
  }

  options.sort((a, b) => b.score - a.score);
  return {
    options,
    best: options[0],
    currentShanten,
    blocks,
    lackLeft: left,
    forced: options.length <= 1,
  };
}

/** 危险度的权重：向听远、牌墙还多的时候先顾效率；快听牌了、牌墙快没了才开始怕点炮 */
function dangerWeight(sh: number, wallLeft: number): number {
  const late = wallLeft < 25 ? 1 : 0.45;
  if (sh <= 0) return 0.35 * late; // 自己都听牌了，通常追打
  if (sh === 1) return 0.7 * late;
  return 1.1 * late;
}

function mainSuitOf(hand: Counts, melds: Meld[], lack: number): number {
  const bySuit = [0, 0, 0];
  for (let t = 0; t < TILE_KINDS; t++) bySuit[suitOf(t)] += hand[t];
  for (const m of melds) bySuit[suitOf(m.tile)] += 3;
  let best = 0;
  let bestN = -1;
  for (let s = 0; s < 3; s++) {
    if (s === lack) continue;
    if (bySuit[s] > bestN) { bestN = bySuit[s]; best = s; }
  }
  return best;
}

/** 番数速算：只用来比较听牌价值，走 scoreWin 太慢也没必要 */
function evalFanQuick(cfg: RuleConfig, hand: Counts, melds: Meld[], _lack: number, _win: TileId): number {
  let fan = cfg.fan.base;
  const suits = new Set<number>();
  for (let t = 0; t < TILE_KINDS; t++) if (hand[t] > 0) suits.add(suitOf(t));
  for (const m of melds) suits.add(suitOf(m.tile));
  const rule = (id: string) => cfg.fan.table.find((f) => f.id === id && f.enabled)?.value ?? 1;
  if (suits.size === 1) fan *= rule('qingyise');
  let pairs = 0;
  let allTriplet = true;
  for (let t = 0; t < TILE_KINDS; t++) {
    const n = hand[t];
    if (n === 0) continue;
    if (n === 2) pairs++;
    else if (n !== 3) allTriplet = false;
  }
  if (melds.length === 0 && pairs === 7) fan *= rule('qidui');
  else if (allTriplet && pairs === 1) fan *= rule('duidui');
  return Math.min(fan, cfg.fan.cap);
}

/**
 * 两个选择差多少：教练用它决定「要不要开口」。
 * 差一点点就别啰嗦，差很多才值得打断用户。
 */
export function lossOf(best: DiscardOption, chosen: DiscardOption): number {
  if (best.tile === chosen.tile) return 0;
  let loss = (best.shanten < chosen.shanten ? 1 : 0) * 60;
  loss += Math.max(0, best.ukeire - chosen.ukeire) * 2.5;
  if (best.ting && !chosen.ting) loss += 45;
  loss += Math.max(0, chosen.danger - best.danger) * 40;
  return Math.round(loss);
}

/** 差距分级，决定教练的语气 */
export type Severity = 'ok' | 'minor' | 'major' | 'blunder';

export function severityOf(loss: number): Severity {
  if (loss < 8) return 'ok';
  if (loss < 25) return 'minor';
  if (loss < 55) return 'major';
  return 'blunder';
}

export const SEVERITY_TEXT: Record<Severity, string> = {
  ok: '这步没问题',
  minor: '有更好的选择',
  major: '这步亏了',
  blunder: '这步是明显失误',
};

/** 一门牌的「连不连得起来」，换三张和定缺都要用 */
export function suitCohesion(c: Counts, suit: number): { count: number; melds: number; partials: number; isolated: number } {
  const off = suit * RANK_COUNT;
  let count = 0;
  for (let r = 0; r < RANK_COUNT; r++) count += c[off + r];
  const one: Counts = new Array(TILE_KINDS).fill(0);
  for (let r = 0; r < RANK_COUNT; r++) one[off + r] = c[off + r];
  const blocks = decompose(one);
  return {
    count,
    melds: blocks.filter((b) => b.kind === 'shunzi' || b.kind === 'kezi').length,
    partials: blocks.filter((b) => ['duizi', 'liangmian', 'kanzhang', 'bianzhang'].includes(b.kind)).length,
    isolated: blocks.filter((b) => b.kind === 'gudan').length,
  };
}

/** 牌的「中张程度」：45 最灵活，19 最死。解说里用得上 */
export const centrality = (t: TileId): number => 1 - Math.abs(5 - rankOf(t)) / 4;
