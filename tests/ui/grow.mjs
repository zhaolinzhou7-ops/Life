/**
 * 成长观察 · 界面走查（真实 Chromium，模拟 iPhone）。
 *
 * 覆盖单元测试管不到的部分：数据真的存进了 IndexedDB（刷新后还在）、
 * 断网能打开、导出的备份文件能在另一台"设备"上恢复、每月备份提醒、
 * 设计红线（发育对照页不出现百分比/几项中几项）、窄屏不横向溢出。
 * 截图写到 OUT 目录。
 *
 * 用法：npm run build && npm run preview，然后 npm run test:ui:grow
 * （脚本里带了 LANG=C.UTF-8：系统语言是 C 时 Chromium 存不了中文文件名，
 *  备份文件名那一项会误报）
 */
import fs from 'fs';
import { chromium } from 'playwright';

// 按北京时间跑：页面和这里算"今天"必须用同一个时区
process.env.TZ = 'Asia/Shanghai';

const BASE = process.env.BASE || 'http://localhost:4173/Life/';
const URL = `${BASE}grow/`;
const OUT = process.env.OUT || 'node_modules/.cache/shots';
fs.mkdirSync(OUT, { recursive: true });

const results = [];
const errors = [];
function check(label, cond, detail = '') {
  results.push({ label, ok: !!cond, detail });
}

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';

function pad(n) {
  return String(n).padStart(2, '0');
}
function dstr(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function daysFromToday(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return dstr(d);
}
const TODAY = dstr(new Date());
const LAST_MONTH = (() => {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  d.setDate(15);
  return dstr(d);
})();

const browser = await chromium.launch({ executablePath: process.env.CHROME || undefined });

/** standalone=true 模拟"从主屏幕图标打开" */
async function newPhone({ width = 390, height = 844, standalone = true, dark = false } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent: IPHONE_UA,
    colorScheme: dark ? 'dark' : 'light',
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
    acceptDownloads: true,
  });
  if (standalone) await ctx.addInitScript(() => Object.defineProperty(navigator, 'standalone', { value: true }));
  const page = await ctx.newPage();
  const tag = `${width}${standalone ? '' : '-safari'}${dark ? '-dark' : ''}`;
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${tag}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
  page.on('dialog', (d) => d.accept());
  return { ctx, page };
}

async function noOverflow(page, label) {
  const o = await page.evaluate(() => ({ bw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  check(`${label} 无横向溢出`, o.bw <= o.iw + 1, JSON.stringify(o));
}

async function tab(page, name) {
  await page.locator('.g-tab', { hasText: name }).click();
  await page.waitForTimeout(120);
}

async function addEntry(page, { text, tags = [], first = false, date }) {
  if (date) await page.locator('.g-record .g-date').fill(date);
  await page.locator('.g-record textarea').fill(text);
  for (const t of tags) await page.locator('.g-record .g-tags .g-chip', { hasText: t }).first().click();
  if (first) await page.locator('.g-record .g-chip-first').click();
  await page.locator('.g-record .g-btn-big', { hasText: '保存' }).click();
  await page.waitForTimeout(150);
}

// ================= 主流程 =================
const { ctx, page } = await newPhone();
try {
await page.goto(URL, { waitUntil: 'networkidle' });
await page.waitForSelector('.g-record');
await page.screenshot({ path: `${OUT}/grow-01-record-empty.png` });
check('打开就是记录页', await page.locator('.g-record h1').isVisible());
check('日期默认今天', (await page.locator('.g-record .g-date').inputValue()) === TODAY);
check('从图标打开时不显示"请先添加到主屏幕"', !(await page.getByText('请先添加到主屏幕').count()));
check('没有记录时不提醒备份', !(await page.locator('.g-banner.remind').count()));
await noOverflow(page, '390 记录页');

// 空内容不能保存
await page.locator('.g-record .g-btn-big', { hasText: '保存' }).click();
await page.waitForTimeout(100);
check('空内容被拦下', (await page.locator('.g-toast').textContent())?.includes('先写一句话'));

await addEntry(page, { text: '今天自己把鞋穿好了，还说"我自己来"', tags: ['自理', '表达需求'], first: true });
check('保存后提示已保存', (await page.locator('.g-toast').textContent())?.includes('已保存'));
check('保存后输入框清空', (await page.locator('.g-record textarea').inputValue()) === '');
check('保存后标签复位', !(await page.locator('.g-record .g-tags .g-chip.on').count()));
check('最近记下的出现这条', (await page.locator('.g-recent .g-entry').first().textContent())?.includes('自己把鞋穿好'));

await page.locator('.g-record .g-chip', { hasText: '昨天' }).click();
await addEntry(page, { text: '睡前哭了一会儿，说想奶奶', tags: ['情绪', '睡眠'] });
await addEntry(page, { text: '在公园和一个小姐姐轮流玩滑梯', tags: ['社交'], date: LAST_MONTH });
check('保存后日期回到今天', (await page.locator('.g-record .g-date').inputValue()) === TODAY);
check('有记录、没备份 → 出现本月备份提醒', await page.locator('.g-banner.remind').isVisible());
await page.screenshot({ path: `${OUT}/grow-02-record-saved.png` });

// 草稿：写一半刷新还在
await page.locator('.g-record textarea').fill('写到一半的草稿');
await page.reload({ waitUntil: 'networkidle' });
await page.waitForSelector('.g-record');
check('写到一半刷新，草稿还在', (await page.locator('.g-record textarea').inputValue()) === '写到一半的草稿');
await page.locator('.g-record textarea').fill('');
check('刷新后记录还在（IndexedDB）', (await page.locator('.g-recent .g-entry').count()) === 3);

// ---------- 时间线 ----------
await tab(page, '时间线');
check('本月 2 条', (await page.locator('.g-results .g-entry').count()) === 2);
await page.screenshot({ path: `${OUT}/grow-03-timeline.png` });
await noOverflow(page, '390 时间线');
await page.locator('.g-filters .g-chip', { hasText: '情绪' }).click();
check('按"情绪"筛出 1 条', (await page.locator('.g-results .g-entry').count()) === 1);
await page.locator('.g-filters .g-chip', { hasText: '自理' }).click();
check('情绪+自理（任一）2 条', (await page.locator('.g-results .g-entry').count()) === 2);
await page.locator('.g-clear').click();
await page.locator('.g-filters .g-chip-first').click();
check('⭐第一次 筛出 1 条', (await page.locator('.g-results .g-entry').count()) === 1);
await page.locator('.g-clear').click();
await page.locator('.g-month-nav button[aria-label="上个月"]').click();
check('上个月 1 条', (await page.locator('.g-results .g-entry').count()) === 1);
await page.locator('.g-month-nav button[aria-label="下个月"]').click();
check('本月不能再往后翻', await page.locator('.g-month-nav button[aria-label="下个月"]').isDisabled());
await page.locator('.g-search').fill('滑梯');
check('搜索跨月份找到上个月的', (await page.locator('.g-results .g-entry').count()) === 1);
check('搜索时隐藏月份切换', await page.locator('.g-month-nav').isHidden());
await page.locator('.g-search').fill('睡眠');
check('搜标签名也能找到', (await page.locator('.g-results .g-entry').count()) === 1);
await page.screenshot({ path: `${OUT}/grow-04-search.png` });
await page.locator('.g-search').fill('');

// 修改、删除
await page.locator('.g-results .g-entry', { hasText: '想奶奶' }).click();
await page.waitForSelector('.g-sheet');
await page.screenshot({ path: `${OUT}/grow-05-edit.png` });
await page.locator('.g-sheet textarea').fill('睡前哭了一会儿，说想奶奶，抱了一下就好了');
await page.locator('.g-sheet .g-btn', { hasText: '保存修改' }).click();
await page.waitForTimeout(150);
check('修改后内容更新', (await page.locator('.g-results').textContent())?.includes('抱了一下就好了'));
await page.locator('.g-results .g-entry', { hasText: '抱了一下' }).click();
await page.locator('.g-sheet .g-btn', { hasText: '删除这条' }).click();
await page.waitForTimeout(150);
check('删除后不见了', !(await page.locator('.g-results').textContent())?.includes('抱了一下'));
await addEntryViaRecord('昨天睡前哭了，说想奶奶，抱一下就好了', ['情绪'], daysFromToday(-1));

async function addEntryViaRecord(text, tags, date) {
  await tab(page, '记录');
  await addEntry(page, { text, tags, date });
}

// ---------- 健康节点 ----------
await tab(page, '健康');
check('预置 4 项', (await page.locator('.g-hcard').count()) === 4);
check('没填日期显示"还没填日期"', (await page.locator('.g-pill', { hasText: '还没填日期' }).count()) === 4);
await noOverflow(page, '390 健康');

async function editHealth(name, fill) {
  await page.locator('.g-hcard', { hasText: name }).locator('.g-btn', { hasText: '修改' }).click();
  await page.waitForSelector('.g-sheet');
  await fill();
  await page.locator('.g-sheet .g-btn', { hasText: '保存' }).click();
  await page.waitForTimeout(150);
}
// 牙科：上次 170 天前，每 6 个月 → 大约 10 天后到期
await editHealth('牙科', async () => {
  await page.locator('.g-sheet .g-date').first().fill(daysFromToday(-170));
  await page.locator('.g-sheet .g-num').fill('6');
});
// 疫苗：直接填下次日期，100 天后
await editHealth('疫苗', async () => {
  await page.locator('.g-sheet .g-date').nth(1).fill(daysFromToday(100));
});
// 体检：上次 13 个月前，每 12 个月 → 已过期
await editHealth('体检', async () => {
  await page.locator('.g-sheet .g-date').first().fill(daysFromToday(-400));
  await page.locator('.g-sheet .g-num').fill('12');
});
// 新增一项
await page.locator('.g-add').click();
await page.locator('.g-sheet .g-input').first().fill('骨龄复查');
await page.locator('.g-sheet .g-seg-btn', { hasText: '直接填下次日期' }).click();
await page.locator('.g-sheet .g-date').nth(1).fill(daysFromToday(400));
await page.locator('.g-sheet .g-btn', { hasText: '保存' }).click();
await page.waitForTimeout(150);

const order = await page.locator('.g-hname').allTextContents();
check('排序：已过期 → 快到期 → 以后 → 没填', JSON.stringify(order) === JSON.stringify(['体检', '牙科', '疫苗', '骨龄复查', '视力']), JSON.stringify(order));
check('体检显示已过期', (await page.locator('.g-hcard', { hasText: '体检' }).locator('.g-pill').textContent())?.startsWith('已过期'));
check('牙科显示还有几天', /还有 \d+ 天/.test((await page.locator('.g-hcard', { hasText: '牙科' }).locator('.g-pill').textContent()) ?? ''));
await page.screenshot({ path: `${OUT}/grow-06-health.png`, fullPage: true });

await page.locator('.g-hcard', { hasText: '体检' }).locator('.g-btn', { hasText: '今天做过了' }).click();
await page.waitForTimeout(150);
check('体检"今天做过了" → 不再过期', !(await page.locator('.g-hcard', { hasText: '体检' }).locator('.g-pill').textContent())?.startsWith('已过期'));

await tab(page, '记录');
check('记录页提示快到期的健康节点', (await page.locator('.g-dueline').textContent())?.includes('牙科'));

// ---------- 发育对照 ----------
await tab(page, '发育对照');
check('没填出生日期时先要生日', (await page.locator('.g-growth').textContent())?.includes('先填上出生日期'));
check('写明"筛查参考，不是诊断"', (await page.locator('.g-disclaimer').textContent())?.includes('筛查参考，不是诊断'));
const birth = (() => {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 4);
  d.setMonth(d.getMonth() - 3);
  return dstr(d);
})();
await page.locator('.g-birth .g-date').fill(birth);
await page.locator('.g-birth .g-date').dispatchEvent('change');
await page.waitForTimeout(150);
check('4 岁 3 个月 → 显示年龄', (await page.locator('.g-birth').textContent())?.includes('4 岁 3 个月'));
check('当前对照 4 岁段', (await page.locator('.g-mgroup.p-current').getAttribute('data-age')) === '4');
check('5、6 岁段不可点', (await page.locator('.g-mgroup.p-future .g-seg-btn').count()) === 0);
for (const id of ['a4-adjective', 'a4-wait', 'a4-dress', 'a4-stand']) {
  await page.locator(`.g-mitem[data-id="${id}"] .g-seg-btn[data-value="yes"]`).click();
}
check('全部能做到 → 无复查提示', !(await page.locator('.g-alert').count()));
await page.locator('.g-mitem[data-id="a4-stand"] .g-seg-btn[data-value="no"]').click();
check('任一"还做不到" → 建议到儿保门诊复查', (await page.locator('.g-alert.visit').textContent())?.includes('建议到儿保门诊复查'));
await page.locator('.g-mitem[data-id="a4-wait"] .g-seg-btn[data-value="unsure"]').click();
check('"不确定" → 温和提示', await page.locator('.g-alert.soft').isVisible());
await page.locator(`.g-mitem[data-id="regression"] .g-seg-btn[data-value="yes"]`).click();
check('倒退选"有" → 尽快就医', (await page.locator('.g-alert.urgent').textContent())?.includes('尽快'));
const growthText = (await page.locator('.g-growth').textContent()) ?? '';
check('红线：不出现百分比/几项中几项/打分', !/%|％|项中|达成|得分|分数|平均/.test(growthText), growthText.match(/%|％|项中|达成|得分|分数|平均/)?.[0]);
await page.screenshot({ path: `${OUT}/grow-07-growth.png`, fullPage: true });
await noOverflow(page, '390 发育对照');
await page.locator(`.g-mitem[data-id="regression"] .g-seg-btn[data-value="no"]`).click();
await page.locator('.g-mitem[data-id="a4-stand"] .g-seg-btn[data-value="yes"]').click();
await page.locator('.g-mitem[data-id="a4-wait"] .g-seg-btn[data-value="yes"]').click();

// ---------- 备份 ----------
await tab(page, '备份');
await page.waitForTimeout(200);
check('备份页显示"还没备份过"', (await page.locator('.g-status-card').textContent())?.includes('还没备份过'));
check('备份页显示从主屏幕图标打开', (await page.locator('.g-status-card').textContent())?.includes('主屏幕图标'));
await page.screenshot({ path: `${OUT}/grow-08-backup.png`, fullPage: true });
await noOverflow(page, '390 备份');
const [download] = await Promise.all([page.waitForEvent('download'), page.locator('.g-btn', { hasText: '导出备份文件' }).click()]);
const backupPath = `${OUT}/grow-backup.json`;
await download.saveAs(backupPath);
check('备份文件名带日期', download.suggestedFilename() === `成长观察备份-${TODAY}.json`, download.suggestedFilename());
const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
const live = backup.entries.filter((e) => !e.deletedAt);
check('备份里有 3 条记录 + 1 个删除空壳', live.length === 3 && backup.entries.length === 4, `${live.length}/${backup.entries.length}`);
check('删除空壳不带原文', backup.entries.filter((e) => e.deletedAt).every((e) => e.text === ''));
check('备份含健康节点、发育状态、出生日期', backup.health.length === 4 && backup.milestones.length === 5 && backup.profile?.birthDate === birth);
await page.waitForTimeout(200);
check('导出后显示上次备份是今天', (await page.locator('.g-status-card').textContent())?.includes('今天'));
await tab(page, '记录');
check('导出后本月不再提醒', !(await page.locator('.g-banner.remind').count()));

// ---------- 断网 ----------
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload({ waitUntil: 'networkidle' }); // 让页面归 service worker 管
await ctx.setOffline(true);
await page.reload({ waitUntil: 'load' });
await page.waitForSelector('.g-record', { timeout: 5000 }).catch(() => {});
check('断网也能打开', await page.locator('.g-record').isVisible());
await addEntry(page, { text: '断网时记的一条', tags: ['兴趣'] });
check('断网也能保存', (await page.locator('.g-recent .g-entry').first().textContent())?.includes('断网时记的一条'));
await page.screenshot({ path: `${OUT}/grow-09-offline.png` });
await ctx.setOffline(false);

// ================= 换一台"设备"：从备份恢复 =================
const b = await newPhone();
await b.page.goto(URL, { waitUntil: 'networkidle' });
await tab(b.page, '备份');
await b.page.locator('.g-hidden-file').setInputFiles(backupPath);
await b.page.waitForSelector('.g-sheet');
const preview = (await b.page.locator('.g-sheet').textContent()) ?? '';
check('恢复前预览：3 条记录、新增 3 条', preview.includes('备份里有 3 条记录') && preview.includes('新增 3 条'), preview);
await b.page.screenshot({ path: `${OUT}/grow-10-restore.png` });
await b.page.locator('.g-sheet .g-btn', { hasText: '合并到这台设备' }).click();
await b.page.waitForTimeout(200);
await tab(b.page, '时间线');
await b.page.locator('.g-search').fill(' ');
await b.page.locator('.g-search').fill('奶奶');
check('恢复后能搜到记录', (await b.page.locator('.g-results .g-entry').count()) === 1);
await tab(b.page, '健康');
check('恢复后健康节点没有重复', (await b.page.locator('.g-hcard').count()) === 5);
await tab(b.page, '发育对照');
check('恢复后出生日期在', (await b.page.locator('.g-birth .g-date').inputValue()) === birth);
// 同一份再恢复一次：什么都不变
await tab(b.page, '备份');
await b.page.locator('.g-hidden-file').setInputFiles(backupPath);
await b.page.waitForSelector('.g-sheet');
check('重复恢复：提示都已经有了', (await b.page.locator('.g-sheet').textContent())?.includes('都已经有了'));
await b.page.locator('.g-sheet .g-btn', { hasText: '知道了' }).click();
// 坏文件
fs.writeFileSync(`${OUT}/not-backup.json`, '{"hello": 1}');
await b.page.locator('.g-hidden-file').setInputFiles(`${OUT}/not-backup.json`);
await b.page.waitForTimeout(150);
check('不是备份文件 → 说人话', (await b.page.locator('.g-toast').textContent())?.includes('不是"成长观察"的备份文件'));
await b.ctx.close();

// ================= 在 Safari 里（没添加到主屏幕） =================
const s = await newPhone({ standalone: false });
await s.page.goto(URL, { waitUntil: 'networkidle' });
check('在 Safari 里打开 → 提示先添加到主屏幕', await s.page.getByText('请先添加到主屏幕').isVisible());
await s.page.screenshot({ path: `${OUT}/grow-11-safari.png` });
await s.ctx.close();

// ================= 最窄屏 + 深色 =================
const narrow = await newPhone({ width: 320, height: 568 });
await narrow.page.goto(URL, { waitUntil: 'networkidle' });
for (const t of ['记录', '时间线', '健康', '发育对照', '备份']) {
  await tab(narrow.page, t);
  await noOverflow(narrow.page, `320 ${t}`);
}
await tab(narrow.page, '记录');
await narrow.page.screenshot({ path: `${OUT}/grow-12-320.png` });
await narrow.ctx.close();

const dark = await newPhone({ dark: true });
await dark.page.goto(URL, { waitUntil: 'networkidle' });
await addEntry(dark.page, { text: '深色模式下看看', tags: ['兴趣'], first: true });
await dark.page.screenshot({ path: `${OUT}/grow-13-dark.png` });
await dark.ctx.close();

} catch (e) {
  errors.push(`中断：${e.message.split('\n')[0]}`);
  await page.screenshot({ path: `${OUT}/grow-FAIL.png`, fullPage: true }).catch(() => {});
}
await ctx.close();
await browser.close();

let fail = 0;
for (const r of results) {
  if (!r.ok) fail++;
  console.log(`${r.ok ? '✓' : '✗'} ${r.label}${r.ok || !r.detail ? '' : `  → ${r.detail}`}`);
}
if (errors.length) {
  console.log('\n控制台错误：');
  for (const e of errors) console.log('  ' + e);
}
console.log(`\n${results.length - fail}/${results.length} 通过，${errors.length} 个控制台错误。截图在 ${OUT}/grow-*.png`);
process.exit(fail || errors.length ? 1 : 0);
