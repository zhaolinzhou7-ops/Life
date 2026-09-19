/**
 * 学习完成页
 *
 * 这一屏要回答的是「我刚才到底学了什么」，不是「我得了几分」。
 *
 * 所以主体是一张词表：今天新学的、今天复习的，每个词带图。
 * 星星只是一行装饰，不做排行、不做连胜奖励、不做「明天不来就清零」——
 * 用损失厌恶去驱动一个五岁孩子，是把产品指标建在孩子的焦虑上。
 */

import type { SessionRecord } from '../types';
import { getWord } from '../data/vocab';
import { FINISH, pick } from '../data/phrases';
import { finishSession } from '../session';
import type { Ctx } from '../ui';
import { btn, el, page } from '../ui';
import { say } from './parts';

export function renderDone(ctx: Ctx, session: SessionRecord, onHome: () => void): HTMLElement {
  const done = finishSession(ctx.data, session);
  ctx.save();
  const p = ctx.data.profile;

  const root = page('kid');
  const stage = el('div', 'en-stage');
  root.appendChild(stage);

  stage.appendChild(el('div', 'en-pic', '🎉'));
  stage.appendChild(el('div', 'en-ask', 'You did it!'));
  stage.appendChild(el('div', 'en-done-stars', '⭐'.repeat(Math.max(1, Math.min(5, done.stars)))));

  const mins = Math.max(1, Math.round(done.seconds / 60));
  stage.appendChild(
    el('div', 'en-ask-zh', `今天学了 ${mins} 分钟${p.streak > 1 ? ` · 连续 ${p.streak} 天 🔥` : ''}`),
  );

  const pick3 = (ids: string[]) => ids.map(getWord).filter((w): w is NonNullable<typeof w> => !!w);
  const newWords = pick3(done.newWords);
  const reviewWords = pick3(done.reviewWords);
  const metWords = pick3(done.metWords ?? []);

  if (newWords.length || reviewWords.length || metWords.length) {
    const box = el('div', 'en-learned');
    const section = (title: string, ws: typeof newWords, first = false) => {
      if (!ws.length) return;
      const h = el('h3', undefined, title);
      if (!first) h.style.marginTop = '12px';
      box.appendChild(h);
      const chips = el('div', 'en-chips');
      for (const w of ws) chips.appendChild(el('span', 'en-chip', `${w.emoji} ${w.en}`));
      box.appendChild(chips);
    };
    section(`今天新学了 ${newWords.length} 个词`, newWords, true);
    section(`复习了 ${reviewWords.length} 个`, reviewWords);
    // 分开列：这些是听到/见到过，不是教过的。混在"新学"里会让家长高估进度
    section(`还在游戏和故事里见到了 ${metWords.length} 个`, metWords);
    stage.appendChild(box);
  }

  // §21：每个活动都要说清楚学会了什么，完成页把它们汇总一次
  if (done.activities.length) {
    const box = el('div', 'en-learned');
    box.appendChild(el('h3', undefined, '今天做了这些'));
    const ul = el('ul');
    ul.style.margin = '0';
    ul.style.paddingLeft = '18px';
    for (const a of done.activities) {
      const li = el('li', undefined, a.learningOutcome);
      ul.appendChild(li);
    }
    box.appendChild(ul);
    stage.appendChild(box);
  }

  stage.appendChild(el('div', 'en-spacer'));
  stage.appendChild(btn('回到首页', 'en-btn', onHome));
  stage.appendChild(el('div', 'en-tip', '明天见！Coco 会安排今天没记牢的词再出现一次。'));

  say(pick(FINISH, done.stars));

  return root;
}
