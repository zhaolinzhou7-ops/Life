/**
 * 场景对话运行时
 *
 * 一条硬规矩：**是否推进由 stage.advance 决定，不由模型决定。**
 *
 * 接了远端模型之后，NPC 说什么可以交给模型（它演得更像人），但"用户到底
 * 有没有办成事"必须本地算。原因很实际——复盘页会告诉用户"你完成了入住"，
 * 如果这句话的依据是模型的自由发挥，那它就是不可复现的，今天说完成了、
 * 明天同样的对话说没完成，用户会立刻不信任整个产品。
 *
 * 另一条来自第 7 节：用户只说 "Hello." 的时候，前台要继续当前台。
 * 所以没推进时走 nudge，NPC 留在角色里，绝不跳出来讲语法。
 */

import type { Conversation, ConversationMessage, Scenario, ScenarioStage } from '../types';
import { analyze } from './analyze';
import { newId } from '../store';

export interface TurnResult {
  conversation: Conversation;
  /** NPC 这一轮说的话 */
  reply: string;
  /** 用户这句话有没有把事情往前推 */
  advanced: boolean;
  /** 任务是不是办成了 */
  complete: boolean;
  /** 当前阶段（推进之后的） */
  stage?: ScenarioStage;
}

export function startConversation(scenario: Scenario, userId: string, engine: 'local' | 'remote' = 'local'): Conversation {
  const first = scenario.stages[0];
  return {
    id: newId('conv'),
    userId,
    scenarioId: scenario.id,
    startedAt: Date.now(),
    messages: [
      {
        id: newId('m'),
        role: 'coach',
        text: first.npc,
        at: Date.now(),
        stageId: first.id,
      },
    ],
    clearedStages: [],
    missionComplete: false,
    engine,
  };
}

/** 当前停在哪个阶段 */
export function currentStage(conv: Conversation, scenario: Scenario): ScenarioStage | undefined {
  return scenario.stages[conv.clearedStages.length];
}

/** 没推进时换一句 nudge。按已经试过几次轮换，不要每次都重复同一句 */
function nudgeFor(stage: ScenarioStage, attempts: number): string {
  if (!stage.nudge.length) return stage.npc;
  return stage.nudge[Math.min(attempts, stage.nudge.length - 1)];
}

/**
 * 用户说了一句话。
 *
 * @param hintLevel 用了第几级提示（0 表示没用）。这个数要记下来——
 *   "在第四级提示下说对的"和"自己说对的"是两件不同的事，复盘时必须分开算。
 */
export function submitTurn(
  conv: Conversation,
  scenario: Scenario,
  text: string,
  opts: { via?: 'typed' | 'spoken'; hintLevel?: number; now?: number } = {},
): TurnResult {
  const now = opts.now ?? Date.now();
  const stage = currentStage(conv, scenario);
  const trimmed = text.trim();

  // 从上一条 NPC 消息到现在，就是用户的反应时间。真实计时，不是估的
  const lastCoach = [...conv.messages].reverse().find((m) => m.role === 'coach');
  const responseMs = lastCoach ? Math.max(0, now - lastCoach.at) : undefined;

  const a = analyze(trimmed);
  const userMsg: ConversationMessage = {
    id: newId('m'),
    role: 'user',
    text: trimmed,
    at: now,
    via: opts.via ?? 'typed',
    corrections: a.corrections,
    hintLevel: opts.hintLevel ?? 0,
    responseMs,
    stageId: stage?.id,
  };

  const messages = [...conv.messages, userMsg];

  if (!stage) {
    // 任务已经办完了还在说话：NPC 客气地收尾，不报错
    const reply = 'Great — all set. Anything else I can help you with?';
    messages.push({ id: newId('m'), role: 'coach', text: reply, at: now + 1 });
    return { conversation: { ...conv, messages }, reply, advanced: false, complete: true };
  }

  const advanced = stage.advance(trimmed);

  if (!advanced) {
    // 这一阶段试了几次了
    const attempts = conv.messages.filter((m) => m.role === 'user' && m.stageId === stage.id).length;
    const reply = nudgeFor(stage, attempts);
    messages.push({ id: newId('m'), role: 'coach', text: reply, at: now + 1, stageId: stage.id });
    return { conversation: { ...conv, messages }, reply, advanced: false, complete: false, stage };
  }

  const clearedStages = [...conv.clearedStages, stage.id];
  const next = scenario.stages[clearedStages.length];
  const complete = !next;
  const reply = next
    ? next.npc
    : `Perfect, you're all set. ${scenario.stages[scenario.stages.length - 1].id === stage.id ? 'Thanks!' : ''}`.trim();

  messages.push({ id: newId('m'), role: 'coach', text: reply, at: now + 1, stageId: next?.id });

  return {
    conversation: {
      ...conv,
      messages,
      clearedStages,
      missionComplete: complete,
      endedAt: complete ? now : undefined,
    },
    reply,
    advanced: true,
    complete,
    stage: next,
  };
}

/** 进度：完成了几步 / 一共几步 */
export function progress(conv: Conversation, scenario: Scenario): { done: number; total: number } {
  return { done: conv.clearedStages.length, total: scenario.stages.length };
}
