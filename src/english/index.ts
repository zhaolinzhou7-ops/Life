/**
 * AI 儿童英语学习伙伴 · 启动入口
 *
 * 和仓库里其它应用一致：导出一个 boot 函数，接管 app 容器，返回清理函数。
 *
 * 路由是一个朴素的视图栈。整个应用十几个页面，引路由库的收益抵不过它的负担。
 *
 * 这里同时是「一次学习」的流程控制器：按今日任务的步骤依次推进，
 * 中途退出再进来能接着上次的位置——孩子被叫去吃饭是常态，
 * 回来发现要从头做起，第二天就不会再打开了。
 */

import './english.css';
import type { SessionRecord } from './types';
import { activeChildId, getChildData, saveChild, type ChildData } from './store';
import { ensureMission, nextStep } from './plan';
import { startSession } from './session';
import { cancelSpeech } from './speech/tts';
import { stopListening } from './speech/recognizer';
import { dayKey } from './engine/util';
import type { Ctx, View } from './ui';
import { el } from './ui';
import { renderOnboard } from './kid/onboard';
import { renderKidHome } from './kid/home';
import { renderAssess } from './kid/assess';
import { renderWords } from './kid/words';
import { renderGame } from './kid/game';
import { renderStory } from './kid/story';
import { renderTalk } from './kid/talk';
import { renderDone } from './kid/done';
import { renderGate } from './parent/gate';
import { renderDash } from './parent/dash';
import { renderReport } from './parent/report';
import { renderSettings } from './parent/settings';

export function bootEnglish(app: HTMLElement, onExit: () => void): () => void {
  const root = el('div', 'en-app en-kid');
  app.appendChild(root);

  let data: ChildData | undefined = getChildData(activeChildId());
  let session: SessionRecord | null = null;
  const stack: View[] = [];

  function skin(kind: 'kid' | 'parent') {
    root.classList.toggle('en-kid', kind === 'kid');
    root.classList.toggle('en-parent', kind === 'parent');
  }

  function paint() {
    cancelSpeech();
    stopListening();
    root.replaceChildren();
    const top = stack[stack.length - 1];
    if (!top) return;
    const node = top();
    skin((node.dataset.kind as 'kid' | 'parent') ?? 'kid');
    root.appendChild(node);
    root.scrollTop = 0;
  }

  function push(v: View) {
    stack.push(v);
    paint();
  }

  function pop() {
    if (stack.length <= 1) {
      onExit();
      return;
    }
    stack.pop();
    paint();
  }

  function replace(v: View) {
    stack.pop();
    stack.push(v);
    paint();
  }

  /** 清空视图栈，回到某一层。用于「完成学习 → 回首页」这类不该留历史的跳转 */
  function reset(v: View) {
    stack.length = 0;
    push(v);
  }

  const ctx: Ctx = {
    get data() {
      // data 在 onboard 之前可能还不存在，但所有用到 ctx 的页面都在那之后
      return data as ChildData;
    },
    save() {
      if (data) saveChild(data);
    },
    push,
    pop,
    replace,
    exit: onExit,
    toParent: () => push(gateView),
    toKidHome: () => reset(homeView),
  };

  // ———————————————— 学习流程 ————————————————

  /**
   * 从某一步开始往下走。
   *
   * stepId 为空时从第一个没做完的步骤开始。每一步做完回调到这里，
   * 自动推进到下一步；全部做完进完成页。
   */
  function runStep(stepId?: string) {
    if (!data) return;
    const mission = ensureMission(data, dayKey());
    ctx.save();

    const step = stepId ? mission.steps.find((s) => s.id === stepId) : nextStep(mission);
    if (!step) {
      // 没有未完成的步骤了：有作答记录就进完成页，否则回首页
      if (session && session.activities.length) {
        const s = session;
        session = null;
        push(() => renderDone(ctx, s, () => reset(homeView)));
      } else {
        reset(homeView);
      }
      return;
    }

    if (!session) session = startSession(data.profile.id);

    const onDone = (s: SessionRecord) => {
      session = s;
      // 做完这一步直接进下一步，不回首页——回首页会打断学习节奏。
      // 先把刚做完的这一层弹掉，再让 runStep 决定下一层是什么。
      stack.pop();
      runStep();
    };
    const onBack = () => reset(homeView);

    const view: View = () => {
      if (!data) return el('div');
      switch (step.kind) {
        case 'word':
          return renderWords(ctx, { step, mission, session: session!, mode: 'learn', onDone, onBack });
        case 'listen':
          return renderWords(ctx, { step, mission, session: session!, mode: 'review', onDone, onBack });
        case 'game':
          return renderGame(ctx, { step, mission, session: session!, onDone, onBack });
        case 'story':
          return renderStory(ctx, { step, mission, session: session!, onDone, onBack });
        case 'talk':
          return renderTalk(ctx, { step, mission, session: session!, onDone, onBack });
        default:
          return renderKidHome(ctx, homeActions);
      }
    };
    push(view);
  }

  // ———————————————— 各视图 ————————————————

  const homeActions = {
    start: () => runStep(),
    assess: () => push(assessView),
    jump: (id: string) => runStep(id),
  };

  const homeView: View = () => {
    if (!data) return renderOnboard(onboarded, { exit: onExit });
    return renderKidHome(ctx, homeActions);
  };

  const assessView: View = () => renderAssess(ctx, () => reset(homeView));

  const gateView: View = () =>
    renderGate(
      () => replace(dashView),
      () => pop(),
    );

  const dashView: View = () =>
    renderDash(ctx, {
      report: () => push(reportView),
      settings: () => push(settingsView),
      backToKid: () => reset(homeView),
    });

  const reportView: View = () => renderReport(ctx, pop);

  const settingsView: View = () =>
    renderSettings(
      ctx,
      pop,
      () => {
        // 数据删干净了，回到首次引导
        data = undefined;
        session = null;
        reset(homeView);
      },
    );

  function onboarded(id: string) {
    data = getChildData(id);
    session = null;
    reset(homeView);
    // 新建档案后直接进测评，不让家长自己找入口
    if (data && !data.profile.assessedAt) push(assessView);
  }

  push(homeView);

  return () => {
    cancelSpeech();
    stopListening();
    root.remove();
    document.querySelector('.en-toast')?.remove();
  };
}
