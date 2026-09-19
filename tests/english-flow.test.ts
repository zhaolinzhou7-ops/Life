/**
 * 端到端流程自测
 *
 * 前两个文件测的是零件。这个文件测的是**整条链**：
 *
 *   建档 → 测评 → 生成今日任务 → 做完活动 → 分析回写 →
 *   存档 → 第二天重新进来 → 复习到期的词 → 薄弱点变化 → 任务跟着变
 *
 * 这条链上任何一环断了，产品就退化成「每天随机出几个词的玩具」。
 * 单元测试看不出这种断裂——每个零件都是对的，但它们没接上。
 *
 * 同时覆盖存档层的真实故障：隐私模式写不进去、存档损坏、跨设置重算、
 * 一键删除。这些都是用户真的会遇到的。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import {
  activeChildId,
  addChild,
  eraseEverything,
  getChildData,
  listChildren,
  removeChild,
  saveChild,
  setParentPin,
  getParentPin,
  type ChildData,
} from '../src/english/store';
import { newChild } from '../src/english/engine/profile';
import { buildAssessment, scoreAssessment } from '../src/english/engine/level';
import { ensureMission, allDone, nextStep, currentWeaknesses } from '../src/english/plan';
import { commitActivity, finishSession, startSession, dailyMinutes, minutesToday, studiedToday } from '../src/english/session';
import { newMemory } from '../src/english/engine/review';
import { getWord } from '../src/english/data/vocab';
import { getStory } from '../src/english/data/stories';
import { getGame } from '../src/english/data/games';
import { dayKey } from '../src/english/engine/util';
import type { ActivityDraft } from '../src/english/session';
import type { AssessAnswer, MissionStep, Outcome, ResultTag } from '../src/english/types';

const DAY = 86400000;

beforeEach(() => {
  memStore.clear();
  memStore.full = false;
});

/** 建一个做完测评的孩子 */
function setup(age = 5, answerAll: ResultTag = 'right'): ChildData {
  const child = newChild('Mimi', age, '🐣');
  const data = addChild(child);
  const items = buildAssessment(age, 11);
  const answers: AssessAnswer[] = items.map((i) => ({
    itemId: i.id,
    result: answerAll,
    hinted: false,
    ms: 900,
  }));
  const out = scoreAssessment(age, items, answers);
  data.profile = { ...data.profile, english: out.profile, level: out.level, assessedAt: Date.now() };
  saveChild(data);
  return data;
}

/** 把一个任务步骤当成「全部答对」做完 */
function doStep(data: ChildData, step: MissionStep, result: ResultTag, now = Date.now()): ActivityDraft {
  const outcomes: Outcome[] = step.wordIds.map((id) => ({
    wordId: id,
    skill: step.kind === 'game' ? 'listening' : step.kind === 'story' ? 'comprehension' : 'vocabulary',
    result,
    hinted: false,
    stage: step.kind === 'game' ? 'listen' : 'recognize',
    at: now,
  }));
  return {
    kind: step.kind,
    refId: step.id,
    title: step.titleZh,
    learningOutcome: step.learningOutcome,
    outcomes,
    startedAt: now - 60000,
  };
}

// ════════════════════ 一次完整的学习 ════════════════════

describe('儿童流程：进入 → 任务 → 学完', () => {
  it('★ 新用户从零走到完成一次学习，全程不需要任何配置', () => {
    const data = setup();
    const today = dayKey();

    // 今日任务
    const mission = ensureMission(data, today);
    expect(mission.steps.length).toBeGreaterThan(0);
    expect(mission.estimateMin).toBeGreaterThan(0);
    expect(nextStep(mission)).toBeTruthy();

    // 一步一步做完
    let session = startSession(data.profile.id);
    for (const step of [...mission.steps]) {
      session = commitActivity(data, session, doStep(data, step, 'right'), mission);
    }
    expect(allDone(mission)).toBe(true);

    const done = finishSession(data, session);
    expect(done.completed).toBe(true);
    expect(done.activities.length).toBe(mission.steps.length);
    expect(data.profile.streak).toBe(1);

    // 学过的词进了记忆
    expect(data.memories.length).toBeGreaterThan(0);
    for (const m of data.memories) expect(m.seen).toBeGreaterThan(0);
  });

  it('★ 每个活动都留下了「学会了什么」，完成页要用它', () => {
    const data = setup();
    const mission = ensureMission(data, dayKey());
    let session = startSession(data.profile.id);
    for (const step of [...mission.steps]) {
      session = commitActivity(data, session, doStep(data, step, 'right'), mission);
    }
    for (const a of session.activities) {
      expect(a.learningOutcome.length, a.title).toBeGreaterThan(5);
    }
  });

  it('★ 中途退出：已经做完的步骤不用重做', () => {
    const data = setup();
    const today = dayKey();
    const mission = ensureMission(data, today);
    const first = mission.steps[0];

    let session = startSession(data.profile.id);
    session = commitActivity(data, session, doStep(data, first, 'right'), mission);
    saveChild(data);

    // 「关掉页面再进来」
    const reloaded = getChildData(data.profile.id)!;
    const again = ensureMission(reloaded, today);
    expect(again.steps.find((s) => s.id === first.id)?.done).toBe(true);
    expect(nextStep(again)?.id).not.toBe(first.id);
  });

  it('答错的词会当场重新排队，同一次学习里就能再遇到', () => {
    const data = setup();
    const mission = ensureMission(data, dayKey());
    const words = mission.steps.find((s) => s.id === 'm-words')!;
    const session = startSession(data.profile.id);
    commitActivity(data, session, doStep(data, words, 'wrong'), mission);

    const now = Date.now();
    for (const id of words.wordIds) {
      const m = data.memories.find((x) => x.wordId === id)!;
      expect(m.dueAt, id).toBeLessThanOrEqual(now);
      expect(m.wrong, id).toBeGreaterThan(0);
    }
  });

  it('星星只加不减，答错也不会被扣', () => {
    const data = setup();
    const mission = ensureMission(data, dayKey());
    let session = startSession(data.profile.id);
    const before = session.stars;
    session = commitActivity(data, session, doStep(data, mission.steps[0], 'wrong'), mission);
    expect(session.stars).toBeGreaterThanOrEqual(before);
  });
});

// ════════════════════ 跨天：复习闭环 ════════════════════

describe('复习闭环', () => {
  it('★ 今天学的词，明天会回到任务里复习（§19）', () => {
    const data = setup();
    const d1 = '2026-05-01';
    const t1 = Date.parse(`${d1}T09:00:00`);

    const m1 = ensureMission(data, d1, t1);
    const words = m1.steps.find((s) => s.id === 'm-words')!;
    const learned = [...words.wordIds];
    let session = startSession(data.profile.id, d1);
    session = commitActivity(data, session, doStep(data, words, 'right', t1), m1);
    finishSession(data, session);

    // 第二天
    const d2 = '2026-05-02';
    const t2 = t1 + DAY;
    data.mission = undefined;
    const m2 = ensureMission(data, d2, t2);
    const review = m2.steps.find((s) => s.id === 'm-review');
    expect(review, '第二天没有排复习').toBeTruthy();
    const overlap = review!.wordIds.filter((id) => learned.includes(id));
    expect(overlap.length, '昨天学的词没有进复习').toBeGreaterThan(0);
  });

  it('★ 连续答对的词复习间隔会拉长，不再天天出现', () => {
    const data = setup();
    let t = Date.parse('2026-05-01T09:00:00');
    const target = 'w-apple';
    data.memories = [newMemory(target, t)];

    // 连续四天都答对
    for (let day = 0; day < 4; day++) {
      const date = dayKey(new Date(t));
      const session = startSession(data.profile.id, date);
      commitActivity(
        data,
        session,
        {
          kind: 'word',
          refId: 'x',
          title: 't',
          learningOutcome: 'o',
          startedAt: t,
          outcomes: [{ wordId: target, skill: 'vocabulary', result: 'right', hinted: false, at: t }],
        },
        undefined,
      );
      t += DAY;
    }
    const m = data.memories.find((x) => x.wordId === target)!;
    expect(m.mastered).toBe(true);
    // 掌握之后间隔至少 8 天
    expect(m.dueAt - (t - DAY)).toBeGreaterThanOrEqual(8 * DAY);
  });

  it('★ 一直答错的词不会被放过，而且会被薄弱点抓到', () => {
    const data = setup();
    const t = Date.parse('2026-05-01T09:00:00');
    const stubborn = ['w-yellow', 'w-green', 'w-blue'];
    data.memories = stubborn.map((id) => newMemory(id, t));

    for (let round = 0; round < 4; round++) {
      const session = startSession(data.profile.id);
      commitActivity(
        data,
        session,
        {
          kind: 'word',
          refId: 'x',
          title: 't',
          learningOutcome: 'o',
          startedAt: t,
          outcomes: stubborn.map((id) => ({
            wordId: id,
            skill: 'vocabulary' as const,
            result: 'wrong' as const,
            hinted: false,
            stage: 'recognize' as const,
            at: t,
          })),
        },
        undefined,
      );
    }

    const ws = currentWeaknesses(data, t);
    expect(ws.length).toBeGreaterThan(0);
    const ids = ws.flatMap((w) => w.prescription.focusWordIds);
    expect(stubborn.some((id) => ids.includes(id)), '顽固错词没有被排进重点').toBe(true);
    // 颜色主题应该被识别出来
    expect(ws.some((w) => w.id === 'theme-color')).toBe(true);
  });

  it('★ 薄弱点会真的改变第二天的任务', () => {
    const data = setup();
    const t = Date.parse('2026-05-01T09:00:00');

    // 造一个「不敢开口」的孩子
    data.profile.english.speaking = 12;
    data.profile.english.pronunciation = 12;
    data.profile.english.vocabulary = 62;
    data.profile.english.participation = {
      attempts: 40,
      skips: 16,
      hintsUsed: 22,
      voluntarySpeak: 1,
      promptedSpeak: 2,
      updatedAt: t,
    };
    data.mission = undefined;

    const m = ensureMission(data, '2026-05-02', t + DAY);
    expect(m.steps.some((s) => s.kind === 'talk'), '不敢开口的孩子不该被排自由对话').toBe(false);
    expect(m.steps.find((s) => s.kind === 'game')?.gameId).not.toBe('echo');
    expect(m.reason).toMatch(/跟读|低压力|开口/);
  });
});

// ════════════════════ 家长流程 ════════════════════

describe('家长流程', () => {
  it('★ 家长能看到孩子学了什么、掌握了多少、哪里弱', () => {
    const data = setup();
    const today = dayKey();
    const mission = ensureMission(data, today);
    let session = startSession(data.profile.id);
    for (const step of [...mission.steps]) {
      session = commitActivity(data, session, doStep(data, step, 'right'), mission);
    }
    finishSession(data, session);

    // 今日学习时长
    expect(minutesToday(data, today)).toBeGreaterThan(0);
    // 一周趋势有七天数据（没学的那天是 0，不是缺失）
    const week = dailyMinutes(data, 7, today);
    expect(week.length).toBe(7);
    expect(week[6].date).toBe(today);
    expect(week[6].min).toBeGreaterThan(0);
    expect(week[6].sessions).toBeGreaterThan(0);
    // 任务的理由要能给家长看
    expect(mission.reason.length).toBeGreaterThan(8);
  });

  it('★ 学了不到一分钟也必须算「学过了」，不能被四舍五入抹成没学', () => {
    const data = setup();
    const today = dayKey();
    const mission = ensureMission(data, today);
    const session = startSession(data.profile.id);
    // 20 秒就被叫去吃饭了——这是最常见的真实情况
    const draft = doStep(data, mission.steps[0], 'right');
    draft.startedAt = Date.now() - 20_000;
    commitActivity(data, session, draft, mission);

    expect(studiedToday(data, today), '学过了却报告没学').toBe(true);
    expect(minutesToday(data, today), '不足一分钟被抹成 0').toBeGreaterThanOrEqual(1);
    const week = dailyMinutes(data, 7, today);
    expect(week[6].sessions).toBe(1);
    // 家长端「学习天数」按有没有学过来数，不按分钟
    expect(week.filter((d) => d.sessions > 0).length).toBe(1);
  });

  it('★ 改设置之后，今天的任务会按新设置重算，但已完成的步骤保留', () => {
    const data = setup();
    const today = dayKey();
    const m1 = ensureMission(data, today);
    const firstId = m1.steps[0].id;
    const session = startSession(data.profile.id);
    commitActivity(data, session, doStep(data, m1.steps[0], 'right'), m1);

    // 家长把时长从 10 改到 20
    data.profile.settings = { ...data.profile.settings, dailyMinutes: 20 };
    const m2 = ensureMission(data, today);
    expect(m2.estimateMin).toBeGreaterThanOrEqual(m1.estimateMin);
    expect(m2.steps.find((s) => s.id === firstId)?.done, '已完成的步骤被重置了').toBe(true);
  });

  it('★ 关掉麦克风后，任务里不会出现任何需要说话的环节', () => {
    const data = setup();
    data.profile.settings = { ...data.profile.settings, allowVoice: false };
    data.mission = undefined;
    for (const d of ['2026-06-01', '2026-06-02', '2026-06-03']) {
      const m = ensureMission(data, d, Date.parse(`${d}T09:00:00`));
      expect(m.steps.some((s) => s.kind === 'talk'), d).toBe(false);
      const g = m.steps.find((s) => s.kind === 'game');
      if (g?.gameId) expect(getGame(g.gameId).needsVoice, d).not.toBe(true);
      data.mission = undefined;
    }
  });

  it('家长密码能设也能清', () => {
    setup();
    expect(getParentPin()).toBeUndefined();
    setParentPin('1234');
    expect(getParentPin()).toBe('1234');
    setParentPin(undefined);
    expect(getParentPin()).toBeUndefined();
  });
});

// ════════════════════ 存档层 ════════════════════

describe('存档', () => {
  it('★ 刷新页面之后数据还在', () => {
    const data = setup();
    const mission = ensureMission(data, dayKey());
    const session = startSession(data.profile.id);
    commitActivity(data, session, doStep(data, mission.steps[0], 'right'), mission);

    const reloaded = getChildData(data.profile.id)!;
    expect(reloaded.profile.name).toBe('Mimi');
    expect(reloaded.memories.length).toBeGreaterThan(0);
    expect(reloaded.sessions.length).toBe(1);
  });

  it('★ 隐私模式写不进去时，产品照常能跑完一次学习', () => {
    const data = setup();
    memStore.full = true;
    const mission = ensureMission(data, dayKey());
    let session = startSession(data.profile.id);
    expect(() => {
      for (const step of [...mission.steps]) {
        session = commitActivity(data, session, doStep(data, step, 'right'), mission);
      }
      finishSession(data, session);
    }).not.toThrow();
    // 内存里的数据是对的，只是没落盘
    expect(data.memories.length).toBeGreaterThan(0);
  });

  it('★ 存档损坏时当作新用户，而不是白屏', () => {
    memStore.setItem('english-save', 'not json at all {{{');
    expect(listChildren()).toEqual([]);
    expect(activeChildId()).toBeUndefined();
    expect(getChildData()).toBeUndefined();
  });

  it('★ 一键删除是真的删掉，不是清空字段', () => {
    setup();
    expect(listChildren().length).toBe(1);
    eraseEverything();
    expect(memStore.getItem('english-save')).toBeNull();
    expect(listChildren()).toEqual([]);
  });

  it('★ 默认不保存语音转写；打开开关才保存', () => {
    const data = setup();
    data.transcripts = [{ at: Date.now(), role: 'child', text: 'I like cats' }];
    saveChild(data);
    expect(getChildData(data.profile.id)!.transcripts).toEqual([]);

    data.profile.settings = { ...data.profile.settings, keepTranscripts: true };
    data.transcripts = [{ at: Date.now(), role: 'child', text: 'I like cats' }];
    saveChild(data);
    expect(getChildData(data.profile.id)!.transcripts.length).toBe(1);
  });

  it('90 天以外的学习记录会被裁掉，不会把存储写满', () => {
    const data = setup();
    const old = dayKey(new Date(Date.now() - 200 * DAY));
    data.sessions.push({
      id: 'old',
      childId: data.profile.id,
      date: old,
      startedAt: 0,
      seconds: 600,
      activities: [],
      newWords: [],
      reviewWords: [],
      stars: 1,
      completed: true,
    });
    saveChild(data);
    expect(getChildData(data.profile.id)!.sessions.some((s) => s.id === 'old')).toBe(false);
  });

  it('支持多个孩子，各自独立', () => {
    const a = addChild(newChild('A', 5, '🐣'));
    const b = addChild(newChild('B', 9, '🦊'));
    expect(listChildren().length).toBe(2);
    expect(activeChildId()).toBe(b.profile.id);

    a.memories = [newMemory('w-apple', Date.now())];
    saveChild(a);
    expect(getChildData(a.profile.id)!.memories.length).toBe(1);
    expect(getChildData(b.profile.id)!.memories.length).toBe(0);

    removeChild(b.profile.id);
    expect(listChildren().length).toBe(1);
    expect(activeChildId()).toBe(a.profile.id);
  });
});

// ════════════════════ 长期运行 ════════════════════

describe('长期运行', () => {
  it('★ 连学 30 天不会崩，也不会没内容可学', () => {
    const data = setup(6);
    let t = Date.parse('2026-01-05T09:00:00');
    let totalNew = 0;

    for (let day = 0; day < 30; day++) {
      const date = dayKey(new Date(t));
      data.mission = undefined;
      const mission = ensureMission(data, date, t);
      expect(mission.steps.length, `第 ${day + 1} 天没有任务`).toBeGreaterThan(0);
      expect(mission.estimateMin, `第 ${day + 1} 天超时`).toBeLessThanOrEqual(
        data.profile.settings.dailyMinutes + 2,
      );

      let session = startSession(data.profile.id, date);
      for (const step of [...mission.steps]) {
        // 八成答对，两成答错——模拟一个真实的孩子
        const result: ResultTag = day % 5 === 0 ? 'wrong' : 'right';
        session = commitActivity(data, session, doStep(data, step, result, t), mission);
      }
      totalNew += session.newWords.length;
      finishSession(data, session);
      t += DAY;
    }

    expect(totalNew).toBeGreaterThan(30);
    expect(data.memories.length).toBeGreaterThan(20);
    expect(data.memories.some((m) => m.mastered), '三十天下来一个词都没掌握').toBe(true);
    // 能力画像没有跑出边界
    for (const k of ['listening', 'vocabulary', 'speaking', 'retention'] as const) {
      const v = data.profile.english[k];
      expect(v, k).toBeGreaterThan(0);
      expect(v, k).toBeLessThanOrEqual(100);
    }
    expect(data.profile.streak).toBe(30);
    // 存档没有无限膨胀
    expect(data.sessions.length).toBeLessThanOrEqual(90);
  });

  it('★ 每一天的任务都指向真实存在的词、故事和游戏', () => {
    const data = setup(7);
    let t = Date.parse('2026-02-01T09:00:00');
    for (let day = 0; day < 14; day++) {
      const date = dayKey(new Date(t));
      data.mission = undefined;
      const m = ensureMission(data, date, t);
      for (const s of m.steps) {
        for (const id of s.wordIds) expect(getWord(id), `${date} ${s.id} 引用了不存在的词 ${id}`).toBeTruthy();
        if (s.storyId) expect(getStory(s.storyId), `${date} 引用了不存在的故事`).toBeTruthy();
        if (s.gameId) expect(() => getGame(s.gameId!), `${date} 引用了不存在的游戏`).not.toThrow();
      }
      let session = startSession(data.profile.id, date);
      for (const step of [...m.steps]) session = commitActivity(data, session, doStep(data, step, 'right', t), m);
      finishSession(data, session);
      t += DAY;
    }
  });
});

// ════════════════════ 数字的诚实性 ════════════════════

describe('「今天学了多少」必须说实话', () => {
  it('★ 只有单词环节正式教过的才算「新学」', () => {
    const data = setup();
    const today = dayKey();
    const mission = ensureMission(data, today);
    const wordStep = mission.steps.find((s) => s.id === 'm-words')!;
    const taught = [...wordStep.wordIds];

    let session = startSession(data.profile.id);
    for (const step of [...mission.steps]) {
      session = commitActivity(data, session, doStep(data, step, 'right'), mission);
    }

    // 新学的正好是单词环节教的那几个，一个不多
    expect(session.newWords.sort()).toEqual(taught.sort());
    // 游戏和故事里第一次碰到的词单独一栏，不算进新学
    for (const id of session.metWords) {
      expect(taught, `${id} 既算教过又算碰到`).not.toContain(id);
    }
    // 这两栏加起来才是「今天一共接触到的新词」
    const all = new Set([...session.newWords, ...session.metWords]);
    expect(all.size).toBe(session.newWords.length + session.metWords.length);
  });

  it('★ 新学 / 见到 / 复习 三栏互斥，同一个词不会同时出现在两栏里', () => {
    const data = setup();
    const mission = ensureMission(data, dayKey());
    let session = startSession(data.profile.id);
    // 故意把单词环节做两遍：第二遍时这些词已经在记忆库里了
    for (const step of [...mission.steps, mission.steps[0]]) {
      session = commitActivity(data, session, doStep(data, step, 'right'), mission);
    }
    const buckets = [session.newWords, session.metWords, session.reviewWords];
    const total = buckets.reduce((a, b) => a + b.length, 0);
    const union = new Set(buckets.flat());
    expect(union.size, '有词被重复计入了不同的栏').toBe(total);
  });

  it('★ 新学数量不该超过任务里写的数量', () => {
    const data = setup();
    const mission = ensureMission(data, dayKey());
    const planned = mission.steps.find((s) => s.id === 'm-words')?.wordIds.length ?? 0;
    let session = startSession(data.profile.id);
    for (const step of [...mission.steps]) {
      session = commitActivity(data, session, doStep(data, step, 'right'), mission);
    }
    expect(session.newWords.length).toBeLessThanOrEqual(planned);
  });
});
