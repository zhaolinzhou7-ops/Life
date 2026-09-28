/**
 * 一条记录的填写区：日期、一句话、标签、⭐第一次。
 * 记录页和"修改记录"弹层共用。控件自己更新自己的样式，不整页重画，
 * 这样点标签时输入框不会失去焦点、键盘不会收起。
 */

import { addDays, todayStr } from '../dates';
import { TAGS, type TagId } from '../types';
import { chip, el, toast } from './ui';

export interface EntryDraft {
  date: string;
  text: string;
  tags: Set<TagId>;
  first: boolean;
}

export function entryFields(d: EntryDraft, onChange: () => void, opts: { autoFocus?: boolean } = {}): HTMLElement {
  const wrap = el('div', 'g-entry-fields');
  const today = todayStr();

  // 日期：默认今天，另有"今天/昨天"两个快捷键
  const dateRow = el('div', 'g-date-row');
  const dateInput = el('input', 'g-input g-date');
  dateInput.type = 'date';
  dateInput.max = today;
  dateInput.value = d.date;
  dateInput.setAttribute('aria-label', '日期');
  const quick = [
    { label: '今天', value: today },
    { label: '昨天', value: addDays(today, -1) },
  ].map((q) => {
    const b = chip(q.label, d.date === q.value, () => setDate(q.value), 'g-chip-sm');
    b.dataset.value = q.value;
    return b;
  });
  function paintQuick() {
    for (const b of quick) {
      const on = b.dataset.value === d.date;
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
  }
  function setDate(v: string) {
    d.date = v;
    dateInput.value = v;
    paintQuick();
    onChange();
  }
  dateInput.addEventListener('change', () => {
    const v = dateInput.value;
    if (!v) {
      setDate(today);
    } else if (v > todayStr()) {
      toast('日期不能晚于今天', 'err', 2500);
      setDate(today);
    } else setDate(v);
  });
  dateRow.append(dateInput, ...quick);

  const text = el('textarea', 'g-input g-text');
  text.rows = 3;
  text.placeholder = '一句话，比如：今天自己把鞋穿好了\n（可以点键盘上的🎤直接说）';
  text.value = d.text;
  text.setAttribute('aria-label', '记录内容');
  text.maxLength = 2000;
  text.addEventListener('input', () => {
    d.text = text.value;
    onChange();
  });
  if (opts.autoFocus) requestAnimationFrame(() => text.focus({ preventScroll: true }));

  const tags = el('div', 'g-tags');
  tags.setAttribute('aria-label', '标签（可多选）');
  for (const t of TAGS) {
    const b = chip(t.label, d.tags.has(t.id), () => {
      if (d.tags.has(t.id)) d.tags.delete(t.id);
      else d.tags.add(t.id);
      const on = d.tags.has(t.id);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      onChange();
    });
    b.dataset.tag = t.id;
    tags.appendChild(b);
  }

  const first = chip('⭐ 第一次', d.first, () => {
    d.first = !d.first;
    first.classList.toggle('on', d.first);
    first.setAttribute('aria-pressed', String(d.first));
    onChange();
  }, 'g-chip-first');

  wrap.append(dateRow, text, tags, first);
  return wrap;
}
