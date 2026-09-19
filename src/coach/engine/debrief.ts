/**
 * 对话复盘
 *
 * 第 8 节要求的七块内容。这是这个产品最核心的差异化功能——
 * 能陪聊的产品很多，聊完能说清"你哪里不行、下次练什么"的很少。
 *
 * 所有结论都必须能追溯到这次对话里的真实数据：
 *   · "你完成了入住" ← clearedStages 里有那个阶段
 *   · "你反应偏慢"   ← 真实计时出来的中位数
 *   · "你靠提示说出来的" ← hintLevel 记下来了
 *
 * 唯一不做的事：编一个"流利度 82 分"。没有可靠的测量方式就不给分数，
 * 只给能说清口径的事实。
 */

import type { Conversation, Correction, Debrief, Measured, Scenario } from '../types';
import { measured } from '../types';
import { analyze, topIssues } from './analyze';
import { spontaneousHits } from './srs';
import { VOCAB } from '../data/vocab';

/** 中位数。平均数会被一次"去倒水了"的超长停顿带偏，中位数稳得多 */
function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = nums.slice().sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

export function buildDebrief(conv: Conversation, scenario: Scenario): Debrief {
  const userMsgs = conv.messages.filter((m) => m.role === 'user');
  const allText = userMsgs.map((m) => m.text).join(' ');
  const a = analyze(allText);

  // ————— 客观指标：全部来自这次对话真实记录下来的东西 —————
  const responseTimes = userMsgs.map((m) => m.responseMs ?? 0).filter((n) => n > 0);
  const hintUsed = userMsgs.filter((m) => (m.hintLevel ?? 0) > 0);
  const spokenCount = userMsgs.filter((m) => m.via === 'spoken').length;

  const metrics: Record<string, Measured> = {
    turns: measured(userMsgs.length, 'counted', '你说话的轮数', '轮'),
    words: measured(a.metrics.wordCount.value, 'counted', '你这一局一共说了多少词', '词'),
    avgWordsPerTurn: measured(
      userMsgs.length ? Math.round((a.metrics.wordCount.value / userMsgs.length) * 10) / 10 : 0,
      'derived',
      '总词数 ÷ 轮数',
      '词/轮',
    ),
    stagesCleared: measured(conv.clearedStages.length, 'counted', `任务一共 ${scenario.stages.length} 步，你完成了几步`, '步'),
    errorPer100: a.metrics.errorPer100,
    hintTurns: measured(hintUsed.length, 'counted', '有几轮是看了提示才说出来的', '轮'),
  };

  if (responseTimes.length) {
    metrics.medianResponse = measured(
      Math.round(median(responseTimes) / 100) / 10,
      'timed',
      '从对方说完到你提交，取中位数。包含你打字/组织语言的时间，不等于纯思考时间',
      '秒',
    );
  }
  if (spokenCount) {
    metrics.spokenTurns = measured(spokenCount, 'counted', '有几轮是说出来的（其余是打字）', '轮');
  }

  // ————— 你说得好的地方 —————
  const strengths: string[] = [];
  if (conv.missionComplete) {
    strengths.push(`你把${scenario.title}这件事办成了——${scenario.mission}。`);
  } else if (conv.clearedStages.length > 0) {
    strengths.push(`${scenario.stages.length} 步里你完成了 ${conv.clearedStages.length} 步。`);
  }
  for (const s of a.strengths.slice(0, 2)) strengths.push(`${s.text}（${s.evidence}）`);
  const selfMade = userMsgs.length - hintUsed.length;
  if (selfMade > 0 && userMsgs.length > 0) {
    strengths.push(`${userMsgs.length} 轮里有 ${selfMade} 轮是你自己说出来的，没看提示。`);
  }

  // ————— 最重要的三个问题 —————
  const issues = topIssues(a.corrections, 3);

  // ————— 更自然的表达 —————
  const naturalSwaps = a.upgrades.map((u) => ({ yours: u.yours, better: u.better }));
  // 场景里的核心表达，用户没用到的也算"更自然的说法"
  for (const p of scenario.keyPhrases) {
    if (naturalSwaps.length >= 4) break;
    const used = allText.toLowerCase().includes(p.en.toLowerCase().slice(0, 12));
    if (!used) naturalSwaps.push({ yours: `（${p.cn}）`, better: p.en });
  }

  // ————— 本次新词：用户自己用出来的场景核心词 —————
  const candidates = VOCAB.filter((v) => v.tags.includes(scenario.category)).map((v) => v.word);
  const newWords = [...new Set([...spontaneousHits(allText, candidates), ...spontaneousHits(allText, scenario.keywords)])];

  // ————— 最值得重新练的一句 —————
  const redo = pickRedoLine(conv, issues);

  return {
    strengths: strengths.slice(0, 4),
    issues,
    naturalSwaps: naturalSwaps.slice(0, 4),
    newWords: newWords.slice(0, 6),
    redoLine: redo,
    nextFocus: nextFocus(conv, scenario, issues, metrics),
    metrics,
  };
}

/**
 * 挑一句最值得重说的。
 *
 * 优先挑"有严重错误的那句"，因为重说一遍带来的收益最大；
 * 没有严重错误就挑最长的那句——长句是成年人最容易露馅的地方。
 */
function pickRedoLine(conv: Conversation, issues: Correction[]): Debrief['redoLine'] {
  const userMsgs = conv.messages.filter((m) => m.role === 'user');
  if (!userMsgs.length) return undefined;

  const worst = issues[0];
  if (worst?.sentence) {
    const target = worst.sentence.replace(worst.original, worst.fixed);
    return {
      yours: worst.sentence,
      target,
      why: `${worst.problem}。改完再说一遍，让这个结构过一次嘴。`,
    };
  }

  const longest = userMsgs.slice().sort((a, b) => b.text.length - a.text.length)[0];
  if (longest.text.split(/\s+/).length < 5) return undefined;
  const corrected = analyze(longest.text).corrected;
  return {
    yours: longest.text,
    // 这句话本来就没错时，target 会和 yours 一模一样。界面据此改成
    // "再说一遍"而不是画一个前后对照——把同一句话划掉再写一遍，
    // 看起来像产品坏了
    target: corrected,
    why:
      corrected === longest.text
        ? '这是你这一局最长的一句，而且没有错。再说一遍，让它变成不用想就能出口的话。'
        : '这是你这一局最长的一句。长句最能体现组织能力，值得再说一遍练顺。',
  };
}

/**
 * 下一次练什么。
 *
 * 不是随口给一个方向，而是按这一局真实暴露出来的问题排序：
 *   1. 没办成事 → 先练这个场景本身
 *   2. 严重错误集中 → 练那条规则
 *   3. 反应慢 → 练快速组织句子
 *   4. 话太短 → 练把一句话说长
 */
function nextFocus(
  conv: Conversation,
  scenario: Scenario,
  issues: Correction[],
  metrics: Record<string, Measured>,
): string {
  if (!conv.missionComplete) {
    return `这个场景再来一次。你停在了「${scenario.stages[conv.clearedStages.length]?.goal ?? '最后一步'}」，下次重点过这一步。`;
  }
  const hintTurns = metrics.hintTurns?.value ?? 0;
  if (hintTurns >= Math.max(2, (metrics.turns?.value ?? 0) / 2)) {
    return '下一次试着先不看提示，卡住了再看。能自己憋出来的句子才会变成你的。';
  }
  if (issues.length && issues[0].severity === 3) {
    return `下一次专门练「${issues[0].problem}」。这个问题会影响对方理解，优先级最高。`;
  }
  const rt = metrics.medianResponse?.value ?? 0;
  if (rt > 20) {
    return '下一次练"快速组织句子"：先说出主谓宾，细节后面再补，别在心里把整句话翻译完才开口。';
  }
  const avg = metrics.avgWordsPerTurn?.value ?? 0;
  if (avg > 0 && avg < 6) {
    return '下一次练"把一句话说长"：每次回答后面加一个 because 或 and，逼自己多说一句。';
  }
  if (issues.length) {
    return `下一次专门练「${issues[0].problem}」。`;
  }
  return '这一局完成得不错。下一次换一个难度高一点的场景，或者试着全程用说的。';
}
