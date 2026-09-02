/**
 * 象棋搜索线程。
 * 大师档要算 3.5 秒，放主线程会把画面冻住（棋子动画、按钮全卡住），
 * 那种卡顿感正是"不像正经游戏"的来源。搜索挪到 Worker 后主线程保持 60fps。
 */
import { think, type SearchOpts } from './ai';
import type { Board, Color } from './rules';

export interface AiRequest {
  id: number;
  board: Board;
  color: Color;
  opts: SearchOpts;
}

self.onmessage = (e: MessageEvent<AiRequest>) => {
  const { id, board, color, opts } = e.data;
  const move = think(board, color, opts);
  (self as unknown as Worker).postMessage({ id, move });
};
