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
  headlineOf,
  reviewMove,
  summarize,
  tagCounts,
  GRADE_LABEL,
  GRADE_COLOR,
  type GameReview,
  type Judged,
  type ReviewedMove,
} from './analysis';
import { setGameReview } from './archive';
import { runChat, type ChatContext } from './chat';
import { deepFacts } from './deepcoach';
import { explain } from './llm';
import { mdToHtml } from './livecoach';
import type { BoardView } from './boardview';
import { toFen } from './notation';
import { addOwnPuzzle, recordGame } from './save';

const esc = (t: string) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** 复盘搜索深度：和对局难度无关，复盘永远用同一把尺子量 */
const REVIEW_DEPTH = 6;
const REVIEW_TIME = 1500;

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
  /**
   * 这一局在存档里的 id。复盘算完之后把结论回填过去，
   * 首页的"最近棋局"才能显示"这盘错在哪"，而不是只有一个日期。
   */
  archiveId?: string;
  /**
   * 对局里教练已经算过的判读（第几手 → 当时的研究结果）。
   * 比复盘自己算得深的就直接用：同一手棋，对局里教练怎么说、复盘就怎么说，
   * 不能对局里说"没问题"、复盘又打成"失误"。
   */
  known?: Map<number, Judged>;
  /** 教练拦过、你坚持走了的那几手（第几手 → 教练当时的话） */
  coachFlags?: Map<number, string>;
  onClose: () => void;
}

export function runReview(opts: ReviewOpts): () => void {
  const { host, scene, startBoard, startColor, moves, playerColor, playerWon, archiveId, onClose } = opts;
  const coachFlags = opts.coachFlags ?? new Map<number, string>();

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
      <button class="xq-rv-ask" title="问教练">🧑‍🏫 问教练</button>
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
      elDetail.innerHTML = '<div class="xq-rv-empty">点上面任意一手，看看那步走得怎么样。</div>';
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
      ${coachFlags.has(m.ply) ? `<div class="xq-rv-flag">🧑‍🏫 对局时教练拦过这一手，你选择了"就这么走"。教练当时说：${esc(coachFlags.get(m.ply)!)}</div>` : ''}
      ${m.bestPv ? `<div class="xq-rv-pv"><span>正确下法</span>${m.bestPv.join(' ')}</div>` : ''}
      <button class="xq-rv-deep" data-deep="${cursor}">🔍 从全局讲讲这一手</button>
      <div class="xq-rv-deepbox"></div>`;
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
          ${coachFlags.has(m.ply) ? '<span class="f" title="教练拦过">🧑‍🏫</span>' : ''}
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
  /**
   * 深度解读。
   *
   * 和上面那句一句话点评是两个层次：点评回答"这手掉了什么坑"，
   * 深度解读回答"这手在做什么、全局上值不值、还有什么更好的、为什么"。
   * 它要现跑一次搜索（一两秒），所以做成按需展开而不是一进来就算——
   * 一盘六十手全算一遍要一分多钟，没人等得了。
   */
  async function showDeep(i: number) {
    const m = reviewed[i];
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
        grade: GRADE_LABEL[m.grade],
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

  panel.addEventListener('click', (e) => {
    const deep = (e.target as HTMLElement).closest('[data-deep]') as HTMLElement | null;
    if (deep) {
      void showDeep(Number(deep.dataset.deep));
      return;
    }
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

  /**
   * 问教练。上下文取的是**当前选中的那一手**——
   * 用户点着第 12 回合问"这一步为什么错"，答的必须是第 12 回合那一手，
   * 而不是整局的总结。所以这里传的是一个取值函数，不是快照。
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
        const me = report?.stats[playerColor];
        const wi = report?.worst[playerColor] ?? -1;
        const w = wi >= 0 ? report!.moves[wi] : null;
        const cur = cursor >= 0 ? reviewed[cursor] : null;
        return {
          side: playerColor === 'r' ? '红' : '黑',
          stats: me ? { ...me, won: playerWon } : undefined,
          problem: w ? w.comment : undefined,
          focus: cur
            ? {
                round: Math.floor(cur.ply / 2) + 1,
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

  // ---- 启动分析 ----
  const cancel = requestReview(
    startBoard,
    startColor,
    moves,
    { maxDepth: REVIEW_DEPTH, timeMs: REVIEW_TIME, jitter: 0 },
    (ply, color, board, judged) => {
      const k = opts.known?.get(ply);
      // 对局里的判读只在"精确、且不比复盘浅"时才用。只有下限的（差得太多、没精确算）
      // 交给复盘自己算——拿下限当亏损，丢车的棋会被评成"不佳"
      const use = k && !k.played.bound && (!judged || k.depth >= judged.depth) ? k : judged;
      if (use) {
        reviewed.push(reviewMove(board, ply, color, use));
      }
      elProgress.textContent = `分析中 ${ply + 1}/${moves.length}`;
      renderList();
    },
    () => {
      report = summarize(reviewed);
      harvest(report);
      elProgress.textContent = `共 ${moves.length} 手`;
      renderSummary();
      // 分析完直接跳到「你最该改的一手」——学棋要看的是自己的错
      const jump = report.worst[playerColor] >= 0 ? report.worst[playerColor] : report.turning;
      goto(jump >= 0 ? jump : reviewed.length - 1);
    },
  );

  /**
   * 把这一局的成绩记下来，并把**你自己走错的那几手做成题**排进错题本。
   *
   * 题库里的题是通用的，这些是你真的走错过的局面——同一个坑掉第二次，
   * 才说明是真没长进。这是整套系统里最针对个人的一块。
   */
  function harvest(rep: GameReview) {
    const me = rep.stats[playerColor];
    // 把这一局的结论回填到存档：首页列表、错误画像、出题全靠它
    if (archiveId) {
      const wi = rep.worst[playerColor];
      const w = wi >= 0 ? rep.moves[wi] : null;
      setGameReview(archiveId, {
        blunders: me.blunders,
        mistakes: me.mistakes,
        avgLoss: me.avgLoss,
        tags: tagCounts(rep.moves, playerColor),
        worstPly: w?.ply,
        worstText: w?.text,
        worstLoss: w?.loss,
        headline: headlineOf(rep.moves, playerColor),
      });
    }
    recordGame({
      won: !!playerWon,
      blunders: me.blunders,
      mistakes: me.mistakes,
      avgLoss: me.avgLoss,
      // 这盘的分分别丢在哪一维——每日训练就是照着这个排的
      lossBy: rep.lossBy[playerColor],
      plies: rep.moves.filter((m) => m.color === playerColor).length,
    });
    let saved = 0;
    rep.moves.forEach((m, i) => {
      if (m.color !== playerColor) return;
      if (m.grade !== 'blunder' && m.grade !== 'mistake') return;
      if (!m.bestMove || !m.bestText) return;
      const before = boards[i];
      const ok = addOwnPuzzle({
        // 用复盘归因出来的维度。原来是"漏着算眼力、失误算战术"，
        // 那只看错的严重程度，不看错的**性质**——开局吃亏和残局走软是两回事
        kind: m.dim,
        fen: toFen(before, m.color),
        answer: m.bestText,
        line: m.bestPv ?? [m.bestText],
        // 难度按亏损给：丢得越多说明越该一眼看出来，题反而越"简单"
        rating: Math.round(Math.max(700, 1500 - m.loss / 3)),
      });
      if (ok) saved++;
    });
    if (saved > 0) {
      const tip = document.createElement('div');
      tip.className = 'xq-rv-harvest';
      tip.innerHTML = `📌 已把你这局走错的 <b>${saved}</b> 手存进错题本，过几天会回来找你。`;
      elSummary.appendChild(tip);
    }
  }

  goto(-1);

  function close() {
    cancel();
    closeChat?.();
    closeChat = null;
    panel.remove();
    scene.select(null);
    scene.syncBoard(boards[boards.length - 1]);
  }
  return close;
}
