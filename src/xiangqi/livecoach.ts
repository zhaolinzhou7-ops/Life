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
import { moveRisk, type MoveRisk } from './teach';
import { explain, type Facts } from './llm';
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
 * 这个级别该不该为这条风险出声。
 *
 * 门槛按级别抬高：轻提示只管"要出大事"的，教学提示连小亏也讲。
 * 这一条单独抽成函数是为了能测——提示策略是产品的核心体验，
 * 不能藏在一堆 DOM 操作中间。
 */
export function shouldWarn(level: HintLevel, risk: MoveRisk | null): boolean {
  if (!risk || level === 0) return false;
  if (level === 1) return risk.severity >= 3; // 只在要丢车或被将死的时候开口
  if (level === 2) return risk.severity >= 2; // 丢马炮以上
  return risk.severity >= 1; // 教学档：亏一个兵也说
}

/** 这个级别该说到什么程度 */
export function warnText(level: HintLevel, risk: MoveRisk): string {
  if (level === 1) return risk.kind === 'mate-next' ? '小心，这一步之后有危险。' : '这里似乎有战术风险。';
  return risk.kind === 'mate-next' ? risk.brief : risk.brief;
}

export interface CoachPromptOpts {
  host: HTMLElement;
  level: HintLevel;
  /** 走这一手之前的棋盘 */
  before: Board;
  move: Move;
  me: Color;
  risk: MoveRisk;
  /** 用户坚持走这一手 */
  onProceed: () => void;
  /** 用户改主意，收回这一手 */
  onCancel: () => void;
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
  const { host, level, before, move, me, risk } = opts;
  const el = document.createElement('div');
  el.className = `xq-tip sev${risk.severity}`;
  el.innerHTML = `
    <div class="xq-tip-body">
      <span class="xq-tip-icon">${risk.severity >= 3 ? '⚠️' : '💡'}</span>
      <span class="xq-tip-text">${warnText(level, risk)}</span>
    </div>
    <div class="xq-tip-why"></div>
    <div class="xq-tip-bar">
      ${level >= 3 ? '<button class="xq-btn" data-act="why">为什么？</button>' : ''}
      <button class="xq-btn" data-act="cancel">换一手</button>
      <button class="xq-btn primary" data-act="go">就这么走</button>
    </div>`;
  host.appendChild(el);
  const elWhy = el.querySelector('.xq-tip-why') as HTMLElement;

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
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
      elWhy.textContent = '…';
      elWhy.classList.add('on');
      // 讲解层只拿事实，不拿棋盘——它编不出盘上没有的着法
      const facts: Facts = {
        kind: 'risk-why',
        side: me === 'r' ? '红' : '黑',
        played: moveToText(before, move),
        problem: risk.detail,
        punish: risk.punish ? moveToText(applyForText(before, move), risk.punish) : undefined,
      };
      elWhy.textContent = await explain(facts);
    }
  });

  return close;
}

/** 惩罚着法的记谱要在"走完我这一手之后"的局面上算，否则记谱会错 */
function applyForText(b: Board, m: Move): Board {
  const nb = b.map((row) => row.slice());
  nb[m.ty][m.tx] = nb[m.fy][m.fx];
  nb[m.fy][m.fx] = null;
  return nb;
}

/**
 * 教练模式的完整一次判断。
 *
 * 对局代码只要调这一个函数：给它一手棋，它决定要不要拦、怎么说。
 * 返回 null = 放行，直接走。
 */
export function checkMove(level: HintLevel, before: Board, move: Move, me: Color): MoveRisk | null {
  if (level === 0) return null;
  const risk = moveRisk(before, move, me);
  return shouldWarn(level, risk) ? risk : null;
}
