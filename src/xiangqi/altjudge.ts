/**
 * 打谱猜着法时，你走的不是原谱那一手：让皮卡鱼判它是不是一样好。
 *
 * 谱一长（15 回合），同样好的着法会很多，只认原谱那一手会把走对的人判错。
 * 做法：两手各精确算一下，你那一手比原谱那一手差不到 tol（车≈1000）就算对。
 * 皮卡鱼起不来返回 null（调用方只认原谱）。
 */
import type { Board, Color, Move } from './rules';
import { engineCapable, engineReady, engineScoreMove, loadEngine } from './pikafish';

const val = (s: { score: number; mateIn?: number }) =>
  s.mateIn !== undefined ? (s.mateIn > 0 ? 30000 - s.mateIn : -30000 - s.mateIn) : s.score;

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
  return { ok: loss <= tol, loss };
}
