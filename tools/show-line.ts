/**
 * 把一条着法一手一手摆出来（文字棋盘 + 这一手的事实说明），写讲解之前核对局面用。
 *   node tools/run.mjs show-line "<着法…>" [从第几手开始显示=0]
 */
import { applyMove, initialBoard, isInCheck, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';
import { noteMove } from '../src/xiangqi/movenote';

const [, , line = '', fromArg = '0'] = process.argv;
const NAMES: Record<string, string> = { rK: '帅', rA: '仕', rE: '相', rH: '马', rR: '车', rC: '炮', rP: '兵', bK: '将', bA: '士', bE: '象', bH: '馬', bR: '車', bC: '砲', bP: '卒' };
function draw(b: Board): string {
  const rows: string[] = ['   1 2 3 4 5 6 7 8 9 (黑)'];
  for (let y = 0; y < 10; y++) {
    let s = `${y} `;
    for (let x = 0; x < 9; x++) {
      const p = b[y][x];
      s += p ? NAMES[p.c + p.t] : '．';
    }
    rows.push(s + (y === 4 ? '  ～河～' : ''));
  }
  rows.push('   九八七六五四三二一 (红)');
  return rows.join('\n');
}
let b = initialBoard();
let c: Color = 'r';
const texts = line.split(/\s+/).filter(Boolean);
texts.forEach((t, i) => {
  const m = textToMove(b, c, t, legalMoves(b, c));
  if (!m) {
    console.log(`✗ 走不通：${t}`);
    process.exit(1);
  }
  const note = noteMove(b, m, c);
  b = applyMove(b, m);
  c = c === 'r' ? 'b' : 'r';
  if (i >= Number(fromArg)) console.log(`\n${i + 1}. ${t}　${note}${isInCheck(b, c) ? '【将军】' : ''}\n${draw(b)}`);
});
