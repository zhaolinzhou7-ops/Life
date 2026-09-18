/** 我的：能力档案、音域、进步、历史、学习记录。 */

import type { Ctx } from '../index';
import { midiToName } from '../dsp/notes';
import { buildProfile } from '../data/profile';
import { getSessions, getTraining, recentSessions } from '../data/store';
import { EXERCISE_BY_ID } from '../training/exercises';
import { abilityRow, btn, card, el, esc, empty, fmtDate, listRow, makeCanvas, sectionTitle } from './components';
import { drawRange } from './charts';

export function renderMe(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(wrap);
  const p = buildProfile();
  const views: { dispose(): void }[] = [];

  wrap.appendChild(el('div', 'v-h1', '我的'));
  wrap.appendChild(
    el('div', 'v-sub', `唱过 ${p.totalSessions} 次 · 练习 ${p.totalTrainings} 轮${p.streak > 1 ? ` · 连续 ${p.streak} 天` : ''}`),
  );

  // ---- 能力 ----
  wrap.appendChild(sectionTitle('我的唱歌能力'));
  const abil = card();
  if (p.abilities.every((a) => a.value === null)) {
    abil.appendChild(empty('还没有数据。唱一首歌，这里就会有你的五项指标。'));
  } else {
    for (const a of p.abilities) abil.appendChild(abilityRow(a.label, a.value, a.delta));
    const why = el('div');
    why.style.cssText = 'margin-top:12px;padding-top:11px;border-top:1px solid var(--v-line)';
    for (const a of p.abilities) {
      const line = el('div', '');
      line.style.cssText = 'font-size:12px;color:var(--v-muted);line-height:1.7;margin-bottom:4px';
      line.textContent = `${a.label}：${a.why}`;
      why.appendChild(line);
    }
    abil.appendChild(why);
  }
  abil.appendChild(el('div', 'v-note', esc(p.disclaimer)));
  wrap.appendChild(abil);

  // ---- 音域 ----
  wrap.appendChild(sectionTitle('音域'));
  const rc = card();
  if (p.range) {
    const v = makeCanvas(rc, 'v-canvas', 62);
    views.push(v);
    requestAnimationFrame(() =>
      drawRange(v, { lo: p.range!.lo, hi: p.range!.hi, comfortLo: p.range!.comfortLo, comfortHi: p.range!.comfortHi }, null),
    );
    rc.appendChild(
      el(
        'p',
        '',
        `最近 10 次里唱到过 ${midiToName(p.range.lo)} ~ ${midiToName(p.range.hi)}（跨度 ${Math.round(p.range.span)} 个半音），` +
          `舒适区 ${midiToName(p.range.comfortLo)} ~ ${midiToName(p.range.comfortHi)}。`,
      ),
    );
    if (p.range.firstSpan !== null) {
      const d = Math.round(p.range.span - p.range.firstSpan);
      rc.appendChild(
        el(
          'p',
          '',
          Math.abs(d) < 2
            ? '和最早几次相比跨度基本没变。音域增长的量级通常是「几周涨一两个半音」，短期看不出来是正常的。'
            : `比最早几次${d > 0 ? '宽了' : '窄了'} ${Math.abs(d)} 个半音。`,
        ),
      );
    }
  } else {
    rc.appendChild(empty('还没测到音域。唱一首歌就有了。'));
  }
  wrap.appendChild(rc);

  // ---- 常见问题 ----
  if (p.commonProblems.length) {
    wrap.appendChild(sectionTitle('反复出现的问题'));
    const pc = card();
    for (const cp of p.commonProblems) {
      pc.appendChild(listRow(esc(cp.title), '', `${cp.count} 次`, undefined));
    }
    pc.appendChild(
      el('p', '', '这些是最近 20 次里每次的首要问题。出现次数最多的那个，就是最该先解决的。'),
    );
    wrap.appendChild(pc);
  }

  // ---- 入口 ----
  wrap.appendChild(sectionTitle('记录'));
  const links = card();
  links.appendChild(
    listRow('进步曲线', '第 1 次 → 第 5 次 → 第 10 次 的对比', '→', () => ctx.go({ p: 'progress' })),
  );
  links.appendChild(
    listRow(
      '历史记录',
      `${getSessions().length} 次演唱${getSessions().filter((s) => s.hasAudio).length ? ` · ${getSessions().filter((s) => s.hasAudio).length} 段录音` : ''}`,
      '→',
      () => ctx.go({ p: 'history' }),
    ),
  );
  links.appendChild(listRow('设置与隐私', 'AI 模型、延迟校准、录音保留策略', '→', () => ctx.go({ p: 'settings' })));
  wrap.appendChild(links);

  // ---- 学习记录 ----
  const training = getTraining().slice(-8).reverse();
  if (training.length) {
    wrap.appendChild(sectionTitle('最近的练习'));
    const tc = card();
    for (const t of training) {
      const ex = EXERCISE_BY_ID.get(t.exerciseId);
      tc.appendChild(
        listRow(
          esc(ex?.name ?? t.exerciseId),
          `${fmtDate(t.at)} · ${t.minutes} 分钟`,
          t.score === null ? '—' : `<span class="big">${t.score}</span>`,
          ex ? () => ctx.go({ p: 'exercise', id: t.exerciseId }) : undefined,
        ),
      );
    }
    wrap.appendChild(tc);
  }

  const recent = recentSessions(1)[0];
  if (recent) {
    const b = btn('看最近一次的分析', 'v-btn', () => ctx.go({ p: 'analysis', sessionId: recent.id }));
    b.style.marginTop = '12px';
    wrap.appendChild(b);
  }

  return () => {
    for (const v of views) v.dispose();
  };
}
