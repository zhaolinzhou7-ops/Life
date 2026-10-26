/**
 * 你走的不是原谱（或者引擎首选）那一手：这一手站不站得住。做题（train.ts）、打谱猜着法（altjudge.ts）、
 * 离线复核题库（tools/deep-apply.ts）用的都是这一份——检查的和出题的是同一条规矩，不会一处判对一处判错。
 *
 * 用户原话："这个局面错误的走法最后红方能把黑方杀掉，但正确的走法走完之后发现是均势。我觉得要从深度思考的决定、
 * 从最终的结果，再去判定这个走法合不合适。"
 *
 * 所以不只比分差，还看最后的结果：
 *   - 和最好那手差不到 ALT_TOLERANCE：站得住；
 *   - 两手都赢定了（多一个马以上或者有杀）：站得住——不苛求最快赢的那一手；
 *   - 两手都还在胜负未分那一段（最好那手没赢定、你这手也没输定），分差在 SAME_RESULT_TOLERANCE 以内：最后的结果一样，站得住；
 *   - 杀法题（mateGoal）：还能杀就算。
 * 分数都是走棋方视角，车≈1000。
 *
 * SAME_RESULT_TOLERANCE 是让皮卡鱼两边对下到底量出来的（tools/outcome-calibrate.ts：从题库第一步深算的结果里
 * 按分差分档挑"首选 vs 别的走法"，每手各下到底，每手 15～20 万节点，领先一方不许原地打转）。31 对：
 *   分差 150 以内 4 对，结果全一样；150～250 的 6 对只有 2 对一样；250～350 的 13 对只有 3 对一样；350 以上 8 对全不一样。
 * 所以门槛定在 150——再往上，多半就是"最后的结果不一样"了（和棋变输、赢棋变和）。
 * 截图那道题第二步：原谱车八进五三盘全和；兵七平六（深算 20 层比原谱差 216）两盘和、一盘输——按这条规矩不算一样好。
 */
import { isLost, isWon } from './analysis';

export const ALT_TOLERANCE = 80;
export const SAME_RESULT_TOLERANCE = 150;

type S = { score: number; mateIn?: number };

/**
 * same 就是同一手 · close 差不多 · won 都赢定了 · result 最后的结果一样（都还在胜负未分那一段）
 * mated 走了被杀 · missed-mate 放过了杀 · no-mate 杀法题里杀不成了 · lost-win 赢定的棋走没了 · to-lost 走完输定了 · worse 差得多
 */
export type Hold = 'same' | 'close' | 'won' | 'result' | 'mated' | 'missed-mate' | 'no-mate' | 'lost-win' | 'to-lost' | 'worse';

export const holdsOk = (h: Hold) => h === 'same' || h === 'close' || h === 'won' || h === 'result';

export function holds(best: S, mine: S, opts: { same?: boolean; mateGoal?: boolean } = {}): Hold {
  if (opts.same) return 'same';
  // 杀法题：首选有杀，你这手也得能杀——大优但没算出杀的（慢一点的杀，十几层看不到底）也算；
  // 首选也没算出杀（杀得太远）就按下面的规矩比
  if (opts.mateGoal && best.mateIn !== undefined && best.mateIn > 0) {
    if (mine.mateIn !== undefined) return mine.mateIn > 0 ? 'won' : 'mated';
    return isWon(mine) ? 'won' : 'no-mate';
  }
  if (mine.mateIn !== undefined && mine.mateIn < 0) return 'mated';
  if (isWon(best) && isWon(mine)) return 'won';
  if (best.mateIn !== undefined && best.mateIn > 0) return 'missed-mate';
  const loss = best.score - mine.score;
  if (loss <= ALT_TOLERANCE) return 'close';
  if (!isWon(best) && !isLost(mine) && loss <= SAME_RESULT_TOLERANCE) return 'result';
  if (isWon(best)) return 'lost-win';
  if (isLost(mine)) return 'to-lost';
  return 'worse';
}
