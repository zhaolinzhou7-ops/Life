/**
 * 布局变招大扩充 + 每一手讲意义（输出 src/xiangqi/openingvars.json，界面按需加载）。
 *
 * 用户原话："多增加一些布局后的变招，每一步变招的意义讲清楚。"
 *
 * 对每一套布局：
 *   1. 主线从"和别的布局分开"的那一手起，往后十几手里的每一个分岔点，皮卡鱼 MultiPV 4 深算：
 *      和首选差不到 0.7 个兵的其它着法，就是"变招"（双方都算，一个点最多两个），每条往下走 12 手；
 *   2. 再找"看着自然、其实是错着"的：浅算（5 层）排前三、深算却亏 1.8 个兵以上的，收成"错着变化"，
 *      往下走 8 手，看对方怎么惩罚（每套最多 3 个）；
 *   3. 每一手配"意义"（movemeaning.ts）：干了什么 + 防住了对方什么（空着搜索：对方能连走一步最想走什么，
 *      走完之后那一手少赚一个半兵以上）+ 威胁什么（自己能连走一步能多赚多少）+ 接下来双方怎么走 + 引擎怎么看；
 *   4. 主线和原有变化里引擎延伸的那些手，也换成这种讲法（人写的定式说明不动）。
 *
 *   node tools/run.mjs expand-openings [分片号 分片数] [每手毫秒=1500]   → node_modules/.cache/openingvars-<分片>.json
 *   node tools/run.mjs expand-openings merge                              → src/xiangqi/openingvars.json
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { briefOf, concrete, keyNote, meaningOf, type MeaningCtx } from '../src/xiangqi/movemeaning';
import { countNames } from '../src/xiangqi/movenote';
import { outlookOf } from '../src/xiangqi/plan';
import lib from '../src/xiangqi/openinglib.json';

type LineMove = { t: string; why: string; ev: number; loss?: number; best?: string; book?: boolean };
type Opening = { id: string; name: string; side: 'red' | 'black'; moves: LineMove[]; variations: { name: string; at: number; moves: LineMove[] }[] };
const OPENINGS = lib as unknown as Opening[];
const CACHE = 'node_modules/.cache';
const OUT = 'src/xiangqi/openingvars.json';

if (process.argv[2] === 'merge') {
  const all: Record<string, unknown> = {};
  for (const f of fs.readdirSync(CACHE).filter((n) => /^openingvars-\d+\.json$/.test(n)).sort()) Object.assign(all, JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')));
  const missing = OPENINGS.filter((o) => !all[o.id]).map((o) => o.id);
  if (missing.length) {
    console.log(`✗ 还没算：${missing.join('、')}`);
    process.exit(1);
  }
  // 合并时再把一遍关：
  //   - 变招的第一手，逐手讲解时引擎又说它差 0.6 个兵以上（分岔点 MultiPV 和逐手搜索的深度不一样，偶尔不一致）——
  //     标着"变招"、讲解里却说"差约 1.7 个兵"会把人弄糊涂，宁可不要；
  //   - 错着的第一手，逐手讲解时引擎没说它亏 1 个兵以上——"错着"站不住，也不要；
  //   - 两处措辞："一手捉住卒和卒"→"一手捉住两个卒"；往回退到中路的马不叫盘头马。
  const tidy = (m: LineMove | null) => {
    if (!m) return m;
    // 引擎的意见已经写进讲解里了（"引擎更想走 X，这一手差约……"），界面上不要再挂一遍
    delete m.loss;
    delete m.best;
    m.why = m.why
      .replace(/一手捉住([车马炮兵卒])和\1/g, '一手捉住两个$1')
      .replace(/同时捉住([车马炮兵卒](?:、[车马炮兵卒])+)/g, (_, list: string) => `同时捉住${countNames(list.split('、'))}`);
    if (m.t.includes('退')) m.why = m.why.replace(/^盘头马，支援中路/, '马退到中路，加强中防');
    return m;
  };
  type Ex = { main: (LineMove | null)[]; vars: (LineMove | null)[][]; extra: { kind: string; moves: LineMove[] }[] };
  let dropped = 0;
  const ordered: Record<string, Ex> = {};
  for (const o of OPENINGS) {
    const e = all[o.id] as Ex;
    const keep = e.extra.filter((x) => (x.kind === 'alt' ? !(x.moves[0].loss! >= 60) : (x.moves[0].loss ?? 0) >= 100));
    dropped += e.extra.length - keep.length;
    keep.forEach((x) => x.moves.forEach(tidy));
    e.main.forEach(tidy);
    e.vars.forEach((v) => v.forEach(tidy));
    ordered[o.id] = { ...e, extra: keep };
  }
  fs.writeFileSync(OUT, JSON.stringify(ordered));
  const ex = Object.values(ordered).flatMap((e) => e.extra);
  const plies = Object.values(ordered).reduce((s, e) => s + e.main.filter(Boolean).length + e.vars.flat().filter(Boolean).length, 0) + ex.reduce((s, x) => s + x.moves.length, 0);
  console.log(
    `写入 ${OUT}：${OPENINGS.length} 套，变招 ${ex.filter((x) => x.kind === 'alt').length}、错着 ${ex.filter((x) => x.kind === 'trap').length}（去掉 ${dropped} 条站不住的），讲解 ${plies} 手`,
  );
  process.exit(0);
}

const SHARD = Number(process.argv[2] ?? 0);
const SHARDS = Number(process.argv[3] ?? 1);
const MS = Number(process.argv[4] ?? 1500);
/** 变招：和首选差多少以内算"一样能走" */
const ALT = 70;
/** 错着：深算亏这么多以上 */
const TRAP = 180;
/** 一个分岔点最多几个变招；一套最多几个变招、几个错着 */
const PER_NODE = 2;
const MAX_ALT = 14;
const MAX_TRAP = 3;
/** 变招往下走几手、错着往下走几手 */
const ALT_PLIES = 12;
const TRAP_PLIES = 8;
/** 分岔点：主线和别的布局分开之后的这么多手以内 */
const SPAN = 16;

const e = await startPikafish(256);
const START = toFen(initialBoard(), 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn * 10 : -30000 - l.mateIn * 10) : l.score);
const sideName = (c: Color) => (c === 'r' ? '红方' : '黑方');

type Cand = { m: Move; score: number; pv: Move[] };
function lastLines(out: string[]): PvLine[] {
  const ls = out.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}
function toCands(ls: PvLine[], b: Board, c: Color): Cand[] {
  const legal = legalMoves(b, c);
  const out: Cand[] = [];
  for (const l of ls) {
    const m = l.pv[0] ? uciToMove(l.pv[0]) : null;
    if (!m || !legal.some((x) => same(x, m)) || out.some((x) => same(x.m, m))) continue;
    out.push({ m, score: val(l), pv: l.pv.map((u) => uciToMove(u)).filter((x): x is Move => !!x) });
  }
  return out;
}
/** 从开局起走 moves 之后的局面搜：前 mpv 名（走棋方视角） */
function search(moves: Move[], b: Board, c: Color, ms: number, mpv = 1, only?: Move): Cand[] {
  e.send(`setoption name MultiPV value ${only ? 1 : mpv}`);
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  return toCands(lastLines(e.send(`go movetime ${ms}${only ? ` searchmoves ${moveToUci(only)}` : ''}`)), b, c);
}
/** 浅算（看着自然的着法）：depth 层的前 n 名 */
function shallow(moves: Move[], b: Board, c: Color, depth: number, n: number): Cand[] {
  e.send(`setoption name MultiPV value ${n}`);
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  return toCands(lastLines(e.send(`go depth ${depth}`)), b, c);
}
/** 空着：同一个盘面改成 c 走，最想走哪一手、多少分（c 视角）。c 的对方被将着时没有空着 */
function nullBest(b: Board, c: Color, ms = 300): Cand | null {
  if (isInCheck(b, other(c))) return null;
  if (!legalMoves(b, c).length) return null;
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${toFen(b, c)} - - 0 1`);
  return toCands(lastLines(e.send(`go movetime ${ms}`)), b, c)[0] ?? null;
}
function nullOnly(b: Board, c: Color, m: Move, ms = 300): number | null {
  if (isInCheck(b, other(c))) return null;
  e.send('setoption name MultiPV value 1');
  e.send(`position fen ${toFen(b, c)} - - 0 1`);
  const r = toCands(lastLines(e.send(`go movetime ${ms} searchmoves ${moveToUci(m)}`)), b, c)[0];
  return r ? r.score : null;
}
const legalHas = (b: Board, c: Color, m: Move) => legalMoves(b, c).some((x) => same(x, m)) && !isInCheck(applyMove(b, m), c);

/**
 * 沿着 moves（从开局起）走到 from，然后按 texts 走（人写/指定的着法），再让引擎接着走到 total 手；
 * 从 annotateFrom 起（含）的每一手（book 的除外）配"意义"。返回从 from 起的着法。
 */
function annotate(prefix: Move[], texts: string[], total: number, keepWhy: (LineMove | null)[] = []): LineMove[] {
  let b = initialBoard();
  let c: Color = 'r';
  for (const m of prefix) {
    b = applyMove(b, m);
    c = other(c);
  }
  const moves = prefix.slice();
  const out: LineMove[] = [];
  let here = search(moves, b, c, MS)[0];
  for (let i = 0; i < total; i++) {
    if (statusAfter(b, c) !== 'playing' || !here) break;
    const given = i < texts.length ? textToMove(b, c, texts[i], legalMoves(b, c)) : null;
    if (i < texts.length && !given) throw new Error(`走不通：${texts[i]}`);
    const m = given ?? here.m;
    const t = moveToText(b, m);
    const after = applyMove(b, m);
    const opp = other(c);
    const keep = keepWhy[i];
    // 走之前对方的威胁（对方能连走一步）；人写的定式着法说明不动，就不用算
    const threatBefore = keep?.book || isInCheck(b, c) ? null : nullBest(b, opp);
    const evBeforeOpp = -here.score; // 对方视角，走之前
    moves.push(m);
    const st = statusAfter(after, opp);
    const next = st === 'playing' ? search(moves, after, opp, MS)[0] : undefined;
    const myAfter = next ? -next.score : st === 'playing' ? 0 : 30000; // 走棋方视角，走之后
    const ctx: MeaningCtx = {};
    const loss = Math.max(0, here.score - myAfter);
    if (!same(m, here.m)) ctx.best = { t: moveToText(b, here.m), loss };
    else ctx.isBest = true;
    // 只说实打实的威胁（吃子、将军、捉子……）：开局里"多走一步出子"本来就值一两个兵，那不叫威胁
    const threatNote = threatBefore ? briefOf(b, threatBefore.m, opp) : '';
    if (threatBefore && concrete(threatNote) && threatBefore.score - evBeforeOpp >= 150) {
      const tt = moveToText(b, threatBefore.m);
      let stopped = !legalHas(after, opp, threatBefore.m);
      if (!stopped) {
        const v2 = nullOnly(after, opp, threatBefore.m);
        stopped = v2 !== null && threatBefore.score - v2 >= 150;
      }
      if (stopped && !same(threatBefore.m, m)) ctx.stopped = { t: tt, what: keyNote(threatNote) };
    }
    const lastOfLine = i === total - 1;
    if (st === 'playing' && !keep?.book) {
      const mine = nullBest(after, c);
      const mineNote = mine ? briefOf(after, mine.m, c) : '';
      if (mine && concrete(mineNote) && mine.score - myAfter >= 150) ctx.threat = { t: moveToText(after, mine.m), what: keyNote(mineNote), gain: mine.score - myAfter };
      // 谱上接下来的着法本来就摆在那儿，"接下来"只在一条线的最后一手说
      if (next && lastOfLine) {
        ctx.reply = { t: moveToText(after, next.m), what: keyNote(briefOf(after, next.m, opp)) };
        const after2 = applyMove(after, next.m);
        const n2 = next.pv[1];
        if (n2 && legalHas(after2, c, n2)) ctx.next = { t: moveToText(after2, n2), what: keyNote(briefOf(after2, n2, c)) };
      }
    }
    // 谱上一路往下都是引擎首选，"引擎的首选"只在分出去的那一手说
    if (i > 0 && ctx.isBest) delete ctx.isBest;
    const why = keep?.book ? keep.why : meaningOf(b, m, c, ctx);
    const ev = c === 'r' ? myAfter : -myAfter;
    const lm: LineMove = { t, why, ev: Math.max(-30000, Math.min(30000, ev)) };
    if (keep?.book) lm.book = true;
    if (loss >= 60 && ctx.best) {
      lm.loss = loss;
      lm.best = ctx.best.t;
    }
    out.push(lm);
    b = after;
    c = opp;
    here = next as Cand;
  }
  return out;
}

function walk(texts: string[]): { board: Board; color: Color; moves: Move[] } {
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) throw new Error(`走不通：${t}`);
    moves.push(m);
    b = applyMove(b, m);
    c = other(c);
  }
  return { board: b, color: c, moves };
}

function finalWord(ev: number): string {
  if (Math.abs(ev) >= 20000) return ev > 0 ? '走到这里：红方杀棋' : '走到这里：黑方杀棋';
  if (Math.abs(ev) < 60) return '走到这里：双方均势';
  return `走到这里：${ev >= 0 ? '红方' : '黑方'}${outlookOf(Math.abs(ev)).replace(/^你/, '')}`;
}

/** 这一套和别的布局分开的那一手（从 0 数） */
function divergeAt(o: Opening): number {
  let k = 0;
  for (const p of OPENINGS) {
    if (p.id === o.id) continue;
    let i = 0;
    while (i < o.moves.length && i < p.moves.length && o.moves[i].t === p.moves[i].t) i++;
    k = Math.max(k, i);
  }
  return k;
}

/** 所有布局的主线、变化里出现过的局面（变招转进了别的谱，就不重复收） */
const known = new Set<string>();
for (const o of OPENINGS) {
  for (const line of [o.moves.map((m) => m.t), ...o.variations.map((v) => [...o.moves.slice(0, v.at).map((m) => m.t), ...v.moves.map((m) => m.t)])]) {
    try {
      const w = walk([]);
      let b = w.board;
      let c = w.color;
      for (const t of line) {
        const m = textToMove(b, c, t, legalMoves(b, c));
        if (!m) break;
        b = applyMove(b, m);
        c = other(c);
        known.add(toFen(b, c));
      }
    } catch {
      /* 跳过 */
    }
  }
}

type Extra = { name: string; at: number; kind: 'alt' | 'trap'; moves: LineMove[]; final: string };
const OUT_SHARD = `${CACHE}/openingvars-${SHARD}.json`;
const result: Record<string, unknown> = fs.existsSync(OUT_SHARD) ? JSON.parse(fs.readFileSync(OUT_SHARD, 'utf8')) : {};
const ONLY = process.env.ONLY?.split(',');

OPENINGS.forEach((o, idx) => {
  if (idx % SHARDS !== SHARD) return;
  if (ONLY && !ONLY.includes(o.id)) return;
  if (result[o.id] && !ONLY) return;
  const t0 = Date.now();
  e.send('ucinewgame');
  const mainTexts = o.moves.map((m) => m.t);
  // 1. 主线重新讲一遍（人写的定式说明不动）
  const main = annotate([], mainTexts, mainTexts.length, o.moves);
  // 2. 原有变化重新讲一遍
  const vars = o.variations.map((v) => {
    const pre = walk(mainTexts.slice(0, v.at)).moves;
    return annotate(pre, v.moves.map((m) => m.t), v.moves.length, v.moves);
  });
  // 3. 分岔点找变招、错着
  const lo = Math.max(2, divergeAt(o));
  const hi = Math.min(mainTexts.length - 2, lo + SPAN);
  const extra: Extra[] = [];
  let traps = 0;
  for (let i = lo; i < hi && extra.filter((x) => x.kind === 'alt').length < MAX_ALT; i++) {
    const w = walk(mainTexts.slice(0, i));
    const mainMove = textToMove(w.board, w.color, mainTexts[i], legalMoves(w.board, w.color))!;
    const existing = new Set(o.variations.filter((v) => v.at === i).map((v) => v.moves[0]?.t));
    const cands = search(w.moves, w.board, w.color, MS * 2, 4);
    if (!cands.length) continue;
    const best = cands[0].score;
    let took = 0;
    for (const cd of cands) {
      if (took >= PER_NODE || same(cd.m, mainMove)) continue;
      const t = moveToText(w.board, cd.m);
      if (existing.has(t) || best - cd.score > ALT) continue;
      const fen = toFen(applyMove(w.board, cd.m), other(w.color));
      if (known.has(fen)) continue;
      known.add(fen);
      const moves = annotate(w.moves, [t], ALT_PLIES);
      if (!moves.length) continue;
      extra.push({
        name: `第 ${Math.floor(i / 2) + 1} 回合${sideName(w.color)}改走 ${t}`,
        at: i,
        kind: 'alt',
        moves,
        final: finalWord(moves[moves.length - 1].ev),
      });
      took++;
    }
    // 看着自然、其实是错着
    if (traps < MAX_TRAP) {
      for (const sc of shallow(w.moves, w.board, w.color, 5, 4).slice(0, 3)) {
        if (same(sc.m, mainMove) || cands.some((x) => same(x.m, sc.m) && best - x.score <= ALT)) continue;
        const deep = search(w.moves, w.board, w.color, MS, 1, sc.m)[0];
        if (!deep || best - deep.score < TRAP) continue;
        const t = moveToText(w.board, sc.m);
        const fen = toFen(applyMove(w.board, sc.m), other(w.color));
        if (known.has(fen)) continue;
        known.add(fen);
        const moves = annotate(w.moves, [t], TRAP_PLIES);
        if (!moves.length) continue;
        extra.push({
          name: `第 ${Math.floor(i / 2) + 1} 回合${sideName(w.color)}走 ${t}（看着自然，其实是错着）`,
          at: i,
          kind: 'trap',
          moves,
          final: finalWord(moves[moves.length - 1].ev),
        });
        traps++;
        break;
      }
    }
  }
  result[o.id] = { main: main.map((m) => (m.book ? null : m)), vars: vars.map((v) => v.map((m) => (m.book ? null : m))), extra };
  fs.writeFileSync(OUT_SHARD, JSON.stringify(result));
  console.log(
    `${o.name}：分岔点 ${lo}–${hi}，变招 ${extra.filter((x) => x.kind === 'alt').length} 个、错着 ${extra.filter((x) => x.kind === 'trap').length} 个｜${Math.round((Date.now() - t0) / 1000)} 秒`,
  );
});
process.exit(0);
