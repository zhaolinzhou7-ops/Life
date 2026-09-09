/**
 * 题库生成器（离线跑，产出 JSON 进仓库）。
 *
 * 象棋 App 最容易烂尾的地方就是题库——手工录几千道题不现实。
 * 这里换个思路：**造局面 + 引擎验证**。局面随便造，但每一道题都必须过引擎的关：
 * 步数准确、初始不将军。验不过的直接丢掉，宁可良率低也不要错题。
 *
 * ⚠️ 原来这里还写着"答案唯一"，而那句话不成立：判唯一只看了 `moves[1]`，
 * 浅层搜索里次佳往往还没搜出杀来，于是"唯一"是假的。全量核对发现 398 道
 * 杀法题里有 16 道同样步数还有别的杀法——学生走出另一手同样快的杀棋会被判错。
 * 现在改成把同样好的着法全收进 `also`，一起算对。
 *
 * 三类题各有各的造法：
 *   杀法  随机摆子（杀棋本来就活在子少的局面里），验"N 回合必杀且首着唯一"
 *   战术  从真实对局里采样局面（随机摆的中局不像人下的），验"最佳比次佳高一大截且赢子"
 *   眼力  同样从对局采样，验"只有极少数着法不亏子"——这正是漏着的反面
 *
 * 难度分不是拍脑袋：用「引擎搜到第几层才找得到这一手」当主指标，
 * 再按合法着法数、是不是安静着法（非吃非将，最难看见）修正。
 *
 * 用法：npx esbuild tools/gen-puzzles.ts --bundle --platform=node --format=esm \
 *         --outfile=/tmp/gen.mjs && node /tmp/gen.mjs > src/xiangqi/puzzles.json
 */
import {
  initialBoard,
  legalMoves,
  applyMove,
  isInCheck,
  statusAfter,
  type Board,
  type Color,
  type Move,
  type PType,
} from '../src/xiangqi/rules';
import { analyze, think } from '../src/xiangqi/ai';
import { steadyAnalyze } from './steady-analyze';
import { toFen, fromFen, moveToText } from '../src/xiangqi/notation';
import { checkBoard } from './validate-positions';
import { rateDifficulty } from './rate-difficulty';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const mkey = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;

export type PuzzleKind = 'mate' | 'tactic' | 'safety' | 'endgame' | 'opening';

export interface Puzzle {
  id: string;
  kind: PuzzleKind;
  /** 局面（标准象棋 FEN，含走子方） */
  fen: string;
  /** 正解首着 */
  answer: string;
  /** 正解主变（中文记谱），用来讲解 */
  line: string[];
  /** 杀法题：几回合成杀 */
  /** 和 answer 一样好的其它着法，判对错时一起算对 */
  also?: string[];
  mateIn?: number;
  /** 难度分，和测评的 Elo 同一把尺子 */
  rating: number;
}

// ---------------- 难度评分 ----------------


// ---------------- 局面来源 ----------------

/** 随机摆子：杀法题用。摆不下返回 null */
/**
 * 受限兵种的全部可落点。直接从这个表里抽，比"随机撒点再拒绝"快一个数量级——
 * 士只有 5 个合法格，随机撒到 90 个格子上命中率只有 5%，绝大部分时间在空转。
 */
function legalSquares(t: PType, c: Color): [number, number][] | null {
  if (t === 'K') {
    const ys = c === 'r' ? [7, 8, 9] : [0, 1, 2];
    const out: [number, number][] = [];
    for (const y of ys) for (const x of [3, 4, 5]) out.push([x, y]);
    return out;
  }
  if (t === 'A') {
    return c === 'r' ? [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]] : [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]];
  }
  if (t === 'E') {
    return c === 'r'
      ? [[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]]
      : [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]];
  }
  return null; // 车马炮兵仍然随机撒点，它们的可落点很多
}

/**
 * 这个子能不能站在这一格——**必须按真正的落点判，不能只判"在不在九宫/本方半场"**。
 *
 * 这里踩过一个大坑：原来士只判了 x∈[3,5] 且 y 在九宫范围内，等于允许士出现在
 * 九宫的 9 个格里。但士只能沿斜线走，一辈子只能落在 **5 个交叉点**上；
 * 象同理只有 7 个象位。结果生成出来的局面里有 45%~80% 摆着"这辈子走不到那儿"
 * 的士象，懂棋的一眼就看出是假局面。
 */
function canStand(t: PType, c: Color, x: number, y: number): boolean {
  const eq = (l: readonly (readonly [number, number])[]) => l.some(([a, b]) => a === x && b === y);
  switch (t) {
    case 'K':
      return x >= 3 && x <= 5 && (c === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
    case 'A':
      // 九宫的五个斜线交叉点
      return eq(c === 'r' ? ([[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]] as const)
                          : ([[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]] as const));
    case 'E':
      // 本方七个象位（象不过河）
      return eq(c === 'r' ? ([[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]] as const)
                          : ([[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]] as const));
    case 'P':
      // 兵不能倒退回自己底线；没过河时只能待在原始的偶数纵线上
      if (c === 'r') return y <= 6 && (y <= 4 || x % 2 === 0);
      return y >= 3 && (y >= 5 || x % 2 === 0);
    default:
      return true; // 车马炮哪儿都能到
  }
}

function randomPosition(atk: PType[], def: PType[], atkColor: Color): Board | null {
  const bd: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const put = (t: PType, c: Color): boolean => {
    // 受限兵种直接从可落点里抽，别用随机撒点碰运气
    const fixed = legalSquares(t, c);
    if (fixed) {
      const free = fixed.filter(([x, y]) => !bd[y][x]);
      if (!free.length) return false;
      const [x, y] = free[(Math.random() * free.length) | 0];
      bd[y][x] = { t, c };
      return true;
    }
    for (let k = 0; k < 90; k++) {
      const y = (Math.random() * 10) | 0;
      const x = (Math.random() * 9) | 0;
      if (bd[y][x]) continue;
      if (!canStand(t, c, x, y)) continue;
      bd[y][x] = { t, c };
      return true;
    }
    return false;
  };
  if (!put('K', 'r') || !put('K', 'b')) return null;
  for (const t of atk) if (!put(t, atkColor)) return null;
  for (const t of def) if (!put(t, other(atkColor))) return null;
  return bd;
}

/** 从一盘"半随机"对局里采样局面：中局题必须像人下出来的，随便摆的不像 */
function* sampleFromGames(): Generator<{ board: Board; color: Color }> {
  for (;;) {
    let b = initialBoard();
    let c: Color = 'r';
    // 采样强度决定题的难度上限：弱引擎+大扰动 → 破绽浅显、题都简单；
    // 强引擎+小扰动 → 剩下的战术才是"要算几层才看得见"的那种。
    // 这是之前整批题偏简单的真正根因，比事后过滤有效得多。
    const depth = SAMPLE_DEPTH + ((Math.random() * 2) | 0);
    const jitter = 40 + Math.random() * SAMPLE_JITTER;
    for (let ply = 0; ply < 60; ply++) {
      if (statusAfter(b, c) !== 'playing') break;
      const legal = legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
      if (!legal.length) break;
      if (ply >= 8) yield { board: b, color: c };
      const m = think(b, c, { maxDepth: depth, timeMs: 300, jitter });
      if (!m) break;
      b = applyMove(b, m);
      c = other(c);
    }
  }
}

// ---------------- 三类题的判定 ----------------

/**
 * 杀法题的判定深度。
 *
 * 原来是 9 层，栽了两次跟头：
 *   · 9 层报出来的"几回合杀"会飘（真正的根子是置换表没给杀棋分做层数换算，
 *     已在 ai.ts 修掉；但即使修完，5/7 层仍然会因为将军延伸报出更远的杀），
 *     实测 9 层起才稳定，这里取 13 层留足余量。
 *   · 判"首着唯一"只看 moves[1]，而浅层的次佳往往还没搜出杀来，
 *     于是"唯一"是假的。现在改成把同样步数的杀法全收进 also 一起算对。
 */
const MATE_DEPTH = Number(process.env.MATE_DEPTH ?? 13);
/** 同样步数的杀法多到这个数以上，这道题就没有"找一手"可言了 */
const MAX_MATE_ALTS = Number(process.env.MAX_MATE_ALTS ?? 4);

/** 杀法题：N 回合必杀；同样快的杀法一并记下来，判对错时都算对 */
function tryMate(b: Board, c: Color, wantMate: number): Puzzle | null {
  if (isInCheck(b, other(c))) return null; // 一上来就将着军的不算题
  const a = analyze(b, c, { maxDepth: MATE_DEPTH, timeMs: 8000, jitter: 0 });
  if (!a.moves.length) return null;
  const top = a.moves[0];
  if (top.mateIn !== wantMate) return null;
  const alts = a.moves.filter((m) => m.mateIn === wantMate).map((m) => moveToText(b, m.move));
  if (alts.length > MAX_MATE_ALTS) return null; // 随便走走都能杀，练不到东西
  const answer = moveToText(b, top.move);
  const also = alts.filter((t) => t !== answer);
  return {
    id: '',
    kind: 'mate',
    fen: toFen(b, c),
    answer,
    ...(also.length ? { also } : {}),
    line: pvToText(b, top.pv, wantMate * 2),
    mateIn: wantMate,
    rating: rateDifficulty(b, c, answer, wantMate),
  };
}

/**
 * 便宜的预筛：绝大多数采样局面都平平无奇，不该为它们付一次 6 层全窗口搜索
 * （约 300~500ms）。先用 3 层粗看一眼「最佳是不是明显甩开次佳」，
 * 甩不开的直接丢，命中的再上 6 层确认。
 */
function promising(b: Board, c: Color, gap: number): boolean {
  const a = analyze(b, c, { maxDepth: PREFILTER_DEPTH, timeMs: 1500, jitter: 0 });
  if (a.moves.length < 6) return false;
  return a.moves[0].score - a.moves[1].score >= gap;
}

/** 只要难题：设 HARD=1 时启用 */
const HARD = process.env.HARD === '1';
/** 采样对局用多强的引擎；越强，采到的战术越隐蔽 */
const SAMPLE_DEPTH = Number(process.env.SAMPLE_DEPTH ?? 2);
const SAMPLE_JITTER = Number(process.env.SAMPLE_JITTER ?? 180);
/** 预筛用几层看。用 3 层等于只要浅层就看得出的题——难题必须提高这个 */
const PREFILTER_DEPTH = Number(process.env.PREFILTER_DEPTH ?? 3);
/** 确认用几层。深层战术要更深才判得准 */
const VERIFY_DEPTH = Number(process.env.VERIFY_DEPTH ?? 6);

/**
 * 难题模式的预筛门槛。
 *
 * 【第一次做错了，记下来】原来 HARD=1 时用的是"2 层搜索里最佳和次佳几乎没差"
 * 这个条件**代替**普通预筛。跑 4 分钟产出 0 道——因为它和后面的判定互相打架：
 * 前面要求"2 层看不出差距"，后面又要求"6 层差距 ≥220"，随机局面里同时满足
 * 这两条的极少，而每个候选都要先付一次 2 层搜索，等于把预算全烧在无用的采样上。
 *
 * 正确的做法是**预筛只管找"有决定性一手"的局面**（便宜），难不难留给最后的
 * 难度分去卡（MIN_RATING）——难度分现在就是"正解在浅层排第几"，
 * 天然就等于"一眼看不看得出来"，不需要再单独判一次。
 * 难题模式只是把预筛门槛放松一点，因为难题的浅层差距本来就小。
 */
const hardGap = (normal: number) => (HARD ? Math.round(normal * 0.55) : normal);
/** 陷阱题的确认深度与"顺手那手要亏多少才算陷阱" */
const TRAP_DEPTH = Number(process.env.TRAP_DEPTH ?? 8);
const TRAP_LOSS = Number(process.env.TRAP_LOSS ?? 200);

/**
 * 难题模式的真正门槛：**正解必须是安静着法**（既不吃子也不将军）。
 *
 * 这是量出来的，不是拍脑袋：加了难度下限之后跑 150 秒，21 个候选全部
 * 落在 680~860 分——因为"6 层里甩开次佳 220 分"基本等同于"能赢子"，
 * 而吃子序列静态搜索(quiescence)在 2 层就算干净了，正解永远排第一，
 * 难度分自然上不去。**"深了才决定性"和"浅了看不见"对吃子战术是矛盾的。**
 *
 * 真正难的题是另一类：正解不吃子也不将军，好处三四步之后才兑现。
 * 浅层没有吃子序列可算，就看不见它；人也一样看不见。所以直接按这个筛。
 */
function quietAnswer(b: Board, c: Color, mv: Move): boolean {
  if (b[mv.ty][mv.tx]) return false; // 吃子
  return !isInCheck(applyMove(b, mv), other(c)); // 将军
}

/**
 * 各道关卡各拦下多少——DEBUG=1 时打印。
 *
 * 加这个是因为"产出 0 道"这种结果光看是猜不出原因的：可能是采样太慢、
 * 可能是某一道判定过严、也可能是难度分卡在最后。上一次我就凭感觉改了
 * 预筛，改完还是 0，白烧了 8 分钟。有数就不用猜。
 */
const stat: Record<string, number> = {};
const bump = (k: string) => { stat[k] = (stat[k] ?? 0) + 1; };

/**
 * 难题的正确定义：**看起来最顺手的那一手是错的**。
 *
 * 前两次都失败了，失败的原因值得写下来：
 *   一试 "2 层看不出差距" 当预筛 —— 跑 4 分钟 0 产出，因为它和"6 层甩开
 *        次佳 220 分"互相矛盾，随机局面几乎不可能同时满足。
 *   二试 "正解必须是安静着法" —— 有产出了，但只有 860~870 分，
 *        因为安静的好棋 2 层照样能排第一，难度分上不去。
 *
 * 两次都错在同一个地方：**我在用"引擎看不看得见"定义难，而不是用
 * "人会不会走错"定义难。** 真正让人栽跟头的局面是——有一手特别顺眼
 * （浅算就排第一、通常还是吃子或将军），而它恰恰是错的，正解在别处。
 *
 * 所以判定改成：浅层首选 ≠ 深层首选，且**照浅层那手走会亏一大截**。
 * 顺带白得一个 blunder 字段：那手顺眼的错棋本身就是最好的干扰项，
 * 做题界面会把它演给你看。
 */
function tryTrap(b: Board, c: Color, kind: 'tactic' | 'safety' | 'endgame' | 'opening'): Puzzle | null {
  bump(`${kind}:看过`);
  if (isInCheck(b, c)) return bump(`${kind}:自己被将`), null;
  // 1. 顺手的那一手：浅算的首选
  const shallow = analyze(b, c, { maxDepth: 2, timeMs: 800, jitter: 0 });
  if (shallow.moves.length < 12) return bump(`${kind}:着法太少`), null;
  const obvious = shallow.moves[0].move;
  // 2. 中等深度先看一眼值不值得深查
  const mid = analyze(b, c, { maxDepth: 5, timeMs: 2500, jitter: 0 });
  const midTop = mid.moves[0];
  if (mkey(midTop.move) === mkey(obvious)) return bump(`${kind}:顺手的就是对的`), null;
  const midObv = mid.moves.find((m) => mkey(m.move) === mkey(obvious));
  if (!midObv || midTop.score - midObv.score < 150) return bump(`${kind}:顺手那手亏得不够多`), null;
  // 3. 深查确认。必须真的搜到 TRAP_DEPTH 层——时限截断的结果会随机器忙不忙
  // 而变，那样生成出来的题就不可复现了（残局和杀法题都在这上面栽过）
  const a = steadyAnalyze(b, c, TRAP_DEPTH, 6000);
  if (!a.full) return bump(`${kind}:搜不到判定深度`), null;
  const top = a.moves[0];
  if (top.mateIn !== undefined) return bump(`${kind}:是杀法题`), null;
  if (mkey(top.move) === mkey(obvious)) return bump(`${kind}:深查后顺手的又对了`), null;
  const obv = a.moves.find((m) => mkey(m.move) === mkey(obvious));
  if (!obv || top.score - obv.score < TRAP_LOSS) return bump(`${kind}:顺手那手亏得不够多(深)`), null;
  const second = a.moves[1];
  if (second && top.score - second.score < 120) return bump(`${kind}:正解不唯一`), null;
  if (top.pv.length < 2) return bump(`${kind}:主变太短`), null;
  bump(`${kind}:成题`);
  const ties = a.moves.filter((m) => top.score - m.score <= 25).map((m) => moveToText(b, m.move));
  const answer = moveToText(b, top.move);
  return {
    id: '',
    kind,
    fen: toFen(b, c),
    answer,
    ...(ties.length > 1 ? { also: ties.filter((t) => t !== answer) } : {}),
    line: pvToText(b, top.pv, 6),
    blunder: moveToText(b, obvious),
    rating: rateDifficulty(b, c, answer, undefined, top.score - obv.score),
  };
}

/** 战术题：能赢子，而且只有这一手能赢，次佳差一大截 */
function tryTactic(b: Board, c: Color): Puzzle | null {
  bump('tactic:看过');
  if (isInCheck(b, c)) return bump('tactic:自己被将'), null; // 那是"应将"不是战术题
  if (!promising(b, c, hardGap(150))) return bump('tactic:预筛没过'), null;
  const a = analyze(b, c, { maxDepth: 6, timeMs: 5000, jitter: 0 });
  if (a.moves.length < 6) return bump('tactic:着法太少'), null;
  const top = a.moves[0];
  const second = a.moves[1];
  if (top.mateIn !== undefined) return bump('tactic:是杀法题'), null;
  if (top.score < 250) return bump('tactic:走完不够优'), null;
  if (top.score - second.score < 220) return bump('tactic:次佳太接近'), null;
  if (Math.abs(second.score) > 900) return bump('tactic:局面已一边倒'), null;
  if (top.pv.length < 2) return bump('tactic:主变太短'), null;
  if (HARD && !quietAnswer(b, c, top.move)) return bump('tactic:吃子/将军，不够难'), null;
  bump('tactic:成题');
  return {
    id: '',
    kind: 'tactic',
    fen: toFen(b, c),
    answer: moveToText(b, top.move),
    line: pvToText(b, top.pv, 6),
    rating: rateDifficulty(b, c, moveToText(b, top.move)),
  };
}

/** 眼力题：绝大多数着法都要亏子，只有一两手安全——正是"漏着"的反面 */
function trySafety(b: Board, c: Color): Puzzle | null {
  if (!promising(b, c, hardGap(200))) return null;
  const a = analyze(b, c, { maxDepth: VERIFY_DEPTH, timeMs: 6000, jitter: 0 });
  if (a.moves.length < 8) return null;
  const top = a.moves[0];
  if (top.mateIn !== undefined) return null;
  if (top.score < -120 || top.score > 260) return null; // 走对了应该是"守住了"，不是大占优
  const second = a.moves[1];
  if (top.score - second.score < 300) return null; // 必须只有这一手能守住
  // 而且大部分着法确实是坏的，否则算不上"眼力"
  const bad = a.moves.filter((m) => top.score - m.score >= 300).length;
  if (bad < a.moves.length * 0.7) return null;
  return {
    id: '',
    kind: 'safety',
    fen: toFen(b, c),
    answer: moveToText(b, top.move),
    line: pvToText(b, top.pv, 4),
    rating: rateDifficulty(b, c, moveToText(b, top.move)),
  };
}

/**
 * 残局题：用真实残局会出现的子力配置摆局面，验"只有一手能保住结果"。
 *
 * 没有手打经典残局的 FEN——凭记忆敲局面很容易敲错，错题比没题更糟。
 * 改成同一套「造局面 + 引擎验证」的路子，正确性由引擎担保。
 */
function tryEndgame(b: Board, c: Color): Puzzle | null {
  if (isInCheck(b, other(c))) return null;
  const a = analyze(b, c, { maxDepth: 8, timeMs: 6000, jitter: 0 });
  if (a.moves.length < 5) return null;
  const top = a.moves[0];
  const second = a.moves[1];
  if (top.mateIn !== undefined && Math.abs(top.mateIn) <= 2) return null; // 那是杀法题
  if (top.score - second.score < 260) return null; // 必须只有这一手对
  if (top.pv.length < 3) return null;
  return {
    id: '',
    kind: 'endgame',
    fen: toFen(b, c),
    answer: moveToText(b, top.move),
    line: pvToText(b, top.pv, 6),
    rating: rateDifficulty(b, c, moveToText(b, top.move)),
  };
}

/**
 * 开局阶段题：前二十来手里"这一手明显该走"的局面。
 *
 * 说明白一点：这测的是**开局阶段不吃亏的判断力**，不是定式背诵。
 * 真正的定式讲的是计划和思路，那要人写讲解，不是引擎能生成的，留到课程里做。
 */
function tryOpening(b: Board, c: Color): Puzzle | null {
  if (isInCheck(b, c)) return null;
  if (!promising(b, c, hardGap(120))) return null;
  const a = analyze(b, c, { maxDepth: 6, timeMs: 5000, jitter: 0 });
  if (a.moves.length < 20) return null; // 开局着法多，少了说明不是开局
  const top = a.moves[0];
  const second = a.moves[1];
  if (top.mateIn !== undefined) return null;
  if (Math.abs(top.score) > 400) return null; // 开局讲的是细微优势，一边倒的不算
  if (top.score - second.score < 170) return null;
  if (top.pv.length < 2) return null;
  return {
    id: '',
    kind: 'opening',
    fen: toFen(b, c),
    answer: moveToText(b, top.move),
    line: pvToText(b, top.pv, 6),
    rating: rateDifficulty(b, c, moveToText(b, top.move)),
  };
}

function pvToText(b: Board, pv: Move[], max: number): string[] {
  const out: string[] = [];
  let cur = b;
  for (const m of pv.slice(0, max)) {
    out.push(moveToText(cur, m));
    cur = applyMove(cur, m);
  }
  return out;
}

// ---------------- 主流程 ----------------

const TARGET = {
  mate1: Number(process.env.N_MATE1 ?? 160),
  mate2: Number(process.env.N_MATE2 ?? 140),
  mate3: Number(process.env.N_MATE3 ?? 70),
  mate4: Number(process.env.N_MATE4 ?? 0),
  tactic: Number(process.env.N_TACTIC ?? 200),
  safety: Number(process.env.N_SAFETY ?? 120),
  endgame: Number(process.env.N_ENDGAME ?? 0),
  opening: Number(process.env.N_OPENING ?? 0),
};

/** 残局子力配置：都是实战里真会出现的组合 */
const ENDGAME_SETS: [PType[], PType[]][] = [
  [['R'], ['A', 'A', 'E', 'E']],
  [['R'], ['H', 'A', 'A']],
  [['R', 'P'], ['R', 'A', 'A']],
  [['H', 'C'], ['A', 'A', 'E']],
  [['R'], ['C', 'A', 'A']],
  [['H', 'P'], ['A', 'A']],
  [['C', 'P', 'P'], ['A', 'A', 'E']],
  [['R', 'H'], ['R', 'A', 'A', 'E']],
  [['P', 'P'], ['A', 'A']],
  [['R', 'C'], ['R', 'A', 'A', 'E']],
  [['H', 'H'], ['A', 'A', 'E']],
  [['R', 'A', 'A'], ['C', 'C', 'A', 'A']],
];
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 240000);

/** 杀法题的兵种组合：攻方带什么、守方带什么 */
const MATE_SETS: [PType[], PType[]][] = [
  // 士象摆到真正的落点之后，防线是**真的管用**的，成杀率比之前低很多。
  // 所以要配一批守方子力更少的组合——实战里的杀棋也大多发生在
  // 对方士象已经被消耗掉的时候，这样反而更贴近真实。
  [['R'], []],
  [['R', 'C'], []],
  [['R', 'H'], []],
  [['C', 'C'], []],
  [['H', 'C'], []],
  [['R'], ['A']],
  [['R', 'C'], ['A']],
  [['R', 'H'], ['A']],
  [['C', 'C'], ['A']],
  [['H', 'C'], ['A']],
  [['R', 'P'], ['A']],
  [['C', 'P'], ['A']],
  [['H', 'H'], ['A']],
  [['R'], ['A', 'A']],
  [['R', 'C'], ['A', 'A']],
  [['R', 'H'], ['A', 'A']],
  [['C', 'C'], ['A', 'A']],
  [['R', 'P'], ['A', 'A']],
  // 守方带得多的留一部分：这类杀法最难一眼看穿，是难题的来源
  [['R', 'C'], ['A', 'A', 'E']],
  [['R', 'C', 'H'], ['A', 'A', 'E']],
  [['R', 'C', 'H'], ['A', 'A', 'E', 'E']],
  [['R', 'R', 'C'], ['A', 'A', 'E', 'E', 'H']],
];

const out: Puzzle[] = [];
const seen = new Set<string>();
const MIN_RATING = Number(process.env.MIN_RATING ?? 0);
let rejected = 0;
const push = (p: Puzzle | null) => {
  if (!p || seen.has(p.fen)) return false;
  if (p.rating < MIN_RATING) {
    bump(`${p.kind}:难度不够(${p.rating})`);
    return false;
  }
  // 闸门：局面必须是真实对局里能出现的（士象兵的落点、子力数量）
  const parsed = fromFen(p.fen);
  const errs = parsed ? checkBoard(parsed.board) : ['FEN 解析失败'];
  if (errs.length) {
    rejected++;
    return false;
  }
  seen.add(p.fen);
  p.id = `${p.kind}${p.mateIn ?? ''}-${out.length.toString(36)}`;
  out.push(p);
  return true;
};

const t0 = Date.now();
const left = () => BUDGET_MS - (Date.now() - t0);

// —— 杀法 ——
const mateCounts = [TARGET.mate1, TARGET.mate2, TARGET.mate3, TARGET.mate4];
for (let wantMate = 1; wantMate <= 4; wantMate++) {
  const want = mateCounts[wantMate - 1];
  let got = 0;
  while (got < want && left() > 0) {
    const [atk, def] = MATE_SETS[(Math.random() * MATE_SETS.length) | 0];
    const b = randomPosition(atk, def, 'r');
    if (!b) continue;
    if (statusAfter(b, 'r') !== 'playing' || statusAfter(b, 'b') !== 'playing') continue;
    if (push(tryMate(b, 'r', wantMate))) got++;
  }
  process.stderr.write(`${wantMate * 2 - 1} 步杀: ${got}/${want}  (剩余预算 ${Math.round(left() / 1000)}s)\n`);
}

// —— 战术 / 眼力：从对局采样 ——
let tac = 0;
let saf = 0;
for (const { board, color } of sampleFromGames()) {
  if (left() <= 0 || (tac >= TARGET.tactic && saf >= TARGET.safety)) break;
  if (tac < TARGET.tactic && push(HARD ? tryTrap(board, color, 'tactic') : tryTactic(board, color))) tac++;
  else if (saf < TARGET.safety && push(HARD ? tryTrap(board, color, 'safety') : trySafety(board, color))) saf++;
}
process.stderr.write(`战术: ${tac}/${TARGET.tactic}  眼力: ${saf}/${TARGET.safety}\n`);

// —— 残局：造典型子力配置 ——
if (TARGET.endgame > 0) {
  let got = 0;
  while (got < TARGET.endgame && left() > 0) {
    const [atk, def] = ENDGAME_SETS[(Math.random() * ENDGAME_SETS.length) | 0];
    const b = randomPosition(atk, def, Math.random() < 0.5 ? 'r' : 'b');
    if (!b) continue;
    const c: Color = Math.random() < 0.5 ? 'r' : 'b';
    if (statusAfter(b, 'r') !== 'playing' || statusAfter(b, 'b') !== 'playing') continue;
    if (push(HARD ? tryTrap(b, c, 'endgame') : tryEndgame(b, c))) got++;
  }
  process.stderr.write(`残局: ${got}/${TARGET.endgame}\n`);
}

// —— 开局阶段：只取前二十来手 ——
if (TARGET.opening > 0) {
  let got = 0;
  for (const { board, color } of sampleFromGames()) {
    if (left() <= 0 || got >= TARGET.opening) break;
    if (push(HARD ? tryTrap(board, color, 'opening') : tryOpening(board, color))) got++;
  }
  process.stderr.write(`开局: ${got}/${TARGET.opening}\n`);
}

if (rejected) process.stderr.write(`\n⚠️ 校验拦下 ${rejected} 个非法摆位的局面\n`);
if (process.env.DEBUG) {
  process.stderr.write('\n各道关卡拦下的数量：\n');
  for (const k of Object.keys(stat).sort()) process.stderr.write(`  ${k.padEnd(26)} ${stat[k]}\n`);
}
out.sort((a, b) => a.rating - b.rating);
process.stderr.write(
  `\n合计 ${out.length} 题，难度 ${out[0]?.rating}~${out[out.length - 1]?.rating}，` +
    `耗时 ${Math.round((Date.now() - t0) / 1000)}s\n`,
);
process.stdout.write(JSON.stringify(out));
