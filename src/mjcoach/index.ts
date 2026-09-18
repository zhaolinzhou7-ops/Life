/**
 * 四川麻将 · AI 学习教练：入口与页面路由。
 *
 * 五个页面：首页 / 陪练 / 复盘 / 训练 / 我的。
 * 路由就是一个字符串加一次重绘——这个体量不需要框架，
 * 而且手写 DOM 和仓库里其它几个游戏保持一致。
 */

import './ui/style.css';
import { listVariants, type RuleConfig } from './rules/config';
import { randomSeed } from './rules/tiles';
import type { AiLevel } from './ai/players';
import { getGame, loadGames, saveGame, type GameRecord } from './replay/record';
import { buildReport, type GameReport } from './replay/analyze';
import { recordGame } from './profile/store';
import { el } from './ui/common';
import { loadPrefs, renderHome } from './ui/home';
import { renderMe } from './ui/me';
import { renderReview } from './ui/review';
import { renderTrain } from './ui/train';
import { runTable, type TeachMode } from './ui/table';

type Route = 'home' | 'play' | 'review' | 'train' | 'me';

const TABS: { id: Route; icon: string; name: string }[] = [
  { id: 'home', icon: '🏠', name: '首页' },
  { id: 'play', icon: '🀄', name: '陪练' },
  { id: 'train', icon: '📝', name: '训练' },
  { id: 'review', icon: '🔍', name: '复盘' },
  { id: 'me', icon: '📊', name: '我的' },
];

export function bootMahjongCoach(app: HTMLElement, onExit: () => void): () => void {
  const root = el('div.mc-root');
  app.appendChild(root);

  const body = el('div', { style: 'flex:1;display:flex;flex-direction:column;min-height:0;position:relative' });
  const tabs = el('div.mc-tabs');
  root.append(body, tabs);

  let route: Route = 'home';
  let disposeTable: (() => void) | null = null;
  let reviewTarget: { rec: GameRecord; report?: GameReport } | null = null;

  // 回到小游戏合集首页的兜底按钮。牌桌页会把它藏起来（那里有自己的退出键）
  const exitBtn = el('button.mc-btn.sm.ghost', {
    style: 'position:absolute;right:10px;top:calc(8px + env(safe-area-inset-top));z-index:50;opacity:.75',
    text: '✕',
    onclick: onExit,
  });
  root.appendChild(exitBtn);

  const tabButtons = TABS.map((t) => {
    const btn = el('button.mc-tab', { onclick: () => go(t.id) }, el('i', { text: t.icon }), el('span', { text: t.name }));
    tabs.appendChild(btn);
    return btn;
  });

  function setTabsVisible(v: boolean) {
    tabs.style.display = v ? '' : 'none';
  }

  function go(next: Route, payload?: unknown) {
    disposeTable?.();
    disposeTable = null;
    route = next;
    body.innerHTML = '';
    tabButtons.forEach((b, i) => b.classList.toggle('on', TABS[i].id === route));
    setTabsVisible(route !== 'play');
    // 牌桌自带「退出」按钮，全局的 ✕ 要让位，否则两个按钮会叠在一起互相挡点击
    exitBtn.style.display = route === 'play' ? 'none' : '';

    switch (route) {
      case 'home':
        renderHome({
          host: body,
          onPlay: startGame,
          onTrain: () => go('train'),
          onReview: (id) => openReview(id),
          onMe: () => go('me'),
        });
        break;

      case 'play': {
        const p = payload as { cfg: RuleConfig; level: AiLevel; mode: TeachMode } | undefined;
        const prefs = loadPrefs();
        if (!p) {
          // 直接点底部「陪练」：用上次的设置开一局
          const cfgs = listVariants();
          startGame(cfgs.find((c) => c.id === prefs.configId) ?? cfgs[0], prefs.level, prefs.mode);
          return;
        }
        disposeTable = runTable(body, {
          config: p.cfg,
          aiLevel: p.level,
          mode: p.mode,
          seed: randomSeed(),
          onExit: () => go('home'),
          onSave: (rec, report) => {
            // 牌谱 + 学习数据都在这里落盘，用户点不点复盘都一样
            saveGame(rec);
            const dianpao = rec.actions.filter(
              (a) => a.type === 'hu' && a.seat !== rec.heroSeat,
            ).length;
            recordGame(report, { dianpao: dianpao > 0 && !rec.heroWon ? 1 : 0, fan: rec.heroFan });
          },
          onReview: (rec, report) => {
            reviewTarget = { rec, report };
            go('review');
          },
          onAgain: () => startGame(p.cfg, p.level, p.mode),
        });
        break;
      }

      case 'review':
        if (reviewTarget) {
          renderReview({ host: body, record: reviewTarget.rec, report: reviewTarget.report, onBack: () => go('home') });
        } else {
          renderReviewList();
        }
        break;

      case 'train':
        renderTrain({ host: body, onBack: () => go('home'), onChanged: () => go('train') });
        break;

      case 'me':
        renderMe({
          host: body,
          onBack: () => go('home'),
          onOpenReview: (id) => openReview(id),
          onTrain: () => go('train'),
          onChanged: () => go('me'),
        });
        break;
    }
  }

  function startGame(cfg: RuleConfig, level: AiLevel, mode: TeachMode) {
    reviewTarget = null;
    go('play', { cfg, level, mode });
  }

  function openReview(id?: string) {
    if (id) {
      const rec = getGame(id);
      if (rec) {
        reviewTarget = { rec, report: buildReport(rec) };
        go('review');
        return;
      }
    }
    reviewTarget = null;
    go('review');
  }

  /** 复盘页没有指定牌局时，列出最近的几局让用户挑 */
  function renderReviewList() {
    const games = loadGames();
    const page = el('div.mc-page');
    const wrap = el('div.mc-page-wide');
    page.appendChild(wrap);
    wrap.appendChild(el('div', { style: 'padding:14px 2px 6px;font-size:19px;font-weight:600', text: '复盘' }));
    if (!games.length) {
      wrap.appendChild(
        el('div.mc-empty', {},
          el('b', { text: '还没有可复盘的牌局' }),
          document.createTextNode('去「陪练」打一局，打完这里就会有完整的复盘报告。'),
        ),
      );
      wrap.appendChild(el('button.mc-btn.primary', { text: '去打一局', onclick: () => go('home') }));
    } else {
      const list = el('div.mc-card');
      for (const g of games) {
        const bad = g.decisions.filter((d) => d.severity === 'major' || d.severity === 'blunder').length;
        list.appendChild(
          el('div.mc-tl-item', { onclick: () => openReview(g.id) },
            el('span.idx', { text: new Date(g.startedAt).toLocaleDateString('sv').slice(5) }),
            el('span', { text: g.heroWon ? `胡牌 ${g.heroFan} 番` : g.exhausted ? '流局' : '没胡' }),
            el('div.mc-spacer'),
            bad ? el('span.mc-pill.warn', { text: `${bad} 处失误` }) : el('span.mc-pill.accent', { text: '无大错' }),
          ),
        );
      }
      wrap.appendChild(list);
    }
    body.innerHTML = '';
    body.appendChild(page);
  }

  go('home');

  return () => {
    disposeTable?.();
    root.remove();
  };
}
