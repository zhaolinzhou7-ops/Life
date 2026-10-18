/**
 * 最高几档到底漏不漏：从自对弈里抽中局局面，让候选配置（按节点数）各选一手，
 * 再用深得多的搜索复核这一手比最好的亏多少。
 *
 * 用户原话："现在最强的教练和棋王级别的对手，感觉还是会走漏招、错招。最高水平的应该没有漏招才对，每一步都必须精准。"
 * 棋王原来按时间算 3 秒：电脑上是 45 万节点，手机上只有一二十万——同一档在手机上弱一截。
 * 这里量的是"多少节点才算得准"：亏 100 分（一个兵）以上算错招，亏 300 分以上算漏招。
 *
 * 用法：node tools/run.mjs top-level-check <分片号> <分片数> [局面数]
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, isInCheck, legalMoves, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { toFen } from '../src/xiangqi/notation';

const [, , a0 = '0', a1 = '1', a2 = '24'] = process.argv;
const shard = Number(a0);
const nShards = Number(a1);
const WANT = Number(a2);
const e = await startPikafish(64);
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const key = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;

function go(fen: string, cmd: string): PvLine[] {
  e.send(`position fen ${fen} - - 0 1`);
  const got = e.send(cmd).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(0, ...got.map((l) => l.depth));
  const best = new Map<number, PvLine>();
  for (const l of got)
    if (l.depth >= depth - 1) {
      const had = best.get(l.multipv);
      if (!had || l.depth >= had.depth) best.set(l.multipv, l);
    }
  return [...best.values()].sort((a, b) => a.multipv - b.multipv);
}

let seed = 1000 + shard * 7919;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

// 1. 自对弈攒局面：前几手随机一点（前 4 名里挑），中局每 5 步取一个
const positions: { fen: string; board: Board; color: Color }[] = [];
let game = 0;
while (positions.length < WANT) {
  game++;
  let b = initialBoard();
  let c: Color = 'r';
  for (let ply = 0; ply < 110; ply++) {
    const legal = legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
    if (!legal.length) break;
    e.send('setoption name MultiPV value 4');
    const lines = go(toFen(b, c), 'go nodes 30000');
    e.send('setoption name MultiPV value 1');
    const cands = lines.map((l) => ({ m: uciToMove(l.pv[0]), s: val(l) })).filter((x) => x.m && legal.some((y) => key(y) === key(x.m!)));
    if (!cands.length) break;
    // 前 4 名里按分差挑（差得多的少挑），棋才会多样
    const top = cands[0].s;
    const pool = cands.filter((x) => top - x.s <= (ply < 16 ? 60 : 30));
    const pick = pool[Math.floor(rnd() * pool.length)].m!;
    b = applyMove(b, pick);
    c = c === 'r' ? 'b' : 'r';
    if (ply >= 18 && ply % 5 === (game + shard) % 5 && positions.length < WANT) positions.push({ fen: toFen(b, c), board: b, color: c });
    if (Math.abs(top) > 2500) break;
  }
}

// 2. 候选配置各选一手；3. 深搜复核
const CANDS = [
  { id: '手机3秒≈20万', go: 'go nodes 200000' },
  { id: '电脑3秒≈45万', go: 'go nodes 450000' },
  { id: '100万', go: 'go nodes 1000000' },
  { id: '200万', go: 'go nodes 2000000' },
];
const REF = 'go nodes 4000000';
const out: string[] = [];
for (const p of positions) {
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 1');
  const picks = CANDS.map((cfg) => {
    e.send('ucinewgame');
    const l = go(p.fen, cfg.go)[0];
    return l ? uciToMove(l.pv[0]) : null;
  });
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 3');
  const ref = go(p.fen, REF);
  e.send('setoption name MultiPV value 1');
  if (!ref.length) continue;
  const bestS = val(ref[0]);
  const loss = picks.map((m) => {
    if (!m) return null;
    const inRef = ref.find((l) => uciToMove(l.pv[0]) && key(uciToMove(l.pv[0])!) === key(m));
    if (inRef) return Math.max(0, bestS - val(inRef));
    const one = go(p.fen, `go nodes 2000000 searchmoves ${moveToUci(m)}`)[0];
    return one ? Math.max(0, bestS - val(one)) : null;
  });
  out.push(JSON.stringify({ fen: p.fen, best: bestS, loss }));
  console.log(`shard ${shard}: ${out.length}/${positions.length} loss=${loss.join(',')}`);
}
fs.writeFileSync(`node_modules/.cache/toplevel-${shard}.jsonl`, out.join('\n') + '\n');
console.log(`shard ${shard} done`);
process.exit(0);
