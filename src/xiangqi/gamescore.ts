/**
 * 给一整盘棋逐手打分。
 *
 * 原来打分长在复盘界面里：不点"复盘"就没有分数，点两次就算两遍、往战绩里记两遍。
 * 现在拆出来当一个服务：
 *   - 一盘下完就在后台开算（专业引擎的服务车道，不占界面），结算页直接显示"本局评分"；
 *   - 复盘界面打开时接着用这一份，不重算；
 *   - 算完只落一次地：存档、战绩、错题本各写一次。
 *
 * 你自己走的那几手，对局里教练已经用更深的研究判过了（known），直接用、不重算——
 * 省一半时间，而且和对局中教练的说法是同一个口径。
 */
import type { Board, Color, Move } from './rules';
import { applyMove } from './rules';
import { requestReview } from './aiclient';
import { REVIEW_BUDGET, engineReady, engineReview, loadEngine } from './pikafish';
import { headlineOf, reviewMove, summarize, tagCounts, type GameReview, type Judged, type ReviewedMove } from './analysis';
import { setGameReview } from './archive';
import { toFen } from './notation';
import { addOwnPuzzle, recordGame } from './save';

/** 自家引擎复盘的深度（专业引擎起不来时用） */
const LOCAL_REVIEW = { maxDepth: 6, timeMs: 1500, jitter: 0 };

export interface GameAnalysisOpts {
  startBoard: Board;
  startColor: Color;
  moves: Move[];
  playerColor: Color;
  playerWon?: boolean;
  /** 存档 id：算完把结论回填过去 */
  archiveId?: string;
  /** 对局里教练对你每一手的判读（第几手 → 判读） */
  known?: Map<number, Judged>;
  /**
   * 要不要记进战绩。刚下完的棋记；从存档里翻出来重看的棋已经记过了，不能再记一遍——
   * 原来每打开一次复盘就往战绩里多记一盘，"我的水平"被重复计数。
   */
  record: boolean;
  /** 深度复盘：每手多给几倍时间，更准也更慢 */
  deep?: boolean;
}

export class GameAnalysis {
  readonly boards: Board[];
  reviewed: ReviewedMove[] = [];
  report: GameReview | null = null;
  done = false;
  engine: 'pro' | 'local' = 'local';
  /** 这一局新存进错题本的题数 */
  savedPuzzles = 0;
  private subs = new Set<(a: GameAnalysis) => void>();
  private cancelFn: () => void = () => {};
  private cancelled = false;

  constructor(readonly opts: GameAnalysisOpts) {
    this.boards = [opts.startBoard];
    let cur = opts.startBoard;
    for (const m of opts.moves) {
      cur = applyMove(cur, m);
      this.boards.push(cur);
    }
    void this.start();
  }

  get total(): number {
    return this.opts.moves.length;
  }

  private async start() {
    // 专业引擎还在加载就等它一会儿：复盘是给这一盘下结论的，值得用最好的那个
    await Promise.race([loadEngine(), new Promise((r) => setTimeout(r, 6000))]);
    if (this.cancelled) return;
    this.engine = engineReady() ? 'pro' : 'local';
    const { startBoard, startColor, moves, known } = this.opts;
    /** 对局里的判读能直接用：精确、同一个引擎 */
    const usable = (ply: number) => {
      const k = known?.get(ply);
      return !!k && !k.played.bound && (k.engine ?? 'local') === this.engine;
    };
    const onStep = (ply: number, color: Color, board: Board, judged: Judged | null) => {
      const k = known?.get(ply);
      // 两个引擎的"层"不是一回事：同一个引擎比深浅；对局里用的是专业引擎、复盘却只能用自家的，照样用对局里的
      const sameEngine = (k?.engine ?? 'local') === this.engine;
      const use =
        k && !k.played.bound && (!judged || (sameEngine ? k.depth >= judged.depth : k.engine === 'pro')) ? k : judged;
      if (use) this.reviewed.push(reviewMove(board, ply, color, use));
      this.emit();
    };
    const onDone = () => {
      if (this.cancelled) return;
      this.report = summarize(this.reviewed);
      this.done = true;
      this.harvest(this.report);
      this.emit();
    };
    this.cancelFn =
      this.engine === 'pro'
        ? engineReview(startBoard, startColor, moves, onStep, onDone, this.opts.deep ? REVIEW_BUDGET.deep : REVIEW_BUDGET.standard, usable)
        : requestReview(startBoard, startColor, moves, LOCAL_REVIEW, onStep, onDone);
  }

  /** 把结论落地：存档回填、战绩、错题本。每盘只做一次 */
  private harvest(rep: GameReview) {
    const { playerColor, archiveId, playerWon, record } = this.opts;
    const me = rep.stats[playerColor];
    const foe = rep.stats[playerColor === 'r' ? 'b' : 'r'];
    if (archiveId) {
      const wi = rep.worst[playerColor];
      const w = wi >= 0 ? rep.moves[wi] : null;
      setGameReview(archiveId, {
        blunders: me.blunders,
        mistakes: me.mistakes,
        avgLoss: me.avgLoss,
        tags: tagCounts(rep.moves, playerColor),
        worstPly: w?.ply,
        worstText: w?.text,
        worstLoss: w?.loss,
        headline: headlineOf(rep.moves, playerColor),
        accuracy: me.accuracy,
        foeAccuracy: foe.accuracy,
      });
    }
    if (!record) return;
    recordGame({
      won: !!playerWon,
      blunders: me.blunders,
      mistakes: me.mistakes,
      avgLoss: me.avgLoss,
      // 这盘的分分别丢在哪一维——每日训练就是照着这个排的
      lossBy: rep.lossBy[playerColor],
      plies: rep.moves.filter((m) => m.color === playerColor).length,
      accuracy: me.accuracy,
    });
    rep.moves.forEach((m, i) => {
      if (m.color !== playerColor) return;
      if (m.grade !== 'blunder' && m.grade !== 'mistake') return;
      if (!m.bestMove || !m.bestText) return;
      const ok = addOwnPuzzle({
        // 用复盘归因出来的维度：开局吃亏和残局走软是两回事
        kind: m.dim,
        fen: toFen(this.boards[i], m.color),
        answer: m.bestText,
        line: m.bestPv ?? [m.bestText],
        // 难度按亏损给：丢得越多说明越该一眼看出来，题反而越"简单"
        rating: Math.round(Math.max(700, 1500 - m.loss / 3)),
      });
      if (ok) this.savedPuzzles++;
    });
  }

  subscribe(cb: (a: GameAnalysis) => void): () => void {
    this.subs.add(cb);
    return () => this.subs.delete(cb);
  }

  cancel() {
    this.cancelled = true;
    this.cancelFn();
    this.subs.clear();
  }

  private emit() {
    for (const cb of [...this.subs]) cb(this);
  }
}
