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
import { fromFen, moveToText, textToMove } from './notation';
import { Board2D, type Mark } from './board2d';

export interface ReplayMove {
  t: string;
  why?: string;
  /** 同样正确的其它走法：猜着法时走这些也算对 */
  alts?: string[];
  /**
   * 谱上收着的其它走法（布局的变招、错着）：猜着法时走到这些，不用等皮卡鱼，直接说它是什么——
   * 变招算对；错着算错，并且说清楚错在哪、对方怎么罚。
   */
  known?: { t: string; ok: boolean; note: string }[];
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
  /** 从这个局面开始（不给就是开局）：残局的示范解法 */
  fen?: string;
  /** 黑方在下面（不给就看猜着法时执哪方） */
  flip?: boolean;
  /** 底部提示条 */
  notes?: string[];
  /** 走完时的局面判断（布局谱：走到这里谁好、好多少） */
  outro?: string;
  /** 走完时回调：猜着法模式下猜中几手、一共猜了几手 */
  onFinish?: (right: number, tried: number) => void;
  onExit: () => void;
  /** 走完之后的下一步（比如邪门布局"破解到底"），放在收尾那一栏最前面 */
  next?: { label: string; run: () => void };
  /** 猜着法时走了原谱之外的着法：判它是不是一样好（皮卡鱼），null = 判不了，只认原谱 */
  judge?: (board: Board, color: Color, mine: Move, expected: Move) => Promise<{ ok: boolean; loss: number } | null>;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

export function runReplay(host: HTMLElement, opts: ReplayOpts): () => void {
  const wrap = document.createElement('div');
  // xq-rp-fit：占满一屏，棋盘吃剩下的高度、讲解框限高可滚——讲解再长，按钮也不会被挤出屏幕
  wrap.className = 'xq-rp xq-rp-fit';
  host.appendChild(wrap);

  const start = opts.fen ? fromFen(opts.fen) : null;
  const startBoard = (): Board => (start ? start.board : initialBoard());
  const startTurn: Color = start ? start.toMove : 'r';
  let board: Board = startBoard();
  let turn: Color = startTurn;
  let idx = 0; // 下一手的下标
  let right = 0;
  let tried = 0;
  let sel: { x: number; y: number } | null = null;
  let waiting = false; // 猜着法模式：正在等你走

  wrap.innerHTML = `
    <div class="xq-rp-head">
      <div class="t">${opts.title}</div>
      <div class="s">${opts.subtitle}</div>
      <button class="xq-rp-flip" title="翻转棋盘" aria-label="翻转棋盘">⇅</button>
    </div>
    <div class="xq-rp-board"></div>
    <div class="xq-rp-say"></div>
    <div class="xq-rp-bar"></div>
    <div class="xq-rp-trail"></div>`;

  const elBoard = wrap.querySelector('.xq-rp-board') as HTMLElement;
  const elSay = wrap.querySelector('.xq-rp-say') as HTMLElement;
  const elBar = wrap.querySelector('.xq-rp-bar') as HTMLElement;
  const elTrail = wrap.querySelector('.xq-rp-trail') as HTMLElement;

  // 讲解框限高可滚：换一段讲解就回到开头，别停在上一段滚到的位置
  const sayObs = new MutationObserver(() => (elSay.scrollTop = 0));
  sayObs.observe(elSay, { childList: true });

  let flipped = opts.flip ?? opts.guessFor === 'b';
  const view = new Board2D(elBoard, { flip: flipped, onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);
  // 学后手的布局（屏风马、单提马……）想站在黑方这边看：翻一下
  (wrap.querySelector('.xq-rp-flip') as HTMLButtonElement).onclick = () => {
    flipped = !flipped;
    view.setFlip(flipped);
  };

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

  async function submitGuess(mv: Move) {
    const mine = moveToText(board, mv);
    const real = opts.moves[idx].t;
    let alt = mine !== real && (opts.moves[idx].alts ?? []).includes(mine);
    let judged = '';
    waiting = false;
    sel = null;
    view.setMarks([]);
    // 谱上收着的变招、错着：直接说它是什么
    const kn = mine !== real && !alt ? opts.moves[idx].known?.find((k) => k.t === mine) : undefined;
    if (kn) {
      alt = kn.ok;
      judged = kn.note;
    }
    // 不是原谱、也不在备选里：让皮卡鱼判是不是一样好（谱长了，同样好的着法很多）
    if (mine !== real && !alt && !kn && opts.judge) {
      const exp = textToMove(board, turn, real, legalMoves(board, turn));
      if (exp) {
        const at = idx;
        elSay.className = 'xq-rp-say ask';
        elSay.innerHTML = `<div class="h">你走的是 ${mine}，不是原谱那一手——皮卡鱼在核对…</div>`;
        const j = await opts.judge(board, turn, mv, exp);
        if (at !== idx) return; // 期间重来了
        if (j?.ok) {
          alt = true;
          judged = '皮卡鱼核对过';
        } else if (j) judged = `皮卡鱼核对过：比原谱差约 ${(j.loss / 100).toFixed(1)} 个兵`;
      }
    }
    tried++;
    if (mine === real || alt) right++;
    const why = opts.moves[idx].why ? `<div class="w">${opts.moves[idx].why}</div>` : '';
    elSay.className = `xq-rp-say ${mine === real || alt ? 'ok' : 'no'}`;
    elSay.innerHTML =
      mine === real
        ? `<div class="h">✅ 猜对了 · ${real}</div>${why}`
        : alt
          ? `<div class="h">✅ 也对 · 你走的 ${mine} 和 <b>${real}</b> 一样好${judged ? `（${judged}）` : ''}</div>${why}`
          : `<div class="h">❌ 你走的是 ${mine}，原谱走的是 <b>${real}</b>${judged ? `（${judged}）` : ''}</div>${why}`;
    play(); // 不管猜没猜中，都按原谱往下走
    // 走完最后一手不马上收尾：先让你看清这一手猜得对不对、为什么，按钮变成"看总结 →"
    renderBar();
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
      .map((m, i) => `<span data-n="${i + 1}" class="${i === idx - 1 ? 'on' : ''}">${i % 2 === 0 ? `${i / 2 + 1}.` : ''}${m.t}</span>`)
      .join(' ');
    // 讲解模式下点棋谱条上的哪一手就跳回哪一手
    if (!opts.guessFor) elTrail.querySelectorAll<HTMLElement>('[data-n]').forEach((el) => (el.onclick = () => goTo(Number(el.dataset.n))));
    // 棋谱条限高可滚：最新一手永远露在眼前
    elTrail.scrollTop = elTrail.scrollHeight;
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
    showStep(step);
    renderBar();
  }

  /** 讲解框里放一手的说明 */
  function showStep(step: ReplayMove, head = step.t) {
    elSay.className = 'xq-rp-say';
    elSay.innerHTML = `<div class="h">${head}</div>${step.why ? `<div class="w">${step.why}</div>` : ''}`;
  }

  /** 前面这几手直接摆好（startAt），讲解只能退到这里 */
  const lo = () => Math.min(opts.startAt ?? 0, opts.moves.length);

  /**
   * 跳到第 n 手走完的局面（讲解模式才能退：猜着法退回去再猜就不算数了）。
   * 用户原话里没说，但看讲解时想回头再看一眼上一手是最常见的事——原来只能"再看一遍"从头来。
   */
  function goTo(n: number) {
    if (opts.guessFor) return;
    n = Math.max(lo(), Math.min(opts.moves.length, n));
    board = startBoard();
    turn = startTurn;
    idx = 0;
    waiting = false;
    sel = null;
    view.setBoard(board);
    view.clearMarks();
    view.setArrows([]);
    while (idx < n) play();
    renderTrail();
    if (n === lo()) return showIntro();
    showStep(opts.moves[n - 1]);
    renderBar();
  }

  function finish() {
    opts.onFinish?.(right, tried);
    elSay.className = 'xq-rp-say done';
    elSay.innerHTML =
      `<div class="h">走完了</div>` +
      (opts.outro ? `<div class="w">${opts.outro}</div>` : '') +
      (opts.guessFor && tried
        ? `<div class="w">你猜中 <b>${right}/${tried}</b> 手。猜不中很正常——真正有用的是<b>看清楚原谱为什么那么走</b>，
           而不是猜中的次数。</div>`
        : '') +
      (opts.notes?.length
        ? `<div class="w"><b>几个容易踩的坑</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">${opts.notes
            .map((n) => `<li>${n}</li>`)
            .join('')}</ul></div>`
        : '');
    elBar.innerHTML =
      backBtn() +
      (opts.next ? `<button class="xq-btn primary" id="rp-next-step">${opts.next.label}</button>` : '') +
      `<button class="xq-btn${opts.next ? '' : ' primary'}" id="rp-again">再看一遍</button><button class="xq-btn ghost" id="rp-out">← 返回</button>`;
    // 总结页的"上一手"回到最后一手的讲解
    const bk = elBar.querySelector('#rp-back') as HTMLButtonElement | null;
    if (bk) bk.onclick = () => goTo(opts.moves.length);
    (elBar.querySelector('#rp-again') as HTMLButtonElement).onclick = () => reset();
    (elBar.querySelector('#rp-out') as HTMLButtonElement).onclick = opts.onExit;
    const nx = elBar.querySelector('#rp-next-step') as HTMLButtonElement | null;
    if (nx && opts.next) nx.onclick = opts.next.run;
  }

  function reset() {
    board = startBoard();
    turn = startTurn;
    idx = 0;
    right = 0;
    tried = 0;
    waiting = false;
    view.setBoard(board);
    view.clearMarks();
    view.setArrows([]);
    skipTo();
    renderTrail();
    showIntro();
  }

  /** 前 startAt 手直接摆好 */
  function skipTo() {
    while (idx < Math.min(opts.startAt ?? 0, opts.moves.length)) play();
  }

  /** 讲解模式下"上一手"的小按钮（猜着法不给退） */
  const backBtn = () => (!opts.guessFor && idx > lo() ? '<button class="xq-btn xq-rp-back" id="rp-back" title="上一手" aria-label="上一手">◀</button>' : '');
  function wireBack() {
    const bk = elBar.querySelector('#rp-back') as HTMLButtonElement | null;
    if (bk) bk.onclick = () => goTo(idx - 1);
  }

  function renderBar() {
    const atEnd = idx >= opts.moves.length;
    elBar.innerHTML = waiting
      ? '<span class="xq-tr-note">在棋盘上走一手</span><button class="xq-btn ghost" id="rp-skip">想不出，直接看</button><button class="xq-btn ghost" id="rp-out">← 返回</button>'
      : `${backBtn()}<button class="xq-btn primary" id="rp-next">${atEnd ? '看总结 →' : '下一手 →'}</button><button class="xq-btn ghost" id="rp-out">← 返回</button>`;
    const sk = elBar.querySelector('#rp-skip') as HTMLButtonElement | null;
    if (sk)
      sk.onclick = () => {
        waiting = false;
        const step = opts.moves[idx];
        play();
        showStep(step, `原谱：${step.t}`);
        renderBar();
      };
    const nx = elBar.querySelector('#rp-next') as HTMLButtonElement | null;
    if (nx) nx.onclick = next;
    const out = elBar.querySelector('#rp-out') as HTMLButtonElement | null;
    if (out) out.onclick = opts.onExit;
    wireBack();
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
      /** 讲解模式：跳到第 n 手走完 */
      goTo: (n: number) => goTo(n),
      flipped: () => flipped,
      idx: () => idx,
      /** 原谱下一手（UI 测试照谱走） */
      expected: () => opts.moves[idx]?.t ?? null,
      total: () => opts.moves.length,
      say: () => elSay.textContent,
    };
  }

  return () => {
    sayObs.disconnect();
    view.dispose();
    wrap.remove();
  };
}
