/**
 * 私教"今天的任务"走一遍：清单列得出来、一天之内不变、中途退出不打勾、做完一组先看小结再打勾。
 *
 * 用户原话："我希望达到的效果是：每天把私教任务做完，棋艺就能稳步提升；而不是像现在这样总做些重复无效的内容。"
 * 用法：npm run dev，然后 node tests/ui/today.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errors = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errors.push(n); };
const note = (m) => console.log('   ' + m);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) errors.push('console: ' + m.text()); });
const until = async (fn, arg, ms = 15000) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 150 }); return true; } catch { return false; }
};

const hub = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('xq-power', 'save'));
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
};
const tasks = () => page.$$eval('[data-today] .xq-task', (els) => els.map((e) => ({ id: e.dataset.task, done: e.classList.contains('done'), t: e.querySelector('b')?.textContent ?? '' })));
const count = async () => ((await page.locator('[data-today] .hd .n').textContent()) ?? '').trim();

// ── 第一天：还没测过、也没下过棋：先测评、再下一盘 ──
await hub();
let ts = await tasks();
note('第一天：' + ts.map((x) => `${x.id}「${x.t}」`).join(' / '));
ok('第一天只有两项：测评、实战一盘', ts.length === 2 && ts[0].id === 'assess' && ts[1].id === 'game');
ok('按钮写着"开始今天的任务"', ((await page.locator('[data-act="today-go"]').textContent()) ?? '').includes('开始今天的任务'));
await page.locator('[data-act="today-go"]').click(); await page.waitForTimeout(1500);
ok('点开始 → 直接进测评第一题', ((await page.locator('.xq-tr-cap').textContent()) ?? '').includes('测评 1/'));
ok('测评里也能退出', (await page.locator('.xq-tr-quit').count()) === 1);
await page.locator('.xq-tr-quit').click(); await page.waitForTimeout(500);
ok('中途退出回到私教首页，测评没打勾', (await page.locator('[data-task="assess"]').count()) === 1 && (await page.locator('[data-task="assess"].done').count()) === 0);

// ── 测过了：清单换成正式的（错题 / 私教课 / 专项 / 加练 / 实战） ──
await page.evaluate(() => {
  const d = JSON.parse(localStorage.getItem('xq-save'));
  d.assessed = true;
  localStorage.setItem('xq-save', JSON.stringify(d));
  localStorage.removeItem('xq-day-plan');
});
await hub();
ts = await tasks();
note('测过之后：' + ts.map((x) => `${x.id}「${x.t}」`).join(' / '));
ok('有专项练习和实战一盘，三到五项', ts.some((x) => x.id === 'focus') && ts.some((x) => x.id === 'game') && ts.length >= 3 && ts.length <= 5);
ok('没有"认杀法名字"之类的任务', ts.every((x) => !/认杀法|杀法图形|热身/.test(x.t)));
await hub();
const again = await tasks();
ok('同一天再进来，清单一模一样', JSON.stringify(again.map((x) => x.id + x.t)) === JSON.stringify(ts.map((x) => x.id + x.t)));

// 专项：做一题就退出 → 不打勾
await page.locator('[data-task="focus"]').click();
ok('点专项 → 一组 8 道', await until(() => /\b1\/8/.test(document.querySelector('.xq-tr-cap')?.textContent ?? '')));
await page.locator('.xq-tr-quit').click(); await page.waitForTimeout(500);
ok('做到一半退出：回到私教首页，专项没打勾', (await page.locator('[data-task="focus"]').count()) === 1 && (await page.locator('[data-task="focus"].done').count()) === 0);

// 专项：整组做完 → 先看小结，再回清单打勾
await page.locator('[data-task="focus"]').click();
for (let k = 0; k < 12; k++) {
  await until(() => !!document.querySelector('.xq-quiz, .xq-tr, [data-score]'));
  if (await page.locator('[data-score]').count()) break;
  if (await page.evaluate(() => !!document.querySelector('.xq-quiz'))) {
    await page.evaluate(() => window.__xqQuiz.solve()); await page.waitForTimeout(200);
    await page.locator('#xq-quiz-next').click();
  } else {
    for (let i = 0; i < 40; i++) {
      const st = await page.evaluate(() => window.__xqTrain?.state());
      if (!st || st.answered) break;
      if (!st.busy) await page.evaluate(() => window.__xqTrain.playRight());
      await page.waitForTimeout(300);
    }
    if (await page.locator('#xq-tr-giveup').count()) await page.locator('#xq-tr-giveup').click();
    await until(() => !!document.querySelector('#xq-tr-next'), null, 10000);
    await page.locator('#xq-tr-next').click();
  }
  await page.waitForTimeout(400);
}
ok('做完一组先看小结（分数变化）', (await page.locator('[data-score]').count()) === 1);
const btns = await page.locator('.screen button').allInnerTexts();
ok('小结上没有"再来一组"，只有回到今天的任务', !btns.some((b) => b.includes('再来一组')) && btns.some((b) => b.includes('回到今天的任务')));
await page.locator('[data-nav-back]').click(); await page.waitForTimeout(500);
ok('从左上角返回也打勾', (await page.locator('[data-task="focus"].done').count()) === 1);
const n = await count();
note('进度：' + n);
ok(`清单上的进度变成 1/${ts.length}`, n === `1/${ts.length}`);
ok('按钮变成"继续：下一项"', ((await page.locator('[data-act="today-go"]').textContent()) ?? '').startsWith('继续：'));
ok('这周的小格子今天点亮了', (await page.locator('.xq-week i.any, .xq-week i.full').count()) >= 1);
await page.locator('[data-nav-back]').click(); await page.waitForTimeout(500);
const card = ((await page.locator('[data-home="coach"]').textContent()) ?? '').replace(/\s+/g, ' ');
note('首页私教卡：' + card);
ok('象棋首页的私教卡写着今天做到第几项', card.includes(`1/${ts.length}`));

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
process.exit(errors.length ? 1 : 0);
