/**
 * 私教：学棋首页有入口；没有任何数据时上见面课；有复盘过的实战就按证据排课、讲三条要点；
 * 上了一步打勾；下节课先检查作业（之后的实战里毛病少了没有）。
 * 用法：npm run dev，然后 node tests/ui/tutor.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

/** 象棋首页的"私教"卡片进私教；再点"返回"到学棋首页 */
const openTutor = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
  await page.locator('.xq-home-card', { hasText: '私教' }).first().click(); await page.waitForTimeout(700);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
};
const openCoach = async () => {
  await openTutor();
  await page.locator('.xq-tutor button.ghost', { hasText: '返回' }).first().click(); await page.waitForTimeout(500);
};

// ───────── 1. 第一次见面：见面课 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-power', 'save'); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
ok('象棋首页有私教入口', (await page.locator('.xq-home-card', { hasText: '私教' }).count()) === 1);
await openCoach();
const card = page.locator('.home-card', { hasText: '私教' }).first();
ok('学棋首页第一张就是私教', (await page.locator('.home-card').first().innerText()).includes('私教'));
ok('没有任何数据：首页写着"见面课"', (await card.innerText()).includes('见面课'));
await card.click(); await page.waitForTimeout(400);
const intro = (await page.locator('.xq-tutor').innerText()).replace(/\s+/g, ' ');
console.log('   见面课：' + intro.slice(0, 160));
ok('见面课：先测评、再下一盘', (await page.locator('[data-tutor-lesson="intro"]').count()) === 1 && intro.includes('水平测评') && intro.includes('下一盘'));
await page.screenshot({ path: OUT + '/tutor-intro.png', fullPage: true });

// ───────── 2. 有复盘过的实战：按证据排课 ─────────
await page.evaluate(() => {
  const now = Date.now();
  const g = (i, tags) => ({ id: 'g' + i, d: '2026-09-2' + i, ts: now - (i + 1) * 86400000, fen: 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w', moves: '', side: 'r', result: 'loss', level: '初级', review: { blunders: 1, mistakes: 2, avgLoss: 90, tags } });
  localStorage.setItem('xq-archive', JSON.stringify([g(0, { greedy: 2, hang: 1 }), g(1, { greedy: 1 }), g(2, { greedy: 2, 'missed-threat': 1 })]));
});
await openCoach();
ok('首页私教卡片写着这一课的主题', (await page.locator('.home-card', { hasText: '私教' }).first().innerText()).includes('贪吃'));
await page.locator('.home-card', { hasText: '私教' }).first().click(); await page.waitForTimeout(400);
const les = (await page.locator('[data-tutor-lesson]').innerText()).replace(/\s+/g, ' ');
console.log('   这一课：' + les.slice(0, 200));
ok('按证据排课：最近实战里贪吃最多 → 今天上"吃子先算账"', les.includes('吃子先算账') && les.includes('5 次') && les.includes('3 盘'));
ok('三条要点', (await page.locator('[data-tutor-lesson] li').count()) === 3);
const ev = (await page.locator('[data-tutor-evidence]').innerText()).replace(/\s+/g, ' ');
ok('"私教看到的你"：每种毛病的次数和每盘几次', ev.includes('贪吃') && ev.includes('1.7'));
const steps = await page.locator('[data-tutor-step]').count();
ok('课上的步骤：套路、同类题、带练一盘', steps >= 3 && (await page.locator('.xq-tutor').innerText()).includes('带练一盘'));
await page.screenshot({ path: OUT + '/tutor-lesson.png', fullPage: true });

// 上第一步（邪门布局：你来破解），退出来打勾
const trickStep = page.locator('[data-tutor-step]', { hasText: '龟背炮' }).first();
ok('贪吃这一课配了龟背炮（卒后面藏着炮）', (await trickStep.count()) === 1);
await trickStep.click(); await page.waitForTimeout(500);
ok('点进去就是"你来破解"', await page.evaluate(() => !!window.__xqReplay));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(400);
ok('退出来回到私教，这一步打了勾', (await page.locator('[data-tutor-step]', { hasText: '龟背炮' }).first().innerText()).includes('✅'));
const log = await page.evaluate(() => JSON.parse(localStorage.getItem('xq-tutor') ?? '[]'));
ok('开课记了档：主题、上课前每盘几次', log.length === 1 && log[0].theme === 'greedy' && log[0].before === 1.7);

// ───────── 3. 下节课先检查作业 ─────────
await page.evaluate(() => {
  const log = JSON.parse(localStorage.getItem('xq-tutor'));
  log[0].done = Array.from({ length: log[0].steps }, (_, i) => i);
  log[0].ts = Date.now() - 3600000;
  localStorage.setItem('xq-tutor', JSON.stringify(log));
  const arc = JSON.parse(localStorage.getItem('xq-archive'));
  const g = (i, tags) => ({ ...arc[0], id: 'n' + i, ts: Date.now() - i * 60000, review: { ...arc[0].review, tags } });
  localStorage.setItem('xq-archive', JSON.stringify([g(1, { 'missed-threat': 2 }), g(2, { hang: 1 }), ...arc]));
});
await openCoach();
await page.locator('.home-card', { hasText: '私教' }).first().click(); await page.waitForTimeout(400);
const chk = (await page.locator('[data-tutor-check]').innerText()).replace(/\s+/g, ' ');
console.log('   检查作业：' + chk);
ok('下节课先检查作业：之后 2 盘每盘 0 次，过关', chk.includes('1.7') && chk.includes('过关'));
const les2 = (await page.locator('[data-tutor-lesson]').innerText()).replace(/\s+/g, ' ');
ok('过关了就换下一课（不再是贪吃）', !les2.includes('吃子先算账'));
await page.screenshot({ path: OUT + '/tutor-check.png', fullPage: true });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
