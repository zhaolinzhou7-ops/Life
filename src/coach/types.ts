/**
 * 成年人 AI 英语教练 · 数据模型
 *
 * 这一层的设计原则只有一条：**学习状态是产品的资产，不能散落在页面里**。
 *
 * 一个只会"渲染今天的课"的英语 App，和一个能说出"你三周前就在 be 动词上栽过，
 * 今天又栽了"的教练，差别不在界面，而在于后者把每一次犯错都落成了结构化数据。
 * 所以这里把用户的能力、错误、词汇掌握度、复习排期全部建模，页面只负责展示。
 *
 * 另一条硬规矩写在 Measured 上：**任何展示给用户的数字都要能说出它是怎么算的**。
 * 拿不到可靠数据时字段就留空，而不是填一个看起来很专业的假数字。
 */

// ═══════════════════════ 基础刻度 ═══════════════════════

/** 欧洲语言共同参考框架。成年人自学到 C1 以上已经不需要这类产品，故止于 C1 */
export type CEFR = 'A1' | 'A2' | 'B1' | 'B2' | 'C1';

export const CEFR_ORDER: CEFR[] = ['A1', 'A2', 'B1', 'B2', 'C1'];

/** 等级转成 0~4 的数字，方便比大小和求平均 */
export const cefrIndex = (l: CEFR): number => CEFR_ORDER.indexOf(l);
export const cefrFrom = (i: number): CEFR => CEFR_ORDER[Math.max(0, Math.min(4, Math.round(i)))];

export const CEFR_LABEL: Record<CEFR, string> = {
  A1: '入门',
  A2: '初级',
  B1: '中级',
  B2: '中高级',
  C1: '高级',
};

/** 六项能力。刻意把"词汇"和"语法"单列——成年人的瓶颈常常只在其中一项 */
export type SkillKey = 'reading' | 'listening' | 'speaking' | 'writing' | 'vocabulary' | 'grammar';

export const SKILLS: SkillKey[] = ['reading', 'listening', 'speaking', 'writing', 'vocabulary', 'grammar'];

export const SKILL_LABEL: Record<SkillKey, string> = {
  reading: '阅读',
  listening: '听力',
  speaking: '口语',
  writing: '写作',
  vocabulary: '词汇',
  grammar: '语法',
};

/** 接收型能力 vs 产出型能力。"会看不会说"这个诊断就是靠这两组的差值算出来的 */
export const RECEPTIVE: SkillKey[] = ['reading', 'listening', 'vocabulary'];
export const PRODUCTIVE: SkillKey[] = ['speaking', 'writing', 'grammar'];

// ═══════════════════════ 数据可信度 ═══════════════════════

/**
 * 一个测量值，附带它的来源。
 *
 * 产品里到处都是数字，用户没法分辨哪些是真算出来的、哪些是模型随口说的。
 * 所以每个数字都必须带上 source，界面按 source 决定怎么标注：
 *   - counted：程序数出来的（词数、错误数、答对题数），可以直接展示
 *   - timed：真实计时得到的（反应时间、语速），可以展示但要说明口径
 *   - derived：由上面两类按写死的规则推出来的（等级、掌握度），可解释可复现
 *   - asr：来自语音识别文本的比对，**不是声学发音评分**，必须标注
 *   - model：模型给的判断，不保证可复现，展示时要说明"这是 AI 的看法"
 */
export type MetricSource = 'counted' | 'timed' | 'derived' | 'asr' | 'model';

export interface Measured {
  value: number;
  source: MetricSource;
  /** 这个数字是怎么来的，一句人话。会直接显示在界面上 */
  how: string;
  unit?: string;
}

export const measured = (value: number, source: MetricSource, how: string, unit?: string): Measured => ({
  value,
  source,
  how,
  unit,
});

// ═══════════════════════ 用户与画像 ═══════════════════════

export type GoalKey = 'work' | 'travel' | 'daily' | 'interview' | 'exam';

export const GOAL_LABEL: Record<GoalKey, string> = {
  work: '工作里能用英语沟通',
  travel: '出国旅行不发怵',
  daily: '日常闲聊能接得住',
  interview: '能用英语面试',
  exam: '为考试做准备',
};

export interface User {
  id: string;
  /** 昵称，随便填，只存在本机 */
  name: string;
  createdAt: number;
  /** 每天愿意学多少分钟。10/20/30 */
  dailyMinutes: number;
  goals: GoalKey[];
  /** 母语背景。目前只服务中文母语者，字段留着是为了以后不用改数据结构 */
  nativeLanguage: 'zh';
}

/**
 * 能力画像。这是 AI 教练每次开口之前都要读的东西。
 *
 * 教练不读画像，就只能把用户当成一个刚认识的陌生人，这正是市面上大多数
 * "AI 英语老师"最大的问题。
 */
export interface UserProfile {
  userId: string;
  updatedAt: number;
  /** 分技能等级。没测过的技能不在这里，不要瞎填一个默认值 */
  levels: Partial<Record<SkillKey, CEFR>>;
  /** 综合等级，由 levels 加权得出 */
  overall?: CEFR;
  /** 最主要的瓶颈，测评引擎算出来的 */
  bottleneck?: Bottleneck;
  /** 连续学习天数 */
  streak: number;
  /** 最近一次学习的日期（YYYY-MM-DD） */
  lastStudyDate?: string;
  /** 累计学习分钟数 */
  totalMinutes: number;
  /** 已完成的训练场次 */
  totalSessions: number;
}

export type BottleneckKey =
  | 'receptive-productive-gap'
  | 'listening-gap'
  | 'grammar-accuracy'
  | 'fluency'
  | 'vocabulary-size'
  | 'chinglish'
  | 'balanced';

export interface Bottleneck {
  key: BottleneckKey;
  /** 一句话结论，直接展示 */
  title: string;
  /** 凭什么这么说——必须引用真实测出来的数据 */
  evidence: string[];
  /** 接下来重点练什么 */
  focus: SkillKey[];
}

// ═══════════════════════ 测评 ═══════════════════════

export type AssessTaskKind =
  | 'reading'
  | 'listening'
  | 'vocab-recognize'
  | 'vocab-use'
  | 'translate'
  | 'write'
  | 'speak';

/** 选择题：有唯一正确答案，能客观算分 */
export interface ChoiceItem {
  id: string;
  kind: 'reading' | 'listening' | 'vocab-recognize' | 'vocab-use';
  level: CEFR;
  /** 阅读题的短文；听力题的朗读文本 */
  passage?: string;
  /** 听力题的语速档位 */
  speed?: 'slow' | 'normal' | 'fast';
  prompt: string;
  options: string[];
  answer: number;
  /** 答错时给的解释 */
  explain: string;
}

/** 开放题：没有唯一答案，靠本地引擎分析产出 */
export interface OpenItem {
  id: string;
  kind: 'translate' | 'write' | 'speak';
  level: CEFR;
  /** 中文题干（翻译题）或英文指令（写作/口语题） */
  prompt: string;
  /** 中文说明 */
  hint: string;
  /** 参考答案，用于对照，不作为唯一正确答案 */
  reference: string[];
  /** 这道题在考什么结构，用于诊断 */
  targets: string[];
}

export interface AssessAnswer {
  itemId: string;
  kind: AssessTaskKind;
  /** 选择题选了第几个；开放题为 -1 */
  choice: number;
  /** 开放题用户写/说的内容 */
  text: string;
  correct?: boolean;
  /** 从题目出现到提交，毫秒。真实计时 */
  elapsedMs: number;
  /** 开放题是说的还是打的 */
  via?: 'typed' | 'spoken';
}

export interface Assessment {
  id: string;
  userId: string;
  createdAt: number;
  answers: AssessAnswer[];
  /** 分技能等级 */
  levels: Record<SkillKey, CEFR>;
  /** 每项能力下面支撑结论的数字 */
  metrics: Record<string, Measured>;
  bottleneck: Bottleneck;
  /** 给用户看的报告正文 */
  summary: string[];
  /** 这次测评发现的具体问题，会进错误档案 */
  findings: Correction[];
}

// ═══════════════════════ 纠错 ═══════════════════════

export type ErrorKind =
  | 'grammar' // 语法错误：时态、主谓一致、冠词、单复数…
  | 'chinglish' // 语法没错但不像英语：中文直译、中文语序
  | 'word-choice' // 用词不对：open the light
  | 'formality' // 语域不对：口语场合说书面语
  | 'incomplete' // 表达不完整
  | 'spelling';

export const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  grammar: '语法',
  chinglish: '中式英语',
  'word-choice': '用词',
  formality: '语域',
  incomplete: '完整度',
  spelling: '拼写',
};

/**
 * 一条纠错。
 *
 * 刻意保留 original —— 只给"正确答案"的产品教不会人，用户需要看到
 * 自己写的 → 问题在哪 → 改成什么 → 为什么。这是第 14 节的硬要求。
 */
export interface Correction {
  id: string;
  kind: ErrorKind;
  /** 用户原话里出问题的片段 */
  original: string;
  /** 改成什么 */
  fixed: string;
  /** 问题是什么，一句话 */
  problem: string;
  /** 为什么，讲给成年人听，不超过两句 */
  why: string;
  /** 归类用的规则 id，错误档案靠它统计"你又犯了" */
  ruleId: string;
  /** 严重程度：3 影响理解，2 明显不自然，1 可以更好 */
  severity: 1 | 2 | 3;
  /** 这条错误出现在哪句话里，用于复盘时回看上下文 */
  sentence?: string;
}

/** 个人错误档案：同一个毛病犯了几次、最近一次是什么时候 */
export interface ErrorRecord {
  ruleId: string;
  kind: ErrorKind;
  /** 规则的人话名字，例如"be 动词漏掉" */
  label: string;
  count: number;
  firstAt: number;
  lastAt: number;
  /** 最近几次的原话，复习时拿用户自己的错句来练最有效 */
  samples: { original: string; fixed: string; at: number }[];
  /** 连续答对几次。到 3 次就从"当前重点"里毕业 */
  clearedStreak: number;
}

export interface ErrorProfile {
  userId: string;
  records: ErrorRecord[];
  updatedAt: number;
}

// ═══════════════════════ 词汇 ═══════════════════════

/**
 * 掌握度五级。第 11 节的要求：
 * "认识 5000 词"和"能用 5000 词"不是一回事，所以必须分开记。
 *
 * 0 未学 · 1 认识（见过，知道大概） · 2 熟悉（知道意思）
 * 3 会理解（听到/读到能反应过来） · 4 会使用（能造句）· 5 熟练使用（对话里用出来过）
 */
export type Mastery = 0 | 1 | 2 | 3 | 4 | 5;

export const MASTERY_LABEL: Record<Mastery, string> = {
  0: '未学',
  1: '认识',
  2: '熟悉',
  3: '会理解',
  4: '会使用',
  5: '熟练使用',
};

export interface VocabItem {
  word: string;
  /** 音标，来自词库，不是推算的 */
  phonetic: string;
  pos: string;
  meaning: string;
  /** 例句 + 中文 */
  example: string;
  exampleCn: string;
  level: CEFR;
  /** 用在什么场景，用于按目标选词 */
  tags: string[];
  /** 中文母语者在这个词上常犯的错，可选 */
  trap?: string;
}

export interface UserVocab {
  word: string;
  mastery: Mastery;
  /** 一共练过几次 */
  reviews: number;
  errorCount: number;
  /** 最近一次复习 */
  lastReview: number;
  /** 下一次该复习的时间戳。间隔复习引擎算的 */
  nextReview: number;
  /** SM-2 风格的难度系数，随表现调整 */
  ease: number;
  /** 上次的间隔（天） */
  intervalDays: number;
  /** 在对话/写作里主动用出来过几次。这是升到 5 级的唯一途径 */
  spontaneousUses: number;
  /** 最近一次答题耗时，用来判断"想起来了"还是"卡了很久" */
  lastElapsedMs?: number;
  /** 这个词是在哪个场景里遇到的 */
  contexts: string[];
}

// ═══════════════════════ 场景对话 ═══════════════════════

export type ScenarioCategory = 'daily' | 'travel' | 'work';

export const CATEGORY_LABEL: Record<ScenarioCategory, string> = {
  daily: '日常',
  travel: '旅行',
  work: '工作',
};

/** 四级提示。用户卡住时不让他退出，而是逐级给梯子 */
export interface HintLadder {
  /** 一级：关键词 */
  keywords: string[];
  /** 二级：句子结构 */
  frame: string;
  /** 三级：半完整表达 */
  half: string;
  /** 四级：完整参考答案 */
  full: string;
  /** 中文，用户想表达的意思 */
  intentCn: string;
}

/**
 * 场景里的一个阶段。
 *
 * 关键设计：**推进与否由本地判定，不交给模型**。
 * 模型负责把 NPC 演得像人，但"用户到底有没有办成事"必须可复现——
 * 否则复盘里的"你完成了入住"就是一句不可信的话。
 */
export interface ScenarioStage {
  id: string;
  /** NPC 进入这个阶段时说的话 */
  npc: string;
  /** 这一步用户要做到什么（中文，展示给用户） */
  goal: string;
  /** 判断用户这句话有没有把事情往前推。纯函数，可测 */
  advance: (text: string) => boolean;
  /** 没推进时 NPC 怎么接。仍然在角色里，不跳出来讲语法 */
  nudge: string[];
  hint: HintLadder;
}

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  title: string;
  titleEn: string;
  /** 场景背景，中文 */
  setting: string;
  /** NPC 演谁 */
  role: string;
  /** 用户演谁 */
  userRole: string;
  level: CEFR;
  /** 这一局要办成的事 */
  mission: string;
  /** 核心表达，练完要能用出来 */
  keyPhrases: { en: string; cn: string }[];
  /** 相关词 */
  keywords: string[];
  stages: ScenarioStage[];
  /** 评价标准：除了办成事，还看什么 */
  rubric: string[];
}

export interface ConversationMessage {
  id: string;
  role: 'coach' | 'user';
  text: string;
  at: number;
  /** 用户这句话是说的还是打的 */
  via?: 'typed' | 'spoken';
  /** 针对这句话的纠错 */
  corrections?: Correction[];
  /** 用了第几级提示（0 表示没用） */
  hintLevel?: number;
  /** 从上一条 coach 消息到用户提交，毫秒 */
  responseMs?: number;
  /** 这句话推进到了哪个阶段 */
  stageId?: string;
}

export interface Conversation {
  id: string;
  userId: string;
  scenarioId: string;
  startedAt: number;
  endedAt?: number;
  messages: ConversationMessage[];
  /** 完成了哪些阶段 */
  clearedStages: string[];
  /** 任务是否办成 */
  missionComplete: boolean;
  debrief?: Debrief;
  /** 这一局用的是本地引擎还是远端模型 */
  engine: 'local' | 'remote';
}

/** 对话复盘。第 8 节要求的七块内容 */
export interface Debrief {
  /** 你说得好的地方 */
  strengths: string[];
  /** 最重要的三个问题 */
  issues: Correction[];
  /** 更自然的表达 */
  naturalSwaps: { yours: string; better: string }[];
  /** 本次新词 */
  newWords: string[];
  /** 最值得重新练的一句 */
  redoLine?: { yours: string; target: string; why: string };
  /** 下一次练什么 */
  nextFocus: string;
  /** 客观数据 */
  metrics: Record<string, Measured>;
}

// ═══════════════════════ 学习计划与记录 ═══════════════════════

export type ActivityKind =
  | 'review' // 复习昨天的表达
  | 'vocab' // 词汇
  | 'listening' // 听力
  | 'speaking' // 口语跟读/自由表达
  | 'scenario' // 情景对话
  | 'writing' // 写作
  | 'reading' // 阅读
  | 'drill'; // 针对错误档案的专项练习

export const ACTIVITY_LABEL: Record<ActivityKind, string> = {
  review: '复习',
  vocab: '词汇',
  listening: '听力',
  speaking: '口语',
  scenario: '情景对话',
  writing: '写作',
  reading: '阅读',
  drill: '专项纠错',
};

export interface PlanActivity {
  id: string;
  kind: ActivityKind;
  /** 标题，例如"复习昨天的 5 个表达" */
  title: string;
  /** 为什么今天要练这个——这是用户最想知道的 */
  why: string;
  minutes: number;
  /** 这个活动要用到的具体材料 id（词、场景、听力材料） */
  payload?: { words?: string[]; scenarioId?: string; clipId?: string; ruleIds?: string[] };
  done?: boolean;
}

export interface LearningPlan {
  id: string;
  userId: string;
  /** YYYY-MM-DD */
  date: string;
  totalMinutes: number;
  activities: PlanActivity[];
  /** 今天这份计划是按什么逻辑排的 */
  rationale: string;
  createdAt: number;
}

export interface LearningSession {
  id: string;
  userId: string;
  date: string;
  startedAt: number;
  endedAt?: number;
  planId?: string;
  /** 完成了哪些活动 */
  completed: ActivityKind[];
  /** 真实花了多少毫秒 */
  elapsedMs: number;
}

export interface SpeakingRecord {
  id: string;
  userId: string;
  at: number;
  /** 目标句（跟读）或题目（自由表达） */
  target?: string;
  /** 识别出来的文本 */
  transcript: string;
  via: 'typed' | 'spoken';
  /** 真实可测的指标。拿不到的就不要有这个 key */
  metrics: Record<string, Measured>;
  corrections: Correction[];
}

export interface ListeningRecord {
  id: string;
  userId: string;
  at: number;
  clipId: string;
  speed: 'slow' | 'normal' | 'fast';
  /** 听了几遍才答对 */
  replays: number;
  correct: boolean;
}

export interface WritingRecord {
  id: string;
  userId: string;
  at: number;
  prompt: string;
  text: string;
  corrections: Correction[];
  metrics: Record<string, Measured>;
}

/** 能力曲线上的一个点 */
export interface ProgressPoint {
  date: string;
  levels: Partial<Record<SkillKey, CEFR>>;
  /** 那天的错误密度：每 100 词多少个错 */
  errorPer100?: number;
  minutes: number;
}

export interface LearningProgress {
  userId: string;
  points: ProgressPoint[];
}

// ═══════════════════════ 听力材料 ═══════════════════════

export interface ListeningClip {
  id: string;
  title: string;
  category: ScenarioCategory | 'news' | 'story';
  level: CEFR;
  /** 整段文本。用浏览器 TTS 朗读，不抓取任何有版权的音频 */
  lines: { speaker: string; text: string; cn: string }[];
  /** 理解题 */
  questions: { prompt: string; options: string[]; answer: number }[];
  /** 值得精听的词 */
  focusWords: string[];
}

// ═══════════════════════ 阅读材料 ═══════════════════════

export interface ReadingPiece {
  id: string;
  title: string;
  level: CEFR;
  paragraphs: string[];
  questions: { prompt: string; options: string[]; answer: number; explain: string }[];
  /** 生词表 */
  glossary: { word: string; meaning: string }[];
}
