/**
 * 一个局面的"研究"：轮到你走时，引擎在后台把这个局面一层一层往深算。
 *
 * **对局里所有关于"这一步该怎么走"的判断，都只读这一份。**
 *
 * 之前教练和 🔍 求助各算各的：教练用 0.9 秒的浅层分析（才 4 层），
 * 求助用 6.5 秒的深层分析。4 层看不见三步以外的杀棋，于是出现了
 * 用户说的那一幕——快被将死了，教练拦着不让出将，说"会丢兵"；
 * 一按求助，最优解恰恰就是出将。两个裁判，两个结论。
 *
 * 现在同一个局面只有一个裁判、一份结论，只是这份结论会随着时间越算越深。
 * 教练判得早，就用当时的深度；之后算深了结论变了，教练会**当场改口**，
 * 而不是留着一句错话让求助去打它的脸。
 */
import type { Board, Color } from './rules';
import type { MoveScore, SearchOpts } from './ai';
import { startStudy } from './aiclient';
import { toFen } from './notation';

/**
 * 研究预算。
 *
 * 比最高难度（棋王 6.5 秒）还多一点：你想棋的时间本来就是白送的算力。
 * margin 300：比首选差出三个兵以上的着法只证明"至少差这么多"，不再精确打分，
 * 省下来的时间在对攻局面里能多算两层——而对攻局面正是教练最需要看深的时候。
 */
export const STUDY_BUDGET: SearchOpts = { maxDepth: 64, timeMs: 8000, jitter: 0, margin: 300 };

/**
 * 教练放行一手棋之前，至少要看到这么深。
 * 4 层能看清一步杀、两步杀和绝大多数"白送子"，又只要不到一秒。
 */
export const MIN_JUDGE_DEPTH = 4;

export class Study {
  readonly fen: string;
  moves: MoveScore[] = [];
  depth = 0;
  done = false;
  /** 被掐掉了（局面变了）。等它的人不用再等 */
  stopped = false;
  private subs = new Set<(s: Study) => void>();
  private cancel: () => void;

  constructor(
    readonly board: Board,
    readonly color: Color,
    opts: SearchOpts = STUDY_BUDGET,
  ) {
    this.fen = toFen(board, color);
    this.cancel = startStudy(
      board,
      color,
      opts,
      (moves, depth) => {
        if (this.stopped || !moves.length) return;
        this.moves = moves;
        this.depth = depth;
        this.emit();
      },
      (moves, depth) => {
        if (this.stopped) return;
        if (moves.length) {
          this.moves = moves;
          this.depth = depth;
        }
        this.done = true;
        this.emit();
      },
    );
  }

  /** 是不是在研究这个局面 */
  is(board: Board, color: Color): boolean {
    return !this.stopped && this.fen === toFen(board, color);
  }

  get best(): MoveScore | undefined {
    return this.moves[0];
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
