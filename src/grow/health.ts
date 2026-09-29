/**
 * 健康节点：算下次日期、判断快到期、排序。都是纯函数。
 */

import { addMonths, daysBetween, isValidDate } from './dates';
import type { HealthItem } from './types';

/** 距离到期不超过这么多天，就算"快到期"，排到最前面 */
export const SOON_DAYS = 30;

export type DueState = 'overdue' | 'soon' | 'later' | 'unknown';

export interface DueInfo {
  /** 下次日期；信息不全时是 '' */
  due: string;
  /** 还有几天（负数表示已过期几天）；信息不全时为 null */
  days: number | null;
  state: DueState;
}

/**
 * 预置的四项。id 固定：手机和电脑各自生成的预置项在合并备份时能对上，
 * 不会变成两份。updatedAt 为 0：任何一次真实修改或删除都比它新。
 */
export const PRESET_HEALTH: readonly HealthItem[] = [
  { id: 'preset-checkup', name: '体检', mode: 'interval', lastDate: '', intervalMonths: null, nextDate: '', note: '', updatedAt: 0 },
  { id: 'preset-vision', name: '视力', mode: 'interval', lastDate: '', intervalMonths: null, nextDate: '', note: '', updatedAt: 0 },
  { id: 'preset-dental', name: '牙科', mode: 'interval', lastDate: '', intervalMonths: null, nextDate: '', note: '', updatedAt: 0 },
  { id: 'preset-vaccine', name: '疫苗', mode: 'date', lastDate: '', intervalMonths: null, nextDate: '', note: '', updatedAt: 0 },
];

export function dueDate(item: HealthItem): string {
  if (item.mode === 'date') return isValidDate(item.nextDate) ? item.nextDate : '';
  if (isValidDate(item.lastDate) && item.intervalMonths && item.intervalMonths > 0) {
    return addMonths(item.lastDate, item.intervalMonths);
  }
  return '';
}

export function dueInfo(item: HealthItem, today: string): DueInfo {
  const due = dueDate(item);
  if (!due) return { due, days: null, state: 'unknown' };
  const days = daysBetween(today, due);
  const state: DueState = days < 0 ? 'overdue' : days <= SOON_DAYS ? 'soon' : 'later';
  return { due, days, state };
}

const RANK: Record<DueState, number> = { overdue: 0, soon: 1, later: 2, unknown: 3 };

/** 已过期 → 快到期 → 以后 → 没填日期；同一档里越早到期越靠前 */
export function sortHealth(items: HealthItem[], today: string): HealthItem[] {
  return items
    .map((item, i) => ({ item, i, info: dueInfo(item, today) }))
    .sort((a, b) => {
      const r = RANK[a.info.state] - RANK[b.info.state];
      if (r) return r;
      if (a.info.days !== null && b.info.days !== null && a.info.days !== b.info.days) return a.info.days - b.info.days;
      return a.i - b.i;
    })
    .map((x) => x.item);
}

/** "今天做过了"：上次日期改成今天；直接填日期的那种，下次日期要重新填 */
export function markDone(item: HealthItem, today: string, now: number): HealthItem {
  return { ...item, lastDate: today, nextDate: item.mode === 'date' ? '' : item.nextDate, updatedAt: now };
}
