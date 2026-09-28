/**
 * 邪门布局（江湖套路）的破解。
 *
 * 业余对局里最常碰到的不是正经定式，而是这一类：开局就炮打中卒、炮打底马、
 * 冲中兵、炮过河骚扰……它们本身都是**亏的**，但专门赌你应错——
 * 被将军就慌着垫仕、看见子就吃、被骚扰就退马。应对了，对方白亏；应错了，亏的是你。
 *
 * 这里按"套路"收，不按江湖名号：同一个套路各地叫法不一样，认得套路才破得了。
 *
 * **每一条都是引擎说了算，不是凭记忆写的。** 着法走得通、这一手本身亏多少、
 * 破解那一手是不是（接近）最好、上当那一手亏多少——tools/check-tricks.ts 逐条让皮卡鱼复核，
 * 复核不过的不许进库。下面 verified 里的数就是复核出来的（车≈1000，破解方视角）。
 */
import { applyMove, initialBoard, legalMoves, type Board, type Color, type Move } from './rules';
import { textToMove, toFen } from './notation';

export interface TrickStep {
  /** 中文记谱 */
  t: string;
  /** 这一手在干什么 */
  why: string;
  /** 同样正确的其它走法（练习时走这些也算对） */
  alts?: string[];
}

export interface TrickOpening {
  id: string;
  name: string;
  /** 谁在走邪门棋 */
  by: Color;
  level: '入门' | '初级' | '中级';
  /** 套路：它在赌你什么 */
  lure: string;
  /** 走到邪门着之前的着法（双方） */
  pre: string[];
  /** 邪门着 */
  trick: TrickStep;
  /** 破解：从破解方这一手起的一小段 */
  refute: TrickStep[];
  /** 上当：最常见的错误应法和它的后果 */
  trap: TrickStep[];
  /** 破解的道理——要记住的是这一句 */
  principle: string;
  /** 引擎复核过的数（破解方视角，车≈1000） */
  verified: {
    /** 邪门着本身比最好的走法亏多少（走邪门棋的一方） */
    trickLoss: number;
    /** 按破解走之后，破解方的分 */
    refuteScore: number;
    /** 上当那一手比破解差多少 */
    trapLoss: number;
  };
}

export const TRICKS: TrickOpening[] = [
  {
    id: 'pao-zhongzu-guarded',
    name: '开局炮打中卒（中卒有马护着）',
    by: 'r',
    level: '入门',
    lure: '当头炮一上来就打中卒，赌你慌了神、没看见自己的马护着中卒。',
    pre: ['炮二平五', '马8进7'],
    trick: { t: '炮五进四', why: '红炮打掉中卒。可这个中卒有 7 路马护着——红炮是送上门的。' },
    refute: [
      { t: '马7进5', why: '马直接把炮吃掉：一个卒换一个炮，白赚。' },
      { t: '车一进一', why: '红方只能赶紧出车，想办法找补。' },
      { t: '炮8平5', why: '你也架上中炮，多一个子，稳稳领先。' },
    ],
    trap: [
      { t: '卒7进1', why: '没看见能吃，走了别的。' },
      { t: '炮五退二', why: '红炮白吃一个中卒，还安全退了回去——你少了中卒，中路被打开。' },
    ],
    principle: '对方的子送到嘴边，先数一数：有保护、吃了不亏就吃。开局随手打中卒的炮，往往就是白送的。',
    verified: { trickLoss: 710, refuteScore: 805, trapLoss: 1311 },
  },
  {
    id: 'pao-da-ma-red',
    name: '开局炮打底马',
    by: 'r',
    level: '入门',
    lure: '第一步就隔着你的炮打掉底线的马，赌你不吃回来——他的炮接着会沿底线再打一个子。',
    pre: [],
    trick: { t: '炮八进七', why: '红炮隔着黑炮，打掉黑方底线的马。' },
    refute: [
      { t: '车1平2', why: '车马上吃回炮：马换炮，你的车还顺势出来了。' },
      { t: '马八进七', why: '红方出马。一换之后红方少了一个炮，出子还慢了。' },
    ],
    trap: [
      { t: '马8进7', why: '不理它，照常出马。' },
      { t: '炮八平六', why: '红炮沿底线再打掉你的士。' },
      { t: '将5平4', why: '将只好出来吃炮——马、士都丢了，将也被拉出了原位。' },
    ],
    principle: '开局被炮换子，马上吃回来。拖一步，那个炮就会在你的底线横着再打一个子。',
    verified: { trickLoss: 355, refuteScore: 229, trapLoss: 373 },
  },
  {
    id: 'pao-da-ma-black',
    name: '黑方炮打底马',
    by: 'b',
    level: '入门',
    lure: '你一架中炮，他就隔着你的炮打掉底线的马，赌你不吃回来。',
    pre: ['炮二平五'],
    trick: { t: '炮2进7', why: '黑炮隔着红方的八路炮，打掉底线的马。' },
    refute: [
      { t: '车九平八', why: '车马上吃回炮：马换炮，车还出来了。' },
      { t: '马2进3', why: '黑方出马。他少了一个炮，你多了一个出好的车。' },
    ],
    trap: [
      { t: '马二进三', why: '不理它，照常出马。' },
      { t: '炮2平4', why: '黑炮沿底线再打掉你的仕。' },
      { t: '帅五平六', why: '帅只好出来吃炮——马、仕都丢了，帅也离开了中路。' },
    ],
    principle: '被炮打了底马，第一件事是吃回来。底线的炮不吃，它会横着接着打。',
    verified: { trickLoss: 281, refuteScore: 365, trapLoss: 196 },
  },
  {
    id: 'shunpao-zhongzu-check',
    name: '顺炮·炮打中卒将军',
    by: 'r',
    level: '初级',
    lure: '双方都架中炮时，他用炮打掉中卒，还隔着你的炮将军——赌你以牙还牙，也用炮去吃他的中兵。',
    pre: ['炮二平五', '炮8平5'],
    trick: { t: '炮五进四', why: '红炮打掉中卒，隔着黑方的中炮将军。' },
    refute: [
      { t: '士4进5', why: '补士挡将，先稳住。他的炮在你的阵地里站不住，下一步就得退。', alts: ['士6进5'] },
      { t: '炮八平五', why: '红方再架一个中炮。' },
      { t: '马8进7', why: '出马护中，接着正常出子。红方先走的那点便宜，已经被他自己这一步送掉了。' },
    ],
    trap: [
      { t: '炮5进4', why: '也用炮吃回中兵。' },
      { t: '炮五退二', why: '红炮一退，把你那个炮的退路堵住了。' },
      { t: '马8进9', why: '你想办法救炮。' },
      { t: '马八进七', why: '红方跳马来捉——你的炮陷在红方阵地里，跑不掉。' },
    ],
    principle: '对方抢了一个卒还将着军，看着凶，其实他的炮站不住：先补士，别急着以牙还牙。',
    verified: { trickLoss: 121, refuteScore: -18, trapLoss: 1006 },
  },
  {
    id: 'hei-pao-zhongbing-check',
    name: '黑方炮打中兵将军',
    by: 'b',
    level: '入门',
    lure: '他用炮打掉你的中兵、隔着你的炮将军，赌你慌着垫仕——你一垫，他的炮就从容退回，白吃一个兵。',
    pre: ['炮二平五', '炮8平5', '马二进三'],
    trick: { t: '炮5进4', why: '黑炮打掉中兵，隔着你的中炮将军。' },
    refute: [
      { t: '马三进五', why: '马直接把将军的炮吃掉——将军的子能吃，就不用垫也不用躲。' },
      { t: '炮2平5', why: '黑方再架中炮。' },
      { t: '马八进七', why: '出马。你多一个子，稳稳拿住。' },
    ],
    trap: [
      { t: '仕四进五', why: '垫仕挡将。' },
      { t: '炮5退1', why: '黑炮从容退回——白吃你一个中兵，炮还没丢。' },
    ],
    principle: '被将军时先看：能不能直接吃掉将军的那个子？能吃就别垫、别躲。',
    verified: { trickLoss: 722, refuteScore: 920, trapLoss: 747 },
  },
  {
    id: 'jijin-zhongbing',
    name: '急冲中兵',
    by: 'r',
    level: '初级',
    lure: '不出子，第二步就冲中兵，想快速打开中路。赌你跟着他乱换子。',
    pre: ['炮二平五', '马8进7'],
    trick: { t: '兵五进一', why: '红方第二步就冲中兵。子还一个没出，先动兵。' },
    refute: [
      { t: '炮2平5', why: '你也架中炮对攻：他的中兵一冲，中路反而成了他自己的弱点。' },
      { t: '炮五退一', why: '红炮退一步，躲开对攻。' },
      { t: '车9平8', why: '出车。你出子比他快，局面已经占优。' },
    ],
    trap: [
      { t: '炮2进7', why: '炮打底马，想跟他换子。' },
      { t: '车九平八', why: '车吃回炮——你用炮换了马，还帮红方把车调了出来。' },
    ],
    principle: '对手不出子光冲兵，你就正常出子、架炮对攻；别去跟他换子，换子等于帮他出子。',
    verified: { trickLoss: 268, refuteScore: 160, trapLoss: 533 },
  },
  {
    id: 'pao-guohe-fengche',
    name: '炮过河封车',
    by: 'b',
    level: '初级',
    lure: '他的炮早早过河，挡在你右车的出路上、还盯着你的马——赌你被吓得退马。',
    pre: ['炮二平五', '马2进3', '马二进三'],
    trick: { t: '炮8进4', why: '黑炮过河，挡住你右车的出路，还瞄着你的马。' },
    refute: [
      { t: '车一平二', why: '出车直接捉炮。' },
      { t: '炮8退4', why: '炮只能退回去——他白白走了两步。' },
      { t: '兵七进一', why: '你多出了两步棋，从容展开。' },
    ],
    trap: [
      { t: '马三退一', why: '怕炮打马，先把马退到边上。' },
      { t: '炮8平5', why: '黑炮平到中路，反而占了先手——你的马退到边上，阵型也散了。' },
    ],
    principle: '对方单个子冲过来骚扰，用出子去捉它：你出一个子，他退一步，一来一回多赚两步。',
    verified: { trickLoss: 277, refuteScore: 401, trapLoss: 426 },
  },
  {
    id: 'kaiju-guohepao',
    name: '开局炮过河',
    by: 'r',
    level: '中级',
    lure: '第一步就炮过河骚扰，赌你也跟着乱打。',
    pre: [],
    trick: { t: '炮二进四', why: '第一步就把炮冲过河，不出子，先骚扰。' },
    refute: [
      { t: '马8进7', why: '正常出马，护住中卒。' },
      { t: '炮八平五', why: '红方架上中炮。' },
      { t: '马2进3', why: '再出马，阵型完整。他那个过河炮孤零零的，早晚要退。' },
    ],
    trap: [
      { t: '炮2进7', why: '你也来炮打底马。' },
      { t: '炮二平五', why: '红方不急着吃回，先用过河炮打掉你的中卒。' },
      { t: '炮2平4', why: '你的炮再打仕。' },
      { t: '帅五平六', why: '被帅吃掉。算下来你少了一个炮，中路还被打开了。' },
    ],
    principle: '对方一上来就冲炮骚扰，你正常出子就行；别跟着乱打，乱打一定是子力没出来的一方吃亏。',
    verified: { trickLoss: 119, refuteScore: 65, trapLoss: 531 },
  },
  {
    id: 'shengche-hupao',
    name: '升车护炮（诱你车吃炮）',
    by: 'b',
    level: '初级',
    lure: '他把车升两步横在炮旁边：炮看着还能吃，其实车已经护着了——赌你数不清保护，一车换一炮。',
    pre: ['炮二平五', '马2进3', '马二进三', '马8进7', '车一平二'],
    trick: { t: '车9进2', why: '黑车升两步，横在 8 路炮旁边。炮看着没人护，其实车护着。' },
    refute: [
      { t: '炮八进二', why: '不吃，稳稳出子：炮巡河，准备配合右车。' },
      { t: '卒9进1', why: '黑方挺边卒，给车让路。' },
      { t: '马八进七', why: '再出马。他这手升车并不好，你出子领先。' },
    ],
    trap: [
      { t: '车二进七', why: '车吃炮。' },
      { t: '车9平8', why: '黑车吃回你的车——你用一个车换了一个炮，亏大了。' },
    ],
    principle: '吃子之前先数保护：这个子有谁护着？横着护的车、斜着护的象最容易看漏。',
    verified: { trickLoss: 196, refuteScore: 194, trapLoss: 878 },
  },
];

export const trickById = (id: string) => TRICKS.find((t) => t.id === id);

/** 一串着法从开局走下去，走不通返回 null */
export function walkMoves(texts: string[]): { board: Board; color: Color; moves: Move[] } | null {
  let b = initialBoard();
  let c: Color = 'r';
  const moves: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) return null;
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return { board: b, color: c, moves };
}

const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

/** 邪门着走完之后的局面 → 是哪一条（认局面不认着法顺序，换个次序走到同一个局面也认得出） */
let byPos: Map<string, TrickOpening> | null = null;

function index(): Map<string, TrickOpening> {
  if (byPos) return byPos;
  const map = new Map<string, TrickOpening>();
  for (const t of TRICKS) {
    const w = walkMoves([...t.pre, t.trick.t]);
    if (w) map.set(toFen(w.board, w.color), t);
  }
  byPos = map;
  return map;
}

/** 这个局面是不是某个邪门着刚走完（轮到破解方） */
export function trickAt(board: Board, toMove: Color): TrickOpening | null {
  return index().get(toFen(board, toMove)) ?? null;
}

/**
 * 陪练"走邪门布局"时，对手这一步该走什么：
 * 对局从开局起的着法恰好是某一条套路（前缀 + 邪门着）的开头、而且轮到对手走，就按那一条走下一手。
 * 有好几条都对得上时随机挑一条，但一旦挑定就一直走这一条（prefer）。
 * 对不上任何一条返回 null，对手照常走。
 */
export function trickMoveFor(moves: Move[], ai: Color, prefer?: string, rand = Math.random): { move: Move; trick: TrickOpening } | null {
  const fits: { move: Move; trick: TrickOpening }[] = [];
  for (const t of TRICKS) {
    if (t.by !== ai) continue;
    const line = [...t.pre, t.trick.t];
    if (moves.length >= line.length) continue;
    const w = walkMoves(line.slice(0, moves.length + 1));
    if (!w) continue;
    if (!moves.every((m, i) => same(m, w.moves[i]))) continue;
    fits.push({ move: w.moves[moves.length], trick: t });
  }
  if (!fits.length) return null;
  return fits.find((f) => f.trick.id === prefer) ?? fits[Math.floor(rand() * fits.length)];
}
