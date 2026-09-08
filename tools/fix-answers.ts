/**
 * 非杀法题的"正解唯一"复核。
 *
 * 入库时是靠「最佳分甩开次佳 170~300 分」来保证唯一的，但用的是 6 层搜索。
 * 换到 8 层重算 730 道，有 16 道站不住：
 *   · 2 道并列的着法有十几二十个（有一道"只有一步不亏子"实际 27 手都不亏），
 *     这种题根本没有"找一手"可言；
 *   · 5 道记的答案深一点搜就不是最优了；
 *   · 9 道答案没错，但确实还有一两手一样好——学生走那手会被判错。
 *
 * 这里对这些题用更深的搜索重新定案：
 *   并列太多 → 删；答案还在最优之列 → 补 also；答案掉出最优 → 只有在
 *   新的最佳甩得够开时才改答案，甩不开说明这个局面本来就没有唯一解，删掉。
 *
 * 用法：npx esbuild tools/fix-answers.ts --bundle --platform=node --format=esm \
 *         --outfile=/tmp/fa.mjs && node /tmp/fa.mjs
 */
import { legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { fromFen, moveToText } from '../src/xiangqi/notation';
import { analyze } from '../src/xiangqi/ai';
import { readFileSync, writeFileSync } from 'fs';

const FILE = 'src/xiangqi/puzzles.json';
const DEPTH = Number(process.env.DEPTH ?? 12);
const TIME = Number(process.env.TIME_MS ?? 12000);
/** 分差在这以内算"一样好"，和复盘里"好棋"的口径一致 */
const TIE = Number(process.env.TIE ?? 25);
/** 并列超过这个数就不成题了 */
const MAX_TIES = Number(process.env.MAX_TIES ?? 3);
/** 要改写答案的话，新答案必须甩开第二名这么多，否则说明这题本来就没有唯一解 */
const REWRITE_GAP = Number(process.env.REWRITE_GAP ?? 150);

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

interface Row {
  id: string;
  kind: string;
  fen: string;
  answer: string;
  also?: string[];
  line: string[];
  mateIn?: number;
  rating: number;
  [k: string]: unknown;
}

const rows = JSON.parse(readFileSync(FILE, 'utf8')) as Row[];
/** 只复核指定的题（默认全查，慢；给 IDS 就只查这些） */
const only = new Set((process.env.IDS ?? '').split(',').filter(Boolean));

const kept: Row[] = [];
let addedAlso = 0;
let rewrote = 0;
let dropped = 0;
const notes: string[] = [];

for (const r of rows) {
  if (r.mateIn || (only.size && !only.has(r.id))) {
    kept.push(r);
    continue;
  }
  const p = fromFen(r.fen);
  if (!p) {
    dropped++;
    notes.push(`✗ ${r.id} FEN 读不出，删`);
    continue;
  }
  const a = analyze(p.board, p.toMove, { maxDepth: DEPTH, timeMs: TIME, jitter: 0 });
  const top = a.moves[0];
  if (!top) {
    dropped++;
    continue;
  }
  const ties = a.moves.filter((m) => top.score - m.score <= TIE).map((m) => moveToText(p.board, m.move));
  if (ties.length > MAX_TIES) {
    dropped++;
    notes.push(`✗ ${r.id}（${r.kind}）一样好的着法有 ${ties.length} 手，不成题，删`);
    continue;
  }
  let answer = r.answer;
  if (!ties.includes(answer)) {
    // 记的答案掉出最优了。只有新答案甩得够开才敢改写，否则这题本来就没有唯一解
    const second = a.moves.find((m) => top.score - m.score > TIE);
    const gap = second ? top.score - second.score : Infinity;
    if (ties.length > 1 || gap < REWRITE_GAP) {
      dropped++;
      notes.push(`✗ ${r.id}（${r.kind}）记的 ${answer} 已不是最优，新最优只甩开 ${gap === Infinity ? '∞' : gap} 分，删`);
      continue;
    }
    answer = ties[0];
    rewrote++;
    notes.push(`  ${r.id}（${r.kind}）答案 ${r.answer} → ${answer}（甩开 ${gap} 分）`);
  }

  // 主变按引擎主变重建，保证每一步都走得通
  const best = a.moves.find((m) => moveToText(p.board, m.move) === answer)!;
  const line: string[] = [];
  let b = p.board;
  let c = p.toMove;
  for (const mv of best.pv) {
    const m = legalOf(b, c).find((x) => x.fx === mv.fx && x.fy === mv.fy && x.tx === mv.tx && x.ty === mv.ty);
    if (!m) break;
    line.push(moveToText(b, m));
    b = applyMove(b, m);
    c = other(c);
    if (statusAfter(b, c) !== 'playing') break;
  }

  const also = ties.filter((t) => t !== answer);
  if (also.length) {
    addedAlso++;
    r.also = also;
    notes.push(`  ${r.id}（${r.kind}）补另解：${also.join('、')}`);
  } else delete r.also;
  r.answer = answer;
  if (line.length) r.line = line;
  kept.push(r);
}

writeFileSync(FILE, JSON.stringify(kept));
console.log(`题库 ${rows.length} → ${kept.length}`);
console.log(`  补另解 ${addedAlso} 道，改写答案 ${rewrote} 道，删掉 ${dropped} 道`);
for (const n of notes) console.log(n);
