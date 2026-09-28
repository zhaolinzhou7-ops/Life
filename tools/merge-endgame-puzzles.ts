/**
 * 把 gen-endgame-puzzles 的产出（node_modules/.cache/egp-*.jsonl）并进题库。
 *
 * 每道题并入前再用规则引擎走一遍：局面读得出、答案合法、主变走得通。
 * 杀棋题的主变如果被截短、没走到将死，就去掉「N 步杀」的标注——
 * 界面上「完整下法」和「N 步杀」对不上，比不标更误导人。
 *
 *   node tools/run.mjs merge-endgame-puzzles
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, legalMoves, type Color } from '../src/xiangqi/rules';

const PUZ = 'src/xiangqi/puzzles.json';
const CACHE = 'node_modules/.cache';

type Rec = { id: string; kind: string; fen: string; answer: string; line: string[]; rating: number; goal: string; ev: number; mateIn?: number };

const puzzles = JSON.parse(readFileSync(PUZ, 'utf8')) as Rec[];
const ids = new Set(puzzles.map((p) => p.id));
const fens = new Set(puzzles.map((p) => p.fen));

const recs: Rec[] = [];
for (const f of readdirSync(CACHE).filter((n) => /^egp-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}

let added = 0;
let skipped = 0;
for (const r of recs) {
  const pos = fromFen(r.fen);
  if (!pos || ids.has(r.id) || fens.has(r.fen) || r.line[0] !== r.answer) {
    skipped++;
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
    skipped++;
    continue;
  }
  const out: Rec = { ...r };
  if (out.mateIn !== undefined && out.line.length !== out.mateIn * 2 - 1) delete out.mateIn;
  puzzles.push(out);
  ids.add(out.id);
  fens.add(out.fen);
  added++;
}

writeFileSync(PUZ, JSON.stringify(puzzles));
const eg = puzzles.filter((p) => p.kind === 'endgame').length;
console.log(`并入 ${added} 道，跳过 ${skipped} 道；题库共 ${puzzles.length} 道，其中残局 ${eg} 道`);
