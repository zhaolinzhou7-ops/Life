/**
 * 测评评分与能力画像
 *
 * 产出的不是"你是 B1"，而是第 3 节要的那种东西：
 *
 *   阅读 B1 / 听力 A2 / 口语 A2 / 词汇 B1 / 语法 A2
 *   你的主要瓶颈不是词汇量，而是"知道单词但无法快速组织成句子"。
 *
 * 后面那句话才是用户真正拿得走的东西，而它只有在**分技能测量**之后才算得出来。
 *
 * 评分规则全部写死在这里并且不引入随机：同一份答卷永远得到同一个结论。
 * 这不是技术洁癖——一个今天说你 B1、明天说你 A2 的测评，用户第二次就不会再做。
 */

import type {
  AssessAnswer,
  Assessment,
  Bottleneck,
  CEFR,
  ChoiceItem,
  Correction,
  Measured,
  OpenItem,
  SkillKey,
} from '../types';
import { CEFR_ORDER, PRODUCTIVE, RECEPTIVE, cefrFrom, cefrIndex, measured } from '../types';
import { CHOICE_ITEMS, OPEN_ITEMS } from '../data/assessment';
import { analyze } from './analyze';
import { newId } from '../store';

const ALL_ITEMS: (ChoiceItem | OpenItem)[] = [...CHOICE_ITEMS, ...OPEN_ITEMS];
const itemById = (id: string) => ALL_ITEMS.find((i) => i.id === id);

/**
 * 由"哪些难度的题做对了"定等级。
 *
 * 规则：取**答对的题里最高的那个难度**。全错就落到最低题难度的下一档
 * （最低到 A1）。刻意不用百分比——2 道题算百分比没有意义，而且百分比
 * 会把"难题对了、简单题手滑错了"算成中等，那是错的。
 */
function levelFromChoices(answers: AssessAnswer[], kinds: string[]): CEFR | undefined {
  const rows = answers
    .map((a) => ({ a, item: itemById(a.itemId) }))
    .filter((r): r is { a: AssessAnswer; item: ChoiceItem } => !!r.item && kinds.includes(r.item.kind));
  if (!rows.length) return undefined;

  const correct = rows.filter((r) => r.a.correct);
  if (correct.length) {
    const best = correct.reduce((m, r) => Math.max(m, cefrIndex(r.item.level)), 0);
    return cefrFrom(best);
  }
  const easiest = rows.reduce((m, r) => Math.min(m, cefrIndex(r.item.level)), 4);
  return cefrFrom(Math.max(0, easiest - 1));
}

/** 开放题：把用户写/说的内容交给本地分析引擎，取它估的等级的中位偏低值 */
function levelFromOpen(answers: AssessAnswer[], kinds: string[]): { level?: CEFR; corrections: Correction[]; texts: string[] } {
  const rows = answers.filter((a) => kinds.includes(a.kind) && a.text.trim().length > 0);
  if (!rows.length) return { corrections: [], texts: [] };
  const analyses = rows.map((r) => analyze(r.text));
  const corrections = analyses.flatMap((a) => a.corrections);
  // 取平均后向下取整：宁可低估一档，也不要给人一个虚高的等级
  const avg = analyses.reduce((s, a) => s + cefrIndex(a.estimatedLevel), 0) / analyses.length;
  return { level: cefrFrom(Math.floor(avg)), corrections, texts: rows.map((r) => r.text) };
}

/**
 * 语法等级。
 *
 * 单独算，因为它和"能不能说出来"是两件事：有人敢说但满是错，有人一句
 * 不敢说但写下来几乎没错。依据是产出题里的错误密度（每百词几处），
 * 这是数出来的，不是估的。
 */
function grammarLevel(errorPer100: number, wordCount: number): CEFR | undefined {
  if (wordCount < 12) return undefined; // 样本太少，不给结论
  if (errorPer100 <= 2) return 'B2';
  if (errorPer100 <= 5) return 'B1';
  if (errorPer100 <= 10) return 'A2';
  return 'A1';
}

const avgIdx = (levels: (CEFR | undefined)[]): number | undefined => {
  const xs = levels.filter((l): l is CEFR => !!l).map(cefrIndex);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
};

/**
 * 找瓶颈。
 *
 * 这是整个测评最有价值的一步，也是最容易说废话的一步。所以每个结论都
 * 必须挂着算出它的那个数——evidence 里写的都是真实测量值。
 */
function findBottleneck(
  levels: Partial<Record<SkillKey, CEFR>>,
  metrics: Record<string, Measured>,
): Bottleneck {
  const recept = avgIdx(RECEPTIVE.map((k) => levels[k]));
  const produce = avgIdx(PRODUCTIVE.map((k) => levels[k]));
  const evidence: string[] = [];

  const lvl = (k: SkillKey) => (levels[k] ? `${levels[k]}` : '未测');

  // 1. 会看不会说：接收和产出差一档以上。这是成年人最典型的画像
  if (recept !== undefined && produce !== undefined && recept - produce >= 1) {
    evidence.push(`阅读 ${lvl('reading')}、听力 ${lvl('listening')}、词汇 ${lvl('vocabulary')}，但口语 ${lvl('speaking')}、写作 ${lvl('writing')}`);
    if (metrics.recognizeVsUse) {
      evidence.push(
        `词汇辨认答对 ${metrics.recognizeCorrect.value}/${metrics.recognizeTotal.value}，但要你选出自然说法时只对 ${metrics.useCorrect.value}/${metrics.useTotal.value}`,
      );
    }
    if (metrics.openResponseSec) {
      evidence.push(`自由表达的中位反应时间 ${metrics.openResponseSec.value} 秒`);
    }
    return {
      key: 'receptive-productive-gap',
      title: '你的瓶颈不是词汇量，而是"知道，但组织不成句子"',
      evidence,
      focus: ['speaking', 'grammar'],
    };
  }

  // 2. 听力单独塌陷
  const listen = levels.listening ? cefrIndex(levels.listening) : undefined;
  const others = avgIdx([levels.reading, levels.vocabulary]);
  if (listen !== undefined && others !== undefined && others - listen >= 1) {
    evidence.push(`阅读 ${lvl('reading')}、词汇 ${lvl('vocabulary')}，听力只有 ${lvl('listening')}`);
    if (metrics.listeningFast) evidence.push(`正常语速及以上的听力题答对 ${metrics.listeningFast.value} 道`);
    return {
      key: 'listening-gap',
      title: '文字看得懂，声音跟不上',
      evidence,
      focus: ['listening'],
    };
  }

  // 3. 语法准确度拖后腿
  if (metrics.errorPer100 && metrics.errorPer100.value >= 8) {
    evidence.push(`你写/说的内容里每百词有 ${metrics.errorPer100.value} 处问题`);
    if (metrics.chinglishRatio) evidence.push(`其中 ${Math.round(metrics.chinglishRatio.value * 100)}% 属于中文直译，不是语法不会`);
    return {
      key: metrics.chinglishRatio && metrics.chinglishRatio.value > 0.5 ? 'chinglish' : 'grammar-accuracy',
      title:
        metrics.chinglishRatio && metrics.chinglishRatio.value > 0.5
          ? '语法基本没问题，问题出在"中文思路直接翻过来"'
          : '意思能传达，但基础语法形式还在丢分',
      evidence,
      focus: ['grammar', 'writing'],
    };
  }

  // 4. 反应慢
  if (metrics.openResponseSec && metrics.openResponseSec.value > 45) {
    evidence.push(`自由表达题的中位用时 ${metrics.openResponseSec.value} 秒`);
    return { key: 'fluency', title: '说得出来，但在心里翻译的时间太长', evidence, focus: ['speaking'] };
  }

  // 5. 产出量太小
  if (metrics.openWords && metrics.openWords.value < 25) {
    evidence.push(`两道开放题一共只写/说了 ${metrics.openWords.value} 个词`);
    return { key: 'fluency', title: '还不太敢展开说，句子都很短', evidence, focus: ['speaking', 'writing'] };
  }

  evidence.push('各项能力之间没有出现明显的塌陷');
  return { key: 'balanced', title: '各项比较均衡，按计划稳步加量就行', evidence, focus: ['speaking', 'listening'] };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};

export interface ScoreInput {
  userId: string;
  answers: AssessAnswer[];
  now?: number;
}

export function scoreAssessment({ userId, answers, now = Date.now() }: ScoreInput): Assessment {
  // ————— 选择题：客观对错 —————
  const scored = answers.map((a) => {
    const item = itemById(a.itemId);
    if (item && 'answer' in item) return { ...a, correct: a.choice === item.answer };
    return a;
  });

  const countOf = (kind: string, onlyCorrect = false) =>
    scored.filter((a) => a.kind === kind && (!onlyCorrect || a.correct)).length;

  // ————— 开放题：交给本地分析引擎 —————
  const open = levelFromOpen(scored, ['translate', 'write', 'speak']);
  const openText = open.texts.join(' ');
  const openAnalysis = analyze(openText);
  const openTimes = scored.filter((a) => ['write', 'speak'].includes(a.kind)).map((a) => a.elapsedMs);

  const chinglish = open.corrections.filter((c) => c.kind === 'chinglish' || c.kind === 'word-choice').length;

  const metrics: Record<string, Measured> = {
    recognizeCorrect: measured(countOf('vocab-recognize', true), 'counted', '词汇辨认题答对数', '题'),
    recognizeTotal: measured(countOf('vocab-recognize'), 'counted', '词汇辨认题总数', '题'),
    useCorrect: measured(countOf('vocab-use', true), 'counted', '词汇运用题答对数', '题'),
    useTotal: measured(countOf('vocab-use'), 'counted', '词汇运用题总数', '题'),
    listeningCorrect: measured(countOf('listening', true), 'counted', '听力题答对数', '题'),
    readingCorrect: measured(countOf('reading', true), 'counted', '阅读题答对数', '题'),
    openWords: measured(openAnalysis.metrics.wordCount.value, 'counted', '开放题一共写/说了多少词', '词'),
    errorPer100: openAnalysis.metrics.errorPer100,
    errorCount: openAnalysis.metrics.errorCount,
  };

  metrics.recognizeVsUse = measured(
    metrics.recognizeTotal.value && metrics.useTotal.value
      ? Math.round(
          (metrics.recognizeCorrect.value / metrics.recognizeTotal.value -
            metrics.useCorrect.value / Math.max(1, metrics.useTotal.value)) *
            100,
        ) / 100
      : 0,
    'derived',
    '辨认正确率 − 运用正确率。差值越大，"认识但不会用"越明显',
  );

  if (open.corrections.length) {
    metrics.chinglishRatio = measured(
      Math.round((chinglish / open.corrections.length) * 100) / 100,
      'derived',
      '中文直译类问题 ÷ 全部问题',
    );
  }
  if (openTimes.length) {
    metrics.openResponseSec = measured(
      Math.round(median(openTimes) / 1000),
      'timed',
      '从题目出现到提交的中位用时。含打字/说话本身的时间，不等于纯思考时间',
      '秒',
    );
  }
  const fastListening = scored.filter((a) => {
    const item = itemById(a.itemId);
    return item && 'speed' in item && item.speed !== 'slow' && a.correct;
  }).length;
  metrics.listeningFast = measured(fastListening, 'counted', '正常语速及以上的听力题答对数', '题');

  // ————— 分技能等级 —————
  const reading = levelFromChoices(scored, ['reading']);
  const listening = levelFromChoices(scored, ['listening']);
  const vocabulary = levelFromChoices(scored, ['vocab-recognize', 'vocab-use']);
  const speakAns = scored.filter((a) => a.kind === 'speak' && a.text.trim());
  const writeAns = scored.filter((a) => ['write', 'translate'].includes(a.kind) && a.text.trim());
  const speaking = speakAns.length ? levelFromOpen(scored, ['speak']).level : undefined;
  const writing = writeAns.length ? levelFromOpen(scored, ['write', 'translate']).level : undefined;
  const grammar = grammarLevel(metrics.errorPer100.value, metrics.openWords.value);

  const levels: Record<SkillKey, CEFR> = {
    reading: reading ?? 'A1',
    listening: listening ?? 'A1',
    speaking: speaking ?? 'A1',
    writing: writing ?? 'A1',
    vocabulary: vocabulary ?? 'A1',
    grammar: grammar ?? 'A1',
  };

  const present: Partial<Record<SkillKey, CEFR>> = { reading, listening, speaking, writing, vocabulary, grammar };
  const bottleneck = findBottleneck(present, metrics);

  return {
    id: newId('as'),
    userId,
    createdAt: now,
    answers: scored,
    levels,
    metrics,
    bottleneck,
    summary: buildSummary(levels, metrics, bottleneck),
    findings: open.corrections,
  };
}

/** 综合等级：接收和产出各占一半。不用六项平均——那会让"会看不会说"的人虚高 */
export function overallLevel(levels: Record<SkillKey, CEFR>): CEFR {
  const r = avgIdx(RECEPTIVE.map((k) => levels[k])) ?? 0;
  const p = avgIdx(PRODUCTIVE.map((k) => levels[k])) ?? 0;
  return cefrFrom((r + p) / 2);
}

function buildSummary(
  levels: Record<SkillKey, CEFR>,
  metrics: Record<string, Measured>,
  bottleneck: Bottleneck,
): string[] {
  const out: string[] = [];
  out.push(`综合看，你目前大致在 ${overallLevel(levels)} 这一档。`);
  out.push(bottleneck.title + '。');

  const gap = metrics.recognizeVsUse?.value ?? 0;
  if (gap >= 0.3) {
    out.push(
      `词汇上有一个值得注意的现象：认得出的比用得上的多。这说明你需要的不是"再背一千个词"，而是把已经认识的词练到能张口用。`,
    );
  }
  const err = metrics.errorPer100?.value ?? 0;
  if (err > 0) {
    out.push(`你写/说的内容里每百词大约有 ${err} 处可以改进的地方，其中最值得先处理的已经列在下面。`);
  }
  if (metrics.openWords && metrics.openWords.value < 30) {
    out.push('这次开放题写得比较短，所以口语和写作的判断只能算初步参考，后面多练几次会更准。');
  }
  return out;
}

/** 每个技能下面要显示的一句依据。界面上点开等级就能看到凭什么 */
export function evidenceFor(skill: SkillKey, metrics: Record<string, Measured>): string {
  switch (skill) {
    case 'reading':
      return `阅读题答对 ${metrics.readingCorrect?.value ?? 0} 道，等级取答对题目里最难的那一档`;
    case 'listening':
      return `听力题答对 ${metrics.listeningCorrect?.value ?? 0} 道，其中正常语速及以上 ${metrics.listeningFast?.value ?? 0} 道`;
    case 'vocabulary':
      return `辨认 ${metrics.recognizeCorrect?.value ?? 0}/${metrics.recognizeTotal?.value ?? 0}，运用 ${metrics.useCorrect?.value ?? 0}/${metrics.useTotal?.value ?? 0}`;
    case 'grammar':
      return `开放题里每百词 ${metrics.errorPer100?.value ?? 0} 处问题（共 ${metrics.openWords?.value ?? 0} 词）`;
    case 'speaking':
      return metrics.openResponseSec
        ? `根据自由表达的内容和用时判断，中位用时 ${metrics.openResponseSec.value} 秒`
        : '根据自由表达的内容判断';
    case 'writing':
      return `根据翻译和写作题的句子长度、用词和准确度判断（共 ${metrics.openWords?.value ?? 0} 词）`;
  }
}

export { CEFR_ORDER };
