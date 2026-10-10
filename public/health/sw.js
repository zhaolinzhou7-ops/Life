/**
 * 健康打卡的离线缓存（service worker）。
 *
 * 这是模板：build.js 把 VERSION 和 FILES 两行换成真实值，写到输出目录的 sw.js。
 *
 * 装好后所有文件都从手机本地读，不等网络——断网、国内打开 GitHub Pages 慢都不影响。
 * 有新版本时浏览器在后台装好，页面弹「刷新」提示，用户点了才换。
 *
 * 只缓存程序文件。打卡数据在 localStorage 里，和这里无关。
 */

const VERSION = "2e6ce251686f";
const FILES = ["./","manifest.webmanifest","icon-180.png","icon-192.png","icon-512.png"];
const CACHE = 'health-' + VERSION;
// 页面本身（…/health/），也是 FILES 的第一项
const SHELL = new URL('./', self.location).href;
const URLS = FILES.map((f) => new URL(f, SHELL).href);

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      for (const url of URLS) {
        // reload：绕过浏览器缓存，确保拿到这一版的文件
        const res = await fetch(new Request(url, { cache: 'reload' }));
        if (!res.ok) throw new Error('下载失败 ' + res.status + ' ' + url);
        // 网站的 CDN 可能还在给旧页面：页面里的版本号对不上就不装，下次再试
        if (url === SHELL && !(await res.clone().text()).includes(VERSION)) {
          throw new Error('页面还是旧版本，稍后再装');
        }
        await cache.put(url, res);
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        if (key.startsWith('health-') && key !== CACHE) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(SHELL)) return;
  // ignoreVary：服务器回了 "Vary: Origin" 之类的头时，断网也能匹配上缓存
  const opts = { cacheName: CACHE, ignoreSearch: true, ignoreVary: true };
  event.respondWith(
    (async () => {
      const key = req.mode === 'navigate' ? SHELL : req;
      return (await caches.match(key, opts)) || fetch(req);
    })(),
  );
});
