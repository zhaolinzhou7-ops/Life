/**
 * 家长看板
 *
 * 家长打开这里是在做判断，不是在被取悦。所以：
 *  · 不用彩虹色、不用卡通字体、不用跳动的动画
 *  · 每个结论后面都跟着依据（「最近 12 次听音选图错了 7 次」）
 *  · 能力值画成条，但**不写数字**——写出来就会被当成考试成绩，
 *    然后家长会问「为什么听力只有 62 分」，而那个数字本来就不该被这样读
 *
 * 四个标签页对应家长真正会问的四个问题：
 *   今天学了吗 / 他现在什么水平 / 哪里不行 / 到底会了哪些词
 */

import type { WordMemory } from '../types';
import { getWord, themeLabel } from '../data/vocab';
import { SKILLS, describeParticipation, describeSkill, LEVEL_INFO } from '../engine/profile';
import { masteredWords, retentionBand, riskOf } from '../engine/review';
import { currentWeaknesses, ensureMission } from '../plan';
import { dailyMinutes, minutesToday, studiedToday } from '../session';
import { dayKey, dayBefore } from '../engine/util';
import type { Ctx } from '../ui';
import { btn, card, el, empty, page, skillBar, topbar } from '../ui';

type Tab = 'today' | 'ability' | 'weak' | 'words';

export interface DashActions {
  report: () => void;
  settings: () => void;
  backToKid: () => void;
}

export function renderDash(ctx: Ctx, act: DashActions): HTMLElement {
  const data = ctx.data;
  const p = data.profile;
  const today = dayKey();
  let tab: Tab = 'today';

  const root = page('parent');
  const right = el('div');
  const settingsBtn = btn('设置', 'en-pbtn', act.settings);
  settingsBtn.style.minHeight = '34px';
  settingsBtn.style.padding = '6px 12px';
  right.appendChild(settingsBtn);
  root.appendChild(topbar(`${p.avatar} ${p.name} · 家长中心`, act.backToKid, right));

  const tabs = el('div', 'en-tabs');
  const body = el('div');

  const TABS: { id: Tab; label: string }[] = [
    { id: 'today', label: '学习情况' },
    { id: 'ability', label: '能力' },
    { id: 'weak', label: '薄弱点' },
    { id: 'words', label: '词汇' },
  ];

  for (const t of TABS) {
    const b = el('button', `en-tab${t.id === tab ? ' on' : ''}`);
    b.type = 'button';
    b.textContent = t.label;
    b.addEventListener('click', () => {
      tab = t.id;
      for (const n of Array.from(tabs.children)) {
        n.classList.toggle('on', (n as HTMLElement).textContent === t.label);
      }
      paint();
    });
    tabs.appendChild(b);
  }
  root.appendChild(tabs);
  root.appendChild(body);

  function paint() {
    body.replaceChildren();
    if (tab === 'today') paintToday();
    else if (tab === 'ability') paintAbility();
    else if (tab === 'weak') paintWeak();
    else paintWords();
  }

  // ———————————————— 学习情况 ————————————————
  function paintToday() {
    const week = dailyMinutes(data, 7, today);
    const weekMin = week.reduce((a, d) => a + d.min, 0);
    // 用「有没有学过」判断，不用分钟数——短会话会被舍入成 0
    const weekDays = week.filter((d) => d.sessions > 0).length;
    const todayMin = minutesToday(data, today);
    const startedToday = studiedToday(data, today);

    const c1 = card('这一周');
    const stats = el('div', 'en-stats');
    const stat = (v: string, l: string) => {
      const s = el('div', 'en-stat');
      s.appendChild(el('b', undefined, v));
      s.appendChild(el('span', undefined, l));
      return s;
    };
    stats.appendChild(stat(String(weekDays), '学习天数'));
    stats.appendChild(stat(String(weekMin), '总分钟'));
    stats.appendChild(stat(String(p.streak), '连续天数'));
    stats.appendChild(stat(String(masteredWords(data.memories).length), '掌握词数'));
    c1.appendChild(stats);

    // 趋势柱。最高的那天撑满，其它按比例——绝对值不重要，规律才重要
    const max = Math.max(10, ...week.map((d) => d.min));
    const trend = el('div', 'en-trend');
    for (const d of week) {
      const col = el('div', 'en-trend-col');
      const bar = el('div', `en-trend-bar${d.sessions ? '' : ' zero'}`);
      bar.style.height = `${Math.max(3, (d.min / max) * 56)}px`;
      bar.title = `${d.date} · ${d.min} 分钟`;
      col.appendChild(bar);
      col.appendChild(el('div', 'en-trend-lab', d.date.slice(5).replace('-', '/')));
      trend.appendChild(col);
    }
    c1.appendChild(trend);

    if (weekDays === 0) {
      c1.appendChild(el('p', undefined, '这一周还没有学习记录。'));
    } else if (weekDays <= 2) {
      c1.appendChild(
        el('p', undefined, '这周只学了 ' + weekDays + ' 天。每天 10~15 分钟比周末一次学一小时有效得多——间隔太久，前面学的会先忘掉。'),
      );
    }
    body.appendChild(c1);

    // 今天
    const c2 = card('今天');
    const mission = ensureMission(data, today);
    ctx.save();
    c2.appendChild(
      el('p', undefined, startedToday ? `已经学了 ${todayMin} 分钟。` : '今天还没有开始。'),
    );
    for (const s of mission.steps) {
      const row = el('div', 'en-switch');
      const txt = el('div', 'en-switch-txt');
      txt.appendChild(el('b', undefined, `${s.done ? '✓ ' : '○ '}${s.titleZh}`));
      txt.appendChild(el('span', undefined, s.learningOutcome));
      row.appendChild(txt);
      row.appendChild(el('div', 'en-trend-lab', `${s.estimateMin} 分钟`));
      c2.appendChild(row);
    }
    const why = el('p');
    why.style.fontSize = '12.5px';
    why.style.color = 'var(--ink-3)';
    why.textContent = `为什么是这些：${mission.reason}`;
    c2.appendChild(why);
    body.appendChild(c2);

    // 最近几次
    const recent = data.sessions.slice(-5).reverse();
    const c3 = card('最近几次学习');
    if (!recent.length) {
      c3.appendChild(el('p', undefined, '还没有记录。'));
    } else {
      for (const s of recent) {
        const row = el('div', 'en-switch');
        const txt = el('div', 'en-switch-txt');
        txt.appendChild(el('b', undefined, `${s.date} · ${Math.max(1, Math.round(s.seconds / 60))} 分钟`));
        txt.appendChild(
          el(
            'span',
            undefined,
            `新学 ${s.newWords.length} 个，复习 ${s.reviewWords.length} 个` +
              ((s.metWords?.length ?? 0) ? `，另外见到 ${s.metWords.length} 个` : '') +
              `，完成 ${s.activities.length} 个活动`,
          ),
        );
        row.appendChild(txt);
        row.appendChild(el('div', 'en-trend-lab', s.completed ? '已完成' : '中途退出'));
        c3.appendChild(row);
      }
    }
    body.appendChild(c3);

    const go = el('div', 'en-pbtn-row');
    go.appendChild(btn('看本周成长报告', 'en-pbtn primary', act.report));
    body.appendChild(go);
  }

  // ———————————————— 能力 ————————————————
  function paintAbility() {
    const c = card(`当前阶段：${LEVEL_INFO[p.level].labelZh}`);
    c.appendChild(el('p', undefined, LEVEL_INFO[p.level].desc));
    if (!p.assessedAt) {
      c.appendChild(
        el('p', undefined, '还没有做过初次测评。下面的数值是按年龄给的起点，孩子学几次之后会逐步调整到真实水平。'),
      );
    }
    body.appendChild(c);

    const c2 = card('八个维度');
    const note = el('p');
    note.style.fontSize = '12.5px';
    note.textContent = '条的长度只用于看相对强弱，不是分数，也不对应任何考试。右侧是当前水平的描述。';
    c2.appendChild(note);
    for (const s of SKILLS) {
      const v = p.english[s.id] as number;
      c2.appendChild(skillBar(s.labelZh, v, describeSkill(s.id, v)));
    }
    body.appendChild(c2);

    // 参与行为。这里是「Confidence」的诚实版本
    const c3 = card('学习状态');
    const sig = p.english.participation;
    c3.appendChild(el('p', undefined, describeParticipation(sig)));
    const detail = el('p');
    detail.style.fontSize = '12.5px';
    detail.style.color = 'var(--ink-3)';
    detail.textContent = `依据：作答 ${sig.attempts} 次，跳过 ${sig.skips} 次，用提示 ${sig.hintsUsed} 次，主动开口 ${sig.voluntarySpeak} 次，提示后开口 ${sig.promptedSpeak} 次。`;
    c3.appendChild(detail);
    const disc = el('p');
    disc.style.fontSize = '12.5px';
    disc.style.color = 'var(--ink-3)';
    disc.textContent =
      '说明：这里描述的是能观察到的行为，不是孩子的性格或自信心。我们没有能力测量心理状态，也不打算假装能。';
    c3.appendChild(disc);
    body.appendChild(c3);
  }

  // ———————————————— 薄弱点 ————————————————
  function paintWeak() {
    const ws = currentWeaknesses(data);
    if (!ws.length) {
      body.appendChild(
        empty(
          '🌱',
          data.memories.length < 5
            ? '学习数据还太少，看不出稳定的薄弱点。再学几次就会有结论。'
            : '目前没有发现明显的薄弱点。继续保持每天的节奏就好。',
        ),
      );
      return;
    }
    const c = card('发现的薄弱点');
    const note = el('p');
    note.style.fontSize = '12.5px';
    note.textContent = '按严重程度排序。每一条都写了判断依据，以及系统已经做了什么调整。';
    c.appendChild(note);
    for (const w of ws) {
      const box = el('div', 'en-weak');
      box.appendChild(el('b', undefined, w.title));
      box.appendChild(el('div', 'ev', `依据：${w.evidence}`));
      if (w.prescription.note) box.appendChild(el('div', 'rx', `已调整：${w.prescription.note}`));
      if (w.prescription.focusWordIds.length) {
        const grid = el('div', 'en-wordgrid');
        for (const id of w.prescription.focusWordIds.slice(0, 10)) {
          const word = getWord(id);
          if (word) grid.appendChild(el('span', 'en-wordtag shaky', `${word.emoji} ${word.en}`));
        }
        box.appendChild(grid);
      }
      c.appendChild(box);
    }
    body.appendChild(c);
  }

  // ———————————————— 词汇 ————————————————
  function paintWords() {
    const mems = data.memories.filter((m) => m.seen > 0);
    if (!mems.length) {
      body.appendChild(empty('📖', '还没有学过词。完成一次学习后，这里会列出孩子掌握了哪些、哪些还不稳。'));
      return;
    }

    const now = Date.now();
    const solid: WordMemory[] = [];
    const fading: WordMemory[] = [];
    const shaky: WordMemory[] = [];
    for (const m of mems) {
      const b = retentionBand(m, now);
      if (b === 'solid') solid.push(m);
      else if (b === 'fading') fading.push(m);
      else shaky.push(m);
    }

    const c = card('掌握情况');
    const stats = el('div', 'en-stats');
    const stat = (v: string, l: string) => {
      const s = el('div', 'en-stat');
      s.appendChild(el('b', undefined, v));
      s.appendChild(el('span', undefined, l));
      return s;
    };
    stats.appendChild(stat(String(solid.length), '记得牢'));
    stats.appendChild(stat(String(fading.length), '还需复习'));
    stats.appendChild(stat(String(shaky.length), '不太稳'));
    c.appendChild(stats);

    const section = (title: string, list: WordMemory[], cls: string, hint: string) => {
      if (!list.length) return;
      c.appendChild(el('h3', undefined, title));
      const h = el('p');
      h.style.fontSize = '12.5px';
      h.style.color = 'var(--ink-3)';
      h.textContent = hint;
      c.appendChild(h);
      const grid = el('div', 'en-wordgrid');
      for (const m of list.slice(0, 60)) {
        const w = getWord(m.wordId);
        if (!w) continue;
        const tag = el('span', `en-wordtag ${cls}`, `${w.emoji} ${w.en}`);
        tag.title = `${w.zh} · 练了 ${m.seen} 次，对 ${m.correct} 次，错 ${m.wrong} 次`;
        grid.appendChild(tag);
      }
      c.appendChild(grid);
    };

    section('记得牢', solid, 'solid', '连续答对多次，复习间隔已经拉长，偶尔在故事和游戏里复现。');
    section('还需复习', fading, '', '学过但还不稳，系统会按间隔安排它们再出现。');
    section(
      '不太稳',
      shaky.sort((a, b) => riskOf(b, now) - riskOf(a, now)),
      'shaky',
      '这些词最近错得多或者隔太久没见，已经排进了接下来几天的重点。',
    );
    body.appendChild(c);

    // 按主题看，家长更容易理解「哪一类不行」
    const byTheme = new Map<string, { ok: number; total: number }>();
    for (const m of mems) {
      const w = getWord(m.wordId);
      if (!w) continue;
      const t = byTheme.get(w.theme) ?? { ok: 0, total: 0 };
      t.total += 1;
      if (m.mastered) t.ok += 1;
      byTheme.set(w.theme, t);
    }
    const c2 = card('按主题');
    for (const [theme, v] of byTheme) {
      c2.appendChild(
        skillBar(
          themeLabel(theme as Parameters<typeof themeLabel>[0]),
          (v.ok / Math.max(1, v.total)) * 100,
          `${v.ok}/${v.total} 已掌握`,
        ),
      );
    }
    body.appendChild(c2);

    const old = dayBefore(today, 7);
    const learnedThisWeek = mems.filter((m) => dayKey(m.firstLearnedAt) > old).length;
    const foot = el('p');
    foot.style.fontSize = '12.5px';
    foot.style.color = 'var(--ink-3)';
    foot.textContent = `最近 7 天新接触了 ${learnedThisWeek} 个词。`;
    body.appendChild(foot);
  }

  paint();
  return root;
}
