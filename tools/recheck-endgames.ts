/**
 * 复核残局库的胜和：皮卡鱼双方下到底，用 App 同一个裁判（endings.ts 的 drawOrForfeit）判结果。
 *
 * 为什么要复核：残局库是拿自家引擎下出来定的胜和，那时候下到底的裁判把"三次重复"一律判和，
 * 不管是不是有一方一直在将军。按棋规长将、长捉判负。而且 App 里你的对手是皮卡鱼，不是自家引擎：
 *   - 标"和"的：可能守方是靠长将守住的（按规则守方判负，"守和"题根本守不住），
 *     也可能攻方其实赢得下来、只是引擎来回晃；
 *   - 标"要赢"的：皮卡鱼守得比自家引擎顽强，有的局面它守得住——那你怎么下都赢不了。
 * 皮卡鱼拿到的是开局局面 + 走过的着法，它自己知道长将、长捉、重复局面，走法和 App 里的对手一样。
 *
 * 两档算力各下一遍（层数定死，结果不随机器忙闲变）；结论写成一行一个 JSON，apply-recheck-endgames 再改残局库。
 * 用法：TARGET=draw SHARD=0/4 node tools/run.mjs recheck-endgames（四个分片并行；TARGET=win 复核标"要赢"的）
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { fromFen, toFen } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, statusAfter, type Color, type Move } from '../src/xiangqi/rules';
import { drawOrForfeit, plyRecord, type PlyRecord } from '../src/xiangqi/endings';
import { moveToUci, uciToMove } from '../src/xiangqi/pikafish';
import lib from '../src/xiangqi/endgamelib.json';

interface Entry {
  id: string;
  fen: string;
  you: Color;
  target: string;
  reason: string;
  role?: string;
}

export interface Game {
  result: 'red-win' | 'black-win' | 'draw' | 'error';
  plies: number;
  reason: string;
  moves: string[];
}

const [si, sn] = (process.env.SHARD ?? '0/1').split('/').map(Number);
/** 两档：浅一点、深一点。nodes 封顶，个别局面不会一步算几分钟 */
const BUDGETS = (process.env.BUDGETS ?? 'depth 14 nodes 1500000|depth 18 nodes 4000000').split('|');
/** 下这么多步还没完就停（60 回合不吃子 = 120 步，吃子以后重新数，所以给宽一点） */
const MAX_PLIES = 400;
const TARGET = process.env.TARGET ?? 'draw';
const OUT = `node_modules/.cache/recheck-${TARGET}-${si}.jsonl`;

const e = await startPikafish(64);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

function game(fen: string, go: string): Game {
  const p = fromFen(fen);
  if (!p) return { result: 'error', plies: 0, reason: 'FEN 读不出来', moves: [] };
  let b = p.board;
  let c = p.toMove;
  const startKey = toFen(b, c);
  const plies: PlyRecord[] = [];
  const hist: string[] = [];
  e.send('ucinewgame');
  for (let ply = 0; ; ply++) {
    const st = statusAfter(b, c);
    if (st !== 'playing') return { result: st, plies: ply, reason: '将死/困毙', moves: hist };
    const end = drawOrForfeit(b, startKey, plies);
    if (end) return { result: end.winner === 'r' ? 'red-win' : end.winner === 'b' ? 'black-win' : 'draw', plies: ply, reason: end.reason, moves: hist };
    if (ply >= MAX_PLIES) return { result: 'draw', plies: ply, reason: 'cap', moves: hist };
    e.send(`position fen ${startKey} - - 0 1${hist.length ? ' moves ' + hist.join(' ') : ''}`);
    const bm = e
      .send(`go ${go}`)
      .find((l) => l.startsWith('bestmove'))
      ?.split(/\s+/)[1];
    const m = bm ? uciToMove(bm) : null;
    const legal = legalMoves(b, c).filter((x) => !isInCheck(applyMove(b, x), c));
    if (!m || !legal.some((x) => same(x, m))) return { result: 'error', plies: ply, reason: `引擎给了 ${bm}`, moves: hist };
    const after = applyMove(b, m);
    plies.push(plyRecord(b, m, after));
    hist.push(moveToUci(m));
    b = after;
    c = c === 'r' ? 'b' : 'r';
  }
}

const done = new Set<string>();
if (fs.existsSync(OUT)) for (const l of fs.readFileSync(OUT, 'utf8').split('\n')) if (l.trim()) done.add(JSON.parse(l).id);
const todo = (lib as Entry[]).filter((x) => x.target === TARGET).filter((_, i) => i % sn === si);
let n = 0;
for (const x of todo) {
  n++;
  if (done.has(x.id)) continue;
  const t0 = Date.now();
  const runs = BUDGETS.map((g) => ({ go: g, ...game(x.fen, g) }));
  fs.appendFileSync(OUT, JSON.stringify({ id: x.id, you: x.you, role: x.role, reason: x.reason, runs }) + '\n');
  console.log(`[${si}] ${n}/${todo.length} ${x.id} ${runs.map((r) => `${r.result}/${r.reason}/${r.plies}`).join(' · ')} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
}
console.log(`[${si}] done`);
