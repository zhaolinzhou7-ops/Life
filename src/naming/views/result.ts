/**
 * 结果页
 *
 * 展示 8~12 个候选，不是 100 个。
 *
 * 顶部会把「我理解到的需求」回显给用户——这是产品最该做而多数取名工具没做的
 * 一步：让用户在看名字之前，先确认引擎有没有听懂他。听错了，改一下比翻一百个
 * 名字快得多。
 */

import type { NameCandidate, NamingResult } from '../types';
import { button, el, esc, emptyState, topbar } from './ui';
import { isFavorite, toggleFavorite } from '../store';
import { collapsible, toast } from './ui';

export interface ResultActions {
  back: () => void;
  detail: (c: NameCandidate) => void;
  regenerate: () => void;
  adjust: () => void;
  favorites: () => void;
}

const COMMON_TEXT = { low: '常见度低', mid: '常见度中', high: '常见度高' };

export function nameCard(c: NameCandidate, onOpen: () => void): HTMLElement {
  const card = el('div', 'nm-card');

  const head = el('div', 'nm-card-head');
  const nameBox = el('div', 'nm-name', esc(c.full));
  nameBox.appendChild(el('div', 'nm-py', esc(c.pinyin)));
  head.appendChild(nameBox);

  const fav = el('button', 'nm-fav', '♡');
  const syncFav = () => {
    const on = isFavorite(c.id);
    fav.classList.toggle('on', on);
    fav.textContent = on ? '♥' : '♡';
    fav.setAttribute('aria-label', on ? '取消收藏' : '收藏');
  };
  syncFav();
  fav.addEventListener('click', (e) => {
    e.stopPropagation();
    const added = toggleFavorite(c);
    syncFav();
    toast(added ? `已收藏「${c.full}」` : `已取消收藏「${c.full}」`);
  });
  head.appendChild(fav);
  card.appendChild(head);

  card.appendChild(el('div', 'nm-oneline', esc(c.oneLine)));

  const tags = el('div', 'nm-tags');
  for (const t of c.tags.slice(0, 3)) tags.appendChild(el('span', 'nm-tag', esc(t)));
  if (c.origin.kind === 'classic' && c.origin.work) {
    tags.appendChild(el('span', 'nm-tag src', esc(c.origin.work.replace(/[《》]/g, ''))));
  }
  const highRisk = c.risks.find((r) => r.level === 'high' && r.kind !== 'common');
  if (highRisk) tags.appendChild(el('span', 'nm-tag risk', '有风险提示'));
  card.appendChild(tags);

  const foot = el('div', 'nm-card-foot');
  foot.appendChild(el('span', '', esc(COMMON_TEXT[c.commonness])));
  foot.appendChild(el('span', 'go', '查看详情 ›'));
  card.appendChild(foot);

  card.addEventListener('click', onOpen);
  return card;
}

export function renderResult(res: NamingResult, a: ResultActions): HTMLElement {
  const page = el('div', 'nm-page');
  const favBtn = button('收藏', 'small', a.favorites);
  page.appendChild(topbar(`${res.candidates.length} 个候选`, a.back, favBtn));

  // —— 我理解到的需求 ——
  const notice = el('div', 'nm-notice');
  notice.innerHTML = `<b>我理解到的需求</b><br>${esc(res.profile.core)}`;
  if (res.engine === 'remote') {
    notice.innerHTML += '<br><span style="color:var(--ink-3)">本轮候选由远端模型提供，筛选和分析仍由本地引擎完成。</span>';
  }
  if (res.fallbackNote) {
    notice.innerHTML += `<br><span style="color:var(--warn)">${esc(res.fallbackNote)}</span>`;
  }
  if (res.profile.unknowns.length) {
    notice.innerHTML += `<ul>${res.profile.unknowns.map((u) => `<li>${esc(u)}</li>`).join('')}</ul>`;
  }
  const adjust = button('需求不对？去调整', 'ghost small', a.adjust);
  adjust.style.padding = '6px 0 0';
  notice.appendChild(adjust);
  page.appendChild(notice);

  if (!res.candidates.length) {
    page.appendChild(
      emptyState(
        '这一轮没有筛出合适的名字',
        '限制条件叠在一起可能把路堵死了。试着放宽一项——比如去掉一个禁用字，或者把字数改成「都可以」。',
        { label: '去调整需求', go: a.adjust },
      ),
    );
    return page;
  }

  const cards = el('div', 'nm-cards');
  for (const c of res.candidates) cards.appendChild(nameCard(c, () => a.detail(c)));
  page.appendChild(cards);

  // —— 生成过程透明化 ——
  const funnel = el('div');
  funnel.innerHTML = res.funnel
    .map(
      (f) =>
        `<div style="margin:7px 0"><b style="color:var(--ink)">${esc(f.stage)}</b> · 留下 ${f.kept}${
          f.dropped ? `，淘汰 ${f.dropped}` : ''
        }<br><span style="color:var(--ink-3)">${esc(f.why)}</span></div>`,
    )
    .join('');
  const wrap = el('div');
  wrap.style.marginTop = '18px';
  wrap.appendChild(collapsible(`这 ${res.candidates.length} 个是怎么筛出来的`, funnel));
  page.appendChild(wrap);

  const bar = el('div', 'nm-actionbar');
  bar.appendChild(button('换一批', '', a.regenerate));
  bar.appendChild(button('调整需求', '', a.adjust));
  page.appendChild(bar);

  return page;
}
