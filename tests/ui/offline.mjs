/**
 * 断网也能用：联网打开一次之后，断网重开，页面、程序、皮卡鱼都从手机里读。
 *
 * 用户原话："为什么每一次皮卡鱼都加载不了？每次没网的时候就没办法加载，是不是这个原因？"
 * 原来的 service worker（coi-serviceworker）只补跨源隔离的头，所有请求都转去网上，断网全失败。
 *
 * 要用**构建好的版本**测（开发服务器不注册 service worker）：
 *   npm run build && npx vite preview --port 4173，然后 BASE=http://localhost:4173/Life/ node tests/ui/offline.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:4173/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const until = async (fn, ms = 30000) => {
  try {
    await page.waitForFunction(fn, null, { timeout: ms, polling: 250 });
    return true;
  } catch {
    return false;
  }
};

// ───────── 联网：第一次打开 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
ok('注册了 service worker', await until(() => !!navigator.serviceWorker?.controller, 30000));
ok('页面跨源隔离照旧（皮卡鱼叫停要用）', await page.evaluate(() => self.crossOriginIsolated === true));
const stored = await until(async () => {
  const keys = await caches.keys();
  const eng = keys.find((k) => k.startsWith('life-pika-'));
  const core = keys.find((k) => k.startsWith('life-core-'));
  if (!eng || !core) return false;
  const e = await caches.open(eng);
  return !!(await e.match(new URL('pika/pikafish.data', location.href).href)) && (await (await caches.open(core)).keys()).length > 20;
}, 60000);
ok('皮卡鱼（引擎 + 评估网络）和全部程序文件存进了手机', stored);
const sizes = await page.evaluate(async () => {
  let n = 0;
  for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) n += (await (await (await caches.open(k)).match(r)).arrayBuffer()).byteLength;
  return Math.round(n / 1e5) / 10;
});
console.log(`   存了 ${sizes} MB`);

// ───────── 断网重开 ─────────
await ctx.setOffline(true);
await page.goto(BASE, { waitUntil: 'load' });
await page.waitForTimeout(800);
ok('断网：页面照样打开', (await page.getByText('中国象棋', { exact: false }).count()) > 0);
await page.evaluate(() => {
  localStorage.setItem('xq-side', 'b');
  localStorage.setItem('xq-hero', 'off');
  localStorage.setItem('xq-tempo', '0');
});
await page.getByText('中国象棋', { exact: false }).first().click();
await page.waitForTimeout(800);
ok('断网：进得了象棋', (await page.locator('[data-home="play"]').count()) === 1);
const pika = await page.evaluate(async () => {
  const r = await fetch(new URL('pika/pikafish.data', location.href).href);
  return r.ok ? (await r.arrayBuffer()).byteLength : 0;
});
ok(`断网：皮卡鱼的评估网络从手机里读得到（${(pika / 1e6).toFixed(1)} MB）`, pika > 3e6);
await page.locator('[data-home="play"]').click();
await page.waitForTimeout(800);
ok('开局设置写着皮卡鱼"已存在本机，断网也能用"', await until(() => document.body.innerText.includes('已存在本机，断网也能用'), 5000));
await page.getByText('开始对弈').first().click();
// 执黑：对手（红方）先走；皮卡鱼起不来会弹"皮卡鱼没加载起来……自带引擎替补"
const moved = await until(() => document.querySelectorAll('.xq-log .mv, .xq-log span').length > 0 || /炮|马|兵|车|相|仕|帅/.test(document.querySelector('.xq-log')?.textContent ?? ''), 45000);
await page.waitForTimeout(1500);
const toast = await page.evaluate(() => document.body.innerText.includes('皮卡鱼没加载起来'));
ok('断网：对手先走了一步', moved);
ok('断网：对手用的是皮卡鱼（没有"皮卡鱼没加载起来、自带引擎替补"）', moved && !toast);
await page.screenshot({ path: OUT + '/offline-game.png' });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
