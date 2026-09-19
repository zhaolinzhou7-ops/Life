/**
 * 界面里的"画牌"这一层：只负责把数据变成 DOM，**不碰任何规则**。
 * 规则判断全在 patterns.ts / game.ts 里，这里连一次牌型比较都不做。
 */
import { isJoker, isRed, suitSymbol, type Card } from './cards';
import { describeMove, type Move } from './patterns';

/** 一张牌 */
export function cardEl(card: Card, opts: { selected?: boolean } = {}): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dd-card';
  if (isRed(card)) el.classList.add('red');
  if (isJoker(card)) el.classList.add('joker');
  if (card.label.length > 1 && !isJoker(card)) el.classList.add('wide'); // 只有 10
  if (opts.selected) el.classList.add('selected');
  el.dataset.id = card.id;
  const suit = suitSymbol(card);
  // 王牌复用普通牌的两行排版：角上"小/大"，下面"王"，右下角星做水印
  el.innerHTML = isJoker(card)
    ? `<div class="rank">${card.label[0]}</div><div class="suit">王</div><div class="big">★</div>`
    : `<div class="rank">${card.label}</div><div class="suit">${suit}</div><div class="big">${suit}</div>`;
  return el;
}

/** 一排牌 */
export function cardsEl(cards: readonly Card[], selected?: Set<string>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'dd-cards';
  for (const c of cards) row.appendChild(cardEl(c, { selected: selected?.has(c.id) }));
  return row;
}

/** 别人打出的牌 / 不要 */
export function playedEl(move: Move | null, passed: boolean, mine = false): HTMLElement {
  const box = document.createElement('div');
  box.className = `dd-played${mine ? ' mine' : ''}`;
  if (passed) {
    const p = document.createElement('div');
    p.className = 'dd-pass';
    p.textContent = '不要';
    box.appendChild(p);
    return box;
  }
  if (!move) return box;
  box.appendChild(cardsEl(move.cards));
  const label = document.createElement('div');
  label.className = 'dd-move-label';
  label.textContent = describeMove(move);
  box.appendChild(label);
  return box;
}

/** 上方 AI 的信息块 */
export function seatEl(opts: {
  name: string;
  avatar: string;
  isLandlord: boolean;
  count: number;
  active: boolean;
  side: 'left' | 'right';
}): HTMLElement {
  const el = document.createElement('div');
  el.className = `dd-seat ${opts.side}${opts.active ? ' active' : ''}`;

  const avatar = document.createElement('div');
  avatar.className = `dd-avatar${opts.isLandlord ? ' landlord' : ''}`;
  avatar.textContent = opts.avatar;

  const info = document.createElement('div');
  info.className = 'dd-seat-info';
  const name = document.createElement('div');
  name.className = 'dd-seat-name';
  name.textContent = opts.name;
  const count = document.createElement('div');
  count.className = `dd-seat-count${opts.count <= 3 ? ' low' : ''}`;
  count.innerHTML = `剩 <b>${opts.count}</b> 张`;
  info.append(name, count);

  // 牌背条：一眼看出还剩多少，比只读数字直观。
  // 最多画 14 根——再多会把座位块撑宽，窄屏上直接顶出屏幕。
  const backs = document.createElement('div');
  backs.className = 'dd-backs';
  for (let i = 0; i < Math.min(opts.count, 14); i++) backs.appendChild(document.createElement('i'));
  info.appendChild(backs);

  el.append(avatar, info);
  return el;
}

/** 一行「名字 : 值」 */
export function rowEl(k: string, v: string, tone?: 'plus' | 'minus'): HTMLElement {
  const el = document.createElement('div');
  el.className = 'dd-row';
  el.innerHTML = `<span class="k">${k}</span><span class="v${tone ? ' ' + tone : ''}">${v}</span>`;
  return el;
}

/** 按钮 */
export function btn(text: string, onClick: () => void, variant = ''): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = `dd-btn${variant ? ' ' + variant : ''}`;
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

/** 分段选择器 */
export function segment<T extends string | number>(
  options: { label: string; value: T }[],
  current: T,
  onPick: (v: T) => void,
): HTMLElement {
  const box = document.createElement('div');
  box.className = 'dd-seg';
  for (const o of options) {
    const b = document.createElement('button');
    b.textContent = o.label;
    if (o.value === current) b.classList.add('on');
    b.addEventListener('click', () => onPick(o.value));
    box.appendChild(b);
  }
  return box;
}

/** 带标题的设置项 */
export function field(label: string, control: HTMLElement, note?: string): HTMLElement {
  const box = document.createElement('div');
  box.className = 'dd-field';
  const l = document.createElement('label');
  l.textContent = label;
  box.append(l, control);
  if (note) {
    const n = document.createElement('div');
    n.className = 'dd-note';
    n.textContent = note;
    n.style.marginTop = '7px';
    box.appendChild(n);
  }
  return box;
}

/** 炸弹/王炸的全屏闪光 */
export function flash(host: HTMLElement, kind: 'bomb' | 'rocket'): void {
  const el = document.createElement('div');
  el.className = `dd-flash ${kind}`;
  el.textContent = kind === 'rocket' ? '王 炸' : '炸 弹';
  host.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

/** 气泡：AI 说的话（叫分、不要、报单） */
export function sayEl(text: string, side: 'left' | 'right'): HTMLElement {
  const el = document.createElement('div');
  el.className = `dd-seat-say ${side}`;
  el.textContent = text;
  return el;
}
