/**
 * AI 儿童英语学习伙伴 · 数据模型
 *
 * 这一层只放「形状」，不放逻辑。所有引擎（任务生成、复习、薄弱点检测）都以
 * 这些类型为输入输出，这样引擎全是纯函数，能在 node 里直接跑单测，不用起浏览器。
 *
 * 几条贯穿全局的原则，写在类型里而不是写在注释里靠自觉：
 *  1. 年龄只是一个参数。真正决定内容难度的是 EnglishProfile + 学习历史 + 当前错误，
 *     所以 MissionInput 里年龄和画像是并列的输入，不存在「4 岁只能学这些」的硬编码。
 *  2. 不制造虚假精确。跟读结果只有 right/close/wrong/skip 四档，
 *     没有「/θ/ 准确率 93.71%」这种东西。
 *  3. Confidence 不假装测量心理状态。ParticipationSignals 里全是可观察行为计数，
 *     要给家长看的时候由 describeParticipation() 翻译成一句人话。
 */

// ———————————————— 基础枚举 ————————————————

/** 词汇主题。第一阶段的六大类，扩展时往后加即可 */
export type ThemeId =
  | 'self'
  | 'family'
  | 'food'
  | 'animal'
  | 'color'
  | 'number'
  | 'action'
  | 'toy'
  | 'nature';

/** 能力维度。刻意和「活动类型」分开：一个活动可以同时练多个维度 */
export type SkillId =
  | 'listening'
  | 'speaking'
  | 'pronunciation'
  | 'vocabulary'
  | 'comprehension'
  | 'reading'
  | 'sentence'
  | 'retention';

/** 学习阶段。用能力命名而不是用年龄命名，因为 5 岁可能是 reader，9 岁可能是 starter */
export type LevelId = 'starter' | 'explorer' | 'reader' | 'talker';

export type ActivityKind = 'word' | 'game' | 'story' | 'talk' | 'listen' | 'assess';

/** 游戏类型。每一个都绑定明确的学习目标，见 data/games.ts */
export type GameId = 'findit' | 'match' | 'listen-jump' | 'echo';

/** 单次作答结果。只有四档，不给分数 */
export type ResultTag = 'right' | 'close' | 'wrong' | 'skip';

// ———————————————— 儿童档案 ————————————————

/**
 * 可观察的参与行为。
 *
 * 这里**不是**自信心的测量。我们能观察到的只有：愿不愿意答、主不主动开口、
 * 是不是频繁放弃、要不要提示。描述结论由 describeParticipation() 给，
 * 且措辞永远是「最近更愿意开口了」这类行为描述，不是「自信心 72 分」。
 */
export interface ParticipationSignals {
  /** 总共尝试作答的次数 */
  attempts: number;
  /** 跳过 / 放弃的次数 */
  skips: number;
  /** 用掉提示的次数 */
  hintsUsed: number;
  /** 不需要提示就开口说的次数 */
  voluntarySpeak: number;
  /** 给了提示之后才开口的次数 */
  promptedSpeak: number;
  updatedAt: number;
}

/** 八个能力维度，0~100。初始值由测评给，之后由每次学习结果缓慢调整 */
export interface EnglishProfile {
  listening: number;
  speaking: number;
  pronunciation: number;
  vocabulary: number;
  comprehension: number;
  reading: number;
  sentence: number;
  retention: number;
  participation: ParticipationSignals;
}

export interface ChildSettings {
  /** 每天目标时长（分钟）。任务生成器按这个裁剪 */
  dailyMinutes: number;
  /** 家长可以整体关掉麦克风。关掉后所有跟读环节降级成「点一下表示我说了」 */
  allowVoice: boolean;
  /** 家长手动加减难度。auto 表示完全交给引擎 */
  difficulty: 'auto' | 'easier' | 'harder';
  /** 学习重点。引擎会在任务配比上向这个方向倾斜 */
  goal: 'balanced' | 'listening' | 'speaking' | 'vocabulary';
  /**
   * 是否保存语音转写文本。默认 false。
   * 无论这个开关如何，**音频本身永远不落盘**，只在内存里用完即弃。
   */
  keepTranscripts: boolean;
}

export interface ChildProfile {
  id: string;
  /** 昵称。引导页明确提示用小名，不要真实姓名 */
  name: string;
  age: number;
  /** 头像用 emoji，不涉及任何图片上传 */
  avatar: string;
  createdAt: number;
  level: LevelId;
  english: EnglishProfile;
  settings: ChildSettings;
  /** 没做过测评时为 undefined，首页会先引导去测评 */
  assessedAt?: number;
  /** 连续学习天数 */
  streak: number;
  lastStudyDate?: string;
  /** 累计星星，只用于儿童端的正向反馈，不代表水平 */
  stars: number;
}

// ———————————————— 词汇 ————————————————

export interface WordSentence {
  /** 1 = 三四个词的短句；2 = 完整简单句；3 = 带修饰或两个子句 */
  level: 1 | 2 | 3;
  text: string;
}

export interface Word {
  id: string;
  en: string;
  zh: string;
  /** 用 emoji 当图片：离线可用、任何设备都渲染、不需要图片流水线和版权 */
  emoji: string;
  theme: ThemeId;
  /** 难度层。1 最基础，3 需要一定基础 */
  tier: 1 | 2 | 3;
  syllables: number;
  pos: 'noun' | 'verb' | 'adj' | 'num';
  /**
   * 这个词本身是复数形式（shoes、grapes）。
   * 影响生成出来的句子用 is 还是 are、要不要冠词——
   * 一个教英语的产品说出 "Where is the shoes?" 是不能接受的。
   */
  plural?: boolean;
  /** 不可数（milk、water、bread）。不加 a/an，也不变复数 */
  mass?: boolean;
  sentences: WordSentence[];
  /** 「这是什么」类提问的具体问法，不同词性问法不同 */
  ask: string;
  /**
   * 干扰项分组。选择题的错误选项从同组里挑，
   * 让「苹果 vs 香蕉」而不是「苹果 vs 大象」，这样才测得出真实识别能力。
   */
  group: string;
}

/**
 * 一个词在这个孩子身上的记忆状态。
 *
 * box 是 Leitner 盒号，决定下次复习间隔；errors 按环节分开记，
 * 因为「看图认不出」和「听不出来」是两种完全不同的薄弱点，处方也不同。
 */
export interface WordMemory {
  wordId: string;
  box: number;
  streak: number;
  seen: number;
  correct: number;
  wrong: number;
  lastSeenAt: number;
  dueAt: number;
  errors: { recognize: number; listen: number; speak: number; use: number };
  firstLearnedAt: number;
  mastered: boolean;
}

// ———————————————— 故事 ————————————————

export interface StoryPage {
  text: string;
  emoji: string;
  /** 这一页要高亮的目标词（原形），朗读时会重读 */
  highlight?: string;
}

export interface StoryQuestion {
  kind: 'choice' | 'speak';
  ask: string;
  askZh: string;
  options?: { label: string; emoji: string; correct: boolean }[];
  /** kind='speak' 时期望听到的词（任意一个命中即可） */
  expect?: string[];
  wordId?: string;
}

export interface Story {
  id: string;
  title: string;
  /** 1~4 对应 starter→talker，故事选择器按孩子当前水平取 */
  level: 1 | 2 | 3 | 4;
  theme: ThemeId;
  coverEmoji: string;
  /** 目标词。故事里会高频重复这几个 */
  words: string[];
  pages: StoryPage[];
  questions: StoryQuestion[];
  /** 这个故事读完，孩子具体会了什么（§21） */
  learningOutcome: string;
}

// ———————————————— 学习记录 ————————————————

export interface Outcome {
  wordId?: string;
  skill: SkillId;
  result: ResultTag;
  /** 是否用了提示。用了提示答对，不算完全掌握 */
  hinted: boolean;
  /** 出错发生在哪个环节，用于薄弱点归因 */
  stage?: 'recognize' | 'listen' | 'speak' | 'use';
  at: number;
}

export interface ActivityRecord {
  kind: ActivityKind;
  refId: string;
  title: string;
  /** §21：每个活动必须能回答「孩子学会了什么」 */
  learningOutcome: string;
  outcomes: Outcome[];
  seconds: number;
  at: number;
}

export interface SessionRecord {
  id: string;
  childId: string;
  /** YYYY-MM-DD，按本地时区 */
  date: string;
  startedAt: number;
  endedAt?: number;
  seconds: number;
  activities: ActivityRecord[];
  /** 在单词环节被正式教过的新词。完成页和家长端的「新学」只数这些 */
  newWords: string[];
  /** 以前学过、这次又练到的词 */
  reviewWords: string[];
  /**
   * 第一次碰到、但没有被正式教的词——游戏里的选项、故事里的角色、对话里带出来的。
   * 它们确实是有效输入，但把它们算进「今天新学了 N 个」会把数字吹到三四倍，
   * 家长照着这个数字去考孩子，只会发现「学了等于没学」。所以单独一栏。
   */
  metWords: string[];
  stars: number;
  completed: boolean;
}

// ———————————————— 每日任务 ————————————————

export interface MissionStep {
  id: string;
  kind: ActivityKind;
  /** 儿童端展示的英文短句，配语音朗读 */
  title: string;
  /** 家长端和辅助文字用的中文 */
  titleZh: string;
  icon: string;
  estimateMin: number;
  learningOutcome: string;
  /** 这一步要用到的词 */
  wordIds: string[];
  storyId?: string;
  gameId?: GameId;
  talkLevel?: 1 | 2 | 3;
  done: boolean;
}

export interface DailyMission {
  date: string;
  childId: string;
  steps: MissionStep[];
  estimateMin: number;
  /** 为什么今天安排这些。家长端原样展示，不做包装 */
  reason: string;
  /** 生成时的种子，保证同一天重进任务不变 */
  seed: number;
}

// ———————————————— 测评 ————————————————

export interface AssessItem {
  id: string;
  /** listen-pick：听声音点图；say：跟读；pick-word：看词选图（7 岁以上才出） */
  kind: 'listen-pick' | 'say' | 'pick-word';
  prompt: string;
  promptZh: string;
  wordId: string;
  options: { wordId: string; emoji: string; label: string }[];
  /** 这道题属于哪一层，用于定级 */
  tier: 1 | 2 | 3;
}

export interface AssessAnswer {
  itemId: string;
  result: ResultTag;
  hinted: boolean;
  ms: number;
}

// ———————————————— AI ————————————————

export interface CoachTurn {
  role: 'coach' | 'child';
  text: string;
  /** 教练轮次里附带的图，让低龄孩子有东西可看 */
  emoji?: string;
  /** 这一轮期望孩子回答什么，用于判定 */
  expect?: string[];
  /** 孩子不会时的第一级提示，例如 "It's b..." */
  hint?: string;
  /**
   * 对话脚本节点 id。
   * 「现在该问什么」永远由本地脚本树决定，模型只负责把话说得自然，
   * 所以即使接了远端模型，这个字段也由本地维护，不让模型自己跳节点。
   */
  nodeId?: string;
}

export interface CoachReply {
  /** 教练说的话 */
  say: string;
  emoji?: string;
  /** 下一个问题（可能和 say 是同一句） */
  expect?: string[];
  hint?: string;
  /** 是否该结束这段对话 */
  end?: boolean;
  /** 触发了安全边界时的说明，只给家长端看，不给孩子看 */
  safetyNote?: string;
  /** 这一轮对应的脚本节点，写回 history 用 */
  nodeId?: string;
  /** 孩子这一轮答得怎么样，用于回写学习记录 */
  judged?: ResultTag;
  /** 这一轮练到的词 */
  wordIds?: string[];
}

/** 跟读判定结果。对孩子只呈现 tag 对应的一句鼓励，不呈现任何数字 */
export interface SpeechJudgement {
  tag: 'right' | 'close' | 'wrong';
  /** 0~1 的内部相似度，只用于引擎和家长端统计，永远不直接展示给孩子 */
  similarity: number;
  /** 给孩子的一句话反馈 */
  feedback: string;
  /** 是否建议再试一次 */
  retry: boolean;
  /** 听到的是什么（可能为空，比如识别失败） */
  heard?: string;
  /** 漏词 / 不完整这类可解释的现象 */
  note?: string;
}
