/**
 * 把 classify-puzzles 的结果写回题库：每道题加上 goal（题目要求）和 ev（走棋方这时的局面分），
 * 剔掉皮卡鱼不认可的题（正解比它的首选差一个半兵以上）和"已经输定了还让你找防守"的题（落后一个车以上）。
 * 用法：node tools/run.mjs apply-puzzle-goals
 */
import fs from 'fs';

type Row = { id: string; goal: string; s1: number; bad: boolean; err?: string };
const rows: Row[] = [];
for (let k = 0; k < 3; k++) {
  const f = `node_modules/.cache/classify-${k}.jsonl`;
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line.trim()) rows.push(JSON.parse(line));
}
const by = new Map(rows.map((r) => [r.id, r]));
const all = JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')) as Record<string, unknown>[];
let dropped = 0;
let unknown = 0;
const out = all.filter((p) => {
  const r = by.get(p.id as string);
  if (!r || r.err) {
    unknown++;
    return true;
  }
  if (r.bad || (r.goal === 'defend' && r.s1 <= -900)) {
    dropped++;
    return false;
  }
  p.goal = r.goal;
  p.ev = Math.max(-3000, Math.min(3000, r.s1));
  return true;
});
fs.writeFileSync('src/xiangqi/puzzles.json', JSON.stringify(out));
console.log(`题库：${all.length} → ${out.length}（剔掉 ${dropped}，没有分类结果的 ${unknown}）`);
