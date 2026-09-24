/**
 * 开局定式：对局里的"这一步按定式该怎么走"。
 *
 * 引擎在开局阶段是最弱的：局面还很平，前几名的分差只有十几分，
 * 算 7 层选出来的"最优"可能是一手很少有人走的冷门棋（比如第一步平边炮），
 * 而真正的高手第一步会走中炮、飞相、仙人指路。**棋理上成熟的定式比浅层搜索可靠**。
 *
 * 所以在定式覆盖到的局面里：
 *   - 🔍 求助除了引擎的梯次，还会说"定式里这里走 X，它在干什么"；
 *   - 教练**不拦定式着法**——按定式走还被教练拦，那是教练的问题。
 *
 * 定式数据来自学棋模块的 openings.ts（每一手都配了"在干什么"，并且过了
 * tools/check-openings.ts 的合法性验证），这里只是把它按局面索引起来。
 */
import { OPENINGS } from './openings';
import { applyMove, initialBoard, legalMoves, type Board, type Color, type Move } from './rules';
import { textToMove, toFen } from './notation';

export interface BookMove {
  move: Move;
  text: string;
  /** 这一手在做什么（一句话） */
  why: string;
  /** 出自哪一套布局 */
  opening: string;
}

let book: Map<string, BookMove[]> | null = null;

const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
/** 定式说明里带 <b> 标记，而且往往好几句；求助面板只要第一句 */
const firstSentence = (html: string) => html.replace(/<[^>]+>/g, '').split('。')[0] + '。';

function build(): Map<string, BookMove[]> {
  const map = new Map<string, BookMove[]>();
  for (const o of OPENINGS) {
    let b = initialBoard();
    let c: Color = 'r';
    for (const om of o.moves) {
      const m = textToMove(b, c, om.t, legalMoves(b, c));
      if (!m) break; // 数据有误就停在这里，不往下猜
      const key = toFen(b, c);
      const list = map.get(key) ?? [];
      if (!list.some((x) => same(x.move, m))) list.push({ move: m, text: om.t, why: firstSentence(om.why), opening: o.name });
      map.set(key, list);
      b = applyMove(b, m);
      c = c === 'r' ? 'b' : 'r';
    }
  }
  return map;
}

/** 这个局面里定式怎么走。不在定式里返回空数组 */
export function bookMoves(board: Board, color: Color): BookMove[] {
  book ??= build();
  return book.get(toFen(board, color)) ?? [];
}

export function isBookMove(board: Board, color: Color, m: Move): boolean {
  return bookMoves(board, color).some((x) => same(x.move, m));
}
