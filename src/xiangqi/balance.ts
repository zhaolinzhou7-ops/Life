/**
 * 题目局面"值不值得练"：子力上一眼就没法下的、双方对等没什么下头的，不出。
 *
 * 用户原话："复盘错题时看一下题目：有些题目本身局势已经极度劣势了，比如自己这边只剩一两个马，
 * 对方还有两个车，或者一车一炮一马，这种残局基本没法下了，把这类题目换掉。
 * 还有一些局面太势均力敌、没什么下头的题目，比如对方一个车我也一个车、对方一个马我也一个马，这些也都全部取消掉。"
 *
 * 只看能动手的子（车马炮兵），士象不算：车 9、马 4、炮 4.5、兵 1（过河 2）。
 *   - 大劣（hopeless）：自己比对方少 8 分以上——少一个车、或者少两个马炮。
 *     "两个马对两个车"差 10，"两个马对车马炮"差 9.5；
 *   - 对等（evenSparse）：双方能动手的子一样多、都不超过两个，分差不超过 1（马和炮算一样），兵差不超过一个——
 *     车对车、马对马、马对炮、车马对车炮……这时候还得看结果：赢不了也输不了（和棋）才算"没什么下头"，
 *     有杀、能赢的照样是题（车兵对车的杀法、单兵怎么赢）。
 * 用到的地方：题库和实用残局离线清理（tools/prune-lopsided.ts）、数据体检（audit-data）、
 * 加载题库时再拦一道（puzzles.ts）、实战抓错着进错题本（gamescore.ts）、错题本里以前存下的（save.ts）。
 */
import { fromFen, textToMove } from './notation';
import { applyMove, legalMoves, type Board, type Color } from './rules';

export interface Force {
  R: number;
  H: number;
  C: number;
  P: number;
  /** 能动手的子一共几分 */
  pts: number;
}

const PTS = { R: 9, H: 4, C: 4.5 } as const;
/** 少这么多分算大劣：一个车 */
export const HOPELESS_GAP = 8;

export function forceOf(b: Board, c: Color): Force {
  const f: Force = { R: 0, H: 0, C: 0, P: 0, pts: 0 };
  for (let y = 0; y < b.length; y++) {
    for (const p of b[y]) {
      if (!p || p.c !== c) continue;
      if (p.t === 'R' || p.t === 'H' || p.t === 'C') {
        f[p.t]++;
        f.pts += PTS[p.t];
      } else if (p.t === 'P') {
        f.P++;
        // 过了河的兵能横走、能逼宫，值两个
        f.pts += (c === 'r' ? y <= 4 : y >= 5) ? 2 : 1;
      }
    }
  }
  return f;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

/** 大劣：me 这一方能动手的子比对方少一个车以上 */
export function hopeless(b: Board, me: Color): boolean {
  return forceOf(b, other(me)).pts - forceOf(b, me).pts >= HOPELESS_GAP;
}

/** 双方子力对等而且很少（车对车、马对马、车马对车炮……兵差不超过一个）。是不是"没下头"还要看结果，见 deadEven */
export function evenSparse(b: Board): boolean {
  const r = forceOf(b, 'r');
  const k = forceOf(b, 'b');
  const nr = r.R + r.H + r.C;
  const nk = k.R + k.H + k.C;
  const big = (f: Force) => f.R * PTS.R + f.H * PTS.H + f.C * PTS.C;
  return nr === nk && nr <= 2 && r.R === k.R && Math.abs(big(r) - big(k)) <= 1 && Math.abs(r.P - k.P) <= 1;
}

/** 结果是不是和棋那一档：没有杀，局面分（皮卡鱼深算，走棋方视角，车≈1000）不到三个兵 */
export const drawish = (o: { ev?: number; mate?: boolean }) => !o.mate && Math.abs(o.ev ?? 0) < 300;

/** 对等又是和棋：车对车、马对马这种，下下去也是和——"没什么下头" */
export function deadEven(b: Board, o: { ev?: number; mate?: boolean }): boolean {
  return evenSparse(b) && drawish(o);
}

/** 一道题（题库、实战抓的错着）：FEN 的走棋方就是解题方，line 是主变（中文记谱） */
export interface PuzzleLike {
  fen: string;
  line?: string[];
  ev?: number;
  goal?: string;
  mateIn?: number;
}

/** 按主变走完以后的局面（走不下去就停在那一步） */
function afterLine(b: Board, c: Color, line: string[]): Board {
  let cur = b;
  let side = c;
  for (const t of line) {
    const m = textToMove(cur, side, t, legalMoves(cur, side));
    if (!m) break;
    cur = applyMove(cur, m);
    side = other(side);
  }
  return cur;
}

/**
 * 这道题该不该出：'hopeless' 大劣、'even' 对等没下头、null 照常出。
 * 大劣（少子反而能赢的不算）分两种：
 *   - 自己能动手的子只剩一两个（"只剩一两个马"），还比对方少一个车以上：不管正解怎么走都不出——
 *     引擎说守得住（马兵对车炮的和棋）、或者正解能捞回一个子，看上去照样是"没法下"；
 *   - 子多的局面（中局）：开头和主变走完都还差一个车以上才算。开头少子、正解把子吃回来的战术题照出（那是题眼）。
 */
export function unfit(p: PuzzleLike): 'hopeless' | 'even' | null {
  const f = fromFen(p.fen);
  if (!f) return null;
  const me = f.toMove;
  // 少子反而能赢（有杀、正解走完大优）：那是以少胜多的妙手，不算"没法下"
  const wins = p.goal === 'mate' || p.mateIn !== undefined || (p.ev ?? 0) >= 300;
  if (!wins && hopeless(f.board, me)) {
    const mine = forceOf(f.board, me);
    if (mine.R + mine.H + mine.C <= 2 || hopeless(afterLine(f.board, me, p.line ?? []), me)) return 'hopeless';
  }
  if (deadEven(f.board, { ev: p.ev, mate: p.goal === 'mate' || p.mateIn !== undefined })) return 'even';
  return null;
}

/** 实用残局（下到底）：你是哪一方写在 you，结论写在 target。大劣的（守方只剩一两个子还差一个车）、对等的和棋不出 */
export function endgameUnfit(e: { fen: string; you: Color; target: string }): 'hopeless' | 'even' | null {
  const f = fromFen(e.fen);
  if (!f) return null;
  if (hopeless(f.board, e.you)) return 'hopeless';
  if (evenSparse(f.board) && e.target === 'draw') return 'even';
  return null;
}
