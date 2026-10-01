/**
 * 把 gen-combos 的产出（node_modules/.cache/combo-*.jsonl）并进题库，作为带主题的战术题。
 *
 * 并入前用规则引擎再走一遍：局面读得出、主变每一手合法、第一手就是答案；
 * 杀棋题主变要真的走到将死，得子题主变要真的净得子力（≥ 2.5 个兵）。
 * 难度用和其它题一样的尺子（rate-difficulty），再按步数保底：
 * 要连走五六步的组合，第一手再显眼也不可能是入门题。
 *
 *   node tools/run.mjs merge-combos
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { applyMove, legalMoves, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { PIECE_VALUE } from '../src/xiangqi/teach';
import { rateDifficulty } from './rate-difficulty';

const PUZ = 'src/xiangqi/puzzles.json';
const CACHE = 'node_modules/.cache';

type Rec = {
  id: string;
  kind: string;
  fen: string;
  answer: string;
  line: string[];
  rating?: number;
  goal: string;
  ev: number;
  mateIn?: number;
  themes: string[];
  steps: number;
  gap: number;
};

function material(b: Board, c: Color): number {
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') s += (p.c === c ? 1 : -1) * PIECE_VALUE[p.t];
  return s;
}

const puzzles = JSON.parse(readFileSync(PUZ, 'utf8')) as Rec[];
// 重新合并时先把上一次并进去的组合题拿掉，免得新旧两份并存
const kept = puzzles.filter((p) => !p.id.startsWith('cb-'));
const fens = new Set(kept.map((p) => p.fen));

const recs: Rec[] = [];
for (const f of readdirSync(CACHE).filter((n) => /^combo-\d+\.jsonl$/.test(n)).sort()) {
  for (const l of readFileSync(`${CACHE}/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
}

const out: Rec[] = [];
const why: Record<string, number> = {};
const drop = (k: string) => (why[k] = (why[k] ?? 0) + 1);
for (const r of recs) {
  const pos = fromFen(r.fen);
  if (!pos) {
    drop('局面读不出');
    continue;
  }
  if (fens.has(r.fen)) {
    drop('局面重复');
    continue;
  }
  if (r.line[0] !== r.answer || r.line.length % 2 === 0 || r.steps < 2) {
    drop('主变格式不对');
    continue;
  }
  let b = pos.board;
  let c: Color = pos.toMove;
  const me = c;
  let ok = true;
  for (const t of r.line) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) {
      ok = false;
      break;
    }
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  if (!ok) {
    drop('主变走不通');
    continue;
  }
  if (r.goal === 'mate') {
    if (statusAfter(b, c) === 'playing') {
      drop('杀棋没走到将死');
      continue;
    }
    r.mateIn = Math.ceil(r.line.length / 2);
  } else {
    // 题目到我方拿到便宜那一步为止：最后一手是我方的，对方还没应。
    // 对方能吃回来的话便宜就没到手——按"我方吃完、对方最好的吃回"保守算
    const gain = material(b, me) - material(pos.board, me);
    if (gain < 250) {
      drop('没有净得子力');
      continue;
    }
    delete r.mateIn;
  }
  const base = rateDifficulty(pos.board, me, r.answer, r.goal === 'mate' ? r.mateIn : undefined);
  r.rating = Math.min(2200, Math.max(base, 760 + (r.steps - 1) * 170 + (r.themes.includes('弃子') ? 80 : 0)));
  fens.add(r.fen);
  out.push(r);
}

writeFileSync(PUZ, JSON.stringify([...kept, ...out]));
const bySteps: Record<string, number> = {};
const byTheme: Record<string, number> = {};
for (const r of out) {
  const k = r.steps >= 6 ? '6+' : r.steps >= 4 ? '4-5' : '2-3';
  bySteps[k] = (bySteps[k] ?? 0) + 1;
  for (const t of r.themes) byTheme[t] = (byTheme[t] ?? 0) + 1;
}
console.log(`中局组合并入 ${out.length} 道（共 ${recs.length} 条候选）；丢掉：`, why);
console.log('按步数', bySteps, '按主题', byTheme);
