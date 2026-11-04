/**
 * 正式对局和练习分开（src/xiangqi/gamemode.ts），备份 / 恢复进度（src/xiangqi/backup.ts）。
 *
 * 评估里提的：悔棋不限次数（被将死了也能悔）、悔过的棋照样全额算实战分，钟只计时不判负——分数不可信；
 * 进度只在浏览器里、界面上没有备份的按钮。
 *   - 正式对局：没有悔棋、🔍 求助、教练档按钮；限时只算你的时间，每走一步加秒；用完判负；中途退出算认输；计实战分
 *   - 练习：悔棋还在；下完说一声不计实战分
 *   - 刷新以后正式对局还是正式对局，剩的时间接着原来的
 *   - 备份到文件、从文件恢复
 * 用法：npm run dev，然后 node tests/ui/rated.mjs
 */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(200); }
  return false;
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
const page = await ctx.newPage();
await page.addInitScript(() => { try { if (!localStorage.getItem('xq-hero')) localStorage.setItem('xq-hero', 'off'); } catch { /* 无痕模式 */ } });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-hero', 'off'); localStorage.setItem('xq-power', 'save'); });
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
ok('进了象棋，地址带着 ?app=xiangqi（刷新、主屏幕图标直接到象棋）', page.url().includes('app=xiangqi'));
ok('象棋有自己的主屏幕名字和图标', (await page.evaluate(() => !!document.querySelector('link[rel="manifest"][href*="xiangqi"]') && !!document.querySelector('link[rel="apple-touch-icon"]'))));

const myTurn = () => until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 30000);
const playOne = async () => {
  await myTurn();
  const m = await page.evaluate(() => window.__xq.legal()[0]);
  await page.evaluate((mv) => window.__xq.play(mv), m);
  await page.waitForTimeout(300);
};
const openSetup = async () => {
  await page.locator('[data-home="play"]').click(); await page.waitForTimeout(300);
  await page.evaluate(() => { const d = document.querySelector('.xq-lowlv'); if (d) d.open = true; });
  await page.locator('.diff-row .card', { hasText: '第 1 档' }).first().click();
  await page.getByText('执红先行').first().click();
};

// ── 正式对局 · 5 分 + 3 秒 ──
await openSetup();
ok('默认是练习', (await page.locator('[data-rated="0"].selected').count()) === 1);
await page.locator('[data-rated="1"]').click(); await page.waitForTimeout(150);
ok('选了正式对局才出现限时', (await page.locator('[data-tc]').count()) === 4);
await page.locator('[data-tc="1"]').click(); await page.waitForTimeout(150);
ok('正式对局不用选教练档', !(await page.getByText('教练模式', { exact: true }).isVisible().catch(() => false)));
await page.screenshot({ path: `${OUT}/rated-setup.png` });
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
const m0 = await page.evaluate(() => window.__xq.mode());
ok(`正式对局、5 分 + 3 秒（${JSON.stringify(m0)}）`, m0.rated === true && m0.tc === 1 && Math.abs(m0.left - 300000) < 2000);
ok('没有悔棋、🔍 求助、教练档按钮', (await page.locator('#xq-undo:visible, #xq-best:visible, #xq-hint:visible').count()) === 0);
ok('教练那一行说明是正式对局', /正式对局/.test(await page.locator('.xq-coachline').innerText()));
ok('你那一框是倒计时', /^\d+:\d{2}/.test((await page.locator('.xq-mebox .xq-clock').innerText()).trim()));
await myTurn();
const leftBefore = await page.evaluate(() => window.__xq.mode().left);
await playOne();
const leftAfter = await page.evaluate(() => window.__xq.mode().left);
ok(`走一步加 3 秒（${Math.round(leftBefore / 100) / 10} → ${Math.round(leftAfter / 100) / 10} 秒）`, leftAfter > leftBefore + 2000 && leftAfter < leftBefore + 3200);
await page.screenshot({ path: `${OUT}/rated-game.png` });
for (let i = 0; i < 3; i++) await playOne();
// 刷新：还是正式对局，时间接着剩的
await myTurn();
const leftSaved = await page.evaluate(() => window.__xq.mode().left);
await page.reload({ waitUntil: 'networkidle' });
if (await page.getByText('中国象棋', { exact: false }).count()) await page.getByText('中国象棋', { exact: false }).first().click();
await page.waitForTimeout(500);
ok('首页提示有一盘没下完，说明是正式对局、不要了算认输', /正式对局/.test(await page.locator('.xq-resume').innerText()));
await page.locator('.xq-resume [data-act="go"]').click(); await page.waitForTimeout(1000);
const m1 = await page.evaluate(() => window.__xq.mode());
ok(`接着下还是正式对局，时间接着原来的（${Math.round(leftSaved / 1000)} → ${Math.round(m1.left / 1000)} 秒）`, m1.rated && m1.tc === 1 && Math.abs(m1.left - leftSaved) < 4000);
// 超时判负
await myTurn();
await page.evaluate(() => window.__xq.setLeft(1200));
await page.waitForTimeout(2500);
const res = await page.locator('.xq-result').innerText().catch(() => '');
ok('时间用完：超时判负', /超时判负/.test(res));
ok('正式对局计实战分', /实战分/.test(res) && !/不计实战分/.test(res));
await page.screenshot({ path: `${OUT}/rated-timeout.png` });

// ── 正式对局中途退出算认输 ──
await page.goto(BASE + '?app=xiangqi', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await openSetup();
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
for (let i = 0; i < 4; i++) await playOne();
await page.locator('.xq-back').click(); await page.waitForTimeout(300);
ok('中途退出：先问"算认输"', /算认输/.test(await page.locator('.xq-confirm').innerText()));
await page.locator('.xq-confirm [data-act="yes"]').click(); await page.waitForTimeout(1200);
ok('认了输，出结果页', /认输/.test(await page.locator('.xq-result').innerText().catch(() => '')));

// ── 练习：悔棋还在，下完不计分 ──
await page.goto(BASE + '?app=xiangqi', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await openSetup();
await page.locator('[data-rated="0"]').click(); await page.waitForTimeout(150);
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
ok('练习：悔棋、求助都在', (await page.locator('#xq-undo:visible').count()) === 1 && (await page.locator('#xq-best:visible').count()) === 1);
for (let i = 0; i < 5; i++) await playOne();
await page.locator('#xq-resign').click();
await page.locator('.xq-confirm [data-act="yes"]').click(); await page.waitForTimeout(1200);
ok('练习局下完说一声不计实战分', /不计实战分/.test(await page.locator('.xq-result').innerText().catch(() => '')));

// ── 备份 / 恢复 ──
await page.goto(BASE + '?app=xiangqi', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await page.locator('[data-home="backup"]').click(); await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/backup.png` });
const games = Number(await page.locator('.xq-backup-now b').first().innerText());
ok(`备份页说清现在有什么（${games} 盘棋）`, games >= 2);
const [dl] = await Promise.all([page.waitForEvent('download'), page.locator('[data-act="save"]').click()]);
const path = await dl.path();
const text = readFileSync(path, 'utf8');
ok(`备份成文件：${dl.suggestedFilename()}`, /^xiangqi-backup-\d{4}-\d{2}-\d{2}\.json$/.test(dl.suggestedFilename()) && JSON.parse(text).format === 'life-xiangqi-backup');
// 清掉进度，再从文件恢复
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('xq-') && k !== 'xq-hero') localStorage.removeItem(k); });
await page.reload({ waitUntil: 'networkidle' }); await page.waitForTimeout(500);
await page.locator('[data-home="backup"]').click(); await page.waitForTimeout(400);
ok('清掉以后一盘都没有', (await page.locator('.xq-backup-now b').first().innerText()) === '0');
await page.locator('[data-file]').setInputFiles(path); await page.waitForTimeout(400);
ok('恢复前先说清两边各有什么', /用这份备份换掉现在的进度/.test(await page.locator('[data-confirm]').innerText()));
await page.locator('[data-act="restore"]').click();
await page.waitForTimeout(2500);
ok('恢复完重新载入，还在象棋', page.url().includes('app=xiangqi') && (await page.locator('.xq-home-card').count()) >= 3);
await page.locator('[data-home="backup"]').click(); await page.waitForTimeout(400);
ok(`棋局都回来了（${await page.locator('.xq-backup-now b').first().innerText()} 盘）`, Number(await page.locator('.xq-backup-now b').first().innerText()) === games);

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
