/**
 * 本周成长报告
 *
 * §18 的要求是「不要给家长一堆复杂指标」。所以这一页只有四段话加一组建议，
 * 每段两句以内，全是人话。
 *
 * 报告由 AI 层生成（aiAssessment）。没接模型时由内置引擎按规则写，
 * 内容一样完整——报告是家长每周唯一会认真看的东西，不能因为没配 API 就是空的。
 *
 * 建议部分有一条硬要求：必须是家长明天就能做的动作。
 * 「请多陪伴孩子」这种话不写，写了等于没写。
 */

import { aiAssessment } from '../ai';
import { currentWeaknesses } from '../plan';
import { dailyMinutes } from '../session';
import { masteredWords } from '../engine/review';
import { getWord } from '../data/vocab';
import { dayKey } from '../engine/util';
import type { Ctx } from '../ui';
import { btn, card, el, page, topbar } from '../ui';

export function renderReport(ctx: Ctx, onBack: () => void): HTMLElement {
  const data = ctx.data;
  const today = dayKey();
  const week = dailyMinutes(data, 7, today);
  const minutes = week.reduce((a, d) => a + d.min, 0);
  const sessions = data.sessions.filter((s) => week.some((w) => w.date === s.date)).length;

  const root = page('parent');
  root.appendChild(topbar('本周英语成长', onBack));

  const loading = card();
  loading.appendChild(el('p', undefined, '正在生成报告…'));
  root.appendChild(loading);

  const weaknesses = currentWeaknesses(data);

  void aiAssessment({
    profile: data.profile,
    memories: data.memories,
    weaknesses,
    minutesThisWeek: minutes,
    sessionsThisWeek: sessions,
  })
    .then((r) => {
      loading.remove();
      const rep = r.data;

      const head = card();
      const h = el('p', undefined, rep.headline);
      h.style.fontSize = '16px';
      h.style.fontWeight = '600';
      h.style.color = 'var(--ink)';
      head.appendChild(h);
      root.appendChild(head);

      const mastered = masteredWords(data.memories);
      const learning = data.memories.filter((m) => m.seen > 0 && !m.mastered);

      const cv = card('词汇');
      const stats = el('div', 'en-stats');
      const stat = (v: string, l: string) => {
        const s = el('div', 'en-stat');
        s.appendChild(el('b', undefined, v));
        s.appendChild(el('span', undefined, l));
        return s;
      };
      stats.appendChild(stat(String(mastered.length), '掌握'));
      stats.appendChild(stat(String(learning.length), '正在学'));
      cv.appendChild(stats);
      cv.appendChild(el('p', undefined, rep.vocabulary));
      if (mastered.length) {
        const grid = el('div', 'en-wordgrid');
        for (const m of mastered.slice(0, 24)) {
          const w = getWord(m.wordId);
          if (w) grid.appendChild(el('span', 'en-wordtag solid', `${w.emoji} ${w.en}`));
        }
        cv.appendChild(grid);
      }
      root.appendChild(cv);

      const cl = card('听力');
      cl.appendChild(el('p', undefined, rep.listening));
      root.appendChild(cl);

      const cs = card('口语');
      cs.appendChild(el('p', undefined, rep.speaking));
      root.appendChild(cs);

      const ca = card('下周建议');
      const ul = el('ul');
      ul.style.margin = '6px 0';
      ul.style.paddingLeft = '18px';
      ul.style.color = 'var(--ink-2)';
      for (const a of rep.advice) {
        const li = el('li', undefined, a);
        li.style.margin = '7px 0';
        li.style.lineHeight = '1.65';
        ul.appendChild(li);
      }
      ca.appendChild(ul);
      const t = el('p');
      t.style.fontSize = '12.5px';
      t.style.color = 'var(--ink-3)';
      t.textContent = '每天 10~15 分钟即可，关键是别断。';
      ca.appendChild(t);
      root.appendChild(ca);

      if (r.fallbackNote) {
        const n = el('div', 'en-notice warn', r.fallbackNote);
        root.appendChild(n);
      } else if (r.engine === 'mock') {
        root.appendChild(
          el('div', 'en-notice', '这份报告由内置引擎生成。在设置里接入 AI 网关后，报告会更贴合孩子的具体情况。'),
        );
      }

      root.appendChild(btn('返回', 'en-pbtn', onBack));
    })
    .catch(() => {
      loading.replaceChildren();
      loading.appendChild(el('p', undefined, '报告生成失败了。这不影响学习数据——数据都在本地，可以稍后再看。'));
      loading.appendChild(btn('返回', 'en-pbtn', onBack));
    });

  return root;
}
