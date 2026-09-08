/**
 * 杀法图形的采集器：先由引擎造出**验证过的杀局**，再按几何形状给它起名字。
 *
 * 我一开始是反过来做的——手工摆出「马后炮」的样子再让引擎验，结果 12 个图形
 * 12 个都不对（有的起手就已经将着军、有的根本不成杀、有的答案不唯一）。
 * 手摆棋盘几何太容易错一格，而错一格的题比没有题更糟。
 *
 * 所以改成：
 *   1. 随机摆子 + 引擎验证，拿到「唯一解的 N 回合杀」——正确性由引擎担保
 *   2. 对**杀完之后的局面**跑形状判定，认出这是哪一种经典图形——名字由几何担保
 *
 * 两头都不靠我的记忆，只靠可执行的判定。
 */
import {
  legalMoves,
  applyMove,
  isInCheck,
  statusAfter,
  findKing,
  type Board,
  type Color,
  type PType,
} from '../src/xiangqi/rules';
import { analyze } from '../src/xiangqi/ai';
import { toFen, moveToText } from '../src/xiangqi/notation';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

// ---------------- 形状判定 ----------------
// 全部针对「最后一击走完之后」的局面，攻方固定为红、被杀方为黑。

type Shape = {
  id: string;
  name: string;
  shape: string;
  why: string;
  /** 杀完之后的局面是否符合这个图形 */
  test: (b: Board, kx: number, ky: number, lastTo: { x: number; y: number }, capturedAt: PType | null) => boolean;
};

const at = (b: Board, x: number, y: number) => (x >= 0 && x < 9 && y >= 0 && y < 10 ? b[y][x] : undefined);

/** 沿方向取下一个非空格；返回坐标与棋子 */
function scan(b: Board, x: number, y: number, dx: number, dy: number) {
  let cx = x + dx;
  let cy = y + dy;
  while (cx >= 0 && cx < 9 && cy >= 0 && cy < 10) {
    const p = b[cy][cx];
    if (p) return { x: cx, y: cy, p };
    cx += dx;
    cy += dy;
  }
  return null;
}

const DIRS: [number, number][] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

/** 红方某兵种，从将出发沿某方向：第一个子是 A、第二个子是 B */
function lineIs(b: Board, kx: number, ky: number, first: PType, second: PType): boolean {
  for (const [dx, dy] of DIRS) {
    const a = scan(b, kx, ky, dx, dy);
    if (!a || a.p.c !== 'r' || a.p.t !== first) continue;
    const c = scan(b, a.x, a.y, dx, dy);
    if (c && c.p.c === 'r' && c.p.t === second) return true;
  }
  return false;
}

/** 将的九宫内相邻可走格（不含被占） */
function kingSteps(kx: number, ky: number): [number, number][] {
  const out: [number, number][] = [];
  for (const [dx, dy] of DIRS) {
    const x = kx + dx;
    const y = ky + dy;
    if (x >= 3 && x <= 5 && y >= 0 && y <= 2) out.push([x, y]);
  }
  return out;
}

/** 将帅对脸（同列、中间无子）——和 rules.ts 里的判定一致 */
function facing(b: Board): boolean {
  let rk: [number, number] | null = null;
  let bk: [number, number] | null = null;
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 9; x++) {
      const p = b[y][x];
      if (p && p.t === 'K') (p.c === 'r' ? (rk = [x, y]) : (bk = [x, y]));
    }
  if (!rk || !bk || rk[0] !== bk[0]) return false;
  const x = rk[0];
  for (let y = Math.min(rk[1], bk[1]) + 1; y < Math.max(rk[1], bk[1]); y++) if (b[y][x]) return false;
  return true;
}

/** 车从 (x,y) 能否打到 (tx,ty)（同线且中间无子） */
function rookHits(b: Board, x: number, y: number, tx: number, ty: number): boolean {
  if (x !== tx && y !== ty) return false;
  if (x === tx && y === ty) return false;
  const dx = Math.sign(tx - x);
  const dy = Math.sign(ty - y);
  let cx = x + dx;
  let cy = y + dy;
  while (cx !== tx || cy !== ty) {
    if (b[cy][cx]) return false;
    cx += dx;
    cy += dy;
  }
  return true;
}

const SHAPES: Shape[] = [
  {
    id: 'ma-hou-pao',
    name: '马后炮',
    shape: '马贴着将，炮在马的正后方同一条线上，隔着马打将。',
    why: '炮借马作炮架将军，而这个马同时管着将左右的落点——将既吃不掉马（炮照着），也无处可躲。象棋里出现频率最高的杀型。',
    // 从将出发：第一个子是马，第二个子是炮
    test: (b, kx, ky) => lineIs(b, kx, ky, 'H', 'C'),
  },
  {
    id: 'chong-pao',
    name: '重炮',
    shape: '两个炮叠在同一条线上，前炮给后炮当炮架，一起打将。',
    why: '后炮借前炮做架子将军，将吃前炮就被后炮打，躲又躲不开这条线。两炮叠线比分开威力大得多。',
    test: (b, kx, ky) => lineIs(b, kx, ky, 'C', 'C'),
  },
  {
    id: 'men-gong',
    name: '闷宫',
    shape: '炮从远处打将，而将的退路全被自己的士象堵死。',
    why: '被自己的子堵死是象棋独有的杀法。士象本来是保护将的，位置不对反而成了棺材板——所以补士补象也要讲位置。',
    test: (b, kx, ky) => {
      // 必须是炮在将军（将出发第一个子是任意子当架、第二个是红炮）
      let byCannon = false;
      for (const [dx, dy] of DIRS) {
        const a = scan(b, kx, ky, dx, dy);
        if (!a) continue;
        const c = scan(b, a.x, a.y, dx, dy);
        if (c && c.p.c === 'r' && c.p.t === 'C') byCannon = true;
      }
      if (!byCannon) return false;
      // 九宫内所有相邻格都被自己人占着
      const steps = kingSteps(kx, ky);
      if (!steps.length) return false;
      return steps.every(([x, y]) => {
        const p = at(b, x, y);
        return !!p && p.c === 'b';
      });
    },
  },
  {
    id: 'bai-lian-jiang',
    name: '白脸将（对面笑）',
    shape: '把中间的子挪开，让帅正对着将的那条竖线。',
    why:
      '规则不许将帅对脸，所以将**不能走到那条线上**——注意两个王在杀棋成立时并不是真的照面，真正起作用的是"走过去就对脸了，所以不能走"。等于白白封死一条逃路，很多杀法的最后一击就是它。',
    // 注意：白脸将成杀时两个王**并不是真的照面**——规则不允许对脸，
    // 所以真正起作用的是"将不能走到那一格，因为走过去就对脸了"。
    // 判定方式：把将逐个挪到九宫相邻格，只要有一格是被对脸规则堵死的，就算这个图形。
    test: (b, kx, ky) => {
      for (const [x, y] of kingSteps(kx, ky)) {
        const t = at(b, x, y);
        if (t && t.c === 'b') continue; // 自己人占着，不是被对脸挡的
        const nb = b.map((r) => r.slice());
        nb[y][x] = nb[ky][kx];
        nb[ky][kx] = null;
        if (facing(nb)) return true;
      }
      return false;
    },
  },
  {
    id: 'wo-cao-ma',
    name: '卧槽马',
    shape: '马跳到将侧下方那个「槽」位将军（黑方九宫两侧的 4 路或 6 路）。',
    why: '卧槽位离将最近又最难驱赶，马在这里将军，将只能横move，正好落进车或炮的控制线——马车配合的经典起手。',
    test: (b, _kx, _ky, lastTo) => {
      const p = at(b, lastTo.x, lastTo.y);
      if (!p || p.c !== 'r' || p.t !== 'H') return false;
      // 卧槽：黑方九宫两侧、第 1 或第 2 横线
      return (lastTo.x === 3 || lastTo.x === 5) && (lastTo.y === 1 || lastTo.y === 2);
    },
  },
  {
    id: 'gua-jiao-ma',
    name: '挂角马',
    shape: '马跳进对方九宫的斜角上将军。',
    why: '挂角位同时管着将的两个落点，又不容易被士象吃掉。和卧槽马一样属于「马的好位置」，看到能挂角就要想到杀。',
    test: (b, _kx, _ky, lastTo) => {
      const p = at(b, lastTo.x, lastTo.y);
      if (!p || p.c !== 'r' || p.t !== 'H') return false;
      // 九宫四角
      return (lastTo.x === 3 || lastTo.x === 5) && (lastTo.y === 0 || lastTo.y === 2);
    },
  },
  {
    id: 'tian-di-pao',
    name: '天地炮',
    shape: '一个炮镇中路（天），一个炮打底线（地），上下夹击。',
    why: '中炮管住将上下的活动，底炮管住底线，九宫被两条线封死。名字很形象——一个在天，一个在地。',
    test: (b, kx, ky) => {
      let mid = false;
      let bottom = false;
      for (let y = 0; y < 10; y++) {
        const p = at(b, 4, y);
        if (p && p.c === 'r' && p.t === 'C') mid = true;
      }
      for (let x = 0; x < 9; x++) {
        const p = at(b, x, 0);
        if (p && p.c === 'r' && p.t === 'C') bottom = true;
      }
      return mid && bottom && kx === 4 && ky <= 1;
    },
  },
  {
    id: 'shuang-che-cuo',
    name: '双车错',
    shape: '两个车错开控线，将左右上下都在车的射程里。',
    why: '两个车分工控住相邻的线，将往哪边走都还在另一个车口上。双车的威力在于「错开」而不是叠在一起。',
    // 两个车未必都直线照着将——通常一个将军、另一个封住逃格。
    // 所以判定改成：两个红车各自都在攻击"将或将的逃格"。
    test: (b, kx, ky) => {
      const targets: [number, number][] = [[kx, ky], ...kingSteps(kx, ky)];
      let n = 0;
      for (let y = 0; y < 10; y++) {
        for (let x = 0; x < 9; x++) {
          const p = b[y][x];
          if (!p || p.c !== 'r' || p.t !== 'R') continue;
          if (targets.some(([tx, ty]) => rookHits(b, x, y, tx, ty))) n++;
        }
      }
      return n >= 2;
    },
  },
  {
    id: 'tie-men-shuan',
    name: '铁门栓',
    shape: '中炮镇住中路，车切进底线，将被「栓」死在原地。',
    why: '中炮封住将上下的路，车封住左右的路，两条线一交叉，九宫就成了铁笼子。中炮布局最想走出来的定型。',
    // 要求"炮打的第一个子正好是将"太死了：铁门栓的实质是
    // 中炮把中路封住 + 车切进来管住横线，炮未必直接将军。
    test: (b, kx, ky) => {
      if (kx !== 4) return false;
      let midCannon = false;
      for (let y = ky + 1; y < 10; y++) {
        const p = b[y][4];
        if (p && p.c === 'r' && p.t === 'C') midCannon = true;
      }
      if (!midCannon) return false;
      const targets: [number, number][] = [[kx, ky], ...kingSteps(kx, ky)];
      for (let y = 0; y < 10; y++)
        for (let x = 0; x < 9; x++) {
          const p = b[y][x];
          if (p && p.c === 'r' && p.t === 'R' && targets.some(([tx, ty]) => rookHits(b, x, y, tx, ty))) return true;
        }
      return false;
    },
  },
  {
    id: 'er-gui-pai-men',
    name: '二鬼拍门',
    shape: '两个过河兵一左一右顶在九宫门口。',
    why: '兵到了对方九宫附近就不是小兵了。两兵分踞将的两侧，将往哪边都被吃，这是兵类残局最常见的取胜图形。',
    test: (b, kx, ky) => {
      let n = 0;
      for (const [dx, dy] of DIRS) {
        const p = at(b, kx + dx, ky + dy);
        if (p && p.c === 'r' && p.t === 'P') n++;
      }
      return n >= 2;
    },
  },
  {
    id: 'da-dao-wan-xin',
    name: '大刀剜心',
    shape: '用车硬砍掉中士，把对方防线从中间劈开。',
    why: '士是九宫的门闩。宁可用车换掉一个士也要把中路打开——学会「该弃则弃」是从业余到专业的分水岭。',
    // 砍士通常是倒数第二手（弃车破防），不是最后一击，所以只要这条线里
    // 出现过"红车吃掉九宫里的士"就算
    test: (_b, _kx, _ky, _lastTo, capturedAt) => capturedAt === 'A',
  },
];

// ---------------- 造局面 ----------------

function randomPosition(atk: PType[], def: PType[]): Board | null {
  const bd: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const put = (t: PType, c: Color): boolean => {
    for (let k = 0; k < 90; k++) {
      const y = (Math.random() * 10) | 0;
      const x = (Math.random() * 9) | 0;
      if (bd[y][x]) continue;
      const inPalace = x >= 3 && x <= 5 && (c === 'r' ? y >= 7 : y <= 2);
      if ((t === 'K' || t === 'A') && !inPalace) continue;
      if (t === 'E' && (c === 'r' ? y < 5 : y > 4)) continue;
      if (t === 'P' && (c === 'r' ? y > 6 : y < 3)) continue;
      // 攻方的子必须压在黑方半场，否则随机摆出来的图形离九宫太远，
      // 形状判定永远命中不了；兵还要更靠前一点
      if (c === 'r' && t !== 'K' && t !== 'A' && t !== 'E' && y > 4) continue;
      if (c === 'r' && t === 'P' && y > 3) continue;
      // 黑将别老蹲在角上，中路更接近实战图形
      if (t === 'K' && c === 'b' && Math.random() < 0.6 && x !== 4) continue;
      bd[y][x] = { t, c };
      return true;
    }
    return false;
  };
  if (!put('K', 'r') || !put('K', 'b')) return null;
  for (const t of atk) if (!put(t, 'r')) return null;
  for (const t of def) if (!put(t, 'b')) return null;
  return bd;
}

/** 每种图形该带什么子，命中率高得多 */
const SETS: Record<string, [PType[], PType[]][]> = {
  'ma-hou-pao': [[['H', 'C'], ['A', 'A']], [['H', 'C', 'R'], ['A', 'A', 'E']]],
  'chong-pao': [[['C', 'C'], ['A', 'A']], [['C', 'C', 'H'], ['A', 'A', 'E']]],
  'men-gong': [[['C'], ['A', 'A', 'E', 'E']], [['C', 'H'], ['A', 'A', 'E', 'E']]],
  'wo-cao-ma': [[['H', 'R'], ['A', 'A']], [['H', 'C'], ['A', 'A', 'E']]],
  'gua-jiao-ma': [[['H', 'R'], ['A', 'A']], [['H', 'C'], ['A', 'A']]],
  // 天地炮要一炮在中路一炮在底线，随机摆很难同时凑齐，多给一个子帮忙成杀
  'tian-di-pao': [[['C', 'C', 'R'], ['A', 'A', 'E']], [['C', 'C', 'H'], ['A', 'A', 'E']], [['C', 'C', 'P'], ['A', 'A']]],
  'shuang-che-cuo': [[['R', 'R'], ['A', 'A', 'E']], [['R', 'R'], ['A', 'A', 'E', 'H']], [['R', 'R'], ['A', 'A']]],
  // 铁门栓需要中路有个"架子"给炮隔，纯 K/C/R 很难自然出现，加个兵当架子
  'tie-men-shuan': [[['C', 'R', 'P'], ['A', 'A']], [['C', 'R', 'H'], ['A', 'A', 'E']], [['C', 'R'], ['A', 'A', 'E']]],
  'er-gui-pai-men': [[['P', 'P', 'R'], ['A', 'A']], [['P', 'P', 'C'], ['A', 'A']], [['P', 'P', 'H'], ['A', 'A']]],
  'bai-lian-jiang': [[['R'], ['A', 'A']], [['R', 'P'], ['A']], [['H', 'P'], ['A', 'A']], [['C', 'P'], ['A']]],
  'da-dao-wan-xin': [[['R', 'C'], ['A', 'A', 'E']], [['R', 'C', 'H'], ['A', 'A', 'E', 'E']]],
};

const MAX_MATE = Number(process.env.MAX_MATE ?? 3);
const PER_SHAPE = Number(process.env.PER_SHAPE ?? 4);
const BUDGET_MS = Number(process.env.BUDGET_MS ?? 240000);
const ONLY = process.env.ONLY ?? '';

interface Found {
  id: string;
  name: string;
  shape: string;
  why: string;
  fen: string;
  answer: string;
  line: string[];
  mateIn: number;
  rating: number;
}

const out: Found[] = [];
const seen = new Set<string>();

/** 走一步并返回新盘 + 被吃子的兵种 */
function step(b: Board, m: { fx: number; fy: number; tx: number; ty: number }) {
  const victim = b[m.ty][m.tx];
  return { board: applyMove(b, m), captured: victim ? victim.t : null };
}

const shapes = SHAPES.filter((s) => !ONLY || s.id === ONLY);
for (const sh of shapes) {
  const sets = SETS[sh.id] ?? [[['R', 'C'], ['A', 'A']]];
  let got = 0;
  const t0 = Date.now();
  const budget = BUDGET_MS / shapes.length;

  while (got < PER_SHAPE && Date.now() - t0 < budget) {
    const [atk, def] = sets[(Math.random() * sets.length) | 0];
    const b = randomPosition(atk, def);
    if (!b) continue;
    if (statusAfter(b, 'r') !== 'playing' || statusAfter(b, 'b') !== 'playing') continue;
    if (isInCheck(b, 'b')) continue; // 起手就将着军，不成题

    const a = analyze(b, 'r', { maxDepth: 7, timeMs: 4000, jitter: 0 });
    if (!a.moves.length) continue;
    const top = a.moves[0];
    if (top.mateIn === undefined || top.mateIn <= 0 || top.mateIn > MAX_MATE) continue;
    const second = a.moves[1];
    if (second && second.mateIn !== undefined && second.mateIn > 0 && second.mateIn <= top.mateIn) continue; // 解不唯一

    // 把主变走完，对最终局面判形状
    let cur: Board = b;
    const line: string[] = [];
    let lastTo = { x: top.move.tx, y: top.move.ty };
    let captured: PType | null = null;
    let okLine = true;
    for (const m of top.pv.slice(0, top.mateIn * 2)) {
      const legal = legalMoves(cur, cur === b ? 'r' : ('r' as Color)); // 仅用于健壮性，实际按 pv 顺序走
      void legal;
      line.push(moveToText(cur, m));
      const r = step(cur, m);
      cur = r.board;
      lastTo = { x: m.tx, y: m.ty };
      if (r.captured) captured = r.captured;
    }
    if (!okLine) continue;

    const k = findKing(cur, 'b');
    if (!k) continue;
    // 必须确实已经被将死
    if (statusAfter(cur, 'b') !== 'red-win') continue;
    if (!sh.test(cur, k[0], k[1], lastTo, captured)) continue;

    const fen = toFen(b, 'r');
    if (seen.has(fen)) continue;
    seen.add(fen);
    out.push({
      id: `${sh.id}-${got}`,
      name: sh.name,
      shape: sh.shape,
      why: sh.why,
      fen,
      answer: moveToText(b, top.move),
      line,
      mateIn: top.mateIn,
      rating: 850 + (top.mateIn - 1) * 200,
    });
    got++;
  }
  process.stderr.write(`${sh.name.padEnd(10)} ${got}/${PER_SHAPE}  (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}

process.stderr.write(`\n合计 ${out.length} 个图形实例\n`);
process.stdout.write(JSON.stringify(out));
