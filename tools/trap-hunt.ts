/**
 * 找陷阱：沿着一条江湖套路的骨架往下走，在被骗一方的每一步上，
 * 比一比"浅算看着好"和"深算真正好"——
 *
 *   - 浅算（几层）挑出来的前几名 + 所有吃子、将军的着法：这是人一眼会想走的；
 *   - 每一个再深算（默认 12 秒）：比深算首选差 1.5 个兵以上、浅算却排在前面的，就是坑。
 *
 * 套路的精髓"宁失一子，不失一先"也从这里看：每一步打印子力差（红方视角）和深算分——
 * 子力少了、分没少，就是对方拿子换来了先手。
 *
 *   node tools/run.mjs trap-hunt "<骨架着法…>" <被骗方 r|b> [深算毫秒=12000] [浅算层数=4]
 */
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, isInCheck, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';
import { moveToUci, uciToMove, parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { PIECE_VALUE } from '../src/xiangqi/teach';

const [, , line = '', victimArg = 'b', msArg = '12000', shallowArg = '4'] = process.argv;
const VICTIM = victimArg as Color;
const MS = Number(msArg);
const SHALLOW = Number(shallowArg);
const e = await startPikafish(256);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const show = (v: number) => (Math.abs(v) > 20000 ? (v > 0 ? `杀${30000 - v}` : `被杀${-30000 - v}`) : String(v));
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

function material(b: Board): number {
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') s += (p.c === 'r' ? 1 : -1) * PIECE_VALUE[p.t];
  return s;
}

function pvText(start: Board, color: Color, pv: string[], n = 14): string {
  let cur = start;
  let cc = color;
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    const m = uciToMove(u);
    if (!m || !legalMoves(cur, cc).some((x) => same(x, m))) break;
    out.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    cc = cc === 'r' ? 'b' : 'r';
  }
  return out.join(' ');
}

const pos = (moves: Move[]) => `position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`;
function lastLines(out: string[]): PvLine[] {
  const ls = out.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}
function deep(moves: Move[], only?: Move, ms = MS): PvLine | undefined {
  e.send('setoption name MultiPV value 1');
  e.send(pos(moves));
  return lastLines(e.send(`go movetime ${ms}${only ? ` searchmoves ${moveToUci(only)}` : ''}`))[0];
}
function shallow(moves: Move[], n: number): PvLine[] {
  e.send(`setoption name MultiPV value ${n}`);
  e.send(pos(moves));
  return lastLines(e.send(`go depth ${SHALLOW}`));
}

const texts = line.split(/\s+/).filter(Boolean);
let b: Board = initialBoard();
let c: Color = 'r';
const played: Move[] = [];
for (let i = 0; i <= texts.length; i++) {
  if (c === VICTIM) {
    e.send('ucinewgame');
    const sgn = c === 'r' ? 1 : -1;
    const best = deep(played)!;
    const sh = shallow(played, 6);
    const cands: Move[] = [];
    for (const l of sh) {
      const m = uciToMove(l.pv[0]);
      if (m && !cands.some((x) => same(x, m))) cands.push(m);
    }
    for (const m of legal(b, c)) {
      const t = b[m.ty][m.tx];
      const after = applyMove(b, m);
      if ((t || isInCheck(after, c === 'r' ? 'b' : 'r')) && !cands.some((x) => same(x, m))) cands.push(m);
    }
    console.log(
      `\n${i + 1}. ${c === 'r' ? '红' : '黑'}（被骗方）子力差 ${material(b)}｜深算首选 ${show(sgn * val(best))}：${pvText(b, c, best.pv)}`,
    );
    for (const m of cands) {
      const r = same(m, uciToMove(best.pv[0])!) ? best : deep(played, m, Math.round(MS / 2));
      if (!r) continue;
      const loss = val(best) - val(r);
      const rank = sh.findIndex((l) => same(uciToMove(l.pv[0])!, m));
      const tag = loss >= 150 ? (rank >= 0 && rank < 3 ? '【坑：浅算前三】' : '【亏】') : '';
      console.log(
        `   ${moveToText(b, m)}\t深 ${show(sgn * val(r))}（差 ${loss}）浅排 ${rank >= 0 ? rank + 1 : '-'}${tag}\t${loss >= 150 ? pvText(b, c, r.pv) : ''}`,
      );
    }
    if (i < texts.length) console.log(`   → 骨架走 ${texts[i]}`);
  } else if (i < texts.length) {
    console.log(`${i + 1}. ${c === 'r' ? '红' : '黑'}（设套方）走 ${texts[i]}｜子力差 ${material(b)}`);
  }
  if (i >= texts.length) break;
  const m = textToMove(b, c, texts[i], legalMoves(b, c));
  if (!m) {
    console.log(`✗ 走不通：${texts[i]}`);
    process.exit(1);
  }
  played.push(m);
  b = applyMove(b, m);
  c = c === 'r' ? 'b' : 'r';
}
process.exit(0);
