/**
 * 造实用残局：随机摆子，让皮卡鱼判胜和。
 *
 * 用户反馈："残局题库太少，做来做去就那几个，到后面光凭记忆都知道怎么答"。原来 16 类 61 个局面，
 * 胜和是自带引擎双方下出来的。现在用皮卡鱼：
 *   1. 按子力组合随机摆：士只能在九宫的五个点、象只能在七个点、兵只能在能走到的格子，
 *      不走棋的一方不能正被将军，将帅不能照面；
 *   2. 先算 1 秒：算出杀（而且不是三步以内的送分题）就是胜局，杀几步就知道；
 *   3. 没算出杀的，皮卡鱼自己跟自己下到底（和 App 同一套规则：60 回合不吃子判和、三次重复判和），
 *      进攻方赢了就是胜局，下不赢就是和棋。
 * 摆出来的局面按"你是进攻方"或"你是守方"两种练法各自入选：守方只收守得住的（和棋）。
 *
 * 用法：node tools/run.mjs gen-endgames <分片号> <分片数> [每组要几个]
 *       node tools/run.mjs gen-endgames recheck   （用同样的办法复核现有的残局库）
 */
import fs from 'fs';
import { startPikafish, type NodeEngine } from './pikafish-node';
import { applyMove, isInCheck, kingsFacing, legalMoves, type Board, type Color, type Move, type PType } from '../src/xiangqi/rules';
import { fromFen, toFen } from '../src/xiangqi/notation';
import { randomPosition, type GroupSpec } from './endgame-place';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';

// ───────────────────────── 要造的组 ─────────────────────────

export type { GroupSpec } from './endgame-place';

export const GROUPS: GroupSpec[] = [
  // 兵类：用户点名要多一些
  { name: '单兵对光将', category: '兵类', att: 'P', def: '', you: 'att' },
  { name: '单兵对单士', category: '兵类', att: 'P', def: 'A', you: 'att' },
  { name: '单兵对单象', category: '兵类', att: 'P', def: 'E', you: 'att' },
  { name: '单兵对双士', category: '兵类', att: 'P', def: 'AA', you: 'both' },
  { name: '单兵对双象', category: '兵类', att: 'P', def: 'EE', you: 'both' },
  { name: '双兵对单士', category: '兵类', att: 'PP', def: 'A', you: 'att' },
  { name: '双兵对双士', category: '兵类', att: 'PP', def: 'AA', you: 'both' },
  { name: '双兵对双象', category: '兵类', att: 'PP', def: 'EE', you: 'both' },
  { name: '双兵对单士象', category: '兵类', att: 'PP', def: 'AE', you: 'both' },
  { name: '双兵对士象全', category: '兵类', att: 'PP', def: 'AAEE', you: 'both' },
  { name: '三兵对双士', category: '兵类', att: 'PPP', def: 'AA', you: 'att' },
  { name: '三兵对士象全', category: '兵类', att: 'PPP', def: 'AAEE', you: 'both' },
  // 马类
  { name: '单马对光将', category: '马类', att: 'H', def: '', you: 'att' },
  { name: '单马对单士', category: '马类', att: 'H', def: 'A', you: 'att' },
  { name: '单马对单象', category: '马类', att: 'H', def: 'E', you: 'att' },
  { name: '单马对双象', category: '马类', att: 'H', def: 'EE', you: 'both' },
  { name: '马兵对双士', category: '马类', att: 'HP', def: 'AA', you: 'att' },
  { name: '马兵对双象', category: '马类', att: 'HP', def: 'EE', you: 'att' },
  { name: '马兵对单缺象', category: '马类', att: 'HP', def: 'AAE', you: 'both' },
  { name: '马兵对士象全', category: '马类', att: 'HP', def: 'AAEE', you: 'both' },
  { name: '单马对单卒', category: '马类', att: 'H', def: 'P', you: 'both' },
  // 炮类
  { name: '炮仕对光将', category: '炮类', att: 'C', attGuard: 'A', def: '', you: 'att' },
  { name: '炮兵对单士', category: '炮类', att: 'CP', def: 'A', you: 'att' },
  { name: '炮兵对双士', category: '炮类', att: 'CP', def: 'AA', you: 'both' },
  { name: '炮兵对双象', category: '炮类', att: 'CP', def: 'EE', you: 'both' },
  { name: '炮兵对士象全', category: '炮类', att: 'CP', attGuard: 'AA', def: 'AAEE', you: 'both' },
  { name: '炮双士对双士', category: '炮类', att: 'C', attGuard: 'AA', def: 'AA', you: 'both' },
  // 车类
  { name: '单车对双象', category: '车类', att: 'R', def: 'EE', you: 'att' },
  { name: '单车对单士象', category: '车类', att: 'R', def: 'AE', you: 'att' },
  { name: '单车对单缺士', category: '车类', att: 'R', def: 'AEE', you: 'att' },
  { name: '单车对单缺象', category: '车类', att: 'R', def: 'AAE', you: 'att' },
  { name: '单车对士象全', category: '车类', att: 'R', def: 'AAEE', you: 'both' },
  { name: '单车对单马', category: '车类', att: 'R', def: 'H', you: 'att' },
  { name: '单车对单炮', category: '车类', att: 'R', def: 'C', you: 'att' },
  { name: '单车对马双士', category: '车类', att: 'R', def: 'HAA', you: 'both' },
  { name: '单车对炮双士', category: '车类', att: 'R', def: 'CAA', you: 'both' },
  { name: '单车对马士象全', category: '车类', att: 'R', def: 'HAAEE', you: 'def' },
  { name: '车兵对单车', category: '车类', att: 'RP', def: 'R', you: 'both' },
  { name: '车兵对车双士', category: '车类', att: 'RP', def: 'RAA', you: 'both' },
  // 组合
  { name: '车马对单车', category: '组合', att: 'RH', attGuard: 'AA', def: 'RAA', you: 'both' },
  { name: '车炮对单车', category: '组合', att: 'RC', attGuard: 'AA', def: 'RAA', you: 'both' },
  { name: '车马对士象全', category: '组合', att: 'RH', def: 'AAEE', you: 'att' },
  { name: '马炮对双士', category: '组合', att: 'HC', def: 'AA', you: 'att' },
  { name: '马炮对士象全', category: '组合', att: 'HC', def: 'AAEE', you: 'att' },
  { name: '双马对士象全', category: '组合', att: 'HH', def: 'AAEE', you: 'att' },
  { name: '马兵对单马', category: '组合', att: 'HP', def: 'H', you: 'both' },
  { name: '炮兵对单马', category: '组合', att: 'CP', attGuard: 'AA', def: 'HAA', you: 'both' },
];

// ───────────────────────── 引擎：先算，再下到底 ─────────────────────────

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

function evalPos(e: NodeEngine, fen: string, ms: number): PvLine | null {
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${fen} - - 0 1`);
  const lines = e.send(`go movetime ${ms}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  return lines[lines.length - 1] ?? null;
}

/**
 * 皮卡鱼自己跟自己下到底。规则和 App 一样：没有着法就判负（将死/困毙），
 * 连续 120 步（60 回合）不吃子判和，同一局面第三次出现判和（长将这里不细分，残局里很少见）。
 * 返回进攻方赢了没有、下了多少步、怎么结束的。
 */
function playout(e: NodeEngine, board: Board, toMove: Color, attacker: Color, ms: number, maxPlies = 200) {
  const start = toFen(board, toMove);
  let b = board;
  let c = toMove;
  const moves: Move[] = [];
  const seen = new Map<string, number>();
  let quiet = 0;
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 1');
  /** 连着多少步两边的分都在半个兵以内：死和，不用真的下满 60 回合 */
  let flat = 0;
  for (let ply = 0; ply < maxPlies; ply++) {
    const legal = legalMoves(b, c);
    if (!legal.length) return { winner: other(c), plies: ply, how: '将死' };
    e.send(`position fen ${start} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
    const out = e.send(`go movetime ${ms}`);
    const last = out.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound).pop();
    if (last) {
      // 进攻方已经算到杀：胜局，杀几步就知道还要走多少
      if (last.mateIn !== undefined) {
        const attMates = (c === attacker ? 1 : -1) * last.mateIn > 0;
        if (attMates && last.depth >= 10) return { winner: attacker, plies: ply + 2 * Math.abs(last.mateIn) - (c === attacker ? 1 : 0), how: '将死' };
        flat = 0;
      } else {
        flat = Math.abs(last.score) < 50 ? flat + 1 : 0;
        if (flat >= 40) return { winner: null, plies: ply + 1, how: '引擎判和' };
      }
    }
    const bm = out.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
    const m = bm ? uciToMove(bm) : null;
    if (!m || !legal.some((x) => same(x, m))) return { winner: other(c), plies: ply, how: '无着' };
    const cap = !!b[m.ty][m.tx];
    b = applyMove(b, m);
    moves.push(m);
    c = other(c);
    quiet = cap ? 0 : quiet + 1;
    if (quiet >= 120) return { winner: null, plies: ply + 1, how: '60 回合无吃子' };
    const key = toFen(b, c);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return { winner: null, plies: ply + 1, how: '三次重复' };
  }
  return { winner: null, plies: maxPlies, how: '打满没分出胜负' };
}

export interface Found {
  name: string;
  category: string;
  fen: string;
  you: Color;
  target: 'win' | 'draw';
  plies: number;
  reason: string;
  mateIn?: number;
  score: number;
}

/**
 * 一个局面的胜和。attacker 是进攻方；toMove 是轮到谁走（练习时轮到你）。
 * 返回 null = 不要这个局面（太简单、一上来就能吃大子、判不清）。
 */
export function judge(e: NodeEngine, b: Board, toMove: Color, attacker: Color): { target: 'win' | 'draw'; plies: number; reason: string; mateIn?: number; score: number } | null {
  if (isInCheck(b, other(toMove))) return null; // 不走棋的一方正被将军：不合法
  if (isInCheck(b, toMove)) return null; // 一上来就被将军的局面不要：练习从安静的局面开始
  if (!legalMoves(b, toMove).length) return null;
  const fen = toFen(b, toMove);
  const top = evalPos(e, fen, 1000);
  if (!top) return null;
  // 进攻方视角的分
  const sign = toMove === attacker ? 1 : -1;
  if (top.mateIn !== undefined) {
    const attMates = top.mateIn * sign > 0;
    if (!attMates) return null; // 守方反而能杀：摆得不像样
    const n = Math.abs(top.mateIn);
    if (n < 4) return null; // 三步以内的杀：送分题
    return { target: 'win', plies: 2 * n - 1, reason: '将死', mateIn: n, score: 30000 };
  }
  const s = top.score * sign;
  // 一上来某一方就能白吃一个大子的局面，多半不像残局练习，跳过
  if (s < -300) return null;
  const r = playout(e, b, toMove, attacker, 80);
  if (r.winner === attacker) return { target: 'win', plies: r.plies, reason: r.how, score: s };
  if (r.winner === null) {
    // 下成和：有点分的局面换更长的时间再下一次，还和才记和——第一版残局库就错在"引擎不会走"被记成和棋
    if (s > 300) {
      const r2 = playout(e, b, toMove, attacker, 200);
      if (r2.winner === attacker) return { target: 'win', plies: r2.plies, reason: r2.how, score: s };
      if (r2.winner !== null) return null;
      return { target: 'draw', plies: r2.plies, reason: r2.how, score: s };
    }
    return { target: 'draw', plies: r.plies, reason: r.how, score: s };
  }
  return null; // 进攻方反而输了：摆得不像样
}

// ───────────────────────── 主程序 ─────────────────────────

const mode = process.argv[2] ?? '0';
const e = await startPikafish(64);

if (mode === 'recheck') {
  // 复核现有残局库：同一套办法重新判一遍
  const lib = JSON.parse(fs.readFileSync('src/xiangqi/endgamelib.json', 'utf8')) as { id: string; name: string; fen: string; you: Color; target: string }[];
  const out: unknown[] = [];
  for (const p of lib) {
    const parsed = fromFen(p.fen)!;
    // 进攻方：子力多的一方
    const val = (c: Color) => parsed.board.flat().reduce((a, x) => a + (x && x.c === c ? ({ R: 9, H: 4, C: 4.5, P: 1, A: 0, E: 0, K: 0 } as Record<string, number>)[x.t] : 0), 0);
    const attacker: Color = val('r') >= val('b') ? 'r' : 'b';
    const j = judge(e, parsed.board, parsed.toMove, attacker);
    out.push({ id: p.id, name: p.name, old: p.target, now: j?.target ?? null, reason: j?.reason, plies: j?.plies, attacker, you: p.you });
    console.log(`${p.id} ${p.name}：原 ${p.target} → 皮卡鱼 ${j?.target ?? '判不清'}（${j?.reason ?? ''}）`);
  }
  fs.writeFileSync('node_modules/.cache/endgame-recheck.json', JSON.stringify(out, null, 1));
} else {
  const shard = Number(mode);
  const n = Number(process.argv[3] ?? 1);
  const want = Number(process.argv[4] ?? 6);
  const groups = GROUPS.filter((_, i) => i % n === shard);
  const outF = fs.createWriteStream(`node_modules/.cache/endgames-${shard}.jsonl`);
  for (const g of groups) {
    const got: Found[] = [];
    const fens = new Set<string>();
    let tries = 0;
    // 进攻练习要胜局也要和局（"先判断能不能赢"才有意义）；防守练习只要和局
    const needWin = g.you === 'def' ? 0 : Math.ceil(want / 2);
    const needDraw = g.you === 'att' ? Math.floor(want / 2) : want;
    let wins = 0;
    let draws = 0;
    while ((wins < needWin || draws < needDraw) && tries < 60) {
      tries++;
      const attacker: Color = Math.random() < 0.75 ? 'r' : 'b';
      const b = randomPosition(g, attacker);
      if (!b) continue;
      // 进攻练习：轮到进攻方走；防守练习：轮到守方走
      const youAtt = g.you === 'att' || (g.you === 'both' && wins < needWin);
      const toMove: Color = youAtt ? attacker : other(attacker);
      const fen = toFen(b, toMove);
      if (fens.has(fen)) continue;
      fens.add(fen);
      const j = judge(e, b, toMove, attacker);
      if (!j) continue;
      if (j.target === 'win' && (wins >= needWin || !youAtt)) continue;
      if (j.target === 'draw' && draws >= needDraw) continue;
      const f: Found = { name: g.name, category: g.category, fen, you: toMove, target: j.target, plies: j.plies, reason: j.reason, mateIn: j.mateIn, score: j.score };
      got.push(f);
      if (j.target === 'win') wins++;
      else draws++;
      outF.write(JSON.stringify({ ...f, role: toMove === attacker ? 'att' : 'def' }) + '\n');
    }
    console.log(`${g.name}：试了 ${tries} 个，收下 胜 ${wins} / 和 ${draws}`);
  }
  outF.end();
}
