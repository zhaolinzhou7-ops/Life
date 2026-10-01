/**
 * 引擎公用小工具：确定性随机、日期、数组。
 *
 * 随机数必须可种子化。原因不是洁癖：孩子早上生成了今天的任务，中途关掉再进来，
 * 看到的必须是同一批词、同一个故事——否则「今天要做的事」这个心理契约就没了。
 * 所以任务生成器全程只用 rng(seed)，绝不碰 Math.random()。
 */

/** mulberry32。够随机、够快、32 位种子，跨设备结果一致 */
export function rng(seed: number): () => number {
  let a = (seed | 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按种子洗牌，不改原数组 */
export function shuffle<T>(arr: T[], rnd: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** 本地时区的 YYYY-MM-DD。不能用 toISOString()，那是 UTC，会把晚上的学习算到第二天 */
export function dayKey(t: number | Date = Date.now()): string {
  const d = t instanceof Date ? t : new Date(t);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

/** 两个 dayKey 相差几天 */
export function daysBetween(a: string, b: string): number {
  const pa = Date.parse(`${a}T00:00:00`);
  const pb = Date.parse(`${b}T00:00:00`);
  if (Number.isNaN(pa) || Number.isNaN(pb)) return 0;
  return Math.round((pb - pa) / DAY_MS);
}

/** 从 dayKey 往前推 n 天 */
export function dayBefore(key: string, n: number): string {
  const t = Date.parse(`${key}T00:00:00`);
  return dayKey(new Date(t - n * DAY_MS));
}

/** 生成一个够用的本地 id。不做全局唯一保证，本来也只在这台设备上用 */
export function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

/** 把字符串折成一个稳定的 32 位种子，用于「同一天同一个孩子结果一致」 */
export function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) || 1;
}
