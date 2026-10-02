/**
 * 邪门布局的闸门：tricks.ts 里写的每一句结论，都要皮卡鱼当场深算复核一遍。
 *
 * 用户原话："算法的思考深度是有问题的"——每个局面默认深算 10 秒（约 18 层），不是两三秒的快棋分。
 *
 *   - 所有着法走得通（前缀、邪门着、破解、上当、其它错着）
 *   - 邪门着本身确实亏（比最好的走法差 60 以上）——不亏的不叫邪门，是正常布局
 *   - 破解那一手是（接近）最好的：和引擎首选差不到 150；局面已经大优时按比例放宽（首选的 35%）——
 *     领先六个兵的局面里差两个兵，结论不变
 *   - 上当那一手确实亏：比破解差 150 以上（陷阱在后面的套路，在分岔那一步比；分岔处的破解也要接近最好）
 *   - 其它错着（wrong）确实亏：比同一位置的破解差 120 以上
 *   - 破解之后，破解方比邪门着之前的处境好（对方白亏了）
 *   - 写在数据里的数和复核结果对得上（差 250 或者四成以内——引擎每次算的深浅不同，数会浮动）
 *
 *   node tools/run.mjs check-tricks [分片号 分片数]      复核，结果写 node_modules/.cache/checktricks-<分片>.json
 *   node tools/run.mjs check-tricks apply                把复核出来的数写回 tricks.ts（verified、wrong.loss）
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { legalMoves, type Move } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { TRICKS, lineToTrap, walkMoves } from '../src/xiangqi/tricks';

type Res = { trickLoss: number; refuteScore: number; trapLoss: number; wrong: Record<string, number> };
const CACHE = 'node_modules/.cache';

if (process.argv[2] === 'apply') {
  const all: Record<string, Res> = {};
  for (const f of fs.readdirSync(CACHE).filter((n) => /^checktricks-\d+\.json$/.test(n))) {
    Object.assign(all, JSON.parse(fs.readFileSync(`${CACHE}/${f}`, 'utf8')));
  }
  let src = fs.readFileSync('src/xiangqi/tricks.ts', 'utf8');
  for (const [id, r] of Object.entries(all)) {
    const at = src.indexOf(`id: '${id}',`);
    if (at < 0) continue;
    const next = src.indexOf('\n  {\n    id: ', at + 1);
    const end = next < 0 ? src.indexOf('\n];', at) : next;
    let block = src.slice(at, end);
    block = block.replace(
      /verified: \{ trickLoss: -?\d+, refuteScore: -?\d+, trapLoss: -?\d+ \}/,
      `verified: { trickLoss: ${r.trickLoss}, refuteScore: ${r.refuteScore}, trapLoss: ${r.trapLoss} }`,
    );
    for (const [t, loss] of Object.entries(r.wrong)) {
      const i = block.indexOf(`t: '${t}',`, block.indexOf('wrong: ['));
      if (i < 0) continue;
      const j = block.indexOf('loss: ', i);
      block = block.slice(0, j) + block.slice(j).replace(/^loss: -?\d+/, `loss: ${loss}`);
    }
    src = src.slice(0, at) + block + src.slice(end);
  }
  fs.writeFileSync('src/xiangqi/tricks.ts', src);
  console.log(`写回 ${Object.keys(all).length} 条`);
  process.exit(0);
}

const SHARD = Number(process.argv[2] ?? 0);
const SHARDS = Number(process.argv[3] ?? 1);
const MS = Number(process.env.MS ?? 10000);
const e = await startPikafish(256);
const pos = (moves: Move[]) => `position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`;
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 : -30000) : l.score);
function best(moves: Move[]): number {
  e.send('setoption name MultiPV value 1');
  e.send(pos(moves));
  const r = e.send(`go movetime ${MS}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  return val(r[r.length - 1]);
}
function only(moves: Move[], m: Move): number {
  e.send(pos(moves));
  const r = e.send(`go movetime ${MS} searchmoves ${moveToUci(m)}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  return val(r[r.length - 1]);
}
/** 离首选多远还算"接近最好" */
const slack = (top: number) => Math.max(150, Math.round(Math.abs(top) * 0.35));
const near = (a: number, b: number) => Math.abs(a - b) <= Math.max(250, Math.abs(b) * 0.4);

let bad = 0;
const fail = (id: string, msg: string) => {
  console.log(`  ✗ ${id}：${msg}`);
  bad++;
};
const out: Record<string, Res> = {};
const ONLY = process.env.ONLY?.split(',');
TRICKS.forEach((t, idx) => {
  if (idx % SHARDS !== SHARD) return;
  if (ONLY && !ONLY.includes(t.id)) return;
  e.send('ucinewgame');
  const pre = walkMoves(t.pre);
  const all = walkMoves([...t.pre, t.trick.t]);
  const refute = walkMoves([...t.pre, t.trick.t, ...t.refute.map((s) => s.t)]);
  const fork = walkMoves(lineToTrap(t));
  const trap = walkMoves([...lineToTrap(t), ...t.trap.map((s) => s.t)]);
  if (!pre || !all || !refute || !trap || !fork) {
    fail(t.id, '有着法走不通');
    return;
  }
  if (pre.color !== t.by) fail(t.id, `邪门着应该是${t.by === 'r' ? '红' : '黑'}方走`);
  if (t.preWhy.length !== t.pre.length) fail(t.id, `preWhy ${t.preWhy.length} 条，pre ${t.pre.length} 手`);
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
  const rs = only(all.moves, r0);
  // 上当在分岔处比：分岔处该走的那一手（refute[k]）和上当那一手（trap[0]）
  const k = t.trapAfter ?? 0;
  if (k % 2) fail(t.id, `trapAfter 必须是偶数（轮到破解方），现在是 ${k}`);
  const rk = textToMove(fork.board, fork.color, t.refute[k].t, legalMoves(fork.board, fork.color))!;
  const w0 = textToMove(fork.board, fork.color, t.trap[0].t, legalMoves(fork.board, fork.color))!;
  const rks = k ? only(fork.moves, rk) : rs;
  const ws = only(fork.moves, w0);
  const trapLoss = rks - ws;
  if (k) {
    const topK = best(fork.moves);
    if (topK - rks > slack(topK)) fail(t.id, `第二关的破解 ${t.refute[k].t} 比引擎首选差 ${topK - rks}`);
  }
  // 其它常见错着
  const wrong: Record<string, number> = {};
  for (const w of t.wrong ?? []) {
    if (w.at % 2) fail(t.id, `wrong「${w.t}」的 at 必须是偶数`);
    const p = walkMoves([...t.pre, t.trick.t, ...t.refute.slice(0, w.at).map((s) => s.t)]);
    const good = p && textToMove(p.board, p.color, t.refute[w.at]?.t ?? '', legalMoves(p.board, p.color));
    const badm = p && textToMove(p.board, p.color, w.t, legalMoves(p.board, p.color));
    if (!p || !good || !badm) {
      fail(t.id, `wrong「${w.t}」走不通`);
      continue;
    }
    const loss = (w.at === 0 ? rs : w.at === k ? rks : only(p.moves, good)) - only(p.moves, badm);
    wrong[w.t] = loss;
    if (loss < 120) fail(t.id, `错着「${w.t}」只亏 ${loss}`);
    else if (!near(loss, w.loss)) fail(t.id, `错着「${w.t}」写的是 ${w.loss}，复核 ${loss}`);
  }
  console.log(
    `${t.name}：邪门着亏 ${trickLoss}｜破解 ${t.refute[0].t} ${rs}（首选 ${top}）｜${k ? `第二关 ${t.refute[k].t} ${rks}，` : ''}上当 ${t.trap[0].t} ${ws}，亏 ${trapLoss}${
      Object.keys(wrong).length ? `｜其它错着 ${Object.entries(wrong).map(([a, b]) => `${a} 亏 ${b}`).join('，')}` : ''
    }`,
  );
  out[t.id] = { trickLoss, refuteScore: rs, trapLoss, wrong };
  fs.writeFileSync(`${CACHE}/checktricks-${process.env.TAG ?? SHARD}.json`, JSON.stringify(out));
  if (trickLoss < 60) fail(t.id, `邪门着只亏 ${trickLoss}，算不上邪门`);
  // 主推的破解离首选远一点也行，条件是：它本身已经大优（3 个兵以上）、差距不到首选的一半，而且备选里有引擎的首选
  if (top - rs > slack(top)) {
    const altOk =
      rs >= 300 &&
      top - rs <= Math.abs(top) * 0.5 &&
      (t.refute[0].alts ?? []).some((a) => {
        const m = textToMove(all.board, all.color, a, legalMoves(all.board, all.color));
        return !!m && top - only(all.moves, m) <= slack(top);
      });
    if (altOk) console.log(`  · ${t.id}：破解 ${t.refute[0].t} 比首选差 ${top - rs}，已大优、备选里有首选，放行`);
    else fail(t.id, `破解比引擎首选差 ${top - rs}`);
  }
  if (trapLoss < 150) fail(t.id, `上当只亏 ${trapLoss}`);
  // 破解之后比邪门着之前好：之前破解方的处境是 -before（对方视角取负）
  if (rs < -before) fail(t.id, `破解之后 ${rs}，还不如对方走邪门着之前（${-before}）`);
  if (!near(trickLoss, t.verified.trickLoss)) fail(t.id, `trickLoss 写的是 ${t.verified.trickLoss}，复核 ${trickLoss}`);
  if (!near(rs, t.verified.refuteScore)) fail(t.id, `refuteScore 写的是 ${t.verified.refuteScore}，复核 ${rs}`);
  if (!near(trapLoss, t.verified.trapLoss)) fail(t.id, `trapLoss 写的是 ${t.verified.trapLoss}，复核 ${trapLoss}`);
});
console.log(bad ? `\n❌ ${bad} 处不对` : `\n✅ 分片 ${SHARD}：全部复核通过`);
process.exit(bad ? 1 : 0);
