/**
 * 斗地主 · 单人对战两个 AI。
 *
 * 这一层只做两件事：**把 GameState 画出来**，和**把用户操作翻译成引擎调用**。
 * 所有规则判断（牌型、能不能压、算倍数、判胜负）都在 patterns.ts / game.ts 里，
 * 这里一行都不写——否则规则会在界面代码里长出第二个版本，两边迟早不一致。
 */
import './doudizhu.css';
import { cardsName, sortCards, type Card } from './cards';
import {
  createGame,
  legalBids,
  nextSeat,
  pass,
  placeBid,
  playCards,
  resolveAllPass,
  totalMultiplier,
  type GameState,
  type Seat,
} from './game';
import { analyzeMove, isBomb, type Move } from './patterns';
import {
  bidAdvice,
  decideBid,
  decidePlay,
  hintMove,
  memoryFacts,
  buildMemory,
  publicViewFor,
  reviewHumanPlay,
  type Difficulty,
} from './ai';
import {
  computeStats,
  loadRecords,
  loadSettings,
  saveRecord,
  saveSettings,
  type Settings,
} from './records';
import { btn, cardsEl, field, flash, playedEl, rowEl, sayEl, seatEl, segment } from './view';
import {
  isMuted,
  setMuted,
  sfxCoin,
  sfxDeal,
  sfxFanfare,
  sfxGangHeavy,
  sfxLose,
  sfxTap,
  sfxThrow,
  sfxTick,
  sfxWinBig,
  unlockAudio,
} from '../gamesfx';

const MY_SEAT: Seat = 0;
const AVATARS = ['🙂', '🐱', '🦊'];
const NAMES: [string, string, string] = ['你', '小满', '陈伯'];

/** AI 思考时间：太快看不清它出了什么，太慢又磨人 */
const AI_THINK_MS = 620;
const AI_BID_MS = 520;

export function bootDoudizhu(app: HTMLElement, onExit: (restart: boolean) => void): () => void {
  let settings = loadSettings();
  let state: GameState | null = null;
  let selected = new Set<string>();
  let hinted: string[] = [];
  let message = '';
  let messageWarn = false;
  /** 每家这一轮打出的牌（画在中间出牌区） */
  let lastPlays: (Move | null)[] = [null, null, null];
  let passedFlags: boolean[] = [false, false, false];
  let bubbles: (string | null)[] = [null, null, null];
  let coachText = '';
  let coachDetail = '';
  let clockLeft = 0;
  let disposed = false;
  let dealing = false;
  /**
   * 「我这一回合」的标识，形如 "轮次:历史长度"。
   *
   * 回合初始化（清空选中、设提示语、起倒计时）必须**在这一回合第一次画出来之前**
   * 完成。之前是放在 stepPlaying 里延迟 260ms 跑的，而按钮在 afterMove 里就已经
   * 画出来了——玩家手快，在这 260ms 内点的牌会被随后的初始化清掉，
   * 表现为"我明明点了牌，它自己弹回去了"。
   * 所以改成在 render() 开头做，每回合只做一次。
   */
  let myTurnKey = '';

  const timers = new Set<ReturnType<typeof setTimeout>>();
  let clockTimer: ReturnType<typeof setInterval> | null = null;

  const later = (fn: () => void, ms: number) => {
    const t = setTimeout(() => {
      timers.delete(t);
      if (!disposed) fn();
    }, ms);
    timers.add(t);
    return t;
  };

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers.clear();
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
  };

  const root = document.createElement('div');
  root.className = 'dd';
  app.appendChild(root);

  const sound = (fn: () => void) => {
    if (settings.sound && !isMuted()) fn();
  };

  // ---------------------------------------------------------------- 首页

  function showHome() {
    clearTimers();
    state = null;
    root.innerHTML = '';
    const overlay = document.createElement('div');
    overlay.className = 'dd-overlay';
    const panel = document.createElement('div');
    panel.className = 'dd-panel';

    const stats = computeStats();
    panel.innerHTML = `
      <h2>🃏 斗地主</h2>
      <div class="sub">一个人 + 两个 AI，从洗牌打到结算</div>`;

    if (stats.total) {
      const rows = document.createElement('div');
      rows.className = 'dd-rows';
      rows.append(
        rowEl('总战绩', `${stats.total} 局 ${stats.wins} 胜（${Math.round((stats.wins / stats.total) * 100)}%）`),
        rowEl('地主 / 农民', `${stats.landlordWins}/${stats.landlordGames} · ${stats.farmerWins}/${stats.farmerGames}`),
        rowEl('总积分', `${stats.net > 0 ? '+' : ''}${stats.net}`, stats.net >= 0 ? 'plus' : 'minus'),
      );
      panel.appendChild(rows);
    }

    panel.appendChild(
      field(
        'AI 难度',
        segment(
          [
            { label: '简单', value: 'easy' as Difficulty },
            { label: '普通', value: 'normal' as Difficulty },
            { label: '困难', value: 'hard' as Difficulty },
          ],
          settings.difficulty,
          (v) => {
            settings = { ...settings, difficulty: v };
            saveSettings(settings);
            showHome();
          },
        ),
        difficultyNote(settings.difficulty),
      ),
    );

    const actions = document.createElement('div');
    actions.className = 'dd-panel-actions';
    actions.append(
      btn('开始牌局', () => {
        unlockAudio();
        startGame();
      }, 'primary'),
    );
    panel.appendChild(actions);

    const actions2 = document.createElement('div');
    actions2.className = 'dd-panel-actions';
    actions2.style.marginTop = '10px';
    actions2.append(
      btn('设置', showSettings, 'ghost'),
      btn('战绩', showRecords, 'ghost'),
      btn('返回', () => onExit(false), 'ghost'),
    );
    panel.appendChild(actions2);

    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function difficultyNote(d: Difficulty): string {
    if (d === 'easy') return '简单：只看自己的牌顺不顺，不记牌，炸弹说炸就炸。';
    if (d === 'normal') return '普通：会算出完这手还剩几手，留控制牌，不随便拆炸弹。';
    return '困难：记牌推断对手剩什么、两个农民会配合、炸弹留到关键时刻、残局不喂单牌。';
  }

  // ---------------------------------------------------------------- 设置

  function showSettings() {
    const overlay = document.createElement('div');
    overlay.className = 'dd-overlay';
    const panel = document.createElement('div');
    panel.className = 'dd-panel';
    panel.innerHTML = '<h2>设置</h2><div class="sub">改完立刻生效，下一局开始应用规则项</div>';

    const put = (s: Partial<Settings>) => {
      settings = { ...settings, ...s };
      saveSettings(settings);
      overlay.remove();
      showSettings();
    };

    panel.append(
      field(
        '学习模式',
        segment(
          [
            { label: '关', value: 0 },
            { label: '开', value: 1 },
          ],
          settings.coach ? 1 : 0,
          (v) => put({ coach: v === 1 }),
        ),
        '打开后：AI 每次出牌会说明理由，你出完牌也会提示有没有更好的选择。',
      ),
      field(
        '出牌时限',
        segment(
          [
            { label: '不限', value: 0 },
            { label: '20 秒', value: 20 },
            { label: '30 秒', value: 30 },
          ],
          settings.clock,
          (v) => put({ clock: v }),
        ),
      ),
      field(
        '三家都不叫',
        segment(
          [
            { label: '重新发牌', value: 'redeal' as const },
            { label: '随机指定', value: 'random' as const },
          ],
          settings.onAllPass,
          (v) => put({ onAllPass: v }),
        ),
      ),
      field(
        '音效',
        segment(
          [
            { label: '关', value: 0 },
            { label: '开', value: 1 },
          ],
          settings.sound ? 1 : 0,
          (v) => {
            setMuted(v === 0);
            put({ sound: v === 1 });
          },
        ),
      ),
      field(
        '动画',
        segment(
          [
            { label: '关', value: 0 },
            { label: '开', value: 1 },
          ],
          settings.animations ? 1 : 0,
          (v) => put({ animations: v === 1 }),
        ),
      ),
    );

    const actions = document.createElement('div');
    actions.className = 'dd-panel-actions';
    actions.append(btn('完成', () => overlay.remove(), 'primary'));
    panel.appendChild(actions);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function showRecords() {
    const overlay = document.createElement('div');
    overlay.className = 'dd-overlay';
    const panel = document.createElement('div');
    panel.className = 'dd-panel';
    const list = loadRecords();
    const stats = computeStats(list);
    panel.innerHTML = `<h2>战绩</h2><div class="sub">${
      stats.total ? `${stats.total} 局 · ${stats.wins} 胜 · 最高连胜 ${stats.bestStreak}` : '还没有记录'
    }</div>`;

    if (!list.length) {
      const e = document.createElement('div');
      e.className = 'dd-empty';
      e.textContent = '打完一局就会出现在这里';
      panel.appendChild(e);
    } else {
      for (const r of list.slice(0, 30)) {
        const row = document.createElement('div');
        row.className = 'dd-record';
        const d = new Date(r.at);
        const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(
          d.getMinutes(),
        ).padStart(2, '0')}`;
        const won = r.iAmLandlord ? r.winner === 'landlord' : r.winner === 'farmers';
        row.innerHTML = `
          <span>
            <span class="who">${r.iAmLandlord ? '地主' : '农民'} · ${r.bidScore} 分 · ${r.multiplier} 倍</span>
            <div class="when">${when} · ${r.history.length} 步${r.bombCount ? ` · ${r.bombCount} 炸` : ''}</div>
          </span>
          <span class="sc ${won ? 'plus' : 'minus'}">${won ? '胜' : '负'} ${r.myScore > 0 ? '+' : ''}${r.myScore}</span>`;
        panel.appendChild(row);
      }
    }

    const actions = document.createElement('div');
    actions.className = 'dd-panel-actions';
    actions.append(btn('关闭', () => overlay.remove(), 'primary'));
    panel.appendChild(actions);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  // ---------------------------------------------------------------- 开局

  function startGame(debugSetup?: Parameters<typeof createGame>[0]) {
    clearTimers();
    // 开局前把所有弹层收掉。render() 是**故意**保留弹层的（设置/战绩面板
    // 不能因为牌桌重绘就消失），所以首页面板必须在这里显式关掉，
    // 否则它会一直盖在牌桌上，叫分按钮看得见却点不着。
    for (const o of root.querySelectorAll('.dd-overlay')) o.remove();
    myTurnKey = '';
    selected = new Set();
    hinted = [];
    lastPlays = [null, null, null];
    passedFlags = [false, false, false];
    bubbles = [null, null, null];
    coachText = '';
    coachDetail = '';
    message = '';
    messageWarn = false;

    state = createGame({
      humanSeat: MY_SEAT,
      names: NAMES,
      config: { onAllPass: settings.onAllPass },
      ...debugSetup,
    });

    dealing = settings.animations;
    render();
    sound(sfxDeal);
    later(() => {
      dealing = false;
      render();
      stepBidding();
    }, settings.animations ? 420 : 0);
  }

  // ---------------------------------------------------------------- 叫地主

  function stepBidding() {
    if (!state || state.phase !== 'bidding') return;
    const seat = state.currentPlayer;
    if (seat === MY_SEAT) {
      startClock();
      render();
      return;
    }
    stopClock();
    render();
    later(() => {
      if (!state || state.phase !== 'bidding' || state.currentPlayer !== seat) return;
      const value = decideBid(state.players[seat].hand, state.highestBid, settings.difficulty);
      const legal = legalBids(state);
      doBid(seat, legal.includes(value) ? value : 0);
    }, AI_BID_MS);
  }

  function doBid(seat: Seat, value: number) {
    if (!state) return;
    const r = placeBid(state, seat, value);
    if (!r.ok) {
      message = r.reason ?? '不能这样叫分';
      messageWarn = true;
      render();
      return;
    }
    bubbles[seat] = value === 0 ? '不叫' : `${value} 分`;
    sound(value === 0 ? sfxTap : sfxCoin);
    later(() => {
      bubbles[seat] = null;
      render();
    }, 1200);

    if (r.allPassed) {
      message = '三家都不叫';
      render();
      later(() => {
        if (!state) return;
        state = resolveAllPass(state, { humanSeat: MY_SEAT, names: NAMES });
        selected = new Set();
        if (state.phase === 'playing') {
          message = `${state.players[state.landlord!].name} 当地主`;
          render();
          later(stepPlaying, 700);
        } else {
          message = '重新发牌';
          render();
          later(stepBidding, 500);
        }
      }, 900);
      return;
    }

    if (r.settled) {
      const lord = state.landlord!;
      message = `${state.players[lord].name} 以 ${state.bidScore} 分成为地主`;
      messageWarn = false;
      sound(sfxCoin);
      render();
      later(stepPlaying, 900);
      return;
    }

    render();
    stepBidding();
  }

  // ---------------------------------------------------------------- 出牌

  function stepPlaying() {
    if (!state || state.phase !== 'playing') return;
    const seat = state.currentPlayer;

    // 新的一轮：把上一轮桌面上的牌清掉
    if (state.currentMove === null) {
      lastPlays = [null, null, null];
      passedFlags = [false, false, false];
    }

    if (seat === MY_SEAT) {
      // 回合初始化交给 render()，这里只负责把界面刷出来
      render();
      return;
    }

    stopClock();
    render();
    later(() => {
      if (!state || state.phase !== 'playing' || state.currentPlayer !== seat) return;
      const view = publicViewFor(state, seat);
      const decision = decidePlay(view, settings.difficulty);
      if (settings.coach) {
        coachText = `${state.players[seat].name}：${decision.reason}`;
        coachDetail = '';
      }
      if (decision.action === 'pass') {
        const r = pass(state, seat);
        if (!r.ok) {
          // 引擎拒绝了 AI 的"不要"——说明有 bug，兜底让它出一张，绝不把牌局卡在这里
          const fallback = sortCards(state.players[seat].hand)[0];
          const forced = playCards(state, seat, [fallback]);
          lastPlays[seat] = forced.move ?? null;
          passedFlags[seat] = false;
          afterMove(seat, false);
          return;
        }
        passedFlags[seat] = true;
        lastPlays[seat] = null;
        bubbles[seat] = '不要';
        sound(sfxTap);
        later(() => {
          bubbles[seat] = null;
          render();
        }, 900);
        afterMove(seat, r.newRound);
        return;
      }

      const r = playCards(state, seat, decision.cards);
      if (!r.ok) {
        message = `AI 出牌被拒绝：${r.reason}`;
        messageWarn = true;
        render();
        return;
      }
      passedFlags[seat] = false;
      lastPlays[seat] = r.move!;
      announce(seat, r.move!);
      afterMove(seat, false);
    }, AI_THINK_MS);
  }

  /** 出牌/不要之后的统一收尾：判结束、报单、进入下一家 */
  function afterMove(seat: Seat, newRound: boolean) {
    if (!state) return;
    if (state.phase === 'finished') {
      render();
      later(showResult, 700);
      return;
    }
    if (newRound) {
      lastPlays = [null, null, null];
      passedFlags = [false, false, false];
    }
    // 报单/报双
    const left = state.players[seat].hand.length;
    if (left === 1 || left === 2) {
      bubbles[seat] = left === 1 ? '只剩一张！' : '还剩两张';
      later(() => {
        bubbles[seat] = null;
        render();
      }, 1400);
    }
    render();
    later(stepPlaying, 260);
  }

  function announce(seat: Seat, move: Move) {
    if (isBomb(move)) {
      sound(sfxGangHeavy);
      if (settings.animations) flash(root, move.type === 'rocket' ? 'rocket' : 'bomb');
      bubbles[seat] = move.type === 'rocket' ? '王炸！' : '炸！';
      later(() => {
        bubbles[seat] = null;
        render();
      }, 1200);
    } else {
      sound(sfxThrow);
    }
  }

  // ---------------------------------------------------------------- 真人操作

  function toggleCard(card: Card) {
    if (!state || state.phase !== 'playing' || state.currentPlayer !== MY_SEAT) return;
    if (selected.has(card.id)) selected.delete(card.id);
    else selected.add(card.id);
    hinted = [];
    message = '';
    messageWarn = false;
    sound(sfxTap);
    render();
  }

  function selectedCards(): Card[] {
    if (!state) return [];
    return sortCards(state.players[MY_SEAT].hand.filter((c) => selected.has(c.id)));
  }

  function doPlay() {
    if (!state) return;
    const cards = selectedCards();
    if (!cards.length) {
      message = '先点牌选中，再点出牌';
      messageWarn = true;
      render();
      return;
    }
    // 先给一次**具体**的提示，再交给引擎
    const analysis = analyzeMove(cards);
    if (!analysis.isValid) {
      message = analysis.reason;
      messageWarn = true;
      sound(() => sfxTick(true));
      render();
      return;
    }

    const view = settings.coach ? publicViewFor(state, MY_SEAT) : null;
    const r = playCards(state, MY_SEAT, cards);
    if (!r.ok) {
      message = r.reason ?? '这手牌出不了';
      messageWarn = true;
      sound(() => sfxTick(true));
      render();
      return;
    }

    if (view) {
      const review = reviewHumanPlay(view, cards, 'hard');
      coachText = review.better ? review.text : '这手打得和最优解一致。';
      coachDetail = review.better ? `推荐：${cardsName(review.suggestion.cards)}` : '';
    }

    lastPlays = [null, null, null];
    passedFlags = [false, false, false];
    lastPlays[MY_SEAT] = r.move!;
    selected = new Set();
    hinted = [];
    message = '';
    stopClock();
    announce(MY_SEAT, r.move!);
    afterMove(MY_SEAT, false);
  }

  function doPass() {
    if (!state) return;
    const r = pass(state, MY_SEAT);
    if (!r.ok) {
      message = r.reason ?? '现在不能不要';
      messageWarn = true;
      render();
      return;
    }
    passedFlags[MY_SEAT] = true;
    lastPlays[MY_SEAT] = null;
    selected = new Set();
    hinted = [];
    stopClock();
    sound(sfxTap);
    afterMove(MY_SEAT, r.newRound);
  }

  function doHint() {
    if (!state) return;
    const table = state.currentMove?.move ?? null;
    const cards = hintMove(state.players[MY_SEAT].hand, table);
    if (!cards) {
      message = table ? '这手牌你压不住，只能不要' : '手里没牌了';
      messageWarn = true;
      render();
      return;
    }
    hinted = cards.map((c) => c.id);
    selected = new Set(hinted);
    sound(sfxTap);
    render();
  }

  // ---------------------------------------------------------------- 倒计时

  function startClock() {
    stopClock();
    if (!settings.clock) return;
    clockLeft = settings.clock;
    clockTimer = setInterval(() => {
      if (disposed || !state) return stopClock();
      clockLeft--;
      if (clockLeft <= 5 && clockLeft > 0) sound(() => sfxTick(true));
      if (clockLeft <= 0) {
        stopClock();
        // 超时：能不要就不要，必须出牌就出提示的那手，绝不让牌局停住
        if (state.phase === 'bidding') doBid(MY_SEAT, 0);
        else if (state.currentMove) doPass();
        else {
          const cards = hintMove(state.players[MY_SEAT].hand, null);
          if (cards) {
            selected = new Set(cards.map((c) => c.id));
            doPlay();
          }
        }
        return;
      }
      updateClock();
    }, 1000);
    updateClock();
  }

  function stopClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    clockLeft = 0;
    updateClock();
  }

  function updateClock() {
    const el = root.querySelector('.dd-clock') as HTMLElement | null;
    if (!el) return;
    if (!clockLeft) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'flex';
    el.textContent = String(clockLeft);
    el.classList.toggle('urgent', clockLeft <= 5);
  }

  // ---------------------------------------------------------------- 结算

  function showResult() {
    if (!state?.result) return;
    const res = state.result;
    const iAmLandlord = state.landlord === MY_SEAT;
    const won = iAmLandlord ? res.winner === 'landlord' : res.winner === 'farmers';
    const myScore = res.scores[MY_SEAT];

    saveRecord({
      at: Date.now(),
      seed: state.seed,
      mySeat: MY_SEAT,
      landlord: res.landlord,
      iAmLandlord,
      names: NAMES,
      bidScore: res.bidScore,
      multiplier: res.multiplier,
      bombCount: res.bombCount,
      spring: res.spring,
      winner: res.winner,
      myScore,
      scores: res.scores,
      difficulty: settings.difficulty,
      history: state.history,
    });

    sound(won ? sfxWinBig : sfxLose);
    if (won) sound(sfxFanfare);

    const overlay = document.createElement('div');
    overlay.className = 'dd-overlay';
    const panel = document.createElement('div');
    panel.className = 'dd-panel';

    const title = document.createElement('div');
    title.className = `dd-result-title ${won ? 'win' : 'lose'}`;
    title.textContent = won ? '胜 利' : '失 败';
    const score = document.createElement('div');
    score.className = `dd-score-big ${myScore >= 0 ? 'plus' : 'minus'}`;
    score.textContent = `${myScore > 0 ? '+' : ''}${myScore}`;
    panel.append(title, score);

    const rows = document.createElement('div');
    rows.className = 'dd-rows';
    rows.append(
      rowEl('我的身份', iAmLandlord ? '地主' : '农民'),
      rowEl('地主', state.players[res.landlord].name),
      rowEl('叫分', `${res.bidScore} 分`),
      rowEl('炸弹', res.bombCount ? `${res.bombCount} 个（×${2 ** res.bombCount}）` : '无'),
      rowEl('春天', res.spring === 'spring' ? '春天 ×2' : res.spring === 'anti-spring' ? '反春 ×2' : '无'),
      rowEl('最终倍数', `${res.bidScore} × ${res.multiplier} = ${res.bidScore * res.multiplier}`),
    );
    for (const p of state.players) {
      rows.append(
        rowEl(
          `${p.name}${p.isLandlord ? '（地主）' : ''}`,
          `${res.scores[p.seat] > 0 ? '+' : ''}${res.scores[p.seat]} · 剩 ${res.remaining[p.seat]} 张`,
          res.scores[p.seat] >= 0 ? 'plus' : 'minus',
        ),
      );
    }
    panel.appendChild(rows);

    const actions = document.createElement('div');
    actions.className = 'dd-panel-actions';
    actions.append(
      btn('再来一局', () => {
        overlay.remove();
        startGame();
      }, 'primary'),
      btn('回首页', () => {
        overlay.remove();
        showHome();
      }, 'ghost'),
    );
    panel.appendChild(actions);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  // ---------------------------------------------------------------- 渲染

  /** 轮到我时的一次性回合初始化。放在 render 开头，保证在任何点击之前跑完 */
  function ensureMyTurn() {
    if (!state || state.phase !== 'playing' || state.currentPlayer !== MY_SEAT) return;
    const key = `${state.round}:${state.history.length}`;
    if (myTurnKey === key) return;
    myTurnKey = key;
    selected = new Set();
    hinted = [];
    message = state.currentMove ? '轮到你，压住或者不要' : '轮到你出牌';
    messageWarn = false;
    startClock();
  }

  function render() {
    if (!state || disposed) return;
    ensureMyTurn();
    const s = state;
    // 弹层单独挂在 root 上，重绘牌桌时不能把它们冲掉
    const overlays = [...root.querySelectorAll('.dd-overlay, .dd-flash')];
    root.innerHTML = '';
    for (const o of overlays) root.appendChild(o);

    root.appendChild(renderTop(s));
    root.appendChild(renderTable(s));
    root.appendChild(renderActions(s));
    updateClock();
  }

  function renderTop(s: GameState): HTMLElement {
    const top = document.createElement('div');
    top.className = 'dd-top';
    top.appendChild(iconBtn('‹', () => (confirm('退出这一局？') ? showHome() : undefined)));

    const status = document.createElement('div');
    status.className = 'dd-status';
    const phaseText = s.phase === 'bidding' ? '叫地主' : s.phase === 'playing' ? `第 ${s.round} 轮` : '已结束';
    status.appendChild(chip(`<b>${phaseText}</b>`, 'phase'));
    status.appendChild(chip(`当前 <b>${s.players[s.currentPlayer].name}</b>`));
    if (s.landlord !== null) {
      status.appendChild(chip(`地主 <b>${s.players[s.landlord].name}</b>`));
      const mult = totalMultiplier(s);
      status.appendChild(chip(`倍数 <b>${mult}</b>`, mult >= 4 ? 'hot' : ''));
    }
    if (s.bombCount) status.appendChild(chip(`炸弹 <b>${s.bombCount}</b>`, 'hot'));
    top.appendChild(status);

    top.appendChild(iconBtn('☰', showSettings));
    return top;
  }

  function chip(html: string, cls = ''): HTMLElement {
    const el = document.createElement('div');
    el.className = `dd-chip${cls ? ' ' + cls : ''}`;
    el.innerHTML = html;
    return el;
  }

  function iconBtn(text: string, onClick: () => void): HTMLElement {
    const b = document.createElement('button');
    b.className = 'dd-btn-icon';
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderTable(s: GameState): HTMLElement {
    const table = document.createElement('div');
    table.className = 'dd-table';

    // 上方两家：座位 2（左上 = 我的上家）、座位 1（右上 = 我的下家）
    const seats = document.createElement('div');
    seats.className = 'dd-seats';
    for (const [seat, side] of [[2, 'left'], [1, 'right']] as [Seat, 'left' | 'right'][]) {
      seats.appendChild(
        seatEl({
          name: s.players[seat].name,
          avatar: AVATARS[seat],
          isLandlord: s.players[seat].isLandlord,
          count: s.players[seat].hand.length,
          active: s.currentPlayer === seat && s.phase !== 'finished',
          side,
        }),
      );
    }
    table.appendChild(seats);

    const center = document.createElement('div');
    center.className = 'dd-center';

    // 底牌
    const bottomRow = document.createElement('div');
    bottomRow.className = 'dd-bottom-row';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = '底牌';
    bottomRow.appendChild(label);
    if (s.bottomRevealed) {
      bottomRow.appendChild(cardsEl(s.bottom));
    } else {
      const hidden = document.createElement('div');
      hidden.className = 'dd-cards';
      for (let i = 0; i < 3; i++) {
        const back = document.createElement('div');
        back.className = 'dd-card';
        back.style.background = 'linear-gradient(160deg,#3b6b60,#24463f)';
        back.style.borderColor = 'rgba(255,255,255,.18)';
        hidden.appendChild(back);
      }
      bottomRow.appendChild(hidden);
    }
    center.appendChild(bottomRow);

    // 三个出牌区：左（座位2）、中（我）、右（座位1）
    center.appendChild(wrapPlayed(2, 'left'));
    center.appendChild(wrapPlayed(MY_SEAT, 'mine'));
    center.appendChild(wrapPlayed(1, 'right'));

    // 气泡
    for (const [seat, side] of [[2, 'left'], [1, 'right']] as [Seat, 'left' | 'right'][]) {
      if (bubbles[seat]) center.appendChild(sayEl(bubbles[seat]!, side));
    }

    if (message) {
      const hint = document.createElement('div');
      hint.className = `dd-hint${messageWarn ? ' warn' : ''}`;
      hint.textContent = message;
      center.appendChild(hint);
    }

    if (settings.coach && coachText) {
      const coach = document.createElement('div');
      coach.className = 'dd-coach';
      coach.innerHTML = `<b>教练</b> ${coachText}`;
      if (coachDetail) {
        const why = document.createElement('span');
        why.className = 'why';
        why.textContent = '为什么？';
        why.addEventListener('click', () => showWhy());
        coach.appendChild(why);
      }
      center.appendChild(coach);
    }

    const clock = document.createElement('div');
    clock.className = 'dd-clock';
    clock.style.display = 'none';
    center.appendChild(clock);

    if (import.meta.env.DEV) center.appendChild(debugPanel());

    table.appendChild(center);

    // 我的手牌
    const mine = document.createElement('div');
    mine.className = `dd-mine${dealing ? ' dd-anim-deal' : ''}`;
    const myHand = s.players[MY_SEAT].hand;
    const row = document.createElement('div');
    row.className = 'dd-cards';
    const myTurn = s.phase === 'playing' && s.currentPlayer === MY_SEAT;
    myHand.forEach((c, i) => {
      const el = cardsElCard(c);
      if (selected.has(c.id)) el.classList.add('selected');
      if (hinted.includes(c.id)) el.classList.add('hinted');
      if (!myTurn) el.classList.add('dim');
      if (dealing) el.style.animationDelay = `${i * 16}ms`;
      el.addEventListener('click', () => toggleCard(c));
      row.appendChild(el);
    });
    mine.appendChild(row);
    table.appendChild(mine);
    // 必须等挂到文档上才量得到宽度
    requestAnimationFrame(() => fitHand(row, myHand.length));

    return table;
  }

  function cardsElCard(c: Card): HTMLElement {
    const wrap = cardsEl([c]);
    return wrap.firstElementChild as HTMLElement;
  }

  function wrapPlayed(seat: Seat, kind: 'left' | 'right' | 'mine'): HTMLElement {
    const el = playedEl(lastPlays[seat], passedFlags[seat], kind === 'mine');
    el.classList.add(kind === 'mine' ? 'mine' : 'side');
    if (lastPlays[seat] && settings.animations) el.classList.add('dd-anim-play');
    return el;
  }

  /**
   * 手牌按容器宽度收紧。
   *
   * 地主有 20 张牌，按固定叠放比例在窄屏上会超出屏幕右边——最右边那几张
   * 直接点不到。这里按实际可用宽度反算每张牌的步进，保证再多牌也铺得下。
   */
  function fitHand(row: HTMLElement, count: number) {
    if (count < 2) return;
    // 必须量 root（它是 position:fixed，永远等于视口宽），不能量父元素——
    // 父元素这时已经被这排牌自己撑宽了，照它算出来的还是溢出的宽度。
    const avail = root.clientWidth - 24;
    const cardW = (row.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0;
    if (avail <= 0 || !cardW) return;
    const natural = cardW * 0.45;
    const needed = (avail - cardW) / (count - 1);
    row.style.setProperty('--step', `${Math.max(6, Math.min(natural, needed))}px`);
  }

  function renderActions(s: GameState): HTMLElement {
    const box = document.createElement('div');
    box.className = 'dd-actions';

    if (s.phase === 'finished') {
      box.append(btn('再来一局', () => startGame(), 'primary'), btn('回首页', showHome, 'ghost'));
      return box;
    }

    if (s.phase === 'bidding') {
      if (s.currentPlayer !== MY_SEAT) {
        const w = document.createElement('div');
        w.className = 'dd-waiting';
        w.textContent = `等 ${s.players[s.currentPlayer].name} 叫分…`;
        box.appendChild(w);
        return box;
      }
      const row = document.createElement('div');
      row.className = 'dd-bid-row';
      const legal = legalBids(s);
      for (const v of [0, 1, 2, 3]) {
        const b = document.createElement('button');
        b.className = `dd-bid-btn${v === 3 ? ' hot' : ''}`;
        b.textContent = v === 0 ? '不叫' : `${v} 分`;
        b.disabled = !legal.includes(v);
        b.addEventListener('click', () => doBid(MY_SEAT, v));
        row.appendChild(b);
      }
      box.appendChild(row);
      if (settings.coach) {
        const advice = bidAdvice(s.players[MY_SEAT].hand);
        message = advice.reason;
      }
      return box;
    }

    // 出牌阶段
    if (s.currentPlayer !== MY_SEAT) {
      const w = document.createElement('div');
      w.className = 'dd-waiting';
      w.textContent = `等 ${s.players[s.currentPlayer].name} 出牌…`;
      box.appendChild(w);
      return box;
    }

    const canPass = s.currentMove !== null;
    const passBtn = btn('不要', doPass, 'danger');
    passBtn.disabled = !canPass;
    if (!canPass) passBtn.title = '该你先出牌，不能不要';
    box.append(passBtn, btn('提示', doHint, 'ghost'), btn('出牌', doPlay, 'primary'));
    return box;
  }

  /** 学习模式里的「为什么」：把记牌信息摊开给玩家看 */
  function showWhy() {
    if (!state || state.landlord === null) return;
    const view = publicViewFor(state, MY_SEAT);
    const facts = memoryFacts(buildMemory(view));
    const overlay = document.createElement('div');
    overlay.className = 'dd-overlay';
    const panel = document.createElement('div');
    panel.className = 'dd-panel';
    panel.innerHTML = '<h2>为什么这么打</h2><div class="sub">以下都是公开信息，你自己也数得出来</div>';
    const rows = document.createElement('div');
    rows.className = 'dd-rows';
    rows.append(
      rowEl('教练建议', coachDetail || coachText),
      rowEl('还没出现的 2', `${facts.twosLeft} 张`),
      rowEl('大王 / 小王', `${facts.bigJokerLeft ? '还没出' : '已出'} / ${facts.smallJokerLeft ? '还没出' : '已出'}`),
      rowEl('对手还可能有炸弹', facts.possibleBombs ? `${facts.possibleBombs} 种可能` : '没有了'),
      rowEl('场上最大的牌', facts.biggestOutstanding > 0 ? rankText(facts.biggestOutstanding) : '都出完了'),
      rowEl('三家剩牌', facts.remaining.map((n, i) => `${NAMES[i]} ${n}`).join(' · ')),
    );
    panel.appendChild(rows);
    const actions = document.createElement('div');
    actions.className = 'dd-panel-actions';
    actions.append(btn('知道了', () => overlay.remove(), 'primary'));
    panel.appendChild(actions);
    overlay.appendChild(panel);
    root.appendChild(overlay);
  }

  function rankText(r: number): string {
    if (r === 17) return '大王';
    if (r === 16) return '小王';
    if (r === 15) return '2';
    if (r === 14) return 'A';
    if (r === 13) return 'K';
    if (r === 12) return 'Q';
    if (r === 11) return 'J';
    return String(r);
  }

  /**
   * 开发调试面板。
   * **只在 import.meta.env.DEV 下挂载**，生产构建里这段代码连同按钮都不会出现。
   */
  function debugPanel(): HTMLElement {
    const box = document.createElement('div');
    box.className = 'dd-debug';
    const b = document.createElement('button');
    b.textContent = 'debug';
    b.addEventListener('click', () => {
      const scenario = prompt('调试场景：bomb / rocket / plane / four2 / endgame / seed:12345', 'bomb');
      if (!scenario) return;
      applyDebugScenario(scenario.trim());
    });
    box.appendChild(b);
    return box;
  }

  function applyDebugScenario(name: string) {
    if (name.startsWith('seed:')) {
      const seed = Number(name.slice(5));
      if (Number.isFinite(seed)) startGame({ seed });
      return;
    }
    const preset = DEBUG_SCENARIOS[name];
    if (!preset) {
      message = `没有这个调试场景：${name}`;
      messageWarn = true;
      render();
      return;
    }
    startGame(preset());
  }

  // ---------------------------------------------------------------- 启动

  showHome();

  return () => {
    disposed = true;
    clearTimers();
    root.remove();
  };
}

/**
 * 预置调试牌局：直接摆出王炸、炸弹、飞机、四带二、残局。
 * 只有开发环境的 debug 按钮会用到，生产里进不来。
 */
const DEBUG_SCENARIOS: Record<string, () => Parameters<typeof createGame>[0]> = {
  bomb: () => ({ seed: 1001, debug: { landlord: 0 } }),
  rocket: () => ({ seed: 2002, debug: { landlord: 0 } }),
  plane: () => ({ seed: 3003, debug: { landlord: 0 } }),
  four2: () => ({ seed: 4004, debug: { landlord: 0 } }),
  endgame: () => ({ seed: 5005, debug: { landlord: 0 } }),
};

export { nextSeat };
