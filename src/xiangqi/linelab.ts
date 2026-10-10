/**
 * 推演板：一个局面、一串着法，在棋盘上一步一步走；走到哪一步都能问"这里还有哪几种走法"——
 * 引擎给出前三名，棋盘上画成 ①②③ 三条箭头，点哪条（箭头或下面的按钮）就沿哪条往下走，后续是引擎算的主变。
 *
 * 用户原话："不管是布局体系、残局走法，还是邪门布局中的变化，走着走着都可能有分支。帮我把不同的路线分出来……
 * 我希望可以按着'下一步'一步步点击去看这些变化，能实时看到棋盘上的具体变化，而不是只写'炮八平七、马二进三'这类纯文字记录。
 * 不要让我自己去脑补，那样太累、太慢了。"
 *
 * 所以凡是界面上写成一串着法的地方（题目的原谱、计划、残局的走法、复盘的最佳走法），都能点开到这里，
 * 在棋盘上走给你看；走到哪一步想看"如果他不这么走呢"，点 🔀 就分出几条路。
 * 着法和讲解都不编：着法是谱上的或者引擎算的，讲解是 movenote 按盘面说的"这一手干了什么"。
 */
import { applyMove, isInCheck, legalMoves, type Board, type Color, type Move } from './rules';
import { Board2D, type Arrow, type Mark } from './board2d';
import { lineTalk, wrongTalk } from './coachexplain';
import { inPieces } from './teach';
import type { MoveScore } from './ai';
import { lineSteps, type PunishStep } from './punish';
import { engineAnalyse, engineReady, engineScoreMove, loadEngine } from './pikafish';
import { evalWords } from './analysis';
import { moveToText, textToMove, toFen } from './notation';
import { planLine } from './plan';

export interface LabOpts {
  /** 从这个局面开始 */
  board: Board;
  turn: Color;
  /** 一开始要走的那一串（从 board 起，第一手是 turn 走的） */
  line?: Move[];
  title: string;
  /** 开场一句：这一串是什么 */
  intro?: string;
  /** 称呼里的"你"是哪一方；不给就是 turn */
  me?: Color;
  /** 黑方在下面 */
  flip?: boolean;
  /** 一打开就把引擎的前三种走法摆出来（残局推演：还没有现成的一串） */
  forkFirst?: boolean;
  onExit: () => void;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
const CIRCLED = ['①', '②', '③', '④'];
/** 三条路三种颜色：绿、蓝、橙 */
const ALT_COLOR = ['rgba(46,170,90,0.92)', 'rgba(59,130,246,0.92)', 'rgba(232,144,42,0.92)'];

export function runLineLab(host: HTMLElement, opts: LabOpts): () => void {
  const me = opts.me ?? opts.turn;
  const wrap = document.createElement('div');
  wrap.className = 'xq-lab';
  wrap.innerHTML = `
    <div class="xq-lab-head">
      <button class="xq-nav-back" data-lab-close>← 返回</button>
      <b class="t"></b>
    </div>
    <div class="xq-lab-board"></div>
    <div class="xq-lab-say" data-lab-say></div>
    <div class="xq-lab-alts" data-lab-alts></div>
    <div class="xq-lab-bar">
      <button class="xq-btn" data-lab="prev" title="上一步">◀</button>
      <button class="xq-btn primary" data-lab="next">下一步 ▶</button>
      <button class="xq-btn" data-lab="fork">🔀 几种走法</button>
    </div>
    <div class="xq-lab-trail" data-lab-trail></div>`;
  (wrap.querySelector('.t') as HTMLElement).textContent = opts.title;
  host.appendChild(wrap);

  const elSay = wrap.querySelector('[data-lab-say]') as HTMLElement;
  const elAlts = wrap.querySelector('[data-lab-alts]') as HTMLElement;
  const elTrail = wrap.querySelector('[data-lab-trail]') as HTMLElement;
  const btnNext = wrap.querySelector('[data-lab="next"]') as HTMLButtonElement;
  const btnPrev = wrap.querySelector('[data-lab="prev"]') as HTMLButtonElement;
  const btnFork = wrap.querySelector('[data-lab="fork"]') as HTMLButtonElement;

  /** 现在这一路（从开局面起的全部着法）和走到第几手 */
  let seq: Move[] = (opts.line ?? []).slice();
  let k = 0;
  /** 分过叉的地方（回到分岔点用） */
  const forks: number[] = [];
  /** 每个局面引擎给的前几名（按局面缓存，来回翻不重算） */
  const altCache = new Map<string, MoveScore[]>();
  /** 正在摆出来的那几条路 */
  let alts: MoveScore[] | null = null;
  let token = 0;
  let steps: PunishStep[] = [];

  const view = new Board2D(wrap.querySelector('.xq-lab-board') as HTMLElement, {
    flip: opts.flip ?? me === 'b',
    onTap: (x, y) => onTap(x, y),
    onArrowTap: (id) => {
      const i = Number(id.replace('alt-', ''));
      if (alts && alts[i]) choose(i);
    },
  });

  const recompute = () => {
    steps = lineSteps(opts.board, seq, opts.turn, me, 60);
    // 走不通的着法截掉（引擎主变偶尔和我们的规则对不上）
    if (steps.length < seq.length) seq = seq.slice(0, steps.length);
  };
  const boardAt = (n: number): Board => (n === 0 ? opts.board : applyMove(steps[n - 1].before, steps[n - 1].move));
  const colorAt = (n: number): Color => (n % 2 === 0 ? opts.turn : other(opts.turn));
  const who = (c: Color) => (c === me ? '你' : '对方');
  const side = (c: Color) => (c === 'r' ? '红方' : '黑方');
  const roundOf = (n: number) => Math.floor(n / 2) + 1;

  function show() {
    const b = boardAt(k);
    view.setBoard(b);
    if (k > 0) {
      const st = steps[k - 1];
      view.setLastMove(st.move, false);
      const c = colorAt(k - 1);
      elSay.innerHTML = `<div class="h"><span class="w ${c === me ? 'me' : 'foe'}">${who(c)}</span> 第 ${roundOf(k - 1)} 回合 ${side(c)} <b>${st.text}</b></div>
        <div class="n">${st.note}${st.tags.length ? `（${st.tags.join('、')}）` : ''}</div>`;
    } else {
      view.setLastMove(null);
      elSay.innerHTML = `<div class="h">${opts.intro ?? '起始局面'}</div><div class="n">轮到${side(opts.turn)}。点「下一步」一步步走${
        seq.length ? '' : '，或者点「🔀 几种走法」看引擎给的前三种走法'
      }；也可以直接点棋盘上的子，按你自己的想法走一步，皮卡鱼替对方接。</div>`;
    }
    btnPrev.disabled = k === 0;
    btnNext.textContent = k < seq.length ? '下一步 ▶' : '🔀 后面还能怎么走';
    renderTrail();
    renderAlts();
  }

  function renderTrail() {
    elTrail.innerHTML = steps
      .map((st, i) => {
        const fork = forks.includes(i) ? '<i class="fk">🔀</i>' : '';
        return `${fork}<span data-n="${i + 1}" class="${i === k - 1 ? 'on' : ''}${i >= k ? ' ahead' : ''}">${i % 2 === 0 ? `${roundOf(i)}.` : ''}${st.text}</span>`;
      })
      .join(' ');
    elTrail.querySelectorAll<HTMLElement>('[data-n]').forEach((el) => (el.onclick = () => go(Number(el.dataset.n))));
  }

  /** 在棋盘上摆出这个局面的几种走法：箭头 ①②③ + 下面一排按钮（每条写着走完谁好） */
  function renderAlts() {
    if (!alts) {
      // 按自己想法走的那一手的讲解：往后翻着看对方怎么接时一直留着，退回到这手之前才收起
      elAlts.innerHTML = ownTalk && k > ownTalk.at ? ownTalk.html : '';
      view.setArrows(k < seq.length ? [{ ...seq[k], color: 'rgba(46,170,90,0.55)' }] : []);
      return;
    }
    const b = boardAt(k);
    const c = colorAt(k);
    const red = (s: MoveScore) => (c === 'r' ? s.score : -s.score);
    const redMate = (s: MoveScore) => (s.mateIn === undefined ? undefined : c === 'r' ? s.mateIn : -s.mateIn);
    // 对"你"这一方好不好：红优黑优要换算一下才知道，直接说出来
    const forMe = (s: MoveScore) => {
      if (s.mateIn !== undefined) return (s.mateIn > 0) === (c === me) ? '（对你有利）' : '（对你不利）';
      const mine = c === me ? s.score : -s.score;
      return mine >= 60 ? '（对你有利）' : mine <= -60 ? '（对你不利）' : '（差不多）';
    };
    const arrows: Arrow[] = alts.map((s, i) => ({ ...s.move, color: ALT_COLOR[i], label: CIRCLED[i], id: `alt-${i}` }));
    view.setArrows(arrows);
    const onLine = k < seq.length ? seq[k] : null;
    elAlts.innerHTML =
      `<div class="hd">🔀 ${who(c)}（${side(c)}）这一步有 ${alts.length} 种走法——点箭头或下面的按钮，沿那一路往下走：</div>` +
      alts
        .map(
          (s, i) =>
            `<button class="xq-lab-alt" data-alt="${i}" style="--c:${ALT_COLOR[i]}"><b>${CIRCLED[i]} ${moveToText(b, s.move)}</b><em>走完：${evalWords(red(s), redMate(s))}${forMe(s)}</em>${
              onLine && same(onLine, s.move) ? '<span class="cur">现在这一路</span>' : ''
            }</button>`,
        )
        .join('');
    elAlts.querySelectorAll<HTMLButtonElement>('[data-alt]').forEach((el) => (el.onclick = () => choose(Number(el.dataset.alt))));
  }

  /** 问引擎：这个局面前三种走法 */
  async function askAlts() {
    const my = ++token;
    const b = boardAt(k);
    const c = colorAt(k);
    const key = toFen(b, c);
    const hit = altCache.get(key);
    if (hit) {
      alts = hit;
      return renderAlts();
    }
    elAlts.innerHTML = '<div class="hd">🔀 引擎正在算这一步的几种走法…</div>';
    if (!engineReady()) await loadEngine();
    if (my !== token) return;
    if (!engineReady()) {
      elAlts.innerHTML = '<div class="hd">引擎还没加载好，过一会儿再点「🔀 几种走法」。</div>';
      return;
    }
    const res = await engineAnalyse(b, c, { movetime: 1500, multipv: 3 });
    if (my !== token) return;
    const list = (res ?? []).filter((s) => !s.bound).slice(0, 3);
    if (!list.length) {
      elAlts.innerHTML = '<div class="hd">这个局面没有可走的棋了。</div>';
      return;
    }
    altCache.set(key, list);
    alts = list;
    renderAlts();
  }

  /**
   * 按你自己的想法走一步。用户原话："我如果按照我的想法走棋对方会怎么接"。
   * 点子、点落点：这一步起换成你走的这手，皮卡鱼算出对方怎么接、后面大概怎么走，接在这一路后面（点「下一步」在棋盘上走）；
   * 下面讲：这手和首选比怎么样、对方会这样接；差得多就说清楚该走什么、差多少。
   */
  let sel: { x: number; y: number } | null = null;
  let ownTalk: { at: number; html: string } | null = null;
  const legalAt = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
  function onTap(x: number, y: number) {
    const b = boardAt(k);
    const c = colorAt(k);
    const legal = legalAt(b, c);
    if (sel) {
      const mv = legal.find((m) => m.fx === sel!.x && m.fy === sel!.y && m.tx === x && m.ty === y);
      if (mv) {
        sel = null;
        view.setMarks([]);
        void playOwn(mv);
        return;
      }
    }
    const p = b[y][x];
    if (p && p.c === c) {
      sel = { x, y };
      const marks: Mark[] = [{ x, y, kind: 'ring' }];
      for (const m of legal) if (m.fx === x && m.fy === y) marks.push({ x: m.tx, y: m.ty, kind: b[m.ty][m.tx] ? 'bad' : 'dot' });
      view.setMarks(marks);
    } else {
      sel = null;
      view.setMarks([]);
    }
  }
  async function playOwn(mv: Move) {
    const b = boardAt(k);
    const c = colorAt(k);
    // 和这一路下一手一样：往下走一步，照样讲对方会怎么接（这一路后面的着法就是）
    if (k < seq.length && same(seq[k], mv)) {
      const at = k;
      ownTalk = {
        at,
        html: `<div class="hd">👍 ${moveToText(b, mv)} 就是这一路的下一手。对方会这样接（点「下一步」在棋盘上走）：</div>${lineTalk(applyMove(b, mv), seq.slice(at + 1), other(c), me, 4)}`,
      };
      return go(at + 1);
    }
    const my = ++token;
    const at = k;
    ownTalk = null;
    seq = [...seq.slice(0, at), mv];
    if (!forks.includes(at)) forks.push(at);
    recompute();
    alts = null;
    k = at + 1;
    show();
    elAlts.innerHTML = '<div class="hd">🧑‍🏫 皮卡鱼在算对方会怎么接……</div>';
    if (!engineReady()) await loadEngine();
    if (my !== token) return;
    if (!engineReady()) {
      elAlts.innerHTML = '<div class="hd">引擎还没加载好：对方这一步也由你来走（点对方的子）。</div>';
      return;
    }
    const list = await engineAnalyse(b, c, { movetime: 1200, multipv: 2, include: mv });
    if (my !== token) return;
    const best = list?.find((x) => !x.bound);
    // 你这手不在前几名里、单独补算也没回来（引擎忙、搜索被打断）：再单独算一次，不能让讲解空着
    const mine = list?.find((x) => !x.bound && same(x.move, mv)) ?? (await engineScoreMove(b, c, mv, { movetime: 1200 }));
    if (my !== token) return;
    if (!best || !mine) {
      elAlts.innerHTML = '<div class="hd">皮卡鱼这一次没算出来，点「🔀 几种走法」再问一次。</div>';
      return;
    }
    const rest = mine.pv.length > 1 && same(mine.pv[0], mv) ? mine.pv.slice(1, 10) : [];
    seq = [...seq.slice(0, at), mv, ...rest];
    recompute();
    show();
    const loss = same(best.move, mv) ? 0 : Math.max(0, best.score - mine.score);
    const html =
      loss >= 30
        ? `<div class="hd">🧑‍🏫 你走的 ${moveToText(b, mv)} 比皮卡鱼的首选差约 ${loss} 分（${inPieces(loss)}）——点「下一步」在棋盘上看对方怎么接：</div>${wrongTalk(b, c, mine, { best, me })}`
        : `<div class="hd">👍 ${moveToText(b, mv)}${same(best.move, mv) ? '就是皮卡鱼的首选' : '和皮卡鱼的首选差不多'}。对方会这样接（点「下一步」在棋盘上走）：</div>${lineTalk(applyMove(b, mv), rest, other(c), me, 4)}`;
    ownTalk = { at, html };
    elAlts.innerHTML = html;
  }

  /** 选第 i 条路：从这一步起换成它（后续是引擎这一路的主变） */
  function choose(i: number) {
    const s = alts?.[i];
    if (!s) return;
    const pv = s.pv?.length && same(s.pv[0], s.move) ? s.pv : [s.move];
    if (!(k < seq.length && same(seq[k], s.move) && seq.length - k >= pv.length)) {
      seq = [...seq.slice(0, k), ...pv];
      if (!forks.includes(k)) forks.push(k);
      recompute();
    }
    alts = null;
    token++;
    if (ownTalk && ownTalk.at >= k) ownTalk = null;
    k = Math.min(seq.length, k + 1);
    show();
  }

  function go(n: number) {
    k = Math.max(0, Math.min(seq.length, n));
    alts = null;
    token++;
    show();
  }

  btnPrev.onclick = () => go(k - 1);
  btnNext.onclick = () => (k < seq.length ? go(k + 1) : void askAlts());
  btnFork.onclick = () => (alts ? ((alts = null), token++, renderAlts()) : void askAlts());
  (wrap.querySelector('[data-lab-close]') as HTMLButtonElement).onclick = () => opts.onExit();

  recompute();
  show();
  if (opts.forkFirst) void askAlts();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqLab = {
      k: () => k,
      len: () => seq.length,
      alts: () => alts?.map((s) => s.move) ?? null,
      choose: (i: number) => choose(i),
      own: (m: Move) => playOwn(m),
      talk: () => elAlts.textContent ?? '',
      ask: () => askAlts(),
      next: () => btnNext.click(),
    };
  }

  return () => {
    token++;
    view.dispose();
    wrap.remove();
  };
}

/**
 * 弹出一块推演板盖在当前界面上（复盘、做题、求助面板里点一串着法就开这个），关掉回到原来那一屏。
 */
export function openLineLab(opts: Omit<LabOpts, 'onExit'> & { onExit?: () => void }): () => void {
  const layer = document.createElement('div');
  layer.className = 'xq-lab-layer';
  document.body.appendChild(layer);
  let dispose: () => void = () => {};
  const close = () => {
    dispose();
    layer.remove();
    opts.onExit?.();
  };
  dispose = runLineLab(layer, { ...opts, onExit: close });
  return close;
}

/** 一串中文记谱换成着法（从 board 起、turn 先走）；走不通的到此为止 */
export function movesFromTexts(board: Board, turn: Color, texts: string[]): Move[] {
  const out: Move[] = [];
  let b = board;
  let c = turn;
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) break;
    out.push(m);
    b = applyMove(b, m);
    c = other(c);
  }
  return out;
}

/**
 * 所有"📋 计划"底下的"▶ 在棋盘上一步步看"统一在这里接：求助面板、教练提醒、残局练习、复盘，
 * 写成文字的那一串都能点开在推演板上走。
 */
if (typeof document !== 'undefined') {
  document.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement | null)?.closest?.('[data-plan-lab]') as HTMLElement | null;
    if (!el) return;
    const p = planLine(el.dataset.planLab ?? '');
    if (!p) return;
    e.stopPropagation();
    openLineLab({ board: p.board, turn: p.color, line: p.moves, me: p.me, title: '计划 · 一步步看', intro: `计划：${p.goal}` });
  });
}
