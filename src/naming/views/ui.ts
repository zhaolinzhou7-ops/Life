/**
 * 共用的小组件
 *
 * 没有引入任何 UI 框架：这个仓库里其它应用都是原生 DOM，保持一致比引入一套
 * 新的心智负担更划算。这里只抽出真正被重复用到的几个东西。
 */

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  html?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

/** 转义，所有用户输入进 innerHTML 之前都要过这里 */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

export function button(label: string, cls = '', onClick?: () => void): HTMLButtonElement {
  const b = el('button', `nm-btn ${cls}`.trim(), esc(label));
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** 顶部导航条：返回 + 标题 + 右侧操作 */
export function topbar(title: string, onBack: () => void, right?: HTMLElement): HTMLElement {
  const bar = el('div', 'nm-topbar');
  const back = el('button', 'nm-back', '‹');
  back.setAttribute('aria-label', '返回');
  back.addEventListener('click', onBack);
  bar.appendChild(back);
  bar.appendChild(el('div', 'nm-topbar-title', esc(title)));
  const slot = el('div', 'nm-topbar-right');
  if (right) slot.appendChild(right);
  bar.appendChild(slot);
  return bar;
}

/** 可多选/单选的标签组 */
export function chipGroup(
  options: string[],
  selected: Set<string>,
  onChange: (s: Set<string>) => void,
  opts: { single?: boolean } = {},
): HTMLElement {
  const wrap = el('div', 'nm-chips');
  for (const o of options) {
    const c = el('button', 'nm-chip', esc(o));
    if (selected.has(o)) c.classList.add('on');
    c.addEventListener('click', () => {
      if (opts.single) {
        selected.clear();
        selected.add(o);
        for (const other of wrap.children) other.classList.remove('on');
        c.classList.add('on');
      } else {
        if (selected.has(o)) {
          selected.delete(o);
          c.classList.remove('on');
        } else {
          selected.add(o);
          c.classList.add('on');
        }
      }
      onChange(selected);
    });
    wrap.appendChild(c);
  }
  return wrap;
}

/** 一条表单项 */
export function field(label: string, hint: string, control: HTMLElement): HTMLElement {
  const f = el('div', 'nm-field');
  f.appendChild(el('div', 'nm-label', esc(label)));
  if (hint) f.appendChild(el('div', 'nm-hint', esc(hint)));
  f.appendChild(control);
  return f;
}

export function textInput(placeholder: string, value = ''): HTMLInputElement {
  const i = el('input', 'nm-input');
  i.type = 'text';
  i.placeholder = placeholder;
  i.value = value;
  return i;
}

/** 加载中的骨架屏。比转圈更能说明「马上就有内容了」 */
export function skeleton(n = 6): HTMLElement {
  const wrap = el('div', 'nm-skel-list');
  for (let i = 0; i < n; i++) {
    const s = el('div', 'nm-skel-card');
    s.innerHTML = `<div class="nm-skel-name"></div><div class="nm-skel-line"></div><div class="nm-skel-line short"></div>`;
    wrap.appendChild(s);
  }
  return wrap;
}

/** 空状态。必须给出下一步能做什么，不能只写「暂无数据」 */
export function emptyState(title: string, desc: string, action?: { label: string; go: () => void }): HTMLElement {
  const e = el('div', 'nm-empty');
  e.appendChild(el('div', 'nm-empty-mark', '　'));
  e.appendChild(el('div', 'nm-empty-title', esc(title)));
  e.appendChild(el('div', 'nm-empty-desc', esc(desc)));
  if (action) e.appendChild(button(action.label, 'primary', action.go));
  return e;
}

/** 出错状态。说清楚发生了什么、能怎么办 */
export function errorState(msg: string, retry?: () => void): HTMLElement {
  const e = el('div', 'nm-empty');
  e.appendChild(el('div', 'nm-empty-title', '没能生成出来'));
  e.appendChild(el('div', 'nm-empty-desc', esc(msg)));
  if (retry) e.appendChild(button('再试一次', 'primary', retry));
  return e;
}

let toastTimer: number | null = null;
export function toast(msg: string): void {
  let t = document.querySelector('.nm-toast') as HTMLElement | null;
  if (!t) {
    t = el('div', 'nm-toast');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t!.classList.remove('show'), 1800);
}

/** 可折叠区块，用来收纳「想看才看」的内容 */
export function collapsible(title: string, content: HTMLElement, open = false): HTMLElement {
  const wrap = el('div', 'nm-collapse');
  const head = el('button', 'nm-collapse-head', `<span>${esc(title)}</span><i>${open ? '−' : '+'}</i>`);
  const body = el('div', 'nm-collapse-body');
  body.appendChild(content);
  if (!open) body.style.display = 'none';
  head.addEventListener('click', () => {
    const shown = body.style.display !== 'none';
    body.style.display = shown ? 'none' : '';
    head.querySelector('i')!.textContent = shown ? '+' : '−';
  });
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

const LEVEL_CLASS: Record<string, string> = { 优: 'lv-a', 良: 'lv-b', 一般: 'lv-c', 需注意: 'lv-d' };

/** 维度条。展示档位和一个粗略的长度，不展示具体分数 */
export function dimBar(label: string, level: string, score: number): HTMLElement {
  const row = el('div', 'nm-dim');
  row.innerHTML = `
    <div class="nm-dim-label">${esc(label)}</div>
    <div class="nm-dim-track"><div class="nm-dim-fill ${LEVEL_CLASS[level] ?? ''}" style="width:${Math.max(8, Math.min(100, score))}%"></div></div>
    <div class="nm-dim-level ${LEVEL_CLASS[level] ?? ''}">${esc(level)}</div>`;
  return row;
}
