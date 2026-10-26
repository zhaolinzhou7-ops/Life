/**
 * 小游戏合集的 service worker：跨源隔离 + 离线缓存。
 *
 * 用户原话："为什么每一次皮卡鱼都加载不了？每次没网的时候就没办法加载，是不是这个原因？"
 * ——是。原来这里用的是 coi-serviceworker，它只做一件事：给每个响应补上 COOP/COEP 两个头，让页面"跨源隔离"
 * （皮卡鱼叫停要用 SharedArrayBuffer）。所有请求它都转去网上取，**断网时一律失败**：页面、程序、
 * 皮卡鱼（4.6MB）都取不到；网站的 HTTP 缓存只留十分钟，过了也一样要重新下载。
 *
 * 现在：
 *   - 跨源隔离照旧（同一个文件名，已经装过旧版的手机会自动换成这一版）；
 *   - 装好时把页面、全部程序文件、皮卡鱼的引擎和评估网络存进手机（PRECACHE，约 9MB）；
 *     图片、配音用到一次就存一次；
 *   - 之后打开一律先读手机里的（断网、GitHub 打不开都能用，皮卡鱼也在），页面本身顺手去网上看有没有新版。
 *   - 皮卡鱼单独一个缓存（名字带引擎文件的哈希）：网站更新但引擎没换时不重新下载那 4.6MB。
 *
 * 这是模板：构建时 vite.config.ts 的 appServiceWorker 把 VERSION、PIKA、PRECACHE、PIKA_FILES 换成真值，
 * 写成 dist/coi-serviceworker.js。开发时不用它（开发服务器直接发隔离头，页面本来就隔离）。
 *
 * 同一个文件在页面里也跑一遍（index.html 里的 <script>）：负责注册自己。
 * 跨源隔离 coi-serviceworker v0.1.7 的写法（Guido Zuidhof 等，MIT）照搬过来。
 */

const VERSION = '__VERSION__';
const PIKA = '__PIKA__';
const PRECACHE = __PRECACHE__;
const PIKA_FILES = __PIKA_FILES__;

const CORE = `life-core-${VERSION}`;
const ENGINE = `life-pika-${PIKA}`;
/** 图片、配音：文件名带内容哈希，存进来就一直能用，跨版本留着 */
const MEDIA = 'life-media';

if (typeof window === 'undefined') {
  let coepCredentialless = false;

  self.addEventListener('install', (event) => {
    event.waitUntil(
      (async () => {
        // reload：绕过浏览器的 HTTP 缓存，确保拿到的是这一版的文件
        const core = await caches.open(CORE);
        await core.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
        const eng = await caches.open(ENGINE);
        for (const url of PIKA_FILES) {
          if (!(await eng.match(url))) await eng.add(new Request(url, { cache: 'reload' }));
        }
        await self.skipWaiting();
      })(),
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      (async () => {
        // 旧版本留一份：正开着的页面还是旧程序，它后面按需加载的那几块（旧文件名）得还找得到
        const keys = await caches.keys();
        const cores = keys.filter((k) => k.startsWith('life-core-') && k !== CORE);
        const keep = new Set([CORE, ENGINE, MEDIA, ...cores.slice(-1)]);
        for (const k of keys) if (k.startsWith('life-') && !keep.has(k)) await caches.delete(k);
        await self.clients.claim();
      })(),
    );
  });

  self.addEventListener('message', (ev) => {
    if (!ev.data) return;
    if (ev.data.type === 'deregister') {
      self.registration
        .unregister()
        .then(() => self.clients.matchAll())
        .then((clients) => clients.forEach((client) => client.navigate(client.url)));
    } else if (ev.data.type === 'coepCredentialless') {
      coepCredentialless = ev.data.value;
    }
  });

  /** 补上跨源隔离的头（和 coi-serviceworker 一样） */
  const isolate = (response) => {
    if (!response || response.status === 0) return response;
    const headers = new Headers(response.headers);
    headers.set('Cross-Origin-Embedder-Policy', coepCredentialless ? 'credentialless' : 'require-corp');
    if (!coepCredentialless) headers.set('Cross-Origin-Resource-Policy', 'cross-origin');
    headers.set('Cross-Origin-Opener-Policy', 'same-origin');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  };

  // ignoreVary：服务器回了 "Vary: Origin" 之类的头时，页面发的请求（带 Origin）和安装时存的（不带）
  // 会被判成"不是同一个"，断网就找不到。文件名都带版本哈希，不需要按请求头区分
  const opts = { ignoreSearch: true, ignoreVary: true };
  const scope = new URL(self.registration.scope).pathname;
  const SHELL = PRECACHE[0];

  async function fromCache(req, cacheName) {
    if (cacheName) {
      const c = await caches.open(cacheName);
      return c.match(req, opts);
    }
    return caches.match(req, opts);
  }

  /** 先读手机里的，没有再上网取，取到的存起来 */
  async function cacheFirst(req, cacheName) {
    const hit = await fromCache(req, cacheName);
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok && res.type === 'basic') {
      const c = await caches.open(cacheName);
      await c.put(req, res.clone());
    }
    return res;
  }

  /** 页面本身：手机里有就先给（马上打开），没有（第一次）才上网 */
  async function shell(req) {
    const hit = await fromCache(SHELL, CORE);
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (e) {
      const any = await caches.match(SHELL, opts);
      if (any) return any;
      throw e;
    }
  }

  self.addEventListener('fetch', (event) => {
    const r = event.request;
    if (r.cache === 'only-if-cached' && r.mode !== 'same-origin') return;
    const request = coepCredentialless && r.mode === 'no-cors' ? new Request(r, { credentials: 'omit' }) : r;
    const url = new URL(r.url);
    const mine = url.origin === self.location.origin && r.method === 'GET';
    // 成长观察、健康打卡是独立页面，有自己的离线缓存
    const other = url.pathname.startsWith(scope + 'grow/') || url.pathname.startsWith(scope + 'health');

    let res;
    if (!mine || other) {
      res = fetch(request);
    } else if (r.mode === 'navigate' && (url.pathname === scope || url.pathname === scope + 'index.html')) {
      res = shell(r);
    } else if (url.pathname.startsWith(scope + 'pika/')) {
      res = cacheFirst(r, ENGINE);
    } else if (url.pathname.startsWith(scope + 'assets/')) {
      // 先在所有缓存里找（正开着的旧版页面要的旧文件在上一版的缓存里），没有再上网取、存进 MEDIA
      res = fromCache(r).then((hit) => hit || cacheFirst(r, MEDIA));
    } else {
      // 别的（coi-serviceworker.js 自己、fonts/……）：先上网，断网用手机里的
      res = fetch(request).catch(async (e) => {
        const hit = await caches.match(r, opts);
        if (hit) return hit;
        throw e;
      });
    }
    event.respondWith(res.then(isolate).catch((e) => {
      console.error(e);
      return Response.error();
    }));
  });
} else {
  (() => {
    const coi = {
      shouldRegister: () => true,
      shouldDeregister: () => false,
      coepCredentialless: () => !(window.chrome || window.netscape),
      doReload: () => window.location.reload(),
      quiet: true,
      ...window.coi,
    };
    const n = navigator;
    if (n.serviceWorker && n.serviceWorker.controller) {
      n.serviceWorker.controller.postMessage({ type: 'coepCredentialless', value: coi.coepCredentialless() });
      if (coi.shouldDeregister()) n.serviceWorker.controller.postMessage({ type: 'deregister' });
    }
    if (!coi.shouldRegister() || !window.isSecureContext || !n.serviceWorker) return;
    // 原来已经跨源隔离就不注册；现在还要靠它离线，照样注册。
    // 只有"还没隔离、也还没被它接管"的第一次打开才刷新一下（让隔离生效）；以后更新不刷新，下次打开自然用上
    const needReload = window.crossOriginIsolated === false && !n.serviceWorker.controller;
    n.serviceWorker.register(window.document.currentScript.src).then(
      (registration) => {
        if (!needReload) return;
        if (registration.active) coi.doReload();
        else registration.addEventListener('updatefound', () => {
          const w = registration.installing;
          if (w) w.addEventListener('statechange', () => w.state === 'activated' && coi.doReload());
        });
      },
      (err) => !coi.quiet && console.error('service worker 注册失败：', err),
    );
  })();
}
