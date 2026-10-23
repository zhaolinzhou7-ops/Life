/**
 * 把皮卡鱼已经核过"只有这一手"的生成结果并进题库：
 *   defense    gen-defense 的解杀题（node_modules/.cache/defense-*.jsonl），作为眼力题
 *   openings2  gen-openings2 的布局题（node_modules/.cache/openings2-*.jsonl）
 *
 * 并入前用规则引擎再走一遍：局面读得出、开局谁都不被将军、主变每一手合法、第一手就是答案；
 * 同一个局面只收一道（也不和题库里已有的重复）。
 *
 *   node tools/run.mjs merge-verified defense
 *   node tools/run.mjs merge-verified openings2
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Color } from '../src/xiangqi/rules';

const PUZ = 'src/xiangqi/puzzles.json';
const CACHE = 'node_modules/.cache';

type Rec = { id: string; kind: string; fen: string; answer: string; line: string[]; rating: number; goal: string; prompt?: string; threat?: number; ply?: number; ev: number; ev2?: number };

const SRC = process.argv[2] ?? 'defense';
if (!['defense', 'openings2'].includes(SRC)) throw new Error(`不认识的来源 ${SRC}`);

const puzzles = JSON.parse(readFileSync(PUZ, 'utf8')) as Rec[];
const recs: Rec[] = [];
for (const f of readdirSync(CACHE).filter((n) => new RegExp(`^${SRC}-\\d+\\.jsonl$`).test(n)).sort()) {
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
  if (r.ev2 === undefined) {
    drop('没有第二名的分');
    continue;
  }
  out.push(SRC === 'defense' ? { ...r, kind: 'safety', goal: 'only' } : r);
}
writeFileSync(PUZ, JSON.stringify([...kept, ...out]));
const by: Record<string, number> = {};
for (const r of out) {
  const k = SRC === 'defense' ? `威胁 ${r.threat} 步杀` : r.goal === 'best' ? '抓软着' : '守住';
  by[k] = (by[k] ?? 0) + 1;
}
console.log(`${SRC === 'defense' ? '解杀题' : '布局题'}收下 ${out.length} 道`, by, '丢掉：', why);
