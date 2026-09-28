/**
 * 棋谱播放器：一手一手走，每一手配一句"这一手在做什么"。
 *
 * 两种用法共用同一套：
 *   讲解模式 —— 点"下一手"往下走，看着法和理由（学定式）
 *   猜着法   —— 先让你在盘上走一手，再揭晓原谱怎么走（打谱的经典练法）
 *
 * 为什么猜着法比看棋谱有用得多：看的时候你会觉得"这手我也想得到"，
 * 真让你先走一遍才知道想不想得到。**先承诺再对答案**，这是所有
 * 有效训练的共同点，和做题界面不给你直接看答案是同一个道理。
 */
import { initialBoard, legalMoves, applyMove, isInCheck, type Board, type Color, type Move } from './rules';
import { moveToText, textToMove } from './notation';
import { Board2D, type Mark } from './board2d';

export interface ReplayMove {
  t: string;
  why?: string;
  /** 同样正确的其它走法：猜着法时走这些也算对 */
  alts?: string[];
}

export interface ReplayOpts {
  title: string;
  subtitle: string;
  /** 开场说明，讲解模式下先看这个 */
  intro?: string;
  moves: ReplayMove[];
  /** 猜着法模式：你要走的是哪一方（不填则纯讲解） */
  guessFor?: Color;
  /** 前这么多手直接摆好，从这之后才开始讲/猜（练破解时，套路那几手不用你猜） */
  startAt?: number;
  /** 底部提示条 */
  notes?: string[];
  /** 走完时回调：猜着法模式下猜中几手、一共猜了几手 */
  onFinish?: (right: number, tried: number) => void;
  onExit: () => void;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

export function runReplay(host: HTMLElement, opts: ReplayOpts): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-rp';
  host.appendChild(wrap);

  let board: Board = initialBoard();
  let turn: Color = 'r';
  let idx = 0; // 下一手的下标
  let right = 0;
  let tried = 0;
  let sel: { x: number; y: number } | null = null;
  let waiting = false; // 猜着法模式：正在等你走

  wrap.innerHTML = `
    <div class="xq-rp-head">
      <div class="t">${opts.title}</div>
      <div class="s">${opts.subtitle}</div>
    </div>
    <div class="xq-rp-board"></div>
    <div class="xq-rp-say"></div>
    <div class="xq-rp-bar"></div>
    <div class="xq-rp-trail"></div>`;

  const elBoard = wrap.querySelector('.xq-rp-board') as HTMLElement;
  const elSay = wrap.querySelector('.xq-rp-say') as HTMLElement;
  const elBar = wrap.querySelector('.xq-rp-bar') as HTMLElement;
  const elTrail = wrap.querySelector('.xq-rp-trail') as HTMLElement;

  const view = new Board2D(elBoard, { flip: opts.guessFor === 'b', onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);

  const legal = () => legalMoves(board, turn).filter((m) => !isInCheck(applyMove(board, m), turn));

  function marks(s: { x: number; y: number } | null): Mark[] {
    if (!s) return [];
    const out: Mark[] = [{ x: s.x, y: s.y, kind: 'ring' }];
    for (const m of legal()) if (m.fx === s.x && m.fy === s.y) out.push({ x: m.tx, y: m.ty, kind: 'dot' });
    return out;
  }

  function onTap(x: number, y: number) {
    if (!waiting) return;
    const p = board[y][x];
    if (sel) {
      const mv = legal().find((m) => m.fx === sel!.x && m.fy === sel!.y && m.tx === x && m.ty === y);
      if (mv) return submitGuess(mv);
    }
    if (p && p.c === turn) {
      sel = { x, y };
      view.setMarks(marks(sel));
    } else {
      sel = null;
      view.setMarks([]);
    }
  }

  function submitGuess(mv: Move) {
    const mine = moveToText(board, mv);
    const real = opts.moves[idx].t;
    const alt = mine !== real && (opts.moves[idx].alts ?? []).includes(mine);
    tried++;
    if (mine === real || alt) right++;
    waiting = false;
    sel = null;
    view.setMarks([]);
    const why = opts.moves[idx].why ? `<div class="w">${opts.moves[idx].why}</div>` : '';
    elSay.className = `xq-rp-say ${mine === real || alt ? 'ok' : 'no'}`;
    elSay.innerHTML =
      mine === real
        ? `<div class="h">✅ 猜对了 · ${real}</div>${why}`
        : alt
          ? `<div class="h">✅ 也对 · 你走的 ${mine} 和 <b>${real}</b> 一样好</div>${why}`
          : `<div class="h">❌ 你走的是 ${mine}，原谱走的是 <b>${real}</b></div>${why}`;
    play(); // 不管猜没猜中，都按原谱往下走
    renderBar();
    // ⚠️ 猜中最后一手之后要收尾。少了这一句，renderBar() 因为已经走完而
    // 直接返回，按钮停在上一状态，界面就卡住了——只有"想不出直接看"那条
    // 分支写了 finish()，猜着法这条漏了。
    if (idx >= opts.moves.length) finish();
  }

  /** 按原谱走下一手 */
  function play() {
    const step = opts.moves[idx];
    if (!step) return;
    const mv = textToMove(board, turn, step.t, legal());
    if (!mv) {
      elSay.className = 'xq-rp-say no';
      elSay.innerHTML = `<div class="h">这一手（${step.t}）走不通，谱子有问题</div>`;
      idx = opts.moves.length;
      return;
    }
    board = applyMove(board, mv);
    view.setBoard(board);
    view.setArrows([{ fx: mv.fx, fy: mv.fy, tx: mv.tx, ty: mv.ty }]);
    turn = other(turn);
    idx++;
    renderTrail();
  }

  function renderTrail() {
    elTrail.innerHTML = opts.moves
      .slice(0, idx)
      .map((m, i) => `<span class="${i === idx - 1 ? 'on' : ''}">${i % 2 === 0 ? `${i / 2 + 1}.` : ''}${m.t}</span>`)
      .join(' ');
  }

  function next() {
    if (idx >= opts.moves.length) return finish();
    if (opts.guessFor && turn === opts.guessFor) {
      // 轮到你——先让你走，再揭晓
      waiting = true;
      elSay.className = 'xq-rp-say ask';
      elSay.innerHTML = `<div class="h">轮到${turn === 'r' ? '红' : '黑'}方 · 第 ${
        Math.floor(idx / 2) + 1
      } 回合</div><div class="w">先自己想一手走出来，再看原谱。<b>先承诺再对答案</b>，光看谱学不到东西。</div>`;
      renderBar();
      return;
    }
    const step = opts.moves[idx];
    play();
    elSay.className = 'xq-rp-say';
    elSay.innerHTML = `<div class="h">${step.t}</div>${step.why ? `<div class="w">${step.why}</div>` : ''}`;
    renderBar();
    if (idx >= opts.moves.length) finish();
  }

  function finish() {
    opts.onFinish?.(right, tried);
    elSay.className = 'xq-rp-say done';
    elSay.innerHTML =
      `<div class="h">走完了</div>` +
      (opts.guessFor && tried
        ? `<div class="w">你猜中 <b>${right}/${tried}</b> 手。猜不中很正常——真正有用的是<b>看清楚原谱为什么那么走</b>，
           而不是猜中的次数。</div>`
        : '') +
      (opts.notes?.length
        ? `<div class="w"><b>几个容易踩的坑</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">${opts.notes
            .map((n) => `<li>${n}</li>`)
            .join('')}</ul></div>`
        : '');
    elBar.innerHTML = '<button class="xq-btn primary" id="rp-again">再看一遍</button><button class="xq-btn ghost" id="rp-out">← 返回</button>';
    (elBar.querySelector('#rp-again') as HTMLButtonElement).onclick = () => reset();
    (elBar.querySelector('#rp-out') as HTMLButtonElement).onclick = opts.onExit;
  }

  function reset() {
    board = initialBoard();
    turn = 'r';
    idx = 0;
    right = 0;
    tried = 0;
    waiting = false;
    view.setBoard(board);
    view.clearMarks();
    skipTo();
    renderTrail();
    showIntro();
  }

  /** 前 startAt 手直接摆好 */
  function skipTo() {
    while (idx < Math.min(opts.startAt ?? 0, opts.moves.length)) play();
  }

  function renderBar() {
    if (idx >= opts.moves.length) return;
    elBar.innerHTML = waiting
      ? '<span class="xq-tr-note">在棋盘上走一手</span><button class="xq-btn ghost" id="rp-skip">想不出，直接看</button>'
      : '<button class="xq-btn primary" id="rp-next">下一手 →</button><button class="xq-btn ghost" id="rp-out">← 返回</button>';
    const sk = elBar.querySelector('#rp-skip') as HTMLButtonElement | null;
    if (sk)
      sk.onclick = () => {
        waiting = false;
        const step = opts.moves[idx];
        play();
        elSay.className = 'xq-rp-say';
        elSay.innerHTML = `<div class="h">原谱：${step.t}</div>${step.why ? `<div class="w">${step.why}</div>` : ''}`;
        renderBar();
        if (idx >= opts.moves.length) finish();
      };
    const nx = elBar.querySelector('#rp-next') as HTMLButtonElement | null;
    if (nx) nx.onclick = next;
    const out = elBar.querySelector('#rp-out') as HTMLButtonElement | null;
    if (out) out.onclick = opts.onExit;
  }

  function showIntro() {
    elSay.className = 'xq-rp-say intro';
    elSay.innerHTML = opts.intro ? `<div class="w">${opts.intro}</div>` : '<div class="w">点「下一手」开始。</div>';
    renderBar();
  }

  skipTo();
  showIntro();
  renderTrail();

  // 开发期测试钩子（生产构建会被摇掉）
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqReplay = {
      /** 猜着法：按中文记谱走一手 */
      guess: (t: string) => {
        const mv = waiting ? textToMove(board, turn, t, legal()) : null;
        if (mv) submitGuess(mv);
        return !!mv;
      },
      waiting: () => waiting,
      idx: () => idx,
      say: () => elSay.textContent,
    };
  }

  return () => {
    view.dispose();
    wrap.remove();
  };
}
