/**
 * 英语教练 · 自测
 *
 * 这个产品最怕的不是崩溃，是**说假话**：把对的句子判成错的、编一条不存在的
 * 语法规则、给一个查不到依据的分数。这些错误在界面上全都看不出来，只有断言
 * 能拦住。所以测试分层如下：
 *
 *   1. 规则库自身的体检（不能有重复 id、改法不能还是错的）
 *   2. 纠错引擎：**该报的要报，不该报的一定不能报**（误报比漏报伤害大）
 *   3. 测评引擎：同样的输入必须得到同样的结论，且结论要有据可查
 *   4. 词汇与间隔复习：掌握度只能按规则升降
 *   5. 场景引擎：任务推进由本地判定，可复现
 *   6. 存档层：写不进去不崩、重复提交不重复、两个用户不串数据
 *   7. AI 层：超时/报错/空返回/垃圾返回都要能降级
 *
 * 标 ★ 的是产品底线，红了就不能发。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import { RULES } from '../src/coach/data/patterns';
import { VOCAB } from '../src/coach/data/vocab';
import { SCENARIOS, SCENARIO_MAP } from '../src/coach/data/scenarios';
import { analyze, applyCorrections, correct, topIssues } from '../src/coach/engine/analyze';
import { ing, past, plural, third } from '../src/coach/engine/morph';
import { DAY, freshVocab, pickReview, review, spontaneousHits, usableCount } from '../src/coach/engine/srs';
import { startConversation, submitTurn } from '../src/coach/engine/scenario';
import { buildDebrief } from '../src/coach/engine/debrief';
import { ASSESSMENT_ORDER, CHOICE_ITEMS, OPEN_ITEMS } from '../src/coach/data/assessment';
import { evidenceFor, overallLevel, scoreAssessment } from '../src/coach/engine/assess';
import { clearedErrors, emptyProfile, recordCleared, recordErrors, summarize, topErrors } from '../src/coach/engine/errors';
import { buildPlan } from '../src/coach/engine/plan';
import { getScenario } from '../src/coach/data/scenarios';
import { getClip } from '../src/coach/data/listening';
import { getWord } from '../src/coach/data/vocab';
import { SKILLS, cefrIndex } from '../src/coach/types';
import { DEFAULT_CONFIG, loadConfig, remoteAvailable, saveConfig } from '../src/coach/ai/config';
import { cleanNpcLine, unwrap } from '../src/coach/ai/prompt';
import { explainCorrection } from '../src/coach/ai/providers';
import {
  addProgressPoint,
  getErrorProfile,
  getProfile,
  getProgress,
  getSpeaking,
  getUser,
  getVocabAll,
  hasAssessment,
  isStorageBroken,
  recordStudy,
  resetCurrentUser,
  saveSpeaking,
  saveUser,
  saveVocab,
  switchUser,
} from '../src/coach/store';
import type { AssessAnswer, Correction, GoalKey, UserProfile, UserVocab } from '../src/coach/types';

const ids = (text: string) => correct(text).map((c) => c.ruleId);
const fixedOf = (text: string, ruleId: string) => correct(text).find((c) => c.ruleId === ruleId)?.fixed;

// ══════════════════════ 1. 规则库体检 ══════════════════════

describe('规则库', () => {
  it('规模够用', () => expect(RULES.length).toBeGreaterThanOrEqual(45));

  it('★ 没有重复 id（错误档案按 id 统计，重了就会串）', () => {
    const seen = new Set<string>();
    const dup = RULES.filter((r) => (seen.has(r.id) ? true : (seen.add(r.id), false)));
    expect(dup.map((r) => r.id)).toEqual([]);
  });

  it('每条都写清了问题和原因', () => {
    const bad = RULES.filter((r) => !r.problem || !r.why || r.why.length < 10);
    expect(bad.map((r) => r.id)).toEqual([]);
  });

  it('label 是中文人话，会直接显示在错误档案里', () => {
    const bad = RULES.filter((r) => !r.label || r.label.length > 24);
    expect(bad.map((r) => r.id)).toEqual([]);
  });
});

// ══════════════════════ 2. 纠错：该报的 ══════════════════════

describe('该报的错误', () => {
  const cases: [string, string][] = [
    ['I very like Chengdu.', 'very-like'],
    ['I very happy today.', 'missing-be-adj'],
    ['I am agree with you.', 'am-agree'],
    ['There have many people here.', 'there-have'],
    ['He go to work every day.', 'third-person-s'],
    ['Yesterday I go to the park.', 'past-tense'],
    ['Did you went there?', 'did-past'],
    ['I can to help you.', 'modal-base'],
    ['I want going home.', 'want-to-do'],
    ['I enjoy to read books.', 'enjoy-to'],
    ['I look forward to meet you.', 'look-forward-to'],
    ['I am used to get up early.', 'be-used-to'],
    ['I am student.', 'missing-article-job'],
    ['I need some informations.', 'uncountable-plural'],
    ['There are many money on the table.', 'many-much'],
    ['He is one of my friend.', 'one-of-singular'],
    ['This is more better.', 'double-comparative'],
    ['We discussed about the plan.', 'discuss-about'],
    ['I will arrive to Beijing tomorrow.', 'arrive-to'],
    ['I go to home after work.', 'go-to-home'],
    ['This is different with that one.', 'different-with'],
    ['I prefer tea than coffee.', 'prefer-than'],
    ['Please open the light.', 'open-the-light'],
    ['I need to eat medicine.', 'eat-medicine'],
    ['The price is very expensive.', 'price-expensive'],
    ['How to say this in English?', 'how-to-say'],
    ['How do you think about my plan?', 'how-do-you-think'],
    ['I am boring at work.', 'im-boring'],
    ['I am very interesting in music.', 'interested-in'],
    ['Because it rained, so I stayed home.', 'because-so'],
    ['Although he is tired, but he keeps working.', 'although-but'],
    ['My father he is a teacher.', 'double-subject'],
    ['I yesterday went to Beijing.', 'time-word-order'],
    ['People is waiting outside.', 'people-is'],
    ['Everyone are here.', 'everyone-are'],
    ['I recieve your email.', 'spelling'],
    ['I play phone too much.', 'play-phone'],
    ['My body is healthy.', 'body-healthy'],
    ['Is very expensive.', 'no-subject-is'],
    ['The reason is because I was late.', 'reason-is-because'],
  ];

  for (const [text, ruleId] of cases) {
    it(`「${text}」→ ${ruleId}`, () => expect(ids(text)).toContain(ruleId));
  }
});

// ══════════════════════ 3. 纠错：不该报的 ══════════════════════
// 误报是这个产品最伤用户的失败方式：一个说对了的人被判错，
// 下次就不敢开口了。所以这一组比上一组更重要。

describe('★ 正确的句子一个都不能报错', () => {
  const clean = [
    'I really like Chengdu.',
    'I am very happy today.',
    "I'm tired after work.",
    'He goes to work every day.',
    'Yesterday I went to the park.',
    'Did you go there?',
    'I can help you.',
    'I want to go home.',
    'I enjoy reading books.',
    'I look forward to meeting you.',
    'I look forward to it.',
    'I am used to getting up early.',
    'I used to live in Shanghai.',
    'I am a student.',
    'I need some information.',
    'There is a lot of money on the table.',
    'He is one of my friends.',
    'This one is better.',
    'We discussed the plan yesterday.',
    'I will arrive in Beijing tomorrow.',
    'I go home after work.',
    'This is different from that one.',
    'I prefer tea to coffee.',
    'Please turn on the light.',
    'I need to take some medicine.',
    'The price is high.',
    'How do you say this in English?',
    'What do you think about my plan?',
    'I am bored at work.',
    'This movie is boring.',
    'I am very interested in music.',
    'Because it rained, I stayed home.',
    'Although he is tired, he keeps working.',
    'My father is a teacher.',
    'People are waiting outside.',
    'Everyone is here.',
    'I received your email.',
    'I use my phone too much.',
    "I'm in good health.",
    'It is very expensive.',
    'The reason is that I was late.',
    'Can he go with us?',
    'When he goes out, he takes his keys.',
    'I know how to say it.',
    'She is married with children.',
    'I like playing basketball.',
    'I like to play basketball.',
    'He said that she works here.',
    'I have been working here for three years.',
    'Could you tell me where the station is?',
    'I would like a coffee, please.',
    'We are looking for a solution.',
    'Thanks for getting back to me so quickly.',
    'It took me about an hour to get here.',
    'I think he is right about this.',
    // ed 结尾但不是过去式的词。用 /[a-z]+ed/ 去捞 did 后面的过去式时，
    // 这几句会被判错并给出 "Did you ne" 这种编出来的改法
    'Did you need anything else?',
    'Do you need a hand?',
    'Did you succeed in the end?',
    'Did the meeting proceed as planned?',
    'Does he feed the cat every morning?',
  ];

  for (const text of clean) {
    it(`「${text}」应当零误报`, () => {
      const found = correct(text);
      expect(found.map((c) => `${c.ruleId}:${c.original}`), text).toEqual([]);
    });
  }
});

// ══════════════════════ 4. 改法本身必须是对的 ══════════════════════

describe('★ 改完之后不能还是错的', () => {
  it('改法不会再次触发规则库', () => {
    const broken: string[] = [];
    for (const [text] of [
      ['I very like Chengdu.'],
      ['He go to work every day.'],
      ['I am student.'],
      ['I enjoy to read books.'],
      ['I want going home.'],
      ['There have many people here.'],
      ['I need some informations.'],
      ['He is one of my friend.'],
      ['Please open the light.'],
      ['I am boring at work.'],
      ['I very happy today.'],
      ['People is waiting outside.'],
    ] as [string][]) {
      const fixed = applyCorrections(text);
      const again = correct(fixed);
      if (again.length) broken.push(`${text} → ${fixed} → 仍报 ${again.map((c) => c.ruleId).join(',')}`);
    }
    expect(broken).toEqual([]);
  });

  it('具体改法读起来是人话', () => {
    expect(fixedOf('I very like Chengdu.', 'very-like')).toBe('I really like');
    expect(fixedOf('He go to work every day.', 'third-person-s')).toBe('He goes');
    expect(fixedOf('I am student.', 'missing-article-job')).toBe('I am a student');
    expect(fixedOf('I enjoy to read books.', 'enjoy-to')).toBe('enjoy reading');
    expect(fixedOf('Please open the light.', 'open-the-light')).toBe('turn on the light');
    expect(fixedOf('I need some informations.', 'uncountable-plural')).toBe('information');
    expect(fixedOf('Yesterday I go to the park.', 'past-tense')).toBe('I went');
  });
});

// ══════════════════════ 5. 词形派生 ══════════════════════

describe('词形派生', () => {
  it('第三人称单数', () => {
    expect(third('go')).toBe('goes');
    expect(third('have')).toBe('has');
    expect(third('be')).toBe('is');
    expect(third('study')).toBe('studies');
    expect(third('watch')).toBe('watches');
    expect(third('work')).toBe('works');
  });

  it('★ 过去式：高频不规则动词一个都不能编', () => {
    expect(past('go')).toBe('went');
    expect(past('eat')).toBe('ate');
    expect(past('buy')).toBe('bought');
    expect(past('think')).toBe('thought');
    expect(past('stop')).toBe('stopped');
    expect(past('study')).toBe('studied');
    expect(past('like')).toBe('liked');
    expect(past('work')).toBe('worked');
    // 双写规则不能误伤 w/x/y 结尾
    expect(past('play')).toBe('played');
    expect(past('show')).toBe('showed');
  });

  it('现在分词', () => {
    expect(ing('read')).toBe('reading');
    expect(ing('make')).toBe('making');
    expect(ing('run')).toBe('running');
    expect(ing('see')).toBe('seeing');
    expect(ing('lie')).toBe('lying');
    expect(ing('play')).toBe('playing');
  });

  it('复数', () => {
    expect(plural('friend')).toBe('friends');
    expect(plural('person')).toBe('people');
    expect(plural('city')).toBe('cities');
    expect(plural('box')).toBe('boxes');
  });
});

// ══════════════════════ 6. 分析层 ══════════════════════

describe('表达分析', () => {
  const sample =
    'I work as a designer in Chengdu. Yesterday I went to a meeting with my client, ' +
    'because we needed to discuss the new plan. It was hard, but we figured out a solution.';

  it('指标是数出来的，不是估的', () => {
    const a = analyze(sample);
    expect(a.metrics.wordCount.value).toBeGreaterThan(30);
    expect(a.metrics.sentenceCount.value).toBe(3);
    expect(a.metrics.wordCount.source).toBe('counted');
    expect(a.metrics.avgSentenceWords.source).toBe('derived');
  });

  it('★ 每个指标都说得出自己是怎么来的', () => {
    const a = analyze(sample);
    const bad = Object.entries(a.metrics).filter(([, m]) => !m.how || m.how.length < 4);
    expect(bad.map(([k]) => k)).toEqual([]);
  });

  it('表扬有据可查，不是空夸', () => {
    const a = analyze(sample);
    expect(a.strengths.length).toBeGreaterThan(0);
    for (const s of a.strengths) expect(s.evidence.length).toBeGreaterThan(2);
  });

  it('同样的输入永远得到同样的结论', () => {
    const a = analyze(sample);
    const b = analyze(sample);
    expect(a.estimatedLevel).toBe(b.estimatedLevel);
    expect(a.metrics.errorPer100.value).toBe(b.metrics.errorPer100.value);
  });

  it('太短的输入不硬给高等级', () => {
    expect(analyze('Yes.').estimatedLevel).toBe('A1');
    expect(analyze('I like it.').estimatedLevel).toBe('A1');
  });

  it('写得长而准的能上到中级以上', () => {
    const good =
      'Although the project was delayed, we managed to deliver the main features on time. ' +
      'I spent most of last week coordinating with the design team, and we eventually ' +
      'figured out a reasonable compromise that everyone could accept.';
    expect(['B1', 'B2', 'C1']).toContain(analyze(good).estimatedLevel);
  });

  it('★ 一次最多只讲 3 个问题（第 21 条）', () => {
    const messy =
      'I very like my work. He go to office every day. I am student. ' +
      'Yesterday I go to meeting. I am agree with you. Please open the light.';
    expect(topIssues(correct(messy)).length).toBeLessThanOrEqual(3);
  });

  it('同一条规则不会在一次反馈里讲两遍', () => {
    const repeated = 'I very like tea. I very like coffee. I very like water.';
    const top = topIssues(correct(repeated), 3);
    expect(new Set(top.map((c) => c.ruleId)).size).toBe(top.length);
  });

  it('空输入不崩', () => {
    const a = analyze('   ');
    expect(a.corrections).toEqual([]);
    expect(a.metrics.wordCount.value).toBe(0);
  });
});

// ══════════════════════ 7. 词汇与间隔复习 ══════════════════════

describe('间隔复习', () => {
  const t0 = 1_700_000_000_000;

  it('新词第二天就该再见一面', () => {
    const v = freshVocab('schedule', t0);
    expect(v.mastery).toBe(1);
    expect(v.nextReview - t0).toBe(DAY);
  });

  it('★ 做对一道对照题不能证明"会用"', () => {
    // 这是产品最核心的诚实性：认识 ≠ 会用
    let v = freshVocab('schedule', t0);
    for (let k = 0; k < 6; k++) v = review(v, 'recognize', true, 1500, t0).vocab;
    expect(v.mastery).toBeLessThanOrEqual(2);
  });

  it('掌握度按练习类型逐级解锁', () => {
    let v = freshVocab('deadline', t0);
    v = review(v, 'recognize', true, 1500, t0).vocab;
    expect(v.mastery).toBe(2);
    v = review(v, 'listen', true, 1500, t0).vocab;
    expect(v.mastery).toBe(3);
    v = review(v, 'produce', true, 1500, t0).vocab;
    expect(v.mastery).toBe(4);
  });

  it('★ 升到"熟练使用"必须真的自己用出来两次', () => {
    let v = freshVocab('handle', t0);
    v = review(v, 'recognize', true, 1000, t0).vocab;
    v = review(v, 'listen', true, 1000, t0).vocab;
    v = review(v, 'produce', true, 1000, t0).vocab;
    expect(v.mastery).toBe(4);
    // 第一次自发使用：还不够
    v = review(v, 'spontaneous', true, 1000, t0).vocab;
    expect(v.mastery).toBe(4);
    // 第二次：才升到 5
    v = review(v, 'spontaneous', true, 1000, t0).vocab;
    expect(v.mastery).toBe(5);
    expect(v.spontaneousUses).toBe(2);
  });

  it('答错会退一级，但不会退到 0', () => {
    let v = freshVocab('issue', t0);
    v = review(v, 'recognize', true, 1000, t0).vocab;
    expect(v.mastery).toBe(2);
    v = review(v, 'recognize', false, 1000, t0).vocab;
    expect(v.mastery).toBe(1);
    v = review(v, 'recognize', false, 1000, t0).vocab;
    expect(v.mastery).toBe(1);
    expect(v.errorCount).toBe(2);
  });

  it('答错的词十分钟后就要再考，不是明天', () => {
    const v = review(freshVocab('issue', t0), 'recognize', false, 1000, t0).vocab;
    expect(v.nextReview - t0).toBe(10 * 60 * 1000);
  });

  it('反应快慢会影响下次间隔', () => {
    const base = freshVocab('update', t0);
    const fast = review(base, 'recognize', true, 1200, t0).vocab;
    const slow = review(base, 'recognize', true, 12000, t0).vocab;
    expect(fast.intervalDays).toBeGreaterThanOrEqual(slow.intervalDays);
    expect(slow.ease).toBeLessThan(fast.ease);
  });

  it('间隔有上限，不会排到几年以后', () => {
    let v = freshVocab('commute', t0);
    for (let k = 0; k < 30; k++) v = review(v, 'produce', true, 1000, t0 + k * DAY).vocab;
    expect(v.intervalDays).toBeLessThanOrEqual(180);
  });

  it('★ 今天复习什么由数据决定，错得多的排前面', () => {
    const all: Record<string, UserVocab> = {};
    for (const w of ['schedule', 'deadline', 'handle', 'issue']) {
      all[w] = { ...freshVocab(w, t0), nextReview: t0 };
    }
    all.issue.errorCount = 5;
    all.handle.errorCount = 1;
    const picked = pickReview(all, 2, { now: t0 + DAY });
    expect(picked[0].word).toBe('issue');
  });

  it('没到期的词不会被排进来', () => {
    const all: Record<string, UserVocab> = {
      schedule: { ...freshVocab('schedule', t0), nextReview: t0 + 10 * DAY },
    };
    expect(pickReview(all, 5, { now: t0 }).length).toBe(0);
  });

  it('自发使用的判定是整词匹配，不能被子串蒙混', () => {
    expect(spontaneousHits('I need a bit of time.', ['a bit'])).toEqual(['a bit']);
    expect(spontaneousHits('The arbiter decided.', ['a bit'])).toEqual([]);
    expect(spontaneousHits('I will follow up tomorrow.', ['follow up'])).toEqual(['follow up']);
  });

  it('"会用的词"只数掌握度 4 级以上的', () => {
    const all: Record<string, UserVocab> = {
      a: { ...freshVocab('a', t0), mastery: 2 },
      b: { ...freshVocab('b', t0), mastery: 4 },
      c: { ...freshVocab('c', t0), mastery: 5 },
    };
    expect(usableCount(all)).toBe(2);
  });
});

describe('词库', () => {
  it('规模够用', () => expect(VOCAB.length).toBeGreaterThanOrEqual(100));

  it('★ 每个词都有真实例句和中文对照', () => {
    const bad = VOCAB.filter((v) => !v.example || !v.exampleCn || v.example.split(/\s+/).length < 3);
    expect(bad.map((v) => v.word)).toEqual([]);
  });

  it('★ 例句里必须真的出现这个词', () => {
    // 词条里有短语动词，例句中会变形（run into → ran into），
    // 所以原形、过去式、-ing 三种形式都算命中
    const bad = VOCAB.filter((v) => {
      const head = v.word.toLowerCase().split(' ')[0];
      const forms = [head, past(head), ing(head), third(head)].filter(Boolean) as string[];
      const ex = v.example.toLowerCase();
      return !forms.some((f) => ex.includes(f));
    });
    expect(bad.map((v) => v.word)).toEqual([]);
  });

  it('每个词都有场景标签，否则排不进计划', () => {
    expect(VOCAB.filter((v) => !v.tags.length).map((v) => v.word)).toEqual([]);
  });
});

// ══════════════════════ 8. 场景引擎 ══════════════════════

describe('场景库', () => {
  it('三类场景都有', () => {
    for (const c of ['daily', 'travel', 'work'] as const) {
      expect(SCENARIOS.filter((s) => s.category === c).length, c).toBeGreaterThanOrEqual(3);
    }
  });

  it('★ 没有重复 id', () => {
    const seen = new Set<string>();
    const dup = SCENARIOS.filter((s) => (seen.has(s.id) ? true : (seen.add(s.id), false)));
    expect(dup.map((s) => s.id)).toEqual([]);
  });

  it('★ 每个场景都有明确要办成的事和评价标准', () => {
    const bad = SCENARIOS.filter((s) => !s.mission || !s.rubric.length || !s.stages.length);
    expect(bad.map((s) => s.id)).toEqual([]);
  });

  it('★ 每一步都有完整的四级提示', () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      for (const st of s.stages) {
        const h = st.hint;
        if (!h.keywords.length || !h.frame || !h.half || !h.full || !h.intentCn) bad.push(`${s.id}/${st.id}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('★ 每一步的完整参考答案自己必须是对的', () => {
    // 参考答案里如果藏着语法错误，等于在教用户说错话
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      for (const st of s.stages) {
        const found = correct(st.hint.full);
        if (found.length) bad.push(`${s.id}/${st.id}: ${st.hint.full} → ${found.map((c) => c.ruleId).join(',')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('★ 核心表达本身也必须是对的', () => {
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      for (const p of s.keyPhrases) {
        const found = correct(p.en);
        if (found.length) bad.push(`${s.id}: ${p.en} → ${found.map((c) => c.ruleId).join(',')}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('每一步的参考答案都能推进这一步', () => {
    // 否则用户照着提示说了却推不动，会立刻失去信任
    const bad: string[] = [];
    for (const s of SCENARIOS) {
      for (const st of s.stages) {
        if (!st.advance(st.hint.full)) bad.push(`${s.id}/${st.id}: "${st.hint.full}"`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('场景对话推进', () => {
  const hotel = SCENARIO_MAP['travel-hotel'];

  it('★ 只说 Hello 不会推进，NPC 仍然留在角色里', () => {
    const conv = startConversation(hotel, 'u_test');
    const r = submitTurn(conv, hotel, 'Hello.');
    expect(r.advanced).toBe(false);
    expect(r.complete).toBe(false);
    expect(r.conversation.clearedStages).toEqual([]);
    // NPC 的回应不能跳出来讲语法
    expect(r.reply).not.toMatch(/grammar|语法|should say/i);
  });

  it('反复说不到点上时，NPC 会换一句话接，而不是复读', () => {
    let conv = startConversation(hotel, 'u_test');
    const a = submitTurn(conv, hotel, 'Hello.');
    conv = a.conversation;
    const b = submitTurn(conv, hotel, 'Hi.');
    expect(b.reply).not.toBe(a.reply);
  });

  it('说到点上才推进', () => {
    const conv = startConversation(hotel, 'u_test');
    const r = submitTurn(conv, hotel, "I'd like to check in. I have a reservation under Zhou.");
    expect(r.advanced).toBe(true);
    expect(r.conversation.clearedStages).toEqual(['checkin']);
  });

  it('★ 走完全部步骤才算任务完成', () => {
    let conv = startConversation(hotel, 'u_test');
    let complete = false;
    for (const st of hotel.stages) {
      const r = submitTurn(conv, hotel, st.hint.full);
      conv = r.conversation;
      complete = r.complete;
    }
    expect(complete).toBe(true);
    expect(conv.missionComplete).toBe(true);
    expect(conv.clearedStages.length).toBe(hotel.stages.length);
  });

  it('推进与否是纯函数，同样的输入永远同样的结果', () => {
    const conv = startConversation(hotel, 'u_test');
    const a = submitTurn(conv, hotel, "I'd like to check in.");
    const b = submitTurn(conv, hotel, "I'd like to check in.");
    expect(a.advanced).toBe(b.advanced);
    expect(a.conversation.clearedStages).toEqual(b.conversation.clearedStages);
  });

  it('任务完成后再说话不会崩', () => {
    let conv = startConversation(hotel, 'u_test');
    for (const st of hotel.stages) conv = submitTurn(conv, hotel, st.hint.full).conversation;
    const extra = submitTurn(conv, hotel, 'Thanks a lot!');
    expect(extra.complete).toBe(true);
    expect(extra.reply.length).toBeGreaterThan(0);
  });

  it('用户说的话会被记下纠错和反应时间', () => {
    const conv = startConversation(hotel, 'u_test');
    const r = submitTurn(conv, hotel, 'I want check in. I very happy.', { now: Date.now() + 5000 });
    const userMsg = r.conversation.messages.filter((m) => m.role === 'user')[0];
    expect(userMsg.responseMs).toBeGreaterThan(0);
    expect(userMsg.corrections?.length).toBeGreaterThan(0);
  });
});

describe('对话复盘', () => {
  const hotel = SCENARIO_MAP['travel-hotel'];

  function playThrough(texts: string[]) {
    let conv = startConversation(hotel, 'u_test');
    for (const t of texts) conv = submitTurn(conv, hotel, t).conversation;
    return conv;
  }

  it('★ 说"任务完成"必须是真的完成了', () => {
    const done = playThrough(hotel.stages.map((s) => s.hint.full));
    const d1 = buildDebrief(done, hotel);
    expect(done.missionComplete).toBe(true);
    expect(d1.metrics.stagesCleared.value).toBe(hotel.stages.length);

    const stuck = playThrough(['Hello.', 'Hi.']);
    const d2 = buildDebrief(stuck, hotel);
    expect(stuck.missionComplete).toBe(false);
    expect(d2.metrics.stagesCleared.value).toBe(0);
    expect(d2.nextFocus).toContain('这个场景再来一次');
  });

  it('复盘的七块内容都在', () => {
    const conv = playThrough(hotel.stages.map((s) => s.hint.full));
    const d = buildDebrief(conv, hotel);
    expect(d.strengths.length).toBeGreaterThan(0);
    expect(Array.isArray(d.issues)).toBe(true);
    expect(d.naturalSwaps.length).toBeGreaterThan(0);
    expect(d.nextFocus.length).toBeGreaterThan(0);
    expect(Object.keys(d.metrics).length).toBeGreaterThan(3);
  });

  it('★ 一次复盘最多只讲 3 个问题', () => {
    const conv = playThrough([
      'I very like this hotel. I am student.',
      'He go to work. I am agree with you.',
      'Please open the light. I need some informations.',
      'Yesterday I go to the park.',
    ]);
    expect(buildDebrief(conv, hotel).issues.length).toBeLessThanOrEqual(3);
  });

  it('★ 每个指标都说得出自己是怎么来的', () => {
    const conv = playThrough(hotel.stages.map((s) => s.hint.full));
    const d = buildDebrief(conv, hotel);
    for (const [k, m] of Object.entries(d.metrics)) {
      expect(m.how, k).toBeTruthy();
      expect(['counted', 'timed', 'derived', 'asr', 'model']).toContain(m.source);
    }
  });

  it('看了提示说出来的轮数会被单独统计', () => {
    let conv = startConversation(hotel, 'u_test');
    conv = submitTurn(conv, hotel, hotel.stages[0].hint.full, { hintLevel: 4 }).conversation;
    conv = submitTurn(conv, hotel, hotel.stages[1].hint.full, { hintLevel: 0 }).conversation;
    expect(buildDebrief(conv, hotel).metrics.hintTurns.value).toBe(1);
  });
});

// ══════════════════════ 9. 测评引擎 ══════════════════════

describe('测评题库', () => {
  it('输入、输出、交流三段都有', () => {
    const kinds = new Set(ASSESSMENT_ORDER.map((i) => i.kind));
    for (const k of ['reading', 'listening', 'vocab-recognize', 'vocab-use', 'translate', 'write', 'speak']) {
      expect(kinds.has(k as never), k).toBe(true);
    }
  });

  it('★ 词汇分成"认得出"和"用得上"两组，否则测不出核心画像', () => {
    expect(ASSESSMENT_ORDER.filter((i) => i.kind === 'vocab-recognize').length).toBeGreaterThanOrEqual(2);
    expect(ASSESSMENT_ORDER.filter((i) => i.kind === 'vocab-use').length).toBeGreaterThanOrEqual(2);
  });

  it('★ 选择题的正确答案下标都在范围内', () => {
    const bad = CHOICE_ITEMS.filter((i) => i.answer < 0 || i.answer >= i.options.length);
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it('选项没有重复（重复选项等于送分或坑人）', () => {
    const bad = CHOICE_ITEMS.filter((i) => new Set(i.options).size !== i.options.length);
    expect(bad.map((i) => i.id)).toEqual([]);
  });

  it('★ 答错要有解释，不能只说"错了"', () => {
    expect(CHOICE_ITEMS.filter((i) => !i.explain || i.explain.length < 8).map((i) => i.id)).toEqual([]);
  });

  it('★ 参考答案本身必须是对的英语', () => {
    const bad: string[] = [];
    for (const item of OPEN_ITEMS) {
      for (const r of item.reference) {
        const found = correct(r);
        if (found.length) bad.push(`${item.id}: ${r} → ${found.map((c) => c.ruleId).join(',')}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('测评评分', () => {
  const answer = (itemId: string, kind: string, choice: number, text = '', elapsedMs = 4000) =>
    ({ itemId, kind, choice, text, elapsedMs }) as AssessAnswer;

  /** 全答对 + 产出也不错 */
  function strongSheet(): AssessAnswer[] {
    return [
      ...CHOICE_ITEMS.map((i) => answer(i.id, i.kind, i.answer)),
      answer('o-t1', 'translate', -1, 'I was late for work today because the subway broke down.'),
      answer('o-t2', 'translate', -1, "I mostly agree with the plan, but I'm a little worried about the timeline."),
      answer(
        'o-w1',
        'write',
        -1,
        'Last weekend I went hiking with two friends. The weather was better than we expected, so we stayed out until the evening. On Sunday I mostly rested and caught up on some reading.',
        30000,
      ),
      answer(
        'o-s1',
        'speak',
        -1,
        "I'm a product designer at a software company in Chengdu, and I've been doing this for about six years. Outside work I really enjoy cooking.",
        25000,
      ),
    ];
  }

  /** 看得懂但说不出来：选择题全对，产出题又短又错 */
  function gapSheet(): AssessAnswer[] {
    return [
      ...CHOICE_ITEMS.filter((i) => i.kind !== 'vocab-use').map((i) => answer(i.id, i.kind, i.answer)),
      ...CHOICE_ITEMS.filter((i) => i.kind === 'vocab-use').map((i) => answer(i.id, i.kind, (i.answer + 1) % i.options.length)),
      answer('o-t1', 'translate', -1, 'Today I go to work late because subway broken.'),
      answer('o-t2', 'translate', -1, 'I am agree this plan but I very worry time.'),
      answer('o-w1', 'write', -1, 'I very happy. I go park.', 60000),
      answer('o-s1', 'speak', -1, 'I am student. I very like design.', 70000),
    ];
  }

  it('★ 同一份答卷永远得到同一个结论', () => {
    const a = scoreAssessment({ userId: 'u1', answers: strongSheet(), now: 1 });
    const b = scoreAssessment({ userId: 'u1', answers: strongSheet(), now: 1 });
    expect(a.levels).toEqual(b.levels);
    expect(a.bottleneck.key).toBe(b.bottleneck.key);
    expect(a.metrics.errorPer100.value).toBe(b.metrics.errorPer100.value);
  });

  it('答得好的等级明显高于答得差的', () => {
    const strong = scoreAssessment({ userId: 'u1', answers: strongSheet(), now: 1 });
    const weak = scoreAssessment({ userId: 'u1', answers: gapSheet(), now: 1 });
    expect(cefrIndex(overallLevel(strong.levels))).toBeGreaterThan(cefrIndex(overallLevel(weak.levels)));
  });

  it('★ 能测出"会看不会说"这个核心画像', () => {
    const a = scoreAssessment({ userId: 'u1', answers: gapSheet(), now: 1 });
    // 接收类应当明显高于产出类
    expect(cefrIndex(a.levels.reading)).toBeGreaterThan(cefrIndex(a.levels.speaking));
    expect(a.bottleneck.evidence.length).toBeGreaterThan(0);
  });

  it('★ 瓶颈结论必须带着算出它的真实数据', () => {
    const a = scoreAssessment({ userId: 'u1', answers: gapSheet(), now: 1 });
    expect(a.bottleneck.title.length).toBeGreaterThan(4);
    for (const e of a.bottleneck.evidence) expect(e.length).toBeGreaterThan(4);
    expect(a.bottleneck.focus.length).toBeGreaterThan(0);
  });

  it('★ 每个指标都说得出自己是怎么来的', () => {
    const a = scoreAssessment({ userId: 'u1', answers: strongSheet(), now: 1 });
    for (const [k, m] of Object.entries(a.metrics)) {
      expect(m.how, k).toBeTruthy();
      expect(['counted', 'timed', 'derived', 'asr', 'model'], k).toContain(m.source);
    }
  });

  it('每一项等级都说得出依据', () => {
    const a = scoreAssessment({ userId: 'u1', answers: strongSheet(), now: 1 });
    for (const k of SKILLS) expect(evidenceFor(k, a.metrics).length).toBeGreaterThan(5);
  });

  it('全部跳过也不崩，而且不会给出虚高的等级', () => {
    const skipped = ASSESSMENT_ORDER.map((i) => answer(i.id, i.kind, -1));
    const a = scoreAssessment({ userId: 'u1', answers: skipped, now: 1 });
    expect(overallLevel(a.levels)).toBe('A1');
    expect(a.summary.length).toBeGreaterThan(0);
  });

  it('产出内容太少时会明说结论只是初步参考', () => {
    const thin = [
      ...CHOICE_ITEMS.map((i) => answer(i.id, i.kind, i.answer)),
      answer('o-s1', 'speak', -1, 'I am fine.'),
    ];
    const a = scoreAssessment({ userId: 'u1', answers: thin, now: 1 });
    expect(a.summary.join(' ')).toMatch(/初步参考|比较短/);
  });

  it('测评里发现的问题会被带出来进错误档案', () => {
    const a = scoreAssessment({ userId: 'u1', answers: gapSheet(), now: 1 });
    expect(a.findings.length).toBeGreaterThan(0);
    expect(a.findings[0].ruleId).toBeTruthy();
  });
});

// ══════════════════════ 10. 错误档案 ══════════════════════

describe('错误档案', () => {
  const mk = (ruleId: string, original = 'I very like it', fixed = 'I really like it'): Correction => ({
    id: `c-${Math.random()}`,
    kind: 'grammar',
    original,
    fixed,
    problem: 'p',
    why: 'w',
    ruleId,
    severity: 2,
  });

  it('同一个毛病会累加次数，而不是变成两条', () => {
    let p = emptyProfile('u1');
    p = recordErrors(p, [mk('very-like')], 1000);
    p = recordErrors(p, [mk('very-like')], 2000);
    expect(p.records.length).toBe(1);
    expect(p.records[0].count).toBe(2);
    expect(p.records[0].lastAt).toBe(2000);
  });

  it('会留下用户自己的原话，用来出专项练习题', () => {
    let p = emptyProfile('u1');
    p = recordErrors(p, [mk('very-like', 'I very like tea')], 1000);
    expect(p.records[0].samples[0].original).toBe('I very like tea');
  });

  it('★ 连续改对三次才算毕业', () => {
    let p = emptyProfile('u1');
    p = recordErrors(p, [mk('very-like')], 1000);
    expect(topErrors(p, 5, 2000).map((r) => r.ruleId)).toContain('very-like');
    p = recordCleared(p, ['very-like'], 2000);
    p = recordCleared(p, ['very-like'], 3000);
    expect(topErrors(p, 5, 4000).map((r) => r.ruleId)).toContain('very-like');
    p = recordCleared(p, ['very-like'], 4000);
    expect(topErrors(p, 5, 5000).map((r) => r.ruleId)).not.toContain('very-like');
    expect(clearedErrors(p).map((r) => r.ruleId)).toContain('very-like');
  });

  it('毕业之后又犯了，连对清零重新来过', () => {
    let p = emptyProfile('u1');
    p = recordErrors(p, [mk('very-like')], 1000);
    p = recordCleared(p, ['very-like'], 2000);
    p = recordCleared(p, ['very-like'], 3000);
    p = recordCleared(p, ['very-like'], 4000);
    expect(clearedErrors(p).length).toBe(1);
    p = recordErrors(p, [mk('very-like')], 5000);
    expect(clearedErrors(p).length).toBe(0);
  });

  it('犯得多、犯得近的排在前面', () => {
    const DAYMS = 24 * 60 * 60 * 1000;
    const now = 100 * DAYMS;
    let p = emptyProfile('u1');
    // 很久以前犯过很多次
    for (let k = 0; k < 6; k++) p = recordErrors(p, [mk('old-rule')], now - 90 * DAYMS);
    // 最近犯了几次
    for (let k = 0; k < 4; k++) p = recordErrors(p, [mk('very-like')], now - 1 * DAYMS);
    expect(topErrors(p, 1, now)[0].ruleId).toBe('very-like');
  });

  it('一句话总结必须基于真实统计', () => {
    let p = emptyProfile('u1');
    expect(summarize(p)).toBeUndefined();
    p = recordErrors(p, [mk('very-like')], 1000);
    const s = summarize(p)!;
    expect(s).toContain('1');
  });
});

// ══════════════════════ 11. 每日计划 ══════════════════════

describe('每日计划', () => {
  const baseProfile = (over: Partial<UserProfile> = {}): UserProfile => ({
    userId: 'u1',
    updatedAt: 1,
    levels: { reading: 'B1', listening: 'A2', speaking: 'A2', writing: 'A2', vocabulary: 'B1', grammar: 'A2' },
    overall: 'A2',
    streak: 0,
    totalMinutes: 0,
    totalSessions: 0,
    ...over,
  });

  const input = (over: Partial<Parameters<typeof buildPlan>[0]> = {}) => ({
    profile: baseProfile(),
    errors: emptyProfile('u1'),
    vocab: {},
    dailyMinutes: 20,
    goals: ['work'] as GoalKey[],
    date: '2026-01-05',
    now: 1_700_000_000_000,
    ...over,
  });

  it('★ 不会超出用户愿意给的时间', () => {
    for (const mins of [10, 20, 30, 45]) {
      const plan = buildPlan(input({ dailyMinutes: mins }));
      expect(plan.totalMinutes, `${mins} 分钟`).toBeLessThanOrEqual(mins + 2);
      expect(plan.activities.length).toBeGreaterThan(0);
    }
  });

  it('★ 同一天进来看到的是同一份计划', () => {
    const a = buildPlan(input());
    const b = buildPlan(input());
    expect(a.activities.map((x) => `${x.kind}:${x.title}`)).toEqual(b.activities.map((x) => `${x.kind}:${x.title}`));
  });

  it('每一项都说得出为什么今天练它', () => {
    const plan = buildPlan(input());
    for (const a of plan.activities) {
      expect(a.why, a.title).toBeTruthy();
      expect(a.why.length).toBeGreaterThan(6);
    }
    expect(plan.rationale.length).toBeGreaterThan(6);
  });

  it('★ 瓶颈是"会看不会说"时，时间偏向开口', () => {
    const plan = buildPlan(
      input({
        bottleneck: {
          key: 'receptive-productive-gap',
          title: 'x',
          evidence: ['y'],
          focus: ['speaking', 'grammar'],
        },
        dailyMinutes: 30,
      }),
    );
    const speakMins = plan.activities
      .filter((a) => a.kind === 'speaking' || a.kind === 'scenario')
      .reduce((s, a) => s + a.minutes, 0);
    const readMins = plan.activities.filter((a) => a.kind === 'reading').reduce((s, a) => s + a.minutes, 0);
    expect(speakMins).toBeGreaterThan(readMins);
  });

  it('听力落后时听力会被排进来并加时', () => {
    const plan = buildPlan(
      input({
        bottleneck: { key: 'listening-gap', title: 'x', evidence: ['y'], focus: ['listening'] },
        dailyMinutes: 30,
      }),
    );
    const listen = plan.activities.find((a) => a.kind === 'listening');
    expect(listen).toBeTruthy();
    expect(listen!.why).toContain('听力');
  });

  it('★ 有复习债的时候不再拼命加新词', () => {
    const t0 = 1_700_000_000_000;
    const vocab: Record<string, UserVocab> = {};
    for (const v of VOCAB.slice(0, 10)) vocab[v.word] = { ...freshVocab(v.word, t0 - DAY * 5), nextReview: t0 - DAY };
    const plan = buildPlan(input({ vocab, now: t0, dailyMinutes: 30 }));
    expect(plan.activities.some((a) => a.kind === 'review')).toBe(true);
    expect(plan.activities.some((a) => a.kind === 'vocab')).toBe(false);
  });

  it('错误档案里有东西时会排专项纠错', () => {
    let errs = emptyProfile('u1');
    errs = recordErrors(
      errs,
      [
        {
          id: 'c1', kind: 'grammar', original: 'I very like it', fixed: 'I really like it',
          problem: 'p', why: 'w', ruleId: 'very-like', severity: 2,
        },
      ],
      1_700_000_000_000,
    );
    const plan = buildPlan(input({ errors: errs, dailyMinutes: 30 }));
    const drill = plan.activities.find((a) => a.kind === 'drill');
    expect(drill).toBeTruthy();
    expect(drill!.payload?.ruleIds).toContain('very-like');
  });

  it('时间够的话，情景对话是一天的落点', () => {
    const plan = buildPlan(input({ dailyMinutes: 30 }));
    const scen = plan.activities.find((a) => a.kind === 'scenario');
    expect(scen).toBeTruthy();
    expect(getScenario(scen!.payload!.scenarioId!)).toBeTruthy();
  });

  it('引用的材料 id 都必须真实存在', () => {
    for (const mins of [10, 20, 30, 45]) {
      const plan = buildPlan(input({ dailyMinutes: mins }));
      for (const a of plan.activities) {
        if (a.payload?.scenarioId) expect(getScenario(a.payload.scenarioId), a.payload.scenarioId).toBeTruthy();
        if (a.payload?.clipId) expect(getClip(a.payload.clipId), a.payload.clipId).toBeTruthy();
        for (const w of a.payload?.words ?? []) expect(getWord(w), w).toBeTruthy();
      }
    }
  });
});

// ══════════════════════ 12. 存档层 ══════════════════════
// 第 23 节点名要求的四件事：数据不串、记录不丢、重复提交不重复、写不进去不崩

describe('存档', () => {
  const rec = (id: string, at = Date.now()) => ({
    id,
    userId: 'x',
    at,
    transcript: 'hello',
    via: 'typed' as const,
    metrics: {},
    corrections: [],
  });

  beforeEach(() => {
    memStore.full = false;
    memStore.clear();
    switchUser('u_local');
  });

  it('★ 重复提交同一条记录不会产生两条', () => {
    saveSpeaking(rec('sp-1'));
    saveSpeaking(rec('sp-1'));
    saveSpeaking(rec('sp-1'));
    expect(getSpeaking().filter((r) => r.id === 'sp-1').length).toBe(1);
  });

  it('★ 两个用户的数据不会串', () => {
    switchUser('user-a');
    saveSpeaking(rec('sp-a'));
    saveUser({ name: 'A' });
    switchUser('user-b');
    expect(getSpeaking().length).toBe(0);
    expect(getUser().name).toBe('');
    saveSpeaking(rec('sp-b'));
    expect(getSpeaking().map((r) => r.id)).toEqual(['sp-b']);
    switchUser('user-a');
    expect(getSpeaking().map((r) => r.id)).toEqual(['sp-a']);
    expect(getUser().name).toBe('A');
  });

  it('★ 存不进去（无痕模式/配额满）也不能崩', () => {
    memStore.full = true;
    expect(() => saveSpeaking(rec('sp-x'))).not.toThrow();
    expect(() => saveUser({ name: '测试' })).not.toThrow();
    expect(() => saveVocab(freshVocab('schedule'))).not.toThrow();
    expect(() => getProfile()).not.toThrow();
    expect(isStorageBroken()).toBe(true);
  });

  it('★ 存档被写坏时当作新用户，而不是打不开', () => {
    localStorage.setItem('coach-save-v1', '{这不是合法 JSON');
    expect(() => getProfile()).not.toThrow();
    expect(getUser().name).toBe('');
    expect(hasAssessment()).toBe(false);
  });

  it('存档里字段缺失/类型不对时会被修补，不会让 undefined 穿到界面', () => {
    localStorage.setItem(
      'coach-save-v1',
      JSON.stringify({ version: 1, currentUserId: 'u_local', buckets: { u_local: { speaking: 'not-an-array', profile: 7 } } }),
    );
    expect(getSpeaking()).toEqual([]);
    expect(getProfile().levels).toEqual({});
    expect(Array.isArray(getErrorProfile().records)).toBe(true);
  });

  it('刷新页面（重新读取）后学习记录还在', () => {
    saveVocab({ ...freshVocab('schedule'), mastery: 4 });
    saveSpeaking(rec('sp-keep'));
    // 重新读一次，模拟刷新
    expect(getVocabAll().schedule.mastery).toBe(4);
    expect(getSpeaking().map((r) => r.id)).toContain('sp-keep');
  });

  it('★ 同一天重复记学习，连续天数只加一次', () => {
    const p1 = recordStudy(10, '2026-03-01');
    expect(p1.streak).toBe(1);
    const p2 = recordStudy(10, '2026-03-01');
    expect(p2.streak).toBe(1);
    expect(p2.totalMinutes).toBe(20);
    expect(p2.totalSessions).toBe(1);
  });

  it('连着两天学，连续天数才涨；断一天就从 1 重新开始', () => {
    recordStudy(10, '2026-03-01');
    expect(recordStudy(10, '2026-03-02').streak).toBe(2);
    expect(recordStudy(10, '2026-03-04').streak).toBe(1);
  });

  it('同一天的能力曲线只留一个点', () => {
    addProgressPoint({ date: '2026-03-01', levels: { speaking: 'A2' }, minutes: 10 });
    addProgressPoint({ date: '2026-03-01', levels: { speaking: 'B1' }, minutes: 20 });
    const pts = getProgress().points.filter((p) => p.date === '2026-03-01');
    expect(pts.length).toBe(1);
    expect(pts[0].levels.speaking).toBe('B1');
  });

  it('清空之后确实什么都不剩', () => {
    saveSpeaking(rec('sp-1'));
    saveUser({ name: '测试' });
    resetCurrentUser();
    expect(getSpeaking()).toEqual([]);
    expect(getUser().name).toBe('');
    expect(hasAssessment()).toBe(false);
  });
});

// ══════════════════════ 13. AI 层：Mock 与降级 ══════════════════════

describe('AI 配置', () => {
  beforeEach(() => {
    memStore.full = false;
    memStore.clear();
  });

  it('★ 默认就是本地模式：不配置任何东西也能用', () => {
    const cfg = loadConfig();
    expect(cfg.mode).toBe('local');
    expect(remoteAvailable(cfg).ok).toBe(false);
    expect(remoteAvailable(cfg).reason).toBeTruthy();
  });

  it('选了远端但没填地址，会说清楚原因而不是静默失败', () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote' });
    const a = remoteAvailable();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain('网关地址');
  });

  it('地址格式不对会被拦下', () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'not-a-url' });
    expect(remoteAvailable().ok).toBe(false);
  });

  it('填对了才算可用', () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'https://example.com/coach' });
    expect(remoteAvailable().ok).toBe(true);
  });

  it('★ 坏掉的存档不会让超时变成 0（那会让所有请求立刻失败）', () => {
    localStorage.setItem('coach-ai-config', JSON.stringify({ mode: 'remote', timeoutMs: 0 }));
    expect(loadConfig().timeoutMs).toBeGreaterThanOrEqual(1000);
    localStorage.setItem('coach-ai-config', '坏掉的内容');
    expect(loadConfig().mode).toBe('local');
  });
});

describe('AI 返回内容的清洗', () => {
  it('去掉引号、角色名前缀和代码块', () => {
    expect(cleanNpcLine('"Good evening!"', 'fallback')).toBe('Good evening!');
    expect(cleanNpcLine('Receptionist: Good evening!', 'fallback')).toBe('Good evening!');
    expect(cleanNpcLine('```\nGood evening!\n```', 'fallback')).toBe('Good evening!');
  });

  it('★ 空返回和垃圾返回一律退回本地台词', () => {
    expect(cleanNpcLine('', 'fallback')).toBe('fallback');
    expect(cleanNpcLine('   ', 'fallback')).toBe('fallback');
  });

  it('★ 模型跑出角色去讲语法时，退回本地台词', () => {
    // 这是角色扮演最致命的失败：前台突然开始教英语
    expect(cleanNpcLine('You should say "I would like to check in". Note: grammar tip.', 'fallback')).toBe('fallback');
    expect(cleanNpcLine('Correction: use the present perfect here.', 'fallback')).toBe('fallback');
  });

  it('模型附带的讲解段落会被截掉，只留台词', () => {
    const out = cleanNpcLine('Of course, may I see your passport?\n\nThis line uses a polite request form.', 'fb');
    expect(out).toBe('Of course, may I see your passport?');
  });

  it('过长的返回会被截断，不会撑破气泡', () => {
    const out = cleanNpcLine('x'.repeat(900), 'fb');
    expect(out.length).toBeLessThanOrEqual(320);
  });

  it('markdown 代码块会被剥掉', () => {
    expect(unwrap('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(unwrap('plain')).toBe('plain');
  });
});

describe('AI 网关失败', () => {
  beforeEach(() => {
    memStore.full = false;
    memStore.clear();
  });

  const fakeCorrection: Correction = {
    id: 'c1', kind: 'grammar', original: 'I very like it', fixed: 'I really like it',
    problem: '问题', why: '本地写好的解释', ruleId: 'very-like', severity: 2,
  };
  const profile: UserProfile = {
    userId: 'u1', updatedAt: 1, levels: {}, streak: 0, totalMinutes: 0, totalSessions: 0,
  };

  it('★ 没配网关时，解释直接用本地的，不发请求', async () => {
    const out = await explainCorrection(fakeCorrection, profile, []);
    expect(out.engine).toBe('local');
    expect(out.value).toBe('本地写好的解释');
  });

  it('★ 网关连不上时降级回本地，并且如实说明', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'http://127.0.0.1:59999/dead', timeoutMs: 1500 });
    const out = await explainCorrection(fakeCorrection, profile, []);
    expect(out.engine).toBe('local');
    expect(out.value).toBe('本地写好的解释');
    expect(out.note).toContain('本地引擎');
  });

  it('★ 网关返回 500 时降级', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'https://example.com/coach', timeoutMs: 1500 });
    const original = globalThis.fetch;
    globalThis.fetch = (async () => new Response('boom', { status: 500 })) as typeof fetch;
    try {
      const out = await explainCorrection(fakeCorrection, profile, []);
      expect(out.engine).toBe('local');
      expect(out.note).toContain('500');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('★ 网关返回空内容时降级', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'https://example.com/coach', timeoutMs: 1500 });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ text: '' }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    try {
      const out = await explainCorrection(fakeCorrection, profile, []);
      expect(out.engine).toBe('local');
      expect(out.value).toBe('本地写好的解释');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('★ 网关返回一堆废话（超长）时也不采用', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'https://example.com/coach', timeoutMs: 1500 });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ text: '啰嗦'.repeat(400) }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const out = await explainCorrection(fakeCorrection, profile, []);
      expect(out.engine).toBe('local');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('网关正常时才会采用模型的解释', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'https://example.com/coach', timeoutMs: 1500 });
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ text: '你这个毛病上次也犯过。' }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })) as typeof fetch;
    try {
      const out = await explainCorrection(fakeCorrection, profile, []);
      expect(out.engine).toBe('remote');
      expect(out.value).toBe('你这个毛病上次也犯过。');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('★ 超时会被中断并降级，不会一直挂着', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'https://example.com/coach', timeoutMs: 1000 });
    const original = globalThis.fetch;
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    try {
      const started = Date.now();
      const out = await explainCorrection(fakeCorrection, profile, []);
      expect(out.engine).toBe('local');
      expect(Date.now() - started).toBeLessThan(4000);
    } finally {
      globalThis.fetch = original;
    }
  });
});
