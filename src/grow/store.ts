/**
 * 本地存储：IndexedDB（浏览器自带的小数据库，数据就在这台设备上）。
 *
 * 启动时整库读进内存，之后所有读取都走内存，写入先改内存、再落盘。
 * 数据量很小（一天几条文字），这样做最简单；更重要的是导出备份时能在点击的
 * 同一瞬间同步生成文件——iPhone 只允许"点了按钮立刻"弹出分享面板，
 * 中间要是先去等数据库，分享面板会被系统拦掉。
 *
 * 和小游戏合集同一个网址域名，所以库名、键名都带 grow 前缀，互不干扰。
 */

import { PRESET_HEALTH } from './health';
import type { MergeResult } from './backup';
import type { Entry, HealthItem, JournalData, MarkStatus, MilestoneMark, Profile } from './types';

const DB_NAME = 'grow-journal';
const DB_VERSION = 1;
type StoreName = 'entries' | 'health' | 'milestones' | 'kv';
const ALL_STORES: StoreName[] = ['entries', 'health', 'milestones', 'kv'];

export interface State {
  /** 含已删除的空壳 */
  entries: Entry[];
  /** 含已删除的空壳；没动过的预置项只在内存里 */
  health: HealthItem[];
  marks: Map<string, MilestoneMark>;
  profile: Profile | null;
  /** 这台设备上次导出备份的时间，0 = 从没导出过 */
  lastExportAt: number;
  /** 哪个月点过"本月不再提醒"，YYYY-MM */
  remindDismissedMonth: string;
}

export const state: State = {
  entries: [],
  health: [...PRESET_HEALTH],
  marks: new Map(),
  profile: null,
  lastExportAt: 0,
  remindDismissedMonth: '',
};

let db: IDBDatabase | null = null;

/** 数据库打不开（比如无痕模式、系统禁用）时为 false：还能用，但关掉就没了 */
export function storageAvailable(): boolean {
  return db !== null;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('这个浏览器不支持 IndexedDB'));
      return;
    }
    const r = indexedDB.open(DB_NAME, DB_VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const name of ['entries', 'health', 'milestones'] as const) {
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath: 'id' });
      }
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const d = r.result;
      // 将来升级库结构时，别让这个旧页面挡住新页面
      d.onversionchange = () => d.close();
      resolve(d);
    };
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('数据库被另一个页面占着'));
  });
}

function upsert<T extends { id: string }>(list: T[], item: T) {
  const i = list.findIndex((x) => x.id === item.id);
  if (i >= 0) list[i] = item;
  else list.push(item);
}

export async function openStore(): Promise<void> {
  try {
    db = await openDB();
  } catch {
    db = null;
    return;
  }
  const t = db.transaction(ALL_STORES, 'readonly');
  const kv = t.objectStore('kv');
  const [entries, health, marks, profile, lastExportAt, dismissed] = await Promise.all([
    req(t.objectStore('entries').getAll() as IDBRequest<Entry[]>),
    req(t.objectStore('health').getAll() as IDBRequest<HealthItem[]>),
    req(t.objectStore('milestones').getAll() as IDBRequest<MilestoneMark[]>),
    req(kv.get('profile') as IDBRequest<Profile | undefined>),
    req(kv.get('lastExportAt') as IDBRequest<number | undefined>),
    req(kv.get('remindDismissedMonth') as IDBRequest<string | undefined>),
  ]);
  state.entries = entries;
  state.health = [...PRESET_HEALTH];
  for (const h of health) upsert(state.health, h);
  state.marks = new Map(marks.map((m) => [m.id, m]));
  state.profile = profile ?? null;
  state.lastExportAt = lastExportAt ?? 0;
  state.remindDismissedMonth = dismissed ?? '';
}

interface Op {
  store: StoreName;
  value: unknown;
  /** 只有 kv 需要单独给键 */
  key?: string;
}

/** 一次事务写入；失败会抛错（调用方负责告诉用户） */
function write(ops: Op[]): Promise<void> {
  const d = db;
  if (!d || !ops.length) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const names = [...new Set(ops.map((o) => o.store))];
    // strict：等真正写到磁盘再算完成。记录不能丢，慢一点无所谓
    const t = d.transaction(names, 'readwrite', { durability: 'strict' });
    for (const o of ops) {
      const s = t.objectStore(o.store);
      if (o.key === undefined) s.put(o.value);
      else s.put(o.value, o.key);
    }
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error ?? new Error('写入失败'));
    t.onabort = () => reject(t.error ?? new Error('写入被中断'));
  });
}

export function newId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// ---------- 记录 ----------

/** 没删除的记录，新的在前（同一天按记下的先后，后记的在前） */
export function liveEntries(): Entry[] {
  return state.entries
    .filter((e) => !e.deletedAt)
    .sort((a, b) => (a.date === b.date ? b.createdAt - a.createdAt : a.date < b.date ? 1 : -1));
}

export function saveEntry(e: Entry): Promise<void> {
  upsert(state.entries, e);
  return write([{ store: 'entries', value: e }]);
}

export function removeEntry(id: string): Promise<void> {
  const cur = state.entries.find((e) => e.id === id);
  if (!cur) return Promise.resolve();
  const now = Date.now();
  // 内容清空，只留空壳：从旧备份恢复时靠它认出"这条已经删过了"
  return saveEntry({ id, date: cur.date, text: '', tags: [], first: false, createdAt: cur.createdAt, updatedAt: now, deletedAt: now });
}

// ---------- 健康节点 ----------

export function liveHealth(): HealthItem[] {
  return state.health.filter((h) => !h.deletedAt);
}

export function saveHealth(h: HealthItem): Promise<void> {
  upsert(state.health, h);
  return write([{ store: 'health', value: h }]);
}

export function removeHealth(id: string): Promise<void> {
  const cur = state.health.find((h) => h.id === id);
  if (!cur) return Promise.resolve();
  const now = Date.now();
  return saveHealth({ ...cur, lastDate: '', nextDate: '', note: '', intervalMonths: null, updatedAt: now, deletedAt: now });
}

// ---------- 发育对照 / 出生日期 ----------

export function setMark(id: string, status: MarkStatus): Promise<void> {
  const m: MilestoneMark = { id, status, updatedAt: Date.now() };
  state.marks.set(id, m);
  return write([{ store: 'milestones', value: m }]);
}

export function setBirthDate(birthDate: string): Promise<void> {
  const p: Profile = { birthDate, updatedAt: Date.now() };
  state.profile = p;
  return write([{ store: 'kv', key: 'profile', value: p }]);
}

// ---------- 备份相关 ----------

export function setLastExport(t: number): Promise<void> {
  state.lastExportAt = t;
  return write([{ store: 'kv', key: 'lastExportAt', value: t }]);
}

export function setRemindDismissed(month: string): Promise<void> {
  state.remindDismissedMonth = month;
  return write([{ store: 'kv', key: 'remindDismissedMonth', value: month }]);
}

/** 要进备份文件的全部数据（含删除空壳；没动过的预置健康项不用带） */
export function journalData(): JournalData {
  return {
    entries: state.entries,
    health: state.health.filter((h) => h.updatedAt > 0),
    milestones: [...state.marks.values()],
    profile: state.profile,
  };
}

export function applyMerge(m: MergeResult): Promise<void> {
  const ops: Op[] = [];
  for (const e of m.entries) {
    upsert(state.entries, e);
    ops.push({ store: 'entries', value: e });
  }
  for (const h of m.health) {
    upsert(state.health, h);
    ops.push({ store: 'health', value: h });
  }
  for (const k of m.milestones) {
    state.marks.set(k.id, k);
    ops.push({ store: 'milestones', value: k });
  }
  if (m.profile) {
    state.profile = m.profile;
    ops.push({ store: 'kv', key: 'profile', value: m.profile });
  }
  return write(ops);
}
