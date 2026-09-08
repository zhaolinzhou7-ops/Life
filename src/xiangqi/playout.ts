/**
 * 残局实战：摆好局面，跟引擎**下到底**。
 *
 * 这是残局课和做题最大的区别。做题只要找出一步正着，残局要的是
 * 「多子必须赢下来、少子必须守和」——把优势兑现的全过程，一步走软就没了。
 * 所以这里不到分出结果不算过。
 *
 * 判定规则和实战一致：将死判负、60 回合无吃子判和、三次重复判和。
 */
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from './rules';
import { fromFen, toFen } from './notation';
import { Board2D, type Mark } from './board2d';
import { requestMove } from './aiclient';

export type PlayResult = 'win' | 'draw' | 'loss';

export interface PlayoutOpts {
  fen: string;
  /** 你执哪一方 */
  you: Color;
  /** 要达成什么才算过：win = 必须赢，draw = 守和即可 */
  target: 'win' | 'draw';
  title: string;
  subtitle: string;
  tips: string[];
  /** 引擎强度 */
  depth?: number;
  timeMs?: number;
  onDone: (r: PlayResult, moves: number) => void;
  onExit: () => void;
}

/** 60 回合无吃子判和 */
const NO_CAPTURE_LIMIT = 120;

export function runPlayout(host: HTMLElement, opts: PlayoutOpts): () => void {
  const parsed = fromFen(opts.fen);
  const wrap = document.createElement('div');
  wrap.className = 'xq-po';
  host.appendChild(wrap);

  if (!parsed) {
    wrap.innerHTML = '<div class="xq-tr-bad">这个残局的局面读不出来。</div>';
    return () => wrap.remove();
  }

  let board: Board = parsed.board;
  let turn: Color = parsed.toMove;
  const me = opts.you;
  const foe: Color = me === 'r' ? 'b' : 'r';

  let selected: { x: number; y: number } | null = null;
  let busy = false;
  let over = false;
  let sinceCapture = 0;
  let myMoves = 0;
  let seq = 0;
  const seen = new Map<string, number>();
  const history: { board: Board; turn: Color; sinceCapture: number }[] = [];

  wrap.innerHTML = `
    <div class="xq-po-top">
      <button class="xq-btn ghost" id="xq-po-back">← 退出</button>
      <div class="xq-po-title">${opts.title}<span>${opts.subtitle}</span></div>
      <button class="xq-btn" id="xq-po-undo">悔棋</button>
    </div>
    <div class="xq-po-goal">${
      opts.target === 'win' ? '🎯 你必须<b>赢下来</b>' : '🛡 你只要<b>守和</b>就算过'
    }　<span class="xq-po-cnt"></span></div>
    <div class="xq-po-board"></div>
    <div class="xq-po-tips"></div>
    <div class="xq-po-bar"></div>`;

  const elBoard = wrap.querySelector('.xq-po-board') as HTMLElement;
  const elTips = wrap.querySelector('.xq-po-tips') as HTMLElement;
  const elBar = wrap.querySelector('.xq-po-bar') as HTMLElement;
  const elCnt = wrap.querySelector('.xq-po-cnt') as HTMLElement;

  const view = new Board2D(elBoard, { flip: me === 'b', onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);

  elTips.innerHTML =
    `<button class="xq-po-tip-toggle">💡 要领（想不出来再看）</button>` +
    `<ul class="xq-po-tip-list hidden">${opts.tips.map((t) => `<li>${t}</li>`).join('')}</ul>`;
  const toggle = elTips.querySelector('.xq-po-tip-toggle') as HTMLButtonElement;
  const tipList = elTips.querySelector('.xq-po-tip-list') as HTMLElement;
  toggle.onclick = () => tipList.classList.toggle('hidden');

  (wrap.querySelector('#xq-po-back') as HTMLButtonElement).onclick = () => opts.onExit();
  (wrap.querySelector('#xq-po-undo') as HTMLButtonElement).onclick = () => undo();

  const myLegal = () => legalMoves(board, me).filter((m) => !isInCheck(applyMove(board, m), me));

  function updateCount() {
    const left = Math.max(0, Math.ceil((NO_CAPTURE_LIMIT - sinceCapture) / 2));
    elCnt.textContent = `第 ${myMoves} 手 · 距判和还有 ${left} 回合`;
  }

  function marksFor(sel: { x: number; y: number } | null): Mark[] {
    if (!sel) return [];
    const out: Mark[] = [{ x: sel.x, y: sel.y, kind: 'ring' }];
    for (const m of myLegal()) if (m.fx === sel.x && m.fy === sel.y) out.push({ x: m.tx, y: m.ty, kind: 'dot' });
    return out;
  }

  function onTap(x: number, y: number) {
    if (over || busy || turn !== me) return;
    const p = board[y][x];
    if (selected) {
      const mv = myLegal().find((m) => m.fx === selected!.x && m.fy === selected!.y && m.tx === x && m.ty === y);
      if (mv) return play(mv);
    }
    if (p && p.c === me) {
      selected = { x, y };
      view.setMarks(marksFor(selected));
    } else {
      selected = null;
      view.setMarks([]);
    }
  }

  function play(mv: Move) {
    busy = true;
    selected = null;
    view.setMarks([]);
    history.push({ board, turn, sinceCapture });
    const cap = !!board[mv.ty][mv.tx];
    const after = applyMove(board, mv);
    board = after;
    turn = turn === 'r' ? 'b' : 'r';
    sinceCapture = cap ? 0 : sinceCapture + 1;
    if (turn === foe) myMoves++;
    updateCount();
    view.animateMove(mv, after, () => {
      busy = false;
      step();
    });
  }

  /** 走完一步之后：判结果，没结束就轮到对方 */
  function step() {
    if (over) return;
    const st = statusAfter(board, turn);
    if (st !== 'playing') {
      // statusAfter 返回的是"谁赢"，turn 是被将死的一方
      return finish(turn === me ? 'loss' : 'win');
    }
    if (sinceCapture >= NO_CAPTURE_LIMIT) return finish('draw', '60 回合无吃子');
    const key = toFen(board, turn);
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n >= 3) return finish('draw', '三次重复局面');

    if (turn === foe) {
      const my = ++seq;
      busy = true;
      requestMove(board, foe, { maxDepth: opts.depth ?? 10, jitter: 0, timeMs: opts.timeMs ?? 900 }).then((m) => {
        if (over || my !== seq) return;
        busy = false;
        if (!m) return finish(me === 'r' ? 'win' : 'win');
        play(m);
      });
    }
  }

  function undo() {
    if (over || busy) return;
    // 退回到上一次轮到我的时候
    while (history.length) {
      const h = history.pop()!;
      board = h.board;
      turn = h.turn;
      sinceCapture = h.sinceCapture;
      if (turn === me) break;
    }
    seq++;
    selected = null;
    myMoves = Math.max(0, myMoves - 1);
    view.setMarks([]);
    view.setBoard(board);
    updateCount();
  }

  function finish(r: PlayResult, reason = '') {
    over = true;
    const pass = r === 'win' || (r === 'draw' && opts.target === 'draw');
    const label =
      r === 'win' ? '赢了' : r === 'loss' ? '输了' : opts.target === 'draw' ? '守和成功' : '走成和棋了';
    elBar.innerHTML = `
      <div class="xq-po-result ${pass ? 'ok' : 'no'}">
        <b>${pass ? '✅' : '❌'} ${label}</b>
        <span>${reason ? reason + '　' : ''}${
          pass
            ? opts.target === 'win'
              ? '优势兑现了，这一局过了。'
              : '守住了，这就是这一局要练的。'
            : opts.target === 'win'
              ? '多子没赢下来——残局最可惜的就是这种。再来一次。'
              : '没守住。看看要领，再试。'
        }</span>
      </div>
      <div class="xq-po-btns">
        <button class="xq-btn primary" id="xq-po-again">再来一次</button>
        <button class="xq-btn" id="xq-po-next">${pass ? '下一个 →' : '换一个'}</button>
      </div>`;
    (elBar.querySelector('#xq-po-again') as HTMLButtonElement).onclick = () => opts.onDone(r, myMoves);
    (elBar.querySelector('#xq-po-next') as HTMLButtonElement).onclick = () => opts.onExit();
  }

  updateCount();

  // 开发期测试钩子（生产构建会被摇掉，同 index.ts / train.ts）
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqPlay = {
      tap: (x: number, y: number) => onTap(x, y),
      /** 随便走一手合法着法，用来自动化跑完整局 */
      playAny: () => {
        const l = myLegal();
        if (!l.length || turn !== me || busy || over) return false;
        play(l[(Math.random() * l.length) | 0]);
        return true;
      },
      state: () => ({ over, turn, myMoves, sinceCapture }),
    };
  }

  // 如果开局就轮到对方，先让引擎走
  if (turn === foe) step();

  return () => {
    over = true;
    seq++;
    view.dispose();
    wrap.remove();
  };
}
