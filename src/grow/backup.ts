/**
 * 备份文件：生成、读取校验、合并。都是纯函数，不碰存储。
 *
 * 备份文件是普通 JSON 文本，用记事本也能打开看。恢复一律按"合并"处理：
 * 备份里有、这里没有的补上；两边都有的留"改得更晚"的那一份；
 * 已经删掉的记录不会因为恢复旧备份又冒出来（删除留了带时间的空壳）。
 */

import { isValidDate, monthKey, todayStr } from './dates';
import { ALL_MILESTONE_IDS } from './milestones';
import { TAG_IDS, type Entry, type HealthItem, type JournalData, type MarkStatus, type MilestoneMark, type Profile, type TagId } from './types';

export const BACKUP_APP = 'grow-journal';
export const BACKUP_FORMAT = 1;

export class BackupError extends Error {}

export function backupFileName(today: string): string {
  return `成长观察备份-${today}.json`;
}

/**
 * 要不要提醒导出：这个月还没导出过、也没点过"本月不再提醒"、而且有东西可备份。
 * 每月第一次打开时就会出现；导出或点掉之前，这个月里每次打开都还在。
 */
export function shouldRemind(today: string, lastExportAt: number, dismissedMonth: string, hasEntries: boolean): boolean {
  if (!hasEntries) return false;
  const month = monthKey(today);
  if (dismissedMonth === month) return false;
  return !(lastExportAt > 0 && monthKey(todayStr(new Date(lastExportAt))) === month);
}

export function buildBackup(data: JournalData, now: Date): string {
  return JSON.stringify(
    {
      app: BACKUP_APP,
      format: BACKUP_FORMAT,
      exportedAt: now.toISOString(),
      note: '成长观察的备份文件。恢复方法：打开成长观察 → 底部"备份" → 从备份恢复。',
      entries: data.entries,
      health: data.health,
      milestones: data.milestones,
      profile: data.profile,
    },
    null,
    2,
  );
}

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
const isTime = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0;
const dateOr = (x: unknown): string => (typeof x === 'string' && isValidDate(x) ? x : '');

function cleanEntry(x: unknown): Entry | null {
  if (!isObj(x) || typeof x.id !== 'string' || !x.id || !isTime(x.updatedAt)) return null;
  const createdAt = isTime(x.createdAt) ? x.createdAt : x.updatedAt;
  if (isTime(x.deletedAt)) {
    return { id: x.id, date: dateOr(x.date), text: '', tags: [], first: false, createdAt, updatedAt: x.updatedAt, deletedAt: x.deletedAt };
  }
  if (typeof x.date !== 'string' || !isValidDate(x.date) || typeof x.text !== 'string') return null;
  const tags = Array.isArray(x.tags) ? [...new Set(x.tags.filter((t): t is TagId => typeof t === 'string' && TAG_IDS.has(t)))] : [];
  return { id: x.id, date: x.date, text: x.text, tags, first: x.first === true, createdAt, updatedAt: x.updatedAt };
}

function cleanHealth(x: unknown): HealthItem | null {
  if (!isObj(x) || typeof x.id !== 'string' || !x.id || !isTime(x.updatedAt)) return null;
  const deleted = isTime(x.deletedAt);
  if (!deleted && (typeof x.name !== 'string' || !x.name.trim())) return null;
  const iv = x.intervalMonths;
  return {
    id: x.id,
    name: typeof x.name === 'string' ? x.name : '',
    mode: x.mode === 'date' ? 'date' : 'interval',
    lastDate: dateOr(x.lastDate),
    intervalMonths: typeof iv === 'number' && Number.isInteger(iv) && iv > 0 && iv <= 240 ? iv : null,
    nextDate: dateOr(x.nextDate),
    note: typeof x.note === 'string' ? x.note : '',
    updatedAt: x.updatedAt,
    ...(deleted ? { deletedAt: x.deletedAt as number } : {}),
  };
}

const STATUSES = new Set<string>(['yes', 'no', 'unsure']);

function cleanMark(x: unknown): MilestoneMark | null {
  if (!isObj(x) || typeof x.id !== 'string' || !ALL_MILESTONE_IDS.has(x.id)) return null;
  if (typeof x.status !== 'string' || !STATUSES.has(x.status) || !isTime(x.updatedAt)) return null;
  return { id: x.id, status: x.status as MarkStatus, updatedAt: x.updatedAt };
}

function cleanProfile(x: unknown): Profile | null {
  if (!isObj(x) || typeof x.birthDate !== 'string' || !isValidDate(x.birthDate) || !isTime(x.updatedAt)) return null;
  return { birthDate: x.birthDate, updatedAt: x.updatedAt };
}

function cleanList<T>(x: unknown, clean: (v: unknown) => T | null): { items: T[]; skipped: number } {
  if (!Array.isArray(x)) return { items: [], skipped: 0 };
  const items: T[] = [];
  for (const v of x) {
    const c = clean(v);
    if (c) items.push(c);
  }
  return { items, skipped: x.length - items.length };
}

export interface ParsedBackup {
  data: JournalData;
  /** 备份时间（ISO），读不出来是 '' */
  exportedAt: string;
  /** 格式不对、被跳过的条数 */
  skipped: number;
}

export function parseBackup(text: string): ParsedBackup {
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, '').trim());
  } catch {
    throw new BackupError('这个文件读不出来：可能不是备份文件，或者文件不完整（复制时少了一截）。');
  }
  if (!isObj(raw) || raw.app !== BACKUP_APP) throw new BackupError('这不是"成长观察"的备份文件。');
  if (typeof raw.format !== 'number' || raw.format > BACKUP_FORMAT) {
    throw new BackupError('这个备份来自更新的版本。请先联网打开一次本工具让它更新，再来恢复。');
  }
  const e = cleanList(raw.entries, cleanEntry);
  const h = cleanList(raw.health, cleanHealth);
  const m = cleanList(raw.milestones, cleanMark);
  return {
    data: { entries: e.items, health: h.items, milestones: m.items, profile: cleanProfile(raw.profile) },
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    skipped: e.skipped + h.skipped + m.skipped,
  };
}

/** 备份内容概况，恢复前给人看一眼 */
export function describe(data: JournalData): { entries: number; from: string; to: string } {
  const live = data.entries.filter((e) => !e.deletedAt).map((e) => e.date).sort();
  return { entries: live.length, from: live[0] ?? '', to: live[live.length - 1] ?? '' };
}

export interface MergeResult {
  /** 需要写入的内容（只含有变化的） */
  entries: Entry[];
  health: HealthItem[];
  milestones: MilestoneMark[];
  profile: Profile | null;
  stats: { added: number; updated: number; removed: number; others: number };
}

function newerOnes<T extends { id: string; updatedAt: number }>(local: T[], incoming: T[]): T[] {
  const byId = new Map(local.map((x) => [x.id, x]));
  const out = new Map<string, T>();
  for (const x of incoming) {
    const cur = out.get(x.id) ?? byId.get(x.id);
    if (!cur || x.updatedAt > cur.updatedAt) out.set(x.id, x);
  }
  return [...out.values()];
}

export function mergeData(local: JournalData, incoming: JournalData): MergeResult {
  const localEntries = new Map(local.entries.map((e) => [e.id, e]));
  const entries = newerOnes(local.entries, incoming.entries);
  const stats = { added: 0, updated: 0, removed: 0, others: 0 };
  for (const e of entries) {
    const before = localEntries.get(e.id);
    const wasLive = !!before && !before.deletedAt;
    if (e.deletedAt) {
      if (wasLive) stats.removed++;
    } else if (wasLive) stats.updated++;
    else stats.added++;
  }
  const health = newerOnes(local.health, incoming.health);
  const milestones = newerOnes(local.milestones, incoming.milestones);
  const profile =
    incoming.profile && (!local.profile || incoming.profile.updatedAt > local.profile.updatedAt) ? incoming.profile : null;
  stats.others = health.length + milestones.length + (profile ? 1 : 0);
  return { entries, health, milestones, profile, stats };
}
