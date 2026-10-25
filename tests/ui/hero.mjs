/**
 * 出场人物：开局前一位人物整幅亮相、喊一声开场白，演完棋盘才转平、棋子落下。
 * 九位人物都是用户给的画（铺满屏幕、镜头推拉、流光、空中飘的东西、亮相一招）；画上自带题字的不再压名字，
 * 围棋那三张（题字裁掉了）自己写名字、一句诗、一方"对弈"印。白衣女侠、齐天大圣拿掉了（用户原话："把孙悟空啊，
 * 还有那白衣女侠呀，从里面拿掉"）。
 * 指定关公就是关公（画、字幕、录音都对得上）；每位五句台词随机念一句（不和他上一次那句重复），字幕和录音是同一句；
 * 画怎么露出来也随机（墨滴洇开、刀光裂屏、烈焰燃开、金门洞开、雷霆一击、卷轴展开），一秒多都露全；
 * 演的时候棋盘入场、对手的第一步都等着；点一下就跳过；
 * 随机不和上一盘重复；"不演"、关了对局特效都直接开局；样式页点一位当场演一遍；进场以后不喊"开局"。
 * 九位人物的画都铺得满屏幕（截图存在 node_modules/.cache/shots/hero-*.png）。
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
const GUANGONG = ['关某在此！鼠辈，谁敢与我一战！', '青龙偃月刀下，从无活口！', '过五关，斩六将，岂惧你一盘棋！', '吾观你，不过插标卖首之辈！', '赤兔追风，取你帅首，易如反掌！'];
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
await start({ 'xq-hero': 'guangong', 'xq-side': 'r', 'xq-hero-line': JSON.stringify({ guangong: 0 }), 'xq-hero-reveal': 'ink' });
ok('开局先演出场：关公', await until(() => document.querySelector('.xqh')?.dataset.hero === 'guangong', null, 2000));
const gl = Number(await page.evaluate(() => document.querySelector('.xqh')?.dataset.line));
ok(`五句里随机念一句，不和上一次那句重复（上次第 1 句，这次第 ${gl} 句）`, gl >= 2 && gl <= 5);
ok('记下这一次念的是第几句', (await page.evaluate(() => JSON.parse(localStorage.getItem('xq-hero-line') ?? '{}').guangong)) === gl - 1);
const rv0 = await page.evaluate(() => document.querySelector('.xqh')?.dataset.rv);
ok(`开场方式随机，不和上一次一样（上次墨滴洇开，这次 ${rv0}）`, ['blade', 'fire', 'gate', 'thunder', 'scroll'].includes(rv0) && (await page.evaluate(() => localStorage.getItem('xq-hero-reveal'))) === rv0);
ok('关公用的是那张整幅的画（骑赤兔马、提青龙偃月刀）', await page.evaluate(() => /guangong/.test(document.querySelector('.xqh-pic img')?.getAttribute('src') ?? '')));
ok('画加载出来了、铺满屏幕', await until(() => { const i = document.querySelector('.xqh-pic img'); const r = i?.getBoundingClientRect(); return !!i && i.complete && i.naturalWidth >= 900 && !!r && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }, null, 3000));
ok('镜头在推（Ken Burns）', await page.evaluate(() => getComputedStyle(document.querySelector('.xqh-pic img')).animationName === 'xqh-kb'));
ok('画上自带题字：不再压一层大名', (await page.locator('.xqh-name').count()) === 0);
ok('空中飘的尘土、火星（一层画布）', (await page.locator('.xqh-air').count()) === 1);
ok('亮相一招：顺着刀劈下去的一道光', (await page.locator('.xqh-slash path').count()) === 1);
ok(`字幕是关公的第 ${gl} 句："${GUANGONG[gl - 1]}"`, (await page.locator('.xqh-line').innerText()).replace(/\s/g, '') === GUANGONG[gl - 1]);
await page.waitForTimeout(1300);
await page.screenshot({ path: OUT + '/hero-guangong-live.png' });
ok('演的时候棋盘还没入场（等人物演完）', !(await boardIntro()));
ok('关公喊的是同一句（他自己的录音，第几句对得上）', await said(`hero-guangong-${gl}`));
ok('演完自己退场（四五秒）', await until(() => !document.querySelector('.xqh'), null, 6000));
ok('接着棋盘入场', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'opening', null, 1500));
await page.waitForTimeout(2500);
ok('入场不喊"开局"（只在吃车、将军、绝杀喊）', (await page.evaluate(() => document.documentElement.dataset.xqSaid)) === `hero-guangong-${gl}`);

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
await start({ 'xq-hero': 'shaoshuai', 'xq-side': 'b' });
ok('这一盘是少帅', await until(() => document.querySelector('.xqh')?.dataset.hero === 'shaoshuai', null, 2000));
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
await page.locator('[data-hero="xuanyi"]').scrollIntoViewIfNeeded();
await page.locator('[data-hero="xuanyi"]').click();
ok('样式页点"玄衣棋客"：当场演一遍', await until(() => document.querySelector('.xqh')?.dataset.hero === 'xuanyi', null, 1500));
ok('样式页点"玄衣棋客"：以后就是他', (await page.evaluate(() => localStorage.getItem('xq-hero'))) === 'xuanyi');
// 围棋那三张裁掉了"围棋"两个字：屏幕上自己写名字、一句诗、一方印
ok('玄衣：名字写的是"玄衣"', (await page.locator('.xqh-name').innerText()).replace(/\s/g, '') === '玄衣');
ok('玄衣：旁边一句"落子无悔"', (await page.locator('.xqh-verse').innerText()).replace(/\s/g, '') === '落子无悔');
ok('玄衣：朱印"对弈"', (await page.locator('.xqh-seal').innerText()).replace(/\s/g, '') === '对弈');
ok('名字的字都在随包的毛笔字里（不靠系统字顶着：竖排时系统字会叠在一起）', await page.evaluate(() => document.fonts.check('40px "XQ Hero"', '玄衣素墨客') && [...document.fonts].some((f) => f.family === 'XQ Hero' && f.status === 'loaded')));
await page.waitForTimeout(1800);
ok('玄衣：名字是竖着的两个字（不叠在一起）', await page.evaluate(() => { const r = document.querySelector('.xqh-name').getBoundingClientRect(); return r.height > r.width * 1.6; }));
await page.screenshot({ path: OUT + '/hero-xuanyi-live.png' });
await page.mouse.click(195, 420);
ok('点一下收掉，回到样式页', await until(() => !document.querySelector('.xqh') && !!document.querySelector('.xq-look'), null, 1500));

// ───────── 六种开场：一秒半以后画都露全了 ─────────
for (const rv of ['ink', 'blade', 'fire', 'gate', 'thunder', 'scroll']) {
  await page.evaluate(async (rv) => {
    const I = await import('/Life/src/xiangqi/intro.ts');
    void I.playHeroIntro('daoke', document.body, { hold: true, reveal: rv });
  }, rv);
  ok(`${rv}：叠了这种开场的那一层`, rv === 'ink' ? (await page.locator('.xqh-rv').count()) === 0 : (await page.locator(`.xqh-rv-${rv}`).count()) === 1);
  await page.waitForTimeout(1600);
  const open = await page.evaluate((rv) => {
    const sc = document.querySelector('.xqh-scene');
    const cs = getComputedStyle(sc);
    const mats = (sel) => [...document.querySelectorAll(sel)].map((e) => new DOMMatrix(getComputedStyle(e).transform));
    if (rv === 'ink' || rv === 'fire') return cs.maskImage === 'none' || cs.webkitMaskImage === 'none';
    // 两半黑幕各自飞出去大半个屏幕；两扇门转过了九十度（背面不画）
    if (rv === 'blade') return mats('.xqh-rv-blade .h').every((m) => Math.abs(m.m42) > innerHeight * 0.6);
    if (rv === 'gate') return mats('.xqh-rv-gate .door').every((m) => m.m11 < 0.05);
    if (rv === 'thunder') return getComputedStyle(document.querySelector('.xqh-rv-thunder .cv')).opacity === '0';
    if (rv === 'scroll') return /^inset\((0(px|%)?\s*)+\)$/.test(cs.clipPath);
    return false;
  }, rv);
  ok(`${rv}：一秒半以后画都露全了`, open);
  await page.screenshot({ path: `${OUT}/hero-reveal-${rv}.png` });
  await page.mouse.click(195, 420);
  await until(() => !document.querySelector('.xqh'), null, 1500);
}

// ───────── 九位人物的画（停在 2.6 秒那一帧截图）；五句字幕每一句都放得下 ─────────
for (const id of ['guangong', 'nezha', 'daoke', 'shaoshuai', 'hongzhuang', 'ziyi', 'xuanyi', 'suyi', 'moke']) {
  for (let k = 1; k < 5; k++) {
    const fit = await page.evaluate(async ([id, k]) => {
      const I = await import('/Life/src/xiangqi/intro.ts');
      void I.playHeroIntro(id, document.body, { hold: true, line: k, reveal: 'ink' });
      await new Promise((r) => setTimeout(r, 60));
      for (const a of document.getAnimations()) { a.pause(); a.currentTime = 2600; }
      const s = document.querySelector('.xqh-line > span');
      const r = s.getBoundingClientRect();
      const ok = r.left >= 0 && r.right <= innerWidth && r.height < 2.6 * parseFloat(getComputedStyle(s).fontSize) * 1.6;
      I.stopHeroIntro();
      return ok;
    }, [id, k]);
    ok(`${id}：第 ${k + 1} 句字幕不出屏幕、最多两行`, fit);
  }
  await page.evaluate(async (id) => {
    const I = await import('/Life/src/xiangqi/intro.ts');
    void I.playHeroIntro(id, document.body, { hold: true, line: 0, reveal: 'ink' });
  }, id);
  await page.waitForTimeout(80);
  await page.evaluate(() => {
    for (const a of document.getAnimations()) { a.pause(); a.currentTime = 2600; }
    document.querySelectorAll('.xqh svg').forEach((s) => { s.pauseAnimations(); s.setCurrentTime(2.6); });
  });
  await page.waitForTimeout(150);
  // 等图解出来，铺满屏幕；字幕一行到两行，在屏幕里
  ok(`${id}：整幅的画铺满屏幕`, await until(() => { const i = document.querySelector('.xqh-pic img'); const r = i?.getBoundingClientRect(); return !!i && i.complete && i.naturalWidth >= 900 && !!r && r.width >= innerWidth - 1 && r.height >= innerHeight - 1; }, null, 3000));
  ok(`${id}：字幕不出屏幕、最多两行`, await page.evaluate(() => { const r = document.querySelector('.xqh-line > span').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.height < 2.6 * parseFloat(getComputedStyle(document.querySelector('.xqh-line > span')).fontSize) * 1.6; }));
  await page.screenshot({ path: `${OUT}/hero-${id}.png` });
  await page.mouse.click(195, 420);
  await until(() => !document.querySelector('.xqh'), null, 1500);
}

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
