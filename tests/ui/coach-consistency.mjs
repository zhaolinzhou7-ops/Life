/**
 * 教练自洽性验证：**照着他推荐的走，他不能反过来说不行。**
 *
 * 这是用户报的最伤信任的一个 bug。根因是报警和推荐原来用了两个不同的裁判
 * （静态兑子 vs 搜索引擎）。改成只用引擎之后，这里把它钉死：
 * 走一手会被拦的棋 → 读出教练推荐的首选 → 撤回 → 照着首选走 → 必须放行。
 *
 * 用法：npm run dev，然后 node tests/ui/coach-consistency.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const note = (m) => console.log('   ' + m);

const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await b.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(800);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(500);
await page.getByText('教学提示').first().click(); await page.waitForTimeout(200);
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(3000);

// 一个红车送到黑车口上的局面
await page.evaluate(f => window.__xq.setBoard(f), '4k4/4r4/9/9/9/9/4R4/9/9/4K4 w');
await page.waitForTimeout(2200);   // 等后台分析跑完

await page.evaluate(() => { window.__xq.tap(4, 6); window.__xq.tap(4, 4); });
await page.waitForTimeout(1000);
ok('送车会被拦下', await page.locator('.xq-tip').count() > 0);

// 读出教练推荐的首选
await page.locator('[data-act="why"]').click();
for (let i = 0; i < 40; i++) {
  const t = await page.locator('.xq-tip-why').textContent();
  if (t && t.includes('引擎首选')) break;
  await page.waitForTimeout(500);
}
const why = (await page.locator('.xq-tip-why').textContent()) ?? '';
const m = why.match(/更好的选择\s*1\.\s*([^\s—]+)/);
const best = m ? m[1] : null;
note('教练推荐的首选：' + (best ?? '（没读到）'));
ok('给出了首选着法', !!best);

// 撤回，照着首选走
await page.locator('[data-act="cancel"]').click();
await page.waitForTimeout(600);
const before = await page.evaluate(() => window.__xq.moves().length);
const played = await page.evaluate((want) => {
  const xq = window.__xq;
  for (const mv of xq.legal()) {
    // 记谱要在**走之前**取：走完之后起点已经空了，再取就是空串
    const txt = xq.textOf(mv);
    if (txt === want) { xq.tap(mv.fx, mv.fy); xq.tap(mv.tx, mv.ty); return txt; }
  }
  return null;
}, best);
note('照着走了：' + (played ?? '（没找到这一手）'));
ok('确实找到并走了推荐的那一手', played === best);
await page.waitForTimeout(1200);
const after = await page.evaluate(() => window.__xq.moves().length);
// 这一条防的是"测试没做事却通过"：没落子的话不报警是理所当然的，证明不了什么
ok('这一手真的落到盘上了（棋谱多了一手）', after > before);
const warnedAgain = await page.locator('.xq-tip').count() > 0;
ok('照着推荐走，教练不再报警（推荐了又说不行 = 已修）', !warnedAgain);
if (warnedAgain) note('又报警了：' + (await page.locator('.xq-tip-text').textContent()));
await page.screenshot({ path: `${OUT}/consistency.png` });

await b.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errs.length ? errs.join('\n') : '无');
process.exit(errs.length ? 1 : 0);
