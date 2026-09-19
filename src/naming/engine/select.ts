/**
 * 第六步：最终挑选
 *
 * 排序完直接取前 12 个会出事：分高的往往长得很像，用户会看到「清远、清和、
 * 清源、清宁」这种一串。那等于没有筛选，只是把同一个名字写了十二遍。
 *
 * 所以这里做的是「好」和「不一样」的平衡：每选一个，就把和它相似的候选压一压。
 */

import type { NameCandidate } from '../types';

function similarity(a: NameCandidate, b: NameCandidate): number {
  let s = 0;
  if (a.given[0] === b.given[0]) s += 0.45;
  if (a.given[a.given.length - 1] === b.given[b.given.length - 1]) s += 0.45;
  if (a.origin.kind === 'classic' && a.origin.work && a.origin.work === b.origin.work) s += 0.2;

  const ta = new Set(a.tags);
  const tb = new Set(b.tags);
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const uni = new Set([...ta, ...tb]).size || 1;
  s += (inter / uni) * 0.3;

  // 声调走势一样的名字念起来是一个味道
  if (a.tones.join('-') === b.tones.join('-')) s += 0.15;
  return Math.min(1, s);
}

/**
 * @param cands 已按 overall 排好序的候选
 * @param n 要几个
 */
export function selectDiverse(cands: NameCandidate[], n: number): NameCandidate[] {
  if (cands.length <= n) return cands.slice();
  const picked: NameCandidate[] = [];
  const pool = cands.slice();

  // 第一个直接取最高分
  picked.push(pool.shift()!);

  while (picked.length < n && pool.length) {
    let bestIdx = 0;
    let bestVal = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = pool[i];
      let maxSim = 0;
      for (const p of picked) maxSim = Math.max(maxSim, similarity(c, p));
      // 分数归一到 0~1 量级后再和相似度做权衡
      const val = c.overall / 100 - maxSim * 0.55;
      if (val > bestVal) {
        bestVal = val;
        bestIdx = i;
      }
    }
    picked.push(pool.splice(bestIdx, 1)[0]);
  }
  return picked;
}

/**
 * 保证结果里既有「有出处」的也有「纯组合」的，两类各自的好处不一样，
 * 让用户自己比，而不是替他决定哪一类更高级。
 */
export function balanceOrigins(picked: NameCandidate[], all: NameCandidate[], n: number): NameCandidate[] {
  const classics = picked.filter((c) => c.origin.kind === 'classic').length;
  if (classics > 0 && classics < picked.length) return picked;

  const want = picked.length >= 6 ? 2 : 1;
  const missingKind = classics === 0 ? 'classic' : 'modern';
  const extras = all
    .filter((c) => c.origin.kind === missingKind && !picked.some((p) => p.given === c.given))
    .slice(0, want);
  if (!extras.length) return picked;

  const out = picked.slice(0, Math.max(1, n - extras.length));
  out.push(...extras);
  return out.sort((a, b) => b.overall - a.overall);
}
