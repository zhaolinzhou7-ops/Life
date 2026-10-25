/**
 * 对局里的四个大字：开局、吃车、将军、绝杀（困毙）——每个字一个意境。
 *
 * 用户原话："这几个字体呢美化一下，比如说开局，还有绝杀呀，稍微做一点，跟它相对应的那种动画……用那种意境，
 * 就是吃的那种意境，绝杀的那种意境。就是有一种震撼的感觉。"
 *
 *   - 开局 · 风起云涌：一笔浓墨从左往右扫开，"开""局"两个金字一个一个写出来，两头金线卷云旋开，"楚汉"朱印盖下；
 *   - 吃车 · 刀光一闪：一道刀光斜着劈过被吃的车，"吃车"砸下来；紧接着第二刀从字中间斩过，字裂成两半、错开落下；
 *   - 将军 · 擂鼓点将：四面的集中线收向被将的老将，一面朱红令旗（一笔朱砂）甩开，金字砸下，跟着两记鼓点震两下、各荡开一圈气浪；
 *   - 绝杀 · 雷霆血墨：盘面压暗，几道闪电劈到老将头上；"绝""杀"一个一个砸下来，每个字背后炸开一团血墨、四周裂开发烫的裂纹；
 *     困毙 · 寒墨锁宫：没有闪电，背后是青黑的寒墨、裂纹是冷光（老将四周一圈墨环收紧，在 fx.ts 的画布上）。
 *
 * 字是马善政毛笔楷书（开源 OFL，只截了这十几个字，6 KB）。之前横幅用的字体子集里没有"开局吃绝杀"这几个字，
 * 手机上一直是系统字顶着——这次补上。字面：金属渐变（中间一道反光）+ 描边 + 三层投影叠出厚度
 * + 飞白（笔画里丝丝留白，像毛笔扫过）+ 一道流光扫过。
 *
 * 这里只搭 DOM/SVG、动画全在 CSS（style.css 的"大字"一节）；粒子（火星、金粉、余烬）在 fx.ts 的画布上。
 * 所有坐标按棋盘画布的 CSS 像素（特效层和棋盘画布一样大、对齐）。
 */
import fxFontUrl from './fonts/xq-fx.woff2?url';
import { splash } from './heroart';

export type Tone = 'gold' | 'silver' | 'red' | 'ink';

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();
let uid = 0;

let fontLoad: Promise<void> | null = null;
/** 大字的毛笔字（6 KB）：特效层一建起来就拉 */
export function ensureFxFont(): Promise<void> {
  if (fontLoad) return fontLoad;
  fontLoad =
    typeof FontFace === 'undefined' || typeof document === 'undefined'
      ? Promise.resolve()
      : new FontFace('XQ Fx', `url(${fxFontUrl}) format("woff2")`)
          .load()
          .then((f) => {
            document.fonts.add(f);
          })
          .catch(() => {
            /* 没加载下来就用后面的毛笔字、系统楷体 */
          });
  return fontLoad;
}

let dryTile = '';
/**
 * 飞白：一张白底、上面挖出一丝丝斜着的细缝的小图，当遮罩铺在字上——笔画里透出毛笔扫过留下的白丝。
 * 缝是半透明的（不是全挖空），远看字还是实的
 */
function dryBrush(): string {
  if (dryTile || typeof document === 'undefined') return dryTile;
  const S = 192;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  g.globalCompositeOperation = 'destination-out';
  g.lineCap = 'round';
  const r = rng(29);
  for (let i = 0; i < 170; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 12 + r() * 64;
    const a = -0.22 + (r() - 0.5) * 0.3;
    g.strokeStyle = `rgba(0,0,0,${0.2 + r() * 0.5})`;
    g.lineWidth = 0.5 + r() * 1.5;
    // 四面绕一圈画，铺开来接缝看不出来
    for (const dx of [-S, 0, S])
      for (const dy of [-S, 0, S]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
        g.stroke();
      }
  }
  dryTile = `url(${cv.toDataURL('image/png')})`;
  return dryTile;
}

const div = (cls: string, html = '') => {
  const e = document.createElement('div');
  e.className = cls;
  e.innerHTML = html;
  return e;
};

/** 一行字：每个字一个 span（一个一个出来、流光一个一个扫）；delays 是每个字出来的时间（秒） */
function text(word: string, tone: Tone, extra: string, delays: number[] = []) {
  const t = div(`xq-bt ${tone} ${extra}`);
  [...word].forEach((ch, i) => {
    const s = document.createElement('span');
    s.className = 'xq-bc';
    s.dataset.c = ch;
    s.textContent = ch;
    if (delays[i] !== undefined) s.style.setProperty('--d', `${delays[i]}s`);
    t.appendChild(s);
  });
  return t;
}

/** 摆在特效层正中间的一层（定位和动画分开两层：外层只管居中，里层的 transform 给动画用） */
const center = (inner: HTMLElement, cls = '') => {
  const c = div(`xq-bctr ${cls}`);
  c.appendChild(inner);
  return c;
};

/**
 * 一笔浓墨（横着）：起笔一个圆头（藏锋），笔身微微起伏，收笔散成十来丝飞白。画在 400×120 的框里。
 * c0 → c1：起笔浓、收笔淡
 */
function band(seed: number, c0: string, c1: string): string {
  const p = `bb${++uid}`;
  const r = rng(seed);
  const N = 14;
  const top: [number, number][] = [];
  const bot: [number, number][] = [];
  for (let i = 0; i <= N; i++) {
    const x = 30 + (i / N) * 290;
    top.push([x, 24 + Math.sin(i * 0.7 + seed) * 3 + (r() - 0.5) * 5 + i * 0.35]);
    bot.push([x, 96 + Math.sin(i * 0.5 + seed) * 3 + (r() - 0.5) * 5 - i * 0.55]);
  }
  const pt = ([x, y]: [number, number]) => `${n1(x)} ${n1(y)}`;
  // 收笔：右边参差的毛边
  const yT = top[N][1];
  const yB = bot[N][1];
  let edge = '';
  for (let k = 1; k < 7; k++) edge += ` L${n1(322 + r() * 30)} ${n1(yT + ((yB - yT) * k) / 7)}`;
  const d =
    `M${pt(top[0])} L${top.map(pt).join(' L')}${edge} L${[...bot].reverse().map(pt).join(' L')}` +
    ` C14 ${n1(bot[0][1] + 2)} 2 70 6 58 C9 40 18 ${n1(top[0][1] + 1)} ${pt(top[0])} Z`;
  // 飞白：收笔散开的十来丝
  let streaks = '';
  for (let i = 0; i < 12; i++) {
    const y = yT + 4 + ((yB - yT - 8) * i) / 11 + (r() - 0.5) * 3;
    const x0 = 270 + r() * 50;
    const x1 = 350 + r() * 46;
    streaks += `<path d="M${n1(x0)} ${n1(y)} Q${n1((x0 + x1) / 2)} ${n1(y - 2 + r() * 4)} ${n1(x1)} ${n1(y + (r() - 0.5) * 6)}" stroke-width="${n1(1 + r() * 3.6)}" opacity="${(0.55 + r() * 0.45).toFixed(2)}"/>`;
  }
  return (
    `<svg viewBox="0 0 400 120" xmlns="http://www.w3.org/2000/svg" overflow="visible"><defs>` +
    `<linearGradient id="${p}g" x1="0" x2="1"><stop offset="0" stop-color="${c0}"/><stop offset=".7" stop-color="${c1}"/><stop offset="1" stop-color="${c1}" stop-opacity=".8"/></linearGradient>` +
    `<filter id="${p}r" x="-5%" y="-20%" width="110%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".045" numOctaves="2" seed="${seed}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="7" xChannelSelector="R" yChannelSelector="G"/></filter></defs>` +
    `<g filter="url(#${p}r)"><path d="${d}" fill="url(#${p}g)"/><g fill="none" stroke="${c1}" stroke-linecap="round">${streaks}</g></g></svg>`
  );
}

/** 一道金线卷云：从中心往外旋一圈半，再甩出一条尾巴。dir = 1 尾巴甩向右，-1 甩向左 */
function swirl(cx: number, cy: number, R: number, dir: number, up: number): string {
  const pts: string[] = [];
  const turns = 2.6 * Math.PI;
  for (let k = 0; k <= 48; k++) {
    const t = k / 48;
    const th = turns * (1 - t);
    const rr = R * (0.18 + 0.82 * t);
    pts.push(`${n1(cx + dir * Math.cos(th) * rr)} ${n1(cy + up * Math.sin(th) * rr)}`);
  }
  // 尾巴：从最外一圈顺势甩出去
  const ex = cx + dir * R;
  const tail = `Q${n1(ex + dir * R * 0.7)} ${n1(cy + up * R * 0.55)} ${n1(ex + dir * R * 1.5)} ${n1(cy + up * R * 0.3)}`;
  return `M${pts.join(' L')} ${tail}`;
}

// ───────────────────────── 开局 ─────────────────────────

/** 开局 · 风起云涌（演 1.95 秒） */
export function bannerOpening(w: number, h: number): HTMLElement {
  const root = div('xq-bn kai');
  root.style.setProperty('--dry', dryBrush());
  const cx = w / 2;
  const cy = h / 2;
  // 卷云：贴着浓墨两头，左上、右下两朵大的，左下、右上两朵小的，错开时间旋出来；每朵双线（祥云纹的画法）
  const sw: [number, number, number, number, number, number][] = [
    [cx - w * 0.3, cy - w * 0.16, w * 0.07, -1, -1, 0.22],
    [cx + w * 0.3, cy + w * 0.16, w * 0.07, 1, 1, 0.3],
    [cx - w * 0.36, cy + w * 0.135, w * 0.042, -1, 1, 0.42],
    [cx + w * 0.36, cy - w * 0.135, w * 0.042, 1, -1, 0.5],
  ];
  const paths = sw
    .map(
      ([x, y, R, dir, up, d]) =>
        `<path d="${swirl(x, y, R, dir, up)}" pathLength="1" style="--d:${d}s"/>` +
        `<path class="thin" d="${swirl(x, y, R * 0.72, dir, up)}" pathLength="1" style="--d:${d + 0.08}s"/>`,
    )
    .join('');
  root.innerHTML = `<svg class="xq-bfull xq-bswirl" viewBox="0 0 ${n1(w)} ${n1(h)}" xmlns="http://www.w3.org/2000/svg">${paths}</svg>`;
  root.appendChild(center(div('xq-bhalo'), 'kai-halo'));
  root.appendChild(center(div('xq-bband', band(11, '#0b0705', '#2a1d14')), 'kai-band'));
  root.appendChild(center(text('开局', 'gold', 'xq-fx-word', [0.14, 0.32])));
  root.appendChild(div('xq-fx-seal', '<span>楚</span><span>汉</span>'));
  return root;
}

// ───────────────────────── 吃车 ─────────────────────────

/** 吃车 · 刀光一闪（演 1.3 秒）。(px, py)：被吃的车在哪（第一刀从它身上劈过） */
export function bannerCapture(w: number, h: number, px: number, py: number, tone: Tone): HTMLElement {
  const root = div('xq-bn chiche');
  root.style.setProperty('--dry', dryBrush());
  // 第一刀：斜着（右上到左下）劈过被吃的车，贯穿整块棋盘
  const L = Math.hypot(w, h);
  const ax = Math.cos(-0.52);
  const ay = Math.sin(-0.52);
  const seg = `M${n1(px - ax * L)} ${n1(py - ay * L)} L${n1(px + ax * L)} ${n1(py + ay * L)}`;
  root.innerHTML =
    `<svg class="xq-bfull xq-bslash" viewBox="0 0 ${n1(w)} ${n1(h)}" xmlns="http://www.w3.org/2000/svg">` +
    `<path class="glow" d="${seg}" pathLength="1"/><path class="core" d="${seg}" pathLength="1"/></svg>`;
  root.appendChild(center(div('xq-bband', band(23, '#2a0303', '#5c0a06')), 'cut-band'));
  // 字：上下两半叠在一起（看着是一整个字），第二刀斩下去，两半顺着刀口错开、落下
  const cut = div('xq-bcut');
  cut.appendChild(text('吃车', tone, 'half a xq-fx-word'));
  cut.appendChild(text('吃车', tone, 'half b'));
  root.appendChild(center(cut));
  return root;
}

/** 第二刀的刀口在特效层里的位置（刀光画在特效画布上、火星沿着它溅）：按字实际排出来的框算，两头各出去一点 */
export function cutLine(root: HTMLElement): [number, number, number, number] | null {
  const c = root.querySelector('.xq-bcut');
  const host = root.parentElement;
  if (!c || !host) return null;
  const r = c.getBoundingClientRect();
  const o = host.getBoundingClientRect();
  if (!r.width) return null;
  const x0 = r.left - o.left;
  const y0 = r.top - o.top;
  const ext = 0.12;
  return [x0 - r.width * ext, y0 + r.height * (0.8 + 0.6 * ext), x0 + r.width * (1 + ext), y0 + r.height * (0.2 - 0.6 * ext)];
}

/** 第二刀的刀光：一道白光沿着刀口一闪（盖在字上面，所以放在横幅里，不画在下面那层画布上） */
export function blade(root: HTMLElement, [x0, y0, x1, y1]: [number, number, number, number]) {
  const b = div('xq-bblade');
  b.style.left = `${n1(x0)}px`;
  b.style.top = `${n1(y0)}px`;
  b.style.width = `${n1(Math.hypot(x1 - x0, y1 - y0))}px`;
  b.style.setProperty('--rot', `${Math.atan2(y1 - y0, x1 - x0).toFixed(4)}rad`);
  root.appendChild(b);
}

// ───────────────────────── 将军 ─────────────────────────

/** 将军 · 擂鼓点将（演 1.15 秒）。(kx, ky)：被将的老将 */
export function bannerCheck(w: number, h: number, kx: number, ky: number, byMe: boolean): HTMLElement {
  const root = div(`xq-bn jiang ${byMe ? 'me' : 'foe'}`);
  root.style.setProperty('--dry', dryBrush());
  // 集中线：几十根细楔子，尖头指着老将
  const r = rng(Math.floor(kx * 7 + ky * 13) + 5);
  const ro = Math.hypot(w, h);
  let wedges = '';
  const n = 60;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + (r() - 0.5) * 0.08;
    const ri = w * (0.17 + r() * 0.16);
    const hw = 0.004 + r() * 0.013;
    const p0 = `${n1(kx + Math.cos(a) * ri)} ${n1(ky + Math.sin(a) * ri)}`;
    const p1 = `${n1(kx + Math.cos(a - hw) * ro)} ${n1(ky + Math.sin(a - hw) * ro)}`;
    const p2 = `${n1(kx + Math.cos(a + hw) * ro)} ${n1(ky + Math.sin(a + hw) * ro)}`;
    wedges += `<path d="M${p0} L${p1} L${p2} Z" opacity="${(0.3 + r() * 0.55).toFixed(2)}"/>`;
  }
  root.innerHTML = `<svg class="xq-bfull xq-bspeed" viewBox="0 0 ${n1(w)} ${n1(h)}" xmlns="http://www.w3.org/2000/svg" style="transform-origin:${n1(kx)}px ${n1(ky)}px">${wedges}</svg>`;
  // 令旗：我将军是一笔朱砂，被将是一笔浓墨
  root.appendChild(center(div('xq-bband', byMe ? band(37, '#8e0d07', '#d4321c') : band(41, '#090606', '#2b1210')), 'flag'));
  root.appendChild(center(div('xq-bhalo'), 'jiang-halo'));
  // 两记鼓点各荡开一圈气浪
  root.appendChild(center(div('xq-bring r1')));
  root.appendChild(center(div('xq-bring r2')));
  root.appendChild(center(text('将军', byMe ? 'gold' : 'red', 'xq-fx-word')));
  return root;
}

// ───────────────────────── 绝杀 / 困毙 ─────────────────────────

/** 一道闪电：中点位移法折出来，带一两根岔 */
function bolt(x0: number, y0: number, x1: number, y1: number, r: () => number): string {
  let pts: [number, number][] = [
    [x0, y0],
    [x1, y1],
  ];
  let amp = Math.hypot(x1 - x0, y1 - y0) * 0.16;
  for (let k = 0; k < 5; k++) {
    const nx: [number, number][] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const [ax, ay] = pts[i - 1];
      const [bx, by] = pts[i];
      const len = Math.hypot(bx - ax, by - ay) || 1;
      const off = (r() - 0.5) * 2 * amp;
      nx.push([(ax + bx) / 2 + (-(by - ay) / len) * off, (ay + by) / 2 + ((bx - ax) / len) * off], pts[i]);
    }
    pts = nx;
    amp *= 0.55;
  }
  let d = `M${pts.map(([x, y]) => `${n1(x)} ${n1(y)}`).join(' L')}`;
  // 岔：从主干中段分出去，短一些、往一边斜
  for (let b = 0; b < 2; b++) {
    const k = Math.floor(pts.length * (0.3 + r() * 0.35));
    const [sx, sy] = pts[k];
    const [tx, ty] = pts[Math.min(pts.length - 1, k + 4)];
    const ang = Math.atan2(ty - sy, tx - sx) + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.5);
    const len = Math.hypot(x1 - x0, y1 - y0) * (0.15 + r() * 0.15);
    let bx = sx;
    let by = sy;
    d += ` M${n1(sx)} ${n1(sy)}`;
    for (let s = 0; s < 5; s++) {
      bx += Math.cos(ang + (r() - 0.5) * 0.9) * (len / 5);
      by += Math.sin(ang + (r() - 0.5) * 0.9) * (len / 5);
      d += ` L${n1(bx)} ${n1(by)}`;
    }
  }
  return d;
}

/**
 * 绝杀 · 雷霆血墨 / 困毙 · 寒墨锁宫：先搭底（绝杀有闪电和一下白光），两个字由 mateChar 一个一个加进来。
 * 留着不收，等结果页出来、新开一盘时 reset 收掉
 */
export function bannerMate(w: number, h: number, kx: number, ky: number, kunbi: boolean, win: boolean): HTMLElement {
  const root = div(`xq-bn mate ${kunbi ? 'kunbi' : 'jiesha'} ${win ? 'win' : 'lose'}`);
  root.style.setProperty('--dry', dryBrush());
  if (!kunbi) {
    const r = rng(Math.floor(kx * 3 + ky * 5) + 17);
    // 三道闪电从棋盘中间那一侧劈进九宫（老将总在上下两头，从画面外劈下来太短）
    const toward = Math.atan2(h / 2 - ky, w / 2 - kx);
    const bolts = [0, 0.13, 0.3]
      .map((d, i) => {
        const a = toward + (i - 1) * 0.75 + (r() - 0.5) * 0.3;
        const L = w * (0.62 + r() * 0.2);
        return `<path d="${bolt(kx + Math.cos(a) * L, ky + Math.sin(a) * L, kx + (r() - 0.5) * 8, ky + (r() - 0.5) * 8, r)}" style="--d:${d}s"/>`;
      })
      .join('');
    const p = `bl${++uid}`;
    root.innerHTML =
      `<div class="xq-bflash" style="--kx:${n1(kx)}px;--ky:${n1(ky)}px"></div>` +
      `<svg class="xq-bfull xq-bbolt" viewBox="0 0 ${n1(w)} ${n1(h)}" xmlns="http://www.w3.org/2000/svg"><defs>` +
      `<filter id="${p}" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3.2"/></filter></defs>` +
      `<g class="glow" filter="url(#${p})">${bolts}</g><g class="core">${bolts}</g></svg>`;
  }
  return root;
}

/** 绝杀的一个字砸下来：背后一团血墨（困毙是寒墨）、四周一圈裂纹。i：第几个字，n：一共几个 */
export function mateChar(root: HTMLElement, ch: string, i: number, n: number, tone: Tone, kunbi: boolean) {
  const cell = div('xq-bm');
  cell.style.setProperty('--slot', String(i - (n - 1) / 2));
  const seed = 50 + i * 7 + (kunbi ? 3 : 0);
  const sp = kunbi ? splash(`bs${++uid}`, seed, '#22384d', '#05090e', '#0c1622') : splash(`bs${++uid}`, seed, '#a10f08', '#200303', '#4a0705');
  // 裂纹：从字中心往外七道折线
  const r = rng(seed + 1);
  let cracks = '';
  for (let k = 0; k < 7; k++) {
    let a = (k / 7) * Math.PI * 2 + (r() - 0.5) * 0.5;
    let x = 100 + Math.cos(a) * 34;
    let y = 100 + Math.sin(a) * 34;
    let d = `M${n1(x)} ${n1(y)}`;
    for (let s = 0; s < 5; s++) {
      a += (r() - 0.5) * 0.7;
      const step = 9 + r() * 10;
      x += Math.cos(a) * step;
      y += Math.sin(a) * step;
      d += ` L${n1(x)} ${n1(y)}`;
    }
    cracks += `<path d="${d}" pathLength="1" stroke-width="${n1(1.2 + r() * 1.6)}"/>`;
  }
  cell.innerHTML =
    `<div class="xq-bsplash">${sp}</div><svg class="xq-bcrack" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">${cracks}</svg>` +
    `<div class="xq-bglow">${ch}</div>`;
  cell.appendChild(text(ch, tone, 'xq-fx-word one'));
  root.appendChild(cell);
}
