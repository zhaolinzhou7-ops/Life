/**
 * 进步
 *
 * 这一页的难点不是画图，是**诚实**。
 *
 * 学习产品最容易滑进去的坑是把"活动量"包装成"进步"：练了 30 天、
 * 学了 600 个词、连续打卡 21 天——这些数字都在涨，但用户依然不会说英语。
 *
 * 所以这一页把两件事分开摆：
 *   · 真的进步（错误密度在降、会用的词在涨、改掉的毛病）
 *   · 只是活动量（学了多久、练了几次）
 * 并且明说后者不等于前者。
 */

import type { ProgressPoint } from '../types';
import { MASTERY_LABEL, SKILLS, SKILL_LABEL } from '../types';
import { clearedErrors, errorsByKind, topErrors } from '../engine/errors';
import { masteryBreakdown, usableCount } from '../engine/srs';
import { ERROR_KIND_LABEL } from '../types';
import {
  getAssessments,
  getConversations,
  getErrorProfile,
  getProfile,
  getSpeaking,
  getVocabAll,
  getWriting,
  getProgress,
} from '../store';
import { button, card, collapsible, el, esc, levelBadge, page, section, topbar, mountTopbar} from './ui';

export function renderProgress(h: { back: () => void; openConversation: (id: string) => void }): HTMLElement {
  const { root, body } = page();
  mountTopbar(root, topbar('进步', h.back));

  const profile = getProfile();
  const vocab = getVocabAll();
  const errors = getErrorProfile();
  const assessments = getAssessments();
  const convs = getConversations();
  const speaking = getSpeaking();
  const writing = getWriting();

  // ─────────── 真的进步 ───────────
  body.appendChild(section('真的进步', '这些数字涨了，才说明你更会用英语了。'));

  // 1. 错误密度趋势：用真实记录算，不够两次就说不够
  const samples = [...speaking, ...writing]
    .filter((r) => (r.metrics.wordCount?.value ?? 0) >= 10)
    .sort((a, b) => a.at - b.at);
  const errCard = card();
  errCard.appendChild(el('div', 'ec-row-title', '错误密度（每百词几处问题）'));
  if (samples.length >= 4) {
    const half = Math.floor(samples.length / 2);
    const avg = (xs: typeof samples) =>
      Math.round((xs.reduce((s, r) => s + (r.metrics.errorPer100?.value ?? 0), 0) / xs.length) * 10) / 10;
    const early = avg(samples.slice(0, half));
    const late = avg(samples.slice(half));
    const delta = Math.round((early - late) * 10) / 10;
    errCard.appendChild(
      el(
        'div',
        'ec-row-sub',
        `前 ${half} 次平均 ${early}，最近 ${samples.length - half} 次平均 ${late}。`,
      ),
    );
    errCard.appendChild(
      el(
        'div',
        delta > 0 ? 'ec-tag ok' : 'ec-tag warn',
        delta > 0 ? `降了 ${delta} 处/百词` : delta < 0 ? `升了 ${-delta} 处/百词` : '基本持平',
      ),
    );
    errCard.appendChild(
      el('div', 'ec-muted', '注意：练得越难，错误密度可能反而上升——这不一定是退步，也可能是你开始尝试更复杂的句子了。'),
    );
    errCard.appendChild(sparkline(samples.map((r) => r.metrics.errorPer100?.value ?? 0)));
  } else {
    errCard.appendChild(
      el('div', 'ec-row-sub', `还需要更多样本才能看出趋势（目前 ${samples.length} 次，至少要 4 次）。`),
    );
  }
  body.appendChild(errCard);

  // 2. 会用的词
  const bd = masteryBreakdown(vocab);
  const vCard = card();
  vCard.appendChild(el('div', 'ec-row-title', `会用的词：${usableCount(vocab)}`));
  vCard.appendChild(el('div', 'ec-row-sub', '掌握度到"会使用"以上才计入。认得出但用不出来的不算。'));
  const dist = el('div', '');
  for (const lv of [5, 4, 3, 2, 1] as const) {
    if (!bd[lv]) continue;
    const row = el('div', 'ec-row');
    row.innerHTML = `<div class="ec-row-main"><div class="ec-row-sub">${esc(MASTERY_LABEL[lv])}</div></div>
      <div class="ec-row-tail">${bd[lv]}</div>`;
    dist.appendChild(row);
  }
  vCard.appendChild(dist);
  body.appendChild(vCard);

  // 3. 改掉的毛病
  const cleared = clearedErrors(errors);
  const cCard = card();
  cCard.appendChild(el('div', 'ec-row-title', `已经改掉的毛病：${cleared.length}`));
  if (cleared.length) {
    cCard.innerHTML += cleared
      .slice(0, 8)
      .map((e) => `<span class="ec-tag ok">${esc(e.label)}</span>`)
      .join('');
  } else {
    cCard.appendChild(el('div', 'ec-row-sub', '连续三次不再犯同一个毛病，它就会出现在这里。'));
  }
  body.appendChild(cCard);

  // 4. 等级变化：只有测过两次以上才有意义
  if (assessments.length >= 2) {
    const latest = assessments[0];
    const first = assessments[assessments.length - 1];
    body.appendChild(section('等级变化', `第一次测评 → 最近一次（共测了 ${assessments.length} 次）`));
    const lc = card();
    for (const k of SKILLS) {
      const row = el('div', 'ec-skillrow');
      row.appendChild(el('div', 'ec-skill-name', SKILL_LABEL[k]));
      row.appendChild(levelBadge(first.levels[k]));
      row.appendChild(el('div', 'ec-row-main', '<div style="text-align:center;color:var(--ink-3)">→</div>'));
      row.appendChild(levelBadge(latest.levels[k]));
      lc.appendChild(row);
    }
    body.appendChild(lc);
  } else if (assessments.length === 1) {
    body.appendChild(
      el('div', 'ec-explain', '只测过一次，还看不出等级变化。练两周之后重测一次，这里会出现对比。'),
    );
  }

  // 5. 能力曲线
  const pts = getProgress().points;
  if (pts.length >= 2) {
    body.appendChild(section('能力曲线'));
    body.appendChild(levelCurve(pts));
  }

  // ─────────── 只是活动量 ───────────
  body.appendChild(section('活动量', '这些数字说明你花了多少时间，不直接说明你进步了多少。'));
  const stats = el('div', 'ec-stats');
  const stat = (n: string | number, label: string) => {
    const s = el('div', 'ec-stat');
    s.innerHTML = `<b>${esc(String(n))}</b><span>${esc(label)}</span>`;
    return s;
  };
  stats.appendChild(stat(profile.totalSessions, '训练次数'));
  stats.appendChild(stat(profile.totalMinutes, '累计分钟'));
  stats.appendChild(stat(profile.streak, '连续天数'));
  body.appendChild(stats);

  // ─────────── 错误分布 ───────────
  const byKind = errorsByKind(errors);
  if (Object.keys(byKind).length) {
    body.appendChild(section('你的错误主要集中在哪'));
    const kc = card();
    const total = Object.values(byKind).reduce((a, b) => a + b, 0);
    for (const [kind, n] of Object.entries(byKind).sort((a, b) => b[1] - a[1])) {
      const row = el('div', 'ec-skillrow');
      row.appendChild(
        el('div', 'ec-skill-name', ERROR_KIND_LABEL[kind as keyof typeof ERROR_KIND_LABEL] ?? kind),
      );
      const track = el('div', 'ec-skill-track');
      const fill = el('div', 'ec-skill-fill');
      fill.style.width = `${Math.round((n / total) * 100)}%`;
      track.appendChild(fill);
      row.appendChild(track);
      row.appendChild(el('div', 'ec-row-tail', String(n)));
      kc.appendChild(row);
    }
    body.appendChild(kc);

    const top = topErrors(errors, 5);
    if (top.length) {
      body.appendChild(
        collapsible(
          '当前重点盯的毛病',
          (() => {
            const c = el('div', '');
            for (const e of top) {
              const row = el('div', 'ec-row');
              row.innerHTML = `<div class="ec-row-main"><div class="ec-row-title">${esc(e.label)}</div>
                <div class="ec-row-sub">${e.count} 次 · 最近一次的例子：${esc(e.samples[0]?.original ?? '—')}</div></div>
                <div class="ec-row-tail">${e.clearedStreak}/3</div>`;
              c.appendChild(row);
            }
            return c;
          })(),
        ),
      );
    }
  }

  // ─────────── 对话历史 ───────────
  if (convs.length) {
    body.appendChild(section('练过的对话'));
    const list = card('flat');
    for (const c of convs.slice(0, 12)) {
      const row = el('div', 'ec-row');
      const d = new Date(c.startedAt);
      row.innerHTML = `<div class="ec-row-main">
          <div class="ec-row-title">${esc(c.scenarioId)}</div>
          <div class="ec-row-sub">${d.getMonth() + 1}月${d.getDate()}日 · ${c.clearedStages.length} 步 · ${c.missionComplete ? '<span class="ec-tag ok">完成</span>' : '<span class="ec-tag warn">未完成</span>'}</div>
        </div>`;
      const open = button('复盘', 'small ghost', () => h.openConversation(c.id));
      row.appendChild(open);
      list.appendChild(row);
    }
    body.appendChild(list);
  }

  return root;
}

/** 极简折线图。不引图表库——这里只需要一条线 */
function sparkline(values: number[]): HTMLElement {
  const w = 300;
  const hgt = 60;
  const pad = 4;
  const max = Math.max(...values, 1);
  const step = values.length > 1 ? (w - pad * 2) / (values.length - 1) : 0;
  const pts = values
    .map((v, i) => `${pad + i * step},${hgt - pad - (v / max) * (hgt - pad * 2)}`)
    .join(' ');
  const svg = el('div', '');
  svg.innerHTML = `<svg class="ec-curve" viewBox="0 0 ${w} ${hgt}" preserveAspectRatio="none" role="img" aria-label="错误密度趋势">
    <polyline class="line" points="${pts}"/>
  </svg>`;
  return svg;
}

/** 能力曲线：把每天的综合等级画成一条线 */
function levelCurve(points: ProgressPoint[]): HTMLElement {
  const w = 320;
  const hgt = 120;
  const pad = 18;
  const pts = points.slice(-20);
  const idx = (p: ProgressPoint) => {
    const vals = SKILLS.map((k) => p.levels[k]).filter(Boolean) as string[];
    if (!vals.length) return 0;
    const order = ['A1', 'A2', 'B1', 'B2', 'C1'];
    return vals.reduce((s, v) => s + order.indexOf(v), 0) / vals.length;
  };
  const step = pts.length > 1 ? (w - pad * 2) / (pts.length - 1) : 0;
  const y = (v: number) => hgt - pad - (v / 4) * (hgt - pad * 2);
  const line = pts.map((p, i) => `${pad + i * step},${y(idx(p))}`).join(' ');
  const dots = pts.map((p, i) => `<circle class="dot" cx="${pad + i * step}" cy="${y(idx(p))}" r="2.5"/>`).join('');
  const grid = ['A1', 'A2', 'B1', 'B2', 'C1']
    .map((l, i) => `<text x="0" y="${y(i) + 3}">${l}</text>`)
    .join('');

  const wrap = el('div', '');
  wrap.innerHTML = `<svg class="ec-curve" viewBox="0 0 ${w} ${hgt}" role="img" aria-label="能力曲线">
    ${grid}<polyline class="line" points="${line}"/>${dots}
  </svg>`;
  wrap.appendChild(
    el('div', 'ec-muted', `${pts[0]?.date ?? ''} → ${pts[pts.length - 1]?.date ?? ''}，取各项等级的平均。`),
  );
  return wrap;
}
