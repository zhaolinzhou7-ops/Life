/**
 * 取名小程序 · 界面走查。
 *
 * 覆盖单元测试覆盖不到的那一半：真实窗口宽度下会不会错位、长文本会不会把
 * 卡片撑破、加载/空/出错三种状态长什么样、深色模式、AI 网关挂掉时用户看到的
 * 是不是一个空白页。截图写到 OUT 目录，出问题时看图比读日志快。
 *
 * 用法：npm run build && npm run preview，然后 node tests/ui/naming.mjs
 * （和 screens.mjs 一样走 preview 构建；不依赖 DEV 钩子）
 */
import fs from 'fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
fs.mkdirSync(OUT, { recursive: true });
const errors = [];
const results = [];
function check(label, cond, detail = '') {
  results.push({ label, ok: !!cond, detail });
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

// 三种屏幕宽度：最窄的在售机型、主流、大屏
const VIEWPORTS = [
  { name: 'iPhone-SE-320', width: 320, height: 568 },
  { name: 'iPhone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${vp.name}] ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${vp.name}] pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('AI 智能取名', { exact: false }).first().click();
  await page.waitForSelector('.nm-app', { timeout: 5000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-1-home.png` });
  check(`${vp.name} 首页渲染`, await page.locator('.nm-home h1').isVisible());

  // 横向溢出检查
  const overflow = async (tag) => {
    const o = await page.evaluate(() => {
      const el = document.querySelector('.nm-app');
      return { sw: el.scrollWidth, cw: el.clientWidth, bw: document.body.scrollWidth, iw: window.innerWidth };
    });
    check(`${vp.name} ${tag} 无横向溢出`, o.sw <= o.cw + 1 && o.bw <= o.iw + 1, JSON.stringify(o));
  };
  await overflow('首页');

  // 进入表单
  await page.getByRole('button', { name: '开始取名' }).click();
  await page.waitForSelector('.nm-progress');
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-2-form.png` });
  await overflow('表单页');

  // 空姓氏应当被拦住
  await page.getByRole('button', { name: '生成名字' }).click();
  await page.waitForTimeout(150);
  check(`${vp.name} 空姓氏被拦截`, await page.locator('.nm-progress').isVisible());

  // 填写并生成
  await page.locator('.nm-input').first().fill('欧阳');
  await page.getByRole('button', { name: '女孩' }).click();
  await page.locator('textarea.nm-input').fill('希望文雅一点，不要太常见的名字');
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-3-form-filled.png` });
  await page.getByRole('button', { name: '生成名字' }).click();

  // 骨架屏
  await page.waitForSelector('.nm-skel-card', { timeout: 2000 }).catch(() => {});
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-4-loading.png` });

  await page.waitForSelector('.nm-card', { timeout: 10000 });
  await page.waitForTimeout(200);
  const cardCount = await page.locator('.nm-card').count();
  check(`${vp.name} 结果页出候选`, cardCount >= 8, `${cardCount} 个`);
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-5-results.png`, fullPage: true });
  await overflow('结果页');

  // 收藏
  await page.locator('.nm-fav').first().click();
  await page.waitForTimeout(100);
  check(`${vp.name} 收藏生效`, (await page.locator('.nm-fav.on').count()) >= 1);
  await page.locator('.nm-fav').nth(1).click();
  await page.waitForTimeout(100);

  // 详情
  await page.locator('.nm-card').first().click();
  await page.waitForSelector('.nm-detail-hero', { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-6-detail.png`, fullPage: true });
  await overflow('详情页');
  const sections = await page.locator('.nm-section h3').allTextContents();
  check(`${vp.name} 详情页板块齐全`, sections.length >= 7, sections.join('/'));
  check(`${vp.name} 详情页有风险提示`, sections.includes('风险提示'));

  // 收藏页
  await page.locator('.nm-back').click();
  await page.waitForSelector('.nm-card');
  await page.getByRole('button', { name: '收藏' }).first().click();
  await page.waitForSelector('.nm-fav-item', { timeout: 3000 });
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-7-favorites.png`, fullPage: true });
  await overflow('收藏页');

  // 备注
  await page.locator('.nm-note-input').first().fill('妈妈喜欢这个');
  await page.locator('.nm-note-input').first().blur();
  await page.waitForTimeout(150);

  // 对比
  const boxes = page.locator('.nm-pickbox');
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await page.waitForTimeout(120);
  await page.locator('.nm-actionbar .nm-btn').click();
  await page.waitForSelector('.nm-cmp', { timeout: 3000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-8-compare.png`, fullPage: true });
  const rows = await page.locator('.nm-cmp tbody tr').count();
  check(`${vp.name} 对比表行数`, rows >= 8, `${rows} 行`);
  // 对比表是横向滚动容器，页面本身不该溢出
  const bodyOverflow = await page.evaluate(() => document.body.scrollWidth <= window.innerWidth + 1);
  check(`${vp.name} 对比页无横向溢出`, bodyOverflow);

  // 设置页
  await page.locator('.nm-back').click();
  await page.waitForSelector('.nm-fav-item');
  await page.locator('.nm-back').click();
  await page.waitForSelector('.nm-card');
  await page.locator('.nm-back').click();
  await page.waitForSelector('.nm-progress');
  await page.locator('.nm-back').click();
  await page.waitForSelector('.nm-home', { timeout: 3000 });
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/nm-${vp.name}-9-settings.png`, fullPage: true });
  await overflow('设置页');

  await ctx.close();
}

// —— 长名字 / 长文本压力测试 ——
{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[stress] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[stress] ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('AI 智能取名', { exact: false }).first().click();
  await page.waitForSelector('.nm-app');
  await page.getByRole('button', { name: '开始取名' }).click();
  await page.waitForSelector('.nm-progress');
  await page.locator('.nm-input').first().fill('欧阳');
  await page.locator('textarea.nm-input').fill('我希望这个名字听起来非常文雅'.repeat(14));
  await page.getByRole('button', { name: '生成名字' }).click();
  await page.waitForSelector('.nm-card', { timeout: 10000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/nm-stress-320-longtext.png`, fullPage: true });
  const o = await page.evaluate(() => ({ b: document.body.scrollWidth, w: window.innerWidth }));
  check('长文本 320px 无横向溢出', o.b <= o.w + 1, JSON.stringify(o));
  await ctx.close();
}

// —— 空状态 ——
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[empty] pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('AI 智能取名', { exact: false }).first().click();
  await page.waitForSelector('.nm-app');
  await page.getByRole('button', { name: '我的收藏' }).click();
  await page.waitForSelector('.nm-empty', { timeout: 3000 });
  await page.screenshot({ path: `${OUT}/nm-empty-favorites.png` });
  check('空收藏有空状态和下一步', await page.locator('.nm-empty .nm-btn').isVisible());
  await ctx.close();
}

// —— API 失败降级 ——
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[apifail] pageerror: ${e.message}`));
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('naming-ai-config', JSON.stringify({
    mode: 'remote', endpoint: 'http://127.0.0.1:59999/dead', token: '', model: '', timeoutMs: 3000,
  })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('AI 智能取名', { exact: false }).first().click();
  await page.waitForSelector('.nm-app');
  await page.getByRole('button', { name: '开始取名' }).click();
  await page.waitForSelector('.nm-progress');
  await page.locator('.nm-input').first().fill('周');
  await page.getByRole('button', { name: '生成名字' }).click();
  await page.waitForSelector('.nm-card', { timeout: 15000 });
  await page.waitForTimeout(200);
  const notice = await page.locator('.nm-notice').innerText();
  check('AI 网关挂掉时降级到本地并说明', /本地引擎/.test(notice), notice.slice(0, 90));
  check('AI 失败时仍然出候选', (await page.locator('.nm-card').count()) >= 8);
  await page.screenshot({ path: `${OUT}/nm-api-fallback.png`, fullPage: true });
  await ctx.close();
}

// —— 深色模式 ——
// 合集里其它应用都是深色的，用户系统开着深色模式进来时，这一个不能刺眼，
// 也不能出现浅色文字压浅色底的情况。
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(`[dark] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[dark] ${m.text()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('AI 智能取名', { exact: false }).first().click();
  await page.waitForSelector('.nm-app');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/nm-dark-1-home.png` });

  // 文字和背景的明暗关系必须是反的，不能两边都亮或者两边都暗
  const contrast = await page.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/\d+/g).map(Number);
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    };
    const app = document.querySelector('.nm-app');
    const h1 = document.querySelector('.nm-home h1');
    return { bg: lum(getComputedStyle(app).backgroundColor), fg: lum(getComputedStyle(h1).color) };
  });
  check('深色模式底色够暗', contrast.bg < 0.3, JSON.stringify(contrast));
  check('深色模式文字够亮', contrast.fg > 0.6, JSON.stringify(contrast));

  await page.getByRole('button', { name: '开始取名' }).click();
  await page.waitForSelector('.nm-progress');
  await page.locator('.nm-input').first().fill('周');
  await page.getByRole('button', { name: '女孩' }).click();
  await page.getByRole('button', { name: '生成名字' }).click();
  await page.waitForSelector('.nm-card', { timeout: 10000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/nm-dark-2-results.png` });
  check('深色模式下能出候选', (await page.locator('.nm-card').count()) >= 8);
  await page.locator('.nm-card').first().click();
  await page.waitForSelector('.nm-detail-hero');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/nm-dark-3-detail.png`, fullPage: true });
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length}/${results.length} 项`);
if (failed.length) { console.log('\n未通过：'); failed.forEach((f) => console.log(`  · ${f.label} ${f.detail}`)); }
console.log(`\n控制台错误：${errors.length}`);
errors.slice(0, 10).forEach((e) => console.log('  ! ' + e));
process.exit(failed.length || errors.length ? 1 : 0);
