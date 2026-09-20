/**
 * 对局中求助：告诉我这一步最优解是什么。
 *
 * 和教练模式的区别：教练是**你走错了才开口**，这个是**你主动问**。
 * 两者用的是同一套引擎和同一套梯次，所以不会出现"求助说走这里、
 * 走完教练又说不行"——那是这个项目已经栽过一次的坑。
 *
 * 强度上不省钱：用的是最高档的时间预算。你主动点了求助，等几秒换一个
 * 靠得住的答案是划算的；给个半秒算出来的"最优解"反而是害人。
 */
import type { Board, Color, Move } from './rules';
import { requestAnalysis } from './aiclient';
import { TIER_INFO, rankMoves, type RankedMove } from './tiers';

/** 求助用的搜索预算。和最高难度同一档——既然是"最优解"，就别打折 */
export const HINT_BUDGET = { maxDepth: 64, timeMs: 6500, jitter: 0 };

export interface HintResult {
  ranked: RankedMove[];
  best: RankedMove | null;
}

export async function askBest(board: Board, me: Color): Promise<HintResult> {
  const moves = await requestAnalysis(board, me, HINT_BUDGET);
  const ranked = rankMoves(board, me, moves);
  return { ranked, best: ranked[0] ?? null };
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
export function showBestHint(opts: BestHintUI): { update: (r: HintResult) => void; close: () => void } {
  const el = document.createElement('div');
  el.className = 'xq-tip xq-besthint';
  el.innerHTML = `
    <div class="xq-tip-body">
      <span class="xq-tip-icon">🔍</span>
      <span class="xq-tip-text">正在算这个局面的最优解…</span>
    </div>
    <div class="xq-tip-why"></div>
    <div class="xq-tip-bar">
      <button class="xq-btn" data-act="more">看完整梯次</button>
      <button class="xq-btn primary" data-act="close">知道了</button>
    </div>`;
  opts.host.appendChild(el);
  const elText = el.querySelector('.xq-tip-text') as HTMLElement;
  const elWhy = el.querySelector('.xq-tip-why') as HTMLElement;
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

  const update = (r: HintResult) => {
    latest = r;
    if (!r.best) {
      elText.textContent = '这个局面已经没有可走的棋了。';
      return;
    }
    // 盘上画出前三手
    opts.board.setArrows(
      r.ranked.slice(0, 3).map((x, i) => ({ ...x.move, color: ARROW_COLORS[i] })),
    );
    opts.board.select({ x: r.best.move.fx, y: r.best.move.fy });
    const alt = r.ranked.slice(1, 3).filter((x) => x.gap <= 30);
    elText.innerHTML =
      `最优是 <b>${r.best.text}</b>${r.best.why ? `（${r.best.why}）` : ''}。` +
      (alt.length ? `　<span class="dim">${alt.map((a) => a.text).join('、')} 也一样好。</span>` : '');
    elWhy.innerHTML = r.ranked
      .slice(0, 8)
      .map((x) => {
        const gap = x.gap === 0 ? '' : x.gap >= 9999 ? '（首选是杀棋）' : `落后 ${x.gap}`;
        return `<div class="row"><i style="color:${TIER_INFO[x.tier].color}">${TIER_INFO[x.tier].name}</i>
          <b>${x.text}</b> <span>${gap}</span>${x.why ? `<em>${x.why}</em>` : ''}</div>`;
      })
      .join('');
    elMore.disabled = false;
  };

  return { update, close };
}

/** 把一手棋画成箭头需要的形状 */
export const arrowOf = (m: Move, color?: string) => ({ ...m, color });
