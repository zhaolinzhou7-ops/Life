/**
 * 健康节点：体检、视力、牙科、疫苗……手动填"上次日期 + 间隔"或直接填"下次日期"。
 * 30 天内到期和已过期的排在最前面。
 */

import { formatFull, isValidDate, todayStr } from '../dates';
import { dueInfo, markDone, sortHealth, SOON_DAYS, type DueInfo } from '../health';
import { liveHealth, newId, removeHealth, saveHealth } from '../store';
import type { HealthItem } from '../types';
import type { Ctx } from './context';
import { button, el, openSheet, saveFailed, segmented, toast } from './ui';

function statusText(info: DueInfo): string {
  if (info.state === 'unknown') return '还没填日期';
  const d = info.days!;
  if (d < 0) return `已过期 ${-d} 天`;
  if (d === 0) return '就是今天';
  return `还有 ${d} 天`;
}

export function renderHealth(ctx: Ctx): HTMLElement {
  const page = el('section', 'g-page g-health');
  const head = el('header', 'g-head');
  head.appendChild(el('h1', '', '健康节点'));
  page.appendChild(head);
  page.appendChild(el('p', 'g-hint', `${SOON_DAYS} 天内到期和已经过期的，排在最前面。`));

  const today = todayStr();
  const items = sortHealth(liveHealth(), today);
  const list = el('div', 'g-health-list');
  for (const h of items) {
    const info = dueInfo(h, today);
    const card = el('div', `g-card g-hcard s-${info.state}`);
    card.dataset.id = h.id;
    const top = el('div', 'g-hcard-top');
    top.append(el('strong', 'g-hname', h.name), el('span', `g-pill s-${info.state}`, statusText(info)));
    card.appendChild(top);

    const lines: string[] = [];
    if (info.due && info.state !== 'unknown') lines.push(`下次：${formatFull(info.due)}`);
    if (h.lastDate) lines.push(`上次：${formatFull(h.lastDate)}`);
    if (h.mode === 'interval' && h.intervalMonths) lines.push(`每 ${h.intervalMonths} 个月一次`);
    if (h.mode === 'date' && !h.nextDate) lines.push('下次日期照接种本/医生说的填');
    if (h.mode === 'interval' && (!h.lastDate || !h.intervalMonths)) lines.push('填上“上次日期”和“间隔”，就能算出下次');
    for (const l of lines) card.appendChild(el('div', 'g-hline', l));
    if (h.note) card.appendChild(el('div', 'g-hnote', h.note));

    const row = el('div', 'g-row');
    row.append(
      button('今天做过了', 'g-btn g-btn-soft g-btn-sm', async () => {
        if (!confirm(`把“${h.name}”的上次日期改成今天？`)) return;
        const updated = markDone(h, today, Date.now());
        const p = saveHealth(updated);
        ctx.refresh();
        try {
          await p;
          toast(updated.mode === 'date' ? '已更新。记得填上下次日期' : '已更新');
          if (updated.mode === 'date') editHealth(updated, ctx);
        } catch (err) {
          saveFailed(err);
        }
      }),
      button('修改', 'g-btn g-btn-ghost g-btn-sm', () => editHealth(h, ctx)),
    );
    card.appendChild(row);
    list.appendChild(card);
  }
  page.appendChild(list);

  page.appendChild(
    button('＋ 添加一项', 'g-btn g-btn-ghost g-add', () =>
      editHealth({ id: newId(), name: '', mode: 'interval', lastDate: '', intervalMonths: null, nextDate: '', note: '', updatedAt: 0 }, ctx, true),
    ),
  );
  return page;
}

function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  // 只有单个输入框才用 <label> 包：label 里放一组按钮时，点第二个按钮会被
  // 浏览器"转发"成点第一个（按钮重画后尤其明显），分段按钮就切不过去
  const single = control instanceof HTMLInputElement || !!control.querySelector('input:only-of-type');
  const f = el(single ? 'label' : 'div', 'g-field');
  f.appendChild(el('span', 'g-field-label', label));
  f.appendChild(control);
  if (hint) f.appendChild(el('span', 'g-field-hint', hint));
  return f;
}

function editHealth(orig: HealthItem, ctx: Ctx, isNew = false) {
  const d = { ...orig };
  const body = el('div', 'g-sheet-body');
  const today = todayStr();

  const name = el('input', 'g-input');
  name.value = d.name;
  name.placeholder = '比如：体检、视力、牙科、疫苗';
  name.maxLength = 30;
  name.addEventListener('input', () => (d.name = name.value));

  const last = el('input', 'g-input g-date');
  last.type = 'date';
  last.max = today;
  last.value = d.lastDate;
  last.addEventListener('change', () => (d.lastDate = last.value));

  const interval = el('input', 'g-input g-num');
  interval.type = 'number';
  interval.inputMode = 'numeric';
  interval.min = '1';
  interval.max = '240';
  interval.placeholder = '比如 6';
  interval.value = d.intervalMonths ? String(d.intervalMonths) : '';
  interval.addEventListener('input', () => {
    const n = Number(interval.value);
    d.intervalMonths = Number.isInteger(n) && n > 0 && n <= 240 ? n : null;
  });
  const intervalWrap = el('div', 'g-inline');
  intervalWrap.append(interval, el('span', '', '个月'));

  const next = el('input', 'g-input g-date');
  next.type = 'date';
  next.value = d.nextDate;
  next.addEventListener('change', () => (d.nextDate = next.value));

  const note = el('input', 'g-input');
  note.value = d.note;
  note.placeholder = '选填，比如：去哪家医院、打的是哪一针';
  note.maxLength = 100;
  note.addEventListener('input', () => (d.note = note.value));

  const lastField = field('上次日期', last);
  const intervalField = field('间隔', intervalWrap);
  const nextField = field('下次日期', next, '照接种本或医生说的日子填');
  function paintMode() {
    intervalField.hidden = d.mode !== 'interval';
    nextField.hidden = d.mode !== 'date';
    lastField.querySelector('.g-field-label')!.textContent = d.mode === 'date' ? '上次日期（选填）' : '上次日期';
  }
  const modeHolder = el('div', '');
  function paintSeg() {
    modeHolder.innerHTML = '';
    modeHolder.appendChild(
      segmented(
        [
          { value: 'interval', label: '按间隔算' },
          { value: 'date', label: '直接填下次日期' },
        ] as const,
        d.mode,
        (v) => {
          d.mode = v;
          paintSeg();
          paintMode();
        },
        { label: '怎么算下次日期' },
      ),
    );
  }
  paintSeg();
  paintMode();

  body.append(field('名称', name), field('怎么算下次', modeHolder), lastField, intervalField, nextField, field('备注', note));

  const actions = el('div', 'g-sheet-actions');
  const sheet = openSheet(isNew ? '添加健康节点' : `修改：${orig.name}`, body);
  actions.appendChild(
    button('保存', 'g-btn g-btn-primary', async () => {
      d.name = d.name.trim();
      if (!d.name) {
        toast('先填个名称', 'err', 1800);
        name.focus();
        return;
      }
      if (d.lastDate && (!isValidDate(d.lastDate) || d.lastDate > today)) {
        toast('上次日期不能晚于今天', 'err', 2500);
        return;
      }
      d.updatedAt = Date.now();
      const p = saveHealth(d);
      sheet.close();
      ctx.refresh();
      try {
        await p;
        toast('已保存 ✓');
      } catch (err) {
        saveFailed(err);
      }
    }),
  );
  if (!isNew) {
    actions.appendChild(
      button('删除这项', 'g-btn g-btn-danger', async () => {
        if (!confirm(`删除“${orig.name}”？删除后找不回来。`)) return;
        const p = removeHealth(orig.id);
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
  }
  body.appendChild(actions);
  if (isNew) requestAnimationFrame(() => name.focus());
}
