/**
 * 把 gen-mates2 的产出（node_modules/.cache/mates2-*.jsonl）并进题库，作为杀法题。
 *
 * 并入前用规则引擎再走一遍：局面读得出、对方还有进攻子（不是光将士象的一眼必胜）、
 * 主变每一手合法、第一手就是答案、最后一手真的将死（将军而且无路可走，不收困毙）。
 * 同一个局面只收一道（也不和题库里已有的重复）。
 *
 *   node tools/run.mjs merge-mates2
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, statusAfter, type Color } from '../src/xiangqi/rules';
import { defenseless } from '../src/xiangqi/puzzles';

const PUZ = 'src/xiangqi/puzzles.json';
const CACHE = 'node_modules/.cache';

type Rec = { id: string; kind: string; fen: string; answer: string; line: string[]; mateIn: number; rating: number; goal: string; ev: number };

const puzzles = JSON.parse(readFileSync(PUZ, 'utf8')) as Rec[];
const recs: Rec[] = [];
for (const f of readdirSync(CACHE).filter((n) => /^mates2-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}
// 重新合并：这一批上次并进去的（同一个题号）先拿掉
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
  if (defenseless(r.fen)) {
    drop('对方没有进攻子');
    continue;
  }
  if (r.line[0] !== r.answer || r.line.length % 2 === 0 || r.line.length !== 2 * r.mateIn - 1) {
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
  if (statusAfter(b, c) === 'playing' || !isInCheck(b, c)) {
    drop('没有将死');
    continue;
  }
  fens.add(key);
  out.push({ ...r, kind: 'mate', goal: 'mate', ev: 3000 });
}
writeFileSync(PUZ, JSON.stringify([...kept, ...out]));
const by: Record<number, number> = {};
for (const r of out) by[r.mateIn] = (by[r.mateIn] ?? 0) + 1;
console.log(`收下 ${out.length} 道（${Object.entries(by).map(([k, v]) => `${k} 步杀 ${v}`).join('、')}），丢掉：`, why);
