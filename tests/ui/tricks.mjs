/**
 * 邪门布局破解：学棋里能找到、能看套路和上当、能自己走一遍破解；
 * 对局里选"邪门布局"对手会走套路，教练当场点破并说出破解，破解那一手不拦、求助里以它领衔。
 * 用法：npm run dev，然后 node tests/ui/tricks.mjs
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

// ───────── 1. 学棋：找得到、看得懂、自己破一遍 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-power', 'save'); localStorage.setItem('xq-hint-level', '2'); localStorage.removeItem('xq-tricks-done'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('.xq-home-card').nth(3).click(); await page.waitForTimeout(700);
if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
await page.getByText('🗡 邪门布局破解').first().click(); await page.waitForTimeout(500);
const cards = await page.locator('[data-trick]').count();
console.log(`   套路：${cards} 条`);
ok('专项练习里找得到邪门布局破解，列出了套路', cards >= 8);
await page.locator('[data-trick="hei-pao-zhongbing-check"]').click(); await page.waitForTimeout(300);
const detail = (await page.locator('.xq-coach-report').innerText()).replace(/\s+/g, ' ');
console.log('   详情：' + detail.slice(0, 200));
ok('详情讲了套路、破解、道理和引擎复核', detail.includes('它在赌什么') && detail.includes('马三进五') && detail.includes('引擎复核'));
await page.screenshot({ path: OUT + '/tricks-detail.png' });

// 看上当会怎样
await page.locator('[data-act="trick-trap"]').click(); await page.waitForTimeout(300);
for (let i = 0; i < 8; i++) { const b = page.locator('#rp-next'); if (!(await b.count())) break; await b.click(); await page.waitForTimeout(120); }
const trapSay = await page.locator('.xq-rp-trail').innerText();
ok('上当那一段走得通（走到了垫仕）', trapSay.includes('仕四进五'));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// 你来破解
await page.locator('[data-act="trick-guess"]').click(); await page.waitForTimeout(300);
const trail0 = await page.locator('.xq-rp-trail').innerText();
ok('套路那几手已经摆好（不用你猜）', trail0.includes('炮5进4'));
await page.locator('#rp-next').click(); await page.waitForTimeout(200);
ok('轮到你破解', await page.evaluate(() => window.__xqReplay.waiting()));
await page.evaluate(() => window.__xqReplay.guess('马三进五'));
await page.waitForTimeout(200);
const say1 = await page.evaluate(() => window.__xqReplay.say());
console.log('   你走 马三进五：' + say1.slice(0, 60));
ok('走对了', say1.includes('猜对了'));
for (let i = 0; i < 6; i++) {
  if (await page.evaluate(() => window.__xqReplay.waiting())) {
    await page.evaluate(() => window.__xqReplay.guess('马八进七'));
  } else {
    const b = page.locator('#rp-next');
    if (!(await b.count())) break;
    await b.click();
  }
  await page.waitForTimeout(150);
}
ok('全对之后记为"已破"', await until(page, () => (localStorage.getItem('xq-tricks-done') ?? '').includes('hei-pao-zhongbing-check'), null, 3000));
await page.screenshot({ path: OUT + '/tricks-guess.png' });

// ───────── 2. 对局：对手走邪门布局，教练点破，破解那一手不拦 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(300);
await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
await page.locator('[data-tricky="1"]').click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
ok('设置记住了"邪门布局"', (await page.evaluate(() => localStorage.getItem('xq-tricky'))) === '1');
// 你走 炮二平五、马二进三、车一平二：黑方的四条套路都从这三步里长出来
let hit = '';
for (const t of ['炮二平五', '马二进三', '车一平二']) {
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
  const line = await page.evaluate(() => window.__xq.coachLine());
  if (line.includes('邪门布局')) { hit = line; break; }
  const legal = await page.evaluate(() => window.__xq.legal());
  const mv = await page.evaluate(([ms, tx]) => ms.find((m) => window.__xq.textOf(m) === tx) ?? null, [legal, t]);
  if (!mv) { console.log('   走不了 ' + t + '（对手走出了别的）'); break; }
  await page.evaluate((m) => window.__xq.play(m), mv);
  await page.waitForTimeout(400);
  if (await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'))) await page.locator('.xq-tip [data-act="go"]').first().click();
}
if (!hit) {
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
  hit = await page.evaluate(() => window.__xq.coachLine());
}
console.log('   教练：' + hit);
ok('对手走了邪门套路，教练当场点破并说出破解', hit.includes('邪门布局') && hit.includes('破解'));
await page.screenshot({ path: OUT + '/tricks-game.png' });

// 求助：破解领衔
await until(page, () => (window.__xq.study()?.depth ?? 0) >= 10, null, 20000);
await page.locator('#xq-best').click();
await until(page, () => (document.querySelector('.xq-besthint')?.textContent ?? '').includes('破解'), null, 10000);
const panel = (await page.locator('.xq-besthint').innerText()).replace(/\s+/g, ' ');
console.log('   求助：' + panel.slice(0, 160));
ok('求助里以破解着法领衔', panel.includes('破解「'));
await page.locator('.xq-besthint [data-act="close"]').click();

// 走破解那一手：教练不拦
const name = hit.match(/「(.+?)」/)?.[1];
const refute = await page.evaluate(async (n) => {
  const T = await import('/Life/src/xiangqi/tricks.ts');
  return T.TRICKS.find((t) => t.name === n)?.refute[0].t ?? null;
}, name);
const before = await page.evaluate(() => window.__xq.moves().length);
const mv = await page.evaluate((tx) => window.__xq.legal().find((m) => window.__xq.textOf(m) === tx) ?? null, refute);
await page.evaluate((m) => window.__xq.play(m), mv);
await page.waitForTimeout(600);
const tipped = await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'));
ok(`走破解 ${refute}：教练不拦，直接走了`, !tipped && (await page.evaluate(() => window.__xq.moves().length)) > before);

// 复盘：你那一手标着"破解成功"
await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
await page.locator('#xq-resign').click();
await page.locator('.xq-confirm [data-act="yes"]').click();
await page.waitForTimeout(800);
await page.getByText('复盘这一局').click();
await until(page, (n) => document.querySelectorAll('.xq-rv-item').length > n, before, 60000);
await page.locator('.xq-rv-item').nth(before).click();
await page.waitForTimeout(300);
const rv = (await page.locator('.xq-rv-detail').innerText()).replace(/\s+/g, ' ');
console.log('   复盘：' + rv.slice(0, 120));
ok('复盘里你那一手标着"破解成功"', rv.includes('破解成功'));
await page.locator('.xq-rv-item').nth(before - 1).click();
await page.waitForTimeout(300);
ok('复盘里对方那一手标着邪门布局', (await page.locator('.xq-rv-detail').innerText()).includes('邪门布局'));
await page.screenshot({ path: OUT + '/tricks-review.png' });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
