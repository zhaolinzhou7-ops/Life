/**
 * 教练和求助是不是同一个裁判、认输/求和、非法点击的解释、底部操作条够不够得着。
 *
 * 用户原话："都要被将死了，还不允许我出将，说会丢兵，结果我让他提示又有这一步。"
 * 这条要在真浏览器里跑：问题出在两条线程、两份分析、落子时机上，单元测试看不到。
 * 用法：npm run dev，然后 node tests/ui/endgame-coach.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

async function openGame(page, side = '执红先行') {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  // 省电档（每步 5 秒）：测试要等"算完"，全力档要算好几分钟
  await page.evaluate(() => { localStorage.setItem('xq-hint-level', '2'); localStorage.setItem('xq-power', 'save'); });
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
  await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(400);
  await page.getByText(side).first().click(); await page.waitForTimeout(150);
  await page.getByText('开始对弈').first().click(); await page.waitForTimeout(1200);
}
const until = async (page, fn, arg, ms = 20000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn, arg)) return true; await page.waitForTimeout(200); }
  return false;
};
const tipOpen = (page) => page.evaluate(() => !!document.querySelector('.xq-tip:not(.xq-besthint):not(.xq-lost):not(.xq-confirm)'));

// ───────── 1. 同一个裁判 ─────────
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await openGame(page);
  const THREAT = 'rnbakabn1/4cR1C1/c8/2p5r/4p1p2/6B2/p1P1P1p1P/RCNKBAN2/9/5A3 w';
  ok('摆出"对方有杀着"的局面', await page.evaluate((f) => window.__xq.setBoard(f), THREAT));
  await page.waitForTimeout(300);
  const line = await page.evaluate(() => window.__xq.coachLine());
  console.log('   教练行：' + line);
  ok('轮到我时教练行提醒了对方的杀着', line.includes('将死'));
  ok('研究在后台算', await until(page, () => (window.__xq.study()?.depth ?? 0) >= 4, null, 8000));
  ok('研究最终算完', await until(page, () => !!window.__xq.study()?.done, null, 15000));
  const st = await page.evaluate(() => window.__xq.study());
  console.log(`   研究：${st.depth} 层`);
  ok('研究至少算到 6 层（原来的预分析只有 4 层）', st.depth >= 6);

  // 求助：读的是同一份研究，所以一点开就是算完的
  await page.locator('#xq-best').click();
  await page.waitForTimeout(300);
  const hintText = (await page.locator('.xq-besthint .xq-tip-text').textContent()) ?? '';
  const status = (await page.locator('.xq-besthint .xq-tip-status').textContent()) ?? '';
  console.log('   求助：' + hintText.trim().slice(0, 70) + ' | ' + status);
  ok('研究算完后求助是立即出结果的', hintText.includes('最优是') && status.includes('已算完'));
  const bestMove = await page.evaluate(() => window.__xq.study().best);
  const bestText = await page.evaluate((m) => window.__xq.textOf(m), bestMove);
  ok('求助推荐的就是研究的首选', hintText.includes(bestText));
  await page.screenshot({ path: OUT + '/eg-hint.png' });
  await page.locator('#xq-best').click(); // 收起
  await page.waitForTimeout(200);

  // 照着求助走：教练绝不能拦
  await page.evaluate((m) => window.__xq.play(m), bestMove);
  await page.waitForTimeout(600);
  ok(`照着求助走 ${bestText}，教练没有拦`, !(await tipOpen(page)));
  await page.screenshot({ path: OUT + '/eg-follow.png' });

  // 反过来：教练拦下的每一手，都不能是求助会推荐的那一手
  await page.evaluate((f) => window.__xq.setBoard(f), THREAT);
  await until(page, () => !!window.__xq.study()?.done, null, 15000);
  const best2 = await page.evaluate(() => window.__xq.study().best);
  const legal = await page.evaluate(() => window.__xq.legal());
  let blocked = 0, contradictions = 0, bound = 0;
  for (const m of legal) {
    await page.evaluate((mv) => window.__xq.play(mv), m);
    await page.waitForTimeout(120);
    if (await tipOpen(page)) {
      blocked++;
      const same = m.fx === best2.fx && m.fy === best2.fy && m.tx === best2.tx && m.ty === best2.ty;
      if (same) contradictions++;
      const txt = await page.locator('.xq-tip .xq-tip-text').first().textContent();
      if (/以上/.test(txt)) bound++;
      await page.locator('.xq-tip:not(.xq-lost) [data-act="cancel"]').first().click();
      await page.waitForTimeout(80);
    } else {
      // 没拦就真走了，摆回去接着试
      await page.evaluate((f) => window.__xq.setBoard(f), THREAT);
      await until(page, () => !!window.__xq.study()?.done, null, 15000);
    }
  }
  console.log(`   ${legal.length} 手里教练拦了 ${blocked} 手（其中 ${bound} 手是"差得太多只给下限"）`);
  ok('教练拦下的没有一手是求助的首选', contradictions === 0);
  ok('明显的坏棋教练会拦', blocked > 0);

  // 被拦下时，提示条里有算到第几层的状态
  const bad = legal.find((m) => !(m.fx === best2.fx && m.fy === best2.fy && m.tx === best2.tx && m.ty === best2.ty));
  await page.evaluate((f) => window.__xq.setBoard(f), THREAT);
  await until(page, () => !!window.__xq.study()?.done, null, 15000);
  for (const m of legal) {
    await page.evaluate((mv) => window.__xq.play(mv), m);
    await page.waitForTimeout(120);
    if (await tipOpen(page)) break;
    await page.evaluate((f) => window.__xq.setBoard(f), THREAT);
    await until(page, () => !!window.__xq.study()?.done, null, 15000);
  }
  if (await tipOpen(page)) {
    const tip = await page.locator('.xq-tip').first().innerText();
    console.log('   提示条：' + tip.replace(/\s+/g, ' ').slice(0, 120));
    ok('提示条标明了算到几层', tip.includes('层'));
    ok('提示条的话不是静态兑子的套话', !tip.includes('这里有风险：'));
    await page.screenshot({ path: OUT + '/eg-warn.png' });
    await page.locator('.xq-tip:not(.xq-lost) [data-act="cancel"]').first().click();
  }
  void bad;
  await page.close();
}

// ───────── 2. 认输 ─────────
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await openGame(page);
  // 先随便走两手，让这一局有东西可复盘
  for (let i = 0; i < 2; i++) {
    await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 15000);
    const m = await page.evaluate(() => window.__xq.legal()[0]);
    await page.evaluate((mv) => window.__xq.play(mv), m);
    await page.waitForTimeout(300);
    if (await tipOpen(page)) await page.locator('.xq-tip [data-act="go"]').first().click();
  }
  await until(page, () => window.__xq.turn() === 'r', null, 15000);
  const barBox = await page.locator('.xq-bar').boundingBox();
  ok('底部操作条在屏幕内', !!barBox && barBox.y + barBox.height <= 844 && barBox.y > 400);
  await page.locator('#xq-resign').click();
  await page.waitForTimeout(250);
  ok('认输先问一句', (await page.locator('.xq-confirm').count()) === 1);
  await page.screenshot({ path: OUT + '/eg-resign-confirm.png' });
  await page.locator('.xq-confirm [data-act="yes"]').click();
  await page.waitForTimeout(900);
  const res = await page.locator('.xq-result').innerText().catch(() => '');
  console.log('   结算：' + res.replace(/\s+/g, ' ').slice(0, 80));
  ok('认输之后是"败"的结算页', res.includes('败') && res.includes('认输'));
  ok('结算页可以复盘', res.includes('复盘'));
  const arch = await page.evaluate(() => JSON.parse(localStorage.getItem('xq-archive') || '[]'));
  ok('这一局存进了棋谱（记为负）', Array.isArray(arch) ? arch.some((g) => g.result === 'loss') : true);
  await page.screenshot({ path: OUT + '/eg-resign.png' });
  await page.close();
}

// ───────── 3. 求和 ─────────
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await openGame(page);
  await until(page, () => window.__xq.turn() === 'r', null, 5000);
  await page.locator('#xq-draw').click();
  await page.waitForTimeout(400);
  const t1 = (await page.locator('.xq-toast').textContent()) ?? '';
  console.log('   开局求和：' + t1);
  ok('开局求和会被拒绝，并说明原因', t1.includes('拒绝') && t1.includes('开局'));
  // 对手（黑）少一个车的残局：它会接受
  await page.evaluate(() => window.__xq.setBoard('3k5/9/9/9/2p6/9/9/9/4R4/4K4 w'));
  await page.waitForTimeout(300);
  await page.locator('#xq-draw').click();
  await until(page, () => !!document.querySelector('.xq-result'), null, 8000);
  const res = await page.locator('.xq-result').innerText().catch(() => '');
  console.log('   残局求和：' + res.replace(/\s+/g, ' ').slice(0, 60));
  ok('落后的对手接受议和，结算显示和棋', res.includes('和棋'));
  await page.screenshot({ path: OUT + '/eg-draw.png' });

  // 对手占优：拒绝
  await page.locator('.xq-result .btn.ghost').first().click(); // 再来一局
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__xq.setBoard('4k4/9/9/9/9/9/9/4r4/9/3K5 w'));
  await page.waitForTimeout(1500);
  // 单车对光帅是输棋，教练会先说一句"守不住了"——那句话本身也验一下
  const lost = await page.locator('.xq-lost').count();
  ok('输定的局面，教练给了一句实话（带悔棋/认输出口）', lost === 1);
  if (lost) {
    ok('那句实话里有认输的出口', (await page.locator('.xq-lost [data-act="resign"]').count()) === 1);
    await page.locator('.xq-lost [data-act="go"]').click();
  }
  await page.locator('#xq-draw').click();
  await page.waitForTimeout(2500);
  const t2 = (await page.locator('.xq-toast').textContent()) ?? '';
  console.log('   对手占优时求和：' + t2);
  ok('占优的对手拒绝议和，并说出为什么', t2.includes('拒绝') && (t2.includes('占优') || t2.includes('杀')));
  await page.close();
}

// ───────── 4. 非法点击要说原因 ─────────
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await openGame(page);
  // 红马在帅前面挡着黑车：马一动，帅就被车吃
  await page.evaluate(() => window.__xq.setBoard('3k5/9/9/9/9/9/9/4r4/4N4/4K4 w'));
  await page.waitForTimeout(300);
  await page.evaluate(() => window.__xq.tap(4, 8));
  await page.waitForTimeout(200);
  const t = (await page.locator('.xq-toast').textContent()) ?? '';
  console.log('   点被牵制的马：' + t);
  ok('选中一个动不了的子，会说明原因', t.includes('没有能走的地方') || t.includes('解不了将'));
  await page.close();
}

// ───────── 5. 没听劝的那一手，复盘里要标出来，而且和对局里的判断一致 ─────────
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  await openGame(page);
  // 红车走到黑车嘴边：教练会拦；坚持走
  await page.evaluate(() => window.__xq.setBoard('4k4/4r4/9/9/9/9/4R4/9/9/3K5 w'));
  await until(page, () => !!window.__xq.study()?.done, null, 15000);
  await page.evaluate(() => { window.__xq.tap(4, 6); window.__xq.tap(4, 2); });
  await page.waitForTimeout(500);
  const warned = await tipOpen(page);
  ok('送车时教练拦了', warned);
  if (warned) await page.locator('.xq-tip [data-act="go"]').first().click();
  await until(page, () => window.__xq.turn() === 'r' && !window.__xq.state().busy, null, 20000);
  // 丢了车，教练可能会说"守不住了"——先点"接着下"，再用底部的认输
  await page.waitForTimeout(1500);
  if (await page.locator('.xq-lost').count()) await page.locator('.xq-lost [data-act="go"]').click();
  await page.locator('#xq-resign').click();
  await page.locator('.xq-confirm [data-act="yes"]').click();
  await page.waitForTimeout(900);
  const res = await page.locator('.xq-result').innerText();
  ok('结算页提醒"教练拦过你"', res.includes('教练拦过你'));
  await page.getByText('复盘这一局').click();
  await until(page, () => (document.querySelector('.xq-rv-progress')?.textContent ?? '').includes('共'), null, 30000);
  const flagged = await page.locator('.xq-rv-item .f').count();
  ok('复盘列表里那一手标了 🧑‍🏫', flagged === 1);
  await page.locator('.xq-rv-item').first().click();
  await page.waitForTimeout(300);
  const detail = await page.locator('.xq-rv-detail').innerText();
  console.log('   复盘：' + detail.replace(/\s+/g, ' ').slice(0, 150));
  ok('复盘里写明教练当时说了什么', detail.includes('教练拦过这一手'));
  ok('复盘对这一手的评级和教练一致（不是"最佳"）', !/最佳|好棋/.test(detail.split('教练')[0]));
  await page.screenshot({ path: OUT + '/eg-review-flag.png' });
  await page.close();
}

// ───────── 6. 秒落子 + 提示条开着时悔棋 + 执黑重开：不能卡死 ─────────
{
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errs.push('console: ' + m.text()); });
  await openGame(page);
  let prompts = 0, undoneWithTip = false;
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 24; i++) {
    const ready = await until(page, () => {
      const s = window.__xq.state();
      return (s.turn === 'r' && !s.busy) || s.over;
    }, null, 20000);
    if (!ready) { ok(`第 ${i} 手等不到轮到我（卡住了）`, false); break; }
    if (await page.evaluate(() => window.__xq.state().over)) break;
    if (await page.locator('.xq-lost').count()) await page.locator('.xq-lost [data-act="go"]').click();
    const legal = await page.evaluate(() => window.__xq.legal());
    const m = legal[Math.floor(rnd() * legal.length)];
    await page.evaluate((mv) => window.__xq.play(mv), m); // 不等研究，立刻落子
    await page.waitForTimeout(80);
    for (let k = 0; k < 40 && (await page.evaluate(() => window.__xq.state().busy && !window.__xq.state().tip)); k++) await page.waitForTimeout(100);
    if (await tipOpen(page)) {
      prompts++;
      if (!undoneWithTip && i > 2) {
        // 提示条开着时直接点悔棋：原来 busy 不复位，整盘卡死。
        // 手机上提示条盖住了操作条点不到，平板上"悔棋"露在外面是点得到的，所以直接触发按钮
        undoneWithTip = true;
        await page.evaluate(() => document.querySelector('#xq-undo').click());
        await page.waitForTimeout(300);
        const st = await page.evaluate(() => window.__xq.state());
        ok('提示条开着时点悔棋，之后还能走棋', !st.busy && !st.tip && st.turn === 'r');
        continue;
      }
      await page.locator('.xq-tip:not(.xq-lost) [data-act="go"]').first().click();
    }
  }
  const n = await page.evaluate(() => window.__xq.moves().length);
  console.log(`   秒落子走了 ${n} 手，其中教练开口 ${prompts} 次`);
  ok('秒落子一路走下来没有卡住', n >= 10 || (await page.evaluate(() => window.__xq.state().over)));

  // 执黑重开：红方（对手）要自己先走
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await openGame(page, '执黑后行');
  await until(page, () => window.__xq.moves().length >= 1, null, 15000);
  await page.locator('#xq-restart').click();
  if (await page.locator('.xq-confirm').count()) await page.locator('.xq-confirm [data-act="yes"]').click();
  const redMoved = await until(page, () => window.__xq.moves().length >= 1 && window.__xq.turn() === 'b', null, 15000);
  ok('执黑时点重开，对手会重新先走（原来会两边干等）', redMoved);
  await page.close();
}

// ───────── 7. 小屏布局 ─────────
for (const [w, h] of [[360, 640], [390, 844], [768, 1024]]) {
  const page = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await openGame(page);
  const bar = await page.locator('.xq-bar').boundingBox();
  const board = await page.locator('.xq-boardwrap canvas').boundingBox();
  const hud = await page.locator('.xq-hud').boundingBox();
  const line = await page.locator('.xq-coachline').boundingBox();
  const inView = bar && bar.y + bar.height <= h + 1 && bar.x >= 0 && bar.x + bar.width <= w + 1;
  const noOverlap = bar && board && bar.y >= board.y + board.height - 2;
  ok(`${w}×${h}：操作条在屏幕内`, !!inView);
  ok(`${w}×${h}：操作条不压棋盘`, !!noOverlap);
  ok(`${w}×${h}：教练行在棋盘下方`, !!line && !!board && line.y >= board.y + board.height - 2);
  ok(`${w}×${h}：HUD 一行放得下`, !!hud && hud.height < 60);
  await page.screenshot({ path: `${OUT}/eg-layout-${w}.png` });
  await page.close();
}

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
