import { defineConfig, type Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 象棋教练用的专业引擎（Pikafish 皮卡鱼，WASM）和一个让页面跨源隔离的 service worker。
 *
 * 引擎文件放在 vendor/pikafish/（原样，GPL-3.0，来源和校验和见那里的 README）。
 * 构建时拷进 dist/pika/，开发时直接从 vendor 读。
 *
 * 跨源隔离眼下不是必需的（这个引擎是单线程构建），留着是因为上一版已经在用户设备上
 * 注册过这个 service worker；而且将来换多线程构建时直接就能用上。
 */
const PIKA_DIR = resolve(__dirname, 'vendor/pikafish');
const ASSETS: Record<string, string> = {
  'pika/pikafish.js': resolve(PIKA_DIR, 'pikafish.js'),
  'pika/pikafish.wasm': resolve(PIKA_DIR, 'pikafish.wasm'),
  'pika/pikafish.data': resolve(PIKA_DIR, 'pikafish.data'),
  'pika/pika-worker.js': resolve(PIKA_DIR, 'pika-worker.js'),
  'pika/COPYING': resolve(PIKA_DIR, 'COPYING'),
  'pika/README.md': resolve(PIKA_DIR, 'README.md'),
  'coi-serviceworker.js': resolve(__dirname, 'node_modules/coi-serviceworker/coi-serviceworker.min.js'),
};
const TYPES: Record<string, string> = { js: 'text/javascript', wasm: 'application/wasm', data: 'application/octet-stream', md: 'text/plain; charset=utf-8' };

/**
 * 多线程 WASM 要用 SharedArrayBuffer，浏览器只在"跨源隔离"的页面里给它，
 * 而跨源隔离要服务器发 COOP/COEP 两个响应头。开发/预览服务器在这里直接发；
 * GitHub Pages 发不了，线上靠 coi-serviceworker 在浏览器里补上。
 */
const ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

function engineAssets(base: string): Plugin {
  return {
    name: 'xiangqi-engine-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? '').split('?')[0];
        const key = path.startsWith(base) ? path.slice(base.length) : '';
        const file = ASSETS[key];
        if (!file) return next();
        res.setHeader('Content-Type', TYPES[key.split('.').pop() ?? ''] ?? 'application/octet-stream');
        for (const [k, v] of Object.entries(ISOLATION)) res.setHeader(k, v);
        res.end(readFileSync(file));
      });
    },
    /*
     * 让页面"跨源隔离"的 service worker。GitHub Pages 没法加响应头，它在浏览器里补上
     * （第一次打开会自动刷新一次）；已经隔离（开发服务器直接发了响应头）时它什么都不做。
     * 不写在 index.html 里：普通 <script> 的路径开发时会被补上 base、构建时不会，
     * 两边总有一边错。在这里按 base 生成，两边一样。
     */
    transformIndexHtml: {
      order: 'post',
      // 成长观察（grow/）是独立页面，有自己的 service worker，不需要跨源隔离
      handler: (_html, ctx) =>
        isGrowPage(ctx.filename) ? [] : [{ tag: 'script', attrs: { src: `${base}coi-serviceworker.js` }, injectTo: 'head-prepend' }],
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(ASSETS)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
      }
    },
  };
}

const GROW_HTML = resolve(__dirname, 'grow/index.html');
const GROW_PUBLIC = resolve(__dirname, 'public/grow');

function isGrowPage(file: string | undefined): boolean {
  return !!file && file.replace(/\\/g, '/').endsWith('/grow/index.html');
}

/**
 * 成长观察的离线缓存。
 *
 * 程序文件名带内容哈希（每次构建都可能变），service worker 得知道这一版到底有哪些
 * 文件才能提前全部存进手机。这里在构建产物写完后，顺着 grow 入口把它用到的
 * JS/CSS 找全，加上 public/grow 里的图标和 manifest，填进 src/grow/sw.js 模板，
 * 写成 dist/grow/sw.js。版本号取这些内容的哈希：内容不变，版本就不变，
 * 手机也就不会白白重新下载。
 */
function growServiceWorker(base: string): Plugin {
  return {
    name: 'grow-service-worker',
    apply: 'build',
    writeBundle(options, bundle) {
      const files = new Set<string>();
      const visit = (name: string) => {
        const item = bundle[name];
        if (!item || files.has(name)) return;
        files.add(name);
        if (item.type === 'chunk') {
          item.imports.forEach(visit);
          item.viteMetadata?.importedCss.forEach((f) => files.add(f));
          item.viteMetadata?.importedAssets.forEach((f) => files.add(f));
        }
      };
      for (const item of Object.values(bundle)) {
        if (item.type === 'chunk' && item.isEntry && isGrowPage(item.facadeModuleId ?? undefined)) visit(item.fileName);
      }
      if (!files.size) throw new Error('grow-service-worker：没找到成长观察的入口文件');

      const statics = readdirSync(GROW_PUBLIC).sort();
      const urls = [`${base}grow/`, ...[...files].sort().map((f) => base + f), ...statics.map((f) => `${base}grow/${f}`)];

      const hash = createHash('sha256');
      hash.update(urls.join('\n'));
      const html = bundle['grow/index.html'];
      if (html?.type === 'asset') hash.update(html.source);
      for (const f of statics) hash.update(readFileSync(resolve(GROW_PUBLIC, f)));
      let sw = readFileSync(resolve(__dirname, 'src/grow/sw.js'), 'utf8');
      const fill = (line: string, value: string) => {
        if (!sw.includes(line)) throw new Error(`grow-service-worker：模板里找不到 ${line}`);
        sw = sw.replace(line, line.replace(/'?__\w+__'?/, value));
      };
      fill("const VERSION = '__VERSION__';", JSON.stringify(hash.digest('hex').slice(0, 12)));
      fill('const PRECACHE = __PRECACHE__;', JSON.stringify(urls, null, 2));
      writeFileSync(resolve(options.dir ?? resolve(__dirname, 'dist'), 'grow/sw.js'), sw);
    },
  };
}

export default defineConfig({
  base: '/Life/',
  build: {
    target: 'es2020',
    rollupOptions: {
      // 两个页面：小游戏合集（/Life/）和成长观察（/Life/grow/）
      input: { index: resolve(__dirname, 'index.html'), grow: GROW_HTML },
    },
  },
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  plugins: [engineAssets('/Life/'), growServiceWorker('/Life/')],
});
