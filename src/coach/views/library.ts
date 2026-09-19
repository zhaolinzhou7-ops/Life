/**
 * 场景库
 *
 * 计划之外的自由入口。每个场景卡片上必须写清**这一局要办成什么事**——
 * 因为这是它和"随便聊聊"的根本区别，也是用户选择的依据。
 */

import type { Scenario, ScenarioCategory } from '../types';
import { CATEGORY_LABEL } from '../types';
import { SCENARIOS } from '../data/scenarios';
import { getConversations } from '../store';
import { button, card, chips, el, esc, levelBadge, page, section, topbar, mountTopbar} from './ui';

export function renderLibrary(h: { back: () => void; open: (s: Scenario) => void }): HTMLElement {
  const { root, body } = page();
  mountTopbar(root, topbar('场景库', h.back));

  const history = getConversations();
  const doneCount = (id: string) => history.filter((c) => c.scenarioId === id && c.missionComplete).length;

  const filter = new Set<string>(['all']);
  const list = el('div', '');

  const paint = () => {
    list.innerHTML = '';
    const cat = [...filter][0] ?? 'all';
    const items = cat === 'all' ? SCENARIOS : SCENARIOS.filter((s) => s.category === cat);
    for (const s of items) {
      const n = doneCount(s.id);
      const c = card('tappable');
      c.innerHTML = `
        <div class="ec-row">
          <div class="ec-row-main">
            <div class="ec-row-title">${esc(s.title)} <span class="ec-tag">${esc(CATEGORY_LABEL[s.category])}</span></div>
            <div class="ec-row-sub">${esc(s.titleEn)}</div>
          </div>
        </div>
        <div style="margin:6px 0 4px"><b>要办成的事：</b>${esc(s.mission)}</div>
        <div class="ec-row-sub">${esc(s.setting)}</div>`;
      const foot = el('div', 'ec-row');
      foot.appendChild(levelBadge(s.level));
      foot.appendChild(
        el(
          'div',
          'ec-row-main',
          `<div class="ec-row-sub">${s.stages.length} 步 · ${n > 0 ? `已完成 ${n} 次` : '还没练过'}</div>`,
        ),
      );
      c.appendChild(foot);
      c.addEventListener('click', () => h.open(s));
      list.appendChild(c);
    }
    if (!items.length) {
      list.appendChild(el('div', 'ec-empty', '<div class="ec-empty-title">这一类还没有场景</div>'));
    }
  };

  body.appendChild(
    chips(
      [
        { key: 'all', label: '全部' },
        ...(Object.keys(CATEGORY_LABEL) as ScenarioCategory[]).map((k) => ({ key: k, label: CATEGORY_LABEL[k] })),
      ],
      filter,
      () => paint(),
      { single: true },
    ),
  );
  body.appendChild(section('', ''));
  body.appendChild(list);
  paint();
  return root;
}

/** 场景开始前的说明页：先让用户知道自己在演谁、要办成什么 */
export function renderScenarioIntro(s: Scenario, h: { back: () => void; start: () => void }): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(root, topbar(s.title, h.back));

  const c = card();
  c.innerHTML = `
    <div class="ec-row-sub">场景</div>
    <div style="margin-bottom:8px">${esc(s.setting)}</div>
    <div class="ec-row-sub">你演</div>
    <div style="margin-bottom:8px">${esc(s.userRole)}</div>
    <div class="ec-row-sub">对方是</div>
    <div style="margin-bottom:8px">${esc(s.role)}</div>
    <div class="ec-row-sub">要办成的事</div>
    <div><b>${esc(s.mission)}</b></div>`;
  body.appendChild(c);

  body.appendChild(section('分几步', '每一步都要靠你说的话推进，说不到点上对方不会自己往下走。'));
  const steps = card('flat');
  s.stages.forEach((st, i) => {
    steps.appendChild(el('div', 'ec-row-title', `${i + 1}. ${esc(st.goal)}`));
  });
  body.appendChild(steps);

  body.appendChild(section('核心表达', '练完之后，这几句应该能脱口而出。'));
  const phrases = card('flat');
  for (const p of s.keyPhrases) {
    phrases.appendChild(el('div', 'ec-row-title', esc(p.en)));
    phrases.appendChild(el('div', 'ec-row-sub', esc(p.cn)));
  }
  body.appendChild(phrases);

  body.appendChild(section('这一局怎么算练得好'));
  const rub = card('flat');
  for (const r of s.rubric) rub.appendChild(el('div', 'ec-row-sub', `· ${esc(r)}`));
  body.appendChild(rub);

  body.appendChild(
    el('div', 'ec-explain', '说不出来的时候别退出——输入框上方有四级提示，一级一级来，能自己憋出来的才算数。'),
  );

  foot.appendChild(button('开始', 'primary block', h.start));
  return root;
}
