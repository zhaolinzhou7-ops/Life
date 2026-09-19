/**
 * AI 调度：选 provider，失败自动降级
 *
 * 界面层只调这里的五个函数，不直接碰 provider。这样「有没有接模型」
 * 对儿童端是完全透明的——网关挂了、超时了、返回了垃圾，孩子那边
 * 看到的依然是一个正常说话的 Coco，只是少了点个性化。
 *
 * 降级说明（fallbackNote）只会出现在家长端。儿童端永远不显示技术信息：
 * 一个四岁孩子不需要知道什么叫「网关返回 502」。
 */

import type { CoachReply, SpeechJudgement, Story } from '../types';
import { mockProvider } from './mock';
import { remoteProvider } from './remote';
import { loadConfig } from './config';
import type {
  AiOutcome,
  AssessmentReport,
  AssessmentRequest,
  ChatRequest,
  ContentRequest,
  CorrectionRequest,
  GeneratedItem,
  StoryRequest,
} from './types';

export { mockProvider } from './mock';
export { remoteProvider } from './remote';
export type { AiOutcome } from './types';

/** 最近一次降级的原因。家长端设置页会显示它，帮助排查网关配置 */
let lastFallback: string | undefined;

export function lastFallbackNote(): string | undefined {
  return lastFallback;
}

export function currentEngine(): 'mock' | 'remote' {
  return remoteProvider.available().ok ? 'remote' : 'mock';
}

/** 家长端设置页用：当前 AI 状态的一句话说明 */
export function engineStatus(): { engine: 'mock' | 'remote'; label: string; detail: string } {
  const cfg = loadConfig();
  const avail = remoteProvider.available();
  if (avail.ok) {
    return {
      engine: 'remote',
      label: '已接入远端模型',
      detail: `网关：${cfg.endpoint}${lastFallback ? `（最近一次调用失败已降级：${lastFallback}）` : ''}`,
    };
  }
  return {
    engine: 'mock',
    label: '使用内置引擎',
    detail: `${avail.reason ?? ''}。内置引擎完全离线，学习、游戏、故事、对话、报告都能正常使用。`,
  };
}

/**
 * 通用降级包装。
 *
 * 远端不可用时直接走内置；可用但调用失败时，记下原因再走内置。
 * 注意失败之后**不重试**：孩子正在等着 Coco 说话，等两次超时不如立刻给回应。
 */
async function withFallback<T>(
  remote: () => Promise<T>,
  local: () => Promise<T>,
): Promise<AiOutcome<T>> {
  if (!remoteProvider.available().ok) {
    return { data: await local(), engine: 'mock' };
  }
  try {
    const data = await remote();
    lastFallback = undefined;
    return { data, engine: 'remote' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    lastFallback = msg;
    return {
      data: await local(),
      engine: 'mock',
      fallbackNote: `调用 AI 网关失败（${msg}），这一轮用的是内置引擎。学习流程不受影响。`,
    };
  }
}

export function aiChat(req: ChatRequest): Promise<AiOutcome<CoachReply>> {
  return withFallback(() => remoteProvider.chat(req), () => mockProvider.chat(req));
}

export function aiCorrection(req: CorrectionRequest): Promise<AiOutcome<SpeechJudgement>> {
  return withFallback(() => remoteProvider.correction(req), () => mockProvider.correction(req));
}

export function aiStory(req: StoryRequest): Promise<AiOutcome<Story>> {
  return withFallback(() => remoteProvider.story(req), () => mockProvider.story(req));
}

export function aiContent(req: ContentRequest): Promise<AiOutcome<GeneratedItem[]>> {
  return withFallback(() => remoteProvider.content(req), () => mockProvider.content(req));
}

export function aiAssessment(req: AssessmentRequest): Promise<AiOutcome<AssessmentReport>> {
  return withFallback(() => remoteProvider.assessment(req), () => mockProvider.assessment(req));
}
