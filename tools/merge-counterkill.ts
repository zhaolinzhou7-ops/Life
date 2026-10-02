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
import { startPikafish } from './pikafish-node';
import { parseInfo, type PvLine } from '../src/xiangqi/pikafish';

const CACHE = 'node_modules/.cache';
const OUT = 'src/xiangqi/counterkill.json';

type Rec = {
  seeDepth?: number;
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

/**
 * 第几章：按步数。两步杀不收了——用户原话："你现在做的残局有点太简单了（包括闯关模式），深度还需要再深入一些。"
 * 3 步 / 4 步 / 5 步 / 6–7 步 / 8–9 步 / 10 步以上
 */
export function chapterOf(n: number): number {
  return n <= 3 ? 1 : n === 4 ? 2 : n === 5 ? 3 : n <= 7 ? 4 : n <= 9 ? 5 : 6;
}
const MIN_STEPS = 3;

const e = await startPikafish(64);
/** 浅算几层才看得出这是红方的杀（老数据没有这一项，合并时补算） */
function seeDepthOf(fen: string): number {
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${fen} - - 0 1`);
  for (let d = 3; d <= 40; d++) {
    const ls = e.send(`go depth ${d}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
    const top = ls[ls.length - 1];
    if (top && top.mateIn !== undefined && top.mateIn > 0) return d;
  }
  return 40;
}

const recs: Rec[] = [];
for (const f of fs.readdirSync(CACHE).filter((n) => /^counterkill-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of fs.readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}

const why: Record<string, number> = {};
const drop = (k: string) => (why[k] = (why[k] ?? 0) + 1);
const seen = new Set<string>();
const seenSig = new Set<string>();
const out: (Rec & { chapter: number; rating: number })[] = [];
for (const r of recs) {
  if (r.mateIn < MIN_STEPS) {
    drop('太短');
    continue;
  }
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
  if (quiet > 3 || quiet !== r.quiet) {
    drop('闲着太多');
    continue;
  }
  // 同一路杀法（红方着法一样）只换了个无关的子：只留一关
  const sig = r.line.filter((_, i) => i % 2 === 0).join(' ');
  if (seenSig.has(sig)) {
    drop('同一路杀法');
    continue;
  }
  seenSig.add(sig);
  seen.add(r.fen);
  // 难度：步数为主；中间有不将军的"闲着"更难看到；引擎浅算要很多层才看得见的，再加
  const seeDepth = r.seeDepth ?? seeDepthOf(r.fen);
  const rating = Math.min(2600, 760 + (r.mateIn - 1) * 150 + quiet * 110 + Math.max(0, seeDepth - r.mateIn * 2 + 1) * 25);
  out.push({ ...r, seeDepth, chapter: chapterOf(r.mateIn), rating });
}

// 章内由易到难：步数、闲着、子力多的（更难看清）排后面；最难的那一道放最后当关底
out.sort((a, b) => a.chapter - b.chapter || a.rating - b.rating || a.line.length - b.line.length || a.id.localeCompare(b.id));
fs.writeFileSync(OUT, JSON.stringify(out));
const by: Record<number, number> = {};
for (const r of out) by[r.chapter] = (by[r.chapter] ?? 0) + 1;
console.log(`绝地反杀：${out.length} 道（丢掉：${JSON.stringify(why)}）`, by);
process.exit(0);
