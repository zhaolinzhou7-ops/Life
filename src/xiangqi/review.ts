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
      <b>复盘</b>
      <span class="xq-rv-progress">分析中 0/${moves.length}</span>
      <button class="xq-rv-hbtn" data-act="copy" title="复制棋谱">📋</button>
      <button class="xq-rv-ask" title="问教练">🧑‍🏫 问教练</button>
      <button class="xq-rv-fold" title="收起/展开">▾</button>
      <button class="xq-rv-close">✕</button>
    </div>
    <div class="xq-rv-body">
      <div class="xq-rv-score">
        <div class="xq-rv-side me"><span>你</span><b>—</b><em>准确率</em></div>
        <canvas class="xq-rv-graph"></canvas>
        <div class="xq-rv-side foe"><span>对手</span><b>—</b><em>准确率</em></div>
      </div>
      <div class="xq-rv-summary"></div>
      <div class="xq-rv-list"></div>
      <div class="xq-rv-detail"></div>
    </div>
    <div class="xq-rv-nav">
      <button class="xq-btn" data-go="-1">◀ 上一手</button>
      <span class="xq-rv-pos">开局</span>
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
    const list = reviewed();
    cursor = Math.max(-1, Math.min(list.length - 1, i));
    scene.syncBoard(boards[cursor + 1]);
    drawGraph();

    if (cursor < 0) {
      elPos.textContent = '开局';
      elDetail.innerHTML = '<div class="xq-rv-empty">点下面任意一手，或者点上面的曲线，看看那一步走得怎么样。</div>';
      scene.select(null);
      renderList();
      return;
    }

    const m = list[cursor];
    elPos.textContent = `第 ${roundOf(m.ply)} 回合 · ${sideName(m.color)}`;
    const lb = labelOf(m);
    const L = MOVE_LABEL[lb];

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
        <span class="xq-rv-acc" title="这一手的准确率">${m.accuracy} 分</span>
      </div>
      <div class="xq-rv-eval">局面：${before === after ? before : `${before} → ${after}`}</div>
      <div class="xq-rv-comment">${badgeWhy(m)}${m.comment}</div>
      ${coachFlags.has(m.ply) ? `<div class="xq-rv-flag">🧑‍🏫 对局时教练拦过这一手，你选择了"就这么走"。教练当时说：${esc(coachFlags.get(m.ply)!)}</div>` : ''}
      ${planBlock(m, boards[cursor])}
      ${endgameNote(m, boards[cursor])}
      <div class="xq-rv-actions">
        <button class="xq-rv-deep" data-deep="${cursor}">🔍 从全局讲讲这一手</button>
        ${opts.onReplayFrom ? `<button class="xq-rv-deep" data-replay="${cursor}">♟ 从这里重下</button>` : ''}
      </div>
      <div class="xq-rv-deepbox"></div>`;
    renderList();
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

    elSummary.innerHTML = `
      <div class="xq-rv-chips">${chips}</div>
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
      ${analysis.savedPuzzles > 0 ? `<div class="xq-rv-harvest">📌 已把你这局走错的 <b>${analysis.savedPuzzles}</b> 手存进错题本，过几天会回来找你。</div>` : ''}
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
      // 分析完直接跳到「你最该改的一手」——学棋要看的是自己的错
      if (!jumped) {
        jumped = true;
        const rep = analysis.report!;
        const jump = rep.worst[playerColor] >= 0 ? rep.worst[playerColor] : rep.turning;
        goto(jump >= 0 ? jump : reviewed().length - 1);
        return;
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
  });
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
  // 面板在手机上会挡住红方底线，收起后只留点评和翻页，棋盘完整可见
  const foldBtn = panel.querySelector('.xq-rv-fold') as HTMLButtonElement;
  foldBtn.onclick = () => {
    const folded = panel.classList.toggle('mini');
    foldBtn.textContent = folded ? '▴' : '▾';
  };

  goto(-1);
  onProgress();
  requestAnimationFrame(drawGraph);

  function close() {
    offAnalysis();
    // 自己开的分析跟着复盘一起停；刚下完的棋那份归对局管（它还要落地存档和战绩）
    if (ownAnalysis && !analysis.done) analysis.cancel();
    window.removeEventListener('resize', onResize);
    closeChat?.();
    closeChat = null;
    panel.remove();
    scene.select(null);
    scene.syncBoard(boards[boards.length - 1]);
  }
  return close;
}
