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
 * 判断全部来自 teach.ts 的静态计算，不走搜索，所以落子瞬间就有反应，
 * 而且同一个局面永远给同一个答复。
 */
import type { Board, Color, Move } from './rules';
import { inPieces, mateInOne, moveRisk, other, type MoveRisk } from './teach';
import { applyMove } from './rules';
import type { MoveScore } from './ai';
import { explain, type Facts } from './llm';
import { deepFacts } from './deepcoach';
import { moveToText } from './notation';

export type HintLevel = 0 | 1 | 2 | 3;

export const HINT_LEVELS: { id: HintLevel; name: string; short: string; desc: string }[] = [
  // short 是给对局 HUD 用的。那一行在 390px 的手机上要挤下退出、回合提示、
  // 静音、教练、悔棋、重开六个东西，写全名会折行，折行之后按钮高度不齐，很难看。
  { id: 0, name: '关闭', short: '关', desc: '安静对弈，什么都不提示' },
  { id: 1, name: '轻提示', short: '轻', desc: '只说一句"这里有风险"，怎么回事自己想' },
  { id: 2, name: '标准提示', short: '标', desc: '说清楚是哪个子有危险（推荐）' },
  { id: 3, name: '教学提示', short: '教', desc: '说清楚，还能追问"为什么"' },
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
 * **这是整个教练最关键的一次重构。**
 *
 * 之前有两个互相独立的裁判：报警用静态兑子（teach.moveRisk），
 * 推荐用搜索引擎（analyze）。两个裁判看的东西不一样，于是出了两个真问题：
 *
 *   1. 报警永远只会说"你哪个子会被吃"——因为静态兑子只认这件事。
 *      一手位置很差但不丢子的棋，它一句话都不说。这就是"只盯着少子、
 *      没有全局考虑"。
 *   2. 教练推荐了 A，用户照着走 A，静态兑子又跳出来说 A 有风险。
 *      因为引擎看得深，知道那个子被吃之后有更好的后续；静态兑子看不到。
 *      推荐完又打自己脸，这是最伤信任的一种 bug。
 *
 * 现在只留一个裁判：**引擎**。报警和推荐来自同一次分析、同一个排序，
 * 所以"推荐了又说不行"在结构上不可能发生。
 * 静态兑子降级为**解释工具**——引擎说这手亏了之后，用它说清亏在哪个子上。
 */
export interface MoveVerdict {
  /** 比引擎首选差多少分（兵=100）。引擎没算出来时为 0 */
  loss: number;
  /** 在所有合法着法里排第几，1 = 引擎首选。0 = 不知道 */
  rank: number;
  /** 引擎首选 */
  best?: MoveScore;
  /** 你这一手的引擎读数 */
  played?: MoveScore;
  /** 具体亏在哪个子上（静态兑子算的，只作解释用） */
  risk: MoveRisk | null;
  /** 走完之后对方一步就能将死 */
  mateNext: boolean;
  /** 引擎分析到底有没有拿到。没拿到时只能退回静态判断，准确度低一档 */
  fromEngine: boolean;
}

const sameMove = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

export function judgeMove(before: Board, m: Move, me: Color, analysis: MoveScore[] | null): MoveVerdict {
  const risk = moveRisk(before, m, me);
  const after = applyMove(before, m);
  const mateNext = !!mateInOne(after, other(me));

  if (!analysis || !analysis.length) {
    return { loss: 0, rank: 0, risk, mateNext, fromEngine: false };
  }
  const idx = analysis.findIndex((s) => sameMove(s.move, m));
  const best = analysis[0];
  const played = idx >= 0 ? analysis[idx] : undefined;
  // 找不到这一手说明分析对应的是**另一个局面**（用户在分析回来之前又走了一手）。
  // 这种时候宁可当作没有引擎数据，也不能拿错局面的分数去判——那比不判更糟。
  //
  // 注意这只是第二道保险：不同局面完全可能有坐标相同的着法，光靠"在不在表里"
  // 拦不住。真正的护栏在调用方——落子前比对局面的 FEN，对不上就不用这份分析。
  if (!played) return { loss: 0, rank: 0, risk, mateNext, fromEngine: false };

  // 杀棋分是四万多，直接相减会得出天文数字，截到一个车的两倍就够表达"输定了"
  const raw = best.score - played.score;
  const loss = Math.max(0, Math.min(2000, raw));
  return { loss, rank: idx + 1, best, played, risk, mateNext, fromEngine: true };
}

/**
 * 这个级别该不该开口。
 *
 * 门槛用**引擎分差**衡量，不再用"哪个子会被吃"。这样一手位置很差但不丢子的棋
 * 也会被拦下来——那正是用户说的"要从全局看"。
 *
 * 第一条铁律：**引擎自己的首选，永远不报警**。
 * 这一条单独写在最前面，因为"推荐了又说不行"是最伤信任的 bug，
 * 它必须在结构上不可能发生，而不是靠调阈值去躲。
 */
const LOSS_GATE: Record<HintLevel, number> = { 0: Infinity, 1: 500, 2: 250, 3: 120 };

export function shouldWarn(level: HintLevel, v: MoveVerdict | null): boolean {
  if (!v || level === 0) return false;
  if (v.mateNext) return true; // 走完被一步将死，任何档位都要拦
  if (v.fromEngine) {
    if (v.rank === 1) return false; // 引擎首选，绝不报警
    return v.loss >= LOSS_GATE[level];
  }
  // 引擎数据没拿到：退回静态判断，门槛按严重程度
  if (!v.risk) return false;
  return v.risk.severity >= (level === 1 ? 3 : level === 2 ? 2 : 1);
}

/** 这个级别该说到什么程度 */
export function warnText(level: HintLevel, v: MoveVerdict): string {
  if (v.mateNext) return level === 1 ? '小心，这一步之后有危险。' : '小心，走完这一步对方就能把你将死。';
  if (level === 1) return '这里似乎有更好的选择。';
  // 有具体丢子就说子，没有就说这是位置上的亏——后者正是原来完全说不出口的那一类
  if (v.risk) return v.risk.brief;
  if (v.fromEngine && v.loss >= 120) {
    return `这一手不算错棋，但比最好的下法差了约${inPieces(v.loss)}——问题不在丢子，在位置。`;
  }
  return '这里有风险。';
}

export interface CoachPromptOpts {
  host: HTMLElement;
  level: HintLevel;
  /** 走这一手之前的棋盘 */
  before: Board;
  move: Move;
  me: Color;
  verdict: MoveVerdict;
  /** 用户坚持走这一手 */
  onProceed: () => void;
  /** 用户改主意，收回这一手 */
  onCancel: () => void;
  /** 第几手，用来判开局/中局/残局 */
  ply?: number;
  /** 这个局面的引擎分析。深度解读直接复用，不必再搜一次 */
  analysis?: MoveScore[] | null;
  /**
   * 棋盘。有它就能把话**画在盘上**：危险的子圈出来，对方的惩罚着法画成箭头。
   *
   * 这一条比多讲一百个字都管用——"你的车会被吃"是抽象的，
   * 一条从对方车指向你的车的红箭头是具体的，看一眼就懂，而且记得住。
   */
  board?: {
    setArrows(a: { fx: number; fy: number; tx: number; ty: number; color?: string }[]): void;
    select(sel: { x: number; y: number } | null, moves?: { x: number; y: number; capture?: boolean }[]): void;
  };
}

/**
 * 弹出提示条。返回一个关闭函数。
 *
 * 界面上只有两个按钮：**改一手** 和 **就这么走**。
 * 没有"知道了"这种只能确认的按钮——那等于强制用户接受教练的意见。
 * 教学提示档多一个"为什么？"，点开才讲道理，不点就不占屏幕。
 */
/*
 * 类名用 xq-tip 而不是 xq-coach：学棋模块（coach.ts）的整屏容器已经叫 .xq-coach 了，
 * 那条规则里有 `inset: 0`。撞名之后 top:0 会从那条规则继承下来，和这里的 bottom
 * 一起把提示条撑成满屏高；反过来这里的背景、边框、动画也会套到整个学棋界面上。
 * 两边都毁，而且只有真的打开界面看才发现得了。
 */
export function showCoachPrompt(opts: CoachPromptOpts): () => void {
  const { host, level, before, move, me, verdict } = opts;
  const el = document.createElement('div');
  // 严重程度：被将死 > 丢车 > 丢马炮 > 其它
  const sev = verdict.mateNext || verdict.loss >= 900 ? 3 : verdict.loss >= 420 || verdict.risk?.severity === 2 ? 2 : 1;
  el.className = `xq-tip sev${sev}`;
  el.innerHTML = `
    <div class="xq-tip-body">
      <span class="xq-tip-icon">${sev >= 3 ? '⚠️' : '💡'}</span>
      <span class="xq-tip-text">${warnText(level, verdict)}</span>
    </div>
    <div class="xq-tip-why"></div>
    <div class="xq-tip-bar">
      ${level >= 3 ? '<button class="xq-btn" data-act="why">为什么？</button>' : ''}
      <button class="xq-btn" data-act="cancel">换一手</button>
      <button class="xq-btn primary" data-act="go">就这么走</button>
    </div>`;
  host.appendChild(el);
  const elWhy = el.querySelector('.xq-tip-why') as HTMLElement;
  // 把危险画到盘上：受威胁的子圈红，对方吃它的那一手画成红箭头
  if (opts.board && verdict.risk?.punish) {
    opts.board.setArrows([{ ...verdict.risk.punish, color: 'rgba(224,67,58,0.92)' }]);
    opts.board.select(null);
  }

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    opts.board?.setArrows([]); // 提示条收掉，盘上的箭头也要一起收
    el.remove();
  };

  el.addEventListener('click', async (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (!act) return;
    if (act === 'go') {
      close();
      opts.onProceed();
      return;
    }
    if (act === 'cancel') {
      close();
      opts.onCancel();
      return;
    }
    if (act === 'why') {
      // 深度解读要跑一次搜索（约一两秒），必须先把状态摆出来，
      // 不然用户会以为按钮没反应，连点好几下
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
        const facts = await deepFacts(before, move, me, { ply: opts.ply, analysis: opts.analysis });
        elWhy.innerHTML = mdToHtml(await explain(facts));
      } catch {
        // 搜索出问题也要有话说：退回静态事实，至少把代价讲清楚
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
): MoveVerdict | null {
  if (level === 0) return null;
  const v = judgeMove(before, move, me, analysis);
  return shouldWarn(level, v) ? v : null;
}
