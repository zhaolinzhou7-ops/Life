/**
 * 重新给题库定难度。
 *
 * 【为什么要重定】原来的难度指标是「引擎最浅搜到第几层能找到这一手」。
 * 这个指标是坏的：think() 里带静态搜索(quiescence)，会把所有吃子序列算干净，
 * 所以**任何以吃子为核心的战术，1 层就能找到**，一律被压到最低难度档。
 *
 * 实测：从强引擎对局里采到的 6 个战术，6 个的 need 都等于 1。
 * 整个题库 971 道有 794 道落在 600~900 分，就是这么来的——
 * 不是题真的简单，是尺子坏了。
 *
 * 【新指标】改用**正解在浅层搜索里排第几名**：
 *   - 浅层就排第一 → 一眼就能看出来，简单
 *   - 浅层排在很后面、深层才升到第一 → 要算才看得见，难
 * 这个量直接对应"人能不能一眼看出来"，而且不受静态搜索干扰。
 *
 * 用法：node rerate.mjs < puzzles.json > puzzles.rated.json
 */
import { analyze } from '../src/xiangqi/ai';
import { fromFen } from '../src/xiangqi/notation';
import { isInCheck, applyMove, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText } from '../src/xiangqi/notation';

interface Puzzle {
  id: string;
  kind: string;
  fen: string;
  answer: string;
  line: string[];
  mateIn?: number;
  rating: number;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

/** 正解在某个深度的搜索结果里排第几（1 起；找不到返回一个大数） */
function rankOfSolution(b: Board, c: Color, answer: string, depth: number): { rank: number; n: number; move: Move | null } {
  const a = analyze(b, c, { maxDepth: depth, timeMs: 4000, jitter: 0 });
  for (let i = 0; i < a.moves.length; i++) {
    if (moveToText(b, a.moves[i].move) === answer) return { rank: i + 1, n: a.moves.length, move: a.moves[i].move };
  }
  return { rank: 99, n: a.moves.length, move: null };
}

const SHALLOW = Number(process.env.SHALLOW ?? 2);
const MID = Number(process.env.MID ?? 5);

const input: Puzzle[] = JSON.parse(await new Promise<string>((res) => {
  let s = '';
  process.stdin.on('data', (d) => (s += d));
  process.stdin.on('end', () => res(s));
}));

const START = Number(process.env.START ?? 0);
const END = Number(process.env.END ?? input.length);

const out: Puzzle[] = [];
let done = 0;
for (let i = 0; i < input.length; i++) {
  const p = input[i];
  if (i < START || i >= END) {
    out.push(p);
    continue;
  }
  const parsed = fromFen(p.fen);
  if (!parsed) {
    out.push(p);
    continue;
  }
  const { board, toMove } = parsed;
  const s = rankOfSolution(board, toMove, p.answer, SHALLOW);
  const m = rankOfSolution(board, toMove, p.answer, MID);
  if (!s.move && !m.move) {
    out.push(p); // 记谱对不上就别乱改
    continue;
  }
  const mv = m.move ?? s.move!;
  const isCap = !!board[mv.ty][mv.tx];
  const isChk = isInCheck(applyMove(board, mv), other(toMove));
  const quiet = !isCap && !isChk;

  // 浅层排名是主指标：排得越靠后，说明越不容易一眼看出来
  let r = 620;
  r += Math.min(9, s.rank - 1) * 78;
  r += Math.min(5, m.rank - 1) * 85;
  if (quiet) r += 110; // 安静着法最难被看见
  else if (!isCap) r += 40;
  r += Math.max(0, s.n - 18) * 5;
  // 杀法按步数保底：七步杀再"显眼"也不可能是入门题
  if (p.mateIn && p.mateIn > 1) r = Math.max(r, 700 + (p.mateIn - 1) * 260);

  out.push({ ...p, rating: Math.round(Math.max(600, Math.min(2200, r))) });
  done++;
  if (done % 50 === 0) process.stderr.write(`  已重评 ${done}\n`);
}

const rated = out.slice(START, END);
const before = input.slice(START, END).map((p) => p.rating).sort((a, b) => a - b);
const after = rated.map((p) => p.rating).sort((a, b) => a - b);
const band = (arr: number[]) =>
  [[600, 900], [900, 1100], [1100, 1300], [1300, 1500], [1500, 1700], [1700, 2200]]
    .map(([lo, hi]) => `${lo}-${hi}:${arr.filter((x) => x >= lo && x < hi).length}`)
    .join('  ');
process.stderr.write(`\n重评 ${done} 题\n  原分布 ${band(before)}\n  新分布 ${band(after)}\n`);
process.stdout.write(JSON.stringify(out));
