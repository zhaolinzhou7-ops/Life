/**
 * 对比页
 *
 * 明确不做的事：**不告诉用户「推荐选 A」**。
 *
 * 到了要对比的阶段，用户面对的已经是几个都不错的名字，差别在于取舍——是更
 * 看重好念，还是更看重不重名。这种取舍只有他自己能做。产品能做的是把差异
 * 摆清楚，让他看见自己在权衡什么。
 */

import type { FavoriteItem } from '../types';
import { el, emptyState, esc, topbar } from './ui';
import { getFavorites } from '../store';

export interface CompareActions {
  back: () => void;
  detail: (f: FavoriteItem) => void;
}

const LEVEL_CLASS: Record<string, string> = { 优: 'lv-a', 良: 'lv-b', 一般: 'lv-c', 需注意: 'lv-d' };
const COMMON_TEXT = { low: '低', mid: '中', high: '高' };

/**
 * 取这一维里最值得摆出来的一条。
 *
 * 对比的时候，缺点比优点更有决策价值——几个名字都是「优」的时候，真正
 * 让人做出选择的是那一条「但是」。所以有 concern 就先摆 concern。
 */
function keyNote(d: { highlight?: string; concern?: string; notes: string[] }): string {
  const n = d.concern ?? d.highlight ?? d.notes.find((x) => !x.startsWith('「')) ?? d.notes[0] ?? '';
  return n.length > 40 ? n.slice(0, 38) + '…' : n;
}

export function renderCompare(ids: string[], a: CompareActions): HTMLElement {
  const page = el('div', 'nm-page');
  page.appendChild(topbar('并排对比', a.back));

  const all = getFavorites();
  const items = ids.map((id) => all.find((f) => f.id === id)).filter((f): f is FavoriteItem => !!f);

  if (items.length < 2) {
    page.appendChild(
      emptyState('没有足够的名字可以对比', '回收藏页勾选 2~4 个名字再来。', {
        label: '回收藏',
        go: a.back,
      }),
    );
    return page;
  }

  page.appendChild(
    el(
      'div',
      'nm-stepnote',
      '这里不会告诉你该选哪个。到这一步差别已经是取舍了——更看重好念，还是更看重不重名，只有你自己能定。',
    ),
  );

  const rows: { label: string; render: (f: FavoriteItem) => string }[] = [
    {
      label: '读音',
      render: (f) => `<span style="color:var(--ink-3)">${esc(f.name.pinyin)}</span>`,
    },
    ...(['sound', 'meaning', 'glyph', 'style', 'usability', 'unique'] as const).map((key) => ({
      label: { sound: '音律', meaning: '字义', glyph: '字形', style: '风格', usability: '易用性', unique: '独特性' }[key],
      render: (f: FavoriteItem) => {
        const d = f.name.dims.find((x) => x.key === key)!;
        return `<span class="lvl ${LEVEL_CLASS[d.level]}">${esc(d.level)}</span><br><span style="color:var(--ink-3);font-size:12px">${esc(
          keyNote(d),
        )}</span>`;
      },
    })),
    {
      label: '常见度',
      render: (f) => `${COMMON_TEXT[f.name.commonness]}`,
    },
    {
      label: '出处',
      render: (f) =>
        f.name.origin.kind === 'classic' && f.name.origin.work
          ? esc(f.name.origin.work)
          : '<span style="color:var(--ink-3)">现代组合，无古典出处</span>',
    },
    {
      label: '风险',
      render: (f) => {
        const rs = f.name.risks.filter((r) => r.kind !== 'common');
        if (!rs.length) return '<span style="color:var(--ink-3)">没有发现明显问题</span>';
        return rs.map((r) => esc(r.text.length > 34 ? r.text.slice(0, 32) + '…' : r.text)).join('<br>');
      },
    },
    {
      label: '备注',
      render: (f) => (f.note ? esc(f.note) : '<span style="color:var(--ink-3)">—</span>'),
    },
  ];

  const scroll = el('div', 'nm-cmp-scroll');
  const table = el('table', 'nm-cmp');

  const thead = el('thead');
  const hr = el('tr');
  hr.appendChild(el('th', 'rowhead', '维度'));
  for (const f of items) {
    const th = el('th');
    th.innerHTML = `<div class="cname">${esc(f.name.full)}</div>`;
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => a.detail(f));
    hr.appendChild(th);
  }
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = el('tbody');
  for (const row of rows) {
    const tr = el('tr');
    tr.appendChild(el('th', 'rowhead', esc(row.label)));
    for (const f of items) {
      const td = el('td');
      td.innerHTML = row.render(f);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  scroll.appendChild(table);
  page.appendChild(scroll);

  // 差异归纳：只指出「它们在哪里不一样」，不给结论
  const diff = el('div', 'nm-notice');
  const lines: string[] = [];
  for (const key of ['sound', 'usability', 'unique'] as const) {
    const label = { sound: '好不好念', usability: '日常好不好用', unique: '会不会撞名' }[key];
    const sorted = items
      .slice()
      .sort((x, y) => y.name.dims.find((d) => d.key === key)!.score - x.name.dims.find((d) => d.key === key)!.score);
    const top = sorted[0];
    const bottom = sorted[sorted.length - 1];
    const gap =
      top.name.dims.find((d) => d.key === key)!.score - bottom.name.dims.find((d) => d.key === key)!.score;
    if (gap >= 10) {
      lines.push(`论${label}，「${top.name.full}」比「${bottom.name.full}」更占优。`);
    }
  }
  if (lines.length) {
    diff.innerHTML = `<b>它们主要差在哪</b><ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
  } else {
    diff.innerHTML =
      '<b>它们主要差在哪</b><br>这几个名字在各维度上咬得很紧，没有拉开明显差距。到这一步可以不看分析了——把它们连着姓各念十遍，哪个先顺口就是哪个。';
  }
  page.appendChild(diff);

  return page;
}
