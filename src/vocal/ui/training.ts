/** 训练中心：今日训练 + 四个大类。 */

import type { Ctx } from '../index';
import { makeDailyPlan, todaySummary } from '../data/plan';
import { EXERCISES, KIND_LABEL, type ExerciseKind } from '../training/exercises';
import { getTraining } from '../data/store';
import { btn, card, el, esc, sectionTitle } from './components';

export function renderTraining(box: HTMLElement, ctx: Ctx): () => void {
  const wrap = el('div', 'v-wrap');
  box.appendChild(wrap);

  wrap.appendChild(el('div', 'v-h1', '训练'));
  wrap.appendChild(
    el(
      'div',
      'v-sub',
      '每条练习都会告诉你怎么做、为什么有用、最容易错在哪。练完的结果会记进档案，' +
        '再唱一遍同一首歌就能看出有没有变化。',
    ),
  );

  // ---- 今日训练 ----
  const plan = makeDailyPlan();
  wrap.appendChild(sectionTitle('今日训练'));
  const planCard = card();
  planCard.innerHTML =
    `<h3>今天建议练 ${plan.totalMinutes} 分钟</h3>` +
    `<p>${esc(plan.focus)}</p>` +
    `<p style="font-size:12px;color:var(--v-dim)">${esc(plan.basis)}</p>`;

  plan.items.forEach((it, i) => {
    const row = el('div', 'v-row');
    const main = el('div', 'main');
    main.appendChild(el('div', 't', `训练 ${i + 1}　${esc(it.name)} · ${it.minutes} 分钟`));
    main.appendChild(el('div', 'd', esc(it.reason)));
    row.appendChild(main);
    row.appendChild(el('div', 'r', '去练 →'));
    row.addEventListener('click', () => ctx.go({ p: 'exercise', id: it.exerciseId }));
    planCard.appendChild(row);
  });

  if (plan.recheck) {
    const row = el('div', 'v-row');
    const main = el('div', 'main');
    main.appendChild(el('div', 't', `再检测　《${esc(plan.recheck.title)}》 · 约 4 分钟`));
    main.appendChild(el('div', 'd', esc(plan.recheck.reason)));
    row.appendChild(main);
    row.appendChild(el('div', 'r', '去唱 →'));
    row.addEventListener('click', () =>
      ctx.go({ p: 'practice', songId: plan.recheck!.refId.split('#')[0] }),
    );
    planCard.appendChild(row);
  }
  wrap.appendChild(planCard);

  wrap.appendChild(el('div', 'v-note', esc(todaySummary())));

  // ---- 分类 ----
  const done = new Map<string, number>();
  for (const t of getTraining()) done.set(t.exerciseId, (done.get(t.exerciseId) ?? 0) + 1);

  const kinds: ExerciseKind[] = ['pitch', 'rhythm', 'high', 'stability'];
  const kindNote: Record<ExerciseKind, string> = {
    pitch: '跑调的根源多半在「心里没有准确的目标音」，这几条都是在建立那个目标。',
    rhythm: '节奏练的是预判——要能提前知道下一拍什么时候来，而不是听到了再反应。',
    high: '高音靠的不是使劲，是省劲。这几条都在教你用更小的力气够到更高的音。',
    stability:
      '这几条测的是长音时长、音量稳定、音高稳定——都是能从录音里客观读到的。' +
      '它们和气息支撑有关，但软件测不了气息本身，所以不会声称在测气息。',
  };

  for (const k of kinds) {
    wrap.appendChild(sectionTitle(KIND_LABEL[k]));
    const c = card();
    c.appendChild(el('p', '', esc(kindNote[k])));
    for (const ex of EXERCISES.filter((e) => e.kind === k)) {
      const n = done.get(ex.id) ?? 0;
      const row = el('div', 'v-row');
      const main = el('div', 'main');
      main.appendChild(
        el(
          'div',
          't',
          `${esc(ex.name)}${ex.load === 3 ? ' <span class="v-tag yellow">偏累</span>' : ex.load === 1 ? ' <span class="v-tag green">不费嗓</span>' : ''}`,
        ),
      );
      main.appendChild(el('div', 'd', esc(ex.goal)));
      row.appendChild(main);
      row.appendChild(el('div', 'r', n ? `练过 ${n} 次` : `${ex.minutes} 分钟`));
      row.addEventListener('click', () => ctx.go({ p: 'exercise', id: ex.id }));
      c.appendChild(row);
    }
    wrap.appendChild(c);
  }

  const back = btn('← 返回首页', 'v-btn ghost', () => ctx.go({ p: 'home' }));
  back.style.marginTop = '14px';
  wrap.appendChild(back);
  return () => {};
}
