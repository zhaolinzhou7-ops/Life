/**
 * 儿童能力模型
 *
 * 八个维度都是 0~100，但**这个数字不给孩子看，也不当成考试分数给家长看**。
 * 它的唯一用途是让任务生成器知道该往哪边倾斜。家长端展示时一律翻译成
 * 「能听懂简单的生活指令」这样的行为描述（见 describeSkill）。
 *
 * 关于 Confidence：产品需求里写了要有这一项，但我们拒绝假装能测心理状态。
 * 这里存的是 ParticipationSignals——愿不愿意答、要不要提示、放不放弃，
 * 全是可观察行为的计数。describeParticipation() 把它翻译成一句描述性的话，
 * 措辞永远是「最近更愿意开口」而不是「自信心 72 分」。
 */

import type { ChildProfile, EnglishProfile, LevelId, ParticipationSignals, SkillId } from '../types';
import { clamp, uid } from './util';

export const SKILLS: { id: SkillId; label: string; labelZh: string }[] = [
  { id: 'listening', label: 'Listening', labelZh: '听力' },
  { id: 'speaking', label: 'Speaking', labelZh: '口语' },
  { id: 'pronunciation', label: 'Pronunciation', labelZh: '发音' },
  { id: 'vocabulary', label: 'Vocabulary', labelZh: '词汇' },
  { id: 'comprehension', label: 'Comprehension', labelZh: '理解' },
  { id: 'reading', label: 'Reading', labelZh: '认读' },
  { id: 'sentence', label: 'Sentence', labelZh: '句子表达' },
  { id: 'retention', label: 'Retention', labelZh: '记得住' },
];

export function skillLabelZh(id: SkillId): string {
  return SKILLS.find((s) => s.id === id)?.labelZh ?? id;
}

export function emptySignals(): ParticipationSignals {
  return {
    attempts: 0,
    skips: 0,
    hintsUsed: 0,
    voluntarySpeak: 0,
    promptedSpeak: 0,
    updatedAt: Date.now(),
  };
}

/**
 * 新建档案时的初始能力值。
 *
 * 按年龄给一个粗略起点，但这只是「在做完测评之前不至于两眼一抹黑」的占位值。
 * 测评一做完就会被真实结果覆盖。刻意不按年龄写死上限——5 岁可能已经能读，
 * 9 岁可能零基础，年龄只是先验，不是天花板。
 */
export function initialProfile(age: number): EnglishProfile {
  const base = clamp(18 + (age - 4) * 4, 12, 40);
  return {
    listening: base,
    speaking: clamp(base - 6, 8, 100),
    pronunciation: clamp(base - 6, 8, 100),
    vocabulary: base,
    comprehension: clamp(base - 3, 8, 100),
    // 认读能力和年龄的关系最强：6 岁以下基本不涉及文字
    reading: age >= 7 ? clamp(base - 10, 5, 100) : 5,
    sentence: clamp(base - 12, 5, 100),
    retention: base,
    participation: emptySignals(),
  };
}

export function newChild(name: string, age: number, avatar: string): ChildProfile {
  return {
    id: uid('child'),
    name: name.trim() || 'Kid',
    age: clamp(Math.round(age), 3, 12),
    avatar: avatar || '🐣',
    createdAt: Date.now(),
    level: 'starter',
    english: initialProfile(age),
    settings: {
      dailyMinutes: age <= 5 ? 10 : 15,
      allowVoice: true,
      difficulty: 'auto',
      goal: 'balanced',
      keepTranscripts: false,
    },
    streak: 0,
    stars: 0,
  };
}

/** 八维平均，用于粗略定级 */
export function overall(p: EnglishProfile): number {
  const v = [p.listening, p.speaking, p.pronunciation, p.vocabulary, p.comprehension, p.sentence, p.retention];
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/**
 * 由能力值推导学习阶段。
 *
 * 认读（reading）单独作为 reader 以上的门槛：一个听说很好但完全不认字的孩子
 * 不应该被推到阅读内容上去，那只会让他挫败。
 */
export function levelOf(p: EnglishProfile): LevelId {
  const o = overall(p);
  if (o >= 72 && p.reading >= 55 && p.sentence >= 60) return 'talker';
  if (o >= 55 && p.reading >= 38) return 'reader';
  if (o >= 34) return 'explorer';
  return 'starter';
}

export const LEVEL_INFO: Record<LevelId, { label: string; labelZh: string; desc: string; storyLevel: 1 | 2 | 3 | 4 }> = {
  starter: {
    label: 'Starter',
    labelZh: '起步',
    desc: '以听和看为主，跟读单个词，不要求成句表达。',
    storyLevel: 1,
  },
  explorer: {
    label: 'Explorer',
    labelZh: '探索',
    desc: '能听懂常见词，开始跟读短语，能用单词回答问题。',
    storyLevel: 2,
  },
  reader: {
    label: 'Reader',
    labelZh: '认读',
    desc: '能认少量单词，能用完整短句回答，开始接触简单阅读。',
    storyLevel: 3,
  },
  talker: {
    label: 'Talker',
    labelZh: '表达',
    desc: '能连续对话，能读短段落，能自己组织句子表达想法。',
    storyLevel: 4,
  },
};

/**
 * 把参与行为翻译成一句人话。
 *
 * 刻意不返回分数。这里的每一句话都能直接对应到上面的计数，
 * 家长追问「你凭什么这么说」时答得出来。
 */
export function describeParticipation(s: ParticipationSignals): string {
  const total = s.attempts + s.skips;
  if (total < 6) return '学习次数还少，暂时看不出稳定的规律。再学几次就能看出来了。';

  const skipRate = s.skips / total;
  const speakTotal = s.voluntarySpeak + s.promptedSpeak;
  const hintRate = s.attempts ? s.hintsUsed / s.attempts : 0;

  const parts: string[] = [];

  if (skipRate >= 0.3) {
    parts.push('遇到不会的题目比较容易放弃');
  } else if (skipRate <= 0.08) {
    parts.push('遇到不会的也愿意试一试');
  } else {
    parts.push('大部分题目都会尝试作答');
  }

  if (speakTotal === 0) {
    parts.push('还没有开口说过（可能是没开麦克风，也可能是还不敢）');
  } else if (s.voluntarySpeak / speakTotal >= 0.6) {
    parts.push('多数时候不用催就会主动跟读');
  } else {
    parts.push('需要提示或示范之后才愿意开口');
  }

  if (hintRate >= 0.45) parts.push('比较依赖提示');
  else if (hintRate <= 0.12) parts.push('很少用提示');

  return parts.join('，') + '。';
}

/** 一句话描述某个维度当前处在什么水平。给家长看的，不出现数字 */
export function describeSkill(id: SkillId, v: number): string {
  const band = v >= 70 ? 3 : v >= 45 ? 2 : v >= 25 ? 1 : 0;
  const table: Record<SkillId, string[]> = {
    listening: [
      '还需要配合图片才能听懂单个词。',
      '能听懂学过的单个词和简单指令。',
      '能听懂简单的生活指令和短句。',
      '能听懂连续的短故事，不用逐词翻译。',
    ],
    speaking: [
      '还很少开口，以模仿为主。',
      '能跟读单个词。',
      '可以主动说出简单单词和短句。',
      '能用完整句子回答问题。',
    ],
    pronunciation: [
      '发音还在模仿阶段，听不太出重音。',
      '单个词能说清楚，长一点的词会含糊。',
      '常用词发音清楚，能听出节奏。',
      '发音清楚，连读和语调都比较自然。',
    ],
    vocabulary: [
      '认识的词还很少。',
      '掌握了一批最基础的名词。',
      '常见主题的词大多认识。',
      '词汇量够用，能听懂新词的大意。',
    ],
    comprehension: [
      '需要图片才能理解意思。',
      '能理解单句的意思。',
      '能理解短故事的情节。',
      '能回答「为什么」这类需要推理的问题。',
    ],
    reading: [
      '还不涉及认字。',
      '能认出少量最熟悉的单词。',
      '能读出学过的短句。',
      '能自己读完一段短文。',
    ],
    sentence: [
      '以单个词表达为主。',
      '能说两三个词的短语。',
      '能说完整的简单句。',
      '能把两个意思连起来说。',
    ],
    retention: [
      '学过的词隔天容易忘。',
      '复习之后能想起来大部分。',
      '学过的词能记住比较久。',
      '很少需要重新学，复习一次就够。',
    ],
  };
  return table[id][band];
}
