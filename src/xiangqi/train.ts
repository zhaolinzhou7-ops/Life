/**
 * 做题界面：摆出局面，你走一手，当场判对错。
 *
 * 两个教学上的讲究：
 *   1. **提示分三级**——直接给答案等于没练。先告诉你该动哪个子，
 *      还想不出再告诉你往哪走，最后才给整手。用了提示不计分但进错题本。
 *   2. **走错要看见反驳**——只说"错了"学不到东西，必须把对方怎么惩罚你演出来。
 */
import { fromFen, moveToText } from './notation';
import { legalMoves, applyMove, isInCheck, type Board, type Color, type Move } from './rules';
import { Board2D, type Mark } from './board2d';
import { requestMove } from './aiclient';
import { KIND_PROMPT, type Puzzle } from './puzzles';

export interface PuzzleResult {
  correct: boolean;
  usedHint: boolean;
}

export interface PuzzleOpts {
  /** 顶部说明，比如「测评 3/35」 */
  caption?: string;
  /** 是否允许提示。测评时要关掉，不然测不准 */
  allowHint?: boolean;
  /** 答完之后点"继续"触发 */
  onDone: (r: PuzzleResult) => void;
}

export function runPuzzle(host: HTMLElement, puzzle: Puzzle, opts: PuzzleOpts): () => void {
  const parsed = fromFen(puzzle.fen);
  const wrap = document.createElement('div');
  wrap.className = 'xq-tr';
  host.appendChild(wrap);

  if (!parsed) {
    wrap.innerHTML = '<div class="xq-tr-bad">这道题的局面读不出来，已跳过。</div>';
    setTimeout(() => opts.onDone({ correct: false, usedHint: false }), 600);
    return () => wrap.remove();
  }

  let board: Board = parsed.board;
  const me: Color = parsed.toMove;
  const allowHint = opts.allowHint !== false;

  let selected: { x: number; y: number } | null = null;
  let hintLevel = 0;
  let answered = false;
  let busy = false;

  wrap.innerHTML = `
    <div class="xq-tr-top">
      <span class="xq-tr-cap">${opts.caption ?? ''}</span>
      <span class="xq-tr-ask">${KIND_PROMPT[puzzle.kind]}${
        puzzle.mateIn ? `（${puzzle.mateIn * 2 - 1} 步杀）` : ''
      }</span>
      <span class="xq-tr-side">${me === 'r' ? '红方走' : '黑方走'} · 难度 ${puzzle.rating}</span>
    </div>
    <div class="xq-tr-board"></div>
    <div class="xq-tr-fb"></div>
    <div class="xq-tr-bar"></div>`;

  const elBoard = wrap.querySelector('.xq-tr-board') as HTMLElement;
  const elFb = wrap.querySelector('.xq-tr-fb') as HTMLElement;
  const elBar = wrap.querySelector('.xq-tr-bar') as HTMLElement;

  // 执黑的题把棋盘转过来，让"自己"永远在下方，符合实战视角
  const view = new Board2D(elBoard, { flip: me === 'b', onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);

  /** 我方合法着法 */
  const legal = () => legalMoves(board, me).filter((m) => !isInCheck(applyMove(board, m), me));

  function marksFor(sel: { x: number; y: number } | null): Mark[] {
    if (!sel) return [];
    const out: Mark[] = [{ x: sel.x, y: sel.y, kind: 'ring' }];
    for (const m of legal()) if (m.fx === sel.x && m.fy === sel.y) out.push({ x: m.tx, y: m.ty, kind: 'dot' });
    return out;
  }

  function onTap(x: number, y: number) {
    if (answered || busy) return;
    const p = board[y][x];
    if (selected) {
      const mv = legal().find((m) => m.fx === selected!.x && m.fy === selected!.y && m.tx === x && m.ty === y);
      if (mv) {
        submit(mv);
        return;
      }
    }
    if (p && p.c === me) {
      selected = { x, y };
      view.setMarks(marksFor(selected));
    } else {
      selected = null;
      view.setMarks([]);
    }
  }

  function submit(mv: Move) {
    answered = true;
    busy = true;
    selected = null;
    view.setMarks([]);
    const text = moveToText(board, mv);
    const correct = text === puzzle.answer;
    const after = applyMove(board, mv);
    board = after;
    view.animateMove(mv, after, () => {
      busy = false;
      if (correct) showRight(text);
      else showWrong(text);
    });
  }

  function showRight(text: string) {
    view.clearMarks();
    elFb.className = 'xq-tr-fb ok';
    elFb.innerHTML = `
      <div class="h">✅ 对了 · ${text}</div>
      ${puzzle.line.length > 1 ? `<div class="l">完整下法：${puzzle.line.join(' ')}</div>` : ''}`;
    finishBar(true);
  }

  function showWrong(text: string) {
    elFb.className = 'xq-tr-fb no';
    elFb.innerHTML = `
      <div class="h">❌ 不对 · 你走的是 ${text}</div>
      <div class="l">正解：<b>${puzzle.answer}</b>${
        puzzle.line.length > 1 ? `　完整下法：${puzzle.line.join(' ')}` : ''
      }</div>
      <div class="r">正在算对方怎么惩罚这一手…</div>`;
    finishBar(false);
    // 走错之后对方的最强应手——让你看见代价，而不是只被告知"错了"
    const other: Color = me === 'r' ? 'b' : 'r';
    const snapshot = board;
    requestMove(snapshot, other, { maxDepth: 6, jitter: 0, timeMs: 1200 }).then((reply) => {
      const el = elFb.querySelector('.r');
      if (!el) return;
      if (!reply) {
        el.remove();
        return;
      }
      el.innerHTML = `对方接下来会走 <b>${moveToText(snapshot, reply)}</b>。`;
      view.setArrows([{ fx: reply.fx, fy: reply.fy, tx: reply.tx, ty: reply.ty, color: 'rgba(214,64,52,0.92)' }]);
    });
  }

  /** 三级提示：动哪个子 → 往哪走 → 整手 */
  function hint() {
    if (answered) return;
    hintLevel++;
    const sol = legal().find((m) => moveToText(board, m) === puzzle.answer);
    if (!sol) return;
    if (hintLevel === 1) {
      view.setMarks([{ x: sol.fx, y: sol.fy, kind: 'ring' }]);
      elFb.className = 'xq-tr-fb tip';
      elFb.innerHTML = '<div class="l">💡 该动的是圈出来的那个子。</div>';
    } else if (hintLevel === 2) {
      const dir =
        sol.ty === sol.fy
          ? '横着走'
          : (sol.ty - sol.fy) * (me === 'r' ? -1 : 1) > 0
            ? '往前走'
            : '往后退';
      view.setMarks([{ x: sol.fx, y: sol.fy, kind: 'ring' }]);
      elFb.innerHTML = `<div class="l">💡 这个子要${dir}。</div>`;
    } else {
      view.setMarks([{ x: sol.fx, y: sol.fy, kind: 'ring' }]);
      view.setArrows([{ fx: sol.fx, fy: sol.fy, tx: sol.tx, ty: sol.ty }]);
      elFb.innerHTML = `<div class="l">💡 正解是 <b>${puzzle.answer}</b>，照着走一遍。</div>`;
    }
    renderBar();
  }

  function renderBar() {
    if (answered) return;
    elBar.innerHTML = allowHint
      ? `<button class="xq-btn" id="xq-tr-hint">💡 提示${hintLevel ? `（已用 ${hintLevel}/3）` : ''}</button>
         <button class="xq-btn ghost" id="xq-tr-skip">跳过</button>`
      : '<span class="xq-tr-note">测评中不给提示，凭自己判断就好</span>';
    const h = elBar.querySelector('#xq-tr-hint') as HTMLButtonElement | null;
    if (h) h.onclick = () => hint();
    const s = elBar.querySelector('#xq-tr-skip') as HTMLButtonElement | null;
    if (s) s.onclick = () => {
      answered = true;
      elFb.className = 'xq-tr-fb no';
      elFb.innerHTML = `<div class="h">跳过了</div><div class="l">正解：<b>${puzzle.answer}</b></div>`;
      finishBar(false);
    };
  }

  function finishBar(correct: boolean) {
    elBar.innerHTML = '<button class="xq-btn primary" id="xq-tr-next">继续 →</button>';
    (elBar.querySelector('#xq-tr-next') as HTMLButtonElement).onclick = () =>
      opts.onDone({ correct, usedHint: hintLevel > 0 });
  }

  renderBar();

  // 开发期测试钩子：做题界面靠点棋盘操作，自动化测试算不出格子的屏幕坐标，
  // 这里把内部动作直接暴露出来。生产构建里整块会被摇掉（同 index.ts 的 __xq）。
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqTrain = {
      tap: (x: number, y: number) => onTap(x, y),
      answer: () => puzzle.answer,
      /** 直接走正解 */
      playRight: () => {
        const m = legal().find((mv) => moveToText(board, mv) === puzzle.answer);
        if (m) submit(m);
        return !!m;
      },
      /** 随便走一手错的 */
      playWrong: () => {
        const m = legal().find((mv) => moveToText(board, mv) !== puzzle.answer);
        if (m) submit(m);
        return !!m;
      },
      hint: () => hint(),
    };
  }

  return () => {
    view.dispose();
    wrap.remove();
  };
}
