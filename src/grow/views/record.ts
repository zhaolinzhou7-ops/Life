/**
 * 记录页：打开就是它。目标是 10 秒记完一条——
 * 日期默认今天，写一句话，点几个标签，保存。
 */

import { shouldRemind } from '../backup';
import { formatDay, todayStr } from '../dates';
import { isIOS, isPhone, isStandalone } from '../env';
import { dueInfo, sortHealth } from '../health';
import { liveEntries, liveHealth, newId, saveEntry, setRemindDismissed, state } from '../store';
import { TAGS, TAG_IDS, type Entry, type TagId } from '../types';
import type { Ctx } from './context';
import { entryCard } from './entry-card';
import { entryFields, type EntryDraft } from './entry-form';
import { button, el, saveFailed, toast } from './ui';

// 草稿存一份在本机：写到一半被切走、App 被系统关掉，回来还在
const DRAFT_KEY = 'grow-draft';

function loadDraft(): EntryDraft {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as { date?: string; text?: string; tags?: string[]; first?: boolean };
      return {
        date: typeof d.date === 'string' && d.date <= todayStr() ? d.date : todayStr(),
        text: typeof d.text === 'string' ? d.text : '',
        tags: new Set((d.tags ?? []).filter((t): t is TagId => TAG_IDS.has(t))),
        first: d.first === true,
      };
    }
  } catch {
    // 草稿坏了就不要了
  }
  return { date: todayStr(), text: '', tags: new Set(), first: false };
}

function storeDraft() {
  try {
    if (isEmpty()) localStorage.removeItem(DRAFT_KEY);
    else localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...draft, tags: [...draft.tags] }));
  } catch {
    // 存不了草稿不影响记录
  }
}

let draft: EntryDraft = loadDraft();

function isEmpty() {
  return !draft.text.trim() && !draft.tags.size && !draft.first;
}

function resetDraft() {
  draft = { date: todayStr(), text: '', tags: new Set(), first: false };
  storeDraft();
}

let lastSaveAt = 0;
let focusedOnce = false;

export function renderRecord(ctx: Ctx): HTMLElement {
  const page = el('section', 'g-page g-record');
  const today = todayStr();
  // 空草稿总是从今天开始（App 可能从昨晚一直开着）
  if (isEmpty()) draft.date = today;

  const head = el('header', 'g-head');
  head.append(el('h1', '', '成长观察'), el('span', 'g-head-sub', formatDay(today)));
  page.appendChild(head);

  if (isPhone() && !isStandalone()) {
    const b = el('div', 'g-banner warn');
    if (isIOS()) {
      b.append(
        el('strong', '', '请先添加到主屏幕'),
        el('p', '', '点 Safari 底部的分享按钮（方框加向上箭头）→“添加到主屏幕”，以后只从主屏幕图标打开。'),
        el('p', '', '在 Safari 里记的内容，主屏幕图标里看不到；Safari 还可能自动清掉它。'),
      );
    } else {
      b.append(
        el('strong', '', '建议装到桌面'),
        el('p', '', '用浏览器菜单里的“添加到主屏幕”或“安装应用”，以后从桌面图标打开，数据更不容易被清掉。'),
      );
    }
    page.appendChild(b);
  }

  if (shouldRemind(today, state.lastExportAt, state.remindDismissedMonth, liveEntries().length > 0)) {
    const b = el('div', 'g-banner remind');
    b.append(
      el('strong', '', '这个月还没备份'),
      el('p', '', '记录只存在这台手机里。导出一份，存到 iCloud 云盘或发给微信“文件传输助手”，才算安全。'),
    );
    const row = el('div', 'g-row');
    row.append(
      button('现在导出', 'g-btn g-btn-primary g-btn-sm', () => ctx.runExport()),
      button('本月不再提醒', 'g-btn g-btn-ghost g-btn-sm', async () => {
        try {
          await setRemindDismissed(today.slice(0, 7));
        } catch {
          // 下次打开再提醒也无妨
        }
        ctx.refresh();
      }),
    );
    b.appendChild(row);
    page.appendChild(b);
  }

  const due = sortHealth(liveHealth(), today)
    .map((h) => ({ h, info: dueInfo(h, today) }))
    .filter((x) => x.info.state === 'overdue' || x.info.state === 'soon');
  if (due.length) {
    const line = button('', 'g-dueline', () => ctx.go('health'));
    line.textContent =
      '🩺 ' +
      due
        .map(({ h, info }) =>
          info.state === 'overdue' ? `${h.name}已过期 ${-info.days!} 天` : info.days === 0 ? `${h.name}就是今天` : `${h.name}还有 ${info.days} 天`,
        )
        .join('，');
    page.appendChild(line);
  }

  const form = el('div', 'g-card g-form');
  // 只在刚打开时把光标放进输入框（iPhone 不允许网页自己弹键盘，放了也没用）；
  // 之后每次重画都抢焦点的话，安卓上保存完键盘会自己又弹出来
  form.appendChild(entryFields(draft, storeDraft, { autoFocus: !focusedOnce && !isIOS() }));
  focusedOnce = true;
  const save = button('保存', 'g-btn g-btn-primary g-btn-big', () => {
    const text = draft.text.trim();
    if (!text) {
      // 刚保存完手抖又点了一下：草稿已经清空，安静忽略，别盖掉"已保存"
      if (Date.now() - lastSaveAt < 1000) return;
      toast('先写一句话', 'err', 1800);
      form.querySelector<HTMLTextAreaElement>('textarea')?.focus();
      return;
    }
    lastSaveAt = Date.now();
    const now = Date.now();
    const e: Entry = {
      id: newId(),
      date: draft.date,
      text,
      tags: TAGS.map((t) => t.id).filter((id) => draft.tags.has(id)),
      first: draft.first,
      createdAt: now,
      updatedAt: now,
    };
    const saving = saveEntry(e);
    resetDraft();
    ctx.refresh();
    saving.then(() => toast('已保存 ✓'), saveFailed);
  });
  form.appendChild(save);
  page.appendChild(form);

  const recent = liveEntries().slice(0, 3);
  if (recent.length) {
    const box = el('div', 'g-recent');
    const h = el('div', 'g-section-title');
    h.append(el('span', '', '最近记下的'), button('看全部', 'g-link', () => ctx.go('timeline')));
    box.appendChild(h);
    for (const e of recent) box.appendChild(entryCard(e, ctx.editEntry, { showDate: true }));
    page.appendChild(box);
  }

  return page;
}
