/**
 * 专业引擎（Pikafish 皮卡鱼）在真浏览器里的验证。
 *
 * 用户原话："教练太笨了，算的最优解结果是让人家吃子，然后让我的车直接吃士将军，被人家老将吃了。"
 * 拿强引擎当裁判测过：自家引擎在 80 个局面里有 7 手明显失误、2 手大漏（其中一手直接走进杀局）。
 * 这里把那一手大漏钉成回归：换引擎之后教练不能再推荐它，你走了它教练必须拦。
 * 用法：npm run dev，然后 node tests/ui/engine.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(200); }
  return false;
};
async function openGame(page, levelName) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // 省电档（每步 5 秒）：测试要等"算完"，全力档要算好几分钟
  await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'save'); });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(300);
  if (levelName) await page.locator('.diff-row .card', { hasText: levelName }).first().click();
  await page.getByText('执红先行').first().click();
  await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
}

const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
page.on('response', (r) => { if (r.status() >= 400) errs.push(`${r.status()} ${r.url()}`); });
await openGame(page);
ok('专业引擎加载成功', await until(page, () => window.__xq.engine() === 'pro', null, 15000));

// ── 自家引擎走进杀局的那一手：车二进八 ──
const TRAP = '2baka2r/9/n7b/p1p5p/4p4/5nC2/P1P1c1P2/9/1r7/RNBAKABR1 w';
await page.evaluate((f) => window.__xq.setBoard(f), TRAP);
ok('研究算完', await until(page, () => !!window.__xq.study()?.done, null, 15000));
const st = await page.evaluate(() => window.__xq.study());
const bestText = await page.evaluate((m) => window.__xq.textOf(m), st.best);
console.log(`   研究 ${st.depth} 层，最优 ${bestText}`);
ok('专业引擎算得深（≥14 层）', st.depth >= 14);
ok('不再推荐会被将死的"车二进八"', bestText !== '车二进八');
// 状态行平时写着"专业引擎"；这个局面对方有杀着，状态行会换成"对方的威胁"那句话——那也是专业引擎算出来的
const cl = await page.evaluate(() => window.__xq.coachLine());
ok('教练行标着专业引擎（或者正在说对方的威胁）', cl.includes('专业引擎') || cl.includes('对方的威胁'));
// 你偏要走车二进八：教练必须拦，而且说出"杀"
await page.evaluate(() => window.__xq.play({ fx: 7, fy: 9, tx: 7, ty: 1 }));
await until(page, () => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'), null, 8000);
const tip = await page.locator('.xq-tip:not(.xq-besthint):not(.xq-lost) .xq-tip-text').first().textContent().catch(() => '');
console.log('   教练：' + tip);
ok('走车二进八教练拦了，并说出会被杀', /杀/.test(tip ?? ''));
if (!/杀/.test(tip ?? '')) {
  // 排查用：最近几次搜索、当前状态、这一手走没走出去
  console.log('   诊断：' + JSON.stringify(await page.evaluate(() => ({ st: window.__xq.state(), moves: window.__xq.moves().length, line: window.__xq.coachLine(), log: (window.__pikaLog ?? []).slice(-4) }))));
}
await page.screenshot({ path: OUT + '/engine-trap.png' });
await page.locator('.xq-tip [data-act="cancel"]').first().click();

// 求助面板也标着专业引擎
await page.locator('#xq-best').click(); await page.waitForTimeout(400);
const hs = await page.locator('.xq-besthint .xq-tip-status').textContent();
ok('求助面板写明是专业引擎算的', (hs ?? '').includes('专业引擎'));
await page.locator('#xq-best').click();

// ── 切到后台就暂停，回来接着算（全力档一算几分钟，不能在口袋里耗电）──
await page.evaluate(() => localStorage.setItem('xq-power', 'max'));
await page.evaluate(() => window.__xq.setBoard('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w'));
await until(page, () => (window.__xq.study()?.depth ?? 0) >= 12, null, 15000);
const hide = (h) => page.evaluate((v) => {
  Object.defineProperty(document, 'hidden', { value: v, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}, h);
await hide(true);
await page.waitForTimeout(300);
const p1 = await page.evaluate(() => window.__xq.study());
await page.waitForTimeout(2500);
const p2s = await page.evaluate(() => window.__xq.study());
ok('切到后台：研究暂停，层数不再涨', p1.paused && p2s.depth === p1.depth);
await hide(false);
ok('回到前台：接着往深算', await until(page, (d) => !window.__xq.study().paused && window.__xq.study().depth > d, p2s.depth, 20000));
console.log(`   暂停时 ${p1.depth} 层，回来后 ${(await page.evaluate(() => window.__xq.study())).depth} 层`);
await page.evaluate(() => localStorage.setItem('xq-power', 'save'));

// ── 对局一手 + 复盘：复盘也用专业引擎 ──
await page.evaluate(() => window.__xq.setBoard('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w'));
await until(page, () => (window.__xq.study()?.depth ?? 0) >= 8, null, 8000);
await page.evaluate(() => window.__xq.play({ fx: 7, fy: 7, tx: 4, ty: 7 })); // 炮二平五（定式，不拦）
await until(page, () => window.__xq.moves().length >= 2 && window.__xq.turn() === 'r', null, 20000);
await page.locator('#xq-resign').click();
await page.locator('.xq-confirm [data-act="yes"]').click();
await page.waitForTimeout(800);
await page.getByText('复盘这一局').click();
ok('复盘算完', await until(page, () => (document.querySelector('.xq-rv-progress')?.textContent ?? '').includes('共'), null, 30000));
await page.close();

// ── 顶档对手：真的换成专业引擎在走 ──
const p2 = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
p2.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await openGame(p2, '棋王');
await until(p2, () => window.__xq.engine() === 'pro', null, 15000);
await p2.evaluate(() => window.__xq.play({ fx: 7, fy: 7, tx: 4, ty: 7 }));
ok('棋王档对手在合理时间内回了一手', await until(p2, () => window.__xq.moves().length >= 2, null, 20000));
ok('棋王档对手用的是专业引擎', (await p2.evaluate(() => window.__xq.aiEngine())) === 'pro');
await p2.close();

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
