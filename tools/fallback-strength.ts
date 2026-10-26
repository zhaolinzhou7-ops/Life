/**
 * 自带引擎（皮卡鱼起不来时的替补）有多强：在题库局面上让它按对局的时限选一手，再用皮卡鱼量这一手比最好的亏多少。
 *
 * 用户原话："如果在断网的情况下，能不能想办法让另外一套系统接进来，让引擎的能力得到提升？"
 * 改自带引擎前后各跑一遍，比"平均亏多少分""亏一个兵以上 / 亏一个马以上的有几步"。
 *
 *   node tools/run.mjs fallback-strength [标签]
 *   TIME=2800 N=150 node tools/run.mjs fallback-strength before
 *
 * 皮卡鱼的复核（每手 80 万节点）存在 node_modules/.cache/fallback-ref.json，第二遍不用重算。
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { moveToUci, parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { think, lastSearch } from '../src/xiangqi/ai';
import { fromFen } from '../src/xiangqi/notation';

const label = process.argv[2] ?? 'run';
const TIME = Number(process.env.TIME ?? 2800);
const N = Number(process.env.N ?? 150);
const NODES = 800000;
const REF = 'node_modules/.cache/fallback-ref.json';

type P = { id: string; kind: string; fen: string };
const puz = JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')) as P[];
// 每类按题号均匀取，开局、中局战术、防守、残局、杀法都有
const kinds = ['opening', 'tactic', 'safety', 'endgame', 'mate'];
const per = Math.ceil(N / kinds.length);
const picked = kinds.flatMap((k) => {
  const all = puz.filter((p) => p.kind === k);
  const step = Math.max(1, Math.floor(all.length / per));
  return all.filter((_, i) => i % step === 0).slice(0, per);
});

const ref: Record<string, Record<string, number>> = fs.existsSync(REF) ? JSON.parse(fs.readFileSync(REF, 'utf8')) : {};
let e: Awaited<ReturnType<typeof startPikafish>> | null = null;
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);
async function score(fen: string, uci: string | null): Promise<number> {
  const key = uci ?? 'best';
  const r = (ref[fen] ??= {});
  if (r[key] !== undefined) return r[key];
  e ??= await startPikafish(64);
  e.send('ucinewgame');
  e.send(`position fen ${fen} - - 0 1`);
  const got = e
    .send(`go nodes ${NODES}${uci ? ` searchmoves ${uci}` : ''}`)
    .map(parseInfo)
    .filter((x): x is PvLine => !!x && !x.bound && x.multipv === 1);
  const last = got[got.length - 1];
  r[key] = last ? val(last) : 0;
  if (!uci && last) r[last.pv[0]] = r[key];
  return r[key];
}

const rows: { id: string; kind: string; loss: number; depth: number }[] = [];
for (const p of picked) {
  const f = fromFen(p.fen);
  if (!f) continue;
  const m = think(f.board, f.toMove, { maxDepth: 64, timeMs: TIME, jitter: 0 });
  if (!m) continue;
  const depth = lastSearch.depth;
  const best = await score(p.fen, null);
  const mine = await score(p.fen, moveToUci(m));
  const loss = Math.max(0, best - mine);
  rows.push({ id: p.id, kind: p.kind, loss, depth });
  if (rows.length % 10 === 0) {
    console.log(`${rows.length}/${picked.length}`);
    fs.writeFileSync(REF, JSON.stringify(ref));
  }
}
fs.writeFileSync(REF, JSON.stringify(ref));

const sum = (xs: typeof rows) => {
  const cap = (x: number) => Math.min(x, 1500); // 被杀按 1500 算，不让一两步把平均拉飞
  const avg = xs.reduce((s, r) => s + cap(r.loss), 0) / xs.length;
  const pct = (t: number) => `${Math.round((100 * xs.filter((r) => r.loss > t).length) / xs.length)}%`;
  const dep = xs.reduce((s, r) => s + r.depth, 0) / xs.length;
  return `${String(xs.length).padStart(3)} 步  平均亏 ${avg.toFixed(0).padStart(4)}  亏一兵以上 ${pct(100).padStart(4)}  亏一马以上 ${pct(400).padStart(4)}  平均 ${dep.toFixed(1)} 层`;
};
const lines = [`[${label}] 每步 ${TIME}ms`, `全部    ${sum(rows)}`, ...kinds.map((k) => `${k.padEnd(8)}${sum(rows.filter((r) => r.kind === k))}`)];
console.log(lines.join('\n'));
fs.writeFileSync(`node_modules/.cache/fallback-${label}.json`, JSON.stringify(rows));
process.exit(0);
