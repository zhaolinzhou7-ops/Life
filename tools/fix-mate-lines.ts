/**
 * 补全杀法题被截断的主变。
 *
 * 体检发现 391 道杀法题里有 41 道的 line 没走到杀：标着"两步杀"，
 * 主变却只有一手。界面上这一行的标题是「完整下法」，用户看到的是
 * 一条走到一半就停住的变化，根本看不出杀在哪——等于这道题没有解析。
 *
 * 做法：用规则引擎**重新算一遍强制杀**，把真正的主变和真实步数写回去。
 * 算不出强制杀的题就地降级为战术题（它可能本来就不是杀法题），
 * 而不是留一个错的标签在题库里。
 *
 * 只在离线跑，结果直接改 puzzles.json。
 */
import fs from 'node:fs';
import path from 'node:path';
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { fromFen, moveToText, textToMove } from '../src/xiangqi/notation';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

/**
 * 攻方的候选着法：只看**将军**的着法，外加能直接困毙对方的。
 *
 * 强制杀的每一步几乎都是将军——不将军就给了对方喘息的机会。
 * 这一条把分支从四十几手砍到三五手，三步杀才算得动。
 * 例外是困毙（把对方憋死），所以也一并考虑能让对方无子可走的着法。
 */
function attackMoves(b: Board, side: Color): Move[] {
  const opp = other(side);
  const out: Move[] = [];
  for (const m of legalMoves(b, side)) {
    const nb = applyMove(b, m);
    if (isInCheck(nb, opp) || statusAfter(nb, opp) !== 'playing') out.push(m);
  }
  return out;
}

/** side 走棋，能不能在 n 个回合内强制将死对方；能就返回那条主变 */
function solveMate(b: Board, side: Color, n: number): Move[] | null {
  if (n <= 0) return null;
  const opp = other(side);
  for (const m of attackMoves(b, side)) {
    const nb = applyMove(b, m);
    if (statusAfter(nb, opp) !== 'playing') return [m]; // 这一手就杀了
    if (n === 1) continue;
    // 对方的每一种应法都必须仍然被杀，才算强制
    const replies = legalMoves(nb, opp);
    let worst: Move[] | null = null;
    let ok = true;
    for (const r of replies) {
      const sub = solveMate(applyMove(nb, r), side, n - 1);
      if (!sub) {
        ok = false;
        break;
      }
      // 取最长的一条当主变：最顽强的应法才是值得展示的那条
      if (!worst || sub.length + 1 > worst.length) worst = [r, ...sub];
    }
    if (ok && worst) return [m, ...worst];
  }
  return null;
}

/** 把着法序列转成中文记谱 */
function toTexts(b: Board, side: Color, line: Move[]): string[] {
  const out: string[] = [];
  let cur = b;
  let c = side;
  for (const m of line) {
    out.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    c = other(c);
  }
  void c;
  return out;
}

/** 主变走完之后是不是真的杀了 */
function endsInMate(b: Board, side: Color, texts: string[]): boolean {
  let cur = b;
  let c = side;
  for (const t of texts) {
    const m = textToMove(cur, c, t, legalMoves(cur, c));
    if (!m) return false;
    cur = applyMove(cur, m);
    c = other(c);
  }
  return statusAfter(cur, c) !== 'playing';
}

interface P {
  id: string;
  kind: string;
  fen: string;
  answer: string;
  line: string[];
  mateIn?: number;
  rating: number;
  also?: string[];
  blunder?: string;
}

const file = path.join(process.cwd(), 'src/xiangqi/puzzles.json');
const puzzles = JSON.parse(fs.readFileSync(file, 'utf8')) as P[];

let fixed = 0;
let demoted = 0;
let deepened = 0;
const failures: string[] = [];

for (const p of puzzles) {
  if (p.kind !== 'mate') continue;
  const f = fromFen(p.fen);
  if (!f) {
    failures.push(`${p.id} 局面读不出`);
    continue;
  }
  if (endsInMate(f.board, f.toMove, p.line)) continue; // 本来就是好的

  // 从 1 步杀往上找，找到最短的强制杀
  let solved: Move[] | null = null;
  let depth = 0;
  for (let n = 1; n <= 4; n++) {
    solved = solveMate(f.board, f.toMove, n);
    if (solved) {
      depth = n;
      break;
    }
  }

  if (!solved) {
    // 算不出强制杀：这道题不该挂在杀法名下。降级成战术题，
    // 保留局面和答案（答案本身是合法的，只是不构成强制杀）。
    p.kind = 'tactic';
    delete p.mateIn;
    demoted++;
    continue;
  }

  const texts = toTexts(f.board, f.toMove, solved);
  // 正解可能不止一手；原来的 answer 如果也成立就别改，免得动到已有的做题记录
  if (texts[0] !== p.answer) {
    p.also = [...new Set([...(p.also ?? []), texts[0]])].filter((a) => a !== p.answer);
  }
  p.line = texts[0] === p.answer ? texts : [p.answer, ...texts.slice(1)];
  // 用 answer 开头的主变要重验一遍，验不过就整条换成算出来的
  if (!endsInMate(f.board, f.toMove, p.line)) {
    p.line = texts;
    p.answer = texts[0];
  }
  if (p.mateIn !== depth) deepened++;
  p.mateIn = depth;
  fixed++;
}

fs.writeFileSync(file, `${JSON.stringify(puzzles, null, 0)}\n`);
console.log(`补全主变 ${fixed} 道（其中步数标错 ${deepened} 道），降级为战术题 ${demoted} 道`);
if (failures.length) console.log('处理不了的：', failures);
