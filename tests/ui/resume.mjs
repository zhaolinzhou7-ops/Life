/**
 * 没下完的棋：页面被回收/刷新之后能接着下。
 * 用法：npm run dev，然后 node tests/ui/resume.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(200); }
  return false;
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-hint-level', '0'); localStorage.setItem('xq-power', 'save'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
ok('没有没下完的棋时不显示"继续"', (await page.locator('.xq-resume').count()) === 0);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(300);
await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
for (let i = 0; i < 3; i++) {
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
  const m = await page.evaluate(() => window.__xq.legal()[0]);
  await page.evaluate((mv) => window.__xq.play(mv), m);
  await page.waitForTimeout(300);
}
await until(page, () => window.__xq.turn() === 'r' && window.__xq.moves().length >= 6, null, 20000);
const before = await page.evaluate(() => ({ n: window.__xq.moves().length, fen: window.__xq.fen() }));
// 模拟手机把页面回收：直接刷新
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
ok('首页出现"有一盘没下完"', (await page.locator('.xq-resume').count()) === 1);
console.log('   ' + (await page.locator('.xq-resume').innerText()).replace(/\s+/g, ' '));
await page.locator('.xq-resume [data-act="go"]').click();
await page.waitForTimeout(1000);
const after = await page.evaluate(() => ({ n: window.__xq.moves().length, fen: window.__xq.fen() }));
ok('接着下：着法和局面都回来了', after.n === before.n && after.fen === before.fen);
// 悔棋也能用（历史是重放出来的）
await page.locator('#xq-undo').click();
await page.waitForTimeout(400);
ok('续下的棋能悔棋', (await page.evaluate(() => window.__xq.moves().length)) === before.n - 2);
// 认输之后就不再提示
await page.locator('#xq-resign').click();
await page.locator('.xq-confirm [data-act="yes"]').click();
await page.waitForTimeout(800);
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
ok('下完（认输）之后不再提示继续', (await page.locator('.xq-resume').count()) === 0);
await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
