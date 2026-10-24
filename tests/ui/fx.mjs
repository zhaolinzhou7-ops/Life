/**
 * 对局特效：开局棋盘转平、棋子落下、"开局"印章；吃子碎开；吃车"吃车"大字 + 响亮的一声；
 * 将军光线 + "将军"大字；绝杀老将倒下 + "绝""杀"两个字、演完才出结果页；悔棋把特效收掉；
 * 样式页里能关掉，关了就不演。吃车的声音比吃兵响，而且不削波。
 * 配音：开局喊"开局"、炮打马喊"吃马"、吃车喊"吃车"、将军喊"将军"、绝杀喊"绝杀"（男声，默认）。
 * 吃子托盘去掉了。
 * 用法：npm run dev，然后 node tests/ui/fx.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
// 出场人物（四秒多的过场）另有 hero.mjs 测，这里直接开局
await page.addInitScript(() => { try { if (!localStorage.getItem('xq-hero')) localStorage.setItem('xq-hero', 'off'); } catch { /* 无痕模式 */ } });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const until = async (fn, arg, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(80); }
  return false;
};
const fx = () => page.evaluate(() => document.querySelector('.xq-boardwrap')?.dataset.fx ?? '');
const words = () => page.evaluate(() => [...document.querySelectorAll('.xq-fx-word')].map((e) => e.textContent).join(''));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-power', 'save'); localStorage.setItem('xq-side', 'r'); localStorage.setItem('xq-tempo', '0'); localStorage.setItem('xq-hint-level', '0'); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(400);
await page.getByText('开始对弈').first().click();

// ───────── 开局 ─────────
await page.waitForTimeout(250);
ok('开局：棋盘在转平（3D 倾斜动画）', await page.evaluate(() => document.querySelector('.xq-boardwrap canvas.xq-b2d')?.classList.contains('xq-fx-tilt')));
ok('开局：棋子正在落下来', (await page.locator('.xq-boardwrap canvas.xq-b2d').first().getAttribute('data-intro')) === '1');
ok('开局：标记 opening', (await fx()) === 'opening');
await page.waitForTimeout(250);
await page.screenshot({ path: OUT + '/fx-opening.png' });
ok('开局："开局"印章翻过来', await until(() => !!document.querySelector('.xq-fx-seal'), null, 2500));
await page.screenshot({ path: OUT + '/fx-seal.png' });
ok('入场演完，棋子都落定', await until(() => !document.querySelector('.xq-boardwrap canvas.xq-b2d')?.dataset.intro, null, 3000));
const said = (name, ms = 4000) => until((n) => document.documentElement.dataset.xqSaid === n, name, ms);
ok('开局：喊一声"开局！"', await said('m-kaiju'));
ok('吃子托盘（我丢了几个子、对方丢了几个子）去掉了', await page.evaluate(() => !document.querySelector('.xq-tray-row')));
await until(() => window.__xq?.turn() === 'r' && !window.__xq.state().busy, null, 8000);

// ───────── 吃子：炮二进七吃马 ─────────
await page.evaluate(() => window.__xq.play({ fx: 7, fy: 7, tx: 7, ty: 0 }));
// 走之前教练要先看一眼这一手（一两秒），所以等得久一点
ok('炮打马：吃子特效（被吃的子碎开）', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'capture:H', null, 8000));
ok('炮打马：喊"吃马"', await said('m-chima'));
await page.waitForTimeout(120);
await page.screenshot({ path: OUT + '/fx-capture.png' });

// ───────── 吃车 ─────────
await until(() => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 15000);
await page.evaluate(() => window.__xq.setBoard('3k5/9/9/9/9/r8/9/9/9/R3K4 w'));
await page.waitForTimeout(400);
await page.evaluate(() => window.__xq.play({ fx: 0, fy: 9, tx: 0, ty: 5 }));
ok('吃车：特效标记 capture:R', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'capture:R', null, 8000));
ok('吃车："吃车"两个立体大字砸下来', await until(() => [...document.querySelectorAll('.xq-fx-word')].some((e) => e.textContent === '吃车'), null, 1500));
ok('吃车：喊"吃车"', await said('m-chiche'));
await page.waitForTimeout(200);
await page.screenshot({ path: OUT + '/fx-rook.png' });
ok('吃车：棋盘大震一下', await page.evaluate(() => document.querySelector('.xq-boardwrap canvas.xq-b2d')?.classList.contains('xq-fx-shake-big')));

// ───────── 将军 ─────────
await until(() => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 15000);
// 车六平五将军；黑将还能躲到右边（不是杀）
await page.evaluate(() => window.__xq.setBoard('4k4/9/9/9/9/9/9/9/3R5/3K5 w'));
await page.waitForTimeout(400);
await page.evaluate(() => window.__xq.play({ fx: 3, fy: 8, tx: 4, ty: 8 }));
ok('将军：特效标记 check', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'check', null, 8000));
ok('将军："将军"大字', await until(() => [...document.querySelectorAll('.xq-fx-word')].some((e) => e.textContent === '将军'), null, 1500));
ok('将军：喊"将军"', await said('m-jiangjun'));
await page.waitForTimeout(250);
await page.screenshot({ path: OUT + '/fx-check.png' });
ok('开着特效：不再另外弹"将军！"的小提示', !(await page.evaluate(() => [...document.querySelectorAll('.xq-toast.show')].some((e) => /将军！/.test(e.textContent ?? '')))));

// ───────── 绝杀 ─────────
await until(() => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 15000);
await page.evaluate(() => window.__xq.setBoard('3k5/R8/9/9/9/9/9/9/8R/4K4 w'));
await page.waitForTimeout(400);
await page.evaluate(() => window.__xq.play({ fx: 8, fy: 8, tx: 8, ty: 0 }));
ok('绝杀：特效标记 mate', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'mate', null, 8000));
const t0 = Date.now();
ok('绝杀之前没有结果页', !(await page.evaluate(() => !!document.querySelector('.xq-result'))));
ok('绝杀："绝""杀"两个字一个一个砸下来', await until(() => [...document.querySelectorAll('.xq-fx-word')].map((e) => e.textContent).join('') === '绝杀', null, 2500));
ok('绝杀：喊"绝杀"', await said('m-jiesha'));
await page.screenshot({ path: OUT + '/fx-mate.png' });
ok('绝杀演完才出结果页（两秒多）', await until(() => !!document.querySelector('.xq-result'), null, 6000));
const waited = Date.now() - t0;
console.log(`   绝杀特效开演到结果页：${waited} 毫秒`);
ok('结果页不是马上就出来的（让特效演完）', waited > 2000);
await page.screenshot({ path: OUT + '/fx-result.png' });

// 悔棋：倒下的老将扶起来、大字收掉
await page.evaluate(() => document.querySelector('#xq-undo')?.click());
await page.waitForTimeout(400);
ok('悔棋：特效全收掉', (await words()) === '' && (await fx()) === '');

// ───────── 声音：吃车比吃兵响，不削波 ─────────
const level = async (kind) => page.evaluate(async (kind) => {
  const S = await import('/Life/src/xqsfx.ts');
  const G = await import('/Life/src/gamesfx.ts');
  G.unlockAudio();
  await new Promise((r) => setTimeout(r, 1800));
  if (kind === 'move') S.xqSfxMove();
  else if (kind.startsWith('hero:')) S.xqSfxHero(kind.slice(5));
  else S.xqSfxCapture(kind);
  // 落子、吃子的"嗒"只有几十毫秒，隔 40 毫秒看一眼会漏掉峰值：密一点看
  let peak = 0;
  const t0 = performance.now();
  const span = kind.startsWith('hero:') ? 2800 : 1000;
  while (performance.now() - t0 < span) {
    await new Promise((r) => setTimeout(r, 8));
    const l = G.outputLevel();
    if (l) peak = Math.max(peak, l.peak);
  }
  return peak;
}, kind);
await page.evaluate(async () => (await import('/Life/src/xqmusic.ts')).stopXqMusic());
const pawn = await level('P');
const rook = await level('R');
console.log(`   吃兵峰值 ${pawn.toFixed(3)}，吃车峰值 ${rook.toFixed(3)}`);
ok('吃车那一声比吃兵响得多', rook > pawn * 1.4 && rook > 0.2);
ok('吃车那一声不削波', rook < 0.99);
// 落子"嗒"：一盘棋要听上百次——听得见，但比吃子轻
const move = await level('move');
console.log(`   落子峰值 ${move.toFixed(3)}`);
ok('落子"嗒"听得见、比吃车轻得多', move > 0.03 && move < rook * 0.7);
ok('落子比吃兵轻（吃子是两子相碰，重一点）', move < pawn);
// 出场的锣鼓古筝叠了好几层，最响的那一下也不能削波
for (const h of ['daoke', 'guangong', 'nezha', 'nvxia', 'dasheng']) {
  const pk = await level('hero:' + h);
  console.log(`   出场（${h}）峰值 ${pk.toFixed(3)}`);
  ok(`出场（${h}）的声音出来了、不削波`, pk > 0.1 && pk < 0.99);
}

// ───────── 关掉特效 ─────────
await page.evaluate(() => localStorage.setItem('xq-fx', '0'));
await page.evaluate(() => window.__xq.setBoard('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w'));
await page.waitForTimeout(400);
await until(() => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 15000);
await page.evaluate(() => window.__xq.play({ fx: 7, fy: 7, tx: 7, ty: 0 }));
const moved = await until(() => !window.__xq.fen().startsWith('rnbakabnr'), null, 8000);
await page.waitForTimeout(600);
ok('关了特效：吃子不演', (await fx()) !== 'capture:H');
ok('关了特效：棋照样走（马被吃掉了）', moved);

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
