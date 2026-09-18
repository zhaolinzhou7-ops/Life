/**
 * 个性化训练计划（Training Recommendation 层）。
 *
 * 计划不是随机推荐，而是「检测 → 训练 → 再检测」闭环里的中间一环：
 * 它读最近几次演唱**真实暴露出来的问题**，为每一条练习给出理由，
 * 练完之后再用同一套指标回来验证有没有改善。
 */

import type { Finding } from '../analysis/types';
import { EXERCISE_BY_ID, EXERCISES, type Exercise } from '../training/exercises';
import { getSessions, getTraining, recentSessions } from './store';
import { buildProfile } from './profile';

export interface PlanItem {
  exerciseId: string;
  name: string;
  minutes: number;
  /** 为什么今天要练这条 */
  reason: string;
}

export interface DailyPlan {
  date: string;
  totalMinutes: number;
  items: PlanItem[];
  /** 今天的重点，一句话 */
  focus: string;
  /** 这个计划是根据什么排的 */
  basis: string;
  /** 建议再唱一遍的歌（闭环的「再检测」那一步） */
  recheck: { refId: string; title: string; reason: string } | null;
}

const todayKey = () => new Date().toLocaleDateString('sv');

/** 最近 3 天练过的练习，用来避免天天重复同一条 */
function recentlyUsed(): Set<string> {
  const since = Date.now() - 3 * 86400_000;
  return new Set(
    getTraining()
      .filter((t) => t.at >= since)
      .map((t) => t.exerciseId),
  );
}

/** 从最近几次演唱里数出反复出现的问题 */
function problemTally(): { kind: Finding['kind']; count: number; title: string }[] {
  const recent = recentSessions(5);
  const map = new Map<string, { count: number; title: string }>();
  for (const s of recent) {
    if (!s.topFinding || s.topFinding === 'clean') continue;
    const e = map.get(s.topFinding);
    if (e) e.count++;
    else map.set(s.topFinding, { count: 1, title: s.topFindingTitle ?? s.topFinding });
  }
  return [...map.entries()]
    .map(([kind, v]) => ({ kind: kind as Finding['kind'], count: v.count, title: v.title }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 生成今日训练计划。
 *
 * 排课的三条规则：
 *   1. 先练暴露最多的问题；
 *   2. 一天最多安排一条高负担（load 3）的练习——高音类练多了适得其反；
 *   3. 尽量不和前三天重样，避免练成肌肉记忆里的固定套路。
 */
export function makeDailyPlan(): DailyPlan {
  const problems = problemTally();
  const used = recentlyUsed();
  const items: PlanItem[] = [];
  let heavyUsed = false;

  const take = (ex: Exercise, reason: string) => {
    if (items.some((i) => i.exerciseId === ex.id)) return false;
    if (ex.load === 3 && heavyUsed) return false;
    if (ex.load === 3) heavyUsed = true;
    items.push({ exerciseId: ex.id, name: ex.name, minutes: ex.minutes, reason });
    return true;
  };

  for (const p of problems) {
    const candidates = EXERCISES.filter((e) => e.targets.includes(p.kind));
    // 优先挑最近没练过的
    const fresh = candidates.filter((e) => !used.has(e.id));
    const pool = fresh.length ? fresh : candidates;
    const picked = pool[0];
    if (picked) {
      take(
        picked,
        p.count > 1
          ? `最近 5 次里有 ${p.count} 次都栽在这上面：${p.title}`
          : `上次的主要问题：${p.title}`,
      );
    }
    if (items.length >= 3) break;
  }

  // 还没练过任何歌的新用户：给一套通用的入门组合
  if (!items.length) {
    const starters = ['match-single', 'metro-follow', 'steady-long'];
    for (const id of starters) {
      const ex = EXERCISE_BY_ID.get(id);
      if (ex) take(ex, '还没有你的演唱数据，先用这三条把音准、节奏、稳定性的底子摸出来。');
    }
  }

  // 闭环的最后一步：再唱一遍同一首，看指标有没有动
  const last = recentSessions(1)[0];
  const recheck =
    last && last.refId
      ? {
          refId: last.refId,
          title: last.title,
          reason: `练完再唱一遍《${last.title}》。同一首歌才比得出来——上次综合 ${last.overall ?? '—'} 分。`,
        }
      : null;

  const total = items.reduce((a, b) => a + b.minutes, 0) + (recheck ? 4 : 0);
  const profile = buildProfile();
  const weakest = profile.abilities
    .filter((a) => a.value !== null)
    .sort((a, b) => (a.value ?? 0) - (b.value ?? 0))[0];

  const focus = problems.length
    ? `今天主攻：${problems[0].title}`
    : weakest
      ? `今天主攻：${weakest.label}（目前五项里最弱，${weakest.value} 分）`
      : '今天先建立基线：把三项基础指标各测一次';

  const basis = problems.length
    ? `依据最近 ${Math.min(5, getSessions().length)} 次演唱的分析结果排的。每条练习后面都写了为什么给你。`
    : '还没有足够的演唱数据，这是一套通用的入门组合。唱过几首之后计划会跟着你的问题走。';

  return { date: todayKey(), totalMinutes: total, items, focus, basis, recheck };
}

/**
 * 训练结束后的小结：今天到底改善了什么。
 * 比较「今天第一次」和「今天最后一次」的同名指标——
 * 只报真的动了的项，动得不明显就说不明显，不编。
 */
export function todaySummary(): string {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const today = getSessions()
    .filter((s) => s.at >= start.getTime())
    .sort((a, b) => a.at - b.at);

  if (today.length < 2) {
    const mins = getTraining()
      .filter((t) => t.at >= start.getTime())
      .reduce((a, b) => a + b.minutes, 0);
    if (!mins && !today.length) return '今天还没开始练。';
    return today.length === 1
      ? `今天练了 ${mins} 分钟，唱了 1 次。再唱一次同一首，就能看出这次训练有没有效果。`
      : `今天练了 ${mins} 分钟。练完唱一首，才能验证有没有改善。`;
  }

  const first = today[0];
  const last = today[today.length - 1];
  const deltas: { name: string; d: number }[] = [];
  const add = (name: string, a: number | null, b: number | null) => {
    if (a === null || b === null) return;
    deltas.push({ name, d: b - a });
  };
  add('音准', first.accuracy, last.accuracy);
  add('节奏', first.rhythm, last.rhythm);
  add('稳定性', first.stability, last.stability);
  add('高音', first.highNotes, last.highNotes);

  const improved = deltas.filter((x) => x.d >= 3).sort((a, b) => b.d - a.d);
  if (!improved.length) {
    const worst = deltas.sort((a, b) => a.d - b.d)[0];
    return worst && worst.d <= -5
      ? `今天唱了 ${today.length} 次，各项没有提升，${worst.name}还降了 ${Math.abs(worst.d)} 分——多半是嗓子累了。今天到此为止，明天再练效果更好。`
      : `今天唱了 ${today.length} 次，各项变化都在 3 分以内，属于正常波动，还看不出改善。一两天看不出效果是正常的，连续练一周再看趋势。`;
  }
  const top = improved[0];
  return `今天最明显的改善：${top.name} +${top.d} 分（今天第 1 次 ${
    top.name === '音准' ? first.accuracy : top.name === '节奏' ? first.rhythm : top.name === '稳定性' ? first.stability : first.highNotes
  } → 最后一次 ${
    top.name === '音准' ? last.accuracy : top.name === '节奏' ? last.rhythm : top.name === '稳定性' ? last.stability : last.highNotes
  }）。`;
}
