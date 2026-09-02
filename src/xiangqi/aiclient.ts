/**
 * 搜索线程的调用封装：能起 Worker 就用 Worker，起不来（老浏览器 / 沙箱限制）
 * 就退回主线程同步计算，保证功能永远可用。
 */
import { bestMove, type SearchOpts } from './ai';
import type { Board, Color, Move } from './rules';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (m: Move | null) => void>();
let workerBroken = false;

function ensureWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; move: Move | null }>) => {
      const cb = pending.get(e.data.id);
      if (cb) {
        pending.delete(e.data.id);
        cb(e.data.move);
      }
    };
    worker.onerror = () => {
      // 线程起不来就整体退回同步模式，别让对局卡死
      workerBroken = true;
      for (const [, cb] of pending) cb(null);
      pending.clear();
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
    pending.set(id, finish);
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

export function disposeAi() {
  worker?.terminate();
  worker = null;
  pending.clear();
  workerBroken = false;
}
