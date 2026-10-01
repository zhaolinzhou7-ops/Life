/**
 * 发育预警对照。
 *
 * 红线：只有"能做到 / 还做不到 / 不确定"三种状态；不显示"几项里做到几项"、
 * 不算百分比、不和任何人比较。任何一项"还做不到"，就提示去儿保门诊复查。
 */

import { ageOn, formatFull, isValidDate, todayStr } from '../dates';
import { evaluate, GROUPS, phaseOf, REGRESSION_ID, type MilestoneGroup } from '../milestones';
import { setBirthDate, setMark, state } from '../store';
import type { MarkStatus } from '../types';
import type { Ctx } from './context';
import { el, saveFailed, segmented, toast } from './ui';

const ABILITY = [
  { value: 'yes', label: '能做到' },
  { value: 'no', label: '还做不到' },
  { value: 'unsure', label: '不确定' },
] as const;

const REGRESSION = [
  { value: 'no', label: '没有' },
  { value: 'yes', label: '有' },
  { value: 'unsure', label: '不确定' },
] as const;

function mark(ctx: Ctx, id: string, v: MarkStatus) {
  const p = setMark(id, v);
  ctx.refresh();
  p.catch(saveFailed);
}

function updatedLine(id: string): HTMLElement | null {
  const m = state.marks.get(id);
  if (!m) return null;
  return el('div', 'g-updated', `更新于 ${formatFull(todayStr(new Date(m.updatedAt)))}`);
}

export function renderGrowth(ctx: Ctx): HTMLElement {
  const page = el('section', 'g-page g-growth');
  const head = el('header', 'g-head');
  head.appendChild(el('h1', '', '发育对照'));
  page.appendChild(head);

  const note = el('div', 'g-disclaimer');
  note.append(
    el('strong', '', '筛查参考，不是诊断。'),
    document.createTextNode('能力项据国家卫健委《儿童心理行为发育问题预警征象筛查表》整理，与儿保门诊版本不一致时，以门诊为准。'),
  );
  page.appendChild(note);

  const today = todayStr();
  const birth = state.profile?.birthDate ?? '';
  const age = birth ? ageOn(birth, today) : null;

  // 出生日期
  const bcard = el('div', 'g-card g-birth');
  const blabel = el('label', 'g-field');
  blabel.appendChild(el('span', 'g-field-label', '孩子的出生日期'));
  const binput = el('input', 'g-input g-date');
  binput.type = 'date';
  binput.max = today;
  binput.value = birth;
  binput.addEventListener('change', async () => {
    const v = binput.value;
    if (!v || !isValidDate(v) || v > today) {
      toast('出生日期不对，请重新选', 'err', 2500);
      binput.value = birth;
      return;
    }
    const p = setBirthDate(v);
    ctx.refresh();
    try {
      await p;
    } catch (err) {
      saveFailed(err);
    }
  });
  blabel.appendChild(binput);
  bcard.appendChild(blabel);
  bcard.appendChild(
    el(
      'p',
      'g-field-hint',
      age ? `现在 ${age.years} 岁${age.months ? ` ${age.months} 个月` : ''}。只存在这台手机里，用来决定对照哪个年龄段。` : '只存在这台手机里，用来决定对照哪个年龄段。',
    ),
  );
  page.appendChild(bcard);

  const ev = evaluate(state.marks, age ? age.years : null);

  // 提示：倒退最要紧，放最上面
  if (ev.regression === 'yes') {
    const a = el('div', 'g-alert urgent');
    a.setAttribute('role', 'alert');
    a.append(el('strong', '', '请尽快带孩子就医'), el('p', '', '出现语言或社交能力倒退，任何年龄都需要尽快就诊（儿保门诊或发育行为儿科）。'));
    page.appendChild(a);
  }
  if (ev.needVisit.length) {
    const a = el('div', 'g-alert visit');
    a.setAttribute('role', 'alert');
    a.append(
      el('strong', '', '建议到儿保门诊复查'),
      el('p', '', `标了“还做不到”的：${ev.needVisit.map((i) => i.text).join('；')}。去的时候可以把这些告诉医生。`),
    );
    page.appendChild(a);
  }
  if (ev.unsure.length || ev.regression === 'unsure') {
    page.appendChild(el('div', 'g-alert soft', '标了“不确定”的，可以多观察几天，或者下次体检时问问医生。'));
  }

  // 倒退：任何年龄都问
  const reg = el('div', 'g-card g-mitem g-regression');
  reg.dataset.id = REGRESSION_ID;
  reg.append(
    el('div', 'g-mgroup-tag', '任何年龄都要留意'),
    el('div', 'g-mtext', '最近有没有出现：原来会说的话、会做的交往（比如叫人、对视、一起玩）变少了，或者不会了？'),
    segmented(REGRESSION, state.marks.get(REGRESSION_ID)?.status ?? null, (v) => mark(ctx, REGRESSION_ID, v), { label: '有没有出现倒退' }),
  );
  const ru = updatedLine(REGRESSION_ID);
  if (ru) reg.appendChild(ru);
  page.appendChild(reg);

  if (!age) {
    page.appendChild(el('p', 'g-empty', '先填上出生日期，才知道该对照哪个年龄段。'));
    return page;
  }

  const years = age.years;
  const current = GROUPS.filter((g) => phaseOf(g.age, years) === 'current');
  const past = GROUPS.filter((g) => phaseOf(g.age, years) === 'past');
  const future = GROUPS.filter((g) => phaseOf(g.age, years) === 'future');

  if (!current.length) page.appendChild(el('p', 'g-hint', '这张表从 4 岁开始对照（这里只收录了 4–6 岁）。'));
  for (const g of current) page.appendChild(groupBlock(ctx, g, 'current'));
  if (past.length) {
    // 更早年龄段里有"还做不到"时默认展开，别藏起来
    const hasNo = past.some((g) => g.items.some((i) => state.marks.get(i.id)?.status === 'no'));
    page.appendChild(fold('past', `更早的年龄段（${past.map((g) => `${g.age} 岁`).join('、')}）`, hasNo, past.map((g) => groupBlock(ctx, g, 'past'))));
  }
  if (future.length) {
    page.appendChild(fold('future', `以后的年龄段（${future.map((g) => `${g.age} 岁`).join('、')}）`, false, future.map((g) => groupBlock(ctx, g, 'future'))));
  }
  if (years >= 7) page.appendChild(el('p', 'g-hint', '这张表只到 6 岁。'));
  return page;
}

// 点选状态后整页会重画，记住哪些折叠区是打开的
const openFolds = new Set<string>();

function fold(key: string, title: string, forceOpen: boolean, children: HTMLElement[]): HTMLElement {
  const d = el('details', 'g-fold');
  d.appendChild(el('summary', '', title));
  d.append(...children);
  d.open = forceOpen || openFolds.has(key);
  d.addEventListener('toggle', () => {
    if (d.open) openFolds.add(key);
    else openFolds.delete(key);
  });
  return d;
}

function groupBlock(ctx: Ctx, g: MilestoneGroup, phase: 'past' | 'current' | 'future'): HTMLElement {
  const box = el('div', `g-mgroup p-${phase}`);
  box.dataset.age = String(g.age);
  const title = el('h2', 'g-mgroup-title', `${g.age} 岁`);
  box.appendChild(title);
  if (phase === 'future') box.appendChild(el('p', 'g-hint', `满 ${g.age} 岁时再对照。现在做不到很正常，不用标。`));
  for (const item of g.items) {
    const row = el('div', 'g-card g-mitem');
    row.dataset.id = item.id;
    row.appendChild(el('div', 'g-mtext', item.text));
    if (phase !== 'future') {
      row.appendChild(segmented(ABILITY, state.marks.get(item.id)?.status ?? null, (v) => mark(ctx, item.id, v), { label: item.text }));
      const u = updatedLine(item.id);
      if (u) row.appendChild(u);
    }
    box.appendChild(row);
  }
  return box;
}
