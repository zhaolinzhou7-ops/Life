/**
 * AI 教练对话测试。
 *
 * 规格里的约束是"必须基于当前棋局和用户历史数据回答，不能脱离棋局随意发挥"。
 * 这里测的就是这一条：事实清单组装对不对，以及回话有没有越界。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import { QUICK_ASKS, factsFor, quickAsks, type ChatContext } from '../src/xiangqi/chat';
import { offlineText, verifyExplanation } from '../src/xiangqi/llm';
import { archiveGame, clearArchive } from '../src/xiangqi/archive';
import { initialBoard } from '../src/xiangqi/rules';
import { toFen } from '../src/xiangqi/notation';

const ctx: ChatContext = {
  side: '红',
  stats: { total: 40, blunders: 2, mistakes: 3, avgLoss: 240, won: false },
  problem: '你在中局丢了一个车。',
  focus: {
    round: 14,
    played: '马八进七',
    best: '车二进六',
    bestLine: ['车二进六', '炮８平７'],
    problem: '你的马走到这里没有保护。',
    loss: 460,
  },
};

beforeEach(() => {
  memStore.clear();
  clearArchive();
});

describe('事实清单的组装', () => {
  it('永远带上这一局的统计和结论', () => {
    const f = factsFor(ctx, '为什么我输了？');
    expect(f.kind).toBe('ask');
    expect(f.side).toBe('红');
    expect(f.stats!.blunders).toBe(2);
    expect(f.problem).toBe('你在中局丢了一个车。');
  });

  it('问"这一步"时把选中那一手的细节放进去', () => {
    const f = factsFor(ctx, '这一步为什么错？');
    expect(f.round).toBe(14);
    expect(f.played).toBe('马八进七');
    expect(f.best).toBe('车二进六');
    expect(f.problem).toBe('你的马走到这里没有保护。');
  });

  it('问别的问题时不夹带那一手，免得答非所问', () => {
    const f = factsFor(ctx, '我最近常犯什么错？');
    expect(f.played).toBeUndefined();
    expect(f.round).toBeUndefined();
  });

  it('样本不够时不给 habits——宁可不说，也不瞎归纳', () => {
    expect(factsFor(ctx, '我常犯什么错？').habits).toBeUndefined();
  });

  it('样本够了才把长期习惯带进来', () => {
    for (let i = 0; i < 4; i++) {
      archiveGame({
        fen: toFen(initialBoard(), 'r'),
        moves: '',
        side: 'r',
        result: 'loss',
        level: '初级',
        review: { blunders: 1, mistakes: 1, avgLoss: 200, tags: { greedy: 4 } },
      });
    }
    const f = factsFor(ctx, '我是不是经常犯这个错？');
    expect(f.habits).toBeTruthy();
    expect(f.habits![0].name).toBe('贪吃');
  });
});

describe('回答必须站得住', () => {
  it('四个预置问题都答得出东西，而且都不编着法', () => {
    expect(QUICK_ASKS.length).toBe(4);
    for (const q of QUICK_ASKS) {
      const f = factsFor(ctx, q);
      const text = offlineText(f);
      expect(text.length).toBeGreaterThan(10);
      expect(verifyExplanation(text, f).ok).toBe(true);
    }
  });

  it('“为什么我输了”答的是这一局的真实数据', () => {
    const t = offlineText(factsFor(ctx, '为什么我输了？'));
    expect(t).toContain('2 手漏着');
    expect(t).toContain('丢了一个车');
  });

  it('“这一步为什么错”答的是选中的那一手', () => {
    const t = offlineText(factsFor(ctx, '这一步为什么错？'));
    expect(t).toContain('没有保护');
  });

  it('“如果我走马会怎样”不凭印象编变化', () => {
    const f = factsFor(ctx, '如果我当时走炮会怎么样？');
    const t = offlineText(f);
    expect(t).toContain('重新算');
    expect(verifyExplanation(t, f).ok).toBe(true);
  });

  it('没有任何上下文时也不会崩，而且不会编内容', () => {
    const f = factsFor({ side: '黑' }, '为什么我输了？');
    const t = offlineText(f);
    expect(t.length).toBeGreaterThan(0);
    expect(verifyExplanation(t, f).ok).toBe(true);
  });
});

describe('教练要看得见这一局的结果——赢了的人不能被问"为什么我输了"', () => {
  it('赢了的时候第一个问题问的是赢在哪', () => {
    expect(quickAsks({ side: '红', stats: { total: 30, blunders: 0, mistakes: 0, avgLoss: 20, won: true } })[0]).toContain('赢');
  });

  it('输了的时候才问为什么输', () => {
    expect(quickAsks({ side: '红', stats: { total: 30, blunders: 2, mistakes: 1, avgLoss: 300, won: false } })[0]).toContain('输');
  });

  it('不知道结果时问个中性的', () => {
    const q = quickAsks({ side: '红' })[0];
    expect(q).not.toContain('输');
    expect(q).not.toContain('赢');
  });

  it('赢了却问"为什么我输了"，教练先把事实摆正而不是顺着答', () => {
    const t = offlineText({
      kind: 'ask',
      side: '红',
      question: '为什么我输了？',
      stats: { total: 30, blunders: 0, mistakes: 0, avgLoss: 20, won: true },
    });
    expect(t).toContain('这一局你是赢的');
  });

  it('真输了就正常分析，不会莫名其妙来一句"你是赢的"', () => {
    const t = offlineText({
      kind: 'ask',
      side: '红',
      question: '为什么我输了？',
      stats: { total: 30, blunders: 3, mistakes: 1, avgLoss: 320, won: false },
    });
    expect(t).not.toContain('你是赢的');
    expect(t).toContain('3 手漏着');
  });
});
