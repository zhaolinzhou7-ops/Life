/**
 * 探索一条开局线：走到最后，引擎给出前几名着法（带分数和主变），
 * 以及指定的几手各值多少。写"邪门布局破解"数据之前先用它看清楚。
 * 用法：node tools/run.mjs explore-line "炮二平五 炮8平5 炮五进四" [候选1,候选2]
 */
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, isInCheck, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, uciToMove, parseInfo } from '../src/xiangqi/pikafish';

const [, , line = '', cands = '', ms = '1500'] = process.argv;
const e = await startPikafish(128);
let b: Board = initialBoard();
let c: Color = 'r';
const played: Move[] = [];
for (const t of line.split(/\s+/).filter(Boolean)) {
  const m = textToMove(b, c, t, legalMoves(b, c));
  if (!m) {
    console.log(`✗ 走不通：${t}`);
    process.exit(1);
  }
  played.push(m);
  b = applyMove(b, m);
  c = c === 'r' ? 'b' : 'r';
}
const pos = `position startpos${played.length ? ' moves ' + played.map(moveToUci).join(' ') : ''}`;
const pvText = (start: Board, color: Color, pv: string[]) => {
  let cur = start;
  let cc = color;
  const out: string[] = [];
  for (const u of pv.slice(0, 10)) {
    const m = uciToMove(u);
    if (!m || !legalMoves(cur, cc).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)) break;
    out.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    cc = cc === 'r' ? 'b' : 'r';
  }
  return out.join(' ');
};
const side = c === 'r' ? '红' : '黑';
console.log(`局面（${side}走）：${toFen(b, c)}${isInCheck(b, c) ? ' 【被将军】' : ''}`);
e.send('setoption name MultiPV value 5');
e.send(pos);
const lines = e.send(`go movetime ${ms}`).map(parseInfo).filter((x) => x && !x.bound);
const last = new Map<number, NonNullable<ReturnType<typeof parseInfo>>>();
let depth = 0;
for (const l of lines) if (l) { if (l.depth >= depth) depth = l.depth; }
for (const l of lines) if (l && l.depth === depth) last.set(l.multipv, l);
if (last.size < 5) for (const l of lines) if (l && l.depth === depth - 1 && !last.has(l.multipv)) last.set(l.multipv, l);
console.log(`前几名（${depth} 层，${side}方视角，车≈1000）：`);
for (const [k, l] of [...last.entries()].sort((a, b2) => a[0] - b2[0])) {
  console.log(`  ${k}. ${l.mateIn !== undefined ? `杀${l.mateIn}` : l.score}\t${pvText(b, c, l.pv)}`);
}
e.send('setoption name MultiPV value 1');
for (const t of cands.split(',').filter(Boolean)) {
  const m = textToMove(b, c, t, legalMoves(b, c));
  if (!m) {
    console.log(`  ✗ 候选走不通：${t}`);
    continue;
  }
  e.send(pos);
  const r = e.send(`go movetime ${ms} searchmoves ${moveToUci(m)}`).map(parseInfo).filter((x) => x && !x.bound);
  const top = r[r.length - 1]!;
  console.log(`  候选 ${t}：${top.mateIn !== undefined ? `杀${top.mateIn}` : top.score}\t${pvText(b, c, top.pv)}`);
}
