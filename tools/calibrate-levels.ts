/**
 * 给对手各档定分：让两个对手对下 N 盘，按胜率算 Elo 差。
 *
 *   node tools/run.mjs calibrate-levels P2 L2 20 [种子]
 *
 * 对手写法：
 *   P0～P6  新的七档（皮卡鱼 + pikalevel.ts 里的配置）
 *   L0～L4  旧的自家引擎五档（它们的分数 750～1450 是实战分的老尺子）
 *   P:{"nodes":3000,...}  临时试一个配置（调参用）
 *
 * 新档的分数 = 旧档分数 + 这里测出来的 Elo 差。用旧档当尺子，
 * 是为了让以前记下的实战分和以后的接得上。
 *
 * 规则：将死 / 困毙判负；三次重复、60 回合不吃子判和；超过 300 手用全力引擎看一眼：
 * 领先三个兵以上算赢，否则算和。开头两手在引擎前五名里随机挑，免得每盘都一样。
 */
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { think } from '../src/xiangqi/ai';
import { chooseMove, PIKA_LEVELS, type Cand, type LevelCfg } from '../src/xiangqi/pikalevel';

const OLD = [
  { jitter: 200, timeMs: 200 },
  { jitter: 90, timeMs: 400 },
  { jitter: 25, timeMs: 900 },
  { jitter: 0, timeMs: 1800 },
  { jitter: 0, timeMs: 2800 },
];

const [, , aSpec = 'P0', bSpec = 'L0', gamesArg = '10', seedArg = '1'] = process.argv;
const GAMES = Number(gamesArg);
let seed = Number(seedArg) >>> 0 || 1;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const e = await startPikafish(32);
const START = toFen(initialBoard(), 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

type Player = { kind: 'P'; cfg: LevelCfg } | { kind: 'L'; jitter: number; timeMs: number };
function parse(spec: string): Player {
  if (spec.startsWith('P:')) return { kind: 'P', cfg: { ...PIKA_LEVELS[2], ...JSON.parse(spec.slice(2)) } };
  const n = Number(spec.slice(1));
  if (spec[0] === 'P') return { kind: 'P', cfg: PIKA_LEVELS[n] };
  return { kind: 'L', ...OLD[n] };
}

/** 皮卡鱼搜一次，返回前 K 名（走棋方视角）和最好的分 */
function pikaSearch(board: Board, color: Color, moves: Move[], multipv: number, go: string): { cands: Cand[]; best: number } {
  e.send(`setoption name MultiPV value ${multipv}`);
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const lines = e
    .send(`go ${go}`)
    .map(parseInfo)
    .filter((x): x is PvLine => !!x && !x.bound);
  let depth = 0;
  for (const l of lines) depth = Math.max(depth, l.depth);
  const byPv = new Map<number, PvLine>();
  // 最后一层可能没算完：先放上一层，再用最后一层覆盖
  for (const l of lines) if (l.depth === depth - 1) byPv.set(l.multipv, l);
  for (const l of lines) if (l.depth === depth) byPv.set(l.multipv, l);
  const legal = legalMoves(board, color);
  const cands: Cand[] = [];
  for (const l of [...byPv.values()].sort((a, b) => a.multipv - b.multipv)) {
    const m = uciToMove(l.pv[0]);
    if (!m || !legal.some((x) => same(x, m)) || cands.some((c) => same(c.move, m))) continue;
    cands.push({ move: m, score: l.score, mateIn: l.mateIn });
  }
  cands.sort((a, b) => b.score - a.score);
  return { cands, best: cands[0]?.score ?? 0 };
}

function pick(p: Player, board: Board, color: Color, moves: Move[]): Move | null {
  if (p.kind === 'L') return think(board, color, { maxDepth: 64, jitter: p.jitter, timeMs: p.timeMs });
  const cfg = p.cfg;
  const go = cfg.nodes ? `nodes ${cfg.nodes}` : `movetime ${cfg.movetime}`;
  const { cands } = pikaSearch(board, color, moves, cfg.multipv, go);
  return chooseMove(cands, cfg, rand) ?? legalMoves(board, color)[0] ?? null;
}

/** 一盘：返回 1 / 0.5 / 0（红方视角） */
function play(red: Player, black: Player): { r: number; plies: number; why: string } {
  e.send('ucinewgame');
  let board = initialBoard();
  let color: Color = 'r';
  const moves: Move[] = [];
  const seen = new Map<string, number>();
  let quiet = 0;
  for (let ply = 0; ply < 300; ply++) {
    const st = statusAfter(board, color);
    if (st !== 'playing') return { r: st === 'red-win' ? 1 : 0, plies: ply, why: '将死' };
    let m: Move | null;
    if (ply < 2) {
      const { cands } = pikaSearch(board, color, moves, 5, 'nodes 20000');
      const ok = cands.filter((c) => cands[0].score - c.score <= 60);
      m = ok[Math.floor(rand() * ok.length)].move;
    } else {
      m = pick(color === 'r' ? red : black, board, color, moves);
    }
    if (!m) return { r: color === 'r' ? 0 : 1, plies: ply, why: '无着' };
    quiet = board[m.ty][m.tx] ? 0 : quiet + 1;
    board = applyMove(board, m);
    moves.push(m);
    color = color === 'r' ? 'b' : 'r';
    const key = toFen(board, color);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return { r: 0.5, plies: ply + 1, why: '重复' };
    if (quiet >= 120) return { r: 0.5, plies: ply + 1, why: '60回合' };
  }
  const { best } = pikaSearch(board, color, moves, 1, 'nodes 200000');
  const red3 = color === 'r' ? best : -best;
  return { r: red3 > 300 ? 1 : red3 < -300 ? 0 : 0.5, plies: 300, why: '判定' };
}

const A = parse(aSpec);
const B = parse(bSpec);
let score = 0;
const tally = { w: 0, d: 0, l: 0 };
for (let g = 0; g < GAMES; g++) {
  const aRed = g % 2 === 0;
  const t0 = Date.now();
  const res = aRed ? play(A, B) : play(B, A);
  const s = aRed ? res.r : 1 - res.r;
  score += s;
  if (s === 1) tally.w++;
  else if (s === 0) tally.l++;
  else tally.d++;
  console.log(`  第 ${g + 1} 盘（${aSpec} 执${aRed ? '红' : '黑'}）：${s === 1 ? '胜' : s === 0 ? '负' : '和'}，${res.plies} 手，${res.why}，${Math.round((Date.now() - t0) / 1000)}s`);
}
const p = Math.min(0.97, Math.max(0.03, score / GAMES));
const elo = Math.round(400 * Math.log10(p / (1 - p)));
console.log(`RESULT ${aSpec} vs ${bSpec}: +${tally.w} =${tally.d} -${tally.l}（${GAMES} 盘，得分率 ${Math.round((score / GAMES) * 100)}%），${aSpec} 比 ${bSpec} 约 ${elo >= 0 ? '+' : ''}${elo}`);
process.exit(0);
