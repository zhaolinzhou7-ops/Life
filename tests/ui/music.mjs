/**
 * 对局配乐：四种乐队挨个放（第一种七种情绪全放，其余放开局和攻杀），量输出电平——真的出声、不削波、不报错；🎵 换一种；
 * 对手说话只出气泡、不念出来。
 * 用户原话："对局音乐希望能丰富一点……""有点太单调了……刚开始、胶着、或者快结束的时候，分别都是不一样的……人的声音也很傻"
 * 用法：npm run dev，然后 node tests/ui/music.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
// 出场人物（四秒多的过场）另有 hero.mjs 测，这里直接开局
await page.addInitScript(() => { try { if (!localStorage.getItem('xq-hero')) localStorage.setItem('xq-hero', 'off'); } catch { /* 无痕模式 */ } });
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('life-mute', '0'); });
await page.reload({ waitUntil: 'networkidle' });
// 盯着浏览器的语音：象棋里一句都不该念
await page.evaluate(() => { window.__spoke = 0; try { speechSynthesis.speak = () => { window.__spoke++; }; } catch { /* 没有语音 */ } });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(300);
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click();
await page.waitForTimeout(1500);
const toast = await page.evaluate(() => document.body.innerText);
const first = (await page.evaluate(() => window.__xqMusic.current()))?.palette.id;
ok(`开局随机挑了一种乐队（${first}），提示"本盘配乐"`, !!first && toast.includes('本盘配乐'));
const bubble = await page.evaluate(() => document.querySelector('.xq-bubble')?.textContent ?? '');
ok(`对手打招呼只出气泡、不念出来（"${bubble}"，念了 ${await page.evaluate(() => window.__spoke)} 句）`, !!bubble && (await page.evaluate(() => window.__spoke)) === 0);
ok('打招呼是下棋的话，不是麻将的', !/[碰杠胡牌张钱]/.test(bubble));

const ids = await page.evaluate(() => window.__xqMusic.palettes());
for (const id of ids) {
  await page.evaluate((x) => window.__xqMusic.start(x), id);
  // 第一种乐队七种情绪全放一遍，其余的放开局和攻杀
  const moods = id === ids[0] ? ['serene', 'flow', 'tense', 'battle', 'triumph', 'peril', 'endgame'] : ['serene', 'battle'];
  for (const mood of moods) {
    await page.evaluate((m) => window.__xqMusic.mood(m, 0.8), mood);
    // 换情绪要等这一句唱完、下一句才换（慢的乐队一句七八秒）：等它真换过来再量，不然量到的还是上一种情绪
    const t0 = Date.now();
    while (Date.now() - t0 < 15000 && (await page.evaluate(() => window.__xqMusic.current()))?.mood !== mood) await page.waitForTimeout(150);
    await page.waitForTimeout(1500);
    let peak = 0;
    let rms = 0;
    for (let i = 0; i < 35; i++) {
      await page.waitForTimeout(100);
      const l = await page.evaluate(() => window.__xqMusic.level());
      if (l) { peak = Math.max(peak, l.peak); rms = Math.max(rms, l.rms); }
    }
    const now = (await page.evaluate(() => window.__xqMusic.current()))?.mood;
    console.log(`   ${id} · ${mood}: 峰值 ${peak.toFixed(3)}，RMS ${rms.toFixed(4)}`);
    ok(`${id} · ${mood}：换到了这种情绪（${now}），真的出声（RMS ${rms.toFixed(4)}），不削波（峰值 ${peak.toFixed(2)} < 0.98）`, now === mood && rms > 0.003 && peak < 0.98);
  }
}
for (const k of ['check', 'capture', 'win']) await page.evaluate((x) => window.__xqMusic.stinger(x), k);
await page.waitForTimeout(1500);
ok('将军、吃子、终局的点缀放得出来、不报错', !errs.length);

// 🎵：换下一种
const before = (await page.evaluate(() => window.__xqMusic.current()))?.palette.id;
await page.locator('#xq-music').click(); await page.waitForTimeout(300);
const after = (await page.evaluate(() => window.__xqMusic.current()))?.palette.id;
ok(`点 🎵 换一种乐队（${before} → ${after}）`, !!after && after !== before);

// 再开一盘：不和上一盘同一种
const last = await page.evaluate(() => localStorage.getItem('xq-bgm-last'));
await page.locator('.xq-back').click(); await page.waitForTimeout(400);
if (await page.locator('.xq-confirm [data-act="yes"]').count()) { await page.locator('.xq-confirm [data-act="yes"]').click(); await page.waitForTimeout(400); }
await page.locator('[data-home="play"]').click().catch(() => {}); await page.waitForTimeout(300);
await page.getByText('开始对弈').first().click().catch(() => {});
await page.waitForTimeout(800);
const next = (await page.evaluate(() => window.__xqMusic.current()))?.palette.id;
ok(`再开一盘，换了一种乐队（上一盘 ${last} → 这一盘 ${next}）`, !!next && next !== last);

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errs.length ? errs.join('\n') : '无');
process.exit(errs.length ? 1 : 0);
