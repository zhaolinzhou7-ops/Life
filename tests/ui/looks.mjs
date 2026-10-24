/**
 * 棋盘和棋子样式：首页底下有入口；九套搭配、八种棋盘、八种棋子、五种字体都列出来；
 * 点哪个当场换（预览和存档都变）；没有繁体字的字体不让勾繁体；开一盘棋，棋盘是选好的那一套；
 * 对局里 🎨 换下一套，当场重画；吃子托盘去掉了（只剩棋谱条）。
 * 同一页还有出场人物（随机 / 五位 / 不演）和配音（男声 / 女声 / 不要，点了试听"将军！"）。
 * 用法：npm run dev，然后 node tests/ui/looks.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
// 出场人物（四秒多的过场）另有 hero.mjs 测，这里直接开局
await page.addInitScript(() => { try { if (!localStorage.getItem('xq-hero')) localStorage.setItem('xq-hero', 'off'); } catch { /* 无痕模式 */ } });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const look = () => page.locator('.xq-look-preview canvas').getAttribute('data-look');
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('xq-look') ?? 'null'));

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-power', 'save'); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
ok('首页底下有"棋盘和棋子样式"', (await page.locator('[data-home="look"]').count()) === 1);
ok('首页还是三个入口（样式不占入口）', (await page.locator('.xq-home .card-list > .home-card').count()) === 3);
await page.locator('[data-home="look"]').click(); await page.waitForTimeout(1500);

ok('默认：榉木、象牙、文楷', (await look()) === 'wood/ivory/wenkai');
ok('九套现成搭配', (await page.locator('[data-preset]').count()) === 9);
ok('八种棋盘', (await page.locator('[data-board]').count()) === 8);
ok('八种棋子', (await page.locator('[data-piece]').count()) === 8);
ok('五种字体', (await page.locator('[data-font]').count()) === 5);
await page.waitForTimeout(1500);
ok('每张卡片都画出了小样', await page.evaluate(() => [...document.querySelectorAll('.xq-look-card')].every((c) => c.querySelector('.pic canvas, .pic .xq-hero-pic'))));
ok('当前那一套标着选中', (await page.locator('[data-preset="classic"].selected').count()) === 1);
await page.screenshot({ path: OUT + '/looks-picker.png', fullPage: true });

// 点一套搭配：预览当场换、存档记下
await page.locator('[data-preset="lacquer"]').click(); await page.waitForTimeout(900);
ok('点"朱漆夜宴"：预览换成玄漆棋盘、漆器棋子、繁体', (await look()) === 'night/lacquer/wenkai/trad');
ok('存档记下了', JSON.stringify(await saved()) === JSON.stringify({ board: 'night', piece: 'lacquer', font: 'wenkai', trad: true }));
await page.locator('.xq-look-preview').screenshot({ path: OUT + '/looks-lacquer.png' });

// 单独换棋盘：变成自己搭的
await page.locator('[data-board="jade"]').click(); await page.waitForTimeout(900);
ok('单独换棋盘（碧玉）：棋子、字体不变', (await look()) === 'jade/lacquer/wenkai/trad');
ok('不是哪一套现成的了：写着"自己搭的"', (await page.locator('.xq-look').innerText()).includes('自己搭的') && (await page.locator('[data-preset].selected').count()) === 0);

// 没有繁体的字体：繁体勾不上
await page.locator('[data-font="mashan"]').click(); await page.waitForTimeout(900);
ok('换成毛笔字：繁体那一项变灰，盘上是简体', (await page.locator('.xq-look-trad:not([data-act]) input').isDisabled()) && (await look()) === 'jade/lacquer/mashan/trad');
const glyph = await page.evaluate(async () => (await import('/Life/src/xiangqi/boardtheme.ts')).glyph('C', 'b'));
ok('毛笔字没有"砲"：黑炮也写"炮"', glyph === '炮');
await page.locator('[data-font="wenkai"]').click(); await page.waitForTimeout(600);
ok('换回文楷：繁体能勾', !(await page.locator('.xq-look-trad:not([data-act]) input').isDisabled()));

// 对局特效开关也在这一页
ok('特效开关在这一页，默认开着', await page.locator('[data-act="fx-toggle"] input').isChecked());
await page.locator('[data-act="fx-toggle"] input').uncheck(); await page.waitForTimeout(200);
ok('关掉特效：记下了', (await page.evaluate(() => localStorage.getItem('xq-fx'))) === '0');
await page.locator('[data-act="fx-toggle"] input').check(); await page.waitForTimeout(200);

// 出场人物：随机 + 五位 + 不演（测试开头设成了不演）；点一位当场演一遍的事 hero.mjs 测
ok('出场人物：随机、五位人物、不演，一共七张', (await page.locator('[data-hero]').count()) === 7);
ok('五位人物都画出了小样（天 + 人）', await page.evaluate(() => [...document.querySelectorAll('[data-hero] .xq-hero-pic .fig svg')].length === 5));
ok('现在是"不演"', (await page.locator('[data-hero="off"].selected').count()) === 1);
await page.locator('[data-hero="random"]').click(); await page.waitForTimeout(300);
ok('点"随机"：记下了、标着选中', (await page.evaluate(() => localStorage.getItem('xq-hero'))) === 'random' && (await page.locator('[data-hero="random"].selected').count()) === 1);
ok('点"随机"不演（只有点某一位才当场演）', !(await page.evaluate(() => !!document.querySelector('.xqh'))));
await page.locator('[data-hero="off"]').click(); await page.waitForTimeout(300);
ok('点回"不演"', (await page.evaluate(() => localStorage.getItem('xq-hero'))) === 'off');

// 配音：男声（默认）、女声、不要；点了当场喊一声"将军！"
ok('配音三张：男声、女声、不要', (await page.locator('[data-voice]').count()) === 3);
ok('默认男声', (await page.locator('[data-voice="m"].selected').count()) === 1);
await page.locator('[data-voice="f"]').click();
ok('点女声：记下了', (await page.evaluate(() => localStorage.getItem('xq-voice'))) === 'f');
const said = async (name) => {
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    if ((await page.evaluate(() => document.documentElement.dataset.xqSaid)) === name) return true;
    await page.waitForTimeout(100);
  }
  return false;
};
ok('点女声：试听女声的"将军！"', await said('f-jiangjun'));
await page.locator('[data-voice="m"]').click();
ok('点回男声：试听男声的"将军！"', await said('m-jiangjun'));

// 恢复默认
await page.locator('[data-act="look-reset"]').click(); await page.waitForTimeout(600);
ok('恢复默认', (await look()) === 'wood/ivory/wenkai');

// 选一套，去下棋
await page.locator('[data-preset="jade"]').click(); await page.waitForTimeout(500);
ok('顶栏写着"棋盘样式"', (await page.locator('.xq-look .xq-nav-path').innerText()).includes('棋盘样式'));
await page.locator('.xq-look [data-nav-back]').click(); await page.waitForTimeout(500);
ok('返回到首页', (await page.locator('[data-home="play"]').count()) === 1);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(500);
ok('开局设置里写着现在的样式', (await page.locator('[data-act="look"]').innerText()).includes('翡翠玉局'));
ok('开局设置里也写着出场、配音', /出场：不演/.test(await page.locator('[data-act="look"]').innerText()) && /配音：男声/.test(await page.locator('[data-act="look"]').innerText()));
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(1500);
const gameLook = () => page.locator('.xq-boardwrap canvas.xq-b2d').first().getAttribute('data-look');
ok('对局的棋盘就是选好的那一套', (await gameLook()) === 'jade/jade/wenkai/trad');
await page.screenshot({ path: OUT + '/looks-game.png' });
await page.locator('#xq-look').click(); await page.waitForTimeout(800);
ok('对局里点 🎨 换下一套（青花汉白玉），当场重画', (await gameLook()) === 'marble/porcelain/xiaowei');
await page.screenshot({ path: OUT + '/looks-game2.png' });

// 用户原话："界面上'我丢了几个子、对方丢了几个子'的信息可以去掉了"
ok('吃子托盘去掉了，只剩棋谱条', await page.evaluate(() => !document.querySelector('.xq-tray-row') && !!document.querySelector('.xq-tray .xq-log')));


await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
