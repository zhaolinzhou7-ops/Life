/**
 * 从残局库的局面里挑出"只有一手最好"的，做成残局题。
 *   进攻方：首选明显好过第二选（杀得更快，或者多出两个半兵以上）
 *   守方：只有这一手守得住（首选是和，其余都要输一大截）
 * 用法：node tools/run.mjs gen-endgame-puzzles <分片号> <分片数>
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, legalMoves, type Color } from '../src/xiangqi/rules';
import { fromFen, moveToText } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import type { EndgamePos } from '../src/xiangqi/library';

const shard = Number(process.argv[2] ?? 0);
const n = Number(process.argv[3] ?? 1);
const lib = (JSON.parse(fs.readFileSync('src/xiangqi/endgamelib.json', 'utf8')) as EndgamePos[]).filter((_, i) => i % n === shard);
const e = await startPikafish(64);
const out = fs.createWriteStream(`node_modules/.cache/egp-${shard}.jsonl`);
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const found: unknown[] = [];
for (const p of lib) {
  const parsed = fromFen(p.fen);
  if (!parsed) continue;
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 3');
  e.send(`position fen ${p.fen} - - 0 1`);
  const lines = e.send('go movetime 1500').map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(0, ...lines.map((l) => l.depth));
  const top = new Map<number, PvLine>();
  for (const l of lines) if (l.depth >= depth - 1) top.set(l.multipv, l);
  const b1 = top.get(1);
  const b2 = top.get(2);
  if (!b1 || !b2) continue;
  const v1 = val(b1);
  const v2 = val(b2);
  let goal: string | null = null;
  const role = p.role ?? 'att';
  if (role === 'att') {
    if (b1.mateIn !== undefined && b1.mateIn > 0 && (b2.mateIn === undefined || b2.mateIn < 0 || b2.mateIn >= b1.mateIn + 3)) goal = b1.mateIn <= 6 ? 'mate' : 'only';
    else if (b1.mateIn === undefined && v1 >= 300 && v1 - v2 >= 250) goal = 'only';
  } else if (Math.abs(v1) < 150 && v1 - v2 >= 400) goal = 'only';
  if (!goal) continue;
  // 正解和它的后续（中文记谱）
  let cur = parsed.board;
  let c: Color = parsed.toMove;
  const line: string[] = [];
  for (const u of b1.pv.slice(0, 7)) {
    const m = uciToMove(u);
    if (!m || !legalMoves(cur, c).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)) break;
    line.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    c = c === 'r' ? 'b' : 'r';
  }
  if (!line.length) continue;
  const rating =
    goal === 'mate' ? 800 + 60 * Math.min(10, b1.mateIn ?? 0) : role === 'def' ? 1250 : 1100 + Math.min(300, Math.round((v1 - v2) / 5));
  const rec = {
    id: `egp-${p.id}`,
    kind: 'endgame',
    fen: p.fen,
    answer: line[0],
    line,
    rating,
    goal,
    ev: Math.max(-3000, Math.min(3000, v1 >= 29000 ? 3000 : v1)),
    ...(goal === 'mate' ? { mateIn: b1.mateIn } : {}),
  };
  found.push(rec);
  out.write(JSON.stringify(rec) + '\n');
}
out.end();
console.log(`shard ${shard}: ${lib.length} 个局面 → ${found.length} 道题`);
