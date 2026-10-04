/**
 * 复盘界面：下完一盘，把每一手的好坏摊开来看，并且给每一手、每一方打分。
 *
 * 教学重点不是分数本身，是让你看见**惩罚**：走到出错那手时，棋盘直接摆出
 * 对方的反驳着法，并把该走的正确一手标在盘上。分数的作用是**排优先级**——
 * 六十手棋，先看哪几手；以及**跟自己比**——这盘比上几盘有没有进步。
 *
 * 分析本身在 gamescore.ts：一盘下完就在后台开算，这里只负责展示。
 */
import type { Board, Color, Move } from './rules';
import {
  LABEL_ORDER,
  MOVE_LABEL,
  PHASE_NAME,
  evalWords,
  labelOf,
  type Judged,
  type Phase,
  type ReviewedMove,
} from './analysis';
import { GameAnalysis } from './gamescore';
import { runChat, type ChatContext } from './chat';
import { deepFacts } from './deepcoach';
import { explain } from './llm';
import { mdToHtml } from './livecoach';
import type { BoardView } from './boardview';
import { moveToText as textOf } from './notation';
import { recentGameAccuracy } from './save';
import { planHtml, planOf } from './plan';
import { classifyEndgame } from './endgame';
import { trickAt, trickStageAt } from './tricks';
import { identify } from './explorer';
import { runPuzzle } from './train';
import { toFen } from './notation';
import { applyMove, initialBoard } from './rules';
import type { Puzzle } from './puzzles';
import { inPieces } from './teach';
import { punishLine, type Punish } from './punish';

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

export interface ReviewOpts {
  host: HTMLElement;
  scene: BoardView;
  startBoard: Board;
  startColor: Color;
  moves: Move[];
  /** 你执哪一方，用来在文案里称"你" */
  playerColor: Color;
  /** 这一局你赢了没有；用来记进对局统计 */
  playerWon?: boolean;
  /** 这一局在存档里的 id。算完之后把结论回填过去 */
  archiveId?: string;
  /** 对局里教练已经算过的判读（第几手 → 当时的研究结果） */
  known?: Map<number, Judged>;
  /** 教练拦过、你坚持走了的那几手（第几手 → 教练当时的话） */
  coachFlags?: Map<number, string>;
  /** 已经在后台算着的分析（刚下完的棋）。没有就在这里开一个 */
  analysis?: GameAnalysis | null;
  /** 要不要记进战绩（刚下完的棋记，从存档翻出来的不记） */
  record?: boolean;
  /** 从某一手之前的局面接着下（试试正确的走法）。不给就不显示这个按钮 */
  onReplayFrom?: (board: Board, toMove: Color) => void;
  /** 去"我的专属课"练这盘存下来的错着。不给就不显示按钮 */
  onTrainOwn?: () => void;
  /** 棋谱文字的抬头，如"2026-09-25 · 你执红 · 负 · 中级" */
  title?: string;
  onClose: () => void;
}

export function runReview(opts: ReviewOpts): () => void {
  const { host, scene, startColor, moves, playerColor, playerWon, onClose } = opts;
  const coachFlags = opts.coachFlags ?? new Map<number, string>();
  const foe: Color = playerColor === 'r' ? 'b' : 'r';

  let analysis =
    opts.analysis ??
    new GameAnalysis({
      startBoard: opts.startBoard,
      startColor,
      moves,
      playerColor,
      playerWon,
      archiveId: opts.archiveId,
      known: opts.known,
      record: opts.record ?? false,
    });
  /** 这份分析是不是这里开的：是的话关掉复盘时要一起停；刚下完的棋那份归对局管 */
  let ownAnalysis = !opts.analysis;
  const boards = analysis.boards;
  let cursor = -1; // -1 = 初始局面
  let jumped = false;

  const panel = document.createElement('div');
  panel.className = 'xq-rv';
  panel.innerHTML = `
    <div class="xq-rv-head">
      <button class="xq-rv-close" data-nav-back title="回到上一屏">← 返回</button>
      <b>复盘</b>
      <span class="xq-rv-pos">开局</span>
      <button class="xq-rv-hbtn xq-rv-ov" data-act="overview" title="回到整盘总结">📊 总览</button>
      <span class="xq-rv-progress">分析中 0/${moves.length}</span>
      <button class="xq-rv-hbtn" data-act="copy" title="复制棋谱">📋</button>
      <button class="xq-rv-ask" title="问教练">🧑‍🏫 问</button>
      <button class="xq-rv-fold" title="展开讲解（棋盘跟着缩小，但一直完整露出来）">▴</button>
    </div>
    <div class="xq-rv-body">
      <div class="xq-rv-score">
        <div class="xq-rv-side me"><span>你</span><b>—</b><em>准确率</em></div>
        <canvas class="xq-rv-graph"></canvas>
        <div class="xq-rv-side foe"><span>对手</span><b>—</b><em>准确率</em></div>
      </div>
      <div class="xq-rv-summary"></div>
      <div class="xq-rv-detail"></div>
      <div class="xq-rv-list"></div>
    </div>
    <div class="xq-rv-nav">
      <button class="xq-btn" data-go="-1">◀ 上一手</button>
      <button class="xq-btn warn" data-act="next-bad" title="跳到你下一个走得有问题的地方">⚠ 下个问题手</button>
      <button class="xq-btn" data-go="1">下一手 ▶</button>
    </div>`;
  host.appendChild(panel);

  const elProgress = panel.querySelector('.xq-rv-progress') as HTMLElement;
  const elSummary = panel.querySelector('.xq-rv-summary') as HTMLElement;
  const elList = panel.querySelector('.xq-rv-list') as HTMLElement;
  const elDetail = panel.querySelector('.xq-rv-detail') as HTMLElement;
  const elPos = panel.querySelector('.xq-rv-pos') as HTMLElement;
  const elMeAcc = panel.querySelector('.xq-rv-side.me b') as HTMLElement;
  const elFoeAcc = panel.querySelector('.xq-rv-side.foe b') as HTMLElement;
  const graph = panel.querySelector('.xq-rv-graph') as HTMLCanvasElement;

  const sideName = (c: Color) => (c === playerColor ? '你' : '对手');
  const reviewed = () => analysis.reviewed;
  const roundOf = (ply: number) => Math.floor((ply + (startColor === 'b' ? 1 : 0)) / 2) + 1;

  // ───────── 优势曲线 ─────────
  /**
   * 红方胜率随着一手一手怎么变。中线是五五开，线往上是红好、往下是黑好。
   * 你走坏的那几手在线上标成红点，走得好的（妙手/唯一着）标成青点；点曲线任何地方跳到那一手。
   * 一盘棋的起伏一眼就看完了——哪里开始落后、哪里被翻盘，不用一手一手翻。
   */
  function drawGraph() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = graph.clientWidth;
    const h = graph.clientHeight;
    if (w < 10 || h < 10) return;
    graph.width = Math.round(w * dpr);
    graph.height = Math.round(h * dpr);
    const g = graph.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const list = reviewed();
    const n = Math.max(moves.length, 1);
    const xOf = (i: number) => ((i + 1) / n) * (w - 4) + 2;
    const yOf = (redWin: number) => h - 2 - (redWin / 100) * (h - 4);
    // 中线
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    if (!list.length) return;
    // 红方占优的部分填红、黑方占优的填蓝灰
    const pts = [{ x: 2, y: yOf(50) }, ...list.map((m, i) => ({ x: xOf(i), y: yOf(m.redWin) }))];
    for (const [fill, clipTop] of [
      ['rgba(224,67,58,0.28)', true],
      ['rgba(120,150,190,0.28)', false],
    ] as const) {
      g.save();
      g.beginPath();
      if (clipTop) g.rect(0, 0, w, h / 2);
      else g.rect(0, h / 2, w, h / 2);
      g.clip();
      g.beginPath();
      g.moveTo(pts[0].x, h / 2);
      for (const p of pts) g.lineTo(p.x, p.y);
      g.lineTo(pts[pts.length - 1].x, h / 2);
      g.closePath();
      g.fillStyle = fill;
      g.fill();
      g.restore();
    }
    g.strokeStyle = 'rgba(240,230,210,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y)));
    g.stroke();
    // 值得注意的那几手
    list.forEach((m, i) => {
      const lb = labelOf(m);
      const bad = lb === 'dubious' || lb === 'mistake' || lb === 'blunder';
      const good = lb === 'brilliant' || lb === 'only';
      if (!bad && !good) return;
      if (m.color !== playerColor && !good && lb !== 'blunder') return;
      g.fillStyle = MOVE_LABEL[lb].color;
      g.beginPath();
      g.arc(xOf(i), yOf(m.redWin), m.color === playerColor ? 3.2 : 2.4, 0, Math.PI * 2);
      g.fill();
    });
    // 当前这一手
    if (cursor >= 0) {
      g.strokeStyle = 'rgba(255,215,110,0.9)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xOf(cursor), 0);
      g.lineTo(xOf(cursor), h);
      g.stroke();
    }
  }
  graph.addEventListener('click', (e) => {
    const r = graph.getBoundingClientRect();
    const n = Math.max(moves.length, 1);
    const i = Math.round(((e.clientX - r.left - 2) / (r.width - 4)) * n) - 1;
    if (reviewed().length) goto(Math.max(0, Math.min(reviewed().length - 1, i)));
  });
  const onResize = () => drawGraph();
  window.addEventListener('resize', onResize);

  // ───────── 单手详情 ─────────
  /** 把棋盘摆到第 i 手走完的样子；并把该走的正确着法标出来 */
  function goto(i: number) {
    stopDemo();
    const list = reviewed();
    cursor = Math.max(-1, Math.min(list.length - 1, i));
    scene.syncBoard(boards[cursor + 1]);
    drawGraph();

    // 总览（开局）时看整盘总结；看某一手时把总结收起来，这一手的讲解直接露在最上面，不用往下翻
    panel.classList.toggle('focus', cursor >= 0);
    const body = panel.querySelector('.xq-rv-body') as HTMLElement | null;
    if (body) body.scrollTop = 0;
    if (cursor < 0) {
      scene.setLastMove(null);
      scene.setBadge(null);
      elPos.textContent = '总览';
      elDetail.innerHTML = '<div class="xq-rv-empty">点「下一手」一手一手看，或者点「⚠ 下个问题手」直接跳到你走得有问题的地方。在棋盘上左右滑也能翻。</div>';
      scene.select(null);
      renderList();
      return;
    }

    const m = list[cursor];
    elPos.textContent = `第 ${roundOf(m.ply)} 回合 · ${sideName(m.color)}`;
    const lb = labelOf(m);
    const L = MOVE_LABEL[lb];
    // 这一手标在盘上：走的路线 + 棋子右上角的评级（★ 优 良 中 差 错 漏）
    scene.setLastMove(m.move, false);
    scene.setBadge({ x: m.move.tx, y: m.move.ty, text: L.short, color: L.badge });

    // 走得不好就把「该走的那一手」标在盘上：起点选中、终点画成可走点
    const bm = m.grade === 'best' || m.grade === 'good' ? null : m.bestMove;
    if (bm) {
      const before = boards[cursor];
      scene.select({ x: bm.fx, y: bm.fy }, [{ x: bm.tx, y: bm.ty, capture: !!before[bm.ty][bm.tx] }]);
    } else scene.select(null);

    // 走之前 → 走之后，红方视角
    const toRed = (s: number) => (m.color === 'r' ? s : -s);
    const mateRed = (x?: number) => (x === undefined ? undefined : m.color === 'r' ? x : -x);
    const before = evalWords(toRed(m.bestScore), mateRed(m.bestMate));
    const after = evalWords(toRed(m.playedScore), mateRed(m.playedMate));

    elDetail.innerHTML = `
      <div class="xq-rv-move" style="--g:${L.color}">
        <span class="xq-rv-grade">${L.sym ? `${L.sym} ` : ''}${L.name}</span>
        <b>${m.text}</b>
        ${punishOf(m, cursor) ? `<button class="xq-rv-pun" data-act="punish-demo">▶ ${m.color === playerColor ? '演示对手怎么罚' : '演示怎么罚他'}</button>` : ''}
        <span class="xq-rv-acc" title="这一手的准确率">${m.accuracy} 分</span>
      </div>
      <div class="xq-rv-eval">局面：${before === after ? before : `${before} → ${after}`}</div>
      <div class="xq-rv-comment">${badgeWhy(m)}${m.comment}</div>
      ${punishBlock(m, cursor)}
      ${coachFlags.has(m.ply) ? `<div class="xq-rv-flag">🧑‍🏫 对局时教练拦过这一手，你选择了"就这么走"。教练当时说：${esc(coachFlags.get(m.ply)!)}</div>` : ''}
      ${trickNote(m, cursor)}
      ${planBlock(m, boards[cursor])}
      ${endgameNote(m, boards[cursor])}
      <div class="xq-rv-actions">
        <button class="xq-rv-deep" data-deep="${cursor}">🔍 从全局讲讲这一手</button>
        ${opts.onReplayFrom ? `<button class="xq-rv-deep" data-replay="${cursor}">♟ 从这里重下</button>` : ''}
      </div>
      <div class="xq-rv-deepbox"></div>`;
    renderList();
  }

  /** 这一手走得不好（不佳、失误、漏着）：对手接下来具体怎么罚 */
  function punishOf(m: ReviewedMove, i: number): Punish | null {
    const lb = labelOf(m);
    if (lb !== 'dubious' && lb !== 'mistake' && lb !== 'blunder') return null;
    const mine = m.color === playerColor;
    return punishLine(boards[i], m.playedLine ?? [m.move], m.color, 9, mine ? { me: '你', foe: '对手' } : { me: '对方', foe: '你' });
  }

  /**
   * 劣势推演。用户原话："当我走得不对时，不能只是笼统地说当前没问题、后面会怎么样，
   * 而是要告诉我对手接下来会怎么应对、具体怎么走会导致我陷入劣势。"
   * 一手一手列出来，最后一句结论；▶ 在棋盘上演示一遍。对手走软的那一手反过来讲：你本可以怎么罚他。
   */
  function punishBlock(m: ReviewedMove, i: number): string {
    const p = punishOf(m, i);
    if (!p) return '';
    const mine = m.color === playerColor;
    const who = (w: 'me' | 'foe') => ((w === 'me') === mine ? '你' : '对手');
    const rows = p.steps
      .map(
        (st, k) =>
          `<li class="${(st.who === 'me') === mine ? 'me' : 'foe'}${k === 0 ? ' first' : ''}"><span class="w">${k === 0 ? (mine ? '你走错' : '他走软') : who(st.who)}</span><b>${st.text}</b><em>${st.note}</em></li>`,
      )
      .join('');
    return `<div class="xq-rv-punish${mine ? '' : ' foe'}" data-punish>
      <div class="hd">${mine ? '⚠️ 走了这步，对手会这样罚你' : '💡 对手这步走软了，你可以这样罚他'}</div>
      <ol>${rows}</ol>
      <div class="sum">${p.summary}</div>
      <button class="xq-rv-deep" data-act="punish-demo">▶ 在棋盘上一步步演示</button>
    </div>`;
  }

  /**
   * 计划：走得不好讲"正确的思路"，走得好讲"你的思路"——不只是一串着法，
   * 而是每一步在干什么、走完局面变成什么样。原来这里只列"正确下法"的记谱，看了也不知道为什么。
   */
  function planBlock(m: ReviewedMove, before: Board): string {
    const src = m.bestMove
      ? { move: m.bestMove, score: m.bestScore, mateIn: m.bestMate, pv: m.bestLine ?? [m.bestMove] }
      : { move: m.move, score: m.playedScore, mateIn: m.playedMate, pv: m.playedLine ?? [m.move] };
    const p = planOf(before, m.color, src, 7);
    const head = m.bestMove ? `正确下法 <b>${m.bestText}</b>` : '这一手的思路';
    return `<div class="xq-rv-pv"><span class="hd">${head}</span>${planHtml(p)}</div>`;
  }

  /**
   * 邪门布局：这一手是不是江湖套路里的那一步邪门棋；是对方刚走了邪门棋的话，你这一手是破了还是上当了。
   */
  function trickNote(m: ReviewedMove, i: number): string {
    const after = boards[i + 1];
    const played = trickAt(after, m.color === 'r' ? 'b' : 'r');
    if (played) return `<div class="xq-rv-trick">🗡 邪门布局「${played.name}」：${played.lure}</div>`;
    const stage = trickStageAt(boards[i], m.color);
    if (stage) {
      const k = stage.trapAfter ?? 0;
      const good = [stage.refute[k].t, ...(stage.refute[k].alts ?? [])].includes(m.text);
      if (good) return `<div class="xq-rv-trick good">✅「${stage.name}」第二关也过了：${stage.refute[k].why}</div>`;
      if (m.text === stage.trap[0].t) {
        return `<div class="xq-rv-trick bad">⚠️ 吃了子却在第二关上当：「${stage.name}」。${stage.principle}这一步该走 <b>${stage.refute[k].t}</b>。</div>`;
      }
      return `<div class="xq-rv-trick">🗡「${stage.name}」第二关：他在捉你吃过去的子，这一步的破解是 <b>${stage.refute[k].t}</b>——${stage.refute[k].why}</div>`;
    }
    const faced = trickAt(boards[i], m.color);
    if (!faced) return '';
    const ok = [faced.refute[0].t, ...(faced.refute[0].alts ?? [])].includes(m.text);
    if (ok) return `<div class="xq-rv-trick good">✅ 破解成功：对方走的是「${faced.name}」，${faced.refute[0].why}</div>`;
    // 陷阱在第二关的套路，trap[0] 是第二关的着法，不能拿来比这一步
    if (!faced.trapAfter && m.text === faced.trap[0].t) {
      return `<div class="xq-rv-trick bad">⚠️ 上当了：对方走的是「${faced.name}」。${faced.principle}破解是 <b>${faced.refute[0].t}</b>。</div>`;
    }
    return `<div class="xq-rv-trick">🗡 对方刚走了邪门布局「${faced.name}」，破解是 <b>${faced.refute[0].t}</b>——${faced.refute[0].why}</div>`;
  }

  /** 残局里的一手：这是什么残局、书上怎么说 */
  function endgameNote(m: ReviewedMove, before: Board): string {
    if (m.phase !== 'endgame') return '';
    const info = classifyEndgame(before, m.color);
    if (!info) return '';
    const book = info.book ? `书上：${info.book.book}。` : '';
    return `<div class="xq-rv-eg">🏁 残局「${info.name}」。${book}${info.tips[0]}。</div>`;
  }

  /** 妙手、唯一着单独说一句为什么这么叫——光给个称号，人不知道好在哪 */
  function badgeWhy(m: ReviewedMove): string {
    if (m.badge === 'brilliant') return '<b>妙手：</b>这一手看起来会丢子，但引擎认为这是最好的走法——值得记住这个思路。';
    if (m.badge === 'only') return '<b>唯一着：</b>其它走法都差出两个兵以上，这一步走不对局面就崩了。';
    return '';
  }

  function renderList() {
    const list = reviewed();
    elList.innerHTML = list
      .map((m, i) => {
        const lb = labelOf(m);
        const L = MOVE_LABEL[lb];
        const loud = lb === 'brilliant' || lb === 'only' || lb === 'dubious' || lb === 'mistake' || lb === 'blunder';
        const bad = lb === 'dubious' || lb === 'mistake' || lb === 'blunder';
        const turn = analysis.report && analysis.report.turning === i;
        return `<button class="xq-rv-item${i === cursor ? ' on' : ''}${bad ? ' bad' : ''}${turn ? ' turn' : ''}"
          data-i="${i}" style="--g:${L.color}">
          <span class="n">${roundOf(m.ply)}${m.color === 'r' ? '.' : '…'}</span>
          <span class="t">${m.text}</span>
          ${L.sym ? `<span class="s">${L.sym}</span>` : ''}
          ${coachFlags.has(m.ply) ? '<span class="f" title="教练拦过">🧑‍🏫</span>' : ''}
          ${loud ? `<span class="g">${L.name}</span>` : ''}
        </button>`;
      })
      .join('');
    const on = elList.querySelector('.xq-rv-item.on') as HTMLElement | null;
    on?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // ───────── 总评 ─────────
  /** 你走错、而且有更好着法的那几手（亏一个兵以上的） */
  function retryItems(): { i: number; m: ReturnType<typeof reviewed>[number] }[] {
    return reviewed()
      .map((m, i) => ({ i, m }))
      .filter(({ m }) => m.color === playerColor && m.bestText && m.bestMove && m.loss >= 100 && ['dubious', 'mistake', 'blunder'].includes(labelOf(m)));
  }

  /**
   * 找回好棋：把你走错的那几手当题，一手一手重新想——先自己找，找不到再看答案。
   * 参考 lichess 的 "Learn from your mistakes"：不直接告诉你该走什么，先给你一次自己想明白的机会。
   * 和引擎首选差不到 0.8 个兵的走法也算找回来了（做题界面本来就这么判）。
   */
  function runRetry() {
    const items = retryItems();
    if (!items.length) return;
    const layer = document.createElement('div');
    layer.className = 'xq-retry';
    // 做题界面自带顶栏（"找回好棋 1/3"、← 退出），这里不再叠一层；题目放进和学棋做题一样的舞台里，棋盘才撑得开
    layer.innerHTML = `<div class="xq-retry-host"></div>`;
    document.body.appendChild(layer);
    const hostEl = layer.querySelector('.xq-retry-host') as HTMLElement;
    let k = 0;
    let found = 0;
    let dispose: (() => void) | null = null;
    const done = () => {
      dispose?.();
      layer.remove();
    };
    const next = () => {
      dispose?.();
      dispose = null;
      hostEl.innerHTML = '';
      if (k >= items.length) {
        hostEl.innerHTML = `<div class="xq-retry-end"><h2>找回了 ${found}/${items.length} 手</h2>
          <p>${found === items.length ? '都找回来了——下次实战里早一步想到就好。' : '没找回来的那几手，复盘里点开看看它为什么好；错题本里也存着，过几天会回来找你。'}</p>
          <button class="xq-btn primary" data-retry-back>回到复盘</button></div>`;
        (hostEl.querySelector('[data-retry-back]') as HTMLButtonElement).onclick = done;
        return;
      }
      const { i, m } = items[k];
      const p: Puzzle = {
        id: `retry-${opts.archiveId ?? 'game'}-${i}`,
        kind: m.dim ?? 'tactic',
        fen: toFen(boards[i], m.color),
        answer: m.bestText!,
        line: m.bestPv?.length ? m.bestPv.slice(0, 1) : [m.bestText!],
        rating: 1200,
        prompt: `找一手比 ${m.text} 更好的`,
      };
      const stage = document.createElement('div');
      stage.className = 'xq-coach-stage';
      hostEl.appendChild(stage);
      dispose = runPuzzle(stage, p, {
        caption: `找回好棋 ${k + 1}/${items.length}`,
        lead: `第 ${roundOf(m.ply)} 回合你走了 <b>${m.text}</b>，亏了约${inPieces(m.loss)}。先自己想一手更好的，想不出来再点提示。`,
        playToEnd: false,
        onExit: done,
        onDone: (r) => {
          if (r.correct && !r.usedHint) found++;
          k++;
          next();
        },
      });
    };
    next();
  }

  function renderSummary() {
    const rep = analysis.report;
    if (!rep) {
      elSummary.innerHTML = '';
      return;
    }
    const me = rep.stats[playerColor];
    const them = rep.stats[foe];
    elMeAcc.textContent = String(me.accuracy);
    elFoeAcc.textContent = String(them.accuracy);
    const wi = rep.worst[playerColor];
    const w = wi >= 0 ? rep.moves[wi] : null;
    // "决定胜负的一手"只在真有一手亏得很重时才说：一盘双方都没大错的棋硬挑出一手来，是胡说
    const t = rep.turning >= 0 && rep.turning !== wi && rep.moves[rep.turning].loss >= 200 ? rep.moves[rep.turning] : null;

    // 各种称号各几手（只列有的）
    const chips = LABEL_ORDER.filter((l) => rep.counts[playerColor][l] > 0)
      .map((l) => {
        const L = MOVE_LABEL[l];
        return `<span class="xq-rv-chip" style="--g:${L.color}">${L.sym ? `<i>${L.sym}</i>` : ''}${L.name} <b>${rep.counts[playerColor][l]}</b></span>`;
      })
      .join('');
    // 分阶段：分丢在哪个阶段，比一个总分有用
    const phases = (['opening', 'middle', 'endgame'] as Phase[])
      .filter((p) => rep.phaseAcc[playerColor][p] !== undefined)
      .map((p) => `${PHASE_NAME[p]} <b>${rep.phaseAcc[playerColor][p]}</b>`)
      .join(' · ');
    // 跟自己比
    const hist = recentGameAccuracy(5);
    const cmp = hist
      ? me.accuracy >= hist.avg
        ? `比你最近 ${hist.games} 盘的平均（${hist.avg}）<b class="up">高 ${me.accuracy - hist.avg}</b>`
        : `比你最近 ${hist.games} 盘的平均（${hist.avg}）<b class="down">低 ${hist.avg - me.accuracy}</b>`
      : '';

    // 布局：象棋巫师那样叫得出名字，再说前几手在谱上（标准开局起的棋才认）
    const fromInitial = startColor === 'r' && toFen(opts.startBoard, 'r') === toFen(initialBoard(), 'r');
    const op = fromInitial ? identify(moves) : null;
    const opLine = op
      ? `<div class="xq-rv-opening" data-opening>📖 布局：<b>${op.name}</b>${
          op.bookPly ? (op.bookPly >= moves.length ? '，整盘都在谱上' : `，前 ${op.bookPly} 手在谱上，第 ${op.bookPly + 1} 手出谱`) : '（谱上没有这一路）'
        }</div>`
      : '';
    // 找回好棋：你走错的那几手，一手一手重新想（lichess "Learn from your mistakes"、chess.com "Retry"）
    const retry = retryItems();
    elSummary.innerHTML = `
      ${opLine}
      <div class="xq-rv-chips">${chips}</div>
      ${retry.length ? `<button class="xq-rv-retry" data-act="retry">🔁 找回好棋：你走错的 ${retry.length} 手，先自己想一遍更好的</button>` : ''}
      <div class="xq-rv-phase">${phases ? `分阶段准确率：${phases}` : ''}${cmp ? `<br>${cmp}` : ''}</div>
      ${
        w && w.loss >= 80
          ? `<button class="xq-rv-turn" data-i="${wi}">
               ✍️ 你最该改的一手：第 ${roundOf(w.ply)} 回合 <b>${w.text}</b>
             </button>`
          : '<div class="xq-rv-empty">这一局你没有明显失误。</div>'
      }
      ${
        t
          ? `<button class="xq-rv-turn alt" data-i="${rep.turning}">
               🎯 决定胜负的一手：第 ${roundOf(t.ply)} 回合 ${sideName(t.color)} <b>${t.text}</b>
             </button>`
          : ''
      }
      ${
        analysis.savedPuzzles > 0
          ? `<div class="xq-rv-harvest">🎯 已把你这局走错的 <b>${analysis.savedPuzzles}</b> 手存进「我的专属课」：按毛病归类，明天起按间隔回来找你，连对五次才算过关。${
              opts.onTrainOwn ? '<button class="xq-rv-deep" data-act="train-own">▶ 去专属课看看</button>' : ''
            }</div>`
          : ''
      }
      ${
        analysis.engine === 'pro' && !analysis.opts.deep
          ? '<button class="xq-rv-deeprv" data-act="deep-review">🔬 深度复盘（每手多算几倍时间，更准）</button>'
          : analysis.opts.deep
            ? '<div class="xq-rv-empty">这是深度复盘的结果。</div>'
            : ''
      }`;
  }

  function onProgress() {
    const n = analysis.reviewed.length;
    if (analysis.done) {
      elProgress.textContent = `共 ${moves.length} 手 · ${analysis.engine === 'pro' ? '专业引擎' : '自带引擎'}${analysis.opts.deep ? ' · 深度' : ''}`;
      renderSummary();
      // 分析完直接跳到「你最该改的一手」——学棋要看的是自己的错。
      // 已经点开某一手在看了就别把人拽走（深度复盘算完换成新结果，原地刷新这一手）
      if (!jumped) {
        jumped = true;
        const rep = analysis.report!;
        const jump = rep.worst[playerColor] >= 0 ? rep.worst[playerColor] : rep.turning;
        if (cursor < 0 || analysis.opts.deep) {
          goto(cursor < 0 ? (jump >= 0 ? jump : reviewed().length - 1) : cursor);
          return;
        }
      }
    } else {
      elProgress.textContent = `${analysis.opts.deep ? '深度' : ''}分析中 ${n}/${moves.length}`;
    }
    renderList();
    drawGraph();
  }
  let offAnalysis = analysis.subscribe(onProgress);

  // ───────── 事件 ─────────
  /**
   * 深度解读：这手在做什么、全局上值不值、还有什么更好的、为什么。
   * 它要现跑一次搜索（一两秒），所以做成按需展开。
   */
  async function showDeep(i: number) {
    const m = reviewed()[i];
    const box = panel.querySelector('.xq-rv-deepbox') as HTMLElement | null;
    const btn = panel.querySelector(`[data-deep="${i}"]`) as HTMLButtonElement | null;
    if (!m || !box || !btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '分析中…';
    box.classList.add('on');
    box.textContent = '正在从全局算这一步的得失…';
    try {
      const facts = await deepFacts(boards[i], m.move, m.color, {
        ply: m.ply,
        grade: MOVE_LABEL[labelOf(m)].name,
        loss: m.loss,
      });
      box.innerHTML = mdToHtml(await explain(facts));
      btn.textContent = '🔍 已展开';
    } catch {
      box.textContent = '这一手的深度分析没算出来，上面的点评仍然有效。';
      btn.disabled = false;
      btn.textContent = '🔍 重试';
    }
  }

  /** 深度复盘：换一份每手多给几倍时间的分析，算完之前旧结果照常能看 */
  function deepReview() {
    const next = new GameAnalysis({ ...analysis.opts, deep: true, record: false });
    offAnalysis();
    if (ownAnalysis) analysis.cancel();
    analysis = next;
    ownAnalysis = true;
    jumped = false;
    offAnalysis = analysis.subscribe(onProgress);
    elSummary.innerHTML = '<div class="xq-rv-empty">深度复盘中，算完会替换上面的结果……</div>';
    onProgress();
  }

  /** 复制棋谱：发给朋友、贴到论坛、拿去别的软件里看 */
  async function copyRecord() {
    const lines: string[] = [];
    if (opts.title) lines.push(opts.title);
    const rep = analysis.report;
    if (rep) lines.push(`准确率 你 ${rep.stats[playerColor].accuracy} · 对手 ${rep.stats[foe].accuracy}`);
    const texts = boards.length ? moveTexts() : [];
    let row = '';
    texts.forEach((t, i) => {
      const ply = i + (startColor === 'b' ? 1 : 0);
      if (ply % 2 === 0) {
        if (row) lines.push(row);
        row = `${ply / 2 + 1}. ${t}`;
      } else row += row ? `  ${t}` : `${Math.floor(ply / 2) + 1}. …  ${t}`;
    });
    if (row) lines.push(row);
    const text = lines.join('\n');
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // 老浏览器 / 没有剪贴板权限：退回选中复制
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
    }
    elProgress.textContent = ok ? '✓ 棋谱已复制' : '复制失败，长按棋谱条手动复制';
    setTimeout(() => onProgress(), 1600);
  }

  /** 每一手的中文记谱（不依赖分析算没算完） */
  function moveTexts(): string[] {
    const list = reviewed();
    return moves.map((m, i) => list[i]?.text ?? textOf(boards[i], m));
  }

  panel.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const act = target.closest('[data-act]')?.getAttribute('data-act');
    if (act === 'copy') {
      void copyRecord();
      return;
    }
    if (act === 'deep-review') {
      deepReview();
      return;
    }
    if (act === 'retry') {
      runRetry();
      return;
    }
    if (act === 'punish-demo') return startDemo();
    if (act === 'train-own' && opts.onTrainOwn) {
      close();
      opts.onTrainOwn();
      return;
    }
    if (act === 'demo-end') return endDemo();
    if (demo && (act === 'demo-prev' || act === 'demo-next')) {
      demoAuto(false);
      demoShow(demo.k + (act === 'demo-next' ? 1 : -1));
      return;
    }
    if (demo && act === 'demo-play') {
      if (demo.k >= demo.p.steps.length) demoShow(1);
      demoAuto(!demo.timer);
      return;
    }
    const replay = target.closest('[data-replay]') as HTMLElement | null;
    if (replay && opts.onReplayFrom) {
      const i = Number(replay.dataset.replay);
      const m = reviewed()[i];
      if (m) {
        close();
        opts.onReplayFrom(boards[i], m.color);
      }
      return;
    }
    const deep = target.closest('[data-deep]') as HTMLElement | null;
    if (deep) {
      void showDeep(Number(deep.dataset.deep));
      return;
    }
    const el = target.closest('[data-i]') as HTMLElement | null;
    if (el) {
      goto(Number(el.dataset.i));
      return;
    }
    const go = target.closest('[data-go]') as HTMLElement | null;
    if (go) goto(cursor + Number(go.dataset.go));
    if (target.closest('[data-act="next-bad"]')) nextBad();
    if (target.closest('[data-act="overview"]')) goto(-1);
  });

  // ───────── 劣势推演：在棋盘上一步步演示 ─────────
  let demo: { p: Punish; k: number; timer: number; mine: boolean } | null = null;
  const navEl = panel.querySelector('.xq-rv-nav') as HTMLElement;
  const navHtml = navEl.innerHTML;
  function startDemo() {
    const m = reviewed()[cursor];
    const p = m ? punishOf(m, cursor) : null;
    if (!m || !p) return;
    const at = cursor;
    stopDemo();
    cursor = at;
    demo = { p, k: 1, timer: 0, mine: m.color === playerColor };
    panel.classList.add('demo');
    // 演示看的是棋盘：讲解展开着的先收起来，棋盘放到最大
    if (tall) {
      tall = false;
      panel.classList.remove('tall');
      foldBtn.textContent = '▴';
      layout();
    }
    navEl.innerHTML = `<button class="xq-btn" data-act="demo-prev" title="上一步">◀</button>
      <button class="xq-btn warn" data-act="demo-play">⏸ 暂停</button>
      <button class="xq-btn" data-act="demo-next" title="下一步">▶</button>
      <button class="xq-btn" data-act="demo-end">✕ 结束演示</button>`;
    scene.select(null);
    scene.setBadge(null);
    demoShow(1);
    demoAuto(true);
  }
  /** 演示到第 k 步（第 1 步是走错的那一手）：棋盘走过去、下面讲这一步在干什么 */
  function demoShow(k: number) {
    if (!demo) return;
    const { p, mine } = demo;
    const n = p.steps.length;
    k = Math.max(1, Math.min(n, k));
    demo.k = k;
    const st = p.steps[k - 1];
    scene.syncBoard(applyMove(st.before, st.move));
    scene.setLastMove(st.move, false);
    const isMe = (st.who === 'me') === mine;
    const who = k === 1 ? (mine ? '你走错' : '他走软') : isMe ? '你' : '对手';
    const dots = p.steps.map((x, j) => `<i class="${j < k ? 'on' : ''}${(x.who === 'me') === mine ? '' : ' foe'}"></i>`).join('');
    elDetail.innerHTML = `<div class="xq-rv-demo" data-demo>
      <div class="pg">${mine ? '⚠️ 对手怎么罚你' : '💡 你可以怎么罚他'} · 第 ${k} / ${n} 步<span class="dots">${dots}</span></div>
      <div class="now ${isMe ? 'me' : 'foe'}"><span class="w">${who}</span><b>${st.text}</b><em>${st.note}${st.tags.length ? `（${st.tags.join('、')}）` : ''}</em></div>
      ${k === n ? `<div class="sum">${p.summary}</div>` : `<div class="nx">下一步：${(p.steps[k].who === 'me') === mine ? '你' : '对手'} ${p.steps[k].text}</div>`}
    </div>`;
    if (k === n) demoAuto(false);
  }
  function demoAuto(on: boolean) {
    if (!demo) return;
    clearInterval(demo.timer);
    demo.timer = 0;
    if (on) demo.timer = window.setInterval(() => demo && demoShow(demo.k + 1), 1400);
    const b = navEl.querySelector('[data-act="demo-play"]') as HTMLButtonElement | null;
    if (b) b.textContent = on ? '⏸ 暂停' : demo.k >= demo.p.steps.length ? '↻ 再看一遍' : '▶ 自动';
  }
  /** 收起演示（不动棋盘）：翻到别的手、关掉复盘时用 */
  function stopDemo() {
    if (!demo) return;
    clearInterval(demo.timer);
    demo = null;
    panel.classList.remove('demo');
    navEl.innerHTML = navHtml;
  }
  function endDemo() {
    stopDemo();
    goto(cursor);
  }

  /** 你下一个走得有问题的地方（不佳、失误、漏着）；到头了从头找 */
  function nextBad() {
    const list = reviewed();
    const bad = (i: number) => {
      const m = list[i];
      if (!m || m.color !== playerColor) return false;
      const lb = labelOf(m);
      return lb === 'dubious' || lb === 'mistake' || lb === 'blunder';
    };
    for (let k = 1; k <= list.length; k++) {
      const i = (cursor + k + list.length) % list.length;
      if (bad(i)) {
        goto(i);
        return;
      }
    }
    const btn = panel.querySelector('[data-act="next-bad"]') as HTMLButtonElement;
    btn.textContent = analysis.done ? '👍 没有问题手' : '还在打分…';
    setTimeout(() => (btn.textContent = '⚠ 下个问题手'), 1600);
  }

  // 在棋盘上左右滑翻页；键盘左右键也行。手机上点小按钮翻几十手太累了
  const boardEl = host.querySelector('.xq-boardwrap') as HTMLElement | null;
  let touchX = 0;
  let touchY = 0;
  const onTouchStart = (e: TouchEvent) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (!(Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5)) return;
    if (demo) {
      demoAuto(false);
      demoShow(demo.k + (dx < 0 ? 1 : -1));
    } else goto(cursor + (dx < 0 ? 1 : -1));
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const d = e.key === 'ArrowRight' ? 1 : -1;
    if (demo) {
      demoAuto(false);
      demoShow(demo.k + d);
    } else goto(cursor + d);
  };
  boardEl?.addEventListener('touchstart', onTouchStart, { passive: true });
  boardEl?.addEventListener('touchend', onTouchEnd, { passive: true });
  window.addEventListener('keydown', onKey);
  (panel.querySelector('.xq-rv-close') as HTMLButtonElement).onclick = () => {
    close();
    onClose();
  };

  /**
   * 问教练。上下文取的是**当前选中的那一手**——
   * 用户点着第 12 回合问"这一步为什么错"，答的必须是第 12 回合那一手。
   */
  let closeChat: (() => void) | null = null;
  (panel.querySelector('.xq-rv-ask') as HTMLButtonElement).onclick = () => {
    if (closeChat) {
      closeChat();
      closeChat = null;
      return;
    }
    closeChat = runChat({
      host,
      getContext: (): ChatContext => {
        const rep = analysis.report;
        const me = rep?.stats[playerColor];
        const wi = rep?.worst[playerColor] ?? -1;
        const w = wi >= 0 ? rep!.moves[wi] : null;
        const cur = cursor >= 0 ? reviewed()[cursor] : null;
        return {
          side: playerColor === 'r' ? '红' : '黑',
          stats: me ? { ...me, won: playerWon } : undefined,
          problem: w ? w.comment : undefined,
          focus: cur
            ? {
                round: roundOf(cur.ply),
                played: cur.text,
                best: cur.bestText,
                bestLine: cur.bestPv,
                problem: cur.comment,
                loss: cur.loss,
              }
            : undefined,
        };
      },
      onClose: () => {
        closeChat = null;
      },
    });
  };
  /*
   * 手机竖屏：棋盘尽量大、整块露出来，面板只占棋盘下面剩下的那一截（至少 210 像素）。
   * 用户原话："复盘时要能看到完整的棋局界面，不能光在底下显示一堆文字，否则很难和棋局联系起来。"
   * 原来面板固定占半屏，存档里打开的棋局棋盘还没放进让位的容器，下半盘直接被面板盖住。
   * 点 ▴ 展开讲解：面板升高、棋盘跟着缩小，但永远完整、不被盖住；宽屏是右侧面板，不用管。
   */
  let tall = false;
  const layout = () => {
    const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || window.innerHeight;
    const w = host.clientWidth || window.innerWidth;
    if (w >= 720) {
      host.style.removeProperty('--rv-h');
      return;
    }
    const boardH = ((w - 6) * 11.2) / 9.9; // 棋盘满宽时有多高（和 board2d 的比例一致）
    const h = tall ? appH * 0.6 : Math.min(appH * 0.5, Math.max(210, appH - boardH - 8));
    host.style.setProperty('--rv-h', `${Math.round(h)}px`);
  };
  layout();
  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);
  const foldBtn = panel.querySelector('.xq-rv-fold') as HTMLButtonElement;
  foldBtn.onclick = () => {
    tall = !tall;
    panel.classList.toggle('tall', tall);
    foldBtn.textContent = tall ? '▾' : '▴';
    foldBtn.title = tall ? '收起讲解，看大棋盘' : '展开讲解（棋盘跟着缩小，但一直完整露出来）';
    layout();
  };

  goto(-1);
  onProgress();
  requestAnimationFrame(drawGraph);

  function close() {
    stopDemo();
    offAnalysis();
    // 自己开的分析跟着复盘一起停；刚下完的棋那份归对局管（它还要落地存档和战绩）
    if (ownAnalysis && !analysis.done) analysis.cancel();
    window.removeEventListener('resize', onResize);
    window.removeEventListener('resize', layout);
    window.visualViewport?.removeEventListener('resize', layout);
    host.style.removeProperty('--rv-h');
    window.removeEventListener('keydown', onKey);
    boardEl?.removeEventListener('touchstart', onTouchStart);
    boardEl?.removeEventListener('touchend', onTouchEnd);
    closeChat?.();
    closeChat = null;
    panel.remove();
    scene.select(null);
    scene.setBadge(null);
    scene.syncBoard(boards[boards.length - 1]);
  }
  return close;
}
