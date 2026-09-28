/**
 * 日期工具。全部用 'YYYY-MM-DD' 字符串表示"某一天"，不带时区：
 * 记录的是"哪天发生的"，不是"哪一刻"。换算天数时按公历日子数，
 * 不经过本地时间，避免跨时区/夏令时算差一天。
 */

export function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

export function todayStr(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidDate(s: string): boolean {
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = +m[1], mo = +m[2], d = +m[3];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

function parts(s: string): [number, number, number] {
  const m = DATE_RE.exec(s);
  if (!m) throw new Error(`日期格式不对：${s}`);
  return [+m[1], +m[2], +m[3]];
}

function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function fromUTC(t: number): string {
  const d = new Date(t);
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

function toUTC(s: string): number {
  const [y, m, d] = parts(s);
  return Date.UTC(y, m - 1, d);
}

export function addDays(s: string, n: number): string {
  return fromUTC(toUTC(s) + n * 86400000);
}

/** 加月份；目标月没有这一天时取月底（1 月 31 日 + 1 个月 = 2 月 28/29 日） */
export function addMonths(s: string, n: number): string {
  const [y, m, d] = parts(s);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad2(nm)}-${pad2(Math.min(d, daysInMonth(ny, nm)))}`;
}

/** b 比 a 晚几天（b 早于 a 时为负） */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUTC(b) - toUTC(a)) / 86400000);
}

export function monthKey(s: string): string {
  return s.slice(0, 7);
}

export function shiftMonth(key: string, delta: number): string {
  return addMonths(`${key}-01`, delta).slice(0, 7);
}

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/** 9月28日 周日 */
export function formatDay(s: string): string {
  const [y, m, d] = parts(s);
  const w = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}月${d}日 周${WEEK[w]}`;
}

/** 2026年9月28日 */
export function formatFull(s: string): string {
  const [y, m, d] = parts(s);
  return `${y}年${m}月${d}日`;
}

/** 2026年9月 */
export function formatMonth(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return `${y}年${m}月`;
}

/** 满几岁几个月（按日子算，没到生日那天不算满） */
export function ageOn(birth: string, today: string): { years: number; months: number } | null {
  if (!isValidDate(birth) || !isValidDate(today) || birth > today) return null;
  const [by, bm, bd] = parts(birth);
  const [ty, tm, td] = parts(today);
  let months = (ty - by) * 12 + (tm - bm);
  if (td < bd) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12 };
}
