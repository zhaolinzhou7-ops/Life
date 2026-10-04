/**
 * 布局体系、中局组合、绝地反杀：学棋里找得到、点得进去、走得通。
 *   布局：按体系分组，点名的体系都在；主线走得够深，讲解每一手都有说明；
 *         执一方自己走，走了谱外的着法交给皮卡鱼判；变化从主线分出去。
 *   组合：按步数、按主题分卡；做一道要连走几步。
 *   阶梯：四档，上一档没过一半下一档锁着；点进去和皮卡鱼下。
 * 用法：npm run dev，然后 node tests/ui/systems.mjs
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

async function coachHome(menu = 'opening') {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.setItem('xq-power', 'save'); });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
  await page.evaluate((m) => window.__xqCoach.menu(m), menu); await page.waitForTimeout(300);
}

// ───────── 1. 布局体系 ─────────
await coachHome();
await page.getByText('📖 布局体系').first().click(); await page.waitForTimeout(400);
const sysText = await page.locator('.xq-coach-report').innerText();
const secs = await page.locator('.xq-sec').allInnerTexts();
console.log('   体系：' + secs.join(' / '));
ok('按体系分组：屏风马、过宫炮、士角炮、飞相局、单提马都有', ['屏风马', '过宫炮', '士角炮', '飞相局', '单提马'].every((s) => secs.includes(s)));
ok('屏风马下面有破急进中兵、牛头滚、巡河炮', ['急进中兵', '牛头滚', '巡河炮'].every((s) => sysText.includes(s)));
const cards = await page.locator('[data-opening]').count();
ok(`布局一共 ${cards} 套`, cards >= 12);
await page.screenshot({ path: OUT + '/systems-list.png' });

await page.locator('[data-opening="pfm-niutougun"]').click(); await page.waitForTimeout(300);
const ntg = (await page.locator('.xq-coach-report').innerText()).replace(/\s+/g, ' ');
console.log('   牛头滚：' + ntg.slice(0, 220));
const rounds = Number((ntg.match(/主线 (\d+) 回合/) ?? [])[1] ?? 0);
ok(`主线走得够深（${rounds} 回合）`, rounds >= 12);
ok('详情讲了思路、怎么破、坑和局面判断', ntg.includes('核心思路') && ntg.includes('破') && ntg.includes('走到这里'));
ok('有变化可以点', (await page.locator('[data-variation]').count()) >= 1);

// 看主线：一直点到底，每一手都有说明
await page.locator('[data-act="op-watch"]').click(); await page.waitForTimeout(300);
let silent = 0;
let steps = 0;
for (let i = 0; i < 80; i++) {
  const b = page.locator('#rp-next');
  if (!(await b.count())) break;
  await b.click(); await page.waitForTimeout(60);
  steps++;
  const say = (await page.locator('.xq-rp-say').innerText()).trim();
  if (say.length < 4) silent++;
}
console.log(`   讲解点了 ${steps} 手，没说明的 ${silent} 手`);
ok('主线讲解一直走到底，每一手都有说明', steps >= 24 && silent === 0);
await page.screenshot({ path: OUT + '/systems-watch.png' });
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// 执黑自己走：前几手照谱，然后走一手谱外的，看皮卡鱼判
await page.locator('[data-act="op-black"]').click(); await page.waitForTimeout(300);
let mine = 0;
let offbook = '';
let judged = '';
for (let i = 0; i < 30 && mine < 6; i++) {
  if (await page.evaluate(() => window.__xqReplay.waiting())) {
    if (mine === 4) {
      // 第五手故意不照谱走：随便挑一手合法的、和原谱不一样的
      const exp = await page.evaluate(() => window.__xqReplay.expected());
      for (const t of ['卒1进1', '卒9进1', '车1进1', '车9进1', '士4进5', '象3进5']) {
        if (t === exp) continue;
        if (await page.evaluate((x) => window.__xqReplay.guess(x), t)) { offbook = t; break; }
      }
      await until(page, () => !/在核对/.test(document.querySelector('.xq-rp-say')?.textContent ?? ''), null, 20000);
      judged = await page.evaluate(() => window.__xqReplay.say());
    } else {
      await page.evaluate(() => window.__xqReplay.guess(window.__xqReplay.expected()));
    }
    mine++;
    await page.waitForTimeout(150);
  } else {
    const b = page.locator('#rp-next');
    if (!(await b.count())) break;
    await b.click(); await page.waitForTimeout(100);
  }
}
console.log(`   谱外走 ${offbook}：${judged.slice(0, 80)}`);
ok('走了谱外的着法，皮卡鱼核对后给出判断（一样好 / 差多少）', !!offbook && (judged.includes('皮卡鱼核对过') || judged.includes('原谱走的是')));
await page.screenshot({ path: OUT + '/systems-guess.png' });
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// 变化：从主线分出去
await page.locator('[data-variation="0"]').click(); await page.waitForTimeout(300);
const vIntro = await page.locator('.xq-rp-say').innerText();
ok('变化从主线某一手分出去，开场说清楚', vIntro.includes('变化') && vIntro.includes('前'));
const vTrail0 = (await page.locator('.xq-rp-trail').innerText()).trim();
ok('变化前面那几手已经摆好', vTrail0.length > 0);
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// 从主线走完的局面实战：谱上那些着法都摆好了，轮到谁走就谁走
if (await page.locator('[data-act="op-play"]').count()) {
  await page.locator('[data-act="op-play"]').click();
  const moved = await until(page, () => (window.__xq?.moves?.() ?? []).length >= 24, null, 15000);
  const n = await page.evaluate(() => (window.__xq?.moves?.() ?? []).length);
  console.log(`   从主线终局实战：棋盘上已经走了 ${n} 手`);
  ok('从布局主线走完的局面直接实战', moved);
  await page.screenshot({ path: OUT + '/systems-play.png' });
  await coachHome();
  await page.getByText('📖 布局体系').first().click(); await page.waitForTimeout(400);
  await page.locator('[data-opening="pfm-niutougun"]').click(); await page.waitForTimeout(300);
} else ok('详情页有"从主线走完的局面实战"', false);

// 点名的另外几套也点得开
for (const id of ['guogong', 'shijiao', 'feixiang', 'dantima', 'pfm-jijin', 'pfm-xunhe']) {
  await page.locator('[data-nav-back]').first().click(); await page.waitForTimeout(250);
  const c = page.locator(`[data-opening="${id}"]`);
  if (!(await c.count())) { ok(`${id} 在列表里`, false); continue; }
  await c.click(); await page.waitForTimeout(250);
  const t = (await page.locator('.xq-coach-report').innerText()).replace(/\s+/g, ' ');
  const n = Number((t.match(/主线 (\d+) 回合/) ?? [])[1] ?? 0);
  ok(`${id}：主线 ${n} 回合`, n >= 12);
}

// ───────── 2. 中局组合 ─────────
await coachHome('tactics');
await page.getByText('🧠 中局组合').first().click();
await until(page, () => document.querySelectorAll('[data-combo]').length > 0, null, 10000);
const cKeys = await page.locator('[data-combo]').evaluateAll((els) => els.map((e) => e.dataset.combo));
console.log('   组合卡：' + cKeys.join(' '));
ok('按步数分档（2–3 步、4–5 步）', cKeys.includes('steps-2') && cKeys.includes('steps-4'));
ok('按主题分卡（至少四个主题）', cKeys.filter((k) => k.startsWith('theme-')).length >= 4);
await page.screenshot({ path: OUT + '/systems-combos.png' });
if (await page.locator('[data-combo="steps-4"]').count()) {
  await page.locator('[data-combo="steps-4"]').click(); await page.waitForTimeout(800);
  const head = (await page.locator('.xq-coach-stage').innerText()).replace(/\s+/g, ' ');
  console.log('   组合题：' + head.slice(0, 120));
  ok('进到一道组合题（标着第几题和主题）', /1\/\d+/.test(head));
}

// ───────── 3. 绝地反杀 ─────────
// 用户原话："我是红棋，对方是黑棋且下一步就能绝杀我，而我必须通过连续将军或者连环杀法，最后绝地反杀。"
await coachHome('tactics');
await page.evaluate(() => localStorage.removeItem('xq-counterkill'));
await page.getByText('🔥 绝地反杀').first().click(); await page.waitForTimeout(500);
const chs = await page.locator('[data-ck-chapter]').evaluateAll((els) => els.map((e) => [e.dataset.ckChapter, e.className.includes('locked')]));
console.log('   章：' + JSON.stringify(chs));
ok('六章都在', chs.length === 6);
ok('第一章开着，后面五章锁着', chs[0][1] === false && chs.slice(1).every((x) => x[1] === true));
await page.screenshot({ path: OUT + '/systems-ck.png' });
await page.locator('[data-ck-chapter="2"]').click(); await page.waitForTimeout(300);
ok('锁着的章点不进去', (await page.locator('[data-ck-chapter]').count()) === 6);
await page.locator('[data-ck-chapter="1"]').click(); await page.waitForTimeout(300);
const nLevels = await page.locator('[data-ck]').count();
ok(`第一章有 ${nLevels} 关`, nLevels >= 5);
ok('最后一关是关底', ((await page.locator('[data-ck]').last().getAttribute('class')) ?? '').includes('boss'));
await page.screenshot({ path: OUT + '/systems-ck-grid.png' });
await page.locator('[data-ck]').first().click(); await page.waitForTimeout(800);
const ckHead = (await page.locator('.xq-tr').innerText()).replace(/\s+/g, ' ');
console.log('   第一关：' + ckHead.slice(0, 120));
ok('题面说清楚：对方下一步就杀你，红先连将杀（第一章三步起）', ckHead.includes('对方下一步就能杀你') && /红先 [3-9] 步连?将?杀/.test(ckHead));
await page.locator('.xq-tr-threat-btn').click(); await page.waitForTimeout(200);
const thr = await page.locator('.xq-tr-threat-btn').innerText();
console.log('   ' + thr);
ok('点开能看到黑方的杀着', thr.includes('他的杀着'));
await page.screenshot({ path: OUT + '/systems-ck-threat.png' });
// 照解法一步步走到将死
for (let i = 0; i < 30; i++) {
  const st = await page.evaluate(() => window.__xqTrain.state());
  if (st.answered) break;
  if (!st.busy) await page.evaluate(() => window.__xqTrain.playRight());
  await page.waitForTimeout(500);
}
const ckEnd = (await page.locator('.xq-tr-fb').innerText()).replace(/\s+/g, ' ');
console.log('   结果：' + ckEnd.slice(0, 60));
ok('连将杀死了', ckEnd.includes('将死'));
await page.locator('#xq-tr-next').click(); await page.waitForTimeout(400);
const firstStars = await page.locator('[data-ck]').first().innerText();
ok('第一次不看提示做对：三颗星', firstStars.includes('★★★'));

// 走闲着会被黑方杀：第二关故意走一手错的
await page.locator('[data-ck]').nth(1).click(); await page.waitForTimeout(800);
await page.evaluate(() => window.__xqTrain.playWrong());
await until(page, () => (document.querySelector('.xq-tr-fb')?.textContent ?? '').length > 6 && !window.__xqTrain.state().busy, null, 20000);
const wrong = (await page.locator('.xq-tr-fb').innerText()).replace(/\s+/g, ' ');
console.log('   走错：' + wrong.slice(0, 80));
ok('走错判错', wrong.includes('❌') || wrong.includes('不对'));

// 解锁只认真题号：乱写的星不算
await coachHome('tactics');
await page.evaluate(() => {
  const s = {};
  for (let i = 0; i < 40; i++) s['ck-x' + i] = 3;
  localStorage.setItem('xq-counterkill', JSON.stringify(s));
});
await page.getByText('🔥 绝地反杀').first().click(); await page.waitForTimeout(400);
const ch2 = await page.locator('[data-ck-chapter="2"]').getAttribute('class');
ok('乱写的关卡号不算数：第二章还是锁着', (ch2 ?? '').includes('locked'));

console.log(errs.length ? `\n✗ ${errs.length} 项不通过：\n  ${errs.join('\n  ')}` : '\n全部通过');
await browser.close();
process.exit(errs.length ? 1 : 0);
