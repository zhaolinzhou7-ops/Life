/**
 * 解杀题：对方下一步就要杀你，只有一步守得住。
 *
 * 用户原话："残棋和练习的题目更新多一点……低级题目太多"。眼力题（safety）191 道里 161 道不到 900 分：
 * 原来的眼力题都是"有个子被捉了，挪开或者保护"，一眼就看得出来。
 * 实战里真正要命的是没看见对方的杀——私教"漏将""漏看威胁"两课要的正是这种题。
 *
 * 做法（每一条都是硬条件）：
 *   1. 随机摆一个对攻局面：黑方两到四个进攻子压在红方九宫附近，红方一两个进攻子在黑方那边，双方士象随机缺；
 *      红先，开局谁都不被将军，将帅不照面；
 *   2. 威胁是真的：假如轮到黑方走，皮卡鱼找得到 1～3 步杀；
 *   3. 只有一步守得住：红方最好的一手不输（≥ -300 分、不被杀），第二好的一手被杀或者亏五个兵以上——
 *      先快看（3 万节点），再深算（30 万节点、前三名）复核；红方自己没有杀（那是杀法题、绝地反杀，不是解杀）；
 *   4. 难度用和其它题同一把尺子（rate-difficulty），再按威胁几步杀保底（见下面）；题面不提醒"他要杀你"。
 *
 *   node tools/run.mjs gen-defense <分片号> [要几道]
 * 输出 node_modules/.cache/defense-<分片>.jsonl（追加；容器重启后接着跑）
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
const OUT = `node_modules/.cache/defense-${SHARD}.jsonl`;
const prior = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim()).length : 0;
const e = await startPikafish(64);

const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T,>(a: T[]) => a[rnd(a.length)];
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);

/** 黑方的进攻子（压在红方九宫附近） */
const ATTACK: PType[][] = [
  ['R', 'H'],
  ['R', 'C'],
  ['H', 'C'],
  ['R', 'R'],
  ['H', 'H', 'C'],
  ['R', 'H', 'C'],
  ['C', 'C', 'H'],
  ['R', 'P', 'P'],
  ['H', 'C', 'P'],
  ['R', 'C', 'P'],
];
/** 红方自己的进攻子（在黑方那边，也有反击） */
const COUNTER: PType[][] = [['R'], ['H'], ['C'], ['R', 'P'], ['H', 'C'], ['R', 'H'], ['C', 'P'], ['R', 'C']];

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
  if (!tryPut('K', 'r', () => [3 + rnd(3), 9 - (rnd(3) === 2 ? 1 : rnd(2))])) return null;
  if (!tryPut('K', 'b', () => [3 + rnd(3), rnd(3) === 2 ? 1 : rnd(2)])) return null;
  const guards = (c: Color, most: number) => {
    const flip = (p: number[]): [number, number] => (c === 'b' ? [p[0], p[1]] : [p[0], 9 - p[1]]);
    for (let i = rnd(most + 1); i > 0; i--) tryPut('A', c, () => flip(pick(BLACK_ADVISOR)));
    for (let i = rnd(most + 1); i > 0; i--) tryPut('E', c, () => flip(pick(BLACK_ELEPHANT)));
  };
  // 守方（红）士象多留一点：守得住才有题
  guards('r', 2);
  guards('b', 2);
  // 黑方进攻子：红方半边、九宫附近（黑卒过了河）
  for (const t of pick(ATTACK)) {
    const ok = tryPut(t, 'b', () => (t === 'P' ? [2 + rnd(5), 6 + rnd(3)] : [rnd(3) === 0 ? rnd(9) : 2 + rnd(5), 4 + rnd(6)]));
    if (!ok) return null;
  }
  // 红方反击子：黑方半边
  for (const t of pick(COUNTER)) {
    const ok = tryPut(t, 'r', () => (t === 'P' ? [rnd(9), 1 + rnd(4)] : [rnd(9), rnd(7)]));
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

/** 最好的一手守得住、第二好的守不住，红方自己也没有杀 */
const onlyHold = (ls: PvLine[]) =>
  ls.length >= 2 && ls[0].mateIn === undefined && ls[0].score >= -300 && (ls[1].mateIn !== undefined ? ls[1].mateIn < 0 : val(ls[1]) <= ls[0].score - 500);

let found = prior;
let tries = 0;
/** 每一关过了多少（DEBUG=1 时每 50 个局面写一行到 defense-debug.txt） */
const stage = { placed: 0, threat: 0, quick: 0, deep: 0 };
const t0 = Date.now();
while (found - prior < WANT) {
  tries++;
  if (process.env.DEBUG && tries % 50 === 0) fs.appendFileSync('node_modules/.cache/defense-debug.txt', JSON.stringify({ tries, ...stage }) + '\n');
  const b = place();
  if (!b) continue;
  stage.placed++;
  const fen = toFen(b, 'r');
  e.send('ucinewgame');
  // 威胁是真的：轮到黑方走的话，黑方 1～3 步杀
  const threat = search(toFen(b, 'b'), 1, 'nodes 30000')[0];
  if (!threat || threat.mateIn === undefined || threat.mateIn < 1 || threat.mateIn > 3) continue;
  stage.threat++;
  if (!onlyHold(search(fen, 2, 'nodes 30000'))) continue;
  stage.quick++;
  const d = search(fen, 3, 'nodes 300000');
  if (!onlyHold(d)) continue;
  stage.deep++;
  const line: string[] = [];
  let cur = b;
  let c: Color = 'r';
  for (const u of d[0].pv.slice(0, 3)) {
    const m = uciToMove(u);
    if (!m || !legalMoves(cur, c).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)) break;
    line.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    c = c === 'r' ? 'b' : 'r';
  }
  if (line.length % 2 === 0) line.pop();
  if (!line.length) continue;
  // 难度：rate-difficulty 看的是浅层搜索里正解排第几——引擎浅算就看得见对方一两步的杀，于是解杀题几乎都被它判成入门题
  // （试跑 7 道全在 900 以下）。人不一样：实战里没人提醒"他要杀你了"，威胁越长越看不见。
  // 所以按威胁的步数保底（和杀法题按步数保底一个道理），题面也不说"他要杀你"，要你自己看出来
  const rating = Math.min(2200, Math.max(rateDifficulty(b, 'r', line[0]), 850 + (threat.mateIn - 1) * 180));
  found++;
  const rec = {
    id: `df-${SHARD}-${found}`,
    kind: 'safety',
    fen,
    answer: line[0],
    line,
    rating,
    goal: 'only',
    prompt: '轮到你走。只有一步守得住，找出来',
    threat: threat.mateIn,
    ev: d[0].score,
    ev2: Math.max(-3000, val(d[1])),
  };
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
  console.log(`[${found - prior}/${WANT}] 试了 ${tries} 个（${Math.round((Date.now() - t0) / 1000)} 秒）：威胁 ${threat.mateIn} 步杀，难度 ${rating}，最好 ${d[0].score} 第二 ${val(d[1])}：${line.join(' ')}`);
}
console.log(`分片 ${SHARD}：新增 ${found - prior} 道`);
process.exit(0);
