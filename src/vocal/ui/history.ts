/** 历史记录：所有演唱记录，以及这台设备上保存了哪些录音。 */

import type { Ctx } from '../index';
import { topbar } from '../index';
import { deleteSession, getSessions, KEEP_AUDIO_LABEL, getSettings, listAudioIds, storageUsage } from '../data/store';
import { btn, card, el, esc, empty, fmtDate, fmtDuration, sectionTitle } from './components';

export function renderHistory(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(topbar('历史记录', () => ctx.back()));
  box.appendChild(wrap);
  wrap.style.padding = '16px';

  const sessions = [...getSessions()].sort((a, b) => b.at - a.at);
  const settings = getSettings();

  const info = el('div', 'v-note');
  info.innerHTML =
    `当前的录音保留策略：<b>${esc(KEEP_AUDIO_LABEL[settings.keepAudio])}</b>。` +
    '指标和分析结果一直保存在本机，录音则按这条策略处理。' +
    '<br>全部数据都只在这台设备上，没有服务器也没有账号。';
  wrap.appendChild(info);

  const usageBox = el('div', 'v-note');
  usageBox.textContent = '正在统计本地占用…';
  wrap.appendChild(usageBox);
  void storageUsage().then((u) => {
    usageBox.textContent =
      `本地占用：指标与报告约 ${u.metricsKb} KB` +
      (u.clips ? `，录音 ${u.clips} 段约 ${u.audioMb} MB` : '，没有保存任何录音');
  });

  if (!sessions.length) {
    wrap.appendChild(empty('还没有记录。'));
    wrap.appendChild(btn('去唱一首', 'v-btn primary big', () => ctx.go({ p: 'songs' })));
    return () => {};
  }

  // 按天分组，看起来像个日记
  const byDay = new Map<string, typeof sessions>();
  for (const s of sessions) {
    const k = new Date(s.at).toLocaleDateString('sv');
    const arr = byDay.get(k) ?? [];
    arr.push(s);
    byDay.set(k, arr);
  }

  for (const [day, items] of byDay) {
    wrap.appendChild(sectionTitle(`${day}　共 ${items.length} 次`));
    const c = card();
    for (const s of items) {
      const row = el('div', 'v-row');
      const main = el('div', 'main');
      main.appendChild(
        el(
          'div',
          't',
          `${esc(s.title)}${s.transpose ? `　<span class="v-tag">${s.transpose > 0 ? '+' : ''}${s.transpose} 调</span>` : ''}${
            s.hasAudio ? '　<span class="v-tag accent">有录音</span>' : ''
          }`,
        ),
      );
      main.appendChild(
        el(
          'div',
          'd',
          `${fmtDate(s.at)} · ${fmtDuration(s.durationSec)}${s.topFindingTitle ? ` · ${esc(s.topFindingTitle)}` : ''}`,
        ),
      );
      row.appendChild(main);
      const r = el('div', 'r');
      r.innerHTML = s.overall === null ? '—' : `<span class="big">${s.overall}</span>`;
      row.appendChild(r);
      row.addEventListener('click', () => ctx.go({ p: 'analysis', sessionId: s.id }));
      c.appendChild(row);
    }
    wrap.appendChild(c);
  }

  // 批量删除录音
  const audioBox = el('div');
  wrap.appendChild(audioBox);
  void listAudioIds().then((clips) => {
    if (!clips.length) return;
    audioBox.appendChild(sectionTitle('本地录音'));
    const c = card();
    c.appendChild(
      el('p', '', `这台设备上存了 ${clips.length} 段录音。不需要了随时可以全部删掉。`),
    );
    c.appendChild(
      btn('🗑 删除全部录音（保留指标记录）', 'v-btn danger', async () => {
        const { deleteAudio, setSessionAudioFlag } = await import('../data/store');
        for (const cl of clips) {
          await deleteAudio(cl.id);
          setSessionAudioFlag(cl.id, false);
        }
        ctx.refresh();
      }),
    );
    audioBox.appendChild(c);
  });

  const danger = card();
  danger.appendChild(sectionTitle('清理'));
  danger.appendChild(
    btn('🗑 删除最早的 10 条记录', 'v-btn danger', async () => {
      const oldest = [...sessions].sort((a, b) => a.at - b.at).slice(0, 10);
      for (const s of oldest) await deleteSession(s.id);
      ctx.refresh();
    }),
  );
  wrap.appendChild(danger);

  return () => {};
}
