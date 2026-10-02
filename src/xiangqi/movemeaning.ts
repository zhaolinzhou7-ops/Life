/**
 * 一手棋的"意义"：不只说看得见的事（movenote.ts），还要说清楚**为什么走这一手**。
 *
 * 用户原话："多增加一些布局后的变招，每一步变招的意义讲清楚。"
 * 讲清楚一手棋，要回答四个问题——每一条都要有引擎或规则算出来的依据，不猜：
 *   1. 它干了什么（movenote：出车、过河、捉马、兑炮……）+ 几个布局里常见的形状
 *      （给车让路、炮封车、别马腿、邀兑、占肋道）——规则算出来；
 *   2. 它防了什么：走之前，对方要是能连走一步，最想走哪一手（皮卡鱼"空着"搜索）；
 *      走完之后那一手不灵了（不能走了，或者少赚一个半兵以上），就是"防住了"；
 *   3. 它威胁什么：走完之后，自己要是能连走一步，最想走哪一手、能多赚多少；
 *   4. 接下来：皮卡鱼的主变里，对方多半怎么应、自己再怎么走。
 * 最后加一句引擎的意见：这一手是不是首选、差多少。
 *
 * 引擎那几项由离线工具（tools/expand-openings.ts）算好传进来；浏览器里的"候选着"也走同一个函数。
 */
import { applyMove, isInCheck, legalMoves, type Board, type Color, type Move, type PType } from './rules';
import { attackersOf, other } from './teach';
import { pieceName } from './notation';
import { noteMove } from './movenote';

export interface MeaningCtx {
  /** 走之前引擎的首选（不是这一手、而且差得多时才说）：首选着法、这一手差多少（走棋方视角，≥0） */
  best?: { t: string; loss: number };
  /** 这一手就是引擎首选 */
  isBest?: boolean;
  /** 走之前对方的威胁，这一手把它化解了：对方那一手、那一手是干什么的 */
  stopped?: { t: string; what: string };
  /** 走完之后自己的威胁：对方不理的话下一步走什么、干什么、能多赚多少（走棋方视角） */
  threat?: { t: string; what: string; gain: number };
  /** 引擎主变：对方多半怎么应、自己再怎么走（各带一句干什么） */
  reply?: { t: string; what: string };
  next?: { t: string; what: string };
}

/** 按顿号外层的逗号切分句（括号里的逗号不切） */
function clauses(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of s.replace(/。$/, '')) {
    if (ch === '（') depth++;
    if (ch === '）') depth = Math.max(0, depth - 1);
    if (ch === '，' && depth === 0) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out.filter(Boolean);
}

/** 去掉句号，取第一个分句——拿来接在别的话里 */
export function shortNote(s: string): string {
  return clauses(s)[0] ?? '';
}

/** 一句说明里最要紧的部分：将军、杀、吃子、兑子、捉子优先，没有才说怎么走 */
export function keyNote(s: string): string {
  const cs = clauses(s);
  // "顺手保护了被捉的子"里的"捉"不是捉对方
  const pri = [/将军|有杀/, /吃/, /兑/, /(?<!被)捉/, /封住|别住/, /过河|直插|沉到/];
  const picked: string[] = [];
  for (const re of pri) for (const c of cs) if (re.test(c) && !picked.includes(c) && picked.length < 2) picked.push(c);
  return picked.length ? picked.join('，') : (cs[0] ?? '');
}

/** 这一手是不是实打实的威胁（吃子、将军、杀、捉子、兑子），而不是"多走一步出子" */
export const concrete = (note: string) => /吃|(?<!被)捉|将军|有杀|兑/.test(note);

const isRook = (b: Board, x: number, y: number, c: Color) => b[y]?.[x]?.c === c && b[y][x]!.t === 'R';

/** 某个车能往前走几步（直线，碰到子就停） */
function rookReachForward(b: Board, x: number, y: number, c: Color): number {
  const dir = c === 'r' ? -1 : 1;
  let n = 0;
  for (let yy = y + dir; yy >= 0 && yy <= 9; yy += dir) {
    if (b[yy][x]) break;
    n++;
  }
  return n;
}

/** 这个马往前跳的几个落点里，有几个能跳（马腿没被别住、落点不是自己的子） */
function horseForwardJumps(b: Board, x: number, y: number, c: Color): number {
  const dir = c === 'r' ? -1 : 1;
  let n = 0;
  for (const [dx, dy, lx, ly] of [
    [-1, 2 * dir, 0, dir],
    [1, 2 * dir, 0, dir],
    [-2, dir, -1, 0],
    [2, dir, 1, 0],
  ]) {
    const tx = x + dx;
    const ty = y + dy;
    if (tx < 0 || tx > 8 || ty < 0 || ty > 9) continue;
    if (b[y + ly][x + lx]) continue;
    if (b[ty][tx]?.c === c) continue;
    n++;
  }
  return n;
}

/** 布局里常见的几个形状：规则算得出来的才说 */
export function shapesOf(before: Board, m: Move, mover: Color): string[] {
  const p = before[m.fy][m.fx];
  if (!p) return [];
  const opp = other(mover);
  const after = applyMove(before, m);
  const out: string[] = [];
  const back = mover === 'r' ? 9 : 0;

  // 给车让路：底线上的马、炮走开以后，旁边的车能横着出来了
  if ((p.t === 'H' || p.t === 'C') && m.fy === back) {
    for (const dx of [-1, 1]) {
      const rx = m.fx + dx;
      if (rx >= 0 && rx <= 8 && isRook(after, rx, back, mover)) {
        // 车原来横着出不来（被这个子挡着），现在能过来了
        out.push('给车让出了路');
        break;
      }
    }
  }

  // 亮车：走开以后这一路通了，底线上旁边的车平过来就能顺着这一路往前出（原来这一路被它挡着，比如平边炮亮车）
  if (p.t !== 'R' && m.fx !== m.tx && !after[back][m.fx]) {
    for (const dx of [-1, 1]) {
      const rx = m.fx + dx;
      if (rx < 0 || rx > 8 || !isRook(after, rx, back, mover)) continue;
      const was = before[back][m.fx] ? 0 : rookReachForward(before, m.fx, back, mover);
      const now = rookReachForward(after, m.fx, back, mover);
      // 车自己那一路本来就通的（往前能走三步以上），用不着亮
      const own = rookReachForward(after, rx, back, mover);
      if (was <= 1 && now >= 3 && own <= 2 && now >= own + 2) {
        out.push(`亮车：${pieceName('R', mover)}平过来就能从这一路出动`);
        break;
      }
    }
  }

  // 炮封车：炮落在对方车的那条直线上、挡在车前面，车往前最多走两步
  if (p.t === 'C') {
    for (let y = 0; y < 10; y++) {
      if (!isRook(after, m.tx, y, opp)) continue;
      const between = mover === 'r' ? y < m.ty : y > m.ty; // 对方的车在对方那一侧，炮挡在它前面
      if (!between) continue;
      const nowReach = rookReachForward(after, m.tx, y, opp);
      const wasReach = rookReachForward(before, m.tx, y, opp);
      if (nowReach <= 2 && wasReach > nowReach + 1) out.push(`封住对方的${pieceName('R', opp)}（${pieceName('R', opp)}往前出不来）`);
    }
  }

  // 别马腿：走到对方马的马腿上，把它往前跳的路堵掉
  for (let y = 0; y < 10; y++) {
    for (let x = 0; x < 9; x++) {
      const q = after[y][x];
      if (!q || q.c !== opp || q.t !== 'H') continue;
      const adj = Math.abs(x - m.tx) + Math.abs(y - m.ty) === 1;
      if (!adj) continue;
      if (horseForwardJumps(after, x, y, opp) < horseForwardJumps(before, x, y, opp)) {
        out.push(`别住对方${pieceName('H', opp)}的马腿`);
        break;
      }
    }
  }

  // 邀兑：走过去和对方同种的子对上了，互相能吃、而且都有保护
  if ((p.t === 'R' || p.t === 'C' || p.t === 'H') && !before[m.ty][m.tx]) {
    const meAttacked = attackersOf(after, m.tx, m.ty, opp).find((a) => after[a.fy][a.fx]?.t === p.t);
    if (meAttacked) {
      const guarded = attackersOf(applyMove(after, meAttacked), m.tx, m.ty, mover).length > 0;
      if (guarded) out.push(`邀兑${pieceName(p.t as PType, opp)}`);
    }
  }

  // 占肋道：车停在四路、六路（对方九宫的两条边线）
  if (p.t === 'R' && (m.tx === 3 || m.tx === 5) && m.fx !== m.tx) out.push('占住肋道');

  // 亮车比"给车让出了路"说得具体，两个都成立只说亮车
  const res = out.some((x) => x.startsWith('亮车')) ? out.filter((x) => x !== '给车让出了路') : out;
  return [...new Set(res)];
}

/**
 * 一手棋的意义：干了什么 → 为什么（防 / 攻）→ 接下来 → 引擎怎么看。
 * 返回一段话（带少量 <b>），给布局浏览器和布局谱用。
 */
export function meaningOf(before: Board, m: Move, mover: Color, ctx: MeaningCtx = {}): string {
  const fact = noteMove(before, m, mover).replace(/。$/, '');
  const shapes = shapesOf(before, m, mover).filter((s) => !fact.includes(s));
  const parts: string[] = [[fact, ...shapes].join('，') + '。'];

  const why: string[] = [];
  if (ctx.stopped) why.push(`防住了对方的 <b>${ctx.stopped.t}</b>（${ctx.stopped.what}）`);
  if (ctx.threat && ctx.threat.gain >= 150) why.push(`威胁下一步 <b>${ctx.threat.t}</b>（${ctx.threat.what}）`);
  if (why.length) parts.push(`目的：${why.join('；')}。`);

  if (ctx.reply) {
    parts.push(
      `接下来对方多半走 <b>${ctx.reply.t}</b>（${ctx.reply.what}）${ctx.next ? `，你再 <b>${ctx.next.t}</b>（${ctx.next.what}）` : ''}。`,
    );
  }

  if (ctx.best && ctx.best.loss >= 60) parts.push(`引擎更想走 <b>${ctx.best.t}</b>，这一手差约 ${(ctx.best.loss / 100).toFixed(1)} 个兵。`);
  else if (ctx.best) parts.push(`和引擎的首选 ${ctx.best.t} 差不多一样好。`);
  else if (ctx.isBest) parts.push('引擎的首选。');
  return parts.join('');
}

/** 一手棋在某个局面里的一句短说明（给"候选着"列表用）：干了什么 + 形状 */
export function briefOf(before: Board, m: Move, mover: Color): string {
  const fact = noteMove(before, m, mover).replace(/。$/, '');
  const shapes = shapesOf(before, m, mover).filter((s) => !fact.includes(s));
  return [fact, ...shapes].join('，');
}

/** "空着"局面：轮到对方的局面改成轮到自己（被将军时没有空着） */
export function nullMoveOk(b: Board, toMove: Color): boolean {
  return !isInCheck(b, toMove) && legalMoves(b, other(toMove)).length > 0;
}
