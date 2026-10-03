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
import { makeAnnotator, same, other, sideName, type LineMove } from './annotate-lib';
import { applyMove, initialBoard, legalMoves, type Color } from '../src/xiangqi/rules';
import { moveToText, textToMove, toFen } from '../src/xiangqi/notation';
import { shapesOf } from '../src/xiangqi/movemeaning';
import { countNames } from '../src/xiangqi/movenote';
import lib from '../src/xiangqi/openinglib.json';

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
  type Ex = { main: (LineMove | null)[]; vars: (LineMove | null)[][]; extra: { kind: string; at: number; moves: LineMove[] }[] };
  // 形状（给车让路、亮车、封车……）是规则算的：说明模块加了新形状，合并时沿着谱重算一遍补进第一句，不用重跑引擎
  let reshaped = 0;
  const reshape = (texts: string[], notes: (LineMove | null)[], from: number) => {
    let b = initialBoard();
    let c: Color = 'r';
    texts.forEach((t, i) => {
      const m = textToMove(b, c, t, legalMoves(b, c));
      if (!m) throw new Error(`走不通：${texts.slice(0, i + 1).join(' ')}`);
      const note = i >= from ? notes[i - from] : null;
      if (note) {
        const add = shapesOf(b, m, c).filter((x) => !note.why.includes(x.split('：')[0]));
        if (add.length) {
          const first = note.why.indexOf('。');
          let head = note.why.slice(0, first);
          if (add.some((x) => x.startsWith('亮车'))) head = head.replace('，给车让出了路', '');
          note.why = `${head}，${add.join('，')}${note.why.slice(first)}`;
          reshaped++;
        }
      }
      b = applyMove(b, m);
      c = c === 'r' ? 'b' : 'r'; // 合并在模块顶上就跑了，下面的 other() 还没定义
    });
  };
  let dropped = 0;
  const ordered: Record<string, Ex> = {};
  for (const o of OPENINGS) {
    const e = all[o.id] as Ex;
    const keep = e.extra.filter((x) => (x.kind === 'alt' ? !(x.moves[0].loss! >= 60) : (x.moves[0].loss ?? 0) >= 100));
    dropped += e.extra.length - keep.length;
    keep.forEach((x) => x.moves.forEach(tidy));
    e.main.forEach(tidy);
    e.vars.forEach((v) => v.forEach(tidy));
    const main = o.moves.map((m) => m.t);
    reshape(main, e.main, 0);
    o.variations.forEach((v, k) => reshape([...main.slice(0, v.at), ...v.moves.map((m) => m.t)], e.vars[k], v.at));
    for (const x of keep) reshape([...main.slice(0, x.at), ...x.moves.map((m) => m.t)], x.moves, x.at);
    ordered[o.id] = { ...e, extra: keep };
  }
  fs.writeFileSync(OUT, JSON.stringify(ordered));
  const ex = Object.values(ordered).flatMap((e) => e.extra);
  const plies = Object.values(ordered).reduce((s, e) => s + e.main.filter(Boolean).length + e.vars.flat().filter(Boolean).length, 0) + ex.reduce((s, x) => s + x.moves.length, 0);
  console.log(
    `写入 ${OUT}：${OPENINGS.length} 套，变招 ${ex.filter((x) => x.kind === 'alt').length}、错着 ${ex.filter((x) => x.kind === 'trap').length}（去掉 ${dropped} 条站不住的），讲解 ${plies} 手，补形状 ${reshaped} 手`,
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
const { search, shallow, annotate, walk, finalWord } = makeAnnotator(e, MS);

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
