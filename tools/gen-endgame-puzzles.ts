/**
 * 从残局库的局面里挑出"只有一手最好"的，做成残局题。
 *   进攻方：首选明显好过第二选（杀得更快，或者多出两个半兵以上）
 *   守方：只有这一手守得住（首选是和，其余都要输一大截）
 * 用法：node tools/run.mjs gen-endgame-puzzles <分片号> <分片数>
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, legalMoves, type Color } from '../src/xiangqi/rules';
import { fromFen, moveToText, toFen } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { obviousDraw, obviousWin, type EndgamePos } from '../src/xiangqi/library';
import { rateDifficulty } from './rate-difficulty';

const shard = Number(process.argv[2] ?? 0);
const n = Number(process.argv[3] ?? 1);
// OLD_LIB=旧的残局库文件：只看这次新加的局面（老局面上次已经挑过题了）
const old = process.env.OLD_LIB ? new Set((JSON.parse(fs.readFileSync(process.env.OLD_LIB, 'utf8')) as EndgamePos[]).map((p) => p.id)) : null;
const lib = (JSON.parse(fs.readFileSync('src/xiangqi/endgamelib.json', 'utf8')) as EndgamePos[])
  .filter((p) => !old?.has(p.id))
  // 界面上不出的局面（对方只剩将士象、一眼和棋）不用看
  .filter((p) => !obviousWin(p) && !obviousDraw(p))
  .filter((_, i) => i % n === shard);
const e = await startPikafish(64);
// 逐条同步追加（引擎调用是同步阻塞的，写流要到最后才落盘；容器中途重启就全丢了）
const OUT = `node_modules/.cache/egp-${shard}.jsonl`;
fs.writeFileSync(OUT, '');
const out = { write: (x: string) => fs.appendFileSync(OUT, x), end: () => {} };
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
const found: unknown[] = [];
/**
 * 看一个局面能不能出题；返回皮卡鱼的主变（往下走几步再看用）。
 */
function probe(fen: string, id: string, role: 'att' | 'def'): string[] {
  const parsed = fromFen(fen);
  if (!parsed) return [];
  e.send('ucinewgame');
  e.send('setoption name MultiPV value 3');
  e.send(`position fen ${fen} - - 0 1`);
  const lines = e.send('go movetime 1500').map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(0, ...lines.map((l) => l.depth));
  const top = new Map<number, PvLine>();
  for (const l of lines) if (l.depth >= depth - 1) top.set(l.multipv, l);
  const b1 = top.get(1);
  const b2 = top.get(2);
  if (!b1 || !b2) return b1?.pv ?? [];
  const v1 = val(b1);
  const v2 = val(b2);
  let goal: string | null = null;
  if (role === 'att') {
    if (b1.mateIn !== undefined && b1.mateIn > 0 && (b2.mateIn === undefined || b2.mateIn < 0 || b2.mateIn >= b1.mateIn + 3)) goal = b1.mateIn <= 6 ? 'mate' : 'only';
    else if (b1.mateIn === undefined && v1 >= 300 && v1 - v2 >= 250) goal = 'only';
  } else if (Math.abs(v1) < 150 && v1 - v2 >= 400) goal = 'only';
  if (!goal) return b1.pv;
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
  if (!line.length) return b1.pv;
  // 难度：原来的保底分（杀棋按步数、守和 1250、取胜按领先多少）和其它题同一把尺子（rate-difficulty）取大的。
  // 原来只有保底分：五步杀才 1100，残局题几乎都在入门段（用户原话"低级题目太多"）
  const base =
    goal === 'mate' ? 800 + 60 * Math.min(10, b1.mateIn ?? 0) : role === 'def' ? 1250 : 1100 + Math.min(300, Math.round((v1 - v2) / 5));
  const rating = Math.max(base, rateDifficulty(parsed.board, parsed.toMove, line[0], goal === 'mate' ? b1.mateIn : undefined));
  const rec = {
    id,
    kind: 'endgame',
    fen,
    answer: line[0],
    line,
    rating,
    goal,
    ev: Math.max(-3000, Math.min(3000, v1 >= 29000 ? 3000 : v1)),
    ...(goal === 'mate' ? { mateIn: b1.mateIn } : {}),
  };
  found.push(rec);
  out.write(JSON.stringify(rec) + '\n');
  return b1.pv;
}

// DEEP=1：每个局面再沿主变往下走 2、4、6、8 步（还是同一方走），各看一次能不能出题。
// 一个残局只在开头那一步有"唯一着法"太少了，下到中途的关键一手才是残局题最多的地方
const DEEP = process.env.DEEP === '1';
const seen = new Set<string>();
for (const p of lib) {
  const role = p.role ?? 'att';
  const pv = probe(p.fen, `egp-${p.id}`, role);
  if (!DEEP) continue;
  const parsed = fromFen(p.fen);
  if (!parsed) continue;
  let cur = parsed.board;
  let c: Color = parsed.toMove;
  for (let ply = 1; ply <= 8 && ply <= pv.length; ply++) {
    const m = uciToMove(pv[ply - 1]);
    if (!m || !legalMoves(cur, c).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)) break;
    cur = applyMove(cur, m);
    c = c === 'r' ? 'b' : 'r';
    if (ply % 2 || !legalMoves(cur, c).length) continue;
    const fen = toFen(cur, c);
    if (seen.has(fen)) continue;
    seen.add(fen);
    probe(fen, `egp-${p.id}-${ply}`, role);
  }
}
out.end();
console.log(`shard ${shard}: ${lib.length} 个局面 → ${found.length} 道题`);
