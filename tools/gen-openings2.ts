/**
 * 布局题第二批：从真实的布局谱出发，一方走软一手，另一方"只有这一手"。
 *
 * 用户原话："残棋和练习的题目更新多一点……低级题目太多"。布局题原来能出 112 道，89 道不到 900 分，
 * 而且不少局面子已经兑得差不多了，不像开局。
 *
 * 做法（每一条都是硬条件）：
 *   1. 开局取自题库里的 20 套布局（openinglib 主线 + openingvars 里各个回合的改走），随机走到第 4～20 手；
 *   2. 接着让皮卡鱼按"会犯错的人"走一两手：多数时候走前几名里的一手，有时候走差一截的（亏 80～400 分）——
 *      实战里布局阶段的错就是这么来的；
 *   3. 每走一手看轮到的一方有没有"只有这一手"：
 *        抓住对方的软着：最好的一手领先 2 个兵以上，第二好的差 2 个兵以上（goal best，题面"开局这一手该怎么走"）；
 *        守住：最好的一手大体均势，第二好的亏 2.5 个兵以上（goal only）；
 *      先快看（4 万节点、前两名），再深算（2 秒、前两名）复核；有杀的不要（那是杀法题）；
 *   4. 难度用和其它题同一把尺子（rate-difficulty），不到 850 的不收。
 *
 *   node tools/run.mjs gen-openings2 <分片号> [要几道]
 * 输出 node_modules/.cache/openings2-<分片>.jsonl（追加；容器重启后接着跑）
 */
import fs from 'node:fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { rateDifficulty } from './rate-difficulty';

const [, , shardArg = '0', wantArg = '200'] = process.argv;
const SHARD = Number(shardArg);
const WANT = Number(wantArg);
const OUT = `node_modules/.cache/openings2-${SHARD}.jsonl`;
const prior = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8').split('\n').filter((l) => l.trim()) : [];
const seen = new Set(prior.map((l) => (JSON.parse(l) as { fen: string }).fen));
const e = await startPikafish(64);

const rnd = (n: number) => Math.floor(Math.random() * n);
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const START = toFen(initialBoard(), 'r');

// 布局谱：主线 + 每个改走（改走之前的部分沿用主线）
type Lib = { id: string; moves: { t: string }[] };
type Vars = Record<string, { extra?: { at: number; moves: ({ t: string } | null)[] }[] }>;
const lib = JSON.parse(fs.readFileSync('src/xiangqi/openinglib.json', 'utf8')) as Lib[];
const vars = JSON.parse(fs.readFileSync('src/xiangqi/openingvars.json', 'utf8')) as Vars;
const LINES: string[][] = [];
for (const o of lib) {
  const main = o.moves.map((m) => m.t);
  LINES.push(main);
  for (const x of vars[o.id]?.extra ?? []) LINES.push([...main.slice(0, x.at), ...x.moves.filter((m): m is { t: string } => !!m).map((m) => m.t)]);
}

function search(moves: Move[], multipv: number, go: string): PvLine[] {
  e.send(`setoption name MultiPV value ${multipv}`);
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const ls = e.send(`go ${go}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}

type Kind = 'best' | 'only';
function verdict(ls: PvLine[]): Kind | null {
  if (ls.length < 2 || ls[0].mateIn !== undefined) return null;
  const v0 = val(ls[0]);
  const v1 = val(ls[1]);
  if (v0 >= 200 && v0 - v1 >= 200) return 'best';
  if (Math.abs(v0) <= 120 && v1 <= v0 - 250) return 'only';
  return null;
}

let found = prior.length;
let tries = 0;
/** 每一关过了多少（DEBUG=1 时每 20 盘写一行到 openings2-debug.txt） */
const stage = { probe: 0, quick: 0, deep: 0, easy: 0 };
const t0 = Date.now();
while (found - prior.length < WANT) {
  tries++;
  if (process.env.DEBUG && tries % 20 === 0) fs.appendFileSync('node_modules/.cache/openings2-debug.txt', JSON.stringify({ tries, ...stage }) + '\n');
  const line = LINES[rnd(LINES.length)];
  const cut = 4 + rnd(Math.max(1, Math.min(line.length, 20) - 3));
  let b: Board = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  let ok = true;
  for (const t of line.slice(0, cut)) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) {
      ok = false;
      break;
    }
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  if (!ok) continue;
  e.send('ucinewgame');
  // 会犯错的人走一两手，每走一手看一次
  for (let k = 0; k < 2 && statusAfter(b, c) === 'playing'; k++) {
    const ls = search(moves, 4, 'nodes 20000');
    if (!ls.length) break;
    const best = val(ls[0]);
    const soft = ls.filter((l) => best - val(l) >= 80 && best - val(l) <= 400);
    const fine = ls.filter((l) => best - val(l) < 80);
    const pickFrom = soft.length && Math.random() < 0.6 ? soft : fine;
    const l = pickFrom[rnd(pickFrom.length)];
    const m = uciToMove(l.pv[0]);
    if (!m || !legalMoves(b, c).some((x) => same(x, m))) break;
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
    if (statusAfter(b, c) !== 'playing') break;
    const fen = toFen(b, c);
    if (seen.has(fen)) continue;
    stage.probe++;
    if (!verdict(search(moves, 2, 'nodes 40000'))) continue;
    stage.quick++;
    const d = search(moves, 2, 'movetime 2000');
    const kind = verdict(d);
    if (!kind) continue;
    stage.deep++;
    const text: string[] = [];
    let bb = b;
    let cc: Color = c;
    for (const u of d[0].pv.slice(0, 3)) {
      const mm = uciToMove(u);
      if (!mm || !legalMoves(bb, cc).some((x) => same(x, mm))) break;
      text.push(moveToText(bb, mm));
      bb = applyMove(bb, mm);
      cc = cc === 'r' ? 'b' : 'r';
    }
    if (text.length % 2 === 0) text.pop();
    if (!text.length) continue;
    const rating = rateDifficulty(b, c, text[0]);
    if (rating < 850) {
      stage.easy++;
      continue;
    }
    seen.add(fen);
    found++;
    const rec = {
      id: `op2-${SHARD}-${found}`,
      kind: 'opening',
      fen,
      answer: text[0],
      line: text,
      rating,
      goal: kind,
      ev: d[0].score,
      ev2: Math.max(-3000, Math.min(3000, val(d[1]))),
      ply: moves.length,
    };
    fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
    console.log(`[${found - prior.length}/${WANT}] 试了 ${tries} 盘（${Math.round((Date.now() - t0) / 1000)} 秒）：第 ${moves.length} 手 ${kind === 'best' ? '抓软着' : '守住'}，难度 ${rating}，最好 ${val(d[0])} 第二 ${val(d[1])}：${text.join(' ')}`);
    break;
  }
}
console.log(`分片 ${SHARD}：新增 ${found - prior.length} 道`);
process.exit(0);
