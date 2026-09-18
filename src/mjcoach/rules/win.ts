/**
 * 胡牌判定与番型计分。
 *
 * 判定（能不能胡）是死规则，写在代码里；
 * 算分（算几番、哪些番型开启）全部走 RuleConfig，一个数字都不许写死。
 * 两者分开是有原因的：「4 面子 + 1 将」全国一致，而「清一色几倍」各地不同。
 */

import {
  TILE_KINDS,
  hasSuit,
  suitOf,
  type Counts,
  type Meld,
  type TileId,
} from './tiles';
import { fanRule, type FanId, type RuleConfig } from './config';

// ==================== 基础牌型判定 ====================

/** 能否全部拆成面子（刻子/顺子），counts 必须是 3n 张 */
export function canFormMelds(c: Counts, start = 0): boolean {
  let i = start;
  while (i < TILE_KINDS && c[i] === 0) i++;
  if (i >= TILE_KINDS) return true;
  // 刻子
  if (c[i] >= 3) {
    c[i] -= 3;
    const ok = canFormMelds(c, i);
    c[i] += 3;
    if (ok) return true;
  }
  // 顺子（不能跨花色，所以要求 rank <= 7）
  const r = i % 9;
  if (r <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--; c[i + 1]--; c[i + 2]--;
    const ok = canFormMelds(c, i);
    c[i]++; c[i + 1]++; c[i + 2]++;
    if (ok) return true;
  }
  return false;
}

/** 标准型：4 面子 + 1 将（手牌 3n+2 张，n 由已副露数决定） */
export function isStandardWin(c: Counts): boolean {
  const work = c.slice();
  for (let p = 0; p < TILE_KINDS; p++) {
    if (work[p] >= 2) {
      work[p] -= 2;
      const ok = canFormMelds(work.slice());
      work[p] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 七对：14 张全是对子（四张算两对） */
export function isSevenPairs(c: Counts): boolean {
  let pairs = 0;
  for (let i = 0; i < TILE_KINDS; i++) {
    if (c[i] % 2 !== 0) return false;
    pairs += c[i] / 2;
  }
  return pairs === 7;
}

/** 对对胡：手牌部分全刻子 + 一对（四川没有吃，副露天然都是刻/杠） */
export function isAllTriplets(c: Counts): boolean {
  let pair = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    const n = c[t];
    if (n === 0) continue;
    if (n === 2) pair++;
    else if (n === 4) {
      // 手里四张没杠：只能当刻子 + 一张单牌，凑不成对对胡
      return false;
    } else if (n !== 3) return false;
  }
  return pair === 1;
}

// ==================== 胡牌资格 ====================

export interface WinContext {
  /** 手牌，**含**胡的那张 */
  hand: Counts;
  melds: Meld[];
  /** 缺门花色，-1 表示还没定缺 */
  lack: number;
  /** 胡的那张牌 */
  winTile: TileId;
  zimo: boolean;
  /** 杠后补牌自摸 */
  gangFlower?: boolean;
  /** 杠后打出的牌被胡 */
  gangPao?: boolean;
  qiangGang?: boolean;
  /** 牌墙最后一张 */
  haidi?: boolean;
  /** 第一巡（天胡/地胡用） */
  firstRound?: boolean;
  isDealer?: boolean;
}

/**
 * 牌型上能不能胡（先不管番数够不够）。
 * 缺门只要手上还有一张就绝对不能胡——这是四川麻将最硬的一条。
 */
export function canWinShape(cfg: RuleConfig, hand: Counts, melds: Meld[], lack: number): boolean {
  if (cfg.lack.enabled && cfg.lack.winRequiresNoLack && lack >= 0 && hasSuit(hand, lack)) return false;
  const total = hand.reduce((a, b) => a + b, 0);
  if (cfg.win.standard && total % 3 === 2 && isStandardWin(hand)) return true;
  // 七对必须门清：碰过、杠过就不算了
  if (cfg.win.sevenPairs && melds.length === 0 && total === 14 && isSevenPairs(hand)) return true;
  return false;
}

// ==================== 番型检出 ====================

export interface FanDetail {
  id: FanId;
  name: string;
  desc: string;
  /** 本次计了几倍（multiply）或几番（addFan） */
  value: number;
  /** 根这种可以出现多次的，记次数 */
  times: number;
}

export interface WinScore {
  /** 最终倍数（已封顶） */
  fan: number;
  details: FanDetail[];
  names: string[];
  /** 没被规则开启、但牌型上确实成立的番型，教学面板用来说明「这套规则不算这个」 */
  suppressed: string[];
}

/** 算这手牌成立了哪些番型（不看配置开关，只看牌型） */
function detectFans(ctx: WinContext): Map<FanId, number> {
  const got = new Map<FanId, number>();
  const { hand, melds } = ctx;
  const total = hand.reduce((a, b) => a + b, 0);
  const concealed = melds.length === 0;
  const seven = concealed && total === 14 && isSevenPairs(hand);

  // 清一色：手牌 + 副露只有一门
  const suits = new Set<number>();
  for (let t = 0; t < TILE_KINDS; t++) if (hand[t] > 0) suits.add(suitOf(t));
  for (const m of melds) suits.add(suitOf(m.tile));
  if (suits.size === 1) got.set('qingyise', 1);

  if (seven) {
    let quads = 0;
    for (let t = 0; t < TILE_KINDS; t++) if (hand[t] === 4) quads++;
    if (quads >= 2) got.set('shuanglong', 1);
    else if (quads === 1) got.set('longqidui', 1);
    got.set('qidui', 1);
  } else {
    if (isAllTriplets(hand)) got.set('duidui', 1);
    // 金钩钓：四副露 + 手里只剩将牌那两张
    if (melds.length === 4 && total === 2) got.set('jingoudiao', 1);
  }

  // 门清：没有碰、没有明杠/补杠（暗杠不破门清）
  if (melds.every((m) => m.kind === 'angang')) got.set('menqing', 1);

  // 根：四张相同（手牌 + 副露合计）。龙七对/双龙七对里的那几张不重复算，
  // 这条在 config.DIVERGENCES 里有登记：各平台确实有算的，我们选不算。
  let roots = 0;
  for (let t = 0; t < TILE_KINDS; t++) {
    let n = hand[t];
    for (const m of melds) if (m.tile === t) n += m.kind === 'peng' ? 3 : 4;
    if (n < 4) continue;
    if (seven && hand[t] === 4) continue; // 已计入龙七对
    roots++;
  }
  if (roots > 0) got.set('gen', roots);

  if (ctx.zimo) got.set('zimo', 1);
  if (ctx.gangFlower) got.set('gangshanghua', 1);
  if (ctx.gangPao) got.set('gangshangpao', 1);
  if (ctx.qiangGang) got.set('qianggang', 1);
  if (ctx.haidi) got.set(ctx.zimo ? 'haidilao' : 'haidipao', 1);
  if (ctx.firstRound) got.set(ctx.isDealer ? 'tianhu' : 'dihu', 1);

  // 平胡：一个「牌型类」番型都没有时才算。放最后判断
  const shapeFans: FanId[] = ['duidui', 'qingyise', 'qidui', 'longqidui', 'shuanglong', 'jingoudiao'];
  if (!shapeFans.some((f) => got.has(f))) got.set('pinghu', 1);
  return got;
}

/** 按当前规则算番。番型开关、倍数、互斥、封顶全部来自 cfg */
export function scoreWin(cfg: RuleConfig, ctx: WinContext): WinScore {
  const got = detectFans(ctx);

  // 互斥：成立了 a 就划掉 b
  for (const [a, b] of cfg.fan.exclusions) if (got.has(a)) got.delete(b);

  const details: FanDetail[] = [];
  const suppressed: string[] = [];
  let mult = cfg.fan.base;
  let addFan = 0;

  for (const [id, times] of got) {
    const rule = fanRule(cfg, id);
    if (!rule) {
      const raw = cfg.fan.table.find((f) => f.id === id);
      if (raw) suppressed.push(raw.name);
      continue;
    }
    if (cfg.fan.scoring === 'multiply') mult *= Math.pow(rule.value, times);
    else addFan += rule.value * times;
    details.push({ id, name: rule.name, desc: rule.desc, value: rule.value, times });
  }

  let fan = cfg.fan.scoring === 'multiply' ? mult : cfg.fan.base * Math.pow(2, addFan);
  fan = Math.min(fan, cfg.fan.cap);

  // 展示顺序：牌型番在前，自摸/杠上花这类动作番在后，根最后
  const order: FanId[] = [
    'shuanglong', 'longqidui', 'qidui', 'qingyise', 'jingoudiao', 'duidui', 'pinghu',
    'menqing', 'tianhu', 'dihu', 'zimo', 'gangshanghua', 'gangshangpao', 'qianggang',
    'haidilao', 'haidipao', 'gen',
  ];
  details.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));

  return {
    fan,
    details,
    names: details.map((d) => (d.id === 'gen' && d.times > 1 ? `${d.name}×${d.times}` : d.name)),
    suppressed,
  };
}

/** 牌型成立 + 番数够 = 真的能胡 */
export function evaluateWin(cfg: RuleConfig, ctx: WinContext): WinScore | null {
  if (!canWinShape(cfg, ctx.hand, ctx.melds, ctx.lack)) return null;
  if (cfg.win.selfDrawOnly && !ctx.zimo) return null;
  const s = scoreWin(cfg, ctx);
  if (s.fan < cfg.win.minFan) return null;
  return s;
}

// ==================== 听牌 ====================

/**
 * 当前手牌（3n+1 张）听哪些张。
 * 注意要带上番数门槛：有些规则 2 番起，那么只能胡平胡的牌不算听牌。
 */
export function waitingTiles(
  cfg: RuleConfig,
  hand: Counts,
  melds: Meld[],
  lack: number,
  opts: { zimo?: boolean } = {},
): TileId[] {
  const out: TileId[] = [];
  if (cfg.lack.enabled && cfg.lack.winRequiresNoLack && lack >= 0 && hasSuit(hand, lack)) return out;
  const work = hand.slice();
  for (let t = 0; t < TILE_KINDS; t++) {
    if (work[t] >= 4) continue;
    if (lack >= 0 && cfg.lack.winRequiresNoLack && suitOf(t) === lack) continue;
    work[t]++;
    const ok = evaluateWin(cfg, {
      hand: work, melds, lack, winTile: t, zimo: opts.zimo ?? false,
    });
    work[t]--;
    if (ok) out.push(t);
  }
  return out;
}

export const isTing = (cfg: RuleConfig, hand: Counts, melds: Meld[], lack: number): boolean =>
  waitingTiles(cfg, hand, melds, lack).length > 0;

/**
 * 这手牌听牌时最大能胡几番（查大叔要按这个赔）。
 * 只看牌型番，不含自摸/杠上花这类要碰运气的。
 */
export function bestTingFan(cfg: RuleConfig, hand: Counts, melds: Meld[], lack: number): number {
  let best = 0;
  const work = hand.slice();
  for (const t of waitingTiles(cfg, hand, melds, lack)) {
    work[t]++;
    const s = scoreWin(cfg, { hand: work, melds, lack, winTile: t, zimo: false });
    work[t]--;
    best = Math.max(best, s.fan);
  }
  return best;
}
