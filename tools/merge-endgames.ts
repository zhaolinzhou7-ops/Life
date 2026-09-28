/**
 * 把皮卡鱼造的残局、复核的结论写进残局库。
 *   - 老局面：按复核结果改胜和；守方练习复核下来守不住的，剔掉（守方被问"能不能赢"、
 *     明明守不住还让你守——用户原话"我是守方，我怎么可能赢"）
 *   - 新局面：按组写好名字、子力、要领、书上的结论、难度，你是进攻方还是守方
 * 用法：node tools/run.mjs merge-endgames
 */
import fs from 'fs';
import { fromFen } from '../src/xiangqi/notation';
import type { Color } from '../src/xiangqi/rules';
import { attackLabel, attackTips, classifyEndgame, defendTips, fullLabel, sideMaterial } from '../src/xiangqi/endgame';
import type { EndgamePos } from '../src/xiangqi/library';

const lib = JSON.parse(fs.readFileSync('src/xiangqi/endgamelib.json', 'utf8')) as EndgamePos[];
const recheck = JSON.parse(fs.readFileSync('node_modules/.cache/endgame-recheck.json', 'utf8')) as {
  id: string;
  now: 'win' | 'draw' | null;
  reason?: string;
  plies?: number;
  attacker: Color;
}[];
const byId = new Map(recheck.map((r) => [r.id, r]));

const REASON: Record<string, string> = {
  将死: '将死',
  '60 回合无吃子': '60 回合无吃子',
  三次重复: '三次重复',
  引擎判和: '三次重复',
  打满没分出胜负: '打满没分出胜负',
};

const out: EndgamePos[] = [];
let dropped = 0;
let changed = 0;
for (const e of lib) {
  const r = byId.get(e.id);
  const role: 'att' | 'def' = r ? (r.attacker === e.you ? 'att' : 'def') : 'att';
  if (r && r.now && r.now !== e.target) {
    if (role === 'def' && r.now === 'win') {
      dropped++;
      continue; // 守方守不住：这不是守和练习
    }
    changed++;
    e.target = r.now;
    e.reason = REASON[r.reason ?? ''] ?? r.reason;
    if (r.plies) e.plies = r.plies;
  }
  e.role = role;
  out.push(e);
}

// 新局面
const found: { name: string; category: string; fen: string; you: Color; target: 'win' | 'draw'; plies: number; reason: string; role: 'att' | 'def' }[] = [];
for (let k = 0; k < 3; k++) {
  const f = `node_modules/.cache/endgames-${k}.jsonl`;
  if (!fs.existsSync(f)) continue;
  for (const line of fs.readFileSync(f, 'utf8').split('\n')) if (line.trim()) found.push(JSON.parse(line));
}
const have = new Set(out.map((e) => e.fen));
const seq = new Map<string, number>();
let added = 0;
for (const g of found) {
  if (have.has(g.fen)) continue;
  have.add(g.fen);
  const p = fromFen(g.fen)!;
  const me = g.you;
  const foe: Color = me === 'r' ? 'b' : 'r';
  const att = g.role === 'att' ? me : foe;
  const def = att === 'r' ? 'b' : 'r';
  const A = sideMaterial(p.board, att);
  const D = sideMaterial(p.board, def);
  const info = classifyEndgame(p.board, me);
  const n = (seq.get(g.name) ?? 0) + 1;
  seq.set(g.name, n);
  const tips = (g.role === 'att' ? attackTips(A) : defendTips(D)).slice(0, 3);
  const goal =
    g.role === 'att'
      ? `你是进攻方（${attackLabel(A)}）。先判断这局能不能赢，再下到底把它兑现。`
      : `你是守方（${fullLabel(D)}）。对方子力占优，守住就算过。`;
  // 难度：胜局按要走多少步算，走得越长越难；守和比兑现和棋难一点
  const rating =
    g.target === 'win' ? Math.round(950 + Math.min(650, g.plies * 7)) : g.role === 'def' ? 1250 : 1150;
  out.push({
    id: `gen-${g.name}-${n}`,
    name: g.name,
    category: g.category,
    material: `${attackLabel(A)} vs ${fullLabel(D)}${g.role === 'def' ? '（你是守方）' : ''}`,
    fen: g.fen,
    you: me,
    target: g.target,
    goal,
    tips,
    plies: g.plies,
    reason: REASON[g.reason] ?? g.reason,
    book: info?.book?.book,
    rating,
    role: g.role,
  });
  added++;
}
fs.writeFileSync('src/xiangqi/endgamelib.json', JSON.stringify(out));
const groups = new Set(out.map((e) => e.name));
console.log(`残局库：原 ${lib.length} 个（改判 ${changed}、剔掉守不住的守方练习 ${dropped}），新增 ${added} 个 → 共 ${out.length} 个、${groups.size} 类`);
