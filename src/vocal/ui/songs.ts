/**
 * 歌曲页。
 *
 * 每张卡片上最要紧的一条信息是「这首歌你现在够不够得着」——
 * 练高音的人第一眼想知道的就是这个。所以把歌曲最高音和你的音域
 * 直接比出来标在卡上，而不是让用户自己去猜。
 */

import type { Ctx } from '../index';

import { midiToName } from '../dsp/notes';
import { SONGS, songNoteCount, songRange, type Song } from '../songs/library';
import { buildProfile } from '../data/profile';
import { sessionsOfSong } from '../data/store';
import { btn, card, el, esc, empty, sectionTitle, textInput } from './components';

export function renderSongs(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(wrap);

  wrap.appendChild(el('div', 'v-h1', '歌曲'));
  wrap.appendChild(
    el(
      'div',
      'v-sub',
      '曲库只收公有领域的旋律，由我们按简谱重新编配，伴奏实时合成。' +
        '想练流行歌，用下面的「唱我自己的」——只分析你的嗓音，不需要原曲。',
    ),
  );

  // ---- 自由演唱入口 ----
  const free = card('tap');
  free.innerHTML =
    '<h3>🎙️ 唱我自己的 <span class="v-tag">自由演唱</span></h3>' +
    '<p>不跟伴奏，直接录一段你想唱的。没有目标旋律，所以不评音准和节奏，' +
    '但音域、长音稳定度、声音特征和录音质量照常分析。</p>';
  free.addEventListener('click', () => ctx.go({ p: 'practice', songId: '__free__' }));
  wrap.appendChild(free);

  // ---- 搜索 ----
  const search = textInput('', '搜歌名…');
  search.style.marginBottom = '12px';
  wrap.appendChild(search);

  const listBox = el('div');
  wrap.appendChild(listBox);

  const profile = buildProfile();
  const mine = profile.range;

  function renderList(keyword: string) {
    listBox.innerHTML = '';
    const kw = keyword.trim().toLowerCase();
    const levels: Song['level'][] = ['入门', '简单', '进阶'];
    let shown = 0;

    for (const level of levels) {
      const songs = SONGS.filter(
        (s) => s.level === level && (!kw || s.name.toLowerCase().includes(kw)),
      );
      if (!songs.length) continue;
      listBox.appendChild(sectionTitle(level));
      for (const song of songs) {
        shown++;
        listBox.appendChild(songCard(song));
      }
    }
    if (!shown) listBox.appendChild(empty('没有找到这首歌。曲库只有公有领域旋律，换个关键词试试。'));
  }

  function songCard(song: Song): HTMLElement {
    const sr = songRange(song);
    const history = sessionsOfSong(song.id);
    const best = history.reduce<number | null>(
      (a, s) => (s.overall !== null && (a === null || s.overall > a) ? s.overall : a),
      null,
    );

    // 够不够得着：拿歌的最高音和你的舒适上限比
    let reach = '';
    if (mine) {
      const over = sr.hi - mine.hi;
      if (over > 2) reach = `<span class="v-tag red">比你最高音还高 ${over} 个半音</span>`;
      else if (over > -2) reach = '<span class="v-tag yellow">刚好到你的顶</span>';
      else reach = '<span class="v-tag green">够得着</span>';
    }

    const c = card('tap');
    c.innerHTML =
      `<h3>${esc(song.emoji)} ${esc(song.name)}${
        best !== null ? ` <span class="v-tag accent">最佳 ${best}</span>` : ''
      }</h3>` +
      `<p>${songNoteCount(song)} 个音 · ${song.bpm} BPM · 最高 ${midiToName(sr.hi)} · ` +
      `${song.sections.map((s) => esc(s.name ?? s.kind)).join(' → ')}</p>` +
      `<p style="font-size:11.5px;color:var(--v-dim)">${esc(song.source)}</p>` +
      (reach || history.length
        ? `<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${reach}${
            history.length ? `<span class="v-tag">唱过 ${history.length} 次</span>` : ''
          }</div>`
        : '');
    c.addEventListener('click', () => ctx.go({ p: 'practice', songId: song.id }));
    return c;
  }

  search.addEventListener('input', () => renderList(search.value));
  renderList('');

  if (!mine) {
    wrap.appendChild(
      el(
        'div',
        'v-note',
        '还没测过你的音域，所以暂时标不出哪首够得着。唱完第一首之后这里就会有了。',
      ),
    );
  }

  const back = btn('← 返回首页', 'v-btn ghost', () => ctx.go({ p: 'home' }));
  back.style.marginTop = '14px';
  wrap.appendChild(back);
  return () => {};
}
