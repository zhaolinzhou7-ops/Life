/**
 * 远端模型 provider
 *
 * 接真实模型之后多出来的东西，只有两样：**话说得更自然**，
 * 以及**能按这个孩子的薄弱点现编故事**。教学决策一样不交给它。
 *
 * 所以这里的每个方法都是同一个套路：
 *   1. 本地引擎先把结论算出来（对不对、下一步问什么、目标词是哪几个）
 *   2. 把结论当事实写进 prompt，让模型只负责措辞
 *   3. 模型返回后**必须**过两道关：安全规则 + 结构校验
 *   4. 任何一步出问题，立刻降级回内置引擎，孩子那边看不出差别
 *
 * 第 3 步不能省。模型再好也会有失手的时候，而这里的用户是四岁小孩。
 */

import type { CoachReply, SpeechJudgement, Story } from '../types';
import { getNode, firstNode } from '../data/dialog';
import { normalize, wordSimilar } from '../engine/speech';
import { checkOutbound, scrubChildInput } from './safety';
import { loadConfig } from './config';
import { mockProvider } from './mock';
import {
  buildChatPrompt,
  buildReportPrompt,
  buildStoryPrompt,
  extractJson,
  factsFor,
  validateStory,
  type ParsedStory,
} from './prompt';
import type {
  AiProvider,
  AssessmentReport,
  AssessmentRequest,
  ChatRequest,
  ContentRequest,
  CorrectionRequest,
  GeneratedItem,
  StoryRequest,
} from './types';

/** 调一次网关。超时、非 200、空返回都当失败抛出，由调用方决定怎么降级 */
async function callGateway(system: string, user: string, signal?: AbortSignal): Promise<string> {
  const cfg = loadConfig();
  if (!cfg.endpoint) throw new Error('还没有填写 AI 网关地址');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  signal?.addEventListener('abort', () => ctl.abort());

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      signal: ctl.signal,
      body: JSON.stringify({ system, user, model: cfg.model || undefined }),
    });
    if (!resp.ok) throw new Error(`网关返回 ${resp.status}`);
    const data = (await resp.json()) as { text?: string; content?: string };
    const text = data.text ?? data.content ?? '';
    if (!text) throw new Error('网关返回的内容是空的');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

/** 和 mock 里同一套判定，保证接不接模型，「答得对不对」的结论一致 */
function matches(said: string, expect: string[], open: boolean): boolean {
  const s = normalize(said);
  if (!s) return false;
  if (open) return s.split(' ').filter(Boolean).length >= 1;
  if (!expect.length) return true;
  const words = s.split(' ').filter(Boolean);
  return expect.some((e) => {
    const en = normalize(e);
    if (s.includes(en)) return true;
    return en.split(' ').length === 1 && words.some((w) => wordSimilar(w, en) >= 0.72);
  });
}

export const remoteProvider: AiProvider = {
  id: 'remote',
  name: '远端模型',

  available() {
    const c = loadConfig();
    if (c.mode !== 'remote') return { ok: false, reason: '当前使用内置引擎' };
    if (!c.endpoint) return { ok: false, reason: '还没有填写 AI 网关地址' };
    return { ok: true };
  },

  async chat(req: ChatRequest): Promise<CoachReply> {
    const lastCoach = [...req.history].reverse().find((t) => t.role === 'coach');
    const node = getNode(lastCoach?.nodeId ?? '') ?? firstNode(req.level);

    // 开场不走模型：第一句话固定，孩子每次进来听到的都一样，有安全感
    if (!lastCoach) return mockProvider.chat(req);

    // 安全第一道：孩子说的敏感信息，在进 prompt 之前就抹掉
    const scrub = scrubChildInput(req.childSaid);
    if (scrub.found) return mockProvider.chat(req);

    const correct = matches(scrub.text, node.expect, !!node.open);
    const next = correct ? getNode(node.next ?? '') : node;

    const { system, user } = buildChatPrompt(
      { ...req, childSaid: scrub.text },
      {
        question: node.ask,
        childCorrect: correct,
        hint: node.hint,
        nextQuestion: correct ? next?.ask : node.ask,
      },
    );

    const text = await callGateway(system, user);
    const parsed = extractJson<{ say?: string; emoji?: string }>(text);
    const say = (parsed?.say ?? '').trim();
    if (!say) throw new Error('模型没有返回可用的回复');

    // 安全第二道：模型说的话，念给孩子之前再过一遍规则
    const verdict = checkOutbound(say);
    const finalSay = verdict.ok ? say : (verdict.replacement ?? node.ask);

    const target = correct ? next : node;
    return {
      say: finalSay,
      emoji: parsed?.emoji ?? target?.emoji ?? '🦜',
      expect: target?.expect,
      hint: target?.hint,
      nodeId: target?.id,
      end: correct && !next,
      judged: correct ? (req.hintCount > 0 ? 'close' : 'right') : 'wrong',
      wordIds: node.wordIds,
      safetyNote: verdict.note,
    };
  },

  /**
   * 纠错不走模型。
   *
   * 相似度判定是确定性的，模型做不会更准，只会更慢、更贵、更不稳定。
   * 模型该做的是「怎么说这句反馈」，而反馈句式已经在 phrases.ts 里定好了，
   * 儿童纠错的措辞本来就不该每次都不一样。
   */
  async correction(req: CorrectionRequest): Promise<SpeechJudgement> {
    return mockProvider.correction(req);
  },

  async story(req: StoryRequest): Promise<Story> {
    const { system, user } = buildStoryPrompt(req);
    const text = await callGateway(system, user);
    const parsed = extractJson<ParsedStory>(text);
    const check = validateStory(parsed, req);
    if (!check.ok) throw new Error(check.reason);

    const s = check.story;
    // 每一页都要过安全规则。一页不合格就整个丢掉，不做局部修补
    for (const p of s.pages) {
      if (!checkOutbound(p.text ?? '').ok) throw new Error('模型生成的故事里有不适合的内容');
    }

    return {
      id: `st-ai-${req.seed}`,
      title: s.title || 'A Little Story',
      level: req.level,
      theme: (req.words[0]?.theme ?? 'toy') as Story['theme'],
      coverEmoji: req.words[0]?.emoji ?? '📖',
      words: req.words.map((w) => w.id),
      pages: s.pages.slice(0, 12).map((p) => ({
        text: p.text,
        emoji: p.emoji || '🙂',
        highlight: p.highlight || undefined,
      })),
      questions: (s.questions ?? [])
        .filter((q) => q.ask && Array.isArray(q.options) && q.options.some((o) => o.correct))
        .slice(0, 3)
        .map((q) => ({
          kind: 'choice' as const,
          ask: q.ask,
          askZh: q.askZh ?? '',
          options: (q.options ?? []).slice(0, 3).map((o) => ({
            label: o.label,
            emoji: o.emoji || '❓',
            correct: !!o.correct,
          })),
        })),
      learningOutcome: `能在故事里听懂并复述：${req.words.map((w) => w.en).join(', ')}`,
    };
  },

  /** 练习题必须从本地词库出，模型编不出图片和干扰项，交给它没有收益 */
  async content(req: ContentRequest): Promise<GeneratedItem[]> {
    return mockProvider.content(req);
  },

  async assessment(req: AssessmentRequest): Promise<AssessmentReport> {
    // 先拿本地结论当底稿和兜底，模型只负责把它写得更好读
    const base = await mockProvider.assessment(req);
    const facts = [
      ...factsFor(req.profile),
      `本周学习 ${req.sessionsThisWeek} 次，共 ${req.minutesThisWeek} 分钟`,
      base.vocabulary,
      base.listening,
      base.speaking,
      ...req.weaknesses.slice(0, 3).map((w) => `${w.title}（依据：${w.evidence}）`),
    ];
    const { system, user } = buildReportPrompt(req, facts);
    const text = await callGateway(system, user);
    const parsed = extractJson<Partial<AssessmentReport>>(text);
    if (!parsed?.headline) throw new Error('模型没有返回可用的报告');
    return {
      headline: parsed.headline ?? base.headline,
      vocabulary: parsed.vocabulary ?? base.vocabulary,
      listening: parsed.listening ?? base.listening,
      speaking: parsed.speaking ?? base.speaking,
      advice: Array.isArray(parsed.advice) && parsed.advice.length ? parsed.advice.slice(0, 3) : base.advice,
    };
  },
};
