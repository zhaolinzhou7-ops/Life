/**
 * AI provider：本地引擎 与 远端模型
 *
 * 分工（和仓库里取名小程序保持同一套哲学）：
 *
 * | 环节            | 谁做      | 为什么 |
 * |-----------------|-----------|--------|
 * | 判断对错        | **只有本地** | 要可复现。今天说你错、明天说你对，产品就废了 |
 * | 任务有没有办成  | **只有本地** | 复盘里那句"你完成了入住"必须是真的 |
 * | 等级与分数      | **只有本地** | 模型最容易在这里编数字 |
 * | 间隔复习排期    | **只有本地** | 纯算法，没有模型的事 |
 * | NPC 说什么      | 模型（可选） | 模型演得像人，本地台词有点硬 |
 * | 解释写得贴不贴合 | 模型（可选） | 模型能照顾到这个用户的具体情况 |
 *
 * 远端挂了、超时了、返回垃圾了，一律**静默降级**回本地，并在界面上如实
 * 标注这一轮用的是本地引擎。用户永远不会因为模型出问题而看到空白页。
 */

import type { Correction, Scenario, ScenarioStage, UserProfile } from '../types';
import type { ErrorRecord } from '../types';
import { loadConfig, remoteAvailable } from './config';
import {
  buildDebriefMessages,
  buildExplainMessages,
  buildNpcMessages,
  cleanNpcLine,
  unwrap,
  type Messages,
  type NpcContext,
} from './prompt';

export type EngineTag = 'local' | 'remote';

export interface AiOutcome<T> {
  value: T;
  engine: EngineTag;
  /** 降级时说明原因，界面要如实显示 */
  note?: string;
}

/**
 * 调一次网关。
 *
 * 这里是整个产品唯一发出网络请求的地方，所以超时、非 200、空返回
 * 三种失败都在这一层处理干净，上面的代码只需要处理"成功"和"抛错"。
 */
export async function callGateway(msgs: Messages, signal?: AbortSignal): Promise<string> {
  const cfg = loadConfig();
  const avail = remoteAvailable(cfg);
  if (!avail.ok) throw new Error(avail.reason ?? '远端不可用');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), cfg.timeoutMs);
  const onAbort = () => ctl.abort();
  signal?.addEventListener('abort', onAbort);

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (cfg.token) headers.Authorization = `Bearer ${cfg.token}`;
    const resp = await fetch(cfg.endpoint, {
      method: 'POST',
      headers,
      signal: ctl.signal,
      body: JSON.stringify({ system: msgs.system, user: msgs.user, model: cfg.model || undefined }),
    });
    if (!resp.ok) throw new Error(`网关返回 ${resp.status}`);
    const data = (await resp.json()) as { text?: string; content?: string };
    const text = unwrap(data.text ?? data.content ?? '');
    if (!text) throw new Error('网关返回的内容是空的');
    return text;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

const failNote = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e);
  return `AI 网关这一轮没能用上（${msg}），下面的内容来自本地引擎。`;
};

// ═══════════════════ NPC 台词 ═══════════════════

/** 本地台词：直接用场景写好的那句。硬一点，但永远在角色里，永远不会挂 */
function localNpcLine(stage: ScenarioStage | undefined, advanced: boolean, attempts: number, fallback: string): string {
  if (!stage) return fallback;
  if (advanced) return stage.npc;
  if (!stage.nudge.length) return stage.npc;
  return stage.nudge[Math.min(attempts, stage.nudge.length - 1)];
}

export async function npcLine(
  ctx: NpcContext,
  profile: UserProfile,
  errors: ErrorRecord[],
  localFallback: string,
  signal?: AbortSignal,
): Promise<AiOutcome<string>> {
  const local = localNpcLine(ctx.stage, ctx.advanced, ctx.attempts, localFallback);
  if (!remoteAvailable().ok) return { value: local, engine: 'local' };
  try {
    const raw = await callGateway(buildNpcMessages(ctx, profile, errors), signal);
    // 模型跑出角色、或者返回空，cleanNpcLine 会退回本地台词
    return { value: cleanNpcLine(raw, local), engine: 'remote' };
  } catch (e) {
    return { value: local, engine: 'local', note: failNote(e) };
  }
}

// ═══════════════════ 纠错解释 ═══════════════════

/**
 * 本地解释就是规则库里写好的 why。
 *
 * 值得说明的是：本地解释**不比模型差**。规则库里的每一条 why 都是人写的、
 * 校对过的；模型的优势只在于能照顾到"你这是第四次犯了"这种个性化语气。
 * 所以降级回本地时，用户损失的是贴合度，不是正确性。
 */
export async function explainCorrection(
  c: Correction,
  profile: UserProfile,
  errors: ErrorRecord[],
  signal?: AbortSignal,
): Promise<AiOutcome<string>> {
  if (!remoteAvailable().ok) return { value: c.why, engine: 'local' };
  const repeat = errors.find((e) => e.ruleId === c.ruleId)?.count ?? 0;
  try {
    const raw = await callGateway(buildExplainMessages(c, profile, errors, repeat), signal);
    const text = raw.trim();
    // 太长说明模型开始讲语法课了，违反了"少讲多练"，宁可用本地的
    if (!text || text.length > 400) return { value: c.why, engine: 'local' };
    return { value: text, engine: 'remote' };
  } catch (e) {
    return { value: c.why, engine: 'local', note: failNote(e) };
  }
}

// ═══════════════════ 复盘总结 ═══════════════════

export async function debriefNarrative(
  scenario: Scenario,
  transcript: string,
  complete: boolean,
  issues: Correction[],
  profile: UserProfile,
  errors: ErrorRecord[],
  localFallback: string,
  signal?: AbortSignal,
): Promise<AiOutcome<string>> {
  if (!remoteAvailable().ok) return { value: localFallback, engine: 'local' };
  try {
    const raw = await callGateway(
      buildDebriefMessages(scenario, transcript, complete, issues, profile, errors),
      signal,
    );
    const text = raw.trim();
    if (!text || text.length > 500) return { value: localFallback, engine: 'local' };
    return { value: text, engine: 'remote' };
  } catch (e) {
    return { value: localFallback, engine: 'local', note: failNote(e) };
  }
}

/** 给界面用：现在到底在用哪个引擎 */
export function engineLabel(): { tag: EngineTag; text: string } {
  const a = remoteAvailable();
  return a.ok
    ? { tag: 'remote', text: '已接入 AI 网关' }
    : { tag: 'local', text: `本地引擎（${a.reason}）` };
}
