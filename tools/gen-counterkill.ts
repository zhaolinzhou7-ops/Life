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
import { moveToText, toFen } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { PIECE_VALUE } from '../src/xiangqi/teach';
import { pieceName } from '../src/xiangqi/notation';
import { BLACK_ADVISOR, BLACK_ELEPHANT, empty, mirror, palace, pawnSquares, place } from './endgame-place';

const [, , shardArg = '0', shardsArg = '1', wantArg = '40'] = process.argv;
const SHARD = Number(shardArg);
const WANT = Number(wantArg);
const MAX_MATE = Number(process.env.MAX_MATE ?? 12);
const e = await startPikafish(128);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const rnd = (n: number) => Math.floor(Math.random() * n);
const pick = <T>(a: T[]) => a[rnd(a.length)];

/** 红方的进攻子（压在黑方九宫附近）和黑方的进攻子（压在红方九宫附近） */
const RED_ATT = ['RH', 'RC', 'HC', 'RR', 'RHC', 'HHC', 'RCP', 'HCP', 'RHP', 'CCH', 'RRC', 'HH', 'RP', 'CCP'];
const BLACK_ATT = ['R', 'RH', 'RC', 'HC', 'RR', 'RP', 'HCP', 'RRH', 'RHC', 'CC', 'HH', 'RCC'];
/** 守子：两边都只留一部分士象，九宫要有破绽才谈得上连杀 */
const GUARDS = ['', 'A', 'AA', 'E', 'AE', 'AAE', 'EE', 'AEE', 'AAEE'];

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
    for (const g of pick(GUARDS)) if (!place(b, c, g as PType, g === 'A' ? adv(c) : ele(c))) return null;
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
let found = 0;
let tried = 0;
let passedRules = 0;
const t0 = Date.now();
while (found < WANT) {
  tried++;
  const b = randomBoard();
  if (!b || isInCheck(b, 'b') || isInCheck(b, 'r')) continue;
  // 形势危急：红方子力不比黑方多
  if (material(b, 'r') > material(b, 'b')) continue;
  const kills = blackKills(b);
  if (!kills.length) continue;
  // 红方得有将军的着法，不然谈不上"连将反杀"
  if (!legal(b, 'r').some((m) => isInCheck(applyMove(b, m), 'b'))) continue;
  passedRules++;
  const fen = toFen(b, 'r');
  e.send('ucinewgame');
  const q = search(fen, 300, 2);
  if (!q.length || q[0].mateIn === undefined || q[0].mateIn < 2 || q[0].mateIn > MAX_MATE) continue;
  if (q[1] && q[1].mateIn !== undefined && q[1].mateIn > 0) continue;
  // 复核：多算一会儿，第二好的仍然不是杀
  const v = search(fen, 2500, 2);
  if (!v.length || v[0].mateIn === undefined || v[0].mateIn < 2 || v[0].mateIn > MAX_MATE) continue;
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
  if (!okLine || statusAfter(cur, c) === 'playing' || quiet > 2) continue;
  // 最后一手必须是将死（不是困毙）
  if (!isMate(cur, 'b')) continue;
  found++;
  const rec = {
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
  console.log(
    `  [${found}] ${d} 步${quiet ? `连杀（${quiet} 步不将军）` : '连将杀'}：红 ${rec.red} vs 黑 ${rec.black}；黑方的杀着 ${rec.threat.join('、')}；${texts.join(' ')}`,
  );
  if (found % 5 === 0) console.log(`  …摆了 ${tried} 个局面，${passedRules} 个过了规则筛，用时 ${Math.round((Date.now() - t0) / 1000)} 秒`);
}
console.log(`分片 ${SHARD}：${found} 道（摆了 ${tried} 个局面）`);
process.exit(0);
