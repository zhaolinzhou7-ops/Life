/**
 * 英语表达分析
 *
 * 输入一段用户写的/说的英语，输出三样东西：
 *   1. 纠错（哪里错了、改成什么、为什么）
 *   2. 客观指标（词数、句数、错误密度、用词档位…全部是数出来的）
 *   3. 做得好的地方（也全部是数出来的，不是随口夸）
 *
 * 为什么"做得好的地方"必须和纠错一样严肃地实现：
 * 成年人学英语最大的敌人不是不会，是不敢开口。一个只会挑错的产品，
 * 用户用三天就会停。但夸奖如果是编的（"你的表达很流畅！"），用户
 * 两次就能察觉，然后连纠错也不信了。所以表扬同样必须有据可查——
 * 用了从句就说用了从句，句子平均 12 词就说平均 12 词。
 *
 * 这一层完全不依赖网络和模型，是 Mock 模式下产品仍然成立的原因。
 */

import type { CEFR, Correction, Measured } from '../types';
import { measured } from '../types';
import { RULES, UPGRADES, type Hit, type Rule } from '../data/patterns';
import { CONNECTIVES, PHRASAL_VERBS, bandOf } from '../data/wordbands';
import { sentences, words } from './morph';

export interface Strength {
  /** 一句话表扬 */
  text: string;
  /** 凭什么这么说 */
  evidence: string;
}

export interface Upgrade {
  yours: string;
  better: string;
  note: string;
}

export interface Analysis {
  text: string;
  corrections: Correction[];
  /** 语法没错但可以更地道的建议。和 corrections 分开放，界面上也要分开 */
  upgrades: Upgrade[];
  strengths: Strength[];
  metrics: Record<string, Measured>;
  /** 按用词和句法估出来的大致档位。只是"大致"，界面要如实说明 */
  estimatedLevel: CEFR;
  /** 整段改好之后的版本。给想对照着看的人，不作为主要呈现方式 */
  corrected: string;
}

let seq = 0;
const nextId = () => `c${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 展示用的修剪：把小句前缀那种标点和空格去掉，让用户看到的是重点 */
const trim = (s: string) => s.replace(/^[\s.,;!?]+/, '').replace(/\s+$/, '');

/**
 * 同一段文字可能被多条规则命中同一处。
 * 保留严重度最高的那条；一样严重就保留先匹配到的，避免输出互相矛盾的两种改法。
 */
function dedupe(found: { rule: Rule; hit: Hit; sentence: string }[]): typeof found {
  const sorted = found.slice().sort((a, b) => b.rule.severity - a.rule.severity || a.hit.index - b.hit.index);
  const kept: typeof found = [];
  for (const f of sorted) {
    const s = f.hit.index;
    const e = s + f.hit.original.length;
    const overlap = kept.some(
      (k) => k.sentence === f.sentence && s < k.hit.index + k.hit.original.length && e > k.hit.index,
    );
    if (!overlap) kept.push(f);
  }
  return kept.sort((a, b) => a.hit.index - b.hit.index);
}

/** 跑规则库，返回纠错列表 */
export function correct(text: string): Correction[] {
  const out: Correction[] = [];
  for (const s of sentences(text)) {
    const found: { rule: Rule; hit: Hit; sentence: string }[] = [];
    for (const rule of RULES) {
      for (const hit of rule.find(s)) found.push({ rule, hit, sentence: s });
    }
    for (const f of dedupe(found)) {
      out.push({
        id: nextId(),
        kind: f.rule.kind,
        original: trim(f.hit.original),
        fixed: trim(f.hit.fixed),
        problem: f.rule.problem,
        why: f.rule.why,
        ruleId: f.rule.id,
        severity: f.rule.severity,
        sentence: s,
      });
    }
  }
  return out;
}

/** 把纠错应用回原文，得到改好的版本 */
export function applyCorrections(text: string): string {
  let out = text;
  for (const s of sentences(text)) {
    let fixed = s;
    const found: { rule: Rule; hit: Hit; sentence: string }[] = [];
    for (const rule of RULES) for (const hit of rule.find(s)) found.push({ rule, hit, sentence: s });
    // 从后往前替换，避免前面的替换把后面的下标挪掉
    for (const f of dedupe(found).reverse()) {
      fixed = fixed.slice(0, f.hit.index) + f.hit.fixed + fixed.slice(f.hit.index + f.hit.original.length);
    }
    if (fixed !== s) out = out.replace(s, fixed);
  }
  return out.replace(/\s{2,}/g, ' ').trim();
}

/** 找出"说得对但可以更地道"的地方 */
function findUpgrades(text: string, limit = 3): Upgrade[] {
  const out: Upgrade[] = [];
  for (const u of UPGRADES) {
    const m = text.match(u.from);
    if (m) out.push({ yours: m[0], better: u.to, note: u.note });
    if (out.length >= limit) break;
  }
  return out;
}

const countOf = (text: string, needles: string[]): string[] => {
  const low = ' ' + text.toLowerCase().replace(/[^a-z' ]/g, ' ').replace(/\s+/g, ' ') + ' ';
  return needles.filter((n) => low.includes(` ${n} `));
};

/**
 * 做得好的地方。每一条都必须能指着数据说话。
 *
 * 阈值是拍下来的，但拍得有理由：
 *   - 平均句长 ≥ 8 词：低于这个数基本都是"主谓宾"三件套，谈不上组织句子
 *   - 用到 ≥1 个从句连接词：说明能把两个意思接起来，而不是一句一顿
 *   - 不同词占比 ≥ 0.6：说明没有反复用同几个词撑场面
 */
function findStrengths(text: string, corrections: Correction[], m: Record<string, Measured>): Strength[] {
  const out: Strength[] = [];
  const ws = words(text);
  const sents = sentences(text);

  const conns = countOf(text, CONNECTIVES);
  if (conns.length >= 1) {
    out.push({
      text: '能把两个意思连成一句话，不是一句一顿',
      evidence: `用到了 ${conns.slice(0, 3).map((c) => `“${c}”`).join('、')}`,
    });
  }

  const phrasals = countOf(text, PHRASAL_VERBS);
  if (phrasals.length >= 1) {
    out.push({
      text: '用了短语动词，这是口语地道度的直接体现',
      evidence: `例如 ${phrasals.slice(0, 3).map((p) => `“${p}”`).join('、')}`,
    });
  }

  if (ws.length >= 25 && (m.avgSentenceWords?.value ?? 0) >= 8) {
    out.push({
      text: '句子有长度，说明是在组织表达而不是蹦单词',
      evidence: `平均每句 ${m.avgSentenceWords.value} 个词`,
    });
  }

  const ttr = m.distinctRatio?.value ?? 0;
  if (ws.length >= 20 && ttr >= 0.6) {
    out.push({ text: '用词没有反复打转', evidence: `${ws.length} 个词里有 ${m.distinctWords.value} 个不重复` });
  }

  const past = /\b(was|were|did|had|went|came|saw|took|made|got|said|told|thought|[a-z]+ed)\b/i.test(text);
  const future = /\b(will|going to|'ll|plan to|would)\b/i.test(text);
  if (past && future) {
    out.push({ text: '同一段话里切换了过去和将来，时态是有意识在用的', evidence: '出现了过去式和将来表达' });
  } else if (past) {
    out.push({ text: '讲过去的事时用了过去式', evidence: '句中出现了过去时形式' });
  }

  const hard = ws.filter((w) => bandOf(w) === 'B1' || bandOf(w) === 'B2');
  if (hard.length >= 2) {
    out.push({
      text: '用到了超出日常最基础范围的词',
      evidence: `例如 ${[...new Set(hard)].slice(0, 3).map((w) => `“${w}”`).join('、')}`,
    });
  }

  if (sents.length >= 2 && corrections.filter((c) => c.severity === 3).length === 0) {
    out.push({ text: '没有影响理解的错误，对方能听明白你在说什么', evidence: '严重错误 0 处' });
  }

  return out.slice(0, 4);
}

/**
 * 估等级。
 *
 * 说明白它是怎么算的，因为这个数字会显示给用户：
 *   起点 A2，然后三项各自加减——
 *   · 用词：B1+ 词占比越高越加分
 *   · 句长：平均句长越长越加分（能组织长句是中级以上的分水岭）
 *   · 准确度：每百词错误数越高越减分
 * 三项都是真实数出来的，所以同一段话每次算出来都一样。
 */
function estimateLevel(m: Record<string, Measured>, wordCount: number): CEFR {
  if (wordCount < 8) return 'A1'; // 太短，没有足够信息，报最低档而不是猜
  let score = 1.0; // 1 = A2
  const adv = m.advancedRatio.value;
  if (adv >= 0.22) score += 1.2;
  else if (adv >= 0.14) score += 0.8;
  else if (adv >= 0.08) score += 0.4;

  const len = m.avgSentenceWords.value;
  if (len >= 16) score += 1.0;
  else if (len >= 12) score += 0.6;
  else if (len >= 8) score += 0.3;
  else if (len < 5) score -= 0.4;

  const err = m.errorPer100.value;
  if (err >= 15) score -= 1.0;
  else if (err >= 8) score -= 0.6;
  else if (err >= 4) score -= 0.3;
  else if (err === 0 && wordCount >= 30) score += 0.3;

  const idx = Math.max(0, Math.min(4, Math.round(score)));
  return (['A1', 'A2', 'B1', 'B2', 'C1'] as CEFR[])[idx];
}

export function analyze(text: string): Analysis {
  const clean = text.trim();
  const ws = words(clean);
  const sents = sentences(clean);
  const corrections = correct(clean);

  // 估词汇档位时先剔掉大写开头的词：Chengdu、Alibaba 这种专名不在词表里，
  // 会被当成高级词，把等级顶高
  const contentWords = (clean.match(/\b[a-z][a-z']*\b/g) ?? []).map((w) => w.toLowerCase());
  const advanced = contentWords.filter((w) => bandOf(w) === 'B1' || bandOf(w) === 'B2');
  const distinct = new Set(ws).size;

  const metrics: Record<string, Measured> = {
    wordCount: measured(ws.length, 'counted', '数出来的词数', '词'),
    sentenceCount: measured(sents.length, 'counted', '按句号/问号/感叹号切出来的句数', '句'),
    avgSentenceWords: measured(
      sents.length ? Math.round((ws.length / sents.length) * 10) / 10 : 0,
      'derived',
      '词数 ÷ 句数',
      '词/句',
    ),
    distinctWords: measured(distinct, 'counted', '不重复的词数', '个'),
    distinctRatio: measured(
      ws.length ? Math.round((distinct / ws.length) * 100) / 100 : 0,
      'derived',
      '不重复词数 ÷ 总词数',
    ),
    errorCount: measured(corrections.length, 'counted', '本地规则库命中的问题数', '处'),
    errorPer100: measured(
      ws.length ? Math.round((corrections.length / ws.length) * 1000) / 10 : 0,
      'derived',
      '问题数 ÷ 词数 × 100',
      '处/百词',
    ),
    advancedRatio: measured(
      contentWords.length ? Math.round((advanced.length / contentWords.length) * 100) / 100 : 0,
      'derived',
      '词频表里 B1 档及以上的词占比（专有名词已剔除）',
    ),
  };

  return {
    text: clean,
    corrections,
    upgrades: findUpgrades(clean),
    strengths: findStrengths(clean, corrections, metrics),
    metrics,
    estimatedLevel: estimateLevel(metrics, ws.length),
    corrected: applyCorrections(clean),
  };
}

/**
 * 教练式反馈：一次只讲 1~3 个问题。
 *
 * 第 21 节的硬要求。用户说错五个地方，一次全倒给他，结果是一个也记不住，
 * 而且会不想再开口。所以按严重度排序后只取前三条，其余的留到错误档案里，
 * 下次再练。
 */
export function topIssues(corrections: Correction[], max = 3): Correction[] {
  const rank = (c: Correction) => c.severity * 10 + (c.kind === 'grammar' ? 2 : c.kind === 'chinglish' ? 1 : 0);
  const seen = new Set<string>();
  return corrections
    .slice()
    .sort((a, b) => rank(b) - rank(a))
    .filter((c) => {
      // 同一条规则只讲一次，讲三遍同样的毛病没有意义
      if (seen.has(c.ruleId)) return false;
      seen.add(c.ruleId);
      return true;
    })
    .slice(0, max);
}

/**
 * 一句话的即时反馈，用于对话里的轻量纠错。
 *
 * 风格严格按第 5 节：少讲、给更自然的说法、让用户再说一次。
 * 不讲语法课，不铺开解释。想深究的用户可以点开看 why。
 */
export function quickFeedback(a: Analysis): { verdict: string; line?: string; issues: Correction[] } {
  const issues = topIssues(a.corrections, 2);
  if (!issues.length) {
    return { verdict: a.upgrades.length ? 'Good. One way to sound even more natural:' : 'That works.', issues: [] };
  }
  const worst = issues[0].severity;
  const verdict = worst === 3 ? 'Almost there.' : worst === 2 ? 'Close.' : 'Good — small tweak.';
  return { verdict, line: a.corrected !== a.text ? a.corrected : undefined, issues };
}
