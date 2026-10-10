/**
 * 找出"本来就赢定了"的题：走棋方第二好的走法也是大优——随便走一手像样的都赢，题目还要你找出最好的那一手。
 *
 * 用户原话："还是存在必胜残局在找最佳步数"。这种题练的不是眼力，是"在赢棋里多赢一点"，没意义。
 * 这里给每道非杀法题算前两名（MultiPV 2），把第二名的分写进题库的 ev2；loadPuzzles 按它过滤。
 * 杀法题不算：找杀本身就是要练的。
 * 用法：node tools/run.mjs find-won-puzzles <分片号> <分片数> [每题毫秒]
 *       然后 node tools/run.mjs find-won-puzzles apply
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { parseInfo, type PvLine } from '../src/xiangqi/pikafish';

interface P {
  id: string;
  fen: string;
  goal?: string;
  ev?: number;
  ev2?: number;
}

const [, , a0 = '0', a1 = '1', a2 = '700', a3 = ''] = process.argv;
const FILE = 'src/xiangqi/puzzles.json';

if (a0 === 'apply') {
  const all = JSON.parse(fs.readFileSync(FILE, 'utf8')) as P[];
  const got = new Map<string, number>();
  for (const f of fs.readdirSync('node_modules/.cache').filter((x) => x.startsWith('won-') && x.endsWith('.jsonl'))) {
    for (const line of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      const r = JSON.parse(line) as { id: string; s2: number };
      got.set(r.id, r.s2);
    }
  }
  let n = 0;
  for (const p of all) {
    const s2 = got.get(p.id);
    if (s2 === undefined) continue;
    p.ev2 = Math.max(-3000, Math.min(3000, s2));
    n++;
  }
  // 题库原来就是一整行的 JSON：保持原样
  fs.writeFileSync(FILE, JSON.stringify(all));
  console.log(`写回 ${n} 题的 ev2；第二好的走法也 ≥600 的：${all.filter((p) => (p.ev2 ?? -1e9) >= 600).length} 题`);
  process.exit(0);
}

const shard = Number(a0);
const n = Number(a1);
const MS = Number(a2);
// 第 4 个参数 mate：只算杀法题（残局里的杀法题，你本来就赢定了、慢一点杀也赢——看要不要出）
const all = (JSON.parse(fs.readFileSync(FILE, 'utf8')) as P[]).filter((p) => (a3 === 'mate' ? p.goal === 'mate' : p.goal !== 'mate'));
const mine = all.filter((_, i) => i % n === shard);
const e = await startPikafish(64);
// 一次性同步写：流式写完紧接着 process.exit 会丢掉还没落盘的数据
const out: string[] = [];
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);

e.send('setoption name MultiPV value 2');
let done = 0;
for (const p of mine) {
  e.send('ucinewgame');
  e.send(`position fen ${p.fen} - - 0 1`);
  const got = e.send(`go movetime ${MS}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(0, ...got.map((l) => l.depth));
  const best = new Map<number, PvLine>();
  for (const l of got)
    if (l.depth >= depth - 1) {
      const had = best.get(l.multipv);
      if (!had || l.depth >= had.depth) best.set(l.multipv, l);
    }
  const top = [...best.values()].sort((x, y) => x.multipv - y.multipv);
  const s1 = top[0] ? val(top[0]) : 0;
  // 只有一手合法着法时没有第二名：当作"非这一手不可"
  const s2 = top[1] ? val(top[1]) : -30000;
  out.push(JSON.stringify({ id: p.id, s1, s2, depth }));
  if (++done % 50 === 0) console.log(`shard ${shard}: ${done}/${mine.length}`);
}
fs.writeFileSync(`node_modules/.cache/won-${a3 === 'mate' ? 'm' : ''}${shard}.jsonl`, out.join('\n') + '\n');
console.log(`shard ${shard} done ${done}`);
process.exit(0);
