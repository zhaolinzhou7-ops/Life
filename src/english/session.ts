/**
 * 一次学习会话的记录与收尾
 *
 * 每个活动结束时把作答结果攒进来，整次学习结束时一次性分析回写。
 *
 * 为什么不每答一题就写 localStorage：孩子一次学习会产生几十次作答，
 * 每次都序列化整个存档，在低端安卓机上会卡出可感知的顿挫。
 * 但也不能只在最后写——孩子中途退出的情况太常见了。折中是：
 * **每个活动结束落一次盘**，粒度刚好，最坏情况只丢一个活动。
 */

import type { ActivityRecord, DailyMission, Outcome, SessionRecord } from './types';
import type { ChildData } from './store';
import { saveChild } from './store';
import { analyzeSession, updateStreak } from './engine/analyze';
import { dayKey, daysBetween, uid } from './engine/util';

export function startSession(childId: string, date = dayKey()): SessionRecord {
  return {
    id: uid('s'),
    childId,
    date,
    startedAt: Date.now(),
    seconds: 0,
    activities: [],
    newWords: [],
    reviewWords: [],
    metWords: [],
    stars: 0,
    completed: false,
  };
}

export interface ActivityDraft {
  kind: ActivityRecord['kind'];
  refId: string;
  title: string;
  learningOutcome: string;
  outcomes: Outcome[];
  startedAt: number;
}

/**
 * 一个活动结束：把结果并进会话，立刻分析回写，然后落盘。
 *
 * 分析放在这里而不是最后统一做，是为了让复习调度当场生效——
 * 孩子在单词环节答错的词，接下来的游戏里就应该再出现一次。
 */
export function commitActivity(
  data: ChildData,
  session: SessionRecord,
  draft: ActivityDraft,
  mission?: DailyMission,
): SessionRecord {
  const act: ActivityRecord = {
    kind: draft.kind,
    refId: draft.refId,
    title: draft.title,
    learningOutcome: draft.learningOutcome,
    outcomes: draft.outcomes,
    seconds: Math.max(1, Math.round((Date.now() - draft.startedAt) / 1000)),
    at: Date.now(),
  };

  const known = new Set(data.memories.map((m) => m.wordId));
  const touched = [...new Set(draft.outcomes.map((o) => o.wordId).filter((x): x is string => !!x))];
  const fresh = touched.filter((id) => !known.has(id));
  const again = touched.filter((id) => known.has(id));

  /*
   * 「新学」只算单词环节正式教过的。
   *
   * 游戏的选项、故事里的角色、对话里带出来的词，孩子确实是第一次碰到，
   * 但那是输入，不是教学——把它们一起算进去，一次 10 分钟的学习会显示
   * 「今天新学了 13 个词」，而实际教的只有 3 个。家长拿这个数字去考孩子，
   * 得到的结论会是「学了等于没学」。
   */
  const taught = draft.kind === 'word' ? fresh : [];
  const met = draft.kind === 'word' ? [] : fresh;

  /*
   * 三栏必须互斥，而且以**这次学习里第一次出现的身份**为准。
   *
   * 不这样的话：单词环节教了 nose，游戏里又练了一次 nose，
   * 那一刻它已经在记忆库里了，于是又被算进「复习」——
   * 完成页上同一个词出现在「新学」和「复习」两栏里，孩子和家长都会困惑。
   * 优先级：新学 > 见到 > 复习。
   */
  const claimed = new Set([...session.newWords, ...(session.metWords ?? [])]);
  const newWords = [...new Set([...session.newWords, ...taught])];
  const metWords = [...new Set([...(session.metWords ?? []), ...met])].filter(
    (id) => !newWords.includes(id),
  );
  const reviewWords = [...new Set([...session.reviewWords, ...again])].filter(
    (id) => !claimed.has(id) && !newWords.includes(id) && !metWords.includes(id),
  );

  const next: SessionRecord = {
    ...session,
    activities: [...session.activities, act],
    seconds: session.seconds + act.seconds,
    newWords,
    reviewWords,
    metWords,
    stars: session.stars + starsFor(draft.outcomes),
  };

  // 只分析这一个活动，避免把之前已经写过的结果重复算进去
  const slice: SessionRecord = { ...next, activities: [act] };
  const res = analyzeSession(data.profile, data.memories, slice);
  data.profile = res.profile;
  data.memories = res.memories;

  if (mission) {
    const step = mission.steps.find((s) => s.id === draft.refId);
    if (step) step.done = true;
    data.mission = mission;
  }

  const i = data.sessions.findIndex((s) => s.id === next.id);
  if (i >= 0) data.sessions[i] = next;
  else data.sessions.push(next);

  saveChild(data);
  return next;
}

/**
 * 给星星。
 *
 * 规则刻意简单而且慷慨：答对给一颗，接近也给一颗（鼓励开口比准确更重要），
 * 答错和跳过不扣。星星是正向反馈，不是成绩单——扣星星会让孩子不敢答。
 */
export function starsFor(outcomes: Outcome[]): number {
  let n = 0;
  for (const o of outcomes) {
    if (o.result === 'right' || o.result === 'close') n += 1;
  }
  return Math.min(5, Math.round(n / 2));
}

/**
 * 整次学习结束。
 *
 * 连续天数按 **这次学习自己的日期** 算，不是按「现在几号」。
 * 差别在跨零点的时候：晚上 11:55 开始学，12:05 结束，那依然是昨天的学习，
 * 不该把今天的份也记掉——否则孩子今天再学一次，连续天数反而不涨。
 */
export function finishSession(data: ChildData, session: SessionRecord): SessionRecord {
  const done: SessionRecord = { ...session, endedAt: Date.now(), completed: true };
  const today = session.date || dayKey();
  const gap = data.profile.lastStudyDate ? daysBetween(data.profile.lastStudyDate, today) : 99;
  data.profile = updateStreak(data.profile, today, gap);
  data.profile.stars += done.stars;

  const i = data.sessions.findIndex((s) => s.id === done.id);
  if (i >= 0) data.sessions[i] = done;
  else data.sessions.push(done);

  saveChild(data);
  return done;
}

/**
 * 秒 → 分钟。
 *
 * **学过就不能显示 0。** 四舍五入会把一次 25 秒的学习算成 0 分钟，
 * 于是家长端一边把四个活动都打上勾，一边写着「今天还没有开始」，
 * 同一屏自相矛盾。孩子打开做了两题就被叫走，这种短会话很常见。
 * 只要真的学了，最少也记 1 分钟。
 */
function toMinutes(seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.max(1, Math.round(seconds / 60));
}

/** 今天已经学了多少分钟 */
export function minutesToday(data: ChildData, date = dayKey()): number {
  return toMinutes(data.sessions.filter((s) => s.date === date).reduce((a, s) => a + s.seconds, 0));
}

/** 今天有没有学过（哪怕只学了十几秒） */
export function studiedToday(data: ChildData, date = dayKey()): boolean {
  return data.sessions.some((s) => s.date === date && s.activities.length > 0);
}

export interface DayStat {
  date: string;
  min: number;
  /** 这一天有几次学习。判断「学没学」用它，不要用 min——min 会被舍入抹平 */
  sessions: number;
}

/** 最近 n 天每天的学习量，用于家长端趋势图 */
export function dailyMinutes(data: ChildData, days: number, today = dayKey()): DayStat[] {
  const out: DayStat[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.parse(`${today}T00:00:00`) - i * 86400000);
    const key = dayKey(d);
    const of = data.sessions.filter((s) => s.date === key && s.activities.length > 0);
    out.push({
      date: key,
      min: toMinutes(of.reduce((a, s) => a + s.seconds, 0)),
      sessions: of.length,
    });
  }
  return out;
}
