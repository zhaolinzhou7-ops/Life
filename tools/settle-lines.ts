/**
 * 谱不能停在兑子半路：最后一手是吃子或将军，对方马上要吃回来、要应将——
 * 这时候说"走到这里红方略好"，盘面上却是红方少一个炮，看谱的人只会糊涂。
 * 这里把布局谱、破解谱里这样收尾的线让皮卡鱼接着走，直到最后一手既不吃子也不将军（最多再走 8 手），
 * 收尾那句局面判断按新的结尾重写。
 *
 *   node tools/run.mjs settle-lines [openings|tricks|all]
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { noteMove } from '../src/xiangqi/movenote';
import { outlookOf } from '../src/xiangqi/plan';
import { TRICKS, lineToTrap } from '../src/xiangqi/tricks';

const WHAT = process.argv[2] ?? 'all';
const MS = 2500;
const MAX_EXTRA = 8;
const e = await startPikafish(256);
const START = toFen(initialBoard(), 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

type M = { t: string; why: string; ev?: number; book?: boolean };

function finalWord(ev: number): string {
  if (Math.abs(ev) < 60) return '走到这里：双方均势';
  return `走到这里：${ev >= 0 ? '红方' : '黑方'}${outlookOf(Math.abs(ev)).replace(/^你/, '')}`;
}

/** 走完 prefix + line，最后一手是吃子或将军就接着走。返回加了几手 */
function settle(prefix: string[], line: M[]): number {
  let b: Board = initialBoard();
  let c: Color = 'r';
  const played: Move[] = [];
  let lastCap = false;
  for (const t of [...prefix, ...line.map((x) => x.t)]) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) throw new Error(`走不通：${t}`);
    lastCap = !!b[m.ty][m.tx];
    played.push(m);
    b = applyMove(b, m);
    c = other(c);
  }
  let added = 0;
  while ((lastCap || isInCheck(b, c)) && added < MAX_EXTRA && statusAfter(b, c) === 'playing') {
    e.send('setoption name MultiPV value 1');
    e.send(`position fen ${START} - - 0 1 moves ${played.map(moveToUci).join(' ')}`);
    const infos = e.send(`go movetime ${MS}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
    const l = infos[infos.length - 1];
    const m = l && uciToMove(l.pv[0]);
    if (!m || !legalMoves(b, c).some((x) => same(x, m))) break;
    const score = l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 : -30000) : l.score;
    line.push({ t: moveToText(b, m), why: noteMove(b, m, c), ev: c === 'r' ? score : -score });
    lastCap = !!b[m.ty][m.tx];
    played.push(m);
    b = applyMove(b, m);
    c = other(c);
    added++;
  }
  return added;
}

let total = 0;
if (WHAT === 'openings' || WHAT === 'all') {
  const OL = 'src/xiangqi/openinglib.json';
  const lib = JSON.parse(fs.readFileSync(OL, 'utf8')) as { id: string; moves: M[]; final: string; variations: { name: string; at: number; moves: M[]; final: string }[] }[];
  for (const o of lib) {
    const n = settle([], o.moves);
    if (n) o.final = finalWord(o.moves[o.moves.length - 1].ev ?? 0);
    total += n;
    if (n) console.log(`${o.id} 主线补了 ${n} 手`);
    for (const v of o.variations) {
      const k = settle(o.moves.slice(0, v.at).map((m) => m.t), v.moves);
      if (k) v.final = finalWord(v.moves[v.moves.length - 1].ev ?? 0);
      total += k;
      if (k) console.log(`${o.id} · ${v.name} 补了 ${k} 手`);
    }
  }
  fs.writeFileSync(OL, JSON.stringify(lib));
}
if (WHAT === 'tricks' || WHAT === 'all') {
  const TD = 'src/xiangqi/trickdeep.json';
  const deep = JSON.parse(fs.readFileSync(TD, 'utf8')) as Record<string, { refute: M[]; trap: M[] }>;
  for (const t of TRICKS) {
    const d = deep[t.id];
    if (!d) continue;
    const n = settle([...t.pre, t.trick.t, ...t.refute.map((s) => s.t)], d.refute);
    const k = settle([...lineToTrap(t), ...t.trap.map((s) => s.t)], d.trap);
    total += n + k;
    if (n + k) console.log(`${t.id} 破解补了 ${n} 手、上当补了 ${k} 手`);
  }
  fs.writeFileSync(TD, JSON.stringify(deep));
}
console.log(`一共补了 ${total} 手`);
process.exit(0);
