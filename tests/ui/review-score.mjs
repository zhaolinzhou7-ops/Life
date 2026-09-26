/**
 * 复盘与评分：每一手打分、整盘评分、结算页直接出分、复制棋谱、从某一手接着下。
 * 用法：npm run dev，然后 node tests/ui/review-score.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(200); }
  return false;
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'save'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(300);
ok('设置页有"教练算力"', (await page.getByText('教练算力').count()) > 0);
await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click();
ok('专业引擎加载', await until(page, () => window.__xq.engine() === 'pro', null, 15000));

// 照着引擎的首选走几手：棋谱条上应该出现称号标记
for (let i = 0; i < 4; i++) {
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy && (window.__xq.study()?.depth ?? 0) >= 10, null, 20000);
  const best = await page.evaluate(() => window.__xq.study().best);
  await page.evaluate((m) => window.__xq.play(m), best);
  await page.waitForTimeout(300);
  if (await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'))) {
    await page.locator('.xq-tip [data-act="go"]').first().click();
  }
}
await until(page, () => window.__xq.turn() === 'r', null, 20000);
const marks = await page.locator('.xq-log .mk').count();
console.log(`   棋谱条上的称号标记：${marks} 个`);
ok('对局中你的每一手都打上了称号', marks >= 3);
await page.screenshot({ path: OUT + '/rs-live.png' });

// 认输 → 结算页直接出分
await page.locator('#xq-resign').click();
await page.locator('.xq-confirm [data-act="yes"]').click();
await page.waitForTimeout(800);
ok('结算页开始打分', (await page.locator('.xq-score').count()) === 1);
ok('打分完成', await until(page, () => (document.querySelector('.xq-score')?.textContent ?? '').includes('准确率'), null, 60000));
const score = (await page.locator('.xq-score').innerText()).replace(/\s+/g, ' ');
console.log('   结算页：' + score);
await page.screenshot({ path: OUT + '/rs-result.png' });

// 复盘
await page.getByText('复盘这一局').click();
await page.waitForTimeout(600);
const acc = await page.locator('.xq-rv-side.me b').textContent();
console.log('   复盘里你的准确率：' + acc);
ok('复盘直接用结算页那份分析（不重算），准确率已经有了', /^\d+$/.test(acc ?? ''));
ok('优势曲线画出来了', await page.evaluate(() => {
  const c = document.querySelector('.xq-rv-graph');
  return !!c && c.width > 50;
}));
ok('有称号统计', (await page.locator('.xq-rv-chips .xq-rv-chip').count()) > 0);
await page.locator('.xq-rv-item').first().click();
await page.waitForTimeout(200);
const det = (await page.locator('.xq-rv-detail').innerText()).replace(/\s+/g, ' ');
console.log('   单手：' + det.slice(0, 120));
ok('每一手都有分数和局面评价', /\d+ 分/.test(det) && det.includes('局面'));
ok('每一手都讲思路（计划）：不只是一串着法', (await page.locator('.xq-rv-detail .xq-plan').count()) === 1 && det.includes('计划'));
ok('有"深度复盘"', (await page.locator('[data-act="deep-review"]').count()) === 1);
await page.screenshot({ path: OUT + '/rs-review.png' });

// 深度复盘：每手多给几倍时间，重新打分
await page.locator('[data-act="deep-review"]').click();
await page.waitForTimeout(300);
ok('深度复盘开始', ((await page.locator('.xq-rv-progress').textContent()) ?? '').includes('深度'));
ok('深度复盘算完', await until(page, () => (document.querySelector('.xq-rv-progress')?.textContent ?? '').includes('· 深度'), null, 90000));
console.log('   ' + (await page.locator('.xq-rv-progress').textContent()));

// 复制棋谱
await page.locator('[data-act="copy"]').click();
await page.waitForTimeout(300);
const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
console.log('   棋谱：' + clip.split('\n').slice(0, 3).join(' | '));
ok('棋谱复制出来了，带回合号和中文记谱', /1\. .+/.test(clip) && clip.includes('准确率'));

// 从第 2 手（黑方那手之前）接着下
await page.locator('.xq-rv-item').nth(2).click();
await page.waitForTimeout(200);
const want = await page.evaluate(() => {
  // 第 3 手（下标 2）之前的局面：取复盘面板里的那一手，由测试钩子里的着法重放
  return window.__xq.moves().length;
});
void want;
await page.locator('[data-replay]').click();
await page.waitForTimeout(1500);
const st = await page.evaluate(() => ({ n: window.__xq.moves().length, turn: window.__xq.turn(), fen: window.__xq.fen() }));
console.log('   重下：' + JSON.stringify(st));
ok('从那一手之前的局面接着下（轮到红方）', st.turn === 'r' && st.n === 0 && !st.fen.startsWith('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR'));
await page.screenshot({ path: OUT + '/rs-replay.png' });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
