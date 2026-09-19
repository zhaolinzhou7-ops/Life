/**
 * 可达性体检：走遍象棋的每一屏，检查**有没有点不到的按钮**。
 *
 * 只看"横向溢出 = 0"是不够的。真正让人点不到按钮的是另外几种：
 *   1. 容器 justify-content:center + 内容超高 → 内容从上方溢出，
 *      滚动条到顶了还够不着，上半截永远点不到
 *   2. flex 子元素被压扁，文字撑出自己的盒子，卡片和按钮视觉上叠在一起
 *   3. 被浮层盖住
 * 这三种在代码里都看不出来，只有把每个按钮的真实位置量一遍才知道。
 *
 * 用法：npm run dev，然后 node tests/ui/reach.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const problems = [];

const AUDIT = () => {
  const out = [];
  const vh = window.innerHeight;
  const vw = window.innerWidth;
  const sel = 'button, .card, [data-act], [data-i], [data-go], .xq-rival, .xq-grow, .xq-chat-chip';
  const clickable = [...document.querySelectorAll(sel)];
  for (const el of clickable) {
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;

    let sc = el.parentElement;
    while (sc && sc !== document.body) {
      const s = getComputedStyle(sc);
      if (/(auto|scroll)/.test(s.overflowY) && sc.scrollHeight > sc.clientHeight + 2) break;
      sc = sc.parentElement;
    }
    const scrollable = sc && sc !== document.body;
    const canUp = scrollable ? sc.scrollTop > 0 : window.scrollY > 0;
    const canDown = scrollable
      ? sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2
      : document.documentElement.scrollHeight > window.innerHeight + 2;
    const label = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 18) || String(el.className);

    const above = r.bottom < 4;
    const below = r.top > vh - 4;
    if (above && !canUp) { out.push({ label, why: `在屏幕上方 ${Math.round(-r.bottom)}px，滚不上去` }); continue; }
    if (below && !canDown) { out.push({ label, why: `在屏幕下方 ${Math.round(r.top - vh)}px，滚不下去` }); continue; }
    if (r.right < 4 || r.left > vw - 4) { out.push({ label, why: '横向跑到屏幕外' }); continue; }
    // 不在视口里的到此为止：它靠滚动够得到。再做命中测试只会误报——
    // 坐标夹回视口之后打到的是别的元素，看着像"被盖住"，其实只是还没滚到。
    if (above || below) continue;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && !el.contains(hit) && !hit.contains(el)) {
      out.push({ label, why: `被 ${String(hit.className || hit.tagName).slice(0, 30)} 盖住` });
    }
  }
  return {
    problems: out,
    hOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    hasExit: clickable.some((e) => /退出|返回|✕|关闭/.test(e.textContent || '')),
    count: clickable.length,
  };
};

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

for (const [dev, w, h] of [['手机', 390, 844], ['小屏', 320, 568], ['平板', 820, 1180]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  page.on('pageerror', (e) => problems.push(`[${dev}] pageerror: ${e.message}`));

  const check = async (name, needExit = true) => {
    await page.waitForTimeout(700);
    const r = await page.evaluate(AUDIT);
    const tag = `[${dev}] ${name}`;
    if (r.hOverflow > 2) problems.push(`${tag} 横向溢出 ${r.hOverflow}px`);
    for (const p of r.problems) problems.push(`${tag} 「${p.label}」${p.why}`);
    if (needExit && !r.hasExit) problems.push(`${tag} 没有任何退出/返回按钮`);
    console.log(`${tag}  可点 ${r.count}  问题 ${r.problems.length}${r.hasExit ? '' : '  ⚠无退出'}`);
    await page.screenshot({ path: `${OUT}/reach-${dev}-${name}.png` }).catch(() => {});
  };

  const home = async () => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByText('中国象棋', { exact: false }).first().click();
    await page.waitForTimeout(800);
  };
  const tap = async (s, n = 0) => { await page.locator(s).nth(n).click().catch(() => {}); };

  await home(); await check('象棋首页');
  await tap('.xq-home-card', 0); await check('对弈设置');
  await page.getByText('开始对弈').first().click(); await page.waitForTimeout(2500); await check('对局中');

  await home(); await tap('.xq-home-card', 1); await check('学棋入口');
  await page.locator('.card.home-card').first().click().catch(() => {}); await check('学棋二级');
  await home(); await tap('.xq-home-card', 3); await check('专项练习');
  await home(); await tap('.xq-home-card', 2); await check('最近棋局');
  await home(); await tap('.xq-home-card', 4); await check('我的水平');

  await page.close();
}

await browser.close();
console.log('\n================ 问题清单 ================');
console.log(problems.length ? problems.join('\n') : '无');
process.exit(problems.length ? 1 : 0);
