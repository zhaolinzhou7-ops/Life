/**
 * 教学层（Teaching Layer）。
 *
 * 流程：结构化指标 → 提示词 → AI Provider → 校验 → 反馈。
 * 校验这一步是产品需求里「避免 AI 废话」的执行点：
 * AI 给出的东西如果不满足「具体问题 + 具体练习 + 可验证目标」，
 * 就直接丢掉，回退到规则引擎。宁可朴素，不要空话。
 */

import type { PerformanceReport } from '../analysis/types';
import type { SessionSummary } from '../data/types';
import { EXERCISE_BY_ID } from '../training/exercises';
import { buildPayload, systemPrompt } from './payload';
import { ruleFeedback, type CoachFeedback, type Drill } from './rules';
import {
  explainError,
  type AIProvider,
  type ProviderConfig,
} from './provider';
import { createOpenAIProvider } from './providers/openai';
import { createAnthropicProvider } from './providers/anthropic';

export type { CoachFeedback, Drill } from './rules';

/** 明令禁止的空话。命中任何一条就判定这次输出不合格 */
const BANNED = [
  '很有潜力',
  '非常不错',
  '继续努力',
  '再接再厉',
  '加油',
  '感情很丰富',
  '情绪很到位',
  '很有感情',
  '未来可期',
  '相信自己',
  '天赋',
  '整体还可以',
  '总体不错',
  '表现很棒',
  '唱得很好听',
];

export function createProvider(cfg: ProviderConfig): AIProvider | null {
  if (cfg.kind === 'mock') return null;
  if (cfg.kind === 'anthropic') return createAnthropicProvider(cfg);
  return createOpenAIProvider(cfg);
}

/** 从可能带 Markdown 围栏的文本里抠出 JSON */
function extractJson(text: string): unknown {
  const t = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(t);
  const body = fenced ? fenced[1] : t;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('返回内容里找不到 JSON');
  return JSON.parse(body.slice(start, end + 1));
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
  feedback?: CoachFeedback;
}

/**
 * 校验 AI 的输出。
 *
 * 这里刻意严格：每一条规则都对应产品需求里的一句话。
 * 校验不通过不是灾难——回退到规则引擎，用户照样拿到一份能用的反馈。
 */
export function validateFeedback(raw: unknown, sourceLabel: string): ValidationResult {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: '返回的不是一个对象' };
  const o = raw as Record<string, unknown>;

  const str = (k: string) => (typeof o[k] === 'string' ? (o[k] as string).trim() : '');
  const good = str('good');
  const problem = str('problem');
  const why = str('why');
  const goal = str('goal');

  if (!good || !problem || !why || !goal) {
    return { ok: false, reason: '五段式反馈缺少字段' };
  }

  const all = [good, problem, why, goal].join('\n');
  const hit = BANNED.find((b) => all.includes(b));
  if (hit) return { ok: false, reason: `输出里出现了没有信息量的套话「${hit}」` };

  // 「一个具体问题」——必须落到数字上
  if (!/\d/.test(problem)) return { ok: false, reason: '问题描述里没有任何具体数字' };
  // 「一个可验证目标」——同理
  if (!/\d/.test(goal)) return { ok: false, reason: '下次目标不可验证（没有具体数值）' };

  // 「一个具体练习」——必须指向真实存在的练习
  const drills: Drill[] = [];
  const rawDrills = Array.isArray(o.drills) ? o.drills : [];
  for (const d of rawDrills) {
    if (typeof d !== 'object' || d === null) continue;
    const dd = d as Record<string, unknown>;
    const id = typeof dd.exerciseId === 'string' ? dd.exerciseId : '';
    const ex = EXERCISE_BY_ID.get(id);
    if (!ex) continue; // 模型编了个不存在的练习，丢掉
    const mins = typeof dd.minutes === 'number' && dd.minutes > 0 && dd.minutes <= 20
      ? Math.round(dd.minutes)
      : ex.minutes;
    const reason = typeof dd.reason === 'string' && dd.reason.trim() ? dd.reason.trim() : ex.goal;
    if (BANNED.some((b) => reason.includes(b))) continue;
    drills.push({ exerciseId: ex.id, name: ex.name, minutes: mins, reason });
    if (drills.length >= 4) break;
  }
  if (!drills.length) return { ok: false, reason: '没有给出任何有效的练习（练习 ID 不存在或为空）' };

  return {
    ok: true,
    feedback: { good, problem, why, drills, goal, source: sourceLabel },
  };
}

/**
 * 拿到这次演唱的教学反馈。
 * 无论走哪条路，都保证返回一份完整的五段式反馈——不会抛错给界面。
 */
export async function getCoachFeedback(
  report: PerformanceReport,
  history: SessionSummary[],
  cfg: ProviderConfig,
  signal?: AbortSignal,
): Promise<CoachFeedback> {
  const provider = createProvider(cfg);
  if (!provider) return ruleFeedback(report);

  try {
    const payload = buildPayload(report, history);
    const text = await provider.complete(
      {
        system: systemPrompt(),
        user: '这是刚才那次演唱的分析数据：\n\n' + JSON.stringify(payload, null, 1),
        maxTokens: 1400,
      },
      signal,
    );
    const parsed = extractJson(text);
    const v = validateFeedback(parsed, `${provider.label}`);
    if (v.ok && v.feedback) return v.feedback;
    return ruleFeedback(report, `AI 的回答没通过校验（${v.reason}），已改用内置教练。`);
  } catch (e) {
    return ruleFeedback(report, `调用 AI 失败：${explainError(e)}已改用内置教练。`);
  }
}
