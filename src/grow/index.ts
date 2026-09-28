/**
 * 成长观察 · 启动入口
 *
 * 独立页面（/Life/grow/），不挂在小游戏合集的菜单里。
 * 打开就是"记录"页：10 秒记完一条是第一目标。
 *
 * 装到主屏幕后靠 service worker（离线缓存）断网也能打开；
 * 所有数据只在本机 IndexedDB 里，详见 store.ts。
 */

import './grow.css';
import { todayStr } from './dates';
import { isPersisted, requestPersist } from './env';
import { openStore, removeEntry, saveEntry, storageAvailable } from './store';
import { exportBackup } from './transfer';
import { TAGS, type Entry } from './types';
import type { Ctx, Tab } from './views/context';
import { entryFields, type EntryDraft } from './views/entry-form';
import { renderBackup } from './views/backup';
import { renderGrowth } from './views/growth';
import { renderHealth } from './views/health';
import { renderRecord } from './views/record';
import { renderTimeline } from './views/timeline';
import { button, el, icon, openSheet, saveFailed, toast } from './views/ui';

const TABS: { id: Tab; label: string; render: (ctx: Ctx) => HTMLElement }[] = [
  { id: 'record', label: '记录', render: renderRecord },
  { id: 'timeline', label: '时间线', render: renderTimeline },
  { id: 'health', label: '健康', render: renderHealth },
  { id: 'growth', label: '发育对照', render: renderGrowth },
  { id: 'backup', label: '备份', render: renderBackup },
];

const app = document.getElementById('app') as HTMLElement;
const top = el('div', 'g-global');
const main = el('main', 'g-main');
const nav = el('nav', 'g-tabs');
nav.setAttribute('aria-label', '页面');

let tab: Tab = 'record';
let renderedDay = '';

function render(keepScroll: boolean) {
  const y = keepScroll ? window.scrollY : 0;
  renderedDay = todayStr();
  main.innerHTML = '';
  main.appendChild(TABS.find((t) => t.id === tab)!.render(ctx));
  for (const b of nav.querySelectorAll<HTMLButtonElement>('.g-tab')) {
    const on = b.dataset.tab === tab;
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  }
  window.scrollTo(0, y);
}

function editEntry(e: Entry) {
  const d: EntryDraft = { date: e.date, text: e.text, tags: new Set(e.tags), first: e.first };
  const body = el('div', 'g-sheet-body');
  body.appendChild(entryFields(d, () => {}));
  const actions = el('div', 'g-sheet-actions');
  const sheet = openSheet('修改记录', body);
  actions.append(
    button('保存修改', 'g-btn g-btn-primary', async () => {
      const text = d.text.trim();
      if (!text) {
        toast('内容不能为空。不要这条了可以点“删除”', 'err', 2500);
        return;
      }
      const updated: Entry = {
        ...e,
        date: d.date,
        text,
        tags: TAGS.map((t) => t.id).filter((id) => d.tags.has(id)),
        first: d.first,
        updatedAt: Date.now(),
      };
      const p = saveEntry(updated);
      sheet.close();
      ctx.refresh();
      try {
        await p;
        toast('已保存 ✓');
      } catch (err) {
        saveFailed(err);
      }
    }),
    button('删除这条', 'g-btn g-btn-danger', async () => {
      if (!confirm('删除这条记录？删除后找不回来。')) return;
      const p = removeEntry(e.id);
      sheet.close();
      ctx.refresh();
      try {
        await p;
        toast('已删除');
      } catch (err) {
        saveFailed(err);
      }
    }),
  );
  body.appendChild(actions);
}

function runExport() {
  // 这里不能先 await 别的东西：iPhone 要求点击后立刻弹分享面板
  exportBackup().then(
    (r) => {
      if (r === 'cancelled') return;
      toast(r === 'shared' ? '已导出 ✓ 确认一下文件存到了手机以外的地方' : '已下载备份文件 ✓', 'ok', 4000);
      ctx.refresh();
    },
    () => toast('导出失败，请试试“复制备份内容”', 'err'),
  );
}

const ctx: Ctx = {
  refresh: () => render(true),
  go: (t) => {
    tab = t;
    render(false);
  },
  editEntry,
  runExport,
};

function showUpdateBar() {
  if (top.querySelector('.g-update')) return;
  const bar = el('div', 'g-update');
  bar.append(el('span', '', '新版本已准备好'), button('刷新', 'g-btn g-btn-primary g-btn-sm', () => location.reload()));
  top.appendChild(bar);
}

/** 离线缓存：只在正式构建里启用（开发时每次改代码都要最新的） */
function setupServiceWorker() {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // 同一个域名下还有小游戏合集的 service worker，别把它的接管当成"我们更新了"
  const ours = () => !!sw.controller && sw.controller.scriptURL.endsWith('/grow/sw.js');
  let controlled = ours();
  sw.addEventListener('controllerchange', () => {
    // 之前已经由旧版本接管 → 这次是新版本到了；不自动刷新，免得打断正在写的记录
    if (controlled) showUpdateBar();
    controlled = ours();
  });
  sw.register('./sw.js', { scope: './' })
    .then((reg) => {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update().catch(() => {});
      });
    })
    .catch(() => {});
}

async function boot() {
  app.append(top, main, nav);
  for (const t of TABS) {
    const b = button('', 'g-tab', () => ctx.go(t.id));
    b.dataset.tab = t.id;
    b.append(icon(t.id), el('span', 'g-tab-label', t.label));
    nav.appendChild(b);
  }

  await openStore();
  if (!storageAvailable()) {
    top.appendChild(
      el('div', 'g-banner bad', '这个浏览器现在存不了数据（可能开了无痕浏览）。现在记的内容，关掉页面就会丢。'),
    );
  }
  render(false);

  // 申请"长期保存"：浏览器空间紧张时别清掉这里的数据
  void isPersisted().then((p) => {
    if (p === false) void requestPersist();
  });

  // App 可能从昨天一直开着：回到前台时如果已经换了一天，重画一次（日期、提醒）
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayStr() !== renderedDay && !document.querySelector('.g-sheet-back')) {
      render(true);
    }
  });

  setupServiceWorker();
}

void boot();
