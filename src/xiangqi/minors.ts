/**
 * 双方各只剩一个马或炮：能不能当场判和。
 *
 * 用户原话："明显各自只剩一个马还要走半天，或者明显和局（比如各自剩一个炮）还要走很多步……直接判定即可。"
 * 书上这些都是和棋，绝大多数局面引擎也只给几十分。但子摆得别扭时有杀：
 * tools/minor-draw-check.ts 六种子力组合各随机摆 30 个局面，180 个里 10 个有杀：炮双士对光马 5 个、
 * 炮士象全对光马 4 个（马被自家将堵住，九步杀）、炮士象全对光炮 1 个；其余的引擎都只给 60 分以内。
 * 光看子力就判和，会把赢棋判没了。
 * 所以先让引擎看一眼：没有杀、分差不到一个半兵，才当场判和；有杀就接着下，下一步再看。
 */
import type { Board, Color, Move } from './rules';
import { requestAnalysis } from './aiclient';
import { engineReady, linesToMoveScores, search } from './pikafish';

/** 分差在这以内算"谁也赢不了"（车≈1000）。这类局面没杀时引擎给的分在 60 以内 */
const DEAD_MARGIN = 150;

export async function minorsDead(board: Board, color: Color, history?: { startFen: string; moves: Move[] }): Promise<boolean> {
  if (engineReady()) {
    const r = await search({ board, color, history, multipv: 1, nodes: 300000, movetime: 4000 }).promise;
    const best = linesToMoveScores(r.lines, board, color).find((x) => !x.bound);
    if (best) return best.mateIn === undefined && Math.abs(best.score) < DEAD_MARGIN;
  }
  // 皮卡鱼起不来：自带引擎看一眼有没有杀（子少，十层很快）。它的分是按子力算的——多一个象就差两百分，
  // 这类残局里多出来的士象并不能赢，所以只看有没有杀，不看分
  const list = await requestAnalysis(board, color, { maxDepth: 10, timeMs: 1500, jitter: 0 });
  const best = list[0];
  return !!best && best.mateIn === undefined;
}
