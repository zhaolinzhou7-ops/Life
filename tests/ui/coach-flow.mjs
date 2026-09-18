/**
 * 教练模式 + 完整闭环的浏览器验证。
 *
 * 用 DEV 钩子摆出确定的局面，验证整条链路：
 *   送子时弹提示 → 点"换一手"棋子不动（教练不替人走棋）
 *   → 点"就这么走"照走（教练不拦人）→ 教学档能追问"为什么"
 *   → 下完自动存档 → 复盘打得开 → 问教练答得出 → 首页和最近棋局都看得到
 *
 * 必须跑在 dev 构建上：测试钩子只在 import.meta.env.DEV 下才挂出来。
 * 用法：npm run dev，然后 node tests/ui/coach-flow.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errors = [];
const log = [];
const ok = (name, cond) => { const line = `${cond ? '✓' : '✗'} ${name}`; log.push(line); console.log(line); if (!cond) errors.push(name); };
const note = (m) => { log.push('   ' + m); console.log('   ' + m); };

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click();
await page.waitForTimeout(700);
await page.locator('.xq-home-card').nth(0).click();
await page.waitForTimeout(500);
await page.getByText('标准提示').first().click();
await page.waitForTimeout(150);
await page.getByText('开始对弈').first().click();
await page.waitForTimeout(3000);
ok('DEV 钩子可用', await page.evaluate(() => !!window.__xq));

// ---- 摆一个"红车走过去就被白吃"的局面 ----
// 红车 (4,6)，黑车 (4,1) 正对着；红车往前走到 (4,4) 仍在黑车射程内且无保护
const FEN = '4k4/4r4/9/9/9/9/4R4/9/9/4K4 w';
ok('摆局面成功', await page.evaluate((f) => window.__xq.setBoard(f), FEN));
await page.waitForTimeout(400);
await page.screenshot({ path: `${OUT}/c1-position.png` });

// 红车 (4,6) → (4,4)：走完被黑车白吃一个车
await page.evaluate(() => { window.__xq.tap(4, 6); window.__xq.tap(4, 4); });
await page.waitForTimeout(900);
ok('送车时弹出教练提示条', await page.locator('.xq-tip').count() > 0);
const text = await page.locator('.xq-tip-text').textContent().catch(() => '');
note('提示文案：' + (text ?? '').trim());
ok('提示里点名了车', (text ?? '').includes('车'));
await page.screenshot({ path: `${OUT}/c2-prompt.png` });

// 换一手：棋子应该没动
await page.locator('[data-act="cancel"]').click();
await page.waitForTimeout(400);
ok('点「换一手」后提示条消失', await page.locator('.xq-tip').count() === 0);
ok('点「换一手」后棋子没动（教练不替人走棋）',
   await page.evaluate(() => window.__xq.moves().length === 0));
await page.screenshot({ path: `${OUT}/c3-cancelled.png` });

// 再走一次，这次坚持
await page.evaluate(() => { window.__xq.tap(4, 6); window.__xq.tap(4, 4); });
await page.waitForTimeout(800);
await page.locator('[data-act="go"]').click();
await page.waitForTimeout(1200);
ok('点「就这么走」之后确实走了（教练不拦人）',
   await page.evaluate(() => window.__xq.moves().length >= 1));
await page.screenshot({ path: `${OUT}/c4-proceeded.png` });

// ---- 教学提示档的"为什么？" ----
await page.locator('#xq-hint').click(); // 标准 → 教学
await page.waitForTimeout(300);
const lvl = await page.locator('#xq-hint').textContent();
note('切档后 = ' + lvl);
await page.evaluate((f) => window.__xq.setBoard(f), FEN);
await page.waitForTimeout(400);
await page.evaluate(() => { window.__xq.tap(4, 6); window.__xq.tap(4, 4); });
await page.waitForTimeout(900);
const hasWhy = await page.locator('[data-act="why"]').count() > 0;
ok('教学提示档有「为什么？」按钮', hasWhy);
if (hasWhy) {
  await page.locator('[data-act="why"]').click();
  await page.waitForTimeout(1200);
  const why = (await page.locator('.xq-tip-why').textContent() ?? '').trim();
  note('为什么的回答：' + why.slice(0, 120));
  ok('「为什么」给出了实质解释', why.length > 20);
  await page.screenshot({ path: `${OUT}/c5-why.png`, fullPage: false });
}

// ---- 把一盘棋下完，验证存档与复盘 ----
await page.locator('[data-act="go"]').click().catch(() => {});
await page.waitForTimeout(600);
/**
 * 红车 (0,6)，黑将被两个过河兵封住两侧。
 * 红车平到四路照将 → 黑车只能垫在 (4,3) → 红车吃掉它就是绝杀。
 * 三手棋分出胜负，而且 moveLog 有 3 手，复盘按钮才会出现（1 手的棋没什么可复盘的）。
 */
await page.evaluate((f) => window.__xq.setBoard(f), '4k4/3P1P3/9/8r/9/9/R8/9/9/3K5 w');
await page.waitForTimeout(400);
const clickThrough = async () => {
  const go = await page.locator('[data-act="go"]').count();
  if (go) { await page.locator('[data-act="go"]').click(); await page.waitForTimeout(400); }
};
/** 等轮回红方。固定 sleep 不靠谱——AI 想多久取决于难度和机器快慢 */
const waitMyTurn = async (want) => {
  for (let i = 0; i < 60; i++) {
    const st = await page.evaluate(() => ({ t: window.__xq.turn(), n: window.__xq.moves().length }));
    if (st.t === 'r' && st.n >= want) return true;
    if (await page.locator('.xq-result').count()) return true;
    await page.waitForTimeout(500);
  }
  return false;
};
await page.evaluate(() => { window.__xq.tap(0, 6); window.__xq.tap(4, 6); });
await page.waitForTimeout(700);
await clickThrough();
ok('黑方应将后轮回红方', await waitMyTurn(2));
await page.evaluate(() => { window.__xq.tap(4, 6); window.__xq.tap(4, 3); });
await page.waitForTimeout(900);
await clickThrough();
await page.waitForTimeout(2500);
note('走完 ' + await page.evaluate(() => window.__xq.moves().length) + ' 手，轮到 ' + await page.evaluate(() => window.__xq.turn()));
ok('对局结束出结算页', await page.locator('.xq-result').count() > 0);
await page.screenshot({ path: `${OUT}/c6-result.png` });
const archived = await page.evaluate(() => { try { return JSON.parse(localStorage.getItem('xq-archive') || '[]').length; } catch { return -1; } });
note('存档里的对局数 = ' + archived);
ok('对局自动存档', archived >= 1);

// 复盘
await page.getByText('复盘这一局').first().click();
await page.waitForTimeout(6000);
ok('复盘面板打开', await page.locator('.xq-rv').count() > 0);
await page.screenshot({ path: `${OUT}/c7-review.png` });

// 问教练
await page.locator('.xq-rv-ask').click();
await page.waitForTimeout(600);
ok('教练对话面板打开', await page.locator('.xq-chat').count() > 0);
await page.locator('.xq-chat-chip').first().click();
await page.waitForTimeout(1200);
const msgs = await page.locator('.xq-chat-msg.ai').allTextContents();
note('教练回答：' + (msgs[msgs.length - 1] ?? '').slice(0, 120));
ok('教练答得出东西', (msgs[msgs.length - 1] ?? '').length > 10);
await page.screenshot({ path: `${OUT}/c8-chat.png` });

// 回首页看最近棋局
await page.locator('.xq-chat-close').click();
await page.waitForTimeout(300);
await page.locator('.xq-rv-close').click();
await page.waitForTimeout(600);
await page.getByText('返回首页').first().click();
await page.waitForTimeout(900);
await page.screenshot({ path: `${OUT}/c9-home-after.png` });
const homeText = await page.locator('.xq-home').textContent();
ok('首页的"棋局复盘"卡片显示了这一盘', !homeText.includes('还没有棋局记录'));
await page.locator('.xq-home-card').nth(2).click();
await page.waitForTimeout(800);
ok('最近棋局列表里有这一盘', await page.locator('.xq-grow').count() >= 1);
await page.screenshot({ path: `${OUT}/c10-gamelist.png` });

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errors.length ? errors.join('\n') : '无');
