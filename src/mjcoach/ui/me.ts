/**
 * 「我的」：学习数据 + 错误画像 + 学习历史。
 *
 * 画像这一屏的写法有讲究：星级只是外壳，真正要让用户看见的是那句
 * 「你最近 N 局最常出现的问题是……」。所以那句话放在最上面，
 * 星级表放在它下面当佐证，而不是反过来拿一堆星星糊人一脸。
 * 样本不够时一律明说「数据还不够」，不拿三局就给人定性。
 */

import { ERROR_INFO } from '../replay/analyze';
import {
  allSkills, loadProfile, recentPattern, resetProfile, summary, trainingPlan,
} from '../profile/store';
import { clearGames, loadGames } from '../replay/record';
import { el, richText, stars, topbar } from './common';

export interface MeOptions {
  host: HTMLElement;
  onBack: () => void;
  onOpenReview: (gameId: string) => void;
  onTrain: () => void;
  onChanged: () => void;
}

export function renderMe(o: MeOptions): void {
  const { host } = o;
  const p = loadProfile();
  const s = summary(p);
  const pattern = recentPattern(p);
  const plan = trainingPlan(p);
  const games = loadGames();

  const page = el('div.mc-page');
  const wrap = el('div.mc-page-wide');
  page.appendChild(wrap);
  host.appendChild(topbar('我的', `Lv.${s.level} · 打了 ${s.games} 局`, o.onBack));
  host.appendChild(page);

  // ---------- 学习数据 ----------
  wrap.appendChild(el('div.mc-section', { text: '学习数据' }));
  const grid = el('div.mc-stat-grid');
  const stat = (v: string | number, k: string) =>
    el('div.mc-stat', {}, el('div.v', { text: String(v) }), el('div.k', { text: k }));
  grid.append(
    stat(s.games, '总局数'),
    stat(`${s.winRate}%`, '胡牌率'),
    stat(`${s.score > 0 ? '+' : ''}${s.score}`, '累计得分'),
    stat(s.huCount, '胡牌次数'),
    stat(s.dianpaoCount, '点炮次数'),
    stat(s.bestFan, '最高番'),
    stat(s.trainingDone, '做题数'),
    stat(`${s.trainingAccuracy}%`, '训练正确率'),
    stat(s.streakDays, '连续练习天'),
  );
  wrap.appendChild(grid);

  // ---------- 错误画像 ----------
  wrap.appendChild(el('div.mc-section', { text: '错误画像' }));
  const patternCard = el('div.mc-card');
  patternCard.appendChild(richText(pattern.text));
  if (pattern.type) {
    patternCard.appendChild(
      el('button.mc-btn.primary.sm', {
        style: 'margin-top:10px',
        text: `去练${ERROR_INFO[pattern.type].name}`,
        onclick: o.onTrain,
      }),
    );
  }
  wrap.appendChild(patternCard);

  const skillCard = el('div.mc-card');
  for (const v of allSkills(p)) {
    const row = el('div.mc-skill');
    row.append(
      el('span.nm', { text: `${v.emoji} ${v.name}` }),
      el('span.stars', { text: stars(v.stars) }),
      el('span.cm', { text: v.comment }),
    );
    skillCard.appendChild(row);
  }
  skillCard.appendChild(
    el('p', {
      class: 'mc-muted',
      style: 'margin-top:10px',
      text: '星级只是个大概。真正有用的是上面那句话——反复出现的问题才值得专门练。',
    }),
  );
  wrap.appendChild(skillCard);

  // ---------- 训练计划 ----------
  wrap.appendChild(el('div.mc-section', { text: '给你的训练计划' }));
  const planCard = el('div.mc-card');
  plan.slice(0, 3).forEach((item, i) => {
    planCard.append(
      el('div', { style: 'font-size:14px;margin-top:6px', text: `${i + 1}. ${ERROR_INFO[item.type].emoji} ${ERROR_INFO[item.type].name}` }),
      el('p', { class: 'mc-muted', text: item.reason }),
    );
  });
  planCard.appendChild(el('button.mc-btn.sm', { text: '开始今日训练', onclick: o.onTrain }));
  wrap.appendChild(planCard);

  // ---------- 学习历史 ----------
  wrap.appendChild(el('div.mc-section', { text: '最近的牌局' }));
  if (!games.length) {
    wrap.appendChild(el('div.mc-empty', {}, el('b', { text: '还没有牌局记录' }), document.createTextNode('打一局就会出现在这里，随时可以回看。')));
  } else {
    const list = el('div.mc-card');
    for (const g of games.slice(0, 12)) {
      const bad = g.decisions.filter((d) => d.severity === 'major' || d.severity === 'blunder').length;
      const row = el('div.mc-tl-item', { onclick: () => o.onOpenReview(g.id) });
      row.append(
        el('span.idx', { text: new Date(g.startedAt).toLocaleDateString('sv').slice(5) }),
        el('span', { text: g.heroWon ? `胡牌 ${g.heroFan} 番` : g.exhausted ? '流局' : '没胡' }),
        el('div.mc-spacer'),
        el('span', {
          style: `color:${g.scores[g.heroSeat] > 0 ? 'var(--mc-accent)' : g.scores[g.heroSeat] < 0 ? 'var(--mc-danger)' : 'var(--mc-muted)'}`,
          text: `${g.scores[g.heroSeat] > 0 ? '+' : ''}${g.scores[g.heroSeat]}`,
        }),
        bad ? el('span.mc-pill.warn', { text: `${bad} 处失误` }) : el('span.mc-pill.accent', { text: '无大错' }),
      );
      list.appendChild(row);
    }
    wrap.appendChild(list);
  }

  // ---------- 预留位 & 数据管理 ----------
  wrap.appendChild(el('div.mc-section', { text: '其它' }));
  const misc = el('div.mc-card');
  misc.append(
    el('p', { text: `等级 Lv.${s.level}（再得 ${s.expToNext} 经验升级）· 段位、成就系统在后续版本开放。` }),
    el('p', { class: 'mc-muted', text: '所有学习数据只保存在这台设备的浏览器里，不会上传。' }),
  );
  const row = el('div.mc-row', { style: 'flex-wrap:wrap' });
  row.append(
    el('button.mc-btn.sm.ghost', {
      text: '清空牌局记录',
      onclick: () => {
        if (confirm('确定清空所有牌局记录吗？此操作不可恢复。')) {
          clearGames();
          o.onChanged();
        }
      },
    }),
    el('button.mc-btn.sm.ghost', {
      text: '重置学习数据',
      onclick: () => {
        if (confirm('确定重置学习档案吗？包括战绩、画像和错题本，此操作不可恢复。')) {
          resetProfile();
          o.onChanged();
        }
      },
    }),
  );
  misc.appendChild(row);
  wrap.appendChild(misc);
}
