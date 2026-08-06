/** 四川麻将（血战到底）：2.5D 专业界面 + 换三张 / 定缺 / 碰杠 / 呼叫转移 / 查大叔查花猪 / 托管 */
import {
  bestTingFan,
  canWin,
  freshWall,
  hasSuit,
  pickSwapThree,
  scoreFan,
  settleDraw,
  suitOf,
  tileName,
  waitingTiles,
  SUITS,
  type Counts,
  type Meld,
  type TileId,
} from './rules';
import { chooseDiscard, chooseLack, wantGang, wantPeng } from './ai';
import { MahjongView, type SeatView } from './view2d';
import {
  isMuted,
  setMuted,
  sfxDraw,
  sfxGangHeavy,
  sfxKnock,
  sfxLose,
  sfxPeng,
  sfxTap,
  sfxWinBig,
  speak,
  startBgm,
  stopBgm,
  unlockAudio,
} from '../gamesfx';
import { CHARACTERS, QUICK_CHAT, pickLine } from '../characters';

const SEAT_CHARS = [null, CHARACTERS[0], CHARACTERS[1], CHARACTERS[2]] as const;
const NAMES = ['你', CHARACTERS[0].name, CHARACTERS[1].name, CHARACTERS[2].name];

interface Player {
  hand: Counts;
  melds: Meld[];
  discards: TileId[];
  lack: number;
  won: boolean;
  winNames: string[];
  fan: number;
  score: number;
  /** 本局杠得的分（用于呼叫转移：被人胡后要退还） */
  gangGains: { from: number; amount: number }[];
  justDiscarded: boolean;
}

const sortedTiles = (c: Counts): TileId[] => {
  const out: TileId[] = [];
  for (let t = 0; t < 27; t++) for (let i = 0; i < c[t]; i++) out.push(t);
  return out;
};

export function bootMahjong(app: HTMLElement, onExit: (restart: boolean) => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'mj-root';
  app.appendChild(wrap);

  let disposed = false;
  const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));
  const alive = () => !disposed;

  let wall: TileId[] = [];
  let players: Player[] = [];
  let drawnTile: TileId | null = null;
  let displayTiles: TileId[] = [];
  let tapHandler: ((idx: number) => void) | null = null;
  let auto = false; // 托管
  /** 开启托管时立刻替玩家做完当前这一步（否则会一直卡在等待点击上） */
  let takeOver: (() => void) | null = null;

  const view = new MahjongView(wrap, (idx) => tapHandler?.(idx));

  // ---------- HUD（顶栏 + 按钮） ----------
  const hud = document.createElement('div');
  hud.className = 'mj-hud';
  hud.innerHTML = `
    <button class="moba-back mj-back">← 退出</button>
    <button class="xq-btn" id="mj-mute">${isMuted() ? '🔇' : '🔊'}</button>
    <button class="xq-btn" id="mj-auto">托管</button>
    <div class="mj-info"><span id="mj-round">血战到底</span></div>`;
  wrap.appendChild(hud);
  (hud.querySelector('.mj-back') as HTMLButtonElement).onclick = () => onExit(false);
  const muteBtn = hud.querySelector('#mj-mute') as HTMLButtonElement;
  muteBtn.onclick = () => {
    setMuted(!isMuted());
    muteBtn.textContent = isMuted() ? '🔇' : '🔊';
  };
  const autoBtn = hud.querySelector('#mj-auto') as HTMLButtonElement;
  autoBtn.onclick = () => {
    auto = !auto;
    autoBtn.classList.toggle('on', auto);
    autoBtn.textContent = auto ? '托管中' : '托管';
    showToast(auto ? '已开启托管，自动打牌' : '已取消托管');
    if (auto) takeOver?.();
  };

  const actionBar = document.createElement('div');
  actionBar.className = 'mj-actions hidden';
  wrap.appendChild(actionBar);

  const toast = document.createElement('div');
  toast.className = 'moba-toast mj-toast';
  wrap.appendChild(toast);
  let toastTimer = 0;
  const showToast = (msg: string) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1600);
  };

  // 快捷聊天
  const chatBtn = document.createElement('button');
  chatBtn.className = 'mj-chat-btn';
  chatBtn.textContent = '💬';
  wrap.appendChild(chatBtn);
  const chatPanel = document.createElement('div');
  chatPanel.className = 'mj-chat hidden';
  QUICK_CHAT.forEach((line) => {
    const b = document.createElement('button');
    b.className = 'mj-chat-item';
    b.textContent = line;
    b.onclick = () => {
      chatPanel.classList.add('hidden');
      speak(line, { pitch: 1.0, rate: 1.1 });
      view.state.centerHint = line;
      setTimeout(() => {
        if (alive() && view.state.centerHint === line) view.state.centerHint = '';
      }, 2000);
      const seat = 1 + Math.floor(Math.random() * 3);
      setTimeout(() => {
        if (alive()) charSay(seat, pickLine(SEAT_CHARS[seat]!.lines.taunt));
      }, 1300);
    };
    chatPanel.appendChild(b);
  });
  wrap.appendChild(chatPanel);
  chatBtn.onclick = () => chatPanel.classList.toggle('hidden');

  const unlock = () => {
    unlockAudio();
    startBgm('majiang');
  };
  window.addEventListener('pointerdown', unlock, { once: true });

  /** 角色说话：中央提示 + 语音 + 座位特效字 */
  function charSay(seat: number, text: string) {
    const ch = SEAT_CHARS[seat];
    if (ch) speak(text, ch.voice);
    view.burst(seat, '', ch?.color ?? '#ffd76e');
    view.state.centerHint = `${NAMES[seat]}：${text}`;
    setTimeout(() => {
      if (alive() && view.state.centerHint.startsWith(NAMES[seat])) view.state.centerHint = '';
    }, 2200);
  }

  /** 同步渲染状态 */
  function sync() {
    const seats: SeatView[] = players.map((p, i) => {
      const total = p.hand.reduce((a, b) => a + b, 0);
      const ting =
        !p.won && total % 3 === 1 && waitingTiles(p.hand, p.melds.length === 0, p.lack).length > 0;
      return {
        name: NAMES[i],
        char: SEAT_CHARS[i],
        hand: i === 0 ? displayTiles : [],
        handCount: i === 0 ? displayTiles.length : total,
        melds: p.melds,
        discards: p.discards,
        lack: p.lack,
        score: p.score,
        won: p.won,
        ting,
        justDiscarded: p.justDiscarded,
      };
    });
    view.state.seats = seats;
    view.state.wallLeft = wall.length;
    view.state.drawnSeparate = drawnTile !== null;
  }

  function refreshPlayerHand() {
    const c = players[0].hand.slice();
    if (drawnTile !== null) c[drawnTile]--;
    displayTiles = sortedTiles(c);
    if (drawnTile !== null) displayTiles.push(drawnTile);
    sync();
  }

  /** 更新听牌提示 */
  function updateTing() {
    const p = players[0];
    const total = p.hand.reduce((a, b) => a + b, 0);
    if (p.won || total % 3 !== 1) {
      view.state.tingTiles = [];
      return;
    }
    view.state.tingTiles = waitingTiles(p.hand, p.melds.length === 0, p.lack);
  }

  function askPlayer(options: string[], autoPick?: () => string): Promise<string> {
    return new Promise((resolve) => {
      const finish = (op: string) => {
        takeOver = null;
        actionBar.classList.add('hidden');
        resolve(op);
      };
      actionBar.innerHTML = '';
      actionBar.classList.remove('hidden');
      for (const op of options) {
        const b = document.createElement('button');
        b.className = 'mj-act' + (op === '胡' ? ' hu' : op === '过' ? ' pass' : '');
        b.textContent = op;
        b.onclick = () => {
          sfxTap();
          finish(op);
        };
        actionBar.appendChild(b);
      }
      // 托管：能胡就胡，否则过（碰/杠交给玩家自己回来再决定）
      takeOver = () => finish(autoPick ? autoPick() : options.includes('胡') ? '胡' : options[options.length - 1]);
      if (auto) setTimeout(() => takeOver?.(), 380);
    });
  }

  /** 玩家出牌：点一次选中，再点打出（托管时自动） */
  function waitPlayerDiscard(): Promise<TileId> {
    return new Promise((resolve) => {
      const finish = (t: TileId) => {
        takeOver = null;
        tapHandler = null;
        view.state.selected = -1;
        resolve(t);
      };
      takeOver = () => {
        const p = players[0];
        finish(chooseDiscard(p.hand, p.lack, p.melds.length === 0));
      };
      if (auto) {
        setTimeout(() => takeOver?.(), 420);
        return;
      }
      let sel = -1;
      view.state.selected = -1;
      tapHandler = (idx) => {
        const t = displayTiles[idx];
        const p = players[0];
        if (suitOf(t) !== p.lack && hasSuit(p.hand, p.lack)) {
          showToast(`必须先打缺门（${SUITS[p.lack]}）`);
          return;
        }
        if (sel === idx) {
          finish(t);
        } else {
          sel = idx;
          view.state.selected = idx;
          sfxTap();
          // 打出这张后听什么
          p.hand[t]--;
          const waits = waitingTiles(p.hand, p.melds.length === 0, p.lack);
          p.hand[t]++;
          if (waits.length) showToast(`打出后听：${waits.map(tileName).join(' ')}`);
        }
      };
    });
  }

  /** 换三张：玩家选 3 张同花色 */
  function waitPlayerSwap(): Promise<TileId[]> {
    return new Promise((resolve) => {
      const finish = (ts: TileId[]) => {
        takeOver = null;
        tapHandler = null;
        actionBar.classList.add('hidden');
        view.state.picked = [];
        view.state.centerHint = '';
        resolve(ts);
      };
      takeOver = () => finish(pickSwapThree(players[0].hand));
      if (auto) {
        setTimeout(() => takeOver?.(), 500);
        return;
      }
      const picked: number[] = [];
      view.state.picked = [];
      view.state.centerHint = '换三张：选 3 张同花色的牌';
      const okBtn = document.createElement('button');
      okBtn.className = 'mj-act hu';
      okBtn.textContent = '确定换牌';
      okBtn.style.display = 'none';
      actionBar.innerHTML = '';
      actionBar.appendChild(okBtn);
      actionBar.classList.remove('hidden');

      const refresh = () => {
        view.state.picked = picked.slice();
        okBtn.style.display = picked.length === 3 ? '' : 'none';
      };
      tapHandler = (idx) => {
        const t = displayTiles[idx];
        const at = picked.indexOf(idx);
        if (at >= 0) {
          picked.splice(at, 1);
          sfxTap();
          refresh();
          return;
        }
        if (picked.length >= 3) {
          showToast('最多选 3 张');
          return;
        }
        if (picked.length > 0 && suitOf(displayTiles[picked[0]]) !== suitOf(t)) {
          showToast('必须是同一种花色');
          return;
        }
        picked.push(idx);
        sfxTap();
        refresh();
      };
      okBtn.onclick = () => finish(picked.map((i) => displayTiles[i]));
    });
  }

  // ---------- 结算 ----------
  let resultEl: HTMLElement | null = null;
  function showResult(extraRows: { seat: number; delta: number; reasons: string[] }[]) {
    if (!players[0].won) sfxLose();
    const s = document.createElement('div');
    s.className = 'screen moba-result';
    const anyWin = players[0].won;
    const rows = players
      .map((p, i) => {
        const extra = extraRows.find((r) => r.seat === i);
        const tags = [
          ...(p.won ? p.winNames : []),
          ...(extra?.reasons ?? []),
        ].join('·');
        return `
      <div class="mj-result-row ${p.won ? 'won' : ''}">
        <span>${NAMES[i]}${p.won ? ' 🏆' : ''}</span>
        <span class="names">${tags || '—'}${p.won ? ` ${p.fan}番` : ''}</span>
        <span class="score">${p.score > 0 ? '+' : ''}${p.score}</span>
      </div>`;
      })
      .join('');
    s.innerHTML = `
      <h1 style="color:${anyWin ? '#66bb6a' : '#ef5350'}">${anyWin ? '胡了！' : '本局结束'}</h1>
      <div class="mj-result">${rows}</div>`;
    const again = document.createElement('button');
    again.className = 'btn';
    again.textContent = '再来一局';
    again.onclick = () => onExit(true);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '返回首页';
    back.onclick = () => onExit(false);
    s.appendChild(again);
    s.appendChild(back);
    wrap.appendChild(s);
    resultEl = s;
  }

  /** 胡牌结算（含呼叫转移：杠分退还给点炮者） */
  function settleWin(seat: number, tile: TileId, opts: { zimo: boolean; gangFlower: boolean; payer: number }) {
    const p = players[seat];
    const c = p.hand.slice();
    if (!opts.zimo) c[tile]++;
    const { fan, names } = scoreFan(c, p.melds, {
      zimo: opts.zimo,
      gangFlower: opts.gangFlower,
      gangPao: false,
      qiangGang: false,
    });
    p.won = true;
    p.fan = fan;
    p.winNames = names;
    if (opts.zimo) {
      for (let i = 0; i < 4; i++) {
        if (i !== seat && !players[i].won) {
          players[i].score -= fan;
          p.score += fan;
        }
      }
    } else {
      players[opts.payer].score -= fan;
      p.score += fan;
      // 呼叫转移：胡牌者此前收的杠分，由点炮者承担
      for (const gg of p.gangGains) {
        if (gg.from === opts.payer) continue;
        players[gg.from].score += gg.amount; // 退还
        players[opts.payer].score -= gg.amount; // 由点炮者赔
      }
      if (p.gangGains.length) showToast('呼叫转移：杠分由点炮者承担');
    }
    // 胡牌后亮出手牌
    p.hand = c;
    sync();
  }

  const winnersCount = () => players.filter((p) => p.won).length;
  const gameOver = () => winnersCount() >= 3 || wall.length === 0;

  // ---------- 主流程 ----------
  async function run() {
    wall = freshWall();
    players = Array.from({ length: 4 }, () => ({
      hand: new Array(27).fill(0) as Counts,
      melds: [] as Meld[],
      discards: [] as TileId[],
      lack: -1,
      won: false,
      winNames: [] as string[],
      fan: 0,
      score: 0,
      gangGains: [] as { from: number; amount: number }[],
      justDiscarded: false,
    }));
    for (let i = 0; i < 13; i++) for (let s = 0; s < 4; s++) players[s].hand[wall.pop()!]++;
    refreshPlayerHand();
    view.state.centerHint = '发牌完毕';
    await sleep(0.6);
    if (!alive()) return;

    // ===== 换三张 =====
    view.state.centerHint = '换三张';
    const mine = await waitPlayerSwap();
    if (!alive()) return;
    const swaps: TileId[][] = [mine];
    for (let s = 1; s < 4; s++) swaps.push(pickSwapThree(players[s].hand));
    // 随机方向：0 对家 1 下家 2 上家
    const dir = Math.floor(Math.random() * 3);
    const dirName = ['对家', '下家(顺时针)', '上家(逆时针)'][dir];
    const shift = dir === 0 ? 2 : dir === 1 ? 1 : 3;
    for (let s = 0; s < 4; s++) for (const t of swaps[s]) players[s].hand[t]--;
    for (let s = 0; s < 4; s++) {
      const to = (s + shift) % 4;
      for (const t of swaps[s]) players[to].hand[t]++;
    }
    sfxKnock();
    showToast(`换三张 · ${dirName}`);
    view.state.centerHint = `换三张 · ${dirName}`;
    refreshPlayerHand();
    await sleep(1.2);
    if (!alive()) return;
    view.state.centerHint = '';

    // ===== 定缺 =====
    const lackOpts = SUITS.map((n, i) => {
      let cnt = 0;
      for (let r = 0; r < 9; r++) cnt += players[0].hand[i * 9 + r];
      return `缺${n}(${cnt})`;
    });
    view.state.centerHint = '请定缺';
    const pick = await askPlayer(lackOpts, () => lackOpts[chooseLack(players[0].hand)]);
    if (!alive()) return;
    players[0].lack = lackOpts.indexOf(pick);
    for (let s = 1; s < 4; s++) players[s].lack = chooseLack(players[s].hand);
    view.state.centerHint = '';
    showToast(`你定缺：${SUITS[players[0].lack]}`);
    sync();
    for (let i = 1; i <= 3; i++)
      setTimeout(() => {
        if (alive()) charSay(i, pickLine(SEAT_CHARS[i]!.lines.greet));
      }, i * 1200);

    // ===== 行牌 =====
    let turn = 0;
    while (alive() && !gameOver()) {
      const p = players[turn];
      if (p.won) {
        turn = (turn + 1) % 4;
        continue;
      }
      if (wall.length === 0) break;
      const drawn = wall.pop()!;
      p.hand[drawn]++;
      view.state.activeSeat = turn;
      for (const q of players) q.justDiscarded = false;
      if (turn === 0) sfxDraw();
      sync();

      let current = drawn;
      let gangFlower = false;
      for (;;) {
        if (!alive()) return;
        const canZimo = !hasSuit(p.hand, p.lack) && canWin(p.hand, p.melds.length === 0);
        const angangTile = findAngang(p);
        if (turn === 0) {
          drawnTile = current;
          refreshPlayerHand();
          updateTing();
          await sleep(0.25);
          if ((canZimo || angangTile >= 0) && !auto) {
            const ops: string[] = [];
            if (canZimo) ops.push('胡');
            if (angangTile >= 0) ops.push('杠');
            ops.push('过');
            const act = await askPlayer(ops);
            if (!alive()) return;
            if (act === '胡') {
              sfxWinBig();
              speak('自摸');
              view.burst(0, '自摸', '#ffd76e');
              settleWin(0, current, { zimo: true, gangFlower, payer: -1 });
              drawnTile = null;
              refreshPlayerHand();
              await sleep(1.1);
              break;
            }
            if (act === '杠') {
              doAngang(0, angangTile);
              sfxGangHeavy();
              speak('杠');
              view.burst(0, '杠', '#ff9c40');
              if (wall.length === 0) break;
              current = wall.pop()!;
              p.hand[current]++;
              gangFlower = true;
              continue;
            }
          } else if (auto && canZimo) {
            sfxWinBig();
            view.burst(0, '自摸', '#ffd76e');
            settleWin(0, current, { zimo: true, gangFlower, payer: -1 });
            drawnTile = null;
            refreshPlayerHand();
            await sleep(1.1);
            break;
          }
        } else {
          await sleep(0.5);
          if (canZimo) {
            sfxWinBig();
            view.burst(turn, '自摸', '#ffd76e');
            charSay(turn, pickLine(SEAT_CHARS[turn]!.lines.win));
            settleWin(turn, current, { zimo: true, gangFlower, payer: -1 });
            await sleep(1.1);
            break;
          }
          if (angangTile >= 0 && suitOf(angangTile) !== p.lack) {
            doAngang(turn, angangTile);
            sfxGangHeavy();
            view.burst(turn, '杠', '#ff9c40');
            charSay(turn, pickLine(SEAT_CHARS[turn]!.lines.gang));
            if (wall.length === 0) break;
            current = wall.pop()!;
            p.hand[current]++;
            gangFlower = true;
            continue;
          }
        }
        break;
      }
      if (!alive()) return;
      if (p.won) {
        turn = (turn + 1) % 4;
        continue;
      }
      if (gameOver()) break;

      // 出牌
      let out: TileId;
      if (turn === 0) {
        out = await waitPlayerDiscard();
        if (!alive()) return;
        players[0].hand[out]--;
        drawnTile = null;
        refreshPlayerHand();
        updateTing();
      } else {
        out = chooseDiscard(p.hand, p.lack, p.melds.length === 0);
        p.hand[out]--;
        if (Math.random() < 0.18) charSay(turn, pickLine(SEAT_CHARS[turn]!.lines.discard));
      }
      p.discards.push(out);
      p.justDiscarded = true;
      sfxKnock();
      sync();
      await sleep(0.42);
      if (!alive()) return;

      const last = await handleReactions(turn, out);
      if (!alive()) return;
      turn = ((last >= 0 ? last : turn) + 1) % 4;
      sync();
    }

    if (!alive()) return;
    // ===== 流局结算：查大叔 / 查花猪 =====
    view.state.activeSeat = -1;
    let extraRows: { seat: number; delta: number; reasons: string[] }[] = [];
    if (winnersCount() < 3) {
      const tingFan = players.map((p) =>
        p.won
          ? 0
          : bestTingFan(p.hand.slice(), p.melds, p.lack, (h, m) =>
              scoreFan(h, m, { zimo: false, gangFlower: false, gangPao: false, qiangGang: false }).fan,
            ),
      );
      extraRows = settleDraw(
        players.map((p) => p.hand),
        players.map((p) => p.lack),
        players.map((p) => p.won),
        tingFan,
      );
      for (const r of extraRows) players[r.seat].score += r.delta;
      const zhu = extraRows.filter((r) => r.reasons.includes('花猪'));
      if (zhu.length) showToast(`查花猪：${zhu.map((r) => NAMES[r.seat]).join('、')}`);
      else if (extraRows.some((r) => r.reasons.includes('未听牌'))) showToast('查大叔：未听牌赔听牌家');
      sync();
      await sleep(1.2);
    }
    if (!alive()) return;
    showResult(extraRows);
  }

  function findAngang(p: Player): TileId {
    for (let t = 0; t < 27; t++) if (p.hand[t] === 4 && suitOf(t) !== p.lack) return t;
    return -1;
  }

  function doAngang(seat: number, t: TileId) {
    const p = players[seat];
    p.hand[t] -= 4;
    p.melds.push({ kind: 'angang', tile: t });
    // 暗杠：每家赔 2
    for (let i = 0; i < 4; i++) {
      if (i === seat || players[i].won) continue;
      players[i].score -= 2;
      p.score += 2;
      p.gangGains.push({ from: i, amount: 2 });
    }
    if (seat === 0) {
      drawnTile = null;
      refreshPlayerHand();
    }
    sync();
  }

  /** 他家打出后的响应：胡（可多响）→ 碰/杠 */
  async function handleReactions(from: number, tile: TileId): Promise<number> {
    let anyHu = false;
    for (let d = 1; d < 4; d++) {
      const seat = (from + d) % 4;
      const p = players[seat];
      if (p.won) continue;
      if (hasSuit(p.hand, p.lack) || suitOf(tile) === p.lack) continue;
      const c = p.hand.slice();
      c[tile]++;
      if (!canWin(c, p.melds.length === 0)) continue;
      if (seat === 0) {
        if (!auto) {
          const act = await askPlayer(['胡', '过']);
          if (!alive()) return -1;
          if (act !== '胡') continue;
        }
      }
      sfxWinBig();
      view.burst(seat, '胡', '#ffd76e');
      if (seat === 0) speak('胡');
      else charSay(seat, pickLine(SEAT_CHARS[seat]!.lines.win));
      settleWin(seat, tile, { zimo: false, gangFlower: false, payer: from });
      anyHu = true;
      await sleep(0.9);
    }
    if (anyHu) {
      players[from].discards.pop();
      sync();
      return -1;
    }

    for (let d = 1; d < 4; d++) {
      const seat = (from + d) % 4;
      const p = players[seat];
      if (p.won || suitOf(tile) === p.lack) continue;
      const canGang = p.hand[tile] === 3 && wall.length > 0;
      const canPeng = p.hand[tile] >= 2;
      if (!canPeng && !canGang) continue;

      let act = '过';
      if (seat === 0) {
        if (auto) {
          act = '过';
        } else {
          const ops: string[] = [];
          if (canGang) ops.push('杠');
          if (canPeng) ops.push('碰');
          ops.push('过');
          act = await askPlayer(ops);
          if (!alive()) return -1;
        }
      } else {
        if (canGang && wantGang(tile, p.lack)) act = '杠';
        else if (canPeng && wantPeng(p.hand, tile, p.lack, p.melds.filter((m) => m.kind === 'peng').length))
          act = '碰';
      }
      if (act === '过') continue;

      players[from].discards.pop();
      if (act === '杠') {
        p.hand[tile] -= 3;
        p.melds.push({ kind: 'gang', tile });
        // 明杠：点杠者赔 2
        players[from].score -= 2;
        p.score += 2;
        p.gangGains.push({ from, amount: 2 });
        sfxGangHeavy();
        view.burst(seat, '杠', '#ff9c40');
        if (seat === 0) speak('杠');
        else charSay(seat, pickLine(SEAT_CHARS[seat]!.lines.gang));
        if (wall.length > 0) {
          const t2 = wall.pop()!;
          p.hand[t2]++;
          if (seat === 0) drawnTile = t2;
        }
      } else {
        p.hand[tile] -= 2;
        p.melds.push({ kind: 'peng', tile });
        sfxPeng();
        view.burst(seat, '碰', '#9ec6ff');
        if (seat === 0) speak('碰');
        else charSay(seat, pickLine(SEAT_CHARS[seat]!.lines.peng));
      }
      view.state.activeSeat = seat;
      if (seat === 0) refreshPlayerHand();
      sync();
      await sleep(0.7);
      if (!alive()) return -1;

      // 碰/杠后由该家出牌
      let out: TileId;
      if (seat === 0) {
        updateTing();
        out = await waitPlayerDiscard();
        if (!alive()) return -1;
        players[0].hand[out]--;
        drawnTile = null;
        refreshPlayerHand();
        updateTing();
      } else {
        await sleep(0.4);
        out = chooseDiscard(p.hand, p.lack, p.melds.length === 0);
        p.hand[out]--;
      }
      for (const q of players) q.justDiscarded = false;
      p.discards.push(out);
      p.justDiscarded = true;
      sfxKnock();
      sync();
      await sleep(0.42);
      if (!alive()) return -1;
      const next = await handleReactions(seat, out);
      return next >= 0 ? next : seat;
    }
    return -1;
  }

  run();

  return () => {
    disposed = true;
    clearTimeout(toastTimer);
    window.removeEventListener('pointerdown', unlock);
    stopBgm();
    resultEl?.remove();
    view.dispose();
    wrap.remove();
  };
}
