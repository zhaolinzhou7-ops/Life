/**
 * 一个局面的"研究"：轮到你走时，引擎在后台把这个局面一层一层往深算。
 *
 * **对局里所有关于"这一步该怎么走"的判断，都只读这一份。**
 * 教练判你这一手、🔍 求助、对手掂量议和，读的是同一个裁判的同一份结论，
 * 结论随时间越算越深；教练判得早、之后算深了结论变了，会当场改口。
 *
 * 裁判优先用专业引擎（pikafish.ts，皮卡鱼）。它没加载好或者这个浏览器跑不了时，
 * 退回自家引擎。专业引擎算到一半倒下了（手机内存不够、Worker 崩了），当场换自家引擎接着算——
 * 宁可浅一点，也不能让教练手里什么都没有、悄悄退回"只看子力"的老判断。
 *
 * **算多久由"算力"决定。** 全力档：你想多久它就算多久（上限 3 分钟），层数随时间一直涨；
 * 你一落子立刻停。切到后台（锁屏、切应用）时暂停，回来接着算，不在口袋里偷偷耗电。
 */
import type { Board, Color, Move } from './rules';
import type { MoveScore, SearchOpts } from './ai';
import { requestScore, startStudy } from './aiclient';
import { toFen } from './notation';
import { cooperativeStop, engineReady, engineScoreMove, linesToMoveScores, search, type SearchJob } from './pikafish';

/**
 * 自家引擎的研究预算。
 * margin 300：比首选差出三个兵以上的着法只证明"至少差这么多"，省下时间换深度。
 */
export const STUDY_BUDGET: SearchOpts = { maxDepth: 64, timeMs: 8000, jitter: 0, margin: 300 };

// ───────────────────────── 算力 ─────────────────────────

export type Power = 'save' | 'standard' | 'max';

export const POWERS: { id: Power; name: string; desc: string; ms: number }[] = [
  { id: 'save', name: '省电', desc: '每步算 5 秒', ms: 5000 },
  { id: 'standard', name: '标准', desc: '每步算 15 秒', ms: 15000 },
  // 上限只是保险：人走开了、页面还开着，不能无限算下去
  { id: 'max', name: '全力', desc: '你想多久它算多久，层数一直往上涨', ms: 180000 },
];

const POWER_KEY = 'xq-power';

/** 默认全力：用户要的就是"算到最深" */
export function getPower(): Power {
  try {
    const v = localStorage.getItem(POWER_KEY);
    return v === 'save' || v === 'standard' || v === 'max' ? v : 'max';
  } catch {
    return 'max';
  }
}

export function setPower(p: Power) {
  try {
    localStorage.setItem(POWER_KEY, p);
  } catch {
    /* 存不下就只在本次生效 */
  }
}

/**
 * 专业引擎研究：前 5 名精确，算到 60 层或时间用完。
 * 只排前 3 名能多算一层，但"走法梯次"就只剩最优、次选，看不到"中""差"的那几手——
 * 用户要的正是整个梯次，所以宁可少一层。
 */
const PRO_MULTIPV = 5;
const PRO_MAX_DEPTH = 60;

/**
 * 教练放行一手棋之前，至少要看到这么深。
 * 自家引擎 4 层能看清一步杀、两步杀和绝大多数白送子；专业引擎 10 层通常不到半秒。
 */
export const MIN_JUDGE_DEPTH = 4;
const PRO_MIN_DEPTH = 10;

/**
 * 算到这么深就当作"有定论"了：可以下"局面已经守不住"这种重话。
 * 全力档可能要算几分钟才"算完"，不能等到那时候才说。
 */
const PRO_SETTLE_DEPTH = 16;
const LOCAL_SETTLE_DEPTH = 7;

/**
 * 浏览器不支持随时叫停引擎时（没有跨源隔离），研究分段算：每段这么长，段与段之间才能停。
 * 每一段都从第 1 层重新迭代，但置换表还在，前面算过的层很快就追回来。
 * 一段太长，你落子之后引擎还要空转一会儿才能开始算下一个局面。
 */
const CHUNK_MS = 2500;

const sameMove = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const key = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;

export class Study {
  readonly fen: string;
  /** 用的是哪个裁判。专业引擎中途倒下会换成自家引擎 */
  engine: 'pro' | 'local';
  /** 教练放行至少要看到的层数（两个引擎的"层"不是一回事） */
  minDepth: number;
  moves: MoveScore[] = [];
  depth = 0;
  done = false;
  /** 被掐掉了（局面变了）。等它的人不用再等 */
  stopped = false;
  /** 暂停中（页面切到后台） */
  paused = false;
  private subs = new Set<(s: Study) => void>();
  private cancel: () => void = () => {};
  /** 单独精确算过的着法：后面每一层刷新时，这些不能又退回成"只知道上限" */
  private exact = new Map<string, MoveScore>();
  private job: SearchJob | null = null;
  private deadline = 0;
  private remaining = 0;
  /** 让出引擎给"精确算一手"：研究先停，算完接着来。可以叠（两个地方同时要精确算） */
  private holds = 0;
  private held = 0;

  constructor(
    readonly board: Board,
    readonly color: Color,
    private readonly history?: { startFen: string; moves: Move[] },
    power: Power = getPower(),
  ) {
    this.fen = toFen(board, color);
    this.engine = engineReady() ? 'pro' : 'local';
    this.minDepth = this.engine === 'pro' ? PRO_MIN_DEPTH : MIN_JUDGE_DEPTH;
    if (this.engine === 'pro') {
      const ms = POWERS.find((p) => p.id === power)?.ms ?? 15000;
      this.deadline = Date.now() + ms;
      this.runPro(ms);
    } else this.runLocal();
  }

  private runLocal() {
    this.cancel = startStudy(
      this.board,
      this.color,
      STUDY_BUDGET,
      (moves, depth) => this.accept(moves, depth, false),
      (moves, depth) => this.accept(moves, depth, true),
    );
  }

  /** 专业引擎倒下了：这个局面换自家引擎从头算。两个引擎的层数不是一回事，已有的结果清掉 */
  private fallBack() {
    this.job = null;
    this.engine = 'local';
    this.minDepth = MIN_JUDGE_DEPTH;
    this.moves = [];
    this.depth = 0;
    this.exact.clear();
    this.emit();
    this.runLocal();
  }

  /** 有定论了：算完，或者已经够深 */
  get settled(): boolean {
    return this.done || this.depth >= (this.engine === 'pro' ? PRO_SETTLE_DEPTH : LOCAL_SETTLE_DEPTH);
  }

  /** 用专业引擎算 movetime 毫秒。不能随时叫停的浏览器上分段算 */
  private runPro(movetime: number) {
    const chunked = !cooperativeStop() && movetime > CHUNK_MS;
    const job = search(
      {
        lane: 'study',
        board: this.board,
        color: this.color,
        history: this.history,
        multipv: PRO_MULTIPV,
        movetime: chunked ? CHUNK_MS : movetime,
        depth: PRO_MAX_DEPTH,
      },
      (lines, depth) => {
        if (this.job !== job) return;
        this.accept(linesToMoveScores(lines, this.board, this.color), depth, false);
      },
    );
    this.job = job;
    this.cancel = () => job.stop();
    void job.promise.then((r) => {
      if (this.job !== job || this.stopped) return;
      this.job = null;
      // 被暂停叫停的不算"算完"
      if (r.stopped) return;
      // 引擎出了问题、手里什么都没有：换自家引擎接着算，别让教练两手空空
      if (r.failed && !r.lines.length && !this.moves.length) {
        this.fallBack();
        return;
      }
      const moves = r.lines.length ? linesToMoveScores(r.lines, this.board, this.color) : [];
      const left = this.deadline - Date.now();
      // 分段算：这一段完了、时间还没用完、也还没算到头，接着下一段
      if (chunked && !r.failed && left > 300 && r.depth < PRO_MAX_DEPTH && !r.lines[0]?.mateIn) {
        this.accept(moves, r.depth, false);
        this.runPro(left);
        return;
      }
      this.accept(moves, r.depth || this.depth, true);
    });
  }

  private accept(moves: MoveScore[], depth: number, final: boolean) {
    if (this.stopped) return;
    // 暂停后重新开算，引擎从第 1 层重新迭代。这期间的浅层结果不能覆盖已经有的深层结论
    if (moves.length && depth >= this.depth) {
      this.moves = moves.map((m) => (m.bound ? this.exact.get(key(m.move)) ?? m : m));
      this.depth = depth;
    }
    if (final) this.done = true;
    this.emit();
  }

  /** 页面切到后台：先停，别在口袋里耗电 */
  pause() {
    if (this.engine !== 'pro' || this.paused || this.done || this.stopped || !this.job) return;
    this.paused = true;
    this.remaining = Math.max(0, this.deadline - Date.now());
    const j = this.job;
    this.job = null;
    j.stop();
    this.emit();
  }

  /** 回到前台：用剩下的时间接着算 */
  resume() {
    if (!this.paused || this.stopped) return;
    this.paused = false;
    if (this.remaining < 500) {
      this.accept([], this.depth, true);
      return;
    }
    this.deadline = Date.now() + this.remaining;
    this.runPro(this.remaining);
    this.emit();
  }

  /** 是不是在研究这个局面 */
  is(board: Board, color: Color): boolean {
    return !this.stopped && this.fen === toFen(board, color);
  }

  get best(): MoveScore | undefined {
    return this.moves[0];
  }

  /** 这一手在表里是不是只有上限（没精确算过） */
  isBound(m: Move): boolean {
    const e = this.moves.find((x) => sameMove(x.move, m));
    return !!e?.bound;
  }

  /** 研究让出引擎（精确算一手用）。在算的话先停下，记住还剩多少时间 */
  private hold() {
    if (this.holds++ > 0) return;
    if (this.engine !== 'pro' || !this.job || this.done || this.paused || this.stopped) return;
    this.held = Math.max(0, this.deadline - Date.now());
    const j = this.job;
    this.job = null;
    j.stop();
  }

  /** 精确算完：研究用剩下的时间接着算 */
  private unhold() {
    if (--this.holds > 0) return;
    const left = this.held;
    this.held = 0;
    if (!left || this.stopped || this.paused || this.done) return;
    if (left < 500) {
      this.accept([], this.depth, true);
      return;
    }
    this.deadline = Date.now() + left;
    this.runPro(left);
  }

  /**
   * 精确算一手。
   *
   * 专业引擎只精确排前 5 名；你走的那一手不在里面时，只知道"不比第 5 名好"。
   * 在安静的局面里前几名只差二三十分，这个上限什么也说明不了——
   * 教练要判它拦不拦，就得单独算一下。
   *
   * **在研究的那个引擎上算。** 它在这个局面上已经想了几秒到几分钟，置换表里全是这个局面的变化，
   * 接着往下算，深度一下就上去了。换一个冷的引擎从头算，同样三秒只到 18 层左右——
   * 实测一手"走完对方四步杀"的棋，冷引擎要算到第 18 层（两秒多）才看得见，
   * 十次里有一两次到时间还没看见，教练就放过去了；手机慢几倍，几乎每次都看不见。
   * 所以研究先让一让，算完这一手再接着研究。
   */
  async refine(m: Move): Promise<MoveScore | null> {
    const k = key(m);
    const have = this.moves.find((x) => sameMove(x.move, m));
    if (have && !have.bound) return have;
    if (this.exact.has(k)) return this.exact.get(k)!;
    let r: MoveScore | null;
    if (this.engine === 'pro') {
      this.hold();
      try {
        // 不设层数上限、按时间算满：层数封顶的话常常还没看到杀棋就停了
        r = await engineScoreMove(this.board, this.color, m, { movetime: 3000, history: this.history, lane: 'study' });
      } finally {
        this.unhold();
      }
    } else r = await requestScore(this.board, this.color, m, { maxDepth: Math.max(2, this.depth), timeMs: 1500, jitter: 0 });
    // 专业引擎这时倒下了：用自家引擎精确算这一手，总比只知道一个上限强
    if (!r && this.engine === 'pro' && !engineReady() && !this.stopped) {
      r = await requestScore(this.board, this.color, m, { maxDepth: 6, timeMs: 1500, jitter: 0 });
    }
    if (r && !this.stopped) {
      this.exact.set(k, r);
      this.moves = this.moves.map((x) => (sameMove(x.move, m) && x.bound ? r : x));
      this.emit();
    }
    return r;
  }

  /** 每多算一层（以及算完、被掐掉）通知一次。返回退订函数 */
  subscribe(cb: (s: Study) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  /** 等到条件满足、算完、被掐掉或者超时，先到先算。返回条件是否满足 */
  until(pred: (s: Study) => boolean, timeoutMs: number): Promise<boolean> {
    if (pred(this)) return Promise.resolve(true);
    if (this.done || this.stopped) return Promise.resolve(false);
    return new Promise((resolve) => {
      const t = window.setTimeout(() => {
        off();
        resolve(pred(this));
      }, timeoutMs);
      const off = this.subscribe(() => {
        if (pred(this) || this.done || this.stopped) {
          clearTimeout(t);
          off();
          resolve(pred(this));
        }
      });
    });
  }

  stop() {
    if (this.stopped) return;
    this.stopped = true;
    this.cancel();
    this.emit();
    this.subs.clear();
  }

  private emit() {
    for (const cb of [...this.subs]) cb(this);
  }
}
