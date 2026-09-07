/**
 * 象棋搜索线程。
 * 大师档要算 3.5 秒，放主线程会把画面冻住（棋子动画、按钮全卡住），
 * 那种卡顿感正是"不像正经游戏"的来源。搜索挪到 Worker 后主线程保持 60fps。
 *
 * 除了对局求解，复盘也走这里：一盘 60 手要逐手搜索约 5 秒，同样不能占着主线程，
 * 而且复盘是**边算边出结果**的——每judge完一手就回一条，界面可以立刻显示进度。
 */
import { think, judgeMove, type SearchOpts } from './ai';
import { applyMove, type Board, type Color, type Move } from './rules';

export interface ThinkRequest {
  kind?: 'think';
  id: number;
  board: Board;
  color: Color;
  opts: SearchOpts;
}

export interface ReviewRequest {
  kind: 'review';
  id: number;
  /** 起始局面 */
  board: Board;
  /** 先手方 */
  color: Color;
  /** 整盘着法 */
  moves: Move[];
  opts: SearchOpts;
}

export type AiRequest = ThinkRequest | ReviewRequest;

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const post = (msg: unknown) => (self as unknown as Worker).postMessage(msg);

  if (e.data.kind === 'review') {
    const { id, board, color, moves, opts } = e.data;
    let cur = board;
    let c = color;
    for (let i = 0; i < moves.length; i++) {
      const judged = judgeMove(cur, c, moves[i], opts);
      // 每手一条，界面可以边算边画进度条
      post({ id, kind: 'review-step', ply: i, color: c, board: cur, judged });
      cur = applyMove(cur, moves[i]);
      c = other(c);
    }
    post({ id, kind: 'review-done' });
    return;
  }

  const { id, board, color, opts } = e.data;
  post({ id, move: think(board, color, opts) });
};
