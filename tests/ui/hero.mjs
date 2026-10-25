/**
 * 出场人物：开局前一位人物在水墨里亮相、报名号，演完棋盘才转平、棋子落下。
 * 指定关公就是关公（大名、字幕、录音都对得上）；演的时候棋盘入场、对手的第一步都等着；
 * 点一下就跳过；随机不和上一盘重复；"不演"、关了对局特效都直接开局；样式页点一位当场演一遍；
 * 关公、哪吒、刀客用的是用户给的三张整幅的画（铺满屏幕、镜头推拉、流光、空中飘尘土火星，画上自带题字，不再压大名）；
 * 女侠、大圣还是分层的水墨矢量画（大名、印章、五层 3D）。
 * 进场以后不喊"开局"（用户原话："开局也不用说开局"）。
 * 五位人物的画都画得出来（截图存在 node_modules/.cache/shots/hero-*.png）。
 * 用法：npm run dev，然后 node tests/ui/hero.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const until = async (fn, arg, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(60); }
  return false;
};
const hero = () => page.evaluate(() => document.querySelector('.xqh')?.dataset.hero ?? '');
const said = (name, ms = 5000) => until((n) => document.documentElement.dataset.xqSaid === n, name, ms);
const boardIntro = () => page.evaluate(() => document.querySelector('.xq-boardwrap canvas.xq-b2d')?.dataset.intro === '1' || document.querySelector('.xq-boardwrap')?.dataset.fx === 'opening');

const start = async (settings) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((s) => {
    localStorage.setItem('xq-power', 'save');
    localStorage.setItem('xq-tempo', '0');
    localStorage.setItem('xq-hint-level', '0');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, settings);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
  await page.locator('[data-home="play"]').click(); await page.waitForTimeout(400);
  await page.getByText('开始对弈').first().click();
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());

// ───────── 指定关公 ─────────
await start({ 'xq-hero': 'guangong', 'xq-side': 'r' });
ok('开局先演出场：关公', await until(() => document.querySelector('.xqh')?.dataset.hero === 'guangong', null, 2000));
ok('关公用的是那张整幅的画（骑赤兔马、提青龙偃月刀）', await page.evaluate(() => document.querySelector('.xqh')?.classList.contains('xqh-photo-mode') && /guangong/.test(document.querySelector('.xqh-pic img')?.getAttribute('src') ?? '')));
ok('画加载出来了、铺满屏幕', await until(() => { const i = document.querySelector('.xqh-pic img'); const r = i?.getBoundingClientRect(); return !!i && i.complete && i.naturalWidth >= 900 && !!r && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }, null, 3000));
ok('镜头在推（Ken Burns）', await page.evaluate(() => getComputedStyle(document.querySelector('.xqh-pic img')).animationName === 'xqh-kb'));
ok('画上自带题字：不再压一层大名', (await page.locator('.xqh-name').count()) === 0);
ok('空中飘的尘土、火星（一层画布）', (await page.locator('.xqh-air').count()) === 1);
ok('亮相一招：顺着刀劈下去的一道光', (await page.locator('.xqh-slash path').count()) === 1);
ok('字幕和录音同一句："关某在此，请赐教！"', (await page.locator('.xqh-line').innerText()).replace(/\s/g, '') === '关某在此，请赐教！');
await page.waitForTimeout(1300);
await page.screenshot({ path: OUT + '/hero-guangong-live.png' });
ok('演的时候棋盘还没入场（等人物演完）', !(await boardIntro()));
ok('关公报名号（他自己的录音）', await said('hero-guangong'));
ok('演完自己退场（四五秒）', await until(() => !document.querySelector('.xqh'), null, 6000));
ok('接着棋盘入场', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'opening', null, 1500));
await page.waitForTimeout(2500);
ok('入场不喊"开局"（只在吃车、将军、绝杀喊）', (await page.evaluate(() => document.documentElement.dataset.xqSaid)) === 'hero-guangong');

// ───────── 执黑：对手的第一步等出场演完；点一下跳过 ─────────
await start({ 'xq-hero': 'nezha', 'xq-side': 'b' });
ok('这一盘是哪吒', await until(() => document.querySelector('.xqh')?.dataset.hero === 'nezha', null, 2000));
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + '/hero-nezha-live.png' });
const fen0 = await page.evaluate(() => window.__xq?.fen());
ok('执黑：出场还在演，对手（红方）不先走', !!fen0 && fen0.startsWith('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR'));
const tTap = Date.now();
await page.mouse.click(195, 420);
ok('点一下屏幕就跳过', await until(() => !document.querySelector('.xqh'), null, 1200));
console.log(`   点下去到画面收掉：${Date.now() - tTap} 毫秒`);
ok('跳过之后棋盘马上入场', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'opening', null, 1000));
ok('对手（红方）随后走了第一步', await until(() => window.__xq?.turn() === 'b', null, 15000));

// ───────── 演到一半就退出（比如手机的返回键）：画面收掉，等着的事都不做了 ─────────
await start({ 'xq-hero': 'dasheng', 'xq-side': 'b' });
ok('这一盘是大圣', await until(() => document.querySelector('.xqh')?.dataset.hero === 'dasheng', null, 2000));
await page.evaluate(() => document.querySelector('.xq-back')?.click());
ok('退出：出场画面当场收掉', await until(() => !document.querySelector('.xqh'), null, 800));
await page.waitForTimeout(5500);
ok('退出之后不再入场、对手也不走（回到了开局设置）', !(await page.evaluate(() => !!document.querySelector('.xq-boardwrap'))) && (await page.getByText('开始对弈').count()) > 0);

// ───────── 随机：不和上一盘重复 ─────────
await start({ 'xq-hero': 'random', 'xq-hero-last': 'daoke', 'xq-side': 'r' });
const h1 = await (async () => { await until(() => !!document.querySelector('.xqh'), null, 2000); return hero(); })();
ok(`随机：上一盘是刀客，这一盘换了一位（${h1}）`, !!h1 && h1 !== 'daoke');
ok('随机：记下这一盘是谁', (await page.evaluate(() => localStorage.getItem('xq-hero-last'))) === h1);
await page.mouse.click(195, 420);
await until(() => !document.querySelector('.xqh'), null, 1500);

// ───────── 不演 / 关了特效 ─────────
await start({ 'xq-hero': 'off', 'xq-side': 'r' });
await page.waitForTimeout(250);
ok('选了"不演"：没有出场，棋盘直接入场', !(await page.evaluate(() => !!document.querySelector('.xqh'))) && (await boardIntro()));
await start({ 'xq-hero': 'guangong', 'xq-fx': '0', 'xq-side': 'r' });
await page.waitForTimeout(400);
ok('关了对局特效：出场也不演', !(await page.evaluate(() => !!document.querySelector('.xqh'))));
await page.evaluate(() => localStorage.setItem('xq-fx', '1'));

// ───────── 样式页：点一位当场演一遍 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
await page.locator('[data-home="look"]').click(); await page.waitForTimeout(800);
await page.locator('[data-hero="nvxia"]').scrollIntoViewIfNeeded();
await page.locator('[data-hero="nvxia"]').click();
ok('样式页点"白衣女侠"：当场演一遍', await until(() => document.querySelector('.xqh')?.dataset.hero === 'nvxia', null, 1500));
ok('样式页点"白衣女侠"：以后就是她', (await page.evaluate(() => localStorage.getItem('xq-hero'))) === 'nvxia');
// 女侠、大圣还是分层的水墨矢量画
ok('女侠：大名写的是"女侠"', (await page.locator('.xqh-name').innerText()).replace(/\s/g, '') === '女侠');
ok('女侠：朱印"对弈"', (await page.locator('.xqh-seal').innerText()).replace(/\s/g, '') === '对弈');
ok('女侠：画分成几层摆在 3D 里（天、远山、中景、雾、近景）', (await page.locator('.xqh-cam > .xqh-l').count()) === 5);
ok('女侠：人物背后一团泼墨', (await page.locator('.xqh-splash svg').count()) === 1);
ok('女侠：人物那一层画出来了', await page.evaluate(() => (document.querySelector('.xqh-fig svg')?.getBoundingClientRect().height ?? 0) > 300));
await page.waitForTimeout(1800);
ok('女侠：背景五层都换成了位图（镜头推的时候不用重画带滤镜的矢量图）', (await page.locator('.xqh-cam > .xqh-l > canvas').count()) === 5);
await page.screenshot({ path: OUT + '/hero-nvxia-live.png' });
await page.mouse.click(195, 420);
ok('点一下收掉，回到样式页', await until(() => !document.querySelector('.xqh') && !!document.querySelector('.xq-look'), null, 1500));

// ───────── 五位人物的画（停在 2.6 秒那一帧截图） ─────────
for (const id of ['daoke', 'guangong', 'nezha', 'nvxia', 'dasheng']) {
  await page.evaluate(async (id) => {
    const I = await import('/Life/src/xiangqi/intro.ts');
    void I.playHeroIntro(id, document.body, { hold: true });
  }, id);
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = 2600; }
    document.querySelectorAll('.xqh svg').forEach((s) => { s.pauseAnimations(); s.setCurrentTime(2.6); });
  });
  await page.waitForTimeout(150);
  if (['guangong', 'nezha', 'daoke'].includes(id)) {
    // 整幅的画：等图解出来，铺满屏幕
    ok(`${id}：整幅的画铺满屏幕`, await until(() => { const i = document.querySelector('.xqh-pic img'); const r = i?.getBoundingClientRect(); return !!i && i.complete && i.naturalWidth > 0 && !!r && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }, null, 3000));
  } else {
    const box = await page.evaluate(() => {
      const r = document.querySelector('.xqh-fig svg').getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, h: innerHeight };
    });
    ok(`${id}：人物整个在屏幕里（脚没被裁掉）`, box.top > 0 && box.bottom < box.h);
  }
  await page.screenshot({ path: `${OUT}/hero-${id}.png` });
  await page.mouse.click(195, 420);
  await until(() => !document.querySelector('.xqh'), null, 1500);
}

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
