/**
 * 江湖布局（邪门布局）的变化扩充 + 破解谱、上当谱重新讲一遍（输出 src/xiangqi/trickvars.json，界面按需加载）。
 *
 * 用户原话："再增加详细教练讲解，江湖布局多一些变化。"
 * 原来每条套路只有一条破解谱、一条上当谱，外加几句"其它常见的错着"（只有文字，走不了）。实战里对方不会照着谱走，
 * 你也不一定走得出正解。沿着破解谱，邪门着之后的十几手里每一个分岔点，皮卡鱼 MultiPV 4 深算：
 *   - 他不按套路走（dev）：轮到设套一方，和他最好的一手差不到 1.5 个兵的其它走法——江湖套路本来就不讲究，
 *     他换一手你还认不认得、怎么接（每个点最多两个，一条套路最多六个），往下走 10 手；
 *   - 另一种破法（alt）：轮到你，和正解差不到 0.7 个兵的其它走法——练习时走这些也算对（最多四个），往下走 10 手；
 *   - 你走错了（wrong）：轮到你，浅算（5 层）排前三、深算却亏 1.8 个兵以上的——看着自然、其实亏（最多四个），
 *     往下走 8 手看他怎么罚；原来写在 wrong 里的常见错着也补成能走的谱。
 * 每一手配"意义"（tools/annotate-lib.ts，和布局变招一样：防住什么、威胁什么、接下来、引擎怎么看）。
 * 破解谱、上当谱里引擎延伸的那几手（原来只有"跳正马出动。"这种一句话）也重新讲一遍；人写的不动。
 *
 *   node tools/run.mjs expand-tricks [分片号 分片数] [每手毫秒=1500]  → node_modules/.cache/trickvars-<分片>.json
 *   node tools/run.mjs expand-tricks merge                            → src/xiangqi/trickvars.json
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { makeAnnotator, same, other, type LineMove } from './annotate-lib';
import { applyMove, initialBoard, legalMoves, type Color } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { countNames } from '../src/xiangqi/movenote';
import { TRICKS, lineToTrap, refuteLine, trapLine, type TrickOpening } from '../src/xiangqi/tricks';

const CACHE = 'node_modules/.cache';
const OUT = 'src/xiangqi/trickvars.json';

export type TrickVar = {
  name: string;
  kind: 'dev' | 'alt' | 'wrong';
  /** 在破解谱（refuteLine）的第几手分出去（从 0 数，0 = 邪门着之后的第一手） */
  at: number;
  moves: LineMove[];
  final: string;
  /** 原来 wrong 里人写的那句说明 */
  note?: string;
};
type Out = { refuteWhy: (string | null)[]; trapWhy: (string | null)[]; refuteEv: number[]; trapEv: number[]; vars: TrickVar[] };

const roundOf = (ply: number) => Math.floor(ply / 2) + 1;

if (process.argv[2] === 'merge') {
  const all: Record<string, Out> = {};
  for (const f of fs.readdirSync(CACHE).filter((n) => /^trickvars-\d+\.json$/.test(n)).sort()) Object.assign(all, JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')));
  const missing = TRICKS.filter((t) => !all[t.id]).map((t) => t.id);
  if (missing.length) {
    console.log(`✗ 还没算：${missing.join('、')}`);
    process.exit(1);
  }
  const tidy = (m: LineMove) => {
    delete m.loss;
    delete m.best;
    m.why = m.why
      .replace(/一手捉住([车马炮兵卒])和\1/g, '一手捉住两个$1')
      .replace(/同时捉住([车马炮兵卒](?:、[车马炮兵卒])+)/g, (_, list: string) => `同时捉住${countNames(list.split('、'))}`);
    return m;
  };
  let dropped = 0;
  const ordered: Record<string, Out> = {};
  for (const t of TRICKS) {
    const o = all[t.id];
    // 和布局变招一样把一遍关：标着"另一种破法"、讲解里引擎却说它差 0.6 个兵以上的不要；
    // 标着"你走错了"、引擎却没说它亏 1 个兵以上的也不要（人写的常见错着另说，它们本来就深算复核过）
    const keep = o.vars.filter((v) => (v.kind === 'alt' ? !(v.moves[0].loss! >= 60) : v.kind === 'wrong' && !v.note ? (v.moves[0].loss ?? 0) >= 100 : true));
    dropped += o.vars.length - keep.length;
    keep.forEach((v) => v.moves.forEach(tidy));
    ordered[t.id] = { ...o, vars: keep };
  }
  fs.writeFileSync(OUT, JSON.stringify(ordered));
  const vs = Object.values(ordered).flatMap((o) => o.vars);
  const n = (k: string) => vs.filter((v) => v.kind === k).length;
  const plies = vs.reduce((s, v) => s + v.moves.length, 0) + Object.values(ordered).reduce((s, o) => s + [...o.refuteWhy, ...o.trapWhy].filter(Boolean).length, 0);
  console.log(`写入 ${OUT}：${TRICKS.length} 条套路，他不按套路走 ${n('dev')}、另一种破法 ${n('alt')}、你走错了 ${n('wrong')}（去掉 ${dropped} 条站不住的），讲解 ${plies} 手`);
  process.exit(0);
}

const SHARD = Number(process.argv[2] ?? 0);
const SHARDS = Number(process.argv[3] ?? 1);
const MS = Number(process.argv[4] ?? 1500);
/** 他改走：和他最好的一手差多少以内（江湖套路本来就不讲究，放宽一些） */
const DEV = 150;
/** 另一种破法：和正解差多少以内 */
const ALT = 70;
/** 你走错了：深算亏这么多以上 */
const TRAP = 180;
const MAX_DEV = 6;
const MAX_ALT = 4;
const MAX_WRONG = 4;
const DEV_PLIES = 10;
const ALT_PLIES = 10;
const WRONG_PLIES = 8;
/** 分岔点：邪门着之后的这么多手以内 */
const SPAN = 14;

const e = await startPikafish(256);
const { search, shallow, annotate, walk, finalWord } = makeAnnotator(e, MS);

const OUT_SHARD = `${CACHE}/trickvars-${SHARD}.json`;
const result: Record<string, Out> = fs.existsSync(OUT_SHARD) ? JSON.parse(fs.readFileSync(OUT_SHARD, 'utf8')) : {};
const ONLY = process.env.ONLY?.split(',');

/** 一条线上出现过的局面 */
function fensOf(texts: string[], known: Set<string>) {
  let b = initialBoard();
  let c: Color = 'r';
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) break;
    b = applyMove(b, m);
    c = other(c);
    known.add(toFen(b, c));
  }
}

function expand(t: TrickOpening): Out {
  e.send('ucinewgame');
  const start = [...t.pre, t.trick.t];
  const R = refuteLine(t);
  const T = trapLine(t);
  const victim = other(t.by);
  // 1. 破解谱、上当谱重新讲一遍：人写的那几手不动，引擎延伸的配上意义
  const keepR = R.map((s, i) => (i < t.refute.length ? { t: s.t, why: s.why, ev: 0, book: true } : null));
  const rNew = annotate(walk(start).moves, R.map((s) => s.t), R.length, keepR);
  const keepT = T.map((s, i) => (i < t.trap.length ? { t: s.t, why: s.why, ev: 0, book: true } : null));
  const tNew = annotate(walk(lineToTrap(t)).moves, T.map((s) => s.t), T.length, keepT);
  const refuteWhy = R.map((_, i) => (i < t.refute.length || !rNew[i] ? null : rNew[i].why));
  const trapWhy = T.map((_, i) => (i < t.trap.length || !tNew[i] ? null : tNew[i].why));

  // 2. 分岔点
  const known = new Set<string>();
  fensOf([...start, ...R.map((s) => s.t)], known);
  fensOf([...lineToTrap(t), ...T.map((s) => s.t)], known);
  const vars: TrickVar[] = [];
  const count = (k: TrickVar['kind']) => vars.filter((v) => v.kind === k).length;
  const add = (at: number, kind: TrickVar['kind'], tx: string, plies: number, name: string, note?: string) => {
    const w = walk([...start, ...R.slice(0, at).map((s) => s.t)]);
    const m = textToMove(w.board, w.color, tx, legalMoves(w.board, w.color));
    if (!m) return false;
    const fen = toFen(applyMove(w.board, m), other(w.color));
    if (known.has(fen)) return false;
    known.add(fen);
    const moves = annotate(w.moves, [tx], plies);
    if (!moves.length) return false;
    vars.push({ name, kind, at, moves, final: finalWord(moves[moves.length - 1].ev), ...(note ? { note } : {}) });
    return true;
  };
  // 人写的常见错着先补成能走的谱
  for (const w of t.wrong ?? []) {
    const ply = start.length + w.at;
    add(w.at, 'wrong', w.t, WRONG_PLIES, `第 ${roundOf(ply)} 回合你走 ${w.t}（常见错着）`, w.why);
  }
  for (let i = 0; i < Math.min(R.length - 2, SPAN); i++) {
    const w = walk([...start, ...R.slice(0, i).map((s) => s.t)]);
    const main = textToMove(w.board, w.color, R[i].t, legalMoves(w.board, w.color))!;
    const ply = start.length + i;
    const cands = search(w.moves, w.board, w.color, MS * 2, 4);
    if (!cands.length) continue;
    const best = cands[0].score;
    if (w.color === t.by) {
      let took = 0;
      for (const cd of cands) {
        if (took >= 2 || count('dev') >= MAX_DEV || same(cd.m, main) || best - cd.score > DEV) continue;
        const tx = moveToText(w.board, cd.m);
        if (add(i, 'dev', tx, DEV_PLIES, `第 ${roundOf(ply)} 回合他改走 ${tx}`)) took++;
      }
      continue;
    }
    if (w.color !== victim) continue;
    for (const cd of cands) {
      if (count('alt') >= MAX_ALT || same(cd.m, main) || best - cd.score > ALT) continue;
      const tx = moveToText(w.board, cd.m);
      if (add(i, 'alt', tx, ALT_PLIES, `第 ${roundOf(ply)} 回合另一种破法：${tx}`)) break;
    }
    if (count('wrong') >= MAX_WRONG) continue;
    // 上当谱本来就是分岔处的那一手，不重复
    const trapMove = i === (t.trapAfter ?? 0) ? T[0]?.t : undefined;
    for (const sc of shallow(w.moves, w.board, w.color, 5, 4).slice(0, 3)) {
      const tx = moveToText(w.board, sc.m);
      if (same(sc.m, main) || tx === trapMove || cands.some((x) => same(x.m, sc.m) && best - x.score <= ALT)) continue;
      const deep = search(w.moves, w.board, w.color, MS, 1, sc.m)[0];
      if (!deep || best - deep.score < TRAP) continue;
      if (add(i, 'wrong', tx, WRONG_PLIES, `第 ${roundOf(ply)} 回合你走 ${tx}（看着自然，其实亏）`)) break;
    }
  }
  vars.sort((a, b) => a.at - b.at);
  return {
    refuteWhy,
    trapWhy,
    refuteEv: rNew.map((m) => m.ev),
    trapEv: tNew.map((m) => m.ev),
    vars,
  };
}

TRICKS.forEach((t, idx) => {
  if (idx % SHARDS !== SHARD) return;
  if (ONLY && !ONLY.includes(t.id)) return;
  if (result[t.id] && !ONLY) return;
  const t0 = Date.now();
  result[t.id] = expand(t);
  fs.writeFileSync(OUT_SHARD, JSON.stringify(result));
  const v = result[t.id].vars;
  console.log(
    `${t.name}：他改走 ${v.filter((x) => x.kind === 'dev').length}、另一种破法 ${v.filter((x) => x.kind === 'alt').length}、你走错了 ${v.filter((x) => x.kind === 'wrong').length}｜${Math.round((Date.now() - t0) / 1000)} 秒`,
  );
});
process.exit(0);
