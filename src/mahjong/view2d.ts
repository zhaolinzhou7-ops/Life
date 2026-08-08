/** 四川麻将横屏界面渲染器：斜俯视牌桌 + 四家环绕 + 大牌手牌（Canvas 2D） */
import { SUITS, type Meld, type TileId } from './rules';
import { drawBack, drawTile } from './tiles2d';
import { avatarCanvas, type Character } from '../characters';

/** 设计分辨率：横屏 844×390（真人麻将 App 都是横屏，手牌能放到两倍大） */
const DW = 844;
const DH = 390;

/** 牌桌上下沿 & 弃牌十字中心 */
const TOP = 4;
const BOT = 300;
const CX = DW / 2;
const CY = 162;

/** 弃牌堆：上下家横排、左右家竖排 */
const DTW = 18;
const DTH = 23;
const DGAP = 1;
const ROW_TB = 10; // 对家/自己每行张数
const ROW_LR = 8; // 左右家每列张数
const D_OFF_X = 104;
const D_OFF_Y = 30;

export interface SeatView {
  name: string;
  char: Character | null;
  hand: TileId[];
  handCount: number;
  melds: Meld[];
  discards: TileId[];
  lack: number; // -1 未定缺
  score: number;
  won: boolean;
  ting: boolean;
  justDiscarded: boolean;
}

export interface ViewState {
  seats: SeatView[]; // 0=我 1=右 2=对 3=左
  wallLeft: number;
  activeSeat: number;
  selected: number;
  drawnSeparate: boolean;
  picked: number[];
  centerHint: string;
  tingTiles: TileId[];
  timer: TimerState | null;
  huAlert: boolean;
}

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  idx: number;
}

/** 飞行中的牌（摸牌 / 打牌） */
interface Flight {
  tile: TileId;
  back: boolean;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  w: number;
  h: number;
  arc: number;
  spin: number;
  born: number;
  dur: number;
  done: () => void;
}

/** 碰/杠/胡 提示：贴着座位弹出，不再糊满全屏 */
interface Impact {
  text: string;
  sub: string;
  color: string;
  seat: number;
  born: number;
  dur: number;
  sparks: { a: number; sp: number; r: number }[];
}

interface Coin {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  born: number;
  dur: number;
}

export interface TimerState {
  seat: number;
  left: number;
  total: number;
}

export class MahjongView {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private raf = 0;
  private disposed = false;
  private hits: HitRect[] = [];
  private avatarImgs = new Map<string, HTMLCanvasElement>();
  private speckles: [number, number, number][] = [];
  private fx: { kind: 'burst' | 'text'; seat: number; text?: string; color: string; born: number; dur: number }[] = [];
  /** 竖屏时提示旋转 */
  private portrait = false;

  state: ViewState = {
    seats: [],
    wallLeft: 0,
    activeSeat: -1,
    selected: -1,
    drawnSeparate: false,
    picked: [],
    centerHint: '',
    tingTiles: [],
    timer: null,
    huAlert: false,
  };

  private flights: Flight[] = [];
  private impacts: Impact[] = [];
  private coins: Coin[] = [];
  private shakes: { power: number; born: number; dur: number }[] = [];
  private flashes: { color: string; alpha: number; born: number; dur: number }[] = [];

  constructor(
    container: HTMLElement,
    private onTileTap: (idx: number) => void,
  ) {
    this.cv = document.createElement('canvas');
    this.cv.className = 'mj-canvas';
    container.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
    for (let i = 0; i < 90; i++) {
      this.speckles.push([20 + Math.random() * (DW - 40), TOP + Math.random() * (BOT - TOP), Math.random()]);
    }
    this.resize();
    window.addEventListener('resize', this.resize);
    window.addEventListener('orientationchange', this.resize);
    this.cv.addEventListener('pointerdown', this.onPointer);
    this.loop();
  }

  private resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.portrait = h > w;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    this.scale = Math.min(w / DW, h / DH);
    this.ox = (w - DW * this.scale) / 2;
    this.oy = (h - DH * this.scale) / 2;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const root = this.cv.parentElement;
    if (root) {
      root.style.setProperty('--mj-act-top', `${this.oy + 296 * this.scale}px`);
      root.style.setProperty('--mj-chat-top', `${this.oy + 8 * this.scale}px`);
      root.classList.toggle('mj-portrait', this.portrait);
    }
  };

  private onPointer = (e: PointerEvent) => {
    if (this.portrait) return;
    const r = this.cv.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.scale;
    const y = (e.clientY - r.top - this.oy) / this.scale;
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        this.onTileTap(h.idx);
        return;
      }
    }
  };

  burst(seat: number, text: string, color = '#ffd76e') {
    this.fx.push({ kind: 'burst', seat, color, born: performance.now(), dur: 700 });
    this.fx.push({ kind: 'text', seat, text, color, born: performance.now(), dur: 1100 });
  }

  // ============ 动画 / 提示 API ============

  /** 某家手牌区的锚点 */
  private seatAnchor(seat: number): [number, number] {
    if (seat === 0) return [CX, DH - 66];
    if (seat === 1) return [DW - 44, CY];
    if (seat === 2) return [CX, 52];
    return [44, CY];
  }

  private discardSlot(seat: number, idx: number): [number, number] {
    if (seat === 0 || seat === 2) {
      const row = Math.floor(idx / ROW_TB);
      const col = idx % ROW_TB;
      const half = (ROW_TB * (DTW + DGAP)) / 2;
      if (seat === 0) return [CX - half + col * (DTW + DGAP), CY + D_OFF_Y + row * (DTH + DGAP)];
      return [CX + half - (col + 1) * (DTW + DGAP), CY - D_OFF_Y - (row + 1) * (DTH + DGAP)];
    }
    const row = Math.floor(idx / ROW_LR);
    const col = idx % ROW_LR;
    const half = (ROW_LR * (DTH + DGAP)) / 2;
    if (seat === 1) return [CX + D_OFF_X + row * (DTW + DGAP), CY - half + col * (DTH + DGAP)];
    return [CX - D_OFF_X - (row + 1) * (DTW + DGAP), CY + half - (col + 1) * (DTH + DGAP)];
  }

  flyDiscard(seat: number, tile: TileId, idx: number): Promise<void> {
    const [x0, y0] = this.seatAnchor(seat);
    const [x1, y1] = this.discardSlot(seat, idx);
    return this.fly(tile, false, x0, y0, x1, y1, DTW, DTH, 240, seat === 0 ? -34 : -22);
  }

  flyDraw(seat: number): Promise<void> {
    const [x1, y1] = this.seatAnchor(seat);
    return this.fly(0, true, CX - 130, CY, x1, y1, 15, 20, 180, -24);
  }

  private fly(
    tile: TileId, back: boolean, x0: number, y0: number, x1: number, y1: number,
    w: number, h: number, dur: number, arc: number,
  ): Promise<void> {
    return new Promise((resolve) => {
      this.flights.push({
        tile, back, x0, y0, x1, y1, w, h, arc,
        spin: (Math.random() - 0.5) * 0.5,
        born: performance.now(), dur, done: resolve,
      });
    });
  }

  /**
   * 碰/杠/胡 提示：贴着出牌那家弹出中等大小的字 + 少量火星。
   * 真人麻将里这是个「一闪而过的确认」，不是过场动画，所以刻意做小。
   */
  impact(seat: number, text: string, sub: string, color: string, power = 1) {
    const n = power >= 1.3 ? 12 : 6;
    const sparks = Array.from({ length: n }, () => ({
      a: Math.random() * Math.PI * 2,
      sp: 40 + Math.random() * 90,
      r: 1 + Math.random() * 2,
    }));
    this.impacts.push({ text, sub, color, seat, born: performance.now(), dur: 900, sparks });
    this.shake(power * 0.4);
    if (power >= 1.3) this.flash(color, 0.1, 160);
  }

  shake(power = 1) {
    if (power <= 0) return;
    this.shakes.push({ power, born: performance.now(), dur: 300 });
  }

  flash(color: string, alpha: number, dur = 200) {
    this.flashes.push({ color, alpha, born: performance.now(), dur });
  }

  coinFly(from: number, to: number, n = 6) {
    const [x0, y0] = this.seatAnchor(from);
    const [x1, y1] = this.seatAnchor(to);
    const now = performance.now();
    for (let i = 0; i < n; i++) {
      this.coins.push({
        x0: x0 + (Math.random() - 0.5) * 44,
        y0: y0 + (Math.random() - 0.5) * 26,
        x1: x1 + (Math.random() - 0.5) * 54,
        y1: y1 + (Math.random() - 0.5) * 20,
        born: now + i * 50,
        dur: 560,
      });
    }
  }

  get busy() {
    return this.flights.length > 0 || this.impacts.length > 0;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
    window.removeEventListener('orientationchange', this.resize);
    this.cv.removeEventListener('pointerdown', this.onPointer);
    this.cv.remove();
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    this.render();
  };

  // ============ 渲染 ============
  private render() {
    const g = this.g;
    const W = window.innerWidth;
    const H = window.innerHeight;
    g.save();
    g.clearRect(0, 0, W, H);
    g.fillStyle = '#06110c';
    g.fillRect(0, 0, W, H);

    if (this.portrait) {
      this.drawRotateHint(W, H);
      g.restore();
      return;
    }

    const now = performance.now();
    this.shakes = this.shakes.filter((s) => now - s.born < s.dur);
    let sx = 0;
    let sy = 0;
    for (const s of this.shakes) {
      const k = 1 - (now - s.born) / s.dur;
      const amp = 7 * s.power * k * k;
      sx += Math.sin((now - s.born) * 0.075) * amp;
      sy += Math.cos((now - s.born) * 0.093) * amp;
    }

    g.translate(this.ox + sx, this.oy + sy);
    g.scale(this.scale, this.scale);

    this.hits = [];
    this.drawTable();
    this.drawWall();
    this.drawCenter();
    this.drawOpponents();
    this.drawMyArea();
    this.drawRail();
    this.drawPlayerCards();
    this.drawFlights();
    this.drawCoins();
    this.drawTimer();
    this.drawCenterHint();
    this.drawFx();
    this.drawHuAlert();
    this.drawImpacts();
    this.drawFlashes();

    g.restore();
  }

  /** 竖屏：提示旋转手机 */
  private drawRotateHint(W: number, H: number) {
    const g = this.g;
    g.save();
    g.textAlign = 'center';
    g.translate(W / 2, H / 2);
    const t = performance.now() * 0.0016;
    const a = Math.sin(t) * 0.5 - 0.5; // -1..0 rad，来回转
    g.save();
    g.rotate(a);
    g.strokeStyle = '#ffd76e';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(-32, -56, 64, 112, 10);
    g.stroke();
    g.fillStyle = 'rgba(255,215,110,0.18)';
    g.fill();
    g.restore();
    g.fillStyle = '#ffe9b0';
    g.font = 'bold 20px sans-serif';
    g.fillText('请横屏', 0, 108);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '13px sans-serif';
    g.fillText('横过来牌更大，和真人麻将一样', 0, 134);
    g.restore();
  }

  /** 斜俯视牌桌 */
  private drawTable() {
    const g = this.g;
    const tl = 46;
    const tr = DW - 46;
    const bl = -30;
    const br = DW + 30;

    const wood = g.createLinearGradient(0, TOP, 0, BOT);
    wood.addColorStop(0, '#5a3418');
    wood.addColorStop(0.5, '#7a4a22');
    wood.addColorStop(1, '#3d2210');
    g.fillStyle = wood;
    g.beginPath();
    g.moveTo(tl, TOP);
    g.lineTo(tr, TOP);
    g.lineTo(br, BOT);
    g.lineTo(bl, BOT);
    g.closePath();
    g.fill();
    g.save();
    g.clip();
    g.globalAlpha = 0.12;
    for (let i = 0; i < 22; i++) {
      g.strokeStyle = i % 2 ? '#000' : '#e0b070';
      g.lineWidth = 1;
      const yy = TOP + (i / 22) * (BOT - TOP);
      g.beginPath();
      g.moveTo(bl, yy);
      g.lineTo(br, yy + 2);
      g.stroke();
    }
    g.restore();

    const inset = 11;
    const il = tl + inset;
    const ir = tr - inset;
    const ibl = bl + inset * 1.6;
    const ibr = br - inset * 1.6;
    const itop = TOP + inset * 0.6;
    const ibot = BOT - inset * 0.6;
    g.strokeStyle = 'rgba(255,214,120,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(il, itop);
    g.lineTo(ir, itop);
    g.lineTo(ibr, ibot);
    g.lineTo(ibl, ibot);
    g.closePath();
    g.stroke();

    const grad = g.createRadialGradient(CX, CY, 40, CX, CY, 460);
    grad.addColorStop(0, '#2f9a65');
    grad.addColorStop(0.55, '#1f7d4e');
    grad.addColorStop(1, '#0f4a30');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(il + 2, itop + 2);
    g.lineTo(ir - 2, itop + 2);
    g.lineTo(ibr - 3, ibot - 2);
    g.lineTo(ibl + 3, ibot - 2);
    g.closePath();
    g.fill();

    g.save();
    g.clip();
    for (const [px, py, k] of this.speckles) {
      g.globalAlpha = 0.05 + k * 0.05;
      g.fillStyle = k > 0.5 ? '#ffffff' : '#000000';
      g.fillRect(px, py, 2, 2);
    }
    g.globalAlpha = 1;
    const lamp = g.createRadialGradient(CX, TOP + 20, 10, CX, TOP + 20, 300);
    lamp.addColorStop(0, 'rgba(255,255,220,0.13)');
    lamp.addColorStop(1, 'rgba(255,255,220,0)');
    g.fillStyle = lamp;
    g.fillRect(bl, TOP, br - bl, BOT - TOP);
    g.restore();
  }

  /** 台面梯形在某高度上的左右边界 */
  private feltEdge(y: number): [number, number] {
    const itop = TOP + 6.6;
    const ibot = BOT - 6.6;
    const k = Math.max(0, Math.min(1, (y - itop) / (ibot - itop)));
    return [59 + k * (-12 - 59), DW - 59 + k * (DW + 12 - (DW - 59))];
  }

  /** 牌墙：中央面板两侧的两摞牌背，随剩余张数变短 */
  private drawWall() {
    const g = this.g;
    const left = Math.max(0, this.state.wallLeft);
    if (left === 0) return;
    const tw = 15;
    const th = 20;
    const gap = 1;
    const col = (x: number, count: number) => {
      const n = Math.min(Math.ceil(count / 2), 7);
      if (n <= 0) return;
      const total = n * th + (n - 1) * gap;
      const y0 = CY - total / 2;
      for (let i = 0; i < n; i++) {
        const y = y0 + i * (th + gap);
        drawBack(g, x + 4, y, tw, th);
        drawBack(g, x, y, tw, th);
      }
    };
    const half = Math.ceil(left / 2);
    col(CX - 74, half);
    col(CX + 60, left - half);
  }

  /** 中央：剩余牌数 + 行动方位 */
  private drawCenter() {
    const g = this.g;
    const w = 88;
    const h = 56;
    g.save();
    g.fillStyle = 'rgba(4,26,17,0.62)';
    g.beginPath();
    g.roundRect(CX - w / 2, CY - h / 2, w, h, 11);
    g.fill();
    g.strokeStyle = 'rgba(255,215,110,0.45)';
    g.lineWidth = 1.4;
    g.stroke();

    g.textAlign = 'center';
    g.fillStyle = '#ffe9b0';
    g.font = 'bold 23px sans-serif';
    g.fillText(String(this.state.wallLeft), CX, CY + 3);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '10px sans-serif';
    g.fillText('剩余牌', CX, CY + 18);

    const dirs: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];
    const a = this.state.activeSeat;
    if (a >= 0 && a < 4) {
      const [dx, dy] = dirs[a];
      const t = (performance.now() % 900) / 900;
      g.fillStyle = '#ffd76e';
      g.globalAlpha = 0.5 + Math.sin(t * Math.PI * 2) * 0.4;
      g.beginPath();
      g.arc(CX + dx * (w / 2 - 8), CY + dy * (h / 2 - 8), 4, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
  }

  private drawCenterHint() {
    if (!this.state.centerHint) return;
    const g = this.g;
    g.save();
    g.font = 'bold 15px sans-serif';
    g.textAlign = 'center';
    const tw = Math.min(DW - 120, g.measureText(this.state.centerHint).width + 28);
    g.fillStyle = 'rgba(2,10,6,0.88)';
    g.beginPath();
    g.roundRect(CX - tw / 2, CY - 62, tw, 30, 15);
    g.fill();
    g.strokeStyle = 'rgba(255,215,110,0.5)';
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = '#fff';
    g.fillText(this.state.centerHint, CX, CY - 42, tw - 20);
    g.restore();
  }

  private drawOpponents() {
    for (let seat = 1; seat <= 3; seat++) {
      const s = this.state.seats[seat];
      if (!s) continue;
      if (seat === 2) this.drawTopSeat(s, seat);
      else this.drawSideSeat(s, seat);
      this.drawDiscards(s, seat);
    }
  }

  /** 对家：头像在上，手牌背横排，副露在下 */
  private drawTopSeat(s: SeatView, seat: number) {
    const g = this.g;
    const tw = 13;
    const th = 18;
    const gap = 1.2;
    const n = s.handCount;
    const totalW = n * tw + (n - 1) * gap;
    const y = 42;
    for (let i = 0; i < n; i++) drawBack(g, CX - totalW / 2 + i * (tw + gap), y, tw, th);
    this.drawMeldsCentered(s.melds, CX, y + th + 4, 13, 17, 'h');
    this.drawSeatChip(s, seat, CX, 20, 'center');
  }

  /** 左右家：头像在外侧上方，手牌背贴桌边竖排 */
  private drawSideSeat(s: SeatView, seat: number) {
    const g = this.g;
    const right = seat === 1;
    const tw = 19;
    const th = 12;
    const gap = 1.2;
    const n = s.handCount;
    const totalH = n * th + (n - 1) * gap;
    const y0 = CY - totalH / 2;
    for (let i = 0; i < n; i++) {
      const ty = y0 + i * (th + gap);
      const [l, r] = this.feltEdge(ty + th / 2);
      drawBack(g, right ? r - tw - 6 : l + 6, ty, tw, th, true);
    }
    const [ml, mr] = this.feltEdge(CY);
    this.drawMelds(s.melds, right ? mr - 46 : ml + 28, CY - 72, 15, 20, 'v');
    this.drawSeatChip(s, seat, right ? DW - 120 : 120, 96, right ? 'right' : 'left');
  }

  /** 自己：弃牌 + 底部一条（头像 / 听牌提示 / 副露） */
  private drawMyArea() {
    const s = this.state.seats[0];
    if (!s) return;
    this.drawDiscards(s, 0);
    this.drawSeatChip(s, 0, 108, 272, 'left');
    this.drawTingBar(s);
    this.drawMeldsRight(s.melds, DW - 22, 258, 22, 30);
  }

  private drawDiscards(s: SeatView, seat: number) {
    const g = this.g;
    const list = s.discards;
    for (let i = 0; i < list.length; i++) {
      const [x, y] = this.discardSlot(seat, i);
      const last = i === list.length - 1 && s.justDiscarded;
      drawTile(g, list[i], x, y, DTW, DTH, { glow: last ? '#ffd76e' : undefined });
    }
  }

  private meldsSize(melds: Meld[], tw: number, th: number, dir: 'h' | 'v') {
    let n = 0;
    for (const m of melds) n += m.kind === 'peng' ? 3 : 4;
    const step = dir === 'h' ? tw + 1 : th + 1;
    return n * step + Math.max(0, melds.length - 1) * 6;
  }

  private drawMeldsCentered(melds: Meld[], cx: number, y: number, tw: number, th: number, dir: 'h' | 'v') {
    if (!melds.length) return;
    this.drawMelds(melds, cx - this.meldsSize(melds, tw, th, dir) / 2, y, tw, th, dir);
  }

  /** 自己的副露：从右往左排，靠着桌子右下角 */
  private drawMeldsRight(melds: Meld[], rightX: number, y: number, tw: number, th: number) {
    if (!melds.length) return;
    this.drawMelds(melds, rightX - this.meldsSize(melds, tw, th, 'h'), y, tw, th, 'h');
  }

  private drawMelds(melds: Meld[], x: number, y: number, tw: number, th: number, dir: 'h' | 'v') {
    const g = this.g;
    let ox = x;
    let oy = y;
    for (const m of melds) {
      const n = m.kind === 'peng' ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const hidden = m.kind === 'angang' && i < 3;
        if (dir === 'h') {
          if (hidden) drawBack(g, ox + i * (tw + 1), oy, tw, th);
          else drawTile(g, m.tile, ox + i * (tw + 1), oy, tw, th);
        } else {
          if (hidden) drawBack(g, ox, oy + i * (th + 1), tw, th, true);
          else drawTile(g, m.tile, ox, oy + i * (th + 1), tw, th);
        }
      }
      if (dir === 'h') ox += n * (tw + 1) + 6;
      else oy += n * (th + 1) + 6;
    }
  }

  /** 座位牌：圆头像 + 名字分数 + 缺/听/胡 徽章（横屏空间紧，做成紧凑一条） */
  private drawSeatChip(s: SeatView, seat: number, cx: number, cy: number, align: 'left' | 'right' | 'center') {
    const g = this.g;
    const active = this.state.activeSeat === seat;
    const col = s.char?.color ?? '#40c4ff';
    const r = 17;
    const av = this.getAvatar(s);

    g.save();
    // 头像
    const ax = align === 'right' ? cx + 26 : align === 'left' ? cx - 26 : cx - 62;
    if (av) {
      g.save();
      g.beginPath();
      g.arc(ax, cy, r, 0, Math.PI * 2);
      g.clip();
      g.drawImage(av, ax - r, cy - r, r * 2, r * 2);
      g.restore();
    } else {
      g.fillStyle = 'rgba(8,24,16,0.9)';
      g.beginPath();
      g.arc(ax, cy, r, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#9fd8ff';
      g.font = 'bold 13px sans-serif';
      g.textAlign = 'center';
      g.fillText('我', ax, cy + 4.5);
    }
    g.strokeStyle = active ? col : 'rgba(255,255,255,0.3)';
    g.lineWidth = active ? 2.5 : 1.4;
    if (active) {
      g.shadowColor = col;
      g.shadowBlur = 10;
    }
    g.beginPath();
    g.arc(ax, cy, r, 0, Math.PI * 2);
    g.stroke();
    g.shadowBlur = 0;

    // 名字 + 分数
    const tx = align === 'right' ? ax - r - 8 : ax + r + 8;
    g.textAlign = align === 'right' ? 'right' : 'left';
    g.fillStyle = '#fff';
    g.font = 'bold 13px sans-serif';
    g.fillText(s.name, tx, cy - 2);
    g.font = 'bold 12px sans-serif';
    g.fillStyle = s.score > 0 ? '#7dff9f' : s.score < 0 ? '#ff8a80' : 'rgba(255,255,255,0.55)';
    g.fillText(`${s.score > 0 ? '+' : ''}${s.score}`, tx, cy + 12);

    // 徽章
    const badges: [string, string, string][] = [];
    if (s.lack >= 0) badges.push(['缺' + SUITS[s.lack], 'rgba(235,90,60,0.92)', '#fff']);
    if (s.ting && !s.won) badges.push(['听', 'rgba(90,200,120,0.95)', '#06210f']);
    if (s.won) badges.push(['胡', 'rgba(255,190,60,0.95)', '#3a2000']);
    let bx = align === 'right' ? tx - 44 : tx + 44;
    for (const [text, bg, fg] of badges) {
      g.font = 'bold 9.5px sans-serif';
      const bw = g.measureText(text).width + 9;
      const x = align === 'right' ? bx - bw : bx;
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect(x, cy - 6, bw, 13, 6.5);
      g.fill();
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.fillText(text, x + bw / 2, cy + 3.5);
      bx += align === 'right' ? -(bw + 3) : bw + 3;
    }
    g.restore();
  }

  private getAvatar(s: SeatView): HTMLCanvasElement | null {
    if (!s.char) return null;
    const key = s.char.id;
    let img = this.avatarImgs.get(key);
    if (!img) {
      img = avatarCanvas(s.char, 68);
      this.avatarImgs.set(key, img);
    }
    return img;
  }

  /** 听牌提示条（桌面左下） */
  private drawTingBar(s: SeatView) {
    void s;
    const items = this.state.tingTiles.slice(0, 8);
    if (!items.length) return;
    const g = this.g;
    const iw = 18;
    const ih = 24;
    const x = 212;
    const y = 258;
    const totW = items.length * (iw + 2) + 44;
    g.save();
    g.fillStyle = 'rgba(6,28,17,0.9)';
    g.beginPath();
    g.roundRect(x, y - 3, totW, ih + 8, 8);
    g.fill();
    g.strokeStyle = 'rgba(120,255,160,0.55)';
    g.lineWidth = 1;
    g.stroke();
    g.fillStyle = '#8effb0';
    g.font = 'bold 12px sans-serif';
    g.textAlign = 'left';
    g.fillText('听', x + 9, y + ih / 2 + 5);
    items.forEach((t, i) => drawTile(g, t, x + 26 + i * (iw + 2), y + 1, iw, ih));
    g.restore();
  }

  /** 桌沿护栏（手牌区背景） */
  private drawRail() {
    const g = this.g;
    const rg = g.createLinearGradient(0, BOT, 0, DH);
    rg.addColorStop(0, '#3a2110');
    rg.addColorStop(0.2, '#25150a');
    rg.addColorStop(1, '#100a06');
    g.fillStyle = rg;
    g.fillRect(0, BOT, DW, DH - BOT);
    g.strokeStyle = 'rgba(255,214,120,0.28)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.moveTo(0, BOT + 1);
    g.lineTo(DW, BOT + 1);
    g.stroke();
  }

  /** 玩家手牌：横屏下宽度充足，牌可以做到接近真人麻将的观感 */
  private drawPlayerCards() {
    const g = this.g;
    const s = this.state.seats[0];
    if (!s) return;
    const tiles = s.hand;
    const n = tiles.length;
    if (n === 0) return;

    const drawn = this.state.drawnSeparate && n > 1;
    const baseN = drawn ? n - 1 : n;
    const gap = 2;
    const drawnGap = 16;
    const avail = DW - 28;
    const slots = drawn ? baseN + 1 : baseN;
    const fixed = (baseN - 1) * gap + (drawn ? drawnGap : 0);
    const tw = Math.min(58, (avail - fixed) / slots);
    const th = tw * 1.4;
    const totalW = slots * tw + fixed;
    const x0 = (DW - totalW) / 2;
    const y = DH - 12 - th;

    g.save();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.roundRect(x0 - 6, y + th * 0.6, totalW + 12, th * 0.5, 6);
    g.fill();
    g.restore();

    for (let i = 0; i < n; i++) {
      const isDrawn = drawn && i === n - 1;
      const x = isDrawn ? x0 + baseN * (tw + gap) - gap + drawnGap : x0 + i * (tw + gap);
      const picked = this.state.picked.includes(i);
      const sel = this.state.selected === i;
      drawTile(g, tiles[i], x, y, tw, th, {
        lift: sel ? 16 : picked ? 10 : 0,
        glow: picked ? '#66ff8f' : sel ? '#ffd76e' : undefined,
      });
      this.hits.push({ x: x - 1, y: y - 22, w: tw + 2, h: th + 28, idx: i });
    }
  }

  private drawFlights() {
    const g = this.g;
    const now = performance.now();
    for (const f of this.flights) {
      const k = Math.min(1, (now - f.born) / f.dur);
      const e = 1 - (1 - k) * (1 - k);
      const x = f.x0 + (f.x1 - f.x0) * e;
      const y = f.y0 + (f.y1 - f.y0) * e + Math.sin(k * Math.PI) * f.arc;
      const pop = k > 0.86 ? 1 + (1 - (k - 0.86) / 0.14) * 0.1 : 1.14 - k * 0.14;
      g.save();
      g.translate(x + f.w / 2, y + f.h / 2);
      g.rotate(f.spin * (1 - e));
      g.scale(pop, pop);
      if (f.back) drawBack(g, -f.w / 2, -f.h / 2, f.w, f.h);
      else drawTile(g, f.tile, -f.w / 2, -f.h / 2, f.w, f.h);
      g.restore();
    }
    const landed = this.flights.filter((f) => now - f.born >= f.dur);
    if (landed.length) {
      this.flights = this.flights.filter((f) => now - f.born < f.dur);
      for (const f of landed) f.done();
    }
  }

  private drawCoins() {
    const g = this.g;
    const now = performance.now();
    this.coins = this.coins.filter((c) => now - c.born < c.dur);
    for (const c of this.coins) {
      const t = now - c.born;
      if (t < 0) continue;
      const k = t / c.dur;
      const e = k * k * (3 - 2 * k);
      const x = c.x0 + (c.x1 - c.x0) * e;
      const y = c.y0 + (c.y1 - c.y0) * e - Math.sin(k * Math.PI) * 46;
      const r = 6 + Math.sin(k * Math.PI) * 1.6;
      const sq = Math.abs(Math.cos(t * 0.014));
      g.save();
      g.globalAlpha = k > 0.85 ? 1 - (k - 0.85) / 0.15 : 1;
      g.translate(x, y);
      g.scale(Math.max(0.25, sq), 1);
      const cg = g.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
      cg.addColorStop(0, '#fff6c8');
      cg.addColorStop(0.55, '#ffc93c');
      cg.addColorStop(1, '#b8770d');
      g.fillStyle = cg;
      g.beginPath();
      g.arc(0, 0, r, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }

  private drawTimer() {
    const t = this.state.timer;
    if (!t) return;
    const g = this.g;
    const cx = t.seat === 0 ? 32 : this.seatAnchor(t.seat)[0];
    const cy = t.seat === 0 ? 272 : this.seatAnchor(t.seat)[1];
    const r = 15;
    const k = Math.max(0, Math.min(1, t.left / t.total));
    const urgent = t.left <= 3;
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fillStyle = 'rgba(4,16,10,0.8)';
    g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    g.lineWidth = 3;
    g.stroke();
    g.globalAlpha = urgent ? 0.6 + Math.abs(Math.sin(performance.now() * 0.008)) * 0.4 : 1;
    g.strokeStyle = urgent ? '#ff5252' : '#7dff9f';
    g.lineWidth = 3;
    g.beginPath();
    g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
    g.stroke();
    g.globalAlpha = 1;
    g.fillStyle = urgent ? '#ff8a80' : '#e8fff0';
    g.font = 'bold 13px sans-serif';
    g.textAlign = 'center';
    g.fillText(String(Math.ceil(t.left)), cx, cy + 4.5);
    g.restore();
  }

  private drawHuAlert() {
    if (!this.state.huAlert) return;
    const g = this.g;
    const p = 0.35 + Math.abs(Math.sin(performance.now() * 0.009)) * 0.65;
    g.save();
    const grd = g.createLinearGradient(0, 0, 0, DH);
    grd.addColorStop(0, `rgba(255,60,60,${0.42 * p})`);
    grd.addColorStop(0.24, 'rgba(255,60,60,0)');
    grd.addColorStop(0.76, 'rgba(255,60,60,0)');
    grd.addColorStop(1, `rgba(255,60,60,${0.42 * p})`);
    g.fillStyle = grd;
    g.fillRect(0, 0, DW, DH);
    g.restore();
  }

  private drawFlashes() {
    const g = this.g;
    const now = performance.now();
    this.flashes = this.flashes.filter((f) => now - f.born < f.dur);
    for (const f of this.flashes) {
      const k = (now - f.born) / f.dur;
      g.save();
      g.globalAlpha = f.alpha * (1 - k);
      g.fillStyle = f.color;
      g.fillRect(-40, -40, DW + 80, DH + 80);
      g.restore();
    }
  }

  /** 碰/杠/胡：贴着那家弹一下就走，克制 */
  private drawImpacts() {
    const g = this.g;
    const now = performance.now();
    this.impacts = this.impacts.filter((im) => now - im.born < im.dur);
    for (const im of this.impacts) {
      const k = (now - im.born) / im.dur;
      const [ax, ay] = this.seatAnchor(im.seat);
      // 往桌心方向让一点，避免压住手牌/头像
      const cx = ax + (CX - ax) * 0.3;
      const cy = ay + (CY - ay) * 0.5;

      // 小范围冲击环
      if (k < 0.4) {
        const kk = k / 0.4;
        g.save();
        g.globalAlpha = (1 - kk) * 0.55;
        g.strokeStyle = im.color;
        g.lineWidth = 3 * (1 - kk) + 0.6;
        g.beginPath();
        g.arc(cx, cy, 12 + kk * 62, 0, Math.PI * 2);
        g.stroke();
        g.restore();
      }

      // 少量火星
      g.save();
      for (const s of im.sparks) {
        const d = s.sp * k;
        const alpha = (1 - k) ** 2;
        g.globalAlpha = alpha * 0.85;
        g.fillStyle = im.color;
        g.beginPath();
        g.arc(cx + Math.cos(s.a) * d, cy + Math.sin(s.a) * d + k * k * 34, s.r * (1 - k * 0.6), 0, Math.PI * 2);
        g.fill();
      }
      g.restore();

      // 字：弹入 → 停住 → 淡出
      const inK = Math.min(1, k / 0.18);
      let sc = 0.55 + (1 - (1 - inK) ** 3) * 0.55;
      if (k > 0.18 && k < 0.3) sc = 1.16 - ((k - 0.18) / 0.12) * 0.16;
      else if (k >= 0.3) sc = 1;
      const alpha = k > 0.72 ? 1 - (k - 0.72) / 0.28 : 1;
      const rise = k > 0.3 ? (k - 0.3) * 26 : 0;
      g.save();
      g.globalAlpha = alpha;
      g.translate(cx, cy - rise);
      g.scale(sc, sc);
      g.textAlign = 'center';
      g.font = 'bold 42px "STKaiti","KaiTi","SimHei",sans-serif';
      g.lineWidth = 6;
      g.lineJoin = 'round';
      g.strokeStyle = 'rgba(20,4,0,0.85)';
      g.strokeText(im.text, 0, 0);
      const tg = g.createLinearGradient(0, -26, 0, 14);
      tg.addColorStop(0, '#fffbe0');
      tg.addColorStop(0.5, '#ffe27a');
      tg.addColorStop(1, im.color);
      g.fillStyle = tg;
      g.fillText(im.text, 0, 0);
      if (im.sub && k > 0.18) {
        g.font = 'bold 14px sans-serif';
        g.lineWidth = 4;
        g.strokeStyle = 'rgba(20,4,0,0.8)';
        g.strokeText(im.sub, 0, 20);
        g.fillStyle = '#fff3c4';
        g.fillText(im.sub, 0, 20);
      }
      g.restore();
    }
  }

  private drawFx() {
    const g = this.g;
    const now = performance.now();
    this.fx = this.fx.filter((f) => now - f.born < f.dur);
    for (const f of this.fx) {
      if (f.kind !== 'text' || !f.text) continue;
      const k = (now - f.born) / f.dur;
      const [cx, cy] = this.seatAnchor(f.seat);
      g.save();
      g.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
      g.translate(cx, cy - 10 - k * 20);
      g.textAlign = 'center';
      g.font = 'bold 24px sans-serif';
      g.lineWidth = 4;
      g.strokeStyle = 'rgba(0,0,0,0.75)';
      g.strokeText(f.text, 0, 0);
      g.fillStyle = f.color;
      g.fillText(f.text, 0, 0);
      g.restore();
    }
  }
}
