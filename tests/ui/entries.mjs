/**
 * 首页五个入口的落点走查。
 *
 * 点「今日训练」和「战术训练」如果落在同一个菜单上，用户会以为自己点错了。
 * 这条只有真的点进去才验得出来，所以单独走一遍。
 * 用法：npm run dev，然后 node tests/ui/entries.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errors = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errors.push(n); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const gotoHome = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click();
  await page.waitForTimeout(800);
};

// 先把"自报水平"那一步过掉，否则每个入口都会先被它拦住
await gotoHome();
await page.locator('.xq-home-card').nth(1).click();
await page.waitForTimeout(900);
if (await page.getByText('业 4-5').count()) {
  await page.getByText('业 4-5').first().click();
  await page.waitForTimeout(600);
  const go = page.getByText('开始', { exact: false }).first();
  if (await go.count()) { await go.click(); await page.waitForTimeout(800); }
}

const titleAfter = async (i) => {
  await gotoHome();
  await page.locator('.xq-home-card').nth(i).click();
  await page.waitForTimeout(1200);
  return (await page.locator('h1').first().textContent()) ?? '';
};

const t0 = await titleAfter(0); ok(`开始对弈 → 「${t0}」`, t0.includes('楚河') || t0.includes('对弈'));
const t1 = await titleAfter(1); ok(`今日训练 → 「${t1}」`, t1.includes('今日训练'));
const t3 = await titleAfter(3); ok(`战术训练 → 「${t3}」`, t3.includes('专项练习'));
const t4 = await titleAfter(4); ok(`我的水平 → 「${t4}」`, t4.includes('我的水平'));
const t2 = await titleAfter(2); ok(`棋局复盘 → 「${t2}」`, t2.includes('最近棋局'));
ok('今日训练和战术训练不是同一屏', t1 !== t3);

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
process.exit(errors.length ? 1 : 0);
