/** 四川麻将 2.5D 界面渲染器：斜俯视牌桌 + 四家环绕 + 清晰大牌（Canvas 2D） */
import { SUITS, type Meld, type TileId } from './rules';
import { drawBack, drawTile } from './tiles2d';
import { avatarCanvas, type Character } from '../characters';

/** 设计分辨率（按此坐标系布局，渲染时整体缩放到屏幕） */
const DW = 390;
const DH = 844;

/** 牌桌上下沿 & 弃牌十字中心 */
const TOP = 66;
const BOT = 700;
const CX = DW / 2;
const CY = 400;

/** 弃牌堆尺寸 */
const DTW = 18;
const DTH = 24;
const DGAP = 1;
const PER_ROW = 6;
/** 弃牌堆离中央面板的距离（要大于面板半宽/半高，否则会压住） */
const D_OFF_X = 54;
const D_OFF_Y = 42;

export interface SeatView {
  name: string;
  char: Character | null;
  /** 手牌（仅玩家展示牌面，其他家只给数量） */
  hand: TileId[];
  handCount: number;
  melds: Meld[];
  discards: TileId[];
  lack: number; // -1 未定缺
  score: number;
  won: boolean;
  ting: boolean;
  /** 刚打出的牌高亮 */
  justDiscarded: boolean;
}

export interface ViewState {
  seats: SeatView[]; // 0=我 1=右 2=对 3=左
  wallLeft: number;
  activeSeat: number;
  /** 玩家手牌选中索引 */
  selected: number;
  /** 刚摸的牌与手牌分开显示 */
  drawnSeparate: boolean;
  /** 高亮可点的手牌（换三张选牌用） */
  picked: number[];
  /** 中央提示文字 */
  centerHint: string;
  /** 听牌提示（打出后听什么） */
  tingTiles: TileId[];
}

interface HitRect {
  x: number;
  y: number;
  w: number;
  h: number;
  idx: number;
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
  /** 台面噪点（一次生成，避免每帧闪烁） */
  private speckles: [number, number, number][] = [];
  /** 特效：{t:0..1} 冲击波与飘字 */
  private fx: { kind: 'burst' | 'text'; seat: number; text?: string; color: string; born: number; dur: number }[] = [];

  state: ViewState = {
    seats: [],
    wallLeft: 0,
    activeSeat: -1,
    selected: -1,
    drawnSeparate: false,
    picked: [],
    centerHint: '',
    tingTiles: [],
  };

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
    this.cv.addEventListener('pointerdown', this.onPointer);
    this.loop();
  }

  private resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.cv.width = Math.round(w * dpr);
    this.cv.height = Math.round(h * dpr);
    this.cv.style.width = w + 'px';
    this.cv.style.height = h + 'px';
    // 等比缩放并居中：取较小比例，保证 844 高的设计稿永不被裁切
    this.scale = Math.min(w / DW, h / DH);
    this.ox = (w - DW * this.scale) / 2;
    this.oy = (h - DH * this.scale) / 2;
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // 把设计坐标暴露给 DOM 浮层（操作按钮条 / 聊天按钮），让它们跟着牌桌缩放走
    const root = this.cv.parentElement;
    if (root) {
      root.style.setProperty('--mj-act-top', `${this.oy + 712 * this.scale}px`);
      root.style.setProperty('--mj-chat-top', `${this.oy + 596 * this.scale}px`);
      root.style.setProperty('--mj-scale', `${this.scale}`);
    }
  };

  private onPointer = (e: PointerEvent) => {
    const r = this.cv.getBoundingClientRect();
    const x = (e.clientX - r.left - this.ox) / this.scale;
    const y = (e.clientY - r.top - this.oy) / this.scale;
    // 逆序命中（后画的在上）
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) {
        this.onTileTap(h.idx);
        return;
      }
    }
  };

  /** 触发座位特效 */
  burst(seat: number, text: string, color = '#ffd76e') {
    this.fx.push({ kind: 'burst', seat, color, born: performance.now(), dur: 700 });
    this.fx.push({ kind: 'text', seat, text, color, born: performance.now(), dur: 1100 });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.resize);
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

    g.translate(this.ox, this.oy);
    g.scale(this.scale, this.scale);

    this.hits = [];
    this.drawTable();
    this.drawWall();
    this.drawCenter();
    this.drawOpponents();
    this.drawMyArea();
    this.drawRail();
    this.drawPlayerCards();
    this.drawCenterHint();
    this.drawFx();

    g.restore();
  }

  /** 斜俯视牌桌：木质外框 + 金线 + 绿呢台面 */
  private drawTable() {
    const g = this.g;
    // 上窄下宽的梯形 = 透视
    const tl = 30;
    const tr = DW - 30;
    const bl = -26;
    const br = DW + 26;

    // 木质外框
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
    // 木纹
    g.save();
    g.clip();
    g.globalAlpha = 0.12;
    for (let i = 0; i < 26; i++) {
      g.strokeStyle = i % 2 ? '#000' : '#e0b070';
      g.lineWidth = 1;
      const yy = TOP + (i / 26) * (BOT - TOP);
      g.beginPath();
      g.moveTo(bl, yy);
      g.lineTo(br, yy + 3);
      g.stroke();
    }
    g.restore();

    // 金色内线
    const inset = 13;
    const il = tl + inset;
    const ir = tr - inset;
    const ibl = bl + inset * 1.5;
    const ibr = br - inset * 1.5;
    const itop = TOP + inset * 0.62;
    const ibot = BOT - inset * 0.62;
    g.strokeStyle = 'rgba(255,214,120,0.55)';
    g.lineWidth = 1.6;
    g.beginPath();
    g.moveTo(il, itop);
    g.lineTo(ir, itop);
    g.lineTo(ibr, ibot);
    g.lineTo(ibl, ibot);
    g.closePath();
    g.stroke();

    // 绿呢台面
    const grad = g.createRadialGradient(CX, CY, 40, CX, CY, 360);
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

    // 呢面绒感噪点
    g.save();
    g.clip();
    for (const [sx, sy, k] of this.speckles) {
      g.globalAlpha = 0.05 + k * 0.05;
      g.fillStyle = k > 0.5 ? '#ffffff' : '#000000';
      g.fillRect(sx, sy, 2, 2);
    }
    // 顶部环境光
    g.globalAlpha = 1;
    const lamp = g.createRadialGradient(CX, TOP + 40, 10, CX, TOP + 40, 300);
    lamp.addColorStop(0, 'rgba(255,255,220,0.14)');
    lamp.addColorStop(1, 'rgba(255,255,220,0)');
    g.fillStyle = lamp;
    g.fillRect(bl, TOP, br - bl, BOT - TOP);
    g.restore();
  }

  /** 牌墙：上下两道两层叠起的牌背，随剩余张数变短（真实麻将桌的"墙"） */
  private drawWall() {
    const g = this.g;
    const left = Math.max(0, this.state.wallLeft);
    if (left === 0) return;
    const tw = 15;
    const th = 20;
    const gap = 1;
    const row = (y: number, count: number) => {
      const n = Math.min(Math.ceil(count / 2), 18);
      if (n <= 0) return;
      const total = n * tw + (n - 1) * gap;
      const x0 = CX - total / 2;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * (tw + gap);
        drawBack(g, x, y + 5, tw, th); // 下层
        drawBack(g, x, y, tw, th); // 上层
      }
    };
    const half = Math.ceil(left / 2);
    row(195, half);
    row(556, left - half);
  }

  /** 某一行高度上绿呢台面的左右边界（梯形透视，牌要贴着这条边摆） */
  private feltEdge(y: number): [number, number] {
    const itop = TOP + 8.06;
    const ibot = BOT - 8.06;
    const k = Math.max(0, Math.min(1, (y - itop) / (ibot - itop)));
    const l = 45 + k * (-3.5 - 45);
    const r = DW - 45 + k * (DW + 3.5 - (DW - 45));
    return [l, r];
  }

  /** 桌沿护栏（牌桌下方到屏幕底部），玩家手牌摆在上面 */
  private drawRail() {
    const g = this.g;
    const rg = g.createLinearGradient(0, BOT, 0, DH);
    rg.addColorStop(0, '#3a2110');
    rg.addColorStop(0.18, '#25150a');
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

  /** 中央：剩余牌数、行动方位、提示语 */
  private drawCenter() {
    const g = this.g;
    const w = 94;
    const h = 62;
    g.save();
    g.fillStyle = 'rgba(4,26,17,0.6)';
    g.beginPath();
    g.roundRect(CX - w / 2, CY - h / 2, w, h, 12);
    g.fill();
    g.strokeStyle = 'rgba(255,215,110,0.45)';
    g.lineWidth = 1.5;
    g.stroke();

    g.textAlign = 'center';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#ffe9b0';
    g.font = 'bold 24px sans-serif';
    g.fillText(String(this.state.wallLeft), CX, CY + 4);
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.font = '10px sans-serif';
    g.fillText('剩余牌', CX, CY + 20);

    // 当前行动方位指示（四角小灯）
    const dirs: [number, number][] = [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ];
    const a = this.state.activeSeat;
    if (a >= 0 && a < 4) {
      const [dx, dy] = dirs[a];
      const t = (performance.now() % 900) / 900;
      g.fillStyle = '#ffd76e';
      g.globalAlpha = 0.5 + Math.sin(t * Math.PI * 2) * 0.4;
      g.beginPath();
      g.arc(CX + dx * (w / 2 - 9), CY + dy * (h / 2 - 9), 4.5, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    g.restore();

  }

  /** 中央提示条（最后绘制，压在所有信息框之上，避免被遮） */
  private drawCenterHint() {
    if (!this.state.centerHint) return;
    const g = this.g;
    g.save();
    g.font = 'bold 15px sans-serif';
    g.textAlign = 'center';
    const tw = Math.min(DW - 40, g.measureText(this.state.centerHint).width + 28);
    g.fillStyle = 'rgba(2,10,6,0.88)';
    g.beginPath();
    g.roundRect(CX - tw / 2, CY - 114, tw, 32, 16);
    g.fill();
    g.strokeStyle = 'rgba(255,215,110,0.5)';
    g.lineWidth = 1.2;
    g.stroke();
    g.fillStyle = '#fff';
    g.fillText(this.state.centerHint, CX, CY - 92, tw - 20);
    g.restore();
  }

  /** 三家对手：手牌背 + 副露 + 弃牌 + 信息框 */
  private drawOpponents() {
    for (let seat = 1; seat <= 3; seat++) {
      const s = this.state.seats[seat];
      if (!s) continue;
      if (seat === 2) this.drawTopSeat(s, seat);
      else this.drawSideSeat(s, seat);
      this.drawDiscards(s, seat);
    }
  }

  /** 对家（上方） */
  private drawTopSeat(s: SeatView, seat: number) {
    const g = this.g;
    const tw = 14;
    const th = 20;
    const gap = 1.5;
    const n = s.handCount;
    const totalW = n * tw + (n - 1) * gap;
    const x0 = CX - totalW / 2;
    const y = 114;
    for (let i = 0; i < n; i++) drawBack(g, x0 + i * (tw + gap), y, tw, th);
    // 副露排在手牌下方，居中
    this.drawMeldsCentered(s.melds, CX, y + th + 5, 14, 19, 'h');
    this.drawSeatInfo(s, seat, CX - 72, TOP + 8, 144, 32);
  }

  /** 左右家（竖排牌背贴桌边） */
  private drawSideSeat(s: SeatView, seat: number) {
    const g = this.g;
    const right = seat === 1;
    const tw = 20;
    const th = 13.5;
    const gap = 1.5;
    const n = s.handCount;
    const totalH = n * th + (n - 1) * gap;
    const y0 = CY - totalH / 2;
    // 沿着梯形桌边摆，牌墙跟着透视往外张开
    for (let i = 0; i < n; i++) {
      const ty = y0 + i * (th + gap);
      const [l, r] = this.feltEdge(ty + th / 2);
      drawBack(g, right ? r - tw - 5 : l + 5, ty, tw, th, true);
    }
    // 副露竖排在手牌内侧（保持牌面比例，字才不会压扁）
    const [ml, mr] = this.feltEdge(CY);
    this.drawMelds(s.melds, right ? mr - 43 : ml + 26, CY - 90, 16, 21, 'v');
    // 信息框：固定高度，不随手牌张数上下漂（否则会撞到中央提示条）
    const iy = 238;
    const [il, ir] = this.feltEdge(iy + 23);
    this.drawSeatInfo(s, seat, right ? Math.min(DW - 112, ir - 106) : Math.max(6, il), iy, 106, 46);
  }

  /** 玩家自己的区域：副露 + 弃牌 + 信息框 */
  private drawMyArea() {
    const s = this.state.seats[0];
    if (!s) return;
    this.drawDiscards(s, 0);
    // 副露摆在自己面前偏右
    this.drawMeldsCentered(s.melds, CX + 56, 594, 21, 29, 'h');
    // 信息框（台面左下角）
    this.drawSeatInfo(s, 0, 14, 640, 156, 46);
  }

  /** 通用：某家的弃牌堆（围绕中央，每行 6 张，朝自己那侧展开） */
  private drawDiscards(s: SeatView, seat: number) {
    const g = this.g;
    const list = s.discards;
    const halfRow = (PER_ROW * (DTW + DGAP)) / 2;
    const halfCol = (PER_ROW * (DTH + DGAP)) / 2;
    for (let i = 0; i < list.length; i++) {
      const row = Math.floor(i / PER_ROW);
      const col = i % PER_ROW;
      let x = 0;
      let y = 0;
      const last = i === list.length - 1 && s.justDiscarded;
      if (seat === 0) {
        x = CX - halfRow + col * (DTW + DGAP);
        y = CY + D_OFF_Y + row * (DTH + DGAP);
      } else if (seat === 2) {
        x = CX + halfRow - (col + 1) * (DTW + DGAP);
        y = CY - D_OFF_Y - (row + 1) * (DTH + DGAP);
      } else if (seat === 1) {
        x = CX + D_OFF_X + row * (DTW + DGAP);
        y = CY - halfCol + col * (DTH + DGAP);
      } else {
        x = CX - D_OFF_X - (row + 1) * (DTW + DGAP);
        y = CY + halfCol - (col + 1) * (DTH + DGAP);
      }
      drawTile(g, list[i], x, y, DTW, DTH, { glow: last ? '#ffd76e' : undefined });
    }
  }

  /** 副露组（碰/杠），返回总宽/高 */
  private meldsSize(melds: Meld[], tw: number, th: number, dir: 'h' | 'v') {
    let n = 0;
    for (const m of melds) n += m.kind === 'peng' ? 3 : 4;
    const step = dir === 'h' ? tw + 1 : th + 1;
    return n * step + Math.max(0, melds.length - 1) * 6;
  }

  private drawMeldsCentered(melds: Meld[], cx: number, y: number, tw: number, th: number, dir: 'h' | 'v') {
    if (!melds.length) return;
    const total = this.meldsSize(melds, tw, th, dir);
    this.drawMelds(melds, cx - total / 2, y, tw, th, dir);
  }

  private drawMelds(melds: Meld[], x: number, y: number, tw: number, th: number, dir: 'h' | 'v') {
    const g = this.g;
    let ox = x;
    let oy = y;
    for (const m of melds) {
      const n = m.kind === 'peng' ? 3 : 4;
      for (let i = 0; i < n; i++) {
        // 暗杠：盖着三张，只亮最后一张
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

  /** 玩家信息框：头像 + 昵称 + 分数（左），缺门/听/胡 徽章（右对齐，永不出框） */
  private drawSeatInfo(s: SeatView, seat: number, x: number, y: number, w: number, h: number) {
    const g = this.g;
    const active = this.state.activeSeat === seat;
    const col = s.char?.color ?? '#40c4ff';

    g.save();
    g.fillStyle = active ? 'rgba(16,58,38,0.94)' : 'rgba(6,20,14,0.86)';
    g.beginPath();
    g.roundRect(x, y, w, h, 10);
    g.fill();
    g.lineWidth = active ? 2 : 1;
    g.strokeStyle = active ? col : 'rgba(255,255,255,0.16)';
    if (active) {
      g.shadowColor = col;
      g.shadowBlur = 10;
    }
    g.stroke();
    g.shadowBlur = 0;

    // 头像（我自己没有头像时不留空位）
    const av = this.getAvatar(s);
    const asz = av ? Math.min(h - 12, 30) : 0;
    const ay = y + (h - asz) / 2;
    if (av) {
      g.save();
      g.beginPath();
      g.arc(x + 5 + asz / 2, ay + asz / 2, asz / 2, 0, Math.PI * 2);
      g.clip();
      g.drawImage(av, x + 5, ay, asz, asz);
      g.restore();
      g.strokeStyle = col;
      g.lineWidth = 1.4;
      g.beginPath();
      g.arc(x + 5 + asz / 2, ay + asz / 2, asz / 2, 0, Math.PI * 2);
      g.stroke();
    }

    // 上行：昵称 + 分数（分数紧跟昵称）
    const tx = av ? x + 10 + asz : x + 12;
    const right = x + w - 6;
    g.textAlign = 'left';
    g.textBaseline = 'alphabetic';
    g.fillStyle = '#fff';
    g.font = 'bold 12.5px sans-serif';
    const nameW = Math.min(g.measureText(s.name).width, right - tx - 26);
    g.fillText(s.name, tx, y + 17, nameW);
    const scoreTxt = `${s.score > 0 ? '+' : ''}${s.score}`;
    g.font = 'bold 11.5px sans-serif';
    g.fillStyle = s.score > 0 ? '#7dff9f' : s.score < 0 ? '#ff8a80' : 'rgba(255,255,255,0.55)';
    g.fillText(scoreTxt, tx + nameW + 7, y + 17, right - tx - nameW - 7);

    // 下行：徽章从右往左排，永远在框内
    let bx = right;
    const badge = (text: string, bg: string, fg: string) => {
      g.font = 'bold 9.5px sans-serif';
      const bw = g.measureText(text).width + 10;
      if (bx - bw < tx - 2) return; // 放不下就不画
      bx -= bw;
      g.fillStyle = bg;
      g.beginPath();
      g.roundRect(bx, y + h - 20, bw, 14, 7);
      g.fill();
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.fillText(text, bx + bw / 2, y + h - 9.5);
      g.textAlign = 'left';
      bx -= 4;
    };
    if (s.won) badge('胡', 'rgba(255,190,60,0.95)', '#3a2000');
    if (s.ting && !s.won) badge('听', 'rgba(90,200,120,0.95)', '#06210f');
    if (s.lack >= 0) badge('缺' + SUITS[s.lack], 'rgba(235,90,60,0.92)', '#fff');
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

  /** 玩家手牌：大牌横排，可点击 */
  private drawPlayerCards() {
    const g = this.g;
    const s = this.state.seats[0];
    if (!s) return;
    const tiles = s.hand;
    const n = tiles.length;
    if (n === 0) return;

    const drawn = this.state.drawnSeparate && n > 1;
    const baseN = drawn ? n - 1 : n;
    const gap = 1;
    const drawnGap = 9;
    const avail = DW - 10;
    // 精确解出牌宽：baseN 张 + (drawn ? 分开的 1 张 + 间隔)
    const slots = drawn ? baseN + 1 : baseN;
    const fixed = (baseN - 1) * gap + (drawn ? drawnGap : 0);
    const tw = Math.min(32, (avail - fixed) / slots);
    const th = tw * 1.42;
    const totalW = slots * tw + fixed;
    const x0 = (DW - totalW) / 2;
    const y = DH - 50 - th;

    // 手牌托板
    g.save();
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.roundRect(x0 - 5, y + th * 0.55, totalW + 10, th * 0.62, 6);
    g.fill();
    g.restore();

    for (let i = 0; i < n; i++) {
      const isDrawn = drawn && i === n - 1;
      const x = isDrawn ? x0 + baseN * (tw + gap) - gap + drawnGap : x0 + i * (tw + gap);
      const picked = this.state.picked.includes(i);
      const sel = this.state.selected === i;
      drawTile(g, tiles[i], x, y, tw, th, {
        lift: sel ? 15 : picked ? 10 : 0,
        glow: picked ? '#66ff8f' : sel ? '#ffd76e' : undefined,
      });
      // 点击判定（比牌大一圈，手指容错）
      this.hits.push({ x: x - 2, y: y - 24, w: tw + 4, h: th + 34, idx: i });
    }

    // 听牌提示条（浮在手牌上方）
    if (this.state.tingTiles.length) {
      const items = this.state.tingTiles.slice(0, 8);
      const iw = 17;
      const ih = 23;
      const totW = items.length * (iw + 2) + 46;
      const sx = (DW - totW) / 2;
      const ty = y - 36;
      g.save();
      g.fillStyle = 'rgba(6,28,17,0.92)';
      g.beginPath();
      g.roundRect(sx, ty - 3, totW, ih + 8, 8);
      g.fill();
      g.strokeStyle = 'rgba(120,255,160,0.55)';
      g.lineWidth = 1;
      g.stroke();
      g.fillStyle = '#8effb0';
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText('听', sx + 9, ty + ih / 2 + 1);
      g.textBaseline = 'alphabetic';
      items.forEach((t, i) => drawTile(g, t, sx + 26 + i * (iw + 2), ty + 1, iw, ih));
      g.restore();
    }
  }

  /** 座位特效：冲击波 + 大字 */
  private drawFx() {
    const g = this.g;
    const now = performance.now();
    const pos = [
      [CX, DH - 190],
      [DW - 78, CY],
      [CX, 172],
      [78, CY],
    ];
    this.fx = this.fx.filter((f) => now - f.born < f.dur);
    for (const f of this.fx) {
      const k = (now - f.born) / f.dur;
      const [cx, cy] = pos[f.seat] ?? pos[0];
      if (f.kind === 'burst') {
        g.save();
        g.globalAlpha = (1 - k) * 0.9;
        g.strokeStyle = f.color;
        g.lineWidth = 4 * (1 - k) + 1;
        g.beginPath();
        g.arc(cx, cy, 20 + k * 90, 0, Math.PI * 2);
        g.stroke();
        for (let i = 0; i < 10; i++) {
          const a = (i / 10) * Math.PI * 2;
          const d = 20 + k * 100;
          g.fillStyle = f.color;
          g.beginPath();
          g.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, 3 * (1 - k) + 0.5, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      } else if (f.text) {
        g.save();
        const pop = k < 0.25 ? 0.4 + (k / 0.25) * 0.75 : 1.15 - Math.min(1, (k - 0.25) / 0.2) * 0.15;
        g.globalAlpha = k > 0.75 ? 1 - (k - 0.75) / 0.25 : 1;
        g.translate(cx, cy - 10);
        g.scale(pop, pop);
        g.textAlign = 'center';
        g.font = 'bold 44px "STKaiti","KaiTi",sans-serif';
        g.lineWidth = 7;
        g.strokeStyle = 'rgba(0,0,0,0.8)';
        g.strokeText(f.text, 0, 0);
        const tg = g.createLinearGradient(0, -26, 0, 14);
        tg.addColorStop(0, '#fff3b0');
        tg.addColorStop(0.5, f.color);
        tg.addColorStop(1, '#ff9c40');
        g.fillStyle = tg;
        g.fillText(f.text, 0, 0);
        g.restore();
      }
    }
  }
}
