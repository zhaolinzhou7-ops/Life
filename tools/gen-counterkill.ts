/**
 * 绝地反杀：红先，黑方下一步就能杀红——红方只有连续将军（或者一气呵成的连杀），抢在前面把黑将杀死。
 *
 * 用户原话："不要出那些优势非常明显、纯粹去算最优步数的必胜局……要那种形势很危急的：我是红棋，
 * 对方是黑棋且下一步就能绝杀我，而我必须通过连续将军或者连环杀法，最后绝地反杀。"
 *
 * 做法（每一条都是硬条件，不满足就扔）：
 *   1. 随机摆一个两边都在进攻的残局：红方几个进攻子压在黑方九宫附近，黑方几个进攻子压在红方九宫附近；
 *      红方子力不比黑方多（形势要危急，不是多子去收官）；
 *   2. 规则引擎先筛：轮到黑方走的话，他有一步直接把红将死（黑方的杀着记下来，界面上可以看）；
 *   3. 皮卡鱼：红先有强制杀（2～12 步），而且第二好的一手不是杀棋——不走这一路，就是被黑方杀；
 *   4. 两边每手 1.5 秒下到将死，示范解法的步数要等于复核的步数；
 *      红方每一步都将军的记作"连将杀"，中间有一两步不将军、但下一步就杀的记作"连杀"（最多两步闲着）。
 *
 *   node tools/run.mjs gen-counterkill <分片号> <分片数> [要几道]
 * 输出 node_modules/.cache/counterkill-<分片>.jsonl
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, isInCheck, kingsFacing, legalMoves, statusAfter, type Board, type Color, type Move, type PType } from '../src/xiangqi/rules';
import { fromFen, moveToText, toFen } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { PIECE_VALUE } from '../src/xiangqi/teach';
import { pieceName } from '../src/xiangqi/notation';
import { BLACK_ADVISOR, BLACK_ELEPHANT, empty, mirror, palace, pawnSquares, place } from './endgame-place';

const [, , shardArg = '0', shardsArg = '1', wantArg = '40'] = process.argv;
const SHARD = Number(shardArg);
const WANT = Number(wantArg);
const MAX_MATE = Number(process.env.MAX_MATE ?? 20);
/**
 * 只要这么多步以上的。用户原话："你现在做的残局有点太简单了（包括闯关模式），深度还需要再深入一些"——
 * 默认 6 步起；2～5 步的已经够多了。
 */
const MIN_MATE = Number(process.env.MIN_MATE ?? 6);
/** 中间最多几步不将军（每一步不将军的都得同时挡住黑方的杀，引擎的强制杀已经保证了这一点） */
const MAX_QUIET = Number(process.env.MAX_QUIET ?? 3);
const e = await startPikafish(128);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]) => a[rnd(a.length)];

/** 红方的进攻子（压在黑方九宫附近）和黑方的进攻子（压在红方九宫附近） */
const RED_ATT = ['RH', 'RC', 'HC', 'RR', 'RHC', 'HHC', 'RCP', 'HCP', 'RHP', 'CCH', 'RRC', 'HH', 'RP', 'CCP'];
const BLACK_ATT = ['R', 'RH', 'RC', 'HC', 'RR', 'RP', 'HCP', 'RRH', 'RHC', 'CC', 'HH', 'RCC'];
/** 守子：两边都只留一部分士象，九宫要有破绽才谈得上连杀 */
const GUARDS = ['', 'A', 'AA', 'E', 'AE', 'AAE', 'EE', 'AEE', 'AAEE'];
/** 黑方的守子多给一些：守得越厚，红方的杀越长、越要算 */
const BLACK_GUARDS = ['AE', 'AAE', 'AEE', 'AAEE', 'AAEE', 'AAEE', 'AA', 'EE'];

function attackSquares(c: Color, t: PType): number[][] {
  const out: number[][] = [];
  for (let x = 0; x < 9; x++)
    for (let y = 0; y < 10; y++) {
      // 进攻子在对方半场或者河口一带（红方的进攻方向是 y 小的那边）
      const depth = c === 'r' ? y : 9 - y;
      if (t === 'H' && depth > 5) continue;
      if ((t === 'R' || t === 'C') && depth > 7) continue;
      out.push([x, y]);
    }
  return out;
}

function material(b: Board, c: Color): number {
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.c === c && p.t !== 'K') s += PIECE_VALUE[p.t];
  return s;
}

function randomBoard(): Board | null {
  const b = empty();
  const adv = (c: Color) => (c === 'b' ? BLACK_ADVISOR : mirror(BLACK_ADVISOR));
  const ele = (c: Color) => (c === 'b' ? BLACK_ELEPHANT : mirror(BLACK_ELEPHANT));
  for (const c of ['r', 'b'] as Color[]) {
    if (!place(b, c, 'K', palace(c))) return null;
    for (const g of pick(c === 'b' && MIN_MATE >= 6 ? BLACK_GUARDS : GUARDS)) if (!place(b, c, g as PType, g === 'A' ? adv(c) : ele(c))) return null;
  }
  for (const [c, sets] of [['r', RED_ATT], ['b', BLACK_ATT]] as [Color, string[]][]) {
    for (const t of pick(sets)) {
      const sq = t === 'P' ? pawnSquares(c) : attackSquares(c, t as PType);
      if (!place(b, c, t as PType, sq)) return null;
    }
  }
  if (kingsFacing(b)) return null;
  return b;
}

const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

// ───────────────────────── 种子 + 小改动（SEED=1） ─────────────────────────
/**
 * 随机摆子很难摆出八步以上的长杀。长杀的局面往往"离一个短杀不远"：把已经入库的四步以上的局面拿来当种子，
 * 每次只改一点（挪一个子、给黑方加一个士象卒、挪一下将帅），改完照样过全部硬条件——
 * 局部搜索比从零乱摆找得快得多。本轮找到的新局面也加进种子池，越长的越常被选中。
 */
const SEEDS: { fen: string; mateIn: number }[] = [];
/** 已经有的解法（红方的着法串）：同一路杀法只换了个无关的子，不算新的一关 */
const seenLine = new Set<string>();
const redMoves = (line: string[]) => line.filter((_, i) => i % 2 === 0).join(' ');
{
  /** 种子至少几步（找特别长的杀时只拿长的做种子） */
  const SEED_MIN = Number(process.env.SEED_MIN ?? 4);
  const lib = JSON.parse(fs.readFileSync('src/xiangqi/counterkill.json', 'utf8')) as { fen: string; mateIn: number; line: string[] }[];
  // 别的分片这一轮已经找到的也拿来当种子（同一路杀法不重复收）
  for (const f of fs.readdirSync('node_modules/.cache').filter((n) => /^counterkill-\d+\.jsonl$/.test(n))) {
    for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) if (l.trim()) lib.push(JSON.parse(l));
  }
  for (const x of lib) {
    seenLine.add(redMoves(x.line));
    if (process.env.SEED && x.mateIn >= SEED_MIN) SEEDS.push({ fen: x.fen, mateIn: x.mateIn });
  }
}
function pickSeed(): Board | null {
  if (!SEEDS.length) return null;
  // 按步数加权：长的更常被选中（步数的三次方）
  const w = (n: number) => n * n * n;
  const total = SEEDS.reduce((a, x) => a + w(x.mateIn), 0);
  let r = Math.random() * total;
  for (const x of SEEDS) {
    r -= w(x.mateIn);
    if (r <= 0) return fromFen(x.fen)?.board ?? null;
  }
  return fromFen(SEEDS[SEEDS.length - 1].fen)?.board ?? null;
}
function squaresFor(c: Color, t: PType): number[][] {
  if (t === 'A') return c === 'b' ? BLACK_ADVISOR : mirror(BLACK_ADVISOR);
  if (t === 'E') return c === 'b' ? BLACK_ELEPHANT : mirror(BLACK_ELEPHANT);
  if (t === 'K') return palace(c);
  if (t === 'P') return pawnSquares(c);
  return attackSquares(c, t);
}
function perturb(src: Board): Board | null {
  const b = src.map((row) => row.slice());
  const pieces: { x: number; y: number; c: Color; t: PType }[] = [];
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) if (b[y][x]) pieces.push({ x, y, ...b[y][x]! });
  const ops = 1 + rnd(2);
  for (let k = 0; k < ops; k++) {
    const r = Math.random();
    if (r < 0.65) {
      // 挪一个子（将帅也可能挪，在九宫里）
      const p = pick(pieces);
      const sq = squaresFor(p.c, p.t).filter(([x, y]) => !b[y][x]);
      if (!sq.length) return null;
      const [nx, ny] = pick(sq);
      b[p.y][p.x] = null;
      b[ny][nx] = { c: p.c, t: p.t };
      p.x = nx;
      p.y = ny;
    } else if (r < 0.85) {
      // 给黑方加一个守子：士、象、卒（守得越厚，杀越长）
      const t = pick(['A', 'E', 'P'] as PType[]);
      const have = pieces.filter((q) => q.c === 'b' && q.t === t).length;
      if ((t === 'A' || t === 'E') && have >= 2) continue;
      if (t === 'P' && have >= 3) continue;
      const sq = (t === 'P' ? pawnSquares('b') : squaresFor('b', t)).filter(([x, y]) => !b[y][x]);
      if (!sq.length) continue;
      const [nx, ny] = pick(sq);
      b[ny][nx] = { c: 'b', t };
    } else {
      // 拿掉红方一个兵或者士象：子更少，杀得更难
      const cand = pieces.filter((q) => q.c === 'r' && 'PAE'.includes(q.t) && b[q.y][q.x]);
      if (!cand.length) continue;
      const q = pick(cand);
      b[q.y][q.x] = null;
    }
  }
  if (kingsFacing(b)) return null;
  return b;
}
const isMate = (b: Board, c: Color) => isInCheck(b, c) && legal(b, c).length === 0;

/** 轮到黑走的话，能一步杀红的着法 */
function blackKills(b: Board): Move[] {
  return legal(b, 'b').filter((m) => isMate(applyMove(b, m), 'r'));
}

function search(fen: string, ms: number, multipv: number): PvLine[] {
  e.send(`setoption name MultiPV value ${multipv}`);
  e.send(`position fen ${fen} - - 0 1`);
  const ls = e.send(`go movetime ${ms}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}

function bestMove(b: Board, c: Color, ms: number): Move | null {
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${toFen(b, c)} - - 0 1`);
  const lines = e.send(`go movetime ${ms}`);
  const bm = lines.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
  const m = bm && bm !== '(none)' ? uciToMove(bm) : null;
  return m ? (legal(b, c).find((x) => same(x, m)) ?? null) : null;
}

const desc = (b: Board, c: Color) => {
  const n: Record<string, number> = {};
  for (const row of b) for (const p of row) if (p && p.c === c && 'RHCP'.includes(p.t)) n[p.t] = (n[p.t] ?? 0) + 1;
  return ['R', 'H', 'C', 'P']
    .filter((t) => n[t])
    .map((t) => (n[t] > 1 ? '双' : '') + pieceName(t as PType, c))
    .join('');
};

const OUT_FILE = `node_modules/.cache/counterkill-${SHARD}.jsonl`;
fs.writeFileSync(OUT_FILE, '');
const seenFen = new Set<string>(SEEDS.map((x) => x.fen));
let found = 0;
let tried = 0;
let passedRules = 0;
const t0 = Date.now();
while (found < WANT) {
  tried++;
  const seed = SEEDS.length ? pickSeed() : null;
  const b = seed ? perturb(seed) : randomBoard();
  if (!b || isInCheck(b, 'b') || isInCheck(b, 'r')) continue;
  // 形势危急：红方子力不比黑方多
  if (material(b, 'r') > material(b, 'b')) continue;
  const kills = blackKills(b);
  if (!kills.length) continue;
  // 红方得有将军的着法，不然谈不上"连将反杀"
  if (!legal(b, 'r').some((m) => isInCheck(applyMove(b, m), 'b'))) continue;
  passedRules++;
  const fen = toFen(b, 'r');
  if (seenFen.has(fen)) continue;
  seenFen.add(fen);
  e.send('ucinewgame');
  const q = search(fen, 250, 2);
  if (!q.length || q[0].mateIn === undefined || q[0].mateIn < MIN_MATE || q[0].mateIn > MAX_MATE) continue;
  if (q[1] && q[1].mateIn !== undefined && q[1].mateIn > 0) continue;
  // 复核：多算一会儿，第二好的仍然不是杀
  const v = search(fen, 2500, 2);
  if (!v.length || v[0].mateIn === undefined || v[0].mateIn < MIN_MATE || v[0].mateIn > MAX_MATE) continue;
  if (v[1] && v[1].mateIn !== undefined && v[1].mateIn > 0) continue;
  const d = v[0].mateIn;
  // 两边下到将死：示范解法
  let cur = b;
  let c: Color = 'r';
  const texts: string[] = [];
  let quiet = 0;
  let okLine = true;
  for (let i = 0; i < 2 * d - 1; i++) {
    const m = bestMove(cur, c, 1500);
    if (!m) {
      okLine = false;
      break;
    }
    texts.push(moveToText(cur, m));
    const after = applyMove(cur, m);
    if (c === 'r' && !isInCheck(after, 'b')) quiet++;
    cur = after;
    c = c === 'r' ? 'b' : 'r';
  }
  if (!okLine || statusAfter(cur, c) === 'playing' || quiet > MAX_QUIET) continue;
  // 最后一手必须是将死（不是困毙）
  if (!isMate(cur, 'b')) continue;
  if (seenLine.has(redMoves(texts))) continue;
  seenLine.add(redMoves(texts));
  // 难不难：浅算几层才看得出这是杀棋（人看得出来的深度，大致也就这么几层）
  let seeDepth = 0;
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${fen} - - 0 1`);
  for (let dd = 3; dd <= 40; dd += 1) {
    const ls = e.send(`go depth ${dd}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
    const top = ls[ls.length - 1];
    if (top && top.mateIn !== undefined && top.mateIn > 0) {
      seeDepth = dd;
      break;
    }
  }
  found++;
  const rec = {
    seeDepth,
    id: `ck-${SHARD}-${found}`,
    fen,
    you: 'r',
    mateIn: d,
    line: texts,
    allChecks: quiet === 0,
    quiet,
    threat: kills.map((m) => moveToText(b, m)),
    red: desc(b, 'r'),
    black: desc(b, 'b'),
    matRed: material(b, 'r'),
    matBlack: material(b, 'b'),
  };
  fs.appendFileSync(OUT_FILE, JSON.stringify(rec) + '\n');
  if (process.env.SEED) SEEDS.push({ fen, mateIn: d });
  console.log(
    `  [${found}] ${d} 步${quiet ? `连杀（${quiet} 步不将军）` : '连将杀'}，浅算 ${seeDepth} 层才看见：红 ${rec.red} vs 黑 ${rec.black}；黑方的杀着 ${rec.threat.join('、')}；${texts.join(' ')}`,
  );
  if (found % 5 === 0) console.log(`  …摆了 ${tried} 个局面，${passedRules} 个过了规则筛，用时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
}
console.log(`分片 ${SHARD}：${found} 道（摆了 ${tried} 个局面）`);
process.exit(0);
