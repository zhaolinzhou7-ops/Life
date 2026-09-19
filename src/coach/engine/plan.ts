/**
 * 每日训练计划
 *
 * 首页只需要回答一个问题：**我今天到底应该学什么。**
 *
 * 这个问题看起来简单，但它是成年人学英语最大的隐性成本。打开一个有四十门
 * 课的 App，光是"选今天学哪个"就要耗掉一部分本来就不多的意志力，于是很多人
 * 第三天就不打开了。所以这里的输出是一份**已经决定好的**清单，用户点"开始"
 * 就行，不需要做任何选择。
 *
 * 排课依据全部来自用户自己的数据：到期该复习的词、错误档案里还没改掉的毛病、
 * 测评算出来的瓶颈、可用时间。同一天重复进来得到同一份计划（按日期播种），
 * 这样"今天的训练"才是一件确定的事，而不是每次刷新都变。
 */

import type {
  ActivityKind,
  Bottleneck,
  CEFR,
  ErrorProfile,
  GoalKey,
  LearningPlan,
  PlanActivity,
  UserProfile,
  UserVocab,
} from '../types';
import { cefrIndex } from '../types';
import { SCENARIOS } from '../data/scenarios';
import { CLIPS } from '../data/listening';
import { pickNew, pickReview, due } from './srs';
import { topErrors } from './errors';
import { newId, today } from '../store';

/** 目标 → 场景标签。学的东西要能马上用上，否则记不住 */
const GOAL_TAG: Record<GoalKey, string> = {
  work: 'work',
  travel: 'travel',
  daily: 'daily',
  interview: 'work',
  exam: 'daily',
};

/** 用日期当种子，保证同一天进来看到同一份计划 */
function seedFrom(date: string): number {
  let h = 0;
  for (let i = 0; i < date.length; i++) h = (h * 31 + date.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const pickBySeed = <T>(list: T[], seed: number): T | undefined =>
  list.length ? list[seed % list.length] : undefined;

export interface PlanInput {
  profile: UserProfile;
  errors: ErrorProfile;
  vocab: Record<string, UserVocab>;
  dailyMinutes: number;
  goals: GoalKey[];
  bottleneck?: Bottleneck;
  date?: string;
  now?: number;
}

/**
 * 按瓶颈决定时间怎么分。
 *
 * 返回的是"权重"，不是分钟数——总时长由用户设定的每日时间决定，
 * 这里只负责决定哪一块该多分一点。
 */
function weights(bottleneck?: Bottleneck): Record<ActivityKind, number> {
  const base: Record<ActivityKind, number> = {
    review: 1.5,
    vocab: 1,
    listening: 1,
    speaking: 1,
    scenario: 1.5,
    writing: 0.6,
    reading: 0.6,
    drill: 0.8,
  };
  switch (bottleneck?.key) {
    case 'receptive-productive-gap':
      // 会看不会说：把时间压到产出上，阅读几乎不用练
      return { ...base, speaking: 2.2, scenario: 2.2, drill: 1.2, reading: 0.2, vocab: 0.8 };
    case 'listening-gap':
      return { ...base, listening: 2.5, speaking: 1.2, reading: 0.3 };
    case 'grammar-accuracy':
      return { ...base, drill: 2.2, writing: 1.5, speaking: 1.2 };
    case 'chinglish':
      return { ...base, drill: 2.0, scenario: 2.0, writing: 1.2 };
    case 'fluency':
      return { ...base, speaking: 2.5, scenario: 2.0, listening: 1.2, reading: 0.2 };
    case 'vocabulary-size':
      return { ...base, vocab: 2.2, reading: 1.2, listening: 1.2 };
    default:
      return base;
  }
}

export function buildPlan(input: PlanInput): LearningPlan {
  const date = input.date ?? today();
  const now = input.now ?? Date.now();
  const seed = seedFrom(date);
  const minutes = Math.max(10, Math.min(45, input.dailyMinutes || 20));
  const tags = [...new Set(input.goals.map((g) => GOAL_TAG[g]))];
  const w = weights(input.bottleneck);

  const dueWords = pickReview(input.vocab, 8, { tags, now });
  const pendingErrors = topErrors(input.errors, 3, now);
  const level = input.profile.levels.speaking ?? input.profile.overall ?? 'A2';

  const activities: PlanActivity[] = [];
  const add = (
    kind: ActivityKind,
    title: string,
    why: string,
    mins: number,
    payload?: PlanActivity['payload'],
  ) => {
    activities.push({ id: newId('act'), kind, title, why, minutes: mins, payload });
  };

  // ————— 1. 复习：有到期的就先还债，这是间隔复习的全部意义 —————
  if (dueWords.length) {
    add(
      'review',
      `${dueWords.length} 个到期的词`,
      dueWords.some((v) => v.errorCount > 0)
        ? `其中 ${dueWords.filter((v) => v.errorCount > 0).length} 个你之前错过，今天是最该再见一面的时候。`
        : '按间隔复习的排期，今天再见一面能记得最久。',
      3,
      { words: dueWords.map((v) => v.word) },
    );
  }

  // ————— 2. 专项纠错：错误档案里还没改掉的毛病 —————
  if (pendingErrors.length) {
    const first = pendingErrors[0];
    add(
      'drill',
      first.label,
      `这个毛病你一共犯过 ${first.count} 次，最近一次就在不久前。用你自己说错的句子来练，比看语法书管用。`,
      Math.round(4 * w.drill),
      { ruleIds: pendingErrors.map((e) => e.ruleId) },
    );
  }

  // ————— 3. 听力 —————
  const clipPool = CLIPS.filter((c) => Math.abs(cefrIndex(c.level) - cefrIndex(level as CEFR)) <= 1);
  const clip = pickBySeed(clipPool.length ? clipPool : CLIPS, seed);
  if (clip && w.listening >= 0.8) {
    add(
      'listening',
      clip.title,
      input.bottleneck?.key === 'listening-gap'
        ? '你的听力明显落后于阅读，这是今天的重点。先整体听，再逐句精听。'
        : '听真实语速的对话，练"不在脑子里翻译就能跟上"。',
      Math.round(4 * w.listening),
      { clipId: clip.id },
    );
  }

  // ————— 4. 词汇：只在复习不多的时候才加新词 —————
  if (dueWords.length < 6) {
    const fresh = pickNew(input.vocab, 5, { tags, levels: [level as string] });
    if (fresh.length) {
      add(
        'vocab',
        `新学 ${fresh.length} 个${tags.includes('work') ? '工作' : tags.includes('travel') ? '旅行' : '日常'}高频词`,
        '今天复习不多，可以加一点新的。每个词都会先让你用它造句，而不是只看中文。',
        Math.round(4 * w.vocab),
        { words: fresh.map((v) => v.word) },
      );
    }
  }

  // ————— 5. 口语 —————
  add(
    'speaking',
    '跟读 + 自由表达',
    input.bottleneck?.key === 'fluency' || input.bottleneck?.key === 'receptive-productive-gap'
      ? '你的问题在"张不开嘴"，所以这一块不能省。要求只有一个：先说出来，说得不完美没关系。'
      : '每天必须有一段时间是你在说，而不是在看。',
    Math.round(4 * w.speaking),
  );

  // ————— 6. 情景对话：一天的落点 —————
  const scenPool = SCENARIOS.filter((s) => tags.length === 0 || tags.includes(s.category));
  const scen = pickBySeed(scenPool.length ? scenPool : SCENARIOS, seed);
  if (scen && minutes >= 12) {
    add(
      'scenario',
      scen.title,
      `${scen.mission}。这是今天所有练习的落点——前面学的东西要在这里真的用出来。`,
      Math.round(5 * w.scenario),
      { scenarioId: scen.id },
    );
  }

  // ————— 7. 写作：时间够才加 —————
  if (minutes >= 25 && w.writing >= 1) {
    add('writing', '写三句话', '写比说慢，但能逼你把句子结构想清楚。写完会逐句分析。', 4);
  }

  // ————— 按可用时间裁剪 —————
  const trimmed = fitToMinutes(activities, minutes);

  return {
    id: newId('plan'),
    userId: input.profile.userId,
    date,
    totalMinutes: trimmed.reduce((s, a) => s + a.minutes, 0),
    activities: trimmed,
    rationale: rationale(input, dueWords.length, pendingErrors.length),
    createdAt: now,
  };
}

/**
 * 把计划压进用户愿意给的时间里。
 *
 * 宁可少排一项，也不要排一个 30 分钟的计划给一个只愿意学 10 分钟的人——
 * 那不叫"有追求"，那叫第一天就把人劝退。
 */
function fitToMinutes(list: PlanActivity[], budget: number): PlanActivity[] {
  // 重要性排序：复习和情景对话是骨架，其它的可以砍
  const priority: ActivityKind[] = ['review', 'scenario', 'speaking', 'drill', 'listening', 'vocab', 'writing', 'reading'];
  const sorted = list.slice().sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
  const kept: PlanActivity[] = [];
  let total = 0;
  for (const a of sorted) {
    const mins = Math.max(2, a.minutes);
    if (total + mins > budget + 2) continue;
    kept.push({ ...a, minutes: mins });
    total += mins;
  }
  // 按原来的顺序还原：复习在前、对话在后，这个顺序本身是教学设计
  const order: ActivityKind[] = ['review', 'drill', 'listening', 'vocab', 'speaking', 'scenario', 'writing', 'reading'];
  return kept.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
}

function rationale(input: PlanInput, dueCount: number, errCount: number): string {
  const bits: string[] = [];
  if (input.bottleneck) bits.push(`你的主要瓶颈是「${input.bottleneck.title}」，所以今天的时间偏向${focusText(input.bottleneck)}`);
  if (dueCount) bits.push(`有 ${dueCount} 个词到了该复习的时间`);
  if (errCount) bits.push(`错误档案里还有 ${errCount} 个反复出现的毛病没改掉`);
  if (!bits.length) return '还没有足够的数据来定制计划，今天先按通用节奏走一轮，练完就能算出你的画像。';
  return bits.join('；') + '。';
}

function focusText(b: Bottleneck): string {
  const map: Record<string, string> = {
    speaking: '开口说',
    listening: '听',
    grammar: '语法准确度',
    writing: '写',
    vocabulary: '词汇',
    reading: '阅读',
  };
  return b.focus.map((f) => map[f] ?? f).join('和');
}

/** 今天还剩什么没做 */
export const remaining = (plan: LearningPlan): PlanActivity[] => plan.activities.filter((a) => !a.done);

export const planDone = (plan: LearningPlan): boolean => plan.activities.every((a) => a.done);

/** 复习债有多重。首页要用它决定是不是该提醒用户"别再加新词了" */
export const reviewDebt = (vocab: Record<string, UserVocab>, now = Date.now()): number => due(vocab, now).length;
