/**
 * 计划：求助面板里有"计划"和"对方的想法"，教练拦棋时说更好的一手和思路，
 * 复盘每一手有思路，进入残局时教练说这是什么残局。
 * 用法：npm run dev，然后 node tests/ui/plan.mjs
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
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'save'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(400);
await page.getByText('执红先行').first().click(); await page.waitForTimeout(150);
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(1200);
await until(page, () => window.__xq.engine() === 'pro', null, 15000);

// ───────── 1. 中局：对方有威胁，求助面板里要有计划和"对方的想法" ─────────
// 黑车捉红马（马没有根）：让对方连走一步他就吃马
const FEN = 'rnbakabn1/9/1c5c1/p1p1p1p1p/6r2/9/P1P1P3P/1C4NC1/9/RNBAKAB1R w';
ok('摆局面', await page.evaluate((f) => window.__xq.setBoard(f), FEN));
await until(page, () => (window.__xq.study()?.depth ?? 0) >= 10, null, 20000);
await page.locator('#xq-best').click();
ok('求助面板里有计划', await until(page, () => !!document.querySelector('.xq-besthint .xq-plan'), null, 10000));
ok('求助面板里有"对方的想法"', await until(page, () => !!document.querySelector('.xq-besthint .xq-tip-threat'), null, 10000));
const panel = (await page.locator('.xq-besthint').innerText()).replace(/\s+/g, ' ');
console.log('   面板：' + panel.slice(0, 260));
ok('对方的想法说出了要吃你的马', /吃你的马/.test(await page.locator('.xq-besthint .xq-tip-threat').innerText()));
await page.screenshot({ path: OUT + '/plan-hint.png' });
await page.locator('.xq-besthint [data-act="close"]').click();

// 教练状态行：研究够深之后，大的威胁会提前说
const line = await page.evaluate(() => window.__xq.coachLine());
console.log('   状态行：' + line);

// ───────── 2. 残局：进入残局时说这是什么残局 ─────────
ok('摆残局', await page.evaluate((f) => window.__xq.setBoard(f), '2bakab2/9/9/9/9/9/9/3R5/9/5K3 w'));
await page.waitForTimeout(500);
const eg = await page.evaluate(() => window.__xq.coachLine());
console.log('   残局：' + eg);
ok('进入残局：说出车对士象全、书上例和', eg.includes('车对士象全') && eg.includes('例和'));
await until(page, () => (window.__xq.study()?.depth ?? 0) >= 10, null, 20000);
await page.locator('#xq-best').click();
ok('求助面板里有残局卡片', await until(page, () => !!document.querySelector('.xq-besthint .xq-egcard'), null, 10000));
const card = await page.locator('.xq-besthint .xq-egcard').innerText();
console.log('   残局卡片：' + card.replace(/\s+/g, ' '));
ok('残局卡片说破"多子不等于能赢"', card.includes('多子不等于能赢'));
await page.screenshot({ path: OUT + '/plan-endgame.png' });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
