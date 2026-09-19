/**
 * 儿童英语学习伙伴 · 界面走查
 *
 * 覆盖单元测试覆盖不到的那一半：真实窗口宽度下会不会错位、大按钮在小手指
 * 够得着的尺寸上、麦克风被拒绝时孩子会不会卡住、AI 网关挂掉时是不是白屏、
 * 刷新之后学习记录还在不在。
 *
 * 浏览器环境的两个现实约束，走查里直接坐实：
 *  · 无头 Chromium 没有语音识别（SpeechRecognition 不存在），
 *    所以这一遍跑的正好是「麦克风不可用」这条降级路径——它必须完全能走通。
 *  · 无头环境的 speechSynthesis 不发声但接口在，onEnd 可能不触发，
 *    所以流程绝不能依赖朗读结束来推进。这里如果卡住，就是真的有 bug。
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
function check(label, cond, detail = '') {
  results.push({ label, ok: !!cond, detail });
  if (!cond) console.log(`  ✗ ${label} ${detail}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

function watch(page, tag, { allowNetworkErrors = false } = {}) {
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    // 「网关挂掉」那一节是故意连一个不存在的地址，浏览器必然会在控制台打一条
    // ERR_CONNECTION_REFUSED。那正是这一节要测的东西，不算应用出错。
    if (allowNetworkErrors && /ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) return;
    errors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
}

/** 进入英语应用，并建好一个孩子档案 */
async function enter(page, { name = 'Mimi', age = '5' } = {}) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByText('AI 儿童英语学习伙伴', { exact: false }).first().click();
  await page.waitForSelector('.en-app', { timeout: 5000 });
  // 首次进来是建档页
  if (await page.locator('.en-input[type="text"]').first().isVisible().catch(() => false)) {
    await page.locator('.en-input').first().fill(name);
    await page.getByRole('button', { name: age, exact: true }).first().click();
    await page.getByRole('button', { name: '开始吧！' }).click();
    await page.waitForTimeout(400);
  }
}

/** 没有横向溢出——儿童端一旦横向能滑，孩子就会滑出去然后不知道怎么回来 */
async function noOverflow(page, tag, vp) {
  const o = await page.evaluate(() => {
    const el = document.querySelector('.en-app');
    return {
      sw: el ? el.scrollWidth : 0,
      cw: el ? el.clientWidth : 0,
      bw: document.body.scrollWidth,
      iw: window.innerWidth,
    };
  });
  check(`${vp} ${tag} 无横向溢出`, o.sw <= o.cw + 1 && o.bw <= o.iw + 1, JSON.stringify(o));
}

/** 把测评一路答完（无头环境没有语音识别，跟读题走「我说啦」） */
async function finishAssessment(page) {
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(300);
  for (let i = 0; i < 20; i++) {
    // 测评结束
    if (await page.getByRole('button', { name: '看看今天学什么' }).isVisible().catch(() => false)) break;
    const said = page.getByRole('button', { name: /我说啦/ });
    if (await said.isVisible().catch(() => false)) {
      await said.click();
      await page.waitForTimeout(500);
      continue;
    }
    const opts = page.locator('.en-opt');
    if ((await opts.count()) > 0) {
      // 逐个点，点中正确的会自动进下一题
      for (let k = 0; k < 3; k++) {
        const o = opts.nth(k);
        if (!(await o.isVisible().catch(() => false))) continue;
        if ((await o.getAttribute('class'))?.includes('wrong')) continue;
        await o.click();
        await page.waitForTimeout(280);
        if ((await page.locator('.en-opt.right').count()) > 0) break;
      }
      await page.waitForTimeout(500);
      continue;
    }
    await page.waitForTimeout(250);
  }
  const done = page.getByRole('button', { name: '看看今天学什么' });
  check('测评能走完并给出结论', await done.isVisible().catch(() => false));
  if (await done.isVisible().catch(() => false)) {
    await done.click();
    await page.waitForTimeout(400);
  }
}

/** 把今日任务从头做到完成页 */
async function runMission(page, { maxSteps = 220 } = {}) {
  await page.getByRole('button', { name: /^(START|CONTINUE|再练一次)$/ }).first().click();
  await page.waitForTimeout(400);

  for (let i = 0; i < maxSteps; i++) {
    // 完成页
    if (await page.getByRole('button', { name: '回到首页' }).isVisible().catch(() => false)) break;

    const clickFirstVisible = async (locator) => {
      if (await locator.isVisible().catch(() => false)) {
        await locator.click();
        await page.waitForTimeout(260);
        return true;
      }
      return false;
    };

    // 各种「继续」型按钮
    if (await clickFirstVisible(page.getByRole('button', { name: /^(NEXT →|Questions →|继续 →|继续|GO!|START)$/ }).first())) continue;
    if (await clickFirstVisible(page.getByRole('button', { name: /我说啦/ }).first())) continue;
    // 对话里的备选答案
    const chips = page.locator('.en-mic-wrap .en-said');
    if ((await chips.count()) > 0 && (await chips.first().isVisible().catch(() => false))) {
      const label = await chips.first().textContent();
      if (label && !/结束|跳过/.test(label)) {
        await chips.first().click();
        await page.waitForTimeout(500);
        continue;
      }
    }
    // 选择题：挨个试，直到点中
    const opts = page.locator('.en-opt');
    if ((await opts.count()) > 0) {
      let hit = false;
      for (let k = 0; k < (await opts.count()); k++) {
        const o = opts.nth(k);
        const cls = (await o.getAttribute('class')) ?? '';
        if (cls.includes('wrong') || cls.includes('right')) continue;
        await o.click();
        await page.waitForTimeout(240);
        if ((await page.locator('.en-opt.right').count()) > 0) {
          hit = true;
          break;
        }
      }
      await page.waitForTimeout(hit ? 700 : 300);
      continue;
    }
    await page.waitForTimeout(250);
  }
  return page.getByRole('button', { name: '回到首页' }).isVisible().catch(() => false);
}

// ═══════════════ 1. 三种屏宽下的儿童端主流程 ═══════════════

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
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/en-${vp.name}-1-home.png` });
  await noOverflow(page, '首页', vp.name);

  // 建完档直接进测评，不让家长自己去找入口
  check(
    `${vp.name} 建档后直接进入测评`,
    await page.getByText('Let\'s play a little game!').isVisible().catch(() => false),
  );
  // 从测评退出来，首页必须仍然在引导去测评，而不是直接给任务
  await page.locator('.en-back').first().click();
  await page.waitForTimeout(300);
  check(
    `${vp.name} 未测评时首页引导去测评`,
    await page.getByText("Let's play a game first!").isVisible().catch(() => false),
  );
  await page.getByRole('button', { name: 'START' }).click();
  await page.waitForTimeout(300);

  await finishAssessment(page);
  await page.waitForSelector('.en-mission', { timeout: 6000 });
  await page.screenshot({ path: `${OUT}/en-${vp.name}-2-mission.png`, fullPage: true });
  await noOverflow(page, '今日任务', vp.name);

  // §4：一眼知道今天做什么
  const steps = await page.locator('.en-step').count();
  check(`${vp.name} 今日任务有步骤`, steps >= 2, `${steps} 步`);
  check(`${vp.name} 今日任务写了预计时长`, /分钟/.test(await page.locator('.en-mission-time').innerText()));
  check(`${vp.name} 有 START 按钮`, await page.getByRole('button', { name: /START|CONTINUE/ }).first().isVisible());

  // 儿童端按钮必须够大（44px 是最低可接受的触控尺寸，主按钮要更大）
  const btnBox = await page.getByRole('button', { name: /START|CONTINUE/ }).first().boundingBox();
  check(`${vp.name} 主按钮够大`, btnBox && btnBox.height >= 52, btnBox ? `${Math.round(btnBox.height)}px` : 'none');

  // §4：不用滑屏就能看到并点到 START。多一步滑动就多一批走不下去的孩子
  check(
    `${vp.name} START 不用滑屏就够得着`,
    btnBox && btnBox.y + btnBox.height <= vp.height + 1,
    btnBox ? `按钮底边 ${Math.round(btnBox.y + btnBox.height)}，屏高 ${vp.height}` : 'none',
  );

  // 首页文字量：儿童端一屏的中文不该多到要"阅读"
  const homeText = await page.locator('.en-page').innerText();
  const zh = (homeText.match(/[一-龥]/g) || []).length;
  check(`${vp.name} 首页中文字数克制`, zh <= 220, `${zh} 字`);

  const finished = await runMission(page);
  check(`${vp.name} 能走完一次完整学习`, finished);
  if (finished) {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}/en-${vp.name}-3-done.png`, fullPage: true });
    await noOverflow(page, '完成页', vp.name);
    const doneText = await page.locator('.en-page').innerText();
    check(`${vp.name} 完成页说清楚学了什么`, /新学|复习|今天做了/.test(doneText));
    await page.getByRole('button', { name: '回到首页' }).click();
    await page.waitForSelector('.en-mission', { timeout: 4000 });
    const doneSteps = await page.locator('.en-step.done').count();
    check(`${vp.name} 首页标记出已完成的步骤`, doneSteps >= 1, `${doneSteps} 步已完成`);
  }

  await ctx.close();
}

// ═══════════════ 2. 刷新后数据还在 ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'persist');
  await enter(page, { name: 'Dodo', age: '6' });
  await finishAssessment(page);
  await page.waitForSelector('.en-mission');
  const before = await page.locator('.en-mission').innerText();

  await page.reload({ waitUntil: 'networkidle' });
  await page.getByText('AI 儿童英语学习伙伴', { exact: false }).first().click();
  await page.waitForSelector('.en-mission', { timeout: 5000 });
  const after = await page.locator('.en-mission').innerText();
  check('刷新后档案还在', (await page.locator('.en-hero h1').innerText()).includes('Dodo'));
  check('刷新后今日任务不变', before === after, `${before.slice(0, 40)} vs ${after.slice(0, 40)}`);
  await ctx.close();
}

// ═══════════════ 3. 麦克风被拒绝 ═══════════════
// 无头 Chromium 本身没有 SpeechRecognition，这里再显式把 getUserMedia 也打掉，
// 模拟家长点了"拒绝"。孩子必须还能把学习走完。
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'mic-denied');
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: () => Promise.reject(new DOMException('Permission denied', 'NotAllowedError')) },
      configurable: true,
    });
    delete window.SpeechRecognition;
    delete window.webkitSpeechRecognition;
  });
  await enter(page, { name: 'Nono', age: '5' });
  await finishAssessment(page);
  await page.waitForSelector('.en-mission');
  await page.screenshot({ path: `${OUT}/en-mic-denied-mission.png`, fullPage: true });

  const ok = await runMission(page);
  check('★ 没有麦克风也能走完整次学习', ok);
  await page.screenshot({ path: `${OUT}/en-mic-denied-done.png`, fullPage: true });
  await ctx.close();
}

// ═══════════════ 4. AI 网关挂掉 ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'api-fail', { allowNetworkErrors: true });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() =>
    localStorage.setItem(
      'english-ai-config',
      JSON.stringify({ mode: 'remote', endpoint: 'http://127.0.0.1:59999/dead', token: '', model: '', timeoutMs: 2000 }),
    ),
  );
  await page.reload({ waitUntil: 'networkidle' });
  await enter(page, { name: 'Lulu', age: '7' });
  await finishAssessment(page);
  await page.waitForSelector('.en-mission');
  const ok = await runMission(page);
  check('★ AI 网关挂掉时学习照常走完', ok);
  await page.screenshot({ path: `${OUT}/en-api-fail-done.png`, fullPage: true });
  await ctx.close();
}

// ═══════════════ 5. 家长端 ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  watch(page, 'parent');
  await enter(page, { name: 'Pipi', age: '8' });
  await finishAssessment(page);
  await page.waitForSelector('.en-mission');
  await runMission(page);
  if (await page.getByRole('button', { name: '回到首页' }).isVisible().catch(() => false)) {
    await page.getByRole('button', { name: '回到首页' }).click();
    await page.waitForSelector('.en-mission');
  }

  // 点一下不该进家长端
  const gate = page.locator('.en-parent-entry');
  await gate.click();
  await page.waitForTimeout(300);
  check('★ 孩子点一下进不了家长端', await page.locator('.en-mission').isVisible());

  // 长按才进
  const box = await gate.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(400);
  check('长按进入家长验证', await page.getByText('家长验证').isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/en-parent-gate.png` });

  // 算术题
  const q = await page.locator('.en-field label').first().innerText();
  const m = q.match(/(\d+)\s*×\s*(\d+)/);
  check('家长验证出的是算术题', !!m, q);
  if (m) {
    await page.locator('.en-input').first().fill(String(Number(m[1]) * Number(m[2])));
    await page.getByRole('button', { name: '进入' }).click();
    await page.waitForTimeout(500);
  }
  check('进入家长看板', await page.locator('.en-tabs').isVisible().catch(() => false));
  await page.screenshot({ path: `${OUT}/en-parent-dash.png`, fullPage: true });
  await noOverflow(page, '家长看板', 'parent');

  // 家长端和儿童端必须明显不同
  const skin = await page.evaluate(() => {
    const app = document.querySelector('.en-app');
    return { cls: app.className, bg: getComputedStyle(app).backgroundColor };
  });
  check('★ 家长端换了一套皮肤', skin.cls.includes('en-parent') && !skin.cls.includes('en-kid'), skin.cls);

  const dashText = await page.locator('.en-page').innerText();
  check('家长端显示学习时长和天数', /学习天数|总分钟/.test(dashText));
  check('家长端说明了今天为什么排这些', /为什么是这些/.test(dashText));

  // 能力页
  await page.getByRole('button', { name: '能力' }).click();
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${OUT}/en-parent-ability.png`, fullPage: true });
  const abilityText = await page.locator('.en-page').innerText();
  check('能力页有八个维度', (await page.locator('.en-skill').count()) >= 8);
  check('★ 能力页说明了不测心理状态', /不是孩子的性格或自信心|没有能力测量心理状态/.test(abilityText));
  check('★ 能力条不写分数', !/听力\s*\d+\s*分/.test(abilityText));

  // 薄弱点
  await page.getByRole('button', { name: '薄弱点' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/en-parent-weak.png`, fullPage: true });
  const weakText = await page.locator('.en-page').innerText();
  check('薄弱点页有内容（有结论或明说数据不足）', weakText.length > 20, weakText.slice(0, 50));

  // 词汇
  await page.getByRole('button', { name: '词汇' }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/en-parent-words.png`, fullPage: true });
  check('词汇页列出了词', (await page.locator('.en-wordtag').count()) >= 1);

  // 周报
  await page.getByRole('button', { name: '学习情况' }).click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: '看本周成长报告' }).click();
  await page.waitForSelector('.en-card', { timeout: 8000 });
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/en-parent-report.png`, fullPage: true });
  const reportText = await page.locator('.en-page').innerText();
  check('周报有四段内容', /词汇/.test(reportText) && /听力/.test(reportText) && /口语/.test(reportText) && /下周建议/.test(reportText));
  check('★ 周报不出现百分比和小数分数', !/\d+%|\d+\.\d+\s*分/.test(reportText), reportText.slice(0, 80));

  // 设置
  await page.locator('.en-back').first().click();
  await page.waitForSelector('.en-tabs', { timeout: 4000 });
  await page.getByRole('button', { name: '设置' }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/en-parent-settings.png`, fullPage: true });
  await noOverflow(page, '设置页', 'parent');
  const setText = await page.locator('.en-page').innerText();
  check('★ 设置页说明录音不保存', /录音永远不保存/.test(setText));
  check('★ 设置页不自称已完全合规', /不声称"已经完全合规"|不声称“已经完全合规”/.test(setText));
  check('设置页说明了当前语音能力', /语音识别/.test(setText));

  // 切到「接入 AI 网关」：网关表单和那条安全警告都该出现
  await page.getByRole('button', { name: '接入 AI 网关' }).click();
  await page.waitForTimeout(300);
  const gwText = await page.locator('.en-page').innerText();
  check('★ 填网关时警告不要把 Key 填进浏览器', /别把模型厂商的 API Key/.test(gwText));
  check('网关表单出现了地址输入框', /网关地址/.test(gwText));
  await page.screenshot({ path: `${OUT}/en-parent-ai.png`, fullPage: true });
  await page.getByRole('button', { name: '内置引擎（离线）' }).click();
  await page.waitForTimeout(250);

  // 改设置 → 回儿童端 → 任务跟着变
  await page.getByRole('button', { name: '20 分钟' }).click();
  await page.waitForTimeout(300);
  await page.locator('.en-back').first().click();
  await page.waitForSelector('.en-tabs', { timeout: 4000 });
  await page.locator('.en-back').first().click();
  await page.waitForSelector('.en-mission', { timeout: 4000 });
  const mins = await page.locator('.en-mission-time').innerText();
  check('改完时长后今日任务跟着变', /1[0-9]|20/.test(mins), mins);

  await ctx.close();
}

// ═══════════════ 6. 深色模式 ═══════════════
{
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    colorScheme: 'dark',
  });
  const page = await ctx.newPage();
  watch(page, 'dark');
  await enter(page, { name: 'Dark', age: '5' });
  // 建完档直接进了测评，退一步回首页看深色下的主界面
  await page.locator('.en-back').first().click();
  await page.waitForSelector('.en-hero h1', { timeout: 4000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/en-dark-home.png`, fullPage: true });
  const contrast = await page.evaluate(() => {
    const lum = (c) => {
      const m = (c.match(/\d+/g) || ['0', '0', '0']).map(Number);
      return (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]) / 255;
    };
    const app = document.querySelector('.en-app');
    const h1 = document.querySelector('.en-hero h1');
    if (!app || !h1) return { bg: -1, fg: -1 };
    return { bg: lum(getComputedStyle(app).backgroundColor), fg: lum(getComputedStyle(h1).color) };
  });
  check('深色模式底色够暗', contrast.bg < 0.35, JSON.stringify(contrast));
  check('深色模式文字够亮', contrast.fg > 0.6, JSON.stringify(contrast));
  await ctx.close();
}

// ═══════════════ 7. 桌面宽屏 ═══════════════
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  watch(page, 'desktop');
  await enter(page, { name: 'Desk', age: '9' });
  await page.locator('.en-back').first().click();
  await page.waitForSelector('.en-hero h1', { timeout: 4000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/en-desktop-home.png` });
  const w = await page.evaluate(() => {
    const p = document.querySelector('.en-page');
    return p ? p.getBoundingClientRect().width : 0;
  });
  check('宽屏下内容居中不拉伸', w <= 560, `${Math.round(w)}px`);
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
