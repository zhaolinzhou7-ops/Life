/**
 * 杀法题第二批：**对方子力还在**的几步杀。
 *
 * 用户原话："残棋和练习的题目更新多一点参考其他象棋软件。不要太多重复……低级题目太多"。
 * 题库里的杀法题原来 365 道，对方只剩将士象（一眼必胜）的那 332 道早就不出了，能出的只剩 77 道。
 * 天天象棋这类软件的杀法练习是成百上千的"几步杀"，对方的车马炮都在、自己的帅也在挨打——那才要真算。
 *
 * 做法（每一条都是硬条件）：
 *   1. 随机摆一个攻杀局面：红方两到四个进攻子压在黑方九宫附近，黑方一两个进攻子在红方这边（不是光将、不是只剩士象），
 *      双方士象随机缺；红先，开局谁都不被将军，将帅不照面；
 *   2. 皮卡鱼快看一眼（3 万节点）有没有 2～6 步杀；有，再深算（30 万节点、前两名）：
 *      首选是 N 步杀，第二好的一手不能也在 N+1 步内杀——第一手是关键，不是随便将几下都行；
 *   3. 主变一手一手按规则走完，要真的将死；不够长就让皮卡鱼接着走（守方每一步都是最顽强的应法）；
 *   4. 难度：和其它题同一把尺子（rate-difficulty：正解在浅层搜索里排第几、是不是安静着法），几步杀保底。
 *
 *   node tools/run.mjs gen-mates2 <分片号> [要几道]
 * 输出 node_modules/.cache/mates2-<分片>.jsonl（追加；容器重启后接着跑）
 */
import fs from 'node:fs';
import { startPikafish } from './pikafish-node';
import { applyMove, isInCheck, kingsFacing, legalMoves, statusAfter, type Board, type Color, type PType } from '../src/xiangqi/rules';
import { moveToText, toFen } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { rateDifficulty } from './rate-difficulty';
import { BLACK_ADVISOR, BLACK_ELEPHANT } from './endgame-place';

const [, , shardArg = '0', wantArg = '200'] = process.argv;
const SHARD = Number(shardArg);
const WANT = Number(wantArg);
const OUT = `node_modules/.cache/mates2-${SHARD}.jsonl`;
const prior = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
const e = await startPikafish(64);

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];

/** 红方的进攻子组合（两到四个） */
const ATTACK: PType[][] = [
  ['R', 'H'],
  ['R', 'C'],
  ['H', 'C'],
  ['R', 'R'],
  ['H', 'H', 'C'],
  ['R', 'H', 'C'],
  ['C', 'C', 'H'],
  ['R', 'P'],
  ['H', 'C', 'P'],
  ['R', 'C', 'P'],
  ['R', 'H', 'P'],
  ['H', 'H'],
  ['C', 'C', 'R'],
  ['R', 'H', 'H'],
];
/** 黑方自己的进攻子（压在红方这边，不是光将） */
const DEFENSE: PType[][] = [['R'], ['H'], ['C'], ['P', 'P'], ['R', 'P'], ['H', 'C'], ['R', 'H'], ['C', 'P']];

function place(): Board | null {
  const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const put = (t: PType, c: Color, x: number, y: number) => {
    if (x < 0 || x > 8 || y < 0 || y > 9 || b[y][x]) return false;
    b[y][x] = { t, c };
    return true;
  };
  const tryPut = (t: PType, c: Color, gen: () => [number, number]) => {
    for (let k = 0; k < 40; k++) {
      const [x, y] = gen();
      if (put(t, c, x, y)) return true;
    }
    return false;
  };
  // 将帅
  if (!tryPut('K', 'b', () => [3 + rnd(3), rnd(3) === 2 ? 1 : rnd(2)])) return null;
  if (!tryPut('K', 'r', () => [3 + rnd(3), 9 - (rnd(3) === 2 ? 1 : rnd(2))])) return null;
  // 士象：各自随机缺
  const guards = (c: Color) => {
    const flip = (p: number[]): [number, number] => (c === 'b' ? [p[0], p[1]] : [p[0], 9 - p[1]]);
    for (let i = rnd(3); i > 0; i--) tryPut('A', c, () => flip(pick(BLACK_ADVISOR)));
    for (let i = rnd(3); i > 0; i--) tryPut('E', c, () => flip(pick(BLACK_ELEPHANT)));
  };
  guards('b');
  guards('r');
  // 红方进攻子：压在黑方半边、九宫附近
  for (const t of pick(ATTACK)) {
    const ok = tryPut(t, 'r', () => (t === 'P' ? [2 + rnd(5), rnd(4)] : [rnd(3) === 0 ? rnd(9) : 2 + rnd(5), rnd(6)]));
    if (!ok) return null;
  }
  // 黑方进攻子：在红方这边（黑卒要过了河）
  for (const t of pick(DEFENSE)) {
    const ok = tryPut(t, 'b', () => (t === 'P' ? [rnd(9), 5 + rnd(4)] : [rnd(9), 3 + rnd(7)]));
    if (!ok) return null;
  }
  if (kingsFacing(b)) return null;
  if (isInCheck(b, 'b') || isInCheck(b, 'r')) return null;
  if (statusAfter(b, 'r') !== 'playing') return null;
  return b;
}

function search(fen: string, multipv: number, go: string): PvLine[] {
  e.send(`setoption name MultiPV value ${multipv}`);
  e.send(`position fen ${fen} - - 0 1`);
  const ls = e.send(`go ${go}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}

let found = prior;
let tries = 0;
const t0 = Date.now();
while (found - prior < WANT) {
  tries++;
  const b = place();
  if (!b) continue;
  const fen = toFen(b, 'r');
  e.send('ucinewgame');
  const q = search(fen, 1, 'nodes 30000');
  const m0 = q[0]?.mateIn;
  if (m0 === undefined || m0 < 2 || m0 > 6) continue;
  const d = search(fen, 2, 'nodes 300000');
  const n = d[0]?.mateIn;
  if (n === undefined || n < 2 || n > 6) continue;
  // 第一手是关键：第二好的一手不能也在 N+1 步内杀
  if (d[1]?.mateIn !== undefined && d[1].mateIn > 0 && d[1].mateIn <= n + 1) continue;
  // 主变：按规则走到将死；不够长就让皮卡鱼接着走
  let cur = b;
  let c: Color = 'r';
  const line: string[] = [];
  let pv = [...d[0].pv];
  let ok = true;
  for (let ply = 0; ply < 2 * n - 1; ply++) {
    if (!pv.length) {
      const nx = search(toFen(cur, c), 1, 'nodes 150000');
      pv = [...(nx[0]?.pv ?? [])];
    }
    const m = pv.length ? uciToMove(pv.shift()!) : null;
    if (!m || !legalMoves(cur, c).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)) {
      ok = false;
      break;
    }
    line.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    c = c === 'r' ? 'b' : 'r';
    if (statusAfter(cur, c) !== 'playing') break;
  }
  if (!ok || statusAfter(cur, c) === 'playing' || line.length % 2 === 0) continue;
  const mateIn = Math.ceil(line.length / 2);
  const rating = rateDifficulty(b, 'r', line[0], mateIn);
  found++;
  const rec = { id: `mt2-${SHARD}-${found}`, kind: 'mate', fen, answer: line[0], line, mateIn, rating, goal: 'mate', ev: 3000 };
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
  console.log(`[${found - prior}/${WANT}] 试了 ${tries} 个（${Math.round((Date.now() - t0) / 1000)} 秒）：${mateIn} 步杀，难度 ${rating}：${line.join(' ')}`);
}
console.log(`分片 ${SHARD}：新增 ${found - prior} 道`);
process.exit(0);
