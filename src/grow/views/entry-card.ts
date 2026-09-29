import { formatDay } from '../dates';
import { tagLabel, type Entry } from '../types';
import { el } from './ui';

/** 一条记录的卡片。整张卡片可点，点开是修改 */
export function entryCard(e: Entry, onOpen: (e: Entry) => void, opts: { showDate?: boolean } = {}): HTMLElement {
  const card = el('button', 'g-entry');
  card.type = 'button';
  card.dataset.id = e.id;
  if (opts.showDate) card.appendChild(el('div', 'g-entry-date', formatDay(e.date)));
  card.appendChild(el('div', 'g-entry-text', e.text));
  if (e.first || e.tags.length) {
    const meta = el('div', 'g-entry-meta');
    if (e.first) meta.appendChild(el('span', 'g-mini g-mini-first', '⭐ 第一次'));
    for (const t of e.tags) meta.appendChild(el('span', 'g-mini', tagLabel(t)));
    card.appendChild(meta);
  }
  card.addEventListener('click', () => onOpen(e));
  return card;
}
