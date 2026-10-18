/**
 * "各剩一个马或炮"直接判和，会不会把赢棋判成和：随机摆这类局面，让皮卡鱼两边自己下，看多出士象的一方能不能赢。
 *
 * 用法：node tools/run.mjs minor-draw-check [每种局面数] [每步节点] [eval：只看开局评估、不下]
 */
import { startPikafish } from './pikafish-node';
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type PType } from '../src/xiangqi/rules';
import { parseInfo, uciToMove, type PvLine } from '../src/xiangqi/pikafish';
import { toFen } from '../src/xiangqi/notation';

const [, , a0 = '8', a1 = '30000', a2 = 'play'] = process.argv;
const EVAL_ONLY = a2 === 'eval';
const N = Number(a0);
const NODES = Number(a1);
const e = await startPikafish(64);
let seed = 4242;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pickOf = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

const SQ: Record<'K' | 'A' | 'E', Record<Color, [number, number][]>> = {
  K: { r: [3, 4, 5].flatMap((x) => [7, 8, 9].map((y) => [x, y] as [number, number])), b: [3, 4, 5].flatMap((x) => [0, 1, 2].map((y) => [x, y] as [number, number])) },
  A: { r: [[3, 9], [5, 9], [4, 8], [3, 7], [5, 7]], b: [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]] },
  E: { r: [[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]], b: [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]] },
};

/** 红方：minor + 士象若干；黑方：minor + 士象若干 */
function place(red: PType[], black: PType[]): { b: Board; c: Color } | null {
  for (let tries = 0; tries < 200; tries++) {
    const b: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
    const put = (t: PType, c: Color) => {
      for (let k = 0; k < 50; k++) {
        const [x, y] = t === 'K' || t === 'A' || t === 'E' ? pickOf(SQ[t][c]) : [Math.floor(rnd() * 9), Math.floor(rnd() * 10)];
        if (!b[y][x]) {
          b[y][x] = { t, c };
          return true;
        }
      }
      return false;
    };
    if (!put('K', 'r') || !put('K', 'b')) continue;
    if (![...red.map((t) => put(t, 'r')), ...black.map((t) => put(t, 'b'))].every(Boolean)) continue;
    const c: Color = rnd() < 0.5 ? 'r' : 'b';
    const other: Color = c === 'r' ? 'b' : 'r';
    if (isInCheck(b, other)) continue; // 不该走的一方被将着：不合法
    if (statusAfter(b, c) !== 'playing') continue;
    // 这一步就能吃掉对方的马炮的不要（规则里那种先不判）
    const foeMinor = (col: Color) => {
      for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) if (b[y][x]?.c === col && (b[y][x]!.t === 'H' || b[y][x]!.t === 'C')) return [x, y];
      return [-1, -1];
    };
    const [tx, ty] = foeMinor(other);
    if (legalMoves(b, c).some((m) => m.tx === tx && m.ty === ty)) continue;
    return { b, c };
  }
  return null;
}

function best(fen: string, go: string): PvLine | undefined {
  e.send(`position fen ${fen} - - 0 1`);
  const got = e.send(go).map(parseInfo).filter((x): x is PvLine => !!x && !x.bound && x.multipv === 1);
  return got[got.length - 1];
}

const CFGS: { id: string; red: PType[]; black: PType[] }[] = [
  { id: '马士象全 vs 光炮', red: ['H', 'A', 'A', 'E', 'E'], black: ['C'] },
  { id: '炮士象全 vs 光马', red: ['C', 'A', 'A', 'E', 'E'], black: ['H'] },
  { id: '马士象全 vs 光马', red: ['H', 'A', 'A', 'E', 'E'], black: ['H'] },
  { id: '炮士象全 vs 光炮', red: ['C', 'A', 'A', 'E', 'E'], black: ['C'] },
  { id: '马双士 vs 炮双象', red: ['H', 'A', 'A'], black: ['C', 'E', 'E'] },
  { id: '炮双士 vs 马', red: ['C', 'A', 'A'], black: ['H'] },
];
for (const cfg of CFGS) {
  let redWins = 0;
  let blackWins = 0;
  const evals: number[] = [];
  for (let i = 0; i < N; i++) {
    const p = place(cfg.red, cfg.black);
    if (!p) continue;
    let { b, c } = p;
    e.send('ucinewgame');
    const ev = best(toFen(b, c), 'go nodes 300000');
    if (ev) evals.push((c === 'r' ? 1 : -1) * (ev.mateIn !== undefined ? Math.sign(ev.mateIn) * (10000 - Math.abs(ev.mateIn)) : ev.score));
    if (ev?.mateIn !== undefined) console.log(`  ${cfg.id} 有杀：${toFen(b, c)} mateIn=${ev.mateIn}`);
    if (EVAL_ONLY) continue;
    let result = 'draw';
    for (let ply = 0; ply < 160; ply++) {
      const st = statusAfter(b, c);
      if (st !== 'playing') {
        result = st === 'red-win' ? 'red' : 'black';
        break;
      }
      const l = best(toFen(b, c), `go nodes ${NODES}`);
      const m = l && uciToMove(l.pv[0]);
      if (!m) break;
      b = applyMove(b, m);
      c = c === 'r' ? 'b' : 'r';
    }
    if (result === 'red') redWins++;
    if (result === 'black') blackWins++;
  }
  evals.sort((a, b) => a - b);
  console.log(`${cfg.id}: 红胜 ${redWins} 黑胜 ${blackWins} / ${N}；开局评估（红方视角）${evals.join(' ')}`);
}
process.exit(0);
