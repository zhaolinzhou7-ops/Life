/**
 * 进步曲线。
 *
 * 用户真正想知道的是「我到底有没有变好」，所以这一页的主角不是折线，
 * 而是「第 1 次 → 第 5 次 → 第 10 次」那张对比表。折线是佐证。
 * 同时要诚实：样本太少、或者变化在正常波动范围内，就直说看不出趋势。
 */

import type { Ctx } from '../index';
import { topbar } from '../index';
import { milestones, progressSeries } from '../data/profile';
import { getSessions } from '../data/store';
import { SONG_BY_ID } from '../songs/library';
import { btn, card, el, esc, empty, fmtDate, makeCanvas, sectionTitle, segmented, type View } from './components';
import { drawProgress } from './charts';

const COLORS = {
  accuracy: '#4d9fff',
  rhythm: '#35c46b',
  stability: '#edb443',
  high: '#c07ae8',
};

export function renderProgress(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(topbar('进步曲线', () => ctx.back()));
  box.appendChild(wrap);
  wrap.style.padding = '16px';

  const views: View[] = [];
  const sessions = getSessions();
  if (sessions.length < 2) {
    wrap.appendChild(
      empty('至少要唱 2 次才能对比。最准的做法是同一首歌隔几天再唱一遍——变量最少，趋势最清楚。'),
    );
    wrap.appendChild(btn('去唱一首', 'v-btn primary big', () => ctx.go({ p: 'songs' })));
    return () => {};
  }

  // 按歌筛选：同一首歌的对比最有意义
  const songIds = [...new Set(sessions.map((s) => s.refId).filter((x): x is string => !!x))];
  const opts = [{ value: '', label: '全部' }].concat(
    songIds.slice(0, 3).map((id) => ({
      value: id,
      label: SONG_BY_ID.get(id.split('#')[0])?.name ?? id,
    })),
  );
  let filter = '';

  if (opts.length > 1) {
    const segCard = card();
    segCard.appendChild(
      segmented(opts, filter, (v) => {
        filter = v;
        render();
      }),
    );
    segCard.appendChild(
      el('p', '', '同一首歌的对比最可信——换歌、换调、换状态都会让数字动，那不一定是你变了。'),
    );
    wrap.appendChild(segCard);
  }

  const body = el('div');
  wrap.appendChild(body);

  function render() {
    for (const v of views) v.dispose();
    views.length = 0;
    body.innerHTML = '';

    const refId = filter || undefined;
    const series = progressSeries(refId);
    const ms = milestones(refId);

    // ---- 结论先行 ----
    const sum = card();
    sum.innerHTML = `<h3>${series.length} 次记录</h3><p>${esc(ms.summary)}</p>`;
    body.appendChild(sum);

    // ---- 里程碑对比表 ----
    if (ms.points.length >= 2) {
      body.appendChild(sectionTitle('第 1 次 → 现在'));
      const mc = card();
      for (const pt of ms.points) {
        const row = el('div', 'v-row');
        row.style.cursor = 'default';
        const main = el('div', 'main');
        main.appendChild(el('div', 't', `第 ${pt.index} 次 · ${esc(pt.title)}`));
        main.appendChild(el('div', 'd', fmtDate(pt.at)));
        row.appendChild(main);
        const r = el('div', 'r');
        const bits: string[] = [];
        if (pt.accuracy !== null) bits.push(`音准 ${pt.accuracy}`);
        if (pt.rhythm !== null) bits.push(`节奏 ${pt.rhythm}`);
        if (pt.stability !== null) bits.push(`稳 ${pt.stability}`);
        if (pt.high !== null) bits.push(`高音 ${pt.high}`);
        if (pt.rangeSpan !== null) bits.push(`音域 ${pt.rangeSpan}`);
        r.innerHTML = bits.join('<br>') || '—';
        row.appendChild(r);
        mc.appendChild(row);
      }
      body.appendChild(mc);
    }

    // ---- 折线 ----
    body.appendChild(sectionTitle('趋势'));
    const chartCard = card();
    const v = makeCanvas(chartCard, 'v-canvas', 190);
    views.push(v);
    const labels = series.map((s) => fmtDate(s.at));
    requestAnimationFrame(() =>
      drawProgress(v, labels, [
        { key: 'accuracy', label: '音准', color: COLORS.accuracy, values: series.map((s) => s.accuracy) },
        { key: 'rhythm', label: '节奏', color: COLORS.rhythm, values: series.map((s) => s.rhythm) },
        { key: 'stability', label: '稳定性', color: COLORS.stability, values: series.map((s) => s.stability) },
        { key: 'high', label: '高音', color: COLORS.high, values: series.map((s) => s.high) },
      ]),
    );
    const legend = el('div', 'v-legend');
    legend.style.marginTop = '8px';
    legend.innerHTML = Object.entries({ 音准: COLORS.accuracy, 节奏: COLORS.rhythm, 稳定性: COLORS.stability, 高音: COLORS.high })
      .map(([k, c]) => `<span><em style="background:${c}"></em>${k}</span>`)
      .join('');
    chartCard.appendChild(legend);
    chartCard.appendChild(
      el(
        'p',
        '',
        '看趋势，别看单次。单次分数受当天嗓子状态、环境噪声、选的调影响很大，' +
          '3~5 分以内的起伏属于正常波动。',
      ),
    );
    body.appendChild(chartCard);

    // ---- 音域变化 ----
    const spans = series.map((s) => s.rangeSpan).filter((x): x is number => x !== null);
    if (spans.length >= 2) {
      body.appendChild(sectionTitle('音域变化'));
      const rc = card();
      const rv = makeCanvas(rc, 'v-canvas', 130);
      views.push(rv);
      requestAnimationFrame(() =>
        drawProgress(rv, labels, [
          {
            key: 'range',
            label: '音域跨度',
            color: '#4d9fff',
            // 跨度按 30 个半音折算成百分比，好和别的曲线共用一套坐标
            values: series.map((s) => (s.rangeSpan === null ? null : Math.min(100, (s.rangeSpan / 30) * 100))),
          },
        ]),
      );
      rc.appendChild(
        el(
          'p',
          '',
          `最早 ${spans[0]} 个半音 → 最近 ${spans[spans.length - 1]} 个半音。` +
            '（纵轴按 30 个半音折算成百分比，方便和其它曲线放在一起看。）',
        ),
      );
      body.appendChild(rc);
    }

    body.appendChild(btn('🎤 再唱一次，给曲线添一个点', 'v-btn primary big', () => ctx.go({ p: 'songs' })));
  }

  render();
  return () => {
    for (const v of views) v.dispose();
  };
}
