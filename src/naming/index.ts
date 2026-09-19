/**
 * AI 智能取名 · 启动入口
 *
 * 和仓库里其它应用保持一致：导出一个 boot 函数，接管 app 容器，返回清理函数。
 *
 * 路由用的是最朴素的视图栈。这个应用一共七个页面，引一套路由库的收益抵不过
 * 它带来的心智负担。
 */

import './naming.css';
import type { FavoriteItem, NameCandidate, NamingRequest, NamingResult } from './types';
import { runNaming } from './ai/providers';
import { getLastRequest, setLastRequest } from './store';
import { el, errorState, skeleton } from './views/ui';
import { renderHome } from './views/home';
import { renderAdvanced, renderForm } from './views/form';
import { renderResult } from './views/result';
import { renderDetail } from './views/detail';
import { renderFavorites } from './views/favorites';
import { renderCompare } from './views/compare';
import { renderSettings } from './views/settings';

function emptyRequest(): NamingRequest {
  return {
    surname: '',
    gender: 'any',
    target: 'baby',
    brief: '',
    likeStyles: [],
    avoidStyles: [],
    mustChars: [],
    banChars: [],
    temperament: [],
    useClassics: true,
    useWuxing: false,
    nameLength: 2,
    count: 10,
  };
}

export function bootNaming(app: HTMLElement, onExit: () => void): () => void {
  const root = el('div', 'nm-app');
  app.appendChild(root);

  // 上次填过的需求直接带出来，不让用户重填
  let req: NamingRequest = { ...emptyRequest(), ...(getLastRequest() ?? {}) };
  let result: NamingResult | null = null;
  let seed = (Date.now() & 0xffff) || 1;
  let inflight: AbortController | null = null;

  /** 视图栈。每一项是一个渲染函数，pop 之后重新渲染上一层（保证收藏状态是新的） */
  const stack: (() => HTMLElement)[] = [];

  function paint() {
    inflight?.abort();
    inflight = null;
    root.innerHTML = '';
    root.scrollTop = 0;
    const top = stack[stack.length - 1];
    if (top) root.appendChild(top());
  }

  function push(view: () => HTMLElement) {
    stack.push(view);
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

  /** 替换当前层，用于「换一批」这种不该新增历史的场景 */
  function replace(view: () => HTMLElement) {
    stack.pop();
    stack.push(view);
    paint();
  }

  // ————————————————— 各页面 —————————————————

  const home = () =>
    renderHome({
      start: () => push(form),
      favorites: () => push(favorites),
      settings: () => push(settings),
      exit: onExit,
    });

  const form = () =>
    renderForm(req, {
      back: pop,
      submit: (r) => {
        req = r;
        setLastRequest(req);
        seed = (Math.random() * 0xffff) | 0 || 1;
        push(loading);
      },
      advanced: () => push(advanced),
    });

  const advanced = () =>
    renderAdvanced(req, {
      back: pop,
      submit: (r) => {
        req = r;
        setLastRequest(req);
        seed = (Math.random() * 0xffff) | 0 || 1;
        // 从高级设置直接生成时，把高级设置这一层换掉，返回时回到表单
        stack.pop();
        push(loading);
      },
    });

  /** 加载页。生成完成后原地换成结果页，不在历史里留一层空白 */
  const loading = () => {
    const page = el('div', 'nm-page');
    const bar = el('div', 'nm-topbar');
    bar.appendChild(el('div', 'nm-topbar-title', '正在筛选…'));
    page.appendChild(bar);
    page.appendChild(
      el('div', 'nm-stepnote', '正在理解需求、生成候选、逐项过滤。通常一两秒。'),
    );
    page.appendChild(skeleton(5));

    const ctl = new AbortController();
    inflight = ctl;
    // 让骨架屏有机会渲染出来，避免本地引擎太快导致闪一下
    const started = Date.now();
    void runNaming(req, { count: req.count, seed, signal: ctl.signal })
      .then(async (r) => {
        if (ctl.signal.aborted) return;
        const wait = Math.max(0, 260 - (Date.now() - started));
        if (wait) await new Promise((res) => setTimeout(res, wait));
        if (ctl.signal.aborted) return;
        result = r;
        replace(results);
      })
      .catch((e: unknown) => {
        if (ctl.signal.aborted) return;
        const msg = e instanceof Error ? e.message : String(e);
        page.innerHTML = '';
        page.appendChild(bar);
        page.appendChild(
          errorState(`生成过程中出了点问题：${msg}`, () => replace(loading)),
        );
      });

    return page;
  };

  const results = () => {
    if (!result) return errorState('没有可展示的结果', () => replace(loading));
    return renderResult(result, {
      back: pop,
      detail: (c) => push(() => detail(c)),
      regenerate: () => {
        seed = (Math.random() * 0xffff) | 0 || 1;
        replace(loading);
      },
      adjust: pop,
      favorites: () => push(favorites),
    });
  };

  const detail = (c: NameCandidate) => renderDetail(c, { back: pop, favorites: () => push(favorites) });

  const favorites = () =>
    renderFavorites({
      back: pop,
      detail: (f: FavoriteItem) => push(() => detail(f.name)),
      compare: (ids) => push(() => compare(ids)),
      start: () => {
        // 从空收藏页去取名：回到首页那一层再进表单，避免堆栈越叠越深
        while (stack.length > 1) stack.pop();
        push(form);
      },
    });

  const compare = (ids: string[]) =>
    renderCompare(ids, { back: pop, detail: (f) => push(() => detail(f.name)) });

  const settings = () => renderSettings({ back: pop });

  push(home);

  return () => {
    inflight?.abort();
    root.remove();
    document.querySelector('.nm-toast')?.remove();
  };
}
