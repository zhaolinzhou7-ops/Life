/**
 * 逐屏体检（手机真实可见高度）：象棋里每一屏、每个常见状态都走一遍，量三件事——
 *   1. 按钮点不点得到：在屏幕外面、又滚不过去的；被别的东西盖住的；
 *   2. 字有没有被裁掉：在屏幕下面、所在的框又滚不动（用户截图里"走完了"那段总结就是这样，按钮全没了）；
 *   3. 横向溢出、页面报错。
 * reach.mjs 只走了几个入口屏，这里把布局讲解走完、开局浏览器、邪门布局、残局、组合、绝地反杀、打谱、私教、
 * 复盘总览、找回好棋、导入棋谱……都走到。每一屏存一张截图（node_modules/.cache/shots/sweep-*）。
 * 用法：npm run dev，然后 node tests/ui/sweep.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const problems = [];
const visited = [];

const AUDIT = () => {
  const out = [];
  const vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || window.innerHeight;
  const vw = window.innerWidth;
  const scroller = (el) => {
    let sc = el.parentElement;
    while (sc && sc !== document.body && sc !== document.documentElement) {
      const s = getComputedStyle(sc);
      if (/(auto|scroll)/.test(s.overflowY) && sc.scrollHeight > sc.clientHeight + 2) return sc;
      sc = sc.parentElement;
    }
    return null;
  };
  /** 横着滚的条（复盘的着法条、棋谱条）：跑到右边外面的按钮滑一下就到 */
  const inHScroller = (el) => {
    let sc = el.parentElement;
    while (sc && sc !== document.body) {
      const s = getComputedStyle(sc);
      if (/(auto|scroll)/.test(s.overflowX) && sc.scrollWidth > sc.clientWidth + 2) return true;
      sc = sc.parentElement;
    }
    return false;
  };
  // 开着浮层（找回好棋、导入框、确认框）时只量浮层里的东西——下面那一屏本来就被盖着
  const layers = [...document.querySelectorAll('.xq-retry, .xq-ex-import, .xq-confirm')].filter((e) => getComputedStyle(e).display !== 'none');
  const root = layers[layers.length - 1] ?? document.body;
  const canDown = (sc) => (sc ? sc.scrollTop + sc.clientHeight < sc.scrollHeight - 2 : document.documentElement.scrollHeight > window.innerHeight + 2);
  const canUp = (sc) => (sc ? sc.scrollTop > 0 : window.scrollY > 0);
  const shown = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  const label = (el) => (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 16) || String(el.className);

  // 1. 按钮
  const clickable = [...root.querySelectorAll('button, .card, [data-act], [data-ex-move], [data-variation], [data-opening], .xq-grow')].filter(shown);
  /** 一个元素真正看得见的那一段：所在滚动框和屏幕的交集 */
  const visBox = (sc) => {
    const b = sc ? sc.getBoundingClientRect() : { top: 0, bottom: vh };
    return { top: Math.max(0, b.top), bottom: Math.min(vh, b.bottom) };
  };
  for (const el of clickable) {
    const r = el.getBoundingClientRect();
    const sc = scroller(el);
    const v = visBox(sc);
    if (r.bottom <= v.top + 4) { if (!canUp(sc)) out.push(`按钮「${label(el)}」在屏幕上方，滚不上去`); continue; }
    if (r.top >= v.bottom - 4) { if (!canDown(sc)) out.push(`按钮「${label(el)}」在屏幕下方 ${Math.round(r.top - vh)}px，滚不下去`); continue; }
    if (r.bottom > v.bottom + 1) { if (!canDown(sc)) out.push(`按钮「${label(el)}」被底边切掉一半，滚不下去`); continue; }
    if (r.top < v.top - 1) { if (!canUp(sc)) out.push(`按钮「${label(el)}」被顶边切掉一半，滚不上去`); continue; }
    if ((r.right < 4 || r.left > vw - 4) && !inHScroller(el)) { out.push(`按钮「${label(el)}」横向跑到屏幕外`); continue; }
    {
      const cx = Math.min(vw - 1, Math.max(0, r.left + Math.min(r.width / 2, 20)));
      const cy = r.top + r.height / 2;
      const hit = document.elementFromPoint(cx, cy);
      if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
        // 半透明遮罩层（弹窗背景）盖住下面的按钮是正常的；只报被不相干的东西盖住
        // 贴顶的"← 返回"顶栏盖住刚滚上去的那一截也正常：往回滚一点就露出来
        if (hit.closest('.xq-nav') && canUp(sc)) continue;
        const layer = hit.closest('.xq-ex-import, .xq-confirm, .xq-retry, .xq-modal, .xq-sheet, .modal, [role="dialog"]');
        if (!layer || !layer.contains(el)) if (!layer) out.push(`按钮「${label(el)}」被「${label(hit)}」盖住`);
      }
    }
  }
  // 2. 字被裁掉：有自己文字的块，在屏幕下面（或被底边切掉）而所在的框滚不动
  const texts = [...root.querySelectorAll('*')].filter((el) => {
    if (['SCRIPT', 'STYLE', 'CANVAS', 'svg', 'OPTION'].includes(el.tagName)) return false;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)) return false;
    return shown(el);
  });
  let clipped = 0;
  for (const el of texts) {
    const r = el.getBoundingClientRect();
    const sc = scroller(el);
    if (r.bottom <= visBox(sc).bottom + 1) continue;
    if (canDown(sc)) continue;
    // 框自己有 overflow:hidden 而且把它裁在框外，也算
    clipped++;
    if (clipped <= 3) out.push(`文字「${label(el)}」在屏幕底边以下（${Math.round(r.top)}–${Math.round(r.bottom)}，屏高 ${vh}），滚不下去`);
  }
  if (clipped > 3) out.push(`……还有 ${clipped - 3} 处文字被裁`);
  // 3. 有没有回去的路：顶栏"← 返回"、讲解的"退出"、或者写着返回/退出/结束/关闭的按钮（用户原话："有些界面甚至没有返回键"）
  const exits = [...root.querySelectorAll('[data-nav-back], #rp-out, .xq-rv-close, button, [data-act]')].filter(
    (el) => shown(el) && (el.matches('[data-nav-back], #rp-out, .xq-rv-close') || /返回|退出|结束|关闭|取消|离开|✕|×/.test(el.textContent || '')),
  );
  return { out, back: exits.length > 0, h: document.documentElement.scrollWidth - document.documentElement.clientWidth, n: clickable.length };
};

/** 本来就不需要返回键的屏：象棋首页（应用自己的导航在上面） */
const NO_BACK = new Set(['象棋首页']);
const SIZES = (process.env.SIZES || '375x548,390x664,430x740').split(',').map((s) => s.split('x').map(Number));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const dev = `${w}×${h}`;
  page.on('pageerror', (e) => problems.push(`[${dev}] 页面报错：${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) problems.push(`[${dev}] 控制台错误：${m.text().slice(0, 120)}`); });

  const check = async (name) => {
    await page.waitForTimeout(500);
    const r = await page.evaluate(AUDIT);
    if (r.h > 2) problems.push(`[${dev}] ${name}：横向溢出 ${r.h}px`);
    if (!r.back && !NO_BACK.has(name)) r.out.push('这一屏没有返回 / 退出键');
    for (const p of r.out) problems.push(`[${dev}] ${name}：${p}`);
    visited.push(name);
    console.log(`${r.out.length || r.h > 2 ? '✗' : '✓'} [${dev}] ${name}（可点 ${r.n}${r.out.length ? `，问题 ${r.out.length}` : ''}）`);
    await page.screenshot({ path: `${OUT}/sweep-${w}-${name.replace(/[\s/·：]+/g, '_')}.png` }).catch(() => {});
  };
  const step = async (name, fn) => {
    try { await fn(); await check(name); } catch (e) { problems.push(`[${dev}] ${name}：走不到（${String(e.message).split('\n')[0].slice(0, 100)}）`); console.log(`✗ [${dev}] ${name} 走不到`); }
  };
  const fresh = async (setup) => {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.evaluate((s) => { localStorage.setItem('xq-power', 'save'); if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, setup);
    await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  };
  const coach = async () => {
    await fresh();
    await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(500);
    if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(400); }
    await page.evaluate(() => window.__xqCoach.home()); await page.waitForTimeout(400);
  };
  /** 私教 › 某个菜单（› 菜单里的某一项） */
  const menu = async (id, act) => {
    await coach();
    await page.evaluate((m) => window.__xqCoach.menu(m), id); await page.waitForTimeout(300);
    if (act) { await page.locator(`[data-act="${act}"]`).click(); await page.waitForTimeout(600); }
  };
  // 一直点到底；走到分岔点（会停下来列出几条路）就沿主线走
  const nextToEnd = async () => {
    for (let i = 0; i < 80 && (await page.locator('#rp-next, #rp-fork-main').count()); i++) {
      await page.locator((await page.locator('#rp-fork-main').count()) ? '#rp-fork-main' : '#rp-next').click();
      await page.waitForTimeout(25);
    }
  };
  /** 一直点到第一个分岔点（停下来列出几条路） */
  const nextToFork = async () => {
    for (let i = 0; i < 60 && !(await page.locator('#rp-fork-main').count()) && (await page.locator('#rp-next').count()); i++) {
      await page.locator('#rp-next').click();
      await page.waitForTimeout(25);
    }
  };

  // ── 首页、对弈 ──
  await step('象棋首页', fresh);
  await step('对弈设置', async () => { await page.locator('[data-home="play"]').click(); });
  await step('对局中', async () => { await page.getByText('开始对弈').first().click(); await page.waitForTimeout(2500); });
  // 走两手：教练那一行多了布局名字（📖 …），行变长了按钮也得在
  await step('对局中·布局名', async () => {
    await page.evaluate(() => { const m = window.__xq.legal().find((x) => window.__xq.textOf(x) === '炮二平五'); window.__xq.play(m); });
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !(await page.evaluate(() => (window.__xq.coachLine() ?? '').includes('📖')))) await page.waitForTimeout(300);
  });

  // ── 私教：首页的任务清单、五个菜单 ──
  await step('私教首页', coach);
  await step('私教·今天第一项', async () => { await page.locator('[data-act="today-go"]').click(); await page.waitForTimeout(1200); });
  await step('私教课', async () => { await coach(); await page.locator('[data-act="m-tutor"]').click(); await page.waitForTimeout(600); });
  for (const [id, name] of [['tactics', '杀法与战术'], ['endgame', '残局'], ['opening', '布局'], ['play', '实战与打谱'], ['progress', '水平和进步']]) {
    await step(`菜单·${name}`, async () => { await menu(id); });
  }
  await step('做题·杀法', async () => { await menu('tactics', 'p-mate'); await page.waitForTimeout(800); });
  await step('做题·残局', async () => { await menu('endgame', 'p-endgame'); await page.waitForTimeout(800); });
  await step('每日一题', async () => { await menu('tactics', 'daily'); await page.waitForTimeout(800); });
  await step('打谱列表', async () => { await menu('play', 'games'); });
  await step('打谱·一局', async () => { await page.locator('.card').first().click(); await page.waitForTimeout(500); for (let i = 0; i < 10 && (await page.locator('#rp-next').count()); i++) await page.locator('#rp-next').click(); });
  await step('限时计算', async () => { await menu('tactics', 'timed'); await page.waitForTimeout(800); });
  await step('让子定级', async () => { await menu('play', 'ladder'); });
  await step('学习路线', async () => { await menu('progress', 'roadmap'); });
  await step('训练方案', async () => { await menu('progress', 'program'); });
  await step('棋风画像', async () => { await menu('progress', 'level'); });

  // ── 布局 ──
  await step('布局体系', async () => { await menu('opening', 'openings'); });
  await step('布局详情（变招加载后）', async () => { await page.locator('[data-opening="pfm-guohe"]').click(); await page.waitForTimeout(1200); });
  await step('布局讲解·中途', async () => { await page.locator('[data-act="op-watch"]').click(); for (let i = 0; i < 12; i++) await page.locator('#rp-next').click(); });
  await step('布局讲解·分岔点', nextToFork);
  await step('布局讲解·走完了', nextToEnd);
  await step('布局·执红走一遍', async () => { await page.locator('#rp-out').first().click(); await page.waitForTimeout(300); await page.locator('[data-act="op-red"]').click(); });
  await step('布局·变招走完了', async () => {
    await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
    await page.locator('[data-variation]', { has: page.locator('.tag', { hasText: '变招' }) }).first().click(); await page.waitForTimeout(300);
    await nextToEnd();
  });
  await step('布局·错着走完了', async () => {
    await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
    await page.locator('[data-variation]', { has: page.locator('.tag', { hasText: '错着' }) }).first().click(); await page.waitForTimeout(300);
    await nextToEnd();
  });
  await step('布局·抽查', async () => { await page.locator('#rp-out').first().click(); await page.waitForTimeout(300); await page.locator('[data-act="op-drill"]').click(); await page.waitForTimeout(300); });

  // ── 开局浏览器 ──
  await step('开局浏览器·开局', async () => { await menu('opening', 'explorer'); });
  await step('开局浏览器·分岔点', async () => {
    for (const t of ['炮二平五', '马8进7', '马二进三', '车9平8', '车一平二', '马2进3']) await page.evaluate((x) => window.__xqExplorer.go(x), t);
  });
  await step('开局浏览器·出谱候选着', async () => {
    for (const t of ['兵九进一', '卒9进1']) await page.evaluate((x) => window.__xqExplorer.go(x), t);
    const t0 = Date.now();
    while (Date.now() - t0 < 30000 && !(await page.evaluate(() => window.__xqExplorer.engine()?.length))) await page.waitForTimeout(300);
  });
  await step('开局浏览器·导入框', async () => { await page.locator('[data-ex-act="import"]').click(); });

  // ── 江湖布局 ──
  await step('江湖布局列表', async () => { await menu('opening', 'tricks'); });
  await step('江湖布局·一课', async () => { await page.locator('.card').nth(1).click(); await page.waitForTimeout(500); });
  await step('江湖布局·看套路走完了', async () => {
    const b = page.locator('button', { hasText: '看套路' }).first();
    if (await b.count()) { await b.click(); await page.waitForTimeout(300); await nextToEnd(); } else throw new Error('没有"看套路"按钮');
  });
  await step('江湖布局·变化列表', async () => {
    await page.locator('#rp-out').first().click();
    const t0 = Date.now();
    while (Date.now() - t0 < 10000 && !(await page.locator('[data-trick-var]').count())) await page.waitForTimeout(200);
    await page.locator('[data-trick-var]').last().scrollIntoViewIfNeeded();
  });
  await step('江湖布局·一条变化走完了', async () => { await page.locator('[data-trick-var]').first().click(); await page.waitForTimeout(300); await nextToEnd(); });
  await step('江湖布局·抽查', async () => { await page.locator('#rp-out').first().click(); await page.waitForTimeout(300); await page.locator('[data-act="trick-drill"]').click(); await page.waitForTimeout(300); });

  // ── 组合、残局、绝地反杀 ──
  await step('中局组合列表', async () => { await menu('tactics', 'combos'); });
  await step('中局组合·一题', async () => { await page.locator('.card').nth(1).click(); await page.waitForTimeout(1000); });
  await step('实用残局列表', async () => { await menu('endgame', 'endgames'); });
  await step('实用残局·下到底', async () => { await page.evaluate(() => window.__xqCoach.endgame()); await page.waitForTimeout(1500); });
  await step('绝地反杀列表', async () => { await menu('tactics', 'counterkill'); });
  await step('绝地反杀·一关', async () => { await page.locator('.card').nth(1).click(); await page.waitForTimeout(1000); });

  // ── 复盘：导入一盘、总览、找回好棋 ──
  await step('最近棋局·导入框', async () => {
    await fresh();
    await page.locator('[data-home="games"]').click(); await page.waitForTimeout(400);
    await page.locator('[data-act="import-game"]').click();
  });
  await step('复盘·总览', async () => {
    await page.locator('[data-imp-text]').fill('1. 炮二平五 马8进7 2. 炮五进四 马7进5 3. 马二进三 车9平8 4. 车一平二 马2进3 5. 马八进七 卒3进1');
    await page.locator('[data-imp-go]').click();
    const t0 = Date.now();
    while (Date.now() - t0 < 120000 && !(await page.locator('[data-act="retry"]').count())) await page.waitForTimeout(500);
    await page.locator('[data-act="overview"]').click();
  });
  await step('复盘·找回好棋', async () => { await page.locator('[data-act="retry"]').click(); await page.waitForTimeout(800); });

  await ctx.close();
}

await browser.close();
console.log(`\n走了 ${visited.length} 屏`);
console.log('================ 问题清单 ================');
console.log(problems.length ? problems.join('\n') : '无');
process.exit(problems.length ? 1 : 0);
