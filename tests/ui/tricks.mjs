/**
 * 邪门布局破解：学棋里能找到、能看套路和上当、能自己走一遍破解；
 * 对局里选"邪门布局"对手会走套路，教练当场点破并说出破解，破解那一手不拦、求助里以它领衔。
 * 用法：npm run dev，然后 node tests/ui/tricks.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(150); }
  return false;
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

// ───────── 1. 学棋：找得到、看得懂、自己破一遍 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-power', 'save'); localStorage.setItem('xq-hint-level', '2'); localStorage.removeItem('xq-tricks-done'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
await page.evaluate((m) => window.__xqCoach.menu(m), 'opening'); await page.waitForTimeout(300);
await page.getByText('🗡 江湖布局破解').first().click(); await page.waitForTimeout(500);
const cards = await page.locator('[data-trick]').count();
console.log(`   套路：${cards} 条`);
ok('私教 › 布局 里找得到江湖布局破解，列出了套路', cards >= 8);
await page.locator('[data-trick="jijin-zhongbing"]').click(); await page.waitForTimeout(300);
const detail = (await page.locator('.xq-coach-report').innerText()).replace(/\s+/g, ' ');
console.log('   详情：' + detail.slice(0, 200));
ok('详情讲了套路、破解、道理和引擎复核', detail.includes('它在赌什么') && detail.includes('炮2平5') && detail.includes('引擎复核'));
const led = (await page.locator('[data-ledger]').innerText()).replace(/\s+/g, ' ');
console.log('   账本：' + led.slice(0, 160));
ok('有"宁失一子，不失一先"的账本：精髓 + 子力/局面分曲线', led.includes('宁失一子') && led.includes('空头炮') && (await page.locator('[data-ledger] svg path.ev').count()) === 1);
await page.screenshot({ path: OUT + '/tricks-detail.png' });

// 看上当会怎样
await page.locator('[data-act="trick-trap"]').click(); await page.waitForTimeout(300);
let warned = false;
for (let i = 0; i < 12; i++) {
  const b = page.locator('#rp-next'); if (!(await b.count())) break; await b.click(); await page.waitForTimeout(120);
  if ((await page.evaluate(() => window.__xqReplay.say())).includes('坑')) warned = true;
}
const trapSay = await page.locator('.xq-rp-trail').innerText();
ok('上当那一段走得通（顶卒 → 空头炮 → 双炮叠中）', trapSay.includes('卒5进1') && trapSay.includes('炮五进三') && trapSay.includes('炮八平五'));
ok('上当那一步当场点出来："坑：这里该走……"', warned);
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// 你来破解
await page.locator('[data-act="trick-guess"]').click(); await page.waitForTimeout(300);
const trail0 = await page.locator('.xq-rp-trail').innerText();
ok('套路那几手已经摆好（不用你猜）', trail0.includes('兵五进一'));
await page.locator('#rp-next').click(); await page.waitForTimeout(200);
ok('轮到你破解', await page.evaluate(() => window.__xqReplay.waiting()));
await page.evaluate(() => window.__xqReplay.guess('炮2平5'));
await page.waitForTimeout(200);
const say1 = await page.evaluate(() => window.__xqReplay.say());
console.log('   你走 炮2平5：' + say1.slice(0, 60));
ok('走对了', say1.includes('猜对了'));
// 破解谱现在走十几个回合（人写的几手 + 皮卡鱼延伸）：后面照谱一手一手走完
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.__xqReplay.waiting())) {
    await page.evaluate(() => window.__xqReplay.guess(window.__xqReplay.expected()));
  } else {
    const b = page.locator('#rp-next');
    if (!(await b.count())) break;
    await b.click();
  }
  await page.waitForTimeout(150);
}
ok('全对之后记为"已破"', await until(page, () => (localStorage.getItem('xq-tricks-done') ?? '').includes('jijin-zhongbing'), null, 3000));
await page.screenshot({ path: OUT + '/tricks-guess.png' });

// ───────── 1b. 铁滑车：送的马该吃，坑在第二关 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
await page.evaluate((m) => window.__xqCoach.menu(m), 'opening'); await page.waitForTimeout(300);
await page.getByText('🗡 江湖布局破解').first().click(); await page.waitForTimeout(500);
const listText = await page.locator('.xq-coach-report').innerText();
ok('列表里有弃马十三着、敢死炮、铁滑车、急进中兵、叠炮、瞎眼狗、龟背炮', ['弃马十三着', '敢死炮', '铁滑车', '双铁滑车', '急进中兵', '叠炮', '瞎眼狗', '龟背炮'].every((n) => listText.includes(n)));
ok('原来那些"炮打中卒"不再算邪门布局', !listText.includes('开局炮打中卒') && !listText.includes('炮打底马') && !listText.includes('炮打中兵将军'));
ok('铁滑车标着"两关"', (await page.locator('[data-trick="tiehuache"]').innerText()).includes('两关'));
await page.locator('[data-trick="tiehuache"]').click(); await page.waitForTimeout(300);
const gs = (await page.locator('.xq-coach-report').innerText()).replace(/\s+/g, ' ');
console.log('   铁滑车：' + gs.slice(0, 260));
ok('铁滑车详情：第一步吃（炮8进7），第二关先躲（炮8平9）', gs.includes('炮8进7') && gs.includes('第二关') && gs.includes('炮8平9'));
ok('每一手的意思讲出来了：车一进一是故意送马', gs.includes('每一手的意思') && gs.includes('故意送的'));
const led2 = (await page.locator('[data-ledger]').innerText()).replace(/\s+/g, ' ');
console.log('   账本：' + led2.slice(0, 220));
ok('账本算出了先手的价钱：子力少了多少、局面分落后多少、差多少', /少了 \d+\.\d 个兵/.test(led2) && led2.includes('先手'));
const ana = (await page.locator('[data-anatomy]').innerText()).replace(/\s+/g, ' ');
console.log('   陷阱拆解：' + ana.slice(0, 160));
ok('陷阱拆解：表面上、陷阱在哪、上当之后、怎么认出来都在', ['表面上', '陷阱在哪', '上当之后', '怎么认出来'].every((k) => ana.includes(k)) && ana.includes('车二退一'));
ok('坑在哪几步（深算标出来的）和其它常见错着（贪吃仕）都列了', (await page.locator('[data-pitfalls] li').count()) >= 1 && ana.includes('炮8平6'));
ok('讲了破了之后他会怎么走', gs.includes('破了之后他会怎么走'));
await page.screenshot({ path: OUT + '/tricks-tiehuache.png', fullPage: true });
await page.locator('[data-act="trick-trap"]').click(); await page.waitForTimeout(300);
ok('上当演示先说明"前面是对的，坑在后面"', (await page.locator('.xq-coach-stage').innerText()).includes('坑在后面'));
for (let i = 0; i < 12; i++) { const b = page.locator('#rp-next'); if (!(await b.count())) break; await b.click(); await page.waitForTimeout(120); }
const gsTrap = await page.locator('.xq-rp-trail').innerText();
ok('上当那一段：吃了马、只顾出子、被车吃回', gsTrap.includes('炮8进7') && gsTrap.includes('卒3进1') && gsTrap.includes('车二退一'));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
await page.locator('[data-act="trick-guess"]').click(); await page.waitForTimeout(300);
const answers = ['炮8进7', '马8进7', '炮8平9'];
let got = 0;
let mine = 0;
for (let i = 0; i < 60; i++) {
  if (await page.evaluate(() => window.__xqReplay.waiting())) {
    // 前三手是两关的要点，自己写死；后面是皮卡鱼延伸的十来手，照谱走完。
    // 最后一手猜完先看这一手的讲解，再点"看总结 →"收尾——对不对看最后有没有记为"已破"（要每手都对）
    const m = got < answers.length ? answers[got] : await page.evaluate(() => window.__xqReplay.expected());
    if (got < answers.length && (await page.evaluate(() => window.__xqReplay.expected())) !== m) break;
    if (!(await page.evaluate((x) => window.__xqReplay.guess(x), m))) break;
    if (got < answers.length) got++;
    mine++;
    await page.waitForTimeout(150);
  } else {
    const b = page.locator('#rp-next');
    if (!(await b.count())) break;
    await b.click();
    await page.waitForTimeout(150);
  }
}
console.log(`   铁滑车破解一共走了 ${mine} 手`);
ok('两关都自己走对（炮8进7 → 马8进7 → 炮8平9），破解谱走到底（十手以上），记为"已破"', got === 3 && mine >= 10 && (await until(page, () => (localStorage.getItem('xq-tricks-done') ?? '').includes('tiehuache'), null, 3000)));

// ───────── 2. 对局：对手走邪门布局，教练点破，破解那一手不拦 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(300);
await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
await page.locator('[data-tricky="1"]').click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(800);
ok('设置记住了"邪门布局"', (await page.evaluate(() => localStorage.getItem('xq-tricky'))) === '1');
// 你走 炮二平五、马二进三、车一平二、车二进六：黑方的三条套路（铁滑车、敢死炮、龟背炮）都从这几步里长出来
let hit = '';
for (const t of ['炮二平五', '马二进三', '车一平二', '车二进六']) {
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
  const line = await page.evaluate(() => window.__xq.coachLine());
  // 认的是教练点破的那句话（"对方走的是邪门布局「…」"）；教练行平时也会挂"📖 邪门布局「…」"布局名，那不算
  if (line.includes('对方走的是邪门布局')) { hit = line; break; }
  const legal = await page.evaluate(() => window.__xq.legal());
  const mv = await page.evaluate(([ms, tx]) => ms.find((m) => window.__xq.textOf(m) === tx) ?? null, [legal, t]);
  if (!mv) { console.log('   走不了 ' + t + '（对手走出了别的）'); break; }
  await page.evaluate((m) => window.__xq.play(m), mv);
  await page.waitForTimeout(400);
  if (await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'))) await page.locator('.xq-tip [data-act="go"]').first().click();
}
if (!hit) {
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
  hit = await page.evaluate(() => window.__xq.coachLine());
}
console.log('   教练：' + hit);
ok('对手走了邪门套路，教练当场点破并说出破解', hit.includes('邪门布局') && hit.includes('破解'));
await page.screenshot({ path: OUT + '/tricks-game.png' });

// 求助：破解领衔
await until(page, () => (window.__xq.study()?.depth ?? 0) >= 10, null, 20000);
await page.locator('#xq-best').click();
await until(page, () => (document.querySelector('.xq-besthint')?.textContent ?? '').includes('破解'), null, 10000);
const panel = (await page.locator('.xq-besthint').innerText()).replace(/\s+/g, ' ');
console.log('   求助：' + panel.slice(0, 160));
ok('求助里以破解着法领衔', panel.includes('破解「'));
await page.locator('.xq-besthint [data-act="close"]').click();

// 走破解那一手：教练不拦
const name = hit.match(/「(.+?)」/)?.[1];
const [refute, trickMove] = await page.evaluate(async (n) => {
  const T = await import('/Life/src/xiangqi/tricks.ts');
  const t = T.TRICKS.find((x) => x.name === n);
  return [t?.refute[0].t ?? null, t?.trick.t ?? null];
}, name);
const before = await page.evaluate(() => window.__xq.moves().length);
const mv = await page.evaluate((tx) => window.__xq.legal().find((m) => window.__xq.textOf(m) === tx) ?? null, refute);
await page.evaluate((m) => window.__xq.play(m), mv);
await page.waitForTimeout(600);
const tipped = await page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost)'));
ok(`走破解 ${refute}：教练不拦，直接走了`, !tipped && (await page.evaluate(() => window.__xq.moves().length)) > before);

// 复盘：你那一手标着"破解成功"
await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
await page.locator('#xq-resign').click();
await page.locator('.xq-confirm [data-act="yes"]').click();
await page.waitForTimeout(800);
await page.getByText('复盘这一局').click();
await until(page, (n) => document.querySelectorAll('.xq-rv-item').length > n, before, 60000);
await page.locator('.xq-rv-item').nth(before).click();
await page.waitForTimeout(300);
const rv = (await page.locator('.xq-rv-detail').innerText()).replace(/\s+/g, ' ');
console.log('   复盘：' + rv.slice(0, 120));
ok('复盘里你那一手标着"破解成功"', rv.includes('破解成功'));
// 复盘列表点一手之后会围着这一手重排，不能再按序号点：按对方那一手邪门着的记谱找
// 分析还在跑的时候列表会重画，按位置点会点到别的一手：在页面里按记谱找到那一手直接点
await page.evaluate((t) => [...document.querySelectorAll('.xq-rv-item')].find((b) => b.querySelector('.t')?.textContent === t)?.click(), trickMove);
await page.waitForTimeout(300);
const rvTrick = (await page.locator('.xq-rv-detail').innerText()).replace(/\s+/g, ' ');
console.log(`   复盘·对方那一手：${rvTrick.slice(0, 140)}`);
if (!rvTrick.includes('邪门布局')) console.log('   复盘列表：' + (await page.$$eval('.xq-rv-item', (els) => els.map((e) => `${e.dataset.i}:${e.querySelector('.t')?.textContent}`).join(' '))));
ok(`复盘里对方那一手（${trickMove}）标着邪门布局`, rvTrick.includes('邪门布局'));
await page.screenshot({ path: OUT + '/tricks-review.png' });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
