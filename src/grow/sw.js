/**
 * 成长观察的离线缓存（service worker）。
 *
 * 这是模板：构建时 vite.config.ts 里的 growServiceWorker 把下面 VERSION 和
 * PRECACHE 两行换成真实的版本号和文件清单，写到 dist/grow/sw.js。
 *
 * 策略：装好后所有文件都从手机本地读，完全不等网络——国内打开 GitHub Pages
 * 慢或者打不开，都不影响日常记录。有新版本时浏览器会在后台装好，
 * 页面提示"新版本已准备好"，用户点刷新才换，不会打断正在写的记录。
 *
 * 只缓存程序文件。记录数据在 IndexedDB 里，和这里无关。
 */

const VERSION = '__VERSION__';
const PRECACHE = __PRECACHE__;
const CACHE = `grow-${VERSION}`;
// 清单里第一项是页面本身（/Life/grow/）
const SHELL = PRECACHE[0];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // reload：绕过浏览器的 HTTP 缓存，确保拿到的是这一版的文件
      await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('grow-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // ignoreVary：服务器回了 "Vary: Origin" 之类的头时，页面发的请求（带 Origin）
  // 和安装时存进来的请求（不带）会被判成"不是同一个"，断网就找不到缓存。
  // 这里的文件名都带版本哈希，不需要按请求头区分。
  const opts = { cacheName: CACHE, ignoreSearch: true, ignoreVary: true };

  if (req.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(SHELL, opts);
        return cached || fetch(req);
      })(),
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(req, opts);
      return cached || fetch(req);
    })(),
  );
});
