/**
 * 中局组合：从对局里找"只有一路能赢、要连着走好几步"的局面，按主题和步数分档。
 *
 * 原来的战术题多是一两步就完；用户要的是"中局战术……真正起到提升棋力的作用"。这里：
 *   1. 两个中等档位的皮卡鱼对下（它们会犯人会犯的错，留下真实的战术机会）；
 *   2. 每一手快速看一眼：最好的一手比第二好的强出 2.5 个兵以上、而且是净赚 → 候选；
 *   3. 候选深算复核，主变里找到"便宜真正拿到手"的那一步（子力净得 ≥ 2.5 个兵、对方吃不回来），
 *      或者杀棋；这之前你要走几步，就是这道题的步数；
 *   4. 按主变打主题标签：连将杀、杀、弃子、抽将、捉双、将军抽子。
 *
 *   node tools/run.mjs gen-combos <分片号> <分片数> [盘数]
 * 输出 node_modules/.cache/combo-<分片>.jsonl
 */
import fs from 'fs';
import { startPikafish } from './pikafish-node';
import { applyMove, initialBoard, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, toFen } from '../src/xiangqi/notation';
import { moveToUci, parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { chooseMove, PIKA_LEVELS, type Cand } from '../src/xiangqi/pikalevel';
import { PIECE_VALUE, attackersOf, hangingPieces, seeAt } from '../src/xiangqi/teach';

const [, , shardArg = '0', shardsArg = '1', gamesArg = '40'] = process.argv;
const SHARD = Number(shardArg);
const GAMES = Number(gamesArg);
const e = await startPikafish(128);
const START = toFen(initialBoard(), 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
let seed = (SHARD + 1) * 7919;
const rand = () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function search(moves: Move[], multipv: number, go: string): PvLine[] {
  e.send(`setoption name MultiPV value ${multipv}`);
  e.send(`position fen ${START} - - 0 1${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const ls = e.send(`go ${go}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  let d = 0;
  for (const l of ls) d = Math.max(d, l.depth);
  const by = new Map<number, PvLine>();
  for (const l of ls) if (l.depth === d - 1) by.set(l.multipv, l);
  for (const l of ls) if (l.depth === d) by.set(l.multipv, l);
  return [...by.values()].sort((a, b) => a.multipv - b.multipv);
}
const val = (l: PvLine) => (l.mateIn !== undefined ? (l.mateIn > 0 ? 30000 - l.mateIn : -30000 - l.mateIn) : l.score);

function material(b: Board, c: Color): number {
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') s += (p.c === c ? 1 : -1) * PIECE_VALUE[p.t];
  return s;
}

/** 主变走一遍：找到"便宜拿到手"的那一步，打主题标签 */
function analyse(board: Board, me: Color, pv: string[], mateIn?: number) {
  let b = board;
  let c = me;
  const start = material(board, me);
  const texts: string[] = [];
  const themes = new Set<string>();
  let allChecks = true;
  let myMoves = 0;
  let realized = -1;
  for (let i = 0; i < pv.length && i < 24; i++) {
    const m = uciToMove(pv[i]);
    if (!m || !legalMoves(b, c).some((x) => same(x, m))) break;
    const before = b;
    texts.push(moveToText(b, m));
    const after = applyMove(b, m);
    if (c === me) {
      myMoves++;
      const check = isInCheck(after, other(me));
      if (!check) allChecks = false;
      if (check) {
        // 抽将：将军的不是走的这个子（闪出来的将）
        const mover = after[m.ty][m.tx]!;
        const kingAt = (() => {
          for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) if (after[y][x]?.t === 'K' && after[y][x]?.c === other(me)) return [x, y];
          return [0, 0];
        })();
        const byMover = attackersOf(after, kingAt[0], kingAt[1], me).some((a) => a.fx === m.tx && a.fy === m.ty);
        if (!byMover && mover) themes.add('抽将');
        // 将军抽子：将军的同时，对方有子挂着
        if (hangingPieces(after, other(me)).length) themes.add('将军抽子');
      }
      // 弃子：这一手走完，走的子能被白吃（静态兑换亏本）
      if (!before[m.ty][m.tx] || PIECE_VALUE[before[m.ty][m.tx]!.t] < PIECE_VALUE[before[m.fy][m.fx]!.t]) {
        if (seeAt(after, m.tx, m.ty, other(me)) >= 250) themes.add('弃子');
      }
      // 捉双：走完对方同时有两个子被捉
      if (!check && hangingPieces(after, other(me)).length >= 2) themes.add('捉双');
    }
    b = after;
    c = other(c);
    if (mateIn === undefined && c === me && realized < 0) {
      // 轮到我、对方刚应完：子力净得够了而且我没有子挂着，便宜就算拿到手了
      if (material(b, me) - start >= 250 && hangingPieces(b, me).every((h) => h.loss < 150)) realized = i + 1;
    }
    if (statusAfter(b, c) !== 'playing') {
      realized = i + 1;
      break;
    }
  }
  if (mateIn !== undefined) {
    themes.add(allChecks ? '连将杀' : '杀');
    themes.delete('将军抽子');
  }
  const cut = realized > 0 ? realized : -1;
  const line = cut > 0 ? texts.slice(0, cut) : [];
  // 我方最后一步之后的对方应着不要（题目到我方拿到便宜那一步为止）
  if (line.length % 2 === 0) line.pop();
  return { line, steps: Math.ceil(line.length / 2), themes: [...themes] };
}

// 逐条同步追加：引擎调用是同步阻塞的，事件循环转不起来，createWriteStream 的内容要到最后才落盘，
// 而结尾的 process.exit() 不等它——整轮跑完一个字都没写进去（残局阶梯第一轮就这样丢了一百分钟的结果）
const OUT_FILE = `node_modules/.cache/combo-${SHARD}.jsonl`;
fs.writeFileSync(OUT_FILE, '');
const out = { write: (s: string) => fs.appendFileSync(OUT_FILE, s), end: () => {} };
let found = 0;
for (let g = 0; g < GAMES; g++) {
  e.send('ucinewgame');
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  // 两边都是中等档（会犯错），偶尔让一边强一点
  const lv: Record<Color, number> = { r: 2 + Math.floor(rand() * 3), b: 2 + Math.floor(rand() * 3) };
  let lastHit = -10;
  for (let ply = 0; ply < 160; ply++) {
    if (statusAfter(b, c) !== 'playing') break;
    if (ply >= 14 && ply - lastHit >= 6) {
      const q = search(moves, 2, 'nodes 60000');
      if (process.env.DEBUG && q.length >= 2 && val(q[0]) - val(q[1]) >= 150) console.log(`  快看 ply ${ply}：最好 ${val(q[0])} 第二 ${val(q[1])}`);
      if (q.length >= 2 && val(q[0]) >= 250 && val(q[0]) - val(q[1]) >= 250) {
        // 深算复核
        const d = search(moves, 2, 'movetime 3000');
        if (d.length >= 2 && val(d[0]) - val(d[1]) >= 250 && (d[0].mateIn !== undefined ? d[0].mateIn > 0 && d[0].mateIn <= 8 : d[0].score >= 250)) {
          const a = analyse(b, c, d[0].pv, d[0].mateIn !== undefined && d[0].mateIn > 0 ? d[0].mateIn : undefined);
          if (process.env.DEBUG) console.log(`    候选 ply ${ply}：gap ${val(d[0]) - val(d[1])} 最好 ${val(d[0])}，主变步数 ${a.steps}（${a.line.join(' ')}）`);
          if (a.steps >= 2) {
            lastHit = ply;
            found++;
            const rec = {
              id: `cb-${SHARD}-${found}`,
              kind: 'tactic',
              fen: toFen(b, c),
              answer: a.line[0],
              line: a.line,
              goal: d[0].mateIn !== undefined ? 'mate' : 'win',
              ev: Math.max(-3000, Math.min(3000, d[0].mateIn !== undefined ? 3000 : d[0].score)),
              ...(d[0].mateIn !== undefined ? { mateIn: d[0].mateIn } : {}),
              themes: a.themes.length ? a.themes : ['组合'],
              steps: a.steps,
              gap: val(d[0]) - val(d[1]),
            };
            out.write(JSON.stringify(rec) + '\n');
            console.log(`  第 ${g + 1} 盘第 ${ply + 1} 手：${rec.steps} 步${rec.goal === 'mate' ? '杀' : '得子'}（${rec.themes.join('、')}）${a.line.join(' ')}`);
          }
        }
      }
    }
    // 对局本身：按档位走
    const cfg = PIKA_LEVELS[lv[c]];
    const ls = search(moves, cfg.multipv, cfg.nodes ? `nodes ${cfg.nodes}` : `movetime ${cfg.movetime}`);
    const legal = legalMoves(b, c);
    const cands: Cand[] = [];
    for (const l of ls) {
      const m = uciToMove(l.pv[0]);
      if (m && legal.some((x) => same(x, m)) && !cands.some((x) => same(x.move, m))) cands.push({ move: m, score: l.score, mateIn: l.mateIn });
    }
    cands.sort((x, y) => y.score - x.score);
    const m = chooseMove(cands, cfg, rand) ?? legal[0];
    if (!m) break;
    moves.push(m);
    b = applyMove(b, m);
    c = other(c);
  }
  console.log(`[${g + 1}/${GAMES}] 累计 ${found} 道`);
}
out.end();
console.log(`分片 ${SHARD}：${found} 道组合`);
process.exit(0);
