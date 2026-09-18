/**
 * 界面冒烟测试：把应用真的跑起来，在四种屏幕宽度下走一遍主要界面。
 *
 * 规格第二十条要求测手机、平板、不同屏幕宽度、空状态。这些在单元测试里
 * 测不到——横向溢出、文字折行、面板挡住棋盘，只有真的渲染出来才看得见。
 *
 * 检查项：控制台报错、页面横向溢出、空状态文案、关键元素存在。
 * 用法：npm run build && npm run preview，然后 node tests/ui/screens.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';

const SIZES = [
  { name: 'phone', w: 390, h: 844 },   // iPhone 14
  { name: 'small', w: 320, h: 640 },   // 最窄的在用机型
  { name: 'tablet', w: 820, h: 1180 }, // iPad Air
  { name: 'desktop', w: 1440, h: 900 },
];

const errors = [];
const report = [];

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

for (const s of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: s.w, height: s.h }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`[${s.name}] console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`[${s.name}] pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 合集首页 → 象棋
  await page.getByText('中国象棋', { exact: false }).first().click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${s.name}-1-home.png` });

  const homeCards = await page.locator('.xq-home-card').count();
  report.push(`[${s.name}] 首页入口数 = ${homeCards}`);

  // 横向溢出检查
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  report.push(`[${s.name}] 首页横向溢出 = ${overflow}px`);
  if (overflow > 2) errors.push(`[${s.name}] 首页横向溢出 ${overflow}px`);

  // 最近棋局（空状态）
  await page.locator('.xq-home-card').nth(2).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${s.name}-2-games.png` });
  const emptyText = await page.locator('.xq-empty').first().textContent().catch(() => null);
  report.push(`[${s.name}] 棋局空状态 = ${emptyText ? emptyText.trim().slice(0, 24) : '（无）'}`);
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov2 > 2) errors.push(`[${s.name}] 最近棋局横向溢出 ${ov2}px`);
  await page.getByText('← 返回').first().click();
  await page.waitForTimeout(400);

  // 我的水平（空状态）
  await page.locator('.xq-home-card').nth(4).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${s.name}-3-level.png`, fullPage: true });
  const prof = await page.locator('.xq-profile-sum').first().textContent().catch(() => null);
  report.push(`[${s.name}] 画像空状态 = ${prof ? prof.trim().slice(0, 30) : '（无）'}`);
  const ov3 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov3 > 2) errors.push(`[${s.name}] 我的水平横向溢出 ${ov3}px`);
  await page.getByText('← 返回').first().click();
  await page.waitForTimeout(400);

  // 对弈设置 → 开局
  await page.locator('.xq-home-card').nth(0).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/${s.name}-4-setup.png`, fullPage: true });
  const hintCards = await page.getByText('教练模式').count();
  report.push(`[${s.name}] 设置页有教练模式 = ${hintCards > 0}`);
  const ov4 = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (ov4 > 2) errors.push(`[${s.name}] 设置页横向溢出 ${ov4}px`);

  await page.getByText('开始对弈').first().click();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/${s.name}-5-board.png` });
  const hud = await page.locator('#xq-hint').textContent().catch(() => null);
  report.push(`[${s.name}] 对局 HUD 教练按钮 = ${hud ?? '（缺）'}`);

  // 走一手会送子的棋，看教练拦不拦（用暴露的测试钩子）
  const coached = await page.evaluate(async () => {
    const xq = window.__xq;
    if (!xq) return 'no-hook';
    // 炮二平五
    xq.tap(1, 7); xq.tap(4, 7);
    await new Promise((r) => setTimeout(r, 2500));
    return document.querySelector('.xq-coach') ? 'prompted' : 'moved';
  });
  report.push(`[${s.name}] 走一手之后 = ${coached}`);
  await page.screenshot({ path: `${OUT}/${s.name}-6-played.png` });

  await ctx.close();
}

await browser.close();
console.log(report.join('\n'));
console.log('\n===== 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
process.exit(errors.length ? 1 : 0);
