/**
 * 自带引擎改前改后对下：同一批开局局面，两边各执一次红黑，每步同样的时间。
 * 改后的版本是 think 里开着对弈剪枝（setPlayPruning(true)），改前是关着。
 *
 *   node tools/run.mjs fallback-match <分片号> <分片数>      TIME=600 GAMES=40
 *
 * 结果：node_modules/.cache/fallback-match-<分片号>.json
 */
import fs from 'fs';
import { evaluatePosition, setPlayPruning, think } from '../src/xiangqi/ai';
import { fromFen, toFen } from '../src/xiangqi/notation';
import { applyMove, statusAfter, type Board, type Color } from '../src/xiangqi/rules';

const [, , a0 = '0', a1 = '1'] = process.argv;
const shard = Number(a0);
const nShards = Number(a1);
const TIME = Number(process.env.TIME ?? 600);
const GAMES = Number(process.env.GAMES ?? 40);
const MAX_PLY = 220;

type P = { id: string; kind: string; fen: string };
const puz = JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')) as P[];
const opens = puz.filter((p) => p.kind === 'opening');
const step = Math.max(1, Math.floor(opens.length / (GAMES / 2)));
const starts = opens.filter((_, i) => i % step === 0).slice(0, GAMES / 2).filter((_, i) => i % nShards === shard);

/** 返回改后版本这盘的得分：1 赢、0.5 和、0 输 */
function play(fen: string, newIs: Color): { score: number; why: string; plies: number } {
  const f = fromFen(fen)!;
  let b: Board = f.board;
  let c: Color = f.toMove;
  const seen = new Map<string, number>();
  for (let ply = 0; ply < MAX_PLY; ply++) {
    const key = toFen(b, c);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return { score: 0.5, why: '重复', plies: ply };
    setPlayPruning(c === newIs);
    const m = think(b, c, { maxDepth: 64, timeMs: TIME, jitter: 0 });
    if (!m) return { score: c === newIs ? 0 : 1, why: '无着', plies: ply };
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
    const st = statusAfter(b, c);
    if (st !== 'playing') {
      const winner: Color = st === 'red-win' ? 'r' : 'b';
      return { score: winner === newIs ? 1 : 0, why: '杀', plies: ply + 1 };
    }
  }
  // 步数到了：静态分差三个兵以上算赢，否则和
  const ev = evaluatePosition(b) * (newIs === 'r' ? 1 : -1);
  return { score: ev > 300 ? 1 : ev < -300 ? 0 : 0.5, why: `步数到了 ${ev}`, plies: MAX_PLY };
}

const out: { id: string; newIs: Color; score: number; why: string; plies: number }[] = [];
for (const s of starts) {
  for (const newIs of ['r', 'b'] as Color[]) {
    const r = play(s.fen, newIs);
    out.push({ id: s.id, newIs, ...r });
    const tot = out.reduce((a, x) => a + x.score, 0);
    console.log(`shard ${shard} ${out.length}/${starts.length * 2}  ${s.id} 改后执${newIs === 'r' ? '红' : '黑'} ${r.score}（${r.why}，${r.plies} 手）  累计 ${tot}/${out.length}`);
    fs.writeFileSync(`node_modules/.cache/fallback-match-${shard}.json`, JSON.stringify(out));
  }
}
process.exit(0);
