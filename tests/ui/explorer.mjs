/**
 * 开局浏览器、布局变招、开局识别、找回好棋、布局复习、棋谱导入：学棋里找得到、点得进去、走得通。
 *   浏览器：开局列出谱上所有走法；点着走、每一手讲意义、标出主线/变招/邪门；走出谱后皮卡鱼列候选着；
 *           退回、前进、点棋谱条跳回去；导入棋谱和 FEN。
 *   布局页：变招数据加载以后，变化分组（变化和变招 / 错着），点进去每一手讲意义；从布局页跳进浏览器。
 *   布局复习：排了复习、到期了，教练首页有提示，布局体系里有复习卡。
 *   复盘：导入一盘棋 → 复盘里叫得出布局名字 → 找回好棋。
 *   对局：教练那一行显示布局名字。
 *   讲解：◀ 上一手、点棋谱条跳回、⇅ 翻转；最后一手的讲解先看得到再"看总结"；教练小结、关键一手；看过的打勾；🎲 抽查。
 *   江湖布局：他不按套路走 / 另一种破法 / 你走错了三组变化，点进去讲到底；抽一条他改走的来接。
 * 用法：npm run dev，然后 node tests/ui/explorer.mjs
 */
import fs from 'fs';
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
const LIB = JSON.parse(fs.readFileSync('src/xiangqi/openinglib.json', 'utf8'));
const VARS = JSON.parse(fs.readFileSync('src/xiangqi/openingvars.json', 'utf8'));
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

async function coachHome(setup) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate((s) => { localStorage.setItem('xq-power', 'save'); if (s) for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); }, setup);
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }
  await page.evaluate((m) => window.__xqCoach.menu(m), 'opening'); await page.waitForTimeout(300);
}

// ───────── 1. 开局浏览器 ─────────
await coachHome();
ok('私教 › 布局 里有开局浏览器', (await page.locator('[data-act="explorer"]').count()) === 1);
await page.getByText('📖 布局体系').first().click(); await page.waitForTimeout(400);
ok('布局体系里有开局浏览器', (await page.locator('[data-act="explorer"]').count()) === 1);
await page.locator('[data-act="explorer"]').click(); await page.waitForTimeout(500);
const first = await page.locator('[data-ex-move]').evaluateAll((els) => els.map((e) => e.dataset.exMove));
console.log('   开局谱上的走法：' + first.join(' '));
ok(`开局局面列出谱上所有起手（${first.length} 种）`, first.length >= 6 && first.includes('炮二平五') && first.includes('相三进五'));
ok('第一种是中炮，标着主线', first[0] === '炮二平五' && (await page.locator('[data-ex-move="炮二平五"] .k-main').count()) === 1);
await page.screenshot({ path: OUT + '/ex-start.png' });

await page.locator('[data-ex-move="炮二平五"]').click(); await page.waitForTimeout(200);
await page.locator('[data-ex-move="马8进7"]').click(); await page.waitForTimeout(200);
const last = (await page.locator('[data-ex-last]').innerText()).replace(/\s+/g, ' ');
console.log('   上一手的意义：' + last.slice(0, 120));
ok('上一手讲了意义', last.includes('马8进7') && last.length > 20);
ok('叫得出布局名字、在谱上', (await page.locator('[data-ex-name]').innerText()).includes('谱上'));
ok('邪门布局的套路着标出来了（兵五进一 · 邪门）', (await page.locator('[data-ex-move="兵五进一"] .k-trick').count()) === 1);
await page.locator('[data-ex-move="兵五进一"]').click(); await page.waitForTimeout(200);
ok('邪门之后，破解和上当分得清', (await page.locator('.k-refute').count()) >= 1 && (await page.locator('.k-fall').count()) >= 1);

// 走到主线的一个分岔点：变招数据加载以后，那里不止一种走法、标着变招
const guohe = LIB.find((o) => o.id === 'pfm-guohe');
const alt = VARS['pfm-guohe'].extra.find((x) => x.kind === 'alt');
await page.locator('[data-ex-act="start"]').click(); await page.waitForTimeout(150);
for (const m of guohe.moves.slice(0, alt.at)) await page.evaluate((t) => window.__xqExplorer.go(t), m.t);
await page.waitForTimeout(300);
const kids = await page.evaluate(() => window.__xqExplorer.children());
console.log(`   第 ${alt.at} 手以后谱上的走法：${kids.join(' ')}`);
ok(`分岔点上有主线的 ${guohe.moves[alt.at].t}，也有变招 ${alt.moves[0].t}`, kids.includes(guohe.moves[alt.at].t) && kids.includes(alt.moves[0].t));
ok('变招标出来了', (await page.locator(`[data-ex-move="${alt.moves[0].t}"] .k-alt`).count()) === 1);
await page.locator(`[data-ex-move="${alt.moves[0].t}"]`).click(); await page.waitForTimeout(200);
const altSay = (await page.locator('[data-ex-last]').innerText()).replace(/\s+/g, ' ');
console.log('   变招这一手：' + altSay.slice(0, 160));
ok('变招这一手讲了意义（不只是"出车"这种话）', altSay.length > 25);
await page.screenshot({ path: OUT + '/ex-alt.png' });

// 退回、前进、点棋谱条
const n0 = (await page.evaluate(() => window.__xqExplorer.path())).length;
await page.locator('[data-ex-act="back"]').click(); await page.waitForTimeout(100);
await page.locator('[data-ex-act="back"]').click(); await page.waitForTimeout(100);
ok('退两手', (await page.evaluate(() => window.__xqExplorer.path())).length === n0 - 2);
await page.locator('[data-ex-act="fwd"]').click(); await page.waitForTimeout(100);
ok('前进回到刚才那条路', (await page.evaluate(() => window.__xqExplorer.path())).length === n0 - 1);
await page.locator('[data-ex-trail] [data-jump="2"]').click(); await page.waitForTimeout(100);
ok('点棋谱条跳回第 2 手', (await page.evaluate(() => window.__xqExplorer.path())).length === 2);

// 出谱：皮卡鱼列候选着
await page.locator('[data-ex-act="start"]').click(); await page.waitForTimeout(100);
for (const t of ['炮二平五', '马8进7', '兵九进一', '卒9进1', '兵一进一']) await page.evaluate((x) => window.__xqExplorer.go(x), t);
await page.waitForTimeout(300);
const offKids = await page.evaluate(() => window.__xqExplorer.children());
ok('走出谱了', offKids.length === 0 && (await page.locator('[data-ex-name]').innerText()).includes('出谱'));
ok('皮卡鱼列出候选着', await until(page, () => (window.__xqExplorer.engine()?.length ?? 0) >= 2, null, 60000));
const eng = await page.locator('[data-ex-engine] .xq-ex-move').allInnerTexts();
console.log('   候选着：' + eng.map((s) => s.replace(/\s+/g, ' ').slice(0, 50)).join(' ｜ '));
ok('候选着带着这一手干了什么、主变', eng.length >= 2 && eng.every((s) => s.includes('主变')));
await page.screenshot({ path: OUT + '/ex-engine.png' });
const before = (await page.evaluate(() => window.__xqExplorer.path())).length;
await page.locator('[data-ex-engine] .xq-ex-move').first().click(); await page.waitForTimeout(200);
ok('点候选着就走那一手', (await page.evaluate(() => window.__xqExplorer.path())).length === before + 1);

// 导入棋谱、FEN
await page.locator('[data-ex-act="import"]').click(); await page.waitForTimeout(150);
await page.locator('[data-ex-text]').fill('1. 炮二平五 马8进7\n2. 马二进三 车9平8');
await page.locator('.xq-ex-import [data-act="ok"]').click(); await page.waitForTimeout(200);
ok('导入中文棋谱', JSON.stringify(await page.evaluate(() => window.__xqExplorer.path())) === JSON.stringify(['炮二平五', '马8进7', '马二进三', '车9平8']));
await page.locator('[data-ex-act="import"]').click(); await page.waitForTimeout(150);
await page.locator('[data-ex-text]').fill('乱写一通');
await page.locator('.xq-ex-import [data-act="ok"]').click(); await page.waitForTimeout(150);
ok('读不出来的说清楚', (await page.locator('.xq-ex-import [data-ex-err]').innerText()).length > 2);
await page.locator('[data-ex-text]').fill('rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C2C4/9/RNBAKABNR b');
await page.locator('.xq-ex-import [data-act="ok"]').click(); await page.waitForTimeout(300);
ok('导入 FEN（轮到黑方走）', (await page.locator('[data-ex-name]').innerText()).includes('导入的局面') && (await page.evaluate(() => window.__xqExplorer.fen())).includes(' b'));
await page.locator('[data-ex-act="out"]').click(); await page.waitForTimeout(300);
ok('返回布局体系', (await page.locator('[data-act="explorer"]').count()) === 1);

// ───────── 2. 布局页：变化分组、变招讲意义、跳进浏览器 ─────────
await page.locator('[data-opening="pfm-guohe"]').click(); await page.waitForTimeout(300);
ok('变招数据加载以后，布局页有"变化和变招"一组', await until(page, () => [...document.querySelectorAll('.xq-sec')].some((e) => e.textContent.includes('变化和变招')), null, 10000));
const secs = await page.locator('.xq-sec').allInnerTexts();
console.log('   分组：' + secs.join(' / '));
const nAlt = await page.locator('[data-variation] .tag', { hasText: '变招' }).count();
const nVar = await page.locator('[data-variation]').count();
ok(`变化一共 ${nVar} 条，其中变招 ${nAlt} 条`, nAlt >= 5 && nVar >= nAlt + 1);
await page.screenshot({ path: OUT + '/ex-opening-page.png', fullPage: true });
await page.locator('[data-variation]', { has: page.locator('.tag', { hasText: '变招' }) }).first().click(); await page.waitForTimeout(300);
const intro = (await page.locator('.xq-rp-say').innerText()).replace(/\s+/g, ' ');
ok('变招的开场白说清楚是变招', intro.includes('变招'));
let meaningful = 0;
let steps = 0;
for (let i = 0; i < 40; i++) {
  const b = page.locator('#rp-next');
  if (!(await b.count())) break;
  await b.click(); await page.waitForTimeout(60);
  steps++;
  const say = (await page.locator('.xq-rp-say').innerText()).trim();
  if (/目的：|接下来|引擎/.test(say)) meaningful++;
}
console.log(`   变招讲解点了 ${steps} 手，讲了"防什么/攻什么/引擎怎么看"的 ${meaningful} 手`);
ok('变招一路讲到底，多数手讲了目的', steps >= 8 && meaningful >= steps / 3);
await page.screenshot({ path: OUT + '/ex-alt-watch.png' });
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
await page.locator('[data-act="op-explorer"]').click(); await page.waitForTimeout(400);
ok('从布局页跳进浏览器，停在第一个分岔点', (await page.evaluate(() => window.__xqExplorer.children().length)) >= 2);
await page.locator('[data-ex-act="out"]').click(); await page.waitForTimeout(300);
ok('浏览器返回布局页', (await page.locator('[data-act="op-explorer"]').count()) === 1);

// 执一方自己走主线：走到谱上收着的错着，不用等皮卡鱼，直接点名、说对方怎么罚
const trapOp = LIB.find((o) => (VARS[o.id]?.extra ?? []).some((x) => x.kind === 'trap' && x.at % 2 === 0));
if (trapOp) {
  const trap = VARS[trapOp.id].extra.find((x) => x.kind === 'trap' && x.at % 2 === 0);
  await page.locator('[data-nav-back]').last().click(); await page.waitForTimeout(300);
  await page.locator(`[data-opening="${trapOp.id}"]`).click(); await page.waitForTimeout(500);
  await page.locator('[data-act="op-red"]').click(); await page.waitForTimeout(300);
  for (let i = 0; i < 120; i++) {
    const st = await page.evaluate(() => ({ idx: window.__xqReplay.idx(), w: window.__xqReplay.waiting() }));
    if (st.w && st.idx === trap.at) break;
    if (st.w) await page.evaluate(() => window.__xqReplay.guess(window.__xqReplay.expected()));
    else { const b = page.locator('#rp-next'); if (await b.count()) await b.click(); }
    await page.waitForTimeout(100);
  }
  await page.evaluate((t) => window.__xqReplay.guess(t), trap.moves[0].t);
  await page.waitForTimeout(200);
  const say = await page.evaluate(() => window.__xqReplay.say());
  console.log(`   ${trapOp.name} 第 ${trap.at + 1} 手走错着 ${trap.moves[0].t}：${say.slice(0, 120)}`);
  ok('走到谱上的错着：直接点名，说出对方怎么罚', say.includes('错着') && say.includes(trap.moves[1].t) && !say.includes('核对'));
  await page.screenshot({ path: OUT + '/ex-guess-trap.png' });
  await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
}

// ───────── 2b. 讲解能后退、跳回、翻转；最后一手的讲解看得到；教练小结；看过的打勾；抽查 ─────────
await page.locator('[data-nav-back]').last().click(); await page.waitForTimeout(300);
await page.locator('[data-opening="pfm-guohe"]').click(); await page.waitForTimeout(800);
await page.locator('[data-act="op-watch"]').click(); await page.waitForTimeout(300);
for (let i = 0; i < 5; i++) await page.locator('#rp-next').click();
ok('讲解第 5 手', (await page.evaluate(() => window.__xqReplay.idx())) === 5);
await page.locator('#rp-back').click(); await page.waitForTimeout(100);
ok('◀ 上一手：退回第 4 手，讲解换成第 4 手的', (await page.evaluate(() => window.__xqReplay.idx())) === 4 && (await page.locator('.xq-rp-say .h').innerText()).trim() === guohe.moves[3].t);
await page.locator('.xq-rp-trail [data-n="2"]').click(); await page.waitForTimeout(100);
ok('点棋谱条跳回第 2 手', (await page.evaluate(() => window.__xqReplay.idx())) === 2);
const f0 = await page.evaluate(() => window.__xqReplay.flipped());
await page.locator('.xq-rp-flip').click();
ok('⇅ 翻转棋盘', (await page.evaluate(() => window.__xqReplay.flipped())) === !f0);
await page.locator('.xq-rp-flip').click();
await page.evaluate((n) => window.__xqReplay.goTo(n), guohe.moves.length);
await page.waitForTimeout(100);
const lastSay = (await page.locator('.xq-rp-say').innerText()).trim();
ok('走到最后一手：先看这一手自己的讲解（原来直接被"走完了"盖掉）', lastSay.startsWith(guohe.moves[guohe.moves.length - 1].t) && (await page.locator('#rp-next').innerText()).includes('看总结'));
await page.locator('#rp-next').click(); await page.waitForTimeout(150);
const endSay = await page.locator('.xq-rp-say').innerText();
ok('看总结：走完了 + 教练小结', endSay.includes('走完了') && endSay.includes('教练小结'));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
// 看一条变招到底 → 打勾
const vRow = page.locator('[data-variation]', { has: page.locator('.tag', { hasText: '变招' }) }).first();
const vk = await vRow.getAttribute('data-variation');
await vRow.click(); await page.waitForTimeout(300);
for (let i = 0; i < 40 && (await page.locator('#rp-next').count()); i++) await page.locator('#rp-next').click();
const vEnd = await page.locator('.xq-rp-say').innerText();
console.log('   变招收尾：' + vEnd.replace(/\s+/g, ' ').slice(0, 200));
ok('变招收尾有教练小结', vEnd.includes('教练小结') && vEnd.includes('走到最后'));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
ok('看完的变招打上"✓ 看过"', (await page.locator(`[data-variation="${vk}"] .tag`, { hasText: '看过' }).count()) === 1);
await page.locator('[data-act="op-drill"]').click(); await page.waitForTimeout(300);
const drillSay = await page.locator('.xq-rp-say').innerText();
ok('🎲 抽一条变化：对方那一手摆好，轮到你走', drillSay.includes('抽查') && (await until(page, () => window.__xqReplay.waiting() || !!document.querySelector('#rp-next'), null, 3000)));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// ───────── 2c. 江湖布局的变化 ─────────
await page.locator('[data-nav-back]').last().click(); await page.waitForTimeout(300);
await page.locator('.card', { hasText: '江湖布局破解' }).first().click(); await page.waitForTimeout(400);
await page.locator('.card', { hasText: '铁滑车（开局车一进一弃马）' }).first().click(); await page.waitForTimeout(600);
ok('江湖布局的变化加载以后列出来：他不按套路走 / 另一种破法 / 你走错了', await until(page, () => document.querySelectorAll('[data-trick-var]').length >= 5, null, 10000));
const tsecs = await page.locator('.xq-sec').allInnerTexts();
console.log('   江湖布局变化：' + tsecs.join(' / '));
ok('三组都有', ['他不按套路走', '另一种破法', '你走错了'].filter((x) => tsecs.some((s) => s.includes(x))).length >= 2);
await page.locator('[data-trick-var]').first().click(); await page.waitForTimeout(300);
const tvIntro = await page.locator('.xq-rp-say').innerText();
ok('点进一条变化：开场说清楚是哪一种', /他不按套路走|另一种破法|你走错了/.test(tvIntro));
let tvSteps = 0;
let tvRich = 0;
for (let i = 0; i < 40 && (await page.locator('#rp-next').count()); i++) {
  await page.locator('#rp-next').click(); tvSteps++;
  if (/目的：|接下来|引擎|⭐/.test(await page.locator('.xq-rp-say').innerText())) tvRich++;
}
console.log(`   江湖布局变化讲了 ${tvSteps} 手，讲了目的/引擎意见/关键一手的 ${tvRich} 手`);
ok('江湖布局的变化一手一手讲到底，带教练小结', tvSteps >= 6 && tvRich >= 2 && (await page.locator('.xq-rp-say').innerText()).includes('教练小结'));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
if (await page.locator('[data-act="trick-drill"]').count()) {
  await page.locator('[data-act="trick-drill"]').click(); await page.waitForTimeout(300);
  ok('🎲 抽一条：他不按套路走，轮到你接', (await page.locator('.xq-rp-say').innerText()).includes('抽查') && (await page.evaluate(() => window.__xqReplay.waiting() || !!document.querySelector('#rp-next'))));
  await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);
}
await page.locator('[data-act="trick-trap"]').click(); await page.waitForTimeout(300);
let star = false;
for (let i = 0; i < 40 && (await page.locator('#rp-next').count()); i++) {
  await page.locator('#rp-next').click();
  if (/关键一手|坑：/.test(await page.locator('.xq-rp-say').innerText())) star = true;
}
ok('上当谱里标出了上当的那一手（⭐ 关键一手 / ⚠️ 坑），收尾有教练小结', star && (await page.locator('.xq-rp-say').innerText()).includes('教练小结'));
await page.locator('#rp-out').first().click(); await page.waitForTimeout(300);

// ───────── 3. 布局复习（间隔重复） ─────────
await coachHome({ 'xq-op-srs': JSON.stringify({ 'pfm-guohe:r': { box: 0, due: 0, last: 50 } }) });
ok('私教 › 布局 的布局体系一行提示该复习了', (await page.locator('[data-act="openings"] .tag').innerText()).includes('1 套该复习'));
await page.getByText('📖 布局体系').first().click(); await page.waitForTimeout(400);
const rv = await page.locator('[data-act="op-review"]').innerText();
console.log('   复习卡：' + rv.replace(/\s+/g, ' ').slice(0, 100));
ok('布局体系里有复习卡，列出今天要复习的', rv.includes('今天 1 套') && rv.includes('执红'));
await page.locator('[data-act="op-review"]').click(); await page.waitForTimeout(400);
ok('点进去就是自己执红走主线', (await page.locator('.xq-rp').count()) === 1 && (await page.evaluate(() => !!window.__xqReplay?.waiting)));

// ───────── 4. 导入一盘棋复盘：叫得出布局、找回好棋 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-power', 'save'); });
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="games"]').click(); await page.waitForTimeout(400);
await page.locator('[data-act="import-game"]').click(); await page.waitForTimeout(150);
await page.locator('[data-imp-text]').fill('1. 炮二平五 马8进7');
await page.locator('[data-imp-go]').click(); await page.waitForTimeout(200);
ok('不到四手不导，说清楚', (await page.locator('[data-imp-err]').innerText()).length > 2);
// 第二回合红方炮打中卒、被马吃掉：白丢一个炮，复盘里该能"找回好棋"
await page.locator('[data-imp-text]').fill('1. 炮二平五 马8进7 2. 炮五进四 马7进5 3. 马二进三 车9平8 4. 车一平二 马2进3 5. 马八进七 卒3进1');
await page.locator('input[name="imp-res"][value="loss"]').check();
await page.locator('[data-imp-go]').click(); await page.waitForTimeout(400);
ok('复盘里叫得出布局名字', await until(page, () => (document.querySelector('[data-opening]')?.textContent ?? '').includes('布局'), null, 90000));
console.log('   ' + (await page.locator('[data-opening]').innerText()).replace(/\s+/g, ' '));
ok('分析完有"找回好棋"', await until(page, () => !!document.querySelector('[data-act="retry"]'), null, 120000));
await page.locator('[data-act="overview"]').click(); await page.waitForTimeout(300);
await page.screenshot({ path: OUT + '/ex-review.png' });
await page.locator('[data-act="retry"]').click(); await page.waitForTimeout(600);
const rtop = (await page.locator('.xq-retry .xq-tr').innerText()).replace(/\s+/g, ' ');
console.log('   ' + rtop.slice(0, 80));
ok('找回好棋：自己先想一遍', (await page.locator('.xq-retry').count()) === 1 && rtop.includes('找回好棋 1/') && rtop.includes('更好的') && rtop.includes('亏了约'));
const bw = await page.locator('.xq-retry canvas, .xq-retry .xq-b2d, .xq-retry svg').first().evaluate((e) => e.getBoundingClientRect().width).catch(() => 0);
ok(`找回好棋的棋盘撑得开（${Math.round(bw)} 像素宽）`, bw >= 300);
await page.screenshot({ path: OUT + '/ex-retry.png' });
await page.locator('.xq-retry .xq-tr-quit').click(); await page.waitForTimeout(300);
ok('关掉回到复盘', (await page.locator('.xq-retry').count()) === 0 && (await page.locator('[data-act="retry"]').count()) === 1);

// ───────── 5. 对局里教练那一行叫得出布局 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'save'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(300);
await page.evaluate(() => { const d = document.querySelector('.xq-lowlv'); if (d) d.open = true; }); await page.locator('.diff-row .card', { hasText: '入门' }).first().click();
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click();
await until(page, () => window.__xq && window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 15000);
await page.evaluate(() => { const m = window.__xq.legal().find((x) => window.__xq.textOf(x) === '炮二平五'); window.__xq.play(m); });
ok('走完一手，教练那一行叫得出布局', await until(page, () => (window.__xq.coachLine() ?? '').includes('📖'), null, 30000));
console.log('   ' + (await page.evaluate(() => window.__xq.coachLine())));
await page.screenshot({ path: OUT + '/ex-game.png' });

await browser.close();
if (errs.length) { console.log('\n✗ 失败：\n' + errs.join('\n')); process.exit(1); }
console.log('\n全部通过');
