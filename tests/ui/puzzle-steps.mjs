/**
 * 做题一手手走到底：杀法题走到将死、中间走错判错并演出惩罚、从头再走不计分、
 * 走出原谱之外的着法由皮卡鱼核对、残局题主变走完接着和皮卡鱼下到底；
 * 邪门布局"破解到底"和皮卡鱼下到胜势。
 * 用法：npm run dev，然后 node tests/ui/puzzle-steps.mjs
 */
import fs from 'fs';
import { chromium } from 'playwright';
/** mate2-ql 第二步的正解（题库里读，不写死） */
const QL_STEP2 = JSON.parse(fs.readFileSync('src/xiangqi/puzzles.json', 'utf8')).find((p) => p.id === 'mate2-ql').line[2];

const BASE = process.env.BASE || 'http://localhost:5175/Life/';
const OUT = process.env.OUT || '/tmp';
const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 420, height: 860 } });
const errs = [];
page.on('pageerror', (e) => errs.push('页面错误：' + e.message));
const ok = (name, cond) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) errs.push(name);
};
const until = async (fn, arg, ms = 15000) => {
  try {
    await page.waitForFunction(fn, arg, { timeout: ms, polling: 150 });
    return true;
  } catch {
    return false;
  }
};
const st = () => page.evaluate(() => window.__xqTrain.state());
/** 走这一步的正解，等对方应完（或者这题结束） */
const stepRight = async () => {
  const before = (await st()).myStep;
  await page.evaluate(() => window.__xqTrain.playRight());
  return until((n) => { const s = window.__xqTrain.state(); return (s.myStep > n && !s.busy) || s.answered; }, before, 20000);
};

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => { localStorage.setItem('xq-power', 'save'); });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(700);
await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(700);
if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(600); }

// ───────── 1. 杀法题：两步杀，要一直走到将死 ─────────
// （原来的 mate2-pc / pd 是对方只剩士的必胜题，题库里已经不出了；换成对方子力还在的两步杀）
await page.evaluate(() => window.__xqCoach.puzzle('mate2-qi'));
await page.waitForTimeout(500);
ok('打开了杀法题，标着"第 1 / 2 步 · 走到将死"', (await page.locator('.xq-tr-steps').innerText()).includes('1 / 2'));
await stepRight();
let s = await st();
ok('第一步走对之后没结束，对方应了一手，轮到第二步', !s.answered && s.myStep === 1 && s.ply === 2);
ok('反馈里写着对方应的那一手', (await page.locator('.xq-tr-fb').innerText()).includes('对方应'));
await stepRight();
s = await st();
ok('第二步将死，这题才算对', s.answered && s.verdict?.correct === true);
ok('反馈说将死', (await page.locator('.xq-tr-fb').innerText()).includes('将死'));
await page.screenshot({ path: OUT + '/puzzle-mate.png' });

// ───────── 2. 第二步走错：判错、说出该走什么、演出惩罚；从头再走不计分 ─────────
await page.evaluate(() => window.__xqCoach.puzzle('mate2-ql'));
await page.waitForTimeout(500);
await stepRight();
await page.evaluate(() => window.__xqTrain.playWrong());
ok('第二步走错：这题算错', await until(() => window.__xqTrain.state().answered, null, 30000) && (await st()).verdict?.correct === false);
const fb2 = await page.locator('.xq-tr-fb').innerText();
console.log('   ' + fb2.replace(/\s+/g, ' ').slice(0, 160));
ok('说清楚是第 2 步错了、该走哪一手', fb2.includes('第 2 步') && fb2.includes(QL_STEP2));
ok('演出对方怎么惩罚：教练讲对方会怎么一手手接', await until(() => /对方会这样接|对方会接|对方接下来会走/.test(document.querySelector('.xq-tr-fb')?.textContent ?? ''), null, 30000));
// 用户截图：「你走的是 帅五退一……这一步该走 帅五退一」——你走的和该走的绝不能是同一手
const sameSaid = async () => {
  const t = (await page.locator('.xq-tr-fb').innerText()).replace(/\s+/g, ' ');
  const you = t.match(/你走的是 (\S+)/)?.[1];
  const should = t.match(/该走 (\S+?)[。（\s]/)?.[1];
  return { you, should, same: !!you && you === should };
};
const ss = await sameSaid();
ok(`你走的（${ss.you}）和该走的（${ss.should}）不是同一手`, !ss.same);
await page.locator('#xq-tr-again').click();
s = await st();
ok('从头再走一遍：局面复原、标着不计分', s.practice && s.myStep === 0 && !s.answered && (await page.locator('.xq-tr-steps').innerText()).includes('不计分'));
await stepRight();
await stepRight();
s = await st();
ok('再走一遍走对了，结果还是第一次的（算错）', s.answered && s.verdict?.correct === false);

// ───────── 2b. 杀法题：走了一手慢一点的杀，也算对（不苛求最快的那条），步数跟着放宽 ─────────
// 用户原话："还是存在必胜残局在找最佳步数"
await page.evaluate(() => window.__xqCoach.puzzle('mate2-qi'));
await page.waitForTimeout(500);
const slow = await page.evaluate(async () => {
  const P = await import('/Life/src/xiangqi/pikafish.ts');
  const N = await import('/Life/src/xiangqi/notation.ts');
  const R = await import('/Life/src/xiangqi/rules.ts');
  await P.loadEngine();
  if (!P.engineReady()) return null;
  const all = (await import('/Life/src/xiangqi/puzzles.ts')).allPuzzles();
  const pz = all.find((p) => p.id === 'mate2-qi');
  const pos = N.fromFen(pz.fen);
  const ms = R.legalMoves(pos.board, pos.toMove).filter((m) => !R.isInCheck(R.applyMove(pos.board, m), pos.toMove));
  for (const m of ms) {
    const t = N.moveToText(pos.board, m);
    if (t === pz.answer || (pz.also ?? []).includes(t)) continue;
    const s = await P.engineScoreMove(pos.board, pos.toMove, m, { movetime: 250 });
    if (s?.mateIn !== undefined && s.mateIn > 2 && s.mateIn <= 12) return { t, mateIn: s.mateIn };
  }
  return null;
});
if (slow) {
  await page.evaluate((t) => window.__xqTrain.play(t), slow.t);
  await until(() => { const s = window.__xqTrain.state(); return !s.busy || s.answered; }, null, 30000);
  await until(() => !window.__xqTrain.state().busy, null, 30000);
  const s2 = await st();
  const fb2b = (await page.locator('.xq-tr-fb').innerText()).replace(/\s+/g, ' ');
  console.log(`   慢一点的杀 ${slow.t}（${slow.mateIn} 步）：${fb2b.slice(0, 100)}`);
  ok(`杀法题走了一手慢一点的杀（${slow.t}，${slow.mateIn} 步杀）：不判错，步数放宽到 ${s2.totalMine}`, !(s2.answered && s2.verdict?.correct === false) && s2.totalMine > 2 && fb2b.includes('也能杀'));
} else console.log('   这道题找不到慢一点的杀（或引擎没起来），跳过');

// ───────── 3. 战术题：走出原谱之外的着法，皮卡鱼来核对 ─────────
await page.evaluate(() => window.__xqCoach.puzzle('tactic-1'));
await page.waitForTimeout(500);
ok('战术题要走 3 步', (await st()).totalMine === 3);
await stepRight();
// 第二步故意不走原谱，走一手别的
const alt = await page.evaluate(() => {
  const s = window.__xqTrain.state();
  return s;
});
void alt;
await page.evaluate(() => {
  // 找一手不是原谱的着法：用 playWrong
  window.__xqTrain.playWrong();
});
ok('不是原谱的一手：先说"正在让皮卡鱼核对"', await until(() => (document.querySelector('.xq-tr-fb')?.textContent ?? '').includes('皮卡鱼'), null, 5000));
ok('皮卡鱼核对完给出结论', await until(() => { const s = window.__xqTrain.state(); return s.answered || (!s.busy && s.myStep === 2); }, null, 30000));
console.log('   核对：' + (await page.locator('.xq-tr-fb').innerText()).replace(/\s+/g, ' ').slice(0, 120));
if ((await st()).answered && !(await st()).verdict?.correct) {
  const s3 = await sameSaid();
  ok(`判错时你走的（${s3.you}）和该走的（${s3.should}）不是同一手`, !s3.same);
  ok('判错时教练讲：你这手在干什么、对方会这样接、该走的好在哪', await until(() => !!document.querySelector('.xq-tr-fb [data-talk]'), null, 30000) && /你这手[\s\S]*该走/.test(await page.locator('[data-talk]').innerText()));
} else {
  // 皮卡鱼认可了这一手：接着走皮卡鱼的首选，它必须被判对（原来三次搜索各算各的，首选也会被判"差 0.9 个兵"）
  await page.evaluate(() => window.__xqTrain.playRight());
  await until(() => { const s = window.__xqTrain.state(); return s.answered || (!s.busy && s.myStep >= 3); }, null, 40000);
  const s3 = await sameSaid();
  ok(`离开原谱后照皮卡鱼首选走：不被判错（或者判错时你走的 ${s3.you} ≠ 该走的 ${s3.should}）`, !s3.same);
}

// ───────── 4. 残局题：主变走完，接着和皮卡鱼下到底 ─────────
await page.evaluate(() => window.__xqCoach.puzzle('egp-c-aa-vs-r-1'));
await page.waitForTimeout(500);
for (let i = 0; i < 4; i++) {
  if ((await st()).answered || (await page.locator('#xq-tr-on').count())) break;
  await stepRight();
}
ok('主变走完：要求接着下到底', await until(() => !!document.querySelector('#xq-tr-on'), null, 20000));
ok('说明要守成和棋', (await page.locator('.xq-tr-fb').innerText()).includes('守成和棋'));
await page.locator('#xq-tr-on').click();
await page.waitForTimeout(800);
ok('进了下到底的界面，对手是皮卡鱼', (await page.locator('.xq-po').count()) === 1 && (await page.locator('.xq-po-opp').innerText()).includes('皮卡鱼'));
ok('目标是守和', (await page.locator('.xq-po-goal').innerText()).includes('守和'));
// 用户截图：题目界面设了 hidden 却还显示着（.xq-tr 写了 display:flex 把默认的 [hidden] 盖掉了），
// 和下到底的界面叠成两层——两个棋盘、两排按钮压在一起
const layers = await page.evaluate(() => ({
  tr: [...document.querySelectorAll('.xq-tr')].filter((e) => e.getBoundingClientRect().height > 0).length,
  boards: [...document.querySelectorAll('canvas')].filter((e) => e.getBoundingClientRect().height > 0).length,
}));
ok(`下到底时题目界面整个藏起来，只看得见一块棋盘（题目界面 ${layers.tr} 个、棋盘 ${layers.boards} 块）`, layers.tr === 0 && layers.boards === 1);
await page.screenshot({ path: OUT + '/puzzle-playout.png' });
await until(() => window.__xqPlay.state().turn === 'b' || window.__xqPlay.state().turn === 'r', null, 5000);
await page.locator('.xq-po-acts [data-act="resign"]').click();
ok('认输：这题算没过', await until(() => (document.querySelector('.xq-po-result')?.textContent ?? '').includes('输了'), null, 20000));
await page.locator('#xq-po-next').click();
await page.waitForTimeout(600);
ok('下完回到学棋首页', (await page.locator('.xq-po').count()) === 0);

// ───────── 5. 邪门布局：破解到底 ─────────
await page.evaluate(() => window.__xqCoach.trickFull('tiehuache'));
await page.waitForTimeout(800);
ok('破解到底：摆好破解之后的局面，对手是皮卡鱼', (await page.locator('.xq-po').count()) === 1 && (await page.locator('.xq-po-opp').innerText()).includes('皮卡鱼'));
ok('目标：将死或者胜势已定', (await page.locator('.xq-po-goal').innerText()).includes('胜势已定'));
ok('教练在算并按目标说局面', await until(() => /胜势|和势|危险|约|优/.test(window.__xqPlay.coach() ?? '') && (window.__xqPlay.study()?.depth ?? 0) >= 8, null, 30000));
console.log('   教练：' + (await page.evaluate(() => window.__xqPlay.coach())));
// 照教练的首选走两步，对手要应
for (let i = 0; i < 2; i++) {
  await until(() => { const s = window.__xqPlay.study(); return !!s && s.depth >= 10 && !window.__xqPlay.state().busy; }, null, 30000);
  const best = await page.evaluate(() => window.__xqPlay.study()?.best);
  if (!best) break;
  await page.evaluate((m) => window.__xqPlay.play(m), best);
  await until(() => window.__xqPlay.state().turn === 'b' && !window.__xqPlay.state().busy, null, 30000);
}
ok('对手确实是皮卡鱼在应', (await page.evaluate(() => window.__xqPlay.opp().last)) === 'pro');
await page.screenshot({ path: OUT + '/trick-full.png' });

await browser.close();
console.log('\n===== 失败项 =====\n' + (errs.length ? errs.join('\n') : '无'));
process.exit(errs.length ? 1 : 0);
