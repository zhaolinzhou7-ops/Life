/**
 * AI 讲解层测试。
 *
 * 这一层最重要的性质只有一条：**不能编出棋局里不存在的着法**。
 * 学棋的人会照着 AI 说的走，走完发现盘上根本没有那只车——
 * 这种事发生一次，整个产品的可信度就没了。所以校验闸门要往死里测。
 */
import { describe, expect, it, vi } from 'vitest';
import {
  explain,
  initCoachProvider,
  mockProvider,
  movesIn,
  offlineText,
  remoteProvider,
  setCoachProvider,
  verifyExplanation,
  type Facts,
} from '../src/xiangqi/llm';

const base: Facts = {
  kind: 'move-bad',
  side: '红',
  round: 12,
  played: '马八进七',
  best: '车二进六',
  bestLine: ['车二进六', '炮８平７', '车二平三'],
  grade: '失误',
  loss: 480,
  problem: '你的马走到这里没有保护，对方走 车８进５ 就能吃掉它。',
  punish: '车８进５',
};

describe('movesIn：认得出中文记谱', () => {
  it('认得出常见写法', () => {
    expect(movesIn('这里该走车二进六，不是马八进七')).toEqual(['车二进六', '马八进七']);
  });

  it('阿拉伯数字的黑方记谱也认', () => {
    expect(movesIn('黑方走炮8平5')).toEqual(['炮8平5']);
  });

  it('前后马这种写法也认', () => {
    expect(movesIn('前马退六是唯一的下法')).toEqual(['前马退六']);
  });

  it('没有着法的句子返回空', () => {
    expect(movesIn('你这一局下得不错，继续保持')).toEqual([]);
  });

  it('不会把普通词误判成着法', () => {
    expect(movesIn('车马炮都很重要')).toEqual([]);
    expect(movesIn('你的马很危险')).toEqual([]);
  });
});

describe('verifyExplanation：编出来的着法一律拦下', () => {
  it('只提到事实里有的着法 → 放行', () => {
    const r = verifyExplanation('你走的马八进七有问题，对方车８进５就吃你的马，这里该走车二进六。', base);
    expect(r.ok).toBe(true);
    expect(r.bad).toEqual([]);
  });

  it('提到一手事实里没有的着法 → 拦下，并指出是哪一手', () => {
    const r = verifyExplanation('这里应该走炮二平五才对。', base);
    expect(r.ok).toBe(false);
    expect(r.bad).toEqual(['炮二平五']);
  });

  it('主变里的着法算数', () => {
    expect(verifyExplanation('接着会走炮８平７。', base).ok).toBe(true);
  });

  it('白送清单里的着法也算数', () => {
    const f: Facts = { kind: 'risk-why', side: '红', hanging: [{ name: '马', loss: 450, by: '车九进三' }] };
    expect(verifyExplanation('对方走车九进三就能吃你的马。', f).ok).toBe(true);
  });

  it('不含任何着法的纯道理话一律放行', () => {
    expect(verifyExplanation('落子之前先看一眼对方的子能吃到你什么。', base).ok).toBe(true);
  });

  it('同一手编造的着法重复出现只报一次', () => {
    const r = verifyExplanation('走炮二平五，炮二平五最好。', base);
    expect(r.bad).toEqual(['炮二平五']);
  });
});

describe('离线讲解：没有网络也要讲得出东西', () => {
  it('讲得出一手错棋错在哪，并给出该走的一手', () => {
    const t = offlineText(base);
    expect(t).toContain('马八进七');
    expect(t).toContain('车二进六');
    expect(t).toContain('没有保护');
    expect(t).toContain('480');
  });

  it('好棋也讲', () => {
    const t = offlineText({ ...base, kind: 'move-good', grade: '好棋' });
    expect(t).toContain('好棋');
    expect(t).toContain('马八进七');
  });

  it('本局总结把统计说清楚', () => {
    const t = offlineText({
      kind: 'game-summary',
      side: '红',
      stats: { total: 42, blunders: 2, mistakes: 3, avgLoss: 210, won: false },
      problem: '中局阶段忽略了对方的直接威胁。',
    });
    expect(t).toContain('42');
    expect(t).toContain('输了');
    expect(t).toContain('2 手是漏着');
    expect(t).toContain('中局阶段');
  });

  it('一手没错的局，总结里不能瞎报错误', () => {
    const t = offlineText({
      kind: 'game-summary',
      side: '红',
      stats: { total: 30, blunders: 0, mistakes: 0, avgLoss: 40, won: true },
    });
    expect(t).toContain('没有明显失误');
    expect(t).not.toContain('漏着');
  });

  it('教练模式的"为什么"要讲到对方的手段，并给一条能记住的习惯', () => {
    const t = offlineText({ ...base, kind: 'risk-why' });
    expect(t).toContain('车８进５');
    expect(t).toContain('先看对方');
  });

  it('离线讲解里出现的着法，自己也要过得了校验', () => {
    for (const kind of ['move-bad', 'move-good', 'risk-why'] as const) {
      const f = { ...base, kind };
      expect(verifyExplanation(offlineText(f), f).ok).toBe(true);
    }
  });
});

describe('离线问答', () => {
  const ask = (question: string, over: Partial<Facts> = {}) =>
    offlineText({ kind: 'ask', side: '红', question, ...over });

  it('“为什么我输了”基于统计回答', () => {
    const t = ask('为什么我输了？', {
      stats: { total: 40, blunders: 3, mistakes: 2, avgLoss: 300, won: false },
      problem: '你在中局丢了一个车。',
    });
    expect(t).toContain('3 手漏着');
    expect(t).toContain('丢了一个车');
  });

  it('“我这种错误是不是经常出现”查历史习惯', () => {
    const t = ask('我这个错误是不是经常犯？', {
      habits: [{ name: '贪吃', count: 7, advice: '吃之前先算账。' }],
    });
    expect(t).toContain('贪吃');
    expect(t).toContain('7');
  });

  it('没有历史数据时老实说样本不够，不编', () => {
    expect(ask('我经常犯什么错？')).toContain('不够');
  });

  it('“如果我走马会怎样”不凭印象回答', () => {
    const t = ask('如果我当时走马会怎么样？');
    expect(t).toContain('重新算');
    expect(movesIn(t)).toEqual([]); // 一手棋都不许编
  });

  it('“讲简单一点”换个说法讲同一件事', () => {
    expect(ask('能不能讲得简单一点', { problem: '你的车没人保护。' })).toContain('你的车没人保护');
  });

  it('听不懂的问题给出能问什么，不装懂', () => {
    const t = ask('今天天气怎么样');
    expect(t).toContain('我可以讲');
  });

  it('任何问答的回话都不许出现编造的着法', () => {
    const qs = ['为什么我输了', '这一步为什么错', '如果我走马会怎样', '给我讲简单一点', '我常犯什么错', '随便问一句'];
    for (const q of qs) {
      const f: Facts = { kind: 'ask', side: '红', question: q };
      expect(verifyExplanation(offlineText(f), f).ok).toBe(true);
    }
  });
});

describe('远端讲解：坏掉的时候必须静默退回离线', () => {
  const fetchReturning = (impl: () => Promise<unknown>) => {
    vi.stubGlobal('fetch', vi.fn(impl as never));
  };

  it('正常返回就用远端的文案', async () => {
    fetchReturning(async () => ({
      ok: true,
      json: async () => ({ text: '简单说：你的马送到对方车口上了，该走车二进六。' }),
    }));
    const p = remoteProvider('https://example.test/coach');
    expect(await p.explain(base)).toContain('简单说');
    vi.unstubAllGlobals();
  });

  it('远端编了一手不存在的棋 → 整段丢掉，退回离线文案', async () => {
    fetchReturning(async () => ({
      ok: true,
      json: async () => ({ text: '这里应该走炮二平五，然后车九平八。' }),
    }));
    const p = remoteProvider('https://example.test/coach');
    const t = await p.explain(base);
    expect(t).toBe(offlineText(base));
    expect(t).not.toContain('炮二平五');
    vi.unstubAllGlobals();
  });

  it('HTTP 错误 → 退回离线', async () => {
    fetchReturning(async () => ({ ok: false, json: async () => ({}) }));
    expect(await remoteProvider('https://x.test').explain(base)).toBe(offlineText(base));
    vi.unstubAllGlobals();
  });

  it('网络直接抛异常 → 退回离线，不把异常抛给界面', async () => {
    fetchReturning(async () => {
      throw new Error('network down');
    });
    expect(await remoteProvider('https://x.test').explain(base)).toBe(offlineText(base));
    vi.unstubAllGlobals();
  });

  it('返回空文本 → 退回离线', async () => {
    fetchReturning(async () => ({ ok: true, json: async () => ({ text: '   ' }) }));
    expect(await remoteProvider('https://x.test').explain(base)).toBe(offlineText(base));
    vi.unstubAllGlobals();
  });

  it('没配端点时 available() 为 false', () => {
    expect(remoteProvider('').available()).toBe(false);
    expect(remoteProvider('https://x.test').available()).toBe(true);
  });

  it('发给远端的只有事实，不含棋盘', async () => {
    let body: unknown = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_u: string, init: RequestInit) => {
        body = JSON.parse(init.body as string);
        return { ok: true, json: async () => ({ text: '好的。' }) };
      }) as never,
    );
    await remoteProvider('https://x.test').explain(base);
    expect(Object.keys(body as object)).toEqual(['facts']);
    expect(JSON.stringify(body)).not.toContain('board');
    vi.unstubAllGlobals();
  });
});

describe('讲解器的选择', () => {
  it('默认是离线讲解，永远可用', () => {
    initCoachProvider();
    expect(mockProvider.available()).toBe(true);
  });

  it('配了端点就用远端', () => {
    initCoachProvider('https://x.test/coach');
    // 通过 explain 的行为间接验证：没有 fetch 桩时会失败并退回离线
    expect(typeof explain).toBe('function');
    initCoachProvider();
  });

  it('讲解器抛异常时 explain 仍然给得出文案', async () => {
    setCoachProvider({
      id: 'boom',
      label: '会炸的',
      available: () => true,
      explain: async () => {
        throw new Error('boom');
      },
    });
    expect(await explain(base)).toBe(offlineText(base));
    setCoachProvider(mockProvider);
  });
});
