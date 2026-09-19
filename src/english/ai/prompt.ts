/**
 * Prompt 构造与解析
 *
 * 一个贯穿全部 prompt 的原则：**模型负责措辞，不负责教学决策。**
 *
 * 具体说就是——「现在该问什么词」「孩子答得对不对」「下一步做什么」
 * 全部由本地引擎算好，写进 prompt 当事实交给模型；模型只做一件事：
 * 把这句话说得像一个有耐心的老师，而不是一个念稿的机器。
 *
 * 这样设计的三个理由：
 *  1. 模型跑偏、超时、返回垃圾时，降级回本地不会让教学逻辑断掉
 *  2. 模型不可能"编出"一个词库里没有的词去考孩子
 *  3. 换模型不影响产品行为，prompt 和引擎各自独立演进
 *
 * 安全约束同时写在 prompt 里和代码里（safety.ts）。写在 prompt 里是让模型
 * 别去踩；写在代码里是因为**不能假设模型一定听话**。
 */

import type { ChildProfile } from '../types';
import type { AssessmentRequest, ChatRequest, StoryRequest } from './types';

/** 所有 prompt 共用的安全与语气约束 */
const GUARD = `You are Coco, a friendly parrot who helps young children (ages 4-12) learn English.

HARD RULES — never break these:
- Never ask for or mention: home address, phone number, school name or location, full name, ID, photos, or any personal data.
- Never suggest meeting in person, keeping secrets from parents, or contacting anyone.
- Never mention buying, paying, subscribing, or upgrading anything.
- Never discuss violence, death, weapons, drugs, alcohol, romance, or anything scary.
- Never say a child is wrong, bad, stupid, or will fail. Never use fear to motivate.
- If the child mentions personal information, do not repeat it and do not ask follow-up questions. Change the subject to the lesson.

STYLE:
- Speak in very short, simple English sentences. One idea per sentence.
- Warm, encouraging, patient. Celebrate effort, not just correctness.
- When the child is wrong, say "Almost!" or "Good try!" then give a small hint. Never reveal the answer on the first try.
- Never use percentages, scores, or technical terms with the child.`;

// ———————————————— 对话 ————————————————

export interface ChatPrompt {
  system: string;
  user: string;
}

/**
 * 对话 prompt。
 *
 * 注意 user 里给的是**已经算好的结论**：孩子答对了没有、下一个问题是什么。
 * 模型只需要把这些串成一句自然的话。
 */
export function buildChatPrompt(
  req: ChatRequest,
  ctx: { question: string; childCorrect: boolean; hint: string; nextQuestion?: string },
): ChatPrompt {
  const levelDesc =
    req.level === 1
      ? 'The child answers with single words. Keep every sentence under 6 words.'
      : req.level === 2
        ? 'The child answers with short phrases. Keep sentences under 9 words.'
        : 'The child can answer with full sentences. Keep sentences under 14 words.';

  const lines = [
    `Child nickname: ${req.profile.name}. Age: ${req.profile.age}. Level: ${req.profile.level}.`,
    levelDesc,
    ``,
    `You just asked: "${ctx.question}"`,
    `The child said: "${req.childSaid || '(said nothing)'}"`,
    `Our system already judged this answer as: ${ctx.childCorrect ? 'CORRECT' : 'NOT CORRECT'}.`,
    ctx.nextQuestion
      ? `Your reply must react to the answer in one short sentence, then ask exactly this next question, in these words or very close: "${ctx.nextQuestion}"`
      : `Your reply must praise the child briefly and end the chat warmly. Do not ask a new question.`,
    !ctx.childCorrect ? `Do NOT give away the answer. You may use this hint: "${ctx.hint}"` : '',
    ``,
    `Reply with JSON only: {"say": "...", "emoji": "one emoji"}`,
  ];

  return { system: GUARD, user: lines.filter(Boolean).join('\n') };
}

// ———————————————— 故事 ————————————————

const LEVEL_LIMIT: Record<1 | 2 | 3 | 4, number> = { 1: 4, 2: 6, 3: 9, 4: 12 };

export function buildStoryPrompt(req: StoryRequest): ChatPrompt {
  const words = req.words.map((w) => `${w.en} (${w.emoji})`).join(', ');
  const limit = LEVEL_LIMIT[req.level];
  const user = [
    `Write a very short picture story for a child learning English.`,
    ``,
    `Target words that MUST appear at least 3 times each: ${words}`,
    `Maximum ${limit} words per sentence. Use only simple, common words.`,
    `Exactly 8 to 10 pages. One sentence per page.`,
    `The story needs a real little plot: something appears, something changes, it is resolved happily.`,
    `Use only the target words plus very common words a beginner knows.`,
    ``,
    `Reply with JSON only:`,
    `{"title":"...","pages":[{"text":"...","emoji":"one emoji","highlight":"target word or empty"}],`,
    ` "questions":[{"ask":"...","askZh":"中文","options":[{"label":"...","emoji":"...","correct":true}]}]}`,
    `Give 2 or 3 questions. Every question's answer must be findable in the story.`,
  ].join('\n');
  return { system: GUARD, user };
}

export interface ParsedStory {
  title: string;
  pages: { text: string; emoji: string; highlight?: string }[];
  questions: {
    ask: string;
    askZh?: string;
    options?: { label: string; emoji: string; correct: boolean }[];
  }[];
}

// ———————————————— 家长报告 ————————————————

export function buildReportPrompt(req: AssessmentRequest, facts: string[]): ChatPrompt {
  const system = `You write weekly English-learning reports for the PARENT of a young child.
Write in Simplified Chinese. Be concrete and plain. No marketing language, no emoji, no scores or percentages.
Every claim must be supported by the facts given. Do not invent numbers.
Advice must be something the parent can actually do tomorrow, not "please accompany more".`;
  const user = [
    `孩子：${req.profile.name}，${req.profile.age} 岁，当前阶段 ${req.profile.level}。`,
    ``,
    `事实（只能用这些，不要编）：`,
    ...facts.map((f) => `- ${f}`),
    ``,
    `请输出 JSON：`,
    `{"headline":"一句话总结","vocabulary":"词汇一段","listening":"听力一段","speaking":"口语一段","advice":["建议1","建议2"]}`,
    `每段不超过两句话。`,
  ].join('\n');
  return { system, user };
}

// ———————————————— 解析 ————————————————

/**
 * 从模型返回里抠出 JSON。
 *
 * 模型经常会在 JSON 外面包一层 ```json，或者前后加一句「好的，这是…」。
 * 与其要求模型严格输出，不如在这里容错——这比重试便宜得多。
 */
export function extractJson<T>(text: string): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fenced ? fenced[1] : text;
  const start = raw.search(/[{[]/);
  if (start < 0) return null;
  // 从第一个 { 开始尝试，逐步缩短尾部，找到第一个能解析成功的片段
  const body = raw.slice(start);
  for (let end = body.length; end > 1; end--) {
    const ch = body[end - 1];
    if (ch !== '}' && ch !== ']') continue;
    try {
      return JSON.parse(body.slice(0, end)) as T;
    } catch {
      // 继续往前找
    }
  }
  return null;
}

/** 句子里的词数。用于校验模型有没有遵守长度上限 */
export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * 校验模型生成的故事能不能用。
 *
 * 不合格就整个丢掉降级回内置故事，而不是「修一修凑合用」——
 * 一个句子太长、目标词没出现的故事，对孩子是负收益。
 */
export function validateStory(
  s: ParsedStory | null,
  req: StoryRequest,
): { ok: true; story: ParsedStory } | { ok: false; reason: string } {
  if (!s || !Array.isArray(s.pages) || s.pages.length < 5) {
    return { ok: false, reason: '模型没有返回可用的故事结构' };
  }
  if (s.pages.length > 14) return { ok: false, reason: '故事太长，超过 14 页' };
  const limit = LEVEL_LIMIT[req.level];
  const tooLong = s.pages.filter((p) => wordCount(p.text ?? '') > limit + 2);
  if (tooLong.length > 1) {
    return { ok: false, reason: `有 ${tooLong.length} 句超过了这个等级的长度上限` };
  }
  const all = s.pages.map((p) => (p.text ?? '').toLowerCase()).join(' ');
  const missing = req.words.filter((w) => !all.includes(w.en.toLowerCase()));
  if (missing.length) {
    return { ok: false, reason: `目标词没有出现：${missing.map((w) => w.en).join(', ')}` };
  }
  return { ok: true, story: s };
}

/** 把孩子的画像压成几条事实，给报告 prompt 用 */
export function factsFor(profile: ChildProfile): string[] {
  const p = profile.english;
  return [
    `听力 ${Math.round(p.listening)}，口语 ${Math.round(p.speaking)}，词汇 ${Math.round(p.vocabulary)}，理解 ${Math.round(p.comprehension)}（满分 100，内部值，不要写进报告）`,
    `连续学习 ${profile.streak} 天`,
  ];
}
