/**
 * AI 能力接口
 *
 * 五个能力刻意拆开（§26）。产品的其它部分只认这个接口，
 * 不认「某家模型的调用方式」——换模型、换网关、甚至换成纯本地规则，
 * 都不该让儿童端视图改一行代码。
 *
 *   chat       —— 对话教练。给一轮对话，返回教练该说什么
 *   content    —— 内容生成。按薄弱点现编练习题
 *   correction —— 纠错。把「说得对不对」翻译成儿童能接受的一句话
 *   assessment —— 评估。把画像和薄弱点写成给家长看的报告
 *   story      —— 故事生成。按孩子当前水平和目标词编一个短故事
 *
 * 每个能力都有 Mock 实现（ai/mock.ts），所以没有 API Key 时整个产品
 * 功能完整，不是「灰掉的按钮」。
 */

import type {
  ChildProfile,
  CoachTurn,
  CoachReply,
  SpeechJudgement,
  Story,
  Word,
  WordMemory,
} from '../types';
import type { Weakness } from '../engine/weakness';

export interface ChatRequest {
  profile: ChildProfile;
  level: 1 | 2 | 3;
  history: CoachTurn[];
  /** 孩子这一轮说的（已经过 safety.scrubChildInput） */
  childSaid: string;
  /** 孩子是不是没听清/没回答 */
  silent?: boolean;
  /** 这一轮用了几次提示 */
  hintCount: number;
  seed: number;
}

export interface CorrectionRequest {
  target: string;
  heard: string;
  /** 第几次尝试 */
  attempt: number;
  profile: ChildProfile;
  seed: number;
}

export interface StoryRequest {
  level: 1 | 2 | 3 | 4;
  /** 必须出现的目标词 */
  words: Word[];
  theme: string;
  seed: number;
}

export interface ContentRequest {
  profile: ChildProfile;
  weaknesses: Weakness[];
  words: Word[];
  seed: number;
}

/** 现编的一道练习题 */
export interface GeneratedItem {
  wordId: string;
  ask: string;
  askZh: string;
  options: { wordId: string; emoji: string; label: string; correct: boolean }[];
  /** 这道题在练什么 */
  why: string;
}

export interface AssessmentRequest {
  profile: ChildProfile;
  memories: WordMemory[];
  weaknesses: Weakness[];
  /** 最近一周的学习分钟数 */
  minutesThisWeek: number;
  sessionsThisWeek: number;
}

export interface AssessmentReport {
  /** 一句话总结 */
  headline: string;
  vocabulary: string;
  listening: string;
  speaking: string;
  /** 下周建议，给家长的具体动作 */
  advice: string[];
}

export interface AiProvider {
  id: 'mock' | 'remote';
  name: string;
  /** 能不能用。不能用时给出人话解释，显示在家长端设置页 */
  available(): { ok: boolean; reason?: string };

  chat(req: ChatRequest): Promise<CoachReply>;
  correction(req: CorrectionRequest): Promise<SpeechJudgement>;
  story(req: StoryRequest): Promise<Story>;
  content(req: ContentRequest): Promise<GeneratedItem[]>;
  assessment(req: AssessmentRequest): Promise<AssessmentReport>;
}

/** 一次 AI 调用的结果，带上降级信息，让界面能诚实地说明发生了什么 */
export interface AiOutcome<T> {
  data: T;
  /** 实际用的是哪个 provider */
  engine: 'mock' | 'remote';
  /** 降级说明。只在家长端显示，儿童端永远不显示技术信息 */
  fallbackNote?: string;
  /** 安全规则拦截说明 */
  safetyNote?: string;
}
