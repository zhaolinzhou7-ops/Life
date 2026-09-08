/**
 * 杀法题的步数、正解、"另解"三件事一次性对齐引擎。
 *
 * 为什么需要这个工具：题库入库时用的是 9 层搜索，而**置换表里的杀棋分没有做
 * 层数换算**（已在 ai.ts 修掉）。同一个局面从不同深度到达，取出来的"几回合杀"
 * 就不一样，于是 398 道题里有 14 道步数标错、8 道换个深度结论就变。
 *
 * 另一件更伤人的事：入库时只用 `moves[1]` 判"首着唯一"，而那一层的次佳
 * 常常还没搜出杀来，所以"唯一"是假的——有 16 道题同样步数还有别的杀法，
 * 学生走出另一手同样快的杀棋会被判错。现在把这些着法收进 `also`，一起算对。
 *
 * 用法：
 *   npx esbuild tools/fix-mates.ts --bundle --platform=node --format=esm \
 *     --outfile=/tmp/fix.mjs && node /tmp/fix.mjs
 */
import { legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { fromFen, moveToText } from '../src/xiangqi/notation';
import { steadyAnalyze } from './steady-analyze';
import { readFileSync, writeFileSync } from 'fs';

/** 步数标签必须在这个深度以上才稳。实测 5/7 层还会飘，9 层起一致 */
const DEPTH = Number(process.env.DEPTH ?? 13);
const TIME = Number(process.env.TIME_MS ?? 8000);
/**
 * 同样步数的杀法多到这个数以上，这道题就没有"找一手"可言了——
 * 随便走走都能杀，练不到东西，删掉。
 */
const MAX_ALTS = Number(process.env.MAX_ALTS ?? 4);

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

interface Row {
  id: string;
  fen: string;
  answer: string;
  also?: string[];
  line: string[];
  mateIn?: number;
  rating: number;
  [k: string]: unknown;
}

/** 杀得越久越难，重新给个难度分 */
const rateMate = (mateIn: number, alts: number, old: number): number => {
  const base = { 1: 800, 2: 1000, 3: 1250, 4: 1450, 5: 1600, 6: 1750 }[mateIn] ?? 1800;
  // 另解越多越好猜，往下压一点
  return Math.max(600, Math.round((base + old) / 2) - (alts - 1) * 40);
};

export function fixFile(path: string, label: string): void {
  const rows = JSON.parse(readFileSync(path, 'utf8')) as Row[];
  const kept: Row[] = [];
  let changedN = 0;
  let addedAlts = 0;
  let dropped = 0;
  const notes: string[] = [];

  for (const r of rows) {
    if (!r.mateIn) {
      kept.push(r);
      continue;
    }
    const p = fromFen(r.fen);
    if (!p) {
      dropped++;
      notes.push(`✗ ${r.id} FEN 读不出，删`);
      continue;
    }
    // 必须真的搜到 DEPTH 层：时限截断的结果会漏掉"同样快的杀法"，
    // 而且同一台机器忙和闲会给出不同答案——数据不能随机器负载而变
    const a = steadyAnalyze(p.board, p.toMove, DEPTH, TIME);
    if (!a.full) {
      notes.push(`✗ ${r.id} 搜不到 ${DEPTH} 层（只到 ${a.depth}），跳过不改`);
      kept.push(r);
      continue;
    }
    const truth = a.moves[0]?.mateIn;
    if (!truth || truth <= 0) {
      dropped++;
      notes.push(`✗ ${r.id} 标${r.mateIn}步，实际根本不成杀，删`);
      continue;
    }
    const alts = a.moves.filter((m) => m.mateIn === truth).map((m) => moveToText(p.board, m.move));
    if (alts.length > MAX_ALTS) {
      dropped++;
      notes.push(`✗ ${r.id} 同样 ${truth} 步的杀法有 ${alts.length} 手，不成题，删`);
      continue;
    }
    // 原来记的那一手仍是最快杀法的话就留着当正解，保持题面稳定
    const answer = alts.includes(r.answer) ? r.answer : alts[0];
    const best = a.moves.find((m) => moveToText(p.board, m.move) === answer)!;

    // 主变按引擎的 PV 重建，保证"完整下法"每一步都走得通
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

    if (truth !== r.mateIn || answer !== r.answer) {
      changedN++;
      notes.push(`  ${r.id} ${r.mateIn}步/${r.answer} → ${truth}步/${answer}`);
    }
    const also = alts.filter((t) => t !== answer);
    if (also.length) addedAlts++;

    r.mateIn = truth;
    r.answer = answer;
    r.line = line.length ? line : r.line;
    r.rating = rateMate(truth, alts.length, r.rating);
    if (also.length) r.also = also;
    else delete r.also;
    kept.push(r);
  }

  writeFileSync(path, JSON.stringify(kept));
  console.log(`\n${label}：${rows.length} → ${kept.length}`);
  console.log(`  步数/正解改掉 ${changedN} 道，补上"另解" ${addedAlts} 道，删掉 ${dropped} 道`);
  for (const n of notes) console.log(n);
}

const only = process.env.ONLY ?? '';
if (!only || only === 'puzzles') fixFile('src/xiangqi/puzzles.json', '题库');
if (!only || only === 'mates') fixFile('src/xiangqi/matepatterns.json', '杀法图形');
