/**
 * 首页
 *
 * 只做一件事：说清楚这个产品和「随机生成一百个名字」的网站有什么不同，
 * 然后让用户开始。不放任何需要先理解才能用的东西。
 */

import { button, el } from './ui';
import { getFavorites } from '../store';

export interface HomeActions {
  start: () => void;
  favorites: () => void;
  settings: () => void;
  exit: () => void;
}

export function renderHome(a: HomeActions): HTMLElement {
  const page = el('div', 'nm-page nm-home');

  page.appendChild(el('div', 'nm-seal', '名'));
  page.appendChild(el('h1', '', 'AI 智能取名'));
  page.appendChild(
    el(
      'p',
      'nm-lede',
      '从姓氏搭配、音律、寓意、文化出处到现实使用场景，多维度帮你筛名字。<br>不追求一次给你一百个，只给少量真正值得认真考虑的。',
    ),
  );

  // 箭头和它后面那一项绑成一个不可断开的单元，换行时才不会在行尾甩下一个箭头
  const steps = el('div', 'nm-steps');
  ['理解需求', '生成候选', '逐项筛选', '解释比较'].forEach((s, i) => {
    const unit = el('span', 'nm-step-unit');
    if (i > 0) unit.appendChild(el('span', 'nm-step-arrow', '→'));
    unit.appendChild(el('span', 'nm-step', s));
    steps.appendChild(unit);
  });
  page.appendChild(steps);

  page.appendChild(
    el(
      'p',
      'nm-sub',
      '本地内置字库与典籍库，不联网也能用。出处只标注真实原句，重名只给风险档位——拿不到的数据不会假装拿得到。',
    ),
  );

  const actions = el('div', 'nm-home-actions');
  actions.appendChild(button('开始取名', 'primary block', a.start));

  const favs = getFavorites();
  const row = el('div', 'nm-row');
  row.appendChild(button(favs.length ? `我的收藏 · ${favs.length}` : '我的收藏', 'block', a.favorites));
  row.appendChild(button('设置', 'block', a.settings));
  actions.appendChild(row);
  actions.appendChild(button('返回小游戏合集', 'ghost block', a.exit));
  page.appendChild(actions);

  return page;
}
