/**
 * 残局阶梯里"步数对不上"的题重新核一遍。
 *
 * 切点复核 8 秒说"N 步杀"，示范解法却比 N 步短（有一道 57 步杀的示范 21 步就杀死了）：
 * 要么 8 秒没算到最快的杀，要么示范里守方走软了。两种情况下"最快 N 步"都说不准——
 * 标少了你用最好的走法也拿不到三星，标多了三星白送。
 *
 * 这里对每一道这样的题：
 *   1. 皮卡鱼算 30 秒，得到更可靠的杀棋步数 d；
 *   2. d 和示范解法步数一样 → 两边对上了，留下；
 *   3. 不一样 → 两边每手 5 秒重新下到将死，示范正好 d 步 → 换成新的示范，留下；
 *   4. 还对不上 → 删掉。宁可少一道，不标一个说不准的步数。
 * 直接改写 node_modules/.cache 里的阶梯产出，之后再跑 merge-mate-ladder。
 *
 *   node tools/run.mjs reverify-ladder <分片号> <分片数>
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { fromFen, moveToText, toFen } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';

const [, , shardArg = '0', shardsArg = '1'] = process.argv;
const SHARD = Number(shardArg);
const SHARDS = Number(shardsArg);
const LONG_MS = Number(process.env.LONG_MS ?? 30000);
const PLAY_MS = Number(process.env.PLAY_MS ?? 5000);
const CACHE = 'node_modules/.cache';
const e = await startPikafish(256);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

type Rec = { id: string; fen: string; you: Color; mateIn: number; solved: number; line: string[] };

function best(fen: string, ms: number): { move: Move | null; mateIn?: number } {
  e.send(`position fen ${fen} - - 0 1`);
  const lines = e.send(`go movetime ${ms}`);
  const infos = lines.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const bm = lines.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
  return { move: bm && bm !== '(none)' ? uciToMove(bm) : null, mateIn: infos[infos.length - 1]?.mateIn };
}

function playOut(board: Board, color: Color, maxPlies: number): { texts: string[]; mated: boolean } {
  const texts: string[] = [];
  let b = board;
  let c = color;
  for (let i = 0; i < maxPlies && statusAfter(b, c) === 'playing'; i++) {
    const r = best(toFen(b, c), PLAY_MS);
    const m = r.move && legalMoves(b, c).find((x) => same(x, r.move!));
    if (!m) break;
    texts.push(moveToText(b, m));
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return { texts, mated: statusAfter(b, c) !== 'playing' && c !== color };
}

// 只看 ladder / longladder / ladder20* 这几类产出里"步数对不上"的
const files = fs.readdirSync(CACHE).filter((n) => /^(ladder|longladder|ladder20[a-z]*)-\d+\.jsonl$/.test(n)).sort();
const todo: { file: string; idx: number; rec: Rec }[] = [];
const all: Record<string, Rec[]> = {};
for (const f of files) {
  all[f] = fs
    .readFileSync(`${CACHE}/${f}`, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Rec);
  all[f].forEach((rec, idx) => {
    if (rec.mateIn !== rec.solved) todo.push({ file: f, idx, rec });
  });
}
const mine = todo.filter((_, k) => k % SHARDS === SHARD);
console.log(`对不上的一共 ${todo.length} 道，这一片核 ${mine.length} 道`);

// 每一道的结论写到自己的文件里（几个分片同时跑，不能都去改同一份产出）
const OUT = `${CACHE}/reverify-${SHARD}.jsonl`;
fs.writeFileSync(OUT, '');
for (const t of mine) {
  const r = t.rec;
  const p = fromFen(r.fen)!;
  e.send('ucinewgame');
  const v = best(r.fen, LONG_MS);
  const d = v.mateIn !== undefined && v.mateIn > 0 ? v.mateIn : null;
  let verdict: { keep: boolean; mateIn?: number; line?: string[] };
  if (d !== null && d === r.solved) verdict = { keep: true, mateIn: d, line: r.line };
  else if (d !== null) {
    const re = playOut(p.board, p.toMove, 2 * d + 8);
    verdict = re.mated && Math.ceil(re.texts.length / 2) === d ? { keep: true, mateIn: d, line: re.texts } : { keep: false };
  } else verdict = { keep: false };
  fs.appendFileSync(OUT, JSON.stringify({ file: t.file, id: r.id, fen: r.fen, ...verdict }) + '\n');
  console.log(`  ${r.id}：原来标 ${r.mateIn}、示范 ${r.solved}；30 秒说 ${d ?? '没算到杀'} → ${verdict.keep ? `留下，${verdict.mateIn} 步` : '删掉'}`);
}
console.log(`分片 ${SHARD} 做完`);
process.exit(0);
