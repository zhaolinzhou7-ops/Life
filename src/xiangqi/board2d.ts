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
import { COLS, ROWS, type Board, type Color, type Move, type PType } from './rules';
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
}

export interface Board2DOpts {
  /** true = 黑方在下（执黑时用） */
  flip?: boolean;
  onTap?: (x: number, y: number) => void;
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
  setBoard(b: Board) {
    this.board = b;
    this.dirty = true;
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
  }
  clearMarks() {
    this.marks = [];
    this.arrows = [];
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
    this.board = board;
    this.dirty = true;
    requestAnimationFrame(() => onDone());
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
    if (!this.onTap) return;
    const r = this.canvas.getBoundingClientRect();
    const cx = e.clientX - r.left;
    const cy = e.clientY - r.top;
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
    if (this.last) {
      // 对局里两秒淡出，复盘里常驻
      let alpha = 1;
      if (this.lastFade) {
        const t = performance.now() - this.lastAt;
        alpha = t >= LAST_FADE_MS ? 0 : t <= LAST_HOLD_MS ? 1 : 1 - (t - LAST_HOLD_MS) / (LAST_FADE_MS - LAST_HOLD_MS);
      }
      if (alpha > 0.01) {
        for (const [lx, ly, solid] of [
          [this.last.fx, this.last.fy, 0],
          [this.last.tx, this.last.ty, 1],
        ] as const) {
          const [px, py] = this.px(lx, ly);
          const r = c * 0.42;
          g.save();
          // 比原来轻很多：细线、不填色，只在终点留一点淡淡的底
          g.strokeStyle = `rgba(96,156,232,${0.55 * alpha})`;
          g.lineWidth = Math.max(1.5, c * 0.035);
          g.beginPath();
          g.rect(px - r, py - r, r * 2, r * 2);
          if (solid) {
            g.fillStyle = `rgba(96,156,232,${0.10 * alpha})`;
            g.fill();
          }
          g.stroke();
          g.restore();
        }
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

    // 棋子：每个都画在自己的交叉点上，没有中间状态
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const p = this.board[y][x];
        if (!p) continue;
        const [px, py] = this.px(x, y);
        g.drawImage(this.sprite(p.t, p.c), px - spriteR, py - spriteR, spriteR * 2, spriteR * 2);
      }
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

  private drawArrow(ar: Arrow) {
    const g = this.g;
    const [sx, sy] = this.px(ar.fx, ar.fy);
    const [tx, ty] = this.px(ar.tx, ar.ty);
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const r = this.cell * 0.42;
    // 两端各让开一个棋子的半径，箭头不压在字上
    const ax = sx + ux * r;
    const ay = sy + uy * r;
    const bx = tx - ux * r * 0.7;
    const by = ty - uy * r * 0.7;
    const head = this.cell * 0.26;

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
    g.restore();
  }
}
