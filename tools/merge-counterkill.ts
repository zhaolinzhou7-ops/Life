/**
 * 把 gen-counterkill 的产出（node_modules/.cache/counterkill-*.jsonl）并成"绝地反杀"闯关题库。
 *
 * 每一道再用规则引擎走一遍，任何一条不满足就扔：
 *   - 红先、红方没被将军；红方子力不比黑方多；
 *   - 黑方记下的杀着真的一步把红方将死（轮到黑走的话）；
 *   - 示范解法每一手合法、最后一手把黑将死，步数正好等于标的步数；
 *   - 红方每一步都将军（连将杀），或者最多两步不将军（连杀）。
 * 按步数分章；同一章里由易到难排，最后一关是这一章最难的（关底）。
 *
 *   node tools/run.mjs merge-counterkill
 */
import fs from 'fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { PIECE_VALUE } from '../src/xiangqi/teach';

const CACHE = 'node_modules/.cache';
const OUT = 'src/xiangqi/counterkill.json';

type Rec = {
  id: string;
  fen: string;
  mateIn: number;
  line: string[];
  allChecks: boolean;
  quiet: number;
  threat: string[];
  red: string;
  black: string;
};

const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
const mated = (b: Board, c: Color) => isInCheck(b, c) && legal(b, c).length === 0;
function material(b: Board, c: Color): number {
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.c === c && p.t !== 'K') s += PIECE_VALUE[p.t];
  return s;
}

/** 第几章：按步数 */
export function chapterOf(n: number): number {
  return n <= 2 ? 1 : n === 3 ? 2 : n === 4 ? 3 : n === 5 ? 4 : 5;
}

const recs: Rec[] = [];
for (const f of fs.readdirSync(CACHE).filter((n) => /^counterkill-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of fs.readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}

const why: Record<string, number> = {};
const drop = (k: string) => (why[k] = (why[k] ?? 0) + 1);
const seen = new Set<string>();
const out: (Rec & { chapter: number; rating: number })[] = [];
for (const r of recs) {
  if (seen.has(r.fen)) {
    drop('局面重复');
    continue;
  }
  const p = fromFen(r.fen);
  if (!p || p.toMove !== 'r' || isInCheck(p.board, 'r') || isInCheck(p.board, 'b')) {
    drop('局面不对');
    continue;
  }
  if (material(p.board, 'r') > material(p.board, 'b')) {
    drop('红方子力多');
    continue;
  }
  // 黑方的杀着：真的一步杀
  const threats = r.threat.filter((t) => {
    const m = textToMove(p.board, 'b', t, legal(p.board, 'b'));
    return !!m && mated(applyMove(p.board, m), 'r');
  });
  if (!threats.length || threats.length !== r.threat.length) {
    drop('黑方的杀着不对');
    continue;
  }
  if (r.line.length !== r.mateIn * 2 - 1) {
    drop('步数对不上');
    continue;
  }
  let b = p.board;
  let c: Color = 'r';
  let quiet = 0;
  let ok = true;
  for (const t of r.line) {
    const m = textToMove(b, c, t, legal(b, c));
    if (!m) {
      ok = false;
      break;
    }
    b = applyMove(b, m);
    if (c === 'r' && !isInCheck(b, 'b')) quiet++;
    c = c === 'r' ? 'b' : 'r';
  }
  if (!ok || !mated(b, 'b')) {
    drop('解法走不到将死');
    continue;
  }
  if (quiet > 2 || quiet !== r.quiet) {
    drop('闲着太多');
    continue;
  }
  seen.add(r.fen);
  // 难度：步数为主，中间有不将军的"闲着"更难看到，再加一点
  const rating = Math.min(2200, 760 + (r.mateIn - 1) * 180 + quiet * 120);
  out.push({ ...r, chapter: chapterOf(r.mateIn), rating });
}

// 章内由易到难：步数、闲着、子力多的（更难看清）排后面；最难的那一道放最后当关底
out.sort((a, b) => a.chapter - b.chapter || a.rating - b.rating || a.line.length - b.line.length || a.id.localeCompare(b.id));
fs.writeFileSync(OUT, JSON.stringify(out));
const by: Record<number, number> = {};
for (const r of out) by[r.chapter] = (by[r.chapter] ?? 0) + 1;
console.log(`绝地反杀：${out.length} 道（丢掉：${JSON.stringify(why)}）`, by);
