/**
 * 私教的每日任务：今天的清单定下来就不变，做完一项打一个勾。
 *
 * 用户原话："每天把私教任务做完，棋艺就能稳步提升。"——那就得有一张明确的、做得完的清单：
 *   - 一天之内清单不变（进进出出不会冒出新任务，也不会少了没做完的）；
 *   - 每一项做完打勾，清单上看得到"今天 2/4"；
 *   - 留最近 30 天的记录：哪天做完了、专项练的哪一维——"同一维连练三天"换维、本周完成几天都从这里来。
 * 任务怎么排在 curriculum.ts 的 dailyPlan()，这里只管存和勾。
 */
import type { Block } from './curriculum';
import type { Dim } from './save';

const KEY = 'xq-day-plan';

export interface DayStore {
  /** 哪一天（本地日期 YYYY-MM-DD） */
  d: string;
  /** 什么时候定的清单（毫秒）：之后下的棋才算"今天的实战" */
  at: number;
  blocks: Block[];
  done: string[];
  hist: { d: string; done: number; total: number; focus?: Dim }[];
}

/** 本地日期（不是 UTC：晚上十点做的任务要算今天） */
export function localDay(t = Date.now()): string {
  const x = new Date(t);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function read(): DayStore | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? 'null') as DayStore | null;
  } catch {
    return null;
  }
}
function write(s: DayStore) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* 存不下就算了：清单照样能用，只是记不住勾 */
  }
}

/**
 * 今天的清单：今天已经定过就原样拿出来，没定过就用 build() 定一份，
 * 昨天（以及更早）的那份收进记录里。
 */
export function todayPlan(build: () => Block[], now = Date.now()): DayStore {
  const d = localDay(now);
  const cur = read();
  if (cur && cur.d === d) return cur;
  const hist = cur ? [...cur.hist, { d: cur.d, done: cur.done.length, total: cur.blocks.length, focus: cur.blocks.find((b) => b.id === 'focus')?.dim }].slice(-30) : [];
  const fresh: DayStore = { d, at: now, blocks: build(), done: [], hist };
  write(fresh);
  return fresh;
}

/** 打勾 */
export function markTask(id: string, now = Date.now()) {
  const cur = read();
  if (!cur || cur.d !== localDay(now) || cur.done.includes(id)) return;
  cur.done.push(id);
  write(cur);
}

/** 最近几天专项练的哪一维（旧的在前，不含今天） */
export function recentFocus(): Dim[] {
  return (read()?.hist ?? []).map((h) => h.focus).filter((x): x is Dim => !!x);
}

/** 最近七天（含今天）每天做完没有：给"这周坚持了几天"用 */
export function lastWeek(now = Date.now()): { d: string; full: boolean; any: boolean }[] {
  const cur = read();
  const byDay = new Map<string, { done: number; total: number }>();
  for (const h of cur?.hist ?? []) byDay.set(h.d, h);
  if (cur) byDay.set(cur.d, { done: cur.done.length, total: cur.blocks.length });
  const out: { d: string; full: boolean; any: boolean }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = localDay(now - i * 86400000);
    const h = byDay.get(d);
    out.push({ d, full: !!h && h.total > 0 && h.done >= h.total, any: !!h && h.done > 0 });
  }
  return out;
}

/** 今天的清单做到哪了（首页卡片上用）：今天还没定清单返回 null */
export function todayProgress(now = Date.now()): { done: number; total: number } | null {
  const cur = read();
  if (!cur || cur.d !== localDay(now)) return null;
  return { done: cur.done.length, total: cur.blocks.length };
}
