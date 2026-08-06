/** 象棋启动入口：开局设置（难度/棋子材质/对手）→ 玩家执红 vs AI 执黑 */
import {
  applyMove,
  findKing,
  initialBoard,
  isInCheck,
  legalMoves,
  statusAfter,
  type Board,
  type Move,
} from './rules';
import { bestMove } from './ai';
import { XiangqiScene, type PieceTheme } from './scene3d';
import {
  isMuted,
  setMuted,
  sfxAlert,
  sfxKnock,
  sfxLose,
  sfxSlash,
  sfxTap,
  sfxWinBig,
  speak,
  startBgm,
  stopBgm,
  unlockAudio,
} from '../gamesfx';
import { CHARACTERS, avatarCanvas, pickLine, type Character } from '../characters';

const LEVELS = [
  { id: 0, name: '初级', desc: '让你三分，适合新手', depth: 2, jitter: 60, timeMs: 180 },
  { id: 1, name: '中级', desc: '正常对弈，有来有回', depth: 6, jitter: 8, timeMs: 600 },
  { id: 2, name: '高级', desc: '深算杀招，专业水准', depth: 12, jitter: 0, timeMs: 1500 },
  { id: 3, name: '大师', desc: '全力计算，不留情面', depth: 16, jitter: 0, timeMs: 3000 },
];

const THEMES: { id: PieceTheme; name: string; emoji: string; desc: string }[] = [
  { id: 'jade', name: '和田玉', emoji: '💚', desc: '温润通透，金线刻字' },
  { id: 'wood', name: '紫檀木', emoji: '🟤', desc: '古朴厚重，传统手感' },
  { id: 'porcelain', name: '青花瓷', emoji: '🔷', desc: '洁白釉面，靛蓝刻痕' },
];

export function bootXiangqi(app: HTMLElement, onExit: (restart: boolean) => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-root';
  app.appendChild(wrap);

  let cleanupGame: (() => void) | null = null;
  let setupEl: HTMLElement | null = null;

  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });

  // ============ 开局设置界面 ============
  function showSetup() {
    cleanupGame?.();
    cleanupGame = null;
    setupEl?.remove();

    let level = Number(localStorage.getItem('xq-level') ?? 1);
    let theme = (localStorage.getItem('xq-theme') ?? 'jade') as PieceTheme;
    let rival = Number(localStorage.getItem('xq-rival') ?? 2);
    let facing = (localStorage.getItem('xq-facing') ?? 'duel') as 'duel' | 'me';

    const s = document.createElement('div');
    s.className = 'screen xq-setup';
    setupEl = s;

    const render = () => {
      s.innerHTML = `<h1>楚河汉界</h1><div class="sub">选对手 · 定难度 · 挑棋子</div>`;

      // 对手
      const rivalLabel = document.createElement('div');
      rivalLabel.className = 'xq-sec';
      rivalLabel.textContent = '选择对手';
      s.appendChild(rivalLabel);
      const rivalRow = document.createElement('div');
      rivalRow.className = 'xq-rivals';
      CHARACTERS.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'xq-rival' + (i === rival ? ' on' : '');
        card.style.setProperty('--c', c.color);
        card.appendChild(avatarCanvas(c, 76, i === rival ? 'happy' : 'idle'));
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = c.name;
        const st = document.createElement('div');
        st.className = 'st';
        st.textContent = c.style;
        card.appendChild(nm);
        card.appendChild(st);
        card.onclick = () => {
          rival = i;
          sfxTap();
          render();
        };
        rivalRow.appendChild(card);
      });
      s.appendChild(rivalRow);

      // 难度
      const lvLabel = document.createElement('div');
      lvLabel.className = 'xq-sec';
      lvLabel.textContent = '难度';
      s.appendChild(lvLabel);
      const lvRow = document.createElement('div');
      lvRow.className = 'diff-row';
      LEVELS.forEach((L) => {
        const card = document.createElement('div');
        card.className = 'card' + (L.id === level ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${L.name}</div>
          <div class="desc" style="text-align:center">${L.desc}</div>`;
        card.onclick = () => {
          level = L.id;
          sfxTap();
          render();
        };
        lvRow.appendChild(card);
      });
      s.appendChild(lvRow);

      // 棋子材质
      const thLabel = document.createElement('div');
      thLabel.className = 'xq-sec';
      thLabel.textContent = '棋子材质';
      s.appendChild(thLabel);
      const thRow = document.createElement('div');
      thRow.className = 'diff-row';
      THEMES.forEach((T) => {
        const card = document.createElement('div');
        card.className = 'card' + (T.id === theme ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${T.emoji} ${T.name}</div>
          <div class="desc" style="text-align:center">${T.desc}</div>`;
        card.onclick = () => {
          theme = T.id;
          sfxTap();
          render();
        };
        thRow.appendChild(card);
      });
      s.appendChild(thRow);

      // 棋子朝向
      const fLabel = document.createElement('div');
      fLabel.className = 'xq-sec';
      fLabel.textContent = '棋子朝向';
      s.appendChild(fLabel);
      const fRow = document.createElement('div');
      fRow.className = 'diff-row';
      ([['duel', '对坐摆放', '黑方字朝对面，像真人对弈'], ['me', '全部朝我', '双方字都朝你，方便识读']] as const).forEach(([id, nm, ds]) => {
        const card = document.createElement('div');
        card.className = 'card' + (facing === id ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${nm}</div>
          <div class="desc" style="text-align:center">${ds}</div>`;
        card.onclick = () => { facing = id; sfxTap(); render(); };
        fRow.appendChild(card);
      });
      s.appendChild(fRow);

      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = '⚔️ 开始对弈';
      go.onclick = () => {
        localStorage.setItem('xq-level', String(level));
        localStorage.setItem('xq-theme', theme);
        localStorage.setItem('xq-rival', String(rival));
        localStorage.setItem('xq-facing', facing);
        s.remove();
        setupEl = null;
        startGame(level, theme, CHARACTERS[rival], facing === 'duel');
      };
      s.appendChild(go);

      const back = document.createElement('button');
      back.className = 'btn ghost';
      back.textContent = '返回首页';
      back.onclick = () => onExit(false);
      s.appendChild(back);
    };
    render();
    wrap.appendChild(s);
  }

  // ============ 对局 ============
  function startGame(level: number, theme: PieceTheme, rival: Character, flipBlack: boolean) {
    const L = LEVELS[level];
    let board: Board = initialBoard();
    let history: Board[] = [];
    let turn: 'r' | 'b' = 'r';
    let busy = false;
    let over = false;
    let selected: { x: number; y: number } | null = null;
    let aiTimer = 0;
    let toastTimer = 0;
    let bubbleTimer = 0;

    const scene = new XiangqiScene(wrap, (x, y) => onTap(x, y), theme, flipBlack);
    scene.syncBoard(board);
    scene.dealIn();
    startBgm('guqin');

    // ---- HUD ----
    const hud = document.createElement('div');
    hud.className = 'xq-hud';
    hud.innerHTML = `
      <button class="moba-back xq-back">← 退出</button>
      <div class="xq-turn"><span id="xq-turn-dot"></span><span id="xq-turn-text">红方走棋</span></div>
      <div class="xq-actions">
        <button class="xq-btn" id="xq-mute">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="xq-btn" id="xq-undo">悔棋</button>
        <button class="xq-btn" id="xq-restart">重开</button>
      </div>`;
    wrap.appendChild(hud);
    (hud.querySelector('.xq-back') as HTMLButtonElement).onclick = () => showSetup();
    (hud.querySelector('#xq-undo') as HTMLButtonElement).onclick = () => undo();
    (hud.querySelector('#xq-restart') as HTMLButtonElement).onclick = () => restart();
    const muteBtn = hud.querySelector('#xq-mute') as HTMLButtonElement;
    muteBtn.onclick = () => {
      setMuted(!isMuted());
      muteBtn.textContent = isMuted() ? '🔇' : '🔊';
    };

    // ---- 对手角色框 ----
    const rivalBox = document.createElement('div');
    rivalBox.className = 'xq-rivalbox';
    rivalBox.style.setProperty('--c', rival.color);
    const av = avatarCanvas(rival, 62);
    rivalBox.appendChild(av);
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<b>${rival.name}</b><span>${L.name} · ${rival.style}</span>`;
    rivalBox.appendChild(info);
    wrap.appendChild(rivalBox);

    const bubble = document.createElement('div');
    bubble.className = 'xq-bubble hidden';
    wrap.appendChild(bubble);
    const say = (text: string) => {
      bubble.textContent = text;
      bubble.classList.remove('hidden');
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
      speak(text, rival.voice);
      rivalBox.classList.add('talking');
      clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => {
        bubble.classList.add('hidden');
        rivalBox.classList.remove('talking');
      }, 2600);
    };

    const toast = document.createElement('div');
    toast.className = 'moba-toast xq-toast';
    wrap.appendChild(toast);
    const showToast = (msg: string) => {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1500);
    };

    const setTurnUI = (thinking = false) => {
      const dot = hud.querySelector('#xq-turn-dot') as HTMLElement;
      const txt = hud.querySelector('#xq-turn-text') as HTMLElement;
      if (!dot || !txt) return;
      dot.className = turn === 'r' ? 'red' : 'black';
      txt.textContent = over
        ? '对局结束'
        : thinking
          ? `${rival.name}思考中…`
          : turn === 'r'
            ? '轮到你走棋'
            : `${rival.name}走棋`;
    };

    setTimeout(() => say(pickLine(rival.lines.greet)), 700);

    // ---- 流程 ----
    function onTap(x: number, y: number) {
      if (busy || over || turn !== 'r') return;
      const p = board[y][x];
      if (selected) {
        const moves = legalMoves(board, 'r').filter((m) => m.fx === selected!.x && m.fy === selected!.y);
        const mv = moves.find((m) => m.tx === x && m.ty === y);
        if (mv) {
          doMove(mv);
          return;
        }
      }
      if (p && p.c === 'r') {
        selected = { x, y };
        sfxTap();
        const moves = legalMoves(board, 'r').filter((m) => m.fx === x && m.fy === y);
        scene.select(
          selected,
          moves.map((m) => ({ x: m.tx, y: m.ty, capture: !!board[m.ty][m.tx] })),
        );
      } else {
        selected = null;
        scene.select(null);
      }
    }

    function doMove(m: Move) {
      busy = true;
      selected = null;
      const captured = !!board[m.ty][m.tx];
      const mover = board[m.fy][m.fx]!;
      history.push(board);
      board = applyMove(board, m);
      turn = turn === 'r' ? 'b' : 'r';
      scene.hideCheck();
      scene.animateMove(m, () => {
        if (captured) {
          sfxSlash();
          if (mover.c === 'b') say(pickLine(rival.lines.capture ?? rival.lines.peng));
        } else sfxKnock();
        busy = false;
        afterMove();
      });
      setTurnUI(turn === 'b');
    }

    function afterMove() {
      const st = statusAfter(board, turn);
      if (st !== 'playing') {
        over = true;
        setTurnUI();
        const k = findKing(board, turn);
        if (k) scene.finishBlast(k[0], k[1]);
        setTimeout(() => showResult(st === 'red-win'), 700);
        return;
      }
      if (isInCheck(board, turn)) {
        const k = findKing(board, turn);
        if (k) scene.flashCheck(k[0], k[1]);
        showToast('将军！');
        sfxAlert();
        if (turn === 'r') say(pickLine(rival.lines.check ?? ['将军']));
        else speak('将军');
      }
      if (turn === 'b') {
        setTurnUI(true);
        aiTimer = window.setTimeout(() => {
          const m = bestMove(board, 'b', L.depth, L.jitter, L.timeMs);
          if (m) doMove(m);
        }, 140);
      } else {
        setTurnUI();
        if (Math.random() < 0.14) say(pickLine(rival.lines.taunt));
      }
    }

    function undo() {
      if (busy || history.length === 0) return;
      clearTimeout(aiTimer);
      const steps = turn === 'r' ? 2 : 1;
      for (let i = 0; i < steps && history.length > 0; i++) board = history.pop()!;
      turn = 'r';
      over = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      scene.syncBoard(board);
      setTurnUI();
    }

    function restart() {
      clearTimeout(aiTimer);
      board = initialBoard();
      history = [];
      turn = 'r';
      over = false;
      busy = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      scene.syncBoard(board);
      scene.dealIn();
      setTurnUI();
      setTimeout(() => say(pickLine(rival.lines.greet)), 500);
    }

    let resultEl: HTMLElement | null = null;
    function showResult(playerWon: boolean) {
      if (playerWon) {
        sfxWinBig();
        setTimeout(() => say(pickLine(rival.lines.lose)), 500);
      } else {
        sfxLose();
        setTimeout(() => say(pickLine(rival.lines.win)), 400);
      }
      const s = document.createElement('div');
      s.className = 'screen moba-result xq-result';
      s.innerHTML = `
        <div class="xq-result-badge ${playerWon ? 'win' : 'lose'}">${playerWon ? '绝杀' : '败'}</div>
        <h1 style="color:${playerWon ? '#ffd76e' : '#ef5350'}">${playerWon ? '绝杀 · 红方胜' : `${rival.name} 胜`}</h1>
        <div class="sub">${playerWon ? `${rival.name}已被将死（${L.name}难度）` : '你的帅被将死了，再来一局？'}</div>`;
      const again = document.createElement('button');
      again.className = 'btn';
      again.textContent = '再来一局';
      again.onclick = () => restart();
      const chg = document.createElement('button');
      chg.className = 'btn ghost';
      chg.textContent = '换对手 / 换难度';
      chg.onclick = () => showSetup();
      const back = document.createElement('button');
      back.className = 'btn ghost';
      back.textContent = '返回首页';
      back.onclick = () => onExit(false);
      s.appendChild(again);
      s.appendChild(chg);
      s.appendChild(back);
      wrap.appendChild(s);
      resultEl = s;
    }

    setTurnUI();

    cleanupGame = () => {
      clearTimeout(aiTimer);
      clearTimeout(toastTimer);
      clearTimeout(bubbleTimer);
      stopBgm();
      scene.dispose();
      hud.remove();
      rivalBox.remove();
      bubble.remove();
      toast.remove();
      resultEl?.remove();
    };
  }

  showSetup();

  return () => {
    window.removeEventListener('pointerdown', unlock);
    cleanupGame?.();
    stopBgm();
    wrap.remove();
  };
}
