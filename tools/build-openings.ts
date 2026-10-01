/**
 * 生成布局体系谱（src/xiangqi/openinglib.json）：
 *   1. 种子谱（openingspecs.ts，人写的定式着法和说明）逐手让皮卡鱼核对：
 *      这一手比引擎首选差多少；差太多的标出来（是这一路的特征着，但引擎不认可）；
 *   2. 种子之后由皮卡鱼深算延伸到 plies 手，每一手配 movenote 的说明；
 *   3. 主线上双方"第二好的一手和最好的一样好"的地方，补成变化（最多两个），也往后延伸；
 *   4. 人写的变化照样核对、延伸。
 *
 *   node tools/run.mjs build-openings [只生成某个 id] [每手毫秒数]
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { noteMove } from '../src/xiangqi/movenote';
import { outlookOf } from '../src/xiangqi/plan';
import { OPENING_SPECS, type OpeningSpec, type SeedMove } from '../src/xiangqi/openingspecs';

const [, , only = '', msArg = '2500'] = process.argv;
const MS = Number(msArg);
const OUT = 'src/xiangqi/openinglib.json';
const e = await startPikafish(256);
const START = toFen(initialBoard(), 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

export interface LineMove {
  t: string;
  why: string;
  /** 走完这一手，红方视角的局面分（车≈1000） */
  ev: number;
  /** 比引擎首选差多少（只记明显的） */
  loss?: number;
  /** 引擎首选（这一手不是首选、而且差得多的时候） */
  best?: string;
  /** 这一手是定式谱上的（人写的），不是引擎延伸的 */
  book?: boolean;
}

type Cand = { m: Move; score: number };

/** 在 moves 之后的局面搜一次：前 3 名（走棋方视角） */
function top(moves: Move[], board: Board, color: Color, ms = MS): Cand[] {
  e.send('setoption name MultiPV value 3');
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const lines = e.send(`go movetime ${ms}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let depth = 0;
  for (const l of lines) depth = Math.max(depth, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of lines) if (l.depth === depth - 1) by.set(l.multipv, l);
  for (const l of lines) if (l.depth === depth) by.set(l.multipv, l);
  const legal = legalMoves(board, color);
  const out: Cand[] = [];
  for (const l of [...by.values()].sort((a, b) => a.multipv - b.multipv)) {
    const m = uciToMove(l.pv[0]);
    if (!m || !legal.some((x) => same(x, m)) || out.some((c) => same(c.m, m))) continue;
    out.push({ m, score: l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 : -30000) : l.score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** 只算这一手值多少（走棋方视角） */
function only1(moves: Move[], m: Move, ms = MS): number {
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const lines = e.send(`go movetime ${ms} searchmoves ${moveToUci(m)}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const l = lines[lines.length - 1];
  return l ? (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 : -30000) : l.score) : 0;
}

interface Built {
  moves: LineMove[];
  played: Move[];
  /** 每一手之前的前 3 名（找变化用） */
  cands: Cand[][];
}

/** 从 prefix 之后，先走 seed，再由引擎延伸到一共 plies 手 */
function build(prefix: Move[], seed: SeedMove[], plies: number, tag: string): Built {
  let board = initialBoard();
  let color: Color = 'r';
  for (const m of prefix) {
    board = applyMove(board, m);
    color = other(color);
  }
  const played = prefix.slice();
  const out: LineMove[] = [];
  const cands: Cand[][] = [];
  for (let i = 0; prefix.length + i < plies; i++) {
    const c = top(played, board, color);
    if (!c.length) break;
    let m: Move;
    let why: string;
    let book = false;
    if (i < seed.length) {
      const mm = textToMove(board, color, seed[i].t, legalMoves(board, color));
      if (!mm) throw new Error(`${tag}：第 ${prefix.length + i + 1} 手「${seed[i].t}」走不通`);
      m = mm;
      why = seed[i].why;
      book = true;
    } else {
      m = c[0].m;
      why = noteMove(board, m, color);
    }
    const s = c.find((x) => same(x.m, m))?.score ?? only1(played, m);
    const loss = Math.max(0, c[0].score - s);
    const t = moveToText(board, m);
    // 谱上的着法比引擎首选差太多：多半是谱写错了（次序不对、漏着），停下来让人改，不往下延伸错的谱
    if (book && loss >= 150 && !seed[i].allow) throw new Error(`${tag}：第 ${prefix.length + i + 1} 手「${t}」比引擎首选 ${moveToText(board, c[0].m)} 差 ${loss}，谱有问题`);
    const rec: LineMove = { t, why, ev: color === 'r' ? s : -s };
    if (book) rec.book = true;
    if (loss >= 40) {
      rec.loss = loss;
      rec.best = moveToText(board, c[0].m);
    }
    out.push(rec);
    cands.push(c);
    console.log(`  ${prefix.length + i + 1}. ${t}${book ? '（谱）' : ''}  ${rec.ev}${loss >= 40 ? `  比首选 ${rec.best} 差 ${loss}` : ''}`);
    played.push(m);
    board = applyMove(board, m);
    color = other(color);
  }
  return { moves: out, played, cands };
}

function finalWord(ev: number): string {
  return `走到这里：${ev >= 0 ? '红方' : '黑方'}${outlookOf(Math.abs(ev)).replace(/^你/, '')}`;
}

const prev = fs.existsSync(OUT) ? (JSON.parse(fs.readFileSync(OUT, 'utf8')) as Record<string, unknown>[]) : [];
const result: Record<string, unknown>[] = [];
const CHECK = process.env.CHECK === '1';
for (const spec of OPENING_SPECS as OpeningSpec[]) {
  if (CHECK) {
    // 只核对种子：每一套主线和人写的变化走到种子末尾
    try {
      const m = build([], spec.seed, spec.seed.length, spec.name);
      for (const v of spec.variations ?? []) build(m.played.slice(0, v.at), v.seed, v.at + v.seed.length, `${spec.name}/${v.name}`);
      console.log(`✓ ${spec.name}`);
    } catch (err) {
      console.log(`✗ ${(err as Error).message}`);
    }
    continue;
  }
  if (only && spec.id !== only) {
    const old = prev.find((x) => x.id === spec.id);
    if (old) result.push(old);
    continue;
  }
  console.log(`\n== ${spec.name}`);
  e.send('ucinewgame');
  const main = build([], spec.seed, spec.plies, spec.name);
  const variations: { name: string; at: number; moves: LineMove[]; final: string }[] = [];
  for (const v of spec.variations ?? []) {
    console.log(` -- 变化：${v.name}`);
    const b = build(main.played.slice(0, v.at), v.seed, v.at + v.plies, `${spec.name}/${v.name}`);
    variations.push({ name: v.name, at: v.at, moves: b.moves, final: finalWord(b.moves[b.moves.length - 1]?.ev ?? 0) });
  }
  // 引擎找的变化：种子之后，第二好的一手和最好的差不到 25 的地方（取最早的两处，相隔至少 4 手）
  const picks: number[] = [];
  for (let k = spec.seed.length; k < main.cands.length && picks.length < 2; k++) {
    const c = main.cands[k];
    if (c.length < 2 || c[0].score - c[1].score > 25) continue;
    if (picks.length && k - picks[picks.length - 1] < 4) continue;
    picks.push(k);
  }
  for (const k of picks) {
    const c = main.cands[k];
    let board = initialBoard();
    let color: Color = 'r';
    for (const m of main.played.slice(0, k)) {
      board = applyMove(board, m);
      color = other(color);
    }
    const alt = c[1].m;
    const altText = moveToText(board, alt);
    console.log(` -- 引擎变化：第 ${k + 1} 手也可以走 ${altText}`);
    const b = build(main.played.slice(0, k), [{ t: altText, why: `这里也可以走 ${altText}——引擎认为和主线 ${main.moves[k].t} 差不多。${noteMove(board, alt, color)}` }], k + 14, `${spec.name}/alt${k}`);
    variations.push({ name: `第 ${Math.floor(k / 2) + 1} 回合${color === 'r' ? '红方' : '黑方'}改走 ${altText}`, at: k, moves: b.moves, final: finalWord(b.moves[b.moves.length - 1]?.ev ?? 0) });
  }
  const lastEv = main.moves[main.moves.length - 1]?.ev ?? 0;
  result.push({
    id: spec.id,
    name: spec.name,
    system: spec.system,
    side: spec.side,
    tag: spec.tag,
    idea: spec.idea,
    breaks: spec.breaks,
    traps: spec.traps,
    moves: main.moves,
    final: finalWord(lastEv),
    variations,
    ms: MS,
  });
  fs.writeFileSync(OUT, JSON.stringify(result, null, 0));
}
fs.writeFileSync(OUT, JSON.stringify(result, null, 0));
console.log(`\n写入 ${OUT}：${result.length} 套`);
process.exit(0);
