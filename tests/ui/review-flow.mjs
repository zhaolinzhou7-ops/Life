/**
 * 复盘第二版：
 *   - 困毙 / 绝杀之后进复盘，终局特效（"困毙"大字、躺倒的老将、压暗、红圈）全收掉，不再盖着棋盘；
 *   - 平时那一屏不用滚：这一手一张小卡片，长讲解收在「📖 讲解」里；
 *   - 局势图下一条横着的棋谱，当前这一手在可见范围里，点哪手到哪手；
 *   - 报告分「总评」「棋谱」两页；⏵ 自动一手一手往下放，手一碰就停；空格键也能开关。
 * 用户原话："最后困毙的那个在复盘的时候，它还会存在上面，会遮挡……在复盘的时候，我有很多东西划来划去的"
 * 用法：npm run dev，然后 node tests/ui/review-flow.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
const until = async (fn, arg, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(80); }
  return false;
};
const st = () => page.evaluate(() => ({ cursor: window.__xqReview?.cursor(), sheet: window.__xqReview?.sheet() }));

// ───────── 困毙之后进复盘：特效收掉 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('xq-power', 'save'); localStorage.setItem('xq-hero', 'off'); localStorage.setItem('xq-tempo', '0'); localStorage.setItem('xq-hint-level', '0'); });
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(400);
await page.getByText('开始对弈').first().click();
await until(() => window.__xq?.turn() === 'r' && !window.__xq.state().busy, null, 15000);
// 黑将在 d10，红车封住第五路和第二横线：车一退一之后黑将一步都动不了、又没被将——困毙
await page.evaluate(() => window.__xq.setBoard('3k5/9/8R/9/9/4R4/9/9/9/5K3 w'));
await page.waitForTimeout(400);
await page.evaluate(() => window.__xq.play({ fx: 8, fy: 2, tx: 8, ty: 1 }));
ok('困毙：特效演起来了', await until(() => document.querySelector('.xq-boardwrap')?.dataset.fx === 'mate', null, 8000));
ok('"困毙"两个字砸下来', await until(() => [...document.querySelectorAll('.xq-fx-word')].map((e) => e.textContent).join('') === '困毙', null, 3000));
ok('结果页出来了', await until(() => !!document.querySelector('.xq-result'), null, 8000));
// 只走了一手，结果页不给"复盘"按钮（太短）；这里直接点它，为的是看特效收没收
await page.evaluate(() => { const b = [...document.querySelectorAll('.xq-result .btn')].find((e) => /复盘/.test(e.textContent)); b.style.display = ''; b.click(); });
await page.waitForTimeout(800);
const leftover = await page.evaluate(() => {
  const cv = document.querySelector('.xq-boardwrap canvas.xq-fx');
  let ink = -1;
  if (cv) {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    ink = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 8) ink++;
  }
  return { words: document.querySelectorAll('.xq-fx-word').length, mark: document.querySelector('.xq-boardwrap')?.dataset.fx ?? '', ink };
});
console.log('   进复盘后：' + JSON.stringify(leftover));
ok('进复盘："困毙"大字收掉了', leftover.words === 0 && leftover.mark === '');
ok('进复盘：特效画布擦干净了（躺倒的老将、压暗都没了）', leftover.ink === 0);
await page.screenshot({ path: OUT + '/rf-after-mate.png' });

// ───────── 一盘真棋的复盘 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(500);
await page.locator('[data-home="games"]').click(); await page.waitForTimeout(400);
await page.locator('[data-act="import-game"]').click();
const PGN = '1. 炮二平五 马8进7 2. 马二进三 车9平8 3. 车一平二 马2进3 4. 兵七进一 卒7进1 5. 车二进六 马7进6 6. 马八进七 象3进5 7. 炮八平九 士4进5 8. 车九平八 炮2进4 9. 车二平四 马6进7 10. 炮五进四 马3进5 11. 车四平五 车1平2 12. 车五平三 炮8进2';
await page.locator('[data-imp-text]').fill(PGN);
await page.locator('[data-imp-go]').click();
ok('复盘打完分', await until(() => !!document.querySelector('[data-act="retry"]'), null, 240000));
// 用户原话："在做残局和做复盘的时候，音乐也可以默认打开"
ok('复盘默认放配乐（存档里的棋，不是刚下完那盘接着放的）', await until(() => !!document.documentElement.dataset.xqBgm, null, 5000));
await page.waitForTimeout(600);
const n = 24;

// 平时那一屏：不用滚
const fit = await page.evaluate(() => {
  const b = document.querySelector('.xq-rv-body');
  return { client: b.clientHeight, scroll: b.scrollHeight };
});
console.log(`   这一手的卡片：可见 ${fit.client}px，内容 ${fit.scroll}px`);
ok('平时那一屏放得下这一手，不用上下划', fit.scroll <= fit.client + 4);
ok('卡片里有一行要点，点它看完整讲解', (await page.locator('.xq-rv-gist').count()) === 1);
ok('长讲解平时收着', !(await page.locator('.xq-rv-more').isVisible()));

// 横着的棋谱条
ok(`棋谱条：${n} 手都在`, (await page.locator('.xq-rv-strip .xq-rv-sm').count()) === n);
const onVisible = await page.evaluate(() => {
  const s = document.querySelector('.xq-rv-strip').getBoundingClientRect();
  const o = document.querySelector('.xq-rv-strip .xq-rv-sm.on')?.getBoundingClientRect();
  return !!o && o.left >= s.left - 2 && o.right <= s.right + 2;
});
ok('棋谱条：当前这一手滚到了看得见的地方', onVisible);
await page.locator('.xq-rv-strip .xq-rv-sm[data-i="3"]').scrollIntoViewIfNeeded();
await page.locator('.xq-rv-strip .xq-rv-sm[data-i="3"]').click();
await page.waitForTimeout(300);
ok('棋谱条上点第 4 手：翻到第 4 手', (await st()).cursor === 3);
await page.screenshot({ path: OUT + '/rf-card.png' });

// 讲解
await page.locator('.xq-rv-gist').click();
await page.waitForTimeout(300);
ok('点要点那一行：展开讲解', (await st()).sheet === 'detail' && (await page.locator('.xq-rv-more').isVisible()));
await page.screenshot({ path: OUT + '/rf-detail.png' });
await page.locator('.xq-rv-nav [data-act="detail"]').click();
await page.waitForTimeout(200);
ok('再点讲解：收回去', (await st()).sheet === 'none');

// 报告两页
await page.locator('.xq-rv-nav [data-act="overview"]').click();
await page.waitForTimeout(300);
ok('报告先看总评（对照表）', await page.locator('[data-report]').isVisible() && !(await page.locator('.xq-rv-list').isVisible()));
await page.locator('[data-tab="list"]').click();
await page.waitForTimeout(200);
ok('「📜 棋谱」那一页：整盘棋谱', await page.locator('.xq-rv-list').isVisible() && !(await page.locator('[data-report]').isVisible()) && (await page.locator('.xq-rv-item').count()) === n);
await page.screenshot({ path: OUT + '/rf-list.png' });
await page.locator('.xq-rv-nav [data-act="overview"]').click();
await page.waitForTimeout(200);
await page.locator('.xq-rv-nav [data-act="overview"]').click();
await page.waitForTimeout(200);
ok('再打开报告：回到总评那一页', await page.locator('[data-report]').isVisible());
await page.locator('.xq-rv-nav [data-act="overview"]').click();
await page.waitForTimeout(200);

// 自动播放
await page.keyboard.press('Home');
await page.waitForTimeout(200);
await page.locator('.xq-rv-nav [data-act="auto"]').click();
await page.waitForTimeout(3700);
const c1 = (await st()).cursor;
ok(`⏵ 自动：自己往下放（3.7 秒到第 ${c1 + 1} 手）`, c1 >= 2);
ok('自动播放时按钮写着"暂停"', (await page.locator('.xq-rv-nav [data-act="auto"]').innerText()).includes('暂停'));
await page.locator('.xq-rv-nav [data-go="-1"]').click();
await page.waitForTimeout(1900);
const c2 = (await st()).cursor;
ok('点"上一手"：自动停了', c2 === c1 - 1 || c2 === c1);
await page.waitForTimeout(1700);
ok('停了就不再往下走', (await st()).cursor === c2);
await page.keyboard.press(' ');
await page.waitForTimeout(1800);
ok('空格键：开始自动', (await st()).cursor > c2);
await page.keyboard.press(' ');

// 从这里重下：按钮和别的放在一排（原来藏在长讲解最底下）
ok('"从这里重下"和别的按钮排在一排，不用翻', (await page.locator('.xq-rv-card [data-replay]').count()) === 1);

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
