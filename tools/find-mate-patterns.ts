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
import { toFen, fromFen, moveToText } from '../src/xiangqi/notation';
import { checkBoard } from './validate-positions';

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
    shape: '将、马、炮在同一条线上，马夹在中间当炮架，炮隔着马打将。',
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
      if (!byCannon) {
        bump('闷宫·不是炮在将军');
        return false;
      }
      // 九宫内所有相邻格都被自己人占着
      const steps = kingSteps(kx, ky);
      if (!steps.length) {
        bump('闷宫·将没有相邻格');
        return false;
      }
      const blocked = steps.filter(([x, y]) => {
        const p = at(b, x, y);
        return !!p && p.c === 'b';
      }).length;
      if (blocked < steps.length) {
        bump(`闷宫·退路只堵住 ${blocked}/${steps.length}`);
        return false;
      }
      return true;
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
    why: '卧槽位离将最近又最难驱赶，马在这里将军，将只能横着挪，正好落进车或炮的控制线——马车配合的经典起手。',
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

/**
 * 骨架预置：有些图形对摆位的要求太具体，随机撒点几乎不可能撞上。
 *
 * 比如闷宫要求「将在 (4,0)、双士正好堵住 (3,0)(5,0)、再有个子填 (4,1)」，
 * 三个条件同时命中的概率极低——跑 140 秒一个都出不来。
 *
 * 所以对这类图形先把骨架摆好，剩下的子随机撒，**正确性照旧由引擎验**
 * （唯一解的 N 回合杀 + 几何判定）。我摆错了的话引擎会一个都验不过，
 * 这一点今天已经验证过很多次了。
 */
type Seed = { fixed: [PType, Color, number, number][]; rand: [PType, Color][] };

const SEEDS: Record<string, Seed[]> = {
  'men-gong': [
    {
      // 将困在底线正中，双士堵住左右，马填住唯一的上方退路
      fixed: [['K', 'b', 4, 0], ['A', 'b', 3, 0], ['A', 'b', 5, 0], ['H', 'b', 4, 1], ['K', 'r', 4, 9]],
      rand: [['C', 'r'], ['R', 'r']],
    },
    {
      // 最经典的那一型：中士当炮架，将被自己的车马堵在底线两边
      fixed: [['K', 'b', 4, 0], ['A', 'b', 4, 1], ['C', 'b', 3, 0], ['H', 'b', 5, 0], ['K', 'r', 4, 9]],
      rand: [['C', 'r'], ['C', 'r']],
    },
    {
      // 双士堵两边、马填正中
      fixed: [['K', 'b', 4, 0], ['A', 'b', 3, 0], ['A', 'b', 5, 0], ['H', 'b', 4, 1], ['K', 'r', 4, 9]],
      rand: [['C', 'r'], ['C', 'r']],
    },
    {
      // 堵路的子必须**动不了**才行。上面两个骨架里那匹马是能跳开的，
      // 黑方一躲，最终局面就不再是"退路全被自己人堵死"，图形判定当然过不去
      //（实测就是卡在"退路只堵住 2/3"）。这一型把中士四个落点全占满，
      // 士彻底动不了，才是真正的闷宫。
      fixed: [
        ['K', 'b', 4, 0], ['A', 'b', 4, 1], ['A', 'b', 3, 2],
        ['R', 'b', 3, 0], ['H', 'b', 5, 0], ['C', 'b', 5, 2],
        ['K', 'r', 4, 9],
      ],
      rand: [['C', 'r'], ['C', 'r']],
    },
  ],
  'tian-di-pao': [
    {
      // 一炮镇中路、一炮打底线，将在中路
      fixed: [['K', 'b', 4, 1], ['A', 'b', 3, 0], ['A', 'b', 5, 0], ['K', 'r', 4, 9]],
      rand: [['C', 'r'], ['C', 'r'], ['R', 'r']],
    },
    {
      fixed: [['K', 'b', 4, 0], ['A', 'b', 4, 1], ['E', 'b', 2, 0], ['K', 'r', 4, 9]],
      rand: [['C', 'r'], ['C', 'r'], ['H', 'r']],
    },
  ],
  'er-gui-pai-men': [
    {
      // 双兵贴在将两侧
      fixed: [['K', 'b', 4, 1], ['P', 'r', 3, 1], ['P', 'r', 5, 1], ['K', 'r', 4, 9]],
      rand: [['R', 'r']],
    },
    {
      fixed: [['K', 'b', 4, 0], ['P', 'r', 3, 0], ['P', 'r', 5, 0], ['K', 'r', 4, 9]],
      rand: [['C', 'r'], ['R', 'r']],
    },
  ],
};

/**
 * 骨架自检：**写死的那些子必须站在它这辈子到得了的格子上**。
 *
 * 这里栽过一次，而且和最初那个士象 bug 一模一样：闷宫的骨架里写了
 * 「黑兵在 (4,1)」，可黑兵是往下走的，永远到不了第 1 行。落点闸门确实
 * 拦住了它，但拦得**一声不吭**——于是闷宫这个图形一直造不出来，
 * 查了半天才发现是我自己的骨架写错了。所以骨架要在启动时就自检，
 * 错了立刻报出来，别等到"产出 0 个"再回头猜。
 */
for (const [id, seeds] of Object.entries(SEEDS)) {
  for (const seed of seeds) {
    for (const [t, c, x, y] of seed.fixed) {
      if (!canStand(t, c, x, y)) {
        throw new Error(`骨架 ${id} 写错了：${c}${t} 到不了 (${x},${y})`);
      }
    }
  }
}

/** 按骨架造局面：固定子摆好，其余随机 */
function seededPosition(seed: Seed): Board | null {
  const bd: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  for (const [t, c, x, y] of seed.fixed) {
    if (bd[y][x]) return null;
    bd[y][x] = { t, c };
  }
  for (const [t, c] of seed.rand) {
    let ok = false;
    for (let k = 0; k < 120 && !ok; k++) {
      const y = (Math.random() * 10) | 0;
      const x = (Math.random() * 9) | 0;
      if (bd[y][x]) continue;
      if (!canStand(t, c, x, y)) continue;
      if (c === 'r' && t !== 'K' && t !== 'A' && t !== 'E' && y > 4) continue;
      if (c === 'r' && t === 'P' && y > 3) continue;
      bd[y][x] = { t, c };
      ok = true;
    }
    if (!ok) return null;
  }
  return bd;
}

// ---------------- 造局面 ----------------

/**
 * 受限兵种的全部可落点。直接从这个表里抽，比"随机撒点再拒绝"快一个数量级——
 * 士只有 5 个合法格，随机撒到 90 个格子上命中率只有 5%，绝大部分时间在空转。
 */
function legalSquares(t: PType, c: Color): [number, number][] | null {
  if (t === 'K') {
    const ys = c === 'r' ? [7, 8, 9] : [0, 1, 2];
    const out: [number, number][] = [];
    for (const y of ys) for (const x of [3, 4, 5]) out.push([x, y]);
    return out;
  }
  if (t === 'A') {
    return c === 'r' ? [[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]] : [[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]];
  }
  if (t === 'E') {
    return c === 'r'
      ? [[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]]
      : [[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]];
  }
  return null; // 车马炮兵仍然随机撒点，它们的可落点很多
}

/**
 * 这个子能不能站在这一格——**必须按真正的落点判，不能只判"在不在九宫/本方半场"**。
 *
 * 这里踩过一个大坑：原来士只判了 x∈[3,5] 且在九宫的 y 范围内，
 * 等于允许士出现在九宫的 9 个格里。但士只能沿斜线走，一辈子只能落在
 * **5 个交叉点**上；象同理，只有 7 个象位。结果生成出来的局面里
 * 有 45%~80% 摆着"这辈子走不到那儿"的士象，懂棋的一眼就看出是假局面。
 */
function canStand(t: PType, c: Color, x: number, y: number): boolean {
  const eq = (l: readonly (readonly [number, number])[]) => l.some(([a, b]) => a === x && b === y);
  switch (t) {
    case 'K':
      return x >= 3 && x <= 5 && (c === 'r' ? y >= 7 && y <= 9 : y >= 0 && y <= 2);
    case 'A':
      // 九宫的五个斜线交叉点
      return eq(c === 'r' ? ([[3, 7], [5, 7], [4, 8], [3, 9], [5, 9]] as const)
                          : ([[3, 0], [5, 0], [4, 1], [3, 2], [5, 2]] as const));
    case 'E':
      // 本方七个象位（不过河）
      return eq(c === 'r' ? ([[2, 9], [6, 9], [0, 7], [4, 7], [8, 7], [2, 5], [6, 5]] as const)
                          : ([[2, 0], [6, 0], [0, 2], [4, 2], [8, 2], [2, 4], [6, 4]] as const));
    case 'P':
      // 兵不能倒退回自己底线；没过河时只能待在原始的偶数纵线上
      if (c === 'r') return y <= 6 && (y <= 4 || x % 2 === 0);
      return y >= 3 && (y >= 5 || x % 2 === 0);
    default:
      return true; // 车马炮哪儿都能到
  }
}

function randomPosition(atk: PType[], def: PType[]): Board | null {
  const bd: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const put = (t: PType, c: Color): boolean => {
    // 受限兵种直接从可落点里抽，别用随机撒点碰运气
    const fixed = legalSquares(t, c);
    if (fixed) {
      const free = fixed.filter(([x, y]) => !bd[y][x]);
      if (!free.length) return false;
      const [x, y] = free[(Math.random() * free.length) | 0];
      bd[y][x] = { t, c };
      return true;
    }
    for (let k = 0; k < 90; k++) {
      const y = (Math.random() * 10) | 0;
      const x = (Math.random() * 9) | 0;
      if (bd[y][x]) continue;
      if (!canStand(t, c, x, y)) continue;
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
/** 各道关卡拦下多少——DEBUG=1 时打印。造不出图形时靠这个定位，别猜 */
const stat: Record<string, number> = {};
const bump = (k: string) => { stat[k] = (stat[k] ?? 0) + 1; };

const SETS: Record<string, [PType[], PType[]][]> = {
  'ma-hou-pao': [[['H', 'C'], ['A', 'A']], [['H', 'C', 'R'], ['A', 'A', 'E']]],
  'chong-pao': [[['C', 'C'], ['A', 'A']], [['C', 'C', 'H'], ['A', 'A', 'E']]],
  // 闷宫要求将的退路全被自己人堵死。双士双象堵不住九宫正中那一格（象落不到），
  // 必须给黑方配一个马或卒去填 (4,1)，否则这个图形根本造不出来。
  // 闷宫必须是**炮**将死的。给红方配车配马的话，杀棋十有八九是车马做的，
  // 图形判定就通不过——实测五个成杀的候选全是"不是炮在将军"。所以红方只给炮。
  'men-gong': [
    [['C', 'C'], ['A', 'A', 'H']],
    [['C'], ['A', 'A', 'H']],
    [['C', 'C'], ['A', 'A', 'H', 'E']],
    [['C', 'C'], ['A', 'A', 'C']],
  ],
  'wo-cao-ma': [[['H', 'R'], ['A', 'A']], [['H', 'C'], ['A', 'A', 'E']]],
  'gua-jiao-ma': [[['H', 'R'], ['A', 'A']], [['H', 'C'], ['A', 'A']]],
  // 天地炮要一炮在中路一炮在底线，随机摆很难同时凑齐，多给一个子帮忙成杀
  'tian-di-pao': [[['C', 'C', 'R'], ['A', 'A', 'E']], [['C', 'C', 'H'], ['A', 'A', 'E']], [['C', 'C', 'P'], ['A', 'A']]],
  'shuang-che-cuo': [[['R', 'R'], ['A', 'A', 'E']], [['R', 'R'], ['A', 'A', 'E', 'H']], [['R', 'R'], ['A', 'A']]],
  // 铁门栓需要中路有个"架子"给炮隔，纯 K/C/R 很难自然出现，加个兵当架子
  'tie-men-shuan': [[['C', 'R', 'P'], ['A', 'A']], [['C', 'R', 'H'], ['A', 'A', 'E']], [['C', 'R'], ['A', 'A', 'E']]],
  // 二鬼拍门要两个兵贴着将，守方带太多子几乎不可能成杀
  'er-gui-pai-men': [
    [['P', 'P'], []],
    [['P', 'P', 'R'], []],
    [['P', 'P', 'C'], []],
    [['P', 'P', 'R'], ['A']],
    [['P', 'P', 'H'], ['A']],
    [['P', 'P', 'C'], ['A', 'A']],
  ],
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
  /** 和 answer 一样快的其它杀法，判对错时一起算对 */
  also?: string[];
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
    const seeds = SEEDS[sh.id];
    let b: Board | null;
    if (seeds && Math.random() < 0.85) {
      b = seededPosition(seeds[(Math.random() * seeds.length) | 0]);
    } else {
      const [atk, def] = sets[(Math.random() * sets.length) | 0];
      b = randomPosition(atk, def);
    }
    if (!b) continue;
    bump('摆出局面');
    if (statusAfter(b, 'r') !== 'playing' || statusAfter(b, 'b') !== 'playing') continue;
    if (isInCheck(b, 'b')) {
      bump('起手就将着军');
      continue; // 不成题
    }

    // 深度必须够：7 层报出来的"几回合杀"会飘，实测 9 层起才稳，这里取 13 留余量
    const a = analyze(b, 'r', { maxDepth: 13, timeMs: 8000, jitter: 0 });
    if (!a.moves.length) continue;
    const top = a.moves[0];
    if (top.mateIn === undefined || top.mateIn <= 0 || top.mateIn > MAX_MATE) {
      bump('不成杀或步数太多');
      continue;
    }
    // 同样快的杀法全收下来一起算对。原来这里是"发现第二手也能杀就丢掉"，
    // 但浅层的次佳常常还没搜出杀来，所以那个"唯一"是假的——
    // 真正的后果是学生走出另一手同样快的杀棋会被判错。
    const alts = a.moves.filter((m) => m.mateIn === top.mateIn).map((m) => moveToText(b, m.move));
    if (alts.length > 4) {
      bump('杀法太多，不成题');
      continue;
    }
    bump('成杀了');

    // 把主变走完，对最终局面判形状。
    //
    // ⚠️ 这里原来走的是 `pv.slice(0, mateIn * 2)`，**多走了一步**：N 回合杀
    // 只有 2N-1 步，走满 2N 步等于在将死之后还往下走一手。置换表抠出来的
    // 主变尾巴不一定合法，多走的那一手常常把黑将吃掉，于是 findKing 返回 null，
    // 整个候选被无声地丢掉。闷宫造不出来就是栽在这儿：66 个成杀的候选里
    // 有 45 个死在这一行，而且一句话都没打印。走到将死就停。
    let cur: Board = b;
    const line: string[] = [];
    let lastTo = { x: top.move.tx, y: top.move.ty };
    let captured: PType | null = null;
    let over: 'playing' | 'red-win' | 'black-win' | 'draw' = 'playing';
    for (const m of top.pv.slice(0, top.mateIn * 2 - 1)) {
      const legalNow = legalMoves(cur, cur === b ? 'r' : ('r' as Color));
      void legalNow;
      line.push(moveToText(cur, m));
      const r = step(cur, m);
      cur = r.board;
      lastTo = { x: m.tx, y: m.ty };
      if (r.captured) captured = r.captured;
      over = statusAfter(cur, cur === b ? 'r' : ('b' as Color));
      if (over !== 'playing') break;
    }

    const k = findKing(cur, 'b');
    if (!k) {
      bump('主变把将走没了');
      continue;
    }
    // 必须确实已经被将死
    if (statusAfter(cur, 'b') !== 'red-win') {
      bump('主变走完并没有将死');
      continue;
    }
    if (!sh.test(cur, k[0], k[1], lastTo, captured)) {
      bump('杀完之后不是这个图形');
      continue;
    }

    const fen = toFen(b, 'r');
    if (seen.has(fen)) {
      bump('这个局面已经收过了');
      continue;
    }
    // 闸门：局面必须是真实对局里能出现的
    const chk = fromFen(fen);
    if (!chk) {
      bump('FEN 读不回来');
      continue;
    }
    const errs = checkBoard(chk.board);
    if (errs.length) {
      bump(`摆位不合法(${errs[0]})`);
      continue;
    }
    seen.add(fen);
    out.push({
      id: `${sh.id}-${got}`,
      name: sh.name,
      shape: sh.shape,
      why: sh.why,
      fen,
      answer: moveToText(b, top.move),
      ...(alts.length > 1 ? { also: alts.filter((t) => t !== moveToText(b, top.move)) } : {}),
      line,
      mateIn: top.mateIn,
      rating: 850 + (top.mateIn - 1) * 200,
    });
    got++;
  }
  process.stderr.write(`${sh.name.padEnd(10)} ${got}/${PER_SHAPE}  (${Math.round((Date.now() - t0) / 1000)}s)\n`);
}

if (process.env.DEBUG) {
  process.stderr.write('\n各道关卡拦下的数量：\n');
  for (const k of Object.keys(stat).sort()) process.stderr.write(`  ${k.padEnd(20)} ${stat[k]}\n`);
}
process.stderr.write(`\n合计 ${out.length} 个图形实例\n`);
process.stdout.write(JSON.stringify(out));
