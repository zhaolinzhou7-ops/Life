/**
 * 首页：开始陪练 / 今日训练 / 最近复盘 / 我的弱项。
 * 四个入口对应产品的四件事，别的都往后放——首页越简单，用户越知道该干嘛。
 */

import { listVariants, type RuleConfig } from '../rules/config';
import { AI_LEVELS, AI_PROFILES, type AiLevel } from '../ai/players';
import { ERROR_INFO } from '../replay/analyze';
import { loadProfile, recentPattern, summary } from '../profile/store';
import { loadGames } from '../replay/record';
import { clearInProgress, loadInProgress } from '../replay/inprogress';
import { buildDaily } from '../training/daily';
import { el } from './common';
import { TEACH_MODES, type TeachMode } from './table';

export interface HomeOptions {
  host: HTMLElement;
  onPlay: (cfg: RuleConfig, level: AiLevel, mode: TeachMode) => void;
  onResume: () => void;
  onTrain: () => void;
  onReview: (gameId?: string) => void;
  onMe: () => void;
}

/** 上一次选的场次，记在本地，不用每次重选 */
const PREF_KEY = 'mjcoach-prefs-v1';

interface Prefs {
  configId: string;
  level: AiLevel;
  mode: TeachMode;
}

export function loadPrefs(): Prefs {
  const base: Prefs = { configId: 'chengdu-xuezhan', level: 'novice', mode: 'light' };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? { ...base, ...(JSON.parse(raw) as Partial<Prefs>) } : base;
  } catch {
    return base;
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  } catch {
    /* 存不下不影响玩 */
  }
}

export function renderHome(o: HomeOptions): void {
  const page = el('div.mc-page');
  const wrap = el('div.mc-page-wide');
  page.appendChild(wrap);
  o.host.appendChild(page);

  const profile = loadProfile();
  const s = summary(profile);
  const pattern = recentPattern(profile);
  const games = loadGames();
  const prefs = loadPrefs();

  // 标题
  wrap.appendChild(
    el('div', { style: 'padding:18px 2px 8px' },
      el('div', { style: 'font-size:23px;font-weight:700;letter-spacing:.5px', text: '四川麻将 · AI 学习教练' }),
      el('div', { style: 'color:var(--mc-muted);font-size:13.5px;margin-top:4px', text: '不是陪你打牌，是教你打对' }),
    ),
  );

  // ---------- 没打完的牌局 ----------
  const unfinished = loadInProgress();
  if (unfinished) {
    const card = el('div.mc-card', { style: 'border-color:var(--mc-accent)' });
    card.append(
      el('h3', { text: '▶ 上一局还没打完' }),
      el('p', { text: `打到第 ${unfinished.actions.filter((a) => a.type === 'discard').length} 张牌时中断了，可以接着打。` }),
      el('div.mc-row', {},
        el('button.mc-btn.primary.sm', { text: '继续这一局', onclick: o.onResume }),
        el('button.mc-btn.sm.ghost', {
          text: '不要了',
          onclick: () => {
            clearInProgress();
            o.host.innerHTML = '';
            renderHome(o);
          },
        }),
      ),
    );
    wrap.appendChild(card);
  }

  // ---------- 第一次来：给条路 ----------
  if (s.games === 0 && s.trainingDone === 0) {
    const card = el('div.mc-card');
    card.append(
      el('h3', { text: '👋 第一次来？建议这样开始' }),
      el('p', { text: '1. 先到「训练」把「基础」三课做完，十分钟，认牌和规则就够用了。' }),
      el('p', { text: '2. 回来选「新手」对手 + 「教练模式」打一局，每一步都可以问教练该打哪张、为什么。' }),
      el('p', { text: '3. 打完看复盘。真正的学习从复盘开始，牌桌上只是练手。' }),
      el('p', { class: 'mc-muted', text: '看不懂的词随时点教练面板里的「📖 术语」。' }),
      el('button.mc-btn.sm', { text: '先去做基础课', onclick: o.onTrain }),
    );
    wrap.appendChild(card);
  }

  // ---------- 开始陪练 ----------
  const playCard = el('div.mc-card');
  playCard.appendChild(el('h3', { text: '🀄 开始陪练' }));

  const pick = <T extends string>(
    label: string,
    items: { id: T; name: string; desc: string }[],
    current: T,
    onPick: (id: T) => void,
  ) => {
    const box = el('div', { style: 'margin-bottom:12px' });
    box.appendChild(el('div', { style: 'font-size:12.5px;color:var(--mc-muted);margin-bottom:6px', text: label }));
    const row = el('div.mc-grid');
    for (const it of items) {
      const on = it.id === current;
      const btn = el('button.mc-btn', {
        style: `text-align:left;padding:10px 12px${on ? ';border-color:var(--mc-accent);background:rgba(52,192,141,.1)' : ''}`,
        onclick: () => onPick(it.id),
      });
      btn.append(
        el('div', { style: `font-size:14px${on ? ';color:var(--mc-accent)' : ''}`, text: it.name }),
        el('div', { style: 'font-size:11.5px;color:var(--mc-muted);margin-top:2px', text: it.desc }),
      );
      row.appendChild(btn);
    }
    box.appendChild(row);
    return box;
  };

  const rerender = () => {
    o.host.innerHTML = '';
    renderHome(o);
  };

  playCard.appendChild(
    pick(
      '对手水平',
      AI_LEVELS.map((l) => ({ id: l, name: AI_PROFILES[l].name, desc: AI_PROFILES[l].desc })),
      prefs.level,
      (id) => {
        savePrefs({ ...prefs, level: id });
        rerender();
      },
    ),
  );
  playCard.appendChild(
    pick(
      '教学模式',
      TEACH_MODES.map((m) => ({ id: m.id, name: m.name, desc: m.desc })),
      prefs.mode,
      (id) => {
        savePrefs({ ...prefs, mode: id });
        rerender();
      },
    ),
  );
  playCard.appendChild(
    pick(
      '规则方案',
      listVariants().map((v) => ({ id: v.id, name: v.name, desc: v.desc.split('，')[0] })),
      prefs.configId,
      (id) => {
        savePrefs({ ...prefs, configId: id });
        rerender();
      },
    ),
  );

  const cfg = listVariants().find((v) => v.id === prefs.configId) ?? listVariants()[0];
  playCard.appendChild(
    el('details', { style: 'margin-bottom:12px' },
      el('summary', { style: 'font-size:12.5px;color:var(--mc-muted);cursor:pointer', text: `这套规则的细节（${cfg.name}）` }),
      el('div', { style: 'font-size:12.5px;color:var(--mc-muted);margin-top:7px;line-height:1.8' },
        el('div', { text: cfg.desc }),
        el('div', { text: `常见于：${cfg.source}` }),
        el('div', { text: `起胡 ${cfg.win.minFan} 番 · 封顶 ${cfg.fan.cap} · ${cfg.swap.enabled ? `换三张 ${cfg.swap.count} 张` : '不换三张'} · ${cfg.draw.chaHuaZhu ? `查花猪赔 ${cfg.draw.huaZhuPay}` : '不查花猪'}` }),
        el('div', { text: `番型：${cfg.fan.table.filter((f) => f.enabled).map((f) => `${f.name}×${f.value}`).join('、')}` }),
      ),
    ),
  );

  playCard.appendChild(
    el('button.mc-btn.primary', {
      style: 'width:100%',
      text: '上桌开打',
      onclick: () => o.onPlay(cfg, prefs.level, prefs.mode),
    }),
  );
  wrap.appendChild(playCard);

  // ---------- 今日训练 ----------
  const daily = buildDaily(profile);
  const trainCard = el('div.mc-card');
  trainCard.append(
    el('h3', { text: '📝 今日训练' }),
    el('p', { text: `${daily.theme}专项 · ${daily.puzzles.length} 道题` }),
    el('p', { class: 'mc-muted', text: daily.reasons[0] ?? '按你的弱项自动出题' }),
    el('button.mc-btn.sm', { text: '去做题', onclick: o.onTrain }),
  );
  wrap.appendChild(trainCard);

  // ---------- 最近复盘 ----------
  const reviewCard = el('div.mc-card');
  reviewCard.appendChild(el('h3', { text: '🔍 最近复盘' }));
  if (!games.length) {
    reviewCard.appendChild(el('p', { class: 'mc-muted', text: '还没有牌局。打完一局会自动生成复盘报告。' }));
  } else {
    const g = games[0];
    const bad = g.decisions.filter((d) => d.severity === 'major' || d.severity === 'blunder').length;
    reviewCard.append(
      el('p', {
        text: `${new Date(g.startedAt).toLocaleString('sv').slice(5, 16)} · ${g.heroWon ? `胡牌 ${g.heroFan} 番` : g.exhausted ? '流局' : '没胡'} · ${g.scores[g.heroSeat] > 0 ? '+' : ''}${g.scores[g.heroSeat]} 分`,
      }),
      el('p', { class: 'mc-muted', text: bad ? `有 ${bad} 处关键失误值得看看` : '这局没有明显失误' }),
      el('button.mc-btn.sm', { text: '打开复盘', onclick: () => o.onReview(g.id) }),
    );
  }
  wrap.appendChild(reviewCard);

  // ---------- 我的弱项 ----------
  const weakCard = el('div.mc-card');
  weakCard.appendChild(el('h3', { text: '📊 我的弱项' }));
  if (pattern.type) {
    const info = ERROR_INFO[pattern.type];
    weakCard.append(
      el('p', { text: `${info.emoji} ${info.name}：最近 ${pattern.total} 局里有 ${pattern.gamesWith} 局在这里出问题` }),
      el('p', { class: 'mc-muted', text: info.desc }),
    );
  } else {
    weakCard.appendChild(el('p', { class: 'mc-muted', text: pattern.text }));
  }
  weakCard.append(
    el('p', { class: 'mc-muted', style: 'margin-top:8px', text: `打了 ${s.games} 局 · 胡牌率 ${s.winRate}% · 做题正确率 ${s.trainingAccuracy}%` }),
    el('button.mc-btn.sm', { text: '看完整画像', onclick: o.onMe }),
  );
  wrap.appendChild(weakCard);

}
