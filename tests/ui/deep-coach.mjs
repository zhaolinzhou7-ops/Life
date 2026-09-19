/**
 * 教练深度解读的浏览器验证。
 * 摆一个送车的局面，点「为什么？」，检查回答是不是真的从全局讲的。
 * 用法：npm run dev，然后 node tests/ui/deep-coach.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type()==='error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(800);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(500);
await page.getByText('教学提示').first().click(); await page.waitForTimeout(200);
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(2500);

// 红车走过去就被黑车白吃
await page.evaluate(f => window.__xq.setBoard(f), '4k4/4r4/9/9/9/9/4R4/9/9/4K4 w');
await page.waitForTimeout(400);
await page.evaluate(() => { window.__xq.tap(4,6); window.__xq.tap(4,4); });
await page.waitForTimeout(900);
ok('弹出教练提示条', await page.locator('.xq-tip').count() > 0);
await page.locator('[data-act="why"]').click();
// 深度解读要跑搜索，等结果出来
for (let i=0;i<40;i++){ const t = await page.locator('.xq-tip-why').textContent(); if (t && t.includes('这一步在做什么')) break; await page.waitForTimeout(500); }
const why = (await page.locator('.xq-tip-why').textContent()) ?? '';
console.log('\n--- 教练的回答 ---\n' + why.slice(0, 700) + '\n---\n');
ok('讲了这一步在做什么', why.includes('这一步在做什么'));
ok('讲了全局的即时变化', why.includes('即时的变化'));
ok('给了更好的选择', why.includes('更好的选择'));
ok('讲了这个阶段的通用道理', why.includes('通用道理'));
ok('回答足够长（不是一句话打发）', why.length > 200);
await page.screenshot({ path: `${OUT}/deep-why.png` });

await b.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errs.length ? errs.join('\n') : '无');
process.exit(errs.length ? 1 : 0);
