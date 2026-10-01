// 临时探针：长线残局随机摆子，短算的分数和真下到将死的步数对得上多少
import { startPikafish } from './pikafish-node';
import { applyMove, isInCheck, legalMoves, statusAfter, type Color, type Move } from '../src/xiangqi/rules';
import { toFen } from '../src/xiangqi/notation';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { randomPosition, type GroupSpec } from './endgame-place';
const G: GroupSpec[] = [
  { name: '马兵对士象全', category: '马类', att: 'HP', def: 'AAEE', you: 'att' },
  { name: '双马对士象全', category: '组合', att: 'HH', def: 'AAEE', you: 'att' },
  { name: '炮兵对士象全', category: '炮类', att: 'CP', attGuard: 'AA', def: 'AAEE', you: 'att' },
];
const e = await startPikafish(128);
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
function go(fen: string, ms: number) {
  e.send(`position fen ${fen} - - 0 1`);
  const lines = e.send(`go movetime ${ms}`);
  const infos = lines.map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const bm = lines.find((l) => l.startsWith('bestmove'))?.split(/\s+/)[1];
  return { last: infos[infos.length - 1], bm };
}
for (const g of G) {
  for (let k = 0; k < 8; k++) {
    const att: Color = Math.random() < 0.5 ? 'r' : 'b';
    const b0 = randomPosition(g, att);
    if (!b0 || isInCheck(b0, 'r') || isInCheck(b0, 'b')) continue;
    e.send('ucinewgame');
    const q = go(toFen(b0, att), 1500).last;
    if (!q) continue;
    let b = b0, c: Color = att, n = 0;
    for (; n < 140 && statusAfter(b, c) === 'playing'; n++) {
      const r = go(toFen(b, c), 600);
      const m = r.bm && uciToMove(r.bm);
      const mv = m && legalMoves(b, c).find((x) => same(x, m));
      if (!mv) break;
      b = applyMove(b, mv);
      c = c === 'r' ? 'b' : 'r';
    }
    const mated = statusAfter(b, c) !== 'playing' && c !== att;
    console.log(`${g.name} 短算 ${q.mateIn !== undefined ? 'mate ' + q.mateIn : 'cp ' + q.score}  → ${mated ? '下了 ' + Math.ceil(n / 2) + ' 步杀' : '没杀死(' + n + '手)'}`);
  }
}
process.exit(0);
