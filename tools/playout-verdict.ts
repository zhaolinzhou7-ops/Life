/**
 * 残局胜和判定的**唯一**实现。
 *
 * 【为什么单独拆一个文件】这件事我犯了三次同样的错：
 *   一次 体检拿 14 层的静态分去审生成器用实战下出来的结论
 *   二次 体检只下一遍 12 层，而生成器跑的是 12/13/14 三个深度
 *   三次 生成器加了"强方不许原地打转"，体检没加
 * 每次都是**拿一个更弱的方法去审更强方法定下来的结论**，然后把好数据报成错。
 *
 * 根子在于判定逻辑被抄了两份，改一边另一边不知道。所以现在只留这一份，
 * 生成器和体检都 import 它——**检查者和生产者用的是同一段代码**，
 * 不可能再对不上。
 */
import { legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { toFen } from '../src/xiangqi/notation';
import { think, analyze, resetEngine } from '../src/xiangqi/ai';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

export interface Outcome {
  result: 'red-win' | 'black-win' | 'draw';
  plies: number;
  reason: string;
}

/** App 里 60 回合无吃子判和，走不进这个长度的"胜"在软件里本来也兑现不了 */
export const MAX_PLIES = 120;
/**
 * 时限一定要给足，让**层数**成为约束而不是墙上时钟。
 * 同一批局面，机器忙时判出 0 胜 4 和，空闲时是 3 胜 1 和——搜索按 timeMs
 * 截断，CPU 被抢就搜不到指定层数。胜和判定不能随机器忙不忙而变。
 */
/**
 * 判定深度**按盘上剩多少子来定**。
 *
 * 这是量出来的，不是拍脑袋：单马对单士（盘上就四个子）在 12/14 层跑出来
 * 四个全是和，而 16 层以上四个里三个变成胜（109 步、31 步、103 步）。
 * 棋书上它是例胜——**标错的原因是深度不够，不是这局真的和**。
 *
 * 为什么浅层会看不出来：这类局面马要一格一格把将的落点掐掉、帅还要上来配合，
 * 整个过程几十步，而每一步的静态分几乎不动，十几层的视野里"怎么走都一样"。
 * 而子少的时候搜索又特别便宜，没有任何理由卡在 14 层。
 */
export function depthsFor(b: Board): number[] {
  let n = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') n++;
  // 只对**真正子少**的局面加深。第一版把 5~7 个子的也抬到 14/16/18，
  // 结果重验 61 个局面跑了 22 分钟还没过半——那一档搜索是秒级的，
  // 乘上 120 步再乘三个深度直接爆掉。四个子以内是毫秒级，加深不花什么钱，
  // 而实测需要加深的正是这一档（单马对单士）。
  //
  // 实测单个局面判一次的代价（供以后调参时参照，别再凭感觉抬深度）：
  //   单马对单士  2 子  16/18/20 层   1.5s
  //   单车对双士  3 子  16/18/20 层  12.6s
  //   马兵对双士  4 子  16/18/20 层   1.1s
  //   车炮对士象全 6 子  12/13/14 层  36.9s   ← 最贵的一档
  //   士象全守车炮 6 子  12/13/14 层   3.1s
  if (n <= 4) return [16, 18, 20];
  return [12, 13, 14];
}
export const TIME_FOR = (d: number) => (d >= 18 ? 15000 : d >= 16 ? 10000 : d >= 14 ? 8000 : 3000);

/** 盘面子力差（红减黑，不含将帅），用来判断谁是强方 */
function edge(b: Board): number {
  const V: Record<string, number> = { A: 220, E: 220, H: 450, R: 1000, C: 500, P: 100 };
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') s += (p.c === 'r' ? 1 : -1) * (V[p.t] ?? 0);
  return s;
}

/**
 * 引擎双方下到底，判定规则和 App 里一致（将死、60 回合无吃子、三次重复）。
 *
 * 关键的一条：**子力占优的一方不许原地打转**。第一版量出来的 50 个"和棋"
 * 全部是三次重复判的、平均只走了 17 步——那不是技术不够，是引擎在这类局面里
 * 没有"进展"的概念，两边来回晃八九个回合就三次重复了。真人强方不会那么走。
 * 所以强方的最佳着法如果会走回已经出现过的局面，就在分差不大的前提下换下一手。
 */
export function playOut(board: Board, toMove: Color, depth: number, timeMs: number, maxPlies = MAX_PLIES): Outcome {
  let b = board;
  let c = toMove;
  let sinceCapture = 0;
  const seen = new Map<string, number>();
  for (let ply = 0; ply < maxPlies; ply++) {
    const st = statusAfter(b, c);
    if (st !== 'playing') return { result: st, plies: ply, reason: '将死/困毙' };
    if (!legalOf(b, c).length) return { result: c === 'r' ? 'black-win' : 'red-win', plies: ply, reason: '无着可走' };
    let m = think(b, c, { maxDepth: depth, timeMs, jitter: 0 });
    if (!m) return { result: 'draw', plies: ply, reason: '引擎无着' };
    const strongSide = edge(b) > 150 ? 'r' : edge(b) < -150 ? 'b' : null;
    if (c === strongSide && (seen.get(toFen(applyMove(b, m), other(c))) ?? 0) >= 1) {
      const a = analyze(b, c, { maxDepth: depth, timeMs, jitter: 0 });
      const top = a.moves[0];
      const alt = a.moves.find(
        (x) => top.score - x.score < 120 && (seen.get(toFen(applyMove(b, x.move), other(c))) ?? 0) === 0,
      );
      if (alt) m = alt.move;
    }
    const cap = !!b[m.ty][m.tx];
    b = applyMove(b, m);
    c = other(c);
    sinceCapture = cap ? 0 : sinceCapture + 1;
    if (sinceCapture >= 120) return { result: 'draw', plies: ply + 1, reason: '60 回合无吃子' };
    const key = toFen(b, c);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return { result: 'draw', plies: ply + 1, reason: '三次重复' };
  }
  return { result: 'draw', plies: maxPlies, reason: '未分胜负' };
}

/**
 * 定这一局是胜是和。
 *
 * 三条规矩，每一条都是踩出来的：
 *   1. **先清空引擎的记忆**。搜索结果依赖置换表里残留的东西，同一个局面在
 *      不同调用历史下会走出不同路线、得出不同结论。清空之后结论只由局面决定。
 *   2. **「引擎没赢下来」不等于「这局赢不了」**，所以要换更强的一档再试。
 *   3. **一次下出来的结果不算数**：三个深度下出同一个结果才收，不一致说明
 *      这个局面就在胜和边界上，没有稳定答案，不该拿去当教材。
 *      深度按盘上剩多少子定，见 depthsFor()。
 */
export function verdict(b: Board, you: Color): {
  target: 'win' | 'draw' | 'loss' | 'unstable';
  plies: number;
  reason: string;
} {
  resetEngine();
  const runs = depthsFor(b).map((d) => playOut(b, you, d, TIME_FOR(d)));
  const mine = you === 'r' ? 'red-win' : 'black-win';
  const wins = runs.filter((r) => r.result === mine);
  const losses = runs.filter((r) => r.result !== 'draw' && r.result !== mine);
  if (losses.length) return { target: 'loss', plies: losses[0].plies, reason: losses[0].reason };
  if (wins.length === runs.length) return { target: 'win', plies: wins[0].plies, reason: wins[0].reason };
  if (wins.length) return { target: 'unstable', plies: wins[0].plies, reason: '有的深度赢得下来有的赢不下来' };
  const last = runs[runs.length - 1];
  return { target: 'draw', plies: last.plies, reason: last.reason };
}
