/**
 * 中式英语与语法规则库
 *
 * ────────────────────────────────────────────────────────────────
 * 这是整个产品最核心的本地资产。没有它，没有 API Key 的用户打开产品只能看到
 * 一个"请先配置 AI"的空壳；有了它，纠错、复盘、错误档案、专项训练全都能跑。
 * ────────────────────────────────────────────────────────────────
 *
 * 三条编写纪律：
 *
 * 1. **只写真实存在的语言规则。** 每一条都是中文母语者确实会犯的错，
 *    改法是英语里确实自然的说法。宁可少写十条，不可编一条。
 *
 * 2. **宁可漏报，不可误报。** 被冤枉一次的挫败感，远大于漏掉一个错误的损失。
 *    所以模式一律卡在小句边界上，绝不用宽松的 `.*` 去捞。
 *
 * 3. **区分"错"和"不像"。** kind=grammar 是真的错；kind=chinglish 是语法
 *    没问题但英语母语者不这么说。这两件事在界面上要分开讲——把"不够自然"
 *    说成"错误"，会让用户不敢开口。
 *
 * 严重度：3 = 影响理解，2 = 明显不自然，1 = 可以更好。
 */

import type { ErrorKind } from '../types';
import { article, ing, matchCase, past, plural, third } from '../engine/morph';

export interface Hit {
  index: number;
  original: string;
  fixed: string;
}

export interface Rule {
  id: string;
  /** 人话名字。错误档案里显示的就是它，必须让用户一眼看懂自己什么毛病 */
  label: string;
  kind: ErrorKind;
  severity: 1 | 2 | 3;
  problem: string;
  why: string;
  find(sentence: string): Hit[];
}

/**
 * 小句开头。
 *
 * 判断"he go"是不是第三人称单数漏 s，关键在于 he 前面是什么：
 * 句首是错，`can he go` / `did he go` / `when he goes` 都不是。
 * 与其写一个后行断言（Safari 16.4 之前直接报错），不如把允许出现在前面的
 * 东西显式列出来——顺带还让规则变得可读。
 */
const CLAUSE =
  '(^|[.!?;,]\\s*|\\b(?:and|but|so|because|when|while|if|then|although|though|that)\\s+|' +
  '\\bi\\s+(?:think|know|believe|guess|heard|found)\\s+(?:that\\s+)?)';

interface RuleSpec {
  id: string;
  label: string;
  kind: ErrorKind;
  severity: 1 | 2 | 3;
  pattern: RegExp;
  /** 返回整段匹配该被替换成什么；返回 null 表示这次不报 */
  fix: (m: RegExpMatchArray) => string | null;
  problem: string;
  why: string;
  /** 整句命中这个就跳过，用来挡掉已知的误报 */
  skip?: RegExp;
}

function rule(spec: RuleSpec): Rule {
  return {
    id: spec.id,
    label: spec.label,
    kind: spec.kind,
    severity: spec.severity,
    problem: spec.problem,
    why: spec.why,
    find(sentence: string): Hit[] {
      if (spec.skip && spec.skip.test(sentence)) return [];
      const hits: Hit[] = [];
      for (const m of sentence.matchAll(spec.pattern)) {
        const fixed = spec.fix(m);
        if (fixed === null || fixed === m[0]) continue;
        hits.push({ index: m.index ?? 0, original: m[0], fixed });
      }
      return hits;
    },
  };
}

/** 带小句边界的规则：pattern 里第一个分组自动是前缀，fix 只管后面的部分 */
function clauseRule(spec: Omit<RuleSpec, 'pattern' | 'fix'> & { body: string; fix: (m: RegExpMatchArray) => string | null }): Rule {
  return rule({
    ...spec,
    pattern: new RegExp(CLAUSE + spec.body, 'gi'),
    fix: (m) => {
      const rest = spec.fix(m);
      return rest === null ? null : m[1] + rest;
    },
  });
}

/** 纯替换：把命中的词换成另一个词 */
function swap(
  id: string,
  label: string,
  kind: ErrorKind,
  severity: 1 | 2 | 3,
  pattern: RegExp,
  to: string | ((m: RegExpMatchArray) => string | null),
  problem: string,
  why: string,
  skip?: RegExp,
): Rule {
  return rule({
    id,
    label,
    kind,
    severity,
    pattern,
    fix: (m) => {
      const out = typeof to === 'string' ? to : to(m);
      return out === null ? null : matchCase(m[0], out);
    },
    problem,
    why,
    skip,
  });
}

// 高频动词，用在时态和三单规则里。刻意只收常用词——学习者用的就是这些
const COMMON_VERBS =
  'go|come|get|make|take|see|know|think|want|need|like|love|feel|look|work|live|study|' +
  'speak|talk|say|tell|ask|help|play|watch|eat|drink|buy|sell|start|finish|open|close|' +
  'stay|move|use|try|call|meet|read|write|walk|run|sleep|cook|drive|learn|teach|send|pay';

const ADJECTIVES =
  'happy|sad|tired|busy|angry|hungry|thirsty|glad|nervous|excited|interested|bored|' +
  'good|fine|sure|ready|late|free|sorry|afraid|worried|lucky|proud|serious|careful|' +
  'young|old|tall|short|rich|poor|lucky|famous|important|difficult|easy|expensive|cheap';

const JOBS =
  'student|teacher|engineer|doctor|nurse|manager|designer|developer|programmer|driver|' +
  'waiter|writer|lawyer|accountant|salesperson|beginner|freshman|intern|consultant|' +
  'photographer|architect|chef|dentist|journalist|researcher';

// ══════════════════════════════════════════════════════════════
//  A · be 动词与系动词
// ══════════════════════════════════════════════════════════════

const A: Rule[] = [
  clauseRule({
    id: 'very-like',
    label: 'very 修饰动词',
    kind: 'grammar',
    severity: 2,
    body: `(i|we|they|you|he|she)\\s+very\\s+(like|love|want|miss|enjoy|hate|need|appreciate)\\b`,
    fix: (m) => `${m[2]} really ${m[3]}`,
    problem: 'very 不能直接修饰动词',
    why: 'very 只修饰形容词和副词。要加强动词的语气，用 really / a lot：I really like it / I like it a lot。',
  }),
  clauseRule({
    id: 'missing-be-adj',
    label: 'be 动词漏掉',
    kind: 'grammar',
    severity: 3,
    body: `(i|he|she|it|we|they|you)\\s+((?:very|so|really|quite|too)\\s+)?(${ADJECTIVES})\\b`,
    fix: (m) => {
      const subj = m[2].toLowerCase();
      const be = subj === 'i' ? 'am' : ['he', 'she', 'it'].includes(subj) ? 'is' : 'are';
      return `${m[2]} ${be} ${m[3] ?? ''}${m[4]}`;
    },
    problem: '形容词前面少了 be 动词',
    why: '英语的形容词不能单独作谓语，必须有 be：I am tired，不是 I tired。中文"我累了"里没有动词，这一步最容易漏。',
    // "I feel tired" / "I am happy" / "It looks good" 已经有动词了，别误报
    skip: /\b(am|is|are|was|were|be|been|feel|feels|felt|look|looks|looked|seem|seems|get|gets|got|become|becomes|became|sound|sounds|'m|'s|'re)\b/i,
  }),
  swap(
    'am-agree',
    'I am agree',
    'grammar',
    3,
    /\b(i\s+am|i'm)\s+agree\b/gi,
    'I agree',
    'agree 本身就是动词，不需要 be',
    'agree 是动词不是形容词，所以是 I agree / I don’t agree。想说"同意"的另一种说法是 I’m with you on that。',
  ),
  swap(
    'there-have',
    'There have',
    'grammar',
    3,
    /\bthere\s+(have|has)\b/gi,
    (m) => (m[1].toLowerCase() === 'has' ? 'there is' : 'there are'),
    '"有"用 there is / there are，不是 there have',
    '中文的"有"对应两个英语结构：表示存在用 There is/are，表示拥有才用 have。There have 是把两个揉在一起了。',
  ),
  rule({
    id: 'no-subject-is',
    label: '句子缺主语',
    kind: 'grammar',
    severity: 3,
    pattern: /^(is|are|was|were)\s+(?!there\b|it\b)(very|so|really|quite|too|a|an|the|not)\b/gi,
    fix: (m) => `It ${m[1].toLowerCase()} ${m[2]}`,
    problem: '句子没有主语',
    why: '中文可以说"很贵"，英语必须有主语：It’s expensive。省略主语是中文母语者最常见的结构习惯。',
    skip: /\?/,
  }),
];

// ══════════════════════════════════════════════════════════════
//  B · 时态与主谓一致
// ══════════════════════════════════════════════════════════════

const PAST_MARKER = /\b(yesterday|last\s+(?:night|week|month|year|time|monday|tuesday|wednesday|thursday|friday|saturday|sunday)|\d+\s+(?:days?|weeks?|months?|years?|hours?)\s+ago|this\s+morning|just\s+now|in\s+(?:19|20)\d\d)\b/i;

/** 时间状语说了过去，动词却是原形 */
const pastTenseRule: Rule = {
  id: 'past-tense',
  label: '过去的事用了现在时',
  kind: 'grammar',
  severity: 3,
  problem: '句子里说了过去的时间，动词却没变过去式',
  why: '英语的时间信息主要靠动词形式承担，中文靠"了""昨天"这类词。说了 yesterday 还用原形，母语者会觉得话没说完。',
  find(sentence) {
    if (!PAST_MARKER.test(sentence)) return [];
    // 已经有过去式的助动词就别管了：didn't go、was going
    if (/\b(did|didn't|was|were|had|would|could)\b/i.test(sentence)) return [];
    const hits: Hit[] = [];
    const re = new RegExp(`\\b(i|he|she|it|we|they|you)\\s+(${COMMON_VERBS})\\b`, 'gi');
    for (const m of sentence.matchAll(re)) {
      const p = past(m[2]);
      if (!p) continue;
      hits.push({ index: m.index ?? 0, original: m[0], fixed: `${m[1]} ${matchCase(m[2], p)}` });
    }
    return hits;
  },
};

/**
 * did / doesn't 后面跟了过去式。
 *
 * 这条**必须**用白名单，不能用 `[a-z]+ed` 去捞：need、feed、speed、succeed、
 * proceed 这些词都以 ed 结尾却不是过去式。用正则捞的版本会把
 * "Did you need it?" 判成错，还会给出 "Did you ne" 这种不存在的改法——
 * 既误报又造词，是这个产品最不能犯的两种错叠在一起。
 *
 * 所以只认从常用动词表真实派生出来的过去式。
 */
const PAST_FORMS: Map<string, string> = (() => {
  const m = new Map<string, string>();
  for (const v of COMMON_VERBS.split('|')) {
    const p = past(v);
    if (p && p !== v) m.set(p, v);
  }
  return m;
})();

/** 同理的 -ing 白名单：光看词尾会把 anything / nothing 当成动词 */
const ING_FORMS: Map<string, string> = new Map(COMMON_VERBS.split('|').map((v) => [ing(v), v]));

const didPastRule: Rule = {
  id: 'did-past',
  label: 'did 后面用了过去式',
  kind: 'grammar',
  severity: 3,
  problem: 'do / did 后面的动词要用原形',
  why: '时态已经由 did 表达过了，后面的动词不用再变一次：Did you go? 不是 Did you went?',
  find(sentence) {
    const hits: Hit[] = [];
    const re = /\b(did|didn't|does|doesn't|don't|do)\s+((?:i|you|he|she|it|we|they)\s+)?([a-z]+)\b/gi;
    for (const m of sentence.matchAll(re)) {
      const base = PAST_FORMS.get(m[3].toLowerCase());
      if (!base) continue;
      hits.push({
        index: m.index ?? 0,
        original: m[0],
        fixed: `${m[1]} ${m[2] ?? ''}${matchCase(m[3], base)}`,
      });
    }
    return hits;
  },
};

const B: Rule[] = [
  pastTenseRule,
  clauseRule({
    id: 'third-person-s',
    label: '第三人称单数漏 s',
    kind: 'grammar',
    severity: 2,
    body: `(he|she|it)\\s+(${COMMON_VERBS}|have)\\b`,
    fix: (m) => `${m[2]} ${matchCase(m[3], third(m[3]))}`,
    problem: '主语是 he / she / it 时，一般现在时的动词要加 s',
    why: '中文动词不随人称变化，所以这一条要靠刻意练习变成习惯。它不影响理解，但母语者一听就知道你在"翻译"。',
    skip: PAST_MARKER,
  }),
  swap(
    'people-is',
    'people 当单数',
    'grammar',
    2,
    /\bpeople\s+(is|was|has)\b/gi,
    (m) => `people ${{ is: 'are', was: 'were', has: 'have' }[m[1].toLowerCase()]}`,
    'people 本身是复数',
    'people 是 person 的复数，后面跟 are / were / have。想说"一个人"用 a person。',
  ),
  swap(
    'everyone-are',
    'everyone 当复数',
    'grammar',
    2,
    /\b(everyone|everybody|someone|somebody|nobody|each\s+one)\s+(are|were|have)\b/gi,
    (m) => `${m[1]} ${{ are: 'is', were: 'was', have: 'has' }[m[2].toLowerCase()]}`,
    'everyone / everybody 是单数',
    '意思上是很多人，语法上算单数：Everyone is here。这是英语里少数"意思和语法不一致"的地方。',
  ),
  didPastRule,
  swap(
    'modal-base',
    '情态动词后面加了 to',
    'grammar',
    2,
    /\b(can|could|will|would|should|must|may|might)\s+to\s+([a-z]+)\b/gi,
    (m) => `${m[1]} ${m[2]}`,
    '情态动词后面直接跟动词原形，不加 to',
    'can / will / should 后面不加 to。唯一的例外是 have to、ought to、be able to 这几个固定搭配。',
  ),
  swap(
    'want-to-do',
    'want / need 后面跟了 -ing',
    'grammar',
    2,
    /\b(want|wants|wanted|need|needs|needed|hope|hopes|plan|plans|decide|decides|decided)\s+([a-z]+ing)\b/gi,
    // 只认常用动词表里真实派生出来的 -ing 形式。
    // 光看"以 ing 结尾"会把 anything / everything / nothing 当成动词，
    // 于是 "Did you need anything else?" 被判错——正确的句子被冤枉一次，
    // 用户下次就不敢开口了
    (m) => {
      const base = ING_FORMS.get(m[2].toLowerCase());
      return base ? `${m[1].toLowerCase()} to ${base}` : null;
    },
    'want / need / hope 后面跟 to + 动词原形',
    '这几个词固定接不定式：I want to go，不是 I want going。like 两种都行（like doing / like to do），所以它不在这条规则里。',
  ),
  swap(
    'enjoy-to',
    'enjoy / finish 后面跟了 to',
    'grammar',
    2,
    /\b(enjoy|enjoys|enjoyed|finish|finished|avoid|practice|practise|practiced|suggest|mind|keep|consider|imagine|miss)\s+to\s+([a-z]+)\b/gi,
    (m) => `${m[1]} ${ing(m[2])}`,
    '这几个动词后面要跟 -ing，不跟 to',
    'enjoy / finish / avoid / practice / mind / keep 后面固定接动名词：I enjoy reading。这一组没有道理可讲，只能记。',
  ),
  swap(
    'look-forward-to',
    'look forward to + 动词原形',
    'grammar',
    2,
    /\blook(?:ing|s)?\s+forward\s+to\s+([a-z]+)\b/gi,
    (m) => {
      const v = m[1].toLowerCase();
      if (/(ing|you|it|this|that|the|your|our|my|her|his|their)$/.test(v)) return null;
      return `look forward to ${ing(v)}`;
    },
    'look forward to 里的 to 是介词，后面要跟 -ing',
    '这里的 to 不是不定式符号，是介词，所以后面跟名词或动名词：look forward to seeing you。',
  ),
  swap(
    'be-used-to',
    'be used to + 动词原形',
    'grammar',
    2,
    /\b(am|is|are|was|were)\s+used\s+to\s+([a-z]+)\b/gi,
    (m) => (/(ing|it|this|that|the|him|her|them)$/.test(m[2].toLowerCase()) ? null : `${m[1]} used to ${ing(m[2])}`),
    'be used to（习惯于）后面跟 -ing',
    '注意两个长得很像的结构：used to do 是"过去常做"，be used to doing 是"习惯了做"。',
  ),
];

// ══════════════════════════════════════════════════════════════
//  C · 冠词、单复数、可数不可数
// ══════════════════════════════════════════════════════════════

const C: Rule[] = [
  swap(
    'missing-article-job',
    '职业名词前漏冠词',
    'grammar',
    2,
    new RegExp(`\\b(i\\s+am|i'm|he\\s+is|he's|she\\s+is|she's|you\\s+are|you're)\\s+(${JOBS})\\b`, 'gi'),
    (m) => `${m[1]} ${article(m[2])} ${m[2]}`,
    '表示身份的单数名词前面要加 a / an',
    '中文说"我是学生"，英语必须说 I’m a student。单数可数名词在英语里几乎不能"光着"出现。',
  ),
  swap(
    'uncountable-plural',
    '不可数名词加了 s',
    'grammar',
    2,
    /\b(informations|advices|equipments|knowledges|softwares|furnitures|luggages|homeworks|researches|progresses|feedbacks|traffics|weathers)\b/gi,
    // 用显式对照表而不是"去掉词尾 s"：advices 去掉 es 会得到 advic，
    // 给学习者一个不存在的词比不纠错更糟
    (m) =>
      ({
        informations: 'information', advices: 'advice', equipments: 'equipment',
        knowledges: 'knowledge', softwares: 'software', furnitures: 'furniture',
        luggages: 'luggage', homeworks: 'homework', researches: 'research',
        progresses: 'progress', feedbacks: 'feedback', traffics: 'traffic', weathers: 'weather',
      })[m[1].toLowerCase()] ?? null,
    '这个词在英语里不可数，不加 s',
    '要表示数量用 a piece of information / some advice / two pieces of equipment。中文没有这个区分，只能一个个记。',
  ),
  swap(
    'many-much',
    'many / much 用反了',
    'grammar',
    2,
    /\b(many)\s+(money|time|water|information|advice|work|homework|traffic|food|rain|coffee|tea|help|experience)\b|\b(much)\s+(people|friends|things|books|words|hours|days|times|places|ideas|questions|students)\b/gi,
    (m) => (m[1] ? `much ${m[2]}` : `many ${m[4]}`),
    'many 接可数复数，much 接不可数',
    'many books / much money。口语里想省事可以一律用 a lot of，两边都能接。',
  ),
  swap(
    'one-of-singular',
    'one of 后面用了单数',
    'grammar',
    2,
    // 不用后行断言（Safari 16.4 之前不支持），复数判断放到 fix 里做
    /\bone\s+of\s+(my|our|your|his|her|their|the)\s+([a-z]+)\b/gi,
    (m) => {
      const n = m[2].toLowerCase();
      if (/(s|sh|ch|x|z)$/.test(n) || n.length < 3) return null;
      return `one of ${m[1].toLowerCase()} ${plural(n)}`;
    },
    'one of 后面要跟复数',
    '"我的朋友之一"意味着朋友不止一个：one of my friends。',
  ),
  swap(
    'a-lots-of',
    'a lots of',
    'grammar',
    2,
    /\ba\s+lots\s+of\b/gi,
    'a lot of',
    '固定搭配是 a lot of 或 lots of',
    'a lot of 和 lots of 都对，但没有 a lots of 这个说法。',
  ),
  swap(
    'double-comparative',
    '比较级叠用',
    'grammar',
    2,
    /\b(more|most)\s+(better|best|worse|easier|harder|bigger|smaller|faster|slower|happier|cheaper|higher|lower|stronger)\b/gi,
    (m) => m[2].toLowerCase(),
    '已经是比较级了，不用再加 more / most',
    'better 本身就是 good 的比较级。英语里比较级只标一次，要么加 -er，要么加 more，不能两个一起来。',
  ),
  swap(
    'most-est',
    '最高级叠用',
    'grammar',
    2,
    /\bthe\s+most\s+([a-z]+est)\b/gi,
    (m) => `the ${m[1].toLowerCase()}`,
    '-est 已经是最高级',
    'the happiest，不是 the most happiest。',
  ),
];

// ══════════════════════════════════════════════════════════════
//  D · 介词与固定搭配
// ══════════════════════════════════════════════════════════════

const D: Rule[] = [
  swap(
    'discuss-about',
    'discuss about',
    'grammar',
    2,
    /\b(discuss|discussed|discussing|discusses)\s+about\b/gi,
    (m) => m[1].toLowerCase(),
    'discuss 是及物动词，后面不加 about',
    '中文说"讨论关于…"，英语直接 discuss the plan。同类的还有 mention、emphasize、enter、marry、contact，后面都不加介词。',
  ),
  swap(
    'mention-about',
    'mention 后面多加了介词',
    'grammar',
    2,
    /\b(mention|mentioned|emphasize|emphasized|stress|stressed)\s+(about|on)\b/gi,
    (m) => m[1].toLowerCase(),
    '这些动词后面直接接宾语',
    'He mentioned the meeting，不是 mentioned about the meeting。',
  ),
  swap(
    'contact-with',
    'contact with',
    'grammar',
    2,
    /\b(contact|contacted)\s+with\s+(me|you|him|her|them|us)\b/gi,
    (m) => `${m[1].toLowerCase()} ${m[2].toLowerCase()}`,
    'contact 后面直接跟人',
    'Please contact me，不用 with。（名词用法 keep in contact with 才有 with。）',
  ),
  swap(
    'arrive-to',
    'arrive to',
    'grammar',
    2,
    /\barriv(e|ed|ing|es)\s+to\b/gi,
    (m) => `arriv${m[1]} at`,
    'arrive 后面用 at / in，不用 to',
    '小地方用 at（arrive at the office），大地方用 in（arrive in Beijing）。要用 to 就换 get to。',
  ),
  swap(
    'go-to-home',
    'go to home',
    'grammar',
    2,
    /\b(go|goes|going|went|get|gets|got)\s+to\s+(home|here|there|downstairs|upstairs|abroad|outside)\b/gi,
    (m) => `${m[1].toLowerCase()} ${m[2].toLowerCase()}`,
    'home / here / there 前面不加 to',
    '这几个词本身就是副词，已经含了"往"的意思：go home、come here。',
  ),
  swap(
    'married-with',
    'married with',
    'grammar',
    2,
    /\bmarried\s+with\s+(?!children|kids|two|three)/gi,
    'married to ',
    '和某人结婚用 married to',
    'She is married to a doctor。married with children 是另一个意思——"有孩子"。',
  ),
  swap(
    'different-with',
    '不同/相同的搭配',
    'grammar',
    2,
    /\b(different)\s+with\b|\b(same)\s+with\b/gi,
    (m) => (m[1] ? 'different from' : 'same as'),
    '固定搭配是 different from、the same as',
    '中文都说"和…不同/相同"，英语两个搭配不一样，要分开记。',
  ),
  swap(
    'prefer-than',
    'prefer ... than',
    'grammar',
    2,
    /\bprefer(s|red)?\s+([a-z]+(?:\s+[a-z]+)?)\s+than\b/gi,
    (m) => `prefer${m[1] ?? ''} ${m[2]} to`,
    'prefer A to B',
    'prefer 后面用 to 不用 than：I prefer tea to coffee。想用 than 就换成 I like tea more than coffee。',
  ),
  swap(
    'in-the-internet',
    'in the internet',
    'grammar',
    2,
    /\bin\s+the\s+internet\b/gi,
    'on the internet',
    '网上用 on',
    'on the internet / online。类似的：on TV、on the phone、on the radio。',
  ),
  swap(
    'everyday-adv',
    'everyday 当"每天"用',
    'spelling',
    1,
    /\b(i|we|they|you|he|she)\s+([a-z]+(?:\s+[a-z]+){0,2}?)\s+everyday\b/gi,
    (m) => `${m[1]} ${m[2]} every day`,
    'everyday 是形容词，"每天"是 every day',
    'everyday English（日常英语）是形容词；I study English every day 是时间状语，中间要空格。',
  ),
];

// ══════════════════════════════════════════════════════════════
//  E · 中式英语：语法没错，但英语不这么说
// ══════════════════════════════════════════════════════════════

const E: Rule[] = [
  swap(
    'open-the-light',
    'open the light',
    'word-choice',
    2,
    /\b(open|close)\s+(the\s+|my\s+|your\s+)?(light|lights|tv|television|computer|air\s+conditioner|ac|radio|fan|machine|phone)\b/gi,
    (m) => `${m[1].toLowerCase() === 'open' ? 'turn on' : 'turn off'} ${m[2] ?? 'the '}${m[3]}`,
    '电器用 turn on / turn off',
    'open 和 close 说的是"打开/关上"一个实体（门、窗、盒子）。带电的东西是接通电源，用 turn on/off，或者 switch on/off。',
  ),
  swap(
    'eat-medicine',
    'eat medicine',
    'word-choice',
    2,
    /\b(eat|eating|ate|eats)\s+(the\s+|some\s+|my\s+)?medicine\b/gi,
    (m) => `take ${m[2] ?? ''}medicine`,
    '吃药用 take',
    '英语里药是"服用"不是"吃"：take medicine、take a pill。中文的"吃"覆盖面比 eat 宽得多。',
  ),
  swap(
    'price-expensive',
    'price is expensive',
    'word-choice',
    2,
    /\b(the\s+)?price\s+(is|was|are|were)\s+(very\s+|too\s+|so\s+)?(expensive|cheap)\b/gi,
    (m) => `the price ${m[2].toLowerCase()} ${m[3] ?? ''}${m[4].toLowerCase() === 'expensive' ? 'high' : 'low'}`,
    '贵的是东西，不是价格',
    'expensive 形容商品，price 只能 high / low。说 It’s expensive 或 The price is high 都行。',
  ),
  swap(
    'very-delicious',
    'very delicious',
    'chinglish',
    1,
    /\bvery\s+(delicious|perfect|excellent|amazing|terrible|awful|huge|tiny|freezing|boiling|exhausted|starving)\b/gi,
    (m) => `really ${m[1].toLowerCase()}`,
    '这类词本身已经是"极致"了，不用 very',
    'delicious 已经是"非常好吃"，再加 very 有点像"非常最好吃"。要加强用 absolutely / really。',
  ),
  swap(
    'how-to-say',
    'How to say ... ?',
    'chinglish',
    2,
    /\bhow\s+to\s+(say|spell|pronounce|write)\b/gi,
    (m) => `how do you ${m[1].toLowerCase()}`,
    '问句需要完整结构',
    'How to say 是个不完整的从句，不能单独当问句。完整问法是 How do you say…? 或 What’s … in English?',
    /\b(know|learn|teach|tell|show|explain|remember|understand)\s+how\s+to\b/i,
  ),
  swap(
    'how-do-you-think',
    'How do you think?',
    'chinglish',
    2,
    /\bhow\s+do\s+(you|they|we)\s+think\s+(about|of)\b/gi,
    (m) => `what do ${m[1].toLowerCase()} think ${m[2].toLowerCase()}`,
    '问看法用 What do you think',
    'How do you think 问的是"你用什么方式思考"。问意见要用 What do you think of it? 或 How do you feel about it?',
  ),
  swap(
    'what-is-your-meaning',
    "What's your meaning?",
    'chinglish',
    2,
    /\bwhat(?:'s|\s+is)\s+(your|his|her|their)\s+meaning\b/gi,
    (m) => `what do ${{ your: 'you', his: 'he', her: 'she', their: 'they' }[m[1].toLowerCase()]} mean`,
    '问对方意思用 What do you mean',
    'What’s your meaning 听起来像在问"你这个人的意义是什么"。',
  ),
  swap(
    'oral-english',
    'oral English',
    'chinglish',
    1,
    /\b(my|your|his|her|their|our)\s+oral\s+english\b/gi,
    (m) => `${m[1].toLowerCase()} spoken English`,
    '日常说 spoken English',
    'oral English 是考试和教材里的说法，日常对话里母语者说 spoken English，或者直接说 my English speaking。',
  ),
  swap(
    'my-english-poor',
    'My English is poor',
    'chinglish',
    1,
    /\bmy\s+english\s+(is|was)\s+(very\s+)?(poor|bad|not\s+good)\b/gi,
    'my English is still a work in progress',
    '这句话在英语语境里过于自贬',
    '母语者一般说 I’m still working on my English 或 I’m not quite fluent yet。开口之前先否定自己，会让对方不知道怎么接。',
  ),
  swap(
    'play-phone',
    'play phone',
    'chinglish',
    2,
    /\b(play|playing|played)\s+(the\s+|my\s+|his\s+|her\s+)?(phone|mobile|computer)\b/gi,
    (m) => (m[3].toLowerCase() === 'computer' ? 'use the computer' : `use ${m[2] ?? 'my '}phone`),
    '中文的"玩手机"不能直译',
    'play 用于玩游戏、玩乐器、做运动。刷手机是 use my phone / be on my phone / scroll on my phone。',
  ),
  swap(
    'play-with-friends',
    '成年人说 play with',
    'chinglish',
    1,
    /\bplay\s+with\s+(my|our)\s+(friends?|colleagues?|classmates?)\b/gi,
    (m) => `hang out with ${m[1].toLowerCase()} ${m[2].toLowerCase()}`,
    '成年人之间不说 play',
    'play with friends 是小孩子的说法。成年人聚会、出去玩说 hang out with friends / meet up with friends。',
  ),
  swap(
    'body-healthy',
    'My body is healthy',
    'chinglish',
    2,
    /\bmy\s+body\s+(is|was)\s+(very\s+)?(healthy|good|strong|not\s+good|bad)\b/gi,
    (m) => (/not|bad/.test(m[3]) ? "I'm not feeling well" : "I'm in good health"),
    '说身体状况不用 my body',
    'my body 指的是肉体本身，听起来很奇怪。说健康状况用 I’m in good health / I’m pretty healthy。',
  ),
  swap(
    'im-boring',
    "I'm boring",
    'word-choice',
    3,
    /\b(i|he|she|we|they)\s*(?:'m|'s|'re|\s+am|\s+is|\s+are|\s+was|\s+were)\s+(boring|exciting|interesting|confusing|annoying|tiring|surprising|frustrating)\b/gi,
    (m) => {
      const map: Record<string, string> = {
        boring: 'bored', exciting: 'excited', interesting: 'interested', confusing: 'confused',
        annoying: 'annoyed', tiring: 'tired', surprising: 'surprised', frustrating: 'frustrated',
      };
      return `${m[0].slice(0, m[0].length - m[2].length)}${map[m[2].toLowerCase()]}`;
    },
    '-ing 说的是"让人…"，-ed 才是"我感到…"',
    'I’m boring = 我这个人很无聊；I’m bored = 我觉得无聊。这一组说反了意思会差很远，是最值得练熟的一条。',
  ),
  swap(
    'interested-in',
    'interesting in',
    'grammar',
    2,
    /\b(am|is|are|was|were|'m|'s|'re)\s+(very\s+)?interesting\s+in\b/gi,
    (m) => `${m[1]} ${m[2] ?? ''}interested in`,
    'be interested in',
    '对某事感兴趣是 be interested in；be interesting 是"（这个人/这件事）很有意思"。',
  ),
  swap(
    'welcome-to-come',
    'Welcome to come',
    'chinglish',
    2,
    /\bwelcome\s+to\s+come\s+to\b/gi,
    "you're welcome to visit",
    '"欢迎来…"不能直译成 welcome to come',
    'Welcome to + 地点 已经是完整的欢迎语（Welcome to Beijing）。想说"欢迎你来"用 You’re welcome to visit / Feel free to come。',
  ),
  swap(
    'too-good',
    'too + 褒义词',
    'chinglish',
    1,
    /\btoo\s+(good|nice|beautiful|delicious|great|kind|happy|wonderful)\b/gi,
    (m) => `really ${m[1].toLowerCase()}`,
    'too 在英语里是负面的"过于"',
    '中文"太好了"是夸奖，英语 too good 却暗示"好过头了、有问题"。要夸就用 so / really / absolutely。',
  ),
];

// ══════════════════════════════════════════════════════════════
//  F · 中文句式结构直译
// ══════════════════════════════════════════════════════════════

const F: Rule[] = [
  rule({
    id: 'because-so',
    label: 'because 和 so 同时用',
    kind: 'grammar',
    severity: 2,
    pattern: /\bbecause\b([^.!?]*?),?\s+so\b/gi,
    fix: (m) => `because${m[1]},`,
    problem: 'because 和 so 只能留一个',
    why: '中文"因为…所以…"是成对的，英语里两个都是连词，用一个就够：Because it rained, I stayed home. 或 It rained, so I stayed home.',
  }),
  rule({
    id: 'although-but',
    label: 'although 和 but 同时用',
    kind: 'grammar',
    severity: 2,
    pattern: /\b(although|though|even\s+though)\b([^.!?]*?),?\s+but\b/gi,
    fix: (m) => `${m[1]}${m[2]},`,
    problem: 'although 和 but 只能留一个',
    why: '和"因为…所以…"同理，"虽然…但是…"在英语里也只保留一半。',
  }),
  swap(
    'think-not',
    'I think ... not',
    'chinglish',
    1,
    /\bi\s+think\s+(he|she|it|they|you|this|that)\s+(is|are|was|were|will|can|does|do)\s+not\b/gi,
    (m) => `I don't think ${m[1].toLowerCase()} ${m[2].toLowerCase()}`,
    '英语习惯把否定提到 think 上',
    '中文说"我觉得他不对"，英语说 I don’t think he’s right。意思一样，位置不同，这是很典型的语序差别。',
  ),
  swap(
    'double-subject',
    '主语重复',
    'grammar',
    2,
    /\b(my|his|her|our|their)\s+(father|mother|friend|boss|teacher|brother|sister|wife|husband|colleague|manager|son|daughter)\s+(he|she)\s+(is|was|has|have|likes|works|lives|can|will)\b/gi,
    (m) => `${m[1]} ${m[2]} ${m[4].toLowerCase()}`,
    '主语说了两遍',
    '中文"我爸爸他是老师"里的"他"是个自然的停顿标记，英语里就是多了一个主语。',
  ),
  rule({
    id: 'time-word-order',
    label: '时间状语插在主谓之间',
    kind: 'chinglish',
    severity: 2,
    pattern: /\b(i|he|she|we|they|you)\s+(yesterday|today|tomorrow|this\s+morning|last\s+night|next\s+week)\s+([a-z]+)\b/gi,
    // 把时间词提到句首，这是英语里合法的位置；时态本身由 past-tense 那条管
    fix: (m) => `${m[2].charAt(0).toUpperCase()}${m[2].slice(1).toLowerCase()}, ${m[1].toLowerCase()} ${m[3]}`,
    problem: '时间词不放在主语和动词中间',
    why: '中文"我昨天去了北京"里时间在动词前；英语要放句首或句尾：Yesterday I went to Beijing / I went to Beijing yesterday。',
  }),
  swap(
    'reason-is-because',
    'The reason is because',
    'grammar',
    1,
    /\bthe\s+reason\s+(is|was)\s+because\b/gi,
    (m) => `the reason ${m[1].toLowerCase()} that`,
    'reason 和 because 语义重复',
    'The reason is that… 或者直接 It’s because…，两个一起用是同义反复。',
  ),
  swap(
    'in-my-opinion-i-think',
    'In my opinion, I think',
    'formality',
    1,
    /\bin\s+my\s+opinion,?\s+i\s+think\b/gi,
    'I think',
    '两个"我认为"叠在一起',
    '挑一个用就行。口语里 I think 最自然，I’d say 也常见。',
  ),
  swap(
    'with-the-development',
    'With the development of…',
    'formality',
    1,
    /\bwith\s+the\s+(development|improvement|progress)\s+of\s+(society|the\s+society|economy|the\s+economy|technology|the\s+times)\b/gi,
    'These days',
    '这是中文作文模板的直译，英语母语者基本不这么开头',
    '英语里想说"现在…"就直说 These days / Nowadays / Over the past few years。',
  ),
  swap(
    'as-we-all-know',
    'As we all know',
    'formality',
    1,
    /\bas\s+we\s+all\s+know,?\s*/gi,
    '',
    '这个开头在英语里听起来有点居高临下',
    '如果真的人人都知道，就不用说；如果不是人人都知道，这么说会让对方觉得被冒犯。直接进入正题更好。',
  ),
  swap(
    'give-you',
    'Give you',
    'chinglish',
    2,
    /(^|[.!?]\s*)give\s+you[.!]/gi,
    (m) => `${m[1]}Here you are.`,
    '递东西时不说 Give you',
    '中文"给你"是完整的一句话，英语 Give you 缺宾语。递东西说 Here you are / Here you go。',
  ),
];

// ══════════════════════════════════════════════════════════════
//  G · 高频拼写
// ══════════════════════════════════════════════════════════════

const SPELLING: Record<string, string> = {
  recieve: 'receive', seperate: 'separate', definately: 'definitely', occured: 'occurred',
  accomodation: 'accommodation', tommorow: 'tomorrow', tomorow: 'tomorrow', begining: 'beginning',
  becuase: 'because', enviroment: 'environment', convient: 'convenient', goverment: 'government',
  reccomend: 'recommend', recomend: 'recommend', neccessary: 'necessary', wich: 'which',
  thier: 'their', freind: 'friend', beleive: 'believe', successfull: 'successful',
  untill: 'until', alot: 'a lot', teh: 'the', adress: 'address', arguement: 'argument',
  responsable: 'responsible', experiance: 'experience', diffrent: 'different', intresting: 'interesting',
};

const G: Rule[] = [
  rule({
    id: 'spelling',
    label: '拼写',
    kind: 'spelling',
    severity: 2,
    pattern: new RegExp(`\\b(${Object.keys(SPELLING).join('|')})\\b`, 'gi'),
    fix: (m) => matchCase(m[1], SPELLING[m[1].toLowerCase()]),
    problem: '拼写错误',
    why: '这些词是中文母语者最常拼错的一批，多数是因为读音和拼写对不上。',
  }),
];

// ══════════════════════════════════════════════════════════════

export const RULES: Rule[] = [...A, ...B, ...C, ...D, ...E, ...F, ...G];

export const RULE_BY_ID: Record<string, Rule> = Object.fromEntries(RULES.map((r) => [r.id, r]));

/**
 * 表达升级库：说得对，但可以更地道。
 *
 * 和 RULES 分开，因为这不是"纠错"——把它混进错误列表里，会让一个说得
 * 完全正确的用户看到一屏红字，这是最打击人的设计。界面上它归"可以更好"。
 */
export interface Upgrade {
  id: string;
  from: RegExp;
  to: string;
  note: string;
}

export const UPGRADES: Upgrade[] = [
  { id: 'up-very-good', from: /\bvery\s+good\b/gi, to: 'great / solid / exactly what I needed', note: 'very good 不算错，但信息量很低。换一个具体的词，对方能听出你的态度。' },
  { id: 'up-i-think', from: /\bi\s+think\s+so\b/gi, to: 'I’d say so / That’s my take', note: 'I think so 偏中性；换个说法能让态度更清楚。' },
  { id: 'up-maybe', from: /\bmaybe\b/gi, to: 'probably / possibly / I might', note: '英语里 maybe 偏口语且比较弱，工作场合常用 probably（更可能）或 possibly（更保守）。' },
  { id: 'up-i-know', from: /\bi\s+know\b\.?$/gi, to: 'Got it / That makes sense', note: '回应别人的解释时说 I know 容易显得"你说的我早就知道了"。Got it 更安全。' },
  { id: 'up-of-course', from: /\bof\s+course\b/gi, to: 'Sure / Absolutely / Definitely', note: 'of course 有时带着"这还用问"的味道。答应别人的请求用 Sure 更温和。' },
  { id: 'up-help-you', from: /\bcan\s+i\s+help\s+you\b/gi, to: 'What can I do for you? / How can I help?', note: '都对，后两个在服务和工作场景里更常听到。' },
  { id: 'up-i-want', from: /\bi\s+want\s+(a|an|the|some|to)\b/gi, to: 'I’d like …', note: '点餐、提要求时 I want 偏直接，I’d like 是成年人场合的默认说法。' },
  { id: 'up-must', from: /\byou\s+must\b/gi, to: 'You should / You need to / It’d be good to', note: '对同事或客户说 you must 语气很重，除非真的是硬性要求。' },
  { id: 'up-difficult', from: /\bit\s+is\s+difficult\b/gi, to: 'It’s tricky / It’s a challenge / That’s not easy', note: 'difficult 没错，换个说法更像日常对话。' },
  { id: 'up-happy-to', from: /\bi\s+am\s+very\s+happy\b/gi, to: 'I’m really glad / I’m pleased', note: '工作场合 happy 偏私人，glad / pleased 更常见。' },
];
