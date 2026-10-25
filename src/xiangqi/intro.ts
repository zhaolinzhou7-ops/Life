/**
 * 出场：开局之前，一位人物在水墨里亮相，报一声名号，然后棋盘才转平、棋子落下。
 *
 * 用户原话："出场动画：可以多一些不同的选择，比如关羽、哪吒这类 3D 神话人物的出场。整体仪式感要强一些，
 * 有水墨画、流光溢彩的感觉，做出那种非常美观的江湖侠气。"
 *
 * 一场四秒多，一气呵成：
 *   0.0 s  一滴浓墨落在屏幕中间、洇开，把整屏染黑（低低一声鼓、一声"嗡"）
 *   0.25s  画卷从墨里晕出来：天、远山、中景、雾、近景分在 3D 空间里的几层，镜头慢慢往前推、微微转，
 *          近处走得快、远处走得慢（视差，这就是"3D"的来处）；一串古筝往上刮
 *   0.5 s  人物背后一团泼墨炸开，人物从墨里凝出来（由虚到实）
 *   0.8 s  人物报名号（各自的嗓子，tools/gen-voice.py 离线生成），字幕跟着出来
 *   1.0 s  大名一笔一笔从上往下写出来，旁边一句诗；一道金光从人物身上、名字上扫过去（流光）
 *   1.15s  亮相的一招：一道光从屏幕上劈过去（刀光、偃月弧、乾坤圈、剑气、金箍棒光柱），一闪白、画面一震
 *   1.9 s  朱红印章"对弈"盖下来，迸出一把火星；上面一行"对阵 · 某某"
 *   末尾   整幅画淡出，棋盘接着转平入场
 * 上下两条电影的黑边，字幕在下面那条黑边里；大名背后一笔泼墨
 * 点一下屏幕任何地方就跳过。
 *
 * 人物和场景的画在 heroart.ts；空中飘的雨、火星、花瓣、金尘画在一张 canvas 上。
 */
import heroFontUrl from './fonts/xq-hero.woff2?url';
import verseFontUrl from './fonts/xq-verse.woff2?url';
import { heroArt, type HeroId } from './heroart';
import { getVoiceKind, preloadVoice, xqHeroLine } from '../xqvoice';
import { xqSfxHero } from '../xqsfx';
import { xqMusicDuck } from '../xqmusic';

export type { HeroId } from './heroart';

export interface HeroInfo {
  id: HeroId;
  /** 设置页里的名字 */
  label: string;
  /** 屏幕上写的大名 */
  name: string;
  /** 大名旁边那一句 */
  verse: string;
  /** 报的名号（和录音一字不差） */
  line: string;
  /** 一句话介绍（设置页） */
  desc: string;
  /** 名字写在哪一边（避开人物手里的兵器） */
  side: 'l' | 'r';
  /** 空中飘什么 */
  air: Air[];
  /** 录音多长（秒），整场按它排 */
  voiceSec: number;
}

type Air = 'rain' | 'embers' | 'fire' | 'petals' | 'motes' | 'moon';

export const HEROES: HeroInfo[] = [
  {
    id: 'daoke',
    label: '斗笠刀客',
    name: '刀客',
    // 黄庭坚《寄黄几复》："桃李春风一杯酒，江湖夜雨十年灯"
    verse: '江湖夜雨十年灯',
    line: '刀在鞘中，棋在心中。请！',
    desc: '雨夜竹林，斗笠、背上一把刀',
    side: 'r',
    air: ['rain', 'motes'],
    voiceSec: 3.8,
  },
  {
    id: 'guangong',
    label: '关公',
    name: '关公',
    verse: '义薄云天',
    line: '关某在此，请赐教！',
    desc: '赤霞战旗，青龙偃月刀',
    side: 'l',
    air: ['embers', 'motes'],
    voiceSec: 3.55,
  },
  {
    id: 'nezha',
    label: '哪吒',
    name: '哪吒',
    verse: '脚踏风火轮',
    line: '哪吒在此，风火轮来也！',
    desc: '闹海火光，风火轮、混天绫',
    side: 'l',
    air: ['fire', 'motes'],
    voiceSec: 3.8,
  },
  {
    id: 'nvxia',
    label: '白衣女侠',
    name: '女侠',
    // 李白《侠客行》："事了拂衣去，深藏身与名"
    verse: '事了拂衣去',
    line: '白衣仗剑，请赐教！',
    desc: '月下梅花，帷帽白衣、倒提一口剑',
    // 右上是月亮和梅枝，白字写在月亮上看不清
    side: 'l',
    air: ['petals', 'moon'],
    voiceSec: 3.3,
  },
  {
    id: 'dasheng',
    label: '齐天大圣',
    name: '大圣',
    verse: '火眼金睛',
    line: '俺老孙来也！',
    desc: '云海金光，筋斗云、金箍棒',
    side: 'r',
    air: ['motes', 'embers'],
    voiceSec: 2.9,
  },
];
export const heroInfo = (id: HeroId) => HEROES.find((h) => h.id === id) ?? HEROES[0];

// ───────────────────────── 设置：演谁 ─────────────────────────

/** 随机（每盘换一位，不和上一盘重复）、指定一位、不演 */
export type HeroPick = HeroId | 'random' | 'off';
const KEY = 'xq-hero';
const LAST = 'xq-hero-last';

export function getHeroPick(): HeroPick {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'random' || v === 'off' || HEROES.some((h) => h.id === v)) return v as HeroPick;
  } catch {
    /* 读不出来按默认 */
  }
  return 'random';
}
export function setHeroPick(v: HeroPick) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 存不下就这一次有效 */
  }
}

/** 这一盘请谁出场（关掉了返回 null） */
export function nextHero(): HeroId | null {
  const pick = getHeroPick();
  if (pick === 'off') return null;
  if (pick !== 'random') return pick;
  let last = '';
  try {
    last = localStorage.getItem(LAST) ?? '';
  } catch {
    /* 没有就随便挑 */
  }
  const pool = HEROES.filter((h) => h.id !== last);
  const id = pool[Math.floor(Math.random() * pool.length)].id;
  try {
    localStorage.setItem(LAST, id);
  } catch {
    /* 记不下就可能和上一盘重复，不要紧 */
  }
  return id;
}

// ───────────────────────── 字体、录音 ─────────────────────────

let fonts: Promise<void> | null = null;
/** 大名、字幕用马善政毛笔楷书，诗句用志莽行书（都只截了出场要用的几十个字） */
function loadFonts(): Promise<void> {
  if (fonts) return fonts;
  if (typeof FontFace === 'undefined') return (fonts = Promise.resolve());
  const one = (family: string, url: string) =>
    new FontFace(family, `url(${url}) format("woff2")`)
      .load()
      .then((f) => {
        document.fonts.add(f);
      })
      .catch(() => {
        /* 落空就用系统的楷体 */
      });
  fonts = Promise.all([one('XQ Hero', heroFontUrl), one('XQ Verse', verseFontUrl)]).then(() => undefined);
  return fonts;
}

/** 提前把字体拉下来（开局设置页就调）；指定了哪一位，就把他的录音也拉下来 */
export function preloadHero() {
  void loadFonts();
  const pick = getHeroPick();
  if (pick !== 'random' && pick !== 'off') preloadVoice([`hero-${pick}`]);
}

// ───────────────────────── 墨滴的形状（遮罩） ─────────────────────────

/** 一滴洇开的墨：毛边的圆 + 甩出去的几个墨点。当 CSS 遮罩用，越放越大就是"洇开" */
const BLOT = (() => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><filter id="b" x="-20%" y="-20%" width="140%" height="140%">` +
    `<feTurbulence type="fractalNoise" baseFrequency=".05" numOctaves="3" seed="11"/><feDisplacementMap in="SourceGraphic" scale="26"/></filter>` +
    `<g filter="url(#b)" fill="#000"><circle cx="100" cy="100" r="62"/><circle cx="160" cy="70" r="7"/><circle cx="44" cy="146" r="5"/><circle cx="58" cy="44" r="4"/><circle cx="150" cy="156" r="6"/></g></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
})();

// ───────────────────────── 空中飘的东西 ─────────────────────────

interface Mote {
  k: Air;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  a: number;
  ph: number;
  spin: number;
  hue: number;
}

function spawn(k: Air, w: number, h: number, rnd: () => number, anywhere: boolean): Mote {
  const m: Mote = { k, x: rnd() * w, y: anywhere ? rnd() * h : 0, vx: 0, vy: 0, r: 1, a: 1, ph: rnd() * 6.3, spin: (rnd() - 0.5) * 6, hue: 0 };
  const s = Math.min(w, h) / 400;
  switch (k) {
    case 'rain':
      m.vy = (900 + rnd() * 500) * s;
      m.vx = m.vy * 0.16;
      m.r = (16 + rnd() * 18) * s;
      m.a = 0.18 + rnd() * 0.28;
      if (!anywhere) m.y = -m.r - rnd() * h * 0.3;
      break;
    case 'embers':
    case 'fire':
      m.vy = -(k === 'fire' ? 70 + rnd() * 150 : 35 + rnd() * 80) * s;
      m.vx = (rnd() - 0.5) * 40 * s;
      m.r = (0.8 + rnd() * 2) * s;
      m.a = 0.5 + rnd() * 0.5;
      m.hue = k === 'fire' ? 12 + rnd() * 30 : 28 + rnd() * 20;
      if (!anywhere) m.y = h + 10;
      break;
    case 'petals':
      m.vy = (40 + rnd() * 50) * s;
      m.vx = (30 + rnd() * 40) * s;
      m.r = (3 + rnd() * 2.6) * s;
      m.a = 0.75 + rnd() * 0.25;
      m.hue = rnd() < 0.7 ? 352 : 340;
      if (!anywhere) {
        m.y = -10;
        m.x = rnd() * w * 1.2 - w * 0.4;
      }
      break;
    case 'motes':
    case 'moon':
      m.vy = -(6 + rnd() * 22) * s;
      m.vx = (rnd() - 0.5) * 14 * s;
      m.r = (0.7 + rnd() * rnd() * 3.2) * s;
      m.a = 0.35 + rnd() * 0.6;
      m.hue = k === 'moon' ? 210 : 42 + rnd() * 10;
      break;
  }
  return m;
}

const COUNT: Record<Air, number> = { rain: 150, embers: 55, fire: 80, petals: 34, motes: 70, moon: 40 };

/** 流光：几道金色的光从左下往右上一闪而过 */
interface Streak {
  t0: number;
  x: number;
  y: number;
  len: number;
  w: number;
}

/** 印章盖下去那一下迸出来的火星：带重力，画成顺着速度方向的一小道 */
interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  hue: number;
}

function runAir(cv: HTMLCanvasElement, air: Air[], durMs: number): { stop: () => void; burst: (x: number, y: number, n: number, hue: number) => void } {
  const g = cv.getContext('2d');
  if (!g) return { stop: () => {}, burst: () => {} };
  const sparks: Spark[] = [];
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth || window.innerWidth;
  const H = cv.clientHeight || window.innerHeight;
  cv.width = Math.round(W * dpr);
  cv.height = Math.round(H * dpr);
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const ms: Mote[] = [];
  for (const k of air) for (let i = 0; i < COUNT[k]; i++) ms.push(spawn(k, W, H, rnd, true));
  const streaks: Streak[] = Array.from({ length: 7 }, (_, i) => ({
    t0: 1150 + i * 90 + rnd() * 120,
    x: W * (-0.2 + rnd() * 0.9),
    y: H * (0.45 + rnd() * 0.5),
    len: Math.max(W, H) * (0.35 + rnd() * 0.3),
    w: 1 + rnd() * 2.2,
  }));
  const start = performance.now();
  let last = start;
  let raf = 0;
  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = now - start;
    g.clearRect(0, 0, W, H);
    // 开场那一下墨还没洇开，东西慢慢多起来
    const fade = Math.min(1, Math.max(0, (t - 250) / 700)) * Math.min(1, Math.max(0, (durMs - t) / 500));
    for (const m of ms) {
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      m.ph += dt * 2.4;
      const out = m.y > H + 40 || m.y < -60 || m.x > W + 60 || m.x < -60;
      if (out) Object.assign(m, spawn(m.k, W, H, rnd, false));
      if (m.k === 'rain') {
        g.globalCompositeOperation = 'source-over';
        g.strokeStyle = `rgba(236,236,240,${m.a * fade})`;
        g.lineWidth = 1;
        g.beginPath();
        g.moveTo(m.x, m.y);
        g.lineTo(m.x - m.vx * 0.022, m.y - m.r);
        g.stroke();
      } else if (m.k === 'petals') {
        g.globalCompositeOperation = 'source-over';
        m.x += Math.sin(m.ph) * 12 * dt;
        g.save();
        g.translate(m.x, m.y);
        g.rotate(m.ph * m.spin * 0.3);
        g.scale(1, 0.55 + 0.45 * Math.sin(m.ph * 1.7));
        g.fillStyle = `hsla(${m.hue},70%,${m.hue === 352 ? 56 : 80}%,${m.a * fade})`;
        g.beginPath();
        g.ellipse(0, 0, m.r, m.r * 0.62, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else {
        g.globalCompositeOperation = 'lighter';
        const tw = m.k === 'motes' || m.k === 'moon' ? 0.55 + 0.45 * Math.sin(m.ph * 1.6) : 1;
        const sat = m.k === 'moon' ? 40 : 100;
        const lum = m.k === 'moon' ? 88 : 62;
        m.x += Math.sin(m.ph) * 8 * dt;
        g.fillStyle = `hsla(${m.hue},${sat}%,${lum}%,${0.16 * m.a * tw * fade})`;
        g.beginPath();
        g.arc(m.x, m.y, m.r * 3.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `hsla(${m.hue},${sat}%,${lum + 18}%,${m.a * tw * fade})`;
        g.beginPath();
        g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        g.fill();
      }
    }
    // 流光
    g.globalCompositeOperation = 'lighter';
    for (const s of streaks) {
      const u = (t - s.t0) / 520;
      if (u < 0 || u > 1) continue;
      const head = u * 1.5;
      const x1 = s.x + s.len * head * 0.86;
      const y1 = s.y - s.len * head * 0.5;
      const x0 = x1 - s.len * 0.42 * 0.86;
      const y0 = y1 + s.len * 0.42 * 0.5;
      const gr = g.createLinearGradient(x0, y0, x1, y1);
      const a = Math.sin(u * Math.PI);
      gr.addColorStop(0, 'rgba(255,214,120,0)');
      gr.addColorStop(0.8, `rgba(255,226,150,${0.55 * a})`);
      gr.addColorStop(1, `rgba(255,250,225,${0.95 * a})`);
      g.strokeStyle = gr;
      g.lineWidth = s.w;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
    }
    // 火星
    for (let i = sparks.length - 1; i >= 0; i--) {
      const p = sparks[i];
      p.age += dt;
      if (p.age > p.life) {
        sparks.splice(i, 1);
        continue;
      }
      p.vy += 900 * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const a = 1 - p.age / p.life;
      g.strokeStyle = `hsla(${p.hue},100%,${60 + a * 25}%,${a})`;
      g.lineWidth = 1.2 + a * 1.4;
      g.beginPath();
      g.moveTo(p.x, p.y);
      g.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03);
      g.stroke();
    }
    g.globalCompositeOperation = 'source-over';
    if (t < durMs) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  const box = () => cv.getBoundingClientRect();
  return {
    stop: () => cancelAnimationFrame(raf),
    burst: (x, y, n, hue) => {
      const r = box();
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2;
        const v = 160 + rnd() * 520;
        sparks.push({ x: x - r.left, y: y - r.top, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 180, age: 0, life: 0.5 + rnd() * 0.7, hue: hue + (rnd() - 0.5) * 16 });
      }
    },
  };
}

/**
 * 亮相那一下的"招式"：一道光从屏幕上劈过去。刀客横着一刀、关公一道偃月弧、哪吒乾坤圈一圈冲击波、
 * 女侠一道斜着的剑气、大圣金箍棒一根通天的光柱。坐标和场景一样是竖版 400×800（铺满屏幕）
 */
const SLASH: Record<HeroId, string> = {
  daoke: '<path d="M-30 470 Q200 416 430 452" pathLength="1"/>',
  guangong: '<path d="M60 610 C80 300 300 210 392 372" pathLength="1"/>',
  nezha: '<circle cx="200" cy="430" r="70" pathLength="1"/>',
  nvxia: '<path d="M372 226 L38 694" pathLength="1"/>',
  dasheng: '<path d="M279 -20 L279 820" pathLength="1"/>',
};

// ───────────────────────── 背景层画成位图 ─────────────────────────

/**
 * 背景几层（天、远山、中景、雾、近景）是静止的画，但镜头一推，浏览器会按新的缩放把带滤镜的矢量图重画——
 * 近景那层竹子（湍流毛边 + 景深模糊，比屏幕还大三成）一层就把帧率从将近 30 拖到 18（无头浏览器、两倍像素实测）。
 * 所以一进场就把它们各画一次成位图（canvas），镜头只是挪位图。原来的 SVG 先顶着，位图画好了再换上，看不出来。
 * scale：按几倍像素画（虚的层用 1 倍就够，远山中景 1.5 倍）
 */
function rasterize(host: HTMLElement, scale: number) {
  const svg = host.innerHTML.trim();
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (!svg.startsWith('<svg') || !w || !h) return;
  const W = Math.round(w * scale);
  const H = Math.round(h * scale);
  const img = new Image();
  img.onload = () => {
    if (!host.isConnected) return;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return;
    try {
      g.drawImage(img, 0, 0, W, H);
    } catch {
      return; // 画不出来就留着 SVG
    }
    host.replaceChildren(cv);
  };
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace('<svg ', `<svg width="${W}" height="${H}" `))}`;
}

/**
 * 大名背后那一笔：起笔重、往下收细、末尾一甩，下半截有几道飞白（干笔刷开的丝），旁边溅几点墨。
 * 毛边是湍流推出来的；从上往下刷出来（CSS 里 clip-path 一点点放开）
 */
const BRUSH =
  `<svg class="xqh-stroke" viewBox="0 0 100 300" preserveAspectRatio="none">` +
  `<filter id="xqh-sf" x="-25%" y="-10%" width="150%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".08 .018" numOctaves="3" seed="5"/><feDisplacementMap in="SourceGraphic" scale="12"/></filter>` +
  `<mask id="xqh-sm" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="300"><rect width="100" height="300" fill="#fff"/>` +
  `<path d="M38 170 C40 220 41 260 44 300 M47 196 C48 236 50 270 51 300 M57 160 C58 210 60 250 61 300 M66 188 C66 226 64 262 62 300" stroke="#000" stroke-width="2.6" fill="none"/></mask>` +
  `<g filter="url(#xqh-sf)" mask="url(#xqh-sm)">` +
  `<path d="M52 4 C80 6 93 26 86 54 C82 92 80 150 76 200 C73 240 66 270 58 296 L54 300 C44 272 34 236 30 196 C26 150 24 100 22 62 C18 30 30 4 52 4 Z"/>` +
  `<circle cx="88" cy="36" r="4"/><circle cx="14" cy="88" r="2.5"/><circle cx="82" cy="252" r="2"/><circle cx="20" cy="210" r="1.6"/></g></svg>`;

// ───────────────────────── 演一场 ─────────────────────────

let current: { el: HTMLElement; end: () => void } | null = null;

/** 现在有没有在演（测试、调试看） */
export const heroPlaying = () => !!current;

/** 不演了（对局还没开始就退出了）：画面立刻收掉 */
export function stopHeroIntro() {
  current?.end();
}

/**
 * 演一场出场。返回的 Promise 在"该轮到棋盘入场"时 resolve（画面开始淡出、或者被点了跳过）。
 * host 默认整个页面（盖住一切，点一下就跳过）
 */
export function playHeroIntro(id: HeroId, host: HTMLElement = document.body, opts: { hold?: boolean; vs?: string } = {}): Promise<void> {
  current?.end();
  const h = heroInfo(id);
  const art = heroArt(id);
  void loadFonts();
  const voiced = getVoiceKind() !== 'off';
  // 整场多长：报完名号再留一点余韵；不配音就短一点
  const total = Math.round(voiced ? Math.max(3600, 800 + h.voiceSec * 1000 + 150) : 3500);
  const outMs = 650;

  const root = document.createElement('div');
  root.className = `xqh xqh-${id} xqh-side-${h.side}`;
  root.dataset.hero = id;
  root.style.setProperty('--T', `${total}ms`);
  root.innerHTML = `
    <div class="xqh-dark"></div>
    <div class="xqh-scene">
      <div class="xqh-cam">
        <div class="xqh-l xqh-sky">${art.sky}</div>
        <div class="xqh-l xqh-far">${art.far}</div>
        <div class="xqh-l xqh-mid">${art.mid}</div>
        <div class="xqh-l xqh-mist">${art.mist}</div>
        <div class="xqh-rays"></div>
        <div class="xqh-splash">${art.splash}</div>
        <div class="xqh-hero"><div class="xqh-fig">${art.fig}</div></div>
        <div class="xqh-l xqh-near">${art.near}</div>
      </div>
      <canvas class="xqh-air"></canvas>
      <div class="xqh-paper"></div>
    </div>
    <svg class="xqh-slash" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">${SLASH[id]}</svg>
    <div class="xqh-flash"></div>
    <div class="xqh-bars"><i></i><i></i></div>
    <div class="xqh-title">
      <div class="xqh-namebox">${BRUSH}<div class="xqh-name">${h.name}</div></div>
      <div class="xqh-side"><div class="xqh-verse">${h.verse}</div><div class="xqh-seal"><span>对</span><span>弈</span></div></div>
    </div>
    <div class="xqh-line"><span>${h.line}</span></div>
    ${opts.vs ? `<div class="xqh-vs">对阵 · ${opts.vs}</div>` : ''}
    <div class="xqh-skip">轻触跳过</div>`;
  for (const sel of ['.xqh-dark', '.xqh-scene']) {
    const el = root.querySelector(sel) as HTMLElement;
    el.style.setProperty('-webkit-mask-image', BLOT);
    el.style.setProperty('mask-image', BLOT);
  }
  host.appendChild(root);
  // 一帧画一层（一起画，开场那一帧要卡上一百多毫秒）；最费的近景先画
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const layers = [['.xqh-near', 1], ['.xqh-far', 1.5], ['.xqh-mid', 1.5], ['.xqh-mist', 1], ['.xqh-sky', 1]] as const;
  layers.forEach(([sel, sc], i) => window.setTimeout(() => rasterize(root.querySelector(sel) as HTMLElement, Math.min(dpr, sc)), 40 + i * 45));
  // 洇开之后遮罩就没用了，撤掉省得每一帧都要算
  const scene = root.querySelector('.xqh-scene') as HTMLElement;
  scene.addEventListener('animationend', (e) => {
    if (e.target === scene && e.animationName === 'xqh-bloom') {
      scene.style.setProperty('-webkit-mask-image', 'none');
      scene.style.setProperty('mask-image', 'none');
    }
  });
  const air = runAir(root.querySelector('.xqh-air') as HTMLCanvasElement, h.air, total);
  const stopAir = air.stop;
  // 印章盖下那一下，从印章上迸出一把火星
  const SPARK_HUE: Record<HeroId, number> = { daoke: 40, guangong: 30, nezha: 22, nvxia: 200, dasheng: 45 };
  const sparkTimer = window.setTimeout(() => {
    const r = root.querySelector('.xqh-seal')?.getBoundingClientRect();
    if (r && r.width) air.burst(r.left + r.width / 2, r.top + r.height / 2, 46, SPARK_HUE[id]);
  }, 2020);

  xqSfxHero(id);
  if (voiced) xqHeroLine(id, 800);
  window.setTimeout(() => xqMusicDuck(0.22, total / 1000), 30);

  return new Promise<void>((resolve) => {
    const timers: number[] = [];
    let ended = false;
    let out = false;
    const end = () => {
      if (ended) return;
      ended = true;
      timers.forEach(clearTimeout);
      clearTimeout(sparkTimer);
      stopAir();
      root.remove();
      if (current?.el === root) current = null;
      resolve();
    };
    const leave = (ms: number) => {
      if (out) return;
      out = true;
      root.classList.add('out');
      root.style.setProperty('--out', `${ms}ms`);
      resolve();
      timers.push(window.setTimeout(end, ms));
    };
    current = { el: root, end };
    // hold：停在画面上不走（调试、截图用；点一下照样跳过）
    if (!opts.hold) timers.push(window.setTimeout(() => leave(outMs), total - outMs));
    // 点一下跳过（按下就算，不等抬手）
    root.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      leave(320);
    });
  });
}
