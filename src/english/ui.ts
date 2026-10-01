/**
 * DOM 小工具 + 应用上下文类型
 *
 * 没有引框架。这个应用一共十几个页面，每个页面都是「渲染一次 + 局部更新」，
 * 引一套运行时的收益抵不过它的体积和心智负担——儿童端在低端安卓机上跑，
 * 首屏每多 100KB 都是真实的等待。
 */

import type { ChildData } from './store';

export type View = () => HTMLElement;

export interface Ctx {
  data: ChildData;
  /** 把 data 写回 localStorage */
  save(): void;
  push(v: View): void;
  pop(): void;
  replace(v: View): void;
  /** 回到合集首页 */
  exit(): void;
  /** 进入家长端 */
  toParent(): void;
  /** 回到儿童端今日任务 */
  toKidHome(): void;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

export function btn(label: string, cls = 'en-btn', onClick?: () => void): HTMLButtonElement {
  const b = el('button', cls);
  b.type = 'button';
  b.textContent = label;
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** 顶栏。back 为空时不显示返回键（例如首页） */
export function topbar(title: string, back?: () => void, right?: HTMLElement): HTMLElement {
  const bar = el('div', 'en-bar');
  if (back) {
    const b = btn('‹', 'en-back', back);
    b.setAttribute('aria-label', '返回');
    bar.appendChild(b);
  }
  bar.appendChild(el('div', 'en-bar-title', title));
  if (right) bar.appendChild(right);
  return bar;
}

/** 进度点。total 超过 10 个就改成文字，否则一排点会挤成一条线 */
export function dots(total: number, current: number): HTMLElement {
  const wrap = el('div', 'en-dots');
  if (total > 10) {
    wrap.className = 'en-bar-title';
    wrap.style.flex = '0 0 auto';
    wrap.style.fontSize = '14px';
    wrap.textContent = `${Math.min(current + 1, total)}/${total}`;
    return wrap;
  }
  for (let i = 0; i < total; i++) {
    const d = el('div', 'en-dot');
    if (i < current) d.classList.add('on');
    if (i === current) d.classList.add('now');
    wrap.appendChild(d);
  }
  return wrap;
}

export function page(kind: 'kid' | 'parent' = 'kid'): HTMLElement {
  const p = el('div', 'en-page');
  p.dataset.kind = kind;
  return p;
}

/** 把句子里的目标词高亮出来，朗读时孩子能对上 */
export function highlight(text: string, word?: string): HTMLElement {
  const n = el('div');
  if (!word) {
    n.textContent = text;
    return n;
  }
  const re = new RegExp(`\\b(${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?)\\b`, 'i');
  const m = text.match(re);
  if (!m || m.index === undefined) {
    n.textContent = text;
    return n;
  }
  n.appendChild(document.createTextNode(text.slice(0, m.index)));
  n.appendChild(el('span', 'hl', m[0]));
  n.appendChild(document.createTextNode(text.slice(m.index + m[0].length)));
  return n;
}

/** 短暂的提示条。用在「已保存」这类不需要打断的反馈上 */
export function toast(msg: string): void {
  const old = document.querySelector('.en-toast');
  old?.remove();
  const t = el('div', 'en-toast', msg);
  Object.assign(t.style, {
    position: 'fixed',
    left: '50%',
    bottom: 'calc(28px + env(safe-area-inset-bottom))',
    transform: 'translateX(-50%)',
    background: 'rgba(20,26,33,0.92)',
    color: '#fff',
    padding: '10px 18px',
    borderRadius: '999px',
    fontSize: '14px',
    zIndex: '99',
    maxWidth: 'calc(100vw - 32px)',
    textAlign: 'center',
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 1900);
}

/** 家长端的能力条 */
export function skillBar(name: string, value: number, desc: string): HTMLElement {
  const row = el('div', 'en-skill');
  row.appendChild(el('div', 'en-skill-name', name));
  const track = el('div', 'en-skill-track');
  const fill = el('div', 'en-skill-fill');
  fill.style.width = `${Math.max(3, Math.min(100, value))}%`;
  track.appendChild(fill);
  row.appendChild(track);
  const d = el('div', 'en-skill-desc', desc);
  d.title = desc;
  row.appendChild(d);
  return row;
}

export function card(title?: string): HTMLElement {
  const c = el('div', 'en-card');
  if (title) c.appendChild(el('h2', undefined, title));
  return c;
}

/** 空状态。必须带一个「下一步做什么」，否则用户只能返回 */
export function empty(emo: string, msg: string, action?: { label: string; go: () => void }): HTMLElement {
  const e = el('div', 'en-empty');
  e.appendChild(el('span', 'emo', emo));
  e.appendChild(el('div', undefined, msg));
  if (action) {
    const row = el('div', 'en-pbtn-row');
    row.style.justifyContent = 'center';
    row.appendChild(btn(action.label, 'en-pbtn primary', action.go));
    e.appendChild(row);
  }
  return e;
}

export type { ChildData };
