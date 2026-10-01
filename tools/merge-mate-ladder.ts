/**
 * 把 gen-mate-ladder 的产出（node_modules/.cache/ladder-*.jsonl、longladder-*.jsonl）并成残局阶梯：
 * 按步数分四档（5 / 10 / 15 / 20 步杀），同一档里按子力体系排；
 * 每一题再用规则引擎走一遍：局面读得出、解法走得通、最后一手将死。
 *
 *   node tools/run.mjs merge-mate-ladder
 */
import fs from 'fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, legalMoves, statusAfter, type Color } from '../src/xiangqi/rules';

const CACHE = 'node_modules/.cache';
const OUT = 'src/xiangqi/mateladder.json';
const CAT_ORDER = ['兵类', '马类', '炮类', '车类', '组合'];

type Rec = { id: string; src: string; name: string; category: string; material: string; fen: string; you: Color; mateIn: number; solved: number; line: string[] };

/** 杀几步归哪一档 */
export function tierOf(n: number): number | null {
  if (n >= 4 && n <= 7) return 5;
  if (n >= 8 && n <= 12) return 10;
  if (n >= 13 && n <= 17) return 15;
  if (n >= 18 && n <= 26) return 20;
  return null;
}

const recs: Rec[] = [];
for (const f of fs.readdirSync(CACHE).filter((n) => /^(ladder|longladder)-\d+\.jsonl$/.test(n))) {
  for (const l of fs.readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}
const seen = new Set<string>();
const out: (Rec & { tier: number })[] = [];
let bad = 0;
for (const r of recs) {
  if (seen.has(r.fen)) continue;
  const tier = tierOf(r.mateIn);
  const p = fromFen(r.fen);
  if (!tier || !p || p.toMove !== r.you) {
    bad++;
    continue;
  }
  let b = p.board;
  let c = p.toMove;
  let ok = true;
  for (const t of r.line) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) {
      ok = false;
      break;
    }
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  if (!ok || statusAfter(b, c) === 'playing') {
    bad++;
    continue;
  }
  seen.add(r.fen);
  out.push({ ...r, tier });
}
out.sort((a, b) => a.tier - b.tier || CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || a.mateIn - b.mateIn);
fs.writeFileSync(OUT, JSON.stringify(out));
const by: Record<number, number> = {};
for (const r of out) by[r.tier] = (by[r.tier] ?? 0) + 1;
console.log(`残局阶梯：${out.length} 题（丢掉 ${bad}）`, by);
