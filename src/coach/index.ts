/**
 * 成年人 AI 英语教练 · 启动入口
 *
 * 和仓库里其它应用保持一致：导出一个 boot 函数，接管 app 容器，返回清理函数。
 * 路由用最朴素的视图栈——这个应用十来个页面，引一套路由库的收益抵不过
 * 它的心智负担。
 *
 * 这一层除了路由，还负责一件重要的事：**把一次训练串成一条线**。
 * 首页点"开始今天的训练"之后，用户不应该再做任何选择，
 * 练完一项自动进下一项，最后回到首页看到今天完成了。
 */

import './coach.css';
import type { Assessment, Conversation, LearningPlan, PlanActivity, Scenario } from '../coach/types';
import { ACTIVITY_LABEL, SKILLS } from './types';
import { getScenario } from './data/scenarios';
import { buildPlan } from './engine/plan';
import { overallLevel } from './engine/assess';
import { recordErrors } from './engine/errors';
import { analyze } from './engine/analyze';
import { stopSpeaking } from './engine/speech';
import {
  addProgressPoint,
  getAssessments,
  getConversation,
  getErrorProfile,
  getPlan,
  getProfile,
  getUser,
  getVocabAll,
  getSpeaking,
  getWriting,
  hasAssessment,
  markActivityDone,
  recordStudy,
  saveAssessment,
  saveErrorProfile,
  savePlan,
  saveProfile,
  today,
} from './store';
import { renderAssessment } from './views/assess';
import { renderConversation, renderDebrief } from './views/conversation';
import { renderHome, renderOnboard } from './views/home';
import { renderLibrary, renderScenarioIntro } from './views/library';
import { ACTIVITY_RENDERER, type ActivityCtx } from './views/practice';
import { renderProgress } from './views/progress';
import { renderReport } from './views/report';
import { renderSettings } from './views/settings';
import { el, errorState, page, toast, topbar, mountTopbar} from './views/ui';

export function bootCoach(app: HTMLElement, onExit: () => void): () => void {
  const root = el('div', 'ec-app');
  app.appendChild(root);

  /** 视图栈。每一项是渲染函数，pop 之后重新渲染上一层，保证数据是新的 */
  const stack: (() => HTMLElement)[] = [];
  /** 这一次训练从什么时候开始，用来记真实时长 */
  let sessionStart = 0;

  function paint() {
    stopSpeaking();
    root.innerHTML = '';
    root.scrollTop = 0;
    const top = stack[stack.length - 1];
    if (top) {
      try {
        root.appendChild(top());
      } catch (e) {
        // 任何一个页面渲染炸了，都不能让用户面对一个白屏
        const msg = e instanceof Error ? e.message : String(e);
        root.appendChild(errorState(`页面没能打开：${msg}`, () => back()));
      }
    }
  }

  function push(view: () => HTMLElement) {
    stack.push(view);
    paint();
  }

  function back() {
    if (stack.length <= 1) {
      onExit();
      return;
    }
    stack.pop();
    paint();
  }

  /** 替换当前层。用于"看完报告回首页"这种不该留历史的跳转 */
  function replace(view: () => HTMLElement) {
    stack.pop();
    stack.push(view);
    paint();
  }

  /** 回到首页那一层 */
  function home() {
    while (stack.length > 1) stack.pop();
    paint();
  }

  /**
   * 把视图栈重置成"首页 + 指定页面"。
   *
   * 入门和测评是从栈底一路 replace 上来的，走完之后栈底站着的是报告页，
   * 而不是首页——于是"开始今天的训练"只会把报告页重画一遍，用户永远
   * 到不了首页。这个函数负责在流程结束时把首页放回栈底。
   */
  function rebaseOnHome(view: () => HTMLElement) {
    stack.length = 0;
    stack.push(homeView);
    push(view);
  }

  // ─────────────────── 计划 ───────────────────

  /**
   * 拿到今天的计划。已经有就用已有的——同一天反复进来看到同一份计划，
   * 这样"今天的训练"才是一件确定的事，而不是每次刷新都变。
   */
  function todayPlan(): LearningPlan | undefined {
    if (!hasAssessment()) return undefined;
    const date = today();
    const existing = getPlan(date);
    if (existing) return existing;
    const profile = getProfile();
    const user = getUser();
    const plan = buildPlan({
      profile,
      errors: getErrorProfile(),
      vocab: getVocabAll(),
      dailyMinutes: user.dailyMinutes,
      goals: user.goals,
      bottleneck: profile.bottleneck,
      date,
    });
    savePlan(plan);
    return plan;
  }

  // ─────────────────── 页面 ───────────────────

  const homeView = () =>
    renderHome(todayPlan(), getProfile(), hasAssessment(), {
      startSession: () => startSession(0),
      openActivity: (idx) => startSession(idx),
      openAssessment: () => push(assessView),
      openReport: () => {
        const a = latestAssessment();
        if (a) push(() => reportView(a, false));
        else toast('还没有测评结果');
      },
      openProgress: () => push(progressView),
      openLibrary: () => push(libraryView),
      openSettings: () => push(settingsView),
      exit: onExit,
    });

  const onboardView = () =>
    renderOnboard(() => {
      // 填完资料直接进测评，中间不再插一个"完成"页
      replace(assessView);
    }, onExit);

  const assessView = () =>
    renderAssessment({
      back,
      done: (a) => {
        saveAssessment(a);
        // 把测评结论写进画像——这是 AI 教练后面每次开口都要读的东西
        saveProfile({
          levels: a.levels,
          overall: overallLevel(a.levels),
          bottleneck: a.bottleneck,
        });
        // 测评里发现的问题必须真的进错误档案：报告页上写着"已经存进你的
        // 错误档案，后面会按它们安排专项练习"，不写进去那句话就是假的
        if (a.findings.length) saveErrorProfile(recordErrors(getErrorProfile(), a.findings));
        addProgressPoint({ date: today(), levels: a.levels, minutes: 0 });
        rebaseOnHome(() => reportView(a, true));
      },
    });

  const reportView = (a: Assessment, firstTime: boolean) =>
    renderReport(
      a,
      {
        back,
        start: () => home(),
        retest: firstTime ? undefined : () => replace(assessView),
      },
      { firstTime },
    );

  const progressView = () =>
    renderProgress({
      back,
      openConversation: (id) => {
        const conv = getConversation(id);
        const scen = conv ? getScenario(conv.scenarioId) : undefined;
        if (conv && scen && conv.debrief) push(() => debriefView(conv, scen));
        else toast('这一局没有留下复盘');
      },
    });

  const debriefView = (conv: Conversation, scen: Scenario) => {
    const { root: r, body } = page();
    mountTopbar(r, topbar(`${scen.title} · 复盘`, back));
    body.appendChild(renderDebrief(conv, scen, conv.debrief!));
    return r;
  };

  const libraryView = () =>
    renderLibrary({
      back,
      open: (s) => push(() => introView(s)),
    });

  const introView = (s: Scenario) =>
    renderScenarioIntro(s, {
      back,
      start: () => push(() => conversationView(s)),
    });

  const conversationView = (s: Scenario) =>
    renderConversation(s, {
      back,
      onFinish: () => {
        finishActivityIfRunning();
        home();
      },
      onRetry: () => replace(() => conversationView(s)),
    });

  const settingsView = () =>
    renderSettings({
      back,
      onReset: () => {
        stack.length = 0;
        push(onboardView);
      },
    });

  // ─────────────────── 训练编排 ───────────────────

  /**
   * 把今天的计划串成一条线：练完一项自动进下一项。
   *
   * 中途退出不会丢进度——每完成一项就立刻写进存档，
   * 用户明天回来看到的是"还剩两项"，而不是从头再来。
   */
  let running: { plan: LearningPlan; index: number } | null = null;

  function startSession(fromIndex: number) {
    const plan = todayPlan();
    if (!plan || !plan.activities.length) {
      toast('今天没有安排训练');
      return;
    }
    if (!sessionStart) sessionStart = Date.now();
    // 从指定项开始；如果该项已完成，跳到第一个没做的
    let idx = fromIndex;
    if (plan.activities[idx]?.done) {
      const next = plan.activities.findIndex((a) => !a.done);
      idx = next >= 0 ? next : fromIndex;
    }
    running = { plan, index: idx };
    push(() => activityView());
  }

  function finishActivityIfRunning() {
    if (!running) return;
    const act = running.plan.activities[running.index];
    if (act) markActivityDone(running.plan.date, act.id);
  }

  function nextActivity() {
    if (!running) {
      home();
      return;
    }
    finishActivityIfRunning();
    const plan = getPlan(running.plan.date) ?? running.plan;
    running.plan = plan;
    const next = plan.activities.findIndex((a, i) => i > running!.index && !a.done);
    if (next >= 0) {
      running.index = next;
      replace(() => activityView());
      return;
    }
    // 全部练完
    endSession();
  }

  function endSession() {
    const plan = running?.plan;
    running = null;
    const minutes = sessionStart ? Math.max(1, Math.round((Date.now() - sessionStart) / 60000)) : 0;
    sessionStart = 0;
    if (minutes) {
      const profile = recordStudy(minutes);
      // 能力曲线上落一个点。等级来自画像，错误密度来自今天真实的练习记录
      addProgressPoint({
        date: today(),
        levels: profile.levels,
        errorPer100: todayErrorRate(),
        minutes,
      });
    }
    home();
    if (plan) toast(`今天练完了，约 ${minutes} 分钟`);
  }

  /** 今天所有口语/写作记录的平均错误密度。没有记录就返回 undefined，不要编 */
  function todayErrorRate(): number | undefined {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const rows = [...getSpeaking(), ...getWriting()].filter(
      (r) => r.at >= start.getTime() && (r.metrics.wordCount?.value ?? 0) >= 8,
    );
    if (!rows.length) return undefined;
    const sum = rows.reduce((s, r) => s + (r.metrics.errorPer100?.value ?? 0), 0);
    return Math.round((sum / rows.length) * 10) / 10;
  }

  function activityView(): HTMLElement {
    if (!running) return homeView();
    const act: PlanActivity | undefined = running.plan.activities[running.index];
    if (!act) return homeView();

    const ctx: ActivityCtx = {
      // 和首页用同一套拼法：类型 + 具体内容
      title: `${ACTIVITY_LABEL[act.kind]} · ${act.title}`,
      onDone: nextActivity,
      onExit: () => {
        running = null;
        home();
      },
    };

    // 情景对话有自己的复盘流程，单独走
    if (act.kind === 'scenario') {
      const s = act.payload?.scenarioId ? getScenario(act.payload.scenarioId) : undefined;
      if (s) {
        return renderConversation(s, {
          back: ctx.onExit,
          onFinish: nextActivity,
          onRetry: () => replace(() => activityView()),
        });
      }
    }

    return ACTIVITY_RENDERER[act.kind](act.payload, ctx);
  }

  // ─────────────────── 启动 ───────────────────

  const latestAssessment = (): Assessment | undefined => getAssessments()[0];

  const user = getUser();
  const needsOnboard = !user.goals.length && !hasAssessment();
  push(needsOnboard ? onboardView : homeView);

  return () => {
    stopSpeaking();
    root.remove();
    document.querySelector('.ec-toast')?.remove();
  };
}

/** 给外部（测试、其它页面）用：和界面里跑的是同一套分析 */
export const analyzeText = analyze;
export const ALL_SKILLS = SKILLS;
