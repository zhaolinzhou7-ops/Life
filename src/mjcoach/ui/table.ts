/**
 * 陪练：麻将桌。
 *
 * 界面归界面，规则归引擎——这里一条规则都不判断。
 * 它只做三件事：把引擎状态画出来、把用户的点击翻译成 Action、在合适的时候叫教练。
 *
 * 四种教学模式的差别全在 `shouldNudge` 和教练按钮的可见性上，
 * 牌局流程本身完全一样，这样才不会出现「教练模式和考试模式规则不一致」这种事。
 */

import { MahjongEngine, type Action, type Pending } from '../rules/engine';
import type { RuleConfig } from '../rules/config';
import {
  Rng, SUIT_NAMES, suitOf, tileName, tilesName, toTiles,
  type TileId,
} from '../rules/tiles';
import { AI_PROFILES, decide, type AiLevel } from '../ai/players';
import { analyzeDiscards, lossOf, severityOf } from '../analysis/efficiency';
import { analyzeLack } from '../analysis/dingque';
import { analyzeSwap } from '../analysis/swap';
import { Recorder, type DecisionRecord, type GameRecord } from '../replay/record';
import { clearInProgress, saveInProgress } from '../replay/inprogress';
import { openGlossary } from './glossary';
import { buildReport, type GameReport } from '../replay/analyze';
import { compareDiscard, compareLack, compareSwap, extractFacts, seatName } from '../teach/facts';
import { QUICK_QUESTIONS, getCoach } from '../teach/coach';
import type { CoachMessage } from '../teach/provider';
import { clear, el, richText, sleep, tileBack, tileEl, toast } from './common';

export type TeachMode = 'free' | 'light' | 'coach' | 'exam';

export const TEACH_MODES: { id: TeachMode; name: string; desc: string }[] = [
  { id: 'free', name: '自由模式', desc: 'AI 不提示，想问的时候自己点教练' },
  { id: 'light', name: '轻提示', desc: '只在明显打错时提醒一句，不拦你' },
  { id: 'coach', name: '教练模式', desc: '每一步都可以问「该打哪张、为什么」' },
  { id: 'exam', name: '考试模式', desc: '全程不提示，打完统一评分复盘' },
];

export interface TableOptions {
  config: RuleConfig;
  /** 三家对手的档位，依次对应下家 / 对家 / 上家 */
  aiLevels: AiLevel[];
  mode: TeachMode;
  seed: number;
  onExit: () => void;
  /** 一局结束就调用：牌谱必须落盘，不能等用户点复盘才存 */
  onSave: (rec: GameRecord, report: GameReport) => void;
  /** 用户主动点「看详细复盘」 */
  onReview: (rec: GameRecord, report: GameReport) => void;
  /** 再来一局 */
  onAgain: () => void;
  /** 接着上次没打完的牌局：把动作重放到中断处再继续 */
  resume?: { actions: Action[]; decisions: DecisionRecord[]; startedAt: number };
}

const HERO = 0;

export function runTable(host: HTMLElement, opts: TableOptions): () => void {
  const { config: cfg, aiLevels, mode, seed } = opts;
  let disposed = false;
  const alive = () => !disposed;

  const engine = new MahjongEngine({ config: cfg, seed });
  const rng = new Rng(seed ^ 0x5bf03635);
  const recorder = new Recorder({
    config: cfg, seed, heroSeat: HERO,
    aiLevels: [...aiLevels],
    mode: TEACH_MODES.find((m) => m.id === mode)!.name,
  });
  const coach = getCoach();

  // ---------- DOM ----------
  const root = el('div.mc-table');
  const seatsBox = el('div.mc-seats');
  const centerBox = el('div.mc-center');
  const handArea = el('div.mc-hand-area');
  const myInfo = el('div.mc-myinfo');
  const handBox = el('div.mc-hand');
  const actionBox = el('div.mc-actions');
  handArea.append(myInfo, handBox, actionBox);
  seatsBox.appendChild(centerBox);
  root.append(seatsBox, handArea);
  host.appendChild(root);

  // 顶栏按钮（退出 / 模式 / 教练）
  const topRow = el('div', {
    style: 'position:absolute;top:calc(6px + env(safe-area-inset-top));left:8px;right:8px;display:flex;gap:6px;z-index:20;align-items:center',
  });
  topRow.appendChild(el('button.mc-btn.sm.ghost', { text: '‹ 退出', onclick: () => opts.onExit() }));
  const modeTag = el('span.mc-pill', { text: TEACH_MODES.find((m) => m.id === mode)!.name });
  topRow.appendChild(modeTag);
  topRow.appendChild(el('div.mc-spacer'));
  const coachBtn = el('button.mc-btn.sm', { text: '🎓 教练' });
  if (mode === 'exam' || mode === 'free') coachBtn.style.display = mode === 'exam' ? 'none' : '';
  topRow.appendChild(coachBtn);
  seatsBox.appendChild(topRow);

  // 教练抽屉
  const coachPanel = el('div.mc-coach');
  const coachBody = el('div.mc-coach-body');
  const coachHead = el('div.mc-coach-head');
  coachHead.append(
    el('b', { text: '🎓 AI 教练' }),
    el('span.mc-pill', { text: coach.id === 'remote' ? '在线' : '本地' }),
    el('div.mc-spacer'),
    el('button.mc-btn.sm.ghost', { text: '📖 术语', onclick: () => openGlossary(root) }),
    el('button.mc-btn.sm.ghost', { text: '收起', onclick: () => coachPanel.classList.remove('open') }),
  );
  const coachFoot = el('div.mc-coach-foot');
  const quickBox = el('div.mc-quickq');
  for (const q of QUICK_QUESTIONS) {
    quickBox.appendChild(el('button', { text: q, onclick: () => ask(q) }));
  }
  const askRow = el('div.mc-ask');
  const askInput = el('input', { type: 'text', placeholder: '问点什么…' }) as HTMLInputElement;
  askInput.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Enter') ask(askInput.value);
  });
  askRow.append(askInput, el('button.mc-btn.sm.primary', { text: '问', onclick: () => ask(askInput.value) }));
  coachFoot.append(quickBox, askRow);
  coachPanel.append(coachHead, coachBody, coachFoot);
  root.appendChild(coachPanel);

  coachBtn.addEventListener('click', () => {
    coachPanel.classList.toggle('open');
    if (coachPanel.classList.contains('open')) explainNow();
  });

  // ---------- 教练交互 ----------
  const chatLog: { role: 'user' | 'coach'; text: string }[] = [];

  function showCoachMessage(m: CoachMessage, question?: string) {
    if (question) {
      coachBody.appendChild(
        el('div.mc-chatline.me', {}, el('div.who', { text: '你' }), el('div', { text: question })),
      );
    }
    const line = el('div.mc-chatline.coach');
    line.appendChild(el('div.who', { text: m.headline || '教练' }));
    line.appendChild(richText(m.body));
    if (m.simple) {
      line.appendChild(
        el('div', {
          style: 'margin-top:7px;padding:8px 10px;background:var(--mc-surface2);border-radius:8px;font-size:13px',
          text: `简单说：${m.simple}`,
        }),
      );
    }
    coachBody.appendChild(line);
    coachBody.scrollTop = coachBody.scrollHeight;
  }

  async function explainNow() {
    const facts = extractFacts(engine, HERO);
    const topic = engine.phase === 'lack' ? 'lack' : engine.phase === 'swap' ? 'swap' : engine.phase === 'turn' && engine.turn === HERO ? 'discard' : 'situation';
    const m = await coach.explain({ topic, facts });
    if (alive()) showCoachMessage(m);
  }

  async function ask(q: string) {
    const text = q.trim();
    if (!text) return;
    askInput.value = '';
    coachPanel.classList.add('open');
    chatLog.push({ role: 'user', text });
    const facts = extractFacts(engine, HERO);
    const m = await coach.chat({ question: text, facts, history: chatLog.slice(-6) });
    if (!alive()) return;
    chatLog.push({ role: 'coach', text: m.body });
    showCoachMessage(m, text);
  }

  // ---------- 渲染 ----------
  let selected = -1;
  let picked: number[] = [];
  let centerHint = '';

  function render() {
    // 座位
    clear(seatsBox);
    seatsBox.append(centerBox, topRow);
    const positions = ['', 'mc-seat-right', 'mc-seat-top', 'mc-seat-left'];
    for (let d = 1; d < 4; d++) {
      const seat = (HERO + d) % 4;
      const p = engine.players[seat];
      const box = el(`div.mc-seat.${positions[d]}`);
      const plate = el(`div.mc-nameplate${engine.turn === seat && engine.phase !== 'over' ? '.active' : ''}`);
      plate.appendChild(el('span', { text: seatName(HERO, seat) }));
      if (new Set(aiLevels).size > 1) {
        plate.appendChild(el('span.mc-pill', { text: AI_PROFILES[aiLevels[seat - 1] ?? aiLevels[0]].name }));
      }
      if (p.lack >= 0) plate.appendChild(el('span.mc-lackbadge', { text: `缺${SUIT_NAMES[p.lack]}` }));
      if (p.outOfPlay) plate.appendChild(el('span.mc-pill.warn', { text: '已胡' }));
      else if (engine.isTing(seat)) plate.appendChild(el('span.mc-pill.accent', { text: '听' }));
      plate.appendChild(el('span', { class: `sc${p.score < 0 ? ' neg' : ''}`, text: `${p.score > 0 ? '+' : ''}${p.score}` }));
      box.appendChild(plate);

      // 手牌背面（血战到底里胡了的家亮牌，那些牌是公开信息，要看得见）
      const hand = el('div.mc-seat-hand');
      if (p.outOfPlay) {
        for (const t of toTiles(p.hand)) hand.appendChild(tileEl(t, { size: 'tiny' }));
      } else {
        const n = p.hand.reduce((a, b) => a + b, 0);
        for (let i = 0; i < n; i++) hand.appendChild(tileBack('tiny'));
      }
      box.appendChild(hand);

      // 副露
      if (p.melds.length) {
        const melds = el('div.mc-seat-hand');
        for (const m of p.melds) {
          const n = m.kind === 'peng' ? 3 : 4;
          for (let i = 0; i < n; i++) melds.appendChild(tileEl(m.tile, { size: 'tiny' }));
        }
        box.appendChild(melds);
      }

      // 牌河：放在最靠近桌心的一侧，这是场上信息量最大的东西
      const river = el('div.mc-river');
      for (const t of p.discards) river.appendChild(tileEl(t, { size: 'tiny' }));
      box.appendChild(river);
      seatsBox.appendChild(box);
    }

    // 自己的牌河：别人能看见你打过什么，你自己更得看得见
    const meBox = el('div.mc-seat.mc-seat-me');
    const meRiver = el('div.mc-river');
    for (const t of engine.players[HERO].discards) meRiver.appendChild(tileEl(t, { size: 'tiny' }));
    if (engine.players[HERO].discards.length) {
      meBox.appendChild(el('div', { style: 'font-size:10.5px;color:rgba(255,255,255,.4)', text: '你打过的牌' }));
      meBox.appendChild(meRiver);
    }
    seatsBox.appendChild(meBox);

    // 中央
    clear(centerBox);
    centerBox.append(
      el('div.wall', { text: String(engine.wallLeft) }),
      el('div', { text: '张剩余' }),
      el('div.hint', { text: centerHint }),
    );

    // 我的信息
    const me = engine.players[HERO];
    clear(myInfo);
    myInfo.append(
      el('span', { text: '你' }),
      me.lack >= 0 ? el('span.mc-lackbadge', { text: `缺${SUIT_NAMES[me.lack]}` }) : el('span'),
      el('span', { class: `mc-pill${me.score < 0 ? ' danger' : me.score > 0 ? ' accent' : ''}`, text: `${me.score > 0 ? '+' : ''}${me.score} 分` }),
    );
    if (mode !== 'exam') {
      const waits = engine.waits(HERO);
      if (waits.length) {
        myInfo.appendChild(el('span.mc-pill.accent', { text: `听 ${tilesName(waits)}` }));
      }
    }
    if (me.melds.length) {
      const mb = el('span.mc-tiles');
      for (const m of me.melds) {
        const n = m.kind === 'peng' ? 3 : 4;
        for (let i = 0; i < n; i++) mb.appendChild(tileEl(m.tile, { size: 'tiny' }));
      }
      myInfo.appendChild(mb);
    }

    renderHand();
  }

  /** 手牌：刚摸的那张单独放右边，和真人手里的样子一致 */
  function renderHand() {
    const me = engine.players[HERO];
    clear(handBox);
    const drawn = engine.phase === 'turn' && engine.turn === HERO ? engine.drawnTile : null;
    const counts = me.hand.slice();
    if (drawn !== null && counts[drawn] > 0) counts[drawn]--;
    const tiles = toTiles(counts);

    const pend = engine.pending();
    const isMyTurn = pend?.seat === HERO && pend.kind === 'turn';
    const isSwap = pend?.seat === HERO && pend.kind === 'swap';
    const legal = isMyTurn ? new Set(engine.legalDiscards(HERO)) : null;

    // 教练模式下标出最优/最差，帮用户建立直觉
    let bestTile = -1;
    if (mode === 'coach' && isMyTurn) {
      bestTile = currentDiscardAnalysis()?.best.tile ?? -1;
    }

    const makeTile = (t: TileId, idx: number) =>
      tileEl(t, {
        selected: selected === idx,
        picked: picked.includes(idx),
        dim: !!legal && !legal.has(t),
        mark: bestTile === t ? 'best' : undefined,
        onClick: isMyTurn || isSwap ? () => onTileTap(t, idx) : undefined,
      });

    tiles.forEach((t, i) => handBox.appendChild(makeTile(t, i)));
    if (drawn !== null) {
      handBox.appendChild(el('div.gap'));
      handBox.appendChild(makeTile(drawn, tiles.length));
    }
  }

  let discardAnalysisCache: { key: string; value: ReturnType<typeof analyzeDiscards> } | null = null;

  function currentDiscardAnalysis() {
    const me = engine.players[HERO];
    const key = `${engine.turnIndex}-${me.hand.join(',')}-${me.melds.length}`;
    if (discardAnalysisCache?.key === key) return discardAnalysisCache.value;
    const facts = extractFacts(engine, HERO);
    if (!facts.discards) return null;
    discardAnalysisCache = { key, value: facts.discards };
    return facts.discards;
  }

  // ---------- 用户输入 ----------
  let resolveAction: ((a: Action) => void) | null = null;
  let tapMode: 'discard' | 'swap' | null = null;

  function onTileTap(tile: TileId, idx: number) {
    if (tapMode === 'swap') {
      const at = picked.indexOf(idx);
      if (at >= 0) picked.splice(at, 1);
      else if (picked.length >= cfg.swap.count) toast(root, `最多选 ${cfg.swap.count} 张`);
      else {
        const first = picked[0];
        const tiles = handTiles();
        if (first !== undefined && cfg.swap.sameSuit && suitOf(tiles[first]) !== suitOf(tile)) {
          toast(root, '换三张必须是同一种花色');
          return;
        }
        picked.push(idx);
      }
      renderHand();
      updateActions();
      return;
    }
    if (tapMode !== 'discard') return;
    const legal = new Set(engine.legalDiscards(HERO));
    if (!legal.has(tile)) {
      const me = engine.players[HERO];
      toast(root, `手上还有${SUIT_NAMES[me.lack]}，必须先打完缺门`);
      return;
    }
    if (selected === idx) {
      tryDiscard(tile);
    } else {
      selected = idx;
      renderHand();
      // 选中时顺手告诉用户打了会怎样——这是最轻量的教学，不打断节奏
      if (mode !== 'exam') {
        const a = currentDiscardAnalysis();
        const o = a?.options.find((x) => x.tile === tile);
        if (o) {
          centerHint = o.ting
            ? `打 ${o.name} → 听 ${tilesName(o.waits)}`
            : `打 ${o.name} → 还差 ${o.shanten} 张听牌，进张 ${o.ukeire} 张`;
          render();
        }
      }
    }
  }

  function handTiles(): TileId[] {
    const me = engine.players[HERO];
    const drawn = engine.phase === 'turn' && engine.turn === HERO ? engine.drawnTile : null;
    const counts = me.hand.slice();
    if (drawn !== null && counts[drawn] > 0) counts[drawn]--;
    const tiles = toTiles(counts);
    if (drawn !== null) tiles.push(drawn);
    return tiles;
  }

  /** 出牌前的「值得再考虑」提示。不拦人，只提醒 */
  function tryDiscard(tile: TileId) {
    const a = currentDiscardAnalysis();
    if (!a || mode === 'free' || mode === 'exam') return commitDiscard(tile);
    const chosen = a.options.find((o) => o.tile === tile);
    if (!chosen) return commitDiscard(tile);
    const loss = lossOf(a.best, chosen);
    const sev = severityOf(loss);
    const shouldNudge = mode === 'light' ? sev === 'major' || sev === 'blunder' : sev !== 'ok';
    if (!shouldNudge) return commitDiscard(tile);
    showNudge(tile, a, chosen);
  }

  let nudgeEl: HTMLElement | null = null;

  function closeNudge() {
    nudgeEl?.remove();
    nudgeEl = null;
  }

  function showNudge(tile: TileId, a: ReturnType<typeof analyzeDiscards>, chosen: { name: string }) {
    closeNudge();
    const box = el('div.mc-nudge');
    box.appendChild(el('div.t', { text: '这一步值得再考虑。' }));
    const row = el('div.mc-row');
    row.append(
      el('button.mc-btn.sm.ghost', {
        text: '看看为什么',
        onclick: async () => {
          closeNudge();
          coachPanel.classList.add('open');
          const facts = extractFacts(engine, HERO);
          const cmp = compareDiscard(a, tile);
          const m = await coach.explain({ topic: 'discard', facts, decision: cmp });
          if (alive()) showCoachMessage(m);
        },
      }),
      el('button.mc-btn.sm', {
        text: `就打 ${chosen.name}`,
        onclick: () => {
          closeNudge();
          commitDiscard(tile);
        },
      }),
      el('button.mc-btn.sm.primary', {
        text: `改打 ${a.best.name}`,
        onclick: () => {
          closeNudge();
          commitDiscard(a.best.tile);
        },
      }),
    );
    box.appendChild(row);
    root.appendChild(box);
    nudgeEl = box;
  }

  function commitDiscard(tile: TileId) {
    const a = currentDiscardAnalysis();
    if (a) {
      const cmp = compareDiscard(a, tile);
      const chosen = a.options.find((o) => o.tile === tile);
      const missedTing = !!a.best.ting && !chosen?.ting;
      const dangerLoss = (chosen?.danger ?? 0) > (a.best.danger ?? 0) + 0.2;
      recorder.onDecision({
        turnIndex: engine.turnIndex,
        kind: 'discard',
        seat: HERO,
        chose: tile,
        best: a.best.tile,
        loss: cmp.loss,
        severity: cmp.severity,
        shanten: chosen?.shanten ?? a.currentShanten,
        ukeire: chosen?.ukeire ?? 0,
        bestUkeire: a.best.ukeire,
        headline: cmp.same ? '打得对' : `${cmp.chosenText} → ${cmp.bestText}`,
        detail: {
          missedTing,
          dangerLoss,
          role: chosen?.role,
          dangerReason: chosen?.dangerReason,
          bestWaits: a.best.waits,
          ting: chosen?.ting,
          diffs: cmp.diffs,
        },
      });
    }
    selected = -1;
    centerHint = '';
    submit({ type: 'discard', seat: HERO, tile });
  }

  function submit(a: Action) {
    const r = resolveAction;
    resolveAction = null;
    tapMode = null;
    clear(actionBox);
    r?.(a);
  }

  /** 按当前待决策刷新底部按钮 */
  function updateActions() {
    const pend = engine.pending();
    clear(actionBox);
    if (!pend || pend.seat !== HERO) return;

    if (pend.kind === 'swap') {
      tapMode = 'swap';
      const ok = el('button.mc-act.hu', {
        text: `确定换出这 ${cfg.swap.count} 张`,
        onclick: () => {
          const tiles = picked.map((i) => handTiles()[i]);
          commitSwap(tiles);
        },
      });
      if (picked.length !== cfg.swap.count) ok.setAttribute('disabled', 'true');
      actionBox.appendChild(ok);
      if (mode === 'coach' || mode === 'light') {
        actionBox.appendChild(
          el('button.mc-act.pass', {
            text: '💡 帮我看看',
            onclick: async () => {
              coachPanel.classList.add('open');
              const facts = extractFacts(engine, HERO);
              const m = await coach.explain({ topic: 'swap', facts });
              if (alive()) showCoachMessage(m);
            },
          }),
        );
      }
      return;
    }

    if (pend.kind === 'lack') {
      for (const o of pend.options) {
        if (o.type !== 'lack') continue;
        let n = 0;
        for (let r = 0; r < 9; r++) n += engine.players[HERO].hand[o.suit * 9 + r];
        actionBox.appendChild(
          el('button.mc-act', { text: `缺${SUIT_NAMES[o.suit]}（${n} 张）`, onclick: () => commitLack(o.suit) }),
        );
      }
      if (mode === 'coach' || mode === 'light') {
        actionBox.appendChild(
          el('button.mc-act.pass', {
            text: '💡 该缺哪门',
            onclick: async () => {
              coachPanel.classList.add('open');
              const facts = extractFacts(engine, HERO);
              const m = await coach.explain({ topic: 'lack', facts });
              if (alive()) showCoachMessage(m);
            },
          }),
        );
      }
      return;
    }

    if (pend.kind === 'turn') {
      tapMode = 'discard';
      const hu = pend.options.find((o) => o.type === 'hu');
      if (hu) actionBox.appendChild(el('button.mc-act.hu', { text: '胡', onclick: () => submit(hu) }));
      const gangs = pend.options.filter((o) => o.type === 'gang');
      for (const g of gangs) {
        if (g.type !== 'gang') continue;
        actionBox.appendChild(
          el('button.mc-act.gang', {
            text: `${g.kind === 'angang' ? '暗杠' : '补杠'} ${tileName(g.tile)}`,
            onclick: () => commitGang(g),
          }),
        );
      }
      if (mode === 'coach') {
        actionBox.appendChild(
          el('button.mc-act.pass', {
            text: '💡 打哪张',
            onclick: async () => {
              coachPanel.classList.add('open');
              const facts = extractFacts(engine, HERO);
              const m = await coach.explain({ topic: 'discard', facts });
              if (alive()) showCoachMessage(m);
            },
          }),
        );
      }
      return;
    }

    if (pend.kind === 'claim') {
      const tileTxt = pend.tile !== undefined ? tileName(pend.tile) : '';
      for (const o of pend.options) {
        if (o.type === 'hu') actionBox.appendChild(el('button.mc-act.hu', { text: `胡 ${tileTxt}`, onclick: () => submit(o) }));
        else if (o.type === 'gang') actionBox.appendChild(el('button.mc-act.gang', { text: `杠 ${tileTxt}`, onclick: () => commitGang(o) }));
        else if (o.type === 'peng') actionBox.appendChild(el('button.mc-act.peng', { text: `碰 ${tileTxt}`, onclick: () => commitPeng(o) }));
        else actionBox.appendChild(el('button.mc-act.pass', { text: '过', onclick: () => submit(o) }));
      }
    }
  }

  function commitSwap(tiles: TileId[]) {
    const a = analyzeSwap(cfg, engine.players[HERO].hand, engine.seenBy(HERO));
    const cmp = compareSwap(a, tiles);
    recorder.onDecision({
      turnIndex: 0, kind: 'swap', seat: HERO,
      chose: [...tiles], best: [...a.best.tiles],
      loss: cmp.loss, severity: cmp.severity,
      shanten: a.best.shantenAfter, ukeire: 0, bestUkeire: a.best.ukeireAfter,
      headline: cmp.same ? '换得不错' : `${cmp.chosenText} → ${cmp.bestText}`,
      detail: { bestReasons: a.best.reasons, brokenMelds: cmp.same ? 0 : a.options.find((o) => o.text === cmp.chosenText)?.brokenMelds ?? 0, diffs: cmp.diffs },
    });
    picked = [];
    submit({ type: 'swap', seat: HERO, tiles });
  }

  function commitLack(suit: number) {
    const a = analyzeLack(cfg, engine.players[HERO].hand, engine.players[HERO].melds, engine.seenBy(HERO));
    const cmp = compareLack(a, suit);
    recorder.onDecision({
      turnIndex: 0, kind: 'lack', seat: HERO,
      chose: suit, best: a.best.suit,
      loss: cmp.loss, severity: cmp.severity,
      shanten: a.best.shantenAfter, ukeire: 0, bestUkeire: a.best.ukeireAfter,
      headline: cmp.same ? '定缺选对了' : `${cmp.chosenText} → ${cmp.bestText}`,
      detail: {
        bestReasons: a.best.reasons,
        chosenReason: a.options.find((o) => o.suit === suit)?.reasons.join('；'),
        diffs: cmp.diffs,
      },
    });
    submit({ type: 'lack', seat: HERO, suit: suit as 0 | 1 | 2 });
  }

  function commitGang(a: Action) {
    if (a.type !== 'gang') return;
    recorder.onDecision({
      turnIndex: engine.turnIndex, kind: 'gang', seat: HERO,
      chose: a.tile, best: a.tile, loss: 0, severity: 'ok',
      shanten: 0, ukeire: 0, bestUkeire: 0,
      headline: `杠 ${tileName(a.tile)}`,
      detail: { kind: a.kind },
    });
    submit(a);
  }

  function commitPeng(a: Action) {
    if (a.type !== 'peng') return;
    recorder.onDecision({
      turnIndex: engine.turnIndex, kind: 'peng', seat: HERO,
      chose: a.tile, best: a.tile, loss: 0, severity: 'ok',
      shanten: 0, ukeire: 0, bestUkeire: 0,
      headline: `碰 ${tileName(a.tile)}`,
      detail: {},
    });
    submit(a);
  }

  function waitHuman(pend: Pending): Promise<Action> {
    return new Promise((resolve) => {
      resolveAction = resolve;
      selected = -1;
      centerHint =
        pend.kind === 'swap'
          ? `换三张：选 ${cfg.swap.count} 张同花色`
          : pend.kind === 'lack'
            ? '请定缺'
            : pend.kind === 'claim'
              ? `${seatName(HERO, pend.from ?? 0)}打出 ${tileName(pend.tile ?? 0)}`
              : '轮到你出牌';
      render();
      updateActions();
    });
  }

  // ---------- 主循环 ----------
  /** 每走一步就把牌局存下来，刷新/误退之后能接着打 */
  function autosave() {
    saveInProgress({
      configId: cfg.id, seed, aiLevels: [...aiLevels], mode,
      actions: recorder.record.actions, decisions: recorder.record.decisions,
      startedAt: recorder.record.startedAt,
    });
  }

  async function loop() {
    engine.start();
    // 续打：把上次的动作原样重放。引擎是确定性的，重放出来就是当时那一局
    if (opts.resume) {
      try {
        for (const a of opts.resume.actions) {
          engine.apply(a);
          recorder.onAction(a);
        }
        recorder.record.decisions.push(...opts.resume.decisions);
        recorder.record.startedAt = opts.resume.startedAt;
        toast(root, `已接上上次的牌局（第 ${engine.turnIndex} 手）`);
      } catch {
        // 重放不出来（比如规则改过了）：这局作废，从头开始，不能让用户卡在一个坏存档上
        clearInProgress();
        toast(root, '上次的牌局恢复失败，重新开一局');
      }
    }
    render();
    await sleep(320);

    let guard = 0;
    while (alive() && engine.phase !== 'over' && guard++ < 3000) {
      const pend = engine.pending();
      if (!pend) break;

      let action: Action;
      if (pend.seat === HERO) {
        action = await waitHuman(pend);
        if (!alive()) return;
      } else {
        // AI 思考的停顿：太快看不清发生了什么，太慢又烦
        await sleep(pend.kind === 'claim' ? 260 : 420);
        if (!alive()) return;
        action = decide(aiLevels[pend.seat - 1] ?? aiLevels[0], engine, pend, rng);
        centerHint = describeAi(action);
      }

      recorder.onAction(action);
      try {
        engine.apply(action);
      } catch (e) {
        // 引擎拒绝了动作说明有 bug，宁可当场看见也不要悄悄错下去
        toast(root, `动作被规则引擎拒绝：${(e as Error).message}`);
        break;
      }
      autosave();
      discardAnalysisCache = null;
      render();
      updateActions();
    }

    if (!alive()) return;
    finish();
  }

  function describeAi(a: Action): string {
    const who = seatName(HERO, a.seat);
    switch (a.type) {
      case 'discard': return `${who} 打 ${tileName(a.tile)}`;
      case 'peng': return `${who} 碰 ${tileName(a.tile)}`;
      case 'gang': return `${who} 杠 ${tileName(a.tile)}`;
      case 'hu': return `${who} 胡了！`;
      case 'lack': return `${who} 定缺`;
      case 'swap': return `${who} 换好了`;
      default: return '';
    }
  }

  // ---------- 结算 ----------
  function finish() {
    clearInProgress();
    const rec = recorder.finish(engine);
    const report = buildReport(rec);
    const overlay = el('div.mc-overlay');
    const me = engine.players[HERO];
    const title = me.won ? '胡 了 ！' : engine.result?.exhausted ? '流 局' : '这把没上';
    overlay.appendChild(el('div', { class: `mc-result-title${me.won ? ' win' : ''}`, text: title }));
    overlay.appendChild(el('div', { style: 'text-align:center;color:var(--mc-muted);font-size:13px', text: report.verdict }));

    const scores = el('div.mc-scores');
    engine.players.forEach((p, i) => {
      const row = el(`div.mc-score-row${i === HERO ? '.hero' : ''}`);
      const tags = [
        ...p.wins.flatMap((w) => w.score.names),
        ...(engine.result?.drawRows.find((r) => r.seat === i)?.reasons ?? []),
      ];
      row.append(
        el('span.nm', { text: seatName(HERO, i) }),
        el('span.tags', { text: tags.join('·') || '—' }),
        el('span', { class: `sc ${p.score > 0 ? 'pos' : p.score < 0 ? 'neg' : ''}`, text: `${p.score > 0 ? '+' : ''}${p.score}` }),
      );
      scores.appendChild(row);
    });
    overlay.appendChild(scores);

    // 关键失误速览：详细的留给复盘页
    if (report.keyMoments.length) {
      const card = el('div.mc-card');
      card.appendChild(el('h3', { text: `本局 ${report.keyMoments.length} 个关键节点` }));
      for (const m of report.keyMoments.slice(0, 3)) {
        card.appendChild(el('p', { text: `· ${m.title}：你选 ${m.yours}，更好的是 ${m.better}` }));
      }
      overlay.appendChild(card);
    } else {
      overlay.appendChild(el('div.mc-card', {}, el('h3', { text: '本局没有明显失误' }), el('p', { text: '继续保持，可以去挑战更高档位的 AI。' })));
    }

    const btns = el('div.mc-row', { style: 'margin-top:8px;flex-wrap:wrap' });
    btns.append(
      el('button.mc-btn.primary', { text: '看详细复盘', onclick: () => opts.onReview(rec, report) }),
      el('button.mc-btn', { text: '再来一局', onclick: () => opts.onAgain() }),
      el('button.mc-btn.ghost', { text: '返回', onclick: () => opts.onExit() }),
    );
    overlay.appendChild(btns);
    root.appendChild(overlay);

    // 无论用户点不点复盘，牌谱和学习数据都要先落盘
    opts.onSave(rec, report);
  }

  loop();

  return () => {
    disposed = true;
    resolveAction = null;
    root.remove();
  };
}
