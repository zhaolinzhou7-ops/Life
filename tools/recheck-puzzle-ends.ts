/**
 * 残局题"主变走完接着下到底"的目标，用皮卡鱼两边真下到底来定。
 *
 * 原来目标是按局面分定的（train.ts 的 endgameTarget）：分数三个兵以上就要你"一直下到将死"，
 * 一个半兵以内就"守成和棋"。可分数不是结果——车兵对车这类残局分数常常过了三个兵，
 * 真下下去皮卡鱼守得住，那你怎么下也赢不了（用户原话："这本身是一个必赢的"，结果判成和）。
 *
 * 做法：每道要下到底的题，照主变走到交给下到底的那个局面（轮到对方），
 * 皮卡鱼双方各下两遍（两档算力，层数定死），用 App 同一个裁判（endings.ts）判。结果写成一行一个 JSON；
 * APPLY=1 时把结论写进 puzzles.json 的 end 字段：
 *   - 要赢的：两遍都是你赢 → end: 'win'；有一遍没赢下来 → end: 'none'（主变走完就算做对，不再要求下到底）
 *   - 要和的：两遍你都没输 → end: 'draw'；有一遍输了 → end: 'none'
 * 用法：SHARD=0/4 node tools/run.mjs recheck-puzzle-ends（分片并行）；APPLY=1 node tools/run.mjs recheck-puzzle-ends
 */
import fs from 'fs';
import { fromFen, textToMove, toFen } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { drawOrForfeit, plyRecord, type PlyRecord } from '../src/xiangqi/endings';
import { moveToUci, uciToMove } from '../src/xiangqi/pikafish';
import type { Puzzle } from '../src/xiangqi/puzzles';

const PUZ = 'src/xiangqi/puzzles.json';
const [si, sn] = (process.env.SHARD ?? '0/1').split('/').map(Number);
const BUDGETS = (process.env.BUDGETS ?? 'depth 14 nodes 1500000|depth 18 nodes 4000000').split('|');
const MAX_PLIES = 400;
const OUT = (i: number) => `node_modules/.cache/recheck-puzzle-ends-${i}.jsonl`;

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

/** 按局面分定的目标（就是 endgameTarget 原来的规则，不看 end） */
function scoreTarget(p: Puzzle): 'win' | 'draw' | null {
  if (p.kind !== 'endgame' || p.ev === undefined) return null;
  if (p.goal === 'mate' || p.ev >= 300) return 'win';
  if (Math.abs(p.ev) < 150) return 'draw';
  return null;
}

/** 照主变走到交给下到底的局面：你走完主变里最后一手（最后剩对方一手应着不走）。走不下去 / 已经将死返回 null */
function handOff(p: Puzzle): { board: Board; toMove: Color } | null {
  const f = fromFen(p.fen);
  if (!f) return null;
  let b = f.board;
  let c = f.toMove;
  const n = p.line.length % 2 ? p.line.length : p.line.length - 1;
  for (let i = 0; i < n; i++) {
    const m = textToMove(b, c, p.line[i], legalOf(b, c));
    if (!m) return null;
    b = applyMove(b, m);
    c = other(c);
  }
  if (statusAfter(b, c) !== 'playing') return null;
  return { board: b, toMove: c };
}

interface Game {
  result: 'red-win' | 'black-win' | 'draw' | 'error';
  plies: number;
  reason: string;
}

async function check() {
  const { startPikafish } = await import('./pikafish-node');
  const e = await startPikafish(64);
  const game = (board: Board, toMove: Color, go: string): Game => {
    let b = board;
    let c = toMove;
    const startKey = toFen(b, c);
    const plies: PlyRecord[] = [];
    const hist: string[] = [];
    e.send('ucinewgame');
    for (let ply = 0; ; ply++) {
      const st = statusAfter(b, c);
      if (st !== 'playing') return { result: st, plies: ply, reason: '将死/困毙' };
      const end = drawOrForfeit(b, startKey, plies);
      if (end) return { result: end.winner === 'r' ? 'red-win' : end.winner === 'b' ? 'black-win' : 'draw', plies: ply, reason: end.reason };
      if (ply >= MAX_PLIES) return { result: 'draw', plies: ply, reason: 'cap' };
      e.send(`position fen ${startKey} - - 0 1${hist.length ? ' moves ' + hist.join(' ') : ''}`);
      const bm = e
        .send(`go ${go}`)
        .find((l) => l.startsWith('bestmove'))
        ?.split(/\s+/)[1];
      const m = bm ? uciToMove(bm) : null;
      if (!m || !legalOf(b, c).some((x) => same(x, m))) return { result: 'error', plies: ply, reason: `引擎给了 ${bm}` };
      const after = applyMove(b, m);
      plies.push(plyRecord(b, m, after));
      hist.push(moveToUci(m));
      b = after;
      c = other(c);
    }
  };
  const done = new Set<string>();
  if (fs.existsSync(OUT(si))) for (const l of fs.readFileSync(OUT(si), 'utf8').split('\n')) if (l.trim()) done.add(JSON.parse(l).id);
  const all = JSON.parse(fs.readFileSync(PUZ, 'utf8')) as Puzzle[];
  const todo = all.filter((p) => scoreTarget(p)).filter((_, i) => i % sn === si);
  let n = 0;
  for (const p of todo) {
    n++;
    if (done.has(p.id)) continue;
    const t0 = Date.now();
    const h = handOff(p);
    const me = fromFen(p.fen)!.toMove;
    const runs = h ? BUDGETS.map((g) => ({ go: g, ...game(h.board, h.toMove, g) })) : [];
    fs.appendFileSync(OUT(si), JSON.stringify({ id: p.id, me, target: scoreTarget(p), handOff: !!h, runs }) + '\n');
    console.log(`[${si}] ${n}/${todo.length} ${p.id} 要${scoreTarget(p) === 'win' ? '赢' : '和'} ${runs.map((r) => `${r.result}/${r.reason}/${r.plies}`).join(' · ') || '主变走完已经结束'} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  }
  console.log(`[${si}] done`);
}

function apply() {
  const all = JSON.parse(fs.readFileSync(PUZ, 'utf8')) as Puzzle[];
  const rows = new Map<string, { me: Color; target: 'win' | 'draw'; handOff: boolean; runs: Game[] }>();
  for (const f of fs.readdirSync('node_modules/.cache').filter((x) => /^recheck-puzzle-ends-\d+\.jsonl$/.test(x)))
    for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) if (l.trim()) rows.set(JSON.parse(l).id, JSON.parse(l));
  const need = all.filter((p) => scoreTarget(p));
  const missing = need.filter((p) => !rows.has(p.id));
  if (missing.length) {
    console.log(`还有 ${missing.length} 道没复核完`);
    process.exit(1);
  }
  const tally: Record<string, string[]> = {};
  for (const p of need) {
    const r = rows.get(p.id)!;
    const mine = r.me === 'r' ? 'red-win' : 'black-win';
    const why = r.runs.map((g) => `${g.result}/${g.reason}/${g.plies}`).join(' · ');
    let end: 'win' | 'draw' | 'none';
    if (!r.handOff) end = r.target; // 主变走完已经将死 / 走不下去：不会进下到底，不动
    else if (r.runs.some((g) => g.result === 'error')) end = 'none';
    else if (r.target === 'win') end = r.runs.every((g) => g.result === mine) ? 'win' : 'none';
    else end = r.runs.some((g) => g.result !== 'draw' && g.result !== mine) ? 'none' : 'draw';
    p.end = end;
    const k = `要${r.target === 'win' ? '赢' : '和'} → ${end}`;
    (tally[k] ??= []).push(`${p.id}（${p.goal}，分 ${p.ev}）：${why}`);
  }
  for (const [k, v] of Object.entries(tally)) {
    console.log(`${k}：${v.length} 道`);
    if (k.endsWith('none')) for (const l of v) console.log('    ' + l);
  }
  if (process.env.WRITE) {
    fs.writeFileSync(PUZ, JSON.stringify(all));
    console.log(`写回 ${PUZ}`);
  }
}

if (process.env.APPLY) apply();
else await check();
