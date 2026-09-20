/**
 * 深度解读一手棋：不只看"哪个子会被吃"，而是从全局看这一步的意义。
 *
 * 为什么要有这一层：teach.ts 回答的是"这一手有没有掉坑"，那是**战术安全**，
 * 只够拦住白送子。但学棋的人真正要问的是另外几件事：
 *
 *   这一步在干什么？（意图）
 *   走完之后整个局面变好了还是变坏了？（全局）
 *   有没有更好的？好在哪？（比较）
 *   对方接下来会怎么办？（后续）
 *
 * 前两个由这里算，后两个由搜索引擎给。合起来才叫复盘，
 * 只报"你的马会被吃"那是防呆提示，不是教练。
 *
 * 老规矩：这里每一条结论都必须由规则算出来，一个数都不许是模型猜的。
 */
import {
  COLS,
  ROWS,
  applyMove,
  initialBoard,
  isInCheck,
  legalMoves,
  type Board,
  type Color,
  type Move,
  type PType,
} from './rules';
import { PIECE_VALUE, hangingPieces, inPieces, mateInOne, moveRisk, other, seeAt, type Hanging } from './teach';
import { moveToText, pieceName } from './notation';
import { requestAnalysis } from './aiclient';
import { TIER_INFO, intentNames, placeInTiers, rankMoves, tierTable } from './tiers';
import type { Facts } from './llm';

// ───────────────────────── 一手棋的意图 ─────────────────────────

/**
 * 一手棋"在做什么"。
 *
 * 这是教学里最该先讲清楚的一件事：初学者走棋往往**自己也说不出为什么走这里**，
 * 而说得出意图，才谈得上判断这个意图值不值得。
 */
export type Intent =
  | 'check'
  | 'mate-threat'
  | 'capture'
  | 'threat'
  | 'defend'
  | 'escape'
  | 'block'
  | 'develop'
  | 'cross'
  | 'center'
  | 'connect'
  | 'guard'
  | 'quiet';

export const INTENT_INFO: Record<Intent, { name: string; why: string }> = {
  check: { name: '将军', why: '逼对方必须应付，这一手你握着主动' },
  'mate-threat': { name: '做杀', why: '走完之后你下一步就有杀棋，对方必须来解' },
  capture: { name: '吃子', why: '直接拿对方的子' },
  threat: { name: '捉子', why: '走完之后你威胁白吃对方的子，对方得先管这件事' },
  defend: { name: '保护', why: '把自己受威胁的子护住' },
  escape: { name: '逃子', why: '把被捉的子挪到安全的地方' },
  block: { name: '解将', why: '挡住对方的将军' },
  develop: { name: '出动大子', why: '把车马炮从原位调出来。开局阶段谁的子出得快、出得有用，谁就占先' },
  cross: { name: '过河', why: '把子力推进到对方半场，抢空间' },
  center: { name: '占中', why: '中路是最短的进攻线，也是对方最难防的一路' },
  connect: { name: '连环', why: '让这个子有己方的子保护着，对方吃它就要赔本' },
  guard: { name: '固防', why: '补士象、巩固九宫，让对方的攻势打不进来' },
  quiet: { name: '调整', why: '没有直接目的的一手。有时候是等对方先表态，有时候是浪费了一步' },
};

/** 车马炮的开局原位，用来判断"出动了没有" */
const HOME = (() => {
  const b = initialBoard();
  const set = new Set<string>();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (p && (p.t === 'R' || p.t === 'H' || p.t === 'C')) set.add(`${p.c}${p.t}${x},${y}`);
    }
  return set;
})();

const isBig = (t: PType) => t === 'R' || t === 'H' || t === 'C';
/** 这一格在不在 c 方的敌境（过了河） */
const overRiver = (y: number, c: Color) => (c === 'r' ? y <= 4 : y >= 5);

/** 这个子现在有没有己方的子保护着 */
function isDefended(b: Board, x: number, y: number, me: Color): boolean {
  const p = b[y][x];
  if (!p) return false;
  // 拿一个假想的敌子替换它，看我方能不能吃回来——这是判"有没有保护"最省事又准确的办法
  const probe = b.map((r) => r.slice());
  probe[y][x] = { t: p.t, c: other(me) };
  return seeAt(probe, x, y, me) > 0;
}

/** 我方现在威胁白吃对方的哪些子 */
function threatsBy(b: Board, me: Color): Hanging[] {
  return hangingPieces(b, other(me));
}

/**
 * 判断这一手在做什么。可能同时有好几个意图——
 * "车二进六"既是出动大子又是过河还可能顺手捉子，这三件事都该说。
 */
export function intentsOf(before: Board, m: Move, me: Color): Intent[] {
  const piece = before[m.fy][m.fx];
  if (!piece || piece.c !== me) return [];
  const opp = other(me);
  const after = applyMove(before, m);
  const out: Intent[] = [];

  if (isInCheck(after, opp)) out.push('check');
  else if (mateInOne(after, me)) out.push('mate-threat');

  if (before[m.ty][m.tx]) out.push('capture');

  // 捉子：走完之后新增了"能白吃对方某个子"的威胁
  const was = new Set(threatsBy(before, me).map((h) => `${h.x},${h.y}`));
  const now = threatsBy(after, me);
  if (now.some((h) => !was.has(`${h.x},${h.y}`))) out.push('threat');

  // 逃子 / 保护：走之前我方有子被捉，走完之后不被捉了
  const hangBefore = hangingPieces(before, me);
  const hangAfter = new Set(hangingPieces(after, me).map((h) => `${h.x},${h.y}`));
  if (hangBefore.some((h) => h.x === m.fx && h.y === m.fy) && !hangAfter.has(`${m.tx},${m.ty}`)) {
    out.push('escape');
  } else if (hangBefore.some((h) => !(h.x === m.fx && h.y === m.fy) && !hangAfter.has(`${h.x},${h.y}`))) {
    out.push('defend');
  }

  if (isInCheck(before, me) && !isInCheck(after, me) && piece.t !== 'K' && !before[m.ty][m.tx]) {
    out.push('block');
  }

  if (isBig(piece.t) && HOME.has(`${me}${piece.t}${m.fx},${m.fy}`)) out.push('develop');
  if (!overRiver(m.fy, me) && overRiver(m.ty, me)) out.push('cross');
  if (m.tx === 4 && m.fx !== 4 && isBig(piece.t)) out.push('center');
  if (!isDefended(before, m.fx, m.fy, me) && isDefended(after, m.tx, m.ty, me) && isBig(piece.t)) {
    out.push('connect');
  }
  if ((piece.t === 'A' || piece.t === 'E') && !out.length) out.push('guard');

  if (!out.length) out.push('quiet');
  return out;
}

/** 一句话说清这一手在做什么 */
export function intentText(before: Board, m: Move, me: Color, intents: Intent[]): string {
  const piece = before[m.fy][m.fx];
  if (!piece) return '';
  const name = pieceName(piece.t, me);
  const text = moveToText(before, m);
  const names = intents.filter((i) => i !== 'quiet').map((i) => INTENT_INFO[i].name);
  if (!names.length) return `${text}：把${name}挪了一格，没有直接的目的。`;
  return `${text}：${names.join('、')}。`;
}

// ───────────────────────── 局面的几个可量化维度 ─────────────────────────

export interface Posture {
  /** 我方子力减对方（不含将帅） */
  material: number;
  /** 我方能走的着法数——机动性低意味着被压着打 */
  mobility: number;
  oppMobility: number;
  /** 我方过河子力的价值和，衡量"抢到多少空间" */
  crossed: number;
  oppCrossed: number;
  /** 对方有几个大子攻到我方九宫范围——这是最直接的危险信号 */
  kingPressure: number;
  oppKingPressure: number;
  /** 我方士象还剩几个（守将的本钱） */
  guards: number;
  oppGuards: number;
  /** 我方出动了几个大子 */
  developed: number;
  oppDeveloped: number;
}

/** 对方有几个大子能攻到这一方的九宫格内 */
function kingPressureOn(b: Board, me: Color): number {
  const opp = other(me);
  const ys = me === 'r' ? [7, 8, 9] : [0, 1, 2];
  let n = 0;
  const seen = new Set<string>();
  for (const y of ys) {
    for (let x = 3; x <= 5; x++) {
      // 把九宫里每一格都当成"有我方的子"，看对方能不能打到
      const probe = b.map((r) => r.slice());
      if (!probe[y][x]) probe[y][x] = { t: 'P', c: me };
      for (const mv of legalMoves(probe, opp)) {
        if (mv.tx !== x || mv.ty !== y) continue;
        const src = probe[mv.fy][mv.fx];
        if (!src || !isBig(src.t)) continue;
        const key = `${mv.fx},${mv.fy}`;
        if (!seen.has(key)) {
          seen.add(key);
          n++;
        }
      }
    }
  }
  return n;
}

export function postureOf(b: Board, me: Color): Posture {
  const opp = other(me);
  let material = 0;
  let crossed = 0;
  let oppCrossed = 0;
  let guards = 0;
  let oppGuards = 0;
  let developed = 0;
  let oppDeveloped = 0;

  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (!p || p.t === 'K') continue;
      const v = PIECE_VALUE[p.t];
      material += p.c === me ? v : -v;
      if (p.t === 'A' || p.t === 'E') {
        if (p.c === me) guards++;
        else oppGuards++;
      }
      if (isBig(p.t)) {
        const home = HOME.has(`${p.c}${p.t}${x},${y}`);
        if (!home) {
          if (p.c === me) developed++;
          else oppDeveloped++;
        }
        if (overRiver(y, p.c)) {
          if (p.c === me) crossed += v;
          else oppCrossed += v;
        }
      }
    }
  }

  return {
    material,
    mobility: legalMoves(b, me).length,
    oppMobility: legalMoves(b, opp).length,
    crossed,
    oppCrossed,
    kingPressure: kingPressureOn(b, me),
    oppKingPressure: kingPressureOn(b, opp),
    guards,
    oppGuards,
    developed,
    oppDeveloped,
  };
}

// ───────────────────────── 全局变化的人话解读 ─────────────────────────

export interface GlobalNote {
  /** 这一条是好消息还是坏消息 */
  tone: 'good' | 'bad' | 'flat';
  /** 「空间」「机动性」这种小标题 */
  label: string;
  /** 一句人话，必须带上真实数字 */
  text: string;
}

/**
 * 把走这一手前后的局面对比成几条人话。
 *
 * 只报**变化明显**的维度。每一条都是好的坏的都说，因为学棋最怕的是
 * 只被告知"这步不好"——人会以为整步棋一无是处，其实往往是
 * "想法对，时机不对"，而这个区别只有把好坏两面都摆出来才看得见。
 */
export function globalNotes(before: Board, m: Move, me: Color): GlobalNote[] {
  const a = postureOf(before, me);
  const after = applyMove(before, m);
  const b = postureOf(after, me);
  const out: GlobalNote[] = [];

  const dMat = b.material - a.material;
  if (Math.abs(dMat) >= 100) {
    out.push({
      tone: dMat > 0 ? 'good' : 'bad',
      label: '子力',
      text: dMat > 0 ? `你这一手净赚 ${dMat} 分子力。` : `这一手直接亏了 ${-dMat} 分子力。`,
    });
  }

  const dSpace = b.crossed - a.crossed;
  if (dSpace !== 0) {
    out.push({
      tone: dSpace > 0 ? 'good' : 'flat',
      label: '空间',
      text:
        dSpace > 0
          ? `你过河的大子价值从 ${a.crossed} 涨到 ${b.crossed}，是在往对方半场推进、抢空间。`
          : `你把过河的子撤了回来，让出 ${-dSpace} 分的空间。`,
    });
  }

  const dDev = b.developed - a.developed;
  if (dDev > 0) {
    out.push({
      tone: 'good',
      label: '出子',
      text: `你出动的大子从 ${a.developed} 个增加到 ${b.developed} 个（对方 ${b.oppDeveloped} 个）。开局阶段谁的子出得快，谁就先有话语权。`,
    });
  }

  // 机动性：变化小于 3 属于正常波动，不值得说
  const dMob = b.mobility - a.mobility;
  const dOppMob = b.oppMobility - a.oppMobility;
  // 将军的时候对方"只剩几手可走"是被将逼出来的，不是真的被困住。
  // 把它说成"对方在被限制"是好听的假话，解将之后他照样活蹦乱跳。
  const gaveCheck = isInCheck(after, other(me));
  if ((Math.abs(dMob) >= 4 || Math.abs(dOppMob) >= 4) && !(gaveCheck && dOppMob < 0)) {
    const bad = dMob < -3 || dOppMob > 3;
    out.push({
      tone: bad ? 'bad' : 'good',
      label: '机动性',
      text: `你的可走着法 ${a.mobility} → ${b.mobility}，对方 ${a.oppMobility} → ${b.oppMobility}。${
        bad ? '你的子在变少变笨，对方在变灵活——这是被压着打的前兆。' : '你在变灵活，对方在被限制。'
      }`,
    });
  } else if (gaveCheck) {
    out.push({
      tone: 'flat',
      label: '机动性',
      text: `对方只剩 ${b.oppMobility} 手可走，但那是被将军逼的——他解完将就恢复了，别当成真的把他困住。`,
    });
  }

  if (b.kingPressure > a.kingPressure) {
    out.push({
      tone: 'bad',
      label: '自家老将',
      text: `对方攻到你九宫的大子从 ${a.kingPressure} 个增加到 ${b.kingPressure} 个。你的帅周围正在变危险。`,
    });
  }
  if (b.oppKingPressure > a.oppKingPressure) {
    out.push({
      tone: 'good',
      label: '对方老将',
      text: `你攻到对方九宫的大子从 ${a.oppKingPressure} 个增加到 ${b.oppKingPressure} 个，攻势在积累。`,
    });
  }
  if (b.guards < a.guards) {
    out.push({
      tone: 'bad',
      label: '士象',
      text: `你的士象从 ${a.guards} 个少到 ${b.guards} 个。士象是守将的本钱，缺一个，对方的车炮就好打很多。`,
    });
  }

  return out;
}

// ───────────────────────── 候选走法的解读 ─────────────────────────

export interface Candidate {
  move: Move;
  text: string;
  /** 走子方视角的分数 */
  score: number;
  /** 和最佳着法差多少（杀棋分已经排除，见 gap） */
  behind: number;
  /** 差距的人话说法。杀棋分是四万多，直接相减会得出"比首选差 99993 分"这种鬼数字 */
  gap: string;
  intents: Intent[];
  /** 这手棋想干什么，一句话 */
  idea: string;
  /** 走完之后的主变，已经是记谱 */
  line: string[];
}

/** 把引擎给的候选着法配上"它想干什么"的解释 */
export function describeCandidates(
  before: Board,
  me: Color,
  scored: { move: Move; score: number; pv: Move[] }[],
  limit = 3,
): Candidate[] {
  if (!scored.length) return [];
  const best = scored[0].score;
  /** 超过这个分就是杀棋区间，不是正常的子力分 */
  const MATEISH = 9000;
  const gapOf = (score: number): string => {
    if (Math.abs(best) > MATEISH && Math.abs(score) <= MATEISH) return '（首选是杀棋，这一手不是）';
    const d = best - score;
    if (d <= 20) return '（和首选一样好）';
    if (d >= 2000) return '（差得很多，基本等于把优势让出去）';
    return `（比首选差 ${d} 分，约${inPieces(d)}）`;
  };
  return scored.slice(0, limit).map((s) => {
    const intents = intentsOf(before, s.move, me);
    const names = intents.filter((i) => i !== 'quiet').map((i) => INTENT_INFO[i].name);
    // 主变转记谱
    const line: string[] = [];
    let cur = before;
    for (const mv of s.pv.slice(0, 4)) {
      line.push(moveToText(cur, mv));
      cur = applyMove(cur, mv);
    }
    return {
      move: s.move,
      text: moveToText(before, s.move),
      score: s.score,
      behind: Math.min(9999, Math.max(0, best - s.score)),
      gap: gapOf(s.score),
      intents,
      idea: names.length ? names.join('、') : '稳一手，不给对方机会',
      line,
    };
  });
}

// ───────────────────────── 阶段与该讲什么道理 ─────────────────────────

export type Phase = 'opening' | 'middle' | 'endgame';

export function phaseOf(b: Board, ply: number): Phase {
  let big = 0;
  for (const row of b) for (const p of row) if (p && isBig(p.t)) big++;
  if (ply < 20 && big >= 10) return 'opening';
  return big <= 4 ? 'endgame' : 'middle';
}

/**
 * 每个阶段该守的原则。
 *
 * 这些是**棋理**，不是从这一局算出来的，所以单独放在这里、明确标成"通用原则"，
 * 不和那些由局面算出来的结论混在一起。混在一起讲，用户分不清哪句是针对他这盘棋的。
 */
export const PHASE_PRINCIPLE: Record<Phase, string[]> = {
  opening: [
    '先出车马炮，士象后补。开局十来手里，谁的大子出得又快又有用，谁就占先。',
    '车是最贵的子，它应该最后出动，而且出动的时候要有保护——车先冲进去，多半是送。',
    '别用同一个子连走好几手去追一个小便宜，那等于让对方白出好几个子。',
  ],
  middle: [
    '每走一手之前先问：对方上一手想干什么？他的威胁没解决，你自己的计划再好也没用。',
    '子力要协同。一个子孤军深入，对方随便来一手就把它困住；两三个子配合，威胁才真实。',
    '兑子要算账：你亏不亏子，兑完之后谁的局面更好。领先的时候多兑子，落后的时候避免兑子。',
  ],
  endgame: [
    '残局里老将要主动出来助攻，它在残局是一个有战斗力的子。',
    '兵过河、到底线之后价值大增，残局常常就是靠一个小兵定胜负。',
    '算清楚再动手。残局子少，每一手的容错率都很低，一步走错可能就从赢变和、从和变输。',
  ],
};

// ───────────────────────── 组装成讲解层要的事实清单 ─────────────────────────

/**
 * 深度解读用多深的搜索。
 *
 * 用户是主动点了"为什么"才触发的，等三四秒换一份**靠谱的**梯次表和主变，
 * 这笔买卖是划算的。之前给 1.6 秒，排出来的名次和主变都不够稳——
 * "对手的预测全是错的"有一半原因在这里。
 */
const DEEP = { maxDepth: 64, timeMs: 4000, jitter: 0 };

export interface DeepOpts {
  /** 第几手（从 0 开始），用来判开局/中局/残局 */
  ply?: number;
  /** 引擎判读。复盘时已经算好了，直接传进来省一次搜索 */
  judged?: { best: { move: Move; score: number; pv: Move[] }; played: { move: Move; score: number; pv: Move[] } };
  /** 等级标签，如「失误」 */
  grade?: string;
  loss?: number;
  /** 这个局面现成的引擎分析。有就直接用，不必再搜一次 */
  analysis?: { move: Move; score: number; pv: Move[] }[] | null;
}

/**
 * 把一手棋解读成完整的事实清单，交给讲解层讲成人话。
 *
 * 这是"从全局看这一步"的落地：
 *   意图   —— 规则算的（intentsOf）
 *   全局   —— 规则算的（globalNotes，每条都带真实数字）
 *   代价   —— 规则算的（moveRisk 的静态兑子）
 *   替代案 —— 引擎给的（候选着法 + 分数 + 主变），再由规则补上"它想干什么"
 *   棋理   —— 固定的阶段原则，**单独成段标明不是针对这一手**
 *
 * 一条都不是模型编的。模型只负责把这张表讲得像人话。
 */
export async function deepFacts(before: Board, m: Move, me: Color, opts: DeepOpts = {}): Promise<Facts> {
  const ply = opts.ply ?? 0;
  const stage = phaseOf(before, ply);
  const risk = moveRisk(before, m, me);
  const after = applyMove(before, m);

  // 候选着法：优先用复盘已经算好的，没有就现搜一次
  let scored: { move: Move; score: number; pv: Move[] }[] = [];
  if (opts.judged) {
    scored = [opts.judged.best];
    const same =
      opts.judged.best.move.fx === m.fx && opts.judged.best.move.fy === m.fy &&
      opts.judged.best.move.tx === m.tx && opts.judged.best.move.ty === m.ty;
    if (!same) scored.push(opts.judged.played);
  } else if (opts.analysis?.length) {
    scored = opts.analysis;
  } else {
    scored = await requestAnalysis(before, me, DEEP);
  }

  // 对方接下来的计划：走完我这一手之后，引擎认为对方会怎么下
  const oppPlan: string[] = [];
  const played = scored.find(
    (s) => s.move.fx === m.fx && s.move.fy === m.fy && s.move.tx === m.tx && s.move.ty === m.ty,
  );
  if (played?.pv?.length) {
    let cur = before;
    played.pv.slice(0, 5).forEach((mv, i) => {
      const txt = moveToText(cur, mv);
      // pv[0] 是我自己这一手，从对方的应手开始才是"对方的计划"
      if (i > 0) oppPlan.push(txt);
      cur = applyMove(cur, mv);
    });
  }

  // 走法梯次：这个局面一共有哪些选择、各自什么档次。
  // 这是"从全局看"的正面回答——下棋是在一堆候选里挑，不是在对错之间挑。
  const ranked = rankMoves(before, me, scored);
  const place = placeInTiers(ranked, m);
  const bestMv = scored[0]?.move;
  const bestIsPlayed =
    bestMv && bestMv.fx === m.fx && bestMv.fy === m.fy && bestMv.tx === m.tx && bestMv.ty === m.ty;

  return {
    kind: 'move-deep',
    side: me === 'r' ? '红' : '黑',
    round: Math.floor(ply / 2) + 1,
    played: moveToText(before, m),
    best: bestMv && !bestIsPlayed ? moveToText(before, bestMv) : undefined,
    grade: opts.grade,
    loss: opts.loss,
    tiers: ranked.length ? tierTable(ranked, m) : undefined,
    place: place ? { rank: place.rank, tier: TIER_INFO[place.tier].name, gap: place.gap } : undefined,
    /*
     * 和首选的差别，用**意图**讲，不用分项差。
     *
     * 试过拿两手的分项相减，两版都不成立：和"走之前"比，会把一手
     * 吃了兵要赔炮的坏棋夸成"净赚子力"；和"首选的主变末端"比，
     * 两条变化长度不同、轮到谁走也不同，减出来的数没有可比性，
     * 于是又把引擎首选描述成"净亏子力"。
     * 意图是纯规则算的，不依赖比较基准，说出来永远成立。
     */
    reason: bestMv && !bestIsPlayed ? intentNames(before, bestMv, me) || undefined : undefined,
    bestReason: undefined,
    problem: risk?.detail,
    punish: risk?.punish ? moveToText(after, risk.punish) : undefined,
    oppPlan: oppPlan.length ? oppPlan : undefined,
    stage: stage === 'opening' ? '开局' : stage === 'middle' ? '中局' : '残局',
  };
}
