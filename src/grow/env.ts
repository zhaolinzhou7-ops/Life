/**
 * 运行环境探测：是不是 iPhone、是不是从主屏幕图标打开、有没有拿到"长期保存"。
 */

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  // iPad 新系统会伪装成 Mac，靠触屏点数认出来
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

export function isPhone(): boolean {
  return isIOS() || isAndroid();
}

/** 是不是从主屏幕图标打开的（而不是在浏览器里） */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || !!window.matchMedia?.('(display-mode: standalone)').matches;
}

/**
 * "长期保存"：向浏览器申请"这份数据很重要，空间紧张时别自动清"。
 * 返回 null 表示这个浏览器不支持这项申请。
 */
export async function isPersisted(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persisted) return null;
    return await navigator.storage.persisted();
  } catch {
    return null;
  }
}

export async function requestPersist(): Promise<boolean | null> {
  try {
    if (!navigator.storage?.persist) return null;
    return await navigator.storage.persist();
  } catch {
    return null;
  }
}
