/**
 * 数据体检：把三个库里**我声称成立、但没有可执行担保的东西**全部查一遍。
 *
 * 起因是士象摆位那个 bug——45%~80% 的局面摆着走不到的子，而当时的自动验证
 * 一个都没抓出来，因为只验了"走法合法"，没验"数据本身对不对"。
 * 后来这一轮体检又抓出三类同源的问题：
 *
 *   · 有 2 处着法文字是**乱码**（U+FFFD），题面直接是坏的
 *   · 398 道杀法题里 14 道步数标错、16 道"正解唯一"不成立
 *     （根子在置换表没给杀棋分做层数换算，已在 ai.ts 修掉）
 *   · 残局的"胜/和"是用 9 层引擎自己对下判的，**引擎赢不下来就记成和**，
 *     于是单车对双士这种教科书例胜被标成"只能和"
 *
 * 所以这个文件的定位是**闸门**，不是报告：数据改完必须过一遍，红的就不许进仓库。
 *
 * 用法：
 *   npx esbuild tools/audit-data.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/audit.mjs && node /tmp/audit.mjs
 *   FAST=1 只做不花时间的检查（编码/摆位/合法性/主变），CI 里用这个
 */
import { legalMoves, applyMove, isInCheck, type Board, type Color } from '../src/xiangqi/rules';
import { fromFen, moveToText, textToMove } from '../src/xiangqi/notation';
import { analyze } from '../src/xiangqi/ai';
import { checkBoard } from './validate-positions';
import puzzles from '../src/xiangqi/puzzles.json';
import mates from '../src/xiangqi/matepatterns.json';
import endgames from '../src/xiangqi/endgamelib.json';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

const problems: Record<string, number> = {};
const samples: Record<string, string[]> = {};
function flag(kind: string, detail: string) {
  problems[kind] = (problems[kind] ?? 0) + 1;
  const s = (samples[kind] ??= []);
  if (s.length < 3) s.push(detail);
}

/** 乱码：一个汉字坏掉会变成三个 U+FFFD，肉眼在终端里很难发现，必须机器查 */
function auditEncoding(rows: unknown[], label: string) {
  for (const r of rows) {
    const json = JSON.stringify(r);
    if (json.includes('�')) flag(`${label}·文字乱码`, (r as { id: string }).id);
  }
}

interface Row {
  id: string;
  fen: string;
  answer: string;
  also?: string[];
  line?: string[];
  mateIn?: number;
}

/** 局面能不能出现、答案合不合法、主变走不走得通 */
function auditPositions(rows: Row[], label: string, hasAnswer: boolean) {
  const seenFen = new Set<string>();
  for (const r of rows) {
    if (!r.fen || (hasAnswer && !r.answer)) {
      flag(`${label}·字段缺失`, r.id);
      continue;
    }
    if (seenFen.has(r.fen)) flag(`${label}·局面重复`, r.id);
    seenFen.add(r.fen);

    const parsed = fromFen(r.fen);
    if (!parsed) {
      flag(`${label}·FEN 读不出`, r.id);
      continue;
    }
    const errs = checkBoard(parsed.board);
    if (errs.length) flag(`${label}·摆位不可能出现`, `${r.id} ${errs[0]}`);
    if (!hasAnswer) continue;

    const legal = legalOf(parsed.board, parsed.toMove);
    // answer 和 also 里的每一手都必须是这个局面里能走的
    for (const t of [r.answer, ...(r.also ?? [])]) {
      if (!textToMove(parsed.board, parsed.toMove, t, legal)) flag(`${label}·答案不是合法着法`, `${r.id} ${t}`);
    }

    if (r.line?.length) {
      let b = parsed.board;
      let c = parsed.toMove;
      for (let i = 0; i < r.line.length; i++) {
        const lm = textToMove(b, c, r.line[i], legalOf(b, c));
        if (!lm) {
          flag(`${label}·主变走不通`, `${r.id} 第${i + 1}步 ${r.line[i]}`);
          break;
        }
        b = applyMove(b, lm);
        c = other(c);
      }
    }
  }
}

/**
 * 杀法题：标的步数要对，而且**同样步数的杀法必须一个不漏地收在 answer/also 里**。
 * 漏一个，学生走出那一手就会被判错——这比步数标错更伤人。
 */
function auditMates(rows: Row[], label: string) {
  const depth = Number(process.env.MATE_DEPTH ?? 13);
  for (const r of rows) {
    if (!r.mateIn) continue;
    const p = fromFen(r.fen);
    if (!p) continue;
    const a = analyze(p.board, p.toMove, { maxDepth: depth, timeMs: 8000, jitter: 0 });
    const truth = a.moves[0]?.mateIn;
    if (truth !== r.mateIn) {
      flag(`${label}·杀棋步数标错`, `${r.id} 标${r.mateIn} 实际${truth ?? '不成杀'}`);
      continue;
    }
    const alts = a.moves.filter((m) => m.mateIn === truth).map((m) => moveToText(p.board, m.move));
    const declared = new Set([r.answer, ...(r.also ?? [])]);
    const missing = alts.filter((t) => !declared.has(t));
    if (missing.length) flag(`${label}·同样快的杀法没算对`, `${r.id} 漏了 ${missing.join('、')}`);
  }
}

/**
 * 残局的胜/和。
 *
 * 注意这里**只能抓一个方向的错**：标"胜"而引擎连优势都看不到，那基本是错的；
 * 标"和"却是例胜的局面，静态分看不出来，得靠生成器里的 theory 闸门挡。
 */
function auditEndgames(rows: { id: string; name: string; fen: string; you: Color; target: string }[]) {
  for (const e of rows) {
    const p = fromFen(e.fen);
    if (!p) continue;
    const a = analyze(p.board, p.toMove, { maxDepth: 14, timeMs: 4000, jitter: 0 });
    const top = a.moves[0];
    const sc = p.toMove === e.you ? (top?.score ?? 0) : -(top?.score ?? 0);
    if (e.target === 'win' && top?.mateIn == null && sc < 250)
      flag('残局·标胜但引擎看不到优势', `${e.id}（${e.name}）分=${sc}`);
    if (e.target === 'draw' && (top?.mateIn ?? 0) > 0)
      flag('残局·标和但引擎有杀', `${e.id}（${e.name}）${top!.mateIn} 步杀`);
  }
}

const all = [puzzles as unknown[], mates as unknown[], endgames as unknown[]];
const labels = ['题库', '杀法图形', '残局'];
all.forEach((rows, i) => auditEncoding(rows, labels[i]));
auditPositions(puzzles as Row[], '题库', true);
auditPositions(mates as Row[], '杀法图形', true);
auditPositions(endgames as unknown as Row[], '残局', false);

if (!process.env.FAST) {
  auditMates(puzzles as Row[], '题库');
  auditMates(mates as Row[], '杀法图形');
  auditEndgames(endgames as { id: string; name: string; fen: string; you: Color; target: string }[]);
}

console.log(
  `体检对象：题库 ${puzzles.length} 道 / 杀法图形 ${mates.length} 个 / 残局 ${endgames.length} 个` +
    `${process.env.FAST ? '（FAST：跳过引擎复核）' : ''}\n`,
);
const keys = Object.keys(problems);
if (!keys.length) {
  console.log('✅ 全部通过');
  process.exit(0);
}
for (const k of keys.sort()) {
  console.log(`✗ ${k}: ${problems[k]} 处`);
  for (const s of samples[k]) console.log(`    ${s}`);
}
process.exit(1);
