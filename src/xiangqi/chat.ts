/**
 * AI 教练对话。
 *
 * 规格里要求它能回答这些：
 *   为什么我输了？ / 这一步为什么错？ / 如果我当时走马会怎样？
 *   给我讲得简单一点 / 我这种错误是不是经常出现？
 *
 * 关键约束：**必须基于当前棋局和用户历史数据回答，不能脱离棋局随意发挥。**
 * 所以这个模块本身不产生任何棋理判断，它只做三件事：
 *   1. 把当前上下文（这一局的复盘结论 + 你的长期画像）整理成事实清单
 *   2. 交给讲解层（llm.ts）讲成人话
 *   3. 把讲解层的回话显示出来——而回话已经过了"不许编着法"那道闸
 *
 * "如果我走马会怎样"这类问题**需要重新搜索才能回答**，讲解层会老实说
 * "这个要重新算"，而不是编一段听起来专业的废话。这是故意的：
 * 学棋软件上编出来的变化，比不回答有害得多。
 */
import { explain, type Facts } from './llm';
import { buildProfile, habitsForCoach } from './insight';
import { listGames } from './archive';

/** 对话的上下文：来自当前这一局的复盘结论 */
export interface ChatContext {
  side: '红' | '黑';
  /** 这一局的统计 */
  stats?: Facts['stats'];
  /** 本局最大的问题，来自复盘 */
  problem?: string;
  /** 用户当前选中的那一手（如果有） */
  focus?: { round: number; played: string; best?: string; bestLine?: string[]; problem?: string; loss?: number };
}

/** 预置问题。新手不知道能问什么，给几个按钮比给一个输入框有用得多 */
export const QUICK_ASKS = [
  '为什么我输了？',
  '这一步为什么错？',
  '我这种错误是不是经常出现？',
  '给我讲得简单一点',
];

/** 把上下文和问题组装成事实清单 */
export function factsFor(ctx: ChatContext, question: string): Facts {
  const profile = buildProfile(listGames());
  const f: Facts = {
    kind: 'ask',
    side: ctx.side,
    question,
    stats: ctx.stats,
    problem: ctx.problem,
    habits: profile.enough ? habitsForCoach(profile) : undefined,
  };
  // 问"这一步"的时候，把选中那一手的细节也放进事实里
  if (ctx.focus && (question.includes('这一步') || question.includes('这步') || question.includes('为什么错'))) {
    f.round = ctx.focus.round;
    f.played = ctx.focus.played;
    f.best = ctx.focus.best;
    f.bestLine = ctx.focus.bestLine;
    f.loss = ctx.focus.loss;
    if (ctx.focus.problem) f.problem = ctx.focus.problem;
  }
  return f;
}

export interface ChatOpts {
  host: HTMLElement;
  getContext: () => ChatContext;
  onClose: () => void;
}

/** 打开教练对话面板 */
export function runChat(opts: ChatOpts): () => void {
  const panel = document.createElement('div');
  panel.className = 'xq-chat';
  panel.innerHTML = `
    <div class="xq-chat-head">
      <b>🧑‍🏫 问教练</b>
      <span class="xq-chat-note">回答都基于这一局的分析和你的历史数据</span>
      <button class="xq-chat-close">✕</button>
    </div>
    <div class="xq-chat-log"></div>
    <div class="xq-chat-quick"></div>
    <form class="xq-chat-bar">
      <input class="xq-chat-input" placeholder="问点别的…" autocomplete="off" />
      <button class="xq-btn primary" type="submit">问</button>
    </form>`;
  opts.host.appendChild(panel);

  const log = panel.querySelector('.xq-chat-log') as HTMLElement;
  const quick = panel.querySelector('.xq-chat-quick') as HTMLElement;
  const input = panel.querySelector('.xq-chat-input') as HTMLInputElement;

  const bubble = (who: 'me' | 'ai', text: string) => {
    const b = document.createElement('div');
    b.className = `xq-chat-msg ${who}`;
    b.textContent = text;
    log.appendChild(b);
    log.scrollTop = log.scrollHeight;
    return b;
  };

  let busy = false;
  async function ask(q: string) {
    if (busy || !q.trim()) return;
    busy = true;
    bubble('me', q);
    const pending = bubble('ai', '想一下…');
    try {
      pending.textContent = await explain(factsFor(opts.getContext(), q));
    } catch {
      // 讲解层内部已经兜过底了，这里再兜一层，保证气泡不会一直卡在"想一下"
      pending.textContent = '这个问题我暂时答不上来，换一个问法试试。';
    }
    log.scrollTop = log.scrollHeight;
    busy = false;
  }

  QUICK_ASKS.forEach((q) => {
    const b = document.createElement('button');
    b.className = 'xq-chat-chip';
    b.textContent = q;
    b.onclick = () => ask(q);
    quick.appendChild(b);
  });

  (panel.querySelector('.xq-chat-bar') as HTMLFormElement).onsubmit = (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = '';
    ask(q);
  };
  (panel.querySelector('.xq-chat-close') as HTMLButtonElement).onclick = () => {
    close();
    opts.onClose();
  };

  bubble('ai', '这一局我都看着呢。想问什么直接问，下面几个是常见的。');

  function close() {
    panel.remove();
  }
  return close;
}
