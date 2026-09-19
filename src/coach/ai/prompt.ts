/**
 * Prompt 构建与解析
 *
 * 两件事决定了这里的写法：
 *
 * 1. **每次调用都要带上学习状态。** 第 4 节的要求——不要每次都把用户当成
 *    一个新用户。所以 buildProfileBlock 会把等级、最近的错误、正在练的毛病
 *    一起塞进 system，模型才有可能说出"你上次也在这里栽过"。
 *
 * 2. **模型只做它擅长的事。** 判断对错、推进任务、算分数全在本地。
 *    模型负责把话说得像人、把解释写得贴合这个用户。所以这里要求模型
 *    返回的结构**刻意很小**：一句话回复、一段解释，没有任何分数字段。
 *    模型填不了的字段，它就编不了。
 */

import type { Correction, Scenario, ScenarioStage, UserProfile } from '../types';
import { SKILL_LABEL } from '../types';
import type { ErrorRecord } from '../types';

export interface Messages {
  system: string;
  user: string;
}

/** 教练的人设。第 21 节的行为规则直接写进 system，不是靠事后过滤 */
const COACH_RULES = `You are an English coach for an adult Chinese-speaking learner.

Hard rules:
- Keep replies SHORT. One or two sentences. Never lecture.
- Correct at most 1-3 things at a time, most important first.
- Never invent grammar rules or word meanings. If unsure, say you are not sure.
- Never shame the learner. Point at the sentence, not the person.
- Do not rewrite everything into formal written English. Natural spoken English is the target.
- Do not output scores, percentages, or levels. Those are computed elsewhere.
- Reply in English for the model sentence, but explanations may be in Chinese.`;

export function buildProfileBlock(profile: UserProfile, recentErrors: ErrorRecord[]): string {
  const levels = Object.entries(profile.levels)
    .map(([k, v]) => `${SKILL_LABEL[k as keyof typeof SKILL_LABEL] ?? k}=${v}`)
    .join(' ');
  const lines: string[] = [];
  if (levels) lines.push(`Learner levels: ${levels}`);
  if (profile.bottleneck) lines.push(`Main bottleneck: ${profile.bottleneck.title}`);
  if (recentErrors.length) {
    lines.push(
      `Recurring mistakes (do not re-explain from scratch, just point and move on): ` +
        recentErrors.map((e) => `${e.label} x${e.count}`).join('; '),
    );
  }
  return lines.length ? `\n\nLearner profile:\n${lines.join('\n')}` : '';
}

// ─────────────── 场景 NPC 台词 ───────────────

export interface NpcContext {
  scenario: Scenario;
  stage: ScenarioStage;
  /** 用户刚说的话 */
  userText: string;
  /** 本地判定：有没有推进 */
  advanced: boolean;
  /** 这一步已经试了几次 */
  attempts: number;
  history: { role: 'coach' | 'user'; text: string }[];
}

export function buildNpcMessages(ctx: NpcContext, profile: UserProfile, errors: ErrorRecord[]): Messages {
  const { scenario, stage, advanced } = ctx;
  const system = `You are role-playing as "${scenario.role}" in this situation: ${scenario.setting}
The learner is playing: ${scenario.userRole}.

STAY IN CHARACTER. Never break role to teach grammar — a receptionist does not give English lessons.
Reply with ONE short line of natural spoken English, the way this character would actually talk.

${advanced
      ? `The learner has just completed this step. Move the conversation to the next beat naturally. The next thing you need to say is roughly: "${stage.npc}" — say it in your own words, keep the same meaning.`
      : `The learner has NOT yet done what this step needs: "${stage.goal}". Stay in character and nudge them toward it without telling them the answer. This is attempt ${ctx.attempts + 1}.`}

Output ONLY the line of dialogue. No quotes, no name prefix, no explanation.${buildProfileBlock(profile, errors)}`;

  const history = ctx.history
    .slice(-6)
    .map((m) => `${m.role === 'coach' ? scenario.role : 'Learner'}: ${m.text}`)
    .join('\n');

  return { system, user: `${history}\nLearner: ${ctx.userText}\n\nYour line:` };
}

/** NPC 台词的清洗：模型很容易带上角色名、引号、或者顺手教一句语法 */
export function cleanNpcLine(raw: string, fallback: string): string {
  let t = (raw ?? '').trim();
  if (!t) return fallback;
  // 去掉代码块和引号
  t = t.replace(/^```[a-z]*\s*|\s*```$/g, '').trim();
  t = t.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  // 跑出角色的检查要在剥前缀**之前**做。
  // "Correction: use the present perfect here." 如果先剥前缀，
  // "Correction:" 会被当成角色名去掉，剩下的部分就检查不出来了——
  // 于是前台开始讲语法，而这正是角色扮演最致命的失败。
  // 冒号后面不能再写 \b：冒号和空格都是非单词字符，中间没有词边界，
  // 于是 /correction:\b/ 永远匹配不上
  const leaksRole = (s: string) =>
    /\b(grammar|you should say)\b/i.test(s) || /\b(correction|correct|tip|note|hint)\s*:/i.test(s);
  if (leaksRole(t)) return fallback;

  // 去掉 "Receptionist:" 这种前缀
  t = t.replace(/^[A-Z][A-Za-z ]{0,24}:\s*/, '').trim();
  // 只取第一段：模型偶尔会在台词后面附一段讲解，那会破坏角色扮演
  t = t.split(/\n{2,}/)[0].trim();
  const lines = t.split('\n').map((l) => l.trim()).filter(Boolean);
  t = lines.slice(0, 2).join(' ');
  if (leaksRole(t)) return fallback;
  if (t.length > 320) t = t.slice(0, 317) + '…';
  return t || fallback;
}

// ─────────────── 纠错解释 ───────────────

export function buildExplainMessages(
  c: Correction,
  profile: UserProfile,
  errors: ErrorRecord[],
  repeatCount: number,
): Messages {
  const system = `${COACH_RULES}

The local engine has already found this issue and decided the correction. Your job is ONLY to explain it
in a way that fits this specific learner. Do not change the correction. Do not add new issues.
Answer in Chinese, at most 2 short sentences, plus one extra natural example sentence in English.${buildProfileBlock(profile, errors)}`;

  const repeat = repeatCount > 1 ? `\nThis learner has made this same mistake ${repeatCount} times before — acknowledge that briefly instead of explaining from zero.` : '';

  return {
    system,
    user: `Learner wrote: "${c.sentence ?? c.original}"
Problem: ${c.problem}
Correction: "${c.original}" → "${c.fixed}"${repeat}

Explain:`,
  };
}

// ─────────────── 复盘总结 ───────────────

export function buildDebriefMessages(
  scenario: Scenario,
  transcript: string,
  complete: boolean,
  issues: Correction[],
  profile: UserProfile,
  errors: ErrorRecord[],
): Messages {
  const system = `${COACH_RULES}

You are writing a short debrief after a role-play. Write in Chinese, 2-3 sentences, warm but direct.
Say what the learner did well and what to work on next. Do NOT list grammar rules — those are shown separately.
Do NOT state whether the task was completed; that is given to you as a fact below.${buildProfileBlock(profile, errors)}`;

  return {
    system,
    user: `Scenario: ${scenario.titleEn} — ${scenario.mission}
Task completed: ${complete ? 'yes' : 'no'}
Issues found by the local engine: ${issues.map((i) => i.problem).join('; ') || 'none'}

What the learner said:
${transcript}

Debrief:`,
  };
}

// ─────────────── 通用解析 ───────────────

/** 网关可能把内容包在 markdown 代码块里，这里一并剥掉 */
export function unwrap(text: string): string {
  const t = (text ?? '').trim();
  const fence = t.match(/^```(?:json|text)?\s*([\s\S]*?)\s*```$/);
  return (fence ? fence[1] : t).trim();
}
