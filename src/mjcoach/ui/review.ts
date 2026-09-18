/**
 * 复盘页：麻将桌 + 操作时间线 + 关键节点 + AI 分析。
 *
 * 复盘最怕两件事：一是把几十步全列出来让人自己找，二是只给分数不给画面。
 * 所以这里的做法是——关键节点排在最前面，点开直接把牌局**倒回那一刻**，
 * 在真实局面上摆出「你打的那张」和「该打的那张」，再配上原因。
 */

import { SUIT_NAMES, toTiles, type TileId } from '../rules/tiles';
import {
  ERROR_INFO, SEVERITY_COLOR, buildReport, buildTimeline, stateAt,
  type GameReport, type KeyMoment,
} from '../replay/analyze';
import { rewind, type GameRecord } from '../replay/record';
import { extractFacts } from '../teach/facts';
import { getCoach } from '../teach/coach';
import { clear, el, richText, tileEl, topbar } from './common';

export interface ReviewOptions {
  host: HTMLElement;
  record: GameRecord;
  report?: GameReport;
  onBack: () => void;
}

export function renderReview(opts: ReviewOptions): void {
  const host = opts.host;
  const rec = opts.record;
  const report = opts.report ?? buildReport(rec);
  const timeline = buildTimeline(rec);
  const coach = getCoach();

  const page = el('div.mc-page');
  const wrap = el('div.mc-page-wide');
  page.appendChild(wrap);
  host.appendChild(topbar('牌局复盘', `${report.basics.configName} · ${report.basics.modeName}`, opts.onBack));
  host.appendChild(page);

  // ---------- 1. 基本数据 ----------
  const basics = el('div.mc-card');
  basics.appendChild(el('h3', { text: '本局数据' }));
  const grid = el('div.mc-stat-grid');
  const stat = (v: string, k: string) => el('div.mc-stat', {}, el('div.v', { text: v }), el('div.k', { text: k }));
  grid.append(
    stat(report.basics.result, '结果'),
    stat(`${report.basics.score > 0 ? '+' : ''}${report.basics.score}`, '得分'),
    stat(`${report.basics.duration}s`, '用时'),
    stat(report.basics.lack, '定缺'),
    stat(report.basics.huInfo || '—', '番型'),
    stat(String(report.basics.decisions), '决策数'),
  );
  basics.appendChild(grid);
  basics.appendChild(el('p', { style: 'margin-top:10px', text: report.basics.swap }));
  basics.appendChild(el('p', { style: 'color:var(--mc-text)', text: report.verdict }));
  wrap.appendChild(basics);

  // ---------- 2. 关键节点 ----------
  wrap.appendChild(el('div.mc-section', { text: '关键节点' }));
  if (!report.keyMoments.length) {
    wrap.appendChild(
      el('div.mc-card', {}, el('p', { text: '这一局没有值得单独拿出来说的失误。牌不好的时候能不亏，就是进步。' })),
    );
  }
  for (const m of report.keyMoments) {
    wrap.appendChild(momentCard(m));
  }

  // ---------- 3. 做得好的地方 ----------
  if (report.highlights.length) {
    wrap.appendChild(el('div.mc-section', { text: '做得好的地方' }));
    const card = el('div.mc-card');
    for (const h of report.highlights) {
      card.append(
        el('div', { style: 'font-size:14px;margin-bottom:2px', text: `✓ ${h.title}` }),
        el('p', { style: 'margin-bottom:10px', text: h.detail }),
      );
    }
    wrap.appendChild(card);
  }

  // ---------- 4. 下一步训练建议 ----------
  if (report.suggestions.length) {
    wrap.appendChild(el('div.mc-section', { text: '下一步练什么' }));
    const card = el('div.mc-card');
    for (const s of report.suggestions) card.appendChild(el('p', { text: s.text }));
    wrap.appendChild(card);
  }

  // ---------- 5. 完整时间线 ----------
  wrap.appendChild(el('div.mc-section', { text: '完整操作记录' }));
  const boardBox = el('div.mc-card');
  boardBox.appendChild(el('h3', { text: '点任意一步，回到当时的局面' }));
  const board = el('div');
  boardBox.appendChild(board);
  wrap.appendChild(boardBox);

  const tl = el('div.mc-timeline');
  timeline.forEach((n) => {
    const item = el('div.mc-tl-item');
    const dot = el('span.dot');
    if (n.severity && n.severity !== 'ok') dot.style.background = SEVERITY_COLOR[n.severity];
    item.append(dot, el('span.idx', { text: `#${n.index + 1}` }), el('span', { text: n.text }));
    if (n.key) item.appendChild(el('span.mc-pill.warn', { text: '关键' }));
    item.addEventListener('click', () => {
      for (const c of tl.children) c.classList.remove('on');
      item.classList.add('on');
      showBoardAt(n.index);
    });
    tl.appendChild(item);
  });
  wrap.appendChild(tl);

  /** 把牌局倒回某一步，画出当时四家的样子 */
  function showBoardAt(index: number) {
    clear(board);
    let snap;
    try {
      snap = stateAt(rec, index);
    } catch {
      board.appendChild(el('p', { text: '这一步重放不出来（牌谱可能来自旧版本）。' }));
      return;
    }
    const hero = snap.players[rec.heroSeat];
    board.appendChild(el('div.mc-muted', { text: `第 ${index + 1} 步 · 牌墙剩 ${snap.wallLeft} 张` }));
    board.appendChild(el('div', { style: 'margin:8px 0 3px;font-size:13px', text: '你的手牌' }));
    const handRow = el('div.mc-tiles');
    for (const t of toTiles(hero.hand)) handRow.appendChild(tileEl(t, { size: 'small' }));
    for (const m of hero.melds) {
      const n = m.kind === 'peng' ? 3 : 4;
      for (let i = 0; i < n; i++) handRow.appendChild(tileEl(m.tile, { size: 'tiny' }));
    }
    board.appendChild(handRow);

    for (let d = 1; d < 4; d++) {
      const seat = (rec.heroSeat + d) % 4;
      const p = snap.players[seat];
      const name = ['你', '下家', '对家', '上家'][d];
      const row = el('div', { style: 'margin-top:9px' });
      row.appendChild(
        el('div', {
          style: 'font-size:12.5px;color:var(--mc-muted);margin-bottom:3px',
          text: `${name}　缺${p.lack >= 0 ? SUIT_NAMES[p.lack] : '?'}　${p.outOfPlay ? '已胡下桌' : `手牌 ${p.hand.reduce((a, b) => a + b, 0)} 张`}　弃牌`,
        }),
      );
      const river = el('div.mc-tiles');
      for (const t of p.discards) river.appendChild(tileEl(t, { size: 'tiny' }));
      if (!p.discards.length) river.appendChild(el('span.mc-muted', { text: '（还没打牌）' }));
      row.appendChild(river);
      board.appendChild(row);
    }
  }

  showBoardAt(Math.max(0, (report.keyMoments[0]?.decision.index ?? 0)));

  /** 关键节点卡片：你打的 vs 该打的，摆在同一行对比 */
  function momentCard(m: KeyMoment): HTMLElement {
    const card = el('div.mc-card');
    const head = el('div.mc-moment');
    head.style.borderLeftColor = SEVERITY_COLOR[m.severity];
    head.appendChild(el('h4', { text: `${ERROR_INFO[m.type].emoji} ${m.title}` }));

    const vs = el('div.vs');
    const yours = el('div', {}, el('div.lbl', { text: '你的选择' }));
    const better = el('div', {}, el('div.lbl', { text: '可以考虑' }));
    const d = m.decision;
    if (d.kind === 'lack') {
      yours.appendChild(el('div', { text: m.yours }));
      better.appendChild(el('div', { text: m.better }));
    } else if (Array.isArray(d.chose)) {
      const a = el('div.mc-tiles');
      for (const t of d.chose as TileId[]) a.appendChild(tileEl(t, { size: 'small', mark: 'bad' }));
      yours.appendChild(a);
      const b = el('div.mc-tiles');
      for (const t of d.best as TileId[]) b.appendChild(tileEl(t, { size: 'small', mark: 'best' }));
      better.appendChild(b);
    } else {
      yours.appendChild(tileEl(d.chose as TileId, { size: 'big', mark: 'bad' }));
      better.appendChild(tileEl(d.best as TileId, { size: 'big', mark: 'best' }));
    }
    vs.append(yours, better);
    head.appendChild(vs);
    head.appendChild(el('div.why', { text: m.why }));
    head.appendChild(el('div.simple', { text: `简单理解：${m.simple}` }));

    const row = el('div.mc-row', { style: 'margin-top:9px' });
    row.appendChild(
      el('button.mc-btn.sm.ghost', {
        text: '回到这一刻',
        onclick: () => {
          showBoardAt(d.index);
          boardBox.scrollIntoView({ behavior: 'smooth', block: 'center' });
        },
      }),
    );
    row.appendChild(
      el('button.mc-btn.sm.ghost', {
        text: '问问教练',
        onclick: async () => {
          const holder = el('div', { style: 'margin-top:9px', text: '教练分析中…' });
          head.appendChild(holder);
          try {
            const engine = rewind(rec, d.index);
            const facts = extractFacts(engine, rec.heroSeat);
            const msg = await coach.explain({ topic: d.kind === 'lack' ? 'lack' : d.kind === 'swap' ? 'swap' : 'discard', facts });
            clear(holder);
            holder.appendChild(richText(msg.body));
          } catch {
            holder.textContent = '这一步重放不出来，没法给出分析。';
          }
        },
      }),
    );
    head.appendChild(row);
    card.appendChild(head);
    return card;
  }
}
