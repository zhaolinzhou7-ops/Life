/**
 * AI 讲解层：把结构化的棋局事实讲成人话。
 *
 * 这一层的职责边界是产品规格里写死的，值得在代码里再说一遍：
 *
 *   语言模型**只负责**：解释、教学、总结、对话
 *   语言模型**不负责**：判断走法合法、判断将军将死、计算局面、给最佳着法
 *
 * 所以这里的数据流是单向的：
 *
 *   规则引擎 / 搜索引擎  →  teach.ts 算出事实  →  本层组装成 Facts
 *        →  讲解（模板 或 远端模型）  →  **回话必须过一遍校验**  →  显示
 *
 * 最后那一步是关键。模型再怎么被提示词约束，也可能编出一手棋局里
 * 根本不存在的着法（"你应该走车二进六"——盘上压根没有那只车）。
 * 所以回话里出现的每一个着法记谱都要和事实清单对一遍，对不上就整段丢掉、
 * 退回模板文案。宁可讲得干巴，也不能讲错——这是学棋软件，讲错就是教坏人。
 */

/** 讲解请求的种类。每一种对应界面上一个具体的问句 */
export type ExplainKind =
  /** 这一手为什么不好 */
  | 'move-bad'
  /** 这一手为什么好 */
  | 'move-good'
  /** 整盘棋的总结 */
  | 'game-summary'
  /** 当前局面有什么风险（教练模式的"为什么？"） */
  | 'risk-why'
  /** 自由提问 */
  | 'ask';

/**
 * 交给讲解层的事实清单。
 *
 * 注意这里面**没有棋盘**。模型看不到棋盘，就编不出"你的车在二路"这种话；
 * 它能说的每一件事都必须来自这张清单。这是防胡说最省事也最可靠的一招。
 */
export interface Facts {
  kind: ExplainKind;
  /** 用户执红还是执黑，文案里称"你" */
  side: '红' | '黑';
  /** 第几回合 */
  round?: number;
  /** 用户走的那一手，中文记谱 */
  played?: string;
  /** 引擎推荐的一手 */
  best?: string;
  /** 推荐着法之后的主变，已经是记谱 */
  bestLine?: string[];
  /** 这一手的评级与亏损 */
  grade?: string;
  loss?: number;
  /** 教学层算出来的问题描述（已经是人话，来自 teach.ts） */
  problem?: string;
  /** 对方的惩罚着法 */
  punish?: string;
  /** 局面事实 */
  material?: number;
  phase?: '开局' | '中局' | '残局';
  inCheck?: boolean;
  /** 我方在白送的子 */
  hanging?: { name: string; loss: number; by: string }[];
  /** 整局统计 */
  stats?: { total: number; blunders: number; mistakes: number; avgLoss: number; won?: boolean };
  /** 用户的长期毛病，回答"我这种错误是不是经常出现"要用 */
  habits?: { name: string; count: number; advice: string }[];
  /** 用户原话的问题（kind = ask 时） */
  question?: string;
  /** 用户想要多简单的讲法 */
  tone?: 'plain' | 'normal';
}

export interface CoachProvider {
  id: string;
  label: string;
  /** 现在能不能用。远端没配就返回 false，界面据此显示"离线讲解" */
  available(): boolean;
  explain(f: Facts): Promise<string>;
}

// ───────────────────────── 着法记谱的校验 ─────────────────────────

/**
 * 中文记谱的形状。有两种写法，都要认：
 *   常规：子名 + 路数 + 进退平 + 目标   例：炮二平五、车八进五、马2进3
 *   同线：前后中 + 子名 + 进退平 + 目标 例：前马退六、后炮平四
 *
 * 第二种**没有路数**——同一路上有两个一样的子时就这么写。
 * 上一版的正则把路数写成了必需项，于是"前马退六"整个匹配不到，
 * 结果是校验闸门看不见它：模型编一手"前马退六"能直接放行。
 * 防胡说的闸门认不全记谱，等于没有闸门。
 */
const PIECE = '[车車马馬炮砲兵卒相象士仕帅將将帥]';
const NUM = '[一二三四五六七八九1-9]';
const MOVE_RE = new RegExp(`(?:[前后中]${PIECE}|${PIECE}${NUM})[进進退平]${NUM}`, 'g');

/** 从一段话里把所有着法记谱抠出来 */
export function movesIn(text: string): string[] {
  return text.match(MOVE_RE) ?? [];
}

/**
 * 校验讲解：回话里提到的着法，必须全都在事实清单里出现过。
 *
 * 这是防"AI 胡说棋"的最后一道闸。模型可以自由组织语言、打比方、
 * 换个说法讲同一件事，但它**不能凭空造出一手棋**——因为学棋的人会照着走，
 * 走完发现盘上没有这只车，整个产品的信任就没了。
 */
export function verifyExplanation(text: string, f: Facts): { ok: boolean; bad: string[] } {
  const allowed = new Set<string>();
  const add = (s?: string) => {
    if (s) for (const m of movesIn(s)) allowed.add(m);
  };
  add(f.played);
  add(f.best);
  add(f.punish);
  add(f.problem);
  f.bestLine?.forEach(add);
  f.hanging?.forEach((h) => add(h.by));
  const bad = [...new Set(movesIn(text))].filter((m) => !allowed.has(m));
  return { ok: bad.length === 0, bad };
}

// ───────────────────────── 离线讲解（模板） ─────────────────────────

const joinLine = (line?: string[]) => (line && line.length ? line.slice(0, 4).join('　') : '');

/**
 * 离线讲解：纯模板，不需要任何网络和密钥。
 *
 * 这不是"降级方案"，是**默认方案**。理由有三个：
 *   1. 没有 API 也必须能完整学棋（规格第十九条）
 *   2. 模板讲的每一句都由规则算出来，一个字都不会错
 *   3. 快——点一下就出，不用等模型
 * 远端模型的价值在于换着说法、回答开放问题，不在于讲得准。
 */
export const mockProvider: CoachProvider = {
  id: 'offline',
  label: '离线讲解',
  available: () => true,
  async explain(f: Facts): Promise<string> {
    return offlineText(f);
  },
};

export function offlineText(f: Facts): string {
  const you = `你（${f.side}方）`;
  switch (f.kind) {
    case 'move-good': {
      const bits = [`${f.round ? `第 ${f.round} 回合，` : ''}${you}走的 ${f.played} 是一步好棋。`];
      if (f.best && f.best !== f.played) bits.push(`引擎的首选是 ${f.best}，你这一手和它差不多好。`);
      if (f.bestLine?.length) bits.push(`接下来大致会这样走：${joinLine(f.bestLine)}。`);
      return bits.join('');
    }

    case 'move-bad': {
      const bits: string[] = [];
      bits.push(`${f.round ? `第 ${f.round} 回合，` : ''}${you}走了 ${f.played}。`);
      if (f.problem) bits.push(f.problem);
      else if (f.punish) bits.push(`走完这一步，对方走 ${f.punish} 就占到便宜了。`);
      if (f.best) {
        bits.push(`\n\n**这里该走 ${f.best}。**`);
        if (f.bestLine?.length) bits.push(`走完之后大致是：${joinLine(f.bestLine)}。`);
      }
      if (f.loss && f.loss >= 200) {
        bits.push(`\n\n这一手大约亏了 ${f.loss} 分`);
        bits.push(f.loss >= 900 ? '，相当于白丢一个车。' : f.loss >= 420 ? '，相当于白丢一个马或炮。' : '。');
      }
      return bits.join('');
    }

    case 'risk-why': {
      const bits: string[] = [];
      bits.push(f.problem ?? '这一步之后局面会变差。');
      if (f.punish) bits.push(`\n\n对方的手段是 ${f.punish}。`);
      if (f.hanging?.length) {
        const h = f.hanging[0];
        bits.push(`\n\n换句话说：你的${h.name}现在没人保护，对方走 ${h.by} 就能直接拿走。`);
      }
      bits.push('\n\n落子之前养成一个习惯：先看对方的子能吃到我什么，再想我要干什么。');
      return bits.join('');
    }

    case 'game-summary': {
      const s = f.stats;
      if (!s) return '这一局还没有分析结果。';
      const bits: string[] = [];
      bits.push(`这一局你走了 ${s.total} 手，${s.won === undefined ? '' : s.won ? '赢了。' : '输了。'}`);
      if (s.blunders > 0) bits.push(`其中有 ${s.blunders} 手是漏着（丢子或被将死那种），${s.mistakes} 手明显失误。`);
      else if (s.mistakes > 0) bits.push(`没有大漏子，但有 ${s.mistakes} 手明显失误。`);
      else bits.push('全程没有明显失误，走得很稳。');
      bits.push(`平均每手亏 ${s.avgLoss} 分。`);
      if (f.problem) bits.push(`\n\n**最大的问题**：${f.problem}`);
      if (f.habits?.length) {
        const h = f.habits[0];
        bits.push(`\n\n**这不是第一次了**：你最近有 ${h.count} 次「${h.name}」。${h.advice}`);
      }
      return bits.join('');
    }

    case 'ask':
    default:
      return answerOffline(f);
  }
}

/**
 * 离线问答：认几个最常问的问题，其余给一个诚实的回复。
 *
 * 明确不做的事：**不瞎猜**。问到超出事实清单的问题（"我如果走马会怎样"
 * 需要重新搜索），就老实说需要什么，而不是编一段听起来很专业的废话。
 */
function answerOffline(f: Facts): string {
  const q = f.question ?? '';
  const has = (...keys: string[]) => keys.some((k) => q.includes(k));

  // 问"为什么输"的写法太多了（为什么我输了 / 这局怎么输的 / 输在哪 / 为啥败），
  // 一条条列关键词一定会漏。改成"提到输赢 + 带疑问词"就稳得多。
  const asksWhy = has('为什么', '为啥', '怎么', '咋', '哪');
  if (has('输', '败', '没赢') && asksWhy) {
    const bits: string[] = [];
    if (f.stats) {
      bits.push(
        f.stats.blunders > 0
          ? `直接原因是这一局有 ${f.stats.blunders} 手漏着。`
          : `你没有大漏子，是一点点被磨没的（平均每手亏 ${f.stats.avgLoss} 分）。`,
      );
    }
    if (f.problem) bits.push(f.problem);
    if (f.habits?.length) bits.push(`你最常犯的是「${f.habits[0].name}」，${f.habits[0].advice}`);
    return bits.join('\n\n') || '这一局还没有分析结果，先复盘一下。';
  }

  if (has('常犯', '经常', '老是', '总是', '毛病', '习惯', '每次都')) {
    if (!f.habits?.length) return '棋局还不够多，再下几盘我才说得准。';
    return (
      '从你最近的对局看：\n\n' +
      f.habits.map((h, i) => `${i + 1}. **${h.name}** —— 出现了 ${h.count} 次。${h.advice}`).join('\n')
    );
  }

  if (has('简单', '听不懂', '通俗', '初学')) {
    return f.problem
      ? `说得再直白一点：${f.problem}`
      : '你挑一步棋点进去，我用最直白的话讲那一手。';
  }

  if (has('如果', '要是', '假如')) {
    return '这个要重新算一遍才敢回答。你在棋盘上把那一手走出来，我算完再告诉你结果——凭印象说会说错。';
  }

  if (has('这一步', '这步', '为什么错', '哪里错')) {
    return f.problem ?? (f.best ? `这里引擎更想走 ${f.best}。` : '点开复盘里的某一手，我讲那一手。');
  }

  return '我可以讲：这一局你为什么输、某一手为什么错、你最近常犯什么毛病。点具体的一手问最准。';
}

// ───────────────────────── 远端讲解 ─────────────────────────

/**
 * 远端讲解：把事实清单 POST 给**你自己的后端**，由后端去调模型。
 *
 * 密钥永远不进前端。这里只认一个 URL（构建时的 VITE_COACH_API），
 * 前端发的是事实，收的是文本，一次也碰不到密钥。
 * 后端没配好、超时、返回不合法，全都静默退回离线模板——
 * 学棋不能因为网络问题就停摆。
 */
export function remoteProvider(endpoint: string, timeoutMs = 8000): CoachProvider {
  return {
    id: 'remote',
    label: 'AI 讲解',
    available: () => !!endpoint,
    async explain(f: Facts): Promise<string> {
      const fallback = offlineText(f);
      if (!endpoint) return fallback;
      try {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          // 只发事实，不发棋盘，也不发任何身份信息
          body: JSON.stringify({ facts: f }),
          signal: ctl.signal,
        });
        clearTimeout(timer);
        if (!res.ok) return fallback;
        const data = (await res.json()) as { text?: string };
        const text = (data.text ?? '').trim();
        if (!text) return fallback;
        // 最后一道闸：编出来的着法一律不放行
        const v = verifyExplanation(text, f);
        if (!v.ok) {
          console.warn('[象棋教练] 讲解里出现了棋局中不存在的着法，已退回离线文案：', v.bad);
          return fallback;
        }
        return text;
      } catch {
        return fallback;
      }
    },
  };
}

// ───────────────────────── 当前使用的讲解器 ─────────────────────────

let current: CoachProvider = mockProvider;

/** 启动时按环境变量决定用哪个讲解器。没配就用离线的 */
export function initCoachProvider(endpoint?: string) {
  current = endpoint ? remoteProvider(endpoint) : mockProvider;
}

export const coachProvider = (): CoachProvider => current;

/** 换讲解器，测试和设置界面用 */
export function setCoachProvider(p: CoachProvider) {
  current = p;
}

/** 讲一段。任何异常都退回离线模板，界面上永远有话可说 */
export async function explain(f: Facts): Promise<string> {
  try {
    return await current.explain(f);
  } catch {
    return offlineText(f);
  }
}
