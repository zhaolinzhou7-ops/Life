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
import { verdict } from './playout-verdict';
import { steadyAnalyze } from './steady-analyze';
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
  for (const r of rows) {
    if (!r.mateIn) continue;
    const p = fromFen(r.fen);
    if (!p) continue;
    // 判定深度按步数给，别一律要求 13 层：将军延伸会让杀棋局面的搜索树炸开，
    // 一步杀要到 13 层反而算不完。实测 9 层起结论就稳了，这里给 mateIn*2+5。
    const depth = Math.min(Number(process.env.MATE_DEPTH ?? 13), r.mateIn * 2 + 5);
    // 一定要真的搜到 depth 层。时限截断的半截结果会漏掉"同样快的杀法"——
    // 上一版体检就因为这个报出一道假问题，而机器闲的时候又复现不了
    const a = steadyAnalyze(p.board, p.toMove, depth, 8000);
    if (!a.full) {
      flag(`${label}·搜不到判定深度`, `${r.id}（只到 ${a.depth} 层）`);
      continue;
    }
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
 * 残局的胜和：**直接调生成器用的那一份 verdict**。
 *
 * 这条判据我改错过三次，每次都是同一个毛病——体检自己抄了一份更弱的判法，
 * 然后把生成器验过的好数据报成错：
 *   一次 拿 14 层的静态分去审"实战下出来"的结论
 *   二次 只下一遍 12 层，而生成器跑的是 12/13/14 三个深度
 *   三次 生成器加了"强方不许原地打转"，体检这边没加
 * 根子是判定逻辑有两份，改一边另一边不知道。现在只留一份
 * （tools/playout-verdict.ts），两边 import 同一段代码，
 * **检查者和生产者用的是同一段逻辑**，从结构上不可能再对不上。
 */
function auditEndgames(rows: { id: string; name: string; fen: string; you: Color; target: string }[]) {
  for (const e of rows) {
    const p = fromFen(e.fen);
    if (!p) continue;
    const v = verdict(p.board, e.you);
    if (v.target === 'loss') flag('残局·标的结果反了，你会输', `${e.id}（${e.name}）标${e.target}`);
    else if (v.target === 'unstable') flag('残局·胜和不稳定', `${e.id}（${e.name}）不同深度结论不一致`);
    else if (v.target !== e.target)
      flag(`残局·标的是${e.target === 'win' ? '胜' : '和'}，实测是${v.target === 'win' ? '胜' : '和'}`, `${e.id}（${e.name}）`);
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
