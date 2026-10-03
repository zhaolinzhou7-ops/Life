/**
 * 离线工具共用的"沿着一条线让皮卡鱼讲每一手"（布局变招 tools/expand-openings.ts、江湖布局变化 tools/expand-tricks.ts）。
 *
 * annotate()：从某个局面起，先按给定的着法走，再让引擎接着走到够手数，每一手配"意义"（movemeaning.ts）——
 * 干了什么 + 防住了对方什么（空着搜索）+ 威胁什么 + 一条线最后一手说接下来怎么走 + 引擎怎么看。
 * search() / shallow()：MultiPV 深算、浅算（找"看着自然、其实是错着"）。
 */
import type { NodeEngine } from './pikafish-node';
import { applyMove, initialBoard, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { briefOf, concrete, keyNote, meaningOf, type MeaningCtx } from '../src/xiangqi/movemeaning';
import { outlookOf } from '../src/xiangqi/plan';

export type LineMove = { t: string; why: string; ev: number; loss?: number; best?: string; book?: boolean };
export type Cand = { m: Move; score: number; pv: Move[] };

export const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
export const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
export const sideName = (c: Color) => (c === 'r' ? '红方' : '黑方');

/** e：引擎；MS：逐手讲解时每手算多久 */
export function makeAnnotator(e: NodeEngine, MS: number) {
  const START = toFen(initialBoard(), 'r');
  const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn * 10 : -30000 - l.mateIn * 10) : l.score);

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
  return { search, shallow, nullBest, annotate, walk, finalWord };
}
