/**
 * 导出与恢复的动作（会碰存储和系统分享面板）。
 *
 * 导出优先走系统分享面板：iPhone 上可以直接"存储到文件"（选 iCloud 云盘）、
 * 发给微信"文件传输助手"或隔空投送。电脑上直接下载文件。
 * 注意：exportBackup 必须在点击事件里**同步**调用到 navigator.share，
 * 中间不能 await 任何东西，否则 iPhone 会拒绝弹出分享面板。
 */

import { backupFileName, buildBackup, mergeData, parseBackup, type MergeResult, type ParsedBackup } from './backup';
import { todayStr } from './dates';
import { isPhone } from './env';
import { applyMerge, journalData, setLastExport, state } from './store';

export type ExportOutcome = 'shared' | 'downloaded' | 'cancelled';

function download(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function backupText(): string {
  return buildBackup(journalData(), new Date());
}

export async function exportBackup(): Promise<ExportOutcome> {
  const text = backupText();
  const name = backupFileName(todayStr());
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (isPhone() && typeof nav.share === 'function' && typeof nav.canShare === 'function') {
    // 有的系统只肯分享它认识的文件类型，JSON 不行就按纯文本再试一次（文件名不变）
    const file = [new File([text], name, { type: 'application/json' }), new File([text], name, { type: 'text/plain' })].find((f) =>
      nav.canShare!({ files: [f] }),
    );
    if (file) {
      try {
        await nav.share({ files: [file] });
        await markExported();
        return 'shared';
      } catch (err) {
        if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
        // 其它错误：退回下载
      }
    }
  }
  download(text, name);
  await markExported();
  return 'downloaded';
}

async function markExported() {
  try {
    await setLastExport(Date.now());
  } catch {
    // 记不住"上次备份时间"不影响备份本身
  }
}

/** 复制全部备份内容为文字：分享和下载都不好用时的保底办法 */
export async function copyBackupText(): Promise<boolean> {
  const text = backupText();
  try {
    await navigator.clipboard.writeText(text);
    await markExported();
    return true;
  } catch {
    return false;
  }
}

export function readBackup(text: string): ParsedBackup {
  return parseBackup(text);
}

export function planMerge(parsed: ParsedBackup): MergeResult {
  return mergeData(
    { entries: state.entries, health: state.health, milestones: [...state.marks.values()], profile: state.profile },
    parsed.data,
  );
}

export function commitMerge(m: MergeResult): Promise<void> {
  return applyMerge(m);
}
