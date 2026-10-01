/**
 * 不动引擎，只按现在的 movenote 把布局谱、破解谱里"引擎延伸的那几手"重新配说明
 * （说明模块改进之后不用把几十分钟的深算重跑一遍）。人写的说明（book）不动。
 *
 *   node tools/run.mjs renote-lines
 */
import fs from 'fs';
import { applyMove, initialBoard, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';
import { noteMove } from '../src/xiangqi/movenote';
import { TRICKS, lineToTrap } from '../src/xiangqi/tricks';

type M = { t: string; why: string; book?: boolean };
/** 从开局走 prefix，再给 line 里不是人写的那几手重配说明 */
function renote(prefix: string[], line: M[]) {
  let b: Board = initialBoard();
  let c: Color = 'r';
  for (const t of prefix) {
    const m = textToMove(b, c, t, legalMoves(b, c))!;
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  for (const x of line) {
    const m = textToMove(b, c, x.t, legalMoves(b, c));
    if (!m) throw new Error(`走不通：${x.t}`);
    // 引擎找的变化的第一手带着"这里也可以走"的开头，保留开头、换掉后半句
    if (!x.book) x.why = x.why.startsWith('这里也可以走') ? x.why.replace(/——引擎认为和主线 (\S+) 差不多。.*$/, (_s, k) => `——引擎认为和主线 ${k} 差不多。${noteMove(b, m, c)}`) : noteMove(b, m, c);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
}

const OL = 'src/xiangqi/openinglib.json';
const lib = JSON.parse(fs.readFileSync(OL, 'utf8')) as { moves: M[]; variations: { at: number; moves: M[] }[] }[];
for (const o of lib) {
  renote([], o.moves);
  for (const v of o.variations) renote(o.moves.slice(0, v.at).map((m) => m.t), v.moves);
}
fs.writeFileSync(OL, JSON.stringify(lib));
const TD = 'src/xiangqi/trickdeep.json';
const deep = JSON.parse(fs.readFileSync(TD, 'utf8')) as Record<string, { refute: M[]; trap: M[] }>;
for (const t of TRICKS) {
  const d = deep[t.id];
  if (!d) continue;
  renote([...t.pre, t.trick.t, ...t.refute.map((s) => s.t)], d.refute);
  renote([...lineToTrap(t), ...t.trap.map((s) => s.t)], d.trap);
}
fs.writeFileSync(TD, JSON.stringify(deep));
console.log(`重配说明：布局 ${lib.length} 套，破解 ${Object.keys(deep).length} 条`);
