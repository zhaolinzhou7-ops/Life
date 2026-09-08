/**
 * 水平测评：自适应出题，二十分钟测出五维水平。
 *
 * 为什么不用"固定 30 题算正确率"：那种测法要么题太简单（高手全对，测不出上限），
 * 要么题太难（新手全错，测不出下限），而且要很多题才有分辨率。
 *
 * 这里用 Elo 自适应——每答一题就修正一次估计，下一题按修正后的水平挑。
 * 答对就往上探，答错就往下探，六七题就能收敛到 ±100 分以内，
 * 和考驾照的适应性测试、Lichess 的 puzzle rating 是一个路子。
 */
import { DIMS, seedRating, type Dim } from './save';
import { loadPuzzles, pickNear, type Puzzle, type PuzzleKind } from './puzzles';

/** 每个维度出几题。5 维 × 7 = 35 题，约 20 分钟 */
export const PER_DIM = 7;

/**
 * 步长：前几题动得大（快速逼近），后面收小（稳定下来）。
 * 这是自适应测评的核心——固定步长要么收敛太慢，要么一直在跳。
 */
const K_SCHEDULE = [400, 250, 160, 110, 80, 60, 45];

const DIM_KIND: Record<Dim, PuzzleKind> = {
  safety: 'safety',
  mate: 'mate',
  tactic: 'tactic',
  endgame: 'endgame',
  opening: 'opening',
};

export interface Question {
  puzzle: Puzzle;
  dim: Dim;
  /** 第几题 / 共几题 */
  index: number;
  total: number;
}

export interface AssessResult {
  dims: Record<Dim, number>;
  /** 每维实际出了几题——题库不够时会少出，必须如实反映 */
  counts: Record<Dim, number>;
  /**
   * 这一维是不是"顶到题库天花板了"：题全做对，说明真实水平只会更高，
   * 测出来的数字是**下限**而不是准确值。这时候必须显示成 ≥X，
   * 不能假装精确——测不准还报个准数，比不测更误导人。
   */
  saturated: Record<Dim, boolean>;
  overall: number;
  ci: number;
  /** 题库能测到的难度上限，用来说明天花板在哪 */
  ceiling: number;
}

export class Assessment {
  // 起点用自报的天天象棋级别换算，能少走好几题弯路；测几题之后就完全按表现走
  private est: Record<Dim, number> = (() => {
    const s = seedRating();
    return { safety: s, mate: s, tactic: s, endgame: s, opening: s };
  })();
  private done: Record<Dim, number> = { safety: 0, mate: 0, tactic: 0, endgame: 0, opening: 0 };
  private used = new Set<string>();
  private order: Dim[] = [];
  private cur: Question | null = null;
  private log: { dim: Dim; rating: number; correct: boolean }[] = [];
  private ready = false;

  /** 题库里实际有题的维度（题库不全时不能假装测过） */
  private available: Dim[] = [];

  async init(): Promise<void> {
    await loadPuzzles();
    this.available = DIMS.filter((d) => {
      const p = pickNear(DIM_KIND[d], 1200, new Set());
      return !!p;
    });
    // 交叉出题：不要连着出七道杀法题，换着来注意力才不容易垮
    this.order = [];
    for (let i = 0; i < PER_DIM; i++) for (const d of this.available) this.order.push(d);
    this.ready = true;
  }

  get total(): number {
    return this.order.length;
  }

  get answered(): number {
    return this.log.length;
  }

  /** 题库里有哪些维度可测 */
  get testable(): Dim[] {
    return this.available;
  }

  /** 取下一题；测完返回 null */
  next(): Question | null {
    if (!this.ready) return null;
    const idx = this.log.length;
    if (idx >= this.order.length) {
      this.cur = null;
      return null;
    }
    const dim = this.order[idx];
    const p = pickNear(DIM_KIND[dim], this.est[dim], this.used);
    if (!p) {
      // 这一维的题用光了：跳过，别卡住
      this.order.splice(idx, 1);
      return this.next();
    }
    this.used.add(p.id);
    this.cur = { puzzle: p, dim, index: idx + 1, total: this.order.length };
    return this.cur;
  }

  /** 提交当前题的对错，返回修正后的该维估计 */
  answer(correct: boolean): number {
    const q = this.cur;
    if (!q) return 0;
    const cur = this.est[q.dim];
    const expect = 1 / (1 + 10 ** ((q.puzzle.rating - cur) / 400));
    const k = K_SCHEDULE[Math.min(this.done[q.dim], K_SCHEDULE.length - 1)];
    this.est[q.dim] = Math.max(600, Math.min(2300, cur + k * ((correct ? 1 : 0) - expect)));
    this.done[q.dim]++;
    this.log.push({ dim: q.dim, rating: q.puzzle.rating, correct });
    this.cur = null;
    return Math.round(this.est[q.dim]);
  }

  result(): AssessResult {
    const dims = {} as Record<Dim, number>;
    const counts = {} as Record<Dim, number>;
    const saturated = {} as Record<Dim, boolean>;
    let ceiling = 0;
    for (const d of DIMS) {
      dims[d] = Math.round(this.est[d]);
      counts[d] = this.done[d];
      const mine = this.log.filter((l) => l.dim === d);
      // 全做对 = 题库里没有能难住你的题了，这个分只是下限
      saturated[d] = mine.length > 0 && mine.every((l) => l.correct);
      for (const l of mine) if (l.rating > ceiling) ceiling = l.rating;
    }
    // 总分按维度加权：眼力和杀法权重高，它们才是业余棋手输棋的主因
    const W: Record<Dim, number> = { safety: 1.3, mate: 1.2, tactic: 1, endgame: 1, opening: 0.7 };
    let s = 0;
    let w = 0;
    for (const d of this.available) {
      s += dims[d] * W[d];
      w += W[d];
    }
    const n = this.log.length;
    return {
      dims,
      counts,
      saturated,
      ceiling,
      overall: w ? Math.round(s / w) : 1200,
      ci: n ? Math.round(Math.max(60, 400 / Math.sqrt(n))) : 400,
    };
  }

  /** 答题记录，诊断报告里用来说"你错在哪一档难度" */
  getLog() {
    return this.log.slice();
  }
}

/**
 * 生成一句具体的诊断，而不是"你的杀法比较弱"这种废话。
 * 说清楚：错在哪个难度档、和你其它维度差多少。
 */
export function diagnose(log: { dim: Dim; rating: number; correct: boolean }[], dim: Dim): string {
  const mine = log.filter((l) => l.dim === dim);
  if (!mine.length) return '这一维还没测（题库里暂时没有这类题）。';
  const wrong = mine.filter((l) => !l.correct);
  if (!wrong.length) {
    const top = Math.max(...mine.map((l) => l.rating));
    return `${mine.length} 题全对，最难那题 ${top} 分也没难住你——题库到顶了，你的真实水平只会更高，这个分只能当下限看。`;
  }
  const easiest = Math.min(...wrong.map((l) => l.rating));
  const right = mine.filter((l) => l.correct);
  const hardest = right.length ? Math.max(...right.map((l) => l.rating)) : 0;
  const parts = [`做对了 ${right.length}/${mine.length} 题`];
  if (hardest) parts.push(`最难做对的是 ${hardest} 分的题`);
  parts.push(`从 ${easiest} 分这一档开始出错`);
  return parts.join('，') + '。';
}
