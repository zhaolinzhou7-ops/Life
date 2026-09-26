/**
 * 教练模式：你下棋的时候，教练在旁边看着。
 *
 * 设计上最要紧的一条：**绝对不替用户走棋**。
 * 自动帮人走等于把学棋变成看棋，用户什么也学不到；而且提示一旦变成
 * "照着点就行"，人会本能地关掉脑子。所以这里永远只做两件事：
 *   说一句"这里有风险"，然后把决定权还给用户——要么改，要么将错就错。
 *
 * 走错了照样让你走，这是故意的。错着走完，复盘的时候再拿这一手出来讲，
 * 印象比当场拦住深得多。
 *
 * 四档提示对应四种人：
 *   关闭     已经有水平，不想被打扰
 *   轻提示   只要一句"这里不对劲"，剩下自己想——练的是搜索能力
 *   标准提示 说到具体哪个子有危险——练的是"看见威胁"
 *   教学提示 说清楚 + 可以追问"为什么"——刚学棋，需要人带
 *
 * 判断来自引擎对这个局面的研究（study.ts），和 🔍 求助读的是同一份，
 * 所以教练说的和求助说的永远是一回事。
 */
import type { Board, Color, Move } from './rules';
import { PIECE_VALUE, hangingPieces, inPieces, mateInOne, moveRisk, other, type MoveRisk } from './teach';
import { applyMove, isInCheck } from './rules';
import type { Study } from './study';
import type { MoveScore } from './ai';
import { explain, type Facts } from './llm';
import { INTENT_INFO, deepFacts, intentsOf } from './deepcoach';
import { moveToText, pieceName } from './notation';
import { planHtml, planOf } from './plan';

export type HintLevel = 0 | 1 | 2 | 3;

export const HINT_LEVELS: { id: HintLevel; name: string; short: string; desc: string }[] = [
  // short 是给对局 HUD 用的。那一行在 390px 的手机上要挤下退出、回合提示、
  // 静音、教练、悔棋、重开六个东西，写全名会折行，折行之后按钮高度不齐，很难看。
  { id: 0, name: '关闭', short: '关', desc: '安静对弈，什么都不提示' },
  { id: 1, name: '轻提示', short: '轻', desc: '只说一句"这里有风险"，怎么回事自己想' },
  { id: 2, name: '标准提示', short: '标', desc: '说清楚会发生什么，提前提醒对方的威胁（推荐）' },
  { id: 3, name: '教学提示', short: '教', desc: '再读出对方每一步的意图，还能追问"为什么"' },
];

const KEY = 'xq-hint-level';

/** 默认档：标准提示。新用户最需要的就是"告诉我哪个子有危险" */
const DEFAULT_LEVEL: HintLevel = 2;

export function getHintLevel(): HintLevel {
  try {
    const raw = localStorage.getItem(KEY);
    // 必须先判 null 再转数字。Number(null) 是 0，而 0 恰好是"关闭"这一档——
    // 结果就是所有新用户一进来教练模式是关的，而教练模式正是这个产品
    // 和普通对弈软件最大的区别。界面上看不出任何异常，功能就这么没了。
    if (raw === null) return DEFAULT_LEVEL;
    const v = Number(raw);
    return ([0, 1, 2, 3] as HintLevel[]).includes(v as HintLevel) ? (v as HintLevel) : DEFAULT_LEVEL;
  } catch {
    return DEFAULT_LEVEL;
  }
}

export function setHintLevel(v: HintLevel) {
  try {
    localStorage.setItem(KEY, String(v));
  } catch {
    /* 存不下就只在本次对局生效 */
  }
}

/**
 * 一手棋的判读。
 *
 * **只有一个裁判：引擎。** 报警、推荐、求助读的是同一份分析（study.ts），
 * 所以"推荐了又说不行"在结构上不可能发生。
 *
 * 静态兑子（teach.moveRisk）只在**完全拿不到引擎数据**时兜底。
 * 上一版的毛病就出在这里：引擎数据明明在，报警的话却还是从静态兑子里拿——
 * 快被将死的时候出将，静态兑子说"会丢兵"，引擎说"这是唯一活路"，
 * 两句话同时出现在屏幕上。现在引擎在场时，每一句话都从引擎的主变里取。
 */
export interface MoveVerdict {
  /** 比引擎首选差多少分（兵=100）。lossAtLeast 时是下限 */
  loss: number;
  /** loss 只是下限：这一手差得太多，引擎只证明了"至少差这么多" */
  lossAtLeast?: boolean;
  /** 在所有合法着法里排第几，1 = 引擎首选。0 = 不知道 */
  rank: number;
  /** 引擎首选 */
  best?: MoveScore;
  /** 你这一手的引擎读数 */
  played?: MoveScore;
  /** 具体亏在哪个子上（静态兑子算的，只在没有引擎数据时用） */
  risk: MoveRisk | null;
  /** 走完之后对方一步就能将死 */
  mateNext: boolean;
  /** 对方将死你的那一手 */
  mateMove?: Move | null;
  /** 引擎分析到底有没有拿到 */
  fromEngine: boolean;
  /** 判这一手时引擎算到了第几层 */
  depth?: number;
  /** 这个局面已经算完，不会再改判了 */
  final?: boolean;
  /** 连引擎首选也逃不过被杀：局面已经输定，挑哪一手都一样 */
  lost?: boolean;
  /** 你有杀棋，这一手放过了 */
  missedMate?: boolean;
  /** 对方对这一手最好的应着（引擎主变的第二手） */
  reply?: Move;
}

const sameMove = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

export function judgeMove(
  before: Board,
  m: Move,
  me: Color,
  analysis: MoveScore[] | null,
  meta: { depth?: number; final?: boolean } = {},
): MoveVerdict {
  const risk = moveRisk(before, m, me);
  const after = applyMove(before, m);
  const mateMove = mateInOne(after, other(me));
  const mateNext = !!mateMove;

  if (!analysis || !analysis.length) {
    return { loss: 0, rank: 0, risk, mateNext, mateMove, fromEngine: false };
  }
  const idx = analysis.findIndex((s) => sameMove(s.move, m));
  const best = analysis[0];
  const played = idx >= 0 ? analysis[idx] : undefined;
  // 找不到这一手说明分析对应的是**另一个局面**。宁可当作没有引擎数据，
  // 也不能拿错局面的分数去判——那比不判更糟。
  // 真正的护栏在调用方：study.is(board, me) 比对的是 FEN。
  if (!played) return { loss: 0, rank: 0, risk, mateNext, mateMove, fromEngine: false };

  // 杀棋分是四万多，直接相减会得出天文数字，截到一个车的两倍就够表达"输定了"
  const raw = best.score - played.score;
  const loss = Math.max(0, Math.min(2000, raw));
  return {
    loss,
    lossAtLeast: !!played.bound,
    rank: idx + 1,
    best,
    played,
    risk,
    mateNext,
    mateMove,
    fromEngine: true,
    depth: meta.depth,
    final: meta.final,
    lost: best.mateIn !== undefined && best.mateIn < 0,
    missedMate: best.mateIn !== undefined && best.mateIn > 0 && !(played.mateIn !== undefined && played.mateIn > 0),
    reply: played.pv[1],
  };
}

/**
 * 这个级别该不该开口。
 *
 * 门槛用**引擎分差**衡量，不用"哪个子会被吃"。
 *
 * 几条硬规则，按优先级：
 *   1. 引擎首选永远不报警——"推荐了又说不行"必须在结构上不可能。
 *   2. 走完被一步杀要拦，**除非怎么走都被一步杀**（那说什么都没用）。
 *   3. 局面已经输定（首选也逃不过杀）就闭嘴。这时候挑哪一手都是输，
 *      还一手一手地拦，就是用户说的"都要被将死了还不让我出将"。
 *      这种局面单独给一句实话（lostNotice），不逐手唠叨。
 *   4. 赢定了的局面，只要这一手还赢定，就别为了几个兵的"不够精确"去打扰。
 */
const LOSS_GATE: Record<HintLevel, number> = { 0: Infinity, 1: 500, 2: 250, 3: 120 };

export function shouldWarn(level: HintLevel, v: MoveVerdict | null): boolean {
  if (!v || level === 0) return false;
  if (!v.fromEngine) {
    // 完全没有引擎数据：一步杀是规则算出来的，百分之百可靠，照拦；
    // 静态丢子按严重程度兜底，免得后台还没算出来时让人白白掉坑
    if (v.mateNext) return true;
    if (!v.risk) return false;
    return v.risk.severity >= (level === 1 ? 3 : level === 2 ? 2 : 1);
  }
  if (v.rank === 1) return false;
  if (v.mateNext) return v.best?.mateIn !== -1;
  if (v.lost) return false;
  if (v.missedMate) return true;
  if (v.played && v.played.score >= 1200 && v.loss < 600) return false;
  return v.loss >= LOSS_GATE[level];
}

/**
 * 这一手在分析里只有上限（引擎只精确排了前几名），得先精确算一下才能判。
 *
 * 专业引擎只精确排前 6 名，其余的只知道"不比第 6 名好"。安静的局面里前 6 名只差
 * 二三十分，拿这个上限去判，一手丢马的棋也会被当成"差不多"放过去。
 * 所以只要你走的那一手只有上限，教练一律先精确算它，再决定开不开口。
 */
export function needsExact(v: MoveVerdict): boolean {
  return v.fromEngine && !!v.played?.bound && v.rank !== 1 && !v.mateNext;
}

/** 这一手的引擎主变走下去，双方各被吃掉了什么 */
function lineLosses(before: Board, pv: Move[], me: Color): { mine: string[]; theirs: string[]; net: number } {
  let cur = before;
  const mine: string[] = [];
  const theirs: string[] = [];
  let net = 0;
  for (const mv of pv.slice(0, 8)) {
    const cap = cur[mv.ty]?.[mv.tx];
    if (cap && cap.t !== 'K') {
      const nm = pieceName(cap.t, cap.c);
      if (cap.c === me) {
        mine.push(nm);
        net -= PIECE_VALUE[cap.t];
      } else {
        theirs.push(nm);
        net += PIECE_VALUE[cap.t];
      }
    }
    cur = applyMove(cur, mv);
  }
  return { mine, theirs, net };
}

/**
 * 这个级别该说到什么程度。
 *
 * 有引擎数据时，话全部从引擎的主变里取：对方怎么应、几步之后谁丢了什么。
 * 这样说出来的每一句都和 🔍 求助、和复盘是同一个口径。
 */
export function warnText(level: HintLevel, v: MoveVerdict, before?: Board, move?: Move): string {
  const after = before && move ? applyMove(before, move) : null;
  if (v.mateNext) {
    if (level === 1) return '小心，这一步之后有危险。';
    const how = after && v.mateMove ? `（对方 ${moveToText(after, v.mateMove)}）` : '';
    return `小心，走完这一步对方就能把你将死${how}。`;
  }
  if (level === 1) return v.missedMate ? '这里有更好的机会，再看看。' : '这里似乎有更好的选择。';
  if (!v.fromEngine) return v.risk ? v.risk.brief : '这里有风险。';

  const reply = after && v.reply ? moveToText(after, v.reply) : '';
  // 对方应着第一手就吃子：直接点名，这是新手最需要看见的
  const first = after && v.reply ? after[v.reply.ty][v.reply.tx] : null;
  const eaten = first && reply ? `走完之后对方会 ${reply}，吃掉你的${pieceName(first.t, first.c)}` : '';
  if (v.missedMate && v.best?.mateIn) {
    return `这里你有杀棋——${v.best.mateIn} 步之内能将死对方，这一手放过了${eaten ? `；而且${eaten}` : ''}。再找找。`;
  }
  const amount = `${inPieces(v.loss)}${v.lossAtLeast ? '以上' : ''}`;
  if (v.played?.mateIn !== undefined && v.played.mateIn < 0) {
    return `走完这一步，对方有 ${-v.played.mateIn} 步杀${reply ? `，从 ${reply} 开始` : ''}。`;
  }
  if (before && v.played && v.best) {
    const side = moverOf(before, move);
    const mine = lineLosses(before, v.played.pv, side);
    const ref = lineLosses(before, v.best.pv, side);
    if (eaten) return `${eaten}——算下去比最好的下法少${amount}。`;
    if (ref.net - mine.net >= 90 && mine.mine.length) {
      return `对方接 ${reply || '下一手'} 之后，几步之内你会丢${mine.mine[0]}——算下去比最好的下法少${amount}。`;
    }
  }
  return `这一手不直接丢子，但位置和主动权上吃亏：比最好的下法差约${amount}${reply ? `（对方会接 ${reply}）` : ''}。`;
}

/** 这一手动的是谁的子 */
function moverOf(before: Board, move?: Move): Color {
  const p = move ? before[move.fy][move.fx] : null;
  return p ? p.c : 'r';
}

/**
 * 局面已经没救了：给一句实话，不逐手唠叨。
 *
 * 只在分析**算完**之后才说——浅层看着像输棋、深层找到解杀的情况是有的，
 * 这句话说错了比不说伤害大得多。
 */
export function lostNotice(board: Board, moves: MoveScore[], strongFoe = true): string | null {
  const b = moves[0];
  if (!b) return null;
  const hold = moveToText(board, b.move);
  if (b.mateIn !== undefined && b.mateIn < 0) {
    // 弱档的对手会看走眼：理论上的杀棋它不一定走得出来。
    // 这时候劝人认输就是教练在帮倒忙——实话要说，但出路也要说
    if (!strongFoe) {
      return `理论上对方已经有 ${-b.mateIn} 步杀了。不过这个难度的对手不一定看得见——最顽强的是 ${hold}，接着下还有机会。`;
    }
    return `对方已经有 ${-b.mateIn} 步杀，怎么走都挡不住了。最顽强的是 ${hold}。可以接着下练防守，也可以认输，直接去复盘找是哪一步开始出的问题。`;
  }
  // 子力落后很多：只对强档对手说。弱档对手送子是常事，落后一个车照样翻得回来
  if (b.score <= -1500 && strongFoe) {
    return `局面已经很难了：算下去落后约${inPieces(-b.score)}。可以接着下练顽强防守，也可以认输去复盘。`;
  }
  return null;
}

/**
 * 轮到你走时，对方是不是已经摆好了一步杀。
 *
 * 新手最常见的输法不是"走了一步坏棋"，而是**根本没看见对方的威胁**，
 * 自顾自地去吃子。一步杀是规则算出来的，百分之百可靠，值得在你动手之前说一句。
 */
export function threatNotice(board: Board, me: Color, level: HintLevel): string | null {
  if (level === 0) return null;
  // 被将军时优先应将，那一条另有提示；这里再算会把"已经在将军"当成"威胁"
  if (isInCheck(board, me)) return null;
  const k = mateInOne(board, other(me));
  if (!k) return null;
  if (level === 1) return '注意：对方已经有杀着了，先看看防守。';
  return `注意：对方威胁 ${moveToText(board, k)} 直接将死你，这一步先解决它。`;
}

/**
 * 读对方上一步：它想干什么。
 *
 * 新手下棋最大的盲区不是"不知道自己该走哪"，而是**根本没去想对方刚才那一步想干嘛**。
 * 强手每走一步之前先问的就是这个。所以教练替你问出来：
 *   标准提示：只在对方这一步新捉了你的子时说（这是最要命、也最常被忽略的）
 *   教学提示：每一步都说对方的意图——将军、捉子、出动大子、占中、过河……
 * 意图是规则算出来的（intentsOf），不是猜的。
 */
export function readOpponent(before: Board, m: Move, foe: Color, level: HintLevel): string | null {
  if (level < 2) return null;
  const me = other(foe);
  const after = applyMove(before, m);
  const text = moveToText(before, m);
  const was = new Set(hangingPieces(before, me).map((h) => `${h.x},${h.y}`));
  const fresh = hangingPieces(after, me).filter((h) => !was.has(`${h.x},${h.y}`) && h.t !== 'P');
  if (fresh.length) {
    const top = fresh.sort((a, b) => b.loss - a.loss)[0];
    return `对方 ${text}：在捉你的${top.name}，先看看怎么应。`;
  }
  if (level < 3) return null;
  const names = intentsOf(before, m, foe)
    .filter((i) => i !== 'quiet' && i !== 'check' && i !== 'mate-threat')
    .map((i) => INTENT_INFO[i].name);
  if (!names.length) return null;
  return `对方上一步 ${text}：${names.join('、')}。`;
}

export interface CoachPromptOpts {
  host: HTMLElement;
  level: HintLevel;
  /** 走这一手之前的棋盘 */
  before: Board;
  move: Move;
  me: Color;
  verdict: MoveVerdict;
  /** 用户坚持走这一手。retracted = 教练已经改判放行；v = 此刻最新的判读 */
  onProceed: (retracted: boolean, v: MoveVerdict) => void;
  /** 用户改主意，收回这一手 */
  onCancel: () => void;
  /** 第几手，用来判开局/中局/残局 */
  ply?: number;
  /**
   * 这个局面的研究。给了它，提示条会**跟着研究一起更新**：
   * 算深之后结论变了（原来看着亏，其实是好棋），当场改口，而不是留着一句错话。
   */
  study?: Study | null;
  /**
   * 这一手在分析里只有下限（"至少差这么多"）时，拿它补一次精确计算。
   * 算回来之后提示条改成精确的说法——"至少少一个车"变成"两步之内被将死"。
   */
  refine?: () => Promise<MoveScore | null>;
  /**
   * 棋盘。有它就能把话**画在盘上**：对方的惩罚着法画成箭头。
   * "你的车会被吃"是抽象的，一条从对方车指向你的车的红箭头是具体的。
   */
  board?: {
    setArrows(a: { fx: number; fy: number; tx: number; ty: number; color?: string }[]): void;
    select(sel: { x: number; y: number } | null, moves?: { x: number; y: number; capture?: boolean }[]): void;
  };
}

/**
 * 弹出提示条。返回一个关闭函数。
 *
 * 界面上只有两个按钮：**换一手** 和 **就这么走**。
 * 没有"知道了"这种只能确认的按钮——那等于强制用户接受教练的意见。
 * 教学提示档多一个"为什么？"，点开才讲道理，不点就不占屏幕。
 */
/*
 * 类名用 xq-tip 而不是 xq-coach：学棋模块（coach.ts）的整屏容器已经叫 .xq-coach 了，
 * 那条规则里有 `inset: 0`。撞名之后两边的样式会互相污染。
 */
export function showCoachPrompt(opts: CoachPromptOpts): () => void {
  const { host, level, before, move, me } = opts;
  let verdict = opts.verdict;
  let retracted = false;
  const el = document.createElement('div');
  el.innerHTML = `
    <div class="xq-tip-body">
      <span class="xq-tip-icon"></span>
      <span class="xq-tip-text"></span>
    </div>
    <div class="xq-tip-status"></div>
    <div class="xq-tip-plan"></div>
    <div class="xq-tip-why"></div>
    <div class="xq-tip-bar">
      ${level >= 3 ? '<button class="xq-btn" data-act="why">为什么？</button>' : ''}
      <button class="xq-btn" data-act="cancel">换一手</button>
      <button class="xq-btn primary" data-act="go">就这么走</button>
    </div>`;
  host.appendChild(el);
  const elIcon = el.querySelector('.xq-tip-icon') as HTMLElement;
  const elText = el.querySelector('.xq-tip-text') as HTMLElement;
  const elStatus = el.querySelector('.xq-tip-status') as HTMLElement;
  const elWhy = el.querySelector('.xq-tip-why') as HTMLElement;
  const elPlan = el.querySelector('.xq-tip-plan') as HTMLElement;
  const elGo = el.querySelector('[data-act="go"]') as HTMLButtonElement;

  let planKey = '';
  let planMemo = '';
  const paint = () => {
    const sev = retracted ? 0 : verdict.mateNext || verdict.loss >= 900 ? 3 : verdict.loss >= 420 || verdict.risk?.severity === 2 ? 2 : 1;
    el.className = `xq-tip sev${sev}${retracted ? ' ok' : ''}`;
    elIcon.textContent = retracted ? '✅' : sev >= 3 ? '⚠️' : '💡';
    if (retracted) {
      const place = verdict.rank === 1 ? '引擎的首选' : `引擎排第 ${verdict.rank}，只比首选差${inPieces(verdict.loss)}`;
      elText.textContent = `改判：往深算了几层，这一手没问题（${place}）。刚才的提醒作废，放心走。`;
      elGo.textContent = '那就走';
    } else {
      elText.textContent = warnText(level, verdict, before, move);
      elGo.textContent = '就这么走';
    }
    // 不只说"这手不好"，还要说该怎么走、接下来往哪儿走（标准提示以上）
    const best = verdict.best;
    const want = !retracted && level >= 2 && best && !best.bound && !sameMove(best.move, move);
    // 研究每多算一层都会重画；主变没变就不重新翻译
    const key = want ? `${best.pv.map((x) => `${x.fx}${x.fy}${x.tx}${x.ty}`).join(' ')}|${best.score}|${best.mateIn ?? ''}` : '';
    if (key !== planKey) {
      planKey = key;
      planMemo = want
        ? `<div class="lead">更好的是 <b>${moveToText(before, best.move)}</b>：</div>${planHtml(planOf(before, me, best, 5))}`
        : '';
    }
    const planned = planMemo;
    if (elPlan.dataset.k !== planned) {
      elPlan.dataset.k = planned;
      elPlan.innerHTML = planned;
    }
    const s = opts.study;
    if (s && !s.done && !s.stopped) elStatus.textContent = `初步判断（已算 ${s.depth} 层，还在往深算，结论变了会马上告诉你）`;
    else if (s && s.depth) elStatus.textContent = `已算完 ${s.depth} 层`;
    else elStatus.textContent = '';
    // 把危险画到盘上：对方的惩罚着法画成红箭头
    if (opts.board) {
      const punish = retracted ? null : verdict.mateMove ?? verdict.reply ?? verdict.risk?.punish ?? null;
      opts.board.setArrows(punish ? [{ ...punish, color: 'rgba(224,67,58,0.92)' }] : []);
      opts.board.select(null);
    }
  };
  // 对方的惩罚着法画在"走之前"的盘面上也对得上：它的起点是对方的子，
  // 你这一手动不到它（动到了就是吃掉它，那对方也就没有这一手了）
  paint();

  /** 这一手的精确读数（补算回来的）。研究更新时，这一手还是只有下限的话就用它顶上 */
  let exact: MoveScore | null = null;
  const withExact = (moves: MoveScore[]): MoveScore[] => {
    if (!exact) return moves;
    return moves.map((x) => (sameMove(x.move, move) && x.bound ? exact! : x));
  };
  const rejudge = (moves: MoveScore[], meta: { depth?: number; final?: boolean }) => {
    const v = judgeMove(before, move, me, withExact(moves), meta);
    if (!v.fromEngine) return;
    verdict = v;
    retracted = !shouldWarn(level, v);
    paint();
  };

  // 跟着研究更新：算深之后改判，当场改口
  const off = opts.study?.subscribe((s) => {
    if (closed || s.stopped) return;
    rejudge(s.moves, { depth: s.depth, final: s.done });
  });

  if (opts.refine && verdict.played?.bound) {
    void opts.refine().then((r) => {
      if (closed || !r) return;
      exact = r;
      const moves = opts.study?.moves.length ? opts.study.moves : null;
      if (moves) rejudge(moves, { depth: opts.study?.depth, final: opts.study?.done });
    });
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    off?.();
    opts.board?.setArrows([]); // 提示条收掉，盘上的箭头也要一起收
    el.remove();
  };

  el.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    if (act === 'go') {
      const r = retracted;
      close();
      opts.onProceed(r, verdict);
      return;
    }
    if (act === 'cancel') {
      close();
      opts.onCancel();
      return;
    }
    if (act === 'why') {
      // 深度解读要组织梯次和主变，先把状态摆出来，不然用户会以为按钮没反应
      const btn = el.querySelector('[data-act="why"]') as HTMLButtonElement | null;
      if (btn) {
        if (btn.disabled) return;
        btn.disabled = true;
        btn.textContent = '分析中…';
      }
      elWhy.textContent = '正在从全局算这一步的得失…';
      elWhy.classList.add('on');
      try {
        // 事实全部由规则和引擎算出来，模型只负责讲成人话
        const moves = opts.study?.moves.length ? withExact(opts.study.moves) : null;
        const facts = await deepFacts(before, move, me, { ply: opts.ply, analysis: moves });
        elWhy.innerHTML = mdToHtml(await explain(facts));
      } catch {
        const fallback: Facts = {
          kind: 'risk-why',
          side: me === 'r' ? '红' : '黑',
          played: moveToText(before, move),
          problem: verdict.risk?.detail,
        };
        elWhy.innerHTML = mdToHtml(await explain(fallback));
      }
      if (btn) btn.textContent = '已展开';
    }
  });

  return close;
}

/**
 * 极简 Markdown → HTML。
 *
 * 讲解层输出的是带 **粗体** 和换行的纯文本，直接塞进 textContent 会把
 * 星号原样显示出来，塞进 innerHTML 又有注入风险。所以这里**先转义再只放行
 * 粗体和换行**——讲解内容里本来就不该出现别的标记。
 */
export function mdToHtml(text: string): string {
  const esc = text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return esc.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n/g, '<br>');
}

/**
 * 教练模式的完整一次判断。
 *
 * 对局代码只要调这一个函数：给它一手棋，它决定要不要拦、怎么说。
 * 返回 null = 放行，直接走。
 */
export function checkMove(
  level: HintLevel,
  before: Board,
  move: Move,
  me: Color,
  analysis: MoveScore[] | null,
  meta: { depth?: number; final?: boolean } = {},
): MoveVerdict | null {
  if (level === 0) return null;
  const v = judgeMove(before, move, me, analysis, meta);
  return shouldWarn(level, v) ? v : null;
}
