/**
 * 教练按多少层下结论才靠得住：拿 top-level-check 攒下的局面，按层数（10、12、14、16、18）各选一手，
 * 再用 200 万节点复核这一手比最好的亏多少。教练研究算到 minDepth 层就开始判，这里量的是那个门槛该定多高。
 *
 * 用法：node tools/run.mjs depth-check <分片号> <分片数>
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';

const [, , a0 = '0', a1 = '1'] = process.argv;
const shard = Number(a0);
const nShards = Number(a1);
const e = await startPikafish(64);
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);

function go(fen: string, cmd: string): PvLine | undefined {
  e.send(`position fen ${fen} - - 0 1`);
  const got = e.send(cmd).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound && x.multipv === 1);
  return got[got.length - 1];
}

const fens = fs
  .readdirSync('node_modules/.cache')
  .filter((f) => /^toplevel-\d+\.jsonl$/.test(f))
  .sort()
  .flatMap((f) => fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').trim().split('\n').map((l) => JSON.parse(l).fen as string))
  .filter((_, i) => i % nShards === shard);
const DEPTHS = [10, 12, 14, 16, 18];
const out: string[] = [];
for (const fen of fens) {
  e.send('setoption name MultiPV value 1');
  const picks = DEPTHS.map((d) => {
    e.send('ucinewgame');
    const l = go(fen, `go depth ${d}`);
    return l?.pv[0];
  });
  e.send('ucinewgame');
  const ref = go(fen, 'go nodes 2000000');
  if (!ref) continue;
  const bestS = val(ref);
  const cache = new Map<string, number>([[ref.pv[0], bestS]]);
  const loss = picks.map((u) => {
    if (!u) return null;
    if (!cache.has(u)) {
      const m = uciToMove(u);
      const one = m && go(fen, `go nodes 2000000 searchmoves ${moveToUci(m)}`);
      cache.set(u, one ? val(one) : bestS);
    }
    return Math.max(0, bestS - cache.get(u)!);
  });
  out.push(JSON.stringify({ fen, best: bestS, loss }));
  console.log(`shard ${shard}: ${out.length}/${fens.length} loss=${loss.join(',')}`);
}
fs.writeFileSync(`node_modules/.cache/depth-${shard}.jsonl`, out.join('\n') + '\n');
console.log(`shard ${shard} done`);
process.exit(0);
