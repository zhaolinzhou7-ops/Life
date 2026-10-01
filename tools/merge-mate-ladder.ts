/**
 * 把 gen-mate-ladder 的产出（node_modules/.cache/ladder-*.jsonl、longladder-*.jsonl、ladder20-*.jsonl）并成残局阶梯：
 * 按步数分四档（5 / 10 / 15 / 20 步杀），同一档里按子力体系排；
 * 每一题再用规则引擎走一遍：局面读得出、解法走得通、最后一手将死，
 * 而且示范解法正好是复核的最快步数（对不上的先交给 reverify-ladder 用 30 秒复核）。
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
for (const f of fs.readdirSync(CACHE).filter((n) => /^(ladder|longladder|ladder20[a-z]*)-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of fs.readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}
// reverify-ladder 的结论：步数对不上的题，30 秒复核之后留不留、留下的话几步、换成哪条示范
const fixes = new Map<string, { keep: boolean; mateIn?: number; line?: string[] }>();
for (const f of fs.readdirSync(CACHE).filter((n) => /^reverify-\d+\.jsonl$/.test(n))) {
  for (const l of fs.readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const v = JSON.parse(l);
    fixes.set(v.fen, v);
  }
}
for (let i = recs.length - 1; i >= 0; i--) {
  const r = recs[i];
  if (r.mateIn === r.solved) continue;
  const v = fixes.get(r.fen);
  // 没核过、或者核下来对不上的，一律不收：宁可少一道，不标一个说不准的步数
  if (!v || !v.keep) {
    recs.splice(i, 1);
    continue;
  }
  r.mateIn = v.mateIn!;
  r.line = v.line!;
  r.solved = Math.ceil(r.line.length / 2);
}
const seen = new Set<string>();
const ids = new Set<string>();
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
  // 示范解法的步数必须和复核的最快步数一样（对不上的上面已经按 30 秒复核处理过了）
  const solved = Math.ceil(r.line.length / 2);
  const mateIn = r.mateIn;
  const t2 = tierOf(mateIn);
  if (!t2 || r.line.length % 2 === 0 || solved !== mateIn) {
    bad++;
    continue;
  }
  seen.add(r.fen);
  // 不同轮次从同一个局面切出同样步数的题，id 会撞；局面不同就加个后缀
  let id = r.id;
  for (let k = 2; ids.has(id); k++) id = `${r.id}-${k}`;
  ids.add(id);
  // 子力写法统一成残局库的"马兵 vs 士象全"（长杀局面那几批写的是"马兵对士象全"）
  const material = r.material.includes(' vs ') ? r.material : r.material.replace('对', ' vs ');
  out.push({ ...r, id, material, mateIn, solved, tier: t2 });
}
out.sort((a, b) => a.tier - b.tier || CAT_ORDER.indexOf(a.category) - CAT_ORDER.indexOf(b.category) || a.mateIn - b.mateIn);
fs.writeFileSync(OUT, JSON.stringify(out));
const by: Record<number, number> = {};
for (const r of out) by[r.tier] = (by[r.tier] ?? 0) + 1;
console.log(`残局阶梯：${out.length} 题（丢掉 ${bad}）`, by);
