/**
 * 邪门布局的破解谱、上当谱往深里走，并且每一手都记下引擎分。
 *
 * 用户原话："破解往往不是三四步的事，可能需要十几步甚至更深入的思考"；
 * "算法的思考深度是有问题的"——所以这里每一手都深算（默认 6 秒，约 17～18 层），不是两三秒的快棋分。
 *
 * 每一条套路产出：
 *   - refute / trap：人写的破解、上当之后，皮卡鱼两边按最好的接着走（每一手配一句说明）；
 *   - evRefute / evTrap：整条线（从开局起）每走一手之后的局面分（红方视角，车≈1000）——
 *     界面上和子力差画在一起：上当那条线上设套的一方子力少了、分却没掉，就是"宁失一子，不失一先"；
 *   - miss：上当那条线上，被骗一方哪几手走错了、该走什么、差多少（深算比出来的，差 1.2 个兵以上才记）。
 *
 *   node tools/run.mjs deepen-tricks [每手毫秒=6000] [分片号 分片数]   → node_modules/.cache/trickdeep-<分片>.json
 *   node tools/run.mjs deepen-tricks merge                               → 合并成 src/xiangqi/trickdeep.json
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { noteMove } from '../src/xiangqi/movenote';
import { TRICKS, lineToTrap, type TrickOpening } from '../src/xiangqi/tricks';

const CACHE = 'node_modules/.cache';
if (process.argv[2] === 'merge') {
  const out: Record<string, unknown> = {};
  for (const f of fs.readdirSync(CACHE).filter((n) => /^trickdeep-\d+\.json$/.test(n)).sort()) {
    Object.assign(out, JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')));
  }
  const missing = TRICKS.filter((t) => !out[t.id]).map((t) => t.id);
  if (missing.length) {
    console.log(`✗ 还没算：${missing.join('、')}`);
    process.exit(1);
  }
  const ordered: Record<string, unknown> = {};
  for (const t of TRICKS) ordered[t.id] = out[t.id];
  fs.writeFileSync('src/xiangqi/trickdeep.json', JSON.stringify(ordered));
  console.log(`写入 src/xiangqi/trickdeep.json：${TRICKS.length} 条`);
  process.exit(0);
}

const MS = Number(process.argv[2] ?? 6000);
const SHARD = Number(process.argv[3] ?? 0);
const SHARDS = Number(process.argv[4] ?? 1);
/** 破解谱总长（从邪门着之后算，双方合计） */
const REFUTE_PLIES = 24;
/** 上当谱总长（从分岔处算）：要走到对方把便宜兑现 */
const TRAP_PLIES = 16;
/** 被骗一方差这么多以上，记为"这一步是坑" */
const MISS_AT = 120;
const e = await startPikafish(256);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn * 10 : -30000 - l.mateIn * 10) : l.score);
const clampEv = (v: number) => Math.max(-30000, Math.min(30000, v));

type Line = { board: Board; color: Color; moves: Move[]; texts: string[] };
function walk(texts: string[]): Line {
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) throw new Error(`走不通：${t}（${texts.join(' ')}）`);
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return { board: b, color: c, moves, texts: texts.slice() };
}

/** 深算一个局面：最好的一手和分（走棋一方视角）；only 给了就只算这一手 */
function search(moves: Move[], only?: Move): { m: Move | null; score: number } {
  e.send('setoption name MultiPV value 1');
  e.send(`position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const out = e.send(`go movetime ${only ? Math.round(MS * 0.7) : MS}${only ? ` searchmoves ${moveToUci(only)}` : ''}`);
  const infos = out.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const last = infos[infos.length - 1];
  const bm = out.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
  return { m: bm && bm !== '(none)' ? uciToMove(bm) : null, score: last ? val(last) : 0 };
}

/**
 * 沿着 texts 走（人写的部分），走完再让引擎接着走到 total 手；
 * 每一手之后记局面分（红方视角），被骗一方（victim）在人写部分里的错着记下来。
 */
function run(texts: string[], total: number, victim: Color, missFrom: number) {
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  const ev: number[] = [];
  const ext: { t: string; why: string; ev: number }[] = [];
  const miss: Record<number, { best: string; loss: number }> = {};
  let cur = search(moves);
  for (let i = 0; i < total; i++) {
    if (statusAfter(b, c) !== 'playing') break;
    let m: Move | null;
    const human = i < texts.length;
    if (human) {
      m = textToMove(b, c, texts[i], legalMoves(b, c));
      if (!m) throw new Error(`走不通：${texts[i]}`);
      // 被骗一方人写的着法：和深算首选比一比
      if (c === victim && i >= missFrom && cur.m && !same(cur.m, m)) {
        const mine = search(moves, m);
        const loss = cur.score - mine.score;
        if (loss >= MISS_AT) miss[i] = { best: moveToText(b, cur.m), loss: Math.min(loss, 9999) };
      }
    } else {
      m = cur.m && legalMoves(b, c).some((x) => same(x, cur.m!)) ? cur.m : null;
      if (!m) break;
    }
    const why = human ? '' : noteMove(b, m, c);
    const t = moveToText(b, m);
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
    const st = statusAfter(b, c);
    if (st === 'playing') {
      cur = search(moves);
      ev.push(clampEv(c === 'r' ? cur.score : -cur.score));
    } else {
      // 走完就分出胜负：赢的是刚走的那一方
      ev.push(c === 'r' ? -30000 : 30000);
    }
    if (!human) ext.push({ t, why, ev: ev[ev.length - 1] });
  }
  return { ev, ext, miss };
}

function deepen(t: TrickOpening) {
  const victim: Color = t.by === 'r' ? 'b' : 'r';
  const base = [...t.pre, t.trick.t];
  e.send('ucinewgame');
  const r = run([...base, ...t.refute.map((s) => s.t)], base.length + Math.max(REFUTE_PLIES, t.refute.length), victim, Infinity);
  const fork = lineToTrap(t);
  e.send('ucinewgame');
  const trapTexts = [...fork, ...t.trap.map((s) => s.t)];
  const p = run(trapTexts, fork.length + Math.max(TRAP_PLIES, t.trap.length), victim, 0);
  return {
    refute: r.ext,
    trap: p.ext,
    evRefute: r.ev,
    evTrap: p.ev,
    miss: p.miss,
  };
}

const OUT = `${CACHE}/trickdeep-${SHARD}.json`;
const result: Record<string, unknown> = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : {};
const only = process.env.ONLY?.split(',');
TRICKS.forEach((t, i) => {
  if (i % SHARDS !== SHARD) return;
  if (only && !only.includes(t.id)) return;
  const t0 = Date.now();
  const d = deepen(t);
  result[t.id] = d;
  fs.writeFileSync(OUT, JSON.stringify(result));
  const missTxt = Object.entries(d.miss)
    .map(([k, v]) => `第${Number(k) + 1}手该走${v.best}（差${v.loss}）`)
    .join('，');
  console.log(
    `${t.name}：破解延伸 ${d.refute.length} 手（走完 ${d.evRefute[d.evRefute.length - 1]}），上当延伸 ${d.trap.length} 手（走完 ${
      d.evTrap[d.evTrap.length - 1]
    }）${missTxt ? `；坑：${missTxt}` : ''}｜${Math.round((Date.now() - t0) / 1000)} 秒`,
  );
});
process.exit(0);
