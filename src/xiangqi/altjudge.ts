/**
 * 打谱猜着法时，你走的不是原谱那一手：让皮卡鱼判它是不是一样好。
 *
 * 谱一长（15 回合），同样好的着法会很多，只认原谱那一手会把走对的人判错。
 * 做法：两手各精确算一下，你那一手比原谱那一手差不到 tol（车≈1000）就算对；
 * 差得多但两手最后的结果一样（holds.ts：都还在胜负未分那一段、分差不大，或者都赢定了）也算对——
 * 要判错之前先算深一点再看（用户原话："我觉得要从深度思考的决定、从最终的结果，再去判定这个走法合不合适"）。
 * 皮卡鱼起不来返回 null（调用方只认原谱）。
 */
import type { Board, Color, Move } from './rules';
import { engineCapable, engineReady, engineScoreMove, loadEngine } from './pikafish';
import { holds, holdsOk } from './holds';

const val = (s: { score: number; mateIn?: number }) =>
  s.mateIn !== undefined ? (s.mateIn > 0 ? 30000 - s.mateIn : -30000 - s.mateIn) : s.score;
/** 要判错之前再算这么久 */
const CONFIRM_MS = 3000;

export async function judgeAgainst(
  board: Board,
  color: Color,
  mine: Move,
  expected: Move,
  tol = 60,
): Promise<{ ok: boolean; loss: number } | null> {
  if (!engineCapable()) return null;
  if (!engineReady()) {
    const up = await Promise.race([loadEngine(), new Promise<boolean>((r) => setTimeout(() => r(false), 12000))]);
    if (!up) return null;
  }
  const a = await engineScoreMove(board, color, mine, { movetime: 1000 });
  const b = await engineScoreMove(board, color, expected, { movetime: 1000 });
  if (!a || !b) return null;
  const loss = Math.max(0, val(b) - val(a));
  if (loss <= tol) return { ok: true, loss };
  if (holdsOk(holds(b, a))) return { ok: true, loss };
  // 浅算说差得多、又不是一眼就输（被杀、丢大子）：算深一点再定
  if ((a.mateIn !== undefined && a.mateIn < 0) || loss >= 900) return { ok: false, loss };
  const a2 = await engineScoreMove(board, color, mine, { movetime: CONFIRM_MS });
  const b2 = await engineScoreMove(board, color, expected, { movetime: CONFIRM_MS });
  if (!a2 || !b2) return { ok: false, loss };
  const loss2 = Math.max(0, val(b2) - val(a2));
  return { ok: loss2 <= tol || holdsOk(holds(b2, a2)), loss: loss2 };
}
