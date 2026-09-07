/**
 * 复盘：把一盘棋逐手交给引擎打分，标出你哪步走坏了、坏在哪、该走什么。
 *
 * 下完一盘不知道自己错在哪，就等于白下。业余棋手输棋六成是**漏着**——
 * 没看见对方下一步的威胁，所以复盘的重点不是「这步价值 -0.7」这种数字，
 * 而是把对方的惩罚手段直接演给你看：「你走完这步，对方车八进五就白吃你一个马」。
 */
import { applyMove, cloneBoard, type Board, type Color, type Move, type PType } from './rules';
import { moveToText, pieceName } from './notation';

/** 子力价值，和引擎 ai.ts 里的 VAL 保持一致（兵=100） */
export const PIECE_VALUE: Record<PType, number> = { K: 60000, A: 220, E: 220, H: 450, R: 1000, C: 500, P: 100 };

export type Grade = 'best' | 'good' | 'ok' | 'dubious' | 'mistake' | 'blunder';

/** 失误分级阈值，单位「兵=100」。一个马/炮 ≈ 450~500，一个车 = 1000 */
const GRADE_CUTS: [number, Grade][] = [
  [30, 'best'],
  [80, 'good'],
  [200, 'ok'],
  [500, 'dubious'],
  [1000, 'mistake'],
];

export const GRADE_LABEL: Record<Grade, string> = {
  best: '好棋',
  good: '不错',
  ok: '可以',
  dubious: '不佳',
  mistake: '失误',
  blunder: '漏着',
};

export const GRADE_COLOR: Record<Grade, string> = {
  best: '#3ec46d',
  good: '#7ec46d',
  ok: '#c9c48a',
  dubious: '#e8a33d',
  mistake: '#e8703d',
  blunder: '#e0433a',
};

/**
 * 胜势门槛：约等于多一个车。
 * 定得太低（比如一个马 450）会出事——最佳 460、实走 440 只差 20 分，
 * 却会被判成「把赢棋走成了平棋」，属于胡说。所以门槛要高，
 * 而且翻转还必须同时亏够 FLIP_MIN_LOSS 才算数。
 */
const WINNING = 900;
/** 判「局势翻转」的最低亏损：没亏到这个数，只是正常的分数波动 */
const FLIP_MIN_LOSS = 200;
/**
 * 亏损上限。走进被将死的局面时，原始分差是四万多（杀棋分），
 * 直接拿去显示和求平均没有意义，还会把整盘的平均亏损带偏。
 * 亏过两个车就已经是"输定了"，再细分没有信息量，统一截到这里。
 */
const LOSS_CAP = 2000;

/** 局势翻转类型，比单纯的分差更能说明「这步葬送了什么」 */
export type Flip = 'win-to-even' | 'win-to-loss' | 'even-to-loss' | 'missed-mate';

export const FLIP_LABEL: Record<Flip, string> = {
  'win-to-even': '把赢棋走成了平棋',
  'win-to-loss': '把赢棋走成了输棋',
  'even-to-loss': '把平棋走成了输棋',
  'missed-mate': '漏掉了杀棋',
};

/** 引擎对一手棋的原始判读（由 ai.judgeMove 提供，这里只声明形状避免循环依赖） */
export interface Judged {
  best: { move: Move; score: number; mateIn?: number; pv: Move[] };
  played: { move: Move; score: number; mateIn?: number; pv: Move[] };
  depth: number;
}

export interface ReviewedMove {
  ply: number;
  color: Color;
  move: Move;
  /** 中文记谱，如「炮二平五」 */
  text: string;
  /** 走子方视角：走之前的最佳分 / 你这手的实际分 */
  bestScore: number;
  playedScore: number;
  /** 亏了多少分（>=0） */
  loss: number;
  grade: Grade;
  flip?: Flip;
  /** 更好的着法与它的后续。bestMove 带坐标，界面要把它标在棋盘上 */
  bestMove?: Move;
  bestText?: string;
  bestPv?: string[];
  /** 一句话人话点评 */
  comment: string;
}

export interface GameReview {
  moves: ReviewedMove[];
  /** 决定胜负的那一手在 moves 里的下标（不分红黑） */
  turning: number;
  /** 各方各自最该改的一手，学棋主要看自己这条 */
  worst: Record<Color, number>;
  /** 按方统计 */
  stats: Record<Color, { total: number; blunders: number; mistakes: number; avgLoss: number }>;
}

/** 依分差与局势翻转定级。翻转优先——分差 300 但把赢棋走没了，比单纯亏 300 严重得多 */
export function gradeOf(loss: number, flip?: Flip): Grade {
  if (flip === 'win-to-loss' || flip === 'missed-mate') return 'blunder';
  if (loss < 0) loss = 0;
  for (const [cut, g] of GRADE_CUTS) if (loss < cut) return g;
  return 'blunder';
}

/** 判断这手棋有没有把局势整个走翻 */
export function flipOf(j: Judged): Flip | undefined {
  const b = j.best.score;
  const p = j.played.score;
  if (j.best.mateIn !== undefined && j.best.mateIn > 0 && (j.played.mateIn === undefined || j.played.mateIn <= 0)) {
    return 'missed-mate';
  }
  // 光是跨过门槛不够，还得真亏了才算翻转，否则 460→440 也会被说成"把赢棋走没了"
  if (b - p < FLIP_MIN_LOSS) return undefined;
  if (b >= WINNING && p <= -WINNING) return 'win-to-loss';
  if (b >= WINNING && p < WINNING && p > -WINNING) return 'win-to-even';
  if (b > -WINNING && p <= -WINNING) return 'even-to-loss';
  return undefined;
}

/** 我方子力减对方子力（不含将帅） */
function balance(b: Board, me: Color): number {
  let s = 0;
  for (const row of b) {
    for (const p of row) {
      if (!p || p.t === 'K') continue;
      s += p.c === me ? PIECE_VALUE[p.t] : -PIECE_VALUE[p.t];
    }
  }
  return s;
}

/**
 * 把主变里「对方第一次吃你的子」找出来，这是最直观的失误说明。
 *
 * 但不能见到吃子就报——兑子的时候对方也会吃你，那是等价交换，
 * 说成「对方吃掉你的车」纯属吓人。所以先看整条主变走完**净亏**了多少，
 * 确实亏了子才去点名那一手。
 */
function firstLoss(b: Board, pv: Move[], me: Color): { text: string; piece: string } | null {
  if (pv.length < 2) return null;
  let cur = cloneBoard(b);
  let hit: { text: string; piece: string } | null = null;
  let hitVal = 0;
  let startBal = 0;
  for (let i = 0; i < pv.length; i++) {
    const m = pv[i];
    if (i === 1) startBal = balance(cur, me); // 我走完之后的子力对比
    const victim = cur[m.ty][m.tx];
    // pv[0] 是我走的，之后奇数下标是对方。
    // 取「丢得最大的那个子」而不是第一个——被吃一个仕和被吃一个车，
    // 该说的显然是车。
    if (i % 2 === 1 && victim && victim.c === me && victim.t !== 'K' && PIECE_VALUE[victim.t] > hitVal) {
      hitVal = PIECE_VALUE[victim.t];
      hit = { text: moveToText(cur, m), piece: pieceName(victim.t, me) };
    }
    cur = applyMove(cur, m);
  }
  // 主变走到底仍然净亏一个兵以上，才认定这是真丢子而不是兑子
  return hit && balance(cur, me) - startBal <= -PIECE_VALUE.P ? hit : null;
}

/** 生成一句人话点评 */
function commentOf(b: Board, j: Judged, me: Color, grade: Grade, flip: Flip | undefined, loss: number): string {
  if (flip === 'missed-mate') {
    const n = j.best.mateIn!;
    const line = pvText(b, j.best.pv).slice(0, 3).join(' ');
    return `这里有杀棋：${line}，${n} 回合成杀。`;
  }
  if (grade === 'best' || grade === 'good') {
    if (j.best.mateIn !== undefined && j.best.mateIn > 0) return '好棋，已经走进杀局了。';
    return '这步是引擎的首选，继续保持。';
  }

  const lost = firstLoss(b, j.played.pv, me);
  const better = j.best.pv.length ? moveToText(b, j.best.move) : '';
  const parts: string[] = [];

  // 被将死比丢子严重，优先说
  if (j.played.mateIn !== undefined && j.played.mateIn < 0) {
    parts.push(`走完这步，对方 ${-j.played.mateIn} 回合内就能把你将死`);
  } else if (lost) parts.push(`走完这步，对方 ${lost.text} 就吃掉你的${lost.piece}`);
  else if (flip) parts.push(FLIP_LABEL[flip]);
  else parts.push(`这步之后局面明显变差（亏 ${loss} 分，约${lossInPieces(loss)}）`);

  if (better) parts.push(`改走 ${better} 更好`);
  return parts.join('，') + '。';
}

/** 把分差换算成"约等于几个子"，比裸数字直观 */
function lossInPieces(loss: number): string {
  if (loss >= 1000) return '一个车';
  if (loss >= 450) return '一个马炮';
  if (loss >= 200) return '两个兵';
  return '一个兵';
}

/** 主变转成中文记谱串 */
export function pvText(b: Board, pv: Move[]): string[] {
  const out: string[] = [];
  let cur = b;
  for (const m of pv) {
    out.push(moveToText(cur, m));
    cur = applyMove(cur, m);
  }
  return out;
}

/**
 * 把引擎判读转成一条复盘记录。
 * b 是**走这步之前**的棋盘。
 */
export function reviewMove(b: Board, ply: number, color: Color, j: Judged): ReviewedMove {
  const flip = flipOf(j);
  const loss = Math.min(LOSS_CAP, Math.max(0, j.best.score - j.played.score));
  const grade = gradeOf(loss, flip);
  const isBest = j.best.move.fx === j.played.move.fx && j.best.move.fy === j.played.move.fy
    && j.best.move.tx === j.played.move.tx && j.best.move.ty === j.played.move.ty;
  return {
    ply,
    color,
    move: j.played.move,
    text: moveToText(b, j.played.move),
    bestScore: j.best.score,
    playedScore: j.played.score,
    loss,
    grade,
    flip,
    bestMove: isBest ? undefined : j.best.move,
    bestText: isBest ? undefined : moveToText(b, j.best.move),
    bestPv: isBest ? undefined : pvText(b, j.best.pv).slice(0, 6),
    comment: commentOf(b, j, color, grade, flip, loss),
  };
}

/** 汇总整盘：统计各方失误，并找出决定胜负的那一手 */
export function summarize(moves: ReviewedMove[]): GameReview {
  const stats: GameReview['stats'] = {
    r: { total: 0, blunders: 0, mistakes: 0, avgLoss: 0 },
    b: { total: 0, blunders: 0, mistakes: 0, avgLoss: 0 },
  };
  const sum: Record<Color, number> = { r: 0, b: 0 };
  for (const m of moves) {
    const s = stats[m.color];
    s.total++;
    sum[m.color] += m.loss;
    if (m.grade === 'blunder') s.blunders++;
    else if (m.grade === 'mistake') s.mistakes++;
  }
  for (const c of ['r', 'b'] as Color[]) {
    stats[c].avgLoss = stats[c].total ? Math.round(sum[c] / stats[c].total) : 0;
  }

  // 决定胜负的一手：以亏损幅度为主，局势翻转作为加权。
  // 不能让翻转直接压过幅度——亏 20 分的边界翻转不该盖过亏 1000 分的丢车。
  let turning = -1;
  let bestKey = -1;
  moves.forEach((m, i) => {
    const w = m.flip === 'win-to-loss' ? 3 : m.flip === 'even-to-loss' ? 2.5 : m.flip ? 1.8 : 1;
    const k = m.loss * w;
    if (k > bestKey && m.loss > 0) {
      bestKey = k;
      turning = i;
    }
  });

  // 各方自己最该改的一手：翻盘点可能是对手送的，但学棋要看的是你自己那步
  const worst: Record<Color, number> = { r: -1, b: -1 };
  moves.forEach((m, i) => {
    const cur = worst[m.color];
    if (m.loss > 0 && (cur < 0 || m.loss > moves[cur].loss)) worst[m.color] = i;
  });

  return { moves, turning, worst, stats };
}
