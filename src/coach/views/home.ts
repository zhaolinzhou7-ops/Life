/**
 * 首屏：入门设置 + 今日训练
 *
 * 首页只回答一个问题：**我今天到底应该学什么。**
 *
 * 所以进来看到的是一份已经排好的清单和一个"开始"按钮，不是一个课程目录。
 * 让用户在几十门课里挑今天学哪个，是把产品该做的决策推给了用户——
 * 而这恰恰是成年人最缺的那点意志力最先被消耗掉的地方。
 *
 * 首页刻意**没有**的东西（第 16 节）：打卡日历、火苗、积分、徽章墙、
 * "再学 5 分钟就能保住连续记录！"。连续天数只作为一行小字存在，
 * 断了也不会有任何惩罚性的视觉提示。
 */

import type { GoalKey, LearningPlan, UserProfile } from '../types';
import { ACTIVITY_LABEL, CEFR_LABEL, GOAL_LABEL, SKILLS, SKILL_LABEL, cefrIndex } from '../types';
import { summarize, topErrors } from '../engine/errors';
import { usableCount } from '../engine/srs';
import { reviewDebt } from '../engine/plan';
import { engineLabel } from '../ai/providers';
import { getErrorProfile, getUser, getVocabAll, isStorageBroken, saveUser } from '../store';
import {
  button,
  card,
  chips,
  el,
  engineNote,
  esc,
  field,
  levelBadge,
  mountTopbar,
  page,
  progressBar,
  section,
  textInput,
} from './ui';

// ══════════════════════════════════════════════════════════
//  第一次进来
// ══════════════════════════════════════════════════════════

export function renderOnboard(onNext: () => void, onExit: () => void): HTMLElement {
  const { root, body, foot } = page();
  const user = getUser();

  mountTopbar(
    root,
    (() => {
      const bar = el('div', 'ec-topbar');
      const back = el('button', 'ec-back', '‹');
      back.type = 'button';
      back.setAttribute('aria-label', '返回');
      back.addEventListener('click', onExit);
      bar.appendChild(back);
      bar.appendChild(el('div', 'ec-topbar-title', ''));
      return bar;
    })(),
  );

  body.appendChild(el('h1', '', '先花两分钟，把你的情况说清楚'));
  body.appendChild(
    el(
      'div',
      'ec-sub',
      '这不是注册。所有内容都只存在这台设备上，不上传到任何地方，也不需要账号。',
    ),
  );

  const nameInput = textInput('怎么称呼你（可以不填）', user.name);
  body.appendChild(field('称呼', '只用来在页面上叫你，留空也行。', nameInput));

  const goals = new Set<string>(user.goals);
  body.appendChild(
    field(
      '你学英语是为了什么',
      '可以多选。这会直接决定你学到的词和练到的场景——学了马上能用上，才记得住。',
      chips(
        (Object.keys(GOAL_LABEL) as GoalKey[]).map((k) => ({ key: k, label: GOAL_LABEL[k] })),
        goals,
        () => undefined,
      ),
    ),
  );

  const mins = new Set<string>([String(user.dailyMinutes || 20)]);
  body.appendChild(
    field(
      '每天愿意花多少时间',
      '按你最忙的那天填，不要填你最理想的那天。排不满比排太满好——排太满的计划第三天就会被跳过。',
      chips(
        [
          { key: '10', label: '10 分钟' },
          { key: '20', label: '20 分钟' },
          { key: '30', label: '30 分钟' },
          { key: '45', label: '45 分钟' },
        ],
        mins,
        () => undefined,
        { single: true },
      ),
    ),
  );

  const go = button('下一步：做个能力诊断', 'primary block');
  go.addEventListener('click', () => {
    saveUser({
      name: nameInput.value.trim(),
      goals: [...goals] as GoalKey[],
      dailyMinutes: Number([...mins][0] ?? 20) || 20,
    });
    onNext();
  });
  foot.appendChild(go);
  return root;
}

// ══════════════════════════════════════════════════════════
//  今日训练
// ══════════════════════════════════════════════════════════

export interface HomeHandlers {
  startSession: () => void;
  openActivity: (index: number) => void;
  openAssessment: () => void;
  openReport: () => void;
  openProgress: () => void;
  openLibrary: () => void;
  openSettings: () => void;
  exit: () => void;
}

export function renderHome(
  plan: LearningPlan | undefined,
  profile: UserProfile,
  hasAssessment: boolean,
  h: HomeHandlers,
): HTMLElement {
  const { root, body, foot } = page();
  const user = getUser();

  // 顶栏：只放两个不常用的入口，不做底部 tab —— 这个产品的主线是一条路，
  // 不是四个并列的板块
  const bar = el('div', 'ec-topbar');
  const back = el('button', 'ec-back', '‹');
  back.type = 'button';
  back.setAttribute('aria-label', '返回合集');
  back.addEventListener('click', h.exit);
  bar.appendChild(back);
  bar.appendChild(el('div', 'ec-topbar-title', 'AI 英语教练'));
  const right = el('div', 'ec-topbar-right');
  right.appendChild(button('进步', 'small ghost', h.openProgress));
  right.appendChild(button('设置', 'small ghost', h.openSettings));
  bar.appendChild(right);
  mountTopbar(root, bar);

  if (isStorageBroken()) {
    body.appendChild(
      engineNote('这台设备存不了数据（可能开了无痕模式）。这次练习照常能用完，但关掉页面后记录会丢。', 'warn'),
    );
  }

  // ——— 还没测评：首页就是一件事 ———
  if (!hasAssessment) {
    body.appendChild(el('h1', '', `${user.name ? user.name + '，' : ''}先搞清楚你卡在哪`));
    body.appendChild(
      el(
        'div',
        'ec-sub',
        '六到八分钟，测阅读、听力、词汇、语法和开口表达。测完你会拿到一份说人话的报告——不是一个等级，是"你为什么说不出来"。',
      ),
    );
    const c = card();
    c.innerHTML = `
      <div class="ec-row-title">会测这些</div>
      <div class="ec-row-sub">· 输入：阅读 / 听力 / 词汇认得出</div>
      <div class="ec-row-sub">· 输出：翻译 / 写作 / 词汇用得上</div>
      <div class="ec-row-sub">· 交流：一段自由表达（说或打）</div>`;
    body.appendChild(c);
    foot.appendChild(button('开始诊断', 'primary block', h.openAssessment));
    foot.appendChild(button('先随便逛逛场景库', 'ghost block', h.openLibrary));
    return root;
  }

  // ——— 今日训练 ———
  const done = plan ? plan.activities.filter((a) => a.done).length : 0;
  const total = plan?.activities.length ?? 0;
  const allDone = total > 0 && done === total;

  const headRow = el('div', 'ec-today-head');
  headRow.appendChild(el('h1', '', allDone ? '今天练完了' : '今日训练'));
  if (plan) headRow.appendChild(el('div', 'ec-today-min', `约 ${plan.totalMinutes} 分钟`));
  body.appendChild(headRow);

  if (plan?.rationale) body.appendChild(el('div', 'ec-why', `为什么是这些：${plan.rationale}`));

  if (plan && total > 0) {
    body.appendChild(progressBar(done, total, `${done} / ${total}`));

    plan.activities.forEach((act, idx) => {
      const c = card(`ec-act tappable${act.done ? ' done' : ''}`);
      c.appendChild(el('div', 'ec-act-idx', act.done ? '✓' : String(idx + 1)));
      const main = el('div', 'ec-act-main');
      main.appendChild(el('div', 'ec-act-title', `${ACTIVITY_LABEL[act.kind]} · ${esc(act.title)}`));
      main.appendChild(el('div', 'ec-act-why', esc(act.why)));
      c.appendChild(main);
      c.appendChild(el('div', 'ec-act-min', `${act.minutes}′`));
      c.addEventListener('click', () => h.openActivity(idx));
      body.appendChild(c);
    });
  } else {
    body.appendChild(el('div', 'ec-explain', '今天的计划还没排出来，点下面的按钮生成。'));
  }

  // ——— 画像摘要：一行字告诉用户教练记得他 ———
  body.appendChild(section('教练记得你什么'));
  const prof = card('flat');
  const levelLine = el('div', 'ec-row');
  if (profile.overall) {
    levelLine.appendChild(levelBadge(profile.overall));
    levelLine.appendChild(
      el('div', 'ec-row-main', `<div class="ec-row-sub">综合 ${esc(CEFR_LABEL[profile.overall])}</div>`),
    );
  }
  prof.appendChild(levelLine);

  const weak = SKILLS.filter((k) => profile.levels[k])
    .sort((a, b) => cefrIndex(profile.levels[a]!) - cefrIndex(profile.levels[b]!))
    .slice(0, 2);
  if (weak.length) {
    prof.appendChild(
      el('div', 'ec-row-sub', `最弱的两项：${weak.map((k) => `${SKILL_LABEL[k]} ${profile.levels[k]}`).join(' · ')}`),
    );
  }
  if (profile.bottleneck) prof.appendChild(el('div', 'ec-row-title', esc(profile.bottleneck.title)));
  const errSummary = summarize(getErrorProfile());
  if (errSummary) prof.appendChild(el('div', 'ec-row-sub', esc(errSummary)));
  const openReport = button('看完整报告', 'small ghost', h.openReport);
  prof.appendChild(openReport);
  body.appendChild(prof);

  // ——— 三个真实的数字 ———
  const vocab = getVocabAll();
  const stats = el('div', 'ec-stats');
  const stat = (n: string | number, label: string) => {
    const s = el('div', 'ec-stat');
    s.innerHTML = `<b>${esc(String(n))}</b><span>${esc(label)}</span>`;
    return s;
  };
  stats.appendChild(stat(usableCount(vocab), '会用的词'));
  stats.appendChild(stat(reviewDebt(vocab), '待复习'));
  stats.appendChild(stat(profile.streak, '连续天数'));
  body.appendChild(stats);
  body.appendChild(
    el('div', 'ec-muted', '"会用的词"指的是掌握度到了"会使用"以上的——认得出但用不出来的不算在里面。'),
  );

  // ——— 错误档案入口 ———
  const errs = topErrors(getErrorProfile(), 3);
  if (errs.length) {
    body.appendChild(section('还没改掉的毛病'));
    const c = card('flat');
    for (const e of errs) {
      const row = el('div', 'ec-row');
      row.innerHTML = `<div class="ec-row-main"><div class="ec-row-title">${esc(e.label)}</div>
        <div class="ec-row-sub">累计 ${e.count} 次 · 连续改对 ${e.clearedStreak}/3 次就毕业</div></div>`;
      c.appendChild(row);
    }
    body.appendChild(c);
  }

  // ——— 自由练习入口 ———
  body.appendChild(section('不按计划，自己挑'));
  const lib = card('tappable');
  lib.innerHTML = `<div class="ec-row-title">场景库</div>
    <div class="ec-row-sub">日常、旅行、工作，十几个有明确任务的情景对话。</div>`;
  lib.addEventListener('click', h.openLibrary);
  body.appendChild(lib);

  const eng = engineLabel();
  body.appendChild(engineNote(`AI：${eng.text}。纠错、评分、任务判定始终由本地完成，不依赖网络。`, eng.tag));

  foot.appendChild(
    button(allDone ? '再练一轮' : done > 0 ? '继续今天的训练' : '开始今天的训练', 'primary block', h.startSession),
  );
  return root;
}
