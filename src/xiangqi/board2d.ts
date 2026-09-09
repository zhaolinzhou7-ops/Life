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

const RED = '#b3311f';
const BLACK = '#22303a';

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
}

export class Board2D {
  readonly canvas: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private board: Board | null = null;
  private marks: Mark[] = [];
  private arrows: Arrow[] = [];
  private flip: boolean;
  private onTap?: (x: number, y: number) => void;

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
    this.cell = Math.min(r.width / (COLS + 0.9), r.height / (ROWS + 0.6));
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
    g.fillStyle = '#f0dcb4';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.restore();

    // 象牙面：斜向渐变做出圆盘的受光
    const grd = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    grd.addColorStop(0, '#fdf0d6');
    grd.addColorStop(0.55, '#f0dcb4');
    grd.addColorStop(1, '#d8bf93');
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
    g.lineWidth = Math.max(1.2, r * 0.06);
    g.beginPath();
    g.arc(cx, cy, r * 0.8, 0, Math.PI * 2);
    g.stroke();

    // 字：先压一道暗影再写正色，看起来像刻进去的
    const label = pieceName(t, c);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `700 ${Math.round(r * 1.08)}px "STKaiti","KaiTi","Songti SC",serif`;
    g.fillStyle = 'rgba(90,60,30,0.30)';
    g.fillText(label, cx + r * 0.035, cy + r * 0.045);
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
