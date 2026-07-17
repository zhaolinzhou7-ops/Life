/** 象棋启动入口：玩家执红 vs AI 执黑，HUD 与对局流程 */
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
import { XiangqiScene } from './scene3d';

export function bootXiangqi(app: HTMLElement, onExit: (restart: boolean) => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-root';
  app.appendChild(wrap);

  let board: Board = initialBoard();
  let history: Board[] = [];
  let turn: 'r' | 'b' = 'r';
  let busy = false; // 动画/AI 思考中
  let over = false;
  let selected: { x: number; y: number } | null = null;
  let aiTimer = 0;

  const scene = new XiangqiScene(wrap, (x, y) => onTap(x, y));
  scene.syncBoard(board);

  // ---- HUD ----
  const hud = document.createElement('div');
  hud.className = 'xq-hud';
  hud.innerHTML = `
    <button class="moba-back xq-back">← 退出</button>
    <div class="xq-turn"><span id="xq-turn-dot"></span><span id="xq-turn-text">红方走棋</span></div>
    <div class="xq-actions">
      <button class="xq-btn" id="xq-undo">悔棋</button>
      <button class="xq-btn" id="xq-restart">重开</button>
    </div>`;
  wrap.appendChild(hud);
  (hud.querySelector('.xq-back') as HTMLButtonElement).onclick = () => onExit(false);
  (hud.querySelector('#xq-undo') as HTMLButtonElement).onclick = () => undo();
  (hud.querySelector('#xq-restart') as HTMLButtonElement).onclick = () => restart();

  const toast = document.createElement('div');
  toast.className = 'moba-toast xq-toast';
  wrap.appendChild(toast);
  let toastTimer = 0;
  const showToast = (msg: string) => {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1500);
  };

  const setTurnUI = (thinking = false) => {
    const dot = document.getElementById('xq-turn-dot');
    const txt = document.getElementById('xq-turn-text');
    if (!dot || !txt) return;
    dot.className = turn === 'r' ? 'red' : 'black';
    txt.textContent = over ? '对局结束' : thinking ? '黑方思考中…' : turn === 'r' ? '红方走棋' : '黑方走棋';
  };

  // ---- 对局流程 ----
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
      const moves = legalMoves(board, 'r').filter((m) => m.fx === x && m.fy === y);
      scene.select(selected, moves.map((m) => ({ x: m.tx, y: m.ty, capture: !!board[m.ty][m.tx] })));
    } else {
      selected = null;
      scene.select(null);
    }
  }

  function doMove(m: Move) {
    busy = true;
    selected = null;
    history.push(board);
    board = applyMove(board, m);
    turn = turn === 'r' ? 'b' : 'r';
    scene.hideCheck();
    scene.animateMove(m, () => {
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
      showResult(st === 'red-win');
      return;
    }
    if (isInCheck(board, turn)) {
      const k = findKing(board, turn);
      if (k) scene.flashCheck(k[0], k[1]);
      showToast('将军！');
    }
    if (turn === 'b') {
      setTurnUI(true);
      aiTimer = window.setTimeout(() => {
        const m = bestMove(board, 'b', 3);
        if (m) doMove(m);
      }, 120);
    } else {
      setTurnUI();
    }
  }

  function undo() {
    if (busy || history.length === 0) return;
    // 退回到玩家上一次走子前（弹出 AI 与玩家各一步）
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
    setTurnUI();
  }

  let resultEl: HTMLElement | null = null;
  function showResult(playerWon: boolean) {
    const s = document.createElement('div');
    s.className = 'screen moba-result';
    s.innerHTML = `
      <h1 style="color:${playerWon ? '#66bb6a' : '#ef5350'}">${playerWon ? '绝杀 · 红方胜' : '黑方胜'}</h1>
      <div class="sub">${playerWon ? 'AI 已被将死' : '你的帅被将死了，再来一局？'}</div>`;
    const again = document.createElement('button');
    again.className = 'btn';
    again.textContent = '再来一局';
    again.onclick = () => restart();
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '返回首页';
    back.onclick = () => onExit(false);
    s.appendChild(again);
    s.appendChild(back);
    wrap.appendChild(s);
    resultEl = s;
  }

  setTurnUI();

  return () => {
    clearTimeout(aiTimer);
    clearTimeout(toastTimer);
    scene.dispose();
    wrap.remove();
  };
}
