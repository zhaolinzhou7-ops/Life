/**
 * 邪门布局破解的闸门：tricks.ts 里写的每一句结论，都要皮卡鱼当场复核一遍。
 *
 *   - 所有着法走得通（前缀、邪门着、破解、上当）
 *   - 邪门着本身确实亏（比最好的走法差 60 以上）——不亏的不叫邪门，是正常布局
 *   - 破解那一手是（接近）最好的：和引擎首选差不到 150
 *   - 上当那一手确实亏：比破解差 150 以上
 *   - 破解之后，破解方比邪门着之前的处境好（对方白亏了）
 *   - 写在数据里的数和复核结果对得上（差 250 以内——引擎每次算的深浅不同，数会浮动）
 * 用法：node tools/run.mjs check-tricks
 */
import { startPikafish } from './pikafish-node';
import { applyMove, legalMoves, type Move } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { TRICKS, walkMoves } from '../src/xiangqi/tricks';

const MS = Number(process.env.MS ?? 2500);
const e = await startPikafish(256);
const pos = (moves: Move[]) => `position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`;
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 : -30000) : l.score);
function best(moves: Move[]): number {
  e.send(pos(moves));
  const r = e.send(`go movetime ${MS}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  return val(r[r.length - 1]);
}
function only(moves: Move[], m: Move): number {
  e.send(pos(moves));
  const r = e.send(`go movetime ${MS} searchmoves ${moveToUci(m)}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  return val(r[r.length - 1]);
}

let bad = 0;
const fail = (id: string, msg: string) => {
  console.log(`  ✗ ${id}：${msg}`);
  bad++;
};
for (const t of TRICKS) {
  const pre = walkMoves(t.pre);
  const all = walkMoves([...t.pre, t.trick.t]);
  const refute = walkMoves([...t.pre, t.trick.t, ...t.refute.map((s) => s.t)]);
  const trap = walkMoves([...t.pre, t.trick.t, ...t.trap.map((s) => s.t)]);
  if (!pre || !all || !refute || !trap) {
    fail(t.id, '有着法走不通');
    continue;
  }
  if (pre.color !== t.by) fail(t.id, `邪门着应该是${t.by === 'r' ? '红' : '黑'}方走`);
  for (const alt of t.refute[0].alts ?? []) {
    if (!textToMove(all.board, all.color, alt, legalMoves(all.board, all.color))) fail(t.id, `备选着「${alt}」走不通`);
  }
  // 邪门着本身亏多少（走邪门棋的一方视角）
  const before = best(pre.moves);
  const trickScore = only(pre.moves, all.moves[all.moves.length - 1]);
  const trickLoss = before - trickScore;
  // 邪门着之后：最好的应法、破解、上当（破解方视角）
  const top = best(all.moves);
  const r0 = textToMove(all.board, all.color, t.refute[0].t, legalMoves(all.board, all.color))!;
  const w0 = textToMove(all.board, all.color, t.trap[0].t, legalMoves(all.board, all.color))!;
  const rs = only(all.moves, r0);
  const ws = only(all.moves, w0);
  const trapLoss = rs - ws;
  console.log(
    `${t.name}：邪门着亏 ${trickLoss}｜破解 ${t.refute[0].t} ${rs}（首选 ${top}）｜上当 ${t.trap[0].t} ${ws}，亏 ${trapLoss}`,
  );
  if (trickLoss < 60) fail(t.id, `邪门着只亏 ${trickLoss}，算不上邪门`);
  if (top - rs > 150) fail(t.id, `破解比引擎首选差 ${top - rs}`);
  if (trapLoss < 150) fail(t.id, `上当只亏 ${trapLoss}`);
  // 破解之后比邪门着之前好：之前破解方的处境是 -before（对方视角取负）
  if (rs < -before) fail(t.id, `破解之后 ${rs}，还不如对方走邪门着之前（${-before}）`);
  const near = (a: number, b: number) => Math.abs(a - b) <= 250;
  if (!near(trickLoss, t.verified.trickLoss)) fail(t.id, `trickLoss 写的是 ${t.verified.trickLoss}，复核 ${trickLoss}`);
  if (!near(rs, t.verified.refuteScore)) fail(t.id, `refuteScore 写的是 ${t.verified.refuteScore}，复核 ${rs}`);
  if (!near(trapLoss, t.verified.trapLoss)) fail(t.id, `trapLoss 写的是 ${t.verified.trapLoss}，复核 ${trapLoss}`);
  void applyMove;
}
console.log(bad ? `\n❌ ${bad} 处不对` : `\n✅ ${TRICKS.length} 条全部复核通过`);
process.exit(bad ? 1 : 0);
