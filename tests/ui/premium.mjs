/**
 * "会员级"的那几样：
 *   - 典藏棋盘（水墨山河 / 鎏金玄漆 / 金碧青绿）会动的那一层：流光、河水粼光、薄雾、金粉，贴着棋盘；关了特效就没有；
 *   - 水墨以外的四套典藏（星河夜弈 / 霓虹赛博 / 烽火沙场 / 敦煌飞天）各有各会动的东西（星星眨眼和流星、扫描线和河边跑的光、
 *     火星、花瓣），对局画面的底也跟着换（深空、霓虹城、烽火城墙、大漠月夜）；换回水墨那几套，底换回水墨远山；
 *   - 报着法：走一步念一声"炮二平五"，对手走的也念；报完再喊"将军"，不叠在一起。默认关着（用户原话："不是每一步都要说话，
 *     就是关键的那几步"），样式页打开；
 *   - 对局两边对着两框：你那一框（执哪方、实战分、用时）和对手框，轮到谁谁亮、钟在走；
 *   - 出场：亮相一招（一道光劈过去）、"对阵 · 对手"、喊开场白。
 * 用户原话："模仿一下天天象棋……他们的那些顶级出场动画，还有他们花钱要会员才能买的那种动画语音，包括……他们的那个棋盘"
 * 用法：npm run dev，然后 node tests/ui/premium.mjs
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
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(80); }
  return false;
};
const start = async (settings) => {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((s) => {
    localStorage.clear();
    localStorage.setItem('xq-power', 'save');
    localStorage.setItem('xq-tempo', '0');
    localStorage.setItem('xq-hint-level', '0');
    localStorage.setItem('xq-side', 'r');
    localStorage.setItem('xq-hero', 'off');
    for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v);
  }, settings);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
  await page.locator('[data-home="play"]').click(); await page.waitForTimeout(400);
  await page.getByText('开始对弈').first().click();
};
const INK = JSON.stringify({ board: 'inkland', piece: 'ink', font: 'mashan', trad: false });

// ───────── 典藏棋盘：会动的那一层 ─────────
await start({ 'xq-look': INK, 'xq-announce': '1' });
await page.waitForTimeout(2400);
const amb = await page.evaluate(() => {
  const a = document.querySelector('.xq-amb');
  const cv = document.querySelector('.xq-boardwrap canvas.xq-b2d');
  const r = a?.getBoundingClientRect();
  const c = cv?.getBoundingClientRect();
  return {
    cls: a?.className ?? '',
    sheen: !!a?.querySelector('.amb-sheen'),
    river: !!a?.querySelector('.amb-river .amb-ripple'),
    mist: a?.querySelectorAll('.amb-mist').length ?? 0,
    motes: a?.querySelectorAll('.amb-motes i').length ?? 0,
    inside: !!r && !!c && r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1 && r.width > c.width * 0.85,
    running: a ? getComputedStyle(a.querySelector('.amb-sheen')).animationName : '',
  };
});
console.log('   ' + JSON.stringify(amb));
ok('水墨山河：棋盘上叠着会动的一层', amb.cls.includes('amb-inkland'));
ok('流光（隔几秒扫一遍）在走', amb.sheen && amb.running === 'amb-sheen');
ok('楚河汉界里有水面的粼光、两团薄雾', amb.river && amb.mist === 2);
ok('金粉十几粒', amb.motes >= 10);
ok('这一层贴着棋盘那一块（不出棋盘）', amb.inside);
await page.locator('.xq-boardwrap').screenshot({ path: OUT + '/premium-inkland.png' });
// 点棋盘照样能走（这一层不挡手指）
const pass = await page.evaluate(() => getComputedStyle(document.querySelector('.xq-amb')).pointerEvents);
ok('这一层不挡点棋子', pass === 'none');

// 两边的钟
await until(() => window.__xq?.turn() === 'r' && !window.__xq.state().busy, null, 15000);
await page.waitForTimeout(2200);
const c1 = await page.evaluate(() => ({ me: document.querySelector('.xq-mebox .xq-clock')?.textContent, foe: document.querySelector('.xq-rivalbox .xq-clock')?.textContent, meOn: document.querySelector('.xq-mebox')?.classList.contains('on'), foeOn: document.querySelector('.xq-rivalbox')?.classList.contains('on') }));
console.log('   钟：' + JSON.stringify(c1));
ok('你那一框：执红、实战分、用时', /执红/.test(await page.locator('.xq-mebox').innerText()) && /实战分/.test(await page.locator('.xq-mebox').innerText()));
ok('轮到你：你那一框亮着、你的钟在走', c1.meOn && !c1.foeOn && c1.me !== '00:00');

// 报着法
await page.evaluate(() => window.__xq.play({ fx: 7, fy: 7, tx: 4, ty: 7 }));
ok('走一步：念出"炮二平五"', await until(() => document.documentElement.dataset.xqSaid === 'announce:炮二平五', null, 6000));
ok('对手思考时：对手那一框亮着', await until(() => document.querySelector('.xq-rivalbox')?.classList.contains('on') || window.__xq.turn() === 'r', null, 3000));
ok('对手走的那一步也念', await until(() => (document.documentElement.dataset.xqSaid ?? '').startsWith('announce:') && document.documentElement.dataset.xqSaid !== 'announce:炮二平五', null, 20000));
console.log('   对手那一步：' + (await page.evaluate(() => document.documentElement.dataset.xqSaid)));
// 将军：先报着法，再喊"将军"
await until(() => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
await page.evaluate(() => window.__xq.setBoard('4k4/9/9/9/9/9/9/9/3R5/3K5 w'));
await page.waitForTimeout(400);
const seq = [];
await page.evaluate(() => {
  window.__said = [];
  new MutationObserver(() => window.__said.push(document.documentElement.dataset.xqSaid)).observe(document.documentElement, { attributes: true, attributeFilter: ['data-xq-said'] });
});
await page.evaluate(() => window.__xq.play({ fx: 3, fy: 8, tx: 4, ty: 8 }));
await until(() => window.__said.includes('m-jiangjun'), null, 6000);
seq.push(...(await page.evaluate(() => window.__said)));
console.log('   将军那一步说了：' + seq.join(' → '));
ok('将军：先报"车六平五"，再喊"将军！"', seq.indexOf('announce:车六平五') >= 0 && seq.indexOf('announce:车六平五') < seq.indexOf('m-jiangjun'));

// 默认（没开报着法）：走棋不念
await start({ 'xq-look': INK });
await until(() => window.__xq?.turn() === 'r' && !window.__xq.state().busy, null, 15000);
await page.evaluate(() => { delete document.documentElement.dataset.xqSaid; });
await page.evaluate(() => window.__xq.play({ fx: 7, fy: 7, tx: 4, ty: 7 }));
await page.waitForTimeout(2500);
ok('默认不报着法：走棋不念', !((await page.evaluate(() => document.documentElement.dataset.xqSaid)) ?? '').startsWith('announce:'));

// 关了特效：没有会动的那一层
await start({ 'xq-look': INK, 'xq-fx': '0' });
await page.waitForTimeout(1500);
ok('关了对局特效：棋盘上没有会动的那一层', await page.evaluate(() => !document.querySelector('.xq-amb')?.children.length));

// 普通棋盘：没有
await start({});
await page.waitForTimeout(1500);
ok('普通棋盘（榉木）：不加那一层', await page.evaluate(() => !document.querySelector('.xq-amb')?.children.length));
ok('普通棋盘：对局画面的底是水墨远山', (await page.evaluate(() => document.querySelector('.xq-ink-bg')?.dataset.bg)) === 'ink');

// ───────── 水墨以外的四套典藏：各有各会动的东西，画面的底跟着换 ─────────
const NEW = {
  xinghe: { look: { board: 'xinghe', piece: 'glass', font: 'xiaowei', trad: false }, sel: ['.amb-stars b', '.amb-meteor'], name: '星河夜弈：星星眨眼、流星' },
  neon: { look: { board: 'neon', piece: 'neon', font: 'hei', trad: false }, sel: ['.amb-scan', '.amb-river .amb-pulse'], name: '霓虹赛博：扫描线、河边跑的光' },
  fenghuo: { look: { board: 'fenghuo', piece: 'bronze', font: 'mashan', trad: false }, sel: ['.amb-embers i', '.amb-river .amb-ripple'], name: '烽火沙场：火星往上飞、河里的火' },
  dunhuang: { look: { board: 'dunhuang', piece: 'lacquer', font: 'mashan', trad: false }, sel: ['.amb-petals i', '.amb-motes i'], name: '敦煌飞天：花瓣往下飘、金粉' },
};
for (const [id, t] of Object.entries(NEW)) {
  await start({ 'xq-look': JSON.stringify(t.look) });
  await page.waitForTimeout(2600);
  const r = await page.evaluate(([id, sel]) => ({
    cls: document.querySelector('.xq-amb')?.className ?? '',
    has: sel.map((s) => document.querySelectorAll(s).length),
    anim: sel.map((s) => (document.querySelector(s) ? getComputedStyle(document.querySelector(s)).animationName : '')),
    bg: document.querySelector('.xq-ink-bg')?.dataset.bg,
    live: document.querySelectorAll('.xq-ink-bg svg').length,
  }), [id, t.sel]);
  console.log(`   ${id}: ${JSON.stringify(r)}`);
  ok(`${t.name}（都在动）`, r.cls.includes(`amb-${id}`) && r.has.every((n) => n > 0) && r.anim.every((a) => a && a !== 'none'));
  ok(`${id}：对局画面的底换成这一套的（底图一张、会动的一张）`, r.bg === id && r.live === 2);
  await page.screenshot({ path: `${OUT}/premium-${id}.png` });
}
// 对局里点 🎨 换下一套（敦煌飞天的下一套是"清晰护眼"）：底当场换回水墨远山（不用重进）
await page.locator('#xq-look').click(); await page.waitForTimeout(600);
ok('对局里换到普通棋盘：底当场换回水墨远山', (await page.evaluate(() => document.querySelector('.xq-ink-bg')?.dataset.bg)) === 'ink');

// ───────── 出场：黑边、亮相一招、对阵 ─────────
await start({ 'xq-hero': 'shaoshuai' });
ok('出场：少帅', await until(() => document.querySelector('.xqh')?.dataset.hero === 'shaoshuai', null, 2000));
ok('出场：亮相那一招（一道光）', (await page.locator('.xqh-slash path, .xqh-slash circle').count()) === 1);
ok('出场：写着"对阵 · 对手"', /对阵 · .+ · /.test((await page.locator('.xqh-vs').textContent()) ?? ''));
ok('出场：喊开场白', await until(() => /^hero-shaoshuai-[1-5]$/.test(document.documentElement.dataset.xqSaid ?? ''), null, 4000));
await page.waitForTimeout(1300);
await page.screenshot({ path: OUT + '/premium-hero.png' });

// 样式页：报着法的开关
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
await page.locator('[data-home="look"]').click(); await page.waitForTimeout(800);
ok('样式页有"报着法"开关，默认关着', !(await page.locator('[data-act="announce-toggle"] input').isChecked()));
await page.locator('[data-act="announce-toggle"] input').check();
ok('打开：当场念一声"炮二平五"试听', await until(() => document.documentElement.dataset.xqSaid === 'announce:炮二平五', null, 6000));
ok('打开：记下了', (await page.evaluate(() => localStorage.getItem('xq-announce'))) === '1');
await page.locator('[data-act="announce-toggle"] input').uncheck();
ok('关掉：记下了', (await page.evaluate(() => localStorage.getItem('xq-announce'))) === '0');

// 音量：配乐、配音分开调
ok('样式页有配乐、配音两个音量滑块', (await page.locator('.xq-look-vols input[type=range]').count()) === 2);
await page.locator('[data-act="vol-music"] input').fill('40');
ok('配乐音量记下了（四成）', (await page.evaluate(() => localStorage.getItem('xq-vol-music'))) === '0.4');
await page.locator('[data-act="vol-voice"] input').fill('70');
ok('配音音量记下了（七成）', (await page.evaluate(() => localStorage.getItem('xq-vol-voice'))) === '0.7');

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
