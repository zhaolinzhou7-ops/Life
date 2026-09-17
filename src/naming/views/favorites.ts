/**
 * 收藏页
 *
 * 取名是一个要反复回来看的决定：今天觉得好的，过两天再念一遍可能就变了。
 * 所以收藏页要能记备注——「妈妈喜欢这个」「和小名不搭」这类信息，比任何
 * 评分都更能帮用户做最后的决定。
 */

import type { FavoriteItem } from '../types';
import { button, el, emptyState, esc, toast, topbar } from './ui';
import { getCompareIds, getFavorites, removeFavorite, setCompareIds, setNote } from '../store';

export interface FavActions {
  back: () => void;
  detail: (f: FavoriteItem) => void;
  compare: (ids: string[]) => void;
  start: () => void;
}

export function renderFavorites(a: FavActions): HTMLElement {
  const page = el('div', 'nm-page');
  page.appendChild(topbar('我的收藏', a.back));

  const favs = getFavorites();
  if (!favs.length) {
    page.appendChild(
      emptyState(
        '还没有收藏的名字',
        '在结果页点名字右上角的心形就能存下来。收藏够两个之后，可以在这里做并排对比。',
        { label: '去取名', go: a.start },
      ),
    );
    return page;
  }

  const picked = new Set(getCompareIds().filter((id) => favs.some((f) => f.id === id)));

  page.appendChild(
    el(
      'div',
      'nm-stepnote',
      `共 ${favs.length} 个。勾选 2~4 个可以并排对比；备注会一直存在这台设备上。`,
    ),
  );

  const list = el('div', 'nm-cards');
  const cmpBtn = button('对比选中的名字', 'primary', () => {
    const ids = [...picked];
    if (ids.length < 2) {
      toast('至少勾选两个才能对比');
      return;
    }
    setCompareIds(ids);
    a.compare(ids);
  });

  const syncBtn = () => {
    cmpBtn.textContent = picked.size >= 2 ? `对比这 ${picked.size} 个` : '勾选 2~4 个来对比';
    cmpBtn.disabled = picked.size < 2;
  };

  for (const f of favs) {
    const item = el('div', 'nm-fav-item');
    if (picked.has(f.id)) item.classList.add('picked');

    const head = el('div', 'nm-fav-head');
    const box = el('button', 'nm-pickbox', '✓');
    if (picked.has(f.id)) box.classList.add('on');
    box.setAttribute('aria-label', '选中以对比');
    box.addEventListener('click', (e) => {
      e.stopPropagation();
      if (picked.has(f.id)) {
        picked.delete(f.id);
      } else {
        if (picked.size >= 4) {
          toast('一次最多对比 4 个');
          return;
        }
        picked.add(f.id);
      }
      box.classList.toggle('on', picked.has(f.id));
      item.classList.toggle('picked', picked.has(f.id));
      setCompareIds([...picked]);
      syncBtn();
    });
    head.appendChild(box);

    const nameBox = el('div', 'nm-name', esc(f.name.full));
    nameBox.appendChild(el('div', 'nm-py', esc(f.name.pinyin)));
    nameBox.style.cursor = 'pointer';
    nameBox.addEventListener('click', () => a.detail(f));
    head.appendChild(nameBox);

    const del = el('button', 'nm-btn small ghost', '删除');
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      removeFavorite(f.id);
      picked.delete(f.id);
      item.remove();
      syncBtn();
      toast(`已删除「${f.name.full}」`);
      if (!getFavorites().length) {
        list.replaceWith(
          emptyState('收藏已经清空', '回结果页重新挑几个吧。', { label: '去取名', go: a.start }),
        );
      }
    });
    head.appendChild(del);
    item.appendChild(head);

    item.appendChild(el('div', 'nm-oneline', esc(f.name.oneLine)));

    const note = el('input', 'nm-note-input');
    note.type = 'text';
    note.placeholder = '写点备注：谁喜欢、有什么顾虑…';
    note.value = f.note;
    note.addEventListener('change', () => {
      setNote(f.id, note.value);
      toast('备注已保存');
    });
    item.appendChild(note);

    list.appendChild(item);
  }
  page.appendChild(list);

  syncBtn();
  const bar = el('div', 'nm-actionbar');
  bar.appendChild(cmpBtn);
  page.appendChild(bar);
  return page;
}
