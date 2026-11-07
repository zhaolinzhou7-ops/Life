/**
 * 残局下到底的裁判和对局是同一套棋规（endings.ts 的 drawOrForfeit）。
 *
 * 用户截图：你领先一个车，对方的车贴着帅一路将军，帅只能四进一、四退一来回躲，
 * 第三次重复原来判"走成和棋了 · 多子没赢下来"。按棋规是对方长将判负——你赢。
 *   1. 对方长将：判对方负，你赢
 *   2. 要赢的局面来回走：第三次重复不管落在谁那一手，都先提醒；再点一次才走，走了判和
 * 用法：npm run dev，然后 node tests/ui/playout-rules.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE + '?app=xiangqi', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/** 在页面里开一局残局下到底 */
const open = (fen, target) =>
  page.evaluate(async ([fen, target]) => {
    document.querySelectorAll('.xq-test-host').forEach((e) => e.remove());
    const host = document.createElement('div');
    host.className = 'xq-test-host screen';
    document.body.appendChild(host);
    const P = await import('/Life/src/xiangqi/playout.ts');
    window.__done = null;
    // 对手停着，由测试替它走
    window.__xqHoldOpp = true;
    P.runPlayout(host, {
      fen,
      you: 'r',
      target,
      title: '残局下到底',
      subtitle: '测试',
      tips: [],
      onDone: (r) => { window.__done = r; },
      onExit: () => {},
    });
  }, [fen, target]);
const until = async (fn, arg, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(150); }
  return false;
};
const myTurn = () => until(() => window.__xqPlay && window.__xqPlay.state().turn === 'r' && !window.__xqPlay.state().busy && !window.__xqPlay.state().over);
const oppTurn = () => until(() => window.__xqPlay && window.__xqPlay.state().turn === 'b' && !window.__xqPlay.state().over);

// ── 1. 对方长将：你赢 ──
await open('4k4/3P1R3/9/9/9/9/9/9/4r4/5K3 b', 'win');
const checks = [{ fx: 4, fy: 8, tx: 4, ty: 9 }, { fx: 4, fy: 9, tx: 4, ty: 8 }];
const kings = [{ fx: 5, fy: 9, tx: 5, ty: 8 }, { fx: 5, fy: 8, tx: 5, ty: 9 }];
for (let i = 0; i < 6; i++) {
  if (await page.evaluate(() => window.__xqPlay.state().over)) break;
  await oppTurn();
  await page.evaluate((m) => window.__xqPlay.oppPlay(m), checks[i % 2]);
  await page.waitForTimeout(500);
  if (await page.evaluate(() => window.__xqPlay.state().over)) break;
  await myTurn();
  await page.evaluate((m) => window.__xqPlay.play(m), kings[i % 2]);
  await page.waitForTimeout(500);
}
await until(() => window.__xqPlay.state().over, null, 5000);
const res1 = await page.locator('.xq-po-result').innerText().catch(() => '');
console.log('   结果：' + res1.replace(/\s+/g, ' ').slice(0, 90));
ok('对方一直将军、第三次重复：判对方长将负，你赢了', /赢了/.test(res1) && /长将/.test(res1) && /对方判负/.test(res1));
ok('记成赢（不是"多子没赢下来"）', (await page.evaluate(() => window.__done)) === 'win' && !/多子没赢下来/.test(res1));
await page.screenshot({ path: `${OUT}/playout-perpetual.png` });

// ── 2. 要赢的局面，来回走成三次重复：先提醒 ──
// 红车来回平、黑将来回走（谁都不将军）。第三次回到开头那个局面落在黑方那一手上，
// 所以红方走前一手（车平回原位）就要提醒："对方一走回去……判和"
await open('3k5/9/9/9/9/9/9/9/4R4/5K3 w', 'win');
const myShuffle = [{ fx: 4, fy: 8, tx: 0, ty: 8 }, { fx: 0, fy: 8, tx: 4, ty: 8 }];
const oppShuffle = [{ fx: 3, fy: 0, tx: 3, ty: 1 }, { fx: 3, fy: 1, tx: 3, ty: 0 }];
const tapMove = (m) => page.evaluate((m) => { window.__xqPlay.tap(m.fx, m.fy); window.__xqPlay.tap(m.tx, m.ty); }, m);
let warned = '';
let warnedAt = -1;
let stillMine = false;
for (let i = 0; i < 6; i++) {
  await myTurn();
  const m = myShuffle[i % 2];
  // 用点的方式走（会经过提醒那一关）
  await tapMove(m);
  await page.waitForTimeout(300);
  const fb = (await page.evaluate(() => window.__xqPlay.feedback())) ?? '';
  if (/按规则判和/.test(fb)) {
    warned = fb;
    warnedAt = i;
    stillMine = (await page.evaluate(() => window.__xqPlay.state().turn)) === 'r';
    break;
  }
  await oppTurn();
  await page.evaluate((m) => window.__xqPlay.oppPlay(m), oppShuffle[i % 2]);
  await page.waitForTimeout(500);
}
console.log(`   提醒（第 ${warnedAt + 1} 手）：` + warned.slice(0, 80));
ok('要赢的局面，走成三次重复之前先提醒"按规则判和"', !!warned);
ok('提醒的时候没有直接走', stillMine);
await page.screenshot({ path: `${OUT}/playout-repeat-warn.png` });
// 坚持要走：再点一次照走；对方走回去，第三次重复，判和
if (warned) {
  await tapMove(myShuffle[warnedAt % 2]);
  await page.waitForTimeout(400);
  ok('再点一次就照走', (await page.evaluate(() => window.__xqPlay.state().turn)) === 'b');
  await oppTurn();
  await page.evaluate((m) => window.__xqPlay.oppPlay(m), oppShuffle[warnedAt % 2]);
  await until(() => window.__xqPlay.state().over, null, 5000);
  const res2 = await page.locator('.xq-po-result').innerText().catch(() => '');
  console.log('   结果：' + res2.replace(/\s+/g, ' ').slice(0, 90));
  ok('对方走回去：三次重复判和', /三次重复/.test(res2) && (await page.evaluate(() => window.__done)) === 'draw');
}

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
