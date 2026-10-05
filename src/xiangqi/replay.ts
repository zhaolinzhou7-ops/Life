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
  /** 讲解模式下的分支：走到分岔那一手停下来，列出主线和这几条路，点哪条（按钮或棋盘上的箭头）走哪条 */
  branches?: ReplayBranch[];
  /** 分岔时主线那一条叫什么（不给就叫"主线"） */
  mainLabel?: string;
  /** 猜着法时走了原谱之外的着法：判它是不是一样好（皮卡鱼），null = 判不了，只认原谱 */
  judge?: (board: Board, color: Color, mine: Move, expected: Move) => Promise<{ ok: boolean; loss: number } | null>;
}

/**
 * 分支：从第 at 手起换一条路走（前 at 手和主线一样）。
 * 用户原话："走着走着都可能有分支。帮我把不同的路线分出来：第一种走法会怎么发展，第二条路又会怎么发展。
 * 我希望可以按着'下一步'一步步点击去看这些变化，能实时看到棋盘上的具体变化。"
 */
export interface ReplayBranch {
  at: number;
  /** 一句话的名字：变招名、"上当：……" */
  name: string;
  /** ok = 也行（变招、另一种破法）；no = 错着、上当；dev = 对方不按套路走 */
  kind: 'ok' | 'no' | 'dev';
  moves: ReplayMove[];
  /** 这一路走完的结论 */
  outro?: string;
  /** 这一路看完了（打勾） */
  onSeen?: () => void;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥', '⑦', '⑧'];
const KIND_TAG: Record<'main' | ReplayBranch['kind'], { tag: string; color: string }> = {
  main: { tag: '主线', color: 'rgba(46,170,90,0.92)' },
  ok: { tag: '也行', color: 'rgba(59,130,246,0.92)' },
  dev: { tag: '他改走', color: 'rgba(168,85,247,0.92)' },
  no: { tag: '错着', color: 'rgba(224,67,58,0.92)' },
};

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
  /** 现在走的这一路：主线，或者从某个分岔点换过去的那一条 */
  let line: ReplayMove[] = opts.moves;
  /** 在哪条分支上（-1 = 主线） */
  let br = -1;
  /** 主线上已经选过路的分岔点（往回退到分岔点之前，就重新问） */
  const chosen = new Set<number>();
  /** 正停在哪个分岔点上等你选 */
  let forkPending: number | null = null;
  /** 看过的路：`${at}:${分支号}` */
  const seenOpt = new Set<string>();

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
  const view = new Board2D(elBoard, {
    flip: flipped,
    onTap: (x, y) => onTap(x, y),
    // 分岔点上：点哪条箭头就走哪条路
    onArrowTap: (id) => {
      if (forkPending !== null && id.startsWith('fork:')) chooseFork(Number(id.slice(5)));
    },
  });
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
    const real = line[idx].t;
    let alt = mine !== real && (line[idx].alts ?? []).includes(mine);
    let judged = '';
    waiting = false;
    sel = null;
    view.setMarks([]);
    // 谱上收着的变招、错着：直接说它是什么
    const kn = mine !== real && !alt ? line[idx].known?.find((k) => k.t === mine) : undefined;
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
    const why = line[idx].why ? `<div class="w">${line[idx].why}</div>` : '';
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
    const step = line[idx];
    if (!step) return;
    const mv = textToMove(board, turn, step.t, legal());
    if (!mv) {
      elSay.className = 'xq-rp-say no';
      elSay.innerHTML = `<div class="h">这一手（${step.t}）走不通，谱子有问题</div>`;
      idx = line.length;
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
    const at = br >= 0 ? opts.branches![br].at : -1;
    elTrail.innerHTML = line
      .slice(0, idx)
      .map(
        (m, i) =>
          `${i === at ? `<i class="fk" title="从这里换了一条路">🔀${opts.branches![br].name}</i>` : ''}<span data-n="${i + 1}" class="${i === idx - 1 ? 'on' : ''}${at >= 0 && i >= at ? ' br' : ''}">${i % 2 === 0 ? `${i / 2 + 1}.` : ''}${m.t}</span>`,
      )
      .join(' ');
    // 讲解模式下点棋谱条上的哪一手就跳回哪一手
    if (!opts.guessFor) elTrail.querySelectorAll<HTMLElement>('[data-n]').forEach((el) => (el.onclick = () => goTo(Number(el.dataset.n))));
    // 棋谱条限高可滚：最新一手永远露在眼前
    elTrail.scrollTop = elTrail.scrollHeight;
  }

  /** 这一手是不是分岔点：主线上、讲解模式，谱上收着别的走法 */
  function forkOptions(i: number): { b: number; move: ReplayMove; name: string; kind: 'main' | ReplayBranch['kind'] }[] | null {
    if (opts.guessFor || br !== -1 || !opts.branches?.length) return null;
    const main = opts.moves[i];
    if (!main) return null;
    const list = opts.branches
      .map((b, k) => ({ b: k, br: b }))
      .filter(({ br: b }) => b.at === i && b.moves.length && b.moves[0].t !== main.t);
    if (!list.length) return null;
    return [{ b: -1, move: main, name: opts.mainLabel ?? '主线', kind: 'main' as const }, ...list.map(({ b, br: x }) => ({ b, move: x.moves[0], name: x.name, kind: x.kind }))];
  }

  /**
   * 停在分岔点：讲解框列出几条路（①②③），棋盘上每条路的第一手画一条箭头、标着同样的号——
   * 点箭头或按钮就沿那一条一步步往下走；走完回到这里看另一条。
   */
  function showFork(i: number) {
    const fk = forkOptions(i);
    if (!fk) return;
    forkPending = i;
    const legalNow = legal();
    const arrows = fk
      .map((o, n) => {
        const mv = textToMove(board, turn, o.move.t, legalNow);
        return mv ? { ...mv, color: KIND_TAG[o.kind].color, label: CIRCLED[n], id: `fork:${o.b}` } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
    view.setArrows(arrows);
    const first = (w?: string) => (w ?? '').replace(/<[^>]+>/g, '').split('。')[0];
    elSay.className = 'xq-rp-say fork';
    elSay.innerHTML = `<div class="h">🔀 第 ${Math.floor(i / 2) + 1} 回合，${turn === 'r' ? '红' : '黑'}方这一步有 ${fk.length} 条路</div>
      <div class="w">点一条（下面的按钮，或棋盘上带号的箭头），沿那一路一步步看；走完回到这里看另一条。</div>
      <div class="xq-forks">${fk
        .map(
          (o, n) =>
            `<button class="xq-fork" data-fork="${o.b}" style="--c:${KIND_TAG[o.kind].color}"><b>${CIRCLED[n]} ${o.move.t}</b><span class="tg">${KIND_TAG[o.kind].tag}</span>${
              seenOpt.has(`${i}:${o.b}`) ? '<span class="tg seen">✓ 看过</span>' : ''
            }<em>${o.b === -1 ? o.name : o.name}${first(o.move.why) ? `：${first(o.move.why)}` : ''}</em></button>`,
        )
        .join('')}</div>`;
    elSay.querySelectorAll<HTMLButtonElement>('[data-fork]').forEach((el) => (el.onclick = () => chooseFork(Number(el.dataset.fork))));
    elBar.innerHTML = `${backBtn()}<button class="xq-btn primary" id="rp-fork-main">${CIRCLED[0]} 沿${opts.mainLabel ?? '主线'}走 →</button><button class="xq-btn ghost" id="rp-out">← 返回</button>`;
    (elBar.querySelector('#rp-fork-main') as HTMLButtonElement).onclick = () => chooseFork(-1);
    (elBar.querySelector('#rp-out') as HTMLButtonElement).onclick = opts.onExit;
    wireBack();
  }

  /** 在分岔点选一条路：-1 = 主线，其它是分支号 */
  function chooseFork(b: number) {
    const i = forkPending;
    if (i === null) return;
    forkPending = null;
    chosen.add(i);
    seenOpt.add(`${i}:${b}`);
    if (b >= 0) {
      const x = opts.branches![b];
      br = b;
      line = [...opts.moves.slice(0, x.at), ...x.moves];
    }
    const step = line[idx];
    play();
    showStep(step, b >= 0 ? `${step.t}　<span class="xq-br-tag" style="--c:${KIND_TAG[opts.branches![b].kind].color}">${opts.branches![b].name}</span>` : step.t);
    renderBar();
  }

  /** 回到某个分岔点（主线上），重新选路 */
  function backToFork(at: number) {
    br = -1;
    line = opts.moves;
    goTo(at);
    showFork(at);
  }

  function next() {
    if (idx >= line.length) return finish();
    if (forkOptions(idx) && !chosen.has(idx)) return showFork(idx);
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
    const step = line[idx];
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
  const lo = () => Math.min(opts.startAt ?? 0, line.length);

  /**
   * 跳到第 n 手走完的局面（讲解模式才能退：猜着法退回去再猜就不算数了）。
   * 用户原话里没说，但看讲解时想回头再看一眼上一手是最常见的事——原来只能"再看一遍"从头来。
   */
  function goTo(n: number) {
    if (opts.guessFor) return;
    n = Math.max(lo(), Math.min(line.length, n));
    forkPending = null;
    for (const c of [...chosen]) if (c >= n) chosen.delete(c);
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
    showStep(line[n - 1]);
    renderBar();
  }

  /** 主线上还有没看过的路的分岔点 */
  function unseenForks(): { at: number; n: number }[] {
    const out: { at: number; n: number }[] = [];
    for (let i = 0; i < opts.moves.length; i++) {
      const prevBr = br;
      br = -1;
      const fk = forkOptions(i);
      br = prevBr;
      if (!fk) continue;
      const n = fk.filter((o) => !seenOpt.has(`${i}:${o.b}`)).length;
      if (n) out.push({ at: i, n });
    }
    return out;
  }

  function finish() {
    if (br >= 0) return finishBranch();
    opts.onFinish?.(right, tried);
    const left = opts.guessFor ? [] : unseenForks();
    elSay.className = 'xq-rp-say done';
    elSay.innerHTML =
      `<div class="h">走完了</div>` +
      (left.length
        ? `<div class="w xq-forks-left">🔀 这一路上还有 <b>${left.reduce((a, x) => a + x.n, 0)}</b> 条路没看：${left
            .map((x) => `<button class="xq-fork-back" data-back-fork="${x.at}">第 ${Math.floor(x.at / 2) + 1} 回合的分岔（${x.n} 条）</button>`)
            .join('')}</div>`
        : '') +
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
    if (bk) bk.onclick = () => goTo(line.length);
    (elBar.querySelector('#rp-again') as HTMLButtonElement).onclick = () => reset();
    (elBar.querySelector('#rp-out') as HTMLButtonElement).onclick = opts.onExit;
    const nx = elBar.querySelector('#rp-next-step') as HTMLButtonElement | null;
    if (nx && opts.next) nx.onclick = opts.next.run;
    elSay.querySelectorAll<HTMLButtonElement>('[data-back-fork]').forEach((el) => (el.onclick = () => backToFork(Number(el.dataset.backFork))));
  }

  /** 一条分支走完：这一路的结论，回到分岔点看另一条 */
  function finishBranch() {
    const x = opts.branches![br];
    x.onSeen?.();
    const at = x.at;
    elSay.className = 'xq-rp-say done';
    elSay.innerHTML =
      `<div class="h">这一路走完了 · <span class="xq-br-tag" style="--c:${KIND_TAG[x.kind].color}">${x.name}</span></div>` +
      (x.outro ? `<div class="w">${x.outro}</div>` : '') +
      `<div class="w">回到第 ${Math.floor(at / 2) + 1} 回合的分岔点，看看另外几条路怎么发展。</div>`;
    elBar.innerHTML =
      backBtn() +
      `<button class="xq-btn primary" id="rp-fork-back">↩ 回到分岔点</button><button class="xq-btn ghost" id="rp-out">← 返回</button>`;
    const bk = elBar.querySelector('#rp-back') as HTMLButtonElement | null;
    if (bk) bk.onclick = () => goTo(line.length);
    (elBar.querySelector('#rp-fork-back') as HTMLButtonElement).onclick = () => backToFork(at);
    (elBar.querySelector('#rp-out') as HTMLButtonElement).onclick = opts.onExit;
  }

  function reset() {
    br = -1;
    line = opts.moves;
    chosen.clear();
    forkPending = null;
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
    while (idx < Math.min(opts.startAt ?? 0, line.length)) play();
  }

  /** 讲解模式下"上一手"的小按钮（猜着法不给退） */
  const backBtn = () => (!opts.guessFor && idx > lo() ? '<button class="xq-btn xq-rp-back" id="rp-back" title="上一手" aria-label="上一手">◀</button>' : '');
  function wireBack() {
    const bk = elBar.querySelector('#rp-back') as HTMLButtonElement | null;
    if (bk) bk.onclick = () => goTo(idx - 1);
  }

  function renderBar() {
    const atEnd = idx >= line.length;
    elBar.innerHTML = waiting
      ? '<span class="xq-tr-note">在棋盘上走一手</span><button class="xq-btn ghost" id="rp-skip">想不出，直接看</button><button class="xq-btn ghost" id="rp-out">← 返回</button>'
      : `${backBtn()}<button class="xq-btn primary" id="rp-next">${atEnd ? '看总结 →' : '下一手 →'}</button><button class="xq-btn ghost" id="rp-out">← 返回</button>`;
    const sk = elBar.querySelector('#rp-skip') as HTMLButtonElement | null;
    if (sk)
      sk.onclick = () => {
        waiting = false;
        const step = line[idx];
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
      expected: () => line[idx]?.t ?? null,
      total: () => line.length,
      say: () => elSay.textContent,
      /** 正停在哪个分岔点（null = 没停） */
      fork: () => forkPending,
      /** 在分岔点选一条路（-1 = 主线） */
      choose: (b: number) => chooseFork(b),
      /** 现在在哪条分支上（-1 = 主线） */
      branch: () => br,
      next: () => next(),
    };
  }

  return () => {
    sayObs.disconnect();
    view.dispose();
    wrap.remove();
  };
}
