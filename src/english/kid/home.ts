/**
 * 今日任务首页（Today's Adventure）
 *
 * 这一屏只回答一个问题：**今天做什么。**
 *
 * 所以屏幕上没有课程列表、没有关卡地图、没有排行榜。
 * 只有：我是谁（头像和连续天数）、今天几件事、大概多久、一个 START。
 *
 * 任务列表里的中文是给旁边的家长看的，孩子看的是图标和英文短句——
 * 所以每一行都是「图标 + 英文 + 小字中文」，而不是一段说明。
 */

import { ensureMission, allDone, nextStep } from '../plan';
import { minutesToday } from '../session';
import { warmUpSpeech } from '../speech/tts';
import { dayKey } from '../engine/util';
import { LEVEL_INFO } from '../engine/profile';
import type { Ctx } from '../ui';
import { btn, el, page } from '../ui';
import { say } from './parts';

export interface HomeActions {
  start: () => void;
  assess: () => void;
  /** 点某一步直接从那一步开始 */
  jump: (stepId: string) => void;
}

export function renderKidHome(ctx: Ctx, act: HomeActions): HTMLElement {
  const data = ctx.data;
  const p = data.profile;
  const today = dayKey();
  const mission = ensureMission(data, today);
  ctx.save();

  const root = page('kid');
  root.style.position = 'relative';

  // —— 家长入口：长按才开，孩子点一下只会看到提示 ——
  const gate = btn('👤', 'en-parent-entry');
  gate.setAttribute('aria-label', '家长中心');
  attachLongPress(gate, () => ctx.toParent(), () => {
    hintLine.textContent = '长按这个按钮进入家长中心';
    hintLine.style.opacity = '1';
    setTimeout(() => (hintLine.style.opacity = '0'), 2200);
  });
  root.appendChild(gate);

  // —— 头部 ——
  const hero = el('div', 'en-hero');
  hero.appendChild(el('div', 'en-hero-avatar', p.avatar));
  hero.appendChild(el('h1', undefined, `Hi, ${p.name}!`));
  hero.appendChild(el('div', 'en-sub', "Today's Adventure"));
  if (p.streak > 0) {
    hero.appendChild(el('div', 'en-streak', `🔥 连续 ${p.streak} 天 · ⭐ ${p.stars}`));
  }
  root.appendChild(hero);

  const hintLine = el('div', 'en-tip', '');
  hintLine.style.transition = 'opacity .2s';
  hintLine.style.opacity = '0';
  hintLine.style.minHeight = '18px';
  root.appendChild(hintLine);

  // —— 还没测评：先引导去测评 ——
  if (!p.assessedAt) {
    const box = el('div', 'en-mission');
    box.appendChild(el('div', 'en-ask', 'Let\'s play a game first!'));
    const d = el('div', 'en-tip', '先和 Coco 玩几个小游戏（约 3 分钟），它就知道该给你安排什么内容了。');
    d.style.marginTop = '8px';
    box.appendChild(d);
    root.appendChild(box);
    root.appendChild(el('div', 'en-spacer'));
    root.appendChild(
      btn('START', 'en-btn', () => {
        warmUpSpeech();
        act.assess();
      }),
    );
    return root;
  }

  // —— 今日任务卡 ——
  const box = el('div', 'en-mission');
  const h = el('div', 'en-mission-h');
  h.appendChild(el('b', undefined, "Today's Mission"));
  h.appendChild(el('div', 'en-mission-time', `约 ${mission.estimateMin} 分钟`));
  box.appendChild(h);

  mission.steps.forEach((s, i) => {
    const row = el('div', `en-step${s.done ? ' done' : ''}`);
    const icon = el('div', 'en-step-icon', s.done ? '✓' : s.icon);
    row.appendChild(icon);
    const txt = el('div', 'en-step-txt');
    txt.appendChild(el('b', undefined, `${i + 1}. ${s.title}`));
    txt.appendChild(el('span', undefined, s.titleZh));
    row.appendChild(txt);
    if (s.done) row.appendChild(el('div', 'en-step-check', '⭐'));
    row.addEventListener('click', () => act.jump(s.id));
    box.appendChild(row);
  });

  if (!mission.steps.length) {
    box.appendChild(el('div', 'en-tip', '今天的内容都学完啦，明天再来～'));
  }
  root.appendChild(box);

  // —— 今天已经学了多久 ——
  const mins = minutesToday(data, today);
  if (mins > 0) {
    root.appendChild(el('div', 'en-tip', `今天已经学了 ${mins} 分钟 · ${LEVEL_INFO[p.level].labelZh}阶段`));
  }

  root.appendChild(el('div', 'en-spacer'));

  const finished = allDone(mission);
  const next = nextStep(mission);
  const label = finished ? '再练一次' : next && mission.steps.some((s) => s.done) ? 'CONTINUE' : 'START';
  const go = btn(label, 'en-btn', () => {
    warmUpSpeech();
    say(`Hi ${p.name}! Let's learn English!`);
    act.start();
  });
  root.appendChild(go);

  if (finished) {
    root.appendChild(el('div', 'en-tip', '今天的任务已经完成了 🎉 再练一次也可以，不会打乱明天的安排。'));
  }

  return root;
}

/**
 * 长按。
 *
 * 触摸和鼠标都要管，而且手指移动超过 12px 要取消——孩子滑屏的时候
 * 经常会从按钮上划过，不做这个判断会误入家长端。
 */
function attachLongPress(node: HTMLElement, onLong: () => void, onShort: () => void, ms = 650): void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  let sx = 0;
  let sy = 0;

  const start = (x: number, y: number) => {
    sx = x;
    sy = y;
    fired = false;
    timer = setTimeout(() => {
      fired = true;
      onLong();
    }, ms);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const end = () => {
    cancel();
    if (!fired) onShort();
  };

  node.addEventListener('touchstart', (e) => {
    const t = e.touches[0];
    start(t.clientX, t.clientY);
  }, { passive: true });
  node.addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (Math.abs(t.clientX - sx) > 12 || Math.abs(t.clientY - sy) > 12) cancel();
  }, { passive: true });
  node.addEventListener('touchend', (e) => {
    e.preventDefault();
    end();
  });
  node.addEventListener('mousedown', (e) => start(e.clientX, e.clientY));
  node.addEventListener('mousemove', (e) => {
    if (timer && (Math.abs(e.clientX - sx) > 12 || Math.abs(e.clientY - sy) > 12)) cancel();
  });
  node.addEventListener('mouseup', end);
  node.addEventListener('mouseleave', cancel);
}
