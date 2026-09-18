/**
 * 术语表弹层：牌桌、训练、复盘三个地方都能一键打开。
 * 可以直接跳到某个词（教练文案里点到的），也可以按分组浏览。
 */

import { TERMS, termsByGroup, type Term } from '../teach/glossary';
import { clear, el } from './common';

export function openGlossary(host: HTMLElement, focusId?: string): () => void {
  const overlay = el('div.mc-overlay');
  const head = el('div.mc-row', { style: 'margin-bottom:10px' });
  head.append(
    el('div', {}, el('b', { style: 'font-size:17px', text: '📖 麻将术语' }), el('div.mc-muted', { text: '教练说的每个词，这里都有解释' })),
    el('div.mc-spacer'),
    el('button.mc-btn.sm.ghost', { text: '关闭', onclick: () => overlay.remove() }),
  );
  overlay.appendChild(head);

  // 搜索
  const input = el('input', { type: 'text', placeholder: '搜一个词，比如「向听」' }) as HTMLInputElement;
  input.setAttribute(
    'style',
    'width:100%;background:var(--mc-surface2);border:1px solid var(--mc-line);border-radius:10px;padding:9px 12px;color:var(--mc-text);font-size:14px;font-family:inherit;margin-bottom:12px',
  );
  overlay.appendChild(input);

  const list = el('div');
  overlay.appendChild(list);

  const card = (t: Term) => {
    const c = el('div.mc-card', { id: `mc-term-${t.id}` });
    c.append(
      el('h3', { text: t.name + (t.alias?.length ? `　${t.alias.map((a) => `「${a}」`).join('')}` : '') }),
      el('p', { style: 'color:var(--mc-text)', text: t.def }),
      el('p', { text: `例：${t.example}` }),
      el('p', { class: 'mc-muted', text: `为什么要懂：${t.why}` }),
    );
    return c;
  };

  const render = (q: string) => {
    clear(list);
    const kw = q.trim();
    if (kw) {
      const hits = TERMS.filter((t) => [t.name, ...(t.alias ?? []), t.def].some((s) => s.includes(kw)));
      if (!hits.length) list.appendChild(el('div.mc-empty', { text: '没有这个词。试试「搭子」「进张」「查大叔」。' }));
      for (const t of hits) list.appendChild(card(t));
      return;
    }
    for (const g of termsByGroup()) {
      list.appendChild(el('div.mc-section', { text: g.group }));
      for (const t of g.terms) list.appendChild(card(t));
    }
  };
  input.addEventListener('input', () => render(input.value));
  render('');
  host.appendChild(overlay);

  if (focusId) {
    const target = overlay.querySelector(`#mc-term-${focusId}`) as HTMLElement | null;
    if (target) {
      target.style.borderColor = 'var(--mc-accent)';
      setTimeout(() => target.scrollIntoView({ block: 'start', behavior: 'smooth' }), 50);
    }
  }
  return () => overlay.remove();
}
