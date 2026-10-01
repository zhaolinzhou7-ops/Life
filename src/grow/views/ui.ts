/**
 * 界面小工具：建元素、按钮、提示条、底部弹层、图标。
 */

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export function button(label: string, cls: string, onClick: (ev: MouseEvent) => void): HTMLButtonElement {
  const b = el('button', cls, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

let toastTimer = 0;

/** 屏幕下方的短提示，几秒后自己消失 */
export function toast(msg: string, kind: 'ok' | 'err' = 'ok', ms = 2200) {
  let t = document.querySelector<HTMLElement>('.g-toast');
  if (!t) {
    t = el('div', 'g-toast');
    t.setAttribute('role', 'status');
    t.setAttribute('aria-live', 'polite');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.dataset.kind = kind;
  t.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), kind === 'err' ? Math.max(ms, 5000) : ms);
}

/** 写入失败时的统一说法：数据没进手机，最要紧的是让用户知道并去导出 */
export function saveFailed(err: unknown) {
  const why = err instanceof Error && err.message ? `（${err.message}）` : '';
  toast(`没能存进手机${why}。这条还在屏幕上，请先到"备份"页导出一份。`, 'err');
}

export interface Sheet {
  close(): void;
}

/** 从底部升起的弹层，用于编辑。点背景或"取消"关闭 */
export function openSheet(title: string, body: HTMLElement): Sheet {
  const back = el('div', 'g-sheet-back');
  const sheet = el('div', 'g-sheet');
  sheet.setAttribute('role', 'dialog');
  sheet.setAttribute('aria-modal', 'true');
  sheet.setAttribute('aria-label', title);
  const head = el('div', 'g-sheet-head');
  head.appendChild(el('h2', '', title));
  const close = () => {
    back.remove();
    document.body.classList.remove('g-noscroll');
  };
  head.appendChild(button('关闭', 'g-link', close));
  sheet.append(head, body);
  back.appendChild(sheet);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  document.body.appendChild(back);
  document.body.classList.add('g-noscroll');
  return { close };
}

const ICONS: Record<string, string> = {
  record: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
  timeline: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  health: '<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7a4.3 4.3 0 0 1 7.5 2.8C19.5 15.4 12 20 12 20z"/>',
  growth: '<path d="M12 21v-9"/><path d="M12 12c0-4.2 2.8-6.5 7-6.5 0 4.2-2.8 6.5-7 6.5z"/><path d="M12 14.5c0-3.2-2.3-5.2-6-5.2 0 3.2 2.3 5.2 6 5.2z"/>',
  backup: '<path d="M12 3.5v11"/><path d="M7.5 10.5L12 15l4.5-4.5"/><path d="M4.5 19.5h15"/>',
};

export function icon(name: keyof typeof ICONS | string): HTMLElement {
  const span = el('span', 'g-icon');
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] ?? ''}</svg>`;
  return span;
}

/** 三选一/二选一的分段按钮 */
export function segmented<T extends string>(
  options: readonly { value: T; label: string }[],
  current: T | null,
  onPick: (v: T) => void,
  opts: { disabled?: boolean; label?: string } = {},
): HTMLElement {
  const wrap = el('div', 'g-seg');
  wrap.setAttribute('role', 'radiogroup');
  if (opts.label) wrap.setAttribute('aria-label', opts.label);
  for (const o of options) {
    const b = button(o.label, 'g-seg-btn', () => {
      if (o.value !== current) onPick(o.value);
    });
    b.dataset.value = o.value;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(o.value === current));
    if (o.value === current) b.classList.add('on');
    if (opts.disabled) b.disabled = true;
    wrap.appendChild(b);
  }
  return wrap;
}

/** 可多选的小标签按钮 */
export function chip(label: string, on: boolean, onToggle: () => void, cls = ''): HTMLButtonElement {
  const b = button(label, `g-chip ${cls}`.trim(), onToggle);
  b.setAttribute('aria-pressed', String(on));
  if (on) b.classList.add('on');
  return b;
}
