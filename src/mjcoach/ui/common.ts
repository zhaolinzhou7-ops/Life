/**
 * 界面公用件：建元素、画牌、排版小工具。
 * 没有引任何框架——这个仓库里的其它几个游戏也都是手写 DOM，保持一致。
 */

import { SUIT_NAMES, rankOf, suitOf, type TileId } from '../rules/tiles';

type Attrs = Record<string, string | number | boolean | undefined | ((e: Event) => void)>;

/** el('div.foo', {…}, 子元素…) */
export function el<K extends keyof HTMLElementTagNameMap>(
  spec: string,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const [tag, ...classes] = spec.split('.');
  const node = document.createElement(tag || 'div');
  if (classes.length) node.className = classes.join(' ');
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'html') {
      node.innerHTML = String(v);
    } else if (k === 'text') {
      node.textContent = String(v);
    } else if (k === 'style') {
      node.setAttribute('style', String(v));
    } else {
      node.setAttribute(k, String(v));
    }
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node as HTMLElementTagNameMap[K];
}

export function clear(node: HTMLElement) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

const SUIT_CLASS = ['wan', 'tiao', 'tong'];

export interface TileOpts {
  size?: 'tiny' | 'small' | 'big';
  selected?: boolean;
  picked?: boolean;
  dim?: boolean;
  mark?: 'best' | 'bad';
  onClick?: (t: TileId) => void;
  title?: string;
}

/**
 * 画一张牌。
 * 牌面用「数字 + 花色字」，不画传统的饼和条——
 * 教学软件里，用户要能一眼看清是哪张，比像不像真牌重要得多。
 */
export function tileEl(t: TileId, opts: TileOpts = {}): HTMLElement {
  const cls = ['mc-tile', SUIT_CLASS[suitOf(t)]];
  if (opts.size) cls.push(opts.size);
  if (opts.selected) cls.push('sel');
  if (opts.picked) cls.push('picked');
  if (opts.dim) cls.push('dim');
  if (opts.mark) cls.push(`mark-${opts.mark}`);
  if (opts.onClick) cls.push('clickable');
  const node = el(`div.${cls.join('.')}`, { title: opts.title ?? `${rankOf(t)}${SUIT_NAMES[suitOf(t)]}` });
  node.appendChild(el('div.r', { text: String(rankOf(t)) }));
  node.appendChild(el('div.s', { text: SUIT_NAMES[suitOf(t)] }));
  if (opts.onClick) node.addEventListener('click', () => opts.onClick!(t));
  return node;
}

/** 牌背（别人的手牌） */
export function tileBack(size?: 'tiny' | 'small'): HTMLElement {
  return el(`div.mc-tile.back${size ? `.${size}` : ''}`);
}

/** 一串牌 */
export function tilesEl(tiles: readonly TileId[], opts: TileOpts = {}): HTMLElement {
  const box = el('div.mc-tiles');
  for (const t of tiles) box.appendChild(tileEl(t, opts));
  return box;
}

/**
 * 教练文案里的轻量 Markdown：只支持 **粗体** 和换行。
 * 故意不引 markdown 库——我们自己生成的文案，格式可控，
 * 而且用 textContent 拼装天然不会有 XSS 问题。
 */
export function richText(text: string): HTMLElement {
  const box = el('div');
  for (const line of text.split('\n')) {
    const p = el('div');
    let rest = line;
    let m: RegExpExecArray | null;
    const re = /\*\*(.+?)\*\*/;
    while ((m = re.exec(rest))) {
      if (m.index > 0) p.appendChild(document.createTextNode(rest.slice(0, m.index)));
      p.appendChild(el('strong', { text: m[1] }));
      rest = rest.slice(m.index + m[0].length);
    }
    if (rest) p.appendChild(document.createTextNode(rest));
    if (!line.trim()) p.style.height = '8px';
    box.appendChild(p);
  }
  return box;
}

export const stars = (n: number): string => '★'.repeat(n) + '☆'.repeat(Math.max(0, 5 - n));

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 顶部返回栏 */
export function topbar(title: string, sub: string, onBack?: () => void): HTMLElement {
  const bar = el('div.mc-topbar');
  if (onBack) bar.appendChild(el('button.mc-btn.sm.ghost', { text: '‹ 返回', onclick: onBack }));
  bar.appendChild(el('div', {}, el('h1', { text: title }), sub ? el('div.mc-sub', { text: sub }) : null));
  return bar;
}

let toastTimer = 0;

export function toast(root: HTMLElement, msg: string) {
  let box = root.querySelector('.mc-toast') as HTMLElement | null;
  if (!box) {
    box = el('div.mc-toast');
    box.setAttribute(
      'style',
      'position:absolute;left:50%;top:22%;transform:translateX(-50%);background:rgba(20,28,36,.95);' +
        'border:1px solid #2b3846;color:#e9eef4;padding:9px 16px;border-radius:10px;font-size:14px;' +
        'z-index:60;pointer-events:none;opacity:0;transition:opacity .18s;max-width:80%;text-align:center',
    );
    root.appendChild(box);
  }
  box.textContent = msg;
  box.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (box) box.style.opacity = '0';
  }, 1800);
}
