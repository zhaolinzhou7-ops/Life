/**
 * 进度备份 / 恢复，和"别让浏览器把进度清掉"。
 *
 * 所有进度（实战分、错题本、下过的棋、布局复习、私教课……）都在浏览器的 localStorage 里，键名都以 `xq-` 开头。
 * 这有三个坑：
 *   1. iPhone 的 Safari：网页没加到主屏幕，七天没打开 Safari 用这个网站，存的东西会被清掉（WebKit 的防跟踪规定）。
 *   2. 加到主屏幕以后，那个图标打开的是**另一份**存储——Safari 里攒的进度不会自己过去。
 *   3. 换手机、清浏览器数据，什么都没了。
 * 所以要能导出成一个文件、再导回来；能申请"持久存储"的浏览器就申请一下（存储紧张时不先清它）。
 */

/** 只是这台设备的情况（引擎能不能跑、跑几条车道），换台手机不该带过去 */
const DEVICE_ONLY = /^xq-(engine-|power$)/;
const PREFIX = 'xq-';
const LAST_KEY = 'xq-backup-at';
const NAG_KEY = 'xq-backup-nag';
const FORMAT = 'life-xiangqi-backup';

export interface BackupFile {
  format: typeof FORMAT;
  v: 1;
  /** 导出的时间（ISO） */
  at: string;
  data: Record<string, string>;
}

function keys(): string[] {
  const out: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && !DEVICE_ONLY.test(k)) out.push(k);
    }
  } catch {
    /* 无痕模式读不了 */
  }
  return out.sort();
}

/** 现在的进度打成一份 */
export function makeBackup(now = new Date()): BackupFile {
  const data: Record<string, string> = {};
  for (const k of keys()) {
    if (k === NAG_KEY) continue;
    const v = localStorage.getItem(k);
    if (v !== null) data[k] = v;
  }
  return { format: FORMAT, v: 1, at: now.toISOString(), data };
}

/** 备份里大致有什么（恢复前给人看一眼，别拿一份空的盖掉几个月的进度） */
export function describeBackup(b: BackupFile): { games: number; solved: number; srs: number; at: string; keys: number } {
  let games = 0;
  let solved = 0;
  let srs = 0;
  try {
    const a = JSON.parse(b.data['xq-archive'] ?? '[]');
    games = Array.isArray(a) ? a.length : 0;
  } catch {
    /* 坏了就当 0 */
  }
  try {
    const s = JSON.parse(b.data['xq-save'] ?? '{}') as { solved?: unknown[] | Record<string, unknown>; srs?: unknown[] | Record<string, unknown> };
    const n = (x: unknown) => (Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0);
    solved = n(s.solved);
    srs = n(s.srs);
  } catch {
    /* 同上 */
  }
  return { games, solved, srs, at: b.at, keys: Object.keys(b.data).length };
}

/** 读一份备份文件。不是我们的格式、或者坏了，给一句人话 */
export function parseBackup(text: string): { ok: true; backup: BackupFile } | { ok: false; error: string } {
  let d: unknown;
  try {
    d = JSON.parse(text.trim());
  } catch {
    return { ok: false, error: '这个文件读不出来：不是备份文件，或者没传完整。' };
  }
  const b = d as Partial<BackupFile>;
  if (!b || typeof b !== 'object' || b.format !== FORMAT || typeof b.data !== 'object' || !b.data) {
    return { ok: false, error: '这不是象棋进度的备份文件。' };
  }
  if (b.v !== 1) return { ok: false, error: '这份备份是更新的版本做的，先把这里的页面刷新到最新再恢复。' };
  for (const [k, v] of Object.entries(b.data)) {
    if (!k.startsWith(PREFIX) || typeof v !== 'string') return { ok: false, error: '备份文件里有看不懂的内容，没有恢复。' };
  }
  return { ok: true, backup: b as BackupFile };
}

/**
 * 用备份**换掉**现在的进度（不是合并：两份实战分、两份错题本混在一起说不清）。
 * 这台设备自己的设置（引擎车道）留着。写不进去（配额满）就把原来的放回去。
 */
export function restoreBackup(b: BackupFile): { ok: true } | { ok: false; error: string } {
  const before: Record<string, string> = {};
  for (const k of keys()) before[k] = localStorage.getItem(k) ?? '';
  try {
    for (const k of Object.keys(before)) localStorage.removeItem(k);
    for (const [k, v] of Object.entries(b.data)) if (!DEVICE_ONLY.test(k)) localStorage.setItem(k, v);
    localStorage.setItem(LAST_KEY, b.at);
    return { ok: true };
  } catch {
    try {
      for (const k of keys()) localStorage.removeItem(k);
      for (const [k, v] of Object.entries(before)) localStorage.setItem(k, v);
    } catch {
      /* 放不回去也只能这样了 */
    }
    return { ok: false, error: '手机上的存储空间不够，没有恢复，原来的进度还在。' };
  }
}

/** 上一次备份（导出或者从备份恢复）是什么时候；没备份过是 null */
export function lastBackupAt(): Date | null {
  try {
    const v = localStorage.getItem(LAST_KEY);
    const d = v ? new Date(v) : null;
    return d && !Number.isNaN(d.getTime()) ? d : null;
  } catch {
    return null;
  }
}

/**
 * 文件名：xiangqi-backup-2026-11-04.json。用英文：中文文件名有的浏览器存成"download"、传到微信里还会变成乱码
 */
export const backupFileName = (d = new Date()) => `xiangqi-backup-${d.toLocaleDateString('sv')}.json`;

/**
 * 存成文件。手机上优先走系统分享（能直接存进"文件"、发给微信里的自己）；不支持就下载。
 * 返回是不是真的交出去了（用户在分享面板里取消了就是 false，不记成"备份过"）。
 */
export async function saveBackupFile(): Promise<boolean> {
  const b = makeBackup();
  const text = JSON.stringify(b);
  const name = backupFileName();
  const blob = new Blob([text], { type: 'application/json' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  let done = false;
  try {
    const file = new File([blob], name, { type: 'application/json' });
    if (nav.share && nav.canShare?.({ files: [file] }) && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
      await nav.share({ files: [file], title: name });
      done = true;
    }
  } catch (e) {
    // 用户取消分享不算失败，也不算备份过
    if ((e as Error)?.name === 'AbortError') return false;
  }
  if (!done) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    done = true;
  }
  try {
    localStorage.setItem(LAST_KEY, b.at);
  } catch {
    /* 记不下时间不要紧 */
  }
  return done;
}

// ───────────────────────── 持久存储 ─────────────────────────

let asked: Promise<boolean | null> | null = null;
/**
 * 向浏览器申请"持久存储"：存储紧张时不先清这个网站。一次打开只问一次。
 * 返回 true 已经是持久的；false 浏览器没给；null 浏览器不支持这个。
 */
export function askPersist(): Promise<boolean | null> {
  if (asked) return asked;
  const st = (typeof navigator !== 'undefined' ? navigator.storage : undefined) as StorageManager | undefined;
  if (!st?.persist) return (asked = Promise.resolve(null));
  asked = (async () => {
    try {
      if (st.persisted && (await st.persisted())) return true;
      return await st.persist();
    } catch {
      return null;
    }
  })();
  return asked;
}

// ───────────────────────── iPhone 主屏幕 ─────────────────────────

/** 装到主屏幕、从主屏幕打开的 */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
}

/** iPhone / iPad 上在 Safari（或别的浏览器）标签页里开着：七天不用会被清 */
export function iosTab(): boolean {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return ios && !isStandalone();
}

/**
 * 首页要不要提醒备份：有了值得保的进度（下过三盘、或者错题本里有题），而且
 * 从没备份过 / 上次备份是三十天前；点过"知道了"的十四天内不再提。
 */
export function shouldNag(progress: { games: number; srs: number }, now = Date.now()): boolean {
  if (progress.games < 3 && progress.srs < 5) return false;
  try {
    const snooze = Number(localStorage.getItem(NAG_KEY) ?? 0);
    if (now - snooze < 14 * 864e5) return false;
  } catch {
    return false;
  }
  const last = lastBackupAt();
  return !last || now - last.getTime() > 30 * 864e5;
}

export function snoozeNag(now = Date.now()) {
  try {
    localStorage.setItem(NAG_KEY, String(now));
  } catch {
    /* 记不下就下回再提 */
  }
}
