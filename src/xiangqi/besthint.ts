/**
 * 对局中求助：告诉我这一步最优解是什么。
 *
 * 和教练模式的区别：教练是**你走错了才开口**，这个是**你主动问**。
 * 两者用的是同一套引擎和同一套梯次，所以不会出现"求助说走这里、
 * 走完教练又说不行"——那是这个项目已经栽过一次的坑。
 *
 * 数据来自对局里的"研究"（study.ts）——和教练是同一份。你想棋的时候它已经在算了，
 * 所以多数时候一点开就是算完的结果；还没算完就边算边显示，并且标明"还在算"。
 */
import type { Board, Color, Move } from './rules';
import type { MoveScore } from './ai';
import { TIER_INFO, gapText, rankMoves, type RankedMove } from './tiers';

export interface HintResult {
  ranked: RankedMove[];
  best: RankedMove | null;
}

/** 把研究的着法表整理成求助要显示的样子 */
export function hintOf(board: Board, me: Color, moves: MoveScore[]): HintResult {
  const ranked = rankMoves(board, me, moves);
  return { ranked, best: ranked[0] ?? null };
}

/** 求助面板当前的状态：算到第几层、算完没有、有没有要额外交代的话 */
export interface HintState {
  depth: number;
  done: boolean;
  /** 附加说明，比如"刚才教练提醒过这一手，算深之后改判了" */
  note?: string;
  /**
   * 开局定式的着法。引擎认为它和首选一样好（分差在"次选"以内）时，
   * 面板**以定式为主**：开局阶段前几名只差十几分，那是误差，不是棋理。
   * 第一步就推荐"炮八平三"这种冷门棋，懂棋的人一看就觉得不专业。
   */
  book?: { move: Move; text: string; why: string; opening: string };
  /** 谁算的：专业引擎还是自带引擎。如实写出来 */
  engine?: 'fsf' | 'local';
}

export interface BestHintUI {
  host: HTMLElement;
  board: {
    setArrows(a: { fx: number; fy: number; tx: number; ty: number; color?: string }[]): void;
    select(sel: { x: number; y: number } | null, moves?: { x: number; y: number; capture?: boolean }[]): void;
  };
  onClose: () => void;
}

/** 前三手各用什么颜色：第一名最醒目，后面依次淡下去 */
const ARROW_COLORS = ['rgba(62,196,109,0.95)', 'rgba(232,200,90,0.75)', 'rgba(150,170,200,0.6)'];

/**
 * 弹出求助面板。
 *
 * 展示三档信息，从最直接到最完整：
 *   盘上箭头   —— 前三手直接画出来，一眼看见该往哪走
 *   一句话     —— 最优是哪一手、它想干什么
 *   完整梯次   —— 展开看全部选择和各自差多少
 */
export function showBestHint(opts: BestHintUI): { update: (r: HintResult, st: HintState) => void; close: () => void } {
  const el = document.createElement('div');
  el.className = 'xq-tip xq-besthint';
  el.innerHTML = `
    <div class="xq-tip-body">
      <span class="xq-tip-icon">🔍</span>
      <span class="xq-tip-text">正在算这个局面的最优解…</span>
    </div>
    <div class="xq-tip-status"></div>
    <div class="xq-tip-why"></div>
    <div class="xq-tip-bar">
      <button class="xq-btn" data-act="more">看完整梯次</button>
      <button class="xq-btn primary" data-act="close">知道了</button>
    </div>`;
  opts.host.appendChild(el);
  const elText = el.querySelector('.xq-tip-text') as HTMLElement;
  const elWhy = el.querySelector('.xq-tip-why') as HTMLElement;
  const elStatus = el.querySelector('.xq-tip-status') as HTMLElement;
  const elMore = el.querySelector('[data-act="more"]') as HTMLButtonElement;
  elMore.disabled = true;

  let latest: HintResult | null = null;

  const close = () => {
    opts.board.setArrows([]);
    el.remove();
  };

  el.addEventListener('click', (e) => {
    const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
    if (act === 'close') {
      close();
      opts.onClose();
    } else if (act === 'more' && latest) {
      elWhy.classList.toggle('on');
      elMore.textContent = elWhy.classList.contains('on') ? '收起' : '看完整梯次';
    }
  });

  const update = (full: HintResult, st: HintState) => {
    // 只有上限、没精确算过的着法不进列表——"落后 20+"这种数没有意义
    const r: HintResult = { ...full, ranked: full.ranked.filter((x) => !x.atLeast) };
    latest = r;
    // 算到第几层要摆出来：没算完的"最优"只是目前的看法，用户有权知道
    const who = st.engine === 'fsf' ? '专业引擎' : st.engine === 'local' ? '自带引擎' : '';
    elStatus.textContent =
      (st.done ? `已算完 ${st.depth} 层` : `已算 ${st.depth} 层，还在往深算…（结论可能还会变）`) + (who ? ` · ${who}` : '');
    if (!r.best) {
      elText.textContent = '这个局面已经没有可走的棋了。';
      return;
    }
    const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;
    const bookAt = st.book ? r.ranked.find((x) => same(x.move, st.book!.move)) : undefined;
    const lead = st.book && bookAt && (bookAt.tier === 'best' || bookAt.tier === 'good') ? bookAt : null;
    // 盘上画出前三手（定式领衔时，定式排第一）
    const shown = lead ? [lead, ...r.ranked.filter((x) => x !== lead)] : r.ranked;
    opts.board.setArrows(shown.slice(0, 3).map((x, i) => ({ ...x.move, color: ARROW_COLORS[i] })));
    opts.board.select({ x: shown[0].move.fx, y: shown[0].move.fy });
    const lost = r.best.score < -9000;
    if (lead && st.book) {
      const others = r.ranked.filter((x) => x !== lead && x.gap <= 30).slice(0, 2);
      elText.innerHTML =
        `开局按定式走 <b>${lead.text}</b>（${st.book.opening}：${st.book.why.replace(/。$/, '')}）。` +
        (others.length
          ? `　<span class="dim">引擎算下来 ${others.map((a) => a.text).join('、')} 也差不多——分差都在 30 以内，开局阶段这点差别是误差，先把定式走熟。</span>`
          : '') +
        (st.note ? `<div class="xq-tip-note">${st.note}</div>` : '');
    } else {
      const alt = r.ranked.slice(1, 3).filter((x) => x.gap <= 30);
      elText.innerHTML =
        `${st.done ? '最优' : '目前看最好'}是 <b>${r.best.text}</b>${r.best.why ? `（${r.best.why}）` : ''}。` +
        (lost ? '　<span class="dim">局面已经挡不住杀了，这是最顽强的一手。</span>' : '') +
        (alt.length ? `　<span class="dim">${alt.map((a) => a.text).join('、')} 也一样好。</span>` : '') +
        (st.note ? `<div class="xq-tip-note">${st.note}</div>` : '');
    }
    elWhy.innerHTML = r.ranked
      .slice(0, 8)
      .map((x) => {
        return `<div class="row"><i style="color:${TIER_INFO[x.tier].color}">${TIER_INFO[x.tier].name}</i>
          <b>${x.text}</b> <span>${gapText(x)}</span>${x.why ? `<em>${x.why}</em>` : ''}</div>`;
      })
      .join('');
    elMore.disabled = false;
  };

  return { update, close };
}

/** 把一手棋画成箭头需要的形状 */
export const arrowOf = (m: Move, color?: string) => ({ ...m, color });
