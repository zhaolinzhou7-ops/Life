/**
 * 能力报告
 *
 * 这一页决定了用户会不会相信这个产品。
 *
 * "你的等级是 B1" 之所以没有价值，是因为它既不能指导行动，也无法被验证。
 * 所以这一页的结构是：
 *
 *   分技能等级（每一项都能点开看凭什么） → 一句话说清瓶颈 → 支撑它的真实数据
 *   → 这次暴露出来的具体问题 → 接下来做什么
 *
 * 每一个数字旁边都有"它是怎么算的"。用户可以不看，但必须能看到。
 */

import type { Assessment, SkillKey } from '../types';
import { CEFR_LABEL, SKILLS, SKILL_LABEL, cefrIndex } from '../types';
import { evidenceFor, overallLevel } from '../engine/assess';
import { button, card, collapsible, el, esc, levelBadge, metricGrid, page, section, topbar, mountTopbar} from './ui';
import { renderCorrections } from './practice';

export interface ReportHandlers {
  back: () => void;
  /** 报告看完 → 生成计划开始学 */
  start?: () => void;
  /** 重新测一次 */
  retest?: () => void;
}

export function renderReport(a: Assessment, h: ReportHandlers, opts: { firstTime?: boolean } = {}): HTMLElement {
  const { root, body, foot } = page();
  mountTopbar(root, topbar('你的能力画像', h.back));

  const overall = overallLevel(a.levels);

  // ——— 总览 ———
  const head = card();
  head.innerHTML = `<div class="ec-row-sub">综合</div>`;
  const line = el('div', 'ec-row');
  line.appendChild(levelBadge(overall, 'lg'));
  line.appendChild(
    el(
      'div',
      'ec-row-main',
      `<div class="ec-row-title">${esc(CEFR_LABEL[overall])}</div>
       <div class="ec-row-sub">按接收能力和产出能力各占一半算出来的</div>`,
    ),
  );
  head.appendChild(line);
  body.appendChild(head);

  // ——— 分技能 ———
  body.appendChild(section('分项', '点一下能看到每一项是凭什么判的。'));
  const skills = card();
  for (const k of SKILLS) {
    const lvl = a.levels[k];
    const row = el('div', 'ec-skillrow');
    row.appendChild(el('div', 'ec-skill-name', SKILL_LABEL[k]));
    const track = el('div', 'ec-skill-track');
    const pct = ((cefrIndex(lvl) + 1) / 5) * 100;
    // 明显低于自己其它项的那一条标成警示色，让瓶颈一眼可见
    const weakest = Math.min(...SKILLS.map((s) => cefrIndex(a.levels[s])));
    const fill = el('div', `ec-skill-fill${cefrIndex(lvl) === weakest && weakest < 4 ? ' low' : ''}`);
    fill.style.width = `${pct}%`;
    track.appendChild(fill);
    row.appendChild(track);
    row.appendChild(levelBadge(lvl));
    skills.appendChild(row);

    const ev = el('div', 'ec-skill-evidence', esc(evidenceFor(k as SkillKey, a.metrics)));
    ev.style.display = 'none';
    row.style.cursor = 'pointer';
    row.addEventListener('click', () => {
      ev.style.display = ev.style.display === 'none' ? '' : 'none';
    });
    skills.appendChild(ev);
  }
  body.appendChild(skills);

  // ——— 瓶颈：这一页真正的产出 ———
  body.appendChild(section('你的主要瓶颈'));
  const bn = card();
  bn.appendChild(el('div', 'ec-row-title', esc(a.bottleneck.title)));
  const ul = el('div', '');
  for (const e of a.bottleneck.evidence) {
    ul.appendChild(el('div', 'ec-row-sub', `· ${esc(e)}`));
  }
  bn.appendChild(ul);
  if (a.bottleneck.focus.length) {
    bn.appendChild(
      el(
        'div',
        'ec-explain',
        `接下来会把时间偏向${a.bottleneck.focus.map((f) => SKILL_LABEL[f]).join('和')}。`,
      ),
    );
  }
  body.appendChild(bn);

  // ——— 文字总结 ———
  const sum = card('flat');
  for (const s of a.summary) sum.appendChild(el('div', '', esc(s)));
  body.appendChild(sum);

  // ——— 这次发现的具体问题 ———
  if (a.findings.length) {
    body.appendChild(
      section(`这次暴露出来的问题（${a.findings.length} 处）`, '已经存进你的错误档案，后面会按它们安排专项练习。'),
    );
    body.appendChild(renderCorrections(a.findings.slice(0, 5)));
    if (a.findings.length > 5) {
      body.appendChild(collapsible(`还有 ${a.findings.length - 5} 处`, renderCorrections(a.findings.slice(5))));
    }
  }

  // ——— 原始数据 ———
  body.appendChild(collapsible('这份报告用到的全部数据', metricGrid(Object.entries(a.metrics))));

  body.appendChild(
    el(
      'div',
      'ec-caveat',
      '关于准确度：这份诊断是十四道题得出的，用来定学习方向足够，但不是权威等级认定。练上两周之后重测一次会更准。',
    ),
  );

  if (h.start) {
    foot.appendChild(button(opts.firstTime ? '好，开始今天的训练' : '回到今日训练', 'primary block', h.start));
  }
  if (h.retest) foot.appendChild(button('重新测一次', 'ghost block', h.retest));
  return root;
}
