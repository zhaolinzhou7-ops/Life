/**
 * 棋盘上会动的那一层：隔几秒斜着扫过去的一道流光、楚河汉界里水面的粼光、河上飘的薄雾、金粉一点点往上飘。
 * 水墨以外的几套各有各的：星河——星星眨眼、流星划过；霓虹——扫描线、河边来回跑的光；
 * 烽火——火星往上飞；敦煌——花瓣往下飘。
 *
 * 用户原话："模仿一下天天象棋……他们的那个棋盘，对吧？它有非常流光溢彩的那种水墨画的那种感觉。"
 *
 * 只有"典藏"那几套棋盘有（boardtheme 里带 ambient 的）。做法是在棋盘画布上面叠几块 CSS 动画的层：
 * 动的只是位置和透明度（GPU 合成），棋盘画布一帧都不重画，开着也不费电。
 * 关了"对局特效"、系统要求减少动态效果，这一层就不出。
 * 开局棋盘正在斜着转平那一秒先藏着（这一层不跟着转），转平了再淡出来。
 */
import type { Board2D } from './board2d';
import { boardPadY, boardStyle, getLook, onLook } from './boardtheme';
import { fxEnabled } from './fx';

export class BoardAmbient {
  private el: HTMLDivElement;
  private offLook: () => void;
  private timer = 0;
  private key = '';

  constructor(
    host: HTMLElement,
    private board: Board2D,
    private coords = true,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'xq-amb';
    this.el.setAttribute('aria-hidden', 'true');
    host.appendChild(this.el);
    this.offLook = onLook(() => this.update(true));
    // 棋盘尺寸会变（转屏、复盘面板升高），隔一会儿对一次位置；只改位置，不重建
    this.timer = window.setInterval(() => this.update(false), 700);
    this.update(true);
  }

  /** rebuild：换了样式（或开关了特效）就重建里面那几块 */
  update(rebuild: boolean) {
    const st = boardStyle(getLook().board);
    const amb = fxEnabled() ? st.ambient : undefined;
    const want = amb ? st.id : '';
    if (want !== this.key || rebuild) {
      this.key = want;
      this.el.className = `xq-amb${amb ? ` amb-${st.id}` : ''}`;
      this.el.innerHTML = '';
      if (!amb) return;
      this.el.style.setProperty('--sheen', amb.sheen);
      this.el.style.setProperty('--river', amb.river ?? 'transparent');
      this.el.style.setProperty('--mist', amb.mist ?? 'transparent');
      this.el.style.setProperty('--mote', amb.motes ?? 'transparent');
      for (const k of ['stars', 'meteor', 'scan', 'pulse', 'embers', 'petals'] as const) this.el.style.setProperty(`--${k}`, amb[k] ?? 'transparent');
      let motes = '';
      if (amb.motes) {
        // 金粉：十几粒，各自的位置、大小、快慢、起步时间不一样
        for (let i = 0; i < 14; i++) {
          const x = ((i * 37) % 100) + (i % 3) * 2.3;
          const d = 7 + ((i * 53) % 60) / 10;
          const delay = -((i * 41) % 70) / 10;
          const s = 2 + ((i * 29) % 30) / 10;
          motes += `<i style="left:${x.toFixed(1)}%;width:${s}px;height:${s}px;animation-duration:${d}s;animation-delay:${delay}s"></i>`;
        }
      }
      // 星：三十来颗，各自眨眼的快慢、起步不一样
      let stars = '';
      if (amb.stars) {
        for (let i = 0; i < 30; i++) {
          const x = (i * 61 + 7) % 100;
          const y = (i * 37 + 13) % 100;
          const s = 1.5 + ((i * 17) % 20) / 10;
          stars += `<b style="left:${x}%;top:${y}%;width:${s}px;height:${s}px;animation-duration:${(2.2 + ((i * 29) % 30) / 10).toFixed(1)}s;animation-delay:${(-((i * 43) % 50) / 10).toFixed(1)}s"></b>`;
        }
      }
      // 火星：二十几粒，比金粉快、晃得厉害
      let embers = '';
      if (amb.embers) {
        for (let i = 0; i < 24; i++) {
          const x = (i * 43 + 5) % 100;
          const d = 2.6 + ((i * 31) % 30) / 10;
          const s = 2 + ((i * 23) % 25) / 10;
          embers += `<i style="left:${x}%;width:${s}px;height:${s}px;--dx:${((i % 5) - 2) * 9}px;animation-duration:${d.toFixed(1)}s;animation-delay:${(-((i * 37) % 60) / 10).toFixed(1)}s"></i>`;
        }
      }
      // 花瓣：十来片，从上往下飘、打着转
      let petals = '';
      if (amb.petals) {
        for (let i = 0; i < 11; i++) {
          const x = (i * 47 + 9) % 100;
          const d = 9 + ((i * 29) % 50) / 10;
          const s = 6 + ((i * 13) % 5);
          petals += `<i style="left:${x}%;width:${s}px;height:${(s * 0.6).toFixed(1)}px;--dx:${((i % 4) - 1.5) * 22}px;animation-duration:${d.toFixed(1)}s;animation-delay:${(-((i * 53) % 90) / 10).toFixed(1)}s"></i>`;
        }
      }
      const river = amb.river
        ? `<div class="amb-river"><div class="amb-ripple"></div>` +
          (amb.mist ? '<div class="amb-mist"></div><div class="amb-mist b"></div>' : '') +
          (amb.pulse ? '<div class="amb-pulse"></div><div class="amb-pulse b"></div>' : '') +
          `</div>`
        : '';
      this.el.innerHTML =
        (stars ? `<div class="amb-stars">${stars}</div>` : '') +
        `<div class="amb-sheen"></div>` +
        river +
        (amb.scan ? '<div class="amb-scan"></div>' : '') +
        (amb.meteor ? '<div class="amb-meteor"></div>' : '') +
        (motes ? `<div class="amb-motes">${motes}</div>` : '') +
        (embers ? `<div class="amb-embers">${embers}</div>` : '') +
        (petals ? `<div class="amb-petals">${petals}</div>` : '');
    }
    if (!amb) return;
    this.place();
  }

  /** 贴着棋盘那一块（不是整张画布）：四角、楚河汉界那一条 */
  private place() {
    const cv = this.board.canvas;
    const a = this.board.pointOf(0, 0);
    const b = this.board.pointOf(8, 9);
    const c = a.cell;
    if (!c) return;
    const left = Math.min(a.x, b.x) - c * 0.62;
    const right = Math.max(a.x, b.x) + c * 0.62;
    const top = Math.min(a.y, b.y) - c * boardPadY(this.coords);
    const bottom = Math.max(a.y, b.y) + c * boardPadY(this.coords);
    const s = this.el.style;
    s.left = `${cv.offsetLeft + left}px`;
    s.top = `${cv.offsetTop + top}px`;
    s.width = `${right - left}px`;
    s.height = `${bottom - top}px`;
    s.borderRadius = `${Math.min(14, c * 0.35)}px`;
    // 河：第 5、6 条横线之间（翻过来也是这一条）
    const riverTop = Math.min(a.y, b.y) + 4 * c - top;
    s.setProperty('--rv-top', `${riverTop + 1}px`);
    s.setProperty('--rv-h', `${c - 2}px`);
    s.setProperty('--grid-l', `${c * 0.62}px`);
    s.setProperty('--grid-w', `${8 * c}px`);
    s.setProperty('--amb-h', `${bottom - top}px`);
  }

  dispose() {
    clearInterval(this.timer);
    this.offLook();
    this.el.remove();
  }
}
