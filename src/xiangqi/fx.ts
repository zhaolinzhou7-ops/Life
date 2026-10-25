/**
 * 对局特效：开局入场、吃子、吃车、将军、绝杀。
 *
 * 用户原话："设计一些3D出场动画，吃子特效，包括将军，开局，绝杀等，另外吃车有一句响亮的音效。"
 *
 * 两层，都盖在棋盘上、不接点击：
 *   - 一张透明画布（粒子、碎片、冲击波、将军的光线、倒下的老将、烟花、墨烟）。粒子带"高度"z：
 *     飞得越高画得越大、影子落在棋盘上越淡越散，落到盘面上会弹两下——平面棋盘上看得出立体；
 *   - 一层 DOM 横幅：开局、吃车、将军、绝杀四个大字，每个字一个意境（风起云涌、刀光一闪、擂鼓点将、雷霆血墨），
 *     见 fxbanner.ts。
 * 开局时整块棋盘从斜着的 3D 角度转平、棋子一排排落下来（board2d 的 intro）；大动作时棋盘震一下。
 *
 * 盘面（谁在哪一格）从来不跟着特效走——特效只是画法，点子、判规则都按 board2d 的盘面来。
 * 可以在"棋盘和棋子样式"里关掉；系统设了"减少动态效果"时默认关。
 */
import type { Board2D } from './board2d';
import { getLook, pieceStyle } from './boardtheme';
import { bannerCapture, bannerCheck, bannerMate, bannerOpening, blade, cutLine, ensureFxFont, mateChar } from './fxbanner';
import type { Color, Piece } from './rules';
import { xqSfxCapture, xqSfxCheck, xqSfxLand, xqSfxMate, xqSfxOpening } from '../xqsfx';
import { getVoiceKind, preloadAnnounce, preloadShouts, xqShout, type Shout } from '../xqvoice';

/**
 * 吃了哪个子喊一声：只有吃车。
 * 用户原话："不是每一步都要说话，就是关键的那几步，比如说吃车、将军、绝杀……开局也不用说开局"
 */
const CAPTURE_SHOUT: Partial<Record<string, Shout>> = { R: 'chiche' };
const voiced = () => getVoiceKind() !== 'off';

const KEY = 'xq-fx';
/** 特效开着没有（默认开；系统要求减少动态效果时默认关） */
export function fxEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* 读不出来按默认 */
  }
  return !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
}
export function setFxEnabled(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* 存不下就这一次有效 */
  }
}

type Kind = 'chip' | 'spark' | 'dust' | 'shard' | 'ember' | 'smoke';
interface Part {
  kind: Kind;
  x: number;
  y: number;
  /** 离盘面的高度 */
  z: number;
  vx: number;
  vy: number;
  vz: number;
  age: number;
  ttl: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  /** 碎片：哪张棋子图、切哪一块扇形 */
  img?: HTMLCanvasElement;
  half?: number;
  a0?: number;
  a1?: number;
  /** 碎片翻滚（绕水平轴），画的时候竖直方向按 cos 压扁，看着像在空中翻 */
  flip?: number;
  vflip?: number;
  grav: number;
  bounce: boolean;
  /** 发光（加色混合） */
  glow?: boolean;
  delay?: number;
}
interface Ring {
  x: number;
  y: number;
  t0: number;
  dur: number;
  r0: number;
  r1: number;
  color: string;
  w: number;
}
interface Beam {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t0: number;
  dur: number;
}
interface Topple {
  x: number;
  y: number;
  img: HTMLCanvasElement;
  half: number;
  t0: number;
  /** 往哪边倒：1 往屏幕下方，-1 往上方（离棋盘中间远的那一边，字始终正着） */
  dir: number;
  cracks: [number, number][][];
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

export class BoardFx {
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private layer: HTMLDivElement;
  private parts: Part[] = [];
  private rings: Ring[] = [];
  private beams: Beam[] = [];
  private topple: Topple | null = null;
  /** 全盘的一层颜色（吃车的金光、绝杀压暗） */
  private flash: { t0: number; dur: number; color: string; peak: number; hold?: boolean } | null = null;
  private raf = 0;
  private last = 0;
  private timers: number[] = [];
  private disposed = false;

  constructor(
    private host: HTMLElement,
    private board: Board2D,
  ) {
    host.classList.add('xq-fxhost');
    this.cv = document.createElement('canvas');
    this.cv.className = 'xq-fx';
    host.appendChild(this.cv);
    this.g = this.cv.getContext('2d')!;
    this.layer = document.createElement('div');
    this.layer.className = 'xq-fx-layer';
    host.appendChild(this.layer);
    board.onLand = (x, y, c) => this.dust(x, y, c);
    // 大字用的毛笔字（6 KB，先拉下来）
    void ensureFxFont();
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    for (const t of this.timers) clearTimeout(t);
    this.board.onLand = undefined;
    this.cv.remove();
    this.layer.remove();
    this.host.classList.remove('xq-fxhost');
  }

  /** 新开一盘、悔棋：把还在演的全收掉 */
  reset() {
    for (const t of this.timers) clearTimeout(t);
    this.timers = [];
    this.parts = [];
    this.rings = [];
    this.beams = [];
    this.topple = null;
    this.flash = null;
    this.layer.innerHTML = '';
    this.board.setHidden([]);
    this.host.dataset.fx = '';
    // 画布上还留着最后一帧（倒下的老将、压暗的那一层）：没有新的一帧来擦，得在这里擦掉。
    // 复盘时"困毙"两个字、躺倒的老将一直盖在棋盘上，就是漏了这一句
    this.g.save();
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.cv.width, this.cv.height);
    this.g.restore();
  }

  private later(ms: number, fn: () => void) {
    const t = window.setTimeout(() => {
      this.timers = this.timers.filter((x) => x !== t);
      if (!this.disposed) fn();
    }, ms);
    this.timers.push(t);
  }

  // ───────────── 对外：几个时刻 ─────────────

  /** 开局：棋盘从斜着转平、棋子一排排落下；"开局"两个金字随一笔浓墨写出来、卷云旋开、"楚汉"印盖下，鼓一阵"锵" */
  opening() {
    this.reset();
    this.mark('opening');
    preloadShouts();
    preloadAnnounce();
    if (!fxEnabled()) return;
    this.cssAnim('xq-fx-tilt', 1000);
    this.board.intro(1500);
    xqSfxOpening();
    this.later(1250, () => {
      const { w, h } = this.size();
      this.banner(bannerOpening(w, h), 1950);
      // 浓墨扫过去的时候带起一层金粉
      this.later(180, () => this.motes(w * 0.1, w * 0.9, h / 2, 26, ['#ffe6a0', '#ffd166', '#fff6d8']));
      // 印章盖下
      this.later(700, () => this.shake(false));
    });
  }

  /**
   * 吃子：等走的那个子落下，被吃的子碎成几块飞出去、木屑溅开、冲击波一圈；
   * 马炮再震一下棋盘；**吃车**：金光一闪、"吃车"大字（刀光一闪：两刀，字被斩成两半）、棋盘大震，配那一声"锵——"。
   */
  capture(x: number, y: number, victim: Piece, by: Color) {
    const shout = CAPTURE_SHOUT[victim.t];
    const say = () => {
      xqSfxCapture(victim.t, !!shout && voiced());
      // 先听到"锵"（吃车的锣在 0.12 秒），人声紧跟着压上来
      if (shout) xqShout(shout, victim.t === 'R' ? 190 : 90);
    };
    if (!fxEnabled()) {
      this.later(this.board.animLeft(), say);
      return;
    }
    this.later(this.board.animLeft(), () => {
      this.mark(`capture:${victim.t}`);
      say();
      const big = victim.t === 'R' || victim.t === 'H' || victim.t === 'C';
      const p = this.board.pointOf(x, y);
      const c = p.cell;
      this.rings.push({ x: p.x, y: p.y, t0: performance.now(), dur: big ? 520 : 380, r0: c * 0.3, r1: c * (victim.t === 'R' ? 2.2 : big ? 1.3 : 0.95), color: 'rgba(255,236,190,0.9)', w: c * 0.12 });
      this.shatter(x, y, victim);
      this.chips(x, y, victim.c, big ? 26 : 14, big ? 1.2 : 0.8);
      if (big) this.sparks(p.x, p.y, victim.t === 'R' ? 34 : 16, c);
      if (victim.t === 'R') {
        this.flash = { t0: performance.now(), dur: 520, color: '255,214,120', peak: 0.38 };
        this.rings.push({ x: p.x, y: p.y, t0: performance.now() + 90, dur: 700, r0: c * 0.5, r1: c * 3.4, color: 'rgba(255,200,90,0.7)', w: c * 0.08 });
        // 刀光一闪：第一刀劈过被吃的车，"吃车"砸下来；第二刀斩开两个字，火星沿着刀口溅
        const { w, h } = this.size();
        const bn = bannerCapture(w, h, p.x, p.y, by === 'r' ? 'gold' : 'silver');
        this.banner(bn, 1300);
        this.shake(true);
        this.later(640, () => {
          const cl = cutLine(bn);
          if (cl) {
            blade(bn, cl);
            for (let k = 1; k < 7; k++) this.sparks(cl[0] + ((cl[2] - cl[0]) * k) / 7, cl[1] + ((cl[3] - cl[1]) * k) / 7, 5, c, ['#ffffff', '#fff3c4', '#ffd166']);
          }
          this.shake(false);
          this.kick();
        });
      } else if (big) this.shake(false);
      this.kick();
    });
  }

  /** 将军：从将军的子到老将一道光，集中线收向老将，令旗甩开、"将军"从远处砸过来，跟着两记鼓点震两下 */
  check(kx: number, ky: number, from: { x: number; y: number }[], byMe: boolean) {
    if (!fxEnabled()) {
      xqSfxCheck();
      xqShout('jiangjun', 200);
      return;
    }
    this.later(this.board.animLeft(), () => {
      this.mark('check');
      xqSfxCheck();
      // 和"将军"两个字砸下来同时喊
      xqShout('jiangjun', 200);
      const k = this.board.pointOf(kx, ky);
      const now = performance.now();
      for (const f of from) {
        const a = this.board.pointOf(f.x, f.y);
        this.beams.push({ x1: a.x, y1: a.y, x2: k.x, y2: k.y, t0: now, dur: 900 });
      }
      this.rings.push({ x: k.x, y: k.y, t0: now + 150, dur: 650, r0: k.cell * 0.4, r1: k.cell * 1.5, color: 'rgba(255,80,60,0.85)', w: k.cell * 0.1 });
      this.sparks(k.x, k.y, 14, k.cell, ['#ff8a65', '#ffd180', '#ffffff']);
      const { w, h } = this.size();
      this.banner(bannerCheck(w, h, k.x, k.y, byMe), 1150);
      // 字砸到、两记鼓点（跟 CSS 里 xqb-drum 的 24%、50%、66% 对上）
      for (const t of [280, 575, 760]) this.later(t, () => this.shake(false));
      this.kick();
    });
  }

  /**
   * 绝杀（或困毙）：盘面压暗、闪电劈下（困毙是一圈墨环收紧），被杀的老将裂开、倒下，
   * "绝""杀"两个字一个一个砸下来、背后各炸开一团血墨；你赢了放烟花，输了是一团墨烟。横幅留着，等结果页出来再收。
   */
  mate(kx: number, ky: number, king: Piece, win: boolean, word = '绝杀') {
    const kunbi = word === '困毙';
    const shout: Shout = kunbi ? 'kunbi' : 'jiesha';
    if (!fxEnabled()) {
      xqSfxMate(win);
      xqShout(shout, 880);
      return;
    }
    this.later(this.board.animLeft() + 120, () => {
      this.mark('mate');
      xqSfxMate(win);
      // "咚——咚——锵"的"锵"上喊
      xqShout(shout, 880);
      const now = performance.now();
      this.flash = { t0: now, dur: 900, color: '0,0,0', peak: win ? 0.38 : 0.55, hold: true };
      const k = this.board.pointOf(kx, ky);
      const sp = this.board.spriteFor(king.t, king.c);
      this.board.setHidden([{ x: kx, y: ky }]);
      // 裂纹：从中心往外几道折线
      const cracks: [number, number][][] = [];
      for (let i = 0; i < 5; i++) {
        let ang = (i / 5) * Math.PI * 2 + rand(-0.3, 0.3);
        let r = 0;
        const line: [number, number][] = [[0, 0]];
        while (r < 0.95) {
          r += rand(0.15, 0.3);
          ang += rand(-0.5, 0.5);
          line.push([Math.cos(ang) * Math.min(r, 0.95), Math.sin(ang) * Math.min(r, 0.95)]);
        }
        cracks.push(line);
      }
      // 往远离棋盘中间的那一边倒
      const dir = k.y > this.board.canvas.clientHeight / 2 ? 1 : -1;
      this.topple = { x: k.x, y: k.y, img: sp.img, half: sp.half, t0: now, dir, cracks };
      this.rings.push({ x: k.x, y: k.y, t0: now + 420, dur: 700, r0: k.cell * 0.4, r1: k.cell * 2.2, color: win ? 'rgba(255,215,110,0.9)' : 'rgba(220,40,30,0.85)', w: k.cell * 0.14 });
      this.later(420, () => this.chips(kx, ky, king.c, 22, 1.1));
      const { w, h } = this.size();
      const bn = bannerMate(w, h, k.x, k.y, kunbi, win);
      this.banner(bn, 0);
      // 困毙：一圈墨环从四面收紧到老将身上
      if (kunbi)
        for (let i = 0; i < 2; i++) this.rings.push({ x: k.x, y: k.y, t0: now + 80 + i * 260, dur: 900, r0: k.cell * 3.4, r1: k.cell * 0.6, color: 'rgba(14,22,34,0.9)', w: k.cell * 0.24 });
      const chars = [...word];
      const cols = kunbi ? ['#e3f0ff', '#9cc6ff', '#ffffff'] : win ? ['#fff3c4', '#ffd166', '#ff9f43'] : ['#ffb3a0', '#ff5a3c', '#ffd0c0'];
      chars.forEach((ch, i) =>
        this.later(560 + i * 380, () => {
          mateChar(bn, ch, i, chars.length, win ? 'gold' : 'ink', kunbi);
          // 字落到盘面（CSS 里 xqb-drop 的一半）：震、四周迸火星
          this.later(220, () => {
            this.shake(true);
            this.sparks(w / 2 + (i - (chars.length - 1) / 2) * w * 0.34, h / 2, 22, k.cell, cols);
            this.kick();
          });
        }),
      );
      // 两个字落定，余烬从盘面往上飘
      this.later(560 + chars.length * 380 + 300, () => this.motes(w * 0.05, w * 0.95, h * 0.75, 30, cols));
      if (win) for (let i = 0; i < 6; i++) this.later(1100 + i * 260, () => this.firework());
      else for (let i = 0; i < 5; i++) this.later(700 + i * 160, () => this.smoke(k.x + rand(-1, 1) * k.cell, k.y + rand(-0.6, 0.6) * k.cell, k.cell));
      this.kick();
    });
  }

  // ───────────── 零件 ─────────────

  /** 给测试看的：最近一次演了什么 */
  private mark(what: string) {
    this.host.dataset.fx = what;
    this.host.dataset.fxn = String(Number(this.host.dataset.fxn ?? 0) + 1);
  }

  /** 给棋盘（和特效画布）加一段 CSS 动画 */
  private cssAnim(cls: string, ms: number) {
    for (const el of [this.board.canvas, this.cv]) {
      el.classList.remove(cls);
      void el.offsetWidth;
      el.classList.add(cls);
    }
    this.later(ms, () => {
      for (const el of [this.board.canvas, this.cv]) el.classList.remove(cls);
    });
  }

  private shake(big: boolean) {
    this.cssAnim(big ? 'xq-fx-shake-big' : 'xq-fx-shake', big ? 560 : 400);
  }

  /** 一个横幅元素：演完（ms 毫秒）自己拿掉；ms = 0 留着 */
  private banner(el: HTMLElement, ms: number) {
    this.layer.appendChild(el);
    if (ms) this.later(ms, () => el.remove());
  }

  /** 特效层多大（和棋盘画布一样） */
  private size() {
    return { w: this.board.canvas.clientWidth, h: this.board.canvas.clientHeight };
  }

  /** 被吃的子碎成六块：每块是同一张棋子图的一个扇形，往外飞、翻滚、落下弹两下再淡掉 */
  private shatter(x: number, y: number, victim: Piece) {
    const p = this.board.pointOf(x, y);
    const sp = this.board.spriteFor(victim.t, victim.c);
    const n = 6;
    const off = rand(0, Math.PI * 2);
    for (let i = 0; i < n; i++) {
      const a0 = off + (i / n) * Math.PI * 2;
      const a1 = a0 + (Math.PI * 2) / n;
      const mid = (a0 + a1) / 2;
      const sp0 = p.cell * rand(2.2, 3.6);
      this.parts.push({
        kind: 'shard',
        x: p.x,
        y: p.y,
        z: 0,
        vx: Math.cos(mid) * sp0,
        vy: Math.sin(mid) * sp0 * 0.8,
        vz: p.cell * rand(4.5, 7),
        age: 0,
        ttl: rand(0.9, 1.25),
        size: 1,
        color: '',
        rot: 0,
        vr: rand(-9, 9),
        img: sp.img,
        half: sp.half,
        a0,
        a1,
        flip: 0,
        vflip: rand(6, 12),
        grav: p.cell * 16,
        bounce: true,
      });
    }
  }

  /** 木屑（或玉屑、瓷片）：颜色跟着这一套棋子的材质 */
  private chips(x: number, y: number, c: Color, n: number, power: number) {
    const p = this.board.pointOf(x, y);
    const st = pieceStyle(getLook().piece);
    const sd = c === 'r' ? st.r : st.b;
    const cols = [sd.face[0], sd.face[1], sd.face[2], sd.edge];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = p.cell * rand(1.2, 4) * power;
      this.parts.push({
        kind: 'chip',
        x: p.x + rand(-0.2, 0.2) * p.cell,
        y: p.y + rand(-0.2, 0.2) * p.cell,
        z: rand(0, p.cell * 0.2),
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.8,
        vz: p.cell * rand(2.5, 7) * power,
        age: 0,
        ttl: rand(0.7, 1.3),
        size: p.cell * rand(0.05, 0.12),
        color: cols[i % cols.length],
        rot: rand(0, 6),
        vr: rand(-14, 14),
        grav: p.cell * 15,
        bounce: true,
      });
    }
  }

  /** 火星：发亮的小点，飞得快、不落地 */
  private sparks(x: number, y: number, n: number, cell: number, cols = ['#fff3c4', '#ffd166', '#ff9f43', '#ffffff']) {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = cell * rand(3, 8);
      this.parts.push({
        kind: 'spark',
        x,
        y,
        z: cell * 0.2,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v * 0.8,
        vz: cell * rand(1, 5),
        age: 0,
        ttl: rand(0.35, 0.7),
        size: cell * rand(0.03, 0.06),
        color: cols[i % cols.length],
        rot: 0,
        vr: 0,
        grav: cell * 6,
        bounce: false,
        glow: true,
      });
    }
  }

  /** 金粉、余烬：一片发亮的小点从一条横线附近慢慢往上飘 */
  private motes(x0: number, x1: number, y: number, n: number, cols: string[]) {
    const cell = this.board.pointOf(0, 0).cell || 40;
    for (let i = 0; i < n; i++)
      this.parts.push({
        kind: 'ember',
        x: rand(x0, x1),
        y: y + rand(-0.7, 0.7) * cell,
        z: 0,
        vx: rand(-0.4, 0.4) * cell,
        vy: rand(-0.2, 0.2) * cell,
        vz: cell * rand(0.4, 1.4),
        age: -rand(0, 0.5),
        ttl: rand(1, 1.7),
        size: cell * rand(0.02, 0.045),
        color: cols[i % cols.length],
        rot: 0,
        vr: 0,
        grav: -cell * 0.5,
        bounce: false,
        glow: true,
      });
    this.kick();
  }

  /** 入场时棋子落定：脚下扬起一小圈灰 */
  private dust(x: number, y: number, c: Color) {
    if (this.disposed) return;
    xqSfxLand();
    const p = this.board.pointOf(x, y);
    void c;
    for (let i = 0; i < 6; i++) {
      const a = rand(0, Math.PI * 2);
      this.parts.push({
        kind: 'dust',
        x: p.x + Math.cos(a) * p.cell * 0.35,
        y: p.y + Math.sin(a) * p.cell * 0.25 + p.cell * 0.1,
        z: 0,
        vx: Math.cos(a) * p.cell * 0.9,
        vy: Math.sin(a) * p.cell * 0.5,
        vz: p.cell * rand(0.2, 0.6),
        age: 0,
        ttl: rand(0.45, 0.7),
        size: p.cell * rand(0.12, 0.22),
        color: 'rgba(255,245,225,0.5)',
        rot: 0,
        vr: 0,
        grav: 0,
        bounce: false,
      });
    }
    this.kick();
  }

  /** 烟花：棋盘上空一处炸开一团金红色火星，慢慢落下 */
  private firework() {
    const w = this.cv.clientWidth;
    const h = this.cv.clientHeight;
    const cell = this.board.pointOf(0, 0).cell;
    const x = rand(0.2, 0.8) * w;
    const y = rand(0.2, 0.75) * h;
    const cols = [['#ffd166', '#fff3c4', '#ff9f43'], ['#ff6b6b', '#ffd166', '#ffffff'], ['#f7d794', '#ffffff', '#f8a5c2']][Math.floor(rand(0, 3))];
    for (let i = 0; i < 46; i++) {
      const a = (i / 46) * Math.PI * 2 + rand(-0.05, 0.05);
      const v = cell * rand(2.2, 3.6);
      this.parts.push({
        kind: 'ember',
        x,
        y,
        z: cell * 3,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v,
        vz: 0,
        age: 0,
        ttl: rand(1, 1.5),
        size: cell * rand(0.04, 0.07),
        color: cols[i % cols.length],
        rot: 0,
        vr: 0,
        grav: cell * 1.6,
        bounce: false,
        glow: true,
      });
    }
    this.rings.push({ x, y: y - cell * 3, t0: performance.now(), dur: 420, r0: cell * 0.2, r1: cell * 1.6, color: 'rgba(255,240,200,0.45)', w: cell * 0.03 });
    this.kick();
  }

  /** 墨烟：一团慢慢晕开、往上飘的暗色 */
  private smoke(x: number, y: number, cell: number) {
    for (let i = 0; i < 4; i++) {
      this.parts.push({
        kind: 'smoke',
        x: x + rand(-0.4, 0.4) * cell,
        y: y + rand(-0.3, 0.3) * cell,
        z: 0,
        vx: rand(-0.3, 0.3) * cell,
        vy: rand(-0.5, -0.1) * cell,
        vz: cell * rand(0.2, 0.6),
        age: 0,
        ttl: rand(1.6, 2.4),
        size: cell * rand(0.5, 0.9),
        color: '20,16,14',
        rot: 0,
        vr: 0,
        grav: 0,
        bounce: false,
      });
    }
    this.kick();
  }

  // ───────────── 画 ─────────────

  private kick() {
    if (!this.raf && !this.disposed) {
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.frame);
    }
  }

  /** 特效画布和棋盘画布对齐（同一个父元素里，按布局位置，不算 3D 倾斜、震动） */
  private sync(): boolean {
    const b = this.board.canvas;
    const w = b.clientWidth;
    const h = b.clientHeight;
    if (w < 2 || h < 2) return false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (this.cv.width !== Math.round(w * dpr) || this.cv.height !== Math.round(h * dpr)) {
      this.cv.width = Math.round(w * dpr);
      this.cv.height = Math.round(h * dpr);
    }
    this.cv.style.left = `${b.offsetLeft}px`;
    this.cv.style.top = `${b.offsetTop}px`;
    this.cv.style.width = `${w}px`;
    this.cv.style.height = `${h}px`;
    this.layer.style.left = `${b.offsetLeft}px`;
    this.layer.style.top = `${b.offsetTop}px`;
    this.layer.style.width = `${w}px`;
    this.layer.style.height = `${h}px`;
    this.layer.style.setProperty('--fxw', `${w}px`);
    this.g.setTransform(dpr, 0, 0, dpr, 0, 0);
    return true;
  }

  private frame = () => {
    this.raf = 0;
    if (this.disposed) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    if (!this.sync()) return;
    const g = this.g;
    g.clearRect(0, 0, this.cv.clientWidth + 4, this.cv.clientHeight + 4);
    const w = this.cv.clientWidth;
    const h = this.cv.clientHeight;
    let alive = false;

    // 全盘的一层颜色
    if (this.flash) {
      const f = this.flash;
      const t = (now - f.t0) / f.dur;
      const a = f.hold ? f.peak * Math.min(1, t * 2.5) : f.peak * (t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / 0.85));
      if (f.hold || t < 1) {
        if (f.color === '0,0,0') {
          // 压暗：四周暗、中间留一点光
          const vg = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.15, w / 2, h / 2, Math.hypot(w, h) * 0.6);
          vg.addColorStop(0, `rgba(0,0,0,${a * 0.35})`);
          vg.addColorStop(1, `rgba(0,0,0,${a})`);
          g.fillStyle = vg;
        } else g.fillStyle = `rgba(${f.color},${a})`;
        g.fillRect(0, 0, w, h);
        if (!f.hold) alive = true;
      } else this.flash = null;
    }

    // 将军的光线：从将军的子射到老将，先亮后散
    this.beams = this.beams.filter((b) => now - b.t0 < b.dur);
    for (const b of this.beams) {
      alive = true;
      const t = (now - b.t0) / b.dur;
      const grow = Math.min(1, t * 4);
      const a = t < 0.25 ? 1 : 1 - (t - 0.25) / 0.75;
      const ex = b.x1 + (b.x2 - b.x1) * grow;
      const ey = b.y1 + (b.y2 - b.y1) * grow;
      g.save();
      g.globalCompositeOperation = 'lighter';
      g.lineCap = 'round';
      for (const [lw, col] of [
        [14, `rgba(255,60,40,${0.25 * a})`],
        [7, `rgba(255,120,80,${0.55 * a})`],
        [2.5, `rgba(255,240,220,${0.95 * a})`],
      ] as const) {
        g.strokeStyle = col;
        g.lineWidth = lw;
        g.beginPath();
        g.moveTo(b.x1, b.y1);
        g.lineTo(ex, ey);
        g.stroke();
      }
      g.restore();
    }

    // 冲击波
    this.rings = this.rings.filter((r) => now - r.t0 < r.dur);
    for (const r of this.rings) {
      alive = true;
      const t = (now - r.t0) / r.dur;
      if (t < 0) continue;
      const e = easeOut(t);
      g.save();
      g.globalAlpha = 1 - t;
      g.strokeStyle = r.color;
      g.lineWidth = Math.max(1, r.w * (1 - t * 0.7));
      g.beginPath();
      g.ellipse(r.x, r.y, r.r0 + (r.r1 - r.r0) * e, (r.r0 + (r.r1 - r.r0) * e) * 0.86, 0, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }

    // 粒子：先动，再按高度从低到高画（高的盖在低的上面），影子先画
    const cell = this.board.pointOf(0, 0).cell || 40;
    for (const p of this.parts) {
      p.age += dt;
      p.vz -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      p.rot += p.vr * dt;
      if (p.flip !== undefined && p.vflip) p.flip += p.vflip * dt;
      if (p.kind === 'smoke' || p.kind === 'dust') {
        p.vx *= 1 - dt * 1.5;
        p.vy *= 1 - dt * 1.5;
        p.size *= 1 + dt * (p.kind === 'smoke' ? 0.9 : 1.6);
      }
      if (p.z < 0) {
        if (p.bounce) {
          p.z = 0;
          p.vz = -p.vz * 0.35;
          p.vx *= 0.55;
          p.vy *= 0.55;
          p.vr *= 0.6;
          if (p.vflip) p.vflip *= 0.5;
        } else if (p.kind !== 'ember') p.z = 0;
      }
    }
    this.parts = this.parts.filter((p) => p.age < p.ttl);
    if (this.parts.length) alive = true;
    // 影子
    for (const p of this.parts) {
      if (p.kind !== 'chip' && p.kind !== 'shard') continue;
      const fade = 1 - p.age / p.ttl;
      const hgt = Math.max(0, p.z) / cell;
      const s = (p.kind === 'shard' ? (p.half ?? cell * 0.5) * 0.7 : p.size) * (1 + hgt * 0.35);
      g.fillStyle = `rgba(0,0,0,${(0.28 * fade) / (1 + hgt * 0.8)})`;
      g.beginPath();
      g.ellipse(p.x, p.y, s, s * 0.55, 0, 0, Math.PI * 2);
      g.fill();
    }
    const order = [...this.parts].sort((a, b) => a.z - b.z);
    for (const p of order) {
      const fade = Math.max(0, 1 - p.age / p.ttl);
      const sx = p.x;
      const sy = p.y - p.z;
      const sc = 1 + Math.max(0, p.z) / (cell * 6);
      g.save();
      switch (p.kind) {
        case 'shard': {
          g.globalAlpha = Math.min(1, fade * 2);
          g.translate(sx, sy);
          g.rotate(p.rot);
          g.scale(sc, sc * Math.abs(Math.cos(p.flip ?? 0)) + 0.08);
          const hf = p.half!;
          g.beginPath();
          g.moveTo(0, 0);
          g.arc(0, 0, hf, p.a0!, p.a1!);
          g.closePath();
          g.clip();
          // 碎片的中心从棋子中心挪到扇形中间：图跟着扇形走
          g.drawImage(p.img!, -hf, -hf, hf * 2, hf * 2);
          g.restore();
          continue;
        }
        case 'chip':
          g.globalAlpha = Math.min(1, fade * 2.2);
          g.translate(sx, sy);
          g.rotate(p.rot);
          g.fillStyle = p.color;
          g.fillRect((-p.size * sc) / 2, (-p.size * sc) / 3, p.size * sc, (p.size * sc * 2) / 3);
          break;
        case 'spark':
        case 'ember': {
          g.globalCompositeOperation = 'lighter';
          // 刚炸开那几帧火星挤在一起，加色混合会叠成一团白：先淡入（金粉的 age 从负的开始 = 晚一点出来）
          g.globalAlpha = Math.max(0, fade * Math.min(1, p.age * (p.kind === 'ember' ? 5 : 12)));
          const r = p.size * sc * (p.kind === 'ember' ? 2.2 : 3);
          const gr = g.createRadialGradient(sx, sy, 0, sx, sy, r);
          gr.addColorStop(0, p.color);
          gr.addColorStop(0.35, p.color);
          gr.addColorStop(1, 'rgba(255,200,80,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(sx, sy, r, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'dust': {
          g.globalAlpha = fade * 0.55;
          const gr = g.createRadialGradient(sx, sy, 0, sx, sy, p.size);
          gr.addColorStop(0, p.color);
          gr.addColorStop(1, 'rgba(255,245,225,0)');
          g.fillStyle = gr;
          g.beginPath();
          g.arc(sx, sy, p.size, 0, Math.PI * 2);
          g.fill();
          break;
        }
        case 'smoke': {
          const a = Math.min(1, p.age * 3) * fade * 0.55;
          const gr = g.createRadialGradient(sx, sy, 0, sx, sy, p.size);
          gr.addColorStop(0, `rgba(${p.color},${a})`);
          gr.addColorStop(1, `rgba(${p.color},0)`);
          g.fillStyle = gr;
          g.beginPath();
          g.arc(sx, sy, p.size, 0, Math.PI * 2);
          g.fill();
          break;
        }
      }
      g.restore();
    }

    // 被杀的老将：先裂开抖两下，再往后倒（绕底边转，竖直方向压扁 = 3D 里往后仰倒），落地弹一下
    if (this.topple) {
      const tp = this.topple;
      const t = (now - tp.t0) / 1000;
      const crackT = Math.min(1, t / 0.35);
      const fallT = Math.max(0, Math.min(1, (t - 0.42) / 0.55));
      const fall = fallT * fallT;
      const bounce = t > 0.97 ? Math.sin(Math.min(1, (t - 0.97) / 0.3) * Math.PI) * 0.12 : 0;
      const ang = (fall - bounce) * Math.PI * 0.46;
      const jit = t < 0.42 ? Math.sin(t * 90) * tp.half * 0.04 : 0;
      const hf = tp.half;
      g.save();
      // 倒下时影子拉长
      g.fillStyle = `rgba(0,0,0,${0.3 + 0.15 * fall})`;
      g.beginPath();
      g.ellipse(tp.x, tp.y + tp.dir * hf * 0.35 * fall, hf * (0.8 + 0.25 * fall), hf * (0.42 + 0.35 * fall), 0, 0, Math.PI * 2);
      g.fill();
      // 绕倒下那一侧的边转：竖直方向按 cos 压扁，看着就是往那边仰倒
      g.translate(tp.x + jit, tp.y + tp.dir * hf * 0.62);
      g.scale(1, Math.cos(ang));
      g.translate(0, -tp.dir * hf * 0.62);
      g.drawImage(tp.img, -hf, -hf, hf * 2, hf * 2);
      // 裂纹
      g.strokeStyle = `rgba(30,10,5,${0.85 * crackT})`;
      g.lineWidth = Math.max(1, hf * 0.05);
      g.lineJoin = 'round';
      const R = hf * 0.66;
      for (const line of tp.cracks) {
        const nseg = Math.max(1, Math.round(line.length * crackT));
        g.beginPath();
        line.slice(0, nseg).forEach(([cx, cy], i) => (i ? g.lineTo(cx * R, cy * R) : g.moveTo(cx * R, cy * R)));
        g.stroke();
      }
      g.restore();
      // 老将一直躺在那里（直到新开一盘），画面得一直刷
      alive = true;
    }

    if (alive) this.raf = requestAnimationFrame(this.frame);
  };
}
