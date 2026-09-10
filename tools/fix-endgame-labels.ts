/**
 * 用当前的判定规则把残局库的胜/和标签重新定一遍（**局面不动，只改标签**）。
 *
 * 为什么不整个重造：局面本身已经过了落点合法性的闸门，而且题号是存档的键——
 * 「已通过」「你猜的是胜还是和」「你赢过」都按题号存。重造会换题号，
 * 用户的记录就对错人了（这个坑在合并题库时已经踩过一次）。
 *
 * 所以这里只做一件事：重新跑 verdict，把 target / plies / reason / rating 更新。
 * 判定和生成器、体检用的是同一份实现（playout-verdict.ts），不会各说各话。
 */
import { fromFen } from '../src/xiangqi/notation';
import { verdict, depthsFor } from './playout-verdict';
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/xiangqi/endgamelib.json';
interface EG {
  id: string;
  name: string;
  fen: string;
  you: 'r' | 'b';
  target: 'win' | 'draw';
  plies: number;
  reason: string;
  rating: number;
  [k: string]: unknown;
}

const lib = JSON.parse(readFileSync(FILE, 'utf8')) as EG[];
const kept: EG[] = [];
let changed = 0;
let dropped = 0;

for (const e of lib) {
  const p = fromFen(e.fen);
  if (!p) {
    dropped++;
    console.log(`✗ ${e.id} FEN 读不出，删`);
    continue;
  }
  const v = verdict(p.board, e.you);
  const ds = depthsFor(p.board).join('/');
  if (v.target === 'loss') {
    dropped++;
    console.log(`✗ ${e.id}（${e.name}）守方会输，删`);
    continue;
  }
  if (v.target === 'unstable') {
    dropped++;
    console.log(`✗ ${e.id}（${e.name}）不同深度结论不一致，删——这种局面没有稳定答案，不能当教材`);
    continue;
  }
  if (v.target !== e.target) {
    changed++;
    console.log(`  ${e.id}（${e.name}）${e.target} → ${v.target}  ${ds} 层，${v.plies} 步，${v.reason}`);
  }
  e.target = v.target;
  e.plies = v.plies;
  e.reason = v.reason;
  e.rating = v.target === 'win' ? Math.min(1700, 950 + v.plies * 6) : 1150;
  kept.push(e);
}

writeFileSync(FILE, JSON.stringify(kept));
console.log(`\n残局 ${lib.length} → ${kept.length}：改标签 ${changed} 个，删 ${dropped} 个`);
