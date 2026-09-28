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
 * **线程。** 这个构建是单线程的：一条 `go` 会把所在的 Worker 一直占到算完，发 stop 它收不到。
 * 所以开了两条"车道"，各一个 Worker：
 *   study   —— 轮到你走时的长时间研究，你一落子就要停
 *   service —— 短任务：精确算你走的那一手、对手走棋、复盘逐手打分、"为什么？"
 * 两条车道互不排队：研究在算的时候，教练照样能立刻精确算你刚走的那一手。
 *
 * **怎么叫停。** 拨引擎的表（pika-worker.js）：它以为时间到了，交出算完的那一层，Worker 接着用。
 * 以前是 terminate 掉 Worker 再起一个，可每个引擎实例要 256MB，手机回收得慢，
 * 下到二三十手就起不来了——教练"刚开始还能算，后面就不算了"。现在 Worker 只在卡死、崩了时才换。
 * 浏览器不支持拨表（没有跨源隔离）时，研究分段算，每段几秒，段与段之间停（study.ts）。
 *
 * **倒下了怎么办。** 起不来、崩了、卡死超时：这一次的结果标成 failed，调用方当场退回自家引擎；
 * 连着起不来，就认定这台设备跑不动它（engineLost），之后都用自家引擎，界面会说一声。
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
/** 引擎中途起不来了（多半是手机内存不够）。之后所有调用方退回自家引擎 */
let lost = false;
const lostSubs = new Set<() => void>();

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
  return ready && !lost;
}

/** 引擎中途倒下了（加载好之后又起不来）。界面据此告诉用户"换回自带引擎了"，只说一次 */
export function engineLost(): boolean {
  return lost;
}

/** 引擎倒下时通知一次。返回退订函数 */
export function onEngineLost(cb: () => void): () => void {
  lostSubs.add(cb);
  return () => lostSubs.delete(cb);
}

function markLost() {
  if (lost) return;
  lost = true;
  for (const cb of [...lostSubs]) cb();
}

/**
 * 能不能"拨表"叫停（见 pika-worker.js）：要有 SharedArrayBuffer，页面要跨源隔离。
 * 不能的话研究改成分段算，每段几秒，段与段之间才能停。
 */
export function cooperativeStop(): boolean {
  try {
    if (localStorage.getItem('xq-engine-noflag')) return false; // 测试用：模拟没有跨源隔离的浏览器
  } catch {
    /* 读不了就按实际情况 */
  }
  return typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined' && self.crossOriginIsolated === true;
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

/** 页面上一次回到前台的时刻。手机切后台时整个页面（连同 Worker）会被冻住，回来那一刻不能按超时处理 */
let visibleAt = 0;
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) visibleAt = Date.now();
  });
}
const justWoke = () => (typeof document !== 'undefined' && document.hidden) || Date.now() - visibleAt < 5000;

/** 一条车道连着这么多次起不来，就认定引擎在这台设备上跑不动了 */
const MAX_FAILURES = 2;
/** 一条车道上的引擎崩了这么多次，同样认定跑不动 */
const MAX_CRASHES = 3;

/** 统计（测试和排查用）：每条车道起过几个 Worker、被迫掐掉过几次 */
const stats = { spawned: { study: 0, service: 0 }, killed: { study: 0, service: 0 }, failed: { study: 0, service: 0 } };
export function engineStats() {
  return {
    spawned: { ...stats.spawned },
    killed: { ...stats.killed },
    failed: { ...stats.failed },
    cooperative: cooperativeStop(),
    lost,
  };
}

/** 引擎输出的一行；null 表示这个 Worker 死了 */
type LineFn = (line: string | null) => void;

class Lane {
  private worker: Worker | null = null;
  private starting: Promise<boolean> | null = null;
  private listeners = new Set<LineFn>();
  /** 叫停标志（和 Worker 共享的一个整数）。没有跨源隔离时为 null */
  private flag: Int32Array | null = null;
  /** 连着起不来的次数 */
  private failures = 0;
  /** 起来之后又崩掉的次数（不清零）：每算一次就崩一次的话，不能无休止地重起 */
  private crashes = 0;
  /** 这条车道上排队的任务：前一个任务的引擎真正空下来，下一个才开始 */
  queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly name: LaneName,
    private readonly hash: number,
  ) {}

  /** 能拨表叫停 */
  get canHalt(): boolean {
    return !!this.flag;
  }

  /** 确保有一个初始化好的 Worker */
  ensure(): Promise<boolean> {
    if (this.worker && this.starting) return this.starting;
    if (!assets || lost) return Promise.resolve(false);
    let w: Worker;
    try {
      w = new Worker(baseUrl() + 'pika-worker.js');
    } catch {
      this.failed();
      return Promise.resolve(false);
    }
    stats.spawned[this.name]++;
    this.worker = w;
    const sab = cooperativeStop() ? new SharedArrayBuffer(4) : null;
    this.flag = sab ? new Int32Array(sab) : null;
    const starting = (this.starting = new Promise<boolean>((resolve) => {
      let up = false;
      const bad = () => {
        clearTimeout(timer);
        if (this.worker === w) this.kill(false);
        if (!up) {
          this.failed();
          resolve(false);
        } else if (++this.crashes >= MAX_CRASHES) markLost();
      };
      // 起不来（内存不够时实例化会失败）：别让等它的研究干等
      const timer = setTimeout(bad, 20000);
      w.onmessage = (e: MessageEvent<{ line?: string; ready?: boolean; error?: string; crashed?: string }>) => {
        const d = e.data;
        if (d.ready) {
          clearTimeout(timer);
          up = true;
          this.failures = 0;
          w.postMessage({ cmd: 'uci' });
          w.postMessage({ cmd: `setoption name Hash value ${this.hash}` });
          resolve(true);
        } else if (d.error || d.crashed) {
          bad();
        } else if (d.line !== undefined) {
          for (const f of [...this.listeners]) f(d.line);
        }
      };
      w.onerror = (e) => {
        e.preventDefault();
        bad();
      };
      w.postMessage({ init: { ...assets!, flag: sab } });
    }));
    return starting;
  }

  private failed() {
    stats.failed[this.name]++;
    if (++this.failures >= MAX_FAILURES) markLost();
  }

  post(cmd: string) {
    this.worker?.postMessage({ cmd });
  }

  listen(f: LineFn): () => void {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  }

  /** 拨表：正在算的那一条马上收手，交出已经算完的那一层 */
  halt() {
    if (this.flag) Atomics.store(this.flag, 0, 1);
  }

  /** 表拨回来（每条 go 之前） */
  resume() {
    if (this.flag) Atomics.store(this.flag, 0, 0);
  }

  /**
   * 掐掉当前的 Worker。只在它卡死、崩了的时候用：
   * 每个引擎实例 256MB，手机上掐一个起一个，内存很快就被还没回收的旧实例占满
   */
  kill(counted = true) {
    if (!this.worker) return;
    if (counted) stats.killed[this.name]++;
    this.worker.terminate();
    this.worker = null;
    this.starting = null;
    this.flag = null;
    const ls = [...this.listeners];
    this.listeners.clear();
    for (const f of ls) f(null);
  }
}

/** 研究车道算得久，给大一点的置换表；服务车道都是短任务 */
const lanes = { study: new Lane('study', 64), service: new Lane('service', 32) };
export type LaneName = 'study' | 'service';

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
  /** 引擎出了问题（起不来、崩了、卡死被掐掉），结果不完整 */
  failed?: boolean;
}

export interface SearchJob {
  promise: Promise<SearchResult>;
  /** 叫停。已经算出来的层数照样返回 */
  stop(): void;
}

/** 叫停之后这么久还没交出 bestmove，就当它卡死了 */
const HALT_GRACE = 3000;
/** 一条 go 超出 movetime 这么久还没回来，就当它卡死了 */
const WATCHDOG_MARGIN = 10000;

export function search(opts: SearchOpts, onDepth?: (lines: PvLine[], depth: number) => void): SearchJob {
  const lane = lanes[opts.lane ?? 'service'];
  let stopRequested = false;
  /** 正在算时：交出结果（job 的 promise 马上兑现）并让引擎收手 */
  let interrupt: (() => void) | null = null;
  let done: SearchResult = { lines: [], depth: 0, bestmove: null };
  let answer!: (r: SearchResult) => void;
  let answered = false;
  const promise = new Promise<SearchResult>((resolve) => {
    answer = (r) => {
      if (answered) return;
      answered = true;
      resolve(r);
    };
  });
  const movetime = opts.movetime ?? (opts.depth ? 0 : 1000);

  /** 在车道上跑这一条。返回时引擎已经空下来（交出了 bestmove，或者被掐掉） */
  const run = async (): Promise<void> => {
    if (!engineReady() || stopRequested) return answer({ ...done, stopped: stopRequested || undefined });
    if (!(await lane.ensure()) || stopRequested) {
      return answer({ ...done, stopped: stopRequested || undefined, failed: !stopRequested || undefined });
    }
    await new Promise<void>((idle) => {
      const K = Math.max(1, opts.multipv ?? 1);
      const want = Math.min(K, opts.searchmoves?.length ?? legalMoves(opts.board, opts.color).length);
      let cur = new Map<number, PvLine>();
      let curDepth = 0;
      let finished = false;
      let dog = 0;
      let haltDog = 0;
      const settle = () => {
        if (finished) return;
        finished = true;
        off();
        clearTimeout(dog);
        clearTimeout(haltDog);
        interrupt = null;
        idle();
      };
      /** 卡死了：掐掉换一个（listen 会收到 null，由那里收尾） */
      const hung = () => {
        if (finished) return;
        if (justWoke()) {
          // 页面刚从后台回来（手机上后台会冻住 Worker），多给它一点时间
          dog = window.setTimeout(hung, 5000);
          return;
        }
        lane.kill();
      };
      /**
       * 只算一手的时候（精确算你走的那一手），"上限"行也有用：它说"这一手最多值这么多"。
       * 引擎刚发现这一手会被将死、还没来得及把精确分数算完就到时间了，最后一条精确行
       * 还是发现杀棋之前的老分数——拿老分数去判，教练就会放过一手走进杀局的棋（实测十次里有一次）。
       * 所以更深一层的上限如果明显更差（被杀，或者差出三个兵以上），就按它算。
       */
      const single = opts.searchmoves?.length === 1;
      let worse: PvLine | null = null;
      const pessimist = (r: SearchResult): SearchResult => {
        const exact = r.lines[0];
        if (!single || !worse || !exact || worse.depth <= r.depth) return r;
        const mated = worse.mateIn !== undefined && worse.mateIn < 0;
        if (!mated && exact.score - worse.score < 300) return r;
        return { ...r, lines: [{ ...worse, bound: false }], depth: worse.depth };
      };
      const off = lane.listen((line) => {
        if (line === null) {
          // Worker 死了（崩了、被掐掉）
          answer({ ...done, stopped: stopRequested || undefined, failed: true });
          settle();
          return;
        }
        if (line.startsWith('bestmove')) {
          const u = line.split(/\s+/)[1];
          answer(pessimist({ ...done, bestmove: u && u !== '(none)' ? uciToMove(u) : null, stopped: stopRequested || undefined }));
          settle();
          return;
        }
        const info = parseInfo(line);
        if (!info) return;
        if (info.bound) {
          // 上限行：/ upperbound / 才是"最多值这么多"
          if (single && / upperbound/.test(line) && (!worse || info.depth >= worse.depth)) worse = info;
          return;
        }
        if (worse && info.depth >= worse.depth) worse = null;
        if (info.depth !== curDepth) {
          cur = new Map();
          curDepth = info.depth;
        }
        cur.set(info.multipv, info);
        if (cur.size >= want) {
          const lines = [...cur.values()].sort((a, b) => a.multipv - b.multipv);
          done = { lines, depth: curDepth, bestmove: null };
          if (!stopRequested) onDepth?.(lines, curDepth);
        }
      });
      interrupt = () => {
        answer({ ...done, stopped: true });
        if (lane.canHalt) {
          lane.halt();
          haltDog = window.setTimeout(hung, HALT_GRACE);
        }
        // 拨不了表：让它算到 movetime 自己停（研究是分段算的，一段只有几秒），看门狗照常
      };
      if (movetime) dog = window.setTimeout(hung, movetime + WATCHDOG_MARGIN);
      lane.resume();
      lane.post(`setoption name MultiPV value ${K}`);
      const h = opts.history;
      lane.post(
        h && h.moves.length
          ? `position fen ${h.startFen} - - 0 1 moves ${h.moves.map(moveToUci).join(' ')}`
          : `position fen ${toFen(opts.board, opts.color)} - - 0 1`,
      );
      const parts = ['go'];
      if (opts.depth) parts.push(`depth ${opts.depth}`);
      if (movetime) parts.push(`movetime ${movetime}`);
      if (opts.searchmoves?.length) parts.push(`searchmoves ${opts.searchmoves.map(moveToUci).join(' ')}`);
      lane.post(parts.join(' '));
    });
  };
  // 开发期：最近 30 次搜索的记录（哪条车道、什么局面、算了多久多深、结果），排查"教练怎么没拦"用
  if (import.meta.env.DEV) {
    const w = window as unknown as { __pikaLog?: unknown[] };
    const rec: Record<string, unknown> = { lane: opts.lane ?? 'service', color: opts.color, fen: toFen(opts.board, opts.color), h: opts.history?.moves.length ?? 0, mt: movetime, sm: opts.searchmoves?.map(moveToUci).join(' '), t0: Date.now() };
    (w.__pikaLog ??= []).push(rec);
    if (w.__pikaLog.length > 30) w.__pikaLog.shift();
    void promise.then((r) => Object.assign(rec, { ms: Date.now() - (rec.t0 as number), depth: r.depth, score: r.lines[0]?.mateIn !== undefined ? `M${r.lines[0].mateIn}` : r.lines[0]?.score, stopped: r.stopped, failed: r.failed }));
  }
  // 出了意外也要交差：不然等它的人（研究、教练）会一直等下去
  const safe = () =>
    run().catch(() => {
      answer({ ...done, failed: true });
    });
  lane.queue = lane.queue.then(safe, safe);
  return {
    promise,
    stop() {
      if (stopRequested) return;
      stopRequested = true;
      // 还在排队的：轮到它时直接跳过；正在算的：交出叫停前算完的那一层，引擎收手
      interrupt?.();
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
  if (!engineReady()) return null;
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
  opts: { depth?: number; movetime: number; history?: { startFen: string; moves: Move[] }; lane?: LaneName },
): Promise<MoveScore | null> {
  if (!engineReady()) return null;
  const r = await search({
    board,
    color,
    history: opts.history,
    searchmoves: [m],
    depth: opts.depth,
    movetime: opts.movetime,
    lane: opts.lane,
  }).promise;
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
  if (!engineReady()) return null;
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
  /** 引擎中途倒下了：从第 ply 手起交给调用方（换自家引擎接着算）。不给就只回调 judged=null */
  onLost?: (ply: number, board: Board, color: Color) => void,
): () => void {
  let cancelled = false;
  let job: SearchJob | null = null;
  const startFen = toFen(start, startColor);
  void (async () => {
    let cur = start;
    let c = startColor;
    for (let i = 0; i < moves.length; i++) {
      if (cancelled) return;
      if (onLost && !engineReady() && !skip(i)) {
        onLost(i, cur, c);
        return;
      }
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
