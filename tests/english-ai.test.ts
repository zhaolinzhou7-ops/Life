/**
 * AI 层与安全边界自测
 *
 * 两件事必须钉死：
 *
 * 1. **Mock 模式是完整的，不是占位的。** 没有 API Key 时，对话能对、
 *    故事能出、报告能写。做不到这一点，「支持 Mock」就是句空话。
 *
 * 2. **安全边界在两个方向上都生效，而且不依赖网络。** 模型说的话要过一遍，
 *    孩子说的话也要过一遍。规则写在代码里而不是只写在 prompt 里，
 *    正是因为不能假设模型一定听话。
 *
 * 标 ★ 的是产品底线。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import { DEFLECT, checkOutbound, scrubChildInput } from '../src/english/ai/safety';
import { mockProvider } from '../src/english/ai/mock';
import { remoteProvider } from '../src/english/ai/remote';
import { aiChat, aiStory, aiAssessment, engineStatus } from '../src/english/ai';
import { DEFAULT_CONFIG, loadConfig, saveConfig } from '../src/english/ai/config';
import { extractJson, validateStory, wordCount, type ParsedStory } from '../src/english/ai/prompt';
import { getWord } from '../src/english/data/vocab';
import { newChild } from '../src/english/engine/profile';
import { newMemory } from '../src/english/engine/review';
import { detectWeakness } from '../src/english/engine/weakness';
import type { CoachTurn } from '../src/english/types';

const kid = () => newChild('Mimi', 5, '🐣');

beforeEach(() => {
  memStore.clear();
  memStore.full = false;
  saveConfig({ ...DEFAULT_CONFIG });
});

// ════════════════════ 安全边界 ════════════════════

describe('模型 → 孩子', () => {
  it('★ 索取个人信息一律拦下', () => {
    for (const bad of [
      'Where do you live?',
      "What's your address?",
      'What school do you go to?',
      'Can you tell me your phone number?',
      'Send me a photo of you.',
      '你家住哪里呀？',
      '你在哪个学校上学？',
    ]) {
      const v = checkOutbound(bad);
      expect(v.ok, bad).toBe(false);
      expect(v.replacement, bad).toBeTruthy();
      expect(v.note, bad).toBeTruthy();
    }
  });

  it('★ 引导线下接触、要求保密，拦下', () => {
    for (const bad of ["Let's meet in person!", "Don't tell your mom.", 'This is our secret.', '别告诉爸爸妈妈']) {
      expect(checkOutbound(bad).ok, bad).toBe(false);
    }
    expect(checkOutbound("Let's meet in person!").rule).toBe('stranger');
  });

  it('★ 引导消费，拦下', () => {
    for (const bad of ['Buy the premium pack!', 'Ask mom to subscribe.', '开通会员就能解锁更多']) {
      expect(checkOutbound(bad).ok, bad).toBe(false);
    }
  });

  it('★ 不适合年龄的内容，拦下', () => {
    for (const bad of ['The monster will kill you.', 'Do you drink beer?', 'There was a lot of blood.']) {
      expect(checkOutbound(bad).ok, bad).toBe(false);
    }
  });

  it('★ 恐吓式激励，拦下', () => {
    for (const bad of ['You are stupid.', 'You will fail.', 'No one will like you.', '你真笨']) {
      expect(checkOutbound(bad).ok, bad).toBe(false);
    }
    expect(checkOutbound('You are stupid.').rule).toBe('fear');
  });

  it('★ 拦下之后给的替代句本身必须是安全的，而且把话题拉回学习', () => {
    for (const bad of ['Where do you live?', 'You are stupid.', 'Buy it now!', "Let's meet."]) {
      const v = checkOutbound(bad);
      expect(v.replacement).toBeTruthy();
      // 替代句不能自己又踩线
      expect(checkOutbound(v.replacement!).ok, v.replacement).toBe(true);
    }
  });

  it('正常的教学用语不会被误伤', () => {
    for (const good of [
      'What is this?',
      'Yes! An apple! Great job!',
      'Almost! Listen again.',
      "It's b...",
      'Can you say it with me?',
      'What color is the ball?',
      'Do you like cats?',
      'Good try! Let us listen again.',
    ]) {
      expect(checkOutbound(good).ok, good).toBe(true);
    }
  });
});

describe('孩子 → 模型', () => {
  it('★ 电话、地址、学校、邮箱在进 prompt 之前就被抹掉', () => {
    const cases = [
      '我家住在北京市朝阳区幸福路',
      'my number is 138 0013 8000',
      'I live at 221 Baker Street',
      '我在阳光幼儿园',
      'my email is kid@example.com',
    ];
    for (const c of cases) {
      const r = scrubChildInput(c);
      expect(r.found, c).toBe(true);
      expect(r.labels.length, c).toBeGreaterThan(0);
    }
    expect(scrubChildInput('my number is 138 0013 8000').text).not.toMatch(/\d{4}/);
    expect(scrubChildInput('my email is kid@example.com').text).not.toContain('@');
  });

  it('普通回答不受影响', () => {
    for (const ok of ['apple', 'I like cats', 'red', 'My name is Mimi', 'I am five']) {
      const r = scrubChildInput(ok);
      expect(r.found, ok).toBe(false);
      expect(r.text, ok).toBe(ok);
    }
  });

  it('★ 孩子说了敏感信息时，教练不追问、不评判，直接换话题', () => {
    for (const d of DEFLECT) {
      expect(checkOutbound(d).ok, d).toBe(true);
      // 不能出现任何暗示孩子做错了的措辞
      expect(d).not.toMatch(/don't|should not|never say|不要说/i);
    }
  });
});

// ════════════════════ Mock 模式的完整性 ════════════════════

describe('内置引擎 · 对话', () => {
  it('★ 开场就能问出第一个问题', async () => {
    const r = await mockProvider.chat({
      profile: kid(),
      level: 1,
      history: [],
      childSaid: '',
      hintCount: 0,
      seed: 1,
    });
    expect(r.say.length).toBeGreaterThan(3);
    expect(r.nodeId).toBeTruthy();
  });

  it('★ 答对了会往下走，答错了停在原地给提示', async () => {
    const start = await mockProvider.chat({ profile: kid(), level: 1, history: [], childSaid: '', hintCount: 0, seed: 1 });
    const history: CoachTurn[] = [{ role: 'coach', text: start.say, nodeId: start.nodeId }];

    const good = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: 'hello', hintCount: 0, seed: 1 });
    expect(good.nodeId).not.toBe(start.nodeId);
    expect(good.judged).toBe('right');

    const bad = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: 'banana', hintCount: 0, seed: 1 });
    expect(bad.nodeId).toBe(start.nodeId);
    expect(bad.judged).toBe('wrong');
  });

  it('★ 答不上来时先给提示，不直接公布答案（§10）', async () => {
    // t1-color 期望 red
    const history: CoachTurn[] = [{ role: 'coach', text: 'What color?', nodeId: 't1-color' }];
    const h0 = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: 'banana', hintCount: 0, seed: 1 });
    expect(h0.say).not.toMatch(/\bred\b/i);
    expect(h0.say).toMatch(/r\.\.\./);

    const h1 = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: 'banana', hintCount: 1, seed: 1 });
    expect(h1.say).toMatch(/starts with/i);

    // 两次提示之后才给答案，而且要求跟读
    const h2 = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: 'banana', hintCount: 2, seed: 1 });
    expect(h2.say).toMatch(/red/i);
    expect(h2.say).toMatch(/say it with me/i);
  });

  it('★ 沉默不会被当成答错，而且两次之后会温和地换一题', async () => {
    const history: CoachTurn[] = [{ role: 'coach', text: 'What color?', nodeId: 't1-color' }];
    const a = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: '', silent: true, hintCount: 0, seed: 1 });
    expect(a.judged).toBe('skip');
    expect(a.nodeId).toBe('t1-color');

    const b = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: '', silent: true, hintCount: 2, seed: 1 });
    expect(b.nodeId).not.toBe('t1-color');
    expect(b.say).toMatch(/okay|no problem|later/i);
  });

  it('开放式问题只要开口就算数', async () => {
    const history: CoachTurn[] = [{ role: 'coach', text: 'What is your name?', nodeId: 't1-name' }];
    const r = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: 'Mimi', hintCount: 0, seed: 1 });
    expect(r.judged).toBe('right');
    expect(r.say).toContain('Mimi');
  });

  it('★ 孩子在对话里说出敏感信息，教练换话题且留下家长可见的说明', async () => {
    const history: CoachTurn[] = [{ role: 'coach', text: 'What is your name?', nodeId: 't1-name' }];
    const r = await mockProvider.chat({
      profile: kid(),
      level: 1,
      history,
      childSaid: '我住在北京市朝阳区幸福路',
      hintCount: 0,
      seed: 1,
    });
    expect(r.safetyNote).toContain('没有记录');
    expect(r.say).not.toContain('北京');
    expect(checkOutbound(r.say).ok).toBe(true);
  });

  it('★ 对话一定会走到结束，不会无限循环', async () => {
    let history: CoachTurn[] = [];
    let r = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: '', hintCount: 0, seed: 1 });
    history = [{ role: 'coach', text: r.say, nodeId: r.nodeId }];
    let guard = 0;
    while (!r.end && guard < 20) {
      const answer = r.expect?.[0] ?? 'yes';
      r = await mockProvider.chat({ profile: kid(), level: 1, history, childSaid: answer, hintCount: 0, seed: 1 });
      history = [{ role: 'coach', text: r.say, nodeId: r.nodeId }];
      guard += 1;
    }
    expect(r.end).toBe(true);
    expect(guard).toBeLessThan(20);
  });

  it('★ 教练说的每一句都过得了安全规则', async () => {
    for (const level of [1, 2, 3] as const) {
      let history: CoachTurn[] = [];
      let r = await mockProvider.chat({ profile: kid(), level, history, childSaid: '', hintCount: 0, seed: level });
      let guard = 0;
      while (!r.end && guard < 20) {
        expect(checkOutbound(r.say).ok, `level ${level}: ${r.say}`).toBe(true);
        history = [{ role: 'coach', text: r.say, nodeId: r.nodeId }];
        r = await mockProvider.chat({
          profile: kid(),
          level,
          history,
          childSaid: r.expect?.[0] ?? 'yes',
          hintCount: 0,
          seed: level,
        });
        guard += 1;
      }
      expect(checkOutbound(r.say).ok).toBe(true);
    }
  });
});

describe('内置引擎 · 故事生成', () => {
  const words = ['w-cat', 'w-red', 'w-ball'].map((id) => getWord(id)!);

  it('★ 没有 API Key 也能出一个结构完整的故事', async () => {
    const s = await mockProvider.story({ level: 1, words, theme: 'animal', seed: 42 });
    expect(s.pages.length).toBeGreaterThanOrEqual(5);
    expect(s.questions.length).toBeGreaterThanOrEqual(1);
    expect(s.learningOutcome).toBeTruthy();
    for (const p of s.pages) expect(p.emoji).toBeTruthy();
  });

  it('★ 目标词真的会出现在故事里', async () => {
    const s = await mockProvider.story({ level: 2, words, theme: 'animal', seed: 7 });
    const all = s.pages.map((p) => p.text.toLowerCase()).join(' ');
    for (const w of words) expect(all, w.en).toContain(w.en.toLowerCase());
  });

  it('★ 句子长度跟着等级走（§14）', async () => {
    const limit: Record<number, number> = { 1: 6, 2: 8, 3: 11, 4: 14 };
    for (const level of [1, 2, 3, 4] as const) {
      const s = await mockProvider.story({ level, words, theme: 'animal', seed: 3 });
      for (const p of s.pages) {
        expect(wordCount(p.text), `L${level}: ${p.text}`).toBeLessThanOrEqual(limit[level]);
      }
    }
  });

  it('★ 生成的每一页都过得了安全规则', async () => {
    for (let seed = 1; seed <= 12; seed++) {
      const s = await mockProvider.story({ level: 2, words, theme: 'animal', seed });
      for (const p of s.pages) expect(checkOutbound(p.text).ok, p.text).toBe(true);
    }
  });

  it('同一个种子出同一个故事', async () => {
    const a = await mockProvider.story({ level: 2, words, theme: 'animal', seed: 99 });
    const b = await mockProvider.story({ level: 2, words, theme: 'animal', seed: 99 });
    expect(a.pages.map((p) => p.text)).toEqual(b.pages.map((p) => p.text));
  });

  it('低龄故事只要求听和重复，高龄才要求开口说', async () => {
    const l1 = await mockProvider.story({ level: 1, words, theme: 'animal', seed: 5 });
    const l3 = await mockProvider.story({ level: 3, words, theme: 'animal', seed: 5 });
    expect(l1.questions.some((q) => q.kind === 'speak')).toBe(false);
    expect(l3.questions.some((q) => q.kind === 'speak')).toBe(true);
  });

  it('选择题永远有且只有一个正确答案', async () => {
    for (let seed = 1; seed <= 10; seed++) {
      const s = await mockProvider.story({ level: 2, words, theme: 'animal', seed });
      for (const q of s.questions) {
        if (q.kind !== 'choice') continue;
        expect(q.options!.filter((o) => o.correct).length).toBe(1);
      }
    }
  });
});

describe('内置引擎 · 家长报告', () => {
  it('★ 没有 API Key 也能写出完整的四段报告', async () => {
    const profile = kid();
    const mems = ['w-apple', 'w-cat', 'w-red'].map((id) => ({ ...newMemory(id, Date.now()), seen: 5, correct: 4 }));
    const r = await mockProvider.assessment({
      profile,
      memories: mems,
      weaknesses: detectWeakness(profile.english, mems),
      minutesThisWeek: 62,
      sessionsThisWeek: 5,
    });
    expect(r.headline).toContain('5');
    expect(r.vocabulary.length).toBeGreaterThan(8);
    expect(r.listening.length).toBeGreaterThan(8);
    expect(r.speaking.length).toBeGreaterThan(8);
    expect(r.advice.length).toBeGreaterThanOrEqual(1);
  });

  it('★ 报告里不出现分数和百分比（§18）', async () => {
    const profile = kid();
    profile.english.listening = 63.7;
    const r = await mockProvider.assessment({
      profile,
      memories: [],
      weaknesses: [],
      minutesThisWeek: 30,
      sessionsThisWeek: 3,
    });
    for (const t of [r.headline, r.vocabulary, r.listening, r.speaking, ...r.advice]) {
      expect(t, t).not.toMatch(/\d+\s*分\b|\d+%|\d+\.\d/);
    }
  });

  it('★ 建议是具体动作，不是"请多陪伴"这类废话', async () => {
    const profile = kid();
    profile.english.listening = 10;
    profile.english.vocabulary = 60;
    const r = await mockProvider.assessment({
      profile,
      memories: [],
      weaknesses: detectWeakness(profile.english, []),
      minutesThisWeek: 20,
      sessionsThisWeek: 2,
    });
    expect(r.advice.join(' ')).toMatch(/听|复习|每天|不用纠正|词/);
    expect(r.advice.join(' ')).not.toMatch(/多陪伴|加油|努力/);
  });

  it('一次没学过时，不假装有数据', async () => {
    const r = await mockProvider.assessment({
      profile: kid(),
      memories: [],
      weaknesses: [],
      minutesThisWeek: 0,
      sessionsThisWeek: 0,
    });
    expect(r.headline).toContain('还没有');
  });
});

// ════════════════════ 降级 ════════════════════

describe('降级', () => {
  it('★ 默认就是内置引擎，什么都不配也能用', () => {
    expect(remoteProvider.available().ok).toBe(false);
    expect(engineStatus().engine).toBe('mock');
    expect(engineStatus().detail).toContain('内置引擎');
  });

  it('配了 remote 但没填地址，仍然不可用，而且说明原因', () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote' });
    const a = remoteProvider.available();
    expect(a.ok).toBe(false);
    expect(a.reason).toContain('网关地址');
  });

  it('★ 网关挂掉时，对话照常进行，并给出家长可见的降级说明', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'http://127.0.0.1:59999/dead', timeoutMs: 300 });
    const r = await aiChat({
      profile: kid(),
      level: 1,
      history: [{ role: 'coach', text: 'What color?', nodeId: 't1-color' }],
      childSaid: 'red',
      hintCount: 0,
      seed: 1,
    });
    expect(r.engine).toBe('mock');
    expect(r.data.say.length).toBeGreaterThan(2);
    expect(r.fallbackNote).toContain('内置引擎');
  });

  it('★ 网关挂掉时，故事和报告也照常出', async () => {
    saveConfig({ ...DEFAULT_CONFIG, mode: 'remote', endpoint: 'http://127.0.0.1:59999/dead', timeoutMs: 300 });
    const words = ['w-cat', 'w-red'].map((id) => getWord(id)!);
    const s = await aiStory({ level: 1, words, theme: 'animal', seed: 1 });
    expect(s.data.pages.length).toBeGreaterThan(3);
    expect(s.engine).toBe('mock');

    const rep = await aiAssessment({
      profile: kid(),
      memories: [],
      weaknesses: [],
      minutesThisWeek: 10,
      sessionsThisWeek: 1,
    });
    expect(rep.data.headline).toBeTruthy();
  });

  it('存档写不进去（隐私模式/配额满）也不会崩', () => {
    memStore.full = true;
    expect(() => saveConfig({ ...DEFAULT_CONFIG, mode: 'remote' })).not.toThrow();
    expect(loadConfig().mode).toBe('mock'); // 没写进去，读回来还是默认值
  });

  it('存档损坏时退回默认值，而不是把用户挡在门外', () => {
    memStore.setItem('english-ai-config', '{这不是 JSON');
    expect(loadConfig()).toEqual(DEFAULT_CONFIG);
  });
});

// ════════════════════ 模型返回的解析与校验 ════════════════════

describe('模型返回的容错', () => {
  it('能从 ```json 包裹和前后废话里抠出 JSON', () => {
    expect(extractJson<{ a: number }>('好的，这是结果：\n```json\n{"a":1}\n```\n希望有帮助')).toEqual({ a: 1 });
    expect(extractJson<{ a: number }>('{"a":2}')).toEqual({ a: 2 });
    expect(extractJson<{ a: number }>('前面一句话 {"a":3} 后面一句话')).toEqual({ a: 3 });
  });

  it('抠不出来时返回 null，而不是抛异常', () => {
    expect(extractJson('完全没有 JSON')).toBeNull();
    expect(extractJson('')).toBeNull();
    expect(extractJson('{ 坏掉的')).toBeNull();
  });

  it('★ 模型编的故事不合格就整个丢掉，不凑合用', () => {
    const words = ['w-cat', 'w-red'].map((id) => getWord(id)!);
    const req = { level: 1 as const, words, theme: 'animal', seed: 1 };

    expect(validateStory(null, req).ok).toBe(false);
    // 页数不够
    expect(validateStory({ title: 'x', pages: [{ text: 'a', emoji: '1' }], questions: [] }, req).ok).toBe(false);
    // 目标词没出现
    const noWords: ParsedStory = {
      title: 'x',
      pages: Array.from({ length: 8 }, () => ({ text: 'A dog runs.', emoji: '🐶' })),
      questions: [],
    };
    const r = validateStory(noWords, req);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('目标词');
    // 句子太长
    const tooLong: ParsedStory = {
      title: 'x',
      pages: Array.from({ length: 8 }, () => ({
        text: 'The little red cat is running very fast down the long street today',
        emoji: '🐱',
      })),
      questions: [],
    };
    expect(validateStory(tooLong, req).ok).toBe(false);
  });

  it('合格的故事能通过', () => {
    const words = ['w-cat'].map((id) => getWord(id)!);
    const ok: ParsedStory = {
      title: 'The Cat',
      pages: Array.from({ length: 8 }, () => ({ text: 'The cat is here.', emoji: '🐱' })),
      questions: [{ ask: 'What is it?', options: [{ label: 'cat', emoji: '🐱', correct: true }] }],
    };
    expect(validateStory(ok, { level: 1, words, theme: 'animal', seed: 1 }).ok).toBe(true);
  });
});
