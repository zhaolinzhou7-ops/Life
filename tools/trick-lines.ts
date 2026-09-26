/**
 * 给选好的邪门着，按指定的"破解"和"上当"那一手，各拿一条引擎主变和分数（写数据用）。
 * 用法：node tools/run.mjs trick-lines <json: [[前缀, 邪门着, 破解, 上当], ...]>
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';
import { moveToUci, uciToMove, parseInfo, type PvLine } from '../src/xiangqi/pikafish';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const e = await startPikafish(256);
const rows: [string, string, string, string][] = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ms = Number(process.argv[3] ?? 3000);
for (const [pre, trick, refute, trap] of rows) {
  let b: Board = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  for (const t of [...pre.split(/\s+/).filter(Boolean), trick]) {
    const m = textToMove(b, c, t, legalMoves(b, c))!;
    moves.push(m);
    b = applyMove(b, m);
    c = other(c);
  }
  const line = (first: string) => {
    const m = textToMove(b, c, first, legalMoves(b, c));
    if (!m) return { score: NaN, pv: ['✗' + first] };
    e.send(`position startpos moves ${moves.map(moveToUci).join(' ')}`);
    const r = e.send(`go movetime ${ms} searchmoves ${moveToUci(m)}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
    const top = r[r.length - 1];
    let cur = b;
    let cc = c;
    const pv: string[] = [];
    for (const u of top.pv.slice(0, 9)) {
      const mm = uciToMove(u);
      if (!mm || !legalMoves(cur, cc).some((x) => same(x, mm))) break;
      pv.push(moveToText(cur, mm));
      cur = applyMove(cur, mm);
      cc = other(cc);
    }
    return { score: top.mateIn !== undefined ? (top.mateIn > 0 ? 50000 : -50000) : top.score, pv, depth: top.depth };
  };
  const r = line(refute);
  const t = line(trap);
  console.log(`\n${pre} | ${trick}`);
  console.log(`  破解 ${r.score}（${r.depth} 层）：${r.pv.join(' ')}`);
  console.log(`  上当 ${t.score}（${t.depth} 层）：${t.pv.join(' ')}`);
}
