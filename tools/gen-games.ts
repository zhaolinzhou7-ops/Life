/**
 * 打谱用的棋谱。
 *
 * ⚠️ **这里放的不是名局，是"定式开局 + 引擎中局"。**
 *
 * 两件事要说清楚：
 *
 * 1. 打谱最经典的材料是胡荣华、许银川这些人的实战。但我手上没有可靠的棋谱
 *    来源，而**凭印象编一份署着真人名字的对局是不能做的**——那是伪造真实
 *    人物的记录，比留个空白糟糕得多。所以这里没有名局。
 *
 * 2. 纯引擎自战也不行。实测让引擎从头下：第 1 手走"炮八进四"、第 3 手
 *    "将5进1"，四局里有三局开局就是仕相乱动——**引擎没有开局库，
 *    开局阶段分支太多，十层搜索根本看不出所以然**。拿那种谱打，
 *    学到的全是坏习惯。
 *
 * 所以改成：**开局照 openings.ts 里那几套已验证的定式走完，
 * 之后再交给引擎自战**。开局是书上的，中局是引擎的，两段都站得住。
 * 打谱真正起作用的是"猜着法"这个动作——先自己想一手再看谱，
 * 这一点对中局同样成立。
 *
 * 用法：npx esbuild tools/gen-games.ts --bundle --platform=node --format=esm \
 *   --outfile=/tmp/gg.mjs && node /tmp/gg.mjs > src/xiangqi/games.json
 */
import { initialBoard, legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';
import { OPENINGS } from '../src/xiangqi/openings';
import { think, judgeMove, resetEngine } from '../src/xiangqi/ai';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

const N = Number(process.env.N ?? 4);
const DEPTH = Number(process.env.DEPTH ?? 10);
const TIME = Number(process.env.TIME_MS ?? 1500);
const MAX_PLIES = Number(process.env.MAX_PLIES ?? 70);

interface Rec {
  id: string;
  name: string;
  result: string;
  /** 开局用的是哪一套定式 */
  opening: string;
  /** 前多少手是定式（之后才是引擎自战） */
  bookPlies: number;
  moves: { t: string; why?: string }[];
}

const out: Rec[] = [];
for (let g = 0; g < N; g++) {
  resetEngine();
  let b = initialBoard();
  let c: Color = 'r';
  const moves: { t: string; why?: string }[] = [];
  let result = '未分胜负';
  const jitter = 0;

  // 先按定式把开局走完——引擎自己走开局只会走出仕相乱动的怪谱
  const book = OPENINGS[g % OPENINGS.length];
  let bookOk = true;
  for (const bm of book.moves) {
    const mv = textToMove(b, c, bm.t, legalOf(b, c));
    if (!mv) {
      bookOk = false;
      break;
    }
    moves.push({ t: bm.t, why: bm.why });
    b = applyMove(b, mv);
    c = other(c);
  }
  if (!bookOk) {
    process.stderr.write(`第 ${g + 1} 局：定式「${book.name}」走不通，跳过\n`);
    continue;
  }
  for (let ply = 0; ply < MAX_PLIES; ply++) {
    const st = statusAfter(b, c);
    if (st !== 'playing') {
      result = st === 'red-win' ? '红胜' : st === 'black-win' ? '黑胜' : '和棋';
      break;
    }
    if (!legalOf(b, c).length) {
      result = c === 'r' ? '黑胜' : '红胜';
      break;
    }
    const m = think(b, c, { maxDepth: DEPTH, timeMs: TIME, jitter: ply < 8 ? jitter : 0 });
    if (!m) break;
    const text = moveToText(b, m);
    // 给"明显好过次佳"的着法加一句注：那些才是值得猜的一手
    let why: string | undefined;
    const j = judgeMove(b, c, m, { maxDepth: 7, timeMs: 900, jitter: 0 });
    if (j) {
      const gap = j.best.score - (j.played.score ?? 0);
      if (j.best.mateIn !== undefined && j.best.mateIn > 0) why = `这里已经算到杀棋了（${j.best.mateIn} 回合）。`;
      else if (Math.abs(gap) < 15 && ply > 10) why = undefined;
    }
    moves.push(why ? { t: text, why } : { t: text });
    b = applyMove(b, m);
    c = other(c);
  }
  out.push({
    id: `bk-${g}`,
    name: `${book.name} · 第 ${g + 1} 局`,
    result,
    opening: book.name,
    bookPlies: book.moves.length,
    moves,
  });
  process.stderr.write(`第 ${g + 1} 局：${book.name} 开局 ${book.moves.length} 手 + 引擎 ${moves.length - book.moves.length} 手，${result}\n`);
}
process.stdout.write(JSON.stringify(out));
