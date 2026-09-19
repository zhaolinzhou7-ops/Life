/**
 * AI 英语教练 · 界面走查
 *
 * 覆盖单元测试覆盖不到的那一半：真实窗口宽度下会不会错位、长文本会不会把
 * 卡片撑破、麦克风不可用时用户看到的是什么、AI 网关挂掉时会不会白屏、
 * 深色模式下有没有浅字压浅底、刷新之后进度还在不在。
 *
 * 截图写到 OUT 目录，出问题时看图比读日志快。
 *
 * 用法：npm run build && npm run preview，然后 node tests/ui/english.mjs
 */
import fs from 'fs';
import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://localhost:4173/Life/';
const OUT = process.env.OUT || 'node_modules/.cache/shots';
fs.mkdirSync(OUT, { recursive: true });

const errors = [];
const results = [];
const check = (label, cond, detail = '') => results.push({ label, ok: !!cond, detail });

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

/** 每个上下文都挂上控制台和未捕获异常的监听——白屏通常先在这里露头 */
function watch(page, tag) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // apifail 那一节**故意**把网关指向一个不存在的地址，浏览器必然会在控制台
    // 记一条连接被拒绝。那正是被测行为本身，不算产品的错误。
    if (tag === 'apifail' && /ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) return;
    errors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
}

/**
 * 从合集首页点进英语教练。
 *
 * 合集首页是一个 position:fixed 的滚动容器，卡片有时会停在视口上方，
 * 这时 Playwright 的自动滚动够不着它，点击会一路重试到超时。
 * 所以先把容器归位再点。
 */
async function clickCoachCard(page) {
  await page.waitForSelector('.home-card', { timeout: 8000 });
  await page.evaluate(() => {
    document.querySelector('.screen')?.scrollTo(0, 0);
    window.scrollTo(0, 0);
  });
  const card = page.locator('.home-card', { hasText: 'AI 英语教练' }).first();
  await card.scrollIntoViewIfNeeded();
  await card.click();
  await page.waitForSelector('.ec-app', { timeout: 8000 });
}

async function enter(page) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await clickCoachCard(page);
}

/** 横向溢出：手机上最常见也最丑的布局事故 */
async function noOverflow(page, tag, label) {
  const o = await page.evaluate(() => ({
    bw: document.body.scrollWidth,
    iw: window.innerWidth,
    aw: document.querySelector('.ec-app')?.scrollWidth ?? 0,
    acw: document.querySelector('.ec-app')?.clientWidth ?? 0,
  }));
  check(`${tag} ${label} 无横向溢出`, o.bw <= o.iw + 1 && o.aw <= o.acw + 1, JSON.stringify(o));
}

/** 走完一次入门 + 测评。返回时停在能力报告页 */
async function runOnboardAndAssess(page, tag, { skipOpen = false } = {}) {
  await page.getByRole('button', { name: '下一步：做个能力诊断' }).click();
  await page.waitForSelector('.ec-opt, .ec-input', { timeout: 6000 });

  // 十四道题：选择题点第一个，开放题填一段话
  for (let step = 0; step < 20; step++) {
    if (await page.locator('.ec-empty-title').first().isVisible().catch(() => false)) {
      const t = await page.locator('.ec-empty-title').first().innerText();
      if (t.includes('正在分析')) break;
    }
    const opts = page.locator('.ec-opt');
    if ((await opts.count()) > 0) {
      await opts.first().click();
      await page.waitForTimeout(240);
      continue;
    }
    const ta = page.locator('textarea.ec-input');
    if ((await ta.count()) > 0) {
      if (skipOpen) {
        await page.getByRole('button', { name: '这题先跳过' }).click();
      } else {
        await ta.first().fill('I work as a designer. Yesterday I go to a meeting with my client.');
        await page.getByRole('button', { name: '提交', exact: true }).click();
      }
      await page.waitForTimeout(240);
      continue;
    }
    break;
  }

  await page.waitForSelector('.ec-skillrow', { timeout: 10000 });
  check(`${tag} 测评能走完并出报告`, true);
}

// ══════════════ 1. 三种屏宽下的主流程 ══════════════

const VIEWPORTS = [
  { name: 'iPhone-SE-320', width: 320, height: 568 },
  { name: 'iPhone-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
];

for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  watch(page, vp.name);
  await enter(page);

  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ec-${vp.name}-1-onboard.png`, fullPage: true });
  check(`${vp.name} 入门页渲染`, await page.locator('.ec-app h1').first().isVisible());
  await noOverflow(page, vp.name, '入门页');

  // 选目标和时长
  await page.getByText('工作里能用英语沟通').click();
  await page.getByText('20 分钟').click();

  await runOnboardAndAssess(page, vp.name);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ec-${vp.name}-2-report.png`, fullPage: true });
  await noOverflow(page, vp.name, '报告页');

  // 报告必须给出分项，而不只是一个总等级
  const skillCount = await page.locator('.ec-skillrow').count();
  check(`${vp.name} 报告有分技能等级`, skillCount >= 6, `${skillCount} 项`);
  const bodyText = await page.locator('.ec-app').innerText();
  check(`${vp.name} 报告说清了瓶颈`, /瓶颈/.test(bodyText));
  check(`${vp.name} 报告写明了测评的局限`, /不是权威等级认定/.test(bodyText));

  // 点开一项能看到依据
  await page.locator('.ec-skillrow').first().click();
  await page.waitForTimeout(150);
  check(`${vp.name} 等级能点开看依据`, await page.locator('.ec-skill-evidence:visible').count() > 0);

  // 进今日训练
  await page.getByRole('button', { name: /开始今天的训练|好，开始今天的训练/ }).click();
  await page.waitForSelector('.ec-act, .ec-page', { timeout: 6000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ec-${vp.name}-3-today.png`, fullPage: true });
  await noOverflow(page, vp.name, '今日训练');

  const home = await page.locator('.ec-app').innerText();
  check(`${vp.name} 首页给出了今天练什么`, /今日训练|今天练完了/.test(home));
  check(`${vp.name} 每项都说了为什么`, /为什么是这些/.test(home));
  const actCount = await page.locator('.ec-act').count();
  check(`${vp.name} 今日训练有具体条目`, actCount >= 2, `${actCount} 项`);

  await ctx.close();
}

// ══════════════ 2. 完整学习闭环（390 宽） ══════════════

{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
  const page = await ctx.newPage();
  watch(page, 'flow');
  await enter(page);
  await page.getByText('工作里能用英语沟通').click();
  await runOnboardAndAssess(page, 'flow');
  await page.getByRole('button', { name: /开始今天的训练|好，开始今天的训练/ }).click();
  await page.waitForSelector('.ec-act', { timeout: 6000 });

  // —— 每日训练编排：点一次"开始"，一项接一项走下去，中间不用再做选择 ——
  {
    const titles = await page.locator('.ec-act-title').allInnerTexts();
    check('今日训练条目不重复报活动类型', !titles.some((t) => /(\S+) · \1[：:]/.test(t)), titles.join(' | '));

    await page.getByRole('button', { name: /开始今天的训练/ }).click();
    await page.waitForTimeout(500);
    const firstTitle = await page.locator('.ec-topbar-title').innerText();
    check('点"开始"直接进入第一项，不用再选', firstTitle.length > 0, firstTitle);
    await page.screenshot({ path: `${OUT}/ec-flow-0-activity.png`, fullPage: true });

    // 专项纠错这一项：用自己说错的句子出题，答对要有真实判定
    if (/专项/.test(firstTitle)) {
      const ta = page.locator('textarea.ec-input').first();
      if (await ta.count()) {
        await ta.fill('I really like it.');
        await page.getByRole('button', { name: '检查' }).click();
        await page.waitForTimeout(300);
        const fb = await page.locator('.ec-explain').last().innerText();
        check('专项纠错会真的判定改对没有', /对了|还是同一个问题/.test(fb), fb.slice(0, 60));
      }
    }

    // 退出训练回首页，进度要留下来
    await page.locator('.ec-back').click();
    await page.waitForTimeout(400);
    const backHome = await page.locator('.ec-app').innerText();
    check('训练中途退出能回到首页', /今日训练|今天练完了/.test(backHome));
  }

  // —— 场景对话：从场景库直接进，测"办成事"这条主线 ——
  await page.getByText('场景库', { exact: false }).first().click();
  await page.waitForSelector('.ec-card', { timeout: 5000 });
  await page.screenshot({ path: `${OUT}/ec-flow-1-library.png`, fullPage: true });
  const libText = await page.locator('.ec-app').innerText();
  check('场景卡写清了要办成什么事', /要办成的事/.test(libText));

  // 挑酒店入住
  await page.getByText('酒店入住', { exact: false }).first().click();
  await page.waitForSelector('.ec-page', { timeout: 5000 });
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${OUT}/ec-flow-2-intro.png`, fullPage: true });
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForSelector('.ec-msg.coach', { timeout: 5000 });
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ec-flow-3-chat.png`, fullPage: true });

  // ★ 只说 Hello：NPC 必须留在角色里，不能跳出来讲语法
  await page.locator('textarea.ec-input').fill('Hello.');
  await page.getByRole('button', { name: '说这句' }).click();
  await page.waitForTimeout(700);
  const afterHello = await page.locator('.ec-msg.coach').last().innerText();
  check('只说 Hello 时 NPC 留在角色里', !/语法|grammar|should say/i.test(afterHello), afterHello.slice(0, 60));
  const stepText = await page.locator('.ec-goal').innerText();
  check('没推进时任务步骤不变', /这一步/.test(stepText));

  // ★ 四级提示：一次只开一级
  await page.getByRole('button', { name: '给我一点提示' }).click();
  await page.waitForTimeout(150);
  check('提示第一级是关键词', await page.locator('.ec-hint-keys').isVisible());
  check('第一级不会直接给出完整答案', (await page.locator('.ec-hint-full').count()) === 0);
  await page.locator('.ec-hint-more').click();
  await page.waitForTimeout(120);
  await page.locator('.ec-hint-more').click();
  await page.waitForTimeout(120);
  await page.locator('.ec-hint-more').click();
  await page.waitForTimeout(150);
  check('第四级才给完整参考', await page.locator('.ec-hint-full').isVisible());
  await page.screenshot({ path: `${OUT}/ec-flow-4-hints.png`, fullPage: true });

  // 照着提示把整局走完
  for (let turn = 0; turn < 8; turn++) {
    const full = await page.locator('.ec-hint-full').first().innerText().catch(() => null);
    if (!full) {
      const more = page.locator('.ec-hint-more');
      if (await more.isVisible().catch(() => false)) {
        for (let k = 0; k < 4; k++) {
          if (await more.isVisible().catch(() => false)) await more.click();
          await page.waitForTimeout(80);
        }
      }
    }
    const answer = await page.locator('.ec-hint-full').first().innerText().catch(() => null);
    if (!answer) break;
    await page.locator('textarea.ec-input').fill(answer);
    await page.getByRole('button', { name: '说这句' }).click();
    await page.waitForTimeout(600);
    if ((await page.locator('.ec-corr').count()) > 0) break; // 已经进复盘
  }

  await page.waitForSelector('.ec-progress', { timeout: 6000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/ec-flow-5-debrief.png`, fullPage: true });
  const debrief = await page.locator('.ec-app').innerText();
  check('对话结束后有复盘', /复盘|你做得好的地方|下一次练什么/.test(debrief));
  check('复盘说清下一次练什么', /下一次练什么/.test(debrief));

  // ★ 复盘必须从头开始显示。对话过程中容器被滚到了底部，不归位的话
  // 用户一打开就停在页面中间，第一眼漏掉"任务完成"和"你做得好的地方"
  const top = await page.evaluate(() => {
    const app = document.querySelector('.ec-app');
    const head = document.querySelector('.ec-page .ec-card');
    return { scrollTop: app.scrollTop, headTop: head?.getBoundingClientRect().top ?? -999 };
  });
  check('★ 复盘页从顶部开始显示', top.scrollTop <= 2 && top.headTop >= 0, JSON.stringify(top));
  await noOverflow(page, 'flow', '复盘页');

  // 复盘里的数字必须能点开看口径
  const metricHead = page.locator('.ec-metric-head');
  if ((await metricHead.count()) > 0) {
    await page.locator('.ec-collapse-head').last().click();
    await page.waitForTimeout(150);
    await metricHead.first().click();
    await page.waitForTimeout(150);
    check('数字能点开看"怎么算的"', (await page.locator('.ec-metric-how:visible').count()) > 0);
  }

  await ctx.close();
}

// ══════════════ 3. 数据持久化：刷新之后还在 ══════════════

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'persist');
  await enter(page);
  await page.getByText('出国旅行不发怵').click();
  await runOnboardAndAssess(page, 'persist');
  await page.getByRole('button', { name: /开始今天的训练|好，开始今天的训练/ }).click();
  await page.waitForSelector('.ec-act', { timeout: 6000 });
  const before = await page.locator('.ec-act-title').allInnerTexts();

  // 刷新
  await page.reload({ waitUntil: 'networkidle' });
  await clickCoachCard(page);
  await page.waitForTimeout(350);
  const stillHome = await page.locator('.ec-app').innerText();
  check('刷新后不会又被要求重新测评', !/开始诊断/.test(stillHome), stillHome.slice(0, 80));
  const after = await page.locator('.ec-act-title').allInnerTexts();
  check('★ 刷新后今天的计划不变', JSON.stringify(before) === JSON.stringify(after), `${before.length} vs ${after.length}`);
  await page.screenshot({ path: `${OUT}/ec-persist.png`, fullPage: true });
  await ctx.close();
}

// ══════════════ 4. 没有麦克风权限时 ══════════════

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'nomic');
  // 把语音识别整个拿掉，模拟不支持的浏览器
  await page.addInitScript(() => {
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await enter(page);
  await page.getByText('日常闲聊能接得住').click();
  await runOnboardAndAssess(page, 'nomic');
  await page.getByRole('button', { name: /开始今天的训练|好，开始今天的训练/ }).click();
  await page.waitForSelector('.ec-act', { timeout: 6000 });

  await page.getByText('场景库', { exact: false }).first().click();
  await page.waitForSelector('.ec-card');
  await page.locator('.ec-card').first().click();
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForSelector('.ec-msg.coach', { timeout: 5000 });
  await page.waitForTimeout(250);
  const micDisabled = await page.locator('.ec-mic').isDisabled();
  const hint = await page.locator('.ec-listening').innerText();
  check('★ 不支持语音识别时麦克风被禁用', micDisabled);
  check('★ 并且明确告诉用户可以打字', /打字/.test(hint), hint.slice(0, 80));
  // 打字这条路必须还能走通
  await page.locator('textarea.ec-input').fill('Hi there, nice to meet you.');
  await page.getByRole('button', { name: '说这句' }).click();
  await page.waitForTimeout(600);
  check('★ 没有麦克风也能完成对话轮次', (await page.locator('.ec-msg.user').count()) >= 1);
  await page.screenshot({ path: `${OUT}/ec-nomic.png`, fullPage: true });
  await ctx.close();
}

// ══════════════ 5. AI 网关挂掉时 ══════════════

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'apifail');
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    localStorage.setItem(
      'coach-ai-config',
      JSON.stringify({ mode: 'remote', endpoint: 'http://127.0.0.1:59999/dead', token: '', model: '', timeoutMs: 2000 }),
    ),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await clickCoachCard(page);
  await page.getByText('工作里能用英语沟通').click();
  await runOnboardAndAssess(page, 'apifail');
  check('★ 网关挂掉时测评照常出报告', (await page.locator('.ec-skillrow').count()) >= 6);

  await page.getByRole('button', { name: /开始今天的训练|好，开始今天的训练/ }).click();
  await page.waitForSelector('.ec-act', { timeout: 6000 });
  await page.getByText('场景库', { exact: false }).first().click();
  await page.waitForSelector('.ec-card');
  await page.locator('.ec-card').first().click();
  await page.getByRole('button', { name: '开始' }).click();
  await page.waitForSelector('.ec-msg.coach', { timeout: 5000 });
  await page.locator('textarea.ec-input').fill('Hi, I am Lin. Nice to meet you.');
  await page.getByRole('button', { name: '说这句' }).click();
  // 网关要 2 秒超时，等它走完降级
  await page.waitForTimeout(4000);
  check('★ 网关挂掉时对话仍然继续', (await page.locator('.ec-msg.coach').count()) >= 2);
  const reply = await page.locator('.ec-msg.coach').last().innerText();
  check('★ 降级后的台词不是空的', reply.trim().length > 0, reply.slice(0, 60));
  await page.screenshot({ path: `${OUT}/ec-apifail.png`, fullPage: true });
  await ctx.close();
}

// ══════════════ 6. 长文本压力 ══════════════

{
  const ctx = await browser.newContext({ viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true });
  const page = await ctx.newPage();
  watch(page, 'stress');
  await enter(page);
  await page.getByText('工作里能用英语沟通').click();
  await page.getByRole('button', { name: '下一步：做个能力诊断' }).click();
  await page.waitForSelector('.ec-opt, .ec-input', { timeout: 6000 });
  for (let step = 0; step < 20; step++) {
    const opts = page.locator('.ec-opt');
    if ((await opts.count()) > 0) {
      await opts.first().click();
      await page.waitForTimeout(220);
      continue;
    }
    const ta = page.locator('textarea.ec-input');
    if ((await ta.count()) > 0) {
      // 超长且满是错误的输入：既压排版，也压纠错引擎
      await ta.first().fill(('I very like my work and I am student and yesterday I go to meeting. ').repeat(12));
      await page.getByRole('button', { name: '提交', exact: true }).click();
      await page.waitForTimeout(260);
      continue;
    }
    break;
  }
  await page.waitForSelector('.ec-skillrow', { timeout: 12000 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ec-stress-320.png`, fullPage: true });
  await noOverflow(page, 'stress', '长文本报告页');
  const corrCount = await page.locator('.ec-corr').count();
  check('长文本能被纠错引擎处理', corrCount > 0, `${corrCount} 条`);
  await ctx.close();
}

// ══════════════ 7. 深色模式 ══════════════

{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  watch(page, 'dark');
  await enter(page);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ec-dark-1-onboard.png`, fullPage: true });

  const contrast = await page.evaluate(() => {
    const lum = (c) => {
      const m = c.match(/\d+/g).map(Number);
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    };
    const app = document.querySelector('.ec-app');
    const h1 = document.querySelector('.ec-app h1');
    return { bg: lum(getComputedStyle(app).backgroundColor), fg: lum(getComputedStyle(h1).color) };
  });
  check('深色模式底色够暗', contrast.bg < 0.3, JSON.stringify(contrast));
  check('深色模式文字够亮', contrast.fg > 0.6, JSON.stringify(contrast));

  await page.getByText('工作里能用英语沟通').click();
  await runOnboardAndAssess(page, 'dark');
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${OUT}/ec-dark-2-report.png`, fullPage: true });
  await ctx.close();
}

// ══════════════ 8. 设置页与进步页 ══════════════

{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  watch(page, 'pages');
  await enter(page);
  await page.getByText('工作里能用英语沟通').click();
  await runOnboardAndAssess(page, 'pages');
  await page.getByRole('button', { name: /开始今天的训练|好，开始今天的训练/ }).click();
  await page.waitForSelector('.ec-act', { timeout: 6000 });

  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/ec-settings.png`, fullPage: true });
  const s = await page.locator('.ec-app').innerText();
  check('设置页说清了不填网关也能用', /所有功能都可用|只用本地引擎/.test(s));
  check('★ 设置页明确写了不提供发音评分', /不提供发音评分/.test(s));
  check('★ 设置页警告不要把 Key 填在前端', /不要把模型的 API Key 填在这里/.test(s));
  await noOverflow(page, 'pages', '设置页');

  await page.locator('.ec-back').click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '进步' }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/ec-progress.png`, fullPage: true });
  const p = await page.locator('.ec-app').innerText();
  check('★ 进步页把"真的进步"和"活动量"分开讲', /真的进步/.test(p) && /活动量/.test(p));
  check('进步页说明了会用的词怎么算', /会用的词/.test(p));
  await noOverflow(page, 'pages', '进步页');
  await ctx.close();
}

await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(`\n通过 ${results.length - failed.length}/${results.length} 项`);
if (failed.length) {
  console.log('\n未通过：');
  failed.forEach((f) => console.log(`  · ${f.label} ${f.detail}`));
}
console.log(`\n控制台错误：${errors.length}`);
errors.slice(0, 12).forEach((e) => console.log('  ! ' + e));
process.exit(failed.length || errors.length ? 1 : 0);
