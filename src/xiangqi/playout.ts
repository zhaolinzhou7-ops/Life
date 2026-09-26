/**
 * 残局实战：摆好局面，跟引擎**下到底**。
 *
 * 这是残局课和做题最大的区别。做题只要找出一步正着，残局要的是
 * 「多子必须赢下来、少子必须守和」——把优势兑现的全过程，一步走软就没了。
 * 所以这里不到分出结果不算过。
 *
 * 原来这一屏只有棋盘和几条要领，对手是自带引擎，走完一步好坏全靠自己猜。现在：
 *   - **教练一直在算**：和对局同一套研究（study.ts），随时告诉你这个局面还赢不赢、还守不守得住，
 *     算到杀就说几步杀；
 *   - **每一手都有反馈**：按这一局的目标判——把赢棋走成和棋、一步让对方有杀，当场说，可以悔棋重走；
 *   - **🔍 提示**：不只给一手棋，给出计划（接下来几步怎么走、每一步为了什么）；
 *   - **对手可以换**：你进攻时默认由专业引擎来守（最顽强的防守才练得出技术）；
 *     你防守时默认由自带引擎来攻——这一类题的"能守和"是按它校准的，换成专业引擎来攻，
 *     书上本来就是胜局的（比如车炮对士象全）就守不住了。两种都可以随时切换；
 *   - **结束有小结**：走了几手、几手是最佳、在哪儿走软的。
 *
 * 判定规则和实战一致：将死判负、60 回合无吃子判和、三次重复判和。
 */
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from './rules';
import type { MoveScore } from './ai';
import { fromFen, moveToText, toFen } from './notation';
import { Board2D, type Mark } from './board2d';
import { requestMove } from './aiclient';
import { Study } from './study';
import { engineBestMove, engineCapable, engineReady, loadEngine } from './pikafish';
import { classifyEndgame, drillVerdict, type DrillVerdict } from './endgame';
import { outlookOf, planHtml, planOf } from './plan';
import { moveAccuracy, winPct } from './analysis';

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
  /** 棋书上这一类残局的结论（只显示） */
  book?: string;
  /** 自带引擎当对手时的强度 */
  depth?: number;
  timeMs?: number;
  onDone: (r: PlayResult, moves: number) => void;
  onExit: () => void;
}

/** 60 回合无吃子判和 */
const NO_CAPTURE_LIMIT = 120;
/** 专业引擎当对手时每步想多久 */
const PRO_OPP_MS = 1000;
const OPP_KEY = 'xq-po-opp';

type Opp = 'pro' | 'local';

function savedOpp(): Opp | null {
  try {
    const v = localStorage.getItem(OPP_KEY);
    return v === 'pro' || v === 'local' ? v : null;
  } catch {
    return null;
  }
}

const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

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
  const startFen = toFen(parsed.board, parsed.toMove);
  const info = classifyEndgame(board, me);
  const iAttack = info?.attacker === me;
  // 你进攻：专业引擎来守（最顽强）；你防守：自带引擎来攻（这类题按它校准）
  let opp: Opp = savedOpp() ?? (iAttack ? 'pro' : 'local');

  let selected: { x: number; y: number } | null = null;
  let busy = false;
  let over = false;
  let sinceCapture = 0;
  let myMoves = 0;
  let seq = 0;
  /** 每悔一次棋加一：悔掉的那几手，迟到的反馈不能再显示 */
  let undoSeq = 0;
  /** 落子动画还在放 */
  let animating = false;
  let hintsUsed = 0;
  /** 整局的着法（研究要知道重复局面） */
  const moves: Move[] = [];
  const seen = new Map<string, number>();
  const history: { board: Board; turn: Color; sinceCapture: number; moves: number }[] = [];
  /** 你每一手的反馈（第几手 → 判读），小结用 */
  const marks = new Map<number, { v: DrillVerdict; acc: number; text: string }>();
  /** 上一步对手用的是哪个引擎（测试用） */
  let lastOpp: Opp | null = null;

  wrap.innerHTML = `
    <div class="xq-po-top">
      <button class="xq-btn ghost" id="xq-po-back">← 退出</button>
      <div class="xq-po-title">${opts.title}<span>${opts.subtitle}</span></div>
      <button class="xq-btn" id="xq-po-hint" title="提示：最好的一手和接下来的计划">🔍</button>
      <button class="xq-btn" id="xq-po-undo">悔棋</button>
    </div>
    <div class="xq-po-goal">${
      opts.target === 'win' ? '🎯 你必须<b>赢下来</b>' : '🛡 你只要<b>守和</b>就算过'
    }　<span class="xq-po-cnt"></span>
      <button class="xq-po-opp" title="换对手">对手：<b></b> ⇄</button></div>
    <div class="xq-po-coach">🧑‍🏫 教练在看…</div>
    <div class="xq-po-board"></div>
    <div class="xq-po-fb"></div>
    <div class="xq-po-tips"></div>
    <div class="xq-po-bar"></div>`;

  const elBoard = wrap.querySelector('.xq-po-board') as HTMLElement;
  const elTips = wrap.querySelector('.xq-po-tips') as HTMLElement;
  const elBar = wrap.querySelector('.xq-po-bar') as HTMLElement;
  const elCnt = wrap.querySelector('.xq-po-cnt') as HTMLElement;
  const elCoach = wrap.querySelector('.xq-po-coach') as HTMLElement;
  const elFb = wrap.querySelector('.xq-po-fb') as HTMLElement;
  const elOpp = wrap.querySelector('.xq-po-opp') as HTMLButtonElement;
  const elHint = wrap.querySelector('#xq-po-hint') as HTMLButtonElement;

  const view = new Board2D(elBoard, { flip: me === 'b', onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);

  // 要领：书上的结论 + 这一类的要领 + 按你手里的子给的通用要领。想不出来再看
  const book = opts.book ?? info?.book?.book;
  const tips = [...opts.tips, ...(info?.tips ?? []).filter((t) => !opts.tips.includes(t)).slice(0, 2)];
  elTips.innerHTML =
    `<button class="xq-po-tip-toggle">💡 要领（想不出来再看）</button>` +
    `<div class="xq-po-tip-list hidden">${
      book ? `<div class="xq-po-book">📘 书上：${book}</div>` : ''
    }<ul>${tips.map((t) => `<li>${t}</li>`).join('')}</ul></div>`;
  const toggle = elTips.querySelector('.xq-po-tip-toggle') as HTMLButtonElement;
  const tipList = elTips.querySelector('.xq-po-tip-list') as HTMLElement;
  toggle.onclick = () => tipList.classList.toggle('hidden');

  (wrap.querySelector('#xq-po-back') as HTMLButtonElement).onclick = () => opts.onExit();
  (wrap.querySelector('#xq-po-undo') as HTMLButtonElement).onclick = () => undo();
  elHint.onclick = () => toggleHint();

  const renderOpp = () => {
    (elOpp.querySelector('b') as HTMLElement).textContent = opp === 'pro' ? '专业引擎' : '自带引擎';
    elOpp.title =
      opp === 'pro'
        ? '现在是专业引擎（最顽强）。点一下换成自带引擎'
        : '现在是自带引擎（这组残局按它校准）。点一下换成专业引擎';
  };
  elOpp.onclick = () => {
    opp = opp === 'pro' ? 'local' : 'pro';
    try {
      localStorage.setItem(OPP_KEY, opp);
    } catch {
      /* 存不下就只在这一局生效 */
    }
    renderOpp();
    showFb(
      opp === 'pro'
        ? '对手换成专业引擎：下一步起它来走，最顽强的应对。'
        : '对手换成自带引擎：这组残局的"能赢/能守和"是按它校准的。',
      'info',
    );
  };
  renderOpp();
  if (!engineCapable()) elOpp.hidden = true;
  void loadEngine();

  const myLegal = () => legalMoves(board, me).filter((m) => !isInCheck(applyMove(board, m), me));

  function updateCount() {
    const left = Math.max(0, Math.ceil((NO_CAPTURE_LIMIT - sinceCapture) / 2));
    elCnt.textContent = `第 ${myMoves} 手 · 距判和还有 ${left} 回合`;
  }

  // ───────── 教练的研究 ─────────

  let study: Study | null = null;
  let offStudy: () => void = () => {};

  function ensureStudy(): Study | null {
    if (over || turn !== me) return null;
    if (study && study.is(board, me)) return study;
    dropStudy();
    const s = new Study(board, me, { startFen, moves: moves.slice() });
    study = s;
    offStudy = s.subscribe(() => renderCoach());
    if (document.hidden) s.pause();
    renderCoach();
    return s;
  }

  function dropStudy() {
    offStudy();
    offStudy = () => {};
    study?.stop();
    study = null;
  }

  /** 按这一局的目标说局面：要赢的看还赢不赢，要守和的看还守不守得住 */
  function verdictWord(b: MoveScore): { text: string; kind: 'good' | 'warn' | 'info' } {
    const o = outlookOf(b.score, b.mateIn);
    if (opts.target === 'win') {
      if (b.mateIn !== undefined && b.mateIn > 0) return { text: `胜势：已经算到 ${b.mateIn} 步杀`, kind: 'good' };
      if (b.score >= 700) return { text: `胜势：${o}，还没算到杀，按计划推进`, kind: 'good' };
      if (b.mateIn !== undefined && b.mateIn < 0) return { text: `危险：对方 ${-b.mateIn} 步杀`, kind: 'warn' };
      if (Math.abs(b.score) < 200) return { text: `和势：${o}，照这样下去赢不了，要找突破`, kind: 'warn' };
      return { text: o, kind: 'info' };
    }
    if (b.mateIn !== undefined && b.mateIn < 0) return { text: `危险：对方 ${-b.mateIn} 步杀，尽量拖`, kind: 'warn' };
    if (b.score <= -700) return { text: `很难守：${o}`, kind: 'warn' };
    return { text: `守得住：${o}`, kind: 'good' };
  }

  function renderCoach() {
    if (over) return;
    const s = study && study.is(board, me) ? study : null;
    if (turn !== me || !s) {
      elCoach.className = 'xq-po-coach';
      elCoach.textContent = turn === foe ? `🧑‍🏫 对手在想…（${opp === 'pro' ? '专业引擎' : '自带引擎'}）` : '🧑‍🏫 教练在看…';
      return;
    }
    const who = s.engine === 'pro' ? '专业引擎' : '自带引擎';
    const b = s.moves[0];
    if (!b) {
      elCoach.className = 'xq-po-coach';
      elCoach.textContent = `🧑‍🏫 教练在算…（${who}）`;
      return;
    }
    const w = verdictWord(b);
    elCoach.className = `xq-po-coach ${w.kind}`;
    elCoach.textContent = `🧑‍🏫 ${w.text} · 已算 ${s.depth} 层${s.done ? '' : '…'} · ${who}`;
    if (hintOpen) renderHint();
  }

  // ───────── 提示：最好的一手 + 计划 ─────────

  let hintOpen = false;
  let hintKey = '';

  function toggleHint() {
    if (over || turn !== me) return;
    hintOpen = !hintOpen;
    elHint.textContent = hintOpen ? '✕' : '🔍';
    if (hintOpen) {
      hintsUsed++;
      ensureStudy();
      hintKey = '';
      renderHint();
    } else closeHint();
  }

  function closeHint() {
    hintOpen = false;
    elHint.textContent = '🔍';
    view.setArrows([]);
    if (elFb.dataset.kind === 'hint') showFb('', 'info');
  }

  function renderHint() {
    const s = study;
    const b = s?.moves[0];
    if (!s || !b || b.bound) {
      showFb('教练还在算，马上就好…', 'hint');
      return;
    }
    const k = `${s.fen}|${b.pv.map((m) => `${m.fx}${m.fy}${m.tx}${m.ty}`).join(' ')}|${b.score}|${b.mateIn}`;
    if (k === hintKey) return;
    hintKey = k;
    view.setArrows([{ ...b.move, color: 'rgba(62,196,109,0.95)' }]);
    const p = planOf(board, me, b);
    showFb(
      `最好的一手是 <b>${moveToText(board, b.move)}</b>${s.done ? '' : `（已算 ${s.depth} 层，还在往深算）`}${planHtml(p)}`,
      'hint',
    );
  }

  // ───────── 反馈条 ─────────

  function showFb(html: string, kind: 'good' | 'bad' | 'info' | 'hint', actions = '') {
    elFb.dataset.kind = kind;
    elFb.className = `xq-po-fb ${kind}${html ? ' on' : ''}`;
    elFb.innerHTML = html ? `<div class="t">${html}</div>${actions}` : '';
  }

  elFb.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'undo') undo();
    else if (act === 'show') {
      const box = elFb.querySelector('.more') as HTMLElement | null;
      box?.classList.toggle('hidden');
    }
  });

  /**
   * 你这一手走得怎么样。走之前那一份研究里有它的分数就直接用；
   * 只有上限（不在前五名）就单独精确算一下——残局里"赢不赢"差一步都不行。
   */
  async function judgeMine(s: Study, before: Board, m: Move, ply: number, token: number) {
    const best = s.moves[0];
    if (!best || best.bound) return;
    let played = s.moves.find((x) => same(x.move, m));
    if (!played || played.bound) played = (await s.refine(m)) ?? undefined;
    if (!played || token !== undoSeq || over) return;
    const isBest = same(best.move, m);
    const v = drillVerdict(opts.target, best, played, isBest);
    const acc = moveAccuracy(winPct(best.score, best.mateIn), winPct(played.score, played.mateIn));
    const text = moveToText(before, m);
    marks.set(ply, { v, acc, text });
    if (hintOpen) closeHint();
    if (v.bad) {
      const p = planOf(before, me, best);
      showFb(
        `❌ ${text}：${v.text}`,
        'bad',
        `<div class="acts"><button class="xq-btn primary" data-act="undo">悔棋重走</button>
          <button class="xq-btn" data-act="show">看正确下法</button></div>
          <div class="more hidden">正确的是 <b>${moveToText(before, best.move)}</b>${planHtml(p)}</div>`,
      );
    } else {
      showFb(`${v.kind === 'best' ? '✅' : v.kind === 'slow' ? '⚠️' : '👌'} ${text}：${v.text}`, v.kind === 'slow' ? 'info' : 'good');
    }
  }

  // ───────── 走子 ─────────

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
    const mine = turn === me;
    const s = mine ? study : null;
    const before = board;
    const ply = moves.length;
    busy = true;
    selected = null;
    view.setMarks([]);
    if (mine) {
      closeHint();
      dropStudy();
      showFb('', 'info');
    }
    history.push({ board, turn, sinceCapture, moves: moves.length });
    const cap = !!board[mv.ty][mv.tx];
    const after = applyMove(board, mv);
    board = after;
    moves.push(mv);
    turn = turn === 'r' ? 'b' : 'r';
    sinceCapture = cap ? 0 : sinceCapture + 1;
    if (turn === foe) myMoves++;
    updateCount();
    // 反馈和对手思考同时进行
    if (s && s.moves.length) void judgeMine(s, before, mv, ply, undoSeq);
    animating = true;
    view.animateMove(mv, after, () => {
      animating = false;
      busy = false;
      step();
    });
  }

  async function pickOpp(my: number): Promise<Move | null> {
    if (opp === 'pro' && engineReady()) {
      const m = await engineBestMove(board, foe, PRO_OPP_MS, { startFen, moves: moves.slice() });
      if (my !== seq) return null;
      if (m) {
        lastOpp = 'pro';
        return m;
      }
    }
    lastOpp = 'local';
    return requestMove(board, foe, { maxDepth: opts.depth ?? 10, jitter: 0, timeMs: opts.timeMs ?? 900 });
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
      renderCoach();
      void pickOpp(my).then((m) => {
        if (over || my !== seq) return;
        busy = false;
        if (!m) return finish('win');
        play(m);
      });
    } else {
      ensureStudy();
    }
  }

  function undo() {
    if (over || animating) return;
    if (busy && turn === me) return;
    // 退回到上一次轮到我的时候
    let back = false;
    while (history.length) {
      const h = history.pop()!;
      const key = toFen(board, turn);
      seen.set(key, Math.max(0, (seen.get(key) ?? 1) - 1));
      board = h.board;
      turn = h.turn;
      sinceCapture = h.sinceCapture;
      moves.length = h.moves;
      back = true;
      if (turn === me) break;
    }
    if (!back) return;
    busy = false;
    seq++;
    undoSeq++;
    for (const k of [...marks.keys()]) if (k >= moves.length) marks.delete(k);
    selected = null;
    myMoves = Math.max(0, myMoves - 1);
    view.setMarks([]);
    view.setArrows([]);
    view.setBoard(board);
    updateCount();
    showFb('悔了一步。想一想刚才哪里不对，再走。', 'info');
    dropStudy();
    ensureStudy();
  }

  /** 小结：几手最佳、在哪儿走软 */
  function summary(): string {
    const list = [...marks.entries()].sort((a, b) => a[0] - b[0]).map(([, x]) => x);
    if (!list.length) return '';
    const best = list.filter((x) => x.v.kind === 'best').length;
    const bad = list.filter((x) => x.v.bad);
    const slow = list.filter((x) => x.v.kind === 'slow');
    const acc = Math.round(list.reduce((a, x) => a + x.acc, 0) / list.length);
    const parts = [`教练看了你 ${list.length} 手：${best} 手和引擎首选一样，准确率 ${acc} 分`];
    if (bad.length) parts.push(`${bad.map((x) => x.text).join('、')} 让结果变了`);
    if (slow.length) parts.push(`${slow.length} 手走软`);
    if (hintsUsed) parts.push(`用了 ${hintsUsed} 次提示`);
    return parts.join('；') + '。';
  }

  function finish(r: PlayResult, reason = '') {
    over = true;
    dropStudy();
    closeHint();
    elCoach.className = 'xq-po-coach';
    elCoach.textContent = '🧑‍🏫 这一局结束了';
    const pass = r === 'win' || (r === 'draw' && opts.target === 'draw');
    const label =
      r === 'win' ? '赢了' : r === 'loss' ? '输了' : opts.target === 'draw' ? '守和成功' : '走成和棋了';
    const sum = summary();
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
        ${sum ? `<span class="xq-po-sum">${sum}</span>` : ''}
      </div>
      <div class="xq-po-btns">
        <button class="xq-btn primary" id="xq-po-again">再来一次</button>
        <button class="xq-btn" id="xq-po-next">${pass ? '下一个 →' : '换一个'}</button>
      </div>`;
    (elBar.querySelector('#xq-po-again') as HTMLButtonElement).onclick = () => opts.onDone(r, myMoves);
    (elBar.querySelector('#xq-po-next') as HTMLButtonElement).onclick = () => opts.onExit();
  }

  /** 切到后台：研究暂停，回来接着算 */
  const onVisibility = () => {
    if (document.hidden) study?.pause();
    else study?.resume();
  };
  document.addEventListener('visibilitychange', onVisibility);

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
      /** 走指定的一手 */
      play: (m: Move) => {
        if (turn !== me || busy || over || !myLegal().some((x) => same(x, m))) return false;
        play(m);
        return true;
      },
      legal: () => myLegal(),
      board: () => board,
      state: () => ({ over, turn, myMoves, sinceCapture, busy }),
      study: () =>
        study && study.is(board, me)
          ? { depth: study.depth, done: study.done, engine: study.engine, best: study.moves[0]?.move ?? null, score: study.moves[0]?.score ?? 0, mateIn: study.moves[0]?.mateIn }
          : null,
      coach: () => elCoach.textContent,
      feedback: () => elFb.textContent,
      opp: () => ({ setting: opp, last: lastOpp }),
      hint: () => toggleHint(),
    };
  }

  // 如果开局就轮到对方，先让引擎走；否则教练开始算
  if (turn === foe) step();
  else ensureStudy();

  return () => {
    over = true;
    seq++;
    dropStudy();
    document.removeEventListener('visibilitychange', onVisibility);
    view.dispose();
    wrap.remove();
  };
}
