/**
 * 实用残局采集器。
 *
 * 和杀法图形一个思路：**结果由引擎判，不由我背书**。
 * 我手工摆了一批经典残局，验证发现好几个不是illegal就是结果和我以为的不一样
 * ——残局理论细节太多，凭记忆写必然出错，而错的残局课比没有更糟。
 *
 * 所以改成：给定子力组合 → 随机摆合法局面 → 引擎双方对下到底 → 记录真实结果。
 * 学生看到的「这局是赢还是和」是实测出来的。
 *
 * 而且这本身就是最好的残局训练：**先判断这个局面是赢是和，再下到底验证**。
 * 判断力才是残局功力的核心，会不会走反倒是其次。
 */
import { legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color, type PType } from '../src/xiangqi/rules';
import { think } from '../src/xiangqi/ai';
import { toFen, fromFen, moveToText } from '../src/xiangqi/notation';
import { checkBoard } from './validate-positions';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

interface Combo {
  id: string;
  name: string;
  category: '车类' | '马类' | '炮类' | '兵类' | '组合';
  /** 强方（你执的一方）子力 */
  strong: PType[];
  /** 弱方子力 */
  weak: PType[];
  material: string;
  /** 这一局练什么 */
  goal: string;
  tips: string[];
}

/** 专业课里排在前面的实用残局，按子力组合列 */
const COMBOS: Combo[] = [
  {
    id: 'r-vs-aa',
    name: '单车对双士',
    category: '车类',
    strong: ['R'],
    weak: ['A', 'A'],
    material: '车 vs 双士',
    goal: '一个车对付两个士。这是所有残局的入门课——先学会怎么用车把将困在九宫里。',
    tips: [
      '车不要乱将军，先占住能横切的那条线，把将压在底线',
      '帅要过河参与——帅占中路能封住将的横向逃路，这叫"帅助攻"',
      '士会挡道，注意别让士正好填在你要将军的线上',
    ],
  },
  {
    id: 'r-vs-aabb',
    name: '单车对士象全',
    category: '车类',
    strong: ['R'],
    weak: ['A', 'A', 'E', 'E'],
    material: '车 vs 双士双象',
    goal: '完整的士象防线有多硬？这一局直接决定你"该不该兑车"的判断。',
    tips: [
      '士象全是很硬的防线，单车往往吃不动',
      '重点体会：多一个车也赢不了的局面长什么样，那种时候就别盲目兑子',
    ],
  },
  {
    id: 'r-vs-h-aa',
    name: '单车对马双士',
    category: '车类',
    strong: ['R'],
    weak: ['H', 'A', 'A'],
    material: '车 vs 马双士',
    goal: '练怎么捉住乱窜的马，同时不让将跑出来。',
    tips: ['马失去士象保护时最怕被车照住', '先把马和将分开，再逐个处理'],
  },
  {
    id: 'hc-vs-aabb',
    name: '马炮对士象全',
    category: '组合',
    strong: ['H', 'C'],
    weak: ['A', 'A', 'E', 'E'],
    material: '马炮 vs 士象全',
    goal: '马炮是最经典的攻杀组合。练的是马炮怎么互为炮架、互相掩护。',
    tips: ['炮要架子，马正好当架子；马怕被捉，炮正好照住', '经典的「马后炮」就是从这类局面长出来的'],
  },
  {
    id: 'rc-vs-aabb',
    name: '车炮对士象全',
    category: '组合',
    strong: ['R', 'C'],
    weak: ['A', 'A', 'E', 'E'],
    material: '车炮 vs 士象全',
    goal: '车炮配合破士象全。车负责限制，炮负责穿透。',
    tips: ['炮要找到能打进九宫的那条线，车负责把士象逼开', '注意保持炮架'],
  },
  {
    id: 'rp-vs-r-aa',
    name: '车兵对车双士',
    category: '组合',
    strong: ['R', 'P'],
    weak: ['R', 'A', 'A'],
    material: '车兵 vs 车双士',
    goal: '实战出现率最高的残局之一：多一个兵怎么兑现成胜势。',
    tips: ['多兵的一方要避免兑车——兑光了就是单兵对双士', '兵要往九宫方向推，车在旁边保护'],
  },
  {
    id: 'pp-vs-aa',
    name: '双兵对双士',
    category: '兵类',
    strong: ['P', 'P'],
    weak: ['A', 'A'],
    material: '双过河兵 vs 双士',
    goal: '兵类残局最见功夫。两个兵能不能困死将？',
    tips: [
      '兵过河才能横走，这是它唯一的机动性',
      '两个兵要一起走，散开了各自都没威力——「二鬼拍门」就是这个图形',
      '帅一定要顶上去，兵单独成不了事',
    ],
  },
  {
    id: 'hp-vs-aa',
    name: '马兵对双士',
    category: '组合',
    strong: ['H', 'P'],
    weak: ['A', 'A'],
    material: '马兵 vs 双士',
    goal: '马和兵配合。马控点，兵占位。',
    tips: ['马走到能控制将落点的位置，兵顶上去封门', '小心马被蹩腿'],
  },
  {
    id: 'c-aa-vs-r',
    name: '炮双士守单车',
    category: '炮类',
    strong: ['C', 'A', 'A'],
    weak: ['R'],
    material: '炮双士 vs 车（你是守方）',
    goal: '这一局你是少子的一方，练<b>守和</b>。守棋比攻棋难，也更实用。',
    tips: [
      '守和的关键是别让车同时攻到两个目标',
      '炮和士要互相保护，散开就被各个击破',
      '能守和的局面千万别贪着去拼——很多输棋是守方自己走乱的',
    ],
  },
  {
    id: 'aabb-vs-rc',
    name: '士象全守车炮',
    category: '组合',
    strong: ['A', 'A', 'E', 'E'],
    weak: ['R', 'C'],
    material: '士象全 vs 车炮（你是守方）',
    goal: '守方练习。士象怎么摆才是最硬的形状？',
    tips: ['象要能互相保护（连环象），士要能填补中路', '最怕的是炮打士象的那条线，注意别让象落单'],
  },
];

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

function randomPosition(strong: PType[], weak: PType[], sc: Color): Board | null {
  const bd: Board = Array.from({ length: 10 }, () => Array(9).fill(null));
  const wc = other(sc);
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
      if (t === 'P' && (c === 'r' ? y > 4 : y < 5)) continue; // 兵已过河，残局才有意义
      bd[y][x] = { t, c };
      return true;
    }
    return false;
  };
  if (!put('K', 'r') || !put('K', 'b')) return null;
  for (const t of strong) if (!put(t, sc)) return null;
  for (const t of weak) if (!put(t, wc)) return null;
  return bd;
}

interface Outcome {
  result: 'red-win' | 'black-win' | 'draw';
  plies: number;
  reason: string;
}

function playOut(board: Board, toMove: Color, depth: number, timeMs: number, maxPlies: number): Outcome {
  let b = board;
  let c = toMove;
  let sinceCapture = 0;
  const seen = new Map<string, number>();
  for (let ply = 0; ply < maxPlies; ply++) {
    const st = statusAfter(b, c);
    if (st !== 'playing') return { result: st, plies: ply, reason: '将死/困毙' };
    const legal = legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
    if (!legal.length) return { result: c === 'r' ? 'black-win' : 'red-win', plies: ply, reason: '无着可走' };
    const m = think(b, c, { maxDepth: depth, timeMs, jitter: 0 });
    if (!m) return { result: 'draw', plies: ply, reason: '引擎无着' };
    const cap = !!b[m.ty][m.tx];
    b = applyMove(b, m);
    c = other(c);
    sinceCapture = cap ? 0 : sinceCapture + 1;
    if (sinceCapture >= 120) return { result: 'draw', plies: ply + 1, reason: '60 回合无吃子' };
    const key = toFen(b, c);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return { result: 'draw', plies: ply + 1, reason: '三次重复' };
  }
  return { result: 'draw', plies: maxPlies, reason: '未分胜负' };
}

const DEPTH = Number(process.env.DEPTH ?? 9);
const TIME = Number(process.env.TIME_MS ?? 500);
const PER = Number(process.env.PER_COMBO ?? 3);
const BUDGET = Number(process.env.BUDGET_MS ?? 400000);
const ONLY = process.env.ONLY ?? '';

interface EgOut {
  id: string;
  name: string;
  category: string;
  material: string;
  fen: string;
  /** 你执哪一方 */
  you: Color;
  /** 实测结果：你能赢 / 只能和 */
  target: 'win' | 'draw';
  goal: string;
  tips: string[];
  /** 引擎走完用了多少步，用来估难度 */
  plies: number;
  rating: number;
}

const out: EgOut[] = [];
const combos = COMBOS.filter((c) => !ONLY || c.id === ONLY);
for (const combo of combos) {
  let got = 0;
  const t0 = Date.now();
  const budget = BUDGET / combos.length;
  let tried = 0;
  while (got < PER && Date.now() - t0 < budget) {
    tried++;
    // 强方固定执红，"你"就是强方（守方局里 strong 是士象炮，你还是执红）
    const b = randomPosition(combo.strong, combo.weak, 'r');
    if (!b) continue;
    if (statusAfter(b, 'r') !== 'playing' || statusAfter(b, 'b') !== 'playing') continue;
    if (isInCheck(b, 'b') || isInCheck(b, 'r')) continue; // 起手就将着，不是残局练习
    // 闸门：局面必须是真实对局里能出现的（士象的落点、子力数量）
    if (checkBoard(b).length) continue;
    // 太快就结束的不要——那是杀法题不是残局
    const quick = playOut(b, 'r', 6, 200, 12);
    if (quick.result !== 'draw' && quick.plies <= 8) continue;

    const o = playOut(b, 'r', DEPTH, TIME, 200);
    const youWin = o.result === 'red-win';
    const youLose = o.result === 'black-win';
    if (youLose) continue; // 你会输的局面不能当练习

    out.push({
      id: `${combo.id}-${got}`,
      name: combo.name,
      category: combo.category,
      material: combo.material,
      fen: toFen(b, 'r'),
      you: 'r',
      target: youWin ? 'win' : 'draw',
      goal: combo.goal,
      tips: combo.tips,
      plies: o.plies,
      // 赢的局面按步数给难度：越长越难走
      rating: youWin ? Math.min(1700, 950 + o.plies * 6) : 1150,
    });
    got++;
  }
  const w = out.filter((x) => x.id.startsWith(combo.id) && x.target === 'win').length;
  const d = out.filter((x) => x.id.startsWith(combo.id) && x.target === 'draw').length;
  process.stderr.write(
    `${combo.name.padEnd(14)} ${got}/${PER}  胜${w} 和${d}  (试 ${tried} 次, ${Math.round((Date.now() - t0) / 1000)}s)\n`,
  );
}

process.stderr.write(`\n合计 ${out.length} 个残局\n`);
process.stdout.write(JSON.stringify(out));
