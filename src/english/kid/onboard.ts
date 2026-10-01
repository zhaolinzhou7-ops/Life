/**
 * 首次引导：建一个孩子档案
 *
 * 只问三件事：叫什么、几岁、选个头像。问得越多，家长越可能中途退出。
 *
 * 昵称这一栏明确写着「用小名就好」。这不是客套——这个应用把数据全部留在
 * 本机，但孩子的真名依然没有任何必要被录进来。少收一个字段，
 * 就少一个将来要解释的问题。
 */

import { newChild } from '../engine/profile';
import { addChild } from '../store';
import type { Ctx } from '../ui';
import { btn, el, page } from '../ui';

const AVATARS = ['🐣', '🦊', '🐼', '🐯', '🐨', '🦉', '🐧', '🦄', '🐝', '🐙', '🦕', '🐢'];

export function renderOnboard(onDone: (id: string) => void, ctx?: Pick<Ctx, 'exit'>): HTMLElement {
  const p = page('kid');

  const hero = el('div', 'en-hero');
  hero.appendChild(el('div', 'en-hero-avatar', '🦜'));
  const h1 = el('h1', undefined, 'Hi! I am Coco.');
  hero.appendChild(h1);
  hero.appendChild(el('div', 'en-sub', '我是陪你学英语的小伙伴。先告诉我你是谁吧～'));
  p.appendChild(hero);

  const box = el('div', 'en-mission');

  // —— 头像 ——
  let avatar = AVATARS[0];
  const avLabel = el('div', 'en-tip', '选一个你喜欢的');
  avLabel.style.textAlign = 'left';
  avLabel.style.marginBottom = '8px';
  box.appendChild(avLabel);

  const grid = el('div', 'en-chips');
  grid.style.gap = '8px';
  const avBtns: HTMLButtonElement[] = [];
  for (const a of AVATARS) {
    const b = el('button', 'en-chip');
    b.type = 'button';
    b.textContent = a;
    b.style.fontSize = '27px';
    b.style.padding = '6px 11px';
    b.style.background = 'transparent';
    b.addEventListener('click', () => {
      avatar = a;
      for (const x of avBtns) x.style.background = 'transparent';
      b.style.background = 'var(--brand-soft)';
    });
    avBtns.push(b);
    grid.appendChild(b);
  }
  avBtns[0].style.background = 'var(--brand-soft)';
  box.appendChild(grid);

  // —— 昵称 ——
  const nameWrap = el('div', 'en-field');
  nameWrap.style.marginTop = '18px';
  const nameLab = el('label', undefined, '小名');
  nameLab.style.fontSize = '14px';
  nameWrap.appendChild(nameLab);
  const name = el('input', 'en-input');
  name.type = 'text';
  name.placeholder = '比如 Mimi、豆豆';
  name.maxLength = 12;
  nameWrap.appendChild(name);
  const note = el('div', 'en-tip', '用小名就好，不需要真实姓名。所有数据只存在这台设备上。');
  note.style.textAlign = 'left';
  note.style.marginTop = '6px';
  nameWrap.appendChild(note);
  box.appendChild(nameWrap);

  // —— 年龄 ——
  let age = 5;
  const ageWrap = el('div', 'en-field');
  const ageLab = el('label', undefined, '几岁了');
  ageLab.style.fontSize = '14px';
  ageWrap.appendChild(ageLab);
  const seg = el('div', 'en-seg');
  const ageBtns: HTMLButtonElement[] = [];
  for (let a = 4; a <= 12; a++) {
    const b = el('button', a === age ? 'on' : '');
    b.type = 'button';
    b.textContent = String(a);
    b.style.minWidth = '46px';
    b.addEventListener('click', () => {
      age = a;
      ageBtns.forEach((x, i) => x.classList.toggle('on', i + 4 === a));
    });
    ageBtns.push(b);
    seg.appendChild(b);
  }
  ageWrap.appendChild(seg);
  const ageNote = el('div', 'en-tip', '年龄只是个起点。真正的难度由接下来的小测试和平时的表现决定。');
  ageNote.style.textAlign = 'left';
  ageNote.style.marginTop = '6px';
  ageWrap.appendChild(ageNote);
  box.appendChild(ageWrap);

  p.appendChild(box);

  const err = el('div', 'en-feedback retry');
  err.style.minHeight = '0';
  p.appendChild(err);

  const go = btn('开始吧！', 'en-btn', () => {
    const n = name.value.trim();
    if (!n) {
      err.textContent = '先给自己起个小名吧';
      err.style.minHeight = '34px';
      name.focus();
      return;
    }
    const child = newChild(n, age, avatar);
    addChild(child);
    onDone(child.id);
  });
  p.appendChild(go);

  if (ctx) {
    p.appendChild(btn('先不用了', 'en-btn ghost', ctx.exit));
  }

  return p;
}
