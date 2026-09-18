/**
 * 进步曲线：回答「我比一个月前强了没」。
 *
 * 画像回答的是「我现在哪里弱」，这是两个不同的问题，而且后者才是让人
 * 第二周还愿意打开的东西——看得见自己在涨，才有继续练的理由。
 *
 * 衡量标准用**每局的决策正确率**，不用胜率。麻将单局运气太大，
 * 胜率要几百局才有意义；而「这一局里有多少步是最优解」是即时可算的，
 * 十几局就能看出趋势，而且它直接对应我们教的东西。
 */

import { ERROR_INFO, ERROR_TYPES, type ErrorType } from '../replay/analyze';
import type { Profile, RecentGame } from './store';

export interface ProgressPoint {
  /** 第几局（1 起） */
  n: number;
  at: number;
  /** 这一局的决策正确率 0~1 */
  accuracy: number;
  /** 最近 window 局的滚动平均，趋势看它 */
  rolling: number;
  score: number;
  won: boolean;
}

/** 滚动窗口。5 局能压住单局噪声，又不会把趋势抹平 */
export const ROLL_WINDOW = 5;

/** 一局的正确率：没出错的决策占比 */
export function gameAccuracy(g: RecentGame): number {
  const errs = Object.values(g.errors).reduce((a, b) => a + (b ?? 0), 0);
  if (!g.decisions) return 0;
  return Math.max(0, Math.min(1, 1 - errs / g.decisions));
}

/** 按时间顺序的进步数据（profile.recent 是倒序存的，这里翻过来） */
export function progressSeries(p: Profile, limit = 40): ProgressPoint[] {
  const games = p.recent.slice(0, limit).reverse();
  const out: ProgressPoint[] = [];
  games.forEach((g, i) => {
    const accuracy = gameAccuracy(g);
    const from = Math.max(0, i - ROLL_WINDOW + 1);
    const slice = games.slice(from, i + 1);
    const rolling = slice.reduce((a, x) => a + gameAccuracy(x), 0) / slice.length;
    out.push({ n: i + 1, at: g.at, accuracy, rolling, score: g.score, won: g.won });
  });
  return out;
}

export interface Improvement {
  /** 够不够数据下结论 */
  enough: boolean;
  /** 最近一半的平均正确率 */
  recent: number;
  /** 更早一半的平均正确率 */
  earlier: number;
  /** 变化（百分点） */
  delta: number;
  /** 一句话结论 */
  text: string;
  /** 各维度的变化，只列变化明显的 */
  bySkill: { type: ErrorType; delta: number; text: string }[];
}

/**
 * 前后对比。
 * 取「最近一半 vs 更早一半」而不是「最近 5 局 vs 之前 5 局」——
 * 后者样本太小，一局手气不好就能翻转结论，那种反馈是误导。
 */
export function improvement(p: Profile, minGames = 8): Improvement {
  const games = p.recent.slice(0, 30).reverse();
  if (games.length < minGames) {
    return {
      enough: false,
      recent: 0,
      earlier: 0,
      delta: 0,
      text: `再打 ${minGames - games.length} 局就能看出趋势了。进步曲线需要一定局数才不会被手气带偏。`,
      bySkill: [],
    };
  }
  const half = Math.floor(games.length / 2);
  const early = games.slice(0, half);
  const late = games.slice(half);
  const avg = (list: RecentGame[]) => list.reduce((a, g) => a + gameAccuracy(g), 0) / list.length;
  const earlier = avg(early);
  const recent = avg(late);
  const delta = (recent - earlier) * 100;

  // 分维度：每局每类错误的次数，前后各算一次
  const bySkill: Improvement['bySkill'] = [];
  for (const t of ERROR_TYPES) {
    const rate = (list: RecentGame[]) => list.reduce((a, g) => a + (g.errors[t] ?? 0), 0) / list.length;
    const e = rate(early);
    const r = rate(late);
    const d = e - r; // 正数 = 错得少了 = 进步
    if (Math.abs(d) < 0.35) continue; // 变化太小的别拿出来说，那是噪声
    bySkill.push({
      type: t,
      delta: d,
      text: d > 0
        ? `${ERROR_INFO[t].name}：每局少错 ${d.toFixed(1)} 次`
        : `${ERROR_INFO[t].name}：每局多错 ${(-d).toFixed(1)} 次`,
    });
  }
  bySkill.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  let text: string;
  const pct = Math.abs(delta).toFixed(0);
  if (delta >= 5) text = `最近 ${late.length} 局的决策正确率是 ${(recent * 100).toFixed(0)}%，比之前高了 ${pct} 个百分点——在进步。`;
  else if (delta <= -5) text = `最近 ${late.length} 局的正确率是 ${(recent * 100).toFixed(0)}%，比之前低了 ${pct} 个百分点。可能是换了更难的对手，也可能最近打得急了。`;
  else text = `最近 ${late.length} 局的正确率稳定在 ${(recent * 100).toFixed(0)}% 左右，和之前基本持平。`;

  return { enough: true, recent, earlier, delta, text, bySkill: bySkill.slice(0, 3) };
}
