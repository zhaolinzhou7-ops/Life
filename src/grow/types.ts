/**
 * 成长观察 · 数据类型
 *
 * 所有记录都只存在这台设备的浏览器里（IndexedDB），不上传任何服务器。
 * 删除用"软删除"：留一个只有 id 和时间的空壳，这样从旧备份恢复时，
 * 已经删掉的记录不会又冒出来。
 */

export type TagId = 'interest' | 'emotion' | 'social' | 'voice' | 'try' | 'selfcare' | 'body' | 'sleep';

export const TAGS: readonly { id: TagId; label: string }[] = [
  { id: 'interest', label: '兴趣' },
  { id: 'emotion', label: '情绪' },
  { id: 'social', label: '社交' },
  { id: 'voice', label: '表达需求/说“不”' },
  { id: 'try', label: '新尝试' },
  { id: 'selfcare', label: '自理' },
  { id: 'body', label: '身体' },
  { id: 'sleep', label: '睡眠' },
];

export const TAG_IDS = new Set<string>(TAGS.map((t) => t.id));

export function tagLabel(id: TagId): string {
  return TAGS.find((t) => t.id === id)?.label ?? id;
}

/** 一条观察记录 */
export interface Entry {
  id: string;
  /** 这件事发生的日期，YYYY-MM-DD（本地日期） */
  date: string;
  text: string;
  tags: TagId[];
  /** 是不是"第一次"，第二阶段的"第一次清单"靠它 */
  first: boolean;
  createdAt: number;
  updatedAt: number;
  /** 有值表示已删除，此时 text 已清空 */
  deletedAt?: number;
}

/**
 * 健康节点。两种填法：
 * - interval：上次日期 + 间隔月数，自动算下次
 * - date：直接填下次日期（疫苗按接种本上的日子打，不是固定间隔）
 */
export interface HealthItem {
  id: string;
  name: string;
  mode: 'interval' | 'date';
  /** 上次做的日期，没填是 '' */
  lastDate: string;
  intervalMonths: number | null;
  /** 只在 mode === 'date' 时使用，没填是 '' */
  nextDate: string;
  note: string;
  updatedAt: number;
  deletedAt?: number;
}

/**
 * 发育对照里一项能力的状态。
 * 对"能力倒退"那一问，yes 表示"出现了倒退"，no 表示"没有"。
 */
export type MarkStatus = 'yes' | 'no' | 'unsure';

export interface MilestoneMark {
  id: string;
  status: MarkStatus;
  updatedAt: number;
}

export interface Profile {
  /** 出生日期，YYYY-MM-DD；只用来决定对照哪个年龄段 */
  birthDate: string;
  updatedAt: number;
}

/** 能进备份文件、能合并的那部分数据 */
export interface JournalData {
  entries: Entry[];
  health: HealthItem[];
  milestones: MilestoneMark[];
  profile: Profile | null;
}
