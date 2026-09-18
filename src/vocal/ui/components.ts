/** 界面的零件库。没有框架，就是一组建 DOM 的小函数，够用且好读。 */

import type { Metric } from '../analysis/types';

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = '',
  html = '',
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (className) n.className = className;
  if (html) n.innerHTML = html;
  return n;
}

export function btn(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', className);
  b.innerHTML = text;
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** 转义用户可见但可能含特殊字符的文本（歌词、模型名、错误信息等） */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function card(className = ''): HTMLDivElement {
  return el('div', `v-card ${className}`.trim());
}

export function note(text: string, kind: '' | 'warn' | 'bad' = ''): HTMLDivElement {
  return el('div', `v-note ${kind}`.trim(), text);
}

export function sectionTitle(text: string): HTMLDivElement {
  return el('div', 'v-section-title', esc(text));
}

/** 分数条的颜色：低分不用刺眼的红，避免打击人——但也不粉饰 */
export function scoreColor(score: number): string {
  if (score >= 80) return 'var(--v-green)';
  if (score >= 62) return 'var(--v-accent)';
  if (score >= 45) return 'var(--v-yellow)';
  return 'var(--v-red)';
}

/**
 * 一个指标的完整展示：名字、分数、进度条、以及**为什么是这个结果**。
 * why 是必须显示的——产品需求里写得很清楚，光给分不给理由等于没说。
 */
export function metricBlock(label: string, m: Metric): HTMLDivElement {
  const box = el('div', 'v-metric');
  const head = el('div', 'head');
  head.appendChild(el('span', 'name', esc(label)));
  const val = el('span', 'val');
  if (m.score === null) {
    val.innerHTML = '<span style="font-size:14px;color:var(--v-dim)">本次未评</span>';
  } else {
    val.innerHTML = `${m.score}<span class="unit">分${m.raw !== null ? ` · ${m.raw}${esc(m.unit)}` : ''}</span>`;
    val.style.color = scoreColor(m.score);
  }
  head.appendChild(val);
  box.appendChild(head);

  if (m.score !== null) {
    const bar = el('div', 'bar');
    const fill = el('i');
    fill.style.width = `${Math.max(2, m.score)}%`;
    fill.style.background = scoreColor(m.score);
    bar.appendChild(fill);
    box.appendChild(bar);
  }

  box.appendChild(el('div', m.score === null ? 'na' : 'why', esc(m.why)));
  return box;
}

export function abilityRow(
  label: string,
  value: number | null,
  delta: number | null,
): HTMLDivElement {
  const row = el('div', 'v-ability');
  row.appendChild(el('span', 'lb', esc(label)));
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = `${value === null ? 0 : Math.max(2, value)}%`;
  if (value !== null) fill.style.background = scoreColor(value);
  bar.appendChild(fill);
  row.appendChild(bar);
  const n = el('span', 'n');
  if (value === null) n.innerHTML = '<span style="color:var(--v-dim)">—</span>';
  else {
    const d =
      delta === null || Math.abs(delta) < 2
        ? ''
        : `<span class="d ${delta > 0 ? 'up' : 'dn'}">${delta > 0 ? '↑' : '↓'}${Math.abs(delta)}</span>`;
    n.innerHTML = `${value}${d}`;
  }
  row.appendChild(n);
  return row;
}

export function field(label: string, input: HTMLElement, hint = ''): HTMLDivElement {
  const f = el('div', 'v-field');
  f.appendChild(el('label', '', esc(label)));
  f.appendChild(input);
  if (hint) {
    const h = el('div', '', esc(hint));
    h.style.cssText = 'font-size:12px;color:var(--v-dim);margin-top:5px;line-height:1.6';
    f.appendChild(h);
  }
  return f;
}

export function textInput(value: string, placeholder = '', type = 'text'): HTMLInputElement {
  const i = el('input', 'v-input');
  i.type = type;
  i.value = value;
  i.placeholder = placeholder;
  return i;
}

export function select(
  options: { value: string; label: string }[],
  current: string,
): HTMLSelectElement {
  const s = el('select', 'v-select');
  for (const o of options) {
    const opt = el('option');
    opt.value = o.value;
    opt.textContent = o.label;
    if (o.value === current) opt.selected = true;
    s.appendChild(opt);
  }
  return s;
}

export function segmented(
  options: { value: string; label: string }[],
  current: string,
  onChange: (v: string) => void,
): HTMLDivElement {
  const box = el('div', 'v-seg');
  for (const o of options) {
    const b = btn(esc(o.label), o.value === current ? 'on' : '', () => {
      for (const c of Array.from(box.children)) c.classList.remove('on');
      b.classList.add('on');
      onChange(o.value);
    });
    box.appendChild(b);
  }
  return box;
}

export function switchRow(
  title: string,
  desc: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLDivElement {
  const row = el('div', 'v-switch');
  const txt = el('div', 'txt');
  txt.appendChild(el('div', 't', esc(title)));
  if (desc) txt.appendChild(el('div', 'd', esc(desc)));
  row.appendChild(txt);
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  row.appendChild(cb);
  return row;
}

export function listRow(
  title: string,
  desc: string,
  right: string,
  onClick?: () => void,
): HTMLDivElement {
  const row = el('div', 'v-row');
  const main = el('div', 'main');
  main.appendChild(el('div', 't', title));
  if (desc) main.appendChild(el('div', 'd', desc));
  row.appendChild(main);
  if (right) row.appendChild(el('div', 'r', right));
  if (onClick) row.addEventListener('click', onClick);
  else row.style.cursor = 'default';
  return row;
}

export function empty(text: string): HTMLDivElement {
  return el('div', 'v-empty', esc(text));
}

export function loading(text: string): HTMLDivElement {
  return el('div', 'v-loading', `<span class="v-spinner"></span>${esc(text)}`);
}

/** 自适应 DPR 的画布 */
export interface View {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  dispose: () => void;
}

export function makeCanvas(parent: HTMLElement, className = 'v-canvas', height = 0): View {
  const canvas = el('canvas', className);
  if (height) canvas.style.height = `${height}px`;
  parent.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  const view: View = { canvas, g, w: 0, h: 0, dispose: () => {} };

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    view.w = rect.width;
    view.h = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  // 布局还没完成时量到的是 0，下一帧再量一次
  requestAnimationFrame(resize);
  resize();
  window.addEventListener('resize', resize);
  view.dispose = () => {
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
  return view;
}

export function rafLoop(fn: (dt: number) => void): () => void {
  let id = 0;
  let last = performance.now();
  let stopped = false;
  const tick = (t: number) => {
    if (stopped) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    fn(dt);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
}

export function fmtDate(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.floor((today.getTime() - new Date(ts).setHours(0, 0, 0, 0)) / 86400000);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (days === 0) return `今天 ${hm}`;
  if (days === 1) return `昨天 ${hm}`;
  if (days < 7) return `${days} 天前`;
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}

export function fmtDuration(sec: number): string {
  const s = Math.round(sec);
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${String(s % 60).padStart(2, '0')} 秒`;
}
