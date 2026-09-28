/**
 * 象棋搜索线程。
 * 大师档要算 3.5 秒，放主线程会把画面冻住（棋子动画、按钮全卡住），
 * 那种卡顿感正是"不像正经游戏"的来源。搜索挪到 Worker 后主线程保持 60fps。
 *
 * 除了对局求解，复盘也走这里：一盘 60 手要逐手搜索约 5 秒，同样不能占着主线程，
 * 而且复盘是**边算边出结果**的——每judge完一手就回一条，界面可以立刻显示进度。
 */
import { analyze, think, judgeMove, scoreMove, type SearchOpts } from './ai';
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

/**
 * 候选着法请求：教练要回答"还有哪几手更好、各自想干什么"，
 * 光有一个最佳着法不够，得把前几名连分数带主变一起拿回来。
 */
export interface AnalyzeRequest {
  kind: 'analyze';
  id: number;
  board: Board;
  color: Color;
  opts: SearchOpts;
}

/**
 * 对局中的"研究"：轮到你走时，把这个局面一层一层往深算，每算完一层回一条。
 *
 * 教练判你这一手、🔍 求助给最优解，读的都是这一份——同一个局面只有一个裁判，
 * 两边才不会一个说不行、一个说最好。
 */
export interface StudyRequest {
  kind: 'study';
  id: number;
  board: Board;
  color: Color;
  opts: SearchOpts;
}

/** 只精确算一手（教练要拦的那一手） */
export interface ScoreRequest {
  kind: 'score';
  id: number;
  board: Board;
  color: Color;
  move: Move;
  opts: SearchOpts;
}

export type AiRequest = ThinkRequest | ReviewRequest | AnalyzeRequest | StudyRequest | ScoreRequest;

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

  if (e.data.kind === 'score') {
    const { id, board, color, move, opts } = e.data;
    post({ id, kind: 'score', score: scoreMove(board, color, move, opts) });
    return;
  }

  if (e.data.kind === 'study') {
    const { id, board, color, opts } = e.data;
    const a = analyze(board, color, opts, (step) => {
      post({ id, kind: 'study-step', moves: step.moves, depth: step.depth });
    });
    post({ id, kind: 'study-done', moves: a.moves, depth: a.depth });
    return;
  }

  if (e.data.kind === 'analyze') {
    const { id, board, color, opts } = e.data;
    const a = analyze(board, color, opts);
    // **整张表都回**。界面只显示前几档，但用户走的那一手必须能查到名次——
    // 只回前几名的话，他走了一手排第三十的棋，教练就只能说"不在前几名里"，
    // 连排第几、差多少都说不出来，而那正是他最想知道的。
    // 一个局面四十来手，连主变一起传过去也就几十 KB，不值得为此省。
    post({ id, kind: 'analysis', moves: a.moves, depth: a.depth });
    return;
  }

  const { id, board, color, opts } = e.data;
  post({ id, move: think(board, color, opts) });
};
