/**
 * 游戏定义
 *
 * §21 的硬要求：每个活动都必须能回答「孩子完成这个活动之后，具体学会了什么」。
 * 所以游戏不是「娱乐模块」，每一个都写死了它练的能力维度和产出的学习结论，
 * 结束页会把这句话念给孩子听，家长端也会原样展示。
 *
 * 四个游戏各自针对一种薄弱点，任务生成器按薄弱点选，不是随机挑：
 *   findit      听 → 指   治「听不懂」
 *   match       看 → 配   治「认不出」
 *   listen-jump 听 → 做   治「反应不过来」（听力指令，要求即时反应）
 *   echo        听 → 说   治「不敢开口」
 */

import type { GameId, SkillId } from '../types';

export interface GameDef {
  id: GameId;
  title: string;
  titleZh: string;
  emoji: string;
  /** 主要练哪些维度，用于薄弱点匹配 */
  skills: SkillId[];
  /** 一句话说明这个游戏练什么，儿童端进入前朗读 */
  intro: string;
  introZh: string;
  /** 学习结论模板，{words} 替换成这一局用到的词 */
  outcome: string;
  /** 一局大概几道题 */
  rounds: number;
  estimateMin: number;
  /** 需要麦克风。家长关掉语音时，这类游戏会被替换掉 */
  needsVoice?: boolean;
}

export const GAMES: GameDef[] = [
  {
    id: 'findit',
    title: 'Find It!',
    titleZh: '听声音找图',
    emoji: '🔍',
    skills: ['listening', 'vocabulary'],
    intro: 'Listen and tap the right picture.',
    introZh: '听一听，点出对的那张图',
    outcome: '能听懂并认出：{words}',
    rounds: 6,
    estimateMin: 2,
  },
  {
    id: 'match',
    title: 'Match Up',
    titleZh: '单词配对',
    emoji: '🧩',
    skills: ['vocabulary', 'reading'],
    intro: 'Match the word with the picture.',
    introZh: '把单词和图片连起来',
    outcome: '能把单词和图片对上：{words}',
    rounds: 5,
    estimateMin: 2,
  },
  {
    id: 'listen-jump',
    title: 'Listen and Move',
    titleZh: '听力打怪',
    emoji: '🐸',
    skills: ['listening', 'comprehension'],
    intro: 'Only move when you hear the right word!',
    introZh: '听到对的词才能动，听错就会掉下去',
    outcome: '能听懂动作指令并马上反应：{words}',
    rounds: 8,
    estimateMin: 2,
  },
  {
    id: 'echo',
    title: 'Say It Back',
    titleZh: '跟读挑战',
    emoji: '🎤',
    skills: ['speaking', 'pronunciation'],
    intro: 'Listen, then say it back to me!',
    introZh: '听一句，说一句',
    outcome: '能开口说出：{words}',
    rounds: 5,
    estimateMin: 3,
    needsVoice: true,
  },
];

const BY_ID = new Map(GAMES.map((g) => [g.id, g]));

export function getGame(id: GameId): GameDef {
  const g = BY_ID.get(id);
  if (!g) throw new Error(`没有这个游戏：${id}`);
  return g;
}
