/**
 * 真实浏览器里的端到端测试。
 *
 * 用 Chromium 的假麦克风（--use-file-for-fake-audio-capture）喂一段合成的
 * 「假唱」音频，把「录音 → 分析 → 出报告」整条链路在真浏览器里跑一遍。
 * 这比单测有价值的地方在于：AudioWorklet、getUserMedia、Canvas、
 * 移动端布局这些东西，只有在真浏览器里才验得了。
 *
 *   npm run test:ui
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);
let chromium;
try {
  ({ chromium } = require_('playwright'));
} catch {
  ({ chromium } = require_('/opt/node22/lib/node_modules/playwright'));
}

const PORT = 5188;
const BASE = `http://localhost:${PORT}/Life/`;
const FIXTURES = resolve('node_modules/.cache/vocal-fixtures');

let pass = 0;
let fail = 0;
const failures = [];
let group = '';

function head(name) {
  group = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}
function ok(cond, name, detail = '') {
  if (cond) {
    pass++;
    console.log(`  \x1b[32m✓\x1b[0m ${name}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  } else {
    fail++;
    failures.push(`${group} → ${name}${detail ? ` (${detail})` : ''}`);
    console.log(`  \x1b[31m✗ ${name}\x1b[0m${detail ? `  ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function startServer() {
  const proc = spawn(
    'node_modules/.bin/vite',
    ['preview', '--port', String(PORT), '--strictPort', '--host', '127.0.0.1'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('预览服务启动超时')), 20000);
    proc.stdout.on('data', (d) => {
      if (String(d).includes(String(PORT))) {
        clearTimeout(t);
        res();
      }
    });
    proc.on('error', rej);
  });
  await sleep(400);
  return proc;
}

/** 开一个带假麦克风的浏览器 */
async function launch(audioFile) {
  const args = [
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    // 容器里是 root，沙箱起不来
    '--no-sandbox',
  ];
  if (audioFile) args.push(`--use-file-for-fake-audio-capture=${audioFile}%noloop`);
  return chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args,
  });
}

/** 进入 AI 唱歌教练 */
async function enterApp(page) {
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.locator('.home-card', { hasText: 'AI 唱歌教练' }).click();
  await page.waitForSelector('.vocal-app', { timeout: 8000 });
  await page.waitForSelector('.v-hero', { timeout: 8000 });
}

/** 检查有没有横向滚动条——手机上最常见的布局事故 */
async function noHorizontalScroll(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function main() {
  if (!existsSync(FIXTURES)) {
    console.error('缺少测试音频，先跑 npm run fixtures');
    process.exit(1);
  }

  const server = await startServer();
  const errors = [];

  try {
    // ============================================================ 完整流程
    {
      head('完整流程 · 唱一首整体偏低的歌');
      const browser = await launch(`${FIXTURES}/flat.wav`);
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        permissions: ['microphone'],
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[flow] ${e.message}`));
      page.on('console', (m) => {
        if (m.type() === 'error') errors.push(`[flow console] ${m.text()}`);
      });

      await enterApp(page);
      ok(await page.isVisible('.v-hero'), '首页渲染出来了，主按钮是「开始练歌」');
      ok(
        await page.isVisible('text=今日训练'),
        '首页有今日训练',
      );

      await page.locator('.v-hero').click();
      await page.waitForSelector('text=茉莉花', { timeout: 6000 });
      ok(await page.isVisible('text=公有领域'), '歌曲页标明了曲库来源（版权边界）');
      ok(await page.isVisible('text=唱我自己的'), '有自由演唱入口');

      await page.locator('.v-card', { hasText: '小星星' }).first().click();
      await page.waitForSelector('text=开始跟唱', { timeout: 6000 });
      ok(await page.isVisible('text=练哪一段'), '练歌准备页有分段练习');
      ok(await page.isVisible('text=提示强度'), '有新手/普通/考试模式选择');
      ok(await page.isVisible('text=默认不保存'), '开始前就说明了录音默认不保存');

      await page.locator('button', { hasText: '开始跟唱' }).click();
      await page.waitForSelector('.v-roll', { timeout: 10000 });
      ok(true, '进入跟唱界面，钢琴卷帘出现');
      await sleep(2500);
      const drawing = await page.evaluate(() => {
        const c = document.querySelector('.v-roll');
        return c ? c.width > 0 && c.height > 0 : false;
      });
      ok(drawing, '卷帘画布已按 DPR 初始化');
      ok(await page.isVisible('.v-live'), '实时读数条在显示');

      // 唱 20 秒后点「唱完了」
      await sleep(20000);
      await page.locator('button', { hasText: '唱完了' }).click();
      await page.waitForSelector('text=这次最大的问题', { timeout: 30000 });
      ok(true, '分析完成，跳到分析页');

      const problem = await page.textContent('.v-card');
      ok(!!problem, '分析页有内容');

      const bodyText = await page.textContent('.v-wrap');
      ok(/偏低/.test(bodyText), '把「整体偏低」这个注入的毛病找出来了',
        (bodyText.match(/整体偏低 \d+ 音分/) ?? [''])[0]);
      ok(/音分/.test(bodyText), '结论里带具体数字（音分）');
      ok(await page.isVisible('text=目标音高 vs 你的实际音高'), '有目标 vs 实际对比图');
      ok(await page.isVisible('text=逐音复盘'), '有逐音复盘');
      ok(await page.isVisible('.v-timeline'), '绿黄红问题节点条渲染出来了');

      const nodeCount = await page.locator('.v-timeline i').count();
      ok(nodeCount > 10, `逐音节点数量合理`, `${nodeCount} 个`);

      // 点一个节点看详情
      await page.locator('.v-timeline i').nth(3).click();
      await page.waitForSelector('.v-note-detail', { timeout: 4000 });
      const detail = await page.textContent('.v-note-detail');
      ok(/目标音/.test(detail) && /你唱的/.test(detail), '点节点能看到「目标音 / 你唱的」', detail.slice(0, 40).replace(/\s+/g, ' '));
      ok(/音高偏差/.test(detail), '详情里有音高偏差');
      ok(await page.isVisible('text=听目标音'), '可以试听目标音');

      // 指标必须带 why
      ok(await page.isVisible('text=命中率'), '有命中率指标');
      const whyCount = await page.locator('.v-metric .why, .v-metric .na').count();
      ok(whyCount >= 4, '每个指标都带「为什么是这个结果」', `${whyCount} 条说明`);

      // AI 教练（Mock 模式）
      await page.waitForSelector('text=① 你唱得好的地方', { timeout: 20000 });
      const coach = await page.textContent('.v-coach');
      ok(/① 你唱得好的地方/.test(coach), 'AI 教练：① 好在哪');
      ok(/② 最大的问题/.test(coach), 'AI 教练：② 最大问题');
      ok(/③ 为什么会这样/.test(coach), 'AI 教练：③ 为什么');
      ok(/④ 怎么练/.test(coach), 'AI 教练：④ 怎么练');
      ok(/⑤ 下一次的目标/.test(coach), 'AI 教练：⑤ 下次目标');
      const banned = ['很有潜力', '继续努力', '感情很丰富', '情绪很到位', '非常不错'];
      const dirty = banned.filter((b) => coach.includes(b));
      ok(dirty.length === 0, '教练反馈里没有套话', dirty.join('、'));
      ok(await page.isVisible('.v-coach .drill'), '给出了可以点进去的练习');

      // 边界声明
      ok(/不等同于专业声乐老师/.test(bodyText + coach), '声明了不等同于专业声乐老师的评估');
      ok(/不能用来判断声带健康/.test(bodyText), '声明了不能判断声带健康');

      // 录音处置
      ok(/离开这个页面就会丢掉/.test(bodyText), '明确告知录音默认不留存');

      // 点练习卡进训练
      await page.locator('.v-coach .drill').first().click();
      await page.waitForSelector('text=为什么有用', { timeout: 6000 });
      ok(await page.isVisible('text=最容易做错的地方'), '练习页写清了怎么做/为什么/易错点');

      await browser.close();
    }

    // ============================================================ 录音质量把关
    {
      head('录音质量把关 · 没声音的录音');
      const browser = await launch(`${FIXTURES}/silent.wav`);
      const ctx = await browser.newContext({
        viewport: { width: 1280, height: 860 },
        permissions: ['microphone'],
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[silent] ${e.message}`));

      await enterApp(page);
      await page.locator('.v-hero').click();
      await page.waitForSelector('text=唱我自己的');
      await page.locator('.v-card', { hasText: '唱我自己的' }).first().click();
      await page.waitForSelector('text=开始录音', { timeout: 6000 });
      await page.locator('button', { hasText: '开始录音' }).click();
      await sleep(6000);
      await page.locator('button', { hasText: '唱完了' }).click();
      await page.waitForSelector('.v-note.bad', { timeout: 25000 });
      const txt = await page.textContent('.v-wrap');
      ok(/没有检测到人声|不足以支撑/.test(txt), '没声音时拒绝出分，并说明原因',
        (txt.match(/[^。]*没有检测到人声[^。]*/) ?? [''])[0].slice(0, 46));
      ok(!/综合分/.test(txt) || /重新唱一次/.test(txt), '不给一个看起来像回事的假分数');
      await browser.close();
    }

    // ============================================================ 麦克风拿不到
    for (const scene of [
      { name: '没有可用的麦克风', args: ['--no-sandbox'], expect: /插好|禁用|找不到|没有找到/ },
      {
        // 有设备但不自动同意 → Chromium 会拒绝
        name: '麦克风权限被拒绝',
        args: ['--no-sandbox', '--use-fake-device-for-media-stream', '--deny-permission-prompts'],
        expect: /地址栏|允许|刷新/,
      },
    ]) {
      head(`麦克风异常 · ${scene.name}`);
      const browser = await chromium.launch({
        executablePath: '/opt/pw-browsers/chromium',
        args: scene.args,
      });
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
      await ctx.clearPermissions();
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[mic] ${e.message}`));

      await enterApp(page);
      await page.locator('.v-hero').click();
      await page.waitForSelector('text=小星星');
      await page.locator('.v-card', { hasText: '小星星' }).first().click();
      await page.waitForSelector('text=开始跟唱');
      await page.locator('button', { hasText: '开始跟唱' }).click();
      await page.waitForSelector('.v-note.bad', { timeout: 20000 });
      const hint = await page.textContent('.v-note.bad');
      ok(/麦克风/.test(hint), '说清了是麦克风的问题', hint.slice(0, 40).replace(/\s+/g, ' '));
      ok(scene.expect.test(hint), '给出了用户能照着做的下一步');
      ok(hint.length > 20, '提示不是一句干巴巴的「失败」');
      ok(await noHorizontalScroll(page), '错误态下没有横向滚动');
      await browser.close();
    }

    // ============================================================ 各种屏幕
    {
      head('响应式 · 手机 / 平板 / 横竖屏');
      const browser = await launch(`${FIXTURES}/good.wav`);
      const sizes = [
        { name: '手机竖屏 390×844', w: 390, h: 844 },
        { name: '小屏手机 360×640', w: 360, h: 640 },
        { name: '手机横屏 844×390', w: 844, h: 390 },
        { name: '平板竖屏 820×1180', w: 820, h: 1180 },
        { name: '平板横屏 1180×820', w: 1180, h: 820 },
      ];
      for (const s of sizes) {
        const ctx = await browser.newContext({
          viewport: { width: s.w, height: s.h },
          permissions: ['microphone'],
          isMobile: s.w < 500,
          hasTouch: s.w < 900,
        });
        const page = await ctx.newPage();
        page.on('pageerror', (e) => errors.push(`[${s.name}] ${e.message}`));
        await enterApp(page);
        ok(await noHorizontalScroll(page), `${s.name}：首页无横向滚动`);

        // 底部标签栏必须够得着
        const tabBox = await page.locator('.v-tab').first().boundingBox();
        ok(tabBox && tabBox.height >= 44, `${s.name}：标签栏触控区域够大`, tabBox ? `${Math.round(tabBox.height)}px` : '');

        // 四个标签都能点开
        for (const label of ['歌曲', '训练', '我的']) {
          await page.locator('.v-tab', { hasText: label }).click();
          await sleep(220);
          ok(await noHorizontalScroll(page), `${s.name}：「${label}」页无横向滚动`);
        }
        await page.locator('.v-tab', { hasText: '首页' }).click();
        await sleep(150);

        // 练歌页在横屏下的布局
        if (s.h < 500) {
          await page.locator('.v-hero').click();
          await page.waitForSelector('text=小星星');
          await page.locator('.v-card', { hasText: '小星星' }).first().click();
          await page.waitForSelector('text=开始跟唱');
          ok(await noHorizontalScroll(page), `${s.name}：练歌准备页无横向滚动`);
        }
        await ctx.close();
      }
      await browser.close();
    }

    // ============================================================ 其余页面
    {
      head('训练 / 我的 / 设置');
      const browser = await launch(`${FIXTURES}/good.wav`);
      const ctx = await browser.newContext({
        viewport: { width: 414, height: 896 },
        permissions: ['microphone'],
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[pages] ${e.message}`));

      await enterApp(page);
      await page.locator('.v-tab', { hasText: '训练' }).click();
      await page.waitForSelector('text=今日训练');
      const tr = await page.textContent('.v-wrap');
      ok(/音准/.test(tr) && /节奏/.test(tr) && /高音/.test(tr) && /稳定性/.test(tr), '训练中心有四大类');
      ok(/软件测不了气息本身/.test(tr), '气息类明确说明测的是代理指标');

      await page.locator('.v-row', { hasText: '单音模唱' }).first().click();
      await page.waitForSelector('text=最容易做错的地方', { timeout: 6000 });
      // 全新用户还没有音域记录，会先问一次声部——这是设计好的分支
      const needVoice = await page.isVisible('text=偏低（多数男声）');
      ok(needVoice, '没有音域记录时，先问一次大致声部而不是瞎猜起始音');
      if (needVoice) await page.locator('button', { hasText: '偏低（多数男声）' }).click();
      await page.waitForSelector('button:has-text("开始练习")', { timeout: 6000 });
      ok(await page.isVisible('button:has-text("开始练习")'), '选完声部后可以开始练习');
      const exText = await page.textContent('.v-wrap');
      ok(/这一轮共 \d+ 步，从 [A-G]#?\d 起/.test(exText), '告诉用户这轮练几步、从哪个音起',
        (exText.match(/这一轮共 \d+ 步，从 [A-G]#?\d 起/) ?? [''])[0]);

      await page.locator('.v-back').click();
      await page.locator('.v-tab', { hasText: '我的' }).click();
      await page.waitForSelector('text=我的唱歌能力');
      const me = await page.textContent('.v-wrap');
      ok(/软件内部的训练指标/.test(me), '能力五维标注了是软件内部指标，不是声乐等级');

      await page.locator('.v-row', { hasText: '设置与隐私' }).click();
      await page.waitForSelector('text=录音与隐私', { timeout: 6000 });
      const st = await page.textContent('.v-wrap');
      ok(/默认情况下录音/.test(st), '设置页说明录音默认不保存');
      ok(/设备延迟校准/.test(st), '有延迟校准');
      ok(/不能.{0,4}判断声带健康/.test(st), '设置页写明了产品边界');
      ok(/内置教练/.test(st), 'AI 默认是不联网的内置教练');

      // 切到需要 Key 的服务商，应当出现隐私说明
      await page.selectOption('.v-provider-select', 'claude');
      await sleep(300);
      const ai = await page.textContent('.v-wrap');
      ok(/只存在这台设备/.test(ai), '配置 Key 时说明了 Key 存在哪里');
      ok(/录音本身、逐帧音高轨迹、设备信息都不会发送/.test(ai), '说明了哪些数据会/不会发送');
      ok(await noHorizontalScroll(page), '设置页无横向滚动');

      await browser.close();
    }


    // ============================================================ 训练执行
    {
      head('专项训练 · 跑完几步并当场打分');
      const browser = await launch(`${FIXTURES}/good.wav`);
      const ctx = await browser.newContext({
        viewport: { width: 414, height: 896 },
        permissions: ['microphone'],
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[drill] ${e.message}`));

      await enterApp(page);
      await page.locator('.v-tab', { hasText: '训练' }).click();
      await page.waitForSelector('text=今日训练');
      await page.locator('.v-row', { hasText: '单音模唱' }).first().click();
      await page.waitForSelector('text=最容易做错的地方');
      if (await page.isVisible('text=偏低（多数男声）')) {
        await page.locator('button', { hasText: '偏低（多数男声）' }).click();
      }
      await page.locator('button', { hasText: '开始练习' }).click();

      // 示范 → 听音 → 打分，走两步就够验证这条链路了
      await page.waitForSelector('#v-ex-big', { timeout: 10000 });
      ok(true, '进入练习执行界面');
      await page.waitForSelector('text=第 1 / 7 步', { timeout: 10000 });
      ok(true, '显示当前进度');

      await page.waitForSelector('.v-card h3:has-text("分"), .v-card h3:has-text("没评上")', {
        timeout: 30000,
      });
      const res = await page.textContent('.v-wrap');
      ok(/\d+ 分|没评上/.test(res), '一步唱完当场给出结果',
        (res.match(/(\d+ 分|这一步没评上)/) ?? [''])[0]);
      ok(/音分|毫秒|没听到|数据/.test(res), '结果里带具体数字或明确的原因');

      // 中途结束也要能正常收尾
      await page.locator('button', { hasText: '结束练习' }).click();
      await page.waitForSelector('text=本轮平均分, text=没有有效数据', { timeout: 10000 }).catch(() => {});
      const sum = await page.textContent('.v-wrap');
      ok(/本轮平均分|没有有效数据/.test(sum), '中途结束也给出小结');
      ok(/去唱一首验证|练习和唱歌用的是同一套指标/.test(sum), '小结把用户导回「再检测」那一步');
      await browser.close();
    }

    // ============================================================ 自由演唱
    {
      head('自由演唱 · 没有目标旋律时的诚实边界');
      const browser = await launch(`${FIXTURES}/good.wav`);
      const ctx = await browser.newContext({
        viewport: { width: 414, height: 896 },
        permissions: ['microphone'],
      });
      const page = await ctx.newPage();
      page.on('pageerror', (e) => errors.push(`[free] ${e.message}`));

      await enterApp(page);
      await page.locator('.v-hero').click();
      await page.waitForSelector('text=唱我自己的');
      await page.locator('.v-card', { hasText: '唱我自己的' }).first().click();
      await page.waitForSelector('button:has-text("开始录音")', { timeout: 6000 });
      await page.locator('button', { hasText: '开始录音' }).click();
      await page.waitForSelector('#v-timer', { timeout: 10000 });
      await sleep(14000);
      await page.locator('button', { hasText: '唱完了' }).click();
      await page.waitForSelector('text=音域', { timeout: 30000 });
      const t = await page.textContent('.v-wrap');
      ok(/本次未评|没有目标旋律|自由演唱/.test(t), '不给音准分，并说明为什么',
        (t.match(/[^。]*没有目标旋律[^。]*/) ?? [''])[0].slice(0, 44));
      ok(/这次唱到 [A-G]#?\d/.test(t), '音域照常测得出',
        (t.match(/这次唱到 [A-G]#?\d+ ~ [A-G]#?\d+/) ?? [''])[0]);
      ok(/最长连续发声/.test(t), '长音持续时间这类可观测指标照常给');
      await browser.close();
    }

    ok(errors.length === 0, '整个过程没有 JS 报错', errors.slice(0, 3).join(' | '));
  } finally {
    server.kill();
  }

  console.log(`\n${'─'.repeat(62)}`);
  if (fail === 0) {
    console.log(`\x1b[32m浏览器端全部通过：${pass} 项\x1b[0m`);
  } else {
    console.log(`\x1b[31m失败 ${fail} 项\x1b[0m，通过 ${pass} 项`);
    for (const f of failures) console.log(`  \x1b[31m·\x1b[0m ${f}`);
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
