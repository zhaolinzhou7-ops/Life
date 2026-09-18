/**
 * AI 唱歌教练 · 应用入口。
 *
 * 一个无框架的小型单页应用：路由是一个状态变量，页面是「给我一个容器，
 * 我往里塞 DOM」的函数。这个规模下引入框架得不偿失。
 *
 * 首页只有一个主按钮「开始练歌」——这是产品需求里明确要求的，
 * 不堆几十个功能入口。
 */

import './vocal.css';
import type { AnalysisResult } from './analysis/performance';
import { Recorder, micErrorMessage, type MicState } from './audio/recorder';
import type { Recording } from './audio/recorder';
import { resumeAudio } from './audio/context';
import { pruneAudio } from './data/store';
import { el } from './ui/components';

export type Route =
  | { p: 'home' }
  | { p: 'songs' }
  | { p: 'practice'; songId: string; section?: number }
  | { p: 'analysis'; sessionId: string }
  | { p: 'training' }
  | { p: 'exercise'; id: string }
  | { p: 'me' }
  | { p: 'progress' }
  | { p: 'history' }
  | { p: 'settings' };

/** 页面能用到的全局能力 */
export interface Ctx {
  go(r: Route): void;
  back(): void;
  exit(): void;
  /** 申请并拿到录音器；被拒绝返回 null（页面自己给提示） */
  requestMic(): Promise<Recorder | null>;
  micState(): MicState;
  micHint(): { text: string; fix: string } | null;
  /** 刚刚分析完的结果，存在内存里给分析页画图用 */
  last: { id: string; result: AnalysisResult; recording: Recording } | null;
  setLast(id: string, result: AnalysisResult, recording: Recording): void;
  /** 重新渲染当前页 */
  refresh(): void;
}

export function bootVocal(app: HTMLElement, onExit: () => void): () => void {
  const root = el('div', 'vocal-app');
  app.appendChild(root);

  const pageBox = el('div', 'v-page');
  const tabBar = el('div', 'v-tabs');
  root.appendChild(pageBox);
  root.appendChild(tabBar);

  let route: Route = { p: 'home' };
  const stack: Route[] = [];
  let disposePage: (() => void) | null = null;

  let mic: Recorder | null = null;
  let micStateVal: MicState = 'idle';
  let micHintVal: { text: string; fix: string } | null = null;
  let last: Ctx['last'] = null;

  const ctx: Ctx = {
    go(r) {
      if (r.p !== route.p || JSON.stringify(r) !== JSON.stringify(route)) stack.push(route);
      route = r;
      render();
    },
    back() {
      route = stack.pop() ?? { p: 'home' };
      render();
    },
    exit: onExit,
    async requestMic() {
      if (mic) return mic;
      if (micStateVal === 'asking') return null;
      micStateVal = 'asking';
      resumeAudio();
      try {
        mic = await Recorder.create();
        micStateVal = 'ready';
        micHintVal = null;
        return mic;
      } catch (e) {
        const info = micErrorMessage(e);
        micStateVal = info.state;
        micHintVal = { text: info.text, fix: info.fix };
        return null;
      }
    },
    micState: () => micStateVal,
    micHint: () => micHintVal,
    get last() {
      return last;
    },
    setLast(id, result, recording) {
      last = { id, result, recording };
    },
    refresh: () => render(),
  };

  const TABS: { key: Route['p']; icon: string; label: string; route: Route }[] = [
    { key: 'home', icon: '🏠', label: '首页', route: { p: 'home' } },
    { key: 'songs', icon: '🎵', label: '歌曲', route: { p: 'songs' } },
    { key: 'training', icon: '🎯', label: '训练', route: { p: 'training' } },
    { key: 'me', icon: '📈', label: '我的', route: { p: 'me' } },
  ];

  /** 带底部标签栏的是主页面；其余是「推进去」的页面，有返回键 */
  const isTabPage = (p: Route['p']) => TABS.some((t) => t.key === p);

  function renderTabs() {
    tabBar.innerHTML = '';
    if (!isTabPage(route.p)) {
      tabBar.style.display = 'none';
      return;
    }
    tabBar.style.display = 'flex';
    for (const t of TABS) {
      const b = el('button', `v-tab ${route.p === t.key ? 'on' : ''}`);
      b.type = 'button';
      b.innerHTML = `<span class="ico">${t.icon}</span><span>${t.label}</span>`;
      b.addEventListener('click', () => {
        if (route.p === t.key) return;
        stack.length = 0;
        route = t.route;
        render();
      });
      tabBar.appendChild(b);
    }
  }

  async function render() {
    disposePage?.();
    disposePage = null;
    pageBox.innerHTML = '';
    pageBox.scrollTop = 0;
    pageBox.className = `v-page${isTabPage(route.p) ? ' has-tabs' : ''}`;
    renderTabs();

    // 各页面按需加载，首屏不用把整个应用都下下来
    switch (route.p) {
      case 'home': {
        const { renderHome } = await import('./ui/home');
        disposePage = renderHome(pageBox, ctx);
        break;
      }
      case 'songs': {
        const { renderSongs } = await import('./ui/songs');
        disposePage = renderSongs(pageBox, ctx);
        break;
      }
      case 'practice': {
        const { renderPractice } = await import('./ui/practice');
        disposePage = renderPractice(pageBox, ctx, route.songId, route.section);
        break;
      }
      case 'analysis': {
        const { renderAnalysis } = await import('./ui/analysis');
        disposePage = renderAnalysis(pageBox, ctx, route.sessionId);
        break;
      }
      case 'training': {
        const { renderTraining } = await import('./ui/training');
        disposePage = renderTraining(pageBox, ctx);
        break;
      }
      case 'exercise': {
        const { renderExercise } = await import('./ui/exercise');
        disposePage = renderExercise(pageBox, ctx, route.id);
        break;
      }
      case 'me': {
        const { renderMe } = await import('./ui/me');
        disposePage = renderMe(pageBox, ctx);
        break;
      }
      case 'progress': {
        const { renderProgress } = await import('./ui/progress');
        disposePage = renderProgress(pageBox, ctx);
        break;
      }
      case 'history': {
        const { renderHistory } = await import('./ui/history');
        disposePage = renderHistory(pageBox, ctx);
        break;
      }
      case 'settings': {
        const { renderSettings } = await import('./ui/settings');
        disposePage = renderSettings(pageBox, ctx);
        break;
      }
    }
  }

  // 按保留策略清理过期录音——这是隐私承诺的执行点，进应用就跑
  void pruneAudio();
  void render();

  return () => {
    disposePage?.();
    mic?.dispose();
    mic = null;
    root.remove();
  };
}

/** 页面共用的顶栏（返回 + 标题） */
export function topbar(title: string, onBack: () => void, action?: HTMLElement): HTMLDivElement {
  const bar = el('div', 'v-topbar');
  const back = el('button', 'v-back', '←');
  back.type = 'button';
  back.setAttribute('aria-label', '返回');
  back.addEventListener('click', onBack);
  bar.appendChild(back);
  bar.appendChild(el('h2', '', title));
  if (action) bar.appendChild(action);
  return bar;
}
