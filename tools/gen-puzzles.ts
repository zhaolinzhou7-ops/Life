/**
 * 题库生成器（离线跑，产出 JSON 进仓库）。
 *
 * 象棋 App 最容易烂尾的地方就是题库——手工录几千道题不现实。
 * 这里换个思路：**造局面 + 引擎验证**。局面随便造，但每一道题都必须过引擎的关：
 * 答案唯一、步数准确、初始不将军。验不过的直接丢掉，宁可良率低也不要错题。
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
import { toFen, moveToText } from '../src/xiangqi/notation';

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
  mateIn?: number;
  /** 难度分，和测评的 Elo 同一把尺子 */
  rating: number;
}

// ---------------- 难度评分 ----------------

/**
 * 难度 = 引擎搜到第几层才认出这一手（主指标）+ 选择面宽度 + 是不是安静着法。
 * 一层就能看出来的吃子题，和要算五层的弃子引离，不该是同一个难度。
 */
function rateDifficulty(b: Board, c: Color, answer: Move, legalCount: number): number {
  // 最浅需要几层
  let need = 10;
  for (let d = 1; d <= 9; d++) {
    const m = think(b, c, { maxDepth: d, timeMs: 4000, jitter: 0 });
    if (m && mkey(m) === mkey(answer)) {
      need = d;
      break;
    }
  }
  const isCapture = !!b[answer.ty][answer.tx];
  const after = applyMove(b, answer);
  const isCheck = isInCheck(after, other(c));
  // 既不吃子又不将军的"安静着法"最难被看见
  const quiet = !isCapture && !isCheck;

  let r = 620 + (need - 1) * 115;
  r += Math.max(0, legalCount - 18) * 7;
  if (quiet) r += 120;
  else if (!isCapture) r += 40; // 只将军不吃子，比白吃子难一点
  return Math.round(Math.max(600, Math.min(2200, r)));
}

// ---------------- 局面来源 ----------------

/** 随机摆子：杀法题用。摆不下返回 null */
function randomPosition(atk: PType[], def: PType[], atkColor: Color): Board | null {
  const bd: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const put = (t: PType, c: Color): boolean => {
    for (let k = 0; k < 80; k++) {
      const y = (Math.random() * 10) | 0;
      const x = (Math.random() * 9) | 0;
      if (bd[y][x]) continue;
      const inPalace = x >= 3 && x <= 5 && (c === 'r' ? y >= 7 : y <= 2);
      if ((t === 'K' || t === 'A') && !inPalace) continue;
      if (t === 'E' && (c === 'r' ? y < 5 : y > 4)) continue; // 象不过河
      if (t === 'P' && (c === 'r' ? y > 6 : y < 3)) continue; // 兵不能倒退回底线区
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
    const depth = 2 + ((Math.random() * 2) | 0);
    const jitter = 40 + Math.random() * 180; // 有扰动才会出现真实的破绽
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

/** 七步杀要看到 7 层才判得出来，深度必须跟上 */
const MATE_DEPTH = Number(process.env.MATE_DEPTH ?? 9);

/** 杀法题：N 回合必杀，且只有一个首着能成杀 */
function tryMate(b: Board, c: Color, wantMate: number): Puzzle | null {
  if (isInCheck(b, other(c))) return null; // 一上来就将着军的不算题
  const a = analyze(b, c, { maxDepth: MATE_DEPTH, timeMs: 5000, jitter: 0 });
  if (!a.moves.length) return null;
  const top = a.moves[0];
  if (top.mateIn !== wantMate) return null;
  // 首着唯一：次佳不能也是同样快的杀
  const second = a.moves[1];
  if (second && second.mateIn !== undefined && second.mateIn > 0 && second.mateIn <= wantMate) return null;
  return {
    id: '',
    kind: 'mate',
    fen: toFen(b, c),
    answer: moveToText(b, top.move),
    line: pvToText(b, top.pv, wantMate * 2),
    mateIn: wantMate,
    rating: rateDifficulty(b, c, top.move, a.moves.length),
  };
}

/**
 * 便宜的预筛：绝大多数采样局面都平平无奇，不该为它们付一次 6 层全窗口搜索
 * （约 300~500ms）。先用 3 层粗看一眼「最佳是不是明显甩开次佳」，
 * 甩不开的直接丢，命中的再上 6 层确认。
 */
function promising(b: Board, c: Color, gap: number): boolean {
  const a = analyze(b, c, { maxDepth: 3, timeMs: 900, jitter: 0 });
  if (a.moves.length < 6) return false;
  return a.moves[0].score - a.moves[1].score >= gap;
}

/** 只要难题：设 HARD=1 时启用 */
const HARD = process.env.HARD === '1';

/**
 * 难题预筛：**浅看看不出来**（2 层时最佳与次佳几乎没差），才有资格当难题。
 *
 * 这是之前题库全是简单题的根因——原来的预筛要求 3 层就能看出差距，
 * 等于在专挑一眼就能看穿的局面。难度的本质是"浅算发现不了"。
 */
function deepOnly(b: Board, c: Color): boolean {
  const shallow = analyze(b, c, { maxDepth: 2, timeMs: 700, jitter: 0 });
  if (shallow.moves.length < 8) return false;
  return shallow.moves[0].score - shallow.moves[1].score < Number(process.env.HARD_GAP ?? 90);
}

/** 战术题：能赢子，而且只有这一手能赢，次佳差一大截 */
function tryTactic(b: Board, c: Color): Puzzle | null {
  if (isInCheck(b, c)) return null; // 自己正被将，那是"应将"不是战术题
  if (HARD ? !deepOnly(b, c) : !promising(b, c, 150)) return null;
  const a = analyze(b, c, { maxDepth: 6, timeMs: 5000, jitter: 0 });
  if (a.moves.length < 6) return null;
  const top = a.moves[0];
  const second = a.moves[1];
  if (top.mateIn !== undefined) return null; // 那是杀法题
  if (top.score < 250) return null; // 走完得真的占优
  if (top.score - second.score < 220) return null; // 次佳太接近 -> 答案不唯一
  if (Math.abs(second.score) > 900) return null; // 局面本来就一边倒，做这种题学不到东西
  if (top.pv.length < 2) return null; // 讲解至少要能演一个回合
  return {
    id: '',
    kind: 'tactic',
    fen: toFen(b, c),
    answer: moveToText(b, top.move),
    line: pvToText(b, top.pv, 6),
    rating: rateDifficulty(b, c, top.move, a.moves.length),
  };
}

/** 眼力题：绝大多数着法都要亏子，只有一两手安全——正是"漏着"的反面 */
function trySafety(b: Board, c: Color): Puzzle | null {
  if (HARD ? !deepOnly(b, c) : !promising(b, c, 200)) return null;
  const a = analyze(b, c, { maxDepth: 6, timeMs: 5000, jitter: 0 });
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
    rating: rateDifficulty(b, c, top.move, a.moves.length),
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
    rating: rateDifficulty(b, c, top.move, a.moves.length),
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
  if (HARD ? !deepOnly(b, c) : !promising(b, c, 120)) return null;
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
    rating: rateDifficulty(b, c, top.move, a.moves.length),
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
  [['R'], ['A', 'A']],
  [['R', 'C'], ['A', 'A', 'E']],
  [['R', 'H'], ['A', 'A', 'E']],
  [['C', 'C'], ['A', 'A']],
  [['H', 'C'], ['A', 'A']],
  [['R', 'P'], ['A', 'A', 'E']],
  [['R', 'C', 'H'], ['A', 'A', 'E', 'E']],
  [['H', 'H'], ['A', 'A']],
  [['R', 'R'], ['A', 'A', 'E', 'H']],
  [['C', 'P'], ['A', 'A']],
  // 守方子力越多，杀法越难被一眼看穿——这是把题库难度上限抬起来最有效的办法
  [['R', 'C', 'H'], ['A', 'A', 'E', 'E', 'H']],
  [['R', 'C', 'P'], ['A', 'A', 'E', 'E', 'C']],
  [['R', 'H', 'H'], ['A', 'A', 'E', 'E', 'R']],
  [['R', 'C', 'C'], ['A', 'A', 'E', 'E', 'H', 'P']],
  [['R', 'R', 'C'], ['A', 'A', 'E', 'E', 'R', 'H']],
];

const out: Puzzle[] = [];
const seen = new Set<string>();
const MIN_RATING = Number(process.env.MIN_RATING ?? 0);
const push = (p: Puzzle | null) => {
  if (!p || seen.has(p.fen)) return false;
  if (p.rating < MIN_RATING) return false;
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
  if (tac < TARGET.tactic && push(tryTactic(board, color))) tac++;
  else if (saf < TARGET.safety && push(trySafety(board, color))) saf++;
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
    if (push(tryEndgame(b, c))) got++;
  }
  process.stderr.write(`残局: ${got}/${TARGET.endgame}\n`);
}

// —— 开局阶段：只取前二十来手 ——
if (TARGET.opening > 0) {
  let got = 0;
  for (const { board, color } of sampleFromGames()) {
    if (left() <= 0 || got >= TARGET.opening) break;
    if (push(tryOpening(board, color))) got++;
  }
  process.stderr.write(`开局: ${got}/${TARGET.opening}\n`);
}

out.sort((a, b) => a.rating - b.rating);
process.stderr.write(
  `\n合计 ${out.length} 题，难度 ${out[0]?.rating}~${out[out.length - 1]?.rating}，` +
    `耗时 ${Math.round((Date.now() - t0) / 1000)}s\n`,
);
process.stdout.write(JSON.stringify(out));
