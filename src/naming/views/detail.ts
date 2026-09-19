/**
 * 名字详情页
 *
 * 结构是按「一个人真的要决定用不用这个名字时，会依次想到什么」排的：
 *   先看它是什么样 → 两个字合起来什么意思 → 有没有来历 → 念着怎么样 →
 *   写着怎么样 → 有什么坑 → 综合起来适合谁
 *
 * 综合评价刻意不给一个总分。给了分，用户就只看分了，而这些名字之间的差别
 * 根本不是一个数字能表达的。
 */

import type { NameCandidate } from '../types';
import { toneMark } from '../engine/pinyin';
import { button, collapsible, dimBar, el, esc, toast, topbar } from './ui';
import { isFavorite, toggleFavorite } from '../store';

export interface DetailActions {
  back: () => void;
  favorites: () => void;
}

const TONE_NAME = ['', '一声', '二声', '三声', '四声'];
const SHAPE_NAME: Record<string, string> = {
  L: '左右结构',
  S: '上下结构',
  D: '独体字',
  B: '半包围结构',
  W: '全包围结构',
  P: '品字结构',
};

function section(title: string, body: HTMLElement): HTMLElement {
  const s = el('div', 'nm-section');
  s.appendChild(el('h3', '', esc(title)));
  s.appendChild(body);
  return s;
}

export function renderDetail(c: NameCandidate, a: DetailActions): HTMLElement {
  const page = el('div', 'nm-page');

  const favBtn = el('button', 'nm-fav', '♡');
  const syncFav = () => {
    const on = isFavorite(c.id);
    favBtn.classList.toggle('on', on);
    favBtn.textContent = on ? '♥' : '♡';
  };
  syncFav();
  favBtn.addEventListener('click', () => {
    const added = toggleFavorite(c);
    syncFav();
    toast(added ? `已收藏「${c.full}」` : `已取消收藏「${c.full}」`);
  });
  page.appendChild(topbar('名字详情', a.back, favBtn));

  // —— 名字本体 ——
  const hero = el('div', 'nm-detail-hero');
  const nameBox = el('div', 'nm-name', esc(c.full));
  nameBox.appendChild(el('div', 'nm-py', esc(c.pinyin)));
  hero.appendChild(nameBox);
  page.appendChild(hero);

  page.appendChild(el('p', 'nm-prose', esc(c.oneLine)));

  const tags = el('div', 'nm-tags');
  for (const t of c.tags) tags.appendChild(el('span', 'nm-tag', esc(t)));
  page.appendChild(tags);

  // —— 寓意 ——
  page.appendChild(section('名字寓意', el('p', 'nm-prose', esc(c.meaning))));

  // —— 逐字 ——
  const chars = el('div', 'nm-chars');
  for (const ch of c.chars) {
    const cc = el('div', 'nm-charcard');
    cc.innerHTML = `
      <div class="g">${esc(ch.c)}</div>
      <div class="m">${esc(toneMark(ch.syl, ch.tone))} · ${ch.bh} 画 · ${esc(SHAPE_NAME[ch.shape] ?? '')}</div>
      <div class="y">${esc(ch.yi)}</div>`;
    chars.appendChild(cc);
  }
  page.appendChild(section('逐字来看', chars));

  // —— 出处 ——
  const originBody = el('div');
  if (c.origin.kind === 'classic' && c.origin.line) {
    const q = el('div', 'nm-quote');
    q.innerHTML = `
      <div class="src">${esc(c.origin.work ?? '')}${c.origin.author ? ' · ' + esc(c.origin.author) : ''}</div>
      <div class="line">${esc(c.origin.line)}</div>
      <div class="note">${esc(c.origin.note ?? '')}</div>`;
    originBody.appendChild(q);
    const p = el('p', 'nm-prose', `名字里的「${esc(c.given)}」二字都出自这一句。`);
    p.style.marginTop = '10px';
    p.style.fontSize = '13px';
    originBody.appendChild(p);
  } else {
    originBody.appendChild(el('p', 'nm-prose', esc(c.origin.note ?? '')));
  }
  page.appendChild(section('出处', originBody));

  // —— 音律 ——
  const sound = c.dims.find((d) => d.key === 'sound')!;
  const soundBody = el('div');
  const toneLine = el('p', 'nm-prose');
  toneLine.innerHTML = `${[...c.full]
    .map((ch, i) => `<strong>${esc(ch)}</strong>${TONE_NAME[c.tones[i]] ?? ''}`)
    .join(' · ')}`;
  toneLine.style.fontSize = '13.5px';
  soundBody.appendChild(toneLine);
  soundBody.appendChild(el('ul', 'nm-notes', sound.notes.map((n) => `<li>${esc(n)}</li>`).join('')));
  page.appendChild(section('音律', soundBody));

  // —— 字形 ——
  const glyph = c.dims.find((d) => d.key === 'glyph')!;
  page.appendChild(
    section('字形', el('ul', 'nm-notes', glyph.notes.map((n) => `<li>${esc(n)}</li>`).join(''))),
  );

  // —— 六维 ——
  const dimsBody = el('div');
  for (const d of c.dims) dimsBody.appendChild(dimBar(d.label, d.level, d.score));
  const dimNote = el('div', 'nm-disclaimer');
  dimNote.style.marginTop = '12px';
  dimNote.textContent =
    '这六项是产品内部用来筛选和排序的工具，不是对名字的客观评分。名字好不好，最终由你来判断——这里的作用是把判断需要的依据摆出来。';
  dimsBody.appendChild(dimNote);
  page.appendChild(section('六个维度', dimsBody));

  // —— 风险 ——
  const realRisks = c.risks.filter((r) => r.kind !== 'common');
  const commonRisk = c.risks.find((r) => r.kind === 'common');
  const riskBody = el('div', 'nm-risk');
  const items: string[] = [];
  if (commonRisk) items.push(commonRisk.text);
  for (const r of realRisks) items.push(r.text);
  if (items.length) riskBody.innerHTML = `<ul>${items.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>`;
  else riskBody.textContent = '没有发现谐音、生僻、书写方面的明显问题。';
  page.appendChild(section('风险提示', riskBody));

  // —— 五行 ——
  if (c.wuxing) {
    const wx = el('div');
    wx.appendChild(el('p', 'nm-prose', esc(c.wuxing.summary)));
    const d = el('div', 'nm-disclaimer');
    d.style.marginTop = '12px';
    d.textContent =
      '五行属性按部首字义派标注，不同流派对同一个字的归属经常有分歧。以上属于传统文化体系中的命名参考方法，不是现代科学验证过的因果预测，不构成对健康、财富、运势的任何承诺。';
    wx.appendChild(d);
    page.appendChild(section('传统五行参考', wx));
  }

  // —— 综合评价 ——
  const overall = el('div');
  overall.appendChild(el('div', 'nm-label', '推荐理由'));
  overall.appendChild(
    el('ul', 'nm-list-pro', c.pros.map((p) => `<li>${esc(p)}</li>`).join('')),
  );
  const conTitle = el('div', 'nm-label', '可能的不足');
  conTitle.style.marginTop = '16px';
  overall.appendChild(conTitle);
  overall.appendChild(el('ul', 'nm-list-con', c.cons.map((p) => `<li>${esc(p)}</li>`).join('')));
  const fit = el('p', 'nm-prose', esc(c.fitFor));
  fit.style.marginTop = '16px';
  overall.appendChild(fit);
  page.appendChild(section('综合评价', overall));

  // —— 逐字细节收起来，想看再看 ——
  const detailNotes = el('div');
  for (const d of c.dims) {
    if (d.key === 'sound' || d.key === 'glyph') continue;
    detailNotes.innerHTML += `<div style="margin:9px 0"><b style="color:var(--ink)">${esc(d.label)} · ${esc(
      d.level,
    )}</b><ul class="nm-notes">${d.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
  }
  const more = el('div');
  more.style.marginTop = '22px';
  more.appendChild(collapsible('每一项的具体依据', detailNotes));
  page.appendChild(more);

  const bar = el('div', 'nm-actionbar');
  bar.appendChild(button('收藏起来慢慢比', 'primary', () => {
    if (!isFavorite(c.id)) {
      toggleFavorite(c);
      syncFav();
    }
    a.favorites();
  }));
  page.appendChild(bar);

  return page;
}
