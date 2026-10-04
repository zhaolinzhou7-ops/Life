/**
 * 复盘和训练这一轮：
 *   - 复盘时棋盘完整露出来（面板不盖棋盘），展开讲解时棋盘缩小但也不被盖；
 *   - 走过的子上挂评级（★ 优 良 中 差 错 漏），翻一手棋子沿路线走过去（有动画）；
 *   - 走错的一手：对手接下来具体怎么罚（一手手列出来、记账、结论），能在棋盘上一步步演示；
 *   - 这盘要改的一个习惯；错着存进「我的专属课」，复盘页一键过去，专属课按毛病归课。
 *
 * 用户原话："复盘时要能看到完整的棋局界面""棋子上直接显示该步的评级""要告诉我对手接下来会怎么应对、
 * 具体怎么走会导致我陷入劣势""针对我复盘表现不好、暴露出的弱项，自动生成到专属课程里让我反复训练"
 * 用法：npm run dev，然后 node tests/ui/review-coach.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errors = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errors.push(n); };
const note = (m) => console.log('   ' + m);

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

for (const [w, h] of [[390, 664], [375, 548]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
  page.on('pageerror', (e) => errors.push(`[${w}×${h}] pageerror: ${e.message}`));
  const dev = `${w}×${h}`;
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-power', 'save'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  // 先在私教里报一下水平（第一次进私教要问），后面从复盘跳专属课时就不会先弹这个
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(600);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(400); }
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="games"]').click(); await page.waitForTimeout(400);
  await page.locator('[data-act="import-game"]').click();
  // 第 3 回合红方炮五进四打中卒：黑马吃回炮
  await page.locator('[data-imp-text]').fill('1. 炮二平五 马8进7 2. 马二进三 车9平8 3. 炮五进四 马7进5 4. 车一平二 马2进3 5. 马八进七 卒3进1');
  await page.locator('[data-imp-go]').click();
  await page.waitForFunction(() => !!document.querySelector('[data-act="retry"]'), null, { timeout: 180000 });
  await page.waitForTimeout(800);

  const fits = () => page.evaluate(() => {
    const c = document.querySelector('.xq-boardwrap canvas')?.getBoundingClientRect();
    const p = document.querySelector('.xq-rv')?.getBoundingClientRect();
    return c && p ? { board: Math.round(c.bottom), panel: Math.round(p.top), w: Math.round(c.width), h: Math.round(c.height), top: Math.round(c.top) } : null;
  });
  let f = await fits();
  note(`[${dev}] 棋盘 ${f.top}–${f.board}（宽 ${f.w}），面板从 ${f.panel} 开始`);
  ok(`[${dev}] 复盘时棋盘整块露出来，不被面板盖住`, f && f.board <= f.panel + 1 && f.top >= 0);
  ok(`[${dev}] 棋盘够大（至少屏宽的七成）`, f.w >= w * 0.7);

  // 炮五进四：失误，棋子上挂"错"或"漏"
  await page.evaluate(() => document.querySelector('.xq-rv-item[data-i="4"]')?.click());
  await page.waitForTimeout(500);
  const badge = await page.evaluate(() => document.querySelector('.xq-boardwrap canvas')?.dataset.badge ?? '');
  note(`[${dev}] 炮五进四的角标：${badge}`);
  ok(`[${dev}] 走错的那一手，棋子上挂着评级（错 / 漏 / 差）`, /,[错漏差]$/.test(badge));
  const detail = (await page.locator('.xq-rv-detail').innerText()).replace(/\s+/g, ' ');
  ok(`[${dev}] 走错的一手有"演示对手怎么罚"按钮`, (await page.locator('.xq-rv-pun').count()) === 1);
  const pun = (await page.locator('[data-punish]').innerText()).replace(/\s+/g, ' ');
  note(`[${dev}] 劣势推演：${pun.slice(0, 160)}`);
  ok(`[${dev}] 劣势推演一手手列出：对手 马7进5 吃炮，最后一句说丢了什么`, pun.includes('马7进5') && /丢了炮/.test(pun));
  ok(`[${dev}] 告诉你下次落子前先问自己什么`, detail.includes('落子前先问自己'));

  // 演示：棋盘一步步走（有动画）
  const anims0 = await page.evaluate(() => Number(document.querySelector('.xq-boardwrap canvas')?.dataset.anims ?? 0));
  await page.locator('.xq-rv-pun').click();
  await page.waitForTimeout(400);
  ok(`[${dev}] 演示开始：讲第 1 步`, (await page.locator('[data-demo]').innerText()).includes('第 1 /'));
  await page.locator('[data-act="demo-next"]').click(); await page.waitForTimeout(500);
  const d2 = (await page.locator('[data-demo]').innerText()).replace(/\s+/g, ' ');
  note(`[${dev}] 演示第 2 步：${d2.slice(0, 80)}`);
  ok(`[${dev}] 下一步：对手 马7进5，棋子是走过去的（有动画）`, d2.includes('马7进5') && (await page.evaluate(() => Number(document.querySelector('.xq-boardwrap canvas')?.dataset.anims ?? 0))) > anims0);
  f = await fits();
  ok(`[${dev}] 演示时棋盘也完整`, f.board <= f.panel + 1);
  await page.locator('[data-act="demo-end"]').click(); await page.waitForTimeout(300);
  ok(`[${dev}] 结束演示回到这一手，翻页按钮回来了`, (await page.locator('[data-act="next-bad"]').count()) === 1);
  await page.screenshot({ path: `${OUT}/review-coach-${w}.png` });

  // 展开讲解：棋盘缩小但不被盖（画布铺满上面那一块，棋盘按能放下的最大尺寸画）
  const h0 = f.h;
  await page.locator('.xq-rv-fold').click(); await page.waitForTimeout(300);
  f = await fits();
  ok(`[${dev}] 展开讲解后棋盘缩小（${h0} → ${f.h}）、仍然整块露出`, f.board <= f.panel + 1 && f.h < h0 * 0.8);
  await page.locator('.xq-rv-fold').click(); await page.waitForTimeout(300);

  // 总览：这盘要改的一个习惯、去专属课
  await page.locator('[data-act="overview"]').click(); await page.waitForTimeout(400);
  const sum = (await page.locator('.xq-rv-summary').innerText()).replace(/\s+/g, ' ');
  note(`[${dev}] 总览：${sum.slice(0, 200)}`);
  ok(`[${dev}] 总览里有"这盘要改的一个习惯"`, sum.includes('这盘要改的一个习惯'));
  ok(`[${dev}] 错着存进了「我的专属课」，一键过去`, (await page.locator('[data-act="train-own"]').count()) === 1);
  await page.locator('[data-act="train-own"]').click(); await page.waitForTimeout(900);
  const own = (await page.locator('[data-own]').innerText()).replace(/\s+/g, ' ');
  note(`[${dev}] 专属课：${own.slice(0, 160)}`);
  ok(`[${dev}] 专属课按毛病归课，写着最贵的毛病`, own.includes('最贵的毛病') && (await page.locator('.xq-own-row').count()) >= 1);
  ok(`[${dev}] 专属课左上角能返回`, (await page.locator('[data-nav-back]').count()) === 1);
  await page.locator('.xq-own-row').first().click(); await page.waitForTimeout(1200);
  const cap = await page.locator('.xq-tr-cap').innerText();
  note(`[${dev}] 题目：${cap}`);
  ok(`[${dev}] 重走自己的错着：写着哪天那盘第几回合`, /那盘第 \d+ 回合/.test(cap));
  await page.close();
}

// 对局：难度从大师起，低档折起来；默认大师
{
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="play"]').click(); await page.waitForTimeout(400);
  const shown = await page.locator('[data-level]:visible .title').allInnerTexts();
  note('看得见的档位：' + shown.map((t) => t.replace(/推荐/, '').trim()).join(' / '));
  ok('设置页一眼看到的是大师往上七档', shown.length === 7 && shown[0].includes('大师') && shown[6].includes('棋王'));
  ok('入门～高级折在"更低的档位"里', (await page.locator('.xq-lowlv:not([open])').count()) === 1);
  ok('默认选中大师', ((await page.locator('.diff-row .card.selected .title').first().innerText()) ?? '').startsWith('大师'));
  // 老存档：旧编号 5（特级大师）换成新编号
  await page.evaluate(() => { localStorage.setItem('xq-level', '5'); localStorage.removeItem('xq-level-v'); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="play"]').click(); await page.waitForTimeout(400);
  const sel = (await page.locator('.diff-row .card.selected .title').first().innerText()).trim();
  ok(`老存档里选的特级大师还是特级大师（现在选中：${sel}）`, sel === '特级大师');
  await page.close();
}

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
process.exit(errors.length ? 1 : 0);
