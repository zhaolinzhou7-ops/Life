/**
 * 学习档案与错误画像。
 *
 * 产品原则里写得很清楚：**不要机械地给用户贴标签**。
 * 「防守 ★☆☆☆☆」这种东西单独看是没用的，甚至会打击人。
 * 有用的是这一句：
 *   「你最近 10 局里，有 6 局在同一个地方出问题：别人听牌之后你还在打中张。」
 * 所以这里存的不只是分数，还有**出错的场景次数**，
 * 这样才能生成那句话，也才能自动排出训练计划。
 *
 * 星级只是一个方便看的外壳，真正驱动训练的是 recent[] 里的原始记录。
 */

import { ERROR_INFO, ERROR_TYPES, type ErrorType, type GameReport } from '../replay/analyze';

const KEY = 'mjcoach-profile-v1';

/** 一维能力的原始统计 */
export interface SkillStat {
  /** 这类决策一共做了多少次 */
  samples: number;
  /** 其中出错多少次 */
  errors: number;
  /** 累计损失分 */
  lossSum: number;
  /** 严重失误次数 */
  blunders: number;
}

/** 每局留一条摘要，用来算「最近 N 局」 */
export interface RecentGame {
  id: string;
  at: number;
  won: boolean;
  score: number;
  /** 每类错误这局出现几次 */
  errors: Partial<Record<ErrorType, number>>;
  /** 这局的决策总数 */
  decisions: number;
}

export interface TrainingStat {
  done: number;
  correct: number;
  /** 按题型分开统计 */
  byType: Partial<Record<ErrorType, { done: number; correct: number }>>;
  /** 连续练习天数 */
  streakDays: number;
  lastDay: string;
}

export interface Profile {
  version: 1;
  games: number;
  wins: number;
  draws: number;
  /** 累计净得分 */
  score: number;
  /** 胡牌次数 */
  huCount: number;
  /** 点炮次数 */
  dianpaoCount: number;
  /** 最高番 */
  bestFan: number;
  /** 总游戏时长（秒） */
  playSeconds: number;
  skills: Record<ErrorType, SkillStat>;
  recent: RecentGame[];
  training: TrainingStat;
  /** 错题本 */
  srs: SrsCard[];
  /** 预留：等级 / 排位 / AI 评分 / 成就。现在只写入不使用，避免以后改存档结构 */
  level: number;
  exp: number;
  rankPoints: number;
  achievements: string[];
}

/** 错题卡：间隔重复 */
export interface SrsCard {
  /** 题目 id（可以是生成器种子，也可以是牌谱决策点） */
  id: string;
  type: ErrorType;
  /** 复习盒子层级，越高间隔越长 */
  box: number;
  /** 下次该复习的日子（天序号） */
  due: number;
  wrongCount: number;
  lastAt: number;
  /** 题目内容（生成器参数），保证复现同一道题 */
  payload: Record<string, unknown>;
}

/** 复习间隔（天）。经典的 Leitner 间隔，够用 */
export const SRS_INTERVALS = [0, 1, 3, 7, 21];

export const todayNum = () => Math.floor(Date.now() / 86400000);
export const todayStr = () => new Date().toLocaleDateString('sv');

const emptySkill = (): SkillStat => ({ samples: 0, errors: 0, lossSum: 0, blunders: 0 });

export function emptyProfile(): Profile {
  return {
    version: 1,
    games: 0,
    wins: 0,
    draws: 0,
    score: 0,
    huCount: 0,
    dianpaoCount: 0,
    bestFan: 0,
    playSeconds: 0,
    skills: Object.fromEntries(ERROR_TYPES.map((t) => [t, emptySkill()])) as Record<ErrorType, SkillStat>,
    recent: [],
    training: { done: 0, correct: 0, byType: {}, streakDays: 0, lastDay: '' },
    srs: [],
    level: 1,
    exp: 0,
    rankPoints: 0,
    achievements: [],
  };
}

export function loadProfile(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return emptyProfile();
    const p = JSON.parse(raw) as Partial<Profile>;
    const base = emptyProfile();
    return {
      ...base,
      ...p,
      skills: { ...base.skills, ...(p.skills ?? {}) },
      training: { ...base.training, ...(p.training ?? {}) },
      recent: Array.isArray(p.recent) ? p.recent : [],
      srs: Array.isArray(p.srs) ? p.srs : [],
      achievements: Array.isArray(p.achievements) ? p.achievements : [],
    };
  } catch {
    return emptyProfile();
  }
}

export function saveProfile(p: Profile) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* 隐私模式写不进去，功能照常，只是这次的数据留不下来 */
  }
}

export function resetProfile() {
  saveProfile(emptyProfile());
}

// ==================== 写入 ====================

/** 一局结束后把报告并进档案 */
export function recordGame(report: GameReport, extra: { dianpao: number; fan: number }): Profile {
  const p = loadProfile();
  p.games++;
  if (report.basics.resultKind === 'win') p.wins++;
  if (report.basics.resultKind === 'draw') p.draws++;
  p.score += report.basics.score;
  p.playSeconds += report.basics.duration;
  p.dianpaoCount += extra.dianpao;
  p.bestFan = Math.max(p.bestFan, extra.fan);
  if (report.basics.resultKind === 'win') p.huCount++;

  for (const t of ERROR_TYPES) {
    const e = report.errorLoss[t];
    const s = p.skills[t];
    s.samples += e.sampled;
    s.errors += e.count;
    s.lossSum += e.totalLoss;
  }
  for (const m of report.keyMoments) {
    if (m.severity === 'blunder') p.skills[m.type].blunders++;
  }

  p.recent.unshift({
    id: report.gameId,
    at: Date.now(),
    won: report.basics.resultKind === 'win',
    score: report.basics.score,
    errors: Object.fromEntries(ERROR_TYPES.map((t) => [t, report.errorCounts[t]]).filter(([, n]) => (n as number) > 0)) as Partial<Record<ErrorType, number>>,
    decisions: report.basics.decisions,
  });
  p.recent = p.recent.slice(0, 50);

  // 经验：打一局就有，赢了更多。等级只是个正反馈，不参与任何判断
  p.exp += 10 + (report.basics.resultKind === 'win' ? 15 : 0);
  p.level = 1 + Math.floor(p.exp / 120);

  saveProfile(p);
  return p;
}

/** 记一次训练作答 */
export function recordTraining(type: ErrorType, correct: boolean): Profile {
  const p = loadProfile();
  p.training.done++;
  if (correct) p.training.correct++;
  const bt = p.training.byType[type] ?? { done: 0, correct: 0 };
  bt.done++;
  if (correct) bt.correct++;
  p.training.byType[type] = bt;

  const d = todayStr();
  if (p.training.lastDay !== d) {
    const yesterday = new Date(Date.now() - 86400000).toLocaleDateString('sv');
    p.training.streakDays = p.training.lastDay === yesterday ? p.training.streakDays + 1 : 1;
    p.training.lastDay = d;
  }
  p.exp += correct ? 6 : 3;
  p.level = 1 + Math.floor(p.exp / 120);
  saveProfile(p);
  return p;
}

// ==================== 错题本 ====================

export function addSrsCard(card: Omit<SrsCard, 'box' | 'due' | 'wrongCount' | 'lastAt'>): Profile {
  const p = loadProfile();
  const exist = p.srs.find((c) => c.id === card.id);
  if (exist) {
    exist.wrongCount++;
    exist.box = Math.max(0, exist.box - 1); // 又错了，退回去重练
    exist.due = todayNum() + SRS_INTERVALS[exist.box];
    exist.lastAt = Date.now();
  } else {
    p.srs.push({ ...card, box: 0, due: todayNum(), wrongCount: 1, lastAt: Date.now() });
  }
  saveProfile(p);
  return p;
}

export function reviewSrsCard(id: string, correct: boolean): Profile {
  const p = loadProfile();
  const c = p.srs.find((x) => x.id === id);
  if (!c) return p;
  if (correct) {
    c.box = Math.min(SRS_INTERVALS.length - 1, c.box + 1);
    // 连续答对到最高盒就毕业，从错题本移除
    if (c.box >= SRS_INTERVALS.length - 1) {
      p.srs = p.srs.filter((x) => x.id !== id);
      saveProfile(p);
      return p;
    }
  } else {
    c.box = 0;
    c.wrongCount++;
  }
  c.due = todayNum() + SRS_INTERVALS[c.box];
  c.lastAt = Date.now();
  saveProfile(p);
  return p;
}

export function dueSrsCards(p: Profile): SrsCard[] {
  const t = todayNum();
  return p.srs.filter((c) => c.due <= t).sort((a, b) => b.wrongCount - a.wrongCount);
}

// ==================== 画像 ====================

export interface SkillView {
  type: ErrorType;
  name: string;
  emoji: string;
  /** 1~5 星 */
  stars: number;
  /** 0~100 分 */
  score: number;
  /** 出错率 */
  errorRate: number;
  samples: number;
  /** 样本够不够，不够就要明说，不能拿三个样本给人定性 */
  confident: boolean;
  comment: string;
}

/**
 * 星级换算。
 * 特意做得**保守**：样本少的时候一律给三星并标注「数据还不够」，
 * 而不是拿两次失误就判人一星。给人贴错标签比不贴更伤。
 */
export function skillView(p: Profile, type: ErrorType): SkillView {
  const s = p.skills[type];
  const info = ERROR_INFO[type];
  const samples = s.samples;
  const confident = samples >= 12;
  const errorRate = samples ? s.errors / samples : 0;
  const avgLoss = samples ? s.lossSum / samples : 0;

  // 分数：错误率为主，平均损失为辅
  let score = 100 - errorRate * 140 - avgLoss * 1.2;
  score = Math.max(5, Math.min(100, Math.round(score)));
  const stars = !confident ? 3 : score >= 88 ? 5 : score >= 72 ? 4 : score >= 55 ? 3 : score >= 38 ? 2 : 1;

  let comment: string;
  if (!confident) comment = `只有 ${samples} 次样本，再多打几局才看得准`;
  else if (stars >= 5) comment = '这一项已经很稳了';
  else if (stars === 4) comment = '大体没问题，偶尔失手';
  else if (stars === 3) comment = '基本会，但还不稳定';
  else if (stars === 2) comment = `经常在这里丢分：${info.desc}`;
  else comment = `这是目前最该补的一项：${info.desc}`;

  return { type, name: info.name, emoji: info.emoji, stars, score, errorRate, samples, confident, comment };
}

export function allSkills(p: Profile): SkillView[] {
  return ERROR_TYPES.map((t) => skillView(p, t));
}

/**
 * 生成那句真正有用的话：「你最近 N 局最常出现的问题是……」
 * 不是把所有维度罗列一遍，而是找出**反复出现**的那一个。
 */
export function recentPattern(p: Profile, n = 10): { text: string; type: ErrorType | null; gamesWith: number; total: number } {
  const games = p.recent.slice(0, n);
  if (games.length < 3) {
    return {
      text: `目前只打了 ${games.length} 局，再打几局我就能看出你的固定问题在哪。`,
      type: null,
      gamesWith: 0,
      total: games.length,
    };
  }
  const counts = new Map<ErrorType, { games: number; times: number }>();
  for (const g of games) {
    for (const [t, n2] of Object.entries(g.errors) as [ErrorType, number][]) {
      if (!n2) continue;
      const c = counts.get(t) ?? { games: 0, times: 0 };
      c.games++;
      c.times += n2;
      counts.set(t, c);
    }
  }
  if (counts.size === 0) {
    return { text: `最近 ${games.length} 局都没有明显失误，可以去挑战更高档位的 AI 了。`, type: null, gamesWith: 0, total: games.length };
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1].games - a[1].games || b[1].times - a[1].times);
  const [type, c] = sorted[0];
  const info = ERROR_INFO[type];
  let text = `你最近 ${games.length} 局里，有 ${c.games} 局在**${info.name}**上出问题（共 ${c.times} 次）。${info.desc}。`;
  if (sorted.length > 1) {
    const [t2, c2] = sorted[1];
    text += `其次是${ERROR_INFO[t2].name}（${c2.games} 局）。`;
  }
  return { text, type, gamesWith: c.games, total: games.length };
}

/** 自动训练计划：先补最常出问题的，再补最伤分的 */
export function trainingPlan(p: Profile): { type: ErrorType; reason: string; priority: number }[] {
  const pattern = recentPattern(p);
  const plans = ERROR_TYPES.map((t) => {
    const s = p.skills[t];
    const v = skillView(p, t);
    let priority = (100 - v.score) * (v.confident ? 1 : 0.5);
    if (t === pattern.type) priority += 40;
    priority += s.blunders * 8;
    // 完全没练过的也该排一点，不然永远轮不到
    if (s.samples === 0) priority = 25;
    return {
      type: t,
      priority,
      reason:
        t === pattern.type
          ? `最近反复在这里出问题（${pattern.gamesWith}/${pattern.total} 局）`
          : s.samples === 0
            ? '还没练过这一项'
            : v.comment,
    };
  });
  return plans.sort((a, b) => b.priority - a.priority);
}

/** 总览数字，「我的」页面直接用 */
export function summary(p: Profile) {
  const winRate = p.games ? Math.round((p.wins / p.games) * 100) : 0;
  const acc = p.training.done ? Math.round((p.training.correct / p.training.done) * 100) : 0;
  return {
    games: p.games,
    wins: p.wins,
    draws: p.draws,
    losses: Math.max(0, p.games - p.wins - p.draws),
    winRate,
    score: p.score,
    huCount: p.huCount,
    dianpaoCount: p.dianpaoCount,
    bestFan: p.bestFan,
    minutes: Math.round(p.playSeconds / 60),
    trainingDone: p.training.done,
    trainingAccuracy: acc,
    streakDays: p.training.streakDays,
    level: p.level,
    exp: p.exp,
    expToNext: 120 - (p.exp % 120),
    srsCount: p.srs.length,
  };
}

// ==================== 导出 / 导入 ====================

/**
 * 把学习数据整包导出。
 * 数据只在这台设备的浏览器里，换手机、清缓存就没了——学了几个月的画像丢掉太可惜。
 * 导出格式就是一份 JSON，不做加密：里面没有任何隐私，只有牌谱和统计。
 */
export function exportAll(): string {
  const games = (() => {
    try {
      return JSON.parse(localStorage.getItem('mjcoach-games-v1') ?? '[]');
    } catch {
      return [];
    }
  })();
  return JSON.stringify({ app: 'mjcoach', version: 1, exportedAt: Date.now(), profile: loadProfile(), games });
}

/** 导入。会**覆盖**当前数据，调用方必须先让用户确认 */
export function importAll(text: string): { ok: boolean; games: number; error?: string } {
  try {
    const o = JSON.parse(text) as { app?: string; profile?: Partial<Profile>; games?: unknown[] };
    if (o.app !== 'mjcoach' || !o.profile) return { ok: false, games: 0, error: '这不是本软件导出的文件' };
    const base = emptyProfile();
    saveProfile({ ...base, ...o.profile, skills: { ...base.skills, ...(o.profile.skills ?? {}) } });
    const games = Array.isArray(o.games) ? o.games : [];
    localStorage.setItem('mjcoach-games-v1', JSON.stringify(games));
    return { ok: true, games: games.length };
  } catch (e) {
    return { ok: false, games: 0, error: (e as Error).message };
  }
}
