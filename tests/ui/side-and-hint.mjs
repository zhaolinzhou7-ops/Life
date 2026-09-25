/**
 * 选边 + 对局中求助的浏览器验证。
 *
 * 执黑最容易出的问题是"红方不动"：整个对局流程原来假设我方永远先行，
 * 开局那一手没人触发。这条必须真跑一遍才验得出来。
 * 用法：npm run dev，然后 node tests/ui/side-and-hint.mjs
 */
import { chromium } from 'playwright';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
const errs = [];
const ok = (n,c)=>{console.log(`${c?'✓':'✗'} ${n}`); if(!c) errs.push(n);};
const b = await chromium.launch({ executablePath: process.env.CHROME || undefined });
const page = await (await b.newContext({viewport:{width:390,height:844}})).newPage();
page.on('pageerror', e=>errs.push('pageerror: '+e.message));
page.on('console', m=>{if(m.type()==='error') errs.push('console: '+m.text());});
await page.goto(process.env.BASE || 'http://localhost:5175/Life/',{waitUntil:'networkidle'});
await page.evaluate(() => localStorage.setItem('xq-power', 'save')); // 省电档每步 5 秒，等得到"算完"
await page.getByText('中国象棋',{exact:false}).first().click(); await page.waitForTimeout(800);
await page.locator('.xq-home-card').nth(0).click(); await page.waitForTimeout(500);
ok('设置里有选边', await page.getByText('你执哪一方').count() > 0);
await page.getByText('执黑后行').first().click(); await page.waitForTimeout(200);
await page.getByText('开始对弈').first().click(); await page.waitForTimeout(1500);
// 执黑：对手（红）应该自己先走一手
for (let i=0;i<40;i++){ const n = await page.evaluate(()=>window.__xq.moves().length); if(n>=1) break; await page.waitForTimeout(400); }
const st = await page.evaluate(()=>({n:window.__xq.moves().length, turn:window.__xq.turn()}));
ok('执黑时红方自动先走了一手', st.n >= 1);
ok('走完之后轮到我（黑）', st.turn === 'b');
await page.screenshot({path:OUT+'/side-black.png'});
// 求助
await page.locator('#xq-best').click();
// 求助读的是后台研究：没算完时显示"目前看最好是…（还在算）"，算完变成"最优是"
for (let i=0;i<40;i++){ const t = await page.locator('.xq-besthint .xq-tip-status').textContent().catch(()=>''); if(t && t.includes('已算完')) break; await page.waitForTimeout(500); }
const hint = (await page.locator('.xq-besthint .xq-tip-text').textContent()) ?? '';
console.log('   求助结果：' + hint.trim().slice(0,80));
ok('求助给出了最优解（中局是"最优是"，定式局面是"按定式走"）', hint.includes('最优是') || hint.includes('按定式走'));
const arrows = await page.evaluate(()=>!!document.querySelector('.xq-boardwrap canvas'));
ok('棋盘还在（箭头画在画布上）', arrows);
await page.screenshot({path:OUT+'/side-hint.png'});
await page.locator('[data-act="more"]').click(); await page.waitForTimeout(400);
const rows = await page.locator('.xq-besthint .xq-tip-why .row').count();
ok(`展开能看到完整梯次（${rows} 行）`, rows >= 4);
await page.screenshot({path:OUT+'/side-hint-more.png'});
await b.close();
console.log('\n===== 失败项 =====\n' + (errs.length?errs.join('\n'):'无'));

process.exit(errs.length ? 1 : 0);
