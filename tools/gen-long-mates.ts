/**
 * 找"要十几二十步才杀得死"的残局：在长线残局的子力组合里随机摆子，
 * 只留皮卡鱼算出 12～30 步杀的局面，给残局阶梯的 15 步、20 步两档当素材。
 * 残局库里多数胜局离将死只有几步，长线的太少——这些才是"体系化"要练的：怎么一步步把对方的士象拆掉、把将逼出来。
 *
 *   node tools/run.mjs gen-long-mates <分片号> <分片数> [每组几个]
 * 输出 node_modules/.cache/longmate-<分片>.jsonl，再交给 gen-mate-ladder（INPUT=...）切出各档。
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { isInCheck, type Color } from '../src/xiangqi/rules';
import { toFen } from '../src/xiangqi/notation';
import { parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { randomPosition, type GroupSpec } from './endgame-place';

const [, , shardArg = '0', shardsArg = '1', perArg = '3'] = process.argv;
const SHARD = Number(shardArg);
const SHARDS = Number(shardsArg);
const PER = Number(perArg);
// 要多长的杀（默认 12～30 步）；专门找 20 步档的素材时 MIN=22 MS=5000 —— 短时间算出来的步数偏长，
// 多算一会儿往往就缩到十五六步，切不出 20 步那一档
const MIN = Number(process.env.MIN ?? 12);
const MAX = Number(process.env.MAX ?? 30);
const MS = Number(process.env.MS ?? 2500);
const TAG = process.env.TAG ?? 'longmate';
const ONLY = new Set((process.env.ONLY ?? '').split(',').filter(Boolean));
const TRIES = Number(process.env.TRIES ?? 160);

const LONG: GroupSpec[] = [
  { name: '单车对单缺士', category: '车类', att: 'R', def: 'AEE', you: 'att' },
  { name: '单车对单缺象', category: '车类', att: 'R', def: 'AAE', you: 'att' },
  { name: '单车对马双士', category: '车类', att: 'R', def: 'HAA', you: 'att' },
  { name: '单车对炮双士', category: '车类', att: 'R', def: 'CAA', you: 'att' },
  { name: '车兵对车双士', category: '车类', att: 'RP', attGuard: 'AA', def: 'RAA', you: 'att' },
  { name: '车马对单车', category: '组合', att: 'RH', attGuard: 'AA', def: 'RAA', you: 'att' },
  { name: '车炮对单车', category: '组合', att: 'RC', attGuard: 'AA', def: 'RAA', you: 'att' },
  { name: '车马对士象全', category: '组合', att: 'RH', def: 'AAEE', you: 'att' },
  { name: '马炮对士象全', category: '组合', att: 'HC', def: 'AAEE', you: 'att' },
  { name: '双马对士象全', category: '组合', att: 'HH', def: 'AAEE', you: 'att' },
  { name: '马炮对双士', category: '组合', att: 'HC', def: 'AA', you: 'att' },
  { name: '马兵对士象全', category: '马类', att: 'HP', def: 'AAEE', you: 'att' },
  { name: '马兵对单缺象', category: '马类', att: 'HP', def: 'AAE', you: 'att' },
  { name: '炮兵对士象全', category: '炮类', att: 'CP', attGuard: 'AA', def: 'AAEE', you: 'att' },
  { name: '炮兵对双士', category: '炮类', att: 'CP', def: 'AA', you: 'att' },
  { name: '三兵对士象全', category: '兵类', att: 'PPP', def: 'AAEE', you: 'att' },
  { name: '双兵对士象全', category: '兵类', att: 'PP', def: 'AAEE', you: 'att' },
];

const e = await startPikafish(128);
// 逐条同步追加：引擎调用是同步阻塞的，事件循环转不起来，createWriteStream 的内容要到最后才落盘，
// 而结尾的 process.exit() 不等它——整轮跑完一个字都没写进去（残局阶梯第一轮就这样丢了一百分钟的结果）
const OUT_FILE = `node_modules/.cache/${TAG}-${SHARD}.jsonl`;
fs.writeFileSync(OUT_FILE, '');
const out = { write: (s: string) => fs.appendFileSync(OUT_FILE, s), end: () => {} };
let total = 0;
const groups = LONG.filter((g) => !ONLY.size || ONLY.has(g.name));
for (let gi = SHARD; gi < groups.length; gi += SHARDS) {
  const g = groups[gi];
  let got = 0;
  for (let tries = 0; tries < TRIES && got < PER; tries++) {
    const attacker: Color = Math.random() < 0.5 ? 'r' : 'b';
    const defender: Color = attacker === 'r' ? 'b' : 'r';
    const b = randomPosition(g, attacker);
    if (!b || isInCheck(b, defender) || isInCheck(b, attacker)) continue;
    const fen = toFen(b, attacker);
    e.send('ucinewgame');
    e.send(`position fen ${fen} - - 0 1`);
    const ls = e.send(`go movetime ${MS}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
    const l = ls[ls.length - 1];
    if (!l || l.mateIn === undefined || l.mateIn < MIN || l.mateIn > MAX) continue;
    got++;
    total++;
    out.write(JSON.stringify({ id: `${TAG === 'longmate' ? 'lm' : TAG}-${g.name}-${SHARD}-${got}`, name: g.name, category: g.category, material: g.name, fen, you: attacker, target: 'win' }) + '\n');
    console.log(`  ${g.name}：${l.mateIn} 步杀（第 ${tries + 1} 次摆）`);
  }
  console.log(`[${g.name}] ${got} 个`);
}
out.end();
console.log(`分片 ${SHARD}：${total} 个长杀局面`);
process.exit(0);
