/**
 * 底部操作按钮在手机上看得到：对局（悔棋/求和/认输/重开）、残局下到底（重来/提和/认输）、
 * 做题（提示/跳过）、打谱（下一手/返回）、残局下完之后的按钮。
 * 用户原话："我打开网页的时候，有时在底下看不到操作按钮，比如重来、继续或者认输。"
 * 手机浏览器的地址栏、底栏会占掉一截，真正能看到的高度只有 550～670 像素，这里按这些高度逐屏量。
 * 用法：npm run dev，然后 node tests/ui/bottom-bars.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

/** 选择器对应的按钮都完整地落在视口里，而且没有被别的东西盖住 */
async function visible(page, sel) {
  return page.evaluate((sel) => {
    const els = [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
    if (!els.length) return { n: 0, bad: ['没找到'] };
    // 页面认为自己能用的高度（模拟工具栏时被压小了）
    const H = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || window.innerHeight;
    const W = window.innerWidth;
    const bad = [];
    for (const e of els) {
      const r = e.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const top = document.elementFromPoint(Math.min(W - 1, Math.max(0, cx)), Math.min(H - 1, Math.max(0, cy)));
      if (r.bottom > H + 0.5 || r.top < 0 || r.height < 18) bad.push(`${e.textContent.trim().slice(0, 6)} 在 ${Math.round(r.top)}-${Math.round(r.bottom)}（屏高 ${H}）`);
      else if (!top || !(e === top || e.contains(top))) bad.push(`${e.textContent.trim().slice(0, 6)} 被盖住`);
    }
    return { n: els.length, bad };
  }, sel);
}

/**
 * 模拟手机浏览器的工具栏盖住底部 90 像素：可见高度变小（visualViewport 触发 resize，页面按它重排），
 * 再量一遍。量完恢复。
 */
async function toolbar(page, sel) {
  await page.evaluate(() => document.documentElement.style.setProperty('--app-h', `${window.innerHeight - 90}px`));
  await page.waitForTimeout(250);
  const r = await visible(page, sel);
  await page.evaluate(() => document.documentElement.style.setProperty('--app-h', `${window.innerHeight}px`));
  await page.waitForTimeout(150);
  return r;
}

const SIZES = [
  [375, 548], // iPhone SE / 8 + Safari 地址栏和底栏
  [360, 560], // 常见安卓 + 浏览器栏
  [390, 664], // iPhone 13/14 + Safari
  [414, 715],
];

for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(`${w}x${h} pageerror: ${e.message}`));
  const tag = `${w}×${h}`;

  // 1. 对局
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('xq-power', 'save'));
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="play"]').click(); await page.waitForTimeout(300);
  await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
  await page.getByText('执红先行').first().click();
  await page.getByText('开始对弈').first().click(); await page.waitForTimeout(1200);
  let r = await visible(page, '.xq-bar .xq-btn');
  ok(`${tag} 对局：悔棋/求和/认输/重开都看得到 ${r.bad.join('；')}`, r.n === 4 && !r.bad.length);
  r = await toolbar(page, '.xq-bar .xq-btn');
  ok(`${tag} 对局：浏览器底栏盖住 90 像素时也看得到 ${r.bad.join('；')}`, r.n === 4 && !r.bad.length);
  await page.screenshot({ path: `${OUT}/bars-game-${w}x${h}.png` });

  // 2. 残局下到底（实用残局第一组第一个局面）
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(600);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(500); }
  await page.evaluate((m) => window.__xqCoach.menu(m), 'endgame'); await page.waitForTimeout(300);
  await page.locator('.xq-coach .card', { hasText: '实用残局' }).first().click(); await page.waitForTimeout(900);
  await page.evaluate(() => window.__xqCoach?.endgame?.());
  await page.waitForTimeout(900);
  if (await page.locator('.xq-po').count()) {
    r = await visible(page, '.xq-po-acts .xq-btn');
    ok(`${tag} 残局下到底：重来/提和/认输看得到 ${r.bad.join('；')}`, r.n >= 3 && !r.bad.length);
    r = await toolbar(page, '.xq-po-acts .xq-btn');
    ok(`${tag} 残局下到底：浏览器底栏盖住 90 像素时也看得到 ${r.bad.join('；')}`, r.n >= 3 && !r.bad.length);
    // 展开要领（最容易把下面挤出去）
    const tg = page.locator('.xq-po-tip-toggle');
    if (await tg.count()) { await tg.click(); await page.waitForTimeout(200); }
    r = await visible(page, '.xq-po-acts .xq-btn');
    ok(`${tag} 残局下到底：展开要领之后按钮还在 ${r.bad.join('；')}`, r.n >= 3 && !r.bad.length);
    // 认输 → 结果栏的按钮（再来一次 / 下一个）
    await page.locator('.xq-po-acts [data-act="resign"]').click(); await page.waitForTimeout(500);
    r = await visible(page, '.xq-po-btns .xq-btn');
    ok(`${tag} 残局结束：再来一次/下一个看得到 ${r.bad.join('；')}`, r.n >= 2 && !r.bad.length);
    await page.screenshot({ path: `${OUT}/bars-po-${w}x${h}.png` });
  } else ok(`${tag} 进得了残局下到底`, false);

  // 3. 做题（专项练习·杀法）
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(600);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(500); }
  await page.evaluate((m) => window.__xqCoach.menu(m), 'tactics'); await page.waitForTimeout(300);
  await page.locator('.xq-coach .card', { hasText: '杀法' }).first().click(); await page.waitForTimeout(1500);
  r = await visible(page, '.xq-tr-bar .xq-btn');
  ok(`${tag} 做题：底下的按钮看得到 ${r.bad.join('；')}`, r.n >= 1 && !r.bad.length);
  r = await toolbar(page, '.xq-tr-bar .xq-btn');
  ok(`${tag} 做题：浏览器底栏盖住 90 像素时也看得到 ${r.bad.join('；')}`, r.n >= 1 && !r.bad.length);
  await page.screenshot({ path: `${OUT}/bars-tr-${w}x${h}.png` });

  // 4. 打谱（布局讲解）
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(600);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(500); }
  await page.evaluate((m) => window.__xqCoach.menu(m), 'opening'); await page.waitForTimeout(300);
  await page.getByText('📖 布局体系').first().click(); await page.waitForTimeout(400);
  await page.locator('[data-opening="pfm-niutougun"]').click(); await page.waitForTimeout(300);
  await page.locator('[data-act="op-watch"]').click(); await page.waitForTimeout(400);
  for (let i = 0; i < 12; i++) { await page.locator('#rp-next').click(); await page.waitForTimeout(40); }
  r = await visible(page, '.xq-rp-bar .xq-btn');
  ok(`${tag} 打谱：下一手/返回看得到 ${r.bad.join('；')}`, r.n >= 1 && !r.bad.length);
  await page.screenshot({ path: `${OUT}/bars-rp-${w}x${h}.png` });
  // 讲到底：走完了那段总结（局面判断 + 几个容易踩的坑）很长，按钮原来被挤出屏幕（用户截图）
  for (let i = 0; i < 80 && (await page.locator('#rp-next').count()); i++) { await page.locator('#rp-next').click(); await page.waitForTimeout(20); }
  r = await visible(page, '.xq-rp-bar .xq-btn');
  ok(`${tag} 打谱走完了：再看一遍/返回看得到 ${r.bad.join('；')}`, r.n >= 2 && !r.bad.length);
  r = await toolbar(page, '.xq-rp-bar .xq-btn');
  ok(`${tag} 打谱走完了：浏览器底栏盖住 90 像素时也看得到 ${r.bad.join('；')}`, r.n >= 2 && !r.bad.length);
  const sayScroll = await page.evaluate(() => { const e = document.querySelector('.xq-rp-say'); return e.scrollHeight <= e.clientHeight + 2 || getComputedStyle(e).overflowY === 'auto'; });
  ok(`${tag} 打谱走完了：总结长了就在框里滚，不会被裁掉`, sayScroll);
  await page.screenshot({ path: `${OUT}/bars-rp-end-${w}x${h}.png` });
  await ctx.close();
}

console.log(errs.length ? `\n✗ ${errs.length} 项不通过：\n  ${errs.join('\n  ')}` : '\n全部通过');
await browser.close();
process.exit(errs.length ? 1 : 0);
