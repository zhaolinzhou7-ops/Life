/**
 * 合并多个生成器产出的题库。
 *
 * 题库分几个进程并行生成（杀法慢、战术快，放一个进程里跑慢的会把快的饿死），
 * 这里把它们并起来：按局面去重、重排 id、按难度排序，再顺手体检一遍。
 *
 * 用法：node tools/merge-puzzles.mjs a.json b.json ... > src/xiangqi/puzzles.json
 */
import { readFileSync } from 'fs';

const files = process.argv.slice(2);
if (!files.length) {
  process.stderr.write('用法: node tools/merge-puzzles.mjs <文件...> > puzzles.json\n');
  process.exit(1);
}

const seen = new Set();
const out = [];
for (const f of files) {
  let list;
  try {
    list = JSON.parse(readFileSync(f, 'utf8'));
  } catch (e) {
    process.stderr.write(`跳过 ${f}: ${e.message}\n`);
    continue;
  }
  let dup = 0;
  for (const p of list) {
    if (seen.has(p.fen)) {
      dup++;
      continue;
    }
    seen.add(p.fen);
    out.push(p);
  }
  process.stderr.write(`${f}: ${list.length} 题，去重后新增 ${list.length - dup}\n`);
}

out.sort((a, b) => a.rating - b.rating);
out.forEach((p, i) => {
  p.id = `${p.kind}${p.mateIn ?? ''}-${i.toString(36)}`;
});

// 体检：每类的数量与难度跨度。某一类太少的话测评那一维会测不准，得知道
const byKind = {};
for (const p of out) (byKind[p.kind] ??= []).push(p.rating);
process.stderr.write(`\n合计 ${out.length} 题\n`);
for (const k of Object.keys(byKind).sort()) {
  const r = byKind[k].sort((a, b) => a - b);
  process.stderr.write(
    `  ${k.padEnd(8)} ${String(r.length).padStart(4)} 题  ` +
      `难度 ${r[0]}~${r[r.length - 1]}  中位 ${r[r.length >> 1]}\n`,
  );
}
const bad = out.filter((p) => !p.fen || !p.answer || !p.rating);
if (bad.length) process.stderr.write(`\n⚠️ ${bad.length} 题字段不全\n`);

process.stdout.write(JSON.stringify(out));
