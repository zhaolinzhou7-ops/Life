/**
 * 题库、实用残局里去掉"没法下"和"没下头"的局面（规则在 src/xiangqi/balance.ts）。
 *
 * 用户原话："有些题目本身局势已经极度劣势了，比如自己这边只剩一两个马，对方还有两个车，或者一车一炮一马，
 * 这种残局基本没法下了，把这类题目换掉。还有一些局面太势均力敌、没什么下头的题目，比如对方一个车我也一个车、
 * 对方一个马我也一个马，这些也都全部取消掉。"
 *
 *   node tools/run.mjs prune-lopsided          只报不改
 *   node tools/run.mjs prune-lopsided write    写回 puzzles.json、endgamelib.json
 */
import fs from 'fs';
import { endgameUnfit, forceOf, unfit } from '../src/xiangqi/balance';
import { fromFen } from '../src/xiangqi/notation';
import type { Color } from '../src/xiangqi/rules';

const WRITE = process.argv[2] === 'write';
type P = { id: string; kind: string; goal?: string; fen: string; line: string[]; ev?: number; mateIn?: number };
type E = { id: string; name: string; category: string; fen: string; you: Color; target: string };

const desc = (fen: string, me: Color) => {
  const b = fromFen(fen)!.board;
  const s = (c: Color) => {
    const f = forceOf(b, c);
    return `${'车'.repeat(f.R)}${'马'.repeat(f.H)}${'炮'.repeat(f.C)}${f.P ? `${f.P}兵` : ''}` || '光杆';
  };
  return `${s(me)} 对 ${s(me === 'r' ? 'b' : 'r')}`;
};

const PUZ = 'src/xiangqi/puzzles.json';
const puz = JSON.parse(fs.readFileSync(PUZ, 'utf8')) as P[];
const gone: Record<string, string[]> = { hopeless: [], even: [] };
const keep = puz.filter((p) => {
  const why = unfit(p);
  if (!why) return true;
  const me: Color = p.fen.split(' ')[1] === 'b' ? 'b' : 'r';
  gone[why].push(`${p.id}（${p.kind}/${p.goal ?? ''}）${desc(p.fen, me)} ev ${p.ev ?? '-'}`);
  return false;
});
console.log(`题库 ${puz.length} 道 → ${keep.length} 道`);
console.log(`  大劣（少一个车以上，正解也吃不回来）：${gone.hopeless.length} 道`);
for (const s of gone.hopeless.slice(0, 12)) console.log('    ' + s);
console.log(`  对等没下头（车对车、马对马……和棋）：${gone.even.length} 道`);
for (const s of gone.even.slice(0, 12)) console.log('    ' + s);
const byKind = (xs: string[]) => xs.reduce<Record<string, number>>((a, s) => ((a[s.split('（')[1].split('/')[0]] = (a[s.split('（')[1].split('/')[0]] ?? 0) + 1), a), {});
console.log('  按题型：大劣', byKind(gone.hopeless), '对等', byKind(gone.even));

// 实用残局下到底：你是哪一方写在 you；结论写在 target（win / draw）
const LIB = 'src/xiangqi/endgamelib.json';
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8')) as E[];
const libGone: Record<string, string[]> = { hopeless: [], even: [] };
const libKeep = lib.filter((e) => {
  const why = endgameUnfit(e);
  if (why) libGone[why].push(`${e.id} ${e.category} ${desc(e.fen, e.you)}（${e.target === 'draw' ? '和' : '胜'}）`);
  return !why;
});
console.log(`\n实用残局 ${lib.length} 局 → ${libKeep.length} 局`);
console.log(`  大劣：${libGone.hopeless.length} 局`);
for (const s of libGone.hopeless.slice(0, 10)) console.log('    ' + s);
console.log(`  对等的和棋：${libGone.even.length} 局`);
for (const s of libGone.even.slice(0, 10)) console.log('    ' + s);
const cats = (xs: string[]) => xs.reduce<Record<string, number>>((a, s) => ((a[s.split(' ')[1]] = (a[s.split(' ')[1]] ?? 0) + 1), a), {});
console.log('  按类别：', cats(libGone.even));

if (WRITE) {
  fs.writeFileSync(PUZ, JSON.stringify(keep));
  fs.writeFileSync(LIB, JSON.stringify(libKeep));
  console.log('\n已写回');
}
