/**
 * 专业引擎中途倒下（手机内存不够、Worker 崩了）：教练不能两手空空、悄悄退回"只看子力"，
 * 要当场换自带引擎接着算，并且如实说一声。
 * 模拟方法：第一个引擎实例（服务车道）正常；研究车道的实例一开算就崩，之后再起的都报内存不够。
 * 用法：npm run dev，然后 node tests/ui/engine-crash.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(150); }
  return false;
};
const CRASH = `self.onmessage=function(e){var d=e.data||{};if(d.init){self.postMessage({ready:true});return}
  if(d.cmd&&d.cmd.indexOf('go')===0)setTimeout(function(){self.postMessage({crashed:'RuntimeError: memory access out of bounds'})},300)};`;
const OOM = `self.onmessage=function(e){if((e.data||{}).init)self.postMessage({error:'RangeError: Out of memory: Cannot allocate Wasm memory for new instance'})};`;
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
let workers = 0;
await ctx.route('**/pika/pika-worker.js', async (route) => {
  workers++;
  if (workers === 1) return route.continue();
  await route.fulfill({ status: 200, contentType: 'text/javascript', body: workers === 2 ? CRASH : OOM });
});
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'standard'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(300);
await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click();
await until(page, () => window.__xq.turn() === 'r' && !!window.__xq.study(), null, 15000);

ok('研究车道的引擎崩了之后，当场换自带引擎接着算', await until(page, () => window.__xq.engine() === 'local' && (window.__xq.study()?.depth ?? 0) >= 4, null, 20000));
const line = await page.evaluate(() => window.__xq.coachLine());
console.log('   状态行：' + line);
ok('状态行如实写着"自带引擎"', line.includes('自带引擎'));

// 接着下几手：之后再起引擎都报内存不够，连着两次就认定跑不动，之后一直用自带引擎
let toast = '';
for (let i = 0; i < 4; i++) {
  const w0 = Date.now();
  const waited = await until(page, () => window.__xq.turn() === "r" && !window.__xq.state().busy && ((window.__xq.study()?.depth ?? 0) >= 4 || !!window.__xq.study()?.done), null, 30000);
  if (!waited) console.log("   等了 " + (Date.now() - w0) + "ms：" + JSON.stringify(await page.evaluate(() => ({ st: window.__xq.state(), s: window.__xq.study(), line: window.__xq.coachLine() }))));
  const t = await page.evaluate(() => document.querySelector('.xq-toast, .toast')?.textContent ?? '');
  if (t.includes('跑不动')) toast = t;
  const s = await page.evaluate(() => ({ ...window.__xq.study(), engine: window.__xq.engine() }));
  console.log(`   #${i + 1} ${s.engine} depth=${s.depth}`);
  ok(`第 ${i + 1} 手：教练手里有真算出来的结果（${s.engine}，${s.depth} 层）`, (s.depth >= 4 || s.done) && !!s.best);
  await page.evaluate((m) => window.__xq.play(m), s.best);
  await page.waitForTimeout(400);
  if (await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'))) {
    await page.locator('.xq-tip [data-act="go"]').first().click();
  }
  const t2 = await page.evaluate(() => document.querySelector('.xq-toast, .toast')?.textContent ?? '');
  if (t2.includes('跑不动')) toast = t2;
  if (await page.evaluate(() => window.__xq.state().over)) break;
}
const st = await page.evaluate(() => window.__xq.engineStats());
console.log('   引擎统计：' + JSON.stringify(st));
ok('连着起不来就认定跑不动（lost），不再一步一试', st.lost === true);
console.log('   提示：' + toast);
ok('告诉用户换成了自带引擎', toast.includes('自带引擎'));
await page.screenshot({ path: OUT + '/engine-crash.png' });
await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
