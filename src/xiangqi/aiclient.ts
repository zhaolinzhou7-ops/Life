/**
 * 搜索线程的调用封装：能起 Worker 就用 Worker，起不来（老浏览器 / 沙箱限制）
 * 就退回主线程同步计算，保证功能永远可用。
 */
import { analyze, bestMove, judgeMove, type MoveScore, type SearchOpts } from './ai';
import { applyMove, type Board, type Color, type Move } from './rules';
import type { Judged } from './analysis';

let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, (m: Move | null) => void>();
/** 复盘是流式的：每算完一手回一次 onStep，全部算完回 onDone */
const reviews = new Map<number, { onStep: ReviewStep; onDone: () => void }>();
const analyses = new Map<number, (r: MoveScore[]) => void>();
const scores = new Map<number, (r: MoveScore | null) => void>();
let workerBroken = false;

export type ReviewStep = (ply: number, color: Color, board: Board, judged: Judged | null) => void;

interface WorkerMsg {
  id: number;
  kind?: 'review-step' | 'review-done' | 'analysis' | 'study-step' | 'study-done' | 'score';
  score?: MoveScore | null;
  moves?: MoveScore[];
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
      if (d.kind === 'analysis') {
        const cb = analyses.get(d.id);
        analyses.delete(d.id);
        cb?.(d.moves ?? []);
        return;
      }
      if (d.kind === 'score') {
        const cb = scores.get(d.id);
        scores.delete(d.id);
        cb?.(d.score ?? null);
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
      for (const [, cb] of analyses) cb([]);
      analyses.clear();
      for (const [, cb] of scores) cb(null);
      scores.clear();
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

/**
 * 求候选着法：教练解释"还有哪几手更好"要用。
 *
 * 和 requestMove 一样，Worker 起不来就退回主线程同步算。
 * 这条通道**允许慢**——用户是主动点了"为什么"才触发的，等一两秒是可以接受的，
 * 换来的是一个能讲得清楚的答案。
 */
export function requestAnalysis(board: Board, color: Color, opts: SearchOpts): Promise<MoveScore[]> {
  const w = ensureWorker();
  if (!w) return Promise.resolve(analyze(board, color, opts).moves);
  const id = ++seq;
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: MoveScore[]) => {
      if (done) return;
      done = true;
      resolve(r);
    };
    const guard = window.setTimeout(() => {
      if (analyses.has(id)) {
        analyses.delete(id);
        // 超时就别再等了，退回一个空表；上层会只讲静态事实，不会卡在"分析中"
        finish([]);
      }
    }, opts.timeMs + 6000);
    analyses.set(id, (r) => {
      clearTimeout(guard);
      finish(r);
    });
    w.postMessage({ kind: 'analyze', id, board, color, opts });
  });
}

/**
 * 精确算一手。走的是对手的搜索线程——轮到你走的时候它正闲着。
 * 起不来 Worker 就返回 null（不在主线程上算，宁可说得粗一点也不能卡界面）。
 */
export function requestScore(board: Board, color: Color, move: Move, opts: SearchOpts): Promise<MoveScore | null> {
  const w = ensureWorker();
  if (!w) return Promise.resolve(null);
  const id = ++seq;
  return new Promise((resolve) => {
    const guard = window.setTimeout(() => {
      if (scores.delete(id)) resolve(null);
    }, opts.timeMs + 4000);
    scores.set(id, (r) => {
      clearTimeout(guard);
      resolve(r);
    });
    w.postMessage({ kind: 'score', id, board, color, move, opts });
  });
}

/**
 * 研究线程：专门给"轮到你走时算这个局面"用，和对手的搜索线程分开。
 *
 * 为什么要单独一条线程：
 *   原来预分析和对手的搜索挤在同一个 Worker 里，Worker 是单线程的，
 *   预分析没算完，对手的回手就得排队。于是预分析只敢给 900ms——
 *   才四层，看不见三步以外的杀棋。教练拿四层的结果判"出将会丢兵"，
 *   🔍 拿六秒半的结果说"出将是最优"，自己跟自己打架。
 *   分开之后，研究可以放开算；你一落子就把它掐掉（terminate），
 *   对手的搜索一点都不受影响。
 */
let studyWorker: Worker | null = null;
let studyBusy = false;
let studyBroken = false;
let studyId = 0;
let studyCb: { onStep: StudyStep; onDone: StudyStep } | null = null;

export type StudyStep = (moves: MoveScore[], depth: number) => void;

function ensureStudyWorker(): Worker | null {
  if (studyBroken) return null;
  if (studyWorker) return studyWorker;
  try {
    studyWorker = new Worker(new URL('./ai.worker.ts', import.meta.url), { type: 'module' });
    studyWorker.onmessage = (e: MessageEvent<WorkerMsg & { depth?: number }>) => {
      const d = e.data;
      if (d.id !== studyId || !studyCb) return; // 过期研究的迟到消息
      if (d.kind === 'study-step') studyCb.onStep(d.moves ?? [], d.depth ?? 0);
      else if (d.kind === 'study-done') {
        studyBusy = false;
        const cb = studyCb;
        studyCb = null;
        cb.onDone(d.moves ?? [], d.depth ?? 0);
      }
    };
    studyWorker.onerror = () => {
      studyBroken = true;
      studyBusy = false;
      const cb = studyCb;
      studyCb = null;
      studyWorker?.terminate();
      studyWorker = null;
      cb?.onDone([], 0);
    };
    return studyWorker;
  } catch {
    studyBroken = true;
    return null;
  }
}

/**
 * 开始研究一个局面。每算完一层调 onStep，算完调 onDone。返回取消函数。
 *
 * 同一时间只有一份研究：开新的会自动掐掉旧的。
 * 掐的办法只能是 terminate——Worker 在同步搜索里收不到消息。
 * 代价是置换表跟着没了，下一次研究冷启动；但只在"还没算完就换局面"时才发生。
 */
export function startStudy(
  board: Board,
  color: Color,
  opts: SearchOpts,
  onStep: StudyStep,
  onDone: StudyStep,
): () => void {
  stopStudy();
  const w = ensureStudyWorker();
  const id = ++studyId;
  if (!w) {
    // 起不来 Worker：主线程上算一个很浅的版本，宁可浅也不能冻住界面
    const t = window.setTimeout(() => {
      if (id !== studyId) return;
      const a = analyze(board, color, { ...opts, maxDepth: Math.min(opts.maxDepth, 4), timeMs: Math.min(opts.timeMs, 500) });
      if (id !== studyId) return;
      onStep(a.moves, a.depth);
      onDone(a.moves, a.depth);
    }, 0);
    return () => {
      clearTimeout(t);
      if (id === studyId) studyId++;
    };
  }
  studyBusy = true;
  studyCb = { onStep, onDone };
  w.postMessage({ kind: 'study', id, board, color, opts });
  return () => {
    if (id === studyId) stopStudy();
  };
}

/** 停掉在跑的研究。已经算完（线程空闲）就留着线程，置换表还能接着用 */
export function stopStudy() {
  studyId++;
  studyCb = null;
  if (studyBusy) {
    studyWorker?.terminate();
    studyWorker = null;
    studyBusy = false;
  }
}

export function disposeAi() {
  worker?.terminate();
  worker = null;
  pending.clear();
  reviews.clear();
  analyses.clear();
  scores.clear();
  workerBroken = false;
  stopStudy();
  studyWorker?.terminate();
  studyWorker = null;
  studyBroken = false;
}
