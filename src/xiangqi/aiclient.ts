/**
 * 搜索线程的调用封装：能起 Worker 就用 Worker，起不来（老浏览器 / 沙箱限制）
 * 就退回主线程同步计算，保证功能永远可用。
 */
import { bestMove, judgeMove, type SearchOpts } from './ai';
import { applyMove, type Board, type Color, type Move } from './rules';
import type { Judged } from './analysis';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (m: Move | null) => void>();
/** 复盘是流式的：每算完一手回一次 onStep，全部算完回 onDone */
const reviews = new Map<number, { onStep: ReviewStep; onDone: () => void }>();
let workerBroken = false;

export type ReviewStep = (ply: number, color: Color, board: Board, judged: Judged | null) => void;

interface WorkerMsg {
  id: number;
  kind?: 'review-step' | 'review-done';
  move?: Move | null;
  ply?: number;
  color?: Color;
  board?: Board;
  judged?: Judged | null;
}

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
      const d = e.data;
      if (d.kind === 'review-step') {
        reviews.get(d.id)?.onStep(d.ply!, d.color!, d.board!, d.judged ?? null);
        return;
      }
      if (d.kind === 'review-done') {
        const r = reviews.get(d.id);
        reviews.delete(d.id);
        r?.onDone();
        return;
      }
      const cb = pending.get(d.id);
      if (cb) {
        pending.delete(d.id);
        cb(d.move ?? null);
      }
    };
    worker.onerror = () => {
      // 线程起不来就整体退回同步模式，别让对局卡死
      workerBroken = true;
      for (const [, cb] of pending) cb(null);
      pending.clear();
      for (const [, r] of reviews) r.onDone();
      reviews.clear();
      worker?.terminate();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

/** 异步求解；Worker 不可用时同步兜底 */
/**
 * 提前把搜索线程叫起来。
 *
 * Worker 是懒创建的：第一次轮到对手时才 new Worker，那一下要装载模块、
 * 编译、初始化置换表。结果就是**第一步的回手明显比后面慢**，
 * 而第一步恰恰是人对"这软件反应快不快"印象最深的时候。
 * 开局时先扔一个极小的搜索进去把它热起来，代价可以忽略。
 */
export function warmupAi(board: Board, color: Color) {
  const w = ensureWorker();
  if (!w) return; // 起不来就算了，同步兜底路径本来也不需要预热
  const id = ++seq;
  pending.set(id, () => {
    /* 预热结果不要 */
  });
  w.postMessage({ id, board, color, opts: { maxDepth: 1, timeMs: 30, jitter: 0 } });
}

export function requestMove(board: Board, color: Color, opts: SearchOpts): Promise<Move | null> {
  const w = ensureWorker();
  if (!w) return Promise.resolve(bestMove(board, color, opts.maxDepth, opts.jitter, opts.timeMs));
  const id = ++seq;
  return new Promise((resolve) => {
    let done = false;
    const finish = (m: Move | null) => {
      if (done) return;
      done = true;
      resolve(m);
    };
    // 兜底：线程异常没回消息时，超时后主线程自己算
    const guard = window.setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        finish(bestMove(board, color, opts.maxDepth, opts.jitter, opts.timeMs));
      }
    }, opts.timeMs + 4000);
    pending.set(id, (m) => {
      clearTimeout(guard);
      finish(m);
    });
    w.postMessage({ id, board, color, opts });
  });
}

/**
 * 复盘整盘棋。每算完一手调一次 onStep（界面可以边算边显示），全部算完调 onDone。
 * 返回取消函数——用户中途退出复盘界面时要能停下来，不然白烧几秒 CPU。
 */
export function requestReview(
  board: Board,
  color: Color,
  moves: Move[],
  opts: SearchOpts,
  onStep: ReviewStep,
  onDone: () => void,
): () => void {
  const w = ensureWorker();
  const id = ++seq;

  if (w) {
    reviews.set(id, { onStep, onDone });
    w.postMessage({ kind: 'review', id, board, color, moves, opts });
    return () => {
      if (!reviews.delete(id)) return;
      // Worker 里的循环停不下来，只能整个换掉，避免它继续往回发消息
      worker?.terminate();
      worker = null;
    };
  }

  // 同步兜底：切成一手一个宏任务，界面还能响应，不至于整片冻住
  let cancelled = false;
  let cur = board;
  let c = color;
  let i = 0;
  const step = () => {
    if (cancelled) return;
    if (i >= moves.length) {
      onDone();
      return;
    }
    const judged = judgeMove(cur, c, moves[i], opts);
    onStep(i, c, cur, judged);
    cur = applyMove(cur, moves[i]);
    c = c === 'r' ? 'b' : 'r';
    i++;
    window.setTimeout(step, 0);
  };
  window.setTimeout(step, 0);
  return () => {
    cancelled = true;
  };
}

export function disposeAi() {
  worker?.terminate();
  worker = null;
  pending.clear();
  reviews.clear();
  workerBroken = false;
}
