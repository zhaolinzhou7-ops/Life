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
 *
 * ⚠️ 第二次踩坑（比士象摆位那次更隐蔽）：
 * 原来的胜和判定是「引擎自己对下一盘，红方赢了就记胜，没赢就记和」，
 * 而引擎只有 9 层 / 500ms。结果**单车对双士这种教科书例胜，引擎有时赢不下来，
 * 就被记成了「和」**——软件于是理直气壮地教了一个假结论。
 * 同一个「单车对双士」四个局面记出了 3 胜 1 和，自相矛盾。
 *
 * 所以现在多了两道闸门：
 *   1. 每个子力组合写上**定式结论**（theory），实测结论和定式对不上的局面直接扔掉，
 *      不进库。宁可少几个局面，也不能教错。
 *   2. 判定用的引擎强度大幅提高，且**上限按 App 自己的规则来**（60 回合无吃子判和），
 *      赢不下来的"胜"本来也兑现不了。
 */
import { legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color, type PType } from '../src/xiangqi/rules';
import { think, analyze, resetEngine } from '../src/xiangqi/ai';
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
  /**
   * 这个子力组合的**定式结论**（站在"你"的角度）。
   * 实测结论必须和它一致，否则说明要么局面不典型、要么引擎没走出来——两种都不能进库。
   * 'varies' 留给结论真的取决于具体摆法的组合（比如车兵对车双士）。
   */
  theory: 'win' | 'draw' | 'varies';
  /**
   * 棋书上这一类的定论，**只用来显示，不参与判定**。
   *
   * 有些组合（马炮对士象全、马兵对双士）书上是例胜，但要走很多步很精确的棋，
   * 我的引擎冷启动之后在 60 回合内走不出来。这时候标"和棋"是实测事实，
   * 可要是不说明白，懂棋的人会以为软件算错了。所以把书上的结论一起显示出来，
   * 让人看得见"这是引擎走不出来"，而不是"这局理论上就是和"。
   */
  book?: string;
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
    /** 单车例胜双士，教科书结论，没有争议 */
    book: '单车例胜双士',
    theory: 'win',
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
    /** 单车例和士象全，同样是教科书结论——「该不该兑车」就是按这条判的 */
    book: '单车例和士象全',
    theory: 'draw',
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
    /** 车对马双士的结论要看马和将的相对位置，不硬写 */
    book: '单车对马双士，书上归入车胜马双士，但要走很精确',
    theory: 'varies',
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
    /** 马炮破士象全要走对方法，随机摆出来的局面不一定还在胜势里 */
    book: '马炮例胜士象全——是公认的胜势，只是技术要求很高',
    theory: 'varies',
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
    /** 同上，车炮虽强，摆法不对也赢不下来 */
    book: '车炮例胜士象全',
    theory: 'varies',
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
    /** 多一个兵能不能兑现，完全取决于兵的位置和车的站位 */
    book: '车兵对车双士，能不能赢要看兵和车的位置',
    theory: 'varies',
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
    /** 两个兵要成「二鬼拍门」才必胜，散开的两个兵经常只是和 */
    book: '双兵能不能胜双士，要看两个兵能不能形成「二鬼拍门」',
    theory: 'varies',
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
    /** 马兵胜双士要马能控点、兵能占位，位置不对就和 */
    book: '马兵例胜双士——是胜势，但要马控点、兵占位配合得很准',
    theory: 'varies',
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
    /** 炮双士例和单车，守方只要不走乱就守得住 */
    book: '炮双士例和单车',
    theory: 'draw',
  },
  {
    id: 'h-vs-a',
    name: '单马对单士',
    category: '马类',
    strong: ['H'],
    weak: ['A'],
    material: '马 vs 单士',
    goal: '马怎么单独把将困住。这是马类残局的入门课，也是"马控点"这个概念最干净的例子。',
    tips: [
      '马不能像车那样一条线扫过去，只能一格一格地把将的落点掐掉',
      '帅必须过来帮忙——单马加单帅才封得住九宫',
      '注意别被士垫住马腿，马腿被蹩就等于这一手没了',
    ],
    book: '单马例胜单士，但要走得很准，帅不上去就赢不了',
    theory: 'varies',
  },
  {
    id: 'h-vs-aa',
    name: '单马对双士',
    category: '马类',
    strong: ['H'],
    weak: ['A', 'A'],
    material: '马 vs 双士',
    goal: '和上一课只差一个士，结论就反过来了。练的是<b>判断</b>：什么时候该兑、什么时候该守。',
    tips: [
      '两个士互相保护，马再怎么走也掐不干净将的落点',
      '这一局的价值在于知道它是和棋——实战里该不该用马换掉对方最后一个士，全看这条',
    ],
    book: '单马例和双士',
    theory: 'draw',
  },
  {
    id: 'rp-vs-aabb',
    name: '车兵对士象全',
    category: '组合',
    strong: ['R', 'P'],
    weak: ['A', 'A', 'E', 'E'],
    material: '车兵 vs 士象全',
    goal: '实战出现率极高：单车破不了士象全，加一个兵就能破。练的就是这个兵怎么用。',
    tips: [
      '兵是用来<b>换士</b>的，不是用来将军的——兵换掉一个士，车就有机可乘',
      '兵要走到九宫口（四路或六路）才有价值，散在边路等于没有',
      '别急着兑车，兑光了就是单兵对士象全，那是和棋',
    ],
    book: '车兵例胜士象全',
    theory: 'varies',
  },
  {
    id: 'pp-hi-vs-aabb',
    name: '高低兵对士象全',
    category: '兵类',
    strong: ['P', 'P'],
    weak: ['A', 'A', 'E', 'E'],
    material: '双兵 vs 士象全',
    goal: '一个高兵一个低兵配合破士象全。兵类残局里最实用的一型。',
    tips: [
      '高兵负责机动，低兵负责占位，两个兵的分工不一样',
      '帅要顶到中路，兵才有落脚的地方',
      '象是最难缠的——先想办法把象逼开，再动士',
    ],
    book: '高低兵例胜士象全，但要走得很精确',
    theory: 'varies',
  },
  {
    id: 'cp-vs-aa',
    name: '炮兵对双士',
    category: '组合',
    strong: ['C', 'P'],
    weak: ['A', 'A'],
    material: '炮兵 vs 双士',
    goal: '炮需要架子，而对方的士正好可以当架子。练的是怎么把对方的子变成自己的工具。',
    tips: [
      '炮打闷宫的机会就藏在这类局面里——士被自己的将堵住，炮隔着士打',
      '兵的作用是逼士动，士一动阵型就散',
      '帅不上去，炮兵成不了事',
    ],
    book: '炮兵能不能胜双士，要看兵的位置和士的形状',
    theory: 'varies',
  },
  {
    id: 'h-aa-vs-r',
    name: '马双士守单车',
    category: '车类',
    strong: ['H', 'A', 'A'],
    weak: ['R'],
    material: '马双士 vs 车（你是守方）',
    goal: '又一课守棋。马比炮难守——马没有炮那种远程反击，只能靠位置。',
    tips: [
      '马要待在能被士保护的位置，落单就会被车捉死',
      '将别乱走，走出九宫等于送',
      '守和的关键永远是：别让对方的车同时攻到两个目标',
    ],
    book: '单车对马双士，书上归入车胜，守方要走得很准才和得了',
    theory: 'varies',
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
    /** 士象全例和车炮，前提是象要连、士要正 */
    book: '士象全例和车炮',
    theory: 'draw',
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
  /** 棋书上这一类的定论，只用来显示 */
  book?: string;
}

/** 盘面子力差（红减黑，不含将帅），用来判断谁是强方 */
function edge(b: Board): number {
  const V: Record<string, number> = { A: 220, E: 220, H: 450, R: 1000, C: 500, P: 100 };
  let s = 0;
  for (const row of b) for (const p of row) if (p && p.t !== 'K') s += (p.c === 'r' ? 1 : -1) * (V[p.t] ?? 0);
  return s;
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
    let m = think(b, c, { maxDepth: depth, timeMs, jitter: 0 });
    /**
     * ⚠️ 强方不许原地打转。
     *
     * 第一版量出来的 50 个"和棋"**全部是三次重复判的，平均只走了 17 步**。
     * 那不是"技术不够赢不下来"，是引擎在这类局面里根本没有"进展"的概念：
     * 每条路的估值都差不多，于是两边来回晃，八九个回合就三次重复了。
     * 把这个记成"这局是和棋"，又是把"我的工具做不到"当成"这件事做不到"。
     *
     * 真人强方不会这么走。所以这里补一条：**子力占优的一方，如果最佳着法会
     * 走回已经出现过的局面，就换下一手**——分数差得不多的前提下。
     * 真到了每一手都只能重复，那才是真的没辙。
     */
    const strongSide = edge(b) > 150 ? 'r' : edge(b) < -150 ? 'b' : null;
    if (m && c === strongSide) {
      const key0 = toFen(applyMove(b, m), other(c));
      if ((seen.get(key0) ?? 0) >= 1) {
        const a = analyze(b, c, { maxDepth: depth, timeMs, jitter: 0 });
        const top = a.moves[0];
        const alt = a.moves.find(
          (x) => (top.score - x.score) < 120 && (seen.get(toFen(applyMove(b, x.move), other(c))) ?? 0) === 0,
        );
        if (alt) m = alt.move;
      }
    }
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

/**
 * ⚠️ 时限一定要给足，让**层数**成为约束，而不是墙上时钟。
 *
 * 这一点是踩出来的：同一批局面，机器上还跑着别的任务时"单车对马双士"
 * 判出 0 胜 4 和，机器空下来重跑就是 3 胜 1 和。原因是搜索按 timeMs 截断，
 * CPU 被抢就搜不到指定层数，引擎变弱、赢不下来、于是被记成"和"。
 * **胜和判定绝不能随机器忙不忙而变。** 所以时限给到 3~8 秒，
 * 残局局面子少，正常几十毫秒就搜完了，给这么多是为了让层数说了算。
 */
const DEPTH = Number(process.env.DEPTH ?? 12);
const TIME = Number(process.env.TIME_MS ?? 3000);
/** 复核档：判「和」之前必须让更强的一档再试一次 */
const DEEP_DEPTH = Number(process.env.DEEP_DEPTH ?? 14);
const DEEP_TIME = Number(process.env.DEEP_TIME_MS ?? 8000);
/** App 里 60 回合无吃子就判和，走不进这个长度的「胜」在软件里本来也兑现不了 */
const MAX_PLIES = 120;
/**
 * 太快就赢下来的局面不要。实用残局练的是**把优势兑现的技术**，
 * 三五步就将死的那是杀法题，放进残局课等于白占一课。
 */
const MIN_WIN_PLIES = Number(process.env.MIN_WIN_PLIES ?? 16);

/**
 * 定这一局到底是胜是和。
 *
 * 两条要害，都是踩出来的：
 *
 * 1. **「引擎没赢下来」不等于「这局赢不了」**。第一版直接把没赢记成了和，
 *    于是单车对双士这种例胜局面被标成「只能和」，软件教了个假结论。
 *
 * 2. **一次下出来的结果不算数**。同一个局面用 12 层和 14 层去下，走的是
 *    不同的路线，结果可能不一样——体检里就出现过"生成时判胜、复查时下成和"
 *    和反过来的情况各好几个。这说明那些局面本身处在胜和边界上，
 *    "这局是胜是和"根本没有稳定答案，那就不该拿来当教材。
 *    所以现在要求**三个深度下出同一个结果**才收，不一致的直接扔掉。
 */
const VERDICT_DEPTHS = [DEPTH, DEPTH + 1, DEEP_DEPTH];

function verdict(b: Board): { target: 'win' | 'draw' | 'loss' | 'unstable'; plies: number; reason: string } {
  // 先把引擎的记忆清空。搜索结果依赖置换表里残留的东西——同一个局面、同样的
  // 深度，在不同的调用历史下会走出不同的路线、得出不同的结论。体检和生成器
  // 用同一份代码却对不上，根子就在这里。清空之后，结论只由局面和深度决定，
  // 体检那边照同样的顺序再跑一遍就能复现。
  resetEngine();
  const runs = VERDICT_DEPTHS.map((d, i) =>
    playOut(b, 'r', d, i === VERDICT_DEPTHS.length - 1 ? DEEP_TIME : TIME, MAX_PLIES),
  );
  // 只要有一次红方赢下来，就说明这局是能赢的（没赢只能说明那一次没走好）；
  // 但要标成"胜"，得三次都赢——赢一次赢不了两次的局面在实战里没有教学价值
  const wins = runs.filter((r) => r.result === 'red-win');
  const losses = runs.filter((r) => r.result === 'black-win');
  if (losses.length) return { target: 'loss', plies: losses[0].plies, reason: losses[0].reason };
  if (wins.length === runs.length) return { target: 'win', plies: wins[0].plies, reason: wins[0].reason };
  if (wins.length) return { target: 'unstable', plies: wins[0].plies, reason: '有的深度赢得下来有的赢不下来' };
  return { target: 'draw', plies: runs[runs.length - 1].plies, reason: runs[runs.length - 1].reason };
}
const PER = Number(process.env.PER_COMBO ?? 3);
const BUDGET = Number(process.env.BUDGET_MS ?? 400000);
/** 只跑其中几个组合，逗号分隔。分批跑是为了每批都能在前台看完，不留后台长任务 */
const ONLY = (process.env.ONLY ?? '').split(',').filter(Boolean);

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
  /**
   * 结果是怎么来的：将死/困毙、60 回合无吃子、三次重复、还是打满没分出胜负。
   *
   * 这条要显示给学生看。标"和"有两种完全不同的意思：一种是这局面本来就是和棋，
   * 另一种是**在 60 回合无吃子判和这条规则下走不出胜果**——后者和棋书上的
   * 理论结论可能不一样，不写清楚就会被当成软件算错了。
   */
  reason: string;
  rating: number;
}

const out: EgOut[] = [];
const combos = COMBOS.filter((c) => !ONLY.length || ONLY.includes(c.id));
for (const combo of combos) {
  let got = 0;
  const t0 = Date.now();
  const budget = BUDGET / combos.length;
  let tried = 0;
  let rejected = 0;
  let unstable = 0;
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

    const v = verdict(b);
    if (v.target === 'loss') continue; // 你会输的局面不能当练习
    if (v.target === 'unstable') {
      unstable++;
      continue; // 胜和边界上的局面，没有稳定答案，不能当教材
    }
    // 闸门二：实测结论要和定式对得上。对不上有两种可能——这个摆法不典型，
    // 或者引擎没把胜势走出来——不管哪种，都不该拿去当"结论"教人。
    if (combo.theory !== 'varies' && v.target !== combo.theory) {
      rejected++;
      continue;
    }
    const youWin = v.target === 'win';
    if (youWin && v.plies < MIN_WIN_PLIES) continue; // 几步就杀完的不算残局课

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
      plies: v.plies,
      reason: v.reason,
      book: combo.book,
      // 赢的局面按步数给难度：越长越难走
      rating: youWin ? Math.min(1700, 950 + v.plies * 6) : 1150,
    });
    got++;
  }
  const w = out.filter((x) => x.id.startsWith(combo.id) && x.target === 'win').length;
  const d = out.filter((x) => x.id.startsWith(combo.id) && x.target === 'draw').length;
  process.stderr.write(
    `${combo.name.padEnd(14)} ${got}/${PER}  胜${w} 和${d}  ` +
      `(试 ${tried} 次，定式对不上扔 ${rejected} 个，胜和不稳定扔 ${unstable} 个, ` +
      `${Math.round((Date.now() - t0) / 1000)}s)\n`,
  );
}

process.stderr.write(`\n合计 ${out.length} 个残局\n`);
process.stdout.write(JSON.stringify(out));
