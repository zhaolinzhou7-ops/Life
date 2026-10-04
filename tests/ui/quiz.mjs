/**
 * 花样题：练习里换着问法出题（点子题、选择题、判断题、认杀法），答完当场显示分数加减；每日一题。
 * 用户原话："目前像眼力、战术之类的测验题目都千篇一律。这些东西都需要去向《天天象棋》看齐。"
 * 用法：npm run dev，然后 node tests/ui/quiz.mjs
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

async function coachPick() {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('xq-power', 'save'));
  await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
  await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(600);
  if (await page.getByText('业 4-5').count()) { await page.getByText('业 4-5').first().click(); await page.waitForTimeout(500); }
  await page.evaluate((m) => window.__xqCoach.menu(m), 'tactics'); await page.waitForTimeout(300);
}

/** 做完一组 10 道：花样题直接答对，走子题照正解走；记下每一道的题型 */
async function runSet(label) {
  const seen = [];
  let scored = 0;
  for (let k = 0; k < 10; k++) {
    await until(page, () => !!document.querySelector('.xq-quiz, .xq-tr'), null, 15000);
    const isQuiz = await page.evaluate(() => !!document.querySelector('.xq-quiz'));
    if (isQuiz) {
      const type = await page.evaluate(() => document.querySelector('.xq-quiz')?.dataset.quiz);
      seen.push(type);
      if (seen.filter((x) => x === type).length === 1) await page.screenshot({ path: `${OUT}/quiz-${label}-${type}.png` });
      await page.evaluate(() => window.__xqQuiz.solve());
      await page.waitForTimeout(200);
      const fb = await page.locator('.xq-tr-fb').innerText();
      if (/分 \d+ → \d+（[+-]?\d+）|不计分/.test(fb)) scored++;
      await page.locator('#xq-quiz-next').click();
    } else {
      seen.push('move');
      for (let i = 0; i < 40; i++) {
        const st = await page.evaluate(() => window.__xqTrain?.state());
        if (!st || st.answered) break;
        if (!st.busy) await page.evaluate(() => window.__xqTrain.playRight());
        await page.waitForTimeout(300);
      }
      // 残局题主变走完要不要下到底：这里不下
      if (await page.locator('#xq-tr-giveup').count()) await page.locator('#xq-tr-giveup').click();
      await until(page, () => !!document.querySelector('#xq-tr-next'), null, 10000);
      await page.locator('#xq-tr-next').click();
    }
    await page.waitForTimeout(500);
    if (await page.locator('[data-score]').count()) break;
  }
  return { seen, scored };
}

// ───────── 1. 战术练习：选择题、判断题和走子题混着出 ─────────
await coachPick();
await page.locator('.xq-coach .card', { hasText: '战术' }).first().click(); await page.waitForTimeout(1200);
let r = await runSet('tactic');
console.log('   战术这一组：' + r.seen.join(' '));
ok('战术练习不再只有一种问法：出了选择题或判断题', r.seen.some((t) => t === 'choice' || t === 'judge'));
ok('走子题照样有（那是根本）', r.seen.includes('move'));
ok('花样题答完当场显示分数加减', r.scored === r.seen.filter((t) => t !== 'move').length);
await until(page, () => !!document.querySelector('[data-score]'), null, 10000);
const score = await page.locator('[data-score]').innerText();
console.log('   结算：' + score);
ok('一组做完，结算页写出这一维的分数变化', /战术分 \d+ → \d+（[+-]?\d+）/.test(score));
await page.screenshot({ path: `${OUT}/quiz-finish.png` });

// ───────── 2. 眼力练习：点子题 ─────────
await coachPick();
await page.locator('.xq-coach .card', { hasText: '眼力' }).first().click(); await page.waitForTimeout(1200);
r = await runSet('safety');
console.log('   眼力这一组：' + r.seen.join(' '));
ok('眼力练习出了点子题（点出被捉的子 / 没保护的子）', r.seen.includes('tap'));

// 点子题点错：标出正确的子，判错
await coachPick();
await page.locator('.xq-coach .card', { hasText: '眼力' }).first().click(); await page.waitForTimeout(1200);
let gotTap = false;
for (let k = 0; k < 10 && !gotTap; k++) {
  await until(page, () => !!document.querySelector('.xq-quiz, .xq-tr'), null, 15000);
  const t = await page.evaluate(() => document.querySelector('.xq-quiz')?.dataset.quiz ?? 'move');
  if (t === 'tap') {
    gotTap = true;
    await page.evaluate(() => window.__xqQuiz.miss());
    await page.waitForTimeout(200);
    const fb = await page.locator('.xq-tr-fb').innerText();
    console.log('   点错：' + fb.replace(/\s+/g, ' ').slice(0, 80));
    ok('点子题点错判错，并说清楚该点几个', fb.includes('❌') && fb.includes('应该点'));
    await page.screenshot({ path: `${OUT}/quiz-tap-miss.png` });
    break;
  }
  if (t === 'move') {
    for (let i = 0; i < 40; i++) {
      const st = await page.evaluate(() => window.__xqTrain?.state());
      if (!st || st.answered) break;
      if (!st.busy) await page.evaluate(() => window.__xqTrain.playRight());
      await page.waitForTimeout(300);
    }
    if (await page.locator('#xq-tr-giveup').count()) await page.locator('#xq-tr-giveup').click();
    await until(page, () => !!document.querySelector('#xq-tr-next'), null, 10000);
    await page.locator('#xq-tr-next').click();
  } else {
    await page.evaluate(() => window.__xqQuiz.solve());
    await page.locator('#xq-quiz-next').click();
  }
  await page.waitForTimeout(400);
}
ok('一组眼力题里遇到了点子题', gotTap);

// ───────── 3. 每日一题 ─────────
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.getByText('中国象棋', { exact: false }).first().click(); await page.waitForTimeout(600);
await page.locator('[data-home="coach"]').click(); await page.waitForTimeout(600);
// 每日一题在 私教 › 杀法与战术 里
await page.locator('[data-act="m-tactics"]').click(); await page.waitForTimeout(400);
ok('私教 › 杀法与战术 里有每日一题', (await page.getByText('📅 每日一题').count()) > 0);
await page.getByText('📅 每日一题').first().click(); await page.waitForTimeout(1200);
ok('每日一题打得开', (await page.locator('.xq-tr').count()) > 0);
await page.screenshot({ path: `${OUT}/quiz-daily.png` });

console.log(errs.length ? `\n✗ ${errs.length} 项不通过：\n  ${errs.join('\n  ')}` : '\n全部通过');
await browser.close();
process.exit(errs.length ? 1 : 0);
