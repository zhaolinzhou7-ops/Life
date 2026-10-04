/**
 * 入口走查：首页三个入口、私教里一级级往下的菜单，每一屏左上角都能返回。
 *
 * 用户原话："像布局、战术、杀法、残局这些内容到处都是，非常混乱。我希望有一个统一的私教入口，
 * 点进去之后能通过层级菜单一级一级往下选。""有些界面甚至没有返回键。"
 * 用法：npm run dev，然后 node tests/ui/entries.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errors = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errors.push(n); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

const gotoHome = async () => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click();
  await page.waitForTimeout(800);
};
const h1 = async () => ((await page.locator('h1').first().textContent()) ?? '').trim();
const path = async () => ((await page.locator('.xq-nav-path').first().textContent()) ?? '').trim();

// 先把"自报水平"那一步过掉
await gotoHome();
await page.locator('[data-home="coach"]').click();
await page.waitForTimeout(900);
if (await page.getByText('业 4-5').count()) {
  await page.getByText('业 4-5').first().click();
  await page.waitForTimeout(600);
}

// ── 首页：只有三个入口 ──
await gotoHome();
const cards = await page.locator('.xq-home-card').allInnerTexts();
console.log('   首页：' + cards.map((c) => c.split('\n')[0]).join(' / '));
ok('首页只有三个入口：私教、下一盘、我的棋局', cards.length === 3 && /私教/.test(cards[0]) && /下一盘/.test(cards[1]) && /我的棋局/.test(cards[2]));

await page.locator('[data-home="play"]').click(); await page.waitForTimeout(600);
ok('下一盘 → 对弈设置，左上角能返回', (await page.locator('[data-nav-back]').count()) === 1);
await page.locator('[data-nav-back]').click(); await page.waitForTimeout(500);
ok('返回回到首页', (await page.locator('[data-home="coach"]').count()) === 1);

await page.locator('[data-home="games"]').click(); await page.waitForTimeout(600);
ok(`我的棋局 → 「${await h1()}」，左上角能返回`, (await h1()).includes('最近棋局') && (await page.locator('[data-nav-back]').count()) === 1);

// ── 私教首页：今天的任务 + 自己选着练 + 我的进度 ──
await gotoHome();
await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(800);
ok(`私教 → 「${await h1()}」`, (await h1()).includes('私教'));
ok('私教首页有今天的任务清单', (await page.locator('[data-today] .xq-task').count()) >= 2);
ok('左上角能返回象棋首页', (await page.locator('[data-nav-back]').count()) === 1);

const MENUS = [
  ['m-tactics', '杀法与战术', ['战术题', '杀法题', '中局组合', '绝地反杀']],
  ['m-endgame', '残局', ['残局题', '实用残局']],
  ['m-opening', '布局', ['布局体系', '江湖布局破解', '开局浏览器']],
  ['m-play', '实战与打谱', ['让子定级', '打谱']],
  ['m-progress', '水平和进步', ['学习路线', '训练方案']],
];
for (const [act, title, items] of MENUS) {
  await page.locator(`[data-act="${act}"]`).click(); await page.waitForTimeout(400);
  const text = await page.locator('.xq-coach-home').innerText();
  ok(`${title}：标题对、顶栏写着"私教 › ${title}"、${items.join('、')} 都在`, (await h1()).includes(title) && (await path()) === `私教 › ${title}` && items.every((x) => text.includes(x)));
  await page.locator('[data-nav-back]').click(); await page.waitForTimeout(400);
  ok(`${title} ← 返回回到私教首页`, (await page.locator('[data-today]').count()) === 1);
}

// ── 往下一层：布局 › 布局体系 › 一套布局，一层层返回 ──
await page.locator('[data-act="m-opening"]').click(); await page.waitForTimeout(300);
await page.locator('[data-act="openings"]').click(); await page.waitForTimeout(400);
await page.locator('[data-opening]').first().click(); await page.waitForTimeout(400);
ok('布局详情：顶栏还写着"私教 › 布局"', (await path()) === '私教 › 布局');
await page.locator('[data-nav-back]').click(); await page.waitForTimeout(300);
ok('← 返回到布局体系列表', (await page.locator('[data-opening]').count()) > 5);
await page.locator('[data-nav-back]').click(); await page.waitForTimeout(300);
ok('← 返回到布局菜单', (await page.locator('[data-menu="opening"]').count()) === 1);
await page.locator('[data-nav-back]').click(); await page.waitForTimeout(300);
ok('← 返回到私教首页', (await page.locator('[data-today]').count()) === 1);

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
process.exit(errors.length ? 1 : 0);
