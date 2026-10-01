/**
 * 残局阶梯：5 步 / 10 步 / 15 步 / 20 步杀，按子力体系分组。
 *
 * 做法：残局库里每一个"能赢"的局面，让皮卡鱼两边都按最好的走、一直下到将死，
 * 这一条线上"进攻方还剩 5、10、15、20 步将死"的那几个局面就是各档的题；
 * 每一个再单独深算一遍，确认它真的是那么多步杀（引擎找到更快的杀就按更快的算）。
 * 同一个残局在不同档出现：先练最后 5 步怎么收，再往前推到 10 步、15 步、20 步——
 * 这正是残局"体系化"的学法：从终点往回学。
 *
 *   node tools/run.mjs gen-mate-ladder <分片号> <分片数>
 * 输出 node_modules/.cache/ladder-<分片>.jsonl，再用 merge-mate-ladder 并进 src/xiangqi/mateladder.json
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { fromFen, moveToText, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';

const [, , shardArg = '0', shardsArg = '1'] = process.argv;
const SHARD = Number(shardArg);
const SHARDS = Number(shardsArg);
// 只切哪几档（长杀局面专门切 15、20 两档）：TIERS=15,20
const TIERS = (process.env.TIERS ?? '5,10,15,20').split(',').map(Number);
// 素材：默认是残局库里的胜局；INPUT=xxx.jsonl 换成别的局面（比如 gen-long-mates 找的长杀局面）
const INPUT = process.env.INPUT ?? '';
const TAG = process.env.TAG ?? 'ladder';
const PLAY_MS = 1200;
const VERIFY_MS = 8000;

const lib = (INPUT
  ? fs.readFileSync(INPUT, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
  : JSON.parse(fs.readFileSync('src/xiangqi/endgamelib.json', 'utf8'))) as {
  id: string;
  name: string;
  category: string;
  material: string;
  fen: string;
  you: Color;
  target: string;
}[];
const e = await startPikafish(256);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

function best(fen: string, ms: number): { move: Move | null; mateIn?: number; score: number } {
  e.send(`position fen ${fen} - - 0 1`);
  const lines = e.send(`go movetime ${ms}`);
  const infos = lines.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const last = infos[infos.length - 1];
  const bm = lines.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
  return { move: bm && bm !== '(none)' ? uciToMove(bm) : null, mateIn: last?.mateIn, score: last?.score ?? 0 };
}

/** 从这个局面两边按引擎最好的一直走到将死（最多 maxPlies 手）；返回着法和每一步之前的局面 */
function playOut(board: Board, color: Color, maxPlies: number, ms: number) {
  const fens: string[] = [];
  const moves: Move[] = [];
  const texts: string[] = [];
  let b = board;
  let c = color;
  for (let i = 0; i < maxPlies; i++) {
    if (statusAfter(b, c) !== 'playing') break;
    const fen = toFen(b, c);
    fens.push(fen);
    const r = best(fen, ms);
    const legal = legalMoves(b, c);
    const m = r.move && legal.find((x) => same(x, r.move!));
    if (!m) break;
    texts.push(moveToText(b, m));
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  const mated = statusAfter(b, c) !== 'playing';
  return { fens, moves, texts, mated, loser: c };
}

// 逐条同步追加：引擎调用是同步阻塞的，事件循环转不起来，createWriteStream 的内容要到最后才落盘，
// 而结尾的 process.exit() 不等它——整轮跑完一个字都没写进去（残局阶梯第一轮就这样丢了一百分钟的结果）
const OUT_FILE = `node_modules/.cache/${TAG}-${SHARD}.jsonl`;
fs.writeFileSync(OUT_FILE, '');
const out = { write: (s: string) => fs.appendFileSync(OUT_FILE, s), end: () => {} };
const wins = lib.filter((x) => x.target === 'win');
let done = 0;
let found = 0;
for (let i = SHARD; i < wins.length; i += SHARDS) {
  const p = wins[i];
  const parsed = fromFen(p.fen);
  if (!parsed) continue;
  e.send('ucinewgame');
  const g = playOut(parsed.board, parsed.toMove, 90, PLAY_MS);
  done++;
  if (!g.mated || g.loser === p.you) {
    console.log(`  ${p.id}：${g.texts.length} 手没下出将死，跳过`);
    continue;
  }
  // 进攻方走的着法下标：和 you 同色的那几手
  const attackIdx: number[] = [];
  for (let k = 0; k < g.fens.length; k++) if (g.fens[k].split(' ')[1] === (p.you === 'r' ? 'w' : 'b')) attackIdx.push(k);
  const A = attackIdx.length;
  const seen = new Set<number>();
  for (const t of TIERS) {
    if (t > A) continue;
    const k = attackIdx[A - t];
    const fen = g.fens[k];
    const v = best(fen, VERIFY_MS);
    const d = v.mateIn !== undefined && v.mateIn > 0 ? v.mateIn : null;
    if (!d || seen.has(d)) continue;
    // 引擎找到了更快的杀：按引擎的步数算，解法也重新按引擎走一遍
    let line = g.texts.slice(k);
    if (d !== t) {
      const pf = fromFen(fen)!;
      const re = playOut(pf.board, pf.toMove, 2 * d + 4, 3000);
      if (!re.mated) continue;
      line = re.texts;
    }
    const myMoves = Math.ceil(line.length / 2);
    seen.add(d);
    found++;
    const rec = { id: `ml-${p.id}-${d}`, src: p.id, name: p.name, category: p.category, material: p.material, fen, you: p.you, mateIn: d, solved: myMoves, line };
    out.write(JSON.stringify(rec) + '\n');
    console.log(`  ${p.id}：剩 ${t} 步处引擎确认 ${d} 步杀（解法 ${myMoves} 步）`);
  }
  console.log(`[${done}] ${p.name} ${p.id}：整盘 ${A} 步杀`);
}
out.end();
console.log(`分片 ${SHARD}：${done} 个局面，找到 ${found} 道阶梯题`);
process.exit(0);
