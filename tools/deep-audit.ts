/**
 * 全题库深度复核（第一步）：每道题主变上轮到解题方的每一步，皮卡鱼多线（MultiPV 5）深算到指定层数，
 * 记下前几名着法的分数和主变；主变那一手不在前几名里就单独算它。结果写进 node_modules/.cache/deep-audit-<分片>.jsonl，
 * 断了接着跑（已经算过的题跳过）。怎么判、怎么改题库在 deep-apply 里。
 *
 * 用户原话："这个局面错误的走法最后红方能把黑方杀掉，但正确的走法走完之后发现是均势。我觉得要从深度思考的决定、
 * 从最终的结果，再去判定这个走法合不合适。所以这整个所有的局面你都要再去过一遍。"
 *
 * 原来题库里的结论大多是一两百万节点（十四五层）定的，做题时核对别的走法只算 1.5 秒（手机上十二三层）——
 * 截图那道题，浅算说"兵七平六比车八进五差两个兵"，可两手对下到底都是和棋。
 *
 *   node tools/run.mjs deep-audit <分片号> <分片数> [层数=20] [每步节点上限=12000000] [题库文件] [first|rest|all]
 *   first 只算每道题的第一步（最要紧：答案对不对、"只有这一手"成不成立、局面分），rest 只算后面几步
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { parseInfo, moveToUci, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { fromFen, moveToText, textToMove } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves, type Board, type Color, type Move } from '../src/xiangqi/rules';

const [, , a0 = '0', a1 = '1', a2 = '20', a3 = '12000000', a4 = 'src/xiangqi/puzzles.json', a5 = 'all'] = process.argv;
const WHICH = a5;
const shard = Number(a0);
const nShards = Number(a1);
const DEPTH = Number(a2);
const NODES = Number(a3);
const SRC = a4;
const tag = SRC.includes('counterkill') ? 'ck' : 'pz';
const OUT = `node_modules/.cache/deep-audit-${tag}-${shard}.jsonl`;
const MULTI = 5;

const e = await startPikafish(256);
e.send(`setoption name MultiPV value ${MULTI}`);
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

type P = { id: string; kind: string; fen: string; answer: string; line: string[]; goal?: string; ev?: number; ev2?: number };
export interface Cand {
  t: string;
  score: number;
  mate?: number;
  pv: string[];
}
export interface StepRec {
  id: string;
  /** 主变里第几手（0、2、4……轮到解题方） */
  ply: number;
  line: string;
  depth: number;
  cands: Cand[];
}

// 别的分片（分片数改过也算）已经算过的步不重算
const done = new Set<string>();
for (const f of fs.readdirSync('node_modules/.cache').filter((n) => n.startsWith(`deep-audit-${tag}-`) && n.endsWith('.jsonl')))
  for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) if (l.trim()) done.add(JSON.parse(l).id + '#' + JSON.parse(l).ply);

const pvText = (b0: Board, c0: Color, pv: string[], n = 10) => {
  let b = b0;
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    const m = uciToMove(u);
    if (!m || !b[m.fy]?.[m.fx]) break;
    out.push(moveToText(b, m));
    b = applyMove(b, m);
  }
  void c0;
  return out;
};

/** 搜到 DEPTH 层（或者节点用完），每一名取它最后一次完整的结果 */
function search(fen: string, ucis: string[], extra = ''): { depth: number; lines: PvLine[] } {
  e.send('ucinewgame');
  e.send(`position fen ${fen} - - 0 1${ucis.length ? ` moves ${ucis.join(' ')}` : ''}`);
  const got = e.send(`go depth ${DEPTH} nodes ${NODES}${extra}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(0, ...got.map((l) => l.depth));
  const best = new Map<number, PvLine>();
  // 最深那一层完整给出的几名；最后一层没搜完的名次用上一层的
  for (const l of got) if (l.depth >= depth - 1 && (!best.has(l.multipv) || best.get(l.multipv)!.depth <= l.depth)) best.set(l.multipv, l);
  return { depth, lines: [...best.values()].sort((a, b) => a.multipv - b.multipv) };
}

const puz = (JSON.parse(fs.readFileSync(SRC, 'utf8')) as P[]).filter((_, i) => i % nShards === shard);
const t0 = Date.now();
let n = 0;
for (const p of puz) {
  const f = fromFen(p.fen);
  if (!f) continue;
  let b = f.board;
  let c = f.toMove;
  const ucis: string[] = [];
  for (let ply = 0; ply < p.line.length; ply++) {
    const lm = textToMove(b, c, p.line[ply], legal(b, c));
    if (!lm) break;
    const want = WHICH === 'all' || (WHICH === 'first' ? ply === 0 : ply > 0);
    if (ply % 2 === 0 && want && !done.has(`${p.id}#${ply}`)) {
      const r = search(p.fen, ucis);
      const cands: Cand[] = r.lines.map((l) => ({ t: pvText(b, c, l.pv, 1)[0], score: l.score, mate: l.mateIn, pv: pvText(b, c, l.pv) }));
      if (!cands.some((x) => x.t === p.line[ply])) {
        const one = search(p.fen, ucis, ` searchmoves ${moveToUci(lm)}`).lines[0];
        if (one) cands.push({ t: p.line[ply], score: one.score, mate: one.mateIn, pv: pvText(b, c, one.pv) });
      }
      const rec: StepRec = { id: p.id, ply, line: p.line[ply], depth: r.depth, cands };
      fs.appendFileSync(OUT, JSON.stringify(rec) + '\n');
      n++;
      if (n % 20 === 0) console.log(`[${shard}] ${n} 步，${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
    }
    if (WHICH === 'first') break;
    b = applyMove(b, lm);
    c = other(c);
    ucis.push(moveToUci(lm));
  }
}
console.log(`[${shard}] 完成 ${n} 步，${((Date.now() - t0) / 60000).toFixed(1)} 分钟`);
