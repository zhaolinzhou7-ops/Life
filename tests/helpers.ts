/**
 * 测试用的小工具：用**看得懂的图**摆棋盘。
 *
 * FEN 摆局面写起来快但没法读——`4k4/9/9/9/9/9/9/9/9/4K4 w` 谁也看不出
 * 那是什么棋。规则测试是这个项目最不能出错的一层，测试本身必须能当文档读，
 * 所以这里支持直接画 10 行 × 9 列的字符图：
 *
 *   '. . . k . . . . .'   ← y=0，黑方底线
 *   ...
 *   '. . . K . . . . .'   ← y=9，红方底线
 *
 * 大写 = 红，小写 = 黑，'.' = 空。用的是 FEN 的字母（k 帅 a 仕 b 相 n 马
 * r 车 c 炮 p 兵），和 notation.ts 保持一致，不再发明第二套记号。
 */
import { COLS, ROWS, type Board, type Color, type Move, type Piece, type PType } from '../src/xiangqi/rules';
import { moveToText } from '../src/xiangqi/notation';

/**
 * 字母 → 棋子类型。
 *
 * 两套写法都收：FEN 那一套（k a b n r c p，和 notation.ts 一致）和
 * 引擎内部的 PType（K A E H R C P）。两套没有冲突，但混用时最容易写错的是
 * 马和相——FEN 里马是 n、相是 b，直觉上会写 h 和 e。所以两种都认。
 *
 * 认不出来的字母**必须抛错**。上一版这里查不到就悄悄返回 undefined，
 * 摆出一个 `{t: undefined}` 的鬼棋子：它不会报错，只是一步也走不了，
 * 于是测试红了却指向"马的走法错了"，真正的原因是测试自己写错了字母。
 * 规则测试是这个产品的地基，地基的工具必须吵闹。
 */
const CH: Record<string, PType> = {
  k: 'K', a: 'A', b: 'E', n: 'H', r: 'R', c: 'C', p: 'P',
  e: 'E', h: 'H', // 直觉写法：相 elephant、马 horse
};

/** 解析一个字符成棋子；认不出来就抛错 */
function pieceOf(ch: string): Piece {
  const t = CH[ch.toLowerCase()];
  if (!t) throw new Error(`看不懂的棋子字母「${ch}」。可用：k帅 a仕 b/e相 n/h马 r车 c炮 p兵（大写=红）`);
  return { t, c: ch === ch.toUpperCase() ? 'r' : 'b' };
}

/** 画图摆盘。每行 9 个格，空格分隔或紧挨都行 */
export function board(...rows: string[]): Board {
  if (rows.length !== ROWS) throw new Error(`棋盘要 ${ROWS} 行，给了 ${rows.length} 行`);
  const b: Board = Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
  rows.forEach((row, y) => {
    const cells = row.trim().split(/\s+/);
    if (cells.length !== COLS) throw new Error(`第 ${y} 行要 ${COLS} 格，给了 ${cells.length} 格：${row}`);
    cells.forEach((ch, x) => {
      if (ch === '.') return;
      try {
        b[y][x] = pieceOf(ch);
      } catch (e) {
        throw new Error(`第 ${y} 行第 ${x} 列：${(e as Error).message}`);
      }
    });
  });
  return b;
}

/**
 * 只有两个光帅的空盘，往上加子最省事。
 *
 * 两个王**故意不同列**（黑将三路、红帅五路）。空盘上如果同列，
 * 将帅照面规则会让几乎每一手都变成非法着法——那样测出来的不是
 * 被测棋子的走法，而是照面规则，白测。照面要单独测，见对应用例。
 */
export const bare = (): Board =>
  board(
    '. . . k . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . . . . . .',
    '. . . . K . . . .',
  );

/** 在盘上放子，返回同一个盘方便串写 */
export function put(b: Board, x: number, y: number, ch: string): Board {
  if (x < 0 || x >= COLS || y < 0 || y >= ROWS) throw new Error(`落点出界：(${x},${y})`);
  b[y][x] = ch === '.' ? null : pieceOf(ch);
  return b;
}

/** 某个子能走到的所有落点，排序后好比对 */
export function destsOf(moves: Move[], x: number, y: number): string[] {
  return moves
    .filter((m) => m.fx === x && m.fy === y)
    .map((m) => `${m.tx},${m.ty}`)
    .sort();
}

/** 把着法列表转成中文记谱，断言读起来是人话 */
export const textsOf = (b: Board, moves: Move[]): string[] => moves.map((m) => moveToText(b, m)).sort();

/** 找一手从 (fx,fy) 到 (tx,ty) 的着法 */
export const mv = (fx: number, fy: number, tx: number, ty: number): Move => ({ fx, fy, tx, ty });

export const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
