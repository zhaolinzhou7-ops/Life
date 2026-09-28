import type { Entry } from '../types';

export type Tab = 'record' | 'timeline' | 'health' | 'growth' | 'backup';

/** 各页面拿到的外壳能力 */
export interface Ctx {
  /** 重画当前页 */
  refresh(): void;
  go(tab: Tab): void;
  editEntry(e: Entry): void;
  /** 导出备份。必须在点击事件里直接调用（iPhone 的分享面板要求） */
  runExport(): void;
}
