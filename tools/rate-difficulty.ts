/**
 * 题目难度的**唯一**定义。
 *
 * 【为什么单独拆一个文件】这个指标错过一次，代价很大：原来用的是
 * "引擎最浅搜到第几层能找到这一手"，而 think() 带静态搜索(quiescence)，
 * 会把所有吃子序列算干净——**任何以吃子为核心的战术，1 层就能找到**，
 * 一律被压到最低难度档。整个题库 971 道有 794 道挤在 600~900 分，
 * 不是题真的简单，是尺子坏了。
 *
 * 修好之后，生成器和重评工具必须用同一把尺子，否则新生成的题和旧题
 * 的分数不可比。所以定义只留这一份，两边都 import 它。
 *
 * 【现在的指标】正解在**浅层搜索里排第几名**：
 *   · 浅层就排第一 → 一眼能看出来，简单
 *   · 浅层排在后面、深层才升到第一 → 要算才看得见，难
 * 直接对应"人能不能一眼看出来"，而且不受静态搜索干扰。
 */
import { analyze } from '../src/xiangqi/ai';
import { isInCheck, applyMove, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText } from '../src/xiangqi/notation';

export const SHALLOW_DEPTH = Number(process.env.SHALLOW ?? 2);
export const MID_DEPTH = Number(process.env.MID ?? 5);

/** 正解在某个深度的搜索结果里排第几（1 起；找不到返回 99） */
export function rankOfSolution(
  b: Board,
  c: Color,
  answer: string,
  depth: number,
): { rank: number; n: number; move: Move | null } {
  const a = analyze(b, c, { maxDepth: depth, timeMs: 4000, jitter: 0 });
  for (let i = 0; i < a.moves.length; i++) {
    if (moveToText(b, a.moves[i].move) === answer) return { rank: i + 1, n: a.moves.length, move: a.moves[i].move };
  }
  return { rank: 99, n: a.moves.length, move: null };
}

/**
 * 按浅层/中层排名给难度分。
 *
 * ⚠️ 关于系数：**这些数字是估的，不是量出来的。** 要真正标定难度需要
 * 大量人类做题数据，我没有。所以这里只保证一件事——**单调性**：
 * 浅层越看不出来、正解越安静、顺手那手亏得越多，分越高。绝对刻度靠
 * save.ts 里的自校准去修（做过的题会按你的实际表现调整难度，±320 分）。
 * 我不打算假装这个刻度是准的。
 *
 * @param trapLoss 顺手的那一手（浅层首选）比正解差多少分。0 表示不是陷阱题。
 */
export function rateByRank(
  b: Board,
  c: Color,
  mv: Move,
  shallowRank: number,
  midRank: number,
  legalCount: number,
  mateIn?: number,
  trapLoss = 0,
): number {
  const isCap = !!b[mv.ty][mv.tx];
  const isChk = isInCheck(applyMove(b, mv), c === 'r' ? 'b' : 'r');
  const quiet = !isCap && !isChk;

  let r = 620;
  r += Math.min(9, shallowRank - 1) * 78;
  r += Math.min(5, midRank - 1) * 85;
  if (quiet) r += 110; // 既不吃子又不将军的安静着法最难被看见
  else if (!isCap) r += 40;
  r += Math.max(0, legalCount - 18) * 5;
  // 陷阱题：有一手特别顺眼而它是错的。亏得越多说明这个陷阱越像真的，
  // 也越容易掉进去——这是"人会不会走错"的直接信号，比排名更贴近难度
  r += Math.min(400, Math.round(trapLoss * 0.8));
  // 杀法按步数保底：几步杀再"显眼"也不可能是入门题
  if (mateIn && mateIn > 1) r = Math.max(r, 700 + (mateIn - 1) * 260);
  return Math.round(Math.max(600, Math.min(2200, r)));
}

/** 一步到位：给局面和正解，算出难度分 */
export function rateDifficulty(b: Board, c: Color, answer: string, mateIn?: number, trapLoss = 0): number {
  const s = rankOfSolution(b, c, answer, SHALLOW_DEPTH);
  const m = rankOfSolution(b, c, answer, MID_DEPTH);
  const mv = m.move ?? s.move;
  if (!mv) return 900; // 记谱对不上，给个中间值，别乱标
  return rateByRank(b, c, mv, s.rank, m.rank, Math.max(s.n, m.n), mateIn, trapLoss);
}
