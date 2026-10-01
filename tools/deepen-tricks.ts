/**
 * 邪门布局的破解谱往深里走：人写的破解只有三五手，用户原话"破解往往不是三四步的事，
 * 可能需要十几步甚至更深入的思考"。这里接着人写的破解，让皮卡鱼两边都按最好的走，
 * 把破解谱延伸到 12 回合左右（破解方 12 手），每一手配说明、记引擎分；
 * 上当那条也延伸几手，让你看清对方是怎么把便宜兑现的。
 *
 *   node tools/run.mjs deepen-tricks [每手毫秒]
 * 输出 src/xiangqi/trickdeep.json：{ id: { refute: LineMove[], trap: LineMove[] } }
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { noteMove } from '../src/xiangqi/movenote';
import { TRICKS, lineToTrap } from '../src/xiangqi/tricks';

const MS = Number(process.argv[2] ?? 2500);
/** 破解谱总长（破解方 + 对方的着法，从邪门着之后算） */
const REFUTE_PLIES = 24;
const TRAP_PLIES = 10;
const e = await startPikafish(256);
const START = toFen(initialBoard(), 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

function walk(texts: string[]): { board: Board; color: Color; moves: Move[] } {
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) throw new Error(`走不通：${t}（${texts.join(' ')}）`);
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return { board: b, color: c, moves };
}

function bestOf(moves: Move[], board: Board, color: Color): { m: Move; score: number } | null {
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const out = e.send(`go movetime ${MS}`);
  const infos = out.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const last = infos[infos.length - 1];
  const bm = out.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
  const m = bm ? uciToMove(bm) : null;
  if (!m || !legalMoves(board, color).some((x) => same(x, m))) return null;
  const score = last ? (last.mateIn !== undefined ? (last.mateIn > 0 ? 30000 : -30000) : last.score) : 0;
  return { m, score };
}

/** 接着 texts 往下，两边按引擎最好的走 n 手 */
function extend(texts: string[], n: number) {
  const w = walk(texts);
  let { board, color } = w;
  const moves = w.moves.slice();
  const out: { t: string; why: string; ev: number }[] = [];
  for (let i = 0; i < n; i++) {
    if (statusAfter(board, color) !== 'playing') break;
    const r = bestOf(moves, board, color);
    if (!r) break;
    const t = moveToText(board, r.m);
    out.push({ t, why: noteMove(board, r.m, color), ev: color === 'r' ? r.score : -r.score });
    moves.push(r.m);
    board = applyMove(board, r.m);
    color = color === 'r' ? 'b' : 'r';
  }
  return out;
}

const result: Record<string, { refute: unknown[]; trap: unknown[] }> = {};
for (const t of TRICKS) {
  e.send('ucinewgame');
  const base = [...t.pre, t.trick.t];
  const refute = extend([...base, ...t.refute.map((s) => s.t)], Math.max(0, REFUTE_PLIES - t.refute.length));
  const trap = extend([...lineToTrap(t), ...t.trap.map((s) => s.t)], Math.max(0, TRAP_PLIES - t.trap.length));
  result[t.id] = { refute, trap };
  const last = refute[refute.length - 1];
  console.log(`${t.name}：破解延伸 ${refute.length} 手（走完 ${last ? last.ev : '?'}），上当延伸 ${trap.length} 手`);
}
fs.writeFileSync('src/xiangqi/trickdeep.json', JSON.stringify(result));
console.log(`写入 src/xiangqi/trickdeep.json：${Object.keys(result).length} 条`);
process.exit(0);
