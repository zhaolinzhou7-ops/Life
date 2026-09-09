/**
 * 布局定式与打谱棋谱的验证：**每一手都必须是那个局面里的合法着法。**
 *
 * 这一路上栽过太多次"写在代码/注释里的断言没有可执行的担保"：
 * 士象摆位、正解唯一、残局胜和、闷宫骨架……每一次都是我自己写的东西错了
 * 而没有闸门拦住。布局着法是纯手写的，最容易错，所以入库先过这一关。
 */
import { legalMoves, applyMove, isInCheck, initialBoard, type Board, type Color } from '../src/xiangqi/rules';
import { textToMove, moveToText } from '../src/xiangqi/notation';
import { OPENINGS } from '../src/xiangqi/openings';
import games from '../src/xiangqi/games.json';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

let bad = 0;
for (const o of OPENINGS) {
  let b = initialBoard();
  let c: Color = 'r';
  const trail: string[] = [];
  for (let i = 0; i < o.moves.length; i++) {
    const want = o.moves[i].t;
    const legal = legalOf(b, c);
    const mv = textToMove(b, c, want, legal);
    if (!mv) {
      const sample = legal.slice(0, 8).map((m) => moveToText(b, m)).join('、');
      console.log(`✗ ${o.name} 第 ${i + 1} 手「${want}」不是合法着法`);
      console.log(`   已走：${trail.join(' ') || '（开局）'}`);
      console.log(`   该方可走的部分着法：${sample}…`);
      bad++;
      break;
    }
    trail.push(want);
    b = applyMove(b, mv);
    c = other(c);
  }
  if (trail.length === o.moves.length) console.log(`✅ ${o.name}：${o.moves.length} 手全部走得通`);
}
// 打谱用的棋谱同样要过闸门：开局那几手是定式抄过来的、中局是引擎下的，
// 但只要有一手走不通，播放器就会在半路停住，学生看到的是一个断掉的谱。
for (const g of games as { name: string; moves: { t: string }[] }[]) {
  let b = initialBoard();
  let c: Color = 'r';
  let okAll = true;
  for (let i = 0; i < g.moves.length; i++) {
    const mv = textToMove(b, c, g.moves[i].t, legalOf(b, c));
    if (!mv) {
      console.log(`✗ ${g.name} 第 ${i + 1} 手「${g.moves[i].t}」走不通`);
      bad++;
      okAll = false;
      break;
    }
    b = applyMove(b, mv);
    c = other(c);
  }
  if (okAll) console.log(`✅ ${g.name}：${g.moves.length} 手全部走得通`);
}

console.log(bad ? `\n✗ ${bad} 处有问题` : '\n✅ 定式与棋谱全部验证通过');
process.exit(bad ? 1 : 0);
