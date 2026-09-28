import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
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
      handler: () => [{ tag: 'script', attrs: { src: `${base}coi-serviceworker.js` }, injectTo: 'head-prepend' }],
    },
    generateBundle() {
      for (const [fileName, file] of Object.entries(ASSETS)) {
        this.emitFile({ type: 'asset', fileName, source: readFileSync(file) });
      }
    },
  };
}

export default defineConfig({
  base: '/Life/',
  build: {
    target: 'es2020',
  },
  server: { headers: ISOLATION },
  preview: { headers: ISOLATION },
  plugins: [engineAssets('/Life/')],
});
