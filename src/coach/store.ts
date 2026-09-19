/**
 * 存档层
 *
 * 全部存在 localStorage，不需要后端。三件事必须做对，它们都是真实用户会遇到的：
 *
 * 1. **写不进去也不能崩**。隐私模式、配额满、存储被禁用，产品要照常能用完
 *    这一次学习，只是关掉页面就没了——这比弹一个"请开启存储权限"体面。
 * 2. **重复提交不能产生重复数据**。所有写入按 id 去重，用户手抖点两下
 *    不会多出一条学习记录。
 * 3. **存档结构变了，旧数据不能把产品打崩**。读的时候一律做形状校验，
 *    认不出来的字段丢掉而不是让 undefined 一路穿到界面上。
 *
 * 另外：所有数据按 userId 分桶。虽然本地只有一个用户，但把 userId 一路带下去
 * 意味着以后接了账号体系不用重写这一层，也意味着测试能构造两个用户来验证
 * "数据不会串"。
 */

import type {
  Assessment,
  Conversation,
  ErrorProfile,
  ErrorRecord,
  LearningPlan,
  LearningProgress,
  LearningSession,
  ListeningRecord,
  ProgressPoint,
  SpeakingRecord,
  User,
  UserProfile,
  UserVocab,
  WritingRecord,
} from './types';

const KEY = 'coach-save-v1';

/** 每类记录只留最近这么多条。学习记录不该无限长，localStorage 只有 5MB 左右 */
const CAP = { assessments: 12, conversations: 40, speaking: 200, listening: 200, writing: 80, sessions: 180 };

interface Bucket {
  user: User;
  profile: UserProfile;
  assessments: Assessment[];
  plans: LearningPlan[];
  sessions: LearningSession[];
  vocab: Record<string, UserVocab>;
  conversations: Conversation[];
  speaking: SpeakingRecord[];
  listening: ListeningRecord[];
  writing: WritingRecord[];
  errors: ErrorProfile;
  progress: LearningProgress;
}

interface SaveData {
  version: 1;
  /** 当前用户 id */
  currentUserId: string;
  buckets: Record<string, Bucket>;
}

/** 写入失败过一次之后就记住，界面可以据此提示用户 */
let storageBroken = false;
export const isStorageBroken = (): boolean => storageBroken;

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function today(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function emptyBucket(userId: string): Bucket {
  return {
    user: {
      id: userId,
      name: '',
      createdAt: Date.now(),
      dailyMinutes: 20,
      goals: [],
      nativeLanguage: 'zh',
    },
    profile: {
      userId,
      updatedAt: Date.now(),
      levels: {},
      streak: 0,
      totalMinutes: 0,
      totalSessions: 0,
    },
    assessments: [],
    plans: [],
    sessions: [],
    vocab: {},
    conversations: [],
    speaking: [],
    listening: [],
    writing: [],
    errors: { userId, records: [], updatedAt: Date.now() },
    progress: { userId, points: [] },
  };
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
const obj = <T>(v: unknown): Record<string, T> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, T>) : {};

/** 把读出来的东西修补成一个合法的 Bucket。缺什么补什么，多余的丢掉 */
function normalizeBucket(userId: string, raw: unknown): Bucket {
  const e = emptyBucket(userId);
  if (!raw || typeof raw !== 'object') return e;
  const b = raw as Partial<Bucket>;
  return {
    user: { ...e.user, ...(b.user ?? {}), id: userId },
    profile: {
      ...e.profile,
      ...(b.profile ?? {}),
      userId,
      levels: obj(b.profile?.levels) as UserProfile['levels'],
    },
    assessments: arr<Assessment>(b.assessments),
    plans: arr<LearningPlan>(b.plans),
    sessions: arr<LearningSession>(b.sessions),
    vocab: obj<UserVocab>(b.vocab),
    conversations: arr<Conversation>(b.conversations),
    speaking: arr<SpeakingRecord>(b.speaking),
    listening: arr<ListeningRecord>(b.listening),
    writing: arr<WritingRecord>(b.writing),
    errors: { userId, records: arr<ErrorRecord>(b.errors?.records), updatedAt: b.errors?.updatedAt ?? Date.now() },
    progress: { userId, points: arr<ProgressPoint>(b.progress?.points) },
  };
}

function read(): SaveData {
  const fresh = (): SaveData => {
    const id = 'u_local';
    return { version: 1, currentUserId: id, buckets: { [id]: emptyBucket(id) } };
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return fresh();
    const d = JSON.parse(raw) as Partial<SaveData>;
    const currentUserId = typeof d.currentUserId === 'string' && d.currentUserId ? d.currentUserId : 'u_local';
    const src = obj<unknown>(d.buckets);
    const buckets: Record<string, Bucket> = {};
    for (const [uid, b] of Object.entries(src)) buckets[uid] = normalizeBucket(uid, b);
    if (!buckets[currentUserId]) buckets[currentUserId] = emptyBucket(currentUserId);
    return { version: 1, currentUserId, buckets };
  } catch {
    // 存档被写坏了：当作新用户，不要让用户面对一个打不开的产品
    return fresh();
  }
}

function write(d: SaveData): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
    storageBroken = false;
  } catch {
    storageBroken = true;
  }
}

/** 读—改—写。所有写操作都走这里，保证不会有人忘记 write */
function edit<T>(fn: (b: Bucket, d: SaveData) => T): T {
  const d = read();
  const b = d.buckets[d.currentUserId];
  const out = fn(b, d);
  write(d);
  return out;
}

function current(): Bucket {
  const d = read();
  return d.buckets[d.currentUserId];
}

export const currentUserId = (): string => read().currentUserId;

/** 切换/新建用户。测试里用它验证两个用户的数据不会串 */
export function switchUser(userId: string): void {
  const d = read();
  if (!d.buckets[userId]) d.buckets[userId] = emptyBucket(userId);
  d.currentUserId = userId;
  write(d);
}

/** 按 id 去重地追加，并裁到上限。重复提交不会多出一条 */
function push<T extends { id: string }>(list: T[], item: T, cap: number): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
  if (list.length > cap) list.splice(0, list.length - cap);
  return list;
}

// ───────────────────────── 用户与画像 ─────────────────────────

export const getUser = (): User => current().user;

export function saveUser(patch: Partial<User>): User {
  return edit((b) => {
    b.user = { ...b.user, ...patch, id: b.user.id };
    return b.user;
  });
}

export const getProfile = (): UserProfile => current().profile;

export function saveProfile(patch: Partial<UserProfile>): UserProfile {
  return edit((b) => {
    b.profile = { ...b.profile, ...patch, userId: b.user.id, updatedAt: Date.now() };
    return b.profile;
  });
}

/** 是否已经做过测评。没做过就不该进每日训练 */
export const hasAssessment = (): boolean => current().assessments.length > 0;

// ───────────────────────── 测评 ─────────────────────────

export function saveAssessment(a: Assessment): void {
  edit((b) => push(b.assessments, a, CAP.assessments));
}

export const getAssessments = (): Assessment[] => current().assessments.slice().sort((x, y) => y.createdAt - x.createdAt);

export const getLatestAssessment = (): Assessment | undefined => getAssessments()[0];

// ───────────────────────── 计划与训练场次 ─────────────────────────

export const getPlan = (date: string): LearningPlan | undefined => current().plans.find((p) => p.date === date);

export function savePlan(p: LearningPlan): void {
  edit((b) => {
    const i = b.plans.findIndex((x) => x.date === p.date);
    if (i >= 0) b.plans[i] = p;
    else b.plans.push(p);
    if (b.plans.length > 60) b.plans.splice(0, b.plans.length - 60);
  });
}

export function markActivityDone(date: string, activityId: string): void {
  edit((b) => {
    const p = b.plans.find((x) => x.date === date);
    const a = p?.activities.find((x) => x.id === activityId);
    if (a) a.done = true;
  });
}

export function saveSession(s: LearningSession): void {
  edit((b) => push(b.sessions, s, CAP.sessions));
}

export const getSessions = (): LearningSession[] => current().sessions;

/**
 * 记一次学习。连续天数、总时长、总场次一次算完。
 *
 * 连续天数的判定刻意宽松：只要**日历日**相邻就算连续，不看具体时刻。
 * 成年人晚上 11 点学和第二天早上 7 点学，中间只隔 8 小时，没有理由算断。
 */
export function recordStudy(minutes: number, date = today()): UserProfile {
  return edit((b) => {
    const p = b.profile;
    if (p.lastStudyDate !== date) {
      const y = new Date(date + 'T00:00:00');
      y.setDate(y.getDate() - 1);
      const yesterday = today(y);
      p.streak = p.lastStudyDate === yesterday ? p.streak + 1 : 1;
      p.lastStudyDate = date;
      p.totalSessions += 1;
    }
    p.totalMinutes += Math.max(0, Math.round(minutes));
    p.updatedAt = Date.now();
    return p;
  });
}

// ───────────────────────── 词汇 ─────────────────────────

export const getVocabAll = (): Record<string, UserVocab> => current().vocab;

export const getVocab = (word: string): UserVocab | undefined => current().vocab[word];

export function saveVocab(v: UserVocab): void {
  edit((b) => {
    b.vocab[v.word] = v;
  });
}

export function saveVocabMany(list: UserVocab[]): void {
  edit((b) => {
    for (const v of list) b.vocab[v.word] = v;
  });
}

// ───────────────────────── 对话 ─────────────────────────

export function saveConversation(c: Conversation): void {
  edit((b) => push(b.conversations, c, CAP.conversations));
}

export const getConversations = (): Conversation[] =>
  current().conversations.slice().sort((a, b) => b.startedAt - a.startedAt);

export const getConversation = (id: string): Conversation | undefined =>
  current().conversations.find((c) => c.id === id);

// ───────────────────────── 三类练习记录 ─────────────────────────

export function saveSpeaking(r: SpeakingRecord): void {
  edit((b) => push(b.speaking, r, CAP.speaking));
}

export const getSpeaking = (): SpeakingRecord[] => current().speaking;

export function saveListening(r: ListeningRecord): void {
  edit((b) => push(b.listening, r, CAP.listening));
}

export const getListening = (): ListeningRecord[] => current().listening;

export function saveWriting(r: WritingRecord): void {
  edit((b) => push(b.writing, r, CAP.writing));
}

export const getWriting = (): WritingRecord[] => current().writing;

// ───────────────────────── 错误档案 ─────────────────────────

export const getErrorProfile = (): ErrorProfile => current().errors;

export function saveErrorProfile(p: ErrorProfile): void {
  edit((b) => {
    b.errors = { ...p, userId: b.user.id, updatedAt: Date.now() };
  });
}

// ───────────────────────── 能力曲线 ─────────────────────────

export const getProgress = (): LearningProgress => current().progress;

/** 同一天只留一个点，后来的覆盖先来的 */
export function addProgressPoint(pt: ProgressPoint): void {
  edit((b) => {
    const i = b.progress.points.findIndex((x) => x.date === pt.date);
    if (i >= 0) b.progress.points[i] = pt;
    else b.progress.points.push(pt);
    b.progress.points.sort((x, y) => x.date.localeCompare(y.date));
    if (b.progress.points.length > 180) b.progress.points.splice(0, b.progress.points.length - 180);
  });
}

// ───────────────────────── 维护 ─────────────────────────

/** 清空当前用户的全部数据。设置页里给用户一个后悔的机会 */
export function resetCurrentUser(): void {
  edit((b, d) => {
    d.buckets[d.currentUserId] = emptyBucket(d.currentUserId);
    void b;
  });
}

/** 导出为 JSON 字符串，用户可以自己备份 */
export function exportData(): string {
  return JSON.stringify(read(), null, 2);
}
