/**
 * 2D 教学棋盘。
 *
 * 对局用 3D（scene3d.ts）好看，但教学不行：讲题要在盘上画箭头、圈出被攻击的子、
 * 标出"这里被车照着"，这些在 3D 里既别扭又慢。而且做题要**快速读图**——
 * 所有棋书棋谱都是 2D 平面图，眼睛认的就是那个样子。
 *
 * 画法沿用麻将牌的路子：静态层（木纹、格线、河界）渲染一次缓存起来，
 * 每帧只 blit；棋子按 (兵种,颜色,尺寸) 缓存成精灵，避免反复画圆和文字。
 */
import { COLS, ROWS, type Board, type Color, type Move, type Piece, type PType } from './rules';
import { pieceName } from './notation';

/**
 * 棋子颜色。
 *
 * 原来的 #a51e0c / #141d24 偏暗，在木色盘面上"陷"进去，隔一臂远看
 * 红黑两方要凑近才分得清。现在两边都提亮提纯：红往正红走、黑往蓝黑走，
 * 色相拉开之后**不用读字也能一眼分出敌我**，这在快速扫盘时最要紧。
 */
/** 上一手标记：亮多久、多久淡完 */
const LAST_HOLD_MS = 1400;
const LAST_FADE_MS = 2400;

const RED = '#c8201a';
const BLACK = '#15283a';

/** 棋子面的底色。红黑用两种极轻微不同的色温，进一步帮助一眼区分 */
const FACE: Record<Color, [string, string, string]> = {
  r: ['#fff6e2', '#f6e3bd', '#dcc298'],
  b: ['#f6f2ea', '#e8e3d6', '#cdc6b4'],
};

export interface Mark {
  x: number;
  y: number;
  /** dot=可走点 ring=选中/强调 bad=被攻击 */
  kind: 'dot' | 'ring' | 'bad';
}

export interface Arrow {
  fx: number;
  fy: number;
  tx: number;
  ty: number;
  color?: string;
  /** 箭头中间标一个字（选择题的 A / B / C / D） */
  label?: string;
  /** 给了 id 的箭头点得动：点在箭头上（离箭身不到半格）回调 onArrowTap(id)，不再当成点格子 */
  id?: string;
}

/** 棋子上的小角标：这一手的评级（复盘逐手、对局里自己走完那一手） */
export interface Badge {
  x: number;
  y: number;
  /** 一个字：妙 / ★ / 优 / 良 / 中 / 差 / 错 / 漏 */
  text: string;
  color: string;
  /** 哪一方的子：那个点上换成了别人的子（被吃了）就不画 */
  c?: Color;
}

/**
 * 走子动画。用户原话："棋子移动时显示行进路线，让我清楚看到它是从哪儿挪到哪儿的。
 * 不要太呆滞刻板（比如只是闪一个方框）。"
 *
 * 只是**画法**：盘面（this.board）在动画开始那一刻就已经是走完的样子，点子、判规则都按它来，
 * 动画只决定这几百毫秒里那个子画在哪——原来"棋子不在交叉点上"的老 bug 来自盘面本身跟着动画走，这里不会。
 */
interface Anim {
  m: Move;
  p: Piece;
  /** 被吃掉的子：棋子快到的时候才淡掉 */
  cap: Piece | null;
  /** 路线上的拐点（马先直走一格再斜走一格），格子坐标 */
  path: [number, number][];
  t0: number;
  dur: number;
}
/** 走完以后路线和落点的涟漪还留多久 */
const TRAIL_MS = 900;

export interface Board2DOpts {
  /** true = 黑方在下（执黑时用） */
  flip?: boolean;
  onTap?: (x: number, y: number) => void;
  /** 点到带 id 的箭头上（分支讲解"点箭头走这一路"、复盘"点箭头看最佳走法的后续"） */
  onArrowTap?: (id: string) => void;
  /** 画纵线号。新手照着棋谱学的时候没有这个根本对不上 */
  coords?: boolean;
}

export class Board2D {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private board: Board | null = null;
  private marks: Mark[] = [];
  private arrows: Arrow[] = [];
  private flip: boolean;
  private coords: boolean;
  private onTap?: (x: number, y: number) => void;
  private onArrowTap?: (id: string) => void;
  /** 上一手棋。不标出来的话，对手走完你根本不知道他动了哪个子 */
  private last: Move | null = null;
  /** 上一手是什么时候标上去的，用来做淡出 */
  private lastAt = 0;
  /**
   * 上一手标记要不要淡出。
   *
   * 对局里要淡出：那两个蓝框的作用是"让你看见对方刚走了什么"，
   * 看见了就该让路——一直挂在盘上，越积越花，看棋盘时总被它抢注意力。
   * 复盘里不淡出：那边是逐手翻看，标记必须一直在。
   */
  private lastFade = false;
  /** 正在被将的老将位置，画成跳动的红圈 */
  private check: { x: number; y: number } | null = null;
  /** 将军圈的呼吸相位 */
  private pulse = 0;

  /** 正在走的那一手 */
  private anim: Anim | null = null;
  /** 刚走完的那一手：路线淡出、落点涟漪 */
  private trail: { path: [number, number][]; c: Color; at: number; cap: boolean } | null = null;
  private badge: Badge | null = null;

  /** 静态层缓存：木纹 + 格线 + 河界，只跟尺寸有关 */
  private bgCv: HTMLCanvasElement | null = null;
  private sprites = new Map<string, HTMLCanvasElement>();

  private cell = 0;
  private ox = 0;
  private oy = 0;
  private w = 0;
  private h = 0;
  private raf = 0;
  private dirty = true;
  private disposed = false;

  constructor(parent: HTMLElement, opts: Board2DOpts = {}) {
    this.flip = !!opts.flip;
    this.coords = opts.coords !== false;
    this.onTap = opts.onTap;
    this.onArrowTap = opts.onArrowTap;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'xq-b2d';
    parent.appendChild(this.canvas);
    this.g = this.canvas.getContext('2d')!;
    this.canvas.addEventListener('pointerdown', this.pointer);
    window.addEventListener('resize', this.resize);
    this.resize();
    this.loop();
  }

  // ---------- 对外 ----------
  /**
   * 换盘面。新盘面和旧盘面只差**一步棋**（一个子从一点走到另一点，可能吃子）时自动走动画——
   * 对局、复盘逐手、讲解、做题都走这一个口子，不用每个调用方各写一遍；
   * 一次跳好几手（跳到某一手、悔棋、换题）就直接摆好，不动画。
   */
  setBoard(b: Board) {
    const prev = this.board;
    this.board = b;
    this.dirty = true;
    const mv = prev && prev !== b ? singleMove(prev, b) : null;
    if (mv) this.startAnim(mv, prev!, b);
    else if (prev !== b) this.anim = null;
  }

  /** 棋子上的评级角标；传 null 去掉 */
  setBadge(b: Badge | null) {
    this.badge = b;
    this.dirty = true;
    // 画在画布上的东西测试看不见：挂一个属性（"x,y,字"）
    this.canvas.dataset.badge = b ? `${b.x},${b.y},${b.text}` : '';
  }
  setFlip(f: boolean) {
    if (this.flip === f) return;
    this.flip = f;
    this.bgCv = null; // 纵线号跟着翻面变，静态层要重画
    this.dirty = true;
  }
  setMarks(marks: Mark[]) {
    this.marks = marks;
    this.dirty = true;
  }
  setArrows(arrows: Arrow[]) {
    this.arrows = arrows;
    this.dirty = true;
    // 测试看不见画布：点得动的箭头挂在属性上
    this.canvas.dataset.arrows = arrows.filter((a) => a.id).map((a) => a.id).join(',');
    // 箭头中点在画布上的位置（测试按这个去点箭头）
    this.canvas.dataset.arrowsxy = JSON.stringify(
      arrows
        .filter((a) => a.id)
        .map((a) => {
          const [sx, sy] = this.px(a.fx, a.fy);
          const [tx, ty] = this.px(a.tx, a.ty);
          return { id: a.id, x: Math.round((sx + tx) / 2), y: Math.round((sy + ty) / 2) };
        }),
    );
  }
  /** 换一个"点箭头"回调（复盘的棋盘是对局那块，建的时候还不知道要点箭头） */
  setArrowTap(fn: ((id: string) => void) | undefined) {
    this.onArrowTap = fn;
  }
  clearMarks() {
    this.marks = [];
    this.arrows = [];
    this.canvas.dataset.arrows = '';
    this.dirty = true;
  }

  /** 标出上一手是从哪走到哪。fade = 对局模式，两秒后自动淡去 */
  setLastMove(m: Move | null, fade = false) {
    this.last = m;
    this.lastAt = performance.now();
    this.lastFade = fade;
    this.dirty = true;
  }

  /** 标出被将的老将；传 null 取消 */
  setCheck(at: { x: number; y: number } | null) {
    this.check = at;
    this.dirty = true;
  }

  /**
   * 走一步。**没有动画，落子即到。**
   *
   * 教学场景一天要走几百步，每步等 0.26 秒纯属浪费；更要紧的是棋子在半空的
   * 那一瞬不在任何交叉点上，看到就是"位置不对"。回调仍然放到下一帧——
   * 调用方靠 onDone 串后续流程，同步执行会打乱顺序。
   */
  animateMove(m: Move, board: Board, onDone: () => void) {
    void m;
    this.setBoard(board);
    requestAnimationFrame(() => onDone());
  }

  private startAnim(m: Move, prev: Board, next: Board) {
    const p = next[m.ty][m.tx];
    if (!p) return;
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const path = pathOf(m, p.t);
    const dist = Math.hypot(m.tx - m.fx, m.ty - m.fy);
    // 走一格 0.2 秒、车炮跨大半个盘 0.36 秒：看得清从哪来，又不拖节奏
    const dur = reduce ? 0 : Math.min(360, 170 + dist * 24);
    this.anim = { m, p, cap: prev[m.ty][m.tx], path, t0: performance.now(), dur };
    this.canvas.dataset.anim = `${m.fx}${m.fy}${m.tx}${m.ty}`;
    this.canvas.dataset.anims = String(Number(this.canvas.dataset.anims ?? 0) + 1);
    this.trail = { path, c: p.c, at: performance.now() + dur, cap: !!prev[m.ty][m.tx] };
    this.dirty = true;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.pointer);
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }

  // ---------- 坐标 ----------
  /** 棋盘格 -> 画布像素中心点 */
  private px(x: number, y: number): [number, number] {
    const gx = this.flip ? COLS - 1 - x : x;
    const gy = this.flip ? ROWS - 1 - y : y;
    return [this.ox + gx * this.cell, this.oy + gy * this.cell];
  }

  private pointer = (e: PointerEvent) => {
    const r = this.canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
    // 点在带 id 的箭头上：算"选这一路"（离箭身最近的那一条；终点那一格也算）
    if (this.onArrowTap) {
      let best: { id: string; d: number } | null = null;
      for (const ar of this.arrows) {
        if (!ar.id) continue;
        const [sx, sy] = this.px(ar.fx, ar.fy);
        const [tx, ty] = this.px(ar.tx, ar.ty);
        const d = segDist(cx, cy, sx, sy, tx, ty);
        if (d < this.cell * 0.45 && (!best || d < best.d)) best = { id: ar.id, d };
      }
      if (best) {
        this.onArrowTap(best.id);
        return;
      }
    }
    if (!this.onTap) return;
    let gx = Math.round((cx - this.ox) / this.cell);
    let gy = Math.round((cy - this.oy) / this.cell);
    if (this.flip) {
      gx = COLS - 1 - gx;
      gy = ROWS - 1 - gy;
    }
    if (gx < 0 || gx >= COLS || gy < 0 || gy >= ROWS) return;
    this.onTap(gx, gy);
  };

  private resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 棋盘 8 格宽 × 9 格高，四周留出半格多的边距
    // 上下各多留 0.35 格给纵线号，否则号会被裁掉
    this.cell = Math.min(r.width / (COLS + 0.9), r.height / (ROWS + 1.2));
    this.ox = (r.width - (COLS - 1) * this.cell) / 2;
    this.oy = (r.height - (ROWS - 1) * this.cell) / 2;
    this.bgCv = null;
    this.sprites.clear();
    this.dirty = true;
  };

  // ---------- 静态层 ----------
  private renderBg(): HTMLCanvasElement {
    const cv = document.createElement('canvas');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(this.w * dpr);
    cv.height = Math.round(this.h * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = this.cell;
    const x0 = this.ox;
    const y0 = this.oy;
    const x1 = x0 + (COLS - 1) * c;
    const y1 = y0 + (ROWS - 1) * c;

    // 木底只铺棋盘那一块，不铺满画布——铺满会让棋盘"泡"在一片木色里，
    // 看不出这是一块实物棋盘。留出的地方透出页面底色，棋盘才立得住。
    const pad = c * 0.62;
    const bx = x0 - pad;
    const by = y0 - pad;
    const bw = x1 - x0 + pad * 2;
    const bh = y1 - y0 + pad * 2;
    const radius = Math.min(14, c * 0.35);

    const roundRect = () => {
      g.beginPath();
      g.moveTo(bx + radius, by);
      g.arcTo(bx + bw, by, bx + bw, by + bh, radius);
      g.arcTo(bx + bw, by + bh, bx, by + bh, radius);
      g.arcTo(bx, by + bh, bx, by, radius);
      g.arcTo(bx, by, bx + bw, by, radius);
      g.closePath();
    };

    // 落地投影，让棋盘有厚度
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.45)';
    g.shadowBlur = 16;
    g.shadowOffsetY = 5;
    const grd = g.createLinearGradient(0, by, 0, by + bh);
    grd.addColorStop(0, '#e8caa0');
    grd.addColorStop(0.5, '#e0bd8e');
    grd.addColorStop(1, '#d0a875');
    g.fillStyle = grd;
    roundRect();
    g.fill();
    g.restore();

    // 木纹只画在棋盘内
    g.save();
    roundRect();
    g.clip();
    g.globalAlpha = 0.05;
    g.strokeStyle = '#7a5227';
    for (let i = 0; i < 70; i++) {
      const yy = by + Math.random() * bh;
      g.beginPath();
      g.moveTo(bx, yy);
      g.bezierCurveTo(bx + bw * 0.3, yy + Math.random() * 5 - 2.5, bx + bw * 0.7, yy + Math.random() * 5 - 2.5, bx + bw, yy);
      g.lineWidth = 0.4 + Math.random() * 0.9;
      g.stroke();
    }
    g.restore();

    // 边框：外深内浅，做出一圈木框的厚度
    g.strokeStyle = 'rgba(90,58,28,0.75)';
    g.lineWidth = 2;
    roundRect();
    g.stroke();
    g.strokeStyle = '#6b4423';
    g.lineWidth = 1.4;
    g.strokeRect(x0 - c * 0.3, y0 - c * 0.3, x1 - x0 + c * 0.6, y1 - y0 + c * 0.6);

    g.strokeStyle = '#7a5430';
    g.lineWidth = 1.1;
    // 横线：十条通到底
    for (let y = 0; y < ROWS; y++) {
      g.beginPath();
      g.moveTo(x0, y0 + y * c);
      g.lineTo(x1, y0 + y * c);
      g.stroke();
    }
    // 竖线：最左最右通到底，中间七条被楚河汉界断开
    for (let x = 0; x < COLS; x++) {
      g.beginPath();
      if (x === 0 || x === COLS - 1) {
        g.moveTo(x0 + x * c, y0);
        g.lineTo(x0 + x * c, y1);
      } else {
        g.moveTo(x0 + x * c, y0);
        g.lineTo(x0 + x * c, y0 + 4 * c);
        g.moveTo(x0 + x * c, y0 + 5 * c);
        g.lineTo(x0 + x * c, y1);
      }
      g.stroke();
    }
    // 九宫斜线
    for (const [ax, ay, bx, by] of [
      [3, 0, 5, 2],
      [5, 0, 3, 2],
      [3, 7, 5, 9],
      [5, 7, 3, 9],
    ]) {
      g.beginPath();
      g.moveTo(x0 + ax * c, y0 + ay * c);
      g.lineTo(x0 + bx * c, y0 + by * c);
      g.stroke();
    }

    // 兵/炮位的小角标
    const tick = (gx: number, gy: number) => {
      const d = c * 0.09;
      const len = c * 0.15;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          // 盘边上的点只画朝内的一半
          if ((gx === 0 && sx < 0) || (gx === COLS - 1 && sx > 0)) continue;
          const px = x0 + gx * c + sx * d;
          const py = y0 + gy * c + sy * d;
          g.beginPath();
          g.moveTo(px + sx * len, py);
          g.lineTo(px, py);
          g.lineTo(px, py + sy * len);
          g.stroke();
        }
      }
    };
    for (const gy of [3, 6]) for (const gx of [0, 2, 4, 6, 8]) tick(gx, gy);
    for (const [gx, gy] of [[1, 2], [7, 2], [1, 7], [7, 7]]) tick(gx, gy);

    // 纵线号。
    //
    // 中文记谱是"炮二平五"这种，二和五指的是**纵线号**，而且红黑各数各的：
    // 红方从右往左数一~九，黑方从左往右数 1~9。不把号标在盘边上，
    // 新手拿着棋谱根本对不上位置——这是学棋软件最不该省的一样东西。
    if (this.coords) {
      const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `${Math.round(c * 0.26)}px system-ui, sans-serif`;
      for (let x = 0; x < COLS; x++) {
        const gx = this.flip ? COLS - 1 - x : x;
        const px = x0 + gx * c;
        // 下方标自己这一方的号，上方标对方的
        const bottomIsRed = !this.flip;
        g.fillStyle = 'rgba(122,84,48,0.85)';
        g.fillText(bottomIsRed ? CN[COLS - 1 - x] : String(x + 1), px, y1 + c * 0.42);
        g.fillStyle = 'rgba(122,84,48,0.6)';
        g.fillText(bottomIsRed ? String(x + 1) : CN[COLS - 1 - x], px, y0 - c * 0.42);
      }
    }

    // 楚河汉界
    g.fillStyle = 'rgba(80,50,22,0.72)';
    g.font = `${Math.round(c * 0.62)}px "STKaiti","KaiTi","Songti SC",serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const my = y0 + 4.5 * c;
    g.save();
    g.translate(x0 + 2 * c, my);
    g.fillText('楚　河', 0, 0);
    g.restore();
    g.save();
    g.translate(x0 + 6 * c, my);
    g.fillText('漢　界', 0, 0);
    g.restore();

    return cv;
  }

  // ---------- 棋子精灵 ----------
  private sprite(t: PType, c: Color): HTMLCanvasElement {
    const key = `${t}${c}`;
    const hit = this.sprites.get(key);
    if (hit) return hit;

    const r = this.cell * 0.44;
    const pad = 4;
    const size = (r + pad) * 2;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cv = document.createElement('canvas');
    cv.width = Math.round(size * dpr);
    cv.height = Math.round(size * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = size / 2;
    const cy = size / 2;

    // 落盘阴影
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.42)';
    g.shadowBlur = 4;
    g.shadowOffsetY = 2;
    const face = FACE[c];
    g.fillStyle = face[1];
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // 象牙面：斜向渐变做出圆盘的受光
    const grd = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grd.addColorStop(0, face[0]);
    grd.addColorStop(0.55, face[1]);
    grd.addColorStop(1, face[2]);
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();

    // 内圈刻线（棋子的标志性特征）
    const col = c === 'r' ? RED : BLACK;
    g.strokeStyle = 'rgba(120,85,45,0.45)';
    g.lineWidth = 1;
    g.beginPath();
    g.arc(cx, cy, r * 0.98, 0, Math.PI * 2);
    g.stroke();
    g.strokeStyle = col;
    g.lineWidth = Math.max(1.5, r * 0.075);
    g.beginPath();
    g.arc(cx, cy, r * 0.85, 0, Math.PI * 2);
    g.stroke();

    /**
     * 字。**认得清排在好看前面。**
     *
     * 原来是"先压一道半透明暗影再写正色"，那道偏移的暗影其实在糊边缘，
     * 字号也只有半径的 1.08 倍。手机上一个棋子才五六十像素，糊一点就认不出
     * 炮和相的区别了。
     *
     * 改成路牌和字幕的通用做法：**先用盘面底色在字外面描一圈**，
     * 把字和底隔开，再补一条极细的深色边把轮廓咬死，最后填正色。
     * 不改配色，纯靠隔离带提对比。字号也放大到 1.24 倍半径。
     */
    const label = pieceName(t, c);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(r * 1.24)}px "STKaiti","KaiTi","Songti SC",serif`;
    g.lineJoin = 'round';
    g.miterLimit = 2;
    g.strokeStyle = face[0];
    g.lineWidth = Math.max(2, r * 0.20);
    g.strokeText(label, cx, cy);
    g.strokeStyle = 'rgba(60,38,14,0.45)';
    g.lineWidth = Math.max(0.8, r * 0.035);
    g.strokeText(label, cx, cy);
    g.fillStyle = col;
    g.fillText(label, cx, cy);

    this.sprites.set(key, cv);
    return cv;
  }

  // ---------- 主循环 ----------
  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    // 容器一开始可能还没布局（宽高为 0），量到尺寸变化就重新算一次
    const r = this.canvas.getBoundingClientRect();
    if (Math.abs(r.width - this.w) > 1 || Math.abs(r.height - this.h) > 1) this.resize();
    // 将军圈要呼吸，这段时间必须每帧重画；其余时候保持"脏了才画"
    if (this.check) {
      this.pulse += 0.06;
      this.dirty = true;
    }
    // 上一手标记正在淡出的这两秒要持续重绘
    if (this.last && this.lastFade && performance.now() - this.lastAt < LAST_FADE_MS) this.dirty = true;
    // 走子动画、路线淡出这一阵也要每帧画
    const now = performance.now();
    if (this.anim && now - this.anim.t0 >= this.anim.dur) {
      this.anim = null;
      this.canvas.dataset.anim = '';
    }
    if (this.anim || (this.trail && now - this.trail.at < TRAIL_MS)) this.dirty = true;
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  };

  private draw() {
    const g = this.g;
    if (this.w < 2) return;
    if (!this.bgCv) this.bgCv = this.renderBg();
    g.clearRect(0, 0, this.w, this.h);
    g.drawImage(this.bgCv, 0, 0, this.w, this.h);
    if (!this.board) return;

    const c = this.cell;
    const spriteR = c * 0.44 + 4;

    // 上一手：起点画空心方框、终点画实心底色。
    // 这是对局里最容易被忽略却最有用的一条信息——没有它，对手走完之后
    // 你得把整个棋盘和记忆比对一遍才知道他动了什么。
    // 正在走的就是这一手：先让棋子走到，路线和落点光等它到了再出现
    const moving = this.anim && this.last && this.anim.m.fx === this.last.fx && this.anim.m.fy === this.last.fy && this.anim.m.tx === this.last.tx && this.anim.m.ty === this.last.ty;
    if (this.last && !moving) {
      // 对局里两秒淡出，复盘里常驻
      let alpha = 1;
      if (this.lastFade) {
        const t = performance.now() - this.lastAt;
        alpha = t >= LAST_FADE_MS ? 0 : t <= LAST_HOLD_MS ? 1 : 1 - (t - LAST_HOLD_MS) / (LAST_FADE_MS - LAST_HOLD_MS);
      }
      if (alpha > 0.01) {
        // 不再是两个方框：一条淡淡的路线（马走折线）+ 起点虚线小圈 + 落点一圈光，
        // 一眼看出"从哪儿挪到哪儿"
        const lm = this.last;
        const piece = this.board[lm.ty]?.[lm.tx];
        const path = pathOf(lm, piece?.t ?? 'R');
        const pts = path.map(([x, y]) => this.px(x, y));
        const col = piece?.c === 'b' ? '64,120,190' : '206,92,52';
        g.save();
        g.lineCap = 'round';
        g.lineJoin = 'round';
        g.strokeStyle = `rgba(${col},${0.28 * alpha})`;
        g.lineWidth = Math.max(3, c * 0.13);
        g.beginPath();
        g.moveTo(pts[0][0], pts[0][1]);
        for (const q of pts.slice(1)) g.lineTo(q[0], q[1]);
        g.stroke();
        g.strokeStyle = `rgba(${col},${0.7 * alpha})`;
        g.lineWidth = Math.max(1.5, c * 0.045);
        g.setLineDash([c * 0.08, c * 0.07]);
        g.beginPath();
        g.arc(pts[0][0], pts[0][1], c * 0.3, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        const [ex, ey] = pts[pts.length - 1];
        const glow = g.createRadialGradient(ex, ey, c * 0.36, ex, ey, c * 0.56);
        glow.addColorStop(0, `rgba(${col},${0.45 * alpha})`);
        glow.addColorStop(1, `rgba(${col},0)`);
        g.fillStyle = glow;
        g.beginPath();
        g.arc(ex, ey, c * 0.56, 0, Math.PI * 2);
        g.fill();
        g.restore();
      }
    }

    // 标记画在棋子下面，不挡字
    for (const mk of this.marks) {
      const [px, py] = this.px(mk.x, mk.y);
      if (mk.kind === 'dot') {
        g.fillStyle = 'rgba(46,160,90,0.55)';
        g.beginPath();
        g.arc(px, py, c * 0.13, 0, Math.PI * 2);
        g.fill();
      } else {
        g.strokeStyle = mk.kind === 'bad' ? 'rgba(214,64,52,0.95)' : 'rgba(46,160,90,0.95)';
        g.lineWidth = Math.max(2, c * 0.055);
        g.beginPath();
        g.arc(px, py, c * 0.46, 0, Math.PI * 2);
        g.stroke();
      }
    }

    const now = performance.now();
    const an = this.anim;
    const k = an ? (an.dur ? Math.min(1, (now - an.t0) / an.dur) : 1) : 1;
    this.drawTrail(now, an ? k : 1);

    // 棋子：每个都画在自己的交叉点上；正在走的那个单独画在路上
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.board[y][x];
        if (!p) continue;
        if (an && an.m.tx === x && an.m.ty === y) continue;
        const [px, py] = this.px(x, y);
        g.drawImage(this.sprite(p.t, p.c), px - spriteR, py - spriteR, spriteR * 2, spriteR * 2);
      }
    }
    if (an) {
      // 被吃的子：走子快到的时候缩小淡掉
      if (an.cap && k < 1) {
        const [cx, cy] = this.px(an.m.tx, an.m.ty);
        const f = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
        const r = spriteR * (0.75 + 0.25 * f);
        g.save();
        g.globalAlpha = Math.max(0, f);
        g.drawImage(this.sprite(an.cap.t, an.cap.c), cx - r, cy - r, r * 2, r * 2);
        g.restore();
      }
      // 走的子：缓出曲线，路上稍微"拿起来"一点（放大、影子拉长），落下时回到原大小
      const e = 1 - Math.pow(1 - k, 3);
      const [ax, ay] = this.alongPath(an.path, e);
      const lift = Math.sin(Math.PI * k);
      const r = spriteR * (1 + 0.1 * lift);
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.35)';
      g.shadowBlur = 6 + 10 * lift;
      g.shadowOffsetY = 2 + 5 * lift;
      g.drawImage(this.sprite(an.p.t, an.p.c), ax - r, ay - r - 3 * lift, r * 2, r * 2);
      g.restore();
    }

    // 评级角标：棋子右上角一个小圆牌
    const bp = this.badge ? this.board[this.badge.y]?.[this.badge.x] : null;
    if (this.badge && bp && (!this.badge.c || bp.c === this.badge.c) && !(an && an.m.tx === this.badge.x && an.m.ty === this.badge.y)) {
      const [bx, by] = this.px(this.badge.x, this.badge.y);
      const r = Math.max(9, c * 0.24);
      const cx = bx + c * 0.36;
      const cy = by - c * 0.36;
      g.save();
      g.shadowColor = 'rgba(0,0,0,0.4)';
      g.shadowBlur = 3;
      g.fillStyle = this.badge.color;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      g.lineWidth = Math.max(1.2, r * 0.14);
      g.strokeStyle = 'rgba(255,255,255,0.92)';
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `700 ${Math.round(r * 1.2)}px system-ui, "PingFang SC", sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(this.badge.text, cx, cy + 0.5);
      g.restore();
    }

    // 将军：老将脚下一圈跳动的红光
    if (this.check) {
      const [px, py] = this.px(this.check.x, this.check.y);
      const t = (Math.sin(this.pulse) + 1) / 2;
      g.save();
      g.strokeStyle = `rgba(226,58,46,${0.55 + t * 0.45})`;
      g.lineWidth = Math.max(2.5, c * 0.07);
      g.beginPath();
      g.arc(px, py, c * (0.5 + t * 0.09), 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // 教学箭头画在最上层
    for (const ar of this.arrows) this.drawArrow(ar);
  }

  /** 路线上走到 t（0～1）的那一点，像素坐标。路线按每一段的长度分配时间 */
  private alongPath(path: [number, number][], t: number): [number, number] {
    const pts = path.map(([x, y]) => this.px(x, y));
    const lens = pts.slice(1).map((p, i) => Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]));
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let d = t * total;
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const f = lens[i] ? Math.min(1, d / lens[i]) : 1;
        return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
      }
      d -= lens[i];
    }
    return pts[pts.length - 1];
  }

  /**
   * 路线：从起点到棋子现在的位置画一条渐变的带子（起点淡、棋子那头浓），起点留一个空心小圈；
   * 走到以后路线慢慢淡掉，落点荡开一圈涟漪（吃子的那一圈是红的）。
   */
  private drawTrail(now: number, k: number) {
    const tr = this.trail;
    if (!tr) return;
    const after = now - tr.at;
    if (after >= TRAIL_MS) return;
    const fade = after <= 0 ? 1 : 1 - after / TRAIL_MS;
    const g = this.g;
    const c = this.cell;
    const col = tr.c === 'r' ? '214,64,40' : '40,92,150';
    const e = 1 - Math.pow(1 - Math.min(1, k), 3);
    const pts = tr.path.map(([x, y]) => this.px(x, y));
    const head = this.alongPath(tr.path, e);
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    const grd = g.createLinearGradient(pts[0][0], pts[0][1], head[0], head[1]);
    grd.addColorStop(0, `rgba(${col},${0.05 * fade})`);
    grd.addColorStop(1, `rgba(${col},${0.55 * fade})`);
    g.strokeStyle = grd;
    g.lineWidth = Math.max(4, c * 0.2);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    // 只画到棋子现在走到的地方
    const total = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0) || 1;
    let left = e * total;
    for (let i = 1; i < pts.length && left > 0; i++) {
      const seg = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
      if (left >= seg) g.lineTo(pts[i][0], pts[i][1]);
      else g.lineTo(head[0], head[1]);
      left -= seg;
    }
    g.stroke();
    // 起点：空心小圈，看得出"从这里走的"
    g.strokeStyle = `rgba(${col},${0.6 * fade})`;
    g.lineWidth = Math.max(1.5, c * 0.045);
    g.setLineDash([c * 0.08, c * 0.07]);
    g.beginPath();
    g.arc(pts[0][0], pts[0][1], c * 0.3, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    // 落点涟漪
    if (after > 0) {
      const t = after / TRAIL_MS;
      const [lx, ly] = pts[pts.length - 1];
      g.strokeStyle = tr.cap ? `rgba(226,58,46,${0.7 * (1 - t)})` : `rgba(${col},${0.5 * (1 - t)})`;
      g.lineWidth = Math.max(2, c * 0.06) * (1 - t * 0.5);
      g.beginPath();
      g.arc(lx, ly, c * (0.48 + 0.35 * t), 0, Math.PI * 2);
      g.stroke();
    }
    g.restore();
  }

  private drawArrow(ar: Arrow) {
    const g = this.g;
    const [sx, sy] = this.px(ar.fx, ar.fy);
    const [tx, ty] = this.px(ar.tx, ar.ty);
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    /*
     * 两端各让开一个棋子的半径，箭头不压在字上。
     *
     * 但**让开的量要跟着距离缩**：走一格的棋（比如炮平一路）全长只有
     * 一个 cell，两头各切掉 0.42 之后剩不下什么，箭头等于没画——
     * 而恰恰是这种短距离的着法最需要标出来，因为肉眼很难注意到。
     */
    const trim = Math.min(this.cell * 0.42, len * 0.32);
    const ax = sx + ux * trim;
    const ay = sy + uy * trim;
    const bx = tx - ux * trim * 0.7;
    const by = ty - uy * trim * 0.7;
    const head = Math.min(this.cell * 0.26, len * 0.34);

    g.save();
    g.strokeStyle = ar.color ?? 'rgba(46,160,90,0.9)';
    g.fillStyle = g.strokeStyle;
    g.lineWidth = Math.max(3, this.cell * 0.1);
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ax, ay);
    g.lineTo(bx - ux * head * 0.8, by - uy * head * 0.8);
    g.stroke();
    g.beginPath();
    g.moveTo(bx, by);
    g.lineTo(bx - ux * head + uy * head * 0.5, by - uy * head - ux * head * 0.5);
    g.lineTo(bx - ux * head - uy * head * 0.5, by - uy * head + ux * head * 0.5);
    g.closePath();
    g.fill();
    if (ar.label) {
      // 标签放在箭身靠终点的三分之二处，圆底白字，几条箭头交叉时也认得出是哪一条
      const lx = ax + (bx - ax) * 0.62;
      const ly = ay + (by - ay) * 0.62;
      const r = Math.max(9, this.cell * 0.22);
      g.beginPath();
      g.arc(lx, ly, r, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.stroke();
      g.fillStyle = '#fff';
      g.font = `bold ${Math.round(r * 1.25)}px system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(ar.label, lx, ly + 1);
    }
    g.restore();
  }
}

/**
 * 两个盘面是不是正好差一步棋：一个子离开了原来的点、出现在另一个点（那里原来是空的或者是对方的子），
 * 其余 88 个点都没动。是的话返回那一步，不是返回 null。
 */
export function singleMove(a: Board, b: Board): Move | null {
  let from: [number, number] | null = null;
  let to: [number, number] | null = null;
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = a[y][x];
      const q = b[y][x];
      if (p === q || (p && q && p.t === q.t && p.c === q.c)) continue;
      if (p && !q) {
        if (from) return null;
        from = [x, y];
      } else if (q) {
        if (to) return null;
        to = [x, y];
      } else return null;
    }
  }
  if (!from || !to) return null;
  const p = a[from[1]][from[0]]!;
  const q = b[to[1]][to[0]]!;
  const was = a[to[1]][to[0]];
  if (p.t !== q.t || p.c !== q.c || (was && was.c === p.c)) return null;
  return { fx: from[0], fy: from[1], tx: to[0], ty: to[1] };
}

/** 一步棋在盘上走的路线：马先直走一格（马腿）再斜走一格，其余直来直去 */
export function pathOf(m: Move, t: PType): [number, number][] {
  const dx = m.tx - m.fx;
  const dy = m.ty - m.fy;
  if (t === 'H' && Math.abs(dx) + Math.abs(dy) === 3) {
    const leg: [number, number] = Math.abs(dx) === 2 ? [m.fx + Math.sign(dx), m.fy] : [m.fx, m.fy + Math.sign(dy)];
    return [[m.fx, m.fy], leg, [m.tx, m.ty]];
  }
  return [
    [m.fx, m.fy],
    [m.tx, m.ty],
  ];
}

/** 点 (px,py) 到线段 (ax,ay)-(bx,by) 的距离 */
function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const L = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
