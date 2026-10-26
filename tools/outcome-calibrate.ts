/**
 * "分差多大，最后的结果才不一样"：拿 deep-audit 第一步的结果，挑首选和别的着法都还在胜负未分那一段的几对，
 * 按分差分档，每对两手各让皮卡鱼两边对下到底，看结果一样不一样。做题时"别的走法也站得住"的分差门槛照这个定。
 *
 * 用户原话："我觉得要从深度思考的决定、从最终的结果，再去判定这个走法合不合适。"
 *
 * 对下的规矩：每手 NODES 个节点；领先一方（深算 150 分以上）不许走回出现过的局面（不然两边来回晃，
 * 全成了三次重复的"和"）；分差一连 6 手都在 1500 以上就算这一方赢了（再下也是把子吃光）；60 回合不吃子、三次重复算和。
 *
 *   node tools/run.mjs outcome-calibrate <分片号> <分片数> [每档几对=6] [每手节点=200000]
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { parseInfo, uciToMove, moveToUci, type PvLine } from '../src/xiangqi/pikafish';
import { fromFen, textToMove, toFen } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color } from '../src/xiangqi/rules';
import { isLost, isWon } from '../src/xiangqi/analysis';

const [, , a0 = '0', a1 = '1', a2 = '6', a3 = '200000'] = process.argv;
const shard = Number(a0);
const nShards = Number(a1);
const PER = Number(a2);
const NODES = Number(a3);
const OUT = `node_modules/.cache/calib-${process.env.CALIB_TAG ?? ''}${shard}.jsonl`;
// 分档可以用 CALIB_BINS='150-250,250-350' 换；已经下过的题（calib-*.jsonl 里有的）不再挑
const BINS: [number, number][] = process.env.CALIB_BINS
  ? process.env.CALIB_BINS.split(',').map((x) => x.split('-').map(Number) as [number, number])
  : [
      [80, 150],
      [150, 250],
      [250, 350],
      [350, 450],
      [450, 600],
    ];
const already = new Set<string>();
for (const f of fs.readdirSync('node_modules/.cache').filter((n) => /^calib-.*\.jsonl$/.test(n)))
  for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) if (l.trim()) already.add(JSON.parse(l).id);

const e = await startPikafish(128);
e.send('setoption name MultiPV value 2');
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

type Cand = { t: string; score: number; mate?: number };
type Rec = { id: string; ply: number; cands: Cand[] };
const puz = new Map((JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')) as { id: string; fen: string; kind: string; goal?: string }[]).map((p) => [p.id, p]));
const pairs: { id: string; fen: string; best: Cand; alt: Cand; bin: number }[] = [];
const recs: Rec[] = [];
for (const f of fs.readdirSync('node_modules/.cache').filter((n) => /^deep-audit-pz-\d+\.jsonl$/.test(n)))
  for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) if (l.trim()) recs.push(JSON.parse(l));
recs.sort((a, b) => (a.id < b.id ? -1 : 1));
const taken = BINS.map(() => 0);
for (const r of recs) {
  const p = puz.get(r.id);
  if (r.ply !== 0 || !p || p.kind === 'mate' || p.goal === 'mate' || already.has(r.id)) continue;
  const best = r.cands[0];
  if (best.mate !== undefined || isWon(best)) continue;
  for (const alt of r.cands.slice(1)) {
    if (alt.mate !== undefined || isLost(alt)) continue;
    const loss = best.score - alt.score;
    const bin = BINS.findIndex(([lo, hi]) => loss >= lo && loss < hi);
    if (bin < 0 || taken[bin] >= PER * nShards) continue;
    taken[bin]++;
    pairs.push({ id: r.id, fen: p.fen, best, alt, bin });
    break;
  }
}
// 只看一个局面：CUSTOM='<fen>|<着法,着法,…>'，每一手各下 REPEAT 盘（默认 2）
if (process.env.CUSTOM) {
  const [fen, ms] = process.env.CUSTOM.split('|');
  for (let k = 0; k < Number(process.env.REPEAT ?? 2); k++)
    for (const t of ms.split(',')) {
      const t0 = Date.now();
      const r = playOut(fen, t);
      console.log(`${t}：${r.res}（${r.why}，${r.plies} 手，${Math.round((Date.now() - t0) / 1000)} 秒）`);
    }
  process.exit(0);
}
const mine = pairs.filter((_, i) => i % nShards === shard);
console.log(`[${shard}] ${mine.length} 对`);

function go(b: Board, c: Color, hist: string[], start: string): { lines: PvLine[] } {
  e.send(`position fen ${start} - - 0 1${hist.length ? ` moves ${hist.join(' ')}` : ''}`);
  const got = e.send(`go nodes ${NODES}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const d = Math.max(...got.map((l) => l.depth));
  return { lines: [1, 2].map((k) => [...got].reverse().find((l) => l.multipv === k && l.depth >= d - 1)).filter((x): x is PvLine => !!x) };
}

/** 从 solver 走完那一手起对下到底；返回 solver 视角的结果 */
function playOut(fen: string, first: string): { res: 'win' | 'draw' | 'loss'; plies: number; why: string } {
  const f = fromFen(fen)!;
  const solver = f.toMove;
  let b = f.board;
  let c = f.toMove;
  const m0 = textToMove(b, c, first, legal(b, c))!;
  const hist = [moveToUci(m0)];
  b = applyMove(b, m0);
  c = other(c);
  e.send('ucinewgame');
  const seen = new Map<string, number>([[toFen(b, c), 1]]);
  let quiet = 0;
  let streak = 0;
  let lead: Color | null = null;
  for (let ply = 1; ply < 260; ply++) {
    if (statusAfter(b, c) !== 'playing') return { res: c === solver ? 'loss' : 'win', plies: ply, why: '将死/困毙' };
    const { lines } = go(b, c, hist, fen);
    const top = lines[0];
    // 一方大优一连六手：算它赢
    const sc = top.mateIn !== undefined ? (top.mateIn > 0 ? 30000 : -30000) : top.score;
    const who: Color = sc > 0 ? c : other(c);
    if (Math.abs(sc) >= 1500) {
      streak = lead === who ? streak + 1 : 1;
      lead = who;
      if (streak >= 6) return { res: who === solver ? 'win' : 'loss', plies: ply, why: '大优一连六手' };
    } else streak = 0;
    let mv = uciToMove(top.pv[0])!;
    if (sc >= 150 && lines[1]) {
      const nb = applyMove(b, mv);
      if ((seen.get(toFen(nb, other(c))) ?? 0) >= 1) {
        const alt = lines[1];
        if (sc - alt.score < 120) mv = uciToMove(alt.pv[0])!;
      }
    }
    const cap = !!b[mv.ty][mv.tx];
    hist.push(moveToUci(mv));
    b = applyMove(b, mv);
    c = other(c);
    quiet = cap ? 0 : quiet + 1;
    if (quiet >= 120) return { res: 'draw', plies: ply, why: '60 回合不吃子' };
    const k = toFen(b, c);
    seen.set(k, (seen.get(k) ?? 0) + 1);
    if (seen.get(k)! >= 3) return { res: 'draw', plies: ply, why: '三次重复' };
  }
  return { res: 'draw', plies: 260, why: '下满了' };
}

for (const pr of mine) {
  const t0 = Date.now();
  const a = playOut(pr.fen, pr.best.t);
  const b = playOut(pr.fen, pr.alt.t);
  const rec = { ...pr, loss: pr.best.score - pr.alt.score, bestRes: a, altRes: b, same: a.res === b.res, sec: Math.round((Date.now() - t0) / 1000) };
  fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
  console.log(`[${shard}] ${pr.id} 档${pr.bin} 差${rec.loss}：首选 ${pr.best.t} ${a.res}（${a.why} ${a.plies}）／${pr.alt.t} ${b.res}（${b.why} ${b.plies}） ${rec.sec}s`);
}
