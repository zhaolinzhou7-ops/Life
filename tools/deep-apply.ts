/**
 * 全题库深度复核（第二步）：拿 deep-audit 深算的结果，按"最后的结果一样不一样"改题库。
 *
 * 判一手站不站得住，和做题界面（train.ts 的 judgeAlt）用同一份代码（src/xiangqi/holds.ts）：
 *   - 首选、和首选差不到 80 分的，算站得住；
 *   - 都赢定了（多一个马以上或者有杀），算站得住；
 *   - 都还在胜负未分那一段（首选没赢定、这一手也没输定），分差在 150 以内（holds.ts 的 SAME_RESULT_TOLERANCE，对下到底量出来的），算站得住——
 *     用户原话："我觉得要从深度思考的决定、从最终的结果，再去判定这个走法合不合适"；
 *   - 杀法题：这一手还能杀就算。
 *
 * 照这条规矩：
 *   - 原谱这一手自己站不住（深算有一手好得多、结果不一样）：第一步就站不住的题去掉；后面某一步站不住的，主变截到上一步；
 *   - "只有这一手站得住"的题，第一步深算还有别的着法也站得住：题目本身不成立，去掉；
 *   - 别的题：每一步站得住的别的着法记进 ok（做题时直接算对，不用手机现场算）；
 *   - ev / ev2（局面分、第二好的分）换成深算的值——"局面差不多""你落后约一个马炮"说的才是真的；
 *     深算下来本来就输定了的（落后约一个马以上），不出（用户原话："一些已经非常劣势的局面，就不要再去看它好的走法是什么了"）；
 *     赢子题深算下来首选也只是差不多（不到 150 分）的，"找出赢子的一手"不成立，不出。
 *
 *   node tools/run.mjs deep-apply          只报不改
 *   node tools/run.mjs deep-apply write    写回 puzzles.json
 */
import fs from 'fs';
import { isLost } from '../src/xiangqi/analysis';
import { holds, holdsOk } from '../src/xiangqi/holds';

const WRITE = process.argv[2] === 'write';

interface Cand {
  t: string;
  score: number;
  mate?: number;
  pv: string[];
}
interface StepRec {
  id: string;
  ply: number;
  line: string;
  depth: number;
  cands: Cand[];
}
type P = {
  id: string;
  kind: string;
  goal?: string;
  fen: string;
  answer: string;
  line: string[];
  also?: string[];
  ok?: string[][];
  ev?: number;
  ev2?: number;
  mateIn?: number;
  steps?: number;
  [k: string]: unknown;
};

const S = (c: Cand) => ({ score: c.score, mateIn: c.mate });
/** 和做题界面用同一份判法（holds.ts） */
const stands = (p: P, best: Cand, c: Cand) =>
  holdsOk(holds(S(best), S(c), { same: c.t === best.t, mateGoal: p.kind === 'mate' || p.goal === 'mate' }));

const recs = new Map<string, Map<number, StepRec>>();
for (const f of fs.readdirSync('node_modules/.cache').filter((n) => /^deep-audit-pz-\d+\.jsonl$/.test(n))) {
  for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) {
    if (!l.trim()) continue;
    const r = JSON.parse(l) as StepRec;
    const m = recs.get(r.id) ?? new Map<number, StepRec>();
    const old = m.get(r.ply);
    if (!old || old.depth < r.depth) m.set(r.ply, r);
    recs.set(r.id, m);
  }
}

const PUZ = 'src/xiangqi/puzzles.json';
const puz = JSON.parse(fs.readFileSync(PUZ, 'utf8')) as P[];
const out: P[] = [];
const log: Record<string, string[]> = {};
const note = (k: string, s: string) => (log[k] ??= []).push(s);
let audited = 0;
let okSteps = 0;
for (const p0 of puz) {
  const steps = recs.get(p0.id);
  if (!steps) {
    out.push(p0);
    continue;
  }
  audited++;
  const p: P = { ...p0 };
  const first = steps.get(0);
  if (first) {
    const best = first.cands[0];
    const lm = first.cands.find((c) => c.t === p.line[0]);
    if (!lm || !stands(p, best, lm)) {
      note('第一步原谱站不住，去掉', `${p.id}（${p.kind}/${p.goal}）原谱 ${p.line[0]} ${lm ? lm.mate ?? lm.score : '?'}，深算首选 ${best.t} ${best.mate ?? best.score}`);
      continue;
    }
    const others = first.cands.filter((c) => c.t !== p.line[0] && stands(p, best, c)).map((c) => c.t);
    if (p.goal === 'only' && others.length) {
      note('"只有这一手"不成立，去掉', `${p.id}（${p.kind}）原谱 ${p.line[0]} ${lm.score}；${others.map((t) => `${t} ${first.cands.find((c) => c.t === t)!.score}`).join('、')} 也站得住`);
      continue;
    }
    // 局面分换成深算的：首选的分，第二好的分
    const oldEv = p.ev;
    if (p.kind !== 'mate' && p.goal !== 'mate' && best.mate === undefined) {
      p.ev = best.score;
      const second = first.cands.find((c) => c.t !== best.t);
      if (second && second.mate === undefined) p.ev2 = second.score;
      if (oldEv !== undefined && Math.sign(Math.round(oldEv / 150)) !== Math.sign(Math.round(p.ev / 150)))
        note('局面说法改了（领先/差不多/落后）', `${p.id} ${oldEv} → ${p.ev}`);
      if (p.goal !== 'mate' && isLost({ score: p.ev })) {
        note('深算下来本来就输定了，不出', `${p.id}（${p.goal}）${p.ev}`);
        continue;
      }
      // 赢子题：深算下来首选也只是"差不多"，题目问"找出赢子的一手"就不成立了
      if (p.goal === 'win' && p.ev < 150) {
        note('"赢子"不成立（深算首选也就差不多），去掉', `${p.id} ${oldEv} → ${p.ev}`);
        continue;
      }
    }
  }
  // 后面每一步：原谱站不住就截到上一步；站得住的别的着法记进 ok
  const ok: string[][] = [];
  let cutAt = -1;
  for (let ply = 0; ply < p.line.length; ply += 2) {
    const r = steps.get(ply);
    if (!r) {
      ok.push([]);
      continue;
    }
    const best = r.cands[0];
    const lm = r.cands.find((c) => c.t === p.line[ply]);
    if (ply > 0 && (!lm || !stands(p, best, lm))) {
      cutAt = ply;
      note('后面某一步原谱站不住，主变截短', `${p.id} 第 ${ply / 2 + 1} 步原谱 ${p.line[ply]} ${lm ? lm.mate ?? lm.score : '?'}，深算首选 ${best.t} ${best.mate ?? best.score}`);
      break;
    }
    const alts = r.cands.filter((c) => c.t !== p.line[ply] && stands(p, best, c)).map((c) => c.t);
    ok.push(alts);
    okSteps += alts.length ? 1 : 0;
  }
  if (cutAt > 0) {
    // 截到上一步解题方的那一手（对方那一手应着也不要：主变最后一手是你走的）
    p.line = p.line.slice(0, cutAt - 1);
    ok.length = Math.ceil(p.line.length / 2);
  }
  // 中局组合：步数跟着主变改；截完不到两步就不算"连走几步的组合"了
  if (p.steps !== undefined) {
    p.steps = Math.ceil(p.line.length / 2);
    if (p.steps < 2) {
      note('中局组合截完不到两步，去掉', p.id);
      continue;
    }
  }
  // 题面说"当时那盘棋走的是 X，亏了子"，深算下来 X 也站得住：这句不成立，去掉（判断题也不再拿它当错着）
  if (typeof p.blunder === 'string' && ok[0]?.includes(p.blunder)) {
    note('实战那一手其实站得住，"当时走错了"这句去掉', `${p.id} ${p.blunder}`);
    delete p.blunder;
  }
  while (ok.length && !ok[ok.length - 1].length) ok.pop();
  if (ok.some((x) => x.length)) p.ok = ok;
  else delete p.ok;
  out.push(p);
}

console.log(`题库 ${puz.length} 道，深算过 ${audited} 道；改完 ${out.length} 道（少了 ${puz.length - out.length} 道），${okSteps} 步记下了别的站得住的着法`);
for (const [k, v] of Object.entries(log)) {
  console.log(`\n${k}：${v.length} 处`);
  for (const s of v.slice(0, process.env.ALL ? 9999 : 25)) console.log(`  ${s}`);
}
if (WRITE) {
  fs.writeFileSync(PUZ, JSON.stringify(out));
  console.log('\n已写回');
}
