/**
 * 每日任务生成器
 *
 * 首页只有一件事：Today's Adventure。孩子打开就知道今天做什么，点 START 就开始。
 * 这个文件负责决定「今天做什么」。
 *
 * 输入是画像 + 记忆状态 + 薄弱点处方 + 日期，输出一串有序的活动。
 * 决策顺序（改顺序就是改产品，所以写在这里而不是散在代码里）：
 *
 *  1. **先还债。** 到期该复习的词优先，复习量大的日子就少上新词。
 *     「今天学了明天忘了再重新学」就是因为永远在上新。
 *  2. **再按薄弱点倾斜。** 听力弱就多听，不敢开口就多跟读少表达。
 *  3. **最后才是新内容。** 按主题顺序推进，一次只碰一到两个主题，
 *     让新词能在同一次学习的游戏和故事里反复出现。
 *  4. **卡时间。** 家长设了 10 分钟就是 10 分钟，超了就砍活动，
 *     而不是让孩子做半截被迫退出。
 *
 * 同一天、同一个孩子，生成结果必须稳定——种子由 childId + 日期决定，
 * 中途退出再进来看到的还是同一批内容。
 */

import type {
  ChildProfile,
  DailyMission,
  GameId,
  MissionStep,
  Story,
  ThemeId,
  Word,
  WordMemory,
} from '../types';
import { WORDS, getWord } from '../data/vocab';
import { STORIES } from '../data/stories';
import { GAMES, getGame } from '../data/games';
import { chainOf, firstNode, talkStarts, type TalkNode } from '../data/dialog';
import { LEVEL_INFO } from './profile';
import { dueWords, riskOf } from './review';
import type { Prescription } from './weakness';
import { hashSeed, rng, shuffle } from './util';

/** 主题推进顺序。刻意从「我自己」开始：离孩子最近的东西最容易建立意义连接 */
export const THEME_ORDER: ThemeId[] = [
  'self',
  'family',
  'food',
  'animal',
  'color',
  'number',
  'action',
  'toy',
  'house',
  'nature',
  'describe',
  'transport',
  'place',
  'school',
  'time',
  'job',
];

export interface MissionInput {
  profile: ChildProfile;
  memories: WordMemory[];
  prescription?: Prescription;
  date: string;
  now?: number;
  /** 读过的故事，按阅读顺序，最后一个是最近读的 */
  readStories?: string[];
  /** 最近聊过的话题链，按时间顺序 */
  recentTalks?: string[];
}

/** 每个等级一次学几个新词。低龄少而精，重复次数比数量重要 */
const NEW_WORD_BUDGET: Record<ChildProfile['level'], number> = {
  starter: 4,
  explorer: 5,
  reader: 6,
  talker: 6,
};

/**
 * 挑今天要复习的词。
 *
 * 不是简单取到期的前 N 个：错得多的、逾期久的要排前面，
 * 处方里点名的词无条件插队。
 */
function pickReview(mems: WordMemory[], rx: Prescription | undefined, now: number, limit: number): WordMemory[] {
  const due = dueWords(mems, now);
  const forced = (rx?.focusWordIds ?? [])
    .map((id) => mems.find((m) => m.wordId === id))
    .filter((m): m is WordMemory => !!m);

  const ranked = due.sort((a, b) => riskOf(b, now) - riskOf(a, now));
  const out: WordMemory[] = [];
  const push = (m: WordMemory) => {
    if (out.length < limit && !out.some((x) => x.wordId === m.wordId)) out.push(m);
  };
  forced.forEach(push);
  ranked.forEach(push);
  return out;
}

/** 按等级和家长的难度设置，算出「优先从哪一档取新词」 */
export function tierCapFor(profile: ChildProfile): 1 | 2 | 3 {
  const maxTier: 1 | 2 | 3 = profile.level === 'starter' ? 1 : profile.level === 'explorer' ? 2 : 3;
  const harder = profile.settings.difficulty === 'harder' ? 1 : 0;
  const easier = profile.settings.difficulty === 'easier' ? -1 : 0;
  return Math.min(3, Math.max(1, maxTier + harder + easier)) as 1 | 2 | 3;
}

/**
 * 挑今天的新词。
 *
 * 主题按顺序推进，但处方指定的主题优先。同一次只从一到两个主题取词，
 * 这样这些词能在后面的游戏和故事里反复碰到，而不是学完就散。
 *
 * **难度档是软上限，不是墙。** 先从当前等级允许的档里取；这一档的词都见过了，
 * 再逐级往上放。以前这里是硬过滤——一个起步阶段的孩子两周就把 tier 1 学完，
 * 之后每天的任务里就再也没有新词，而他的等级可能还没来得及升上去。
 * 「学完了这一档」本身就是最直接的学习历史，比能力分数更该算数。
 */
function pickNew(
  profile: ChildProfile,
  mems: WordMemory[],
  rx: Prescription | undefined,
  count: number,
  rnd: () => number,
): Word[] {
  const known = new Set(mems.map((m) => m.wordId));
  const unknown = WORDS.filter((w) => !known.has(w.id));
  if (!unknown.length) return [];

  const themeOrder: ThemeId[] = [...(rx?.boostThemes ?? []), ...THEME_ORDER].filter(
    (t, i, a) => a.indexOf(t) === i,
  );

  const out: Word[] = [];
  const taken = new Set<string>();
  const take = (w: Word) => {
    if (out.length < count && !taken.has(w.id)) {
      out.push(w);
      taken.add(w.id);
    }
  };

  for (let cap = tierCapFor(profile); cap <= 3 && out.length < count; cap++) {
    const eligible = unknown.filter((w) => w.tier <= cap && !taken.has(w.id));
    for (const theme of themeOrder) {
      if (out.length >= count) break;
      // 同一主题里先低档后高档，同档内随机
      const pool = shuffle(eligible.filter((w) => w.theme === theme), rnd).sort((a, b) => a.tier - b.tier);
      pool.forEach(take);
    }
    // THEME_ORDER 之外的主题（将来加的）也要能被取到
    shuffle(eligible, rnd)
      .sort((a, b) => a.tier - b.tier)
      .forEach(take);
  }
  return out;
}

/** 按薄弱点选游戏。没有薄弱点时按等级给一个合适的默认 */
function pickGame(profile: ChildProfile, rx: Prescription | undefined, rnd: () => number): GameId {
  const voice = profile.settings.allowVoice;
  const usable = GAMES.filter((g) => voice || !g.needsVoice);
  const boost = rx?.boostSkills ?? [];

  // 不敢开口时，绝不推跟读挑战——那只会让他更想跑
  const lowPressure = rx?.lowPressure ?? false;
  const candidates = usable.filter((g) => {
    if (lowPressure && g.id === 'echo') return false;
    return true;
  });

  const scored = candidates.map((g) => {
    let s = 1;
    for (const sk of g.skills) if (boost.includes(sk)) s += 3;
    if (profile.settings.goal === 'listening' && g.skills.includes('listening')) s += 2;
    if (profile.settings.goal === 'speaking' && g.skills.includes('speaking')) s += 2;
    if (profile.settings.goal === 'vocabulary' && g.skills.includes('vocabulary')) s += 2;
    // 认读类游戏对还不识字的孩子没意义
    if (g.id === 'match' && profile.english.reading < 25) s -= 2;
    return { g, s: s + rnd() * 0.9 };
  });
  scored.sort((a, b) => b.s - a.s);
  return (scored[0]?.g.id ?? 'findit') as GameId;
}

/**
 * 挑故事。
 *
 * 优先选「目标词里有今天学的词」的故事——故事的价值就在于让新词在情节里复现。
 * 其次才是难度匹配。
 *
 * 读过的故事按**多久以前读的**降权，而不是一刀切：
 *   最近三次读过的 —— 几乎排除。昨天刚听完的故事今天又来，孩子会觉得 App 坏了。
 *   更早读过的    —— 轻罚。隔一阵重听同一个故事对低龄孩子是好事，不是浪费。
 *
 * 「最近三次」的罚分必须压得过「和今天的词重合」的加分。否则会形成一个回路：
 * 读完一个故事 → 它的词进复习 → 第二天复习词和这个故事重合 → 又选中它。
 *
 * readIds 按阅读顺序排列，最后一个是最近读的（见 session.ts 的 noteStory）。
 */
function pickStory(profile: ChildProfile, todayWords: string[], readIds: string[], rnd: () => number): Story | null {
  const target = LEVEL_INFO[profile.level].storyLevel;
  const adj = profile.settings.difficulty === 'harder' ? 1 : profile.settings.difficulty === 'easier' ? -1 : 0;
  const want = Math.min(4, Math.max(1, target + adj));

  const scored = STORIES.map((s) => {
    let score = 0;
    const overlap = s.words.filter((w) => todayWords.includes(w)).length;
    score += overlap * 4;
    score -= Math.abs(s.level - want) * 3;
    const idx = readIds.lastIndexOf(s.id);
    if (idx >= 0) {
      const ago = readIds.length - 1 - idx; // 0 = 上一次读的就是它
      score -= ago < 3 ? 30 : ago < 8 ? 3 : 1;
    }
    return { s, score: score + rnd() * 1.2 };
  }).sort((a, b) => b.score - a.score);

  return scored[0]?.s ?? null;
}

/**
 * 挑今天聊哪条话题链。
 *
 *  · 第一次和 Coco 说话：用自我介绍链（问名字、年龄）。之后不再用——
 *    天天听到 "Hello! I am Coco." 很怪，像一个记不住你的人。
 *  · 之后优先和今天学的词重合的链：今天学了动物，就聊动物，
 *    让新词马上在对话里用一次。
 *  · 最近两次聊过的几乎排除，最近五次聊过的轻罚，保证轮换。
 */
function pickTalk(level: 1 | 2 | 3, todayWords: string[], recent: string[], rnd: () => number): TalkNode {
  const starts = talkStarts(level);
  if (!recent.length) {
    const intro = starts.find((n) => n.intro);
    if (intro) return intro;
  }
  const pool = starts.filter((n) => !n.intro);
  const scored = (pool.length ? pool : starts).map((n) => {
    const words = chainOf(n.id).flatMap((x) => x.wordIds ?? []);
    let score = words.filter((w) => todayWords.includes(w)).length * 3;
    const idx = recent.lastIndexOf(n.id);
    if (idx >= 0) {
      const ago = recent.length - 1 - idx;
      score -= ago < 2 ? 30 : ago < 5 ? 4 : 1;
    }
    return { n, score: score + rnd() * 1.5 };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0]?.n ?? firstNode(level);
}

export function generateMission(input: MissionInput): DailyMission {
  const { profile, memories, prescription: rx, date } = input;
  const now = input.now ?? Date.now();
  const seed = hashSeed(`${profile.id}:${date}`);
  const rnd = rng(seed);

  const minutes = profile.settings.dailyMinutes;
  const level = profile.level;

  // 复习债越多，新词越少。上限是每天预算的一半时间
  const reviewCap = minutes >= 20 ? 10 : minutes >= 15 ? 8 : 6;
  const review = pickReview(memories, rx, now, reviewCap);

  // 顺序要紧：先按目标和时长调，最后才让复习债压新词量。
  // 复习债是最强的那个约束——「今天学了明天忘了」的根源就是永远在上新，
  // 所以它必须放在最后，而且允许把新词压到比时长下限更低。
  let newCount = NEW_WORD_BUDGET[level];
  if (profile.settings.goal === 'vocabulary') newCount += 1;
  if (minutes <= 10) newCount = Math.max(3, newCount - 1);
  if (review.length >= reviewCap) newCount = Math.max(2, newCount - 2);
  else if (review.length >= reviewCap * 0.6) newCount = Math.max(2, newCount - 1);

  const fresh = pickNew(profile, memories, rx, newCount, rnd);
  const reviewIds = review.map((m) => m.wordId).filter((id) => !!getWord(id));
  const newIds = fresh.map((w) => w.id);
  const todayWords = [...newIds, ...reviewIds];

  const steps: MissionStep[] = [];

  // ——— 1. 学新词 ———
  if (newIds.length) {
    const names = fresh.map((w) => w.en).join(', ');
    steps.push({
      id: 'm-words',
      kind: 'word',
      title: `Learn ${newIds.length} new words`,
      titleZh: `学 ${newIds.length} 个新单词`,
      icon: '🔤',
      estimateMin: Math.max(3, Math.round(newIds.length * 0.8)),
      learningOutcome: `能看图认出并说出：${names}`,
      wordIds: newIds,
      done: false,
    });
  }

  // ——— 2. 复习 ———
  if (reviewIds.length >= 3) {
    const names = reviewIds.map((id) => getWord(id)?.en ?? id).slice(0, 6).join(', ');
    steps.push({
      id: 'm-review',
      kind: 'listen',
      title: `Review ${reviewIds.length} words`,
      titleZh: `复习 ${reviewIds.length} 个词`,
      icon: '🔁',
      estimateMin: Math.max(2, Math.round(reviewIds.length * 0.4)),
      learningOutcome: `巩固之前学过的：${names}${reviewIds.length > 6 ? ' 等' : ''}`,
      wordIds: reviewIds,
      done: false,
    });
  }

  // ——— 3. 游戏 ———
  const gameId = pickGame(profile, rx, rnd);
  const game = getGame(gameId);
  const gameWords = shuffle(todayWords.length >= 4 ? todayWords : WORDS.slice(0, 8).map((w) => w.id), rnd).slice(0, 8);
  steps.push({
    id: 'm-game',
    kind: 'game',
    title: `Play: ${game.title}`,
    titleZh: `玩一个游戏：${game.titleZh}`,
    icon: game.emoji,
    estimateMin: game.estimateMin,
    learningOutcome: game.outcome.replace(
      '{words}',
      gameWords.slice(0, 5).map((id) => getWord(id)?.en ?? id).join(', '),
    ),
    wordIds: gameWords,
    gameId,
    done: false,
  });

  // ——— 4. 故事 ———
  const story = pickStory(profile, todayWords, input.readStories ?? [], rnd);
  if (story) {
    steps.push({
      id: 'm-story',
      kind: 'story',
      title: `Listen to a story`,
      titleZh: `听一个故事：${story.title}`,
      icon: '📖',
      estimateMin: story.level <= 2 ? 3 : 4,
      learningOutcome: story.learningOutcome,
      wordIds: story.words,
      storyId: story.id,
      done: false,
    });
  }

  // ——— 5. 对话 ———
  // 不敢开口的孩子今天不排自由对话，先把跟读做扎实。这是处方直接生效的地方。
  const talkLevel: 1 | 2 | 3 = level === 'starter' ? 1 : level === 'explorer' ? 1 : level === 'reader' ? 2 : 3;
  const wantTalk = !rx?.lowPressure && profile.settings.allowVoice !== false;
  if (wantTalk) {
    const chain = pickTalk(talkLevel, todayWords, input.recentTalks ?? [], rnd);
    steps.push({
      id: 'm-talk',
      kind: 'talk',
      title: 'Talk with Coco',
      titleZh: `和 Coco 说几句话：${chain.title ?? '聊聊天'}`,
      icon: '🦜',
      estimateMin: 3,
      learningOutcome: chain.outcome ?? '能就一个话题回答几个问题',
      wordIds: chainOf(chain.id).flatMap((n) => n.wordIds ?? []).filter((id, i, a) => a.indexOf(id) === i),
      talkLevel,
      talkStart: chain.id,
      done: false,
    });
  }

  // ——— 6. 卡时间 ———
  // 从后往前砍。单词和复习是根基，永远不砍；砍掉的顺序是 对话 → 故事 → 游戏。
  const protectedIds = new Set(['m-words', 'm-review']);
  const order = ['m-talk', 'm-story', 'm-game'];
  let total = steps.reduce((a, s) => a + s.estimateMin, 0);
  for (const id of order) {
    if (total <= minutes + 2) break;
    const i = steps.findIndex((s) => s.id === id && !protectedIds.has(s.id));
    if (i >= 0) {
      total -= steps[i].estimateMin;
      steps.splice(i, 1);
    }
  }

  // ——— 7. 说清楚为什么是这些 ———
  const why: string[] = [];
  if (review.length) why.push(`有 ${review.length} 个词到了该复习的时候`);
  if (newIds.length) why.push(`按主题进度该上 ${newIds.length} 个新词`);
  if (rx?.note) why.push(rx.note);
  if (rx?.lowPressure) why.push('暂时不安排自由对话，先做低压力的跟读和选择');
  const reason = why.join('；') + '。';

  return {
    date,
    childId: profile.id,
    steps,
    estimateMin: steps.reduce((a, s) => a + s.estimateMin, 0),
    reason,
    seed,
  };
}
