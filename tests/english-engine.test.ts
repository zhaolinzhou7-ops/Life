/**
 * 英语学习伙伴 · 引擎自测
 *
 * 这个产品最危险的失败不是白屏，而是**悄悄地教错**：
 * 把还没掌握的词判成掌握了、把「不愿开口」当成「发音不准」、
 * 给一个四岁孩子排出十五个新词、或者把「Wrong!」说给孩子听。
 * 这些在界面上都看不出来，只有断言能拦住。
 *
 * 分四层：
 *   1. 数据完整性 —— 词库、故事库自身有没有自相矛盾
 *   2. 纯函数行为 —— 复习、跟读判定、定级、薄弱点
 *   3. 任务生成   —— 在各种画像下排出来的内容合不合理
 *   4. 分析闭环   —— 学完一次之后，画像和记忆有没有正确变化
 *
 * 标 ★ 的是产品底线，红了就不能发。
 */
import { describe, expect, it } from 'vitest';
import { WORDS, getWord, distractors, THEMES, pointPrompt, findPrompt, withArticle } from '../src/english/data/vocab';
import { STORIES } from '../src/english/data/stories';
import { TALK_NODES, getNode } from '../src/english/data/dialog';
import { GAMES } from '../src/english/data/games';
import { ALMOST, PRAISE, TRY_AGAIN, ON_SKIP, hintFor } from '../src/english/data/phrases';
import { judgeSpeech, normalize, skeleton, wordSimilar } from '../src/english/engine/speech';
import {
  INTERVALS,
  applyResult,
  dueWords,
  newMemory,
  retentionBand,
  riskOf,
} from '../src/english/engine/review';
import { describeParticipation, initialProfile, levelOf, newChild } from '../src/english/engine/profile';
import { buildAssessment, scoreAssessment, shouldStop } from '../src/english/engine/level';
import { generateMission } from '../src/english/engine/mission';
import { detectWeakness, mergePrescriptions } from '../src/english/engine/weakness';
import { analyzeSession, updateStreak } from '../src/english/engine/analyze';
import { dayKey, daysBetween, hashSeed, rng } from '../src/english/engine/util';
import type { AssessAnswer, ChildProfile, SessionRecord, WordMemory } from '../src/english/types';

const DAY = 86400000;

function child(over: Partial<ChildProfile> = {}): ChildProfile {
  const c = newChild('Mimi', 5, '🐣');
  return { ...c, ...over, english: { ...c.english, ...(over.english ?? {}) } };
}

function session(over: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    childId: 'c1',
    date: dayKey(),
    startedAt: Date.now(),
    seconds: 0,
    activities: [],
    newWords: [],
    reviewWords: [],
    stars: 0,
    completed: false,
    ...over,
  };
}

// ════════════════════ 1. 数据完整性 ════════════════════

describe('词库', () => {
  it('★ 每个词都有图、有中文、有三级例句', () => {
    for (const w of WORDS) {
      expect(w.emoji, w.id).toBeTruthy();
      expect(w.zh, w.id).toBeTruthy();
      expect(w.sentences.map((s) => s.level).sort(), w.id).toEqual([1, 2, 3]);
      for (const s of w.sentences) expect(s.text.trim().length, `${w.id} L${s.level}`).toBeGreaterThan(2);
    }
  });

  it('★ 例句长度随等级递增，且 level 1 不超过 5 个词', () => {
    for (const w of WORDS) {
      const n = (t: string) => t.trim().split(/\s+/).length;
      const [a, b, c] = w.sentences.map((s) => n(s.text));
      expect(a, `${w.id} 的 level 1 例句太长：${w.sentences[0].text}`).toBeLessThanOrEqual(5);
      expect(b, w.id).toBeGreaterThanOrEqual(a);
      expect(c, w.id).toBeGreaterThanOrEqual(b);
    }
  });

  it('id 唯一', () => {
    const ids = WORDS.map((w) => w.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('每个主题都有词，且 THEMES 和词库对得上', () => {
    for (const t of THEMES) {
      expect(WORDS.some((w) => w.theme === t.id), `主题 ${t.id} 没有词`).toBe(true);
    }
    for (const w of WORDS) {
      expect(THEMES.some((t) => t.id === w.theme), `${w.id} 的主题不在 THEMES 里`).toBe(true);
    }
  });

  it('★ 起步阶段（tier 1）的词必须够多，否则四岁孩子几天就没内容学了', () => {
    expect(WORDS.filter((w) => w.tier === 1).length).toBeGreaterThanOrEqual(40);
  });

  it('干扰项优先来自同一组，而不是随便抓一个', () => {
    const apple = getWord('w-apple')!;
    const rnd = rng(1);
    const ds = distractors(apple, 2, rnd);
    expect(ds.length).toBe(2);
    expect(ds.every((d) => d.id !== apple.id)).toBe(true);
    expect(ds.every((d) => d.group === apple.group)).toBe(true);
  });

  it('干扰项不够时会放宽，永远能凑够数量', () => {
    const rnd = rng(7);
    for (const w of WORDS) {
      expect(distractors(w, 2, rnd).length, w.id).toBe(2);
    }
  });

  it('★ 拼出来的句子语法必须对——这是个教英语的产品', () => {
    for (const w of WORDS) {
      const point = pointPrompt(w);
      const find = findPrompt(w);
      const art = withArticle(w);

      // 复数不能配 is，也不能加 a/an
      if (w.plural) {
        expect(point, w.id).not.toMatch(/\bis\b/);
        expect(art, w.id).not.toMatch(/^an? /);
      }
      // 不可数不加冠词
      if (w.mass) expect(art, w.id).not.toMatch(/^an? /);
      // 元音开头用 an，辅音开头用 a
      if (!w.plural && !w.mass) {
        expect(art, w.id).toMatch(/^[aeiou]/i.test(w.en) ? /^an / : /^a /);
      }
      // 形容词和动词不该被问"在哪里"
      if (w.pos === 'adj' || w.pos === 'verb' || w.pos === 'num') {
        expect(point, `${w.id}: ${point}`).not.toMatch(/^Where /);
      }
      // 每个问法都必须是一句完整的话
      for (const q of [point, find]) {
        expect(q, w.id).toMatch(/[.?!]$/);
        expect(q.length, w.id).toBeGreaterThan(5);
      }
    }
  });

  it('★ 具体检查几个最容易写错的词', () => {
    expect(pointPrompt(getWord('w-shoes')!)).toBe('Where are the shoes?');
    expect(pointPrompt(getWord('w-apple')!)).toBe('Where is the apple?');
    expect(pointPrompt(getWord('w-red')!)).toBe('Which one is red?');
    expect(pointPrompt(getWord('w-eat')!)).toBe('Show me: eat.');
    expect(withArticle(getWord('w-apple')!)).toBe('an apple');
    expect(withArticle(getWord('w-cat')!)).toBe('a cat');
    expect(withArticle(getWord('w-milk')!)).toBe('milk');
    expect(withArticle(getWord('w-shoes')!)).toBe('shoes');
    expect(withArticle(getWord('w-grapes')!)).toBe('grapes');
  });

  it('词形里不留"orange color"这种拼凑出来的说法', () => {
    for (const w of WORDS) {
      expect(w.en, w.id).not.toMatch(/\b(color|toy)$/);
    }
  });
});

describe('故事库', () => {
  it('★ 句子长度不超过该等级的上限', () => {
    const limit: Record<number, number> = { 1: 5, 2: 7, 3: 10, 4: 13 };
    for (const s of STORIES) {
      for (const p of s.pages) {
        const n = p.text.trim().split(/\s+/).length;
        expect(n, `${s.id}: "${p.text}"`).toBeLessThanOrEqual(limit[s.level]);
      }
    }
  });

  it('★ 目标词必须在故事里真的出现，而且至少三次', () => {
    for (const s of STORIES) {
      const all = s.pages.map((p) => p.text.toLowerCase()).join(' ');
      for (const id of s.words) {
        const w = getWord(id);
        expect(w, `${s.id} 引用了词库里没有的 ${id}`).toBeTruthy();
        const stem = w!.en.toLowerCase().split(' ')[0];
        const hits = all.split(new RegExp(`\\b${stem}`, 'g')).length - 1;
        expect(hits, `${s.id} 里 ${stem} 只出现了 ${hits} 次`).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it('★ 每个故事都有互动问题，选择题必须有且只有一个正确答案', () => {
    for (const s of STORIES) {
      expect(s.questions.length, s.id).toBeGreaterThanOrEqual(1);
      for (const q of s.questions) {
        if (q.kind === 'choice') {
          expect(q.options?.length, `${s.id} ${q.ask}`).toBeGreaterThanOrEqual(2);
          expect(q.options!.filter((o) => o.correct).length, `${s.id} ${q.ask}`).toBe(1);
        } else {
          expect(q.expect?.length, `${s.id} ${q.ask}`).toBeGreaterThanOrEqual(1);
        }
      }
    }
  });

  it('★ 每个故事都写清楚了学完会什么（§21）', () => {
    for (const s of STORIES) {
      expect(s.learningOutcome.length, s.id).toBeGreaterThan(8);
    }
  });

  it('四个等级都有故事，每页都有图', () => {
    for (const lv of [1, 2, 3, 4] as const) {
      expect(STORIES.some((s) => s.level === lv), `等级 ${lv} 没有故事`).toBe(true);
    }
    for (const s of STORIES) {
      for (const p of s.pages) expect(p.emoji, `${s.id}`).toBeTruthy();
    }
  });
});

describe('对话脚本', () => {
  it('★ next 指向的节点必须存在，不能把孩子带进死路', () => {
    for (const n of TALK_NODES) {
      if (n.next) expect(getNode(n.next), `${n.id} → ${n.next}`).toBeTruthy();
    }
  });

  it('每个节点都有提示，非开放节点必须有期望答案', () => {
    for (const n of TALK_NODES) {
      expect(n.hint.length, n.id).toBeGreaterThan(2);
      if (!n.open) expect(n.expect.length, n.id).toBeGreaterThan(0);
    }
  });

  it('三个等级都有起始节点', () => {
    for (const lv of [1, 2, 3] as const) {
      expect(TALK_NODES.some((n) => n.level === lv), `等级 ${lv} 没有节点`).toBe(true);
    }
  });
});

describe('游戏定义', () => {
  it('★ 每个游戏都绑定了能力维度和学习结论（§21）', () => {
    for (const g of GAMES) {
      expect(g.skills.length, g.id).toBeGreaterThan(0);
      expect(g.outcome).toContain('{words}');
    }
  });
});

describe('话术', () => {
  it('★ 给孩子的反馈里绝不出现否定判词', () => {
    const banned = /\b(wrong|bad|stupid|fail|no!)\b|错了|不对|笨/i;
    for (const list of [PRAISE, ALMOST, TRY_AGAIN, ON_SKIP]) {
      for (const s of list) expect(s, s).not.toMatch(banned);
    }
  });

  it('★ 答错的反馈必须带下一步动作，不能只说"再试一次"', () => {
    for (const s of [...ALMOST, ...TRY_AGAIN]) {
      expect(s, s).toMatch(/listen|together|with me|one more|again/i);
    }
  });

  it('★ 提示分三级，第一级不能泄底', () => {
    expect(hintFor('black', 1)).toBe("It's b...");
    expect(hintFor('black', 1)).not.toContain('black');
    expect(hintFor('black', 2)).toContain('bl');
    // 第三级才给答案，而且要求跟读
    expect(hintFor('black', 3)).toContain('black');
    expect(hintFor('black', 3)).toMatch(/say it with me/i);
  });
});

// ════════════════════ 2. 纯函数行为 ════════════════════

describe('跟读判定', () => {
  it('说对了就是对的', () => {
    expect(judgeSpeech({ target: 'apple', heard: 'apple' }).tag).toBe('right');
    expect(judgeSpeech({ target: 'apple', heard: 'Apple.' }).tag).toBe('right');
    expect(judgeSpeech({ target: 'a red ball', heard: 'a red ball' }).tag).toBe('right');
  });

  it('★ 词对了但元音飘，判 close 而不是 wrong', () => {
    // 辅音骨架一致，元音不准：这是孩子最常见的情况，不该被判错
    const j = judgeSpeech({ target: 'three', heard: 'tree' });
    expect(j.tag).not.toBe('wrong');
    expect(judgeSpeech({ target: 'red', heard: 'rad' }).tag).not.toBe('wrong');
  });

  it('★ 说的完全是别的词，才判 wrong', () => {
    expect(judgeSpeech({ target: 'apple', heard: 'elephant' }).tag).toBe('wrong');
    expect(judgeSpeech({ target: 'cat', heard: 'banana' }).tag).toBe('wrong');
  });

  it('漏词会被指出来，而且不算全对', () => {
    const j = judgeSpeech({ target: 'a red ball', heard: 'ball' });
    expect(j.tag).not.toBe('right');
    expect(j.note).toContain('red');
  });

  it('说得比要求多，不扣分', () => {
    const j = judgeSpeech({ target: 'apple', heard: 'this is a big red apple' });
    expect(j.tag).toBe('right');
  });

  it('★ 没听到声音不会崩，而且明确说明原因', () => {
    const j = judgeSpeech({ target: 'apple', heard: '' });
    expect(j.tag).toBe('wrong');
    expect(j.retry).toBe(true);
    expect(j.note).toContain('没有听到');
  });

  it('★ 第二次尝试放宽，不让孩子卡在同一个词上', () => {
    const a = judgeSpeech({ target: 'three', heard: 'tree', attempt: 1 });
    const b = judgeSpeech({ target: 'three', heard: 'tree', attempt: 2 });
    expect(a.tag).toBe('close');
    expect(b.tag).toBe('right');
  });

  it('★ 给孩子的反馈里没有任何数字', () => {
    for (const heard of ['apple', 'tree', 'banana', '']) {
      const j = judgeSpeech({ target: 'three', heard });
      expect(j.feedback).not.toMatch(/\d/);
    }
  });

  it('accept 里的任意一种说法都算对', () => {
    const j = judgeSpeech({ target: 'red', heard: 'it is red', accept: ['it is red', 'a red ball'] });
    expect(j.tag).toBe('right');
  });

  it('辅音骨架把常见的儿童发音归到一起', () => {
    expect(skeleton('three')).toBe(skeleton('tree'));
    expect(skeleton('phone')).toBe(skeleton('fon'));
    expect(wordSimilar('apple', 'aple')).toBeGreaterThan(0.7);
    expect(wordSimilar('apple', 'elephant')).toBeLessThan(0.5);
  });

  it('normalize 去掉标点和大小写', () => {
    expect(normalize('  A Red, BALL! ')).toBe('a red ball');
  });
});

describe('复习引擎', () => {
  const now = Date.now();

  it('答对升盒，间隔变长', () => {
    let m = newMemory('w-apple', now);
    const gaps: number[] = [];
    for (let i = 0; i < 4; i++) {
      m = applyResult(m, 'right', 'recognize', now);
      gaps.push(Math.round((m.dueAt - now) / DAY));
    }
    expect(gaps).toEqual([INTERVALS[1], INTERVALS[2], INTERVALS[3], INTERVALS[4]]);
  });

  it('★ 连续正确三次且进到高盒才算掌握（§19）', () => {
    let m = newMemory('w-apple', now);
    m = applyResult(m, 'right', 'recognize', now);
    m = applyResult(m, 'right', 'recognize', now);
    expect(m.mastered).toBe(false);
    m = applyResult(m, 'right', 'recognize', now);
    expect(m.streak).toBe(3);
    m = applyResult(m, 'right', 'recognize', now);
    expect(m.mastered).toBe(true);
  });

  it('★ 答错只退一盒，并且当场重新排队——不清零', () => {
    let m = newMemory('w-yellow', now);
    for (let i = 0; i < 4; i++) m = applyResult(m, 'right', 'recognize', now);
    const box = m.box;
    m = applyResult(m, 'wrong', 'listen', now);
    expect(m.box).toBe(box - 1);
    expect(m.box).toBeGreaterThan(0);
    expect(m.dueAt).toBeLessThanOrEqual(now);
    expect(m.streak).toBe(0);
  });

  it('★ 错误按环节分开记，这是薄弱点归因的依据', () => {
    let m = newMemory('w-cat', now);
    m = applyResult(m, 'wrong', 'listen', now);
    m = applyResult(m, 'wrong', 'listen', now);
    m = applyResult(m, 'wrong', 'speak', now);
    expect(m.errors.listen).toBe(2);
    expect(m.errors.speak).toBe(1);
    expect(m.errors.recognize).toBe(0);
  });

  it('★ 靠提示答对不升盒', () => {
    let m = newMemory('w-dog', now);
    m = applyResult(m, 'right', 'recognize', now, true);
    expect(m.box).toBe(0);
    expect(m.streak).toBe(0);
    expect(m.dueAt).toBeGreaterThan(now);
  });

  it('跳过不算错，但会很快再出现', () => {
    let m = newMemory('w-dog', now);
    m = applyResult(m, 'skip', 'recognize', now);
    expect(m.wrong).toBe(0);
    expect(m.dueAt - now).toBeLessThan(DAY);
  });

  it('到期的词按逾期时长排序', () => {
    const a = { ...newMemory('a', now), dueAt: now - 3 * DAY };
    const b = { ...newMemory('b', now), dueAt: now - DAY };
    const c = { ...newMemory('c', now), dueAt: now + DAY };
    const due = dueWords([b, c, a], now);
    expect(due.map((m) => m.wordId)).toEqual(['a', 'b']);
  });

  it('掌握了的词风险被压低，不会因为偶尔错一次就被拉回重点', () => {
    const base = newMemory('x', now);
    const plain: WordMemory = { ...base, seen: 10, wrong: 4, dueAt: now - 4 * DAY };
    const mastered: WordMemory = { ...plain, mastered: true };
    expect(riskOf(mastered, now)).toBeLessThan(riskOf(plain, now));
  });

  it('retentionBand 只给三档，不给百分比', () => {
    const fresh = newMemory('x', now);
    expect(retentionBand(fresh, now)).toBe('shaky');
    let m = fresh;
    for (let i = 0; i < 4; i++) m = applyResult(m, 'right', 'recognize', now);
    expect(retentionBand(m, now)).toBe('solid');
  });
});

describe('定级', () => {
  it('★ 6 岁以下不出认字题（§7）', () => {
    for (const age of [4, 5, 6]) {
      const items = buildAssessment(age);
      expect(items.some((i) => i.kind === 'pick-word'), `${age} 岁出现了认字题`).toBe(false);
    }
    expect(buildAssessment(8).some((i) => i.kind === 'pick-word')).toBe(true);
  });

  it('题量适中，且从简单开始', () => {
    const items = buildAssessment(5);
    expect(items.length).toBeGreaterThanOrEqual(8);
    expect(items.length).toBeLessThanOrEqual(11);
    expect(items[0].tier).toBe(1);
  });

  it('★ 每道选择题都有正确答案在选项里', () => {
    for (const age of [4, 8, 12]) {
      for (const it of buildAssessment(age)) {
        if (it.kind === 'say') continue;
        expect(it.options.some((o) => o.wordId === it.wordId), it.id).toBe(true);
        expect(it.options.length, it.id).toBe(3);
      }
    }
  });

  it('★ 连错两题就停，不把孩子一路问到懵', () => {
    const mk = (r: AssessAnswer['result']): AssessAnswer => ({ itemId: 'x', result: r, hinted: false, ms: 1 });
    expect(shouldStop([mk('right'), mk('right'), mk('wrong'), mk('wrong')])).toBe(true);
    expect(shouldStop([mk('right'), mk('right'), mk('wrong'), mk('right')])).toBe(false);
    // 前三题不停，避免一开局就结束
    expect(shouldStop([mk('wrong'), mk('wrong')])).toBe(false);
  });

  it('全对的孩子等级高于全错的', () => {
    const items = buildAssessment(8, 3);
    const all = (r: AssessAnswer['result']) =>
      items.map((i) => ({ itemId: i.id, result: r, hinted: false, ms: 1 }));
    const good = scoreAssessment(8, items, all('right'));
    const bad = scoreAssessment(8, items, all('wrong'));
    expect(good.profile.listening).toBeGreaterThan(bad.profile.listening);
    expect(good.accuracy).toBe(1);
    expect(bad.accuracy).toBe(0);
  });

  it('★ 跟读全跳过时，报告说的是"没开口"而不是"发音不准"', () => {
    const items = buildAssessment(5, 5);
    const answers: AssessAnswer[] = items.map((i) => ({
      itemId: i.id,
      result: i.kind === 'say' ? 'skip' : 'right',
      hinted: false,
      ms: 1,
    }));
    const out = scoreAssessment(5, items, answers);
    expect(out.report).toContain('没有开口');
    expect(out.report).not.toContain('发音不准');
    expect(out.profile.participation.skips).toBeGreaterThan(0);
  });

  it('5 岁不测认读时，reading 保持很低而不是瞎猜一个值', () => {
    const items = buildAssessment(5, 2);
    const answers = items.map((i) => ({ itemId: i.id, result: 'right' as const, hinted: false, ms: 1 }));
    expect(scoreAssessment(5, items, answers).profile.reading).toBeLessThanOrEqual(6);
  });

  it('等级由能力推导，不由年龄决定', () => {
    const young = initialProfile(4);
    const old = initialProfile(11);
    expect(levelOf(young)).toBe('starter');
    // 一个 4 岁但能力很强的孩子，照样能到高阶
    const strong = { ...young, listening: 85, speaking: 80, pronunciation: 78, vocabulary: 84, comprehension: 80, reading: 70, sentence: 72, retention: 80 };
    expect(levelOf(strong)).toBe('talker');
    // 一个 11 岁但零基础的孩子，不会被年龄推上去
    const weak = { ...old, listening: 10, speaking: 8, pronunciation: 8, vocabulary: 10, comprehension: 9, reading: 5, sentence: 5, retention: 10 };
    expect(levelOf(weak)).toBe('starter');
  });
});

describe('参与行为描述', () => {
  it('★ 不返回任何分数，只描述行为', () => {
    const p = initialProfile(6);
    p.participation = { attempts: 20, skips: 10, hintsUsed: 10, voluntarySpeak: 2, promptedSpeak: 6, updatedAt: 0 };
    const s = describeParticipation(p.participation);
    expect(s).not.toMatch(/\d+\s*分|\d+%/);
    expect(s).toContain('放弃');
  });

  it('数据太少时明说看不出来，不硬下结论', () => {
    const p = initialProfile(6);
    expect(describeParticipation(p.participation)).toContain('看不出');
  });

  it('主动开口多的孩子，描述里说的是"主动"', () => {
    const p = initialProfile(6);
    p.participation = { attempts: 30, skips: 1, hintsUsed: 2, voluntarySpeak: 20, promptedSpeak: 3, updatedAt: 0 };
    const s = describeParticipation(p.participation);
    expect(s).toContain('主动');
    expect(s).toContain('很少用提示');
  });
});

// ════════════════════ 3. 任务生成 ════════════════════

describe('每日任务', () => {
  const date = '2026-03-05';

  it('★ 同一天同一个孩子，生成结果必须一致', () => {
    const c = child();
    const a = generateMission({ profile: c, memories: [], date });
    const b = generateMission({ profile: c, memories: [], date });
    expect(a.steps.map((s) => s.id + s.wordIds.join(','))).toEqual(
      b.steps.map((s) => s.id + s.wordIds.join(',')),
    );
  });

  it('★ 不超时。家长设了 10 分钟就不能排出 20 分钟的任务', () => {
    for (const min of [10, 15, 20]) {
      const c = child();
      c.settings.dailyMinutes = min;
      const m = generateMission({ profile: c, memories: [], date });
      expect(m.estimateMin, `${min} 分钟档排出了 ${m.estimateMin} 分钟`).toBeLessThanOrEqual(min + 2);
    }
  });

  it('★ 起步阶段的新词不超过 5 个', () => {
    const c = child();
    const m = generateMission({ profile: c, memories: [], date });
    const words = m.steps.find((s) => s.id === 'm-words');
    expect(words?.wordIds.length).toBeLessThanOrEqual(5);
  });

  it('★ 每一步都说清楚学完会什么（§21）', () => {
    const c = child();
    const m = generateMission({ profile: c, memories: [], date });
    for (const s of m.steps) {
      expect(s.learningOutcome.length, s.id).toBeGreaterThan(5);
      expect(s.titleZh.length, s.id).toBeGreaterThan(1);
    }
  });

  it('★ 复习债多的日子会少上新词', () => {
    const c = child();
    const now = Date.now();
    const many: WordMemory[] = WORDS.slice(0, 14).map((w) => ({
      ...newMemory(w.id, now - 10 * DAY),
      dueAt: now - 2 * DAY,
      seen: 3,
    }));
    const light = generateMission({ profile: c, memories: [], date });
    const heavy = generateMission({ profile: c, memories: many, date, now });
    const n = (m: typeof light) => m.steps.find((s) => s.id === 'm-words')?.wordIds.length ?? 0;
    expect(n(heavy)).toBeLessThan(n(light));
    expect(heavy.steps.some((s) => s.id === 'm-review')).toBe(true);
  });

  it('★ 不愿开口的孩子不排自由对话，而且不推跟读挑战（§20 画像 A）', () => {
    const c = child();
    c.english.speaking = 15;
    c.english.vocabulary = 60;
    c.english.participation = { attempts: 40, skips: 14, hintsUsed: 20, voluntarySpeak: 1, promptedSpeak: 3, updatedAt: 0 };
    const ws = detectWeakness(c.english, []);
    const rx = mergePrescriptions(ws);
    expect(rx.lowPressure).toBe(true);
    const m = generateMission({ profile: c, memories: [], prescription: rx, date });
    expect(m.steps.some((s) => s.kind === 'talk')).toBe(false);
    expect(m.steps.find((s) => s.kind === 'game')?.gameId).not.toBe('echo');
    expect(m.reason).toContain('低压力');
  });

  it('★ 关掉麦克风后，不会排出需要麦克风的游戏', () => {
    const c = child();
    c.settings.allowVoice = false;
    for (const d of ['2026-03-01', '2026-03-02', '2026-03-03', '2026-03-04']) {
      const m = generateMission({ profile: c, memories: [], date: d });
      expect(m.steps.find((s) => s.kind === 'game')?.gameId, d).not.toBe('echo');
      expect(m.steps.some((s) => s.kind === 'talk'), d).toBe(false);
    }
  });

  it('听力弱的孩子会拿到听力类游戏（§20 画像 C）', () => {
    const c = child();
    c.english.listening = 15;
    c.english.vocabulary = 65;
    c.english.speaking = 55;
    const ws = detectWeakness(c.english, []);
    const rx = mergePrescriptions(ws);
    expect(rx.boostSkills).toContain('listening');
    const m = generateMission({ profile: c, memories: [], prescription: rx, date });
    const g = m.steps.find((s) => s.kind === 'game');
    expect(['findit', 'listen-jump']).toContain(g?.gameId);
  });

  it('还不识字的孩子不会被推认读游戏', () => {
    const c = child();
    c.english.reading = 5;
    for (const d of ['2026-04-01', '2026-04-02', '2026-04-03', '2026-04-04', '2026-04-05']) {
      const m = generateMission({ profile: c, memories: [], date: d });
      expect(m.steps.find((s) => s.kind === 'game')?.gameId, d).not.toBe('match');
    }
  });

  it('★ 会说明为什么是这些内容，家长端要原样展示', () => {
    const c = child();
    const m = generateMission({ profile: c, memories: [], date });
    expect(m.reason.length).toBeGreaterThan(10);
    expect(m.reason).toContain('新词');
  });

  it('故事等级跟着孩子的水平走', () => {
    const starter = child();
    const talker = child();
    talker.level = 'talker';
    talker.english = { ...talker.english, reading: 75, sentence: 75 };
    const a = generateMission({ profile: starter, memories: [], date });
    const b = generateMission({ profile: talker, memories: [], date });
    const sa = STORIES.find((s) => s.id === a.steps.find((x) => x.kind === 'story')?.storyId);
    const sb = STORIES.find((s) => s.id === b.steps.find((x) => x.kind === 'story')?.storyId);
    if (sa && sb) expect(sb.level).toBeGreaterThanOrEqual(sa.level);
  });

  it('词学完了也不会排空任务——永远有东西可学', () => {
    const c = child();
    c.level = 'talker';
    const all: WordMemory[] = WORDS.map((w) => ({ ...newMemory(w.id, 0), seen: 5, mastered: true, box: 5 }));
    const m = generateMission({ profile: c, memories: all, date });
    expect(m.steps.length).toBeGreaterThan(0);
  });
});

// ════════════════════ 4. 薄弱点与分析闭环 ════════════════════

describe('薄弱点检测', () => {
  it('数据太少时不下结论', () => {
    expect(detectWeakness(initialProfile(5), []).length).toBe(0);
  });

  it('★ 每条薄弱点都带能指回原始数据的依据', () => {
    const p = initialProfile(6);
    p.listening = 12;
    p.vocabulary = 62;
    p.speaking = 55;
    const ws = detectWeakness(p, []);
    expect(ws.length).toBeGreaterThan(0);
    for (const w of ws) {
      expect(w.evidence, w.id).toMatch(/\d/);
      expect(w.prescription.note.length, w.id).toBeGreaterThan(5);
    }
  });

  it('★ 颜色总混淆会被抓出来并开专项（§20 画像 D）', () => {
    const now = Date.now();
    const p = initialProfile(6);
    const mems: WordMemory[] = WORDS.filter((w) => w.theme === 'color')
      .slice(0, 5)
      .map((w) => ({ ...newMemory(w.id, now), seen: 4, wrong: 3, correct: 1, errors: { recognize: 3, listen: 0, speak: 0, use: 0 } }));
    const ws = detectWeakness(p, mems, now);
    const color = ws.find((w) => w.id === 'theme-color');
    expect(color).toBeTruthy();
    expect(color!.prescription.boostThemes).toContain('color');
    expect(color!.prescription.focusWordIds.length).toBeGreaterThan(0);
  });

  it('★ 区分"听不出来"和"认不出来"，两种处方不同', () => {
    const now = Date.now();
    const p = initialProfile(6);
    const listen: WordMemory[] = WORDS.slice(0, 4).map((w) => ({
      ...newMemory(w.id, now),
      seen: 4,
      wrong: 3,
      errors: { recognize: 0, listen: 3, speak: 0, use: 0 },
    }));
    const recog: WordMemory[] = WORDS.slice(0, 4).map((w) => ({
      ...newMemory(w.id, now),
      seen: 4,
      wrong: 3,
      errors: { recognize: 3, listen: 0, speak: 0, use: 0 },
    }));
    const a = detectWeakness(p, listen, now).find((w) => w.id.startsWith('stage-'));
    const b = detectWeakness(p, recog, now).find((w) => w.id.startsWith('stage-'));
    expect(a?.id).toBe('stage-listen');
    expect(b?.id).toBe('stage-recognize');
    expect(a?.prescription.boostSkills).toContain('listening');
    expect(b?.prescription.boostSkills).toContain('vocabulary');
  });

  it('频繁放弃会被识别成行为问题，并降低难度', () => {
    const p = initialProfile(6);
    p.participation = { attempts: 20, skips: 12, hintsUsed: 8, voluntarySpeak: 4, promptedSpeak: 4, updatedAt: 0 };
    const w = detectWeakness(p, []).find((x) => x.id === 'behavior-skip');
    expect(w).toBeTruthy();
    expect(w!.prescription.lowPressure).toBe(true);
  });

  it('按严重程度排序', () => {
    const p = initialProfile(6);
    p.listening = 8;
    p.speaking = 35;
    const ws = detectWeakness(p, []);
    for (let i = 1; i < ws.length; i++) {
      expect(ws[i - 1].severity).toBeGreaterThanOrEqual(ws[i].severity);
    }
  });
});

describe('表现分析', () => {
  const now = Date.now();

  it('★ 答对涨、答错跌，而且跌得比涨得快', () => {
    const c = child();
    const mk = (result: 'right' | 'wrong') =>
      session({
        activities: [
          {
            kind: 'word',
            refId: 'x',
            title: 't',
            learningOutcome: 'o',
            seconds: 10,
            at: now,
            outcomes: [{ wordId: 'w-apple', skill: 'listening', result, hinted: false, at: now }],
          },
        ],
      });
    const up = analyzeSession(c, [], mk('right'), now);
    const down = analyzeSession(c, [], mk('wrong'), now);
    const gain = up.profile.english.listening - c.english.listening;
    const loss = c.english.listening - down.profile.english.listening;
    expect(gain).toBeGreaterThan(0);
    expect(loss).toBeGreaterThan(gain);
  });

  it('★ 靠提示答对不加能力值', () => {
    const c = child();
    const s = session({
      activities: [
        {
          kind: 'word',
          refId: 'x',
          title: 't',
          learningOutcome: 'o',
          seconds: 10,
          at: now,
          outcomes: [{ wordId: 'w-apple', skill: 'listening', result: 'right', hinted: true, at: now }],
        },
      ],
    });
    const r = analyzeSession(c, [], s, now);
    expect(r.profile.english.listening).toBe(c.english.listening);
    expect(r.profile.english.participation.hintsUsed).toBe(1);
  });

  it('★ 跳过不扣能力值，但会被参与度记下来', () => {
    const c = child();
    const s = session({
      activities: [
        {
          kind: 'word',
          refId: 'x',
          title: 't',
          learningOutcome: 'o',
          seconds: 10,
          at: now,
          outcomes: [{ wordId: 'w-apple', skill: 'speaking', result: 'skip', hinted: false, at: now }],
        },
      ],
    });
    const r = analyzeSession(c, [], s, now);
    expect(r.profile.english.speaking).toBe(c.english.speaking);
    expect(r.profile.english.participation.skips).toBe(1);
    expect(r.profile.english.participation.voluntarySpeak).toBe(0);
  });

  it('作答会写进词记忆', () => {
    const c = child();
    const s = session({
      activities: [
        {
          kind: 'word',
          refId: 'x',
          title: 't',
          learningOutcome: 'o',
          seconds: 10,
          at: now,
          outcomes: [
            { wordId: 'w-cat', skill: 'listening', result: 'right', hinted: false, at: now },
            { wordId: 'w-dog', skill: 'listening', result: 'wrong', hinted: false, stage: 'listen', at: now },
          ],
        },
      ],
    });
    const r = analyzeSession(c, [], s, now);
    expect(r.memories.length).toBe(2);
    expect(r.memories.find((m) => m.wordId === 'w-cat')!.correct).toBe(1);
    expect(r.memories.find((m) => m.wordId === 'w-dog')!.errors.listen).toBe(1);
  });

  it('能力值不会跑到边界之外', () => {
    let c = child();
    for (let i = 0; i < 200; i++) {
      c = analyzeSession(
        c,
        [],
        session({
          activities: [
            {
              kind: 'word',
              refId: 'x',
              title: 't',
              learningOutcome: 'o',
              seconds: 1,
              at: now,
              outcomes: [{ wordId: 'w-apple', skill: 'listening', result: 'right', hinted: false, at: now }],
            },
          ],
        }),
        now,
      ).profile;
    }
    expect(c.english.listening).toBeLessThanOrEqual(100);
    for (let i = 0; i < 300; i++) {
      c = analyzeSession(
        c,
        [],
        session({
          activities: [
            {
              kind: 'word',
              refId: 'x',
              title: 't',
              learningOutcome: 'o',
              seconds: 1,
              at: now,
              outcomes: [{ wordId: 'w-apple', skill: 'listening', result: 'wrong', hinted: false, at: now }],
            },
          ],
        }),
        now,
      ).profile;
    }
    expect(c.english.listening).toBeGreaterThanOrEqual(2);
  });

  it('等级会随能力变化自动更新', () => {
    let c = child();
    expect(c.level).toBe('starter');
    c.english = { ...c.english, listening: 80, speaking: 78, pronunciation: 75, vocabulary: 80, comprehension: 78, reading: 70, sentence: 72, retention: 78 };
    const r = analyzeSession(c, [], session(), Date.now());
    expect(r.profile.level).toBe('talker');
  });

  it('连续天数：隔一天累加，隔两天重来', () => {
    const c = child({ streak: 5, lastStudyDate: '2026-03-04' });
    expect(updateStreak(c, '2026-03-05', 1).streak).toBe(6);
    expect(updateStreak(c, '2026-03-07', 3).streak).toBe(1);
    // 同一天重复学习不重复加
    expect(updateStreak({ ...c, lastStudyDate: '2026-03-05' }, '2026-03-05', 0).streak).toBe(5);
  });
});

describe('工具函数', () => {
  it('★ dayKey 用本地时区，不会把晚上的学习算到第二天', () => {
    const night = new Date(2026, 2, 5, 23, 30);
    expect(dayKey(night)).toBe('2026-03-05');
  });

  it('daysBetween 算的是自然日差', () => {
    expect(daysBetween('2026-03-01', '2026-03-05')).toBe(4);
    expect(daysBetween('2026-03-05', '2026-03-05')).toBe(0);
  });

  it('同样的种子给同样的序列', () => {
    const a = rng(hashSeed('child-1:2026-03-05'));
    const b = rng(hashSeed('child-1:2026-03-05'));
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
