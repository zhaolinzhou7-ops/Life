/**
 * 本地存档：收藏、备注、上次填过的需求
 *
 * 全部存在 localStorage。隐私模式下写不进去时，产品照常能用，只是关掉页面
 * 就没了——这比弹一个"请开启存储权限"的框要体面。
 */

import type { FavoriteItem, NameCandidate, NamingRequest } from './types';

const KEY = 'naming-save';

interface SaveData {
  favorites: FavoriteItem[];
  /** 上次填的需求，下次进来直接带出来，不用重填 */
  lastRequest?: NamingRequest;
  /** 对比页上次选中的名字 */
  compareIds: string[];
}

const EMPTY: SaveData = { favorites: [], compareIds: [] };

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      return {
        favorites: Array.isArray(d.favorites) ? d.favorites : [],
        lastRequest: d.lastRequest,
        compareIds: Array.isArray(d.compareIds) ? d.compareIds : [],
      };
    }
  } catch {
    // 数据损坏时当作没存过
  }
  return { ...EMPTY };
}

function save(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // 存不下就算了，不打断用户
  }
}

export function getFavorites(): FavoriteItem[] {
  return load().favorites.sort((a, b) => b.savedAt - a.savedAt);
}

export function isFavorite(id: string): boolean {
  return load().favorites.some((f) => f.id === id);
}

export function toggleFavorite(name: NameCandidate): boolean {
  const d = load();
  const i = d.favorites.findIndex((f) => f.id === name.id);
  if (i >= 0) {
    d.favorites.splice(i, 1);
    d.compareIds = d.compareIds.filter((x) => x !== name.id);
    save(d);
    return false;
  }
  d.favorites.push({ id: name.id, name, note: '', savedAt: Date.now() });
  save(d);
  return true;
}

export function removeFavorite(id: string): void {
  const d = load();
  d.favorites = d.favorites.filter((f) => f.id !== id);
  d.compareIds = d.compareIds.filter((x) => x !== id);
  save(d);
}

export function setNote(id: string, note: string): void {
  const d = load();
  const f = d.favorites.find((x) => x.id === id);
  if (f) {
    f.note = note;
    save(d);
  }
}

export function getLastRequest(): NamingRequest | undefined {
  return load().lastRequest;
}

export function setLastRequest(req: NamingRequest): void {
  const d = load();
  d.lastRequest = req;
  save(d);
}

export function getCompareIds(): string[] {
  return load().compareIds;
}

export function setCompareIds(ids: string[]): void {
  const d = load();
  d.compareIds = ids.slice(0, 4);
  save(d);
}
