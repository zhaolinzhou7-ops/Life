/** 四川麻将（血战到底）规则引擎：牌、胡牌判定、听牌、番型计分 */

/** 牌编码：suit 0=万 1=条 2=筒，rank 1-9；id = suit*9 + rank-1 (0..26)，共 108 张 */
export type TileId = number;
export const SUITS = ['万', '条', '筒'] as const;
export const suitOf = (t: TileId) => Math.floor(t / 9);
export const rankOf = (t: TileId) => (t % 9) + 1;
export const tileName = (t: TileId) => `${rankOf(t)}${SUITS[suitOf(t)]}`;

/** 洗好的一副牌（108 张） */
export function freshWall(): TileId[] {
  const wall: TileId[] = [];
  for (let t = 0; t < 27; t++) for (let i = 0; i < 4; i++) wall.push(t);
  for (let i = wall.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [wall[i], wall[j]] = [wall[j], wall[i]];
  }
  return wall;
}

export type Counts = number[]; // 长度 27

export function toCounts(tiles: TileId[]): Counts {
  const c = new Array(27).fill(0);
  for (const t of tiles) c[t]++;
  return c;
}

/** 4 面子 + 1 对（标准胡型），递归消去 */
function canMeldAll(c: Counts, start = 0): boolean {
  let i = start;
  while (i < 27 && c[i] === 0) i++;
  if (i >= 27) return true;
  // 刻子
  if (c[i] >= 3) {
    c[i] -= 3;
    if (canMeldAll(c, i)) {
      c[i] += 3;
      return true;
    }
    c[i] += 3;
  }
  // 顺子（同花色内）
  const r = i % 9;
  if (r <= 6 && c[i + 1] > 0 && c[i + 2] > 0) {
    c[i]--;
    c[i + 1]--;
    c[i + 2]--;
    if (canMeldAll(c, i)) {
      c[i]++;
      c[i + 1]++;
      c[i + 2]++;
      return true;
    }
    c[i]++;
    c[i + 1]++;
    c[i + 2]++;
  }
  return false;
}

/** 标准胡：手牌（含刚摸/胡的那张，3n+2 张）能否胡 */
export function canWinStandard(c: Counts): boolean {
  for (let p = 0; p < 27; p++) {
    if (c[p] >= 2) {
      c[p] -= 2;
      const ok = canMeldAll(c.slice());
      c[p] += 2;
      if (ok) return true;
    }
  }
  return false;
}

/** 七对（含龙七对：4 张算两对）。要求手牌恰 14 张且无碰杠 */
export function canWinSevenPairs(c: Counts): boolean {
  let pairs = 0;
  for (let i = 0; i < 27; i++) {
    if (c[i] % 2 !== 0) return false;
    pairs += c[i] / 2;
  }
  return pairs === 7;
}

export function canWin(c: Counts, concealedOnly: boolean): boolean {
  const total = c.reduce((a, b) => a + b, 0);
  if (total % 3 === 2 && canWinStandard(c)) return true;
  if (concealedOnly && total === 14 && canWinSevenPairs(c)) return true;
  return false;
}

/** 缺门检查：胡牌时不能持有缺门花色 */
export function hasSuit(c: Counts, suit: number): boolean {
  for (let r = 0; r < 9; r++) if (c[suit * 9 + r] > 0) return true;
  return false;
}

/** 听牌：打出后（或当前 3n+1 手牌）加哪张能胡 */
export function waitingTiles(c: Counts, noMelds: boolean, lack: number): TileId[] {
  const out: TileId[] = [];
  if (hasSuit(c, lack)) return out; // 有缺门不可能胡
  for (let t = 0; t < 27; t++) {
    if (c[t] >= 4 || suitOf(t) === lack) continue;
    c[t]++;
    if (canWin(c, noMelds)) out.push(t);
    c[t]--;
  }
  return out;
}

export interface Meld {
  kind: 'peng' | 'gang' | 'angang' | 'bugang';
  tile: TileId;
}

/** 番型计算（倍数制，封顶 64） */
export function scoreFan(
  hand: Counts, // 含胡的那张
  melds: Meld[],
  opts: { zimo: boolean; gangFlower: boolean; gangPao: boolean; qiangGang: boolean },
): { fan: number; names: string[] } {
  let fan = 1;
  const names: string[] = [];
  const total = hand.reduce((a, b) => a + b, 0);
  const seven = melds.length === 0 && total === 14 && canWinSevenPairs(hand);

  // 清一色
  const suits = new Set<number>();
  for (let t = 0; t < 27; t++) if (hand[t] > 0) suits.add(suitOf(t));
  for (const m of melds) suits.add(suitOf(m.tile));
  if (suits.size === 1) {
    fan *= 4;
    names.push('清一色');
  }

  if (seven) {
    // 龙七对：含 4 张相同
    let dragon = false;
    for (let t = 0; t < 27; t++) if (hand[t] === 4) dragon = true;
    fan *= dragon ? 8 : 4;
    names.push(dragon ? '龙七对' : '七对');
  } else {
    // 对对胡：无顺子（全部刻子 + 将）
    if (isPengPengHu(hand, melds)) {
      fan *= 2;
      names.push('对对胡');
    }
    // 金钩钓：全靠碰杠，手里单钓一张
    if (melds.length === 4) {
      fan *= 4;
      names.push('金钩钓');
    }
  }

  // 根：每凑齐 4 张相同（含杠）×2；龙七对的 4 张已计入番型不重复算根
  let roots = 0;
  for (let t = 0; t < 27; t++) {
    let n = hand[t];
    for (const m of melds) {
      if (m.tile === t) n += m.kind === 'peng' ? 3 : 4;
    }
    if (n === 4 && !(seven && hand[t] === 4)) roots++;
  }
  if (roots > 0) {
    fan *= 2 ** roots;
    names.push(`根×${roots}`);
  }

  if (opts.zimo) {
    fan *= 2;
    names.push('自摸');
  }
  if (opts.gangFlower) {
    fan *= 2;
    names.push('杠上花');
  }
  if (opts.gangPao) {
    fan *= 2;
    names.push('杠上炮');
  }
  if (opts.qiangGang) {
    fan *= 2;
    names.push('抢杠胡');
  }
  if (names.length === 0) names.push('平胡');
  return { fan: Math.min(fan, 64), names };
}

/** 是否对对胡：手牌部分能分成刻子×n + 一对 */
function isPengPengHu(hand: Counts, melds: Meld[]): boolean {
  // 副露必须全是碰/杠（本就无吃），手牌需全为刻子+一对
  void melds;
  const c = hand.slice();
  let pair = 0;
  for (let t = 0; t < 27; t++) {
    if (c[t] === 0) continue;
    if (c[t] === 2) pair++;
    else if (c[t] !== 3 && c[t] !== 4) return false; // 4 张在手（未杠）当刻子+单张，不算
    if (c[t] === 4) return false;
  }
  return pair === 1;
}

// ==================== 四川麻将专业玩法 ====================

/** 换三张方向：0=对家 1=下家(顺时针) 2=上家(逆时针) */
export type SwapDir = 0 | 1 | 2;

/** 为某家挑选换三张的牌：优先挑张数最少花色里最没用的三张 */
export function pickSwapThree(c: Counts): TileId[] {
  // 统计各花色张数，选 >=3 张且总数最少的花色
  const suitCount = [0, 0, 0];
  for (let t = 0; t < 27; t++) suitCount[suitOf(t)] += c[t];
  let bestSuit = -1;
  let bestN = Infinity;
  for (let s = 0; s < 3; s++) {
    if (suitCount[s] >= 3 && suitCount[s] < bestN) {
      bestN = suitCount[s];
      bestSuit = s;
    }
  }
  if (bestSuit < 0) {
    // 没有任何花色够 3 张（极罕见）：随便挑三张
    const out: TileId[] = [];
    for (let t = 0; t < 27 && out.length < 3; t++) for (let i = 0; i < c[t] && out.length < 3; i++) out.push(t);
    return out;
  }
  // 该花色里挑最孤立的三张（无对子、无邻牌优先）
  const cand: { t: TileId; score: number }[] = [];
  for (let r = 0; r < 9; r++) {
    const t = bestSuit * 9 + r;
    if (c[t] === 0) continue;
    const at = (rr: number) => (rr >= 0 && rr <= 8 ? c[bestSuit * 9 + rr] : 0);
    const score = c[t] * 5 + (at(r - 1) + at(r + 1)) * 3 + (at(r - 2) + at(r + 2));
    for (let i = 0; i < c[t]; i++) cand.push({ t, score });
  }
  cand.sort((a, b) => a.score - b.score);
  return cand.slice(0, 3).map((x) => x.t);
}

/** 是否花猪：流局时手上仍有缺门牌 */
export function isHuaZhu(c: Counts, lack: number): boolean {
  return hasSuit(c, lack);
}

/** 番数封顶 */
export const FAN_CAP = 64;

export interface SettleRow {
  seat: number;
  /** 本局净得分变化 */
  delta: number;
  reasons: string[];
}

/**
 * 流局结算（查大叔 / 查花猪）：
 * - 花猪（手上还有缺门牌）：赔给每个听牌家 该家最大可能番数（此处按固定重罚），且不能收别人的钱
 * - 未听牌（大叔）：赔给每个听牌家 其番数
 * - 听牌家之间不结算
 */
export function settleDraw(
  hands: Counts[],
  lacks: number[],
  won: boolean[],
  tingFan: number[],
): SettleRow[] {
  const rows: SettleRow[] = hands.map((_, i) => ({ seat: i, delta: 0, reasons: [] }));
  const huazhu = hands.map((h, i) => !won[i] && isHuaZhu(h, lacks[i]));
  const ting = hands.map((_, i) => !won[i] && !huazhu[i] && tingFan[i] > 0);

  for (let i = 0; i < hands.length; i++) {
    if (won[i]) continue;
    // 花猪重罚
    if (huazhu[i]) {
      for (let j = 0; j < hands.length; j++) {
        if (j === i || won[j]) continue;
        const pay = Math.min(FAN_CAP, 16);
        rows[i].delta -= pay;
        rows[j].delta += pay;
      }
      rows[i].reasons.push('花猪');
      continue;
    }
    // 未听牌（大叔）赔听牌家
    if (!ting[i]) {
      for (let j = 0; j < hands.length; j++) {
        if (j === i || won[j] || !ting[j] || huazhu[j]) continue;
        const pay = Math.min(FAN_CAP, tingFan[j]);
        rows[i].delta -= pay;
        rows[j].delta += pay;
      }
      rows[i].reasons.push('未听牌');
    } else {
      rows[i].reasons.push('已听牌');
    }
  }
  return rows;
}

/** 估算某手牌听牌时的最大番数（用于查大叔赔付） */
export function bestTingFan(
  c: Counts,
  melds: Meld[],
  lack: number,
  scoreFn: (hand: Counts, melds: Meld[]) => number,
): number {
  if (hasSuit(c, lack)) return 0;
  let best = 0;
  for (let t = 0; t < 27; t++) {
    if (suitOf(t) === lack || c[t] >= 4) continue;
    c[t]++;
    if (canWin(c, melds.length === 0)) {
      best = Math.max(best, scoreFn(c, melds));
    }
    c[t]--;
  }
  return best;
}
