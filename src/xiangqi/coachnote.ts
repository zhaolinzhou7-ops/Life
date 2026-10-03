/**
 * 教练讲解：一条线（布局主线、变招、错着、江湖布局的破解/上当/变化）讲完每一手之后，再像教练那样点两句——
 *   ⭐ 关键一手：这条线上局面变化最大的那一手（按皮卡鱼每一手之后的局面分算），讲解里标出来，说清楚局面从什么变成什么；
 *   🧑‍🏫 教练小结：这一路在干什么、关键在哪一手、走到最后谁好、要记住什么。
 * 用户原话："再增加详细教练讲解。"
 *
 * 只用谱上已有的东西拼：每一手的局面分（引擎算的）、那一手自己的讲解（movemeaning 配的）、收尾的局面判断。
 * 不编着法、不编理由——分数没有明显变化的线就不硬找"关键一手"。
 */
import type { Color } from './rules';

/** 红方视角的分 → 一句局面判断 */
export function evWords(ev: number): string {
  if (Math.abs(ev) >= 20000) return ev > 0 ? '红方有杀' : '黑方有杀';
  const a = Math.abs(ev);
  if (a < 60) return '均势';
  const who = ev > 0 ? '红方' : '黑方';
  if (a >= 900) return `${who}大优`;
  if (a >= 420) return `${who}占优（约多一个马炮）`;
  if (a >= 150) return `${who}稍优（约多${Math.round(a / 100)}个兵）`;
  return `${who}略好`;
}

export interface KeyMove {
  /** 在这串着法里的下标 */
  i: number;
  /** 走棋方视角，这一手让局面变了多少（正 = 变好） */
  swing: number;
  before: number;
  after: number;
}

/** 分数夹到 ±2000 再比：杀棋的分动辄三万，直接比会把"已经赢定之后多走一步"当成关键 */
const clamp = (v: number) => Math.max(-2000, Math.min(2000, v));
const side = (c: Color) => (c === 'r' ? '红' : '黑');

/**
 * 关键一手：局面分变化最大（按走棋方算，变好变坏都算）的那一手。
 * evBefore 是第一手之前的局面分（红方视角）；firstMover 是第一手谁走。
 * 变化不到 1 个兵、或者局面判断的说法没变的，不算——那种线没有"关键一手"。
 */
export function keyMove(moves: { ev: number }[], evBefore: number, firstMover: Color): KeyMove | null {
  let best: KeyMove | null = null;
  let prev = evBefore;
  let c = firstMover;
  moves.forEach((m, i) => {
    const swing = (clamp(m.ev) - clamp(prev)) * (c === 'r' ? 1 : -1);
    if (Math.abs(swing) >= 100 && evWords(prev) !== evWords(m.ev) && (!best || Math.abs(swing) > Math.abs(best.swing))) best = { i, swing, before: prev, after: m.ev };
    prev = m.ev;
    c = c === 'r' ? 'b' : 'r';
  });
  return best;
}

/** 讲解里那一手前面加上"⭐ 关键一手"的说明 */
export function keyTag(k: KeyMove, mover: Color): string {
  const good = k.swing > 0;
  return `<span class="xq-key">⭐ <b>关键一手</b>：${side(mover)}方${good ? '这一手把局面' : '这一手让局面'}从「${evWords(k.before)}」${good ? '扳成' : '变成'}「${evWords(k.after)}」。</span>`;
}

/** 讲解里第一句（干了什么） */
const firstClause = (why: string) => why.replace(/<[^>]+>/g, '').split(/[。]/)[0];

export type LineKind = 'main' | 'alt' | 'trap' | 'var' | 'dev' | 'refute' | 'fall' | 'wrong';

/**
 * 教练小结：一条线的开场白后面接这一段。
 * ply0：第一手是从开局起的第几手（算回合用）；moves 带着每一手的讲解和局面分。
 */
export function lineSummary(opts: {
  kind: LineKind;
  moves: { t: string; why: string; ev: number }[];
  evBefore: number;
  firstMover: Color;
  ply0: number;
  /** 正解（错着、他改走的那一手原来谱上是什么） */
  mainMove?: string;
}): string {
  const { kind, moves, evBefore, firstMover, ply0 } = opts;
  if (!moves.length) return '';
  const first = moves[0];
  const round = (i: number) => Math.floor((ply0 + i) / 2) + 1;
  const moverOf = (i: number): Color => ((i % 2 === 0) === (firstMover === 'r') ? 'r' : 'b');
  const parts: string[] = [];
  const what = firstClause(first.why);
  const best = /引擎更想走 <b>(.+?)<\/b>，这一手差约 ([\d.]+) 个兵/.exec(first.why);
  if (kind === 'trap' || kind === 'wrong') {
    parts.push(
      `${side(firstMover)}方第 ${round(0)} 回合走 <b>${first.t}</b>（${what}）看着很自然${
        best ? `，可引擎算下来比 <b>${best[1]}</b> 差约 ${best[2]} 个兵` : opts.mainMove ? `，正解是 <b>${opts.mainMove}</b>` : ''
      }。`,
    );
  } else if (kind === 'dev') {
    parts.push(`他没按套路走，第 ${round(0)} 回合改走 <b>${first.t}</b>（${what}）${opts.mainMove ? `，原来谱上是 ${opts.mainMove}` : ''}。认出来以后照着下面的应法走，便宜照样拿得到。`);
  } else if (kind === 'alt' || kind === 'var') {
    parts.push(`第 ${round(0)} 回合${side(firstMover)}方走 <b>${first.t}</b>（${what}）${opts.mainMove ? `，和 ${opts.mainMove} 是两条路` : ''}，引擎认为差不多一样好。`);
  }
  const k = keyMove(moves, evBefore, firstMover);
  if (k) {
    const m = moves[k.i];
    parts.push(`关键在第 ${round(k.i)} 回合${side(moverOf(k.i))}方的 <b>${m.t}</b>（${firstClause(m.why)}）：局面从「${evWords(k.before)}」变成「${evWords(k.after)}」。`);
  } else if (moves.length >= 4) {
    // 没有哪一手让局面大起大落：也是一句实话——这一路靠的是每一手都不松
    const a = evWords(evBefore);
    const z = evWords(moves[moves.length - 1].ev);
    parts.push(`这一路没有一步定输赢的地方，${a === z ? `局面一直是「${a}」` : `局面从「${a}」一路走到「${z}」`}，靠的是每一手都不松。`);
  }
  const end = moves[moves.length - 1].ev;
  parts.push(`走到最后：${evWords(end)}。`);
  if (kind === 'trap' || kind === 'wrong') parts.push('要记住的不是这几步着法，而是那一刻少想了什么——讲解里每一手的"防住了 / 威胁"就是对方在算的东西。');
  else if (kind === 'dev') parts.push('江湖套路走法多变，认的是形，不是死背着法：他图什么、你先手在哪，讲解里每一手都写着。');
  return `<div class="xq-coach-sum">🧑‍🏫 <b>教练小结</b>　${parts.join('')}</div>`;
}

/** 给一串讲解打上"关键一手"：返回新的着法（why 前面加了标记） */
export function withKey<T extends { t: string; why: string; ev: number }>(moves: T[], evBefore: number, firstMover: Color): T[] {
  const k = keyMove(moves, evBefore, firstMover);
  if (!k) return moves;
  const mover: Color = (k.i % 2 === 0) === (firstMover === 'r') ? 'r' : 'b';
  return moves.map((m, i) => (i === k.i ? { ...m, why: `${keyTag(k, mover)}${m.why}` } : m));
}
