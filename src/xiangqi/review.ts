/**
 * 复盘界面：下完一盘，把每一手的好坏摊开来看。
 *
 * 教学重点不是给分数，是让你看见**惩罚**：走到出错那手时，棋盘直接摆出
 * 对方的反驳着法，并把该走的正确一手标在盘上。光说"这步 -0.7"没人学得会。
 */
import type { Board, Color, Move } from './rules';
import { applyMove } from './rules';
import { requestReview } from './aiclient';
import {
  reviewMove,
  summarize,
  GRADE_LABEL,
  GRADE_COLOR,
  type GameReview,
  type ReviewedMove,
} from './analysis';
import type { XiangqiScene } from './scene3d';

/** 复盘搜索深度：和对局难度无关，复盘永远用同一把尺子量 */
const REVIEW_DEPTH = 6;
const REVIEW_TIME = 1500;

export interface ReviewOpts {
  host: HTMLElement;
  scene: XiangqiScene;
  startBoard: Board;
  startColor: Color;
  moves: Move[];
  /** 你执哪一方，用来在文案里称"你" */
  playerColor: Color;
  onClose: () => void;
}

export function runReview(opts: ReviewOpts): () => void {
  const { host, scene, startBoard, startColor, moves, playerColor, onClose } = opts;

  // 每一手走之前的局面，导航时直接取用
  const boards: Board[] = [startBoard];
  {
    let cur = startBoard;
    for (const m of moves) {
      cur = applyMove(cur, m);
      boards.push(cur);
    }
  }

  const reviewed: ReviewedMove[] = [];
  let report: GameReview | null = null;
  let cursor = -1; // -1 = 初始局面

  const panel = document.createElement('div');
  panel.className = 'xq-rv';
  panel.innerHTML = `
    <div class="xq-rv-head">
      <b>复盘</b>
      <span class="xq-rv-progress">分析中 0/${moves.length}</span>
      <button class="xq-rv-fold" title="收起/展开">▾</button>
      <button class="xq-rv-close">✕</button>
    </div>
    <div class="xq-rv-summary"></div>
    <div class="xq-rv-list"></div>
    <div class="xq-rv-detail"></div>
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

  const sideName = (c: Color) => (c === playerColor ? '你' : '对手');

  /** 把棋盘摆到第 i 手走完的样子；并把该走的正确着法标出来 */
  function goto(i: number) {
    cursor = Math.max(-1, Math.min(reviewed.length - 1, i));
    scene.syncBoard(boards[cursor + 1]);

    if (cursor < 0) {
      elPos.textContent = '开局';
      elDetail.innerHTML = '<div class="xq-rv-empty">点左边任意一手，看看那步走得怎么样。</div>';
      scene.select(null);
      renderList();
      return;
    }

    const m = reviewed[cursor];
    elPos.textContent = `第 ${Math.floor(m.ply / 2) + 1} 回合 · ${sideName(m.color)}`;

    // 走错了就把「该走的那一手」标在盘上：起点选中、终点画成可走点
    const bm = m.grade === 'best' || m.grade === 'good' ? null : m.bestMove;
    if (bm) {
      const before = boards[cursor];
      scene.select({ x: bm.fx, y: bm.fy }, [{ x: bm.tx, y: bm.ty, capture: !!before[bm.ty][bm.tx] }]);
    } else scene.select(null);

    elDetail.innerHTML = `
      <div class="xq-rv-move" style="--g:${GRADE_COLOR[m.grade]}">
        <span class="xq-rv-grade">${GRADE_LABEL[m.grade]}</span>
        <b>${m.text}</b>
        ${m.loss > 30 ? `<span class="xq-rv-loss">亏 ${m.loss}</span>` : ''}
      </div>
      <div class="xq-rv-comment">${m.comment}</div>
      ${m.bestPv ? `<div class="xq-rv-pv"><span>正确下法</span>${m.bestPv.join(' ')}</div>` : ''}`;
    renderList();
  }

  function renderList() {
    elList.innerHTML = reviewed
      .map((m, i) => {
        const bad = m.grade === 'blunder' || m.grade === 'mistake' || m.grade === 'dubious';
        const turn = report && report.turning === i;
        return `<button class="xq-rv-item${i === cursor ? ' on' : ''}${bad ? ' bad' : ''}${turn ? ' turn' : ''}"
          data-i="${i}" style="--g:${GRADE_COLOR[m.grade]}">
          <span class="n">${Math.floor(m.ply / 2) + 1}${m.color === startColor ? '.' : '…'}</span>
          <span class="t">${m.text}</span>
          ${bad ? `<span class="g">${GRADE_LABEL[m.grade]}</span>` : ''}
        </button>`;
      })
      .join('');
    const on = elList.querySelector('.xq-rv-item.on') as HTMLElement | null;
    on?.scrollIntoView({ block: 'nearest' });
  }

  function renderSummary() {
    if (!report) return;
    const me = report.stats[playerColor];
    const wi = report.worst[playerColor];
    const w = wi >= 0 ? report.moves[wi] : null;
    const t = report.turning >= 0 && report.turning !== wi ? report.moves[report.turning] : null;
    elSummary.innerHTML = `
      <div class="xq-rv-chips">
        <span class="xq-rv-chip bad">漏着 <b>${me.blunders}</b></span>
        <span class="xq-rv-chip warn">失误 <b>${me.mistakes}</b></span>
        <span class="xq-rv-chip">平均亏 <b>${me.avgLoss}</b></span>
      </div>
      ${
        w
          ? `<button class="xq-rv-turn" data-i="${wi}">
               ✍️ 你最该改的一手：第 ${Math.floor(w.ply / 2) + 1} 回合 <b>${w.text}</b>
             </button>`
          : '<div class="xq-rv-empty">这一局你没有明显失误。</div>'
      }
      ${
        t
          ? `<button class="xq-rv-turn alt" data-i="${report.turning}">
               🎯 决定胜负的一手：第 ${Math.floor(t.ply / 2) + 1} 回合 ${sideName(t.color)} <b>${t.text}</b>
             </button>`
          : ''
      }`;
  }

  // ---- 事件 ----
  panel.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('[data-i]') as HTMLElement | null;
    if (el) {
      goto(Number(el.dataset.i));
      return;
    }
    const go = (e.target as HTMLElement).closest('[data-go]') as HTMLElement | null;
    if (go) goto(cursor + Number(go.dataset.go));
  });
  (panel.querySelector('.xq-rv-close') as HTMLButtonElement).onclick = () => {
    close();
    onClose();
  };
  // 面板在手机上会挡住红方底线，收起后只留点评和翻页，棋盘完整可见
  const foldBtn = panel.querySelector('.xq-rv-fold') as HTMLButtonElement;
  foldBtn.onclick = () => {
    const folded = panel.classList.toggle('mini');
    foldBtn.textContent = folded ? '▴' : '▾';
  };

  // ---- 启动分析 ----
  const cancel = requestReview(
    startBoard,
    startColor,
    moves,
    { maxDepth: REVIEW_DEPTH, timeMs: REVIEW_TIME, jitter: 0 },
    (ply, color, board, judged) => {
      if (judged) {
        reviewed.push(reviewMove(board, ply, color, judged));
      }
      elProgress.textContent = `分析中 ${ply + 1}/${moves.length}`;
      renderList();
    },
    () => {
      report = summarize(reviewed);
      elProgress.textContent = `共 ${moves.length} 手`;
      renderSummary();
      // 分析完直接跳到「你最该改的一手」——学棋要看的是自己的错
      const jump = report.worst[playerColor] >= 0 ? report.worst[playerColor] : report.turning;
      goto(jump >= 0 ? jump : reviewed.length - 1);
    },
  );

  goto(-1);

  function close() {
    cancel();
    panel.remove();
    scene.select(null);
    scene.syncBoard(boards[boards.length - 1]);
  }
  return close;
}
