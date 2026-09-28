/**
 * 长对局：全力档下 40 多手，教练的研究每一手都要真的在算（专业引擎、层数往上涨），
 * 不能下到后面就不算了、悄悄退回静态判断。
 * 用法：npm run dev，然后 node tests/ui/long-game.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const PLIES = Number(process.env.PLIES || 44);
const THINK = Number(process.env.THINK || 2500);
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(150); }
  return false;
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'max'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(300);
await page.locator('.diff-row .card', { hasText: process.env.LEVEL || '特级大师' }).first().click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click();
ok('专业引擎加载', await until(page, () => window.__xq.engine() === 'pro', null, 15000));

const log = [];
let bad = 0;
for (let i = 0; i < PLIES; i++) {
  const got = await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy && !!window.__xq.study(), null, 30000);
  if (!got) { const st = await page.evaluate(() => ({ turn: window.__xq.turn(), st: window.__xq.state(), line: window.__xq.coachLine?.() })); console.log('   卡住：', JSON.stringify(st)); break; }
  if (await page.evaluate(() => window.__xq.state().over)) break;
  const t0 = Date.now();
  await page.waitForTimeout(THINK);
  const s = await page.evaluate(() => ({ ...window.__xq.study(), engine: window.__xq.engine(), mem: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : 0 }));
  const row = `#${i + 1} ${s.engine} depth=${s.depth} done=${s.done} score=${s.score} mem=${s.mem}MB`;
  log.push(row);
  console.log('   ' + row);
  if (s.engine !== 'pro' || s.depth < 10) bad++;
  const mv = s.best;
  if (!mv) { console.log('   没有最佳着法'); break; }
  await page.evaluate((m) => window.__xq.play(m), mv);
  await page.waitForTimeout(250);
  if (await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'))) {
    await page.locator('.xq-tip [data-act="go"]').first().click();
  }
  if (await page.evaluate(() => window.__xq.state().over)) { console.log('   棋局结束'); break; }
  void t0;
}
const st = await page.evaluate(() => window.__xq.engineStats());
console.log('   引擎统计：' + JSON.stringify(st));
ok(`每一手教练都用专业引擎算到 10 层以上（不达标 ${bad} 手）`, bad === 0);
// 以前每一手都掐掉研究的 Worker 重起一个（每个 256MB），手机上下到后面就起不来了
ok('整盘棋研究只起了一个引擎实例，没有反复掐掉重起', st.spawned.study === 1 && st.killed.study === 0 && !st.lost);
ok('至少下了 20 手', log.length >= 20);
await page.screenshot({ path: OUT + '/long-game.png' });
await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
