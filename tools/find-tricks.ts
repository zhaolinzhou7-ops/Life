/**
 * 找"邪门布局"的素材：让引擎说话，不凭记忆。
 *
 * 两种：
 *   line  给定的几条江湖着法（前缀 | 那一手邪门棋）：量它本身亏多少、对方怎么应最好、
 *         哪些"顺手"的应法会上当（吃子、将军、反捉——看着最自然、实际亏大的那几手）
 *   bait  在常见开局线上扫"毒饵"：一方故意把子放到能被吃的地方（本身不算漏着），
 *         而对方一吃就亏大——江湖棋手最爱摆的就是这种
 * 用法：node tools/run.mjs find-tricks line|bait
 */
import fs from 'fs';
import { startPikafish, type NodeEngine } from './pikafish-node';
import { applyMove, initialBoard, legalMoves, isInCheck, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';
import { moveToUci, uciToMove, parseInfo, type PvLine } from '../src/xiangqi/pikafish';
import { hangingPieces, PIECE_VALUE } from '../src/xiangqi/teach';
import { OPENINGS } from '../src/xiangqi/openings';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

function walk(texts: string[]): { board: Board; color: Color; moves: Move[] } | null {
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) return null;
    moves.push(m);
    b = applyMove(b, m);
    c = other(c);
  }
  return { board: b, color: c, moves };
}

function pvText(start: Board, color: Color, pv: string[], n = 10): string[] {
  let cur = start;
  let c = color;
  const out: string[] = [];
  for (const u of pv.slice(0, n)) {
    const m = uciToMove(u);
    if (!m || !legalMoves(cur, c).some((x) => same(x, m))) break;
    out.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    c = other(c);
  }
  return out;
}

/** 全部着法的分数（走子方视角）。multipv 开到全部合法着法 */
function scoreAll(e: NodeEngine, moves: Move[], board: Board, color: Color, ms: number) {
  const n = legalMoves(board, color).length;
  e.send(`setoption name MultiPV value ${n}`);
  e.send(`position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const lines = e.send(`go movetime ${ms}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  const depth = Math.max(...lines.map((l) => l.depth));
  // 取每个 multipv 最深的一条
  const best = new Map<number, PvLine>();
  for (const l of lines) {
    const had = best.get(l.multipv);
    if (!had || l.depth >= had.depth) best.set(l.multipv, l);
  }
  e.send('setoption name MultiPV value 1');
  return { depth, lines: [...best.values()].sort((a, b) => b.score - a.score) };
}

function scoreOne(e: NodeEngine, moves: Move[], m: Move, ms: number): PvLine | null {
  e.send(`position startpos${moves.length ? ' moves ' + moves.map(moveToUci).join(' ') : ''}`);
  const r = e.send(`go movetime ${ms} searchmoves ${moveToUci(m)}`).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound);
  return r[r.length - 1] ?? null;
}

/** "顺手"的应法：吃子、将军、捉那个刚动的子 */
function natural(board: Board, color: Color, m: Move, last: Move): string | null {
  const after = applyMove(board, m);
  const cap = board[m.ty][m.tx];
  if (cap) return `吃${cap.t}`;
  if (isInCheck(after, other(color))) return '将军';
  // 走完之后能吃到对方刚动的那个子
  if (legalMoves(after, color).some((x) => x.tx === last.tx && x.ty === last.ty)) return '反捉';
  return null;
}

const mode = process.argv[2] ?? 'line';
const e = await startPikafish(128);
const found: unknown[] = [];

if (mode === 'line') {
  const LINES: [string, string][] = JSON.parse(fs.readFileSync(process.argv[3] ?? 'node_modules/.cache/trick-lines.json', 'utf8'));
  for (const [pre, trick] of LINES) {
    const p = walk(pre.split(/\s+/).filter(Boolean));
    if (!p) {
      console.log(`✗ 前缀走不通：${pre}`);
      continue;
    }
    const tm = textToMove(p.board, p.color, trick, legalMoves(p.board, p.color));
    if (!tm) {
      console.log(`✗ 邪门着走不通：${pre} | ${trick}`);
      continue;
    }
    const before = scoreAll(e, p.moves, p.board, p.color, 1200);
    const trickScore = before.lines.find((l) => l.pv[0] === moveToUci(tm))?.score ?? scoreOne(e, p.moves, tm, 1200)?.score ?? NaN;
    const best0 = before.lines[0];
    const b1 = applyMove(p.board, tm);
    const c1 = other(p.color);
    const mv1 = [...p.moves, tm];
    const replies = scoreAll(e, mv1, b1, c1, 2500);
    const top = replies.lines[0];
    const traps = replies.lines
      .map((l) => {
        const m = uciToMove(l.pv[0])!;
        return { l, m, why: natural(b1, c1, m, tm), loss: top.score - l.score };
      })
      .filter((x) => x.why && x.loss >= 200)
      .slice(0, 4);
    console.log(`\n===== ${pre} | ${trick}（${p.color === 'r' ? '红' : '黑'}方的邪门着）`);
    console.log(`  本身：最好 ${best0.score}（${pvText(p.board, p.color, best0.pv, 1)}），这一手 ${trickScore}，亏 ${best0.score - trickScore}`);
    console.log(`  应法最好：${top.score}  ${pvText(b1, c1, top.pv).join(' ')}   （${replies.depth} 层）`);
    for (const l of replies.lines.slice(1, 4)) console.log(`    也可以：${l.score}  ${pvText(b1, c1, l.pv, 3).join(' ')}`);
    for (const t of traps) console.log(`  ⚠ 上当（${t.why}）：${t.l.score}，亏 ${t.loss}  ${pvText(b1, c1, t.l.pv).join(' ')}`);
    found.push({
      pre,
      trick,
      trickLoss: best0.score - trickScore,
      bestReply: pvText(b1, c1, top.pv),
      bestScore: top.score,
      alts: replies.lines.slice(1, 4).map((l) => ({ score: l.score, pv: pvText(b1, c1, l.pv, 3) })),
      traps: traps.map((t) => ({ why: t.why, score: t.l.score, loss: t.loss, pv: pvText(b1, c1, t.l.pv) })),
    });
  }
} else {
  // 扫毒饵：常见开局线上的每一个局面
  const bases = new Set<string>();
  for (const o of OPENINGS) for (let i = 2; i <= o.moves.length; i++) bases.add(o.moves.slice(0, i).map((m) => m.t).join(' '));
  for (const extra of (process.argv[3] ?? '').split(';').filter(Boolean)) bases.add(extra);
  for (const pre of bases) {
    const p = walk(pre.split(' '));
    if (!p) continue;
    const all = scoreAll(e, p.moves, p.board, p.color, 1000);
    const best = all.lines[0];
    for (const l of all.lines) {
      const m = uciToMove(l.pv[0])!;
      const loss = best.score - l.score;
      if (loss > 120) continue; // 本身就是漏着的不算：江湖套路要"看着亏、其实不亏"
      const after = applyMove(p.board, m);
      const hang = hangingPieces(after, p.color).filter((h) => PIECE_VALUE[h.t] >= 400 && h.loss >= 300);
      if (!hang.length) continue;
      const c1 = other(p.color);
      const mv1 = [...p.moves, m];
      const rep = scoreAll(e, mv1, after, c1, 1500);
      const top = rep.lines[0];
      for (const h of hang) {
        const take = rep.lines.find((x) => {
          const mm = uciToMove(x.pv[0])!;
          return mm.tx === h.x && mm.ty === h.y;
        });
        if (!take) continue;
        const tl = top.score - take.score;
        if (tl < 250) continue;
        const rec = {
          pre,
          bait: moveToText(p.board, m),
          baitLoss: loss,
          piece: h.t,
          take: pvText(after, c1, take.pv),
          takeLoss: tl,
          best: pvText(after, c1, top.pv),
          bestScore: top.score,
        };
        console.log(`\n🪤 ${pre} ${rec.bait}（亏 ${loss}），吃${h.t}亏 ${tl}`);
        console.log(`   吃了：${rec.take.join(' ')}`);
        console.log(`   正解：${rec.best.join(' ')}（${top.score}）`);
        found.push(rec);
      }
    }
  }
}
fs.writeFileSync(`node_modules/.cache/tricks-${mode}.json`, JSON.stringify(found, null, 1));
