/**
 * 专业引擎：Pikafish（皮卡鱼），目前最强的象棋引擎，NNUE 神经网络评估。
 *
 * **为什么是它。** 上一版用的 Fairy-Stockfish 已经比自家引擎强得多，但同样 300 毫秒一步
 * 对下 8 盘，Pikafish 8 : 0 全胜（执红执黑都是把对方将死）。单线程 3 秒能算到 19 层，
 * Fairy-Stockfish 两个线程才 11～12 层。它也不需要 SharedArrayBuffer，老一点的手机也能跑。
 *
 * **分工。** 它只做"判断"：教练判你这一手、🔍 求助、复盘评分、"为什么？"、顶两档对手。
 * 规则（合法着法、将军、将死）仍然只认 rules.ts；它给的每一手都要在我们的合法着法里。
 * 起不来时所有调用方自动退回自家引擎，功能不缺，只是弱一些。
 *
 * **线程。** 这个构建是单线程的：一条 `go` 会把所在的 Worker 一直占到算完，中途叫不停。
 * 所以开了两条"车道"，各一个 Worker：
 *   study   —— 轮到你走时的长时间研究，想停就 terminate 掉重起一个（重起只要几十毫秒：
 *              编译好的 wasm 模块和评估网络由主线程直接递过去，不重新下载、不重新编译）
 *   service —— 短任务：精确算你走的那一手、对手走棋、复盘逐手打分、"为什么？"
 * 两条车道互不排队：研究在算的时候，教练照样能立刻精确算你刚走的那一手。
 *
 * 许可：Pikafish 是 GPL-3.0。原样加载 vendor/pikafish/ 里的文件，来源与校验和见那里的 README。
 */
import type { MoveScore } from './ai';
import type { Board, Color, Move } from './rules';
import { applyMove as applyMoveLocal, legalMoves } from './rules';
import { toFen } from './notation';

/**
 * 分数换算。Pikafish 的分数按胜率归一过，实测一个车约 560，我们的口径车是 1000。
 * 乘上这个系数之后，教练的门槛、梯次、"少一个车"这些说法才对得上。
 */
export const PRO_SCALE = 1.8;
const MATE = 50000;

// ───────────────────────── 纯函数：坐标、分数、info 行 ─────────────────────────

const FILES = 'abcdefghi';

/** (x,y) 着法 → UCI。Pikafish 的行号是 0～9：a0 是红方左下角，第 9 行是黑方底线 */
export function moveToUci(m: Move): string {
  return `${FILES[m.fx]}${9 - m.fy}${FILES[m.tx]}${9 - m.ty}`;
}

export function uciToMove(s: string): Move | null {
  const r = /^([a-i])(\d)([a-i])(\d)$/.exec(s);
  if (!r) return null;
  return { fx: FILES.indexOf(r[1]), fy: 9 - Number(r[2]), tx: FILES.indexOf(r[3]), ty: 9 - Number(r[4]) };
}

/** 引擎的分数 → 我们的口径（杀棋换成 MATE-步数，和自家引擎一致） */
export function toOurScore(cp: number | null, mate: number | null): { score: number; mateIn?: number } {
  if (mate !== null) {
    if (mate > 0) return { score: MATE - (2 * mate - 1), mateIn: mate };
    const n = Math.max(1, -mate);
    return { score: -(MATE - 2 * n), mateIn: -n };
  }
  return { score: Math.round((cp ?? 0) * PRO_SCALE) };
}

export interface PvLine {
  depth: number;
  multipv: number;
  score: number;
  mateIn?: number;
  pv: string[];
  /** 这是搜索中途的上下界，不是这一层的最终结论 */
  bound: boolean;
}

/** 解析一行 info。不带主变的（currmove 之类）返回 null */
export function parseInfo(line: string): PvLine | null {
  if (!line.startsWith('info ') || !line.includes(' pv ')) return null;
  const num = (re: RegExp) => {
    const r = re.exec(line);
    return r ? Number(r[1]) : null;
  };
  const depth = num(/ depth (\d+)/);
  if (depth === null) return null;
  const { score, mateIn } = toOurScore(num(/ score cp (-?\d+)/), num(/ score mate (-?\d+)/));
  return {
    depth,
    multipv: num(/ multipv (\d+)/) ?? 1,
    score,
    mateIn,
    pv: line.split(' pv ')[1].trim().split(/\s+/),
    bound: / (lowerbound|upperbound)/.test(line),
  };
}

/** 引擎的主变 → 我们的着法；遇到转不了的着法就截断 */
function pvToMoves(pv: string[]): Move[] {
  const out: Move[] = [];
  for (const u of pv) {
    const m = uciToMove(u);
    if (!m) break;
    out.push(m);
  }
  return out;
}

/**
 * 把一层的 MultiPV 结果整理成教练用的着法表：前几名是精确分，
 * 其余合法着法挂成"只知道上限"的条目（分数 = 最后一名精确分）。
 * 教练要判的那一手如果落在后面，调用方会再单独精确算它（Study.refine）。
 */
export function linesToMoveScores(lines: PvLine[], board: Board, color: Color): MoveScore[] {
  const legal = legalMoves(board, color);
  const key = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;
  const legalKeys = new Set(legal.map(key));
  const out: MoveScore[] = [];
  const seen = new Set<string>();
  for (const l of [...lines].sort((a, b) => a.multipv - b.multipv)) {
    const pv = pvToMoves(l.pv);
    const m = pv[0];
    if (!m || !legalKeys.has(key(m)) || seen.has(key(m))) continue;
    seen.add(key(m));
    const r: MoveScore = { move: m, score: l.score, pv };
    if (l.mateIn !== undefined) r.mateIn = l.mateIn;
    out.push(r);
  }
  const floor = out.length ? out[out.length - 1].score : 0;
  for (const m of legal) {
    if (seen.has(key(m))) continue;
    out.push({ move: m, score: floor, pv: [m], bound: true });
  }
  return out;
}

// ───────────────────────── 加载 ─────────────────────────

/** 编译好的引擎和评估网络。所有 Worker 共用，重起一个 Worker 不用重新下载和编译 */
let assets: { module: WebAssembly.Module; data: ArrayBuffer } | null = null;
let loading: Promise<boolean> | null = null;
let ready = false;

/** 这个浏览器能不能跑：要有 WebAssembly 和 Worker。这个构建不需要 SIMD，也不需要多线程 */
export function engineCapable(): boolean {
  try {
    return typeof window !== 'undefined' && typeof Worker !== 'undefined' && typeof WebAssembly === 'object';
  } catch {
    return false;
  }
}

/** 引擎已经加载好、可以用 */
export function engineReady(): boolean {
  return ready;
}

const baseUrl = () => `${import.meta.env.BASE_URL}pika/`;

/** 给一个 Promise 加上限时：超时当作失败，别让教练一直等一个起不来的引擎 */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/**
 * 加载引擎：下载约 4.6MB（引擎 0.5MB + 评估网络 4.1MB，浏览器会缓存），编译，起一个 Worker 试跑。
 * 重复调用返回同一个 Promise。失败返回 false，调用方退回自家引擎。
 * 进象棋就开始加载，等你第一次轮到走棋时通常已经好了。
 */
export function loadEngine(): Promise<boolean> {
  if (loading) return loading;
  if (!engineCapable()) return (loading = Promise.resolve(false));
  loading = (async () => {
    try {
      const got = await within(
        Promise.all([
          fetch(baseUrl() + 'pikafish.wasm').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('wasm')))),
          fetch(baseUrl() + 'pikafish.data').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error('data')))),
        ]),
        60000,
      );
      if (!got) return false;
      const module = await WebAssembly.compile(got[0]);
      assets = { module, data: got[1] };
      // 真的起一个试跑一下：能回 uciok 才算好
      const ok = await lanes.service.ensure();
      ready = ok;
      return ok;
    } catch {
      return false;
    }
  })();
  return loading;
}

// ───────────────────────── 车道：一个 Worker + 一个队列 ─────────────────────────

class Lane {
  private worker: Worker | null = null;
  private starting: Promise<boolean> | null = null;
  private listeners = new Set<(line: string) => void>();
  /** 这条车道上排队的任务 */
  queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly hash: number) {}

  /** 确保有一个初始化好的 Worker */
  ensure(): Promise<boolean> {
    if (this.worker && this.starting) return this.starting;
    if (!assets) return Promise.resolve(false);
    const w = new Worker(baseUrl() + 'pika-worker.js');
    this.worker = w;
    this.starting = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 20000);
      w.onmessage = (e: MessageEvent<{ line?: string; ready?: boolean; error?: string }>) => {
        const d = e.data;
        if (d.ready) {
          clearTimeout(timer);
          w.postMessage({ cmd: 'uci' });
          w.postMessage({ cmd: `setoption name Hash value ${this.hash}` });
          resolve(true);
        } else if (d.error) {
          clearTimeout(timer);
          resolve(false);
        } else if (d.line !== undefined) {
          for (const f of [...this.listeners]) f(d.line);
        }
      };
      w.onerror = () => {
        clearTimeout(timer);
        resolve(false);
      };
      w.postMessage({ init: assets });
    });
    return this.starting;
  }

  post(cmd: string) {
    this.worker?.postMessage({ cmd });
  }

  listen(f: (line: string) => void): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** 掐掉当前的 Worker。下一个任务会自动起一个新的 */
  kill() {
    this.worker?.terminate();
    this.worker = null;
    this.starting = null;
    this.listeners.clear();
  }
}

/** 研究车道算得久，给大一点的置换表；服务车道都是短任务 */
const lanes = { study: new Lane(64), service: new Lane(32) };
export type LaneName = keyof typeof lanes;

// ───────────────────────── 搜索 ─────────────────────────

export interface SearchOpts {
  /** 局面：当前 FEN（我们的格式），或者起始 FEN + 之后的着法（引擎就知道重复局面和长将） */
  board: Board;
  color: Color;
  history?: { startFen: string; moves: Move[] };
  multipv?: number;
  movetime?: number;
  depth?: number;
  searchmoves?: Move[];
  /** 在哪条车道上算。默认 service */
  lane?: LaneName;
}

export interface SearchResult {
  /** 最后一层完整的结果，按 multipv 排好 */
  lines: PvLine[];
  depth: number;
  bestmove: Move | null;
  /** 被叫停了（结果是叫停前算完的那一层） */
  stopped?: boolean;
}

export interface SearchJob {
  promise: Promise<SearchResult>;
  /** 叫停。已经算出来的层数照样返回 */
  stop(): void;
}

export function search(opts: SearchOpts, onDepth?: (lines: PvLine[], depth: number) => void): SearchJob {
  const lane = lanes[opts.lane ?? 'service'];
  let stopRequested = false;
  let finish: ((r: SearchResult) => void) | null = null;
  let done: SearchResult = { lines: [], depth: 0, bestmove: null };
  const promise = (lane.queue = lane.queue.then(
    () =>
      new Promise<SearchResult>((resolve) => {
        void (async () => {
          if (!ready || stopRequested || !(await lane.ensure()) || stopRequested) {
            resolve({ ...done, stopped: stopRequested });
            return;
          }
          const K = Math.max(1, opts.multipv ?? 1);
          const want = Math.min(K, opts.searchmoves?.length ?? legalMoves(opts.board, opts.color).length);
          let cur = new Map<number, PvLine>();
          let curDepth = 0;
          let settled = false;
          const off = lane.listen((line) => {
            if (line.startsWith('bestmove')) {
              const u = line.split(/\s+/)[1];
              end({ ...done, bestmove: u && u !== '(none)' ? uciToMove(u) : null });
              return;
            }
            const info = parseInfo(line);
            if (!info || info.bound) return;
            if (info.depth !== curDepth) {
              cur = new Map();
              curDepth = info.depth;
            }
            cur.set(info.multipv, info);
            if (cur.size >= want) {
              const lines = [...cur.values()].sort((a, b) => a.multipv - b.multipv);
              done = { lines, depth: curDepth, bestmove: null };
              onDepth?.(lines, curDepth);
            }
          });
          const end = (r: SearchResult) => {
            if (settled) return;
            settled = true;
            off();
            finish = null;
            resolve(r);
          };
          finish = end;
          lane.post(`setoption name MultiPV value ${K}`);
          const h = opts.history;
          lane.post(
            h && h.moves.length
              ? `position fen ${h.startFen} - - 0 1 moves ${h.moves.map(moveToUci).join(' ')}`
              : `position fen ${toFen(opts.board, opts.color)} - - 0 1`,
          );
          const parts = ['go'];
          if (opts.depth) parts.push(`depth ${opts.depth}`);
          if (opts.movetime) parts.push(`movetime ${opts.movetime}`);
          if (!opts.depth && !opts.movetime) parts.push('movetime 1000');
          if (opts.searchmoves?.length) parts.push(`searchmoves ${opts.searchmoves.map(moveToUci).join(' ')}`);
          lane.post(parts.join(' '));
        })();
      }),
  )) as Promise<SearchResult>;
  return {
    promise,
    stop() {
      if (stopRequested) return;
      stopRequested = true;
      // 正在算的那一条：Worker 停不下来，只能整个掐掉，交出叫停前算完的那一层
      if (finish) {
        const f = finish;
        lane.kill();
        f({ ...done, stopped: true });
      }
    },
  };
}

/** 引擎给出的最佳着法（对手用）。起不来返回 null，调用方用自家引擎 */
export async function engineBestMove(
  board: Board,
  color: Color,
  movetime: number,
  history?: { startFen: string; moves: Move[] },
  avoid: Move[] = [],
): Promise<Move | null> {
  if (!ready) return null;
  const legal = legalMoves(board, color);
  const key = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;
  const banned = new Set(avoid.map(key));
  const allowed = legal.filter((m) => !banned.has(key(m)));
  const r = await search({
    board,
    color,
    history,
    movetime,
    searchmoves: allowed.length && allowed.length < legal.length ? allowed : undefined,
  }).promise;
  const m = r.bestmove;
  // 引擎说的着法必须在我们的合法着法里——规则只认 rules.ts
  return m && legal.some((x) => key(x) === key(m)) ? m : null;
}

const sameMv = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

/** 精确算一手（服务车道）。算不出来返回 null */
export async function engineScoreMove(
  board: Board,
  color: Color,
  m: Move,
  opts: { depth?: number; movetime: number; history?: { startFen: string; moves: Move[] } },
): Promise<MoveScore | null> {
  if (!ready) return null;
  const r = await search({ board, color, history: opts.history, searchmoves: [m], depth: opts.depth, movetime: opts.movetime }).promise;
  return linesToMoveScores(r.lines, board, color).find((x) => !x.bound && sameMv(x.move, m)) ?? null;
}

/**
 * 分析一个局面：前 multipv 名精确，另外把 include 这一手也精确算出来（讲解"你这一手"要用）。
 * 起不来返回 null，调用方用自家引擎。
 */
export async function engineAnalyse(
  board: Board,
  color: Color,
  opts: { movetime: number; multipv?: number; include?: Move; history?: { startFen: string; moves: Move[] } },
): Promise<MoveScore[] | null> {
  if (!ready) return null;
  const r = await search({ board, color, history: opts.history, multipv: opts.multipv ?? 6, movetime: opts.movetime }).promise;
  if (!r.lines.length) return null;
  let moves = linesToMoveScores(r.lines, board, color);
  const inc = opts.include;
  if (inc && moves.find((x) => sameMv(x.move, inc))?.bound) {
    const ex = await engineScoreMove(board, color, inc, { movetime: 2000, history: opts.history });
    if (ex) moves = moves.map((y) => (y.bound && sameMv(y.move, inc) ? ex : y));
  }
  return moves;
}

export interface EngineJudged {
  best: MoveScore;
  played: MoveScore;
  depth: number;
  engine: 'pro';
  /** 次好一手的分数，判"唯一着"用 */
  second?: number;
}

/** 复盘每一手的预算：标准和深度两档 */
export const REVIEW_BUDGET = {
  standard: { best: 600, played: 500 },
  deep: { best: 2500, played: 1500 },
};

/**
 * 用专业引擎复盘整盘棋：每一手算"最好的一手"和"你走的这一手"各值多少。
 * 边算边回调，返回取消函数。和 aiclient.requestReview 同一个形状，复盘界面换着用。
 */
export function engineReview(
  start: Board,
  startColor: Color,
  moves: Move[],
  onStep: (ply: number, color: Color, board: Board, judged: EngineJudged | null) => void,
  onDone: () => void,
  per = REVIEW_BUDGET.standard,
  /** 这一手已经有更好的判读（对局里教练算过，更深），不用再算——直接回调 judged=null */
  skip: (ply: number) => boolean = () => false,
): () => void {
  let cancelled = false;
  let job: SearchJob | null = null;
  const startFen = toFen(start, startColor);
  void (async () => {
    let cur = start;
    let c = startColor;
    for (let i = 0; i < moves.length; i++) {
      if (cancelled) return;
      if (skip(i)) {
        onStep(i, c, cur, null);
        cur = applyMoveLocal(cur, moves[i]);
        c = c === 'r' ? 'b' : 'r';
        continue;
      }
      const history = { startFen, moves: moves.slice(0, i) };
      // 前两名：次好一手的分数用来判"唯一着"
      job = search({ board: cur, color: c, history, movetime: per.best, multipv: 2 });
      const r = await job.promise;
      if (cancelled) return;
      const table = linesToMoveScores(r.lines, cur, c).filter((x) => !x.bound);
      const best = table[0];
      let judged: EngineJudged | null = null;
      if (best) {
        let played: MoveScore | undefined = sameMv(best.move, moves[i]) ? best : undefined;
        if (!played) {
          // 按时间算满，不设层数上限：封顶的话冷启动的搜索常常还没看到杀棋就停了
          job = search({ board: cur, color: c, history, searchmoves: [moves[i]], movetime: per.played });
          const p = await job.promise;
          if (cancelled) return;
          played = linesToMoveScores(p.lines, cur, c).find((x) => !x.bound && sameMv(x.move, moves[i]));
        }
        if (played) judged = { best, played, depth: r.depth, engine: 'pro', second: table[1]?.score };
      }
      onStep(i, c, cur, judged);
      cur = applyMoveLocal(cur, moves[i]);
      c = c === 'r' ? 'b' : 'r';
    }
    if (!cancelled) onDone();
  })();
  return () => {
    cancelled = true;
    job?.stop();
  };
}
