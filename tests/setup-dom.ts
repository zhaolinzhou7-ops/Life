/**
 * localStorage 的最小替身。
 *
 * 存档和画像这两层的核心逻辑是纯函数，但**存取本身也会出错**——
 * 配额满、隐私模式、存档被写坏，这些正是真实用户会遇到的情况，
 * 必须能测。node 环境没有 localStorage，所以这里给一个够用的实现。
 */
class MemoryStorage {
  private m = new Map<string, string>();
  /** 模拟配额满：打开之后所有写入都抛错，用来测"写不进去也不能崩" */
  full = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) {
    if (this.full) throw new DOMException('QuotaExceededError');
    this.m.set(k, String(v));
  }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}

export const memStore = new MemoryStorage();
(globalThis as unknown as { localStorage: Storage }).localStorage = memStore as unknown as Storage;
