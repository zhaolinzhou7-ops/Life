/**
 * 内置引擎（Mock 模式）
 *
 * 这不是「占位实现」。没有 API Key 时，这就是产品的全部 AI 能力，
 * 而且必须让一个孩子能完整地学下去（§27）：对话能对、纠错能纠、
 * 故事能听、报告能出。做不到这一点，所谓的 Mock 模式就是骗自己。
 *
 * 实现方式是规则 + 模板 + 本地数据，全部确定性（同一个 seed 结果一致），
 * 所以它同时也是测试里的稳定基准：接不接网关，学习逻辑的行为都应该一样。
 *
 * 它做不到的事情，也写清楚：
 *  · 编不出超出模板结构的故事
 *  · 听不懂孩子完全离题的话，只能把话题拉回来
 *  · 生成的练习题不会比模板更有创意
 * 这些正是接真实模型的价值所在（见 remote.ts）。
 */

import type { CoachReply, SpeechJudgement, Story, StoryPage, StoryQuestion } from '../types';
import { getNode, firstNode } from '../data/dialog';
import { distractors, getWord, withArticle } from '../data/vocab';
import { INVITE_SPEAK, ON_SKIP, PRAISE, TRANSITION, hintFor, pick } from '../data/phrases';
import { judgeSpeech, normalize, wordSimilar } from '../engine/speech';
import { describeParticipation, describeSkill } from '../engine/profile';
import { masteredWords, learningWords } from '../engine/review';
import { rng, shuffle } from '../engine/util';
import { DEFLECT, checkOutbound, scrubChildInput } from './safety';
import type {
  AiProvider,
  AssessmentReport,
  AssessmentRequest,
  ChatRequest,
  ContentRequest,
  CorrectionRequest,
  GeneratedItem,
  StoryRequest,
} from './types';

/** 孩子的回答有没有命中期望。open 的节点只要开口就算 */
function matches(said: string, expect: string[], open: boolean): boolean {
  const s = normalize(said);
  if (!s) return false;
  if (open) return s.split(' ').filter(Boolean).length >= 1;
  if (!expect.length) return true;
  const words = s.split(' ').filter(Boolean);
  return expect.some((e) => {
    const en = normalize(e);
    if (s.includes(en)) return true;
    // 单个词的期望允许发音接近（孩子说 "aperr" 也算说出了 apple）
    return en.split(' ').length === 1 && words.some((w) => wordSimilar(w, en) >= 0.72);
  });
}

/**
 * 从孩子的话里摘一个词填进回应模板，让教练的回应像真的在听。
 *
 * 匹配在归一化之后做，但**返回的是原文里的那一段**——
 * 归一化会把大小写抹平，于是 "Mimi" 会被念成 "nice to meet you, mimi"。
 * 名字被写成小写，孩子第一眼就会觉得这个伙伴不认真。
 */
function echoOf(said: string, expect: string[]): string {
  const raw = said.trim();
  const s = normalize(raw);
  const hit = expect.map(normalize).find((e) => e && s.includes(e));
  const words = s.split(' ').filter((w) => w.length > 1);
  const picked = hit ?? words[words.length - 1] ?? s;
  if (!picked) return raw;
  const i = raw.toLowerCase().indexOf(picked);
  return i >= 0 ? raw.slice(i, i + picked.length) : picked;
}

export const mockProvider: AiProvider = {
  id: 'mock',
  name: '内置引擎',
  available: () => ({ ok: true }),

  async chat(req: ChatRequest): Promise<CoachReply> {
    const lastCoach = [...req.history].reverse().find((t) => t.role === 'coach');
    const node = getNode(lastCoach?.nodeId ?? '') ?? firstNode(req.level);

    // 开场：还没说过话，直接抛出第一个问题
    if (!lastCoach) {
      return {
        say: node.ask,
        emoji: node.emoji,
        expect: node.expect,
        hint: node.hint,
        nodeId: node.id,
        wordIds: node.wordIds,
      };
    }

    // 先过安全：孩子说了敏感信息就安静地抹掉并换话题，不追问、不评判
    const scrub = scrubChildInput(req.childSaid);
    if (scrub.found) {
      const next = getNode(node.next ?? '');
      return {
        say: pick(DEFLECT, req.seed),
        emoji: '🙂',
        expect: next?.expect,
        hint: next?.hint,
        nodeId: next?.id ?? node.id,
        safetyNote: `孩子在对话中说到了${scrub.labels.join('、')}，系统没有记录，也没有追问。`,
        judged: 'skip',
      };
    }

    const said = scrub.text;

    // 没听到 / 没回答
    if (req.silent || !said.trim()) {
      if (req.hintCount >= 2) {
        const next = getNode(node.next ?? '');
        return {
          say: `${pick(ON_SKIP, req.seed)} ${next?.ask ?? "Let's play a game!"}`,
          emoji: next?.emoji ?? '🎈',
          expect: next?.expect,
          hint: next?.hint,
          nodeId: next?.id,
          end: !next,
          judged: 'skip',
          wordIds: node.wordIds,
        };
      }
      return {
        say: `${node.hint} ${pick(INVITE_SPEAK, req.seed)}`,
        emoji: node.emoji,
        expect: node.expect,
        hint: node.hint,
        nodeId: node.id,
        judged: 'skip',
      };
    }

    const ok = matches(said, node.expect, !!node.open);

    if (ok) {
      const next = getNode(node.next ?? '');
      const echo = node.echo.replace('{a}', echoOf(said, node.expect));
      const say = next ? `${echo} ${next.ask}` : `${echo} ${pick(PRAISE, req.seed)}`;
      return {
        say,
        emoji: next?.emoji ?? '🎉',
        expect: next?.expect,
        hint: next?.hint,
        nodeId: next?.id,
        end: !next,
        judged: req.hintCount > 0 ? 'close' : 'right',
        wordIds: node.wordIds,
      };
    }

    // 答得不对：先给提示，不直接公布答案（§10）
    if (req.hintCount === 0) {
      const target = node.expect[0] ?? '';
      return {
        say: `Good try! ${target ? hintFor(target, 1) : node.hint}`,
        emoji: node.emoji,
        expect: node.expect,
        hint: node.hint,
        nodeId: node.id,
        judged: 'wrong',
        wordIds: node.wordIds,
      };
    }
    if (req.hintCount === 1) {
      const target = node.expect[0] ?? '';
      return {
        say: target ? hintFor(target, 2) : node.hint,
        emoji: node.emoji,
        expect: node.expect,
        hint: node.hint,
        nodeId: node.id,
        judged: 'wrong',
        wordIds: node.wordIds,
      };
    }

    // 两次提示之后给答案，但要求跟读一次再往下走
    const target = node.expect[0] ?? '';
    const next = getNode(node.next ?? '');
    return {
      say: `${target ? hintFor(target, 3) : ''} ${pick(TRANSITION, req.seed)} ${next?.ask ?? ''}`.trim(),
      emoji: next?.emoji ?? node.emoji,
      expect: next?.expect,
      hint: next?.hint,
      nodeId: next?.id,
      end: !next,
      judged: 'wrong',
      wordIds: node.wordIds,
    };
  },

  async correction(req: CorrectionRequest): Promise<SpeechJudgement> {
    return judgeSpeech({
      target: req.target,
      heard: req.heard,
      seed: req.seed,
      attempt: req.attempt,
    });
  },

  /**
   * 故事生成。
   *
   * 模板是「出场 → 重复 → 变化 → 收尾」，每个目标词至少出现三次。
   * 句子长度按 level 卡死，这是故事难度自适应真正落地的地方（§14）。
   */
  async story(req: StoryRequest): Promise<Story> {
    const rnd = rng(req.seed);
    const words = req.words.slice(0, 3);
    const hero = pick(['Tom', 'Mia', 'Ben', 'Lily', 'Sam'], req.seed);
    const heroEmoji = pick(['👦', '👧', '🧒'], req.seed >> 3);

    const pages: StoryPage[] = [{ text: `This is ${hero}.`, emoji: heroEmoji }];

    for (const w of words) {
      const s = w.sentences.find((x) => x.level === Math.min(3, req.level)) ?? w.sentences[0];
      if (req.level <= 1) {
        pages.push({ text: `${hero} sees ${withArticle(w)}.`, emoji: w.emoji, highlight: w.en });
        pages.push({ text: `The ${w.en}!`, emoji: w.emoji, highlight: w.en });
      } else if (req.level === 2) {
        pages.push({ text: `${hero} sees ${withArticle(w)}.`, emoji: w.emoji, highlight: w.en });
        pages.push({ text: s.text, emoji: w.emoji, highlight: w.en });
      } else {
        pages.push({ text: `Then ${hero} finds ${withArticle(w)} by the door.`, emoji: w.emoji, highlight: w.en });
        pages.push({ text: s.text, emoji: w.emoji, highlight: w.en });
      }
    }

    const last = words[words.length - 1];
    pages.push({
      text: req.level <= 1 ? `${hero} is happy!` : `${hero} is very happy, and goes home.`,
      emoji: '😄',
    });

    const questions: StoryQuestion[] = [];
    for (const w of words.slice(0, 2)) {
      const others = distractors(w, 2, rnd);
      questions.push({
        kind: 'choice',
        ask: `What does ${hero} see?`,
        askZh: `${hero} 看到了什么？`,
        wordId: w.id,
        options: shuffle(
          [
            { label: w.en, emoji: w.emoji, correct: true },
            ...others.map((o) => ({ label: o.en, emoji: o.emoji, correct: false })),
          ],
          rnd,
        ),
      });
    }
    if (last && req.level >= 2) {
      questions.push({
        kind: 'speak',
        ask: `Tell me one thing about ${hero}.`,
        askZh: `说一句关于 ${hero} 的话`,
        expect: [last.en, hero.toLowerCase(), 'happy'],
        wordId: last.id,
      });
    }

    return {
      id: `st-gen-${req.seed}`,
      title: `${hero} and the ${last?.en ?? 'Day'}`,
      level: req.level,
      theme: (words[0]?.theme ?? 'toy') as Story['theme'],
      coverEmoji: words[0]?.emoji ?? '📖',
      words: words.map((w) => w.id),
      pages,
      questions,
      learningOutcome: `能在故事里听懂并复述：${words.map((w) => w.en).join(', ')}`,
    };
  },

  /** 按薄弱点现编选择题。图片和干扰项都来自本地词库，不会出现编造的词 */
  async content(req: ContentRequest): Promise<GeneratedItem[]> {
    const rnd = rng(req.seed);
    const listenWeak = req.weaknesses.some((w) => w.prescription.boostSkills.includes('listening'));
    return req.words.slice(0, 8).map((w) => {
      const others = distractors(w, 2, rnd);
      const opts = shuffle(
        [
          { wordId: w.id, emoji: w.emoji, label: w.en, correct: true },
          ...others.map((o) => ({ wordId: o.id, emoji: o.emoji, label: o.en, correct: false })),
        ],
        rnd,
      );
      return {
        wordId: w.id,
        ask: listenWeak ? `Where is the ${w.en}?` : w.ask,
        askZh: listenWeak ? '听一听，点出对的那张图' : '这是什么？',
        options: opts,
        why: listenWeak ? '针对"听不出来"，先听再指' : '看图识别，巩固词形和意思的连接',
      };
    });
  },

  /**
   * 家长报告。
   *
   * 不堆指标（§18）。每一段都是一句人话 + 一个能核对的数字，
   * 建议部分必须是家长明天就能做的动作，不是「请多陪伴」这种废话。
   */
  async assessment(req: AssessmentRequest): Promise<AssessmentReport> {
    const mastered = masteredWords(req.memories);
    const learning = learningWords(req.memories).filter((m) => m.seen > 0);
    const p = req.profile.english;

    const headline =
      req.sessionsThisWeek === 0
        ? '这周还没有学习记录。'
        : `这周学了 ${req.sessionsThisWeek} 次，一共 ${req.minutesThisWeek} 分钟。${
            req.profile.streak > 1 ? `已经连续 ${req.profile.streak} 天了。` : ''
          }`;

    const advice: string[] = [];
    for (const w of req.weaknesses.slice(0, 2)) {
      if (w.prescription.note) advice.push(w.prescription.note);
    }
    if (req.minutesThisWeek < 40 && req.sessionsThisWeek > 0) {
      advice.push('每天 10~15 分钟就够，但要尽量每天都有。隔三天学一次，前面学的基本会忘掉。');
    }
    if (!advice.length) {
      const themes = new Set(
        mastered.map((m) => getWord(m.wordId)?.theme).filter((t): t is NonNullable<typeof t> => !!t),
      );
      advice.push(
        themes.size >= 3
          ? '目前节奏很好，保持每天 10~15 分钟即可。下周会开始加入更长的句子。'
          : '下周继续强化已经学过的主题，等这些词稳了再铺新的。',
      );
    }
    advice.push('孩子说错的时候不用纠正发音，让他继续说下去就好——这个阶段愿意开口比说得准更重要。');

    return {
      headline,
      // 学习记录还少时，词汇水平的判断几乎全来自那十道测评题。
      // 不说明这一点，就会出现「掌握 0 个」和「常见词大多认识」并排出现的怪画面。
      vocabulary:
        `掌握 ${mastered.length} 个，正在学 ${learning.length} 个。${describeSkill('vocabulary', p.vocabulary)}` +
        (req.memories.length < 8
          ? '（学习记录还少，这个判断主要来自入门测评，接下来几天会逐步校准。）'
          : ''),
      listening: describeSkill('listening', p.listening),
      speaking: `${describeSkill('speaking', p.speaking)}${describeParticipation(p.participation)}`,
      advice: advice.slice(0, 3),
    };
  },
};

/** 供 remote 复用：把模型返回的一句话过一遍安全规则 */
export function safeSay(text: string, fallback: string): { say: string; note?: string } {
  const v = checkOutbound(text);
  if (v.ok) return { say: text };
  return { say: v.replacement ?? fallback, note: v.note };
}
