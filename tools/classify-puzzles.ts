/**
 * 给每道题定"题目要求"：让皮卡鱼看这道题的正解到底在干什么。
 *
 * 原来按题型写死提问：战术题一律"找出赢子的一手"。可很多战术题的局面里走棋方本来就落后，
 * 正解是最顽强的防守、或者唯一不丢子的一手——问"赢子"就是在误导，用户照着找当然找不到。
 * 这里逐题判：
 *   mate    正解走下去是杀棋
 *   defend  走完正解，走棋方还是明显落后（在防守）
 *   win     正解那一串净赚子力，而且走完局面占优
 *   only    正解是唯一站得住的一手（第二好的差出一个半兵以上）
 *   best    以上都不是：就是这个局面里最好的一手
 * 同时标出皮卡鱼不认可的题（正解比它的首选差出一个半兵以上），入库时剔掉或者改正。
 * 用法：node tools/run.mjs classify-puzzles <分片号> <分片数>
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, legalMoves, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { fromFen, moveToText, textToMove } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { PIECE_VALUE } from '../src/xiangqi/teach';

const [, , shardS = '0', nS = '1', msS = '700'] = process.argv;
const shard = Number(shardS);
const n = Number(nS);
const MS = Number(msS);
const all = JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')) as {
  id: string;
  kind: string;
  fen: string;
  answer: string;
  line: string[];
  mateIn?: number;
  also?: string[];
}[];
const mine = all.filter((_, i) => i % n === shard);
const e = await startPikafish(64);
const out = fs.createWriteStream(`node_modules/.cache/classify-${shard}.jsonl`);
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

function lines(fen: string, extra = ''): PvLine[] {
  e.send(`position fen ${fen} - - 0 1`);
  const got = e.send(`go movetime ${MS}${extra}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(0, ...got.map((l) => l.depth));
  const best = new Map<number, PvLine>();
  for (const l of got) if (l.depth >= depth - 1) {
    const had = best.get(l.multipv);
    if (!had || l.depth >= had.depth) best.set(l.multipv, l);
  }
  return [...best.values()].sort((a, b) => a.multipv - b.multipv);
}

let done = 0;
for (const p of mine) {
  const parsed = fromFen(p.fen);
  if (!parsed) continue;
  const b: Board = parsed.board;
  const c: Color = parsed.toMove;
  const ans = textToMove(b, c, p.answer, legalMoves(b, c));
  if (!ans) {
    out.write(JSON.stringify({ id: p.id, err: 'answer' }) + '\n');
    continue;
  }
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 3');
  const top = lines(p.fen);
  e.send('setoption name MultiPV value 1');
  const s1 = top[0] ? val(top[0]) : 0;
  const s2 = top[1] ? val(top[1]) : -99999;
  const bestMove = top[0] ? uciToMove(top[0].pv[0]) : null;
  const okMoves = [p.answer, ...(p.also ?? [])];
  let sa: number;
  const inTop = top.find((l) => {
    const m = uciToMove(l.pv[0]);
    return m && okMoves.includes(moveToText(b, m));
  });
  if (inTop) sa = val(inTop);
  else {
    const one = lines(p.fen, ` searchmoves ${moveToUci(ans)}`);
    sa = one[0] ? val(one[0]) : -99999;
  }
  // 正解那一串的子力得失（走棋方视角）
  let cur = b;
  let cc = c;
  let gain = 0;
  for (const t of p.line.slice(0, 6)) {
    const m = textToMove(cur, cc, t, legalMoves(cur, cc));
    if (!m) break;
    const cap = cur[m.ty][m.tx];
    if (cap && cap.t !== 'K') gain += (cc === c ? 1 : -1) * PIECE_VALUE[cap.t];
    cur = applyMove(cur, m);
    cc = cc === 'r' ? 'b' : 'r';
  }
  const answerIsBest = !!bestMove && (same(bestMove, ans) || okMoves.includes(moveToText(b, bestMove)));
  const gap = answerIsBest ? s1 - s2 : 0;
  let goal: string;
  if (sa >= 29000 || p.mateIn) goal = 'mate';
  else if (sa <= -300) goal = 'defend';
  else if (gain >= 200 && sa >= 150) goal = 'win';
  else if (answerIsBest && gap >= 150) goal = 'only';
  else goal = 'best';
  const bad = s1 - sa > 150 && !(sa >= 29000);
  out.write(
    JSON.stringify({
      id: p.id,
      kind: p.kind,
      goal,
      s1,
      s2,
      sa,
      gain,
      gap,
      bad,
      pika: bestMove ? moveToText(b, bestMove) : null,
      depth: top[0]?.depth,
    }) + '\n',
  );
  if (++done % 50 === 0) console.log(`shard ${shard}: ${done}/${mine.length}`);
}
out.end();
console.log(`shard ${shard} done ${done}`);
