/** 首页。只有一个主按钮「开始练歌」，其余是当天最该看的三块信息。 */

import type { Ctx } from '../index';
import { midiToName } from '../dsp/notes';
import { makeDailyPlan, todaySummary } from '../data/plan';
import { buildProfile } from '../data/profile';
import { recentSessions } from '../data/store';
import { btn, card, el, esc, fmtDate, empty, listRow, sectionTitle } from './components';

export function renderHome(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(wrap);

  const profile = buildProfile();
  const recent = recentSessions(3);

  const head = el('div');
  head.appendChild(el('div', 'v-h1', 'AI 唱歌教练'));
  head.appendChild(
    el(
      'div',
      'v-sub',
      '唱一遍，告诉你哪里不好、为什么不好、接下来练什么。' +
        '所有分析都在这台设备上完成，录音默认不保存。',
    ),
  );
  wrap.appendChild(head);

  // ---- 主按钮 ----
  const hero = el('button', 'v-hero');
  hero.type = 'button';
  hero.innerHTML =
    '<div class="t">开始练歌</div>' +
    '<div class="d">选一首歌跟着唱，唱完就能看到你的音高曲线和问题在哪</div>';
  hero.addEventListener('click', () => ctx.go({ p: 'songs' }));
  wrap.appendChild(hero);

  // 麦克风被拒绝时，首页就要说清楚，别等用户点进去才发现用不了
  if (ctx.micState() === 'denied' || ctx.micState() === 'unsupported' || ctx.micState() === 'error') {
    const hint = ctx.micHint();
    const n = el('div', 'v-note bad');
    n.innerHTML = `<b>${esc(hint?.text ?? '麦克风不可用')}</b><br>${esc(hint?.fix ?? '')}`;
    wrap.appendChild(n);
  }

  // ---- 今日训练 ----
  const plan = makeDailyPlan();
  wrap.appendChild(sectionTitle('今日训练'));
  const planCard = card('tap');
  const mins = plan.totalMinutes;
  planCard.innerHTML =
    `<h3>今天建议练 ${mins} 分钟 <span class="v-tag accent">${plan.items.length} 项</span></h3>` +
    `<p>${esc(plan.focus)}</p>` +
    `<p style="color:var(--v-dim);font-size:12px">${esc(plan.basis)}</p>`;
  const list = el('div');
  list.style.cssText = 'margin-top:10px;display:flex;flex-wrap:wrap;gap:6px';
  for (const it of plan.items) {
    list.appendChild(el('span', 'v-tag', `${esc(it.name)} ${it.minutes}′`));
  }
  planCard.appendChild(list);
  planCard.addEventListener('click', () => ctx.go({ p: 'training' }));
  wrap.appendChild(planCard);

  if (profile.todayMinutes > 0 || recent.length) {
    const sum = el('div', 'v-note', esc(todaySummary()));
    wrap.appendChild(sum);
  }

  // ---- 最近歌曲 ----
  wrap.appendChild(sectionTitle('最近唱过'));
  const recentCard = card();
  if (!recent.length) {
    recentCard.appendChild(empty('还没有记录。点上面的「开始练歌」唱第一首。'));
  } else {
    for (const s of recent) {
      recentCard.appendChild(
        listRow(
          esc(s.title),
          `${fmtDate(s.at)} · ${s.topFindingTitle ? esc(s.topFindingTitle) : '无明显问题'}`,
          s.overall === null ? '—' : `<span class="big">${s.overall}</span>`,
          () => ctx.go({ p: 'analysis', sessionId: s.id }),
        ),
      );
    }
  }
  wrap.appendChild(recentCard);

  // ---- 我的进步 ----
  wrap.appendChild(sectionTitle('我的进步'));
  const progCard = card('tap');
  const acc = profile.abilities.find((a) => a.key === 'accuracy');
  const hasData = profile.totalSessions >= 2;
  progCard.innerHTML = `<h3>进步曲线</h3>`;
  if (hasData) {
    const bits: string[] = [];
    for (const a of profile.abilities) {
      if (a.value === null) continue;
      const d = a.delta;
      bits.push(
        `${esc(a.label)} <b style="color:var(--v-text)">${a.value}</b>${
          d !== null && Math.abs(d) >= 2
            ? `<span style="color:${d > 0 ? 'var(--v-green)' : 'var(--v-red)'}">${d > 0 ? ' ↑' : ' ↓'}${Math.abs(d)}</span>`
            : ''
        }`,
      );
    }
    progCard.appendChild(
      el('p', '', `唱过 ${profile.totalSessions} 次。${bits.join(' · ')}`),
    );
    if (profile.range) {
      progCard.appendChild(
        el(
          'p',
          '',
          `音域 ${midiToName(profile.range.lo)}~${midiToName(profile.range.hi)}` +
            (profile.range.firstSpan !== null && profile.range.span - profile.range.firstSpan >= 2
              ? `，比最早宽了 ${Math.round(profile.range.span - profile.range.firstSpan)} 个半音`
              : ''),
        ),
      );
    }
  } else {
    progCard.appendChild(
      el(
        'p',
        '',
        acc?.value === null
          ? '至少唱 2 次才能看出趋势。同一首歌多唱几次，对比最准。'
          : '再唱一次就能开始看趋势了。',
      ),
    );
  }
  progCard.addEventListener('click', () => ctx.go({ p: 'progress' }));
  wrap.appendChild(progCard);

  if (profile.streak > 1) {
    wrap.appendChild(el('div', 'v-note', `已经连续练了 ${profile.streak} 天。`));
  }

  const row = el('div', 'v-btn-row');
  row.style.marginTop = '14px';
  row.appendChild(btn('⚙️ 设置', 'v-btn ghost', () => ctx.go({ p: 'settings' })));
  row.appendChild(btn('← 返回合集', 'v-btn ghost', ctx.exit));
  wrap.appendChild(row);

  return () => {};
}
