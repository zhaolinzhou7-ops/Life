/**
 * 共用组件
 *
 * 和仓库里其它应用一致：原生 DOM，不引 UI 框架。这里只抽真正被重复用到的东西。
 *
 * 有两个组件值得特别说明，因为它们承载的是产品原则而不只是样式：
 *
 * · `metric()` —— 任何数字都必须带着"它是怎么来的"一起显示。点一下就能看到
 *   口径。这是第 22 节在界面上的落地：不给用户一个他无法判断可信度的数字。
 *
 * · `hintLadder()` —— 四级提示。它的交互刻意设计成"一级一级点开"，
 *   而不是一次全给：用户在第一级就能说出来的话，就不该看到第四级。
 */

import type { Measured, MetricSource } from '../types';

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

/** 转义。所有用户输入进 innerHTML 之前都要过这里 */
export function esc(s: string): string {
  return String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}

export function button(label: string, cls = '', onClick?: () => void): HTMLButtonElement {
  const b = el('button', `ec-btn ${cls}`.trim(), esc(label));
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/**
 * 把顶栏装到页面上。
 *
 * 必须用它，不能直接 appendChild：page() 已经先放好了内容区和底部操作条，
 * 再 append 顶栏会让它排到**页面最下面**——返回按钮跑到屏幕底部，
 * 而 sticky 定位并不会把它挪回去。这个错误在单元测试里完全看不出来。
 */
export function mountTopbar(root: HTMLElement, bar: HTMLElement): void {
  root.insertBefore(bar, root.firstChild);
}

/** 顶栏：返回 + 标题 + 右侧槽位 */
export function topbar(title: string, onBack: () => void, right?: HTMLElement): HTMLElement {
  const bar = el('div', 'ec-topbar');
  const back = el('button', 'ec-back', '‹');
  back.type = 'button';
  back.setAttribute('aria-label', '返回');
  back.addEventListener('click', onBack);
  bar.appendChild(back);
  bar.appendChild(el('div', 'ec-topbar-title', esc(title)));
  const slot = el('div', 'ec-topbar-right');
  if (right) slot.appendChild(right);
  bar.appendChild(slot);
  return bar;
}

export function card(cls = ''): HTMLElement {
  return el('div', `ec-card ${cls}`.trim());
}

export function section(title: string, sub?: string): HTMLElement {
  const s = el('div', 'ec-section');
  s.appendChild(el('h3', '', esc(title)));
  if (sub) s.appendChild(el('div', 'ec-section-sub', esc(sub)));
  return s;
}

/** 一条表单项 */
export function field(label: string, hint: string, control: HTMLElement): HTMLElement {
  const f = el('div', 'ec-field');
  f.appendChild(el('div', 'ec-label', esc(label)));
  if (hint) f.appendChild(el('div', 'ec-hint', esc(hint)));
  f.appendChild(control);
  return f;
}

export function textInput(placeholder: string, value = ''): HTMLInputElement {
  const i = el('input', 'ec-input');
  i.type = 'text';
  i.placeholder = placeholder;
  i.value = value;
  return i;
}

export function textArea(placeholder: string, value = '', rows = 4): HTMLTextAreaElement {
  const t = el('textarea', 'ec-input ec-textarea');
  t.placeholder = placeholder;
  t.value = value;
  t.rows = rows;
  return t;
}

export function chips(
  options: { key: string; label: string }[],
  selected: Set<string>,
  onChange: (s: Set<string>) => void,
  opts: { single?: boolean } = {},
): HTMLElement {
  const wrap = el('div', 'ec-chips');
  for (const o of options) {
    const c = el('button', 'ec-chip', esc(o.label));
    c.type = 'button';
    if (selected.has(o.key)) c.classList.add('on');
    c.addEventListener('click', () => {
      if (opts.single) {
        selected.clear();
        selected.add(o.key);
        for (const other of wrap.children) other.classList.remove('on');
        c.classList.add('on');
      } else if (selected.has(o.key)) {
        selected.delete(o.key);
        c.classList.remove('on');
      } else {
        selected.add(o.key);
        c.classList.add('on');
      }
      onChange(selected);
    });
    wrap.appendChild(c);
  }
  return wrap;
}

// ─────────────────── 数据可信度 ───────────────────

const SOURCE_LABEL: Record<MetricSource, string> = {
  counted: '数出来的',
  timed: '真实计时',
  derived: '按公式算的',
  asr: '来自语音识别文本',
  model: 'AI 的判断',
};

/**
 * 一个带口径的数字。
 *
 * 点一下展开"这个数是怎么来的"。来自语音识别的数字额外标一个记号——
 * 用户必须知道那不是发音评分。
 */
export function metric(label: string, m: Measured): HTMLElement {
  const wrap = el('div', `ec-metric src-${m.source}`);
  const head = el('button', 'ec-metric-head');
  head.type = 'button';
  head.innerHTML = `
    <span class="ec-metric-label">${esc(label)}</span>
    <span class="ec-metric-value">${esc(String(m.value))}${m.unit ? `<i>${esc(m.unit)}</i>` : ''}</span>
    <span class="ec-metric-mark" aria-hidden="true">?</span>`;
  const body = el('div', 'ec-metric-how', `<b>${esc(SOURCE_LABEL[m.source])}</b>：${esc(m.how)}`);
  body.style.display = 'none';
  head.addEventListener('click', () => {
    body.style.display = body.style.display === 'none' ? '' : 'none';
  });
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

export function metricGrid(entries: [string, Measured][]): HTMLElement {
  const g = el('div', 'ec-metrics');
  for (const [label, m] of entries) g.appendChild(metric(label, m));
  return g;
}

/** 一条明确的说明横幅。用来讲"这个数字不代表什么" */
export function caveat(text: string): HTMLElement {
  return el('div', 'ec-caveat', esc(text));
}

/** 引擎来源标注：这一轮是本地算的还是模型给的 */
export function engineNote(text: string, kind: 'local' | 'remote' | 'warn' = 'local'): HTMLElement {
  return el('div', `ec-enginenote ${kind}`, esc(text));
}

// ─────────────────── 状态 ───────────────────

export function skeleton(n = 3): HTMLElement {
  const wrap = el('div', 'ec-skel-list');
  for (let i = 0; i < n; i++) {
    const s = el('div', 'ec-skel-card');
    s.innerHTML = `<div class="ec-skel-line w60"></div><div class="ec-skel-line"></div><div class="ec-skel-line w40"></div>`;
    wrap.appendChild(s);
  }
  return wrap;
}

/** 空状态。必须给出下一步能做什么，不能只写"暂无数据" */
export function emptyState(title: string, desc: string, action?: { label: string; go: () => void }): HTMLElement {
  const e = el('div', 'ec-empty');
  e.appendChild(el('div', 'ec-empty-title', esc(title)));
  e.appendChild(el('div', 'ec-empty-desc', esc(desc)));
  if (action) e.appendChild(button(action.label, 'primary', action.go));
  return e;
}

export function errorState(msg: string, retry?: () => void): HTMLElement {
  const e = el('div', 'ec-empty');
  e.appendChild(el('div', 'ec-empty-title', '这一步没能完成'));
  e.appendChild(el('div', 'ec-empty-desc', esc(msg)));
  if (retry) e.appendChild(button('再试一次', 'primary', retry));
  return e;
}

let toastTimer: number | null = null;
export function toast(msg: string): void {
  let t = document.querySelector('.ec-toast') as HTMLElement | null;
  if (!t) {
    t = el('div', 'ec-toast');
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => t?.classList.remove('show'), 2000);
}

export function collapsible(title: string, content: HTMLElement, open = false): HTMLElement {
  const wrap = el('div', 'ec-collapse');
  const head = el('button', 'ec-collapse-head', `<span>${esc(title)}</span><i>${open ? '−' : '+'}</i>`);
  head.type = 'button';
  const body = el('div', 'ec-collapse-body');
  body.appendChild(content);
  if (!open) body.style.display = 'none';
  head.addEventListener('click', () => {
    const shown = body.style.display !== 'none';
    body.style.display = shown ? 'none' : '';
    const i = head.querySelector('i');
    if (i) i.textContent = shown ? '+' : '−';
  });
  wrap.appendChild(head);
  wrap.appendChild(body);
  return wrap;
}

/** 进度条。用得很克制：只在"这一次训练进行到哪了"这种地方出现 */
export function progressBar(done: number, total: number, label?: string): HTMLElement {
  const wrap = el('div', 'ec-progress');
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  wrap.innerHTML = `
    <div class="ec-progress-track"><div class="ec-progress-fill" style="width:${pct}%"></div></div>
    <div class="ec-progress-text">${label ? esc(label) : `${done} / ${total}`}</div>`;
  return wrap;
}

export function levelBadge(level: string, size: 'sm' | 'lg' = 'sm'): HTMLElement {
  return el('span', `ec-level ${size} lv-${level.toLowerCase()}`, esc(level));
}

// ─────────────────── 四级提示 ───────────────────

export interface HintLadderOpts {
  keywords: string[];
  frame: string;
  half: string;
  full: string;
  intentCn: string;
  /** 每次展开一级都回调，用来记录"这句话是在第几级提示下说出来的" */
  onReveal: (level: number) => void;
}

/**
 * 四级提示（第 6 节）。
 *
 * 用户卡住时不让他退出，而是逐级给梯子。设计要点：
 *   · 一次只开一级。全给出来等于直接给答案，用户抄一遍学不到东西
 *   · 每一级都显示"还有下一级"，让用户知道退路一直在，不必焦虑
 *   · 展开到第几级会被记录下来，复盘时"自己说出来的"和"看着答案说的"
 *     必须分开算，否则进步是假的
 */
export function hintLadder(opts: HintLadderOpts): HTMLElement {
  const wrap = el('div', 'ec-hint-ladder');
  const levels = [
    { name: '关键词', render: () => `<div class="ec-hint-keys">${opts.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</div>` },
    { name: '句子结构', render: () => `<div class="ec-hint-frame">${esc(opts.frame)}</div>` },
    { name: '半句提示', render: () => `<div class="ec-hint-frame">${esc(opts.half)}</div>` },
    { name: '完整参考', render: () => `<div class="ec-hint-full">${esc(opts.full)}</div>` },
  ];

  let shown = 0;
  const body = el('div', 'ec-hint-body');
  const more = button('', 'ec-hint-more');

  const paint = () => {
    body.innerHTML = '';
    if (shown === 0) {
      body.appendChild(el('div', 'ec-hint-intent', `你想说的是：${esc(opts.intentCn)}`));
    } else {
      body.appendChild(el('div', 'ec-hint-intent', `你想说的是：${esc(opts.intentCn)}`));
      for (let i = 0; i < shown; i++) {
        const step = el('div', 'ec-hint-step');
        step.appendChild(el('div', 'ec-hint-stepname', `${i + 1} · ${levels[i].name}`));
        step.insertAdjacentHTML('beforeend', levels[i].render());
        body.appendChild(step);
      }
    }
    if (shown >= levels.length) {
      more.style.display = 'none';
    } else {
      more.style.display = '';
      more.textContent = shown === 0 ? '给我一点提示' : `还不行，再给一点（${levels[shown].name}）`;
    }
  };

  more.addEventListener('click', () => {
    shown = Math.min(levels.length, shown + 1);
    opts.onReveal(shown);
    paint();
  });

  wrap.appendChild(body);
  wrap.appendChild(more);
  paint();
  return wrap;
}

// ─────────────────── 纠错展示 ───────────────────

/**
 * 一条纠错。
 *
 * 严格按第 14 节的结构：原句 → 问题 → 修改 → 为什么。
 * 不把用户写的东西直接换成"完美英语"就完事——那样用户只会复制粘贴，
 * 下次还是一样。
 */
export function correctionCard(c: {
  kind: string;
  kindLabel: string;
  severity: number;
  original: string;
  fixed: string;
  problem: string;
  why: string;
}): HTMLElement {
  const wrap = el('div', `ec-corr sev-${c.severity} kind-${c.kind}`);
  wrap.innerHTML = `
    <div class="ec-corr-head">
      <span class="ec-corr-kind">${esc(c.kindLabel)}</span>
      <span class="ec-corr-problem">${esc(c.problem)}</span>
    </div>
    <div class="ec-corr-diff">
      <div class="ec-corr-row from"><i>你说的</i><span>${esc(c.original)}</span></div>
      <div class="ec-corr-row to"><i>更好的</i><span>${c.fixed ? esc(c.fixed) : '<em>（直接去掉）</em>'}</span></div>
    </div>`;
  const why = el('div', 'ec-corr-why', esc(c.why));
  wrap.appendChild(why);
  return wrap;
}

/** 底部固定操作条。手机上单手能按到 */
export function actionBar(...nodes: HTMLElement[]): HTMLElement {
  const bar = el('div', 'ec-actionbar');
  for (const n of nodes) bar.appendChild(n);
  return bar;
}

/** 页面骨架：一个可滚动的页 + 可选的底部操作条 */
export function page(): { root: HTMLElement; body: HTMLElement; foot: HTMLElement } {
  const root = el('div', 'ec-page');
  const body = el('div', 'ec-page-body');
  const foot = el('div', 'ec-page-foot');
  root.appendChild(body);
  root.appendChild(foot);
  return { root, body, foot };
}
