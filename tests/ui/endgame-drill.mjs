/**
 * 残局练习：教练一直在算、每一手有反馈、提示给计划、对手可以换、结束有小结。
 * 用法：npm run dev，然后 node tests/ui/endgame-drill.mjs
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

async function openDrill(group) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.setItem('xq-power', 'save'); localStorage.removeItem('xq-po-opp'); });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
  await page.locator('.xq-home-card').nth(3).click(); await page.waitForTimeout(700);
  if (await page.getByText('业 4-5').count()) {
    await page.getByText('业 4-5').first().click(); await page.waitForTimeout(500);
    const go = page.getByText('开始', { exact: false }).first();
    if (await go.count()) { await go.click(); await page.waitForTimeout(700); }
  }
  await page.getByText('实用残局 · 下到底').first().click(); await page.waitForTimeout(800);
  await page.locator('.card', { hasText: group }).first().click(); await page.waitForTimeout(500);
  const guess = page.locator('.xq-eg-guess [data-g="win"]').first();
  if (await guess.count()) { await guess.click(); await page.waitForTimeout(300); }
  await page.locator('.card', { hasText: '局面 1' }).first().click(); await page.waitForTimeout(800);
}

// ───────── 1. 单车对双士：跟着教练的首选走，要赢下来 ─────────
await openDrill('单车对双士');
ok('进了残局练习', (await page.locator('.xq-po').count()) === 1);
ok('你进攻时，默认由专业引擎来守', (await page.evaluate(() => window.__xqPlay.opp().setting)) === 'pro');
ok('教练在算，并按目标说局面（胜势）', await until(page, () => /胜势/.test(window.__xqPlay.coach() ?? '') && (window.__xqPlay.study()?.depth ?? 0) >= 10, null, 20000));
console.log('   教练：' + (await page.evaluate(() => window.__xqPlay.coach())));

// 提示：最好的一手 + 计划
await page.evaluate(() => window.__xqPlay.hint());
await page.waitForTimeout(400);
const hint = await page.locator('.xq-po-fb').innerText();
console.log('   提示：' + hint.replace(/\s+/g, ' ').slice(0, 140));
ok('提示给出最好的一手和计划', hint.includes('最好的一手') && hint.includes('计划'));
await page.screenshot({ path: OUT + '/drill-hint.png' });
await page.evaluate(() => window.__xqPlay.hint());

let fbSeen = '';
for (let i = 0; i < 40; i++) {
  const ready = await until(page, () => {
    const s = window.__xqPlay.state();
    const st = window.__xqPlay.study();
    return s.over || (s.turn === "r" && !s.busy && st && (st.depth >= 10 || st.done));
  }, null, 30000);
  if (!ready) break;
  if (await page.evaluate(() => window.__xqPlay.state().over)) break;
  const best = await page.evaluate(() => window.__xqPlay.study().best);
  await page.evaluate((m) => window.__xqPlay.play(m), best);
  await page.waitForTimeout(700);
  const fb = await page.evaluate(() => window.__xqPlay.feedback());
  if (fb) fbSeen = fb;
}
console.log('   反馈：' + fbSeen.slice(0, 80));
ok('每一手有反馈（走的是首选：好棋）', fbSeen.includes('好棋') || fbSeen.includes('可以'));
ok('跟着首选走，赢下来了', await until(page, () => (document.querySelector('.xq-po-result')?.textContent ?? '').includes('赢了'), null, 30000));
const sum = await page.locator('.xq-po-result').innerText();
console.log('   结果：' + sum.replace(/\s+/g, ' '));
ok('结束有小结（几手最佳、准确率）', sum.includes('准确率'));
ok('对手确实是专业引擎', (await page.evaluate(() => window.__xqPlay.opp().last)) === 'pro');
await page.screenshot({ path: OUT + '/drill-done.png' });

// ───────── 2. 走一手把子送掉：要当场说"胜势走丢了"，能悔棋 ─────────
await openDrill('车兵对士象全');
await until(page, () => (window.__xqPlay.study()?.depth ?? 0) >= 10, null, 20000);
const blunder = await page.evaluate(async () => {
  const R = await import('/Life/src/xiangqi/rules.ts');
  const N = await import('/Life/src/xiangqi/notation.ts');
  const fen = window.__xqPlay.fen?.();
  void fen;
  // 找一手让车被白吃的棋：走完之后对方能吃到这个车（车兵对士象全，丢了车就只剩兵，赢不了）
  for (const m of window.__xqPlay.legal()) {
    const b = window.__xqPlay.board();
    const p = b[m.fy][m.fx];
    if (!p || p.t !== 'R') continue;
    const after = R.applyMove(b, m);
    if (R.legalMoves(after, 'b').some((x) => x.tx === m.tx && x.ty === m.ty)) return { m, text: N.moveToText(b, m) };
  }
  return null;
});
ok('找到一手送车的棋', !!blunder);
console.log('   开局：' + (await page.evaluate(() => window.__xqPlay.coach())));
if (blunder) {
  console.log('   送车：' + blunder.text);
  await page.evaluate((m) => window.__xqPlay.play(m), blunder.m);
  ok('当场说这一手把胜势走丢了', await until(page, () => (window.__xqPlay.feedback() ?? '').includes('胜势走丢'), null, 15000));
  ok('给了"悔棋重走"', (await page.locator('.xq-po-fb [data-act="undo"]').count()) === 1);
  await page.locator('.xq-po-fb [data-act="show"]').click();
  ok('能看正确下法和计划', (await page.locator('.xq-po-fb .more .xq-plan').count()) === 1);
  await page.screenshot({ path: OUT + '/drill-blunder.png' });
  await until(page, () => !window.__xqPlay.state().busy || window.__xqPlay.state().turn === 'r', null, 8000);
  await page.waitForTimeout(600);
  await page.locator('.xq-po-fb [data-act="undo"]').click();
  await page.waitForTimeout(500);
  const st = await page.evaluate(() => window.__xqPlay.state());
  ok('悔棋回到走之前', st.turn === 'r' && st.myMoves === 0);
}

// ───────── 3. 换对手 ─────────
await page.locator('.xq-po-opp').click();
ok('对手换成自带引擎并记住', (await page.evaluate(() => [window.__xqPlay.opp().setting, localStorage.getItem('xq-po-opp')].join())) === 'local,local');
await page.locator('.xq-po-opp').click();

// ───────── 4. 守方练习：不问"能不能赢"；提和引擎同意就算守住；操作条一直在 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('.xq-home-card').nth(3).click(); await page.waitForTimeout(700);
await page.getByText('实用残局 · 下到底').first().click(); await page.waitForTimeout(800);
await page.locator('.card', { hasText: '炮双士守单车' }).first().click(); await page.waitForTimeout(500);
ok('守方练习不问"能赢/只能和"', (await page.locator('.xq-eg-guess').count()) === 0 && (await page.getByText('守和练习').count()) > 0);
await page.locator('.card', { hasText: '局面 1' }).first().click(); await page.waitForTimeout(800);
ok('操作条一直在：重来 / 提和 / 认输', (await page.locator('.xq-po-acts [data-act]').count()) === 3);
await until(page, () => (window.__xqPlay.study()?.depth ?? 0) >= 14 || !!window.__xqPlay.study()?.done, null, 30000);
await page.locator('.xq-po-acts [data-act="draw"]').click();
await page.waitForTimeout(500);
const res4 = ((await page.locator('.xq-po-result').textContent().catch(() => '')) || (await page.evaluate(() => window.__xqPlay.feedback()))).replace(/\s+/g, ' ');
console.log('   提和：' + res4.slice(0, 80));
ok('守和局面提和，引擎同意，算守住', res4.includes('守和成功'));
await page.screenshot({ path: OUT + '/drill-def.png' });

// ───────── 5. 死和局面：连续几步都是和势，引擎提前判和，不用走满 60 回合 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('.xq-home-card').nth(3).click(); await page.waitForTimeout(700);
await page.getByText('实用残局 · 下到底').first().click(); await page.waitForTimeout(800);
await page.locator('.card', { hasText: '单车对马士象全' }).first().click(); await page.waitForTimeout(500);
await page.locator('.card', { hasText: '局面 1' }).first().click(); await page.waitForTimeout(800);
let ended = '';
for (let i = 0; i < 12 && !ended; i++) {
  await until(page, () => {
    const s = window.__xqPlay.state();
    const st = window.__xqPlay.study();
    return s.over || (!s.busy && st && (st.depth >= 14 || st.done));
  }, null, 40000);
  ended = (await page.locator('.xq-po-result').textContent().catch(() => '')) || '';
  if (ended) break;
  const best = await page.evaluate(() => window.__xqPlay.study()?.best);
  if (!best) break;
  await page.evaluate((m) => window.__xqPlay.play(m), best);
  await page.waitForTimeout(600);
  ended = (await page.locator('.xq-po-result').textContent().catch(() => '')) || '';
}
const moves5 = await page.evaluate(() => window.__xqPlay.state().myMoves);
console.log(`   死和：走了 ${moves5} 手，${ended.replace(/\s+/g, ' ').slice(0, 60)}`);
ok('死和局面几步之内提前判和（不用走满 60 回合）', ended.includes('不用再走满') && moves5 <= 8);

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
