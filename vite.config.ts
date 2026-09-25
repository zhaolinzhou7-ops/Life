import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 象棋教练用的专业引擎（Fairy-Stockfish，WASM 多线程版）和让它能跑起来的 service worker。
 *
 * 文件不进 git：版本钉死在 package.json 里，构建时从 node_modules 拷进 dist，
 * 开发时直接从 node_modules 读。这样升级只改一个版本号，仓库里也没有二进制。
 *
 * 引擎是 GPL-3.0，原样分发、不做修改，许可证文本（Copying.txt）一并拷过去。
 */
const ENGINE_DIR = resolve(__dirname, 'node_modules/fairy-stockfish-nnue.wasm');
const ASSETS: Record<string, string> = {
  'fsf/stockfish.js': resolve(ENGINE_DIR, 'stockfish.js'),
  'fsf/stockfish.wasm': resolve(ENGINE_DIR, 'stockfish.wasm'),
  'fsf/stockfish.worker.js': resolve(ENGINE_DIR, 'stockfish.worker.js'),
  'fsf/Copying.txt': resolve(ENGINE_DIR, 'Copying.txt'),
  'fsf/AUTHORS': resolve(ENGINE_DIR, 'AUTHORS'),
  'coi-serviceworker.js': resolve(__dirname, 'node_modules/coi-serviceworker/coi-serviceworker.min.js'),
};
const TYPES: Record<string, string> = { js: 'text/javascript', wasm: 'application/wasm', txt: 'text/plain' };

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
