/**
 * 时间线：按月翻看，按标签筛，搜索（搜全部月份）。点一条可以修改或删除。
 */

import { formatDay, formatFull, formatMonth, monthKey, shiftMonth, todayStr } from '../dates';
import { isPhone } from '../env';
import { filterEntries, groupBy } from '../query';
import { liveEntries } from '../store';
import { TAGS, type TagId } from '../types';
import type { Ctx } from './context';
import { entryCard } from './entry-card';
import { button, chip, el } from './ui';

// 切到别的页再回来，筛选条件保持不变
const view = {
  month: monthKey(todayStr()),
  tags: new Set<TagId>(),
  firstOnly: false,
  query: '',
};

export function renderTimeline(ctx: Ctx): HTMLElement {
  const page = el('section', 'g-page g-timeline');
  const head = el('header', 'g-head');
  head.appendChild(el('h1', '', '时间线'));
  page.appendChild(head);

  const all = liveEntries();
  const results = el('div', 'g-results');

  const search = el('input', 'g-input g-search');
  search.type = 'search';
  search.placeholder = '搜索全部记录';
  search.value = view.query;
  search.setAttribute('aria-label', '搜索全部记录');
  search.enterKeyHint = 'search';
  search.addEventListener('input', () => {
    view.query = search.value;
    paintMonthNav();
    paintResults();
  });
  page.appendChild(search);

  // 月份切换：‹ 2026年9月 ›；点中间的月份可以直接跳
  const nav = el('div', 'g-month-nav');
  const thisMonth = monthKey(todayStr());
  const prev = button('‹', 'g-btn g-btn-ghost g-month-btn', () => setMonth(shiftMonth(view.month, -1)));
  prev.setAttribute('aria-label', '上个月');
  const next = button('›', 'g-btn g-btn-ghost g-month-btn', () => setMonth(shiftMonth(view.month, 1)));
  next.setAttribute('aria-label', '下个月');
  const label = el('label', 'g-month-label');
  const labelText = el('span', '');
  const picker = el('input', 'g-month-picker');
  picker.type = 'month';
  picker.max = thisMonth;
  picker.setAttribute('aria-label', '选择月份');
  picker.addEventListener('change', () => {
    if (picker.value) setMonth(picker.value);
  });
  // 手机上点透明的月份框会直接弹出选择器；电脑浏览器要主动叫一下
  if (!isPhone()) {
    picker.addEventListener('click', () => {
      try {
        picker.showPicker();
      } catch {
        // 不支持就算了，还有左右箭头
      }
    });
  }
  label.append(labelText, picker);
  nav.append(prev, label, next);
  page.appendChild(nav);

  function setMonth(m: string) {
    view.month = m > thisMonth ? thisMonth : m;
    paintMonthNav();
    paintResults();
  }

  function paintMonthNav() {
    nav.hidden = !!view.query.trim();
    labelText.textContent = `${formatMonth(view.month)} ▾`;
    picker.value = view.month;
    next.disabled = view.month >= thisMonth;
  }

  // 标签筛选：可多选，含其中任意一个就显示
  const filters = el('div', 'g-tags g-filters');
  const clear = button('清除筛选', 'g-link g-clear', () => {
    view.tags.clear();
    view.firstOnly = false;
    for (const b of filters.querySelectorAll<HTMLButtonElement>('.g-chip')) {
      b.classList.remove('on');
      b.setAttribute('aria-pressed', 'false');
    }
    paintResults();
  });
  for (const t of TAGS) {
    const b = chip(t.label, view.tags.has(t.id), () => {
      if (view.tags.has(t.id)) view.tags.delete(t.id);
      else view.tags.add(t.id);
      b.classList.toggle('on', view.tags.has(t.id));
      b.setAttribute('aria-pressed', String(view.tags.has(t.id)));
      paintResults();
    }, 'g-chip-sm');
    b.dataset.tag = t.id;
    filters.appendChild(b);
  }
  const firstChip = chip('⭐ 第一次', view.firstOnly, () => {
    view.firstOnly = !view.firstOnly;
    firstChip.classList.toggle('on', view.firstOnly);
    firstChip.setAttribute('aria-pressed', String(view.firstOnly));
    paintResults();
  }, 'g-chip-sm g-chip-first');
  filters.append(firstChip, clear);
  page.appendChild(filters);
  page.appendChild(results);

  function paintResults() {
    clear.hidden = !view.tags.size && !view.firstOnly;
    results.innerHTML = '';
    const searching = !!view.query.trim();
    const list = filterEntries(all, { month: view.month, tags: view.tags, firstOnly: view.firstOnly, query: view.query });
    if (searching) results.appendChild(el('p', 'g-hint', list.length ? `找到 ${list.length} 条` : '没有找到。换个词试试？'));
    if (!list.length) {
      if (!searching) {
        const filtered = view.tags.size || view.firstOnly;
        results.appendChild(el('p', 'g-empty', filtered ? '这个月没有符合筛选的记录。' : '这个月还没有记录。'));
        if (!all.length) results.appendChild(button('去记第一条', 'g-btn g-btn-primary', () => ctx.go('record')));
      }
      return;
    }
    for (const day of groupBy(list, (e) => e.date)) {
      const g = el('div', 'g-day');
      g.appendChild(el('h3', 'g-day-title', searching ? `${formatFull(day.key)} · ${formatDay(day.key).split(' ')[1]}` : formatDay(day.key)));
      for (const e of day.entries) g.appendChild(entryCard(e, ctx.editEntry));
      results.appendChild(g);
    }
  }

  paintMonthNav();
  paintResults();
  return page;
}
