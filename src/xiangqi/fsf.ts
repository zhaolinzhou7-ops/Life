/**
 * 专业引擎：Fairy-Stockfish（WASM，多线程）。
 *
 * **为什么换引擎。** 自己写的搜索在手机上 8 秒只能算 6～9 层，用 Fairy-Stockfish 当裁判
 * 实测：80 个真实局面里只有 56 个选到了同样的着法，还有两手是会被将死、会丢车的——
 * 用户看到的"最优解让车吃士将军、被老将吃掉"就是这一类。这不是调参数能补上的差距。
 * Fairy-Stockfish 是 Stockfish 的变体版，象棋是它原生支持的棋种，同样 3 秒能到 11～12 层，
 * 剪枝和评估都是职业级的。
 *
 * **分工。** 它只做"判断"：教练判你这一手、🔍 求助、复盘、顶两档对手。
 * 规则（合法着法、将军、将死）仍然只认 rules.ts；它说的每一手都要在我们的合法着法里。
 * 起不来（老浏览器、没有跨源隔离）时，所有调用方自动退回自己的引擎，功能不缺，只是弱一些。
 *
 * 许可：Fairy-Stockfish 是 GPL-3.0，这里原样加载官方 npm 包里的文件，不做修改，
 * 许可证文本随文件一起发布（dist/fsf/Copying.txt），源码见 github.com/fairy-stockfish。
 */
import type { MoveScore } from './ai';
import type { Board, Color, Move } from './rules';
import { applyMove as applyMoveLocal, legalMoves } from './rules';
import { toFen } from './notation';

interface SfModule {
  postMessage(cmd: string): void;
  addMessageListener(cb: (line: string) => void): void;
  removeMessageListener(cb: (line: string) => void): void;
}

declare global {
  interface Window {
    Stockfish?: (m?: Record<string, unknown>) => Promise<SfModule>;
  }
}

/**
 * 分数换算。Fairy-Stockfish 的"兵"是国际象棋口径，实测一个车约 870，我们的口径车是 1000。
 * 乘上这个系数之后，教练的门槛、梯次、"少一个车"这些说法才对得上。
 */
export const FSF_SCALE = 1.15;
const MATE = 50000;

// ───────────────────────── 纯函数：坐标、分数、info 行 ─────────────────────────

const FILES = 'abcdefghi';

/** (x,y) 着法 → UCI（a1 在红方左下角，第 10 行是黑方底线） */
export function moveToUci(m: Move): string {
  return `${FILES[m.fx]}${10 - m.fy}${FILES[m.tx]}${10 - m.ty}`;
}

export function uciToMove(s: string): Move | null {
  const r = /^([a-i])(\d{1,2})([a-i])(\d{1,2})$/.exec(s);
  if (!r) return null;
  const fy = 10 - Number(r[2]);
  const ty = 10 - Number(r[4]);
  if (fy < 0 || fy > 9 || ty < 0 || ty > 9) return null;
  return { fx: FILES.indexOf(r[1]), fy, tx: FILES.indexOf(r[3]), ty };
}

/** 引擎的分数 → 我们的口径（杀棋换成 MATE-步数，和自家引擎一致） */
export function toOurScore(cp: number | null, mate: number | null): { score: number; mateIn?: number } {
  if (mate !== null) {
    if (mate > 0) return { score: MATE - (2 * mate - 1), mateIn: mate };
    const n = Math.max(1, -mate);
    return { score: -(MATE - 2 * n), mateIn: -n };
  }
  return { score: Math.round((cp ?? 0) * FSF_SCALE) };
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
 * 其余合法着法挂成"只知道上限"的条目（分数 = 第 K 名的分数）。
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

// ───────────────────────── 引擎实例 ─────────────────────────

let sf: SfModule | null = null;
let loading: Promise<boolean> | null = null;
let ready = false;

/**
 * 一个只用到 SIMD 指令的最小 WASM 模块。引擎是按 WASM SIMD 编译的，
 * 不支持 SIMD 的浏览器（iOS 16.4 之前的 Safari 等）加载会失败，先验一下，省得白下 1.7MB。
 */
const SIMD_PROBE = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11,
]);

/** 这个浏览器能不能跑多线程 + SIMD 的 WASM */
export function engineCapable(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.crossOriginIsolated === true &&
      typeof SharedArrayBuffer !== 'undefined' &&
      typeof WebAssembly === 'object' &&
      WebAssembly.validate(SIMD_PROBE)
    );
  } catch {
    return false;
  }
}

/** 给一个 Promise 加上限时：超时当作失败，别让教练一直等一个起不来的引擎 */
function within<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);
}

/** 引擎已经加载好、可以用 */
export function engineReady(): boolean {
  return ready;
}

function injectScript(src: string): Promise<void> {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => res();
    s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}

/** 等某一行出现（或超时） */
function waitLine(pred: (l: string) => boolean, ms: number): Promise<boolean> {
  return new Promise((res) => {
    const t = setTimeout(() => {
      sf?.removeMessageListener(f);
      res(false);
    }, ms);
    const f = (l: string) => {
      if (!pred(l)) return;
      clearTimeout(t);
      sf?.removeMessageListener(f);
      res(true);
    };
    sf?.addMessageListener(f);
  });
}

/**
 * 加载引擎。重复调用返回同一个 Promise。失败返回 false，调用方退回自家引擎。
 * 下载约 1.7MB（浏览器会缓存），手机上编译加初始化一两秒——进象棋就开始加载，
 * 等你第一次轮到走棋时通常已经好了。
 */
export function loadEngine(): Promise<boolean> {
  if (loading) return loading;
  if (!engineCapable()) return (loading = Promise.resolve(false));
  loading = (async () => {
    try {
      const base = `${import.meta.env.BASE_URL}fsf/`;
      if (!window.Stockfish) await injectScript(`${base}stockfish.js`);
      if (!window.Stockfish) return false;
      const mod = await within(window.Stockfish({ locateFile: (f: string) => base + f }), 20000);
      if (!mod) return false;
      sf = mod;
      sf.postMessage('uci');
      if (!(await waitLine((l) => l === 'uciok', 15000))) return false;
      const cores = navigator.hardwareConcurrency || 2;
      // 留一个核给界面和对手的搜索线程；手机上四线程以后收益很小，发热却很明显
      const threads = Math.max(1, Math.min(4, cores - 1));
      sf.postMessage('setoption name UCI_Variant value xiangqi');
      sf.postMessage(`setoption name Threads value ${threads}`);
      sf.postMessage('setoption name Hash value 32');
      sf.postMessage('isready');
      if (!(await waitLine((l) => l === 'readyok', 15000))) return false;
      ready = true;
      return true;
    } catch {
      return false;
    }
  })();
  return loading;
}

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
}

export interface SearchResult {
  /** 最后一层完整的结果，按 multipv 排好 */
  lines: PvLine[];
  depth: number;
  bestmove: Move | null;
}

export interface SearchJob {
  promise: Promise<SearchResult>;
  /** 叫停。已经算出来的层数照样返回 */
  stop(): void;
}

/** 同一时间只让引擎跑一件事：排队 */
let queue: Promise<unknown> = Promise.resolve();

export function search(opts: SearchOpts, onDepth?: (lines: PvLine[], depth: number) => void): SearchJob {
  let stopRequested = false;
  let running = false;
  const promise = (queue = queue.then(
    () =>
      new Promise<SearchResult>((resolve) => {
        const empty: SearchResult = { lines: [], depth: 0, bestmove: null };
        if (!sf || !ready || stopRequested) {
          resolve(empty);
          return;
        }
        running = true;
        const K = Math.max(1, opts.multipv ?? 1);
        const want = Math.min(K, opts.searchmoves?.length ?? legalMoves(opts.board, opts.color).length);
        let cur = new Map<number, PvLine>();
        let curDepth = 0;
        let done: SearchResult = empty;
        const listener = (line: string) => {
          if (line.startsWith('bestmove')) {
            sf!.removeMessageListener(listener);
            running = false;
            const u = line.split(/\s+/)[1];
            resolve({ ...done, bestmove: u && u !== '(none)' ? uciToMove(u) : null });
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
        };
        sf.addMessageListener(listener);
        sf.postMessage(`setoption name MultiPV value ${K}`);
        const h = opts.history;
        sf.postMessage(
          h && h.moves.length
            ? `position fen ${h.startFen} - - 0 1 moves ${h.moves.map(moveToUci).join(' ')}`
            : `position fen ${toFen(opts.board, opts.color)} - - 0 1`,
        );
        const parts = ['go'];
        if (opts.depth) parts.push(`depth ${opts.depth}`);
        if (opts.movetime) parts.push(`movetime ${opts.movetime}`);
        if (!opts.depth && !opts.movetime) parts.push('movetime 1000');
        if (opts.searchmoves?.length) parts.push(`searchmoves ${opts.searchmoves.map(moveToUci).join(' ')}`);
        sf.postMessage(parts.join(' '));
        // 在排队期间就被叫停的，开始之后立刻停
        if (stopRequested) sf.postMessage('stop');
      }),
  )) as Promise<SearchResult>;
  return {
    promise,
    stop() {
      stopRequested = true;
      if (running) sf?.postMessage('stop');
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
    const x = await search({
      board,
      color,
      history: opts.history,
      searchmoves: [inc],
      depth: Math.max(8, r.depth - 2),
      movetime: 1500,
    }).promise;
    const ex = linesToMoveScores(x.lines, board, color).find((y) => !y.bound && sameMv(y.move, inc));
    if (ex) moves = moves.map((y) => (y.bound && sameMv(y.move, inc) ? ex : y));
  }
  return moves;
}

export interface EngineJudged {
  best: MoveScore;
  played: MoveScore;
  depth: number;
}

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
  per = { best: 350, played: 250 },
): () => void {
  let cancelled = false;
  let job: SearchJob | null = null;
  const startFen = toFen(start, startColor);
  void (async () => {
    let cur = start;
    let c = startColor;
    for (let i = 0; i < moves.length; i++) {
      if (cancelled) return;
      const history = { startFen, moves: moves.slice(0, i) };
      job = search({ board: cur, color: c, history, movetime: per.best });
      const r = await job.promise;
      if (cancelled) return;
      const best = linesToMoveScores(r.lines, cur, c).find((x) => !x.bound);
      let judged: EngineJudged | null = null;
      if (best) {
        let played: MoveScore | undefined = sameMv(best.move, moves[i]) ? best : undefined;
        if (!played) {
          job = search({ board: cur, color: c, history, searchmoves: [moves[i]], depth: Math.max(6, r.depth - 1), movetime: per.played });
          const p = await job.promise;
          if (cancelled) return;
          played = linesToMoveScores(p.lines, cur, c).find((x) => !x.bound && sameMv(x.move, moves[i]));
        }
        if (played) judged = { best, played, depth: r.depth };
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
