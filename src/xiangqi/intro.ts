/**
 * 出场：开局之前，一位人物整幅亮相、喊一声，然后棋盘才转平、棋子落下。
 *
 * 用户原话："出场动画：可以多一些不同的选择，比如关羽、哪吒这类 3D 神话人物的出场。整体仪式感要强一些……"
 * 后来用户给了两批图（关公、哪吒、斗笠刀客；六位棋手），说"融入到我们的这个软件当中"，又说"把孙悟空啊，还有那白衣女侠呀，
 * 从里面拿掉……配上合适的台词，要有杀气，女的呢也要有特色……真正的是征战杀伐的那种感觉"。
 * 所以九位人物全用用户给的画（Real-ESRGAN 放大过，src/xiangqi/heroimg/），原来手画的矢量人物删了。
 *
 * 一场四五秒，一气呵成：
 *   0.0 s  一滴浓墨落在屏幕中间、洇开，把整屏染黑（低低一声鼓、一声"嗡"）
 *   0.25s  画从墨里晕出来，铺满屏幕；镜头慢慢推拉（每位推的方向、落点不一样）
 *   0.8 s  人物喊出开场白（各自的嗓子，tools/gen-voice.py 离线生成、处理成有杀气的喊），字幕跟着出来
 *   1.15s  亮相的一招：一道光顺着画里的兵器劈下去（或者落子那一下炸开一圈），一闪白、画面一震、迸一把火星
 *   1.35s  一道金光斜着扫过整幅画
 *   末尾   整幅画淡出，棋盘接着转平入场
 * 画上自带题字（"关公 · 提刀斩将""中国象棋 · 运筹帷幄"……）；三张围棋棋手的画题的是"围棋"，软件里下的是象棋，
 * 那两个字裁掉了，换成我们自己写的名字、一句诗、一方"对弈"印。点一下屏幕任何地方就跳过。
 *
 * 空中飘的尘土、火星、花瓣、雪画在一张 canvas 上。
 */
import heroFontUrl from './fonts/xq-hero.woff2?url';
import verseFontUrl from './fonts/xq-verse.woff2?url';
import { getVoiceKind, preloadVoice, xqHeroLine } from '../xqvoice';
import { xqSfxHero } from '../xqsfx';
import { xqMusicDuck } from '../xqmusic';

export type HeroId = 'guangong' | 'nezha' | 'daoke' | 'shaoshuai' | 'hongzhuang' | 'ziyi' | 'xuanyi' | 'suyi' | 'moke';

export interface HeroInfo {
  id: HeroId;
  /** 设置页里的名字 */
  label: string;
  /**
   * 开场白：五句，每次出场随机挑一句（不和这位上一次念的那句重复）。和录音 hero-{id}-{第几句} 一字不差——
   * 录音里为了念准换过同音字（车念"居"、将念"匠"……），这里写的是真字
   */
  lines: string[];
  /** 一句话介绍（设置页） */
  desc: string;
  /** 每一句录音多长（秒），整场按它排 */
  voiceSec: number[];
  /** 画铺满屏幕时对齐哪里（object-position）：对着画上的题字那一边 */
  pos: string;
  /** 镜头从哪个样子推到哪个样子（transform），绕哪一点 */
  from: string;
  to: string;
  origin: string;
  /** 空中飘什么 */
  air: Air[];
  /** 亮相一招画在哪（竖版 400×800 的坐标，铺满屏幕），火星从哪迸出来（屏幕的几成） */
  slash: string;
  spark: [number, number];
  /** 画里的太阳：一团光晕（屏幕的几成） */
  flare?: [number, number];
  /** 题字在画的哪一边（"轻触跳过"放到另一边，不压字） */
  side: 'l' | 'r';
  /** 画上的题字裁掉了的（围棋那三张）：屏幕上自己写名字、一句诗（写在 side 那一边） */
  title?: { name: string; verse: string };
}

type Air = 'embers' | 'fire' | 'petals' | 'blossom' | 'motes' | 'dust' | 'snow' | 'leaves';

const PHOTOS = import.meta.glob('./heroimg/*.webp', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const photoUrl = (id: HeroId) => PHOTOS[`./heroimg/${id}.webp`];
/** 这位人物的画（样式页小样用） */
export const heroPhoto = (id: HeroId): string => photoUrl(id);

/** 落子那一下炸开的一圈（圆心就是落子的地方） */
const ring = (x: number, y: number, r: number) => `<circle cx="${x}" cy="${y}" r="${r}" pathLength="1" style="transform-origin:${x}px ${y}px"/>`;

export const HEROES: HeroInfo[] = [
  {
    id: 'guangong',
    side: 'l',
    label: '关公',
    lines: [
      '关某在此！鼠辈，谁敢与我一战！',
      '青龙偃月刀下，从无活口！',
      '过五关，斩六将，岂惧你一盘棋！',
      '吾观你，不过插标卖首之辈！',
      '赤兔追风，取你帅首，易如反掌！',
    ],
    desc: '提刀斩将：骑赤兔马、提青龙偃月刀，古战场上冲锋',
    voiceSec: [3.14, 3.0, 3.35, 3.16, 3.37],
    // 一上来贴得很近（马和刀冲到脸前），拉开到整幅；尘土碎石朝镜头飞过来；刀光顺着偃月刀的刃口划下去
    pos: '50% 0%',
    from: 'scale(1.24) translate(3%, 4%)',
    to: 'scale(1.02)',
    origin: '42% 58%',
    air: ['dust', 'embers'],
    slash: '<path d="M70 410 C60 560 110 690 190 722" pathLength="1"/>',
    spark: [0.3, 0.8],
  },
  {
    id: 'nezha',
    side: 'l',
    label: '哪吒',
    lines: [
      '哪吒在此！火尖枪下，片甲不留！',
      '风火轮起，烧你个满盘皆空！',
      '小爷来也！谁敢接我三枪！',
      '乾坤圈出，管你是帅是将，统统砸烂！',
      '混天绫一卷，你的帅，跑不掉！',
    ],
    desc: '踩风火轮：云海仙山间腾空，混天绫翻飞、火尖枪',
    voiceSec: [3.33, 3.18, 2.94, 3.87, 2.99],
    // 近处拉开到全身；火星往上窜；太阳一团光晕；风火轮上炸开一圈火环
    pos: '50% 0%',
    from: 'scale(1.16) translateY(5%)',
    to: 'scale(1.02) translateY(-1%)',
    origin: '50% 35%',
    air: ['fire', 'motes'],
    slash: ring(218, 700, 60),
    spark: [0.56, 0.83],
    flare: [0.63, 0.13],
  },
  {
    id: 'daoke',
    side: 'l',
    label: '斗笠刀客',
    lines: [
      '刀已出鞘，不见血，不回鞘！',
      '一人一刀，斩尽这一局！',
      '江湖路远，你的帅，今日留下！',
      '我的刀，只问输赢，不问生死！',
      '落子如刀，一步，便是一命！',
    ],
    desc: '江湖一人一刀：云海孤峰，斗笠长刀，衣袍猎猎',
    voiceSec: [3.16, 2.8, 3.32, 3.08, 2.98],
    // 慢慢推近斗笠和左上角的题字"江湖 一人一刀"（绕人物中间推会把字推出屏幕）；雪和落叶横着飘；一道横着的刀光
    pos: '50% 0%',
    from: 'scale(1.01) translateX(-1.5%)',
    to: 'scale(1.13)',
    origin: '40% 6%',
    air: ['snow', 'leaves'],
    slash: '<path d="M-30 500 Q200 455 430 478" pathLength="1"/>',
    spark: [0.62, 0.55],
  },
  {
    id: 'shaoshuai',
    side: 'r',
    label: '少帅',
    lines: [
      '三军听令！过河，斩将，夺帅旗！',
      '擂鼓！列阵！今日踏平你的九宫！',
      '车马炮齐出，一个不留！',
      '兵临城下，降者免死！',
      '我的兵，只进不退！',
    ],
    desc: '运筹帷幄：夕阳下战旗猎猎，黑袍红襟、腰横长剑，按住一枚棋子',
    voiceSec: [3.33, 3.26, 2.88, 2.78, 2.49],
    pos: '74% 0%',
    from: 'scale(1.2) translate(1%, 3%)',
    to: 'scale(1.02)',
    origin: '40% 32%',
    air: ['embers', 'dust'],
    slash: '<path d="M-20 360 C120 420 260 470 430 640" pathLength="1"/>',
    spark: [0.45, 0.62],
  },
  {
    id: 'hongzhuang',
    side: 'l',
    label: '红妆女将',
    lines: [
      '步步为营，步步见血！你的帅，本姑娘要定了！',
      '红妆上阵，不让须眉！接招！',
      '别眨眼！我红妆出手，绝不留情！',
      '哭也没用，这一盘，你输定了！',
      '胭脂是红的，血也是红的！',
    ],
    desc: '步步为营：朱楼红灯下一身红装，红绫翻飞，笑着等你送帅',
    voiceSec: [4.41, 3.25, 3.63, 3.13, 3.13],
    pos: '0% 0%',
    from: 'scale(1.16) translate(-2%, 2%)',
    to: 'scale(1.02)',
    origin: '45% 28%',
    air: ['petals', 'embers'],
    slash: '<path d="M430 250 C300 330 160 300 -20 430" pathLength="1"/>',
    spark: [0.5, 0.42],
  },
  {
    id: 'ziyi',
    side: 'r',
    label: '紫衣炮手',
    lines: [
      '炮已架好！隔山，也取你帅首！',
      '一炮定乾坤，你躲不过！',
      '炮声一响，寸草不生！',
      '隔子打子，专打你的心窝！',
      '点火！送你的帅，上路！',
    ],
    desc: '指尖风云：暮色宫阙、紫衣黑甲，指尖捏着一枚炮',
    voiceSec: [3.13, 2.86, 2.68, 2.8, 2.62],
    pos: '100% 0%',
    from: 'scale(1.22) translate(-2%, 1%)',
    to: 'scale(1.02)',
    origin: '58% 40%',
    air: ['petals', 'motes'],
    slash: ring(170, 333, 46),
    spark: [0.6, 0.4],
  },
  {
    id: 'xuanyi',
    side: 'l',
    label: '玄衣棋客',
    lines: [
      '落子无悔！这一局，我要你满盘皆输！',
      '一子落下，生死已定！',
      '你走的每一步，都在我算中！',
      '黑云压城，这一局，没有活路！',
      '算你十步，杀你一步！',
    ],
    desc: '落子无悔：悬崖古亭、飞瀑松风，一身玄衣，一子按下',
    voiceSec: [3.83, 2.75, 3.23, 3.24, 2.84],
    pos: '50% 0%',
    from: 'scale(1.16) translate(-1%, 2%)',
    to: 'scale(1.02)',
    origin: '50% 30%',
    air: ['leaves', 'motes'],
    slash: ring(222, 650, 54),
    spark: [0.55, 0.78],
    title: { name: '玄衣', verse: '落子无悔' },
  },
  {
    id: 'suyi',
    side: 'l',
    label: '素衣棋仙',
    lines: [
      '莫看我笑！取你性命，只需一手！',
      '花开一季，你的帅，撑不过一盘！',
      '别怕，很快就结束了！',
      '我笑一次，就有人输一次！',
      '梨花落尽，胜负已分！',
    ],
    desc: '自有乾坤：梨花树下、素衣轻纱，支颐一笑，一手定生死',
    voiceSec: [3.29, 3.12, 2.57, 2.71, 2.47],
    pos: '50% 0%',
    from: 'scale(1.18) translate(1%, 2%)',
    to: 'scale(1.02)',
    origin: '52% 32%',
    air: ['blossom', 'motes'],
    slash: ring(342, 615, 50),
    spark: [0.75, 0.72],
    title: { name: '素衣', verse: '自有乾坤' },
  },
  {
    id: 'moke',
    side: 'l',
    label: '白衣墨客',
    lines: [
      '行云流水，杀人不见血。请落子！',
      '一笔一画，皆是杀机！',
      '胜负？我早已写好了！',
      '墨未干，你已败！',
      '风雪千里，只为斩你一局！',
    ],
    desc: '行云流水：雪峰群鹤之间，一身泼墨白衣，抬手便是一局',
    voiceSec: [3.29, 2.71, 2.75, 2.37, 3.02],
    pos: '50% 0%',
    from: 'scale(1.03) translateY(-1%)',
    to: 'scale(1.16)',
    origin: '55% 22%',
    air: ['snow', 'motes'],
    slash: '<path d="M-30 520 Q200 470 430 505" pathLength="1"/>',
    spark: [0.62, 0.62],
    title: { name: '墨客', verse: '行云流水' },
  },
];
export const heroInfo = (id: HeroId) => HEROES.find((h) => h.id === id) ?? HEROES[0];

// ───────────────────────── 设置：演谁 ─────────────────────────

/** 随机（每盘换一位，不和上一盘重复）、指定一位、不演 */
export type HeroPick = HeroId | 'random' | 'off';
const KEY = 'xq-hero';
const LAST = 'xq-hero-last';

/** 选过、现在已经拿掉了的人物（白衣女侠、齐天大圣）读出来按随机 */
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

/** 随机的话，下一盘请谁已经先挑好了（开局设置页一打开就挑，好先把那一幅画、那一句录音拉下来，不用九幅都拉） */
let queued: HeroId | null = null;
function pickRandom(): HeroId {
  let last = '';
  try {
    last = localStorage.getItem(LAST) ?? '';
  } catch {
    /* 没有就随便挑 */
  }
  const pool = HEROES.filter((h) => h.id !== last);
  return pool[Math.floor(Math.random() * pool.length)].id;
}

/**
 * 这一位这一次念第几句（从 0 数）：随机，不和他上一次那句重复。
 * 开局设置页就先挑好（preloadHero），好先把那一句录音拉下来；真演的时候（takeLine）取走、记下
 */
const queuedLine = new Map<HeroId, number>();
const LINE_LAST = 'xq-hero-line';
function lastLines(): Record<string, number> {
  try {
    const m = JSON.parse(localStorage.getItem(LINE_LAST) ?? '{}');
    return m && typeof m === 'object' ? m : {};
  } catch {
    return {};
  }
}
function pickLine(id: HeroId): number {
  const last = lastLines()[id];
  const pool = heroInfo(id)
    .lines.map((_, i) => i)
    .filter((i) => i !== last);
  return pool[Math.floor(Math.random() * pool.length)];
}
function takeLine(id: HeroId): number {
  const i = queuedLine.get(id) ?? pickLine(id);
  queuedLine.delete(id);
  try {
    localStorage.setItem(LINE_LAST, JSON.stringify({ ...lastLines(), [id]: i }));
  } catch {
    /* 记不下就可能和上一次同一句，不要紧 */
  }
  return i;
}

/** 这一盘请谁出场（关掉了返回 null） */
export function nextHero(): HeroId | null {
  const pick = getHeroPick();
  if (pick === 'off') return null;
  if (pick !== 'random') return pick;
  const id = queued ?? pickRandom();
  queued = null;
  try {
    localStorage.setItem(LAST, id);
  } catch {
    /* 记不下就可能和上一盘重复，不要紧 */
  }
  return id;
}

// ───────────────────────── 字体、录音 ─────────────────────────

let fonts: Promise<void> | null = null;
/** 字幕、名字用马善政毛笔楷书，诗句用志莽行书（都只截了出场要用的几十个字） */
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

/** 提前把字体拉下来（开局设置页就调）；这一盘要演的那一位（随机就先挑好），把他的画和录音也拉下来 */
export function preloadHero() {
  void loadFonts();
  const pick = getHeroPick();
  if (pick === 'off') return;
  const id = pick === 'random' ? (queued ??= pickRandom()) : pick;
  if (!queuedLine.has(id)) queuedLine.set(id, pickLine(id));
  preloadVoice([`hero-${id}-${queuedLine.get(id)! + 1}`]);
  // 那一幅画（一两百 KB）：先拉下来，出场时墨一洇开就是画，不会先黑一下
  const img = new Image();
  img.decoding = 'async';
  img.src = photoUrl(id);
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

/** 烈焰燃开的遮罩：下半截不透明、上沿是一排火舌（湍流推歪），从屏幕底下烧上去 */
const FLAME = (() => {
  const r = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const rnd = r(29);
  let d = 'M0 220V108';
  for (let x = 0; x < 100; ) {
    const w = 5 + rnd() * 9;
    const tip = 82 + rnd() * 20;
    d += `Q${(x + w * 0.3).toFixed(1)} ${(tip + 10).toFixed(1)} ${(x + w * 0.5).toFixed(1)} ${tip.toFixed(1)}Q${(x + w * 0.7).toFixed(1)} ${(tip + 12).toFixed(1)} ${(x + w).toFixed(1)} 108`;
    x += w;
  }
  d += 'V220Z';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 220" preserveAspectRatio="none"><filter id="f" x="-10%" y="-10%" width="120%" height="120%">` +
    `<feTurbulence type="fractalNoise" baseFrequency=".09 .05" numOctaves="2" seed="4"/><feDisplacementMap in="SourceGraphic" scale="7"/></filter>` +
    `<path filter="url(#f)" d="${d}" fill="#000"/></svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
})();

// ───────────────────────── 开场：画怎么露出来（每次随机一种） ─────────────────────────

/**
 * 墨滴洇开（原来那一种）、刀光裂屏（一道刀光斜着劈开黑幕，两半各自飞开）、烈焰燃开（黑幕从底下烧上去，火舌一路舔上来）、
 * 金门洞开（两扇朱漆金钉的大门往两边推开，门缝里先漏出一道金光）、雷霆一击（黑里一道闪电，一闪一闪地把画照出来）、
 * 卷轴展开（两根卷轴从中间往两边滚开，画一点点露出来）。
 * 都在一秒左右露全，亮相一招（1.15 秒那一刀）照旧
 */
export type Reveal = 'ink' | 'blade' | 'fire' | 'gate' | 'thunder' | 'scroll';
export const REVEALS: Reveal[] = ['ink', 'blade', 'fire', 'gate', 'thunder', 'scroll'];
const REVEAL_LAST = 'xq-hero-reveal';
function pickReveal(): Reveal {
  let last = '';
  try {
    last = localStorage.getItem(REVEAL_LAST) ?? '';
  } catch {
    /* 没有就随便挑 */
  }
  const pool = REVEALS.filter((r) => r !== last);
  const r = pool[Math.floor(Math.random() * pool.length)];
  try {
    localStorage.setItem(REVEAL_LAST, r);
  } catch {
    /* 记不下就可能和上一次一样，不要紧 */
  }
  return r;
}

/** 一道闪电：从上往下折几折，中途分一叉 */
function bolt(): string {
  let x = 210 + (Math.random() - 0.5) * 80;
  let y = -20;
  let d = `M${x.toFixed(0)} ${y}`;
  let fork = '';
  while (y < 820) {
    x += (Math.random() - 0.5) * 90;
    y += 40 + Math.random() * 60;
    d += `L${x.toFixed(0)} ${y.toFixed(0)}`;
    if (!fork && y > 260) {
      let fx = x;
      let fy = y;
      fork = `M${fx.toFixed(0)} ${fy.toFixed(0)}`;
      for (let k = 0; k < 4; k++) {
        fx += 20 + Math.random() * 40;
        fy += 30 + Math.random() * 40;
        fork += `L${fx.toFixed(0)} ${fy.toFixed(0)}`;
      }
    }
  }
  return `<path d="${d}"/><path class="fk" d="${fork}"/>`;
}

/** 各种开场要叠在画上面的那一层 */
function revealLayer(rv: Reveal): string {
  switch (rv) {
    case 'blade':
      return `<div class="xqh-rv xqh-rv-blade"><div class="h a"></div><div class="h b"></div><svg viewBox="0 0 100 100" preserveAspectRatio="none"><line x1="-5" y1="64" x2="105" y2="36" pathLength="1"/></svg><div class="fl"></div></div>`;
    case 'fire':
      return `<div class="xqh-rv xqh-rv-fire"><div class="burn"></div></div>`;
    case 'gate':
      return `<div class="xqh-rv xqh-rv-gate"><div class="door l"><i></i></div><div class="door r"><i></i></div><div class="beam"></div></div>`;
    case 'thunder':
      return `<div class="xqh-rv xqh-rv-thunder"><div class="cv"></div><svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">${bolt()}</svg><div class="fl"></div></div>`;
    case 'scroll':
      return `<div class="xqh-rv xqh-rv-scroll"><div class="rod l"></div><div class="rod r"></div></div>`;
    default:
      return '';
  }
}

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
    case 'blossom':
      m.vy = (40 + rnd() * 50) * s;
      m.vx = (30 + rnd() * 40) * s;
      m.r = (3 + rnd() * 2.6) * s;
      m.a = 0.75 + rnd() * 0.25;
      m.hue = k === 'blossom' ? 48 : rnd() < 0.7 ? 352 : 340;
      if (!anywhere) {
        m.y = -10;
        m.x = rnd() * w * 1.2 - w * 0.4;
      }
      break;
    case 'motes':
      m.vy = -(6 + rnd() * 22) * s;
      m.vx = (rnd() - 0.5) * 14 * s;
      m.r = (0.7 + rnd() * rnd() * 3.2) * s;
      m.a = 0.35 + rnd() * 0.6;
      m.hue = 42 + rnd() * 10;
      break;
    case 'dust': {
      // 战场上的尘土碎石：从画面中下部往四面飞、越飞越大（冲着镜头来）
      m.x = w * (0.3 + rnd() * 0.4);
      m.y = h * (0.55 + rnd() * 0.3);
      const a = Math.atan2(m.y - h * 0.5, m.x - w * 0.5) + (rnd() - 0.5) * 0.9;
      const v = (60 + rnd() * 160) * s;
      m.vx = Math.cos(a) * v;
      m.vy = Math.sin(a) * v - 20 * s;
      m.r = (0.8 + rnd() * 2.2) * s;
      m.a = 0.35 + rnd() * 0.45;
      m.hue = 22 + rnd() * 16;
      if (anywhere) {
        m.x = rnd() * w;
        m.y = rnd() * h;
      }
      break;
    }
    case 'snow':
      // 山风吹雪：横着往右飘、慢慢往下
      m.vx = (50 + rnd() * 90) * s;
      m.vy = (18 + rnd() * 40) * s;
      m.r = (0.6 + rnd() * rnd() * 2.6) * s;
      m.a = 0.35 + rnd() * 0.5;
      if (!anywhere) {
        m.x = -10;
        m.y = rnd() * h;
      }
      break;
    case 'leaves':
      // 落叶：比花瓣大、翻着跟头被风卷过去
      m.vx = (80 + rnd() * 90) * s;
      m.vy = (20 + rnd() * 40) * s;
      m.r = (3.5 + rnd() * 3) * s;
      m.a = 0.7 + rnd() * 0.3;
      m.hue = 70 + rnd() * 40;
      if (!anywhere) {
        m.x = -20;
        m.y = rnd() * h * 0.8;
      }
      break;
  }
  return m;
}

const COUNT: Record<Air, number> = { embers: 55, fire: 80, petals: 34, blossom: 30, motes: 70, dust: 70, snow: 110, leaves: 14 };

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
      if (m.k === 'dust') {
        g.globalCompositeOperation = 'source-over';
        m.r *= 1 + dt * 0.9;
        g.fillStyle = `hsla(${m.hue},45%,${38 + m.a * 20}%,${m.a * fade})`;
        g.beginPath();
        g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        g.fill();
      } else if (m.k === 'snow') {
        g.globalCompositeOperation = 'source-over';
        m.y += Math.sin(m.ph) * 10 * dt;
        g.fillStyle = `rgba(245,248,252,${m.a * fade})`;
        g.beginPath();
        g.arc(m.x, m.y, m.r, 0, Math.PI * 2);
        g.fill();
      } else if (m.k === 'petals' || m.k === 'blossom' || m.k === 'leaves') {
        g.globalCompositeOperation = 'source-over';
        m.x += Math.sin(m.ph) * 12 * dt;
        g.save();
        g.translate(m.x, m.y);
        g.rotate(m.ph * m.spin * 0.3);
        g.scale(1, 0.55 + 0.45 * Math.sin(m.ph * 1.7));
        g.fillStyle =
          m.k === 'leaves'
            ? `hsla(${m.hue},35%,30%,${m.a * fade})`
            : m.k === 'blossom'
              ? `hsla(${m.hue},70%,95%,${m.a * fade})`
              : `hsla(${m.hue},70%,${m.hue === 352 ? 56 : 80}%,${m.a * fade})`;
        g.beginPath();
        g.ellipse(0, 0, m.r, m.r * 0.62, 0, 0, Math.PI * 2);
        g.fill();
        g.restore();
      } else {
        g.globalCompositeOperation = 'lighter';
        const tw = m.k === 'motes' ? 0.55 + 0.45 * Math.sin(m.ph * 1.6) : 1;
        m.x += Math.sin(m.ph) * 8 * dt;
        g.fillStyle = `hsla(${m.hue},100%,62%,${0.16 * m.a * tw * fade})`;
        g.beginPath();
        g.arc(m.x, m.y, m.r * 3.4, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = `hsla(${m.hue},100%,80%,${m.a * tw * fade})`;
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
 * 名字背后那一笔：起笔重、往下收细、末尾一甩，下半截有几道飞白（干笔刷开的丝），旁边溅几点墨。
 * 毛边是湍流推出来的；从上往下刷出来（CSS 里 clip-path 一点点放开）。只有自己写名字的那三位用
 */
const BRUSH =
  `<svg class="xqh-stroke" viewBox="0 0 100 300" preserveAspectRatio="none">` +
  `<filter id="xqh-sf" x="-25%" y="-10%" width="150%" height="120%"><feTurbulence type="fractalNoise" baseFrequency=".08 .018" numOctaves="3" seed="5"/><feDisplacementMap in="SourceGraphic" scale="12"/></filter>` +
  `<mask id="xqh-sm" maskUnits="userSpaceOnUse" x="0" y="0" width="100" height="300"><rect width="100" height="300" fill="#fff"/>` +
  `<path d="M38 170 C40 220 41 260 44 300 M47 196 C48 236 50 270 51 300 M57 160 C58 210 60 250 61 300 M66 188 C66 226 64 262 62 300" stroke="#000" stroke-width="2.6" fill="none"/></mask>` +
  `<g filter="url(#xqh-sf)" mask="url(#xqh-sm)">` +
  `<path d="M52 4 C80 6 93 26 86 54 C82 92 80 150 76 200 C73 240 66 270 58 296 L54 300 C44 272 34 236 30 196 C26 150 24 100 22 62 C18 30 30 4 52 4 Z"/>` +
  `<circle cx="88" cy="36" r="4"/><circle cx="14" cy="88" r="2.5"/><circle cx="82" cy="252" r="2"/><circle cx="20" cy="210" r="1.6"/></g></svg>`;

/** 字幕按分句包起来：太长要折行时只在标点后面折（不把"性命"拆成两行） */
const clauses = (line: string) =>
  line
    .split(/(?<=[，！。？])/)
    .map((c) => `<i>${c}</i>`)
    .join('');

/** 亮相一招迸出来的火星什么颜色（色相） */
const SPARK_HUE: Record<HeroId, number> = { guangong: 30, nezha: 22, daoke: 40, shaoshuai: 18, hongzhuang: 8, ziyi: 280, xuanyi: 42, suyi: 200, moke: 210 };

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
export function playHeroIntro(
  id: HeroId,
  host: HTMLElement = document.body,
  opts: { hold?: boolean; vs?: string; line?: number; reveal?: Reveal } = {},
): Promise<void> {
  current?.end();
  const h = heroInfo(id);
  void loadFonts();
  const voiced = getVoiceKind() !== 'off';
  // 念哪一句：随机（不和上一次重复）；调试、截图可以指定
  const li = opts.line ?? takeLine(id);
  // 整场多长：喊完再留一点余韵；不配音就短一点
  const total = Math.round(voiced ? Math.max(3600, 800 + h.voiceSec[li] * 1000 + 150) : 3500);
  const outMs = 650;

  const root = document.createElement('div');
  root.className = `xqh xqh-${id} xqh-side-${h.side}`;
  root.dataset.hero = id;
  root.dataset.line = String(li + 1);
  // 画怎么露出来：随机一种（不和上一次一样）
  const rv = opts.reveal ?? pickReveal();
  root.dataset.rv = rv;
  root.style.setProperty('--T', `${total}ms`);
  root.style.setProperty('--pos', h.pos);
  root.style.setProperty('--kb-from', h.from);
  root.style.setProperty('--kb-to', h.to);
  root.style.setProperty('--kb-origin', h.origin);
  // 整幅的画：铺满屏幕、镜头推拉；上面一道斜着扫过的流光、画里太阳的光晕、空中飘的东西、上下压暗
  const title = h.title
    ? `<div class="xqh-title">
      <div class="xqh-namebox">${BRUSH}<div class="xqh-name">${h.title.name}</div></div>
      <div class="xqh-side"><div class="xqh-verse">${h.title.verse}</div><div class="xqh-seal"><span>对</span><span>弈</span></div></div>
    </div>`
    : '';
  root.innerHTML = `<div class="xqh-dark"></div>
    <div class="xqh-scene">
      <div class="xqh-pic"><img src="${photoUrl(id)}" alt="" decoding="async"></div>
      ${h.flare ? `<div class="xqh-flare" style="left:${h.flare[0] * 100}%;top:${h.flare[1] * 100}%"></div>` : ''}
      <div class="xqh-sheen"></div>
      <canvas class="xqh-air"></canvas>
      <div class="xqh-vign"></div>
    </div>
    ${revealLayer(rv)}
    <svg class="xqh-slash" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice">${h.slash}</svg>
    <div class="xqh-flash"></div>
    ${title}
    <div class="xqh-line"><span>${clauses(h.lines[li])}</span></div>
    ${opts.vs ? `<div class="xqh-vs">对阵 · ${opts.vs}</div>` : ''}
    <div class="xqh-skip">轻触跳过</div>`;
  const masks: [string, string][] = rv === 'ink' ? [['.xqh-dark', BLOT], ['.xqh-scene', BLOT]] : rv === 'fire' ? [['.xqh-scene', FLAME]] : [];
  for (const [sel, m] of masks) {
    const el = root.querySelector(sel) as HTMLElement;
    el.style.setProperty('-webkit-mask-image', m);
    el.style.setProperty('mask-image', m);
  }
  host.appendChild(root);
  // 洇开之后遮罩就没用了，撤掉省得每一帧都要算
  const scene = root.querySelector('.xqh-scene') as HTMLElement;
  scene.addEventListener('animationend', (e) => {
    if (e.target === scene && (e.animationName === 'xqh-bloom' || e.animationName === 'xqh-burn')) {
      scene.style.setProperty('-webkit-mask-image', 'none');
      scene.style.setProperty('mask-image', 'none');
    }
  });
  const air = runAir(root.querySelector('.xqh-air') as HTMLCanvasElement, h.air, total);
  const stopAir = air.stop;
  // 亮相一招劈下去那一下，从刀光上（落子的地方）迸一把火星
  const sparkTimer = window.setTimeout(() => air.burst(window.innerWidth * h.spark[0], window.innerHeight * h.spark[1], 60, SPARK_HUE[id]), 1250);

  xqSfxHero(id);
  if (voiced) xqHeroLine(id, li + 1, 800);
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
