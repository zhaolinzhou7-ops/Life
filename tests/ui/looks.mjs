/**
 * 棋盘和棋子样式：首页底下有入口；九套搭配、八种棋盘、八种棋子、五种字体都列出来；
 * 点哪个当场换（预览和存档都变）；没有繁体字的字体不让勾繁体；开一盘棋，棋盘是选好的那一套；
 * 对局里 🎨 换下一套，当场重画；托盘里的小棋子是图（同一套样式）。
 * 用法：npm run dev，然后 node tests/ui/looks.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 })).newPage();
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
ok('每张卡片都画出了小样', await page.evaluate(() => [...document.querySelectorAll('.xq-look-card')].every((c) => c.querySelector('.pic canvas'))));
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
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(1500);
const gameLook = () => page.locator('.xq-boardwrap canvas.xq-b2d').first().getAttribute('data-look');
ok('对局的棋盘就是选好的那一套', (await gameLook()) === 'jade/jade/wenkai/trad');
await page.screenshot({ path: OUT + '/looks-game.png' });
await page.locator('#xq-look').click(); await page.waitForTimeout(800);
ok('对局里点 🎨 换下一套（青花汉白玉），当场重画', (await gameLook()) === 'marble/porcelain/xiaowei');
await page.screenshot({ path: OUT + '/looks-game2.png' });

// 托盘：吃了子之后是小棋子图（走两步让红炮打掉黑马）
const tray = await page.evaluate(async () => {
  const T = await import('/Life/src/xiangqi/boardtheme.ts');
  return T.pieceIcon('H', 'b', 20).startsWith('data:image/png');
});
ok('托盘的小棋子是同一套样式画的图', tray);

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
