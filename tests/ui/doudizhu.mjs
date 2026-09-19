/**
 * 斗地主的浏览器实测：真的点进去，从叫地主打到结算，连打 5 局。
 *
 * 单元测试能保证规则和 AI 是对的，但保证不了「界面上点得到、点了有反应」。
 * 按钮被遮住、手牌超出屏幕、结算弹窗出不来、控制台报错——这些只有
 * 真的打开浏览器点一遍才看得见。
 *
 * 用法：npm run dev，然后 node tests/ui/doudizhu.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const ROUNDS = Number(process.env.ROUNDS || 5);
const errors = [];
const fallbacks = [];
const ok = (name, cond, extra = '') => {
  console.log(`${cond ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`);
  if (!cond) errors.push(name + (extra ? ' — ' + extra : ''));
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await context.newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// ---- 入口 ----
await page.getByText('斗地主', { exact: false }).first().click();
await page.waitForTimeout(600);
ok('首页能进斗地主', (await page.locator('.dd').count()) > 0);
ok('开局面板有「开始牌局」', (await page.getByText('开始牌局').count()) > 0);

// ---- 难度可切换 ----
await page.getByText('困难', { exact: true }).first().click();
await page.waitForTimeout(250);
ok('难度切到困难有说明文字', (await page.locator('.dd-note').first().textContent())?.includes('记牌'));

/** 打完整一局，返回结算信息 */
async function playOneGame(index) {
  await page.getByText('开始牌局').first().click();
  await page.waitForTimeout(900);

  const handCount = await page.locator('.dd-mine .dd-card').count();
  if (index === 0) ok('开局手牌 17 张', handCount === 17, `实际 ${handCount}`);

  // 叫地主：一直叫 3 分（叫不了就不叫），直到进入出牌阶段
  for (let i = 0; i < 12; i++) {
    if ((await page.locator('.dd-bid-row').count()) === 0) {
      await page.waitForTimeout(500);
      continue;
    }
    const three = page.locator('.dd-bid-btn', { hasText: '3 分' }).first();
    if (await three.isEnabled().catch(() => false)) await three.click();
    else await page.locator('.dd-bid-btn', { hasText: '不叫' }).first().click();
    await page.waitForTimeout(900);
    if ((await page.locator('.dd-bid-row').count()) === 0) break;
  }

  await page.waitForTimeout(800);
  const phaseChip = (await page.locator('.dd-chip.phase').first().textContent()) ?? '';
  if (index === 0) {
    ok('叫完地主进入出牌阶段', phaseChip.includes('轮'), `阶段显示「${phaseChip}」`);
    ok('底牌已亮出', (await page.locator('.dd-bottom-row .dd-card').count()) === 3);
    ok('顶栏显示了地主和倍数', (await page.locator('.dd-chip').allTextContents()).join(' ').includes('地主'));
  }

  // 出牌：轮到我就「提示 -> 出牌」，压不住就「不要」
  let steps = 0;
  while (steps++ < 260) {
    if ((await page.locator('.dd-overlay').count()) > 0) break; // 结算弹窗出来了
    const playBtn = page.locator('.dd-btn', { hasText: '出牌' }).first();
    if ((await playBtn.count()) === 0) {
      await page.waitForTimeout(300);
      continue;
    }
    await page.locator('.dd-btn', { hasText: '提示' }).first().click();
    await page.waitForTimeout(140);
    const selected = await page.locator('.dd-mine .dd-card.selected').count();
    if (selected > 0) {
      await playBtn.click();
    } else {
      const passBtn = page.locator('.dd-btn', { hasText: '不要' }).first();
      if (await passBtn.isEnabled().catch(() => false)) await passBtn.click();
      else {
        // 必须出牌，提示却没选中任何牌——这本身就不该发生，记下来
        const diag = await page.evaluate(() => ({
          actions: document.querySelector('.dd-actions')?.textContent?.trim(),
          hint: document.querySelector('.dd-hint')?.textContent?.trim(),
          chips: [...document.querySelectorAll('.dd-chip')].map((e) => e.textContent.trim()).join(' | '),
          hand: document.querySelectorAll('.dd-mine .dd-card').length,
          sel: document.querySelectorAll('.dd-mine .dd-card.selected').length,
          passDisabled: [...document.querySelectorAll('.dd-btn')].find((b) => b.textContent.includes('不要'))?.disabled,
          played: [...document.querySelectorAll('.dd-played')].map((e) => e.textContent.trim()).join(' / '),
        }));
        fallbacks.push(`第 ${index + 1} 局第 ${steps} 步：${JSON.stringify(diag)}`);
        // 手牌是叠着画的，一张牌只有最左边一条是露出来的，点中心会点到盖在它上面的下一张。
        // 最后一张是完整露出来的，点它最稳。
        await page.locator('.dd-mine .dd-card').last().click();
        await playBtn.click();
      }
    }
    await page.waitForTimeout(420);
  }

  await page.waitForTimeout(900);
  const overlay = page.locator('.dd-overlay').last();
  const title = (await overlay.locator('.dd-result-title').textContent().catch(() => null)) ?? '';
  const rows = (await overlay.locator('.dd-row').allTextContents().catch(() => [])).join(' | ');
  return { title, rows, steps };
}

let finished = 0;
for (let i = 0; i < ROUNDS; i++) {
  const r = await playOneGame(i);
  const overlay = page.locator('.dd-overlay').last();
  const done = r.title.includes('胜') || r.title.includes('败');
  ok(`第 ${i + 1} 局打到结算（${r.steps} 步）`, done, r.title || '没有出现结算弹窗');
  if (done) {
    finished++;
    if (i === 0) {
      ok('结算里有身份、叫分、倍数', /身份/.test(r.rows) && /叫分/.test(r.rows) && /倍数/.test(r.rows));
    }
    // 牌桌底部也有一组同名按钮（被结算弹窗盖住），所以必须限定在弹窗里点
    await overlay.locator('.dd-btn', { hasText: '回首页' }).first().click();
    await page.waitForTimeout(700);
  }
  // 回首页，保证下一局从同样的状态开始
  if ((await page.getByText('开始牌局').count()) === 0) {
    const back = page.locator('.dd-btn-icon').first();
    page.once('dialog', (d) => d.accept());
    await back.click();
    await page.waitForTimeout(600);
  }
}
ok(`${ROUNDS} 局全部打完并结算`, finished === ROUNDS, `实际完成 ${finished} 局`);
ok('轮到自己先出牌时，提示永远给得出牌', fallbacks.length === 0, '\n    ' + fallbacks.slice(0, 3).join('\n    '));

// ---- 战绩被记下来了 ----
// 注意用 .dd-btn 限定：首页统计里也有一行叫「总战绩」，纯文字选择器会选错
const recordsBtn = page.locator('.dd-btn', { hasText: '战绩' }).first();
if ((await recordsBtn.count()) > 0) {
  await recordsBtn.click();
  await page.waitForTimeout(400);
  const records = await page.locator('.dd-record').count();
  ok('战绩里有刚打完的记录', records >= finished, `列出 ${records} 条`);
  const first = (await page.locator('.dd-record').first().textContent()) ?? '';
  ok('战绩记录里有身份和倍数', /地主|农民/.test(first) && /倍/.test(first), first.replace(/\s+/g, ' ').slice(0, 60));
  await page.locator('.dd-btn', { hasText: '关闭' }).first().click();
  await page.waitForTimeout(300);
}

// ---- 布局检查：手牌不能超出屏幕 ----
const overflow = await page.evaluate(() => {
  const el = document.querySelector('.dd-mine .dd-cards');
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { left: r.left, right: r.right, width: window.innerWidth, scroll: document.body.scrollWidth };
});
if (overflow) {
  ok('手牌没有横向溢出屏幕', overflow.left >= -2 && overflow.right <= overflow.width + 2,
    `牌区 ${Math.round(overflow.left)}~${Math.round(overflow.right)}，屏宽 ${overflow.width}`);
}

await page.screenshot({ path: process.env.SHOT || '/tmp/dd-table.png' });
await browser.close();

console.log('\n===== 失败项 / 报错 =====');
if (!errors.length) console.log('（无）');
else errors.forEach((e) => console.log('  ' + e));
process.exit(errors.length ? 1 : 0);
