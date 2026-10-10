/**
 * 复盘界面：下完一盘，把每一手的好坏摊开来看，并且给每一手、每一方打分。
 *
 * 教学重点不是分数本身，是让你看见**惩罚**：走到出错那手时，棋盘直接摆出
 * 对方的反驳着法，并把该走的正确一手标在盘上。分数的作用是**排优先级**——
 * 六十手棋，先看哪几手；以及**跟自己比**——这盘比上几盘有没有进步。
 *
 * 布局参照天天象棋的复盘（用户原话："复盘的布局也是需要彻底优化，可以参照天天象棋的复盘"）：
 *   - 棋盘最大，整块露出来；
 *   - 棋盘正下方一条局势图（红上黑下，以中线为界），手指在上面左右拖就一手手翻，问题手是红点；
 *   - 下面一张"这一手"的卡片：评级、亏多少分、★ 推荐走法和多得几分，▶ 看后续 / ⚠ 怎么罚 两个按钮；
 *   - 底部一排工具：返回、上一手、问题手、下一手、试下、讲解、报告；
 *   - 试下：直接点棋盘上的子走走看，引擎替对方应，告诉你这一手比最佳差多少——不影响棋谱；
 *   - 报告：你和对手的准确率、开局/中局/残局三段、好棋和错着各几手，下面是整盘棋谱，每手挂评级。
 * 长讲解（对手怎么罚、计划、残局、邪门布局……）都在卡片下面，点「📖 讲解」把面板拉高看。
 *
 * 分析本身在 gamescore.ts：一盘下完就在后台开算，这里只负责展示。
 */
import type { Board, Color, Move } from './rules';
import {
  LABEL_ORDER,
  MOVE_LABEL,
  PHASE_NAME,
  evalWords,
  gradeOf,
  labelOf,
  type Judged,
  type MoveLabel,
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
import { applyMove, initialBoard, isInCheck, legalMoves } from './rules';
import type { Puzzle } from './puzzles';
import { ERR_INFO, inPieces, type ErrTag } from './teach';
import { lineSteps, punishLine, type Punish, type PunishStep } from './punish';
import { openLineLab } from './linelab';
import { lineTalk, whatItDoes } from './coachexplain';
import type { MoveScore } from './ai';
import { engineAnalyse, engineReady, engineScoreMove, loadEngine } from './pikafish';

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

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

/** 面板拉高时看什么：不拉高 / 讲解 / 报告（整盘总结 + 棋谱） */
type Sheet = 'none' | 'detail' | 'report';

export function runReview(opts: ReviewOpts): () => void {
  const { host, scene, startColor, moves, playerColor, playerWon, onClose } = opts;
  const coachFlags = opts.coachFlags ?? new Map<number, string>();
  const foe: Color = other(playerColor);

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
  /** 正在看的这一手是不是"对比"摆法（棋盘停在走之前，你走的和最佳两条箭头） */
  let compare = false;
  let jumped = false;
  let sheet: Sheet = 'none';

  const panel = document.createElement('div');
  panel.className = 'xq-rv';
  panel.dataset.sheet = sheet;
  panel.innerHTML = `
    <div class="xq-rv-score">
      <div class="xq-rv-side me"><span>你</span><b>—</b><em>准确率</em></div>
      <div class="xq-rv-chart">
        <div class="xq-rv-meta"><span class="xq-rv-pos">开局</span><span class="xq-rv-progress">分析中 0/${moves.length}</span></div>
        <canvas class="xq-rv-graph" title="局势图：红方占优在上、黑方占优在下。手指左右拖，一手一手翻"></canvas>
      </div>
      <div class="xq-rv-side foe"><span>对手</span><b>—</b><em>准确率</em></div>
    </div>
    <div class="xq-rv-body">
      <div class="xq-rv-detail"></div>
      <div class="xq-rv-report"><div class="xq-rv-summary"></div></div>
      <div class="xq-rv-list"></div>
    </div>
    <div class="xq-rv-nav"></div>`;
  host.appendChild(panel);

  const elProgress = panel.querySelector('.xq-rv-progress') as HTMLElement;
  const elSummary = panel.querySelector('.xq-rv-summary') as HTMLElement;
  const elList = panel.querySelector('.xq-rv-list') as HTMLElement;
  const elDetail = panel.querySelector('.xq-rv-detail') as HTMLElement;
  const elBody = panel.querySelector('.xq-rv-body') as HTMLElement;
  const elPos = panel.querySelector('.xq-rv-pos') as HTMLElement;
  const elMeAcc = panel.querySelector('.xq-rv-side.me b') as HTMLElement;
  const elFoeAcc = panel.querySelector('.xq-rv-side.foe b') as HTMLElement;
  const graph = panel.querySelector('.xq-rv-graph') as HTMLCanvasElement;
  const navEl = panel.querySelector('.xq-rv-nav') as HTMLElement;

  /** 底部工具条：像天天象棋那样一排图标 + 两个字，单手也点得到 */
  const tb = (attrs: string, icon: string, label: string, cls = '') =>
    `<button class="xq-rv-tb${cls ? ` ${cls}` : ''}" ${attrs}><i>${icon}</i><span>${label}</span></button>`;
  const navHtml =
    tb('data-nav-back title="回到上一屏"', '←', '返回', 'xq-rv-close') +
    tb('data-go="-1" title="上一手（也可以在棋盘上往右滑）"', '◀', '上一手') +
    tb('data-act="next-bad" title="跳到你下一个走得有问题的地方"', '⚠', '问题手', 'warn') +
    tb('data-go="1" title="下一手（也可以在棋盘上往左滑）"', '▶', '下一手') +
    tb('data-act="try" title="在棋盘上自己走走看，引擎替对方应"', '🧪', '试下') +
    tb('data-act="detail" title="展开这一手的讲解（棋盘跟着缩小，但一直完整露出来）"', '📖', '讲解', 'xq-rv-fold') +
    tb('data-act="overview" title="复盘报告和整盘棋谱"', '📊', '报告', 'xq-rv-ov');
  navEl.innerHTML = navHtml;

  const sideName = (c: Color) => (c === playerColor ? '你' : '对手');
  const reviewed = () => analysis.reviewed;
  const roundOf = (ply: number) => Math.floor((ply + (startColor === 'b' ? 1 : 0)) / 2) + 1;
  /** 第 i 手走完之后、红方视角的分（局势图上滑到这一手时显示） */
  const redAfter = (m: ReviewedMove) => ({
    score: m.color === 'r' ? m.playedScore : -m.playedScore,
    mate: m.playedMate === undefined ? undefined : m.color === 'r' ? m.playedMate : -m.playedMate,
  });

  // ───────── 局势图 ─────────
  /**
   * 天天象棋叫"局势图"：以中线为界，红方占优往上（红）、黑方占优往下（灰），一盘棋的起伏一眼看完。
   * 你走坏的那几手标成红点，妙手 / 唯一着标成青点；开局、中局、残局之间画一条虚线。
   * 手指按住左右拖，棋盘跟着一手一手翻，上面写着这一手走完的局面分。
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
    g.font = '9px -apple-system, "PingFang SC", sans-serif';
    g.textBaseline = 'middle';
    // 中线
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(0, h / 2);
    g.lineTo(w, h / 2);
    g.stroke();
    g.fillStyle = 'rgba(240,150,140,0.45)';
    g.fillText('红优', 3, 7);
    g.fillStyle = 'rgba(190,205,220,0.4)';
    g.fillText('黑优', 3, h - 7);
    if (!list.length) return;
    // 阶段分界：开局 | 中局 | 残局
    g.setLineDash([2, 3]);
    g.strokeStyle = 'rgba(255,255,255,0.16)';
    list.forEach((m, i) => {
      if (i === 0 || m.phase === list[i - 1].phase) return;
      const x = (xOf(i) + xOf(i - 1)) / 2;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.32)';
      g.fillText(PHASE_NAME[m.phase], x + 3, h - 7);
    });
    g.setLineDash([]);
    // 红方占优的部分填红、黑方占优的填灰
    const pts = [{ x: 2, y: yOf(50) }, ...list.map((m, i) => ({ x: xOf(i), y: yOf(m.redWin) }))];
    for (const [fill, clipTop] of [
      ['rgba(224,67,58,0.32)', true],
      ['rgba(150,170,195,0.28)', false],
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
    // 当前这一手：竖线 + 曲线上的点 + 这一手走完的局面分
    if (cursor >= 0 && list[cursor]) {
      const m = list[cursor];
      const x = xOf(cursor);
      const y = yOf(m.redWin);
      g.strokeStyle = 'rgba(255,215,110,0.9)';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
      g.fillStyle = '#ffd76e';
      g.beginPath();
      g.arc(x, y, 3.6, 0, Math.PI * 2);
      g.fill();
      const r = redAfter(m);
      const t =
        r.mate !== undefined
          ? `${r.mate > 0 ? '红' : '黑'}方 ${Math.abs(r.mate)} 步杀`
          : Math.abs(r.score) < 60
            ? '均势'
            : `${r.score > 0 ? '红' : '黑'} +${(Math.abs(r.score) / 100).toFixed(1)}`;
      g.font = 'bold 10px -apple-system, "PingFang SC", sans-serif';
      const tw = g.measureText(t).width + 8;
      const tx = Math.max(1, Math.min(w - tw - 1, x + 5));
      const ty = y < h / 2 ? h - 15 : 2;
      g.fillStyle = 'rgba(12,18,25,0.85)';
      g.fillRect(tx, ty, tw, 13);
      g.fillStyle = r.mate !== undefined ? (r.mate > 0 ? '#ff9b91' : '#c9d6e3') : r.score >= 60 ? '#ff9b91' : r.score <= -60 ? '#c9d6e3' : '#f0e6d2';
      g.fillText(t, tx + 4, ty + 7);
    }
  }
  /** 局势图上按住左右拖：天天象棋就是这么翻的，几十手棋一拖就到 */
  let scrubbing = false;
  const scrubTo = (e: PointerEvent) => {
    const r = graph.getBoundingClientRect();
    const n = Math.max(moves.length, 1);
    const i = Math.round(((e.clientX - r.left - 2) / Math.max(1, r.width - 4)) * n) - 1;
    const k = Math.max(-1, Math.min(reviewed().length - 1, i));
    if (k !== cursor || demo || trial || sheet === 'report') goto(k);
  };
  graph.addEventListener('pointerdown', (e) => {
    scrubbing = true;
    try {
      graph.setPointerCapture(e.pointerId);
    } catch {
      // 老浏览器没有 pointer capture：拖出画布就停，不影响点
    }
    scrubTo(e);
  });
  graph.addEventListener('pointermove', (e) => {
    if (scrubbing) scrubTo(e);
  });
  const endScrub = () => (scrubbing = false);
  graph.addEventListener('pointerup', endScrub);
  graph.addEventListener('pointercancel', endScrub);
  const onResize = () => drawGraph();
  window.addEventListener('resize', onResize);

  // ───────── 单手详情 ─────────
  /** 把棋盘摆到第 i 手走完的样子；并把该走的正确着法标出来 */
  function goto(i: number) {
    stopDemo();
    stopTrial();
    if (sheet === 'report') setSheet('none');
    const list = reviewed();
    cursor = Math.max(-1, Math.min(list.length - 1, i));
    const cm = cursor >= 0 ? list[cursor] : null;
    // 你走得不好的一手：棋盘停在走之前，红箭头是你走的、绿箭头是最佳——点箭头看两条路各自怎么发展
    compare = !!cm && cm.color === playerColor && !!cm.bestMove && isBad(cm);
    scene.syncBoard(boards[compare ? cursor : cursor + 1]);
    scene.setArrows([]);
    scene.select(null);
    drawGraph();
    elBody.scrollTop = 0;
    if (cursor < 0) {
      scene.setLastMove(null);
      scene.setBadge(null);
      elPos.textContent = '开局';
      elDetail.innerHTML = `<div class="xq-rv-card start"><div class="xq-rv-empty">${
        list.length ? `开局局面 · 共 ${moves.length} 手。` : `正在给每一手打分（${list.length}/${moves.length}）……`
      }点 <b>▶</b> 一手一手看，点 <b>⚠ 问题手</b> 直接跳到你走得有问题的地方；在上面的局势图上按住左右拖能快速翻；点棋盘上的子可以<b>试下</b>。</div></div>`;
      renderList();
      return;
    }

    const m = list[cursor];
    elPos.textContent = `第 ${roundOf(m.ply)} 回合 · ${sideName(m.color)}`;
    const lb = labelOf(m);
    const L = MOVE_LABEL[lb];
    // 这一手标在盘上：走的路线 + 棋子右上角的评级（★ 优 良 中 差 错 漏）
    if (compare) {
      // 走之前的局面：评级挂在要走的那个子上，两条箭头都点得动
      scene.setLastMove(cursor > 0 ? list[cursor - 1].move : null, false);
      scene.setBadge({ x: m.move.fx, y: m.move.fy, text: L.short, color: L.badge });
      scene.setArrows([
        { ...m.move, color: 'rgba(224,67,58,0.9)', label: '你', id: 'mine' },
        { ...m.bestMove!, color: 'rgba(46,170,90,0.95)', label: '★', id: 'best' },
      ]);
    } else {
      scene.setLastMove(m.move, false);
      scene.setBadge({ x: m.move.tx, y: m.move.ty, text: L.short, color: L.badge });
      // 对手走软的一手：绿箭头是你该怎么罚他（他这一路主变里你的下一手），点它看整条
      const pun = m.color !== playerColor && isBad(m) ? m.playedLine?.[1] : undefined;
      if (pun) scene.setArrows([{ ...pun, color: 'rgba(46,170,90,0.95)', label: '罚', id: 'punish' }]);
    }

    // 走之前 → 走之后，红方视角
    const toRed = (s: number) => (m.color === 'r' ? s : -s);
    const mateRed = (x?: number) => (x === undefined ? undefined : m.color === 'r' ? x : -x);
    const before = evalWords(toRed(m.bestScore), mateRed(m.bestMate));
    const after = evalWords(toRed(m.playedScore), mateRed(m.playedMate));

    // 卡片：一眼看完这一手（评级、亏多少、该走什么、两个按钮）；下面是长讲解，点「📖 讲解」拉高看
    elDetail.innerHTML = `
      <div class="xq-rv-card" data-card>
        <div class="xq-rv-move" style="--g:${L.color}">
          <span class="xq-rv-grade" style="--b:${L.badge}">${L.short === L.name.slice(0, 1) ? L.name : `${L.short} ${L.name}`}</span>
          <span class="n">${roundOf(m.ply)}${m.color === 'r' ? '.' : '…'}</span><b>${m.text}</b>
          <span class="who">${sideName(m.color)}</span>
          ${m.loss >= 30 ? `<span class="xq-rv-loss">亏 ${m.loss}</span>` : ''}
          <span class="xq-rv-acc" title="这一手的准确率（0～100）">准确率 ${m.accuracy}</span>
        </div>
        ${bestBlock(m)}
      </div>
      <div class="xq-rv-more">
        <div class="xq-rv-eval">局面：${before === after ? before : `${before} → ${after}`}</div>
        <div class="xq-rv-comment">${badgeWhy(m)}${m.comment}</div>
        ${
          m.color === playerColor && m.tag && m.loss >= 80
            ? `<div class="xq-rv-ask-self" data-ask-self>🤔 <b>下次在这种局面，落子前先问自己</b>（${ERR_INFO[m.tag].name}）：${ERR_INFO[m.tag].advice}</div>`
            : ''
        }
        ${punishBlock(m, cursor)}
        ${coachFlags.has(m.ply) ? `<div class="xq-rv-flag">🧑‍🏫 对局时教练拦过这一手，你选择了"就这么走"。教练当时说：${esc(coachFlags.get(m.ply)!)}</div>` : ''}
        ${trickNote(m, cursor)}
        ${planBlock(m, boards[cursor])}
        ${endgameNote(m, boards[cursor])}
        <div class="xq-rv-actions">
          <button class="xq-rv-deep" data-deep="${cursor}">🔍 从全局讲讲这一手</button>
          ${opts.onReplayFrom ? `<button class="xq-rv-deep" data-replay="${cursor}">♟ 从这里重下</button>` : ''}
          <button class="xq-rv-deep xq-rv-ask" data-act="ask" title="问教练这一手">🧑‍🏫 问教练</button>
        </div>
        <div class="xq-rv-deepbox"></div>
      </div>`;
    renderList();
  }

  /** 不佳、失误、漏着 */
  function isBad(m: ReviewedMove): boolean {
    const lb = labelOf(m);
    return lb === 'dubious' || lb === 'mistake' || lb === 'blunder';
  }

  /**
   * 最佳走法那一行（卡片的第二行）。用户原话："能看到最好的走法应该是什么，以及这步最佳走法能多得多少分。
   * 最好能支持交互，比如有一个箭头，我点着箭头就能知道最佳走法及接下来的后续发展。"
   */
  function bestBlock(m: ReviewedMove): string {
    const mine = m.color === playerColor;
    const pun =
      isBad(m) && punishOf(m, cursor)
        ? `<button class="xq-rv-act bad xq-rv-pun" data-act="punish-demo">⚠ ${mine ? '对手怎么罚你' : '怎么罚他'}</button>`
        : '';
    const tryBtn = `<button class="xq-rv-act try" data-act="try-here" title="从这一手走之前开始，按你的想法走一手，看对方怎么接">🧪 换一手试试</button>`;
    if (m.isBest) return `<div class="xq-rv-best ok" data-best>✅ ${mine ? '这就是最佳走法' : '对手这一手就是最佳走法'}。<div class="acts">${pun}${tryBtn}</div></div>`;
    if (!m.bestMove || !m.bestText) return `<div class="xq-rv-best"><div class="acts">${pun}${tryBtn}</div></div>`;
    const pawns = (m.loss / 100).toFixed(1);
    const who = mine ? '你这手' : '他这手';
    const hint = compare
      ? `<div class="tip">棋盘上 <b class="g">绿箭头 ★</b> 是最佳、<b class="r">红箭头「你」</b>是你走的——点箭头看两条路各自怎么走下去。</div>`
      : !mine && isBad(m)
        ? '<div class="tip">棋盘上 <b class="g">绿箭头「罚」</b>是你该怎么罚他——点它看整条。</div>'
        : '';
    return `<div class="xq-rv-best" data-best>
      <div class="rec">★ ${mine ? '最佳走法' : '他该走'} <b>${m.bestText}</b>：比${who}多得约 <b>${m.loss} 分</b><em>（约 ${pawns} 个兵）</em></div>
      ${hint}
      <div class="acts"><button class="xq-rv-act" data-act="best-demo">▶ 看最佳的后续</button>${pun}${tryBtn}<button class="xq-rv-act" data-act="lab">🔀 推演</button></div>
    </div>`;
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
    const played = trickAt(after, other(m.color));
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

  /**
   * 整盘棋谱：一回合一行，红一手、黑一手，每手挂评级（天天象棋的"棋谱"页）。点哪手跳哪手。
   * 手机上在「📊 报告」里，宽屏一直摆在右侧面板下面。
   */
  function renderList() {
    const list = reviewed();
    if (!list.length) {
      elList.innerHTML = '';
      return;
    }
    const cell = (i: number) => {
      const m = list[i];
      if (!m) return '<span></span>';
      const lb = labelOf(m);
      const L = MOVE_LABEL[lb];
      const bad = lb === 'dubious' || lb === 'mistake' || lb === 'blunder';
      const turn = analysis.report && analysis.report.turning === i;
      return `<button class="xq-rv-item${i === cursor ? ' on' : ''}${bad ? ' bad' : ''}${turn ? ' turn' : ''}${m.color === playerColor ? ' me' : ''}"
        data-i="${i}" style="--g:${L.color}" title="${L.name}">
        <span class="t">${m.text}</span>
        <span class="lv" style="--g:${L.badge}">${L.short}</span>
        ${coachFlags.has(m.ply) ? '<span class="f" title="教练拦过">🧑‍🏫</span>' : ''}
      </button>`;
    };
    // 黑方先走的棋（从中途摆的局面）：第一行红那一格空着
    const off = startColor === 'b' ? 1 : 0;
    const rows: string[] = [];
    for (let r = 0; 2 * r - off < list.length; r++) {
      const ri = 2 * r - off;
      rows.push(`<div class="xq-rv-round"><span class="rn">${r + 1}.</span>${ri >= 0 ? cell(ri) : '<span></span>'}${cell(ri + 1)}</div>`);
    }
    // 不自动滚到当前这一手：宽屏时棋谱就摆在讲解下面，一滚讲解就看不见了；报告里打分一刷新也会把人拽走
    elList.innerHTML = `<div class="hd">📜 棋谱${analysis.done ? '' : `（打分中 ${list.length}/${moves.length}）`} · 点哪一手看哪一手</div>${rows.join('')}`;
  }

  // ───────── 面板拉高：讲解 / 报告 ─────────
  function setSheet(s: Sheet) {
    sheet = s;
    panel.dataset.sheet = s;
    panel.classList.toggle('tall', s !== 'none');
    navEl.querySelector('[data-act="detail"]')?.classList.toggle('on', s === 'detail');
    navEl.querySelector('[data-act="overview"]')?.classList.toggle('on', s === 'report');
    if (s === 'report') {
      renderSummary();
      renderList();
    }
    elBody.scrollTop = 0;
    layout();
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

  /**
   * 复盘报告（天天象棋的复盘报告：整盘准确率、开中残三段各打一个分、好棋和错着漏着各几手）。
   * 你和对手并排一张表，下面是这盘要改的一个习惯、最该改的一手、错过的机会……
   */
  function renderSummary() {
    const rep = analysis.report;
    const head = `<div class="xq-rv-rephd"><b>📊 复盘报告</b>
      <button class="xq-rv-act" data-act="copy" title="复制棋谱">📋 复制棋谱</button>
      <button class="xq-rv-act" data-act="ask" title="问教练">🧑‍🏫 问教练</button></div>`;
    if (!rep) {
      elSummary.innerHTML = `${head}<div class="xq-rv-empty">还在给每一手打分（${reviewed().length}/${moves.length}），算完这里出整盘报告。</div>`;
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

    // 你和对手对照表：准确率、三个阶段、好棋 / 不佳 / 失误 / 漏着
    const cnt = (c: Color, ls: MoveLabel[]) => ls.reduce((a, l) => a + rep.counts[c][l], 0);
    const phaseRow = (p: Phase) =>
      rep.phaseAcc[playerColor][p] === undefined && rep.phaseAcc[foe][p] === undefined
        ? ''
        : `<tr><td>${PHASE_NAME[p]}</td><td class="me">${rep.phaseAcc[playerColor][p] ?? '—'}</td><td class="foe">${rep.phaseAcc[foe][p] ?? '—'}</td></tr>`;
    const countRow = (name: string, ls: MoveLabel[], cls = '') =>
      `<tr class="${cls}"><td>${name}</td><td class="me">${cnt(playerColor, ls)}</td><td class="foe">${cnt(foe, ls)}</td></tr>`;
    const table = `<table class="xq-rv-table" data-report>
      <tr><th></th><th class="me">你</th><th class="foe">对手</th></tr>
      <tr class="acc"><td>准确率</td><td class="me"><b>${me.accuracy}</b></td><td class="foe"><b>${them.accuracy}</b></td></tr>
      ${(['opening', 'middle', 'endgame'] as Phase[]).map(phaseRow).join('')}
      ${countRow('★ 好棋', ['brilliant', 'only', 'top', 'best'], 'good')}
      ${countRow('?! 不佳', ['dubious'])}
      ${countRow('? 失误', ['mistake'], 'warn')}
      ${countRow('?? 漏着', ['blunder'], 'bad')}
    </table>`;

    // 各种称号各几手（只列有的）
    const chips = LABEL_ORDER.filter((l) => rep.counts[playerColor][l] > 0)
      .map((l) => {
        const L = MOVE_LABEL[l];
        return `<span class="xq-rv-chip" style="--g:${L.color}">${L.sym ? `<i>${L.sym}</i>` : ''}${L.name} <b>${rep.counts[playerColor][l]}</b></span>`;
      })
      .join('');
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
    // 教练复盘的两样：一是把这盘最贵的毛病变成一个下盘就能用的习惯；二是对手的错着你抓住了没有——
    // 复盘不只找自己的错，也要找对手的错（象棋教练的说法），没抓住的机会和走错一样亏
    const cost = new Map<ErrTag, number>();
    for (const m of rep.moves) if (m.color === playerColor && m.tag && m.loss >= 80) cost.set(m.tag, (cost.get(m.tag) ?? 0) + m.loss);
    const habitTag = [...cost.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const habit = habitTag
      ? `<div class="xq-rv-habit" data-habit>🧭 <b>这盘要改的一个习惯</b>：少犯「${ERR_INFO[habitTag].name}」（这盘亏了约${inPieces(cost.get(habitTag)!)}）。${ERR_INFO[habitTag].advice}</div>`
      : '';
    const missed = rep.moves
      .map((m, i) => ({ m, i, reply: rep.moves[i + 1] }))
      .filter(({ m, reply }) => m.color === foe && (m.grade === 'mistake' || m.grade === 'blunder') && reply && reply.color === playerColor && reply.loss >= 100)
      .slice(0, 2)
      .map(
        ({ m, i }) =>
          `<button class="xq-rv-turn alt" data-i="${i}" data-missed>😮 错过的机会：第 ${roundOf(m.ply)} 回合对手 <b>${m.text}</b> 走软了，你没抓住——看看怎么罚他</button>`,
      )
      .join('');
    elSummary.innerHTML = `
      ${head}
      ${table}
      ${opLine}
      <div class="xq-rv-chips">${chips}</div>
      ${cmp ? `<div class="xq-rv-phase">${cmp}</div>` : ''}
      ${retry.length ? `<button class="xq-rv-retry" data-act="retry">🔁 找回好棋：你走错的 ${retry.length} 手，先自己想一遍更好的</button>` : ''}
      ${
        w && w.loss >= 80
          ? `<button class="xq-rv-turn" data-i="${wi}">
               ✍️ 你最该改的一手：第 ${roundOf(w.ply)} 回合 <b>${w.text}</b>
             </button>`
          : '<div class="xq-rv-empty">这一局你没有明显失误。</div>'
      }
      ${habit}
      ${missed}
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
        if ((cursor < 0 && !trial && !demo) || analysis.opts.deep) {
          goto(cursor < 0 ? (jump >= 0 ? jump : reviewed().length - 1) : cursor);
          return;
        }
      }
    } else {
      elProgress.textContent = `${analysis.opts.deep ? '深度' : ''}分析中 ${n}/${moves.length}`;
      if (sheet === 'report') renderSummary();
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
    onProgress();
    elSummary.insertAdjacentHTML('afterbegin', '<div class="xq-rv-empty">深度复盘中，算完会替换下面的结果……</div>');
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

  function onClick(e: MouseEvent) {
    const target = e.target as HTMLElement;
    const act = target.closest('[data-act]')?.getAttribute('data-act');
    if (target.closest('[data-nav-back]')) {
      close();
      onClose();
      return;
    }
    if (act === 'copy') return void copyRecord();
    if (act === 'ask') return toggleChat();
    if (act === 'deep-review') return deepReview();
    if (act === 'retry') return runRetry();
    if (act === 'punish-demo') return startDemo('punish');
    if (act === 'best-demo') return startDemo('best');
    if (act === 'lab') return openLab();
    if (act === 'detail') return setSheet(sheet === 'detail' ? 'none' : 'detail');
    if (act === 'overview') return setSheet(sheet === 'report' ? 'none' : 'report');
    if (act === 'try') return trial ? endTrial() : startTrial();
    if (act === 'trial-undo') return trialUndo();
    if (act === 'trial-lab') return trialLab();
    if (act === 'trial-follow') return trialFollow();
    if (act === 'try-here') {
      // 卡片上的「🧪 换一手试试」：从这一手走之前开始，按你的想法换一手
      const m = reviewed()[cursor];
      if (m) startTrial(undefined, { board: boards[cursor], turn: m.color, ref: cursor });
      return;
    }
    if (act === 'trial-end') return endTrial();
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
      if (demo.k >= demo.d.steps.length) demoShow(1);
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
    if (deep) return void showDeep(Number(deep.dataset.deep));
    const el = target.closest('[data-i]') as HTMLElement | null;
    if (el) return goto(Number(el.dataset.i));
    const go = target.closest('[data-go]') as HTMLElement | null;
    if (go) return goto(cursor + Number(go.dataset.go));
    if (act === 'next-bad') nextBad();
  }
  panel.addEventListener('click', onClick);

  // ───────── 在棋盘上一步步演示一条路：对手怎么罚你 / 最佳走法怎么走下去 ─────────
  interface DemoLine {
    steps: PunishStep[];
    summary: string;
    title: string;
    /** 第一步那个标签："你走错" / "应该走" */
    firstWho: string;
    /** 第一步是不是你走的 */
    mine: boolean;
  }
  let demo: { d: DemoLine; k: number; timer: number } | null = null;

  function punishDemo(m: ReviewedMove, i: number): DemoLine | null {
    const p = punishOf(m, i);
    if (!p) return null;
    const mine = m.color === playerColor;
    return { steps: p.steps, summary: p.summary, title: mine ? '⚠️ 对手怎么罚你' : '💡 你可以怎么罚他', firstWho: mine ? '你走错' : '他走软', mine };
  }
  /** 最佳走法这一路：引擎的主变，一手手讲；结尾说这一路的计划和走完谁好 */
  function bestDemo(m: ReviewedMove, i: number): DemoLine | null {
    if (!m.bestMove) return null;
    const line = m.bestLine?.length ? m.bestLine : [m.bestMove];
    const steps = lineSteps(boards[i], line, m.color, m.color, 10);
    if (!steps.length) return null;
    const p = planOf(boards[i], m.color, { move: m.bestMove, score: m.bestScore, mateIn: m.bestMate, pv: line }, 10);
    const toRed = (x: number) => (m.color === 'r' ? x : -x);
    const end = evalWords(toRed(m.bestScore), m.bestMate === undefined ? undefined : toRed(m.bestMate));
    const mine = m.color === playerColor;
    return {
      steps,
      summary: `${mine ? '这一手该走' : '他该走'} <b>${m.bestText}</b>——${p.goal}。这一路走下去：${end}；比${mine ? '你' : '他'}走的 ${m.text} 多得约 ${m.loss} 分。`,
      title: `✅ 最佳走法 ${m.bestText} 怎么走下去`,
      firstWho: mine ? '应该走' : '他该走',
      mine,
    };
  }
  function startDemo(kind: 'punish' | 'best') {
    const m = reviewed()[cursor];
    const d = m ? (kind === 'best' ? bestDemo(m, cursor) : punishDemo(m, cursor)) : null;
    if (!m || !d) return;
    const at = cursor;
    stopDemo();
    stopTrial();
    cursor = at;
    demo = { d, k: 1, timer: 0 };
    panel.classList.add('demo');
    // 演示看的是棋盘：讲解展开着的先收起来，棋盘放到最大
    if (sheet !== 'none') setSheet('none');
    navEl.innerHTML =
      tb('data-act="demo-prev" title="上一步"', '◀', '上一步') +
      tb('data-act="demo-play"', '⏸', '暂停', 'warn') +
      tb('data-act="demo-next" title="下一步"', '▶', '下一步') +
      tb('data-act="demo-end"', '✕', '结束演示', 'wide');
    scene.select(null);
    scene.setBadge(null);
    scene.setArrows([]);
    // 从走之前的局面开始，第一步就是这一路的第一手（对比摆法下棋盘本来就在走之前）
    scene.syncBoard(boards[at]);
    demoShow(1);
    demoAuto(true);
  }
  /** 演示到第 k 步：棋盘走过去、下面讲这一步在干什么 */
  function demoShow(k: number) {
    if (!demo) return;
    const { d } = demo;
    const n = d.steps.length;
    k = Math.max(1, Math.min(n, k));
    demo.k = k;
    const st = d.steps[k - 1];
    scene.syncBoard(applyMove(st.before, st.move));
    scene.setLastMove(st.move, false);
    scene.setArrows(k < n ? [{ ...d.steps[k].move, color: 'rgba(255,215,110,0.45)' }] : []);
    const isMe = (st.who === 'me') === d.mine;
    const who = k === 1 ? d.firstWho : isMe ? '你' : '对手';
    const dots = d.steps.map((x, j) => `<i class="${j < k ? 'on' : ''}${(x.who === 'me') === d.mine ? '' : ' foe'}"></i>`).join('');
    elDetail.innerHTML = `<div class="xq-rv-demo" data-demo>
      <div class="pg">${d.title} · 第 ${k} / ${n} 步<span class="dots">${dots}</span></div>
      <div class="now ${isMe ? 'me' : 'foe'}"><span class="w">${who}</span><b>${st.text}</b><em>${st.note}${st.tags.length ? `（${st.tags.join('、')}）` : ''}</em></div>
      ${k === n ? `<div class="sum">${d.summary}</div>` : `<div class="nx">下一步：${(d.steps[k].who === 'me') === d.mine ? '你' : '对手'} ${d.steps[k].text}（棋盘上淡黄箭头）</div>`}
    </div>`;
    if (k === n) demoAuto(false);
  }
  function demoAuto(on: boolean) {
    if (!demo) return;
    clearInterval(demo.timer);
    demo.timer = 0;
    if (on) demo.timer = window.setInterval(() => demo && demoShow(demo.k + 1), 1400);
    const b = navEl.querySelector('[data-act="demo-play"]') as HTMLButtonElement | null;
    if (b) {
      const [icon, label] = on ? ['⏸', '暂停'] : demo.k >= demo.d.steps.length ? ['↻', '再看一遍'] : ['▶', '自动'];
      b.innerHTML = `<i>${icon}</i><span>${label}</span>`;
    }
  }
  /** 推演板：从这一手走之前的局面开始，先摆最佳走法这一路，任何一步都能问"还有哪几种走法" */
  function openLab() {
    const m = reviewed()[cursor];
    if (!m) return;
    openLineLab({
      board: boards[cursor],
      turn: m.color,
      line: m.bestLine?.length ? m.bestLine : m.bestMove ? [m.bestMove] : [],
      title: `第 ${roundOf(m.ply)} 回合 · 推演`,
      intro: `这一手${m.color === playerColor ? '你' : '对手'}走的是 ${m.text}${m.bestText ? `，最佳是 ${m.bestText}` : ''}。点「下一步」看最佳这一路，或者点「🔀 几种走法」看别的走法各自怎么发展`,
      me: playerColor,
      flip: playerColor === 'b',
      forkFirst: true,
    });
  }

  /** 收起演示（不动棋盘）：翻到别的手、关掉复盘时用 */
  function stopDemo() {
    if (!demo) return;
    clearInterval(demo.timer);
    demo = null;
    panel.classList.remove('demo');
    navEl.innerHTML = navHtml;
    setSheetButtons();
  }
  function endDemo() {
    stopDemo();
    goto(cursor);
  }
  /** 工具条换回来以后，讲解 / 报告按钮的"按下"状态跟着面板 */
  function setSheetButtons() {
    navEl.querySelector('[data-act="detail"]')?.classList.toggle('on', sheet === 'detail');
    navEl.querySelector('[data-act="overview"]')?.classList.toggle('on', sheet === 'report');
  }

  // ───────── 试下：在复盘的棋盘上自己走走看 ─────────
  /**
   * 天天象棋复盘里最常用的一样：看到一手不满意，直接在棋盘上换一种走法，看对手怎么应。
   * 用户原话："增加一个复盘时，我如果按照我的想法走棋对方会怎么接，教练讲解再细致一些。"
   * 点轮到走的那一方的子就进来（或者卡片上「🧪 换一手试试」、工具条上的 🧪 试下）；你走一步，引擎替对方应一步。
   * 每一步都讲：你这手在干什么、评级、对方接的那手在干什么、引擎预计接下来怎么走；
   * 走差了说对方怎么罚、这里最好走什么；第一手还和实战那一手比。棋谱一手不动。
   */
  interface TrialStep {
    text: string;
    label?: MoveLabel;
    replyText?: string;
    /** 这一步的教练讲解（HTML） */
    talk?: string;
    /** 对方应完之后，引擎预计的后续（从哪个局面、谁先走、哪几手）：「▶ 看后续」打开推演板 */
    follow?: { board: Board; turn: Color; line: Move[] };
  }
  interface Trial {
    start: Board;
    /** 试下从哪一方开始走（你替这一方走，引擎替另一方应） */
    first: Color;
    moves: Move[];
    log: { text: string; color: Color }[];
    /** 这个局面在棋谱里对应的那一手（拿它的最佳分来比），没有就是 -1 */
    ref: number;
    sel: { x: number; y: number } | null;
    busy: boolean;
    token: number;
    /** 引擎起得来就替对方应；起不来两边都由你走 */
    auto: boolean;
    verdict: string;
    evalText: string;
    say: string;
    /** 你走的每一步（引擎应的那手记在同一条里） */
    steps: TrialStep[];
  }
  let trial: Trial | null = null;
  let lastSwipe = 0;

  /** 棋盘上现在摆的是哪个局面、轮到谁走 */
  function shownPosition(): { board: Board; turn: Color; ref: number } {
    const list = reviewed();
    if (cursor >= 0 && compare) return { board: boards[cursor], turn: list[cursor].color, ref: cursor };
    const turn: Color = cursor >= 0 ? other(list[cursor].color) : startColor;
    const ref = list[cursor + 1] && list[cursor + 1].color === turn ? cursor + 1 : -1;
    return { board: boards[cursor + 1], turn, ref };
  }
  const trialBoard = (t: Trial) => t.moves.reduce((b, m) => applyMove(b, m), t.start);
  const trialTurn = (t: Trial): Color => (t.moves.length % 2 === 0 ? t.first : other(t.first));
  const legalOf = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

  /** at：从哪个局面开始（卡片上的「🧪 换一手试试」从这一手走之前开始）；不给就是棋盘上现在摆的 */
  function startTrial(tap?: { x: number; y: number }, at?: { board: Board; turn: Color; ref: number }) {
    stopDemo();
    const p = at ?? shownPosition();
    trial = { start: p.board, first: p.turn, moves: [], log: [], ref: p.ref, sel: null, busy: false, token: 0, auto: true, verdict: '', evalText: '', say: '', steps: [] };
    if (sheet !== 'none') setSheet('none');
    panel.classList.add('trial');
    navEl.innerHTML =
      tb('data-act="trial-undo" title="退回你上一步之前"', '↶', '悔一步') +
      tb('data-act="trial-follow" title="对方应完之后引擎预计怎么走：在推演板上一步步看"', '▶', '看后续') +
      tb('data-act="trial-lab" title="引擎列出这一步的几种走法"', '🔀', '几种走法') +
      tb('data-act="trial-end" title="回到棋谱"', '✕', '结束试下', 'wide');
    scene.setArrows([]);
    scene.setBadge(null);
    scene.select(null);
    scene.syncBoard(p.board);
    renderTrial();
    void loadEngine();
    if (tap) trialTap(tap.x, tap.y);
  }
  /** 收起试下（不动棋盘）：翻到别的手、演示、关掉复盘时用 */
  function stopTrial() {
    if (!trial) return;
    trial.token++;
    trial = null;
    panel.classList.remove('trial');
    navEl.innerHTML = navHtml;
    setSheetButtons();
    scene.select(null);
  }
  function endTrial() {
    stopTrial();
    goto(cursor);
  }

  function trialTap(x: number, y: number) {
    const t = trial;
    if (!t || t.busy) return;
    const b = trialBoard(t);
    const c = trialTurn(t);
    if (t.auto && c !== t.first) return;
    const legal = legalOf(b, c);
    if (t.sel) {
      const mv = legal.find((m) => m.fx === t.sel!.x && m.fy === t.sel!.y && m.tx === x && m.ty === y);
      if (mv) {
        t.sel = null;
        scene.select(null);
        void trialPlay(mv);
        return;
      }
    }
    const pc = b[y][x];
    if (pc && pc.c === c) {
      t.sel = { x, y };
      scene.select(
        { x, y },
        legal.filter((m) => m.fx === x && m.fy === y).map((m) => ({ x: m.tx, y: m.ty, capture: !!b[m.ty][m.tx] })),
      );
    } else {
      t.sel = null;
      scene.select(null);
    }
  }

  async function trialPlay(mv: Move) {
    const t = trial;
    if (!t) return;
    const b = trialBoard(t);
    const c = trialTurn(t);
    const text = textOf(b, mv);
    t.log.push({ text, color: c });
    t.moves.push(mv);
    const step: TrialStep = { text };
    if (c === t.first) t.steps.push(step);
    const nb = applyMove(b, mv);
    scene.setBadge(null);
    scene.syncBoard(nb);
    scene.setLastMove(mv, false);
    if (!legalOf(nb, other(c)).length) {
      t.say = isInCheck(nb, other(c)) ? '将死了！' : '对方无棋可走（困毙）。';
      t.evalText = '';
      return renderTrial();
    }
    if (!t.auto) return renderTrial();
    t.busy = true;
    t.say = '';
    const my = ++t.token;
    renderTrial();
    if (!engineReady()) await loadEngine();
    if (trial !== t || my !== t.token) return;
    if (!engineReady()) {
      t.auto = false;
      t.busy = false;
      t.say = '引擎没起来：对方这一步也由你来走。';
      return renderTrial();
    }
    /*
     * 一次搜索拿全：这个局面最好的一手、你这一手（include）的分和主变。
     * 你这手的主变第二手就是对方的应着，再往后是引擎预计的后续——评级、应着、后续、讲解都出自同一次计算，不会互相打架。
     */
    const list = await engineAnalyse(b, c, { movetime: 1100, multipv: 2, include: mv });
    if (trial !== t || my !== t.token) return;
    const best = list?.find((s) => !s.bound);
    // 你这手不在前几名里、补算也没回来（引擎忙、搜索被打断）：再单独算一次，讲解不能空着
    const mine = list?.find((s) => !s.bound && same(s.move, mv)) ?? (await engineScoreMove(b, c, mv, { movetime: 1000 })) ?? undefined;
    if (trial !== t || my !== t.token) return;
    let reply: Move | undefined = mine?.pv[1];
    if (reply && !legalOf(nb, other(c)).some((m) => same(m, reply!))) reply = undefined;
    if (!reply) {
      const r2 = await engineAnalyse(nb, other(c), { movetime: 800, multipv: 1 });
      if (trial !== t || my !== t.token) return;
      reply = r2?.find((s) => !s.bound)?.move;
    }
    t.busy = false;
    if (!reply) return renderTrial();
    if (mine && best) {
      const loss = same(best.move, mv) ? 0 : mine.mateIn !== undefined && mine.mateIn > 0 ? 0 : Math.max(0, best.score - mine.score);
      step.label = loss < 10 || same(best.move, mv) ? 'top' : gradeOf(loss);
      step.talk = trialTalk(b, c, t.first, mv, mine, best, loss, reply);
      // 第一手还和实战那一手比
      if (t.steps.length === 1 && step === t.steps[0]) t.verdict = rateTry(t, mv, mine.score, mine.mateIn);
      const red = c === 'r' ? mine.score : -mine.score;
      const redMate = mine.mateIn === undefined ? undefined : c === 'r' ? mine.mateIn : -mine.mateIn;
      t.evalText = evalWords(red, redMate);
    }
    const nb2 = applyMove(nb, reply);
    step.replyText = textOf(nb, reply);
    const rest = mine && mine.pv.length > 2 && same(mine.pv[1], reply) ? mine.pv.slice(2, 10) : [];
    step.follow = rest.length ? { board: nb2, turn: c, line: rest } : undefined;
    t.log.push({ text: step.replyText, color: other(c) });
    t.moves.push(reply);
    scene.syncBoard(nb2);
    scene.setLastMove(reply, false);
    if (step.label) scene.setBadge(null);
    renderTrial();
  }

  /**
   * 试下这一步的教练讲解：你这手在干什么、评级；对方接的那手在干什么；引擎预计接下来怎么走；
   * 走差了说对方怎么罚、这里最好走什么。全是皮卡鱼这一次算出来的着法，讲解只是翻译。
   */
  function trialTalk(b: Board, c: Color, me: Color, mv: Move, mine: MoveScore, best: MoveScore, loss: number, reply: Move): string {
    const lb: MoveLabel = loss < 10 || same(best.move, mv) ? 'top' : gradeOf(loss);
    const L = MOVE_LABEL[lb];
    const nb = applyMove(b, mv);
    const nb2 = applyMove(nb, reply);
    const you = c === playerColor ? '你' : '你（替对手走）';
    const rows: string[] = [];
    rows.push(
      `<div class="xq-talk-row"><span class="k">${you}走</span><b>${textOf(b, mv)}</b> <span class="lv" style="--g:${L.badge}">${L.short}</span>：${whatItDoes(b, mv, c, me)}。</div>`,
    );
    rows.push(`<div class="xq-talk-row"><span class="k">对方接</span><b>${textOf(nb, reply)}</b>：${whatItDoes(nb, reply, other(c), me)}。</div>`);
    const rest = mine.pv.length > 2 && same(mine.pv[1], reply) ? mine.pv.slice(2) : [];
    if (rest.length) rows.push(`<div class="xq-talk-row"><span class="k">接下来大概</span>（皮卡鱼预计，点 ▶ 看后续 在棋盘上一步步走）</div>${lineTalk(nb2, rest, c, me, 4)}`);
    if (loss >= 150) {
      const p = punishLine(b, mine.pv, c, 7, { me: '你', foe: '对方' });
      if (p) rows.push(`<div class="xq-talk-sum">⚠️ ${p.summary}</div>`);
    }
    if (lb === 'top') rows.push(`<div class="xq-talk-row good">👍 ${same(best.move, mv) ? '这就是皮卡鱼的首选' : '和最好的一手一样好'}。</div>`);
    else if (loss < 30) rows.push(`<div class="xq-talk-row good">👍 和最好的一手（${textOf(b, best.move)}）差不多。</div>`);
    else
      rows.push(
        `<div class="xq-talk-row good"><span class="k">这里最好</span><b>${textOf(b, best.move)}</b>：${whatItDoes(b, best.move, c, me)}——比你这手多约 ${loss} 分（${inPieces(loss)}）。</div>`,
      );
    return `<div class="xq-talk" data-talk>${rows.join('')}</div>`;
  }

  /** 你试的第一手和这个局面的最佳比：评级（★ 优 良 中 差 错 漏）、比最佳少多少、比实战那一手好还是差 */
  function rateTry(t: Trial, mv: Move, score: number, mate?: number): string {
    const ref = t.ref >= 0 ? reviewed()[t.ref] : undefined;
    const text = t.log[0].text;
    if (!ref || ref.color !== t.first) return `试的是 <b>${text}</b>。`;
    let loss: number;
    if (same(mv, ref.move)) loss = ref.loss;
    else if (ref.bestMove && same(mv, ref.bestMove)) loss = 0;
    else if (mate !== undefined && mate > 0) loss = ref.bestMate !== undefined && ref.bestMate > 0 && ref.bestMate < mate ? 40 : 0;
    else if (mate !== undefined) loss = 2000;
    else loss = Math.max(0, ref.bestScore - score);
    const grade = gradeOf(loss);
    const lb: MoveLabel = loss < 10 || (ref.bestMove && same(mv, ref.bestMove)) ? 'top' : grade;
    const L = MOVE_LABEL[lb];
    const chip = `<span class="lv" style="--g:${L.badge}">${L.short}</span>`;
    const vsBest = lb === 'top' ? '这就是最佳走法' : loss < 30 ? `和最佳 ${ref.bestText ?? ''} 差不多` : `比最佳 <b>${ref.bestText ?? ''}</b> 少约 ${loss} 分`;
    const vsGame = same(mv, ref.move)
      ? '——就是实战走的那一手'
      : ref.loss - loss >= 30
        ? `，比实战走的 ${ref.text} <b class="up">好约 ${ref.loss - loss} 分</b>`
        : loss - ref.loss >= 30
          ? `，比实战走的 ${ref.text} <b class="down">还差约 ${loss - ref.loss} 分</b>`
          : `，和实战走的 ${ref.text} 差不多`;
    return `${chip} 你试的 <b>${text}</b>：${L.name}，${vsBest}${vsGame}。`;
  }

  function renderTrial() {
    const t = trial;
    if (!t) return;
    const who = (c: Color) => (c === playerColor ? '你' : '对手');
    const side = (c: Color) => (c === 'r' ? '红' : '黑');
    const at = t.ref >= 0 ? `第 ${roundOf(reviewed()[t.ref].ply)} 回合` : cursor >= 0 ? `第 ${roundOf(reviewed()[cursor].ply)} 回合之后` : '开局';
    // 引擎替对方应的时候一步一行："1. 你 车九进一〔差〕→ 对方 炮2进7"；两边都由你走的时候按原来那样排
    const log = t.auto
      ? t.steps
          .map((st, i) => {
            const L = st.label ? MOVE_LABEL[st.label] : null;
            return `<span class="me"><i>${i + 1}.${who(t.first)}</i>${st.text}${L ? ` <em class="lv" style="--g:${L.badge}">${L.short}</em>` : ''}${
              st.replyText ? ` <span class="foe">→ <i>${who(other(t.first))}</i>${st.replyText}</span>` : ''
            }</span>`;
          })
          .join('')
      : t.log.map((l, i) => `<span class="${l.color === t.first ? 'me' : 'foe'}"><i>${i % 2 === 0 ? `${Math.floor(i / 2) + 1}.` : ''}${who(l.color)}</i>${l.text}</span>`).join('');
    const last = t.steps[t.steps.length - 1];
    const c = trialTurn(t);
    const tip = t.busy
      ? `${who(c)}在想怎么应……`
      : t.say ||
        (t.moves.length
          ? `接着点${side(c)}子再走一步，或者「↶ 悔一步」换一种走法${last?.follow ? '，「▶ 看后续」在棋盘上看引擎预计的后续' : ''}。`
          : `点一个${side(c)}子，再点它要去的地方。${t.auto ? `${who(other(c))}由引擎来应。` : ''}`);
    elDetail.innerHTML = `<div class="xq-rv-trial" data-trial>
      <div class="hd">🧪 试下 · 从${at}${side(t.first)}方走之前 · 不影响棋谱</div>
      ${log ? `<div class="log">${log}</div>` : ''}
      ${t.verdict ? `<div class="vd">${t.verdict}</div>` : ''}
      ${last?.talk && !t.busy ? last.talk : ''}
      ${t.evalText && !t.busy ? `<div class="ev">现在的局面：${t.evalText}</div>` : ''}
      <div class="tip">${tip}</div>
    </div>`;
  }

  function trialUndo() {
    const t = trial;
    if (!t) return;
    t.token++;
    t.busy = false;
    if (!t.moves.length) return endTrial();
    // 退回你上一步之前：引擎应过的话连它那一手一起退
    const n = t.auto ? (t.moves.length % 2 === 0 ? 2 : 1) : 1;
    t.moves.splice(-n);
    t.log.splice(-n);
    t.steps.pop();
    t.sel = null;
    t.say = '';
    t.evalText = '';
    if (!t.moves.length) t.verdict = '';
    scene.select(null);
    scene.syncBoard(trialBoard(t));
    scene.setLastMove(t.moves.length ? t.moves[t.moves.length - 1] : null, false);
    renderTrial();
  }

  /** 对方应完之后引擎预计怎么走：在推演板上一步步看（每一步还能点 🔀 换一条路） */
  function trialFollow() {
    const t = trial;
    const f = t?.steps[t.steps.length - 1]?.follow;
    if (!t || !f) {
      if (t) {
        t.say = t.steps.length ? '这一步之后皮卡鱼没给出更长的后续，接着自己走走看。' : '先在棋盘上走一步，再看后续。';
        renderTrial();
      }
      return;
    }
    openLineLab({
      board: f.board,
      turn: f.turn,
      line: f.line,
      title: '试下 · 接下来大概怎么走',
      intro: '对方应完之后，皮卡鱼预计的后续',
      me: t.first,
      flip: playerColor === 'b',
    });
  }

  /** 试到这里想看"这一步还有哪几种走法"：推演板接着这个局面，引擎列前三 */
  function trialLab() {
    const t = trial;
    if (!t) return;
    openLineLab({
      board: trialBoard(t),
      turn: trialTurn(t),
      line: [],
      title: '试下 · 几种走法',
      intro: '这是你试下走到的局面',
      me: playerColor,
      flip: playerColor === 'b',
      forkFirst: true,
    });
  }

  /** 点棋盘：试下中就是走棋；不在试下时，点到轮到走的那一方的子直接进试下 */
  function onBoardTap(x: number, y: number) {
    if (Date.now() - lastSwipe < 400 || demo) return;
    if (trial) return trialTap(x, y);
    const p = shownPosition();
    const pc = p.board[y]?.[x];
    if (pc && pc.c === p.turn) startTrial({ x, y });
    else if (pc) flashMeta(`现在轮到${p.turn === 'r' ? '红' : '黑'}方走：点${p.turn === 'r' ? '红' : '黑'}子试下，或者先 ◀ 退一手`);
  }
  /** 局势图上面那一小行临时说一句话，过一会儿换回分析进度 */
  let flashTimer = 0;
  function flashMeta(text: string) {
    clearTimeout(flashTimer);
    elProgress.textContent = text;
    elProgress.classList.add('flash');
    flashTimer = window.setTimeout(() => {
      elProgress.classList.remove('flash');
      onProgress();
    }, 2200);
  }
  scene.setTapOverride(onBoardTap);

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
    const label = navEl.querySelector('[data-act="next-bad"] span') as HTMLElement | null;
    if (!label) return;
    label.textContent = analysis.done ? '没有问题手' : '还在打分';
    setTimeout(() => (label.textContent = '问题手'), 1600);
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
    lastSwipe = Date.now();
    if (trial) return; // 试下时手指在棋盘上是走棋，不翻页
    if (demo) {
      demoAuto(false);
      demoShow(demo.k + (dx < 0 ? 1 : -1));
    } else goto(cursor + (dx < 0 ? 1 : -1));
  };
  const onKey = (e: KeyboardEvent) => {
    const el = e.target as HTMLElement | null;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
    if (e.key === 'Home' || e.key === 'End') {
      goto(e.key === 'Home' ? -1 : reviewed().length - 1);
      return;
    }
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

  /**
   * 问教练。上下文取的是**当前选中的那一手**——
   * 用户点着第 12 回合问"这一步为什么错"，答的必须是第 12 回合那一手。
   */
  let closeChat: (() => void) | null = null;
  function toggleChat() {
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
  }
  /*
   * 手机竖屏：棋盘尽量大、整块露出来，面板只占棋盘下面剩下的那一截（至少放得下局势图、这一手的卡片和工具条）。
   * 用户原话："复盘时要能看到完整的棋局界面，不能光在底下显示一堆文字，否则很难和棋局联系起来。"
   * 点 📖 讲解 / 📊 报告：面板升高、棋盘跟着缩小，但永远完整、不被盖住；宽屏是右侧面板，不用管。
   */
  const MIN_PANEL = 196;
  function layout() {
    const appH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || window.innerHeight;
    const w = host.clientWidth || window.innerWidth;
    if (w >= 720) {
      host.style.removeProperty('--rv-h');
    } else {
      const boardH = ((w - 6) * 11.2) / 9.9; // 棋盘满宽时有多高（和 board2d 的比例一致）
      const h = sheet !== 'none' ? Math.max(MIN_PANEL, appH * 0.6) : Math.min(appH * 0.52, Math.max(MIN_PANEL, appH - boardH - 6));
      host.style.setProperty('--rv-h', `${Math.round(h)}px`);
    }
    requestAnimationFrame(drawGraph);
  }
  layout();
  window.addEventListener('resize', layout);
  window.visualViewport?.addEventListener('resize', layout);

  // 点棋盘上的箭头：绿 ★ 看最佳走法的后续，红「你」看这一手的后果，绿「罚」看怎么罚他
  scene.setArrowTap((id) => {
    if (demo || trial) return;
    if (id === 'best') startDemo('best');
    else if (id === 'mine' || id === 'punish') startDemo('punish');
  });

  goto(-1);
  onProgress();
  requestAnimationFrame(drawGraph);

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqReview = {
      cursor: () => cursor,
      sheet: () => sheet,
      tap: (x: number, y: number) => onBoardTap(x, y),
      shown: () => {
        const p = shownPosition();
        return { turn: p.turn, ref: p.ref, fen: toFen(p.board, p.turn) };
      },
      trial: () =>
        trial
          ? {
              moves: trial.moves.length,
              busy: trial.busy,
              auto: trial.auto,
              verdict: trial.verdict,
              log: trial.log.map((l) => l.text),
              steps: trial.steps.map((st) => ({ text: st.text, label: st.label, reply: st.replyText, talk: !!st.talk, follow: st.follow?.line.length ?? 0 })),
            }
          : null,
    };
  }

  function close() {
    clearTimeout(flashTimer);
    stopDemo();
    stopTrial();
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
    scene.setArrows([]);
    scene.setArrowTap(undefined);
    scene.setTapOverride(undefined);
    scene.syncBoard(boards[boards.length - 1]);
  }
  return close;
}
