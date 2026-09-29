/**
 * 时间线的筛选、搜索、分组。纯函数。
 */

import { monthKey } from './dates';
import { tagLabel, type Entry, type TagId } from './types';

export interface EntryFilter {
  /** YYYY-MM；搜索时忽略，搜全部月份 */
  month: string;
  /** 选中的标签，含其中任意一个就算 */
  tags: ReadonlySet<TagId>;
  firstOnly: boolean;
  query: string;
}

function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase();
}

/** 输入的 entries 应当已按时间从新到旧排好 */
export function filterEntries(entries: readonly Entry[], f: EntryFilter): Entry[] {
  const words = norm(f.query).split(/\s+/).filter(Boolean);
  return entries.filter((e) => {
    if (e.deletedAt) return false;
    if (!words.length && monthKey(e.date) !== f.month) return false;
    if (f.tags.size && !e.tags.some((t) => f.tags.has(t))) return false;
    if (f.firstOnly && !e.first) return false;
    if (words.length) {
      // 标签名也能搜到：搜"睡眠"能找到打了睡眠标签的记录
      const hay = norm([e.text, ...e.tags.map(tagLabel), e.first ? '第一次' : ''].join(' '));
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
}

export function groupBy<K>(entries: readonly Entry[], key: (e: Entry) => K): { key: K; entries: Entry[] }[] {
  const out: { key: K; entries: Entry[] }[] = [];
  for (const e of entries) {
    const k = key(e);
    const last = out[out.length - 1];
    if (last && last.key === k) last.entries.push(e);
    else out.push({ key: k, entries: [e] });
  }
  return out;
}
