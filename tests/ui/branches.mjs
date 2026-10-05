/**
 * 分支和棋盘演示这一轮：
 *   - 布局讲解走到有变招的那一手停下来，列出几条路，棋盘上画带号的箭头；点箭头（真的点在画布上）走那一路，走完回分岔点；
 *   - 江湖布局"套路和破解"走到分岔处，上当那一路也挂在分支里；
 *   - 复盘：你走错的一手棋盘停在走之前，红"你"、绿"★"两条箭头，点绿箭头看最佳走法的后续；着法条每手挂评级；最佳走法写着多得多少分；
 *   - 题目做完"在棋盘上一步步看原谱"、计划底下"在棋盘上一步步看"、残局"🔀 推演"都打开推演板，能问引擎几种走法。
 *
 * 用户原话："帮我把不同的路线分出来：第一种走法会怎么发展，第二条路又会怎么发展……能实时看到棋盘上的具体变化，
 * 而不是只写'炮八平七、马二进三'这类纯文字记录""有一个箭头，我点着箭头就能知道最佳走法及接下来的后续发展"
 * 用法：npm run dev，然后 node tests/ui/branches.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errors = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errors.push(n); };
const note = (m) => console.log('   ' + m);
const until = async (page, fn, arg, ms = 30000) => {
  try { await page.waitForFunction(fn, arg, { timeout: ms, polling: 150 }); return true; } catch { return false; }
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 744 }, hasTouch: true, isMobile: true })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

/** 点画布上某条带 id 的箭头（真的点在箭头中点上） */
async function tapArrow(sel, id) {
  const pt = await page.evaluate(([s, i]) => {
    const c = document.querySelector(s);
    const r = c.getBoundingClientRect();
    const a = JSON.parse(c.dataset.arrowsxy || '[]').find((x) => x.id === i);
    return a ? { x: r.left + a.x, y: r.top + a.y } : null;
  }, [sel, id]);
  if (!pt) return false;
  await page.mouse.click(pt.x, pt.y);
  return true;
}

async function coach() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('xq-power', 'save'));
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(500); }
}

// ───────── 1. 布局讲解：分岔点 ─────────
await coach();
await page.evaluate(() => window.__xqCoach.menu('opening')); await page.waitForTimeout(300);
await page.locator('[data-act="openings"]').click(); await page.waitForTimeout(500);
await page.locator('[data-opening="pfm-guohe"]').click(); await page.waitForTimeout(1500);
await page.locator('[data-act="op-watch"]').click(); await page.waitForTimeout(400);
ok('讲解开场说了"走到有变招的那一手会停下来"', ((await page.locator('.xq-rp-say').innerText()) ?? '').includes('停下来'));
let steps = 0;
for (; steps < 40; steps++) {
  if ((await page.evaluate(() => window.__xqReplay.fork())) !== null) break;
  await page.locator('#rp-next').click(); await page.waitForTimeout(40);
}
const at = await page.evaluate(() => window.__xqReplay.fork());
const forkText = (await page.locator('.xq-rp-say').innerText()).replace(/\s+/g, ' ');
note('分岔：' + forkText.slice(0, 140));
ok('走到分岔点停下来，列出几条路（①主线、②……）', at !== null && /① .*主线/.test(forkText) && forkText.includes('②'));
const arrows = await page.evaluate(() => document.querySelector('.xq-rp-board canvas').dataset.arrows);
ok(`棋盘上每条路一条带号的箭头（${arrows}）`, (arrows ?? '').split(',').length >= 2 && arrows.includes('fork:-1'));
await page.screenshot({ path: `${OUT}/branches-fork.png` });
// 真的点在第二条路的箭头上
const second = arrows.split(',').find((x) => x !== 'fork:-1');
ok('点箭头（画布上）就沿那一路走', (await tapArrow('.xq-rp-board canvas', second)) && (await until(page, () => window.__xqReplay.branch() >= 0, null, 3000)));
const brSay = (await page.locator('.xq-rp-say').innerText()).replace(/\s+/g, ' ');
note('换到分支：' + brSay.slice(0, 80));
ok('讲解框标着这是哪一路', /第 \d+ 回合|变|改走/.test(brSay));
for (let i = 0; i < 40 && (await page.locator('#rp-next').count()); i++) { await page.locator('#rp-next').click(); await page.waitForTimeout(30); }
const endSay = (await page.locator('.xq-rp-say').innerText()).replace(/\s+/g, ' ');
ok('分支走完说这一路的结论，能回到分岔点', endSay.includes('这一路走完了') && (await page.locator('#rp-fork-back').count()) === 1);
await page.locator('#rp-fork-back').click(); await page.waitForTimeout(300);
ok('回到分岔点：刚才那条打上"✓ 看过"', (await page.evaluate(() => window.__xqReplay.fork())) === at && (await page.locator('.xq-fork .seen').count()) >= 1);
await page.locator('#rp-fork-main').click(); await page.waitForTimeout(200);
ok('选主线接着往下走', (await page.evaluate(() => window.__xqReplay.branch())) === -1 && (await page.evaluate(() => window.__xqReplay.fork())) === null);

// ───────── 2. 江湖布局：上当那一路挂在分支里 ─────────
await coach();
await page.evaluate(() => window.__xqCoach.menu('opening')); await page.waitForTimeout(300);
await page.locator('[data-act="tricks"]').click(); await page.waitForTimeout(500);
await page.locator('[data-trick="tiehuache"]').click(); await page.waitForTimeout(800);
await until(page, () => document.querySelectorAll('[data-trick-var]').length > 0, null, 10000);
await page.locator('button', { hasText: '看套路' }).first().click(); await page.waitForTimeout(400);
let found = '';
for (let i = 0; i < 40; i++) {
  if ((await page.evaluate(() => window.__xqReplay.fork())) !== null) {
    found = (await page.locator('.xq-rp-say').innerText()).replace(/\s+/g, ' ');
    if (found.includes('上当')) break;
    await page.locator('#rp-fork-main').click(); await page.waitForTimeout(40);
    continue;
  }
  if (!(await page.locator('#rp-next').count())) break;
  await page.locator('#rp-next').click(); await page.waitForTimeout(40);
}
note('江湖布局分岔：' + found.slice(0, 160));
ok('江湖布局走到分岔处：破解谱和上当那一路都列出来', found.includes('破解谱') && found.includes('上当'));

// ───────── 3. 复盘：对比箭头、评级、多得几分 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="games"]').click(); await page.waitForTimeout(400);
await page.locator('[data-act="import-game"]').click();
await page.locator('[data-imp-text]').fill('1. 炮二平五 马8进7 2. 马二进三 车9平8 3. 炮五进四 马7进5 4. 车一平二 马2进3 5. 马八进七 卒3进1');
await page.locator('[data-imp-go]').click();
await until(page, () => !!document.querySelector('[data-act="retry"]'), null, 180000);
await page.waitForTimeout(500);
const chips = await page.$$eval('.xq-rv-item .lv', (els) => els.map((e) => e.textContent));
note('着法条评级：' + chips.join(' '));
ok('着法条上每一手都挂着评级（★ 优 良 中 差 错 漏）', chips.length >= 8 && chips.every((c) => /^[妙唯★优良中差错漏]$/.test(c)));
await page.evaluate(() => document.querySelector('.xq-rv-item[data-i="4"]')?.click());
await page.waitForTimeout(600);
const best = (await page.locator('[data-best]').innerText()).replace(/\s+/g, ' ');
note('最佳走法：' + best.slice(0, 120));
ok('写着最佳走法是什么、比你这手多得多少分', /最佳走法 \S+：比你这手多得约 \d+ 分/.test(best));
const rvArrows = await page.evaluate(() => document.querySelector('.xq-boardwrap canvas').dataset.arrows);
ok(`你走错的一手：棋盘上红"你"、绿"★"两条箭头（${rvArrows}）`, rvArrows === 'mine,best');
ok('点绿箭头（画布上）：在棋盘上一步步看最佳走法的后续', (await tapArrow('.xq-boardwrap canvas', 'best')) && (await until(page, () => !!document.querySelector('[data-demo]'), null, 3000)));
const demo = (await page.locator('[data-demo]').innerText()).replace(/\s+/g, ' ');
note('最佳这一路：' + demo.slice(0, 100));
ok('演示讲的是最佳走法这一路', demo.includes('最佳走法'));
await page.locator('[data-act="demo-end"]').click(); await page.waitForTimeout(300);
ok('结束演示回到对比摆法（两条箭头还在）', (await page.evaluate(() => document.querySelector('.xq-boardwrap canvas').dataset.arrows)) === 'mine,best');
await page.locator('[data-act="lab"]').click(); await page.waitForTimeout(400);
ok('推演板从这一手走之前开始，先摆最佳那一路', (await page.locator('.xq-lab-layer').count()) === 1 && (await page.evaluate(() => window.__xqLab.len())) >= 2);
await until(page, () => !!window.__xqLab.alts(), null, 60000);
ok('推演板一打开就列出这一步的几种走法', (await page.locator('.xq-lab-alt').count()) >= 2);
await page.locator('[data-lab-close]').click(); await page.waitForTimeout(300);
ok('关掉推演板回到复盘', (await page.locator('.xq-lab-layer').count()) === 0 && (await page.locator('[data-best]').count()) === 1);
// 计划底下"在棋盘上一步步看"
await page.evaluate(() => document.querySelector('.xq-rv-item[data-i="1"]')?.click());
await page.waitForTimeout(500);
await page.locator('.xq-rv-fold').click(); await page.waitForTimeout(300);
const planBtn = page.locator('[data-plan-lab]').first();
if (await planBtn.count()) {
  await planBtn.click(); await page.waitForTimeout(400);
  ok('计划底下"在棋盘上一步步看"打开推演板', (await page.locator('.xq-lab-layer').count()) === 1);
  await page.locator('[data-lab="next"]').click(); await page.waitForTimeout(400);
  ok('推演板"下一步"往下走一手', (await page.evaluate(() => window.__xqLab.k())) === 1);
  await page.locator('[data-lab-close]').click(); await page.waitForTimeout(300);
} else ok('这一手有计划', false);

// ───────── 4. 题目原谱、残局推演 ─────────
await coach();
await page.evaluate(() => window.__xqCoach.puzzle('mate2-qi')); await page.waitForTimeout(500);
for (let i = 0; i < 6; i++) {
  const st = await page.evaluate(() => window.__xqTrain.state());
  if (st.answered) break;
  if (!st.busy) await page.evaluate(() => window.__xqTrain.playRight());
  await page.waitForTimeout(600);
}
await until(page, () => !!document.querySelector('[data-lab-open]'), null, 10000);
ok('题目做完有"在棋盘上一步步看原谱"', (await page.locator('[data-lab-open]').count()) === 1);
await page.locator('[data-lab-open]').click(); await page.waitForTimeout(400);
const len = await page.evaluate(() => window.__xqLab.len());
ok(`推演板摆好原谱（${len} 手）`, len >= 3);
for (let i = 0; i < len; i++) { await page.locator('[data-lab="next"]').click(); await page.waitForTimeout(350); }
ok('一步步点"下一步"走到原谱最后一手', (await page.evaluate(() => window.__xqLab.k())) === len);
await page.locator('[data-lab-close]').click(); await page.waitForTimeout(300);

await page.evaluate(() => window.__xqCoach.endgame()); await page.waitForTimeout(2500);
await page.locator('[data-act="lab"]').click();
ok('残局"🔀 推演"：引擎列出这一步的几种走法', await until(page, () => (window.__xqLab?.alts()?.length ?? 0) >= 2, null, 60000));
const alts = (await page.locator('[data-lab-alts]').innerText()).replace(/\s+/g, ' ');
note('残局几种走法：' + alts.slice(0, 160));
ok('每种走法写着走完谁好', /① \S+ 走完：/.test(alts));
const altArrows = await page.evaluate(() => document.querySelector('.xq-lab-board canvas').dataset.arrows);
ok('点箭头（画布上）走那一路', (await tapArrow('.xq-lab-board canvas', altArrows.split(',')[1])) && (await until(page, () => window.__xqLab.k() === 1, null, 3000)));
await page.screenshot({ path: `${OUT}/branches-lab.png` });
await page.locator('[data-lab-close]').click(); await page.waitForTimeout(300);

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
process.exit(errors.length ? 1 : 0);
