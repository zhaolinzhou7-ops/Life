/**
 * 做题的两道防线。
 *
 * 用户截图（测评 · 残局"找出杀棋"）：题目局面里黑将已经被红车照着、却轮到红方走——第一手把将吃了，还判"不对"。
 *   1. 局面在真实对局里出不来（不该走的一方正被将军）：不出这道题，直接跳过
 *   2. 不是原谱那一手、但直接把对方将死了：当场算对，不用等皮卡鱼（皮卡鱼没起来时原来只认原谱）
 * 用法：npm run dev，然后 node tests/ui/puzzle-guard.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE + '?app=xiangqi', { waitUntil: 'networkidle' });
await page.waitForTimeout(500);

/** 在页面里开一道题 */
const open = (puzzle) =>
  page.evaluate(async (puzzle) => {
    document.querySelectorAll('.xq-test-host').forEach((e) => e.remove());
    const host = document.createElement('div');
    host.className = 'xq-test-host screen';
    document.body.appendChild(host);
    const T = await import('/Life/src/xiangqi/train.ts');
    window.__res = null;
    T.runPuzzle(host, puzzle, { caption: '测试', onDone: (r) => { window.__res = r; }, onExit: () => {} });
  }, puzzle);
const until = async (fn, ms = 15000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(150); }
  return false;
};

// ── 1. 截图那道题：黑将被红车照着、却轮到红走 ──
await open({ id: 't-bad', kind: 'endgame', goal: 'mate', fen: '3a1ab2/9/2R2k3/9/9/9/5C3/2r6/4K4/9 w', answer: '车七退五', line: ['车七退五'], rating: 1080 });
await page.waitForTimeout(300);
const bad = await page.locator('.xq-tr-bad').innerText().catch(() => '');
console.log('   ' + bad);
ok('局面出不来的题不出：说清楚为什么跳过', /局面有问题/.test(bad) && /正被将军/.test(bad));
ok('没有摆出能吃将的棋盘让人走', (await page.locator('.xq-test-host .xq-tr-board, .xq-test-host canvas').count()) === 0);

// 题库里也没有这种题了（加载时拦一道）
const left = await page.evaluate(async () => {
  const P = await import('/Life/src/xiangqi/puzzles.ts');
  const all = await P.loadPuzzles();
  return { n: all.length, has: all.some((p) => ['endgame-1v', 'endgame-1z', 'endgame-21', 'endgame-25'].includes(p.id)) };
});
ok(`题库（${left.n} 道）里没有截图那几道`, left.n > 1000 && !left.has);

// ── 2. 不是原谱那一手，但直接将死 ──
// 两个车：车九进六、车一进七、车九平六、车一平六都是一步杀，原谱只写了车九进六
await open({ id: 't-mate', kind: 'mate', goal: 'mate', fen: '3k5/9/9/9/9/9/9/R8/8R/4K4 w', answer: '车九进六', line: ['车九进六'], mateIn: 1, rating: 800 });
await until(() => window.__xqTrain && !window.__xqTrain.state().busy);
await page.evaluate(() => window.__xqTrain.play('车一进七'));
await until(() => window.__xqTrain.state().answered, 8000);
const fb = await page.locator('.xq-test-host .xq-tr-fb').innerText().catch(() => '');
console.log('   ' + fb.replace(/\s+/g, ' ').slice(0, 80));
ok('原谱外直接将死：算对', (await page.evaluate(() => window.__xqTrain.state().verdict?.correct)) === true);
ok('当场就说将死，不用等皮卡鱼核对', /将死/.test(fb) && !/正在让皮卡鱼核对/.test(fb));

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
