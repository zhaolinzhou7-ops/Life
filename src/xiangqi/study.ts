/**
 * 一个局面的"研究"：轮到你走时，引擎在后台把这个局面一层一层往深算。
 *
 * **对局里所有关于"这一步该怎么走"的判断，都只读这一份。**
 * 教练判你这一手、🔍 求助、对手掂量议和，读的是同一个裁判的同一份结论，
 * 结论随时间越算越深；教练判得早、之后算深了结论变了，会当场改口。
 *
 * 裁判优先用专业引擎（fsf.ts，Fairy-Stockfish）。它没加载好或者这个浏览器跑不了时，
 * 退回自家引擎——同一个局面从头到尾只用一个裁判，不会中途换人。
 */
import type { Board, Color, Move } from './rules';
import type { MoveScore, SearchOpts } from './ai';
import { requestScore, startStudy } from './aiclient';
import { toFen } from './notation';
import { engineReady, linesToMoveScores, search, type SearchJob } from './fsf';

/**
 * 自家引擎的研究预算。
 * margin 300：比首选差出三个兵以上的着法只证明"至少差这么多"，省下时间换深度。
 */
export const STUDY_BUDGET: SearchOpts = { maxDepth: 64, timeMs: 8000, jitter: 0, margin: 300 };

/** 专业引擎的研究预算：前 6 名精确，最多算 8 秒或 24 层 */
const FSF_STUDY = { multipv: 6, movetime: 8000, depth: 24 };

/**
 * 教练放行一手棋之前，至少要看到这么深。
 * 自家引擎 4 层能看清一步杀、两步杀和绝大多数白送子；专业引擎 8 层通常不到半秒。
 */
export const MIN_JUDGE_DEPTH = 4;
const FSF_MIN_DEPTH = 8;

const sameMove = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

export class Study {
  readonly fen: string;
  /** 用的是哪个裁判 */
  readonly engine: 'fsf' | 'local';
  /** 教练放行至少要看到的层数（两个引擎的"层"不是一回事） */
  readonly minDepth: number;
  moves: MoveScore[] = [];
  depth = 0;
  done = false;
  /** 被掐掉了（局面变了）。等它的人不用再等 */
  stopped = false;
  private subs = new Set<(s: Study) => void>();
  private cancel: () => void = () => {};
  /** 单独精确算过的着法：后面每一层刷新时，这些不能又退回成"只知道上限" */
  private exact = new Map<string, MoveScore>();
  private job: SearchJob | null = null;
  private deadline = 0;

  constructor(
    readonly board: Board,
    readonly color: Color,
    private readonly history?: { startFen: string; moves: Move[] },
  ) {
    this.fen = toFen(board, color);
    this.engine = engineReady() ? 'fsf' : 'local';
    this.minDepth = this.engine === 'fsf' ? FSF_MIN_DEPTH : MIN_JUDGE_DEPTH;
    if (this.engine === 'fsf') {
      this.deadline = Date.now() + FSF_STUDY.movetime;
      this.runFsf(FSF_STUDY.movetime);
    } else {
      this.cancel = startStudy(
        board,
        color,
        STUDY_BUDGET,
        (moves, depth) => this.accept(moves, depth, false),
        (moves, depth) => this.accept(moves, depth, true),
      );
    }
  }

  private runFsf(movetime: number) {
    const job = search(
      { board: this.board, color: this.color, history: this.history, multipv: FSF_STUDY.multipv, movetime, depth: FSF_STUDY.depth },
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
      if (r.lines.length) this.accept(linesToMoveScores(r.lines, this.board, this.color), r.depth, true);
      else this.accept([], this.depth, true);
    });
  }

  private accept(moves: MoveScore[], depth: number, final: boolean) {
    if (this.stopped) return;
    // 暂停精确算单手之后重新开算，引擎会从第 1 层重新迭代（有置换表，很快追上来）。
    // 这期间的浅层结果不能覆盖已经有的深层结论
    if (moves.length && depth >= this.depth) {
      this.moves = moves.map((m) => (m.bound ? this.exact.get(key(m.move)) ?? m : m));
      this.depth = depth;
    }
    if (final) this.done = true;
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

  /**
   * 精确算一手。
   *
   * 专业引擎只精确排前 6 名；你走的那一手不在里面时，只知道"不比第 6 名好"。
   * 在安静的局面里前 6 名只差二三十分，这个上限什么也说明不了——
   * 教练要判它拦不拦，就得单独算一下。算的时候研究暂停，算完接着算。
   */
  async refine(m: Move): Promise<MoveScore | null> {
    const k = key(m);
    const have = this.moves.find((x) => sameMove(x.move, m));
    if (have && !have.bound) return have;
    if (this.exact.has(k)) return this.exact.get(k)!;
    let r: MoveScore | null = null;
    if (this.engine === 'fsf') {
      // 先把 job 摘掉再叫停：被叫停的那次搜索收尾时不能把研究标成"算完了"
      const running = this.job;
      this.job = null;
      running?.stop();
      if (running) await running.promise;
      if (this.stopped) return null;
      const res = await search({
        board: this.board,
        color: this.color,
        history: this.history,
        searchmoves: [m],
        depth: Math.max(FSF_MIN_DEPTH, this.depth - 2),
        movetime: 1500,
      }).promise;
      const ms = linesToMoveScores(res.lines, this.board, this.color).find((x) => !x.bound && sameMove(x.move, m));
      r = ms ?? null;
      // 接着算：还有剩余预算就继续，没有就算这一份结束
      const left = this.deadline - Date.now();
      if (!this.stopped && running) {
        if (left > 500) this.runFsf(left);
        else this.accept([], this.depth, true);
      }
    } else {
      r = await requestScore(this.board, this.color, m, { maxDepth: Math.max(2, this.depth), timeMs: 1500, jitter: 0 });
    }
    if (r && !this.stopped) {
      this.exact.set(k, r);
      this.moves = this.moves.map((x) => (sameMove(x.move, m) && x.bound ? r! : x));
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

const key = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;
