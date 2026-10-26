/**
 * 深算一个局面里的几手：每一手单独搜到指定层数（searchmoves），再让皮卡鱼两边对下到底，看最后是谁赢。
 *
 * 用户原话："这个局面错误的走法最后红方能把黑方杀掉，但正确的走法走完之后发现是均势。我觉得要从深度思考的决定、
 * 从最终的结果，再去判定这个走法合不合适。"——查单道题用这个；全题库复核用 deep-audit。
 *
 *   node tools/run.mjs deep-probe '<fen>' '<着法,着法,…>' '<候选,候选,…>' [层数=22] [下到底每手节点=400000]
 *   着法：从题目局面先走的几手（中文记谱，可以空）；候选：走到那里以后要比的几手（空 = 引擎前三名）
 */
import { startPikafish } from './pikafish-node';
import { parseInfo, moveToUci, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { fromFen, moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';

const [, , fen0, pre = '', cands = '', d0 = '22', n0 = '400000'] = process.argv;
const DEPTH = Number(d0);
const NODES = Number(n0);
const e = await startPikafish(256);
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

const p = fromFen(fen0);
if (!p) throw new Error('局面读不出来');
let b = p.board;
let c = p.toMove;
for (const t of pre.split(',').filter(Boolean)) {
  const m = textToMove(b, c, t, legal(b, c));
  if (!m) throw new Error(`走不出 ${t}`);
  b = applyMove(b, m);
  c = other(c);
}
const fen = toFen(b, c);
console.log(`局面：${fen}（${c === 'r' ? '红' : '黑'}走）`);

const pvText = (start: Board, side: Color, pv: string[], n = 14) => {
  let bb = start;
  let cc = side;
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    const m = uciToMove(u);
    if (!m) break;
    out.push(moveToText(bb, m));
    bb = applyMove(bb, m);
    cc = other(cc);
  }
  return out.join(' ');
};

function search(f: string, cmd: string): PvLine[] {
  e.send('ucinewgame');
  e.send(`position fen ${f} - - 0 1`);
  return e.send(cmd).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
}

let list: Move[] = [];
if (cands) {
  for (const t of cands.split(',')) {
    const m = textToMove(b, c, t, legal(b, c));
    if (!m) throw new Error(`走不出 ${t}`);
    list.push(m);
  }
} else {
  e.send('setoption name MultiPV value 3');
  const got = search(fen, `go depth ${Math.min(DEPTH, 18)}`);
  e.send('setoption name MultiPV value 1');
  const dmax = Math.max(...got.map((l) => l.depth));
  list = got.filter((l) => l.depth === dmax).map((l) => uciToMove(l.pv[0])!);
}

for (const m of list) {
  const t = moveToText(b, m);
  const t0 = Date.now();
  const got = search(fen, `go depth ${DEPTH} searchmoves ${moveToUci(m)}`);
  const last = got[got.length - 1];
  // 分数是走棋方视角（车≈1000）
  const sc = last.mateIn !== undefined ? `${last.mateIn > 0 ? '' : '被'}${Math.abs(last.mateIn)} 步杀` : `${last.score}`;
  console.log(`\n${t}：${DEPTH} 层 ${sc}（${((Date.now() - t0) / 1000).toFixed(0)} 秒）\n  主变：${pvText(b, c, last.pv)}`);
  // 两边对下到底
  let bb = applyMove(b, m);
  let cc = other(c);
  const seen = new Map<string, number>();
  let quiet = 0;
  let res = '';
  const moves: string[] = [t];
  for (let ply = 1; ply < 240; ply++) {
    if (statusAfter(bb, cc) !== 'playing') {
      res = `${cc === 'r' ? '红' : '黑'}被将死（第 ${ply} 手）`;
      break;
    }
    const g = search(toFen(bb, cc), `go nodes ${NODES}`);
    const mv = uciToMove(g[g.length - 1].pv[0])!;
    const cap = !!bb[mv.ty][mv.tx];
    moves.push(moveToText(bb, mv));
    bb = applyMove(bb, mv);
    cc = other(cc);
    quiet = cap ? 0 : quiet + 1;
    const k = toFen(bb, cc);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (seen.get(k)! >= 3) {
      res = `三次重复（第 ${ply} 手）`;
      break;
    }
    if (quiet >= 120) {
      res = `60 回合不吃子（第 ${ply} 手）`;
      break;
    }
  }
  console.log(`  下到底：${res || '240 手还没完'}\n  ${moves.join(' ')}`);
}
