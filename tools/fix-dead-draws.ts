/**
 * 走成死和以后就不用再走了：
 *   - 题库：主变走到双方只剩一马/一炮（或者谁都没有进攻子力），后面的截掉；残局题第一手就是吃子吃成死和的
 *     （白吃对方最后一个兵、最后一个子），整道题去掉——那一手谁都看得出来，吃完就是和棋，练不到东西；
 *   - 实用残局：轮到你（守方）走、第一步就能吃成死和的局面去掉。
 *
 * 用户原话："残棋里有一些情况，比如我方一个马、对方一个马一个兵，很多时候第一步就想把兵给吃了，
 * 吃完之后就开始走和棋，要走很多步，这就没有意义。"
 *
 *   node tools/run.mjs fix-dead-draws         只报不改
 *   node tools/run.mjs fix-dead-draws write   写回 puzzles.json、endgamelib.json
 */
import fs from 'fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { bareMinors, noAttackers } from '../src/xiangqi/endings';

const WRITE = process.argv[2] === 'write';
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
/** 谁都赢不了了：双方都没有进攻子力，或者各只剩一个马/炮（轮到走的这一方吃不掉对方那个子） */
const deadDraw = (b: Board, toMove: Color) => noAttackers(b) || bareMinors(b, toMove);

type P = { id: string; kind: string; fen: string; answer: string; line: string[]; also?: string[]; mateIn?: number };
const PUZ = 'src/xiangqi/puzzles.json';
const puz = JSON.parse(fs.readFileSync(PUZ, 'utf8')) as P[];
const dropped: string[] = [];
const cut: string[] = [];
const kept: P[] = [];
for (const p of puz) {
  const f = fromFen(p.fen);
  if (!f) {
    kept.push(p);
    continue;
  }
  let b = f.board;
  let c = f.toMove;
  let at = -1;
  let firstIsCapture = false;
  for (let i = 0; i < p.line.length; i++) {
    const m = textToMove(b, c, p.line[i], legal(b, c));
    if (!m) break;
    if (i === 0) firstIsCapture = !!b[m.ty][m.tx];
    b = applyMove(b, m);
    c = other(c);
    if (deadDraw(b, c)) {
      at = i;
      break;
    }
  }
  if (at < 0) {
    kept.push(p);
    continue;
  }
  // 残局题第一手白吃掉对方最后的兵/子：吃完就是死和，这一手谁都看得出来——去掉。
  // 解杀、反杀这类题第一手吃子是在拆对方的杀（要看出危险才吃得对），留着，只是吃完就算做完
  if (at === 0 && firstIsCapture && p.kind === 'endgame') {
    dropped.push(`${p.id}（${p.line[0]} 吃完就是死和）`);
    continue;
  }
  if (at + 1 < p.line.length) cut.push(`${p.id}：主变 ${p.line.length} 手 → ${at + 1} 手（${p.line.slice(0, at + 1).join(' ')} 之后成死和）`);
  kept.push(at + 1 < p.line.length ? { ...p, line: p.line.slice(0, at + 1) } : p);
}
console.log(`题库：去掉 ${dropped.length} 道，截短 ${cut.length} 道`);
for (const s of dropped) console.log(`  去掉 ${s}`);
for (const s of cut) console.log(`  截短 ${s}`);

type E = { id: string; fen: string; you: Color; target: string };
const LIB = 'src/xiangqi/endgamelib.json';
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8')) as E[];
const badLib: string[] = [];
const keptLib = lib.filter((e) => {
  const f = fromFen(e.fen);
  if (!f || f.toMove !== e.you) return true;
  const hit = legal(f.board, f.toMove).some((m) => !!f.board[m.ty][m.tx] && deadDraw(applyMove(f.board, m), other(f.toMove)));
  if (hit) badLib.push(e.id);
  return !hit;
});
console.log(`\n实用残局：去掉 ${badLib.length} 局（轮到你走、第一步就能吃成死和）：${badLib.join('、')}`);

if (WRITE) {
  fs.writeFileSync(PUZ, JSON.stringify(kept));
  fs.writeFileSync(LIB, JSON.stringify(keptLib));
  console.log('已写回');
}
