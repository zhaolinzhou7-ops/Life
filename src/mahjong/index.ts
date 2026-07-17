/** 四川麻将（血战到底）启动入口：对局流程、玩家交互与结算 */
import {
  canWin,
  freshWall,
  hasSuit,
  scoreFan,
  suitOf,
  tileName,
  SUITS,
  type Counts,
  type Meld,
  type TileId,
} from './rules';
import { chooseDiscard, chooseLack, wantGang, wantPeng } from './ai';
import { MahjongScene } from './scene3d';

interface Player {
  hand: Counts;
  melds: Meld[];
  lack: number;
  won: boolean;
  winNames: string[];
  fan: number;
  score: number;
}

const NAMES = ['你', '右家', '对家', '左家'];

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

  // ---------- 状态 ----------
  let wall: TileId[] = [];
  let players: Player[] = [];
  let drawnTile: TileId | null = null; // 玩家刚摸的牌（展示分离）
  let displayTiles: TileId[] = [];
  let tapHandler: ((idx: number) => void) | null = null;

  const scene = new MahjongScene(wrap, (idx) => tapHandler?.(idx));

  // ---------- HUD ----------
  const hud = document.createElement('div');
  hud.className = 'mj-hud';
  hud.innerHTML = `
    <button class="moba-back mj-back">← 退出</button>
    <div class="mj-info"><span id="mj-wall"></span></div>
    <div class="mj-seats" id="mj-seats"></div>`;
  wrap.appendChild(hud);
  (hud.querySelector('.mj-back') as HTMLButtonElement).onclick = () => onExit(false);

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

  const banner = document.createElement('div');
  banner.className = 'mj-banner hidden';
  wrap.appendChild(banner);
  const flashBanner = async (text: string) => {
    banner.textContent = text;
    banner.classList.remove('hidden');
    await sleep(0.9);
    banner.classList.add('hidden');
  };

  function updateHud() {
    const wallEl = document.getElementById('mj-wall');
    if (wallEl) wallEl.textContent = `剩 ${wall.length} 张`;
    const seats = document.getElementById('mj-seats');
    if (seats) {
      seats.innerHTML = players
        .map((p, i) => {
          const lack = p.lack >= 0 ? `缺${SUITS[p.lack]}` : '';
          const st = p.won ? `<b class="win">胡</b>` : '';
          return `<span class="mj-seat ${p.won ? 'won' : ''}">${NAMES[i]} ${lack} ${st} <em>${p.score}</em></span>`;
        })
        .join('');
    }
  }

  function refreshPlayerHand() {
    const c = players[0].hand.slice();
    let drawn: TileId | null = drawnTile;
    if (drawn !== null) c[drawn]--;
    displayTiles = sortedTiles(c);
    if (drawn !== null) displayTiles.push(drawn);
    scene.setPlayerHand(displayTiles, drawn !== null);
  }

  /** 弹出操作按钮，等玩家选择 */
  function askPlayer(options: string[]): Promise<string> {
    return new Promise((resolve) => {
      actionBar.innerHTML = '';
      actionBar.classList.remove('hidden');
      for (const op of options) {
        const b = document.createElement('button');
        b.className = 'mj-act' + (op === '胡' ? ' hu' : op === '过' ? ' pass' : '');
        b.textContent = op;
        b.onclick = () => {
          actionBar.classList.add('hidden');
          resolve(op);
        };
        actionBar.appendChild(b);
      }
    });
  }

  /** 等玩家点两次同一张牌打出（强制先打缺门） */
  function waitPlayerDiscard(): Promise<TileId> {
    return new Promise((resolve) => {
      let sel = -1;
      tapHandler = (idx) => {
        const t = displayTiles[idx];
        const p = players[0];
        if (suitOf(t) !== p.lack && hasSuit(p.hand, p.lack)) {
          showToast(`必须先打缺门（${SUITS[p.lack]}）`);
          return;
        }
        if (sel === idx) {
          tapHandler = null;
          scene.selectTile(-1);
          resolve(t);
        } else {
          sel = idx;
          scene.selectTile(idx);
        }
      };
    });
  }

  // ---------- 结算 ----------
  let resultEl: HTMLElement | null = null;
  function showResult() {
    const s = document.createElement('div');
    s.className = 'screen moba-result';
    const anyWin = players[0].won;
    const rows = players
      .map(
        (p, i) => `
      <div class="mj-result-row ${p.won ? 'won' : ''}">
        <span>${NAMES[i]}${p.won ? ' 🏆' : ''}</span>
        <span class="names">${p.won ? p.winNames.join('·') + ` ${p.fan}番` : '未胡'}</span>
        <span class="score">${p.score > 0 ? '+' : ''}${p.score}</span>
      </div>`,
      )
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

  // ---------- 胡牌处理 ----------
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
    }
    scene.showWin(seat, sortedTiles(c));
    updateHud();
  }

  const winnersCount = () => players.filter((p) => p.won).length;
  const gameOver = () => winnersCount() >= 3 || wall.length === 0;

  // ---------- 主流程 ----------
  async function run() {
    // 发牌
    wall = freshWall();
    players = Array.from({ length: 4 }, () => ({
      hand: new Array(27).fill(0) as Counts,
      melds: [],
      lack: -1,
      won: false,
      winNames: [] as string[],
      fan: 0,
      score: 0,
    }));
    for (let i = 0; i < 13; i++)
      for (let s = 0; s < 4; s++) players[s].hand[wall.pop()!]++;

    refreshPlayerHand();
    for (let s = 1; s < 4; s++) scene.setOpponentCount(s, 13);
    updateHud();

    // 定缺
    const lackNames = SUITS.map((n, i) => {
      let cnt = 0;
      for (let r = 0; r < 9; r++) cnt += players[0].hand[i * 9 + r];
      return `缺${n}(${cnt})`;
    });
    const pick = await askPlayer(lackNames);
    if (!alive()) return;
    players[0].lack = lackNames.indexOf(pick);
    for (let s = 1; s < 4; s++) players[s].lack = chooseLack(players[s].hand);
    updateHud();
    showToast(`你定缺：${SUITS[players[0].lack]}`);

    // 行牌循环
    let turn = 0;
    while (alive() && !gameOver()) {
      const p = players[turn];
      if (p.won) {
        turn = (turn + 1) % 4;
        continue;
      }
      // 摸牌
      if (wall.length === 0) break;
      const drawn = wall.pop()!;
      p.hand[drawn]++;
      scene.drawAnim(turn);
      updateHud();
      let gangFlower = false;

      // 自摸/暗杠循环（杠了要补摸）
      let current = drawn;
      for (;;) {
        if (!alive()) return;
        const canZimo = !hasSuit(p.hand, p.lack) && canWin(p.hand, p.melds.length === 0);
        const angangTile = findAngang(p);
        if (turn === 0) {
          drawnTile = current;
          refreshPlayerHand();
          await sleep(0.25);
          if (canZimo || angangTile >= 0) {
            const ops: string[] = [];
            if (canZimo) ops.push('胡');
            if (angangTile >= 0) ops.push('杠');
            ops.push('过');
            const act = await askPlayer(ops);
            if (!alive()) return;
            if (act === '胡') {
              await flashBanner('自摸！');
              settleWin(0, current, { zimo: true, gangFlower, payer: -1 });
              drawnTile = null;
              refreshPlayerHand();
              break;
            }
            if (act === '杠') {
              doAngang(turn, angangTile);
              await flashBanner('暗杠');
              if (wall.length === 0) break;
              current = wall.pop()!;
              p.hand[current]++;
              gangFlower = true;
              updateHud();
              continue;
            }
          }
        } else {
          await sleep(0.45);
          if (canZimo) {
            await flashBanner(`${NAMES[turn]} 自摸！`);
            settleWin(turn, current, { zimo: true, gangFlower, payer: -1 });
            break;
          }
          if (angangTile >= 0 && suitOf(angangTile) !== p.lack) {
            doAngang(turn, angangTile);
            await flashBanner(`${NAMES[turn]} 暗杠`);
            if (wall.length === 0) break;
            current = wall.pop()!;
            p.hand[current]++;
            gangFlower = true;
            updateHud();
            continue;
          }
        }
        break;
      }
      if (!alive()) return;
      if (p.won || gameOver()) {
        if (p.won) {
          turn = (turn + 1) % 4;
          continue;
        }
        break;
      }

      // 出牌
      let out: TileId;
      if (turn === 0) {
        out = await waitPlayerDiscard();
        if (!alive()) return;
        players[0].hand[out]--;
        drawnTile = null;
        refreshPlayerHand();
      } else {
        out = chooseDiscard(p.hand, p.lack);
        p.hand[out]--;
        scene.setOpponentCount(turn, p.hand.reduce((a, b) => a + b, 0));
      }
      scene.discard(turn, out);
      await sleep(0.42);
      if (!alive()) return;

      // 各家响应：先胡（可多响），再碰/杠。
      // 返回值 = 链条中最后一个完成出牌的座位（碰/杠接管），-1 表示无人响应
      const lastDiscarder = await handleReactions(turn, out);
      if (!alive()) return;
      turn = ((lastDiscarder >= 0 ? lastDiscarder : turn) + 1) % 4;
      updateHud();
    }

    if (!alive()) return;
    await sleep(0.6);
    showResult();
  }

  function findAngang(p: Player): TileId {
    for (let t = 0; t < 27; t++) if (p.hand[t] === 4 && suitOf(t) !== p.lack) return t;
    return -1;
  }

  function doAngang(seat: number, t: TileId) {
    const p = players[seat];
    p.hand[t] -= 4;
    p.melds.push({ kind: 'angang', tile: t });
    scene.setMelds(seat, p.melds);
    if (seat === 0) {
      drawnTile = null;
      refreshPlayerHand();
    } else {
      scene.setOpponentCount(seat, p.hand.reduce((a, b) => a + b, 0));
    }
  }

  /** 处理打出一张牌后的响应；返回接管出牌权的座位（碰/杠），-1 表示无 */
  async function handleReactions(from: number, tile: TileId): Promise<number> {
    // 1. 胡（血战可一炮多响）
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
        drawnTile = null;
        refreshPlayerHand();
        const act = await askPlayer(['胡', '过']);
        if (!alive()) return -1;
        if (act !== '胡') continue;
      }
      await flashBanner(seat === 0 ? '胡！' : `${NAMES[seat]} 胡！`);
      settleWin(seat, tile, { zimo: false, gangFlower: false, payer: from });
      anyHu = true;
    }
    if (anyHu) {
      scene.takeLastDiscard(from);
      return -1;
    }

    // 2. 碰 / 明杠（只可能一家）
    for (let d = 1; d < 4; d++) {
      const seat = (from + d) % 4;
      const p = players[seat];
      if (p.won) continue;
      if (suitOf(tile) === p.lack) continue;
      const canGang = p.hand[tile] === 3 && wall.length > 0;
      const canPeng = p.hand[tile] >= 2;
      if (!canPeng && !canGang) continue;

      let act = '过';
      if (seat === 0) {
        const ops: string[] = [];
        if (canGang) ops.push('杠');
        if (canPeng) ops.push('碰');
        ops.push('过');
        act = await askPlayer(ops);
        if (!alive()) return -1;
      } else {
        if (canGang && wantGang(tile, p.lack)) act = '杠';
        else if (canPeng && wantPeng(p.hand, tile, p.lack, p.melds.filter((m) => m.kind === 'peng').length)) act = '碰';
      }
      if (act === '过') continue;

      scene.takeLastDiscard(from);
      if (act === '杠') {
        p.hand[tile] -= 3;
        p.melds.push({ kind: 'gang', tile });
        scene.setMelds(seat, p.melds);
        await flashBanner(seat === 0 ? '杠！' : `${NAMES[seat]} 杠`);
        // 杠后补摸
        if (wall.length > 0) {
          const t2 = wall.pop()!;
          p.hand[t2]++;
          if (seat === 0) {
            drawnTile = t2;
          }
        }
      } else {
        p.hand[tile] -= 2;
        p.melds.push({ kind: 'peng', tile });
        scene.setMelds(seat, p.melds);
        await flashBanner(seat === 0 ? '碰！' : `${NAMES[seat]} 碰`);
      }
      if (seat === 0) refreshPlayerHand();
      else scene.setOpponentCount(seat, p.hand.reduce((a, b) => a + b, 0));
      updateHud();

      // 碰/杠后该家出牌
      let out: TileId;
      if (seat === 0) {
        out = await waitPlayerDiscard();
        if (!alive()) return -1;
        players[0].hand[out]--;
        drawnTile = null;
        refreshPlayerHand();
      } else {
        await sleep(0.4);
        out = chooseDiscard(p.hand, p.lack);
        p.hand[out]--;
        scene.setOpponentCount(seat, p.hand.reduce((a, b) => a + b, 0));
      }
      scene.discard(seat, out);
      await sleep(0.42);
      if (!alive()) return -1;
      const next = await handleReactions(seat, out);
      return next >= 0 ? next : seat; // 出牌权已经在这里轮转过
    }
    return -1;
  }

  run();

  return () => {
    disposed = true;
    clearTimeout(toastTimer);
    resultEl?.remove();
    scene.dispose();
    wrap.remove();
  };
}

// 供调试
export { tileName };
