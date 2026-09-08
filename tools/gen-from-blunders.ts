/**
 * 从「真的有人走错了」的地方出题。
 *
 * 【为什么换这个思路】
 * 原来的眼力题是随机摆局面 + 判定「只有一手不亏子」。问题在于这类局面
 * 本身就偏显眼——补了 81 道，78 道还是简单题，跑更久也没用。
 *
 * 真正的谜题库（Lichess 那种）都不是这么造的，而是**从真实对局里
 * 有人走错的那一步提取**。这里照做：让引擎自己下棋（一方削弱、带扰动，
 * 模拟真人会犯的错），逐手用 judgeMove 打分，凡是走出失误/漏着的那个局面
 * 就是一道好题——因为「确实有人在这里选错了」本身就是难度的最好证据。
 *
 * 比「引擎要搜几层」强在哪：后者衡量的是机器的难度，前者衡量的是
 * **错误选项看起来有多合理**，那才是人做题时真正的障碍。
 *
 * 用法：npx esbuild tools/gen-from-blunders.ts --bundle --platform=node \
 *         --format=esm --outfile=/tmp/gb.mjs && node /tmp/gb.mjs > out.json
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
} from '../src/xiangqi/rules';
import { analyze, judgeMove, think } from '../src/xiangqi/ai';
import { toFen, moveToText } from '../src/xiangqi/notation';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const mk = (m: Move) => `${m.fx},${m.fy},${m.tx},${m.ty}`;

interface Out {
  id: string;
  kind: 'safety' | 'tactic';
  fen: string;
  answer: string;
  line: string[];
  rating: number;
  /** 当时那位"棋手"实际走的错着，用来做讲解 */
  blunder: string;
}

const BUDGET_MS = Number(process.env.BUDGET_MS ?? 400000);
/** 失误多大才值得出题（单位：兵=100） */
const MIN_LOSS = Number(process.env.MIN_LOSS ?? 280);
/** 最佳着必须比次佳好这么多，保证答案唯一 */
const MIN_GAP = Number(process.env.MIN_GAP ?? 200);
const VERIFY_DEPTH = Number(process.env.VERIFY_DEPTH ?? 7);
const TARGET = Number(process.env.TARGET ?? 200);

/** 正解在浅层搜索里排第几——和 rerate-puzzles.ts 同一把尺子 */
function rankAt(b: Board, c: Color, sol: Move, depth: number): { rank: number; n: number } {
  const a = analyze(b, c, { maxDepth: depth, timeMs: 3000, jitter: 0 });
  for (let i = 0; i < a.moves.length; i++) if (mk(a.moves[i].move) === mk(sol)) return { rank: i + 1, n: a.moves.length };
  return { rank: 99, n: a.moves.length };
}

function rate(b: Board, c: Color, sol: Move, blunderRank: number): number {
  const s = rankAt(b, c, sol, 2);
  const m = rankAt(b, c, sol, 5);
  const isCap = !!b[sol.ty][sol.tx];
  const isChk = isInCheck(applyMove(b, sol), other(c));
  const quiet = !isCap && !isChk;
  let r = 620;
  r += Math.min(9, s.rank - 1) * 78;
  r += Math.min(5, m.rank - 1) * 85;
  if (quiet) r += 110;
  else if (!isCap) r += 40;
  r += Math.max(0, s.n - 18) * 5;
  // 错着排得越靠前，说明它看起来越"像好棋"，题就越难
  if (blunderRank <= 3) r += 120;
  else if (blunderRank <= 8) r += 60;
  return Math.round(Math.max(600, Math.min(2200, r)));
}

const out: Out[] = [];
const seen = new Set<string>();
const t0 = Date.now();
let games = 0;
let scanned = 0;

while (out.length < TARGET && Date.now() - t0 < BUDGET_MS) {
  games++;
  let b: Board = initialBoard();
  let c: Color = 'r';
  // 两边都用中等强度 + 扰动：这样犯的错像人犯的，而不是随机乱走
  const dep = 3 + ((Math.random() * 2) | 0);
  const jit = 60 + Math.random() * 120;

  for (let ply = 0; ply < 70 && Date.now() - t0 < BUDGET_MS; ply++) {
    if (statusAfter(b, c) !== 'playing') break;
    const legal = legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
    if (!legal.length) break;

    const played = think(b, c, { maxDepth: dep, timeMs: 250, jitter: jit });
    if (!played) break;

    // 前几手是布局，谈不上"漏着"，跳过
    if (ply >= 10) {
      scanned++;
      const j = judgeMove(b, c, played, { maxDepth: VERIFY_DEPTH, timeMs: 4000, jitter: 0 });
      if (j) {
        const loss = j.best.score - j.played.score;
        const isBest = mk(j.best.move) === mk(played);
        if (!isBest && loss >= MIN_LOSS) {
          // 确认正解唯一，否则不是一道干净的题
          const a = analyze(b, c, { maxDepth: VERIFY_DEPTH, timeMs: 4000, jitter: 0 });
          const gap = a.moves.length > 1 ? a.moves[0].score - a.moves[1].score : 9999;
          const fen = toFen(b, c);
          if (gap >= MIN_GAP && !seen.has(fen) && a.moves.length >= 8) {
            // 那位"棋手"选的错着，在正确排序里排第几
            let brank = 99;
            for (let i = 0; i < a.moves.length; i++) if (mk(a.moves[i].move) === mk(played)) brank = i + 1;

            seen.add(fen);
            let cur: Board = b;
            const line: string[] = [];
            for (const mv of j.best.pv.slice(0, 6)) {
              line.push(moveToText(cur, mv));
              cur = applyMove(cur, mv);
            }
            out.push({
              id: '',
              // 正解是吃子/将军 → 抓住对方破绽，算战术；否则是"避免亏子"，算眼力
              kind: !!b[j.best.move.ty][j.best.move.tx] || isInCheck(applyMove(b, j.best.move), other(c))
                ? 'tactic'
                : 'safety',
              fen,
              answer: moveToText(b, j.best.move),
              line,
              rating: rate(b, c, j.best.move, brank),
              blunder: moveToText(b, played),
            });
            if (out.length % 20 === 0) {
              process.stderr.write(
                `  已出 ${out.length} 题（${games} 局，扫过 ${scanned} 个局面，` +
                  `${Math.round((Date.now() - t0) / 1000)}s）\n`,
              );
            }
          }
        }
      }
    }
    b = applyMove(b, played);
    c = other(c);
  }
}

out.forEach((p, i) => {
  p.id = `bl-${p.kind}-${i.toString(36)}`;
});
const rs = out.map((p) => p.rating).sort((a, b) => a - b);
process.stderr.write(
  `\n合计 ${out.length} 题（${games} 局，扫过 ${scanned} 个局面，${Math.round((Date.now() - t0) / 1000)}s）\n` +
    `  眼力 ${out.filter((p) => p.kind === 'safety').length}  战术 ${out.filter((p) => p.kind === 'tactic').length}\n` +
    `  难度 ${rs[0]}~${rs[rs.length - 1]}  中位 ${rs[rs.length >> 1]}\n`,
);
const band = [[600, 900], [900, 1100], [1100, 1300], [1300, 1500], [1500, 2200]]
  .map(([lo, hi]) => `${lo}-${hi}:${rs.filter((x) => x >= lo && x < hi).length}`)
  .join('  ');
process.stderr.write(`  分布 ${band}\n`);
process.stdout.write(JSON.stringify(out));
