/**
 * 复盘：把一盘棋逐手交给引擎打分，标出你哪步走坏了、坏在哪、该走什么。
 *
 * 下完一盘不知道自己错在哪，就等于白下。业余棋手输棋六成是**漏着**——
 * 没看见对方下一步的威胁，所以复盘的重点不是「这步价值 -0.7」这种数字，
 * 而是把对方的惩罚手段直接演给你看：「你走完这步，对方车八进五就白吃你一个马」。
 */
import { applyMove, cloneBoard, type Board, type Color, type Move, type PType } from './rules';
import { moveToText, pieceName } from './notation';
import { hangingPieces, tagMistake, type ErrTag } from './teach';
import type { Dim } from './save';

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
  /** bound = 分数只是上限（引擎只证明了"至少差这么多"），复盘不能拿它当精确亏损 */
  played: { move: Move; score: number; mateIn?: number; pv: Move[]; bound?: boolean };
  depth: number;
  /** 哪个引擎判的。两个引擎的"层"不能互相比深浅 */
  engine?: 'pro' | 'local';
  /** 次好的一手的分数（走子方视角）。有它才判得出"唯一着" */
  second?: number;
}

// ───────────────────────── 评分：胜率、准确率、妙手 ─────────────────────────

/**
 * 胜率（走子方视角，0～100）。
 *
 * 用胜率而不是分差给每一手打分，是国际象棋网站通行的做法，道理很简单：
 * 已经多两个车的时候再亏一个兵无关痛痒，均势时亏一个兵却可能是胜负手。
 * 分差一样，对结果的影响完全不同。
 * 系数按"车≈1000"的口径调：多一个兵约 56%，多一个马炮约 75%，多一个车约 92%。
 */
export function winPct(score: number, mateIn?: number): number {
  if (mateIn !== undefined) return mateIn > 0 ? 100 : 0;
  const s = Math.max(-4000, Math.min(4000, score));
  return 50 + 50 * (2 / (1 + Math.exp(-0.0025 * s)) - 1);
}

/**
 * 一手棋的准确率（0～100）：走完之后你的胜率比最好的下法掉了多少。
 * 公式沿用 lichess：掉 0 → 100，掉 5 个百分点 → 约 80，掉 20 个百分点 → 约 40。
 */
export function moveAccuracy(winBefore: number, winAfter: number): number {
  const d = Math.max(0, winBefore - winAfter);
  const a = 103.1668 * Math.exp(-0.04354 * d) - 3.1669;
  return Math.max(0, Math.min(100, Math.round(a)));
}

/** 一方整盘的准确率：算术平均和调和平均各半——一手漏着要能把分数拉下来，不能被几十手好棋摊平 */
export function gameAccuracy(accs: number[]): number {
  if (!accs.length) return 0;
  const arith = accs.reduce((a, b) => a + b, 0) / accs.length;
  const harm = accs.length / accs.reduce((a, b) => a + 1 / Math.max(1, b), 0);
  return Math.round((arith + harm) / 2);
}

export type Phase = 'opening' | 'middle' | 'endgame';
export const PHASE_NAME: Record<Phase, string> = { opening: '开局', middle: '中局', endgame: '残局' };

/**
 * 每一手的称号。比六档分级多出三样：
 *   妙手   —— 引擎首选（或几乎一样好），而且是弃子：走完对方能白吃你一个马炮以上，但引擎认为值
 *   唯一着 —— 引擎首选，而且其它走法都差出两个兵以上：这一步走不对局面就崩
 *   最佳   —— 就是引擎的首选
 * 这三样最能说明"你看到了别人看不到的东西"，只挑错不夸好的复盘让人越下越怕。
 */
export type MoveLabel = 'brilliant' | 'only' | 'top' | 'best' | 'good' | 'ok' | 'dubious' | 'mistake' | 'blunder';

export const MOVE_LABEL: Record<MoveLabel, { name: string; sym: string; color: string }> = {
  brilliant: { name: '妙手', sym: '!!', color: '#26c6da' },
  only: { name: '唯一着', sym: '!', color: '#2eb7a0' },
  top: { name: '最佳', sym: '★', color: '#3ec46d' },
  best: { name: '好棋', sym: '', color: '#6cc46d' },
  good: { name: '不错', sym: '', color: '#9cc46d' },
  ok: { name: '可以', sym: '', color: '#c9c48a' },
  dubious: { name: '不佳', sym: '?!', color: '#e8a33d' },
  mistake: { name: '失误', sym: '?', color: '#e8703d' },
  blunder: { name: '漏着', sym: '??', color: '#e0433a' },
};

/** 统计表里的顺序：从好到坏 */
export const LABEL_ORDER: MoveLabel[] = ['brilliant', 'only', 'top', 'best', 'good', 'ok', 'dubious', 'mistake', 'blunder'];

export function labelOf(m: { grade: Grade; badge?: 'brilliant' | 'only'; isBest?: boolean }): MoveLabel {
  if (m.badge) return m.badge;
  if (m.isBest && m.grade === 'best') return 'top';
  return m.grade;
}

/**
 * 局面评价说成人话（红方视角的分数）："红优，约多一个马炮"、"均势"、"黑方 3 步杀"。
 * 复盘里每一手都标"走之前 → 走之后"，一眼看出这一手让局面变成了什么样。
 */
export function evalWords(redScore: number, redMate?: number): string {
  if (redMate !== undefined) return redMate > 0 ? `红方 ${redMate} 步杀` : `黑方 ${-redMate} 步杀`;
  const a = Math.abs(redScore);
  if (a < 60) return '均势';
  const side = redScore > 0 ? '红' : '黑';
  const size = a >= 1900 ? '大优（约多两个车）' : a >= 900 ? '大优（约多一个车）' : a >= 420 ? '优（约多一个马炮）' : a >= 150 ? `稍优（约多${Math.round(a / 100)}个兵）` : '略好';
  return `${side}${size}`;
}

/** 这一手是哪个阶段：前 12 回合算开局，进攻子力剩 6 个以内算残局 */
export function phaseAt(b: Board, ply: number): Phase {
  if (ply < 24) return 'opening';
  return materialLeft(b) <= 6 ? 'endgame' : 'middle';
}

/**
 * 是不是弃子：走完之后，对方能白吃你的子，净赚一个马炮以上（扣掉你这一手吃到的）。
 * 静态兑子只用来**认出**弃子；这一手值不值，由引擎说了算。
 */
function isSacrifice(b: Board, m: Move, me: Color): boolean {
  const after = applyMove(b, m);
  const hang = hangingPieces(after, me).reduce((mx, h) => Math.max(mx, h.loss), 0);
  const took = b[m.ty][m.tx];
  const gained = took ? PIECE_VALUE[took.t] : 0;
  return hang - gained >= 300;
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
  /** 主变的着法本身（计划要一步步翻译，只有中文记谱不够） */
  bestLine?: Move[];
  /** 你这一手之后引擎预计的应对（你走的就是最好的一手时，讲"你的思路"用） */
  playedLine?: Move[];
  /** 一句话人话点评 */
  comment: string;
  /** 这一手的亏损算在哪一维（只有真亏了才有意义） */
  dim: Dim;
  /** 这一手的准确率（0～100） */
  accuracy: number;
  /** 就是引擎的首选 */
  isBest: boolean;
  /** 妙手 / 唯一着 */
  badge?: 'brilliant' | 'only';
  /** 这一手在哪个阶段 */
  phase: Phase;
  /** 走完之后红方的胜率（0～100），画优势曲线用 */
  redWin: number;
  /** 最好的下法 / 你这一手的杀棋步数（走子方视角，正数=能杀对方） */
  bestMate?: number;
  playedMate?: number;
  /**
   * 这一手是**哪种毛病**。和 dim 是两件事：
   *   dim  回答"该练哪一块"（拿去排训练计划）
   *   tag  回答"你是个什么毛病的棋手"（拿去做错误画像）
   * 同样归到"眼力"，贪吃和只顾自己不看对方是完全不同的两种人，
   * 给的建议也完全不同，所以必须分开记。
   * 只有真走坏了的一手才有 tag——好棋没有毛病可言。
   */
  tag?: ErrTag;
}

export interface GameReview {
  moves: ReviewedMove[];
  /** 决定胜负的那一手在 moves 里的下标（不分红黑） */
  turning: number;
  /** 各方各自最该改的一手，学棋主要看自己这条 */
  worst: Record<Color, number>;
  /** 按方统计 */
  stats: Record<Color, { total: number; blunders: number; mistakes: number; avgLoss: number; accuracy: number }>;
  /** 各方各阶段的准确率（这个阶段没走过棋就没有） */
  phaseAcc: Record<Color, Partial<Record<Phase, number>>>;
  /** 各方每种称号各有几手 */
  counts: Record<Color, Record<MoveLabel, number>>;
  /**
   * 每一方的分**分别丢在哪一维**（只统计"不佳"以上的失误）。
   * 每日训练就是照着这个排的——练你真正在输分的那一块，而不是练你分低的那一块。
   */
  lossBy: Record<Color, Partial<Record<Dim, number>>>;
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

/** 盘面上还剩多少子力（不含将帅），用来判断进没进残局 */
function materialLeft(b: Board): number {
  let n = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K' && p.t !== 'A' && p.t !== 'E') n++;
  return n;
}

/**
 * 这一手的分**丢在哪一维**。
 *
 * 这是整套训练系统里最关键的一次归因：做题分只说明你会不会做题，
 * 而决定你输棋的是实战里分从哪儿漏掉的。专业教练拿到一盘棋，第一件事
 * 就是分门别类地问"这几步分别是什么性质的错"，然后照着最贵的那一类去练。
 *
 * 归类的顺序是有讲究的，从"最该先解决的"往下排：
 *   漏杀       → 杀法：眼前就有杀棋没看见，最可惜
 *   开局十二手内 → 布局：这个阶段的亏损几乎都是不懂定式思路
 *   子力已经很少 → 残局：技术问题，不是眼力问题
 *   对方立刻吃你子 → 眼力：没看见对方的威胁，业余输棋六成是这个
 *   其余         → 战术：有赢子的手段没抓住
 */
export function dimOfLoss(b: Board, j: Judged, me: Color, ply: number, flip?: Flip): Dim {
  if (flip === 'missed-mate' || (j.best.mateIn !== undefined && j.best.mateIn > 0)) return 'mate';
  if (ply < 24) return 'opening';
  if (materialLeft(b) <= 6) return 'endgame';
  return firstLoss(b, j.played.pv, me) ? 'safety' : 'tactic';
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
    // "分差很小"和"就是首选"是两回事。原来这两种都说成"这步是引擎的首选"，
    // 而界面同时又在旁边列着另一手更好的着法，自相矛盾——稍微懂棋的人一眼看穿。
    const same =
      j.best.move.fx === j.played.move.fx && j.best.move.fy === j.played.move.fy &&
      j.best.move.tx === j.played.move.tx && j.best.move.ty === j.played.move.ty;
    if (same) return '这步就是引擎的首选，继续保持。';
    const alt = moveToText(b, j.best.move);
    return grade === 'best'
      ? `这步和引擎的首选 ${alt} 一样好。`
      : `这步可以，引擎更想走 ${alt}，但差得不多。`;
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
  // 只给真亏了的一手打标签。实测单手 1.2ms，整盘加起来可以忽略
  const tag = loss >= 80 ? tagMistake(b, j.played.move, color, { missedMate: flip === 'missed-mate', loss }) : undefined;
  const wBefore = winPct(j.best.score, j.best.mateIn);
  const wAfter = winPct(j.played.score, j.played.mateIn);
  const accuracy = moveAccuracy(wBefore, wAfter);
  // 已经赢定（或输定）的局面里谈不上妙手和唯一着：怎么走都一样
  const live = Math.abs(j.best.score) < 1500 && j.best.mateIn === undefined;
  let badge: 'brilliant' | 'only' | undefined;
  if (grade === 'best' && live && j.best.score > -400 && isSacrifice(b, j.played.move, color)) badge = 'brilliant';
  else if (isBest && live && j.second !== undefined && j.best.score - j.second >= 200) badge = 'only';
  return {
    accuracy,
    isBest,
    badge,
    phase: phaseAt(b, ply),
    redWin: color === 'r' ? wAfter : 100 - wAfter,
    bestMate: j.best.mateIn,
    playedMate: j.played.mateIn,
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
    bestLine: isBest ? undefined : j.best.pv?.length ? j.best.pv.slice(0, 12) : [j.best.move],
    playedLine: j.played.pv?.length ? j.played.pv.slice(0, 12) : [j.played.move],
    comment: commentOf(b, j, color, grade, flip, loss),
    dim: dimOfLoss(b, j, color, ply, flip),
    tag,
  };
}

/** 一方在这一局里各类毛病各犯了几次，错误画像直接用这个 */
export function tagCounts(moves: ReviewedMove[], c: Color): Partial<Record<ErrTag, number>> {
  const out: Partial<Record<ErrTag, number>> = {};
  for (const m of moves) {
    if (m.color !== c || !m.tag) continue;
    out[m.tag] = (out[m.tag] ?? 0) + 1;
  }
  return out;
}

/**
 * 一句话说清这一局最大的问题。列表里要显示的就是这一句。
 *
 * 优先说**性质**而不是数量："中局漏看了对方的威胁"比"有 3 手失误"有用得多，
 * 因为前者告诉你该改什么，后者只告诉你考了几分。
 */
export function headlineOf(moves: ReviewedMove[], c: Color): string {
  const mine = moves.filter((m) => m.color === c);
  if (!mine.length) return '';
  const counts = tagCounts(moves, c);
  const worst = mine.reduce((a, b2) => (b2.loss > a.loss ? b2 : a), mine[0]);
  if (worst.loss < 80) return '全程没有明显失误';
  const top = (Object.entries(counts) as [ErrTag, number][]).sort((a, b2) => b2[1] - a[1])[0];
  const phase = worst.ply < 24 ? '开局' : mine.length - Math.floor(worst.ply / 2) < 8 ? '残局' : '中局';
  const names: Record<ErrTag, string> = {
    hang: '送子',
    greedy: '贪吃',
    'missed-threat': '漏看对方的威胁',
    'walk-into-mate': '漏将',
    'missed-mate': '漏掉了杀棋',
    slow: '走软',
  };
  return top ? `${phase}${names[top[0]]}` : `${phase}走坏了一手`;
}

/** 汇总整盘：统计各方失误，并找出决定胜负的那一手 */
export function summarize(moves: ReviewedMove[]): GameReview {
  const stats: GameReview['stats'] = {
    r: { total: 0, blunders: 0, mistakes: 0, avgLoss: 0, accuracy: 0 },
    b: { total: 0, blunders: 0, mistakes: 0, avgLoss: 0, accuracy: 0 },
  };
  const zero = () => Object.fromEntries(LABEL_ORDER.map((l) => [l, 0])) as Record<MoveLabel, number>;
  const counts: GameReview['counts'] = { r: zero(), b: zero() };
  const accs: Record<Color, number[]> = { r: [], b: [] };
  const phaseList: Record<Color, Partial<Record<Phase, number[]>>> = { r: {}, b: {} };
  const sum: Record<Color, number> = { r: 0, b: 0 };
  const lossBy: GameReview['lossBy'] = { r: {}, b: {} };
  for (const m of moves) {
    const s = stats[m.color];
    s.total++;
    sum[m.color] += m.loss;
    if (m.grade === 'blunder') s.blunders++;
    else if (m.grade === 'mistake') s.mistakes++;
    // 只统计"不佳"以上的失误。好棋和小波动算进去只会把画面搅浑
    if (m.loss >= 80) lossBy[m.color][m.dim] = (lossBy[m.color][m.dim] ?? 0) + m.loss;
    counts[m.color][labelOf(m)]++;
    accs[m.color].push(m.accuracy);
    (phaseList[m.color][m.phase] ??= []).push(m.accuracy);
  }
  const phaseAcc: GameReview['phaseAcc'] = { r: {}, b: {} };
  for (const c of ['r', 'b'] as Color[]) {
    stats[c].avgLoss = stats[c].total ? Math.round(sum[c] / stats[c].total) : 0;
    stats[c].accuracy = gameAccuracy(accs[c]);
    for (const [ph, list] of Object.entries(phaseList[c]) as [Phase, number[]][]) phaseAcc[c][ph] = gameAccuracy(list);
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

  return { moves, turning, worst, stats, lossBy, phaseAcc, counts };
}
