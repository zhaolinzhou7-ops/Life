/**
 * 流局结算：查大叔（查叫）与查花猪。
 *
 * 四川麻将真正的钱多半不是胡出来的，是流局这一下罚出来的——
 * 新手最常见的惨案就是「打到最后手上还留着缺门牌」，一把赔光。
 * 所以这一段必须算准，而且要能把理由列清楚给教练用。
 */

import { hasSuit, type Counts, type Meld } from './tiles';
import type { RuleConfig } from './config';

export interface SettleInput {
  seat: number;
  hand: Counts;
  melds: Meld[];
  lack: number;
  won: boolean;
  gangGains: { from: number; amount: number }[];
  /** 听牌时的最大番数；没听牌为 0 */
  tingFan: number;
}

export interface SettleRow {
  seat: number;
  delta: number;
  reasons: string[];
  /** 状态：胡牌 / 听牌 / 未听牌（大叔）/ 花猪 */
  status: 'won' | 'ting' | 'noting' | 'huazhu';
}

/**
 * 结算规则（可由 RuleConfig 关掉任意一条）：
 * - 花猪（手上还有缺门牌）：赔给每个没花猪的家固定分，自己不收钱，还要退回杠分
 * - 未听牌（俗称大叔）：赔给每个听牌家「该家的最大可能番数」
 * - 听牌家之间互不结算
 * - 已经胡了的家不参与
 */
export function settleDraw(cfg: RuleConfig, inputs: SettleInput[]): SettleRow[] {
  const rows: SettleRow[] = inputs.map((p) => ({
    seat: p.seat,
    delta: 0,
    reasons: [],
    status: p.won ? 'won' : 'ting',
  }));
  const byId = new Map(rows.map((r) => [r.seat, r]));

  const huazhu = new Set<number>();
  const noting = new Set<number>();
  const ting = new Set<number>();

  for (const p of inputs) {
    if (p.won) continue;
    if (cfg.draw.chaHuaZhu && cfg.lack.huaZhuOnLack && p.lack >= 0 && hasSuit(p.hand, p.lack)) {
      huazhu.add(p.seat);
      byId.get(p.seat)!.status = 'huazhu';
    } else if (p.tingFan > 0) {
      ting.add(p.seat);
      byId.get(p.seat)!.status = 'ting';
    } else {
      noting.add(p.seat);
      byId.get(p.seat)!.status = 'noting';
    }
  }

  // 查花猪
  if (cfg.draw.chaHuaZhu) {
    for (const seat of huazhu) {
      const row = byId.get(seat)!;
      row.reasons.push('花猪');
      for (const q of inputs) {
        if (q.seat === seat || q.won || huazhu.has(q.seat)) continue;
        row.delta -= cfg.draw.huaZhuPay;
        byId.get(q.seat)!.delta += cfg.draw.huaZhuPay;
      }
      // 花猪退还本局收过的杠分
      if (cfg.draw.huaZhuReturnGang) {
        const p = inputs.find((x) => x.seat === seat)!;
        for (const g of p.gangGains) {
          row.delta -= g.amount;
          const back = byId.get(g.from);
          if (back) back.delta += g.amount;
        }
        if (p.gangGains.length) row.reasons.push('退杠分');
      }
    }
  }

  // 查大叔：未听牌赔听牌家
  if (cfg.draw.chaJiao) {
    for (const seat of noting) {
      const row = byId.get(seat)!;
      row.reasons.push('未听牌');
      for (const q of inputs) {
        if (!ting.has(q.seat)) continue;
        const pay = Math.min(cfg.draw.chaJiaoCap, q.tingFan);
        row.delta -= pay;
        byId.get(q.seat)!.delta += pay;
      }
    }
    for (const seat of ting) byId.get(seat)!.reasons.push('已听牌');
  }

  return rows;
}
