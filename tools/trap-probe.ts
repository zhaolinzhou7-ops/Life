/**
 * 把一条开局线一手一手地深算：每一手走之前，皮卡鱼给出前三名（带分数和主变），
 * 再看实际走的这一手值多少、比首选差多少。写"邪门布局"之前用它找出陷阱到底在哪一步：
 * 哪一手是故意送的、送了以后引擎怎么看（少了子，分却没少多少 = 宁失一子，不失一先）、
 * 被骗的一方是哪一手开始走错、错了多少。
 *
 *   node tools/run.mjs trap-probe "<着法…>" [从第几手开始=0] [每手毫秒=8000]
 * 分数一律写成红方视角（车≈1000），子力差也是红方视角，方便看"少子不少分"。
 */
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, isInCheck, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';
import { moveToUci, uciToMove, parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { PIECE_VALUE } from '../src/xiangqi/teach';

const [, , line = '', fromArg = '0', msArg = '8000', mpvArg = '3'] = process.argv;
const FROM = Number(fromArg);
const MS = Number(msArg);
const MPV = Number(mpvArg);
const e = await startPikafish(256);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const show = (v: number) => (Math.abs(v) > 20000 ? (v > 0 ? `杀${30000 - v}` : `被杀${-30000 - v}`) : String(v));

function material(b: Board): number {
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') s += (p.c === 'r' ? 1 : -1) * PIECE_VALUE[p.t];
  return s;
}

function pvText(start: Board, color: Color, pv: string[], n = 12): string {
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

function search(moves: Move[], only?: Move): { lines: PvLine[]; depth: number } {
  e.send(`setoption name MultiPV value ${only ? 1 : MPV}`);
  e.send(`position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const ls = e.send(`go movetime ${MS}${only ? ` searchmoves ${moveToUci(only)}` : ''}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return { lines: [...by.values()].sort((a, b) => a.multipv - b.multipv), depth: d };
}

const texts = line.split(/\s+/).filter(Boolean);
let b: Board = initialBoard();
let c: Color = 'r';
const played: Move[] = [];
for (let i = 0; i <= texts.length; i++) {
  if (i >= FROM) {
    const sgn = c === 'r' ? 1 : -1;
    const { lines, depth } = search(played);
    const head = `${i + 1}. ${c === 'r' ? '红' : '黑'}${isInCheck(b, c) ? '（被将军）' : ''} 子力差 ${material(b)}｜${depth} 层`;
    console.log(head);
    for (const l of lines) console.log(`     ${l.multipv}) ${show(sgn * val(l))}\t${pvText(b, c, l.pv)}`);
    if (i < texts.length) {
      const m = textToMove(b, c, texts[i], legalMoves(b, c));
      if (!m) {
        console.log(`✗ 走不通：${texts[i]}`);
        process.exit(1);
      }
      const hit = lines.find((l) => l.pv[0] && same(uciToMove(l.pv[0])!, m));
      const v = hit ?? search(played, m).lines[0];
      const loss = lines.length && v ? val(lines[0]) - val(v) : 0;
      console.log(`   → 走 ${texts[i]}：${v ? show(sgn * val(v)) : '?'}（比首选差 ${loss}）${hit ? '' : `\t${v ? pvText(b, c, v.pv) : ''}`}`);
    }
  }
  if (i >= texts.length) break;
  const m = textToMove(b, c, texts[i], legalMoves(b, c))!;
  if (!m) {
    console.log(`✗ 走不通：${texts[i]}`);
    process.exit(1);
  }
  played.push(m);
  b = applyMove(b, m);
  c = c === 'r' ? 'b' : 'r';
}
process.exit(0);
