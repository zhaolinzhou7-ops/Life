/**
 * 找"一步就成死和"的题和残局：走完（或者主变走到某一手）双方只剩一马/一炮、或者谁都没有进攻子力——
 * 之后再怎么走都是和棋，接着一步步走就没意义了。
 *
 * 用户原话："残棋里有一些情况，比如我方一个马、对方一个马一个兵，很多时候第一步就想把兵给吃了，
 * 吃完之后就开始走和棋，要走很多步，这就没有意义。"
 *
 *   node tools/run.mjs scan-dead-draws
 */
import fs from 'fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { bareMinors, noAttackers } from '../src/xiangqi/endings';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
const dead = (b: Board, c: Color) => noAttackers(b) || bareMinors(b, c);

type P = { id: string; kind: string; fen: string; answer: string; line: string[]; ev?: number; goal?: string };
const puz = JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')) as P[];
const hits: string[] = [];
for (const p of puz) {
  const f = fromFen(p.fen);
  if (!f) continue;
  let b = f.board;
  let c = f.toMove;
  if (dead(b, c)) {
    hits.push(`${p.id}\t开局就是死和\t${p.line.join(' ')}`);
    continue;
  }
  for (let i = 0; i < p.line.length; i++) {
    const m = textToMove(b, c, p.line[i], legal(b, c));
    if (!m) break;
    b = applyMove(b, m);
    c = other(c);
    if (dead(b, c)) {
      hits.push(`${p.id}\t第 ${i + 1} 手成死和（主变 ${p.line.length} 手，ev ${p.ev} ${p.goal}）\t${p.line.join(' ')}`);
      break;
    }
  }
}
console.log(`题库 ${puz.length} 道，走着走着成死和的 ${hits.length} 道：`);
console.log(hits.join('\n'));

// 实用残局（残局练习）：开局一步就能把对方唯一的兵、或者让局面变成死和的
type E = { id?: string; name?: string; fen: string; [k: string]: unknown };
const lib = JSON.parse(fs.readFileSync('src/xiangqi/endgamelib.json', 'utf8'));
const items: E[] = Array.isArray(lib) ? lib : (Object.values(lib).flat() as E[]);
let n = 0;
const eh: string[] = [];
for (const it of items) {
  if (!it || typeof it !== 'object' || typeof it.fen !== 'string') continue;
  const f = fromFen(it.fen);
  if (!f) continue;
  n++;
  const b = f.board;
  const c = f.toMove;
  const one = legal(b, c).filter((m) => dead(applyMove(b, m), other(c)));
  if (one.length) eh.push(`${it.id ?? it.name}\t${it.fen}\t一步成死和：${one.length} 手`);
}
console.log(`\n实用残局 ${n} 局，一步就能走成死和的 ${eh.length} 局：`);
console.log(eh.join('\n'));
