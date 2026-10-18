/**
 * 对局配乐：七种曲风挨个放几秒，量输出电平——真的出声、不削波、不报错；🎵 换一种。
 * 用户原话："对局音乐希望能丰富一点，不要每次都是那几种……每次下棋的感觉都不一样。"
 * 用法：npm run dev，然后 node tests/ui/music.mjs
 */
import { chromium } from 'playwright';
const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const errs = [];
const ok = (n, c) => { console.log(`${c ? '✓' : '✗'} ${n}`); if (!c) errs.push(n); };
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--autoplay-policy=no-user-gesture-required'] });
const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
page.on('pageerror', (e) => errs.push('pageerror: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.clear(); localStorage.setItem('life-mute', '0'); });
await page.reload({ waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="play"]').click(); await page.waitForTimeout(300);
await page.getByText('执红先行').first().click();
await page.getByText('开始对弈').first().click();
await page.waitForTimeout(1500);
const toast = await page.evaluate(() => document.body.innerText);
const first = await page.evaluate(() => window.__xqMusic.current());
ok(`开局随机挑了一种配乐（${first}），提示"本盘配乐"`, !!first && toast.includes('本盘配乐'));

const ids = await page.evaluate(() => window.__xqMusic.styles());
for (const id of ids) {
  await page.evaluate((x) => window.__xqMusic.start(x), id);
  let peak = 0;
  let rms = 0;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const l = await page.evaluate(() => window.__xqMusic.level());
    if (l) { peak = Math.max(peak, l.peak); rms = Math.max(rms, l.rms); }
  }
  console.log(`   ${id}: 峰值 ${peak.toFixed(3)}，RMS ${rms.toFixed(4)}`);
  ok(`${id}：真的出声（RMS ${rms.toFixed(4)}），不削波（峰值 ${peak.toFixed(2)} < 0.98）`, rms > 0.003 && peak < 0.98);
}

// 🎵：换下一种
const before = await page.evaluate(() => window.__xqMusic.current());
await page.locator('#xq-music').click(); await page.waitForTimeout(300);
const after = await page.evaluate(() => window.__xqMusic.current());
ok(`点 🎵 换一种配乐（${before} → ${after}）`, !!after && after !== before);

// 再开一盘：不和上一盘同一种
const last = await page.evaluate(() => localStorage.getItem('xq-bgm-last'));
await page.locator('.xq-back').click(); await page.waitForTimeout(400);
if (await page.locator('.xq-confirm [data-act="yes"]').count()) { await page.locator('.xq-confirm [data-act="yes"]').click(); await page.waitForTimeout(400); }
await page.locator('[data-home="play"]').click().catch(() => {}); await page.waitForTimeout(300);
await page.getByText('开始对弈').first().click().catch(() => {});
await page.waitForTimeout(800);
const next = await page.evaluate(() => window.__xqMusic.current());
ok(`再开一盘，换了一种曲风（上一盘 ${last} → 这一盘 ${next}）`, !!next && next !== last);

await browser.close();
console.log('\n===== 失败项 / 报错 =====');
console.log(errs.length ? errs.join('\n') : '无');
process.exit(errs.length ? 1 : 0);
