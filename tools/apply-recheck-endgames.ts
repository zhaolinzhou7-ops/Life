/**
 * 把 recheck-endgames 的结果落到残局库（src/xiangqi/endgamelib.json）。
 *
 * 规矩（宁缺毋滥，不编结论；和当初定胜和的办法一样：两档都下成和才记"和"）：
 * 标"和"的——
 *   - 攻方哪一档都没赢（下成和，或者攻方自己走成长打判负）：站得住，不动。
 *     攻方长打判负是皮卡鱼认"捉"比我们宽（比如一将一捉它不当长打），那是攻方的错，不说明这局能赢。
 *   - 两档都是攻方赢：标"和"是错的。你是攻方的改成"要赢"；你是守方的这道题守不住，去掉。
 *   - 一档赢一档没赢：在胜和边界上，没有稳定答案，去掉。
 * 标"要赢"的——
 *   - 两档攻方都赢：站得住，不动。
 *   - 两档攻方都没赢下来：皮卡鱼守得住，App 里你的对手就是它——改成"和"（改完是对等局面的不收，去掉）。
 *   - 一档赢一档没赢：去掉。
 * 引擎出错的：去掉，打出来人工看。
 * 用法：node tools/run.mjs apply-recheck-endgames（先跑完 recheck-endgames 的分片；WRITE=1 才写回）
 */
import fs from 'fs';
import type { Game } from './recheck-endgames';
import { endgameUnfit } from '../src/xiangqi/balance';

interface Entry {
  id: string;
  name: string;
  you: 'r' | 'b';
  target: string;
  reason: string;
  plies: number;
  role?: string;
  [k: string]: unknown;
}
interface Row {
  id: string;
  runs: (Game & { go: string })[];
}

const LIB = 'src/xiangqi/endgamelib.json';
const lib = JSON.parse(fs.readFileSync(LIB, 'utf8')) as Entry[];
const rows = new Map<string, Row>();
for (const f of fs.readdirSync('node_modules/.cache').filter((x) => /^recheck-(draw|win)-\d+\.jsonl$/.test(x)))
  for (const l of fs.readFileSync(`node_modules/.cache/${f}`, 'utf8').split('\n')) if (l.trim()) rows.set(JSON.parse(l).id, JSON.parse(l));

/** 裁判的结论写成残局库里的说法（和老数据一致） */
const REASON: Record<string, string> = {
  '将死/困毙': '将死/困毙',
  'perpetual-check': '长将判负',
  'perpetual-chase': '长捉判负',
  repetition: '三次重复',
  'move-limit': '60 回合无吃子',
  'no-attackers': '双方无进攻子力',
  cap: '未分胜负',
};

const checked = lib.filter((e) => rows.has(e.id));
const out: Entry[] = [];
const log = { keep: 0, toWin: [] as string[], toDraw: [] as string[], drop: [] as string[] };
for (const e of lib) {
  const r = rows.get(e.id);
  if (!r) {
    out.push(e);
    continue;
  }
  const att: 'r' | 'b' = e.role === 'def' ? (e.you === 'r' ? 'b' : 'r') : e.you;
  const attWin = att === 'r' ? 'red-win' : 'black-win';
  const kinds = r.runs.map((g) => (g.result === 'draw' ? 'draw' : g.result === attWin ? 'att' : g.result === 'error' ? 'error' : 'def'));
  const why = r.runs.map((g) => `${g.result}/${g.reason}/${g.plies}`).join(' · ');
  const tag = `${e.id}（${e.name}，你是${e.role === 'def' ? '守方' : '攻方'}，标${e.target === 'win' ? '要赢' : '和'}）：${why}`;
  const wins = kinds.filter((k) => k === 'att').length;
  if (kinds.includes('error')) log.drop.push(tag);
  else if (e.target === 'draw' && wins === 0) {
    log.keep++;
    out.push(e);
  } else if (e.target === 'win' && wins === kinds.length) {
    log.keep++;
    out.push(e);
  } else if (e.target === 'draw' && wins === kinds.length && e.role !== 'def') {
    const deep = r.runs[r.runs.length - 1];
    log.toWin.push(tag);
    out.push({ ...e, target: 'win', reason: REASON[deep.reason] ?? deep.reason, plies: deep.plies });
  } else if (e.target === 'win' && wins === 0 && kinds.includes('draw')) {
    const deep = [...r.runs].reverse().find((g) => g.result === 'draw')!;
    const next = { ...e, target: 'draw', reason: REASON[deep.reason] ?? deep.reason, plies: deep.plies };
    // 改成"和"以后要是子力对等（没下头）或者守方大劣，残局库本来就不收（balance.ts，prune-lopsided 清过一遍）
    if (endgameUnfit(next as Parameters<typeof endgameUnfit>[0])) log.drop.push(tag + '（改成和以后是对等局面，不收）');
    else {
      log.toDraw.push(tag);
      out.push(next);
    }
  } else log.drop.push(tag);
}
console.log(`复核了 ${checked.length} 局：站得住 ${log.keep}，"和"改成"要赢" ${log.toWin.length}，"要赢"改成"和" ${log.toDraw.length}，去掉 ${log.drop.length}`);
for (const l of log.toWin) console.log('  改成要赢 ' + l);
for (const l of log.toDraw) console.log('  改成和 ' + l);
for (const l of log.drop) console.log('  去掉 ' + l);
if (process.env.WRITE) {
  fs.writeFileSync(LIB, JSON.stringify(out));
  console.log(`写回 ${LIB}：${lib.length} → ${out.length} 局`);
}
