/**
 * 把 gen-defense 的产出（node_modules/.cache/defense-*.jsonl）并进题库，作为眼力题（解杀）。
 *
 * 并入前用规则引擎再走一遍：局面读得出、开局谁都不被将军、主变每一手合法、第一手就是答案；
 * 同一个局面只收一道（也不和题库里已有的重复）。
 *
 *   node tools/run.mjs merge-defense
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Color } from '../src/xiangqi/rules';

const PUZ = 'src/xiangqi/puzzles.json';
const CACHE = 'node_modules/.cache';

type Rec = { id: string; kind: string; fen: string; answer: string; line: string[]; rating: number; goal: string; prompt?: string; threat?: number; ev: number; ev2?: number };

const puzzles = JSON.parse(readFileSync(PUZ, 'utf8')) as Rec[];
const recs: Rec[] = [];
for (const f of readdirSync(CACHE).filter((n) => /^defense-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}
const newIds = new Set(recs.map((r) => r.id));
const kept = puzzles.filter((p) => !newIds.has(p.id));
const fens = new Set(kept.map((p) => p.fen.split(' ').slice(0, 2).join(' ')));

const out: Rec[] = [];
const why: Record<string, number> = {};
const drop = (k: string) => (why[k] = (why[k] ?? 0) + 1);
for (const r of recs) {
  const key = r.fen.split(' ').slice(0, 2).join(' ');
  const pos = fromFen(r.fen);
  if (!pos) {
    drop('局面读不出');
    continue;
  }
  if (fens.has(key)) {
    drop('局面重复');
    continue;
  }
  if (isInCheck(pos.board, 'r') || isInCheck(pos.board, 'b')) {
    drop('开局就在将军');
    continue;
  }
  if (r.line[0] !== r.answer || r.line.length % 2 === 0) {
    drop('主变格式不对');
    continue;
  }
  let b = pos.board;
  let c: Color = pos.toMove;
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
  if (!ok) {
    drop('主变走不通');
    continue;
  }
  fens.add(key);
  out.push({ ...r, kind: 'safety', goal: 'only' });
}
writeFileSync(PUZ, JSON.stringify([...kept, ...out]));
const by: Record<string, number> = {};
for (const r of out) by[`威胁 ${r.threat} 步杀`] = (by[`威胁 ${r.threat} 步杀`] ?? 0) + 1;
console.log(`解杀题收下 ${out.length} 道`, by, '丢掉：', why);
