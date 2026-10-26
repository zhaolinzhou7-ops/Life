/**
 * 棋盘、棋子的样式：八种棋盘、八种棋子、五种字体，再配成九套现成的搭配。
 *
 * 用户原话："最大限度增加棋盘，棋子的美化效果，增加可以选择的样式。"
 *
 * 原来只有一种样子：渐变木色底 + 七十条随手画的细线当木纹，棋子是一个渐变圆 + 一圈线 + 系统楷体。
 * 隔着手机屏幕看像矢量插画，不像实物。实物的质感来自三样东西，这里每样都做：
 *
 *   1. **材质纹理**：木纹（年轮 + 顺纹纤维）、竹排（竹节、竹缝）、宣纸（纤维、洇痕）、玉（絮状云纹）、
 *      大理石（石筋）、青铜（同心车纹 + 铜锈）……都是按像素算出来的（值噪声叠几层），不是贴图——
 *      不占下载、换尺寸也不会糊；
 *   2. **统一的光**：全场光从左上来。棋盘有清漆的反光和四角暗角，边框有倒角；棋子有厚度（底下露出一圈侧边）、
 *      凸起的边沿（左上亮、右下暗）、刻进去的字（阴刻：左上暗、右下亮），漆器、瓷器、玉还有高光；
 *   3. **字**：五种字体里四种是随包带的（霞鹜文楷、马善政毛笔楷书、志莽行书、站酷小薇，都是 OFL 开源字体，
 *      只截了棋子和"楚河汉界"那二十几个字，每个几 KB），换到哪台手机上都是同一个样子；
 *      原来写的是"楷体"，可安卓手机上没有楷体，落回黑体，棋子就没了味道。
 *
 * **认得清排在好看前面**（board2d 原来的那条规矩不变）：字外面照样先用棋面色描一圈隔离带；
 * 红黑两方除了字色，在玉、漆器、青铜这几套里棋面本身也不同色（白玉对墨玉、朱漆对黑漆），一眼分得出敌我；
 * 深色棋盘上"可走点"换成亮色，不会和盘面混在一起。
 *
 * 样式存在 localStorage（xq-look），改了以后所有正开着的棋盘当场重画（onLook）。
 */
import type { Color, PType } from './rules';
import wenkaiUrl from './fonts/xq-wenkai.woff2?url';
import mashanUrl from './fonts/xq-mashan.woff2?url';
import xingshuUrl from './fonts/xq-xingshu.woff2?url';
import xiaoweiUrl from './fonts/xq-xiaowei.woff2?url';

export type BoardId =
  | 'wood'
  | 'rosewood'
  | 'bamboo'
  | 'paper'
  | 'jade'
  | 'marble'
  | 'night'
  | 'inkland'
  | 'goldlac'
  | 'qinglv'
  | 'dunhuang'
  | 'nanmu'
  | 'duanyan'
  | 'ruyao'
  | 'plain';
export type PieceId = 'ivory' | 'boxwood' | 'jade' | 'bronze' | 'porcelain' | 'lacquer' | 'ink' | 'zitan' | 'ruyao' | 'jianzhan' | 'agate' | 'flat';
export type FontId = 'wenkai' | 'mashan' | 'xingshu' | 'xiaowei' | 'hei';

export interface Look {
  board: BoardId;
  piece: PieceId;
  font: FontId;
  /** 繁体字（帥將、馬車）。字体没有繁体字就不管这一项 */
  trad: boolean;
}

// ───────────────────────── 字体 ─────────────────────────

export interface FontDef {
  id: FontId;
  name: string;
  desc: string;
  /** canvas 用的 font-family（随包的字体在最前，后面是落空时的系统字） */
  family: string;
  /** 随包带的字体文件 */
  face?: { family: string; url: string; weight: string };
  weight: number;
  /** 不同字体的字面大小不一样：按这个倍数调到看着一样大 */
  scale: number;
  /** 竖直方向的微调（字号的几分之几，正数往下） */
  dy: number;
  /** 有没有繁体字（帥將馬車漢） */
  trad: boolean;
  /** 有没有"砲"字：没有的话黑炮也写"炮" */
  pao: boolean;
}

export const FONTS: FontDef[] = [
  {
    id: 'wenkai',
    name: '文楷',
    desc: '霞鹜文楷：端正清楚的楷书，简体繁体都有',
    face: { family: 'XQ WenKai', url: wenkaiUrl, weight: '700' },
    family: '"XQ WenKai","STKaiti","KaiTi","Songti SC",serif',
    weight: 700,
    scale: 1,
    dy: 0.04,
    trad: true,
    pao: true,
  },
  {
    id: 'mashan',
    name: '毛笔',
    desc: '马善政毛笔楷书：笔锋重，像手写上去的',
    face: { family: 'XQ MaShan', url: mashanUrl, weight: '400' },
    family: '"XQ MaShan","XQ WenKai","STKaiti","KaiTi",serif',
    weight: 400,
    scale: 1.06,
    dy: 0.03,
    trad: false,
    pao: false,
  },
  {
    id: 'xingshu',
    name: '行书',
    desc: '志莽行书：笔意连绵，书法味最浓（字形活，认字稍慢一点）',
    face: { family: 'XQ XingShu', url: xingshuUrl, weight: '400' },
    family: '"XQ XingShu","XQ WenKai","STKaiti","KaiTi",serif',
    weight: 400,
    scale: 1.1,
    dy: 0.02,
    trad: false,
    pao: false,
  },
  {
    id: 'xiaowei',
    name: '雅宋',
    desc: '站酷小薇：清秀的宋体',
    face: { family: 'XQ XiaoWei', url: xiaoweiUrl, weight: '400' },
    family: '"XQ XiaoWei","Songti SC","SimSun",serif',
    weight: 400,
    scale: 1.04,
    dy: 0.03,
    trad: false,
    pao: false,
  },
  {
    id: 'hei',
    name: '黑体',
    desc: '系统黑体加粗：笔画最粗最清楚，看不清的时候用',
    family: '"PingFang SC","Microsoft YaHei","Noto Sans SC","Noto Sans CJK SC",system-ui,sans-serif',
    weight: 700,
    scale: 0.9,
    dy: 0.04,
    trad: true,
    pao: true,
  },
];

const fontDef = (id: FontId) => FONTS.find((f) => f.id === id) ?? FONTS[0];
export const fontOf = (look: Look) => fontDef(look.font);

const fontLoads = new Map<FontId, Promise<void>>();
/** 用到某个随包字体时才加载（几 KB）；加载完所有棋盘重画一遍 */
export function ensureFont(id: FontId): Promise<void> {
  const f = fontDef(id);
  const had = fontLoads.get(f.id);
  if (had) return had;
  let p: Promise<void> = Promise.resolve();
  if (f.face && typeof FontFace !== 'undefined' && typeof document !== 'undefined') {
    const face = new FontFace(f.face.family, `url(${f.face.url}) format("woff2")`, { weight: f.face.weight });
    p = face
      .load()
      .then((x) => {
        document.fonts.add(x);
        bump();
      })
      .catch(() => {
        /* 字体没加载下来就用后面的系统字，棋照下 */
      });
  }
  fontLoads.set(f.id, p);
  return p;
}

const SIMP: Record<PType, [string, string]> = {
  K: ['帅', '将'],
  A: ['仕', '士'],
  E: ['相', '象'],
  H: ['马', '马'],
  R: ['车', '车'],
  C: ['炮', '砲'],
  P: ['兵', '卒'],
};
/** 繁体：实物棋子多是帥將、馬車；红方"俥傌"这两个字随包的字体里没有，用馬車（很多老棋子也是这样刻的） */
const TRAD: Record<PType, [string, string]> = {
  K: ['帥', '將'],
  A: ['仕', '士'],
  E: ['相', '象'],
  H: ['馬', '馬'],
  R: ['車', '車'],
  C: ['炮', '砲'],
  P: ['兵', '卒'],
};

/** 棋子上写什么字 */
export function glyph(t: PType, c: Color, look: Look = getLook()): string {
  const f = fontOf(look);
  const s = (look.trad && f.trad ? TRAD : SIMP)[t][c === 'r' ? 0 : 1];
  return s === '砲' && !f.pao ? '炮' : s;
}

/** 河界上的四个字 */
export function riverText(look: Look = getLook()): [string, string] {
  return ['楚　河', fontOf(look).trad ? '漢　界' : '汉　界'];
}

// ───────────────────────── 存档 / 通知 ─────────────────────────

const KEY = 'xq-look';
export const DEFAULT_LOOK: Look = { board: 'wood', piece: 'ivory', font: 'wenkai', trad: false };
let cur: Look | null = null;
const subs = new Set<() => void>();
let version = 0;

export function getLook(): Look {
  if (cur) return cur;
  let v: Partial<Look> = {};
  try {
    v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Look>;
  } catch {
    /* 读不出来就用默认 */
  }
  cur = {
    board: BOARDS.some((b) => b.id === v.board) ? v.board! : DEFAULT_LOOK.board,
    piece: PIECES.some((p) => p.id === v.piece) ? v.piece! : DEFAULT_LOOK.piece,
    font: FONTS.some((f) => f.id === v.font) ? v.font! : DEFAULT_LOOK.font,
    trad: v.trad === true,
  };
  void ensureFont(cur.font);
  return cur;
}

export function setLook(p: Partial<Look>): Look {
  cur = { ...getLook(), ...p };
  try {
    localStorage.setItem(KEY, JSON.stringify(cur));
  } catch {
    /* 存不下也照样换，只是下次打开回到默认 */
  }
  void ensureFont(cur.font);
  bump();
  return cur;
}

/** 样式变了（换样式、字体加载完）就叫一声；返回取消订阅 */
export function onLook(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
export const lookVersion = () => version;

function bump() {
  // 纹理按样式和尺寸存，换一套照样能用，不清（原来每点一下都清，样式页上几十张小样全部重算）
  version++;
  for (const f of [...subs]) f();
}

/** 现成的搭配 */
export const PRESETS: { id: string; name: string; desc: string; look: Look }[] = [
  { id: 'classic', name: '经典木盘', desc: '榉木棋盘、象牙棋子、楷书', look: { board: 'wood', piece: 'ivory', font: 'wenkai', trad: false } },
  { id: 'hongmu', name: '红木象牙', desc: '红木描金棋盘、象牙棋子、繁体字', look: { board: 'rosewood', piece: 'ivory', font: 'wenkai', trad: true } },
  { id: 'bamboo', name: '竹林清风', desc: '竹排棋盘、黄杨木刻棋子、毛笔字', look: { board: 'bamboo', piece: 'boxwood', font: 'mashan', trad: false } },
  { id: 'qipu', name: '宣纸棋谱', desc: '宣纸墨线、印章式棋子、毛笔字，像翻一本老棋谱', look: { board: 'paper', piece: 'ink', font: 'mashan', trad: false } },
  { id: 'jade', name: '翡翠玉局', desc: '碧玉棋盘、白玉对墨玉', look: { board: 'jade', piece: 'jade', font: 'wenkai', trad: true } },
  { id: 'qinghua', name: '青花汉白玉', desc: '汉白玉棋盘、青花瓷棋子、宋体字', look: { board: 'marble', piece: 'porcelain', font: 'xiaowei', trad: false } },
  { id: 'lacquer', name: '朱漆夜宴', desc: '玄漆描金棋盘、朱漆对黑漆、金字', look: { board: 'night', piece: 'lacquer', font: 'wenkai', trad: true } },
  { id: 'bronze', name: '青铜古韵', desc: '红木棋盘、青铜棋子、毛笔字', look: { board: 'rosewood', piece: 'bronze', font: 'mashan', trad: false } },
  // 典藏：带画、带动效
  { id: 'shanhe', name: '✨ 水墨山河', desc: '洒金宣纸、河里一幅水墨山水、印章式棋子；流光和河水会动', look: { board: 'inkland', piece: 'ink', font: 'mashan', trad: false } },
  { id: 'liujin', name: '✨ 鎏金玄漆', desc: '黑漆洒金、祥云、朱漆对黑漆、金字；金光隔几秒扫一遍', look: { board: 'goldlac', piece: 'lacquer', font: 'wenkai', trad: true } },
  { id: 'jinbi', name: '✨ 金碧青绿', desc: '绢本青绿山水、金线勾边、青花瓷棋子', look: { board: 'qinglv', piece: 'porcelain', font: 'xiaowei', trad: false } },
  // 典藏里水墨以外的一套：壁画。星河夜弈、霓虹赛博、烽火沙场（发光的格线、满盘闪的星、飞的火星）太晃眼，拿掉了
  { id: 'dunhuang', name: '✨ 敦煌飞天', desc: '土墙壁画、石绿石青、河里飘带和莲花、朱漆棋子；花瓣往下飘', look: { board: 'dunhuang', piece: 'lacquer', font: 'mashan', trad: false } },
  // 耐看的四套：真材料，不发光、不会动
  { id: 'nanmuset', name: '金丝楠 · 紫檀', desc: '金丝楠木棋盘，黄花梨对紫檀的棋子，朱砂字对描金字', look: { board: 'nanmu', piece: 'zitan', font: 'wenkai', trad: true } },
  { id: 'songyun', name: '宋韵茶席', desc: '汝窑开片的天青棋盘，柿红对兔毫的建盏棋子，宋体字', look: { board: 'ruyao', piece: 'jianzhan', font: 'xiaowei', trad: false } },
  { id: 'yantai', name: '端砚天青', desc: '端溪砚石棋盘（石眼、蕉叶白），汝窑天青棋子，毛笔字', look: { board: 'duanyan', piece: 'ruyao', font: 'mashan', trad: false } },
  { id: 'nanhong', name: '南红汉白玉', desc: '汉白玉棋盘，南红玛瑙对墨玛瑙的棋子', look: { board: 'marble', piece: 'agate', font: 'wenkai', trad: true } },
  { id: 'clear', name: '清晰护眼', desc: '素色棋盘、扁平棋子、粗黑体：最好认', look: { board: 'plain', piece: 'flat', font: 'hei', trad: false } },
];

/** 现在的样式正好是哪一套搭配（自己搭的返回 null） */
export function presetOf(look: Look = getLook()): (typeof PRESETS)[number] | null {
  return PRESETS.find((p) => p.look.board === look.board && p.look.piece === look.piece && p.look.font === look.font && p.look.trad === look.trad) ?? null;
}

// ───────────────────────── 噪声 ─────────────────────────

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 值噪声：格点上放随机数，中间平滑插值。结果 0～1 */
function makeNoise(seed: number) {
  const rnd = mulberry32(seed);
  const perm = new Uint8Array(512);
  const base = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [base[i], base[j]] = [base[j], base[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = base[i & 255];
  const val = new Float32Array(256);
  for (let i = 0; i < 256; i++) val[i] = rnd();
  const at = (x: number, y: number) => val[perm[(perm[x & 255] + (y & 255)) & 511]];
  return (x: number, y: number) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = at(xi, yi);
    const b = at(xi + 1, yi);
    const c = at(xi, yi + 1);
    const d = at(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** 分形噪声：几层叠加，越细的层越淡。结果大致 0～1 */
function fbm(n: (x: number, y: number) => number, x: number, y: number, oct = 4): number {
  let s = 0;
  let amp = 0.5;
  let norm = 0;
  // 每一层转一个角度再叠：值噪声的格子是横平竖直的，不转的话看得出一块块方格
  let px = x;
  let py = y;
  for (let i = 0; i < oct; i++) {
    s += amp * n(px, py);
    norm += amp;
    amp *= 0.5;
    const nx = (px * ROT_C - py * ROT_S) * 2.03 + 17.3;
    py = (px * ROT_S + py * ROT_C) * 2.03 + 5.1;
    px = nx;
  }
  return s / norm;
}
const ROT_C = Math.cos(0.62);
const ROT_S = Math.sin(0.62);

/**
 * 细胞噪声：平面上撒一把点，回到最近的点、第二近的点各多远。两者差得很小的地方就是两块的交界——
 * 瓷釉的开片（冰裂纹）就这么画：f2 − f1 接近 0 处画一道细线
 */
function makeWorley(seed: number) {
  const rnd = mulberry32(seed);
  const pts = new Float32Array(512);
  for (let i = 0; i < 512; i++) pts[i] = rnd();
  return (x: number, y: number): [number, number] => {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    let f1 = 9;
    let f2 = 9;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const h = (Math.imul(ix + dx, 73856093) ^ Math.imul(iy + dy, 19349663)) & 255;
        const d = Math.hypot(x - (ix + dx + pts[h * 2]), y - (iy + dy + pts[h * 2 + 1]));
        if (d < f1) {
          f2 = f1;
          f1 = d;
        } else if (d < f2) f2 = d;
      }
    }
    return [f1, f2];
  };
}
let worleys: ((x: number, y: number) => [number, number])[] | null = null;
const worley = (i: number) => (worleys ??= [makeWorley(97), makeWorley(5303), makeWorley(811)])[i];
/** 开片：大片、小片两层裂纹，坐标先扭一扭（裂纹不是规规矩矩的多边形）。回 [大片, 小片] 的线有多浓（0～1） */
function crackle(n: (x: number, y: number) => number, u: number, v: number, scale: number): [number, number] {
  const wx = u * scale + (fbm(n, u * scale * 0.9, v * scale * 0.9, 3) - 0.5) * 1.1;
  const wy = v * scale + (fbm(n, u * scale * 0.9 + 7, v * scale * 0.9, 3) - 0.5) * 1.1;
  const [a1, a2] = worley(0)(wx, wy);
  const [b1, b2] = worley(1)(wx * 2.4 + 3.1, wy * 2.4 + 1.7);
  return [1 - smooth(0, 0.045, a2 - a1), 1 - smooth(0, 0.035, b2 - b1)];
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
type RGB = [number, number, number];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * 纹理缓存：满了只扔最久没用的那几张（Map 按放进去的先后排，用到一次就挪到最后）。
 * 原来是满 80 张整个清空——样式页一屏小样就有五六十张（十五种棋盘、十二种棋子各两面），
 * 一满就全部重算，点一下卡好几秒
 */
const texCache = new Map<string, HTMLCanvasElement>();
const TEX_MAX = 140;
function cached(key: string, make: () => HTMLCanvasElement): HTMLCanvasElement {
  const hit = texCache.get(key);
  if (hit) {
    texCache.delete(key);
    texCache.set(key, hit);
    return hit;
  }
  const cv = make();
  texCache.set(key, cv);
  for (const k of texCache.keys()) {
    if (texCache.size <= TEX_MAX) break;
    texCache.delete(k);
  }
  return cv;
}

/**
 * 按像素算一张图：fn 收到"格"为单位的坐标（u, v，和棋盘格子一样大，尺寸变了纹理跟着缩放），回一个颜色和不透明度。
 * w、h 是 CSS 像素，res 是每个 CSS 像素算几个点。
 */
function paintPixels(w: number, h: number, res: number, cellPx: number, fn: (u: number, v: number) => [number, number, number, number]): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const W = Math.max(1, Math.round(w * res));
  const H = Math.max(1, Math.round(h * res));
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  const d = img.data;
  const k = 1 / (res * cellPx);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const [r, gg, b, a] = fn(x * k, y * k);
      const i = (y * W + x) * 4;
      d[i] = r;
      d[i + 1] = gg;
      d[i + 2] = b;
      d[i + 3] = a;
    }
  }
  g.putImageData(img, 0, 0);
  return cv;
}

// ───────────────────────── 棋盘 ─────────────────────────

export interface BoardStyle {
  id: BoardId;
  name: string;
  desc: string;
  /** 材质：u、v 以格为单位，回颜色 */
  surface: (n1: (x: number, y: number) => number, n2: (x: number, y: number) => number, u: number, v: number) => RGB;
  /** 投影前先铺的底色（纹理画好之前、四角圆角外缘） */
  base: string;
  /** 边框的颜色（外圈那一道木框） */
  frame: string;
  /** 格线 */
  line: string;
  lineW: number;
  /** 格线做成刻进去的样子：先画一道亮边 */
  engrave: number;
  river: string;
  label: string;
  /** 清漆反光有多亮（0～1） */
  gloss: number;
  /** 四角暗角 */
  vignette: number;
  /** 楚河汉界那一条稍微染一点色 */
  riverTint?: string;
  /** 边角回纹 */
  corners?: boolean;
  /** 外框再加一道细线（棋谱、红木） */
  double?: boolean;
  /** 盘面是深色：可走点、选中圈换亮色 */
  dark?: boolean;
  /**
   * 纹理算多细：每个 CSS 像素算几个点（再乘设备像素比）。木纹、竹纹的细纤维要细一点，
   * 玉、石、漆这种大块的云纹粗算再放大看不出差别，省下几倍时间（手机上第一次打开棋盘不卡）
   */
  res: number;
  /** 按像素算完以后再用笔画几样细节（宣纸纤维、竹节），画进缓存的纹理里 */
  decorate?: (g: CanvasRenderingContext2D, w: number, h: number, c: number, n1: (x: number, y: number) => number, rnd: () => number) => void;
  /**
   * 会动的那一层（ambient.ts，叠在棋盘上的 CSS 动画，不重画棋盘）：
   * sheen 隔几秒斜着扫过去的一道流光；river 楚河汉界里水面的粼光；mist 河上飘的雾；motes 金粉一点点往上飘
   */
  ambient?: {
    sheen: string;
    river?: string;
    mist?: string;
    motes?: string;
    /** 花瓣从上往下飘、打着转（敦煌，天女散花） */
    petals?: string;
  };
  /** 典藏：样式页上标出来（带动效、带画） */
  premium?: boolean;
}

const WOOD_L = hex('#ecd2a6');
const WOOD_M = hex('#dcb784');
const WOOD_D = hex('#b98a55');
const ROSE_L = hex('#8a4528');
const ROSE_M = hex('#6c3019');
const ROSE_D = hex('#3e170a');
const BAMBOO_L = hex('#e8dca0');
const BAMBOO_M = hex('#d6c47e');
const BAMBOO_D = hex('#a88f4a');
const PAPER_L = hex('#f6efdc');
const PAPER_D = hex('#e2d5b6');
const JADE_L = hex('#7cc0a0');
const JADE_M = hex('#3f8f6c');
const JADE_D = hex('#1f5a43');
const MARBLE_L = hex('#f4f3ee');
const MARBLE_V = hex('#8c8a84');
const NIGHT_L = hex('#2a3142');
const NIGHT_D = hex('#121620');
const PLAIN = hex('#f1dfb6');
const XUAN_L = hex('#f7f0df');
const XUAN_D = hex('#e6d9bb');
const LAC_L = hex('#2a1e1c');
const LAC_D = hex('#0d0a0a');
const SILK_L = hex('#ece3c4');
const SILK_D = hex('#d6c9a0');
const DH_L = hex('#e4c38e');
const DH_M = hex('#cf9d63');
const DH_D = hex('#a46c3c');
const DH_G = hex('#4f9480');
const DH_B = hex('#2c5cb4');
const NAN_L = hex('#d9a35a');
const NAN_M = hex('#b47a34');
const NAN_D = hex('#7a4b1c');
const DUAN_L = hex('#6f5c66');
const DUAN_M = hex('#54444d');
const DUAN_D = hex('#382b33');
const RU_L = hex('#cfe0d8');
const RU_M = hex('#b4cbc3');
const RU_D = hex('#93afa8');

/** 棋盘纹理里格子的原点（decorate 拿到的是整块纹理，四周有边） */
const gridOrigin = (w: number, h: number, c: number) => ({ ox: (w - 8 * c) / 2, oy: (h - 9 * c) / 2 });

/**
 * 一列水墨山：几座峰叠在一起取最高的轮廓，峰顶浓、山脚淡进雾里。
 * 画在 [xa, xb] 之间、山脚在 base，最高 hMax。fill 是峰顶的颜色（山脚透明）
 */
function inkRidge(g: CanvasRenderingContext2D, xa: number, xb: number, base: number, hMax: number, rnd: () => number, fill: [number, number, number], alpha: number, sharp = 1.6, n = 4) {
  const pk = Array.from({ length: n }, () => ({ x: xa + rnd() * (xb - xa), h: hMax * (0.45 + rnd() * 0.55), w: (xb - xa) * (0.12 + rnd() * 0.22) }));
  const step = Math.max(1, (xb - xa) / 90);
  g.beginPath();
  g.moveTo(xa, base);
  for (let x = xa; x <= xb + 0.01; x += step) {
    let y = 0;
    for (const p of pk) {
      const u = Math.abs(x - p.x) / p.w;
      if (u < 1) y = Math.max(y, p.h * Math.pow(Math.cos((u * Math.PI) / 2), sharp));
    }
    g.lineTo(x, base - y - (rnd() - 0.5) * hMax * 0.025);
  }
  g.lineTo(xb, base);
  g.closePath();
  const gr = g.createLinearGradient(0, base - hMax, 0, base);
  gr.addColorStop(0, `rgba(${fill[0]},${fill[1]},${fill[2]},${alpha})`);
  gr.addColorStop(0.6, `rgba(${fill[0]},${fill[1]},${fill[2]},${alpha * 0.45})`);
  gr.addColorStop(1, `rgba(${fill[0]},${fill[1]},${fill[2]},0)`);
  g.fillStyle = gr;
  g.fill();
  return pk;
}

/** 洒金：纸面上星星点点的金箔碎片（形状不规则，有的亮有的暗） */
function goldFlecks(g: CanvasRenderingContext2D, w: number, h: number, c: number, rnd: () => number, density: number, alpha: number) {
  const n = Math.round(((w * h) / (c * c)) * density);
  for (let i = 0; i < n; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = c * (0.012 + rnd() * rnd() * 0.07);
    const k = 3 + Math.floor(rnd() * 4);
    const a0 = rnd() * Math.PI;
    const lit = rnd();
    g.fillStyle = `rgba(${Math.round(196 + lit * 50)},${Math.round(150 + lit * 70)},${Math.round(60 + lit * 70)},${alpha * (0.45 + rnd() * 0.55)})`;
    g.beginPath();
    for (let j = 0; j < k; j++) {
      const a = a0 + (j / k) * Math.PI * 2;
      const rr = r * (0.55 + rnd() * 0.75);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (j) g.lineTo(px, py);
      else g.moveTo(px, py);
    }
    g.closePath();
    g.fill();
  }
}

/** 祥云：一个圆卷、两个小卷，金线勾出来 */
function cloudCurl(g: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, lw: number) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, s, Math.PI * 0.9, Math.PI * 2.6);
  g.arc(x + s * 0.45, y - s * 0.1, s * 0.45, Math.PI * 0.6, Math.PI * 1.9, true);
  g.stroke();
  g.beginPath();
  g.arc(x + s * 1.6, y + s * 0.15, s * 0.7, Math.PI * 1.0, Math.PI * 2.4);
  g.stroke();
  g.beginPath();
  g.moveTo(x - s * 1.4, y + s * 0.95);
  g.quadraticCurveTo(x + s * 0.6, y + s * 1.25, x + s * 2.8, y + s * 0.9);
  g.stroke();
  g.restore();
}

/** 河面：几道淡淡的水纹（横着、断断续续） */
function waterLines(g: CanvasRenderingContext2D, xa: number, xb: number, ya: number, yb: number, rnd: () => number, color: string, n: number) {
  g.save();
  g.strokeStyle = color;
  g.lineCap = 'round';
  for (let i = 0; i < n; i++) {
    const y = ya + rnd() * (yb - ya);
    const x = xa + rnd() * (xb - xa);
    const len = (xb - xa) * (0.04 + rnd() * 0.1);
    g.lineWidth = 0.6 + rnd() * 0.8;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + len / 2, y - len * 0.04, x + len, y);
    g.stroke();
  }
  g.restore();
}

/** 木纹：顺着横向的年轮（被噪声扭弯）+ 细细的顺纹纤维 */
function woodGrain(n1: (x: number, y: number) => number, n2: (x: number, y: number) => number, u: number, v: number, L: RGB, M: RGB, D: RGB, contrast: number): RGB {
  const warp = fbm(n1, u * 0.22, v * 0.7, 4) * 1.9;
  const ring = v * 1.15 + warp;
  const s = 0.5 + 0.5 * Math.sin(ring * Math.PI * 2);
  const late = Math.pow(s, 6); // 晚材：细而深的一道
  const fiber = n2(u * 0.7, v * 26) * 0.55 + n2(u * 2.1, v * 61) * 0.45;
  const t = clamp01(0.2 + late * 0.34 * contrast + (fiber - 0.5) * 0.2 * contrast + (fbm(n1, u * 0.12 + 9, v * 0.12, 2) - 0.5) * 0.36);
  return t < 0.5 ? mix(L, M, t * 2) : mix(M, D, (t - 0.5) * 2);
}

export const BOARDS: BoardStyle[] = [
  {
    id: 'wood',
    res: 0.55,
    name: '榉木',
    desc: '浅色榉木，顺纹年轮，清漆罩面',
    base: '#dcb784',
    surface: (n1, n2, u, v) => woodGrain(n1, n2, u, v, WOOD_L, WOOD_M, WOOD_D, 1),
    frame: '#8a5a2e',
    line: '#6b4524',
    lineW: 1.15,
    engrave: 0.35,
    river: 'rgba(84,52,22,0.78)',
    label: 'rgba(110,74,40,0.85)',
    gloss: 0.16,
    vignette: 0.16,
  },
  {
    id: 'rosewood',
    res: 0.55,
    name: '红木',
    desc: '深色红木，金漆描线，边角回纹',
    base: '#6c3019',
    surface: (n1, n2, u, v) => woodGrain(n1, n2, u, v, ROSE_L, ROSE_M, ROSE_D, 1.25),
    frame: '#2c1008',
    line: '#e3c37e',
    lineW: 1.15,
    engrave: 0,
    river: 'rgba(236,204,132,0.92)',
    label: 'rgba(236,204,132,0.8)',
    gloss: 0.2,
    vignette: 0.28,
    corners: true,
    double: true,
    dark: true,
  },
  {
    id: 'bamboo',
    res: 0.5,
    name: '竹排',
    desc: '一根根竹片拼成，有竹节、竹缝',
    base: '#d6c47e',
    surface: (n1, n2, u, v) => {
      const sw = 0.92; // 竹片宽（格）
      const k = Math.floor(u / sw);
      const lx = u / sw - k;
      const tint = n1(k * 7.3, 3.1) - 0.5;
      // 竹节：每片竹子两三格一个节，位置各不相同
      const period = 2.6 + n1(k * 3.7, 11) * 1.4;
      const off = n1(k * 5.1, 17) * period;
      const ph = ((v + off) % period) / period;
      // 竹节两边颜色稍深一点（节本身的那道棱在 decorate 里用笔画，像素算出来是糊的）
      const node = Math.exp(-Math.pow((ph - 0.5) * period * 3.2, 2));
      const fiber = n2(u * 18, v * 0.5) - 0.5;
      const round = Math.sin(lx * Math.PI); // 竹片中间鼓、两边低
      let c = mix(BAMBOO_L, BAMBOO_M, clamp01(0.45 - round * 0.35 + tint * 0.6 + fiber * 0.35));
      c = mix(c, BAMBOO_D, node * 0.28);
      const gap = smooth(0.06, 0, Math.min(lx, 1 - lx));
      return mix(c, hex('#6f5a26'), gap * 0.85);
    },
    decorate: (g, w, h, c, n1) => {
      const sw = 0.92;
      for (let k = 0; k * sw * c < w; k++) {
        const period = 2.6 + n1(k * 3.7, 11) * 1.4;
        const off = n1(k * 5.1, 17) * period;
        const xa = k * sw * c + c * 0.05;
        const xb = (k + 1) * sw * c - c * 0.05;
        for (let j = -1; j * period * c < h + period * c; j++) {
          // 节在 ph = 0.5 的地方：v = (j + 0.5) * period - off
          const y = ((j + 0.5) * period - off) * c;
          if (y < -c || y > h + c) continue;
          const bow = c * 0.04;
          g.lineCap = 'round';
          g.strokeStyle = 'rgba(92,70,24,0.62)';
          g.lineWidth = Math.max(1, c * 0.05);
          g.beginPath();
          g.moveTo(xa, y);
          g.quadraticCurveTo((xa + xb) / 2, y + bow, xb, y);
          g.stroke();
          g.strokeStyle = 'rgba(255,252,226,0.5)';
          g.lineWidth = Math.max(0.8, c * 0.03);
          g.beginPath();
          g.moveTo(xa, y + c * 0.05);
          g.quadraticCurveTo((xa + xb) / 2, y + c * 0.05 + bow, xb, y + c * 0.05);
          g.stroke();
        }
      }
    },
    frame: '#7a6430',
    line: '#4f3f17',
    lineW: 1.2,
    engrave: 0.3,
    river: 'rgba(70,54,18,0.82)',
    label: 'rgba(80,62,24,0.85)',
    gloss: 0.08,
    vignette: 0.14,
  },
  {
    id: 'paper',
    res: 0.45,
    name: '宣纸',
    desc: '米色宣纸、墨线，像翻开一本老棋谱',
    base: '#efe5cc',
    surface: (n1, n2, u, v) => {
      const mottle = fbm(n1, u * 0.35, v * 0.35, 5);
      const fine = fbm(n2, u * 3, v * 3, 3) - 0.5;
      const stain = smooth(0.6, 0.76, fbm(n1, u * 0.16 + 30, v * 0.16, 3)) * 0.3;
      return mix(PAPER_L, PAPER_D, clamp01((mottle - 0.4) * 0.7 + fine * 0.25 + stain));
    },
    decorate: (g, w, h, c, _n1, rnd) => {
      // 宣纸的纤维：方向随便、有弯，短短的一根根
      const n = Math.round(((w * h) / (c * c)) * 9);
      g.lineCap = 'round';
      for (let i = 0; i < n; i++) {
        const x = rnd() * w;
        const y = rnd() * h;
        const a = rnd() * Math.PI;
        const len = c * (0.15 + rnd() * 0.5);
        const bend = (rnd() - 0.5) * len * 0.6;
        g.strokeStyle = `rgba(${rnd() < 0.5 ? '150,128,92' : '255,255,250'},${0.1 + rnd() * 0.14})`;
        g.lineWidth = 0.4 + rnd() * 0.7;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, y + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, x + Math.cos(a) * len, y + Math.sin(a) * len);
        g.stroke();
      }
    },
    frame: '#2a2622',
    line: '#2b2724',
    lineW: 1.25,
    engrave: 0,
    river: 'rgba(30,26,23,0.86)',
    label: 'rgba(60,54,48,0.85)',
    gloss: 0,
    vignette: 0.1,
    double: true,
  },
  {
    id: 'jade',
    res: 0.36,
    name: '碧玉',
    desc: '整块碧玉，絮状云纹，温润透光',
    base: '#3f8f6c',
    surface: (n1, n2, u, v) => {
      const cloud = fbm(n1, u * 0.42, v * 0.42, 5);
      const ridge = 1 - Math.abs(fbm(n2, u * 0.7 + 5, v * 0.7, 4) * 2 - 1);
      const vein = Math.pow(ridge, 10);
      const soft = fbm(n2, u * 1.6 + 11, v * 1.6, 3);
      let c = cloud < 0.5 ? mix(JADE_D, JADE_M, cloud * 2) : mix(JADE_M, JADE_L, (cloud - 0.5) * 2);
      c = mix(c, hex('#cfe9db'), vein * 0.22 + smooth(0.55, 0.8, soft) * 0.18);
      return c;
    },
    frame: '#123a2c',
    line: 'rgba(246,238,206,0.88)',
    lineW: 1.1,
    engrave: 0,
    river: 'rgba(250,243,214,0.9)',
    label: 'rgba(240,234,206,0.82)',
    gloss: 0.26,
    vignette: 0.3,
    corners: true,
    dark: true,
  },
  {
    id: 'marble',
    res: 0.4,
    name: '汉白玉',
    desc: '白色大理石，灰色石筋',
    base: '#ecebe5',
    surface: (n1, n2, u, v) => {
      const t = fbm(n1, u * 0.55, v * 0.55, 5);
      const d = Math.abs(Math.sin((u * 0.42 + v * 0.27 + t * 2.6) * Math.PI));
      const vein = 1 - smooth(0, 0.09, d);
      const d2 = Math.abs(Math.sin((u * 0.9 - v * 0.6 + fbm(n2, u * 0.9, v * 0.9, 4) * 3.4) * Math.PI));
      const vein2 = (1 - smooth(0, 0.05, d2)) * 0.45;
      const cloud = (fbm(n2, u * 0.25 + 20, v * 0.25, 3) - 0.5) * 0.16;
      return mix(mix(MARBLE_L, hex('#dcdad2'), clamp01(0.3 + cloud * 3)), MARBLE_V, clamp01(vein * 0.38 + vein2 * 0.3));
    },
    frame: '#a7a39a',
    line: '#4f4e4a',
    lineW: 1.1,
    engrave: 0.4,
    river: 'rgba(62,60,55,0.9)',
    label: 'rgba(96,94,88,0.85)',
    gloss: 0.22,
    vignette: 0.12,
  },
  {
    id: 'night',
    res: 0.3,
    name: '玄漆',
    desc: '黑漆底、金线描边，夜里看不刺眼',
    base: '#1a1f2b',
    surface: (n1, n2, u, v) => {
      const cloud = fbm(n1, u * 0.3, v * 0.3, 4);
      const fine = n2(u * 12, v * 12) - 0.5;
      return mix(NIGHT_D, NIGHT_L, clamp01(cloud * 0.7 + fine * 0.06));
    },
    frame: '#07080c',
    line: '#c9a45a',
    lineW: 1.1,
    engrave: 0,
    river: 'rgba(222,186,110,0.92)',
    label: 'rgba(214,180,106,0.8)',
    gloss: 0.12,
    vignette: 0.3,
    corners: true,
    double: true,
    dark: true,
  },
  // ───── 典藏：带画、带动效（ambient.ts）─────
  {
    id: 'inkland',
    res: 0.45,
    name: '水墨山河',
    desc: '洒金宣纸，楚河汉界里一幅水墨山水；流光、河水、薄雾会动',
    premium: true,
    base: '#f0e6cf',
    surface: (n1, n2, u, v) => {
      const mottle = fbm(n1, u * 0.3, v * 0.3, 5);
      const fine = fbm(n2, u * 3.2, v * 3.2, 3) - 0.5;
      // 墨在纸上洇开的几团极淡的灰
      const wash = smooth(0.62, 0.8, fbm(n1, u * 0.12 + 40, v * 0.12, 3)) * 0.22;
      return mix(XUAN_L, XUAN_D, clamp01((mottle - 0.42) * 0.6 + fine * 0.22 + wash));
    },
    decorate: (g, w, h, c, _n1, rnd) => {
      const { ox, oy } = gridOrigin(w, h, c);
      const top = oy + 4 * c;
      const bot = oy + 5 * c;
      goldFlecks(g, w, h, c, rnd, 1.6, 0.85);
      g.save();
      g.beginPath();
      g.rect(ox, top, 8 * c, c);
      g.clip();
      // 远山一抹（整条河上都有，很淡）
      inkRidge(g, ox, ox + 8 * c, bot - c * 0.2, c * 0.42, rnd, [60, 74, 84], 0.16, 1.2, 7);
      // 中间（"楚河""汉界"两组字之间）一组浓一点的山，一轮朱红的日头
      g.fillStyle = 'rgba(196,58,40,0.55)';
      g.beginPath();
      g.arc(ox + 3.45 * c, top + c * 0.3, c * 0.13, 0, Math.PI * 2);
      g.fill();
      inkRidge(g, ox + 2.95 * c, ox + 5.05 * c, bot - c * 0.12, c * 0.74, rnd, [34, 40, 44], 0.62, 2.1, 4);
      inkRidge(g, ox + 3.2 * c, ox + 4.9 * c, bot - c * 0.02, c * 0.38, rnd, [22, 26, 28], 0.72, 1.7, 3);
      // 一叶小舟
      g.fillStyle = 'rgba(28,30,32,0.75)';
      const bx = ox + 4.62 * c;
      const byy = bot - c * 0.13;
      g.beginPath();
      g.moveTo(bx - c * 0.13, byy);
      g.quadraticCurveTo(bx, byy + c * 0.06, bx + c * 0.14, byy - c * 0.01);
      g.closePath();
      g.fill();
      g.fillRect(bx - c * 0.01, byy - c * 0.12, c * 0.012, c * 0.12);
      waterLines(g, ox, ox + 8 * c, bot - c * 0.22, bot - c * 0.04, rnd, 'rgba(50,64,74,0.22)', 26);
      g.restore();
    },
    frame: '#3a2c1c',
    line: '#2b2724',
    lineW: 1.2,
    engrave: 0,
    river: 'rgba(28,24,21,0.9)',
    label: 'rgba(60,52,44,0.85)',
    gloss: 0.06,
    vignette: 0.14,
    double: true,
    corners: true,
    ambient: { sheen: 'rgba(255,226,150,0.55)', river: 'rgba(120,150,170,0.35)', mist: 'rgba(255,255,255,0.55)', motes: '#e8c46a' },
  },
  {
    id: 'goldlac',
    res: 0.3,
    name: '鎏金玄漆',
    desc: '黑漆洒金、金线金字，河里一道祥云；金光隔几秒扫一遍',
    premium: true,
    base: '#16100f',
    surface: (n1, n2, u, v) => {
      const cloud = fbm(n1, u * 0.28, v * 0.28, 4);
      const fine = n2(u * 14, v * 14) - 0.5;
      return mix(LAC_D, LAC_L, clamp01(cloud * 0.75 + fine * 0.05));
    },
    decorate: (g, w, h, c, _n1, rnd) => {
      const { ox, oy } = gridOrigin(w, h, c);
      goldFlecks(g, w, h, c, rnd, 2.6, 0.75);
      // 河里：中间一组金线祥云，两头淡淡的金色水波
      const top = oy + 4 * c;
      g.save();
      g.beginPath();
      g.rect(ox, top, 8 * c, c);
      g.clip();
      const gr = g.createLinearGradient(0, top, 0, top + c);
      gr.addColorStop(0, 'rgba(214,170,90,0)');
      gr.addColorStop(0.5, 'rgba(214,170,90,0.1)');
      gr.addColorStop(1, 'rgba(214,170,90,0)');
      g.fillStyle = gr;
      g.fillRect(ox, top, 8 * c, c);
      cloudCurl(g, ox + 3.55 * c, top + c * 0.48, c * 0.17, 'rgba(226,186,104,0.85)', Math.max(1, c * 0.028));
      cloudCurl(g, ox + 4.15 * c, top + c * 0.36, c * 0.12, 'rgba(226,186,104,0.6)', Math.max(0.8, c * 0.022));
      waterLines(g, ox, ox + 8 * c, top + c * 0.7, top + c * 0.95, rnd, 'rgba(226,186,104,0.22)', 22);
      g.restore();
    },
    frame: '#050303',
    line: '#d6ac5a',
    lineW: 1.15,
    engrave: 0,
    river: 'rgba(236,200,120,0.95)',
    label: 'rgba(226,190,112,0.85)',
    gloss: 0.18,
    vignette: 0.34,
    corners: true,
    double: true,
    dark: true,
    ambient: { sheen: 'rgba(255,214,120,0.6)', river: 'rgba(240,196,110,0.3)', motes: '#f5d27a' },
  },
  {
    id: 'qinglv',
    res: 0.4,
    name: '金碧青绿',
    desc: '绢本，河里一幅青绿山水、金线勾边（金碧山水）；薄雾、流光会动',
    premium: true,
    base: '#e4d9b4',
    surface: (n1, n2, u, v) => {
      // 绢：经纬细细的十字纹 + 年久泛黄的斑
      const weave = n2(u * 30, v * 30);
      const age = fbm(n1, u * 0.25, v * 0.25, 4);
      const fine = fbm(n2, u * 2.5, v * 2.5, 2) - 0.5;
      return mix(SILK_L, SILK_D, clamp01((age - 0.4) * 0.8 + weave * 0.08 + fine * 0.18));
    },
    decorate: (g, w, h, c, _n1, rnd) => {
      const { ox, oy } = gridOrigin(w, h, c);
      const top = oy + 4 * c;
      const bot = oy + 5 * c;
      g.save();
      g.beginPath();
      g.rect(ox, top, 8 * c, c);
      g.clip();
      // 远处一抹石青
      inkRidge(g, ox, ox + 8 * c, bot - c * 0.18, c * 0.4, rnd, [70, 120, 150], 0.22, 1.3, 7);
      // 中间一组石绿 → 石青的峰，金线勾边
      const draw = (xa: number, xb: number, base: number, hm: number, a: number) => {
        const pk = Array.from({ length: 3 }, () => ({ x: xa + rnd() * (xb - xa), h: hm * (0.5 + rnd() * 0.5), w: (xb - xa) * (0.18 + rnd() * 0.2) }));
        const path = new Path2D();
        path.moveTo(xa, base);
        for (let x = xa; x <= xb; x += (xb - xa) / 60) {
          let y = 0;
          for (const p of pk) {
            const u = Math.abs(x - p.x) / p.w;
            if (u < 1) y = Math.max(y, p.h * Math.pow(Math.cos((u * Math.PI) / 2), 2.2));
          }
          path.lineTo(x, base - y);
        }
        path.lineTo(xb, base);
        path.closePath();
        const gr = g.createLinearGradient(0, base - hm, 0, base);
        gr.addColorStop(0, `rgba(46,104,150,${a})`);
        gr.addColorStop(0.55, `rgba(52,140,110,${a})`);
        gr.addColorStop(1, `rgba(120,160,110,${a * 0.2})`);
        g.fillStyle = gr;
        g.fill(path);
        g.strokeStyle = `rgba(196,150,60,${a})`;
        g.lineWidth = Math.max(0.8, c * 0.018);
        g.stroke(path);
      };
      draw(ox + 2.95 * c, ox + 5.05 * c, bot - c * 0.1, c * 0.72, 0.8);
      draw(ox + 3.35 * c, ox + 4.75 * c, bot, c * 0.36, 0.9);
      // 一条白雾横过山腰
      const mg = g.createLinearGradient(0, bot - c * 0.4, 0, bot - c * 0.22);
      mg.addColorStop(0, 'rgba(250,246,232,0)');
      mg.addColorStop(0.5, 'rgba(250,246,232,0.55)');
      mg.addColorStop(1, 'rgba(250,246,232,0)');
      g.fillStyle = mg;
      g.fillRect(ox + 2.7 * c, bot - c * 0.4, 2.6 * c, c * 0.18);
      waterLines(g, ox, ox + 8 * c, bot - c * 0.12, bot - c * 0.02, rnd, 'rgba(46,104,150,0.28)', 20);
      g.restore();
    },
    frame: '#5a4420',
    line: '#3b3020',
    lineW: 1.15,
    engrave: 0,
    river: 'rgba(52,40,22,0.88)',
    label: 'rgba(70,56,32,0.85)',
    gloss: 0.08,
    vignette: 0.16,
    double: true,
    corners: true,
    ambient: { sheen: 'rgba(255,236,170,0.5)', river: 'rgba(80,150,170,0.32)', mist: 'rgba(255,252,240,0.6)', motes: '#d8b45a' },
  },
  {
    id: 'dunhuang',
    res: 0.4,
    name: '敦煌飞天',
    desc: '土墙壁画：赭石底子、剥落的石绿石青、龟裂纹，河里几条飘带围着一朵莲花；花瓣往下飘',
    premium: true,
    base: '#d8b07a',
    surface: (n1, n2, u, v) => {
      const m = fbm(n1, u * 0.35, v * 0.35, 5);
      const fine = fbm(n2, u * 3, v * 3, 3) - 0.5;
      let col = mix(DH_L, DH_M, clamp01((m - 0.35) * 1.1 + fine * 0.25));
      col = mix(col, DH_D, smooth(0.66, 0.85, m) * 0.5);
      // 颜料剥落剩下的石绿、石青残块
      col = mix(col, DH_G, smooth(0.7, 0.75, fbm(n2, u * 0.5 + 7, v * 0.5, 4)) * 0.38);
      return mix(col, DH_B, smooth(0.74, 0.78, fbm(n1, u * 0.5 + 50, v * 0.5 + 3, 4)) * 0.26);
    },
    decorate: (g, w, h, c, _n1, rnd) => {
      const { ox, oy } = gridOrigin(w, h, c);
      const top = oy + 4 * c;
      const cy = top + c / 2;
      // 龟裂纹：墙皮老了裂开的细纹，一根分几叉
      g.strokeStyle = 'rgba(96,56,24,0.28)';
      g.lineCap = 'round';
      const crack = (x: number, y: number, a: number, len: number, depth: number) => {
        g.lineWidth = 0.4 + depth * 0.3;
        g.beginPath();
        g.moveTo(x, y);
        for (let s = 0; s < len; s++) {
          a += (rnd() - 0.5) * 0.9;
          x += Math.cos(a) * c * 0.1;
          y += Math.sin(a) * c * 0.1;
          g.lineTo(x, y);
          if (depth > 0 && rnd() < 0.12) {
            g.stroke();
            crack(x, y, a + (rnd() < 0.5 ? 1 : -1) * (0.6 + rnd() * 0.6), Math.floor(len / 2), depth - 1);
            g.lineWidth = 0.4 + depth * 0.3;
            g.beginPath();
            g.moveTo(x, y);
          }
        }
        g.stroke();
      };
      for (let i = 0; i < 16; i++) crack(rnd() * w, rnd() * h, rnd() * Math.PI * 2, 12 + Math.floor(rnd() * 14), 2);
      // 河：三条飘带（朱砂、石绿、石青）顺着河飘，粗细起伏
      g.save();
      g.beginPath();
      g.rect(ox, top, 8 * c, c);
      g.clip();
      const ribbon = (phase: number, amp: number, yOff: number, wMax: number, fill: string, edge: string) => {
        const pts: [number, number, number][] = [];
        for (let x = ox - c * 0.2; x <= ox + 8.2 * c; x += c * 0.08) {
          const t = (x - ox) / (8 * c);
          const y = cy + yOff + Math.sin(t * Math.PI * 3.2 + phase) * amp;
          const wd = wMax * (0.35 + 0.65 * Math.abs(Math.sin(t * Math.PI * 2.4 + phase * 1.7)));
          pts.push([x, y, wd]);
        }
        g.beginPath();
        pts.forEach(([x, y, wd], i) => (i ? g.lineTo(x, y - wd / 2) : g.moveTo(x, y - wd / 2)));
        for (let i = pts.length - 1; i >= 0; i--) g.lineTo(pts[i][0], pts[i][1] + pts[i][2] / 2);
        g.closePath();
        g.fillStyle = fill;
        g.fill();
        g.strokeStyle = edge;
        g.lineWidth = Math.max(0.6, c * 0.012);
        g.stroke();
      };
      ribbon(0.3, c * 0.22, -c * 0.12, c * 0.17, 'rgba(176,52,34,0.62)', 'rgba(110,30,18,0.55)');
      ribbon(2.2, c * 0.18, c * 0.1, c * 0.14, 'rgba(44,132,108,0.58)', 'rgba(24,80,62,0.5)');
      ribbon(4.1, c * 0.2, 0, c * 0.11, 'rgba(48,84,156,0.55)', 'rgba(28,48,100,0.5)');
      // 中间一朵莲花：八片外瓣朱砂、八片内瓣石绿、金心
      const lx = ox + 4 * c;
      const petal = (r0: number, r1: number, n: number, rot: number, fill: string) => {
        for (let i = 0; i < n; i++) {
          const a = rot + (i / n) * Math.PI * 2;
          const wd = (Math.PI / n) * 0.9;
          g.beginPath();
          g.moveTo(lx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.quadraticCurveTo(lx + Math.cos(a - wd) * r1, cy + Math.sin(a - wd) * r1, lx + Math.cos(a) * r1 * 1.12, cy + Math.sin(a) * r1 * 1.12);
          g.quadraticCurveTo(lx + Math.cos(a + wd) * r1, cy + Math.sin(a + wd) * r1, lx + Math.cos(a) * r0, cy + Math.sin(a) * r0);
          g.fillStyle = fill;
          g.fill();
          g.strokeStyle = 'rgba(70,34,14,0.6)';
          g.lineWidth = Math.max(0.5, c * 0.01);
          g.stroke();
        }
      };
      petal(c * 0.12, c * 0.4, 8, 0, 'rgba(184,62,40,0.85)');
      petal(c * 0.08, c * 0.26, 8, Math.PI / 8, 'rgba(52,140,112,0.9)');
      const gold = g.createRadialGradient(lx - c * 0.03, cy - c * 0.03, 0, lx, cy, c * 0.11);
      gold.addColorStop(0, '#f8dc8a');
      gold.addColorStop(1, '#b8862e');
      g.fillStyle = gold;
      g.beginPath();
      g.arc(lx, cy, c * 0.1, 0, Math.PI * 2);
      g.fill();
      g.restore();
    },
    frame: '#5a2e14',
    line: '#4a2412',
    lineW: 1.2,
    engrave: 0,
    river: 'rgba(122,28,14,0.92)',
    label: 'rgba(90,48,22,0.85)',
    gloss: 0.06,
    vignette: 0.26,
    double: true,
    corners: true,
    ambient: { sheen: 'rgba(255,226,160,0.45)', motes: '#f0c860', petals: '#e0705a' },
  },
  // 下面三套是"耐看"的：真材料的样子，不发光、不会动（用户原话："找一些特别美观、赏心悦目的"；晃眼的上一轮刚拿掉）
  {
    id: 'nanmu',
    res: 0.55,
    name: '金丝楠',
    desc: '金丝楠木：金黄的木色，顺着木纹一缕缕金丝，有水波似的明暗',
    base: '#cf9d56',
    surface: (n1, n2, u, v) => {
      const c = woodGrain(n1, n2, u, v, NAN_L, NAN_M, NAN_D, 0.7);
      // 水波纹：横着一道道柔和的明暗（光照上去像水面，金丝楠最出名的就是这个）
      const wave = Math.sin((u * 0.45 + v * 0.12 + fbm(n2, u * 0.25 + 3, v * 0.25, 3) * 1.6) * Math.PI * 2) * 0.5 + 0.5;
      const w = mix(c, hex('#e9bd6e'), smooth(0.4, 1, wave) * 0.14);
      // 金丝：顺纹的细亮线（木纤维里的结晶反光），一片有、一片没有
      const silk = Math.pow(n2(u * 1.3, v * 40), 12) * smooth(0.5, 0.7, fbm(n1, u * 0.3 + 40, v * 0.6, 3));
      return mix(w, hex('#ffe3a0'), clamp01(silk * 1.6) * 0.6);
    },
    frame: '#4e2c0c',
    line: '#3f2208',
    lineW: 1.15,
    engrave: 0.3,
    river: 'rgba(62,32,8,0.85)',
    label: 'rgba(72,40,12,0.85)',
    gloss: 0.24,
    vignette: 0.24,
    double: true,
  },
  {
    id: 'duanyan',
    res: 0.4,
    name: '端砚',
    desc: '端溪砚石：紫里带青，有蕉叶白、火捺，几只石眼，线是刻进去的',
    base: '#54444d',
    surface: (n1, n2, u, v) => {
      const t = fbm(n1, u * 0.5, v * 0.5, 5);
      let c = t < 0.5 ? mix(DUAN_D, DUAN_M, t * 2) : mix(DUAN_M, DUAN_L, (t - 0.5) * 2);
      // 蕉叶白：一大片淡的、发青发白
      c = mix(c, hex('#a29aa0'), smooth(0.6, 0.82, fbm(n2, u * 0.22 + 7, v * 0.3, 4)) * 0.38);
      // 火捺：紫红的一团
      c = mix(c, hex('#7c3a40'), smooth(0.64, 0.86, fbm(n1, u * 0.35 + 30, v * 0.35 + 12, 3)) * 0.32);
      // 青花：细密的小青点，淡淡的
      return mix(c, hex('#66848c'), clamp01(Math.pow(n2(u * 7 + 3, v * 7), 16) * 3) * 0.22);
    },
    decorate: (g, w, h, c, _n1, rnd) => {
      // 石眼：端砚最珍贵的，一圈圈青绿、中间一点深的瞳仁。只放在楚河汉界正中那一片（那里不落子，
      // 也不会被看成"可以走"的提示点）——像河里映着一轮月亮
      const { ox, oy } = gridOrigin(w, h, c);
      const x = ox + 4 * c;
      const y = oy + 4.5 * c;
      const R = c * 0.3;
      for (let k = 7; k >= 1; k--) {
        g.fillStyle = k % 2 ? 'rgba(150,160,128,0.32)' : 'rgba(96,108,86,0.36)';
        g.beginPath();
        g.ellipse(x, y, (R * k) / 7, ((R * k) / 7) * 0.86, 0.2, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = 'rgba(40,44,34,0.6)';
      g.beginPath();
      g.ellipse(x, y, R * 0.14, R * 0.12, 0.2, 0, Math.PI * 2);
      g.fill();
      // 冰纹：两三道若有若无的细白线
      g.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        let x = rnd() * w;
        let y = rnd() * h;
        g.strokeStyle = `rgba(232,228,222,${0.1 + rnd() * 0.1})`;
        g.lineWidth = 0.5 + rnd() * 0.6;
        g.beginPath();
        g.moveTo(x, y);
        let a = rnd() * Math.PI * 2;
        for (let k = 0; k < 14; k++) {
          a += (rnd() - 0.5) * 0.9;
          x += Math.cos(a) * c * 0.35;
          y += Math.sin(a) * c * 0.35;
          g.lineTo(x, y);
        }
        g.stroke();
      }
    },
    frame: '#2a1e25',
    line: 'rgba(228,216,192,0.8)',
    lineW: 1.1,
    engrave: 0,
    river: 'rgba(232,220,194,0.86)',
    label: 'rgba(224,210,184,0.72)',
    gloss: 0.12,
    vignette: 0.3,
    double: true,
    dark: true,
  },
  {
    id: 'ruyao',
    res: 0.5,
    name: '汝窑开片',
    desc: '天青色的汝窑釉，满釉细细的开片，像雨过天晴',
    base: '#b4cbc3',
    surface: (n1, n2, u, v) => {
      const t = fbm(n1, u * 0.35, v * 0.35, 4);
      let c = t < 0.5 ? mix(RU_D, RU_M, t * 2) : mix(RU_M, RU_L, (t - 0.5) * 2);
      const [big, small] = crackle(n2, u, v, 1.7);
      c = mix(c, hex('#7d938f'), big * 0.26 + small * 0.1);
      // 釉里的小气泡（"寥若晨星"）：一点点亮
      return mix(c, hex('#f0f7f3'), clamp01(Math.pow(n2(u * 14, v * 14), 18) * 4) * 0.45);
    },
    frame: '#7f6f5f',
    line: '#57442f',
    lineW: 1.1,
    engrave: 0.3,
    river: 'rgba(84,64,46,0.84)',
    label: 'rgba(92,72,56,0.8)',
    gloss: 0.3,
    vignette: 0.12,
  },
  {
    id: 'plain',
    res: 0.2,
    name: '素色',
    desc: '没有纹理、线条加粗，最清楚',
    base: '#f1dfb6',
    surface: () => PLAIN,
    frame: '#a9824f',
    line: '#4a3418',
    lineW: 1.5,
    engrave: 0,
    river: 'rgba(74,52,24,0.8)',
    label: 'rgba(74,52,24,0.9)',
    gloss: 0,
    vignette: 0,
  },
];
export const boardStyle = (id: BoardId) => BOARDS.find((b) => b.id === id) ?? BOARDS[0];

/** 盘面上"可走点"、选中圈的颜色：深色盘面用亮色 */
export function markColors(look: Look = getLook()): { dot: string; ring: string } {
  return boardStyle(look.board).dark
    ? { dot: 'rgba(255,232,150,0.85)', ring: 'rgba(255,226,120,0.95)' }
    : { dot: 'rgba(46,160,90,0.55)', ring: 'rgba(46,160,90,0.95)' };
}

/** 棋盘木底在最上、最下一条线外面多留几格（带纵线号的要多留，号写在棋子外面） */
export const boardPadY = (coords: boolean) => (coords ? 0.95 : 0.62);

export interface BoardGeom {
  /** 左上角交叉点（CSS 像素） */
  x0: number;
  y0: number;
  /** 格宽 */
  c: number;
  cols: number;
  rows: number;
  flip: boolean;
  coords: boolean;
  dpr: number;
}

function roundRectPath(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** 画整块棋盘（静态层：材质、光、边框、格线、九宫、炮兵位、河界、纵线号） */
export function paintBoard(g: CanvasRenderingContext2D, geo: BoardGeom, look: Look = getLook()): void {
  const st = boardStyle(look.board);
  const { x0, y0, c, cols, rows } = geo;
  const x1 = x0 + (cols - 1) * c;
  const y1 = y0 + (rows - 1) * c;
  // 上下多留一些：纵线号要在棋子外面（原来的号写在底线下面 0.42 格，正好被底线那一排棋子盖住）
  const pad = c * 0.62;
  const padY = c * boardPadY(geo.coords);
  const bx = x0 - pad;
  const by = y0 - padY;
  const bw = x1 - x0 + pad * 2;
  const bh = y1 - y0 + padY * 2;
  const radius = Math.min(14, c * 0.35);

  // 1. 落地投影 + 底色
  g.save();
  g.shadowColor = st.dark ? 'rgba(0,0,0,0.6)' : 'rgba(0,0,0,0.45)';
  g.shadowBlur = Math.max(10, c * 0.4);
  g.shadowOffsetY = Math.max(3, c * 0.12);
  g.fillStyle = st.base;
  roundRectPath(g, bx, by, bw, bh, radius);
  g.fill();
  g.restore();

  // 2. 材质（按像素算，缓存）
  g.save();
  roundRectPath(g, bx, by, bw, bh, radius);
  g.clip();
  const res = Math.min(1.2, geo.dpr * st.res);
  // 纹理按"格宽取整到 2 像素"来算和缓存：手机地址栏一收一放，棋盘差几个像素，不用整张重算（一张要一两百毫秒）
  const cq = Math.max(8, Math.round(c / 2) * 2);
  const tw = (bw / c) * cq;
  const th = (bh / c) * cq;
  const tex = cached(`b|${st.id}|${cq}|${Math.round(tw)}x${Math.round(th)}`, () => {
    const n1 = makeNoise(1301 + st.id.length * 17);
    const n2 = makeNoise(7717 + st.id.length * 29);
    const cv = paintPixels(tw, th, res, cq, (u, v) => {
      const col = st.surface(n1, n2, u, v);
      return [col[0], col[1], col[2], 255];
    });
    if (st.decorate) {
      const tg = cv.getContext('2d')!;
      tg.setTransform(cv.width / tw, 0, 0, cv.height / th, 0, 0);
      st.decorate(tg, tw, th, cq, n1, mulberry32(4242));
    }
    return cv;
  });
  g.imageSmoothingQuality = 'high';
  g.drawImage(tex, bx, by, bw, bh);

  // 3. 光：左上来的清漆反光 + 四角暗角
  if (st.gloss > 0) {
    const gl = g.createLinearGradient(bx, by, bx + bw * 0.75, by + bh * 0.9);
    gl.addColorStop(0, `rgba(255,255,255,${st.gloss})`);
    gl.addColorStop(0.45, `rgba(255,255,255,${st.gloss * 0.25})`);
    gl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gl;
    g.fillRect(bx, by, bw, bh);
  }
  if (st.vignette > 0) {
    const vg = g.createRadialGradient(bx + bw / 2, by + bh / 2, Math.min(bw, bh) * 0.35, bx + bw / 2, by + bh / 2, Math.hypot(bw, bh) * 0.62);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, `rgba(0,0,0,${st.vignette})`);
    g.fillStyle = vg;
    g.fillRect(bx, by, bw, bh);
  }

  // 4. 边框：外圈一道框，倒角（左上亮、右下暗）
  const band = Math.max(3, c * 0.13);
  g.lineWidth = band;
  g.strokeStyle = st.frame;
  g.globalAlpha = st.id === 'paper' ? 0 : 0.85;
  roundRectPath(g, bx + band / 2, by + band / 2, bw - band, bh - band, Math.max(1, radius - band / 2));
  g.stroke();
  g.globalAlpha = 1;
  const bev = g.createLinearGradient(bx, by, bx + bw, by + bh);
  bev.addColorStop(0, 'rgba(255,255,255,0.45)');
  bev.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  bev.addColorStop(1, 'rgba(0,0,0,0.35)');
  g.strokeStyle = bev;
  g.lineWidth = 1.2;
  roundRectPath(g, bx + 0.8, by + 0.8, bw - 1.6, bh - 1.6, radius);
  g.stroke();
  if (st.id !== 'paper') {
    // 框里面那条缝：内侧一道暗线，盘面像是嵌进框里的
    g.strokeStyle = st.dark ? 'rgba(0,0,0,0.55)' : 'rgba(60,36,14,0.45)';
    g.lineWidth = 1;
    roundRectPath(g, bx + band, by + band, bw - band * 2, bh - band * 2, Math.max(1, radius - band));
    g.stroke();
  }
  g.restore();

  // 5. 格线外面的方框（棋谱、红木、玄漆再多一道细线）
  const lw = Math.max(1, st.lineW * Math.max(0.9, c / 44));
  const line = (draw: () => void) => {
    if (st.engrave > 0) {
      // 刻线：先画一道偏右下的亮边，再画线——像是刻进木头里、底边受光
      g.save();
      g.translate(0.7, 0.8);
      g.strokeStyle = `rgba(255,248,230,${st.engrave})`;
      draw();
      g.restore();
    }
    g.strokeStyle = st.line;
    draw();
  };
  g.lineCap = 'round';
  const fr = c * 0.3;
  g.lineWidth = lw * 1.4;
  line(() => g.strokeRect(x0 - fr, y0 - fr, x1 - x0 + fr * 2, y1 - y0 + fr * 2));
  if (st.double) {
    g.lineWidth = Math.max(0.8, lw * 0.6);
    const fr2 = c * 0.38;
    line(() => g.strokeRect(x0 - fr2, y0 - fr2, x1 - x0 + fr2 * 2, y1 - y0 + fr2 * 2));
  }
  if (st.corners) cornerKnots(g, x0 - c * 0.38, y0 - c * 0.38, x1 + c * 0.38, y1 + c * 0.38, c * 0.2, st.line, Math.max(0.8, lw * 0.7));

  // 6. 河界染色
  if (st.riverTint) {
    g.fillStyle = st.riverTint;
    g.fillRect(x0, y0 + 4 * c, x1 - x0, c);
  }

  // 7. 格线
  g.lineWidth = lw;
  line(() => {
    for (let y = 0; y < rows; y++) {
      g.beginPath();
      g.moveTo(x0, y0 + y * c);
      g.lineTo(x1, y0 + y * c);
      g.stroke();
    }
    for (let x = 0; x < cols; x++) {
      g.beginPath();
      if (x === 0 || x === cols - 1) {
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
    for (const [ax, ay, ex, ey] of [
      [3, 0, 5, 2],
      [5, 0, 3, 2],
      [3, 7, 5, 9],
      [5, 7, 3, 9],
    ]) {
      g.beginPath();
      g.moveTo(x0 + ax * c, y0 + ay * c);
      g.lineTo(x0 + ex * c, y0 + ey * c);
      g.stroke();
    }
    // 兵、炮位的小角标
    const tick = (gx: number, gy: number) => {
      const d = c * 0.09;
      const len = c * 0.15;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          if ((gx === 0 && sx < 0) || (gx === cols - 1 && sx > 0)) continue;
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
    for (const [gx, gy] of [
      [1, 2],
      [7, 2],
      [1, 7],
      [7, 7],
    ])
      tick(gx, gy);
  });

  // 8. 纵线号：红方从右往左一～九，黑方从左往右 1～9（中文记谱靠它对位置）
  if (geo.coords) {
    const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `${Math.round(c * 0.25)}px system-ui, sans-serif`;
    const bottomIsRed = !geo.flip;
    for (let x = 0; x < cols; x++) {
      const gx = geo.flip ? cols - 1 - x : x;
      const px = x0 + gx * c;
      g.fillStyle = st.label;
      g.fillText(bottomIsRed ? CN[cols - 1 - x] : String(x + 1), px, y1 + c * 0.7);
      g.globalAlpha = 0.72;
      g.fillText(bottomIsRed ? String(x + 1) : CN[cols - 1 - x], px, y0 - c * 0.7);
      g.globalAlpha = 1;
    }
  }

  // 9. 楚河汉界：用棋子的字体
  const f = fontOf(look);
  const [left, right] = riverText(look);
  g.font = `${f.weight} ${Math.round(c * 0.6 * f.scale)}px ${f.family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const my = y0 + 4.5 * c + c * 0.6 * f.dy;
  for (const [tx, txt] of [
    [x0 + 2 * c, left],
    [x0 + 6 * c, right],
  ] as const) {
    if (st.engrave > 0) {
      g.fillStyle = `rgba(255,248,230,${st.engrave * 0.9})`;
      g.fillText(txt, tx + 0.8, my + 1);
    }
    g.fillStyle = st.river;
    g.fillText(txt, tx, my);
  }
}

/** 四个角上的回纹：两道折线，像家具上的角花 */
function cornerKnots(g: CanvasRenderingContext2D, ax: number, ay: number, bx: number, by: number, s: number, color: string, lw: number) {
  g.save();
  g.strokeStyle = color;
  g.lineWidth = lw;
  g.lineCap = 'square';
  for (const [cx, cy, sx, sy] of [
    [ax, ay, 1, 1],
    [bx, ay, -1, 1],
    [ax, by, 1, -1],
    [bx, by, -1, -1],
  ]) {
    g.beginPath();
    // 外面一道"回"字折线
    g.moveTo(cx + sx * s * 2.2, cy + sy * s * 0.5);
    g.lineTo(cx + sx * s * 0.5, cy + sy * s * 0.5);
    g.lineTo(cx + sx * s * 0.5, cy + sy * s * 2.2);
    g.moveTo(cx + sx * s * 1.5, cy + sy * s * 1.1);
    g.lineTo(cx + sx * s * 1.1, cy + sy * s * 1.1);
    g.lineTo(cx + sx * s * 1.1, cy + sy * s * 1.5);
    g.stroke();
  }
  g.restore();
}

// ───────────────────────── 棋子 ─────────────────────────

interface Side {
  /** 棋面：亮、中、暗 */
  face: [string, string, string];
  /** 字：一个颜色，或者上下两色（金字的渐变） */
  text: string | [string, string];
  /** 字外面那一圈隔离带的颜色 */
  halo: string;
  /** 内圈刻线 */
  ring: string;
  /** 侧边（棋子的厚度） */
  edge: string;
}

export interface PieceStyle {
  id: PieceId;
  name: string;
  desc: string;
  r: Side;
  b: Side;
  /**
   * 棋面的纹理。hardwood：红方黄花梨（行云流水、鬼脸）、黑方紫檀（牛毛纹）；crackle：瓷釉开片；
   * harefur：建盏的兔毫（从盏心往外放射的细丝）；agate：玛瑙一圈圈的缠丝
   */
  tex: 'ivory' | 'wood' | 'jade' | 'metal' | 'paper' | 'hardwood' | 'crackle' | 'harefur' | 'agate' | 'none';
  /** 哪一方是深色棋面：阴刻的字影要换个方向（深色面上压暗看不出，提亮才看得出） */
  dark?: Color[];
  /** 高光 */
  gloss: number;
  /** 字：阴刻（刻进去）、阳刻（凸出来）、墨（洇开一点）、平的 */
  carve: 'deboss' | 'emboss' | 'ink' | 'flat';
  /** 厚度（半径的几分之几） */
  thick: number;
  /** 两道刻线（青花） */
  rings?: number;
}

export const PIECES: PieceStyle[] = [
  {
    id: 'ivory',
    name: '象牙',
    desc: '暖白象牙面，红黑刻字',
    r: { face: ['#fff8e8', '#f3e2bf', '#d8bd90'], text: '#c41d16', halo: '#fff6e2', ring: '#c41d16', edge: '#b59263' },
    b: { face: ['#f8f5ee', '#e8e2d4', '#cbc3ae'], text: '#14283b', halo: '#f6f2ea', ring: '#14283b', edge: '#a59c86' },
    tex: 'ivory',
    gloss: 0.32,
    carve: 'deboss',
    thick: 0.1,
  },
  {
    id: 'boxwood',
    name: '黄杨木',
    desc: '黄杨木刻，木纹看得见，字刻进去上漆',
    r: { face: ['#f3d9a2', '#e2bd7a', '#c4974f'], text: '#a8150e', halo: '#f2d9a6', ring: '#a8150e', edge: '#8c6431' },
    b: { face: ['#efd49b', '#ddb673', '#bf9149'], text: '#1c1712', halo: '#efd6a2', ring: '#1c1712', edge: '#86602f' },
    tex: 'wood',
    gloss: 0.18,
    carve: 'deboss',
    thick: 0.13,
  },
  {
    id: 'jade',
    name: '玉石',
    desc: '红方白玉、黑方墨玉，絮纹透光',
    r: { face: ['#fbfdf6', '#e4ede0', '#c3d3bf'], text: '#bd1f25', halo: '#f2f7ee', ring: '#bd1f25', edge: '#9fb39a' },
    b: { face: ['#4f7563', '#2b4b3d', '#132820'], text: '#eef6ea', halo: '#2b4b3d', ring: '#cfe3d2', edge: '#0d1c16' },
    tex: 'jade',
    gloss: 0.55,
    carve: 'deboss',
    thick: 0.1,
    dark: ['b'],
  },
  {
    id: 'bronze',
    name: '青铜',
    desc: '红方金铜、黑方青铜，车纹铜锈，字是铸出来的',
    r: { face: ['#f6dc98', '#d4a85a', '#94692b'], text: '#7a1408', halo: '#e9c77e', ring: '#7a1408', edge: '#5e4119' },
    b: { face: ['#a9b89a', '#6f8268', '#3d4c3a'], text: '#111a14', halo: '#93a487', ring: '#111a14', edge: '#2a3527' },
    tex: 'metal',
    gloss: 0.45,
    carve: 'emboss',
    thick: 0.12,
  },
  {
    id: 'porcelain',
    name: '青花瓷',
    desc: '白瓷釉面，青花蓝、釉里红，两道细圈',
    r: { face: ['#ffffff', '#f1f4f8', '#d6dde8'], text: '#b0221b', halo: '#ffffff', ring: '#b0221b', edge: '#b9c3d3' },
    b: { face: ['#ffffff', '#eef2f8', '#d2dbe8'], text: '#1d4f9e', halo: '#ffffff', ring: '#1d4f9e', edge: '#b3bfd2' },
    tex: 'none',
    gloss: 0.7,
    carve: 'flat',
    thick: 0.11,
    rings: 2,
  },
  {
    id: 'lacquer',
    name: '漆器',
    desc: '朱漆对黑漆，描金字，亮面',
    r: { face: ['#e04a36', '#b8261a', '#7a120a'], text: ['#fff0b8', '#d9a945'], halo: '#9c1c12', ring: '#f2cf78', edge: '#4e0a05' },
    b: { face: ['#3c3c44', '#1d1d22', '#08080a'], text: ['#fff0b8', '#d9a945'], halo: '#1d1d22', ring: '#e8c56e', edge: '#000000' },
    tex: 'none',
    gloss: 0.62,
    carve: 'emboss',
    thick: 0.12,
    dark: ['b'],
  },
  {
    id: 'ink',
    name: '印章',
    desc: '宣纸面、朱砂和墨写的字，像盖上去的印',
    r: { face: ['#fbf4e2', '#efe4c8', '#dccda8'], text: '#c0321f', halo: '#f6eed8', ring: '#c0321f', edge: '#bcae8c' },
    b: { face: ['#fbf4e2', '#efe4c8', '#dccda8'], text: '#1b1916', halo: '#f6eed8', ring: '#1b1916', edge: '#bcae8c' },
    tex: 'paper',
    gloss: 0,
    carve: 'ink',
    thick: 0.07,
  },
  // 下面四种是"耐看"的：真材料的样子（用户原话："找一些特别美观、赏心悦目的棋子"），不发光
  {
    id: 'zitan',
    name: '紫檀黄花梨',
    desc: '红方黄花梨（金黄、行云流水的纹、带鬼脸），黑方紫檀（紫黑、牛毛纹），朱砂字对描金字',
    r: { face: ['#f2cc86', '#d9a35a', '#a46c2c'], text: '#ad2316', halo: '#e2b26c', ring: '#ad2316', edge: '#74471a' },
    b: { face: ['#5e3a40', '#3b2026', '#1c0d11'], text: ['#f5dfa0', '#c99e4e'], halo: '#3b2026', ring: '#d2ae68', edge: '#110608' },
    tex: 'hardwood',
    gloss: 0.26,
    carve: 'deboss',
    thick: 0.13,
    dark: ['b'],
  },
  {
    id: 'ruyao',
    name: '汝窑天青',
    desc: '天青釉，满面细开片，釉里红对铁褐的字，润得像玉',
    r: { face: ['#e2eee8', '#c4d9d1', '#9db9b1'], text: '#9a2c22', halo: '#d3e4dd', ring: '#9a2c22', edge: '#7e9a93' },
    b: { face: ['#dde9e4', '#bed3cc', '#97b2ab'], text: '#2c3c40', halo: '#cfe0da', ring: '#2c3c40', edge: '#7a958f' },
    tex: 'crackle',
    gloss: 0.34,
    carve: 'deboss',
    thick: 0.11,
  },
  {
    id: 'jianzhan',
    name: '建盏',
    desc: '红方柿红釉，黑方兔毫黑釉（银褐色的细丝从中心放射出去），描金、描银的字',
    r: { face: ['#c96a3e', '#9c3f1f', '#5c1f0d'], text: ['#f8e6b6', '#d6b066'], halo: '#7f3015', ring: '#e0c07a', edge: '#361205' },
    b: { face: ['#3d3733', '#1d1917', '#080706'], text: ['#f0f2f4', '#b8bfc6'], halo: '#1d1917', ring: '#c6cbd0', edge: '#000000' },
    tex: 'harefur',
    gloss: 0.5,
    carve: 'emboss',
    thick: 0.12,
    dark: ['r', 'b'],
  },
  {
    id: 'agate',
    name: '南红玛瑙',
    desc: '红方南红玛瑙，黑方墨玛瑙，一圈圈缠丝，刻字填白',
    r: { face: ['#f07c52', '#c63f28', '#861d12'], text: '#fff3dc', halo: '#b03520', ring: '#ffe4c0', edge: '#5a1109' },
    b: { face: ['#4d4c51', '#27262b', '#0c0c0f'], text: '#f2efe8', halo: '#27262b', ring: '#dcd8ce', edge: '#000000' },
    tex: 'agate',
    gloss: 0.6,
    carve: 'deboss',
    thick: 0.11,
    dark: ['r', 'b'],
  },
  {
    id: 'flat',
    name: '扁平',
    desc: '没有纹理和高光，字最大最清楚',
    r: { face: ['#fdf5e1', '#fdf5e1', '#f2e4c3'], text: '#d01b12', halo: '#fdf5e1', ring: '#d01b12', edge: '#c9ad7c' },
    b: { face: ['#f7f4ec', '#f7f4ec', '#e6e0d0'], text: '#0f2234', halo: '#f7f4ec', ring: '#0f2234', edge: '#b3aa95' },
    tex: 'none',
    gloss: 0,
    carve: 'flat',
    thick: 0.06,
  },
];
export const pieceStyle = (id: PieceId) => PIECES.find((p) => p.id === id) ?? PIECES[0];

/** 棋面纹理：一张带透明度的图，盖在棋面渐变上 */
function pieceTexture(st: PieceStyle, c: Color, size: number, res: number): HTMLCanvasElement | null {
  if (st.tex === 'none') return null;
  return cached(`p|${st.id}|${c}|${Math.round(size)}|${res}`, () => {
    const n1 = makeNoise(c === 'r' ? 911 : 4127);
    const n2 = makeNoise(c === 'r' ? 2333 : 6151);
    const s = size; // 以棋子直径为 1
    return paintPixels(size, size, res, size, (u, v) => {
      const dx = u - 0.5;
      const dy = v - 0.5;
      const rr = Math.hypot(dx, dy);
      switch (st.tex) {
        case 'ivory': {
          // 象牙：极细的颗粒 + 几道若有若无的生长纹
          const grain = n2(u * 60, v * 60) - 0.5;
          const growth = Math.pow(0.5 + 0.5 * Math.sin((rr * 9 + fbm(n1, u * 3, v * 3, 3) * 1.5) * Math.PI * 2), 6);
          return grain > 0 ? [255, 255, 250, grain * 70] : [120, 92, 50, -grain * 60 + growth * 22];
        }
        case 'wood': {
          const warp = fbm(n1, u * 1.6, v * 5, 4) * 1.8;
          const ring = Math.pow(0.5 + 0.5 * Math.sin((v * 7 + warp) * Math.PI * 2), 4);
          const fiber = n2(u * 4, v * 70);
          return [110, 66, 24, ring * 95 + fiber * 40];
        }
        case 'jade': {
          const cloud = fbm(n1, u * 3.2, v * 3.2, 5);
          const ridge = Math.pow(1 - Math.abs(fbm(n2, u * 4 + 3, v * 4, 4) * 2 - 1), 6);
          const lightness = c === 'r' ? [210, 228, 205] : [150, 200, 170];
          return [lightness[0], lightness[1], lightness[2], clamp01((cloud - 0.45) * 1.6) * 110 + ridge * 120];
        }
        case 'metal': {
          // 青铜：同心的车削纹 + 一点点铜锈
          const lathe = 0.5 + 0.5 * Math.sin(rr * 160 + n2(u * 8, v * 8) * 3);
          // 铜锈只在青铜（黑方）上明显；金铜（红方）只在边上一点点，不然像脏了
          const patina = smooth(c === 'r' ? 0.7 : 0.56, c === 'r' ? 0.8 : 0.7, fbm(n1, u * 3.5, v * 3.5, 4)) * (c === 'r' ? smooth(0.32, 0.5, rr) : 1);
          if (patina > 0.05) return c === 'r' ? [70, 140, 110, patina * 90] : [90, 170, 140, patina * 160];
          return lathe > 0.5 ? [255, 244, 210, (lathe - 0.5) * 70] : [40, 26, 8, (0.5 - lathe) * 60];
        }
        case 'paper': {
          const fiber = Math.pow(n2(u * 26, v * 7), 6) * 0.7 + Math.pow(n1(u * 6 + 4, v * 24), 7) * 0.6;
          const mottle = fbm(n1, u * 2, v * 2, 3) - 0.5;
          return [150, 128, 90, clamp01(fiber + mottle * 0.4) * 110];
        }
        case 'hardwood': {
          if (c === 'r') {
            // 黄花梨：行云流水的纹；右上有一处"鬼脸"（树结），纹到那里绕着它一圈圈转
            const kx = u - 0.7;
            const ky = v - 0.28;
            const kr = Math.hypot(kx, ky);
            const blend = Math.exp(-kr * 8);
            const phase = (v * 5.5 + fbm(n1, u * 1.3, v * 3, 4) * 2.2) * (1 - blend) + kr * 15 * blend;
            const line = Math.pow(0.5 + 0.5 * Math.sin(phase * Math.PI * 2), 3);
            return [118, 58, 14, line * 105 + n2(u * 5, v * 80) * 28];
          }
          // 紫檀：牛毛纹——极细极密、几乎顺直，看不出年轮；暗处带一点紫的光
          const fine = Math.pow(n2(u * 3, v * 150 + fbm(n1, u * 2, v * 2, 3) * 9), 3);
          return fine > 0.22 ? [14, 4, 8, fine * 130] : [150, 96, 130, clamp01(fbm(n1, u * 2 + 5, v * 1.2, 3) - 0.5) * 70];
        }
        case 'crackle': {
          // 汝窑开片：大片的线深一点，小片的淡；釉里有几个小气泡
          const [big, small] = crackle(n1, u, v, 3.2);
          const bubble = Math.pow(n2(u * 40, v * 40), 16);
          if (bubble > 0.3) return [246, 252, 250, bubble * 120];
          return [64, 86, 82, big * 120 + small * 48];
        }
        case 'harefur': {
          // 兔毫：从中心往外放射的细丝，外圈密、中心淡。用角度的余弦正弦取噪声，绕一圈首尾接得上
          const ang = Math.atan2(dy, dx);
          const ca = Math.cos(ang);
          const sa = Math.sin(ang);
          const streak = Math.pow(n2(ca * 14 + 50, sa * 14 + rr * 1.5), 3) * 0.8 + Math.pow(n1(ca * 34 + 9, sa * 34 + rr * 3), 4) * 0.7;
          const reach = smooth(0.04, 0.4, rr);
          const col = c === 'r' ? [240, 160, 96] : [214, 186, 150];
          return [col[0], col[1], col[2], clamp01(streak * reach * 1.3) * (c === 'r' ? 170 : 210)];
        }
        case 'agate': {
          // 玛瑙：一圈圈缠丝（层层沉积的带），带子弯弯曲曲；带子之间是半透的"冻"
          const warp = (fbm(n1, u * 1.8, v * 1.8, 4) - 0.5) * 0.4;
          const d = (rr + warp + 0.15) * 46;
          const band = Math.pow(0.5 + 0.5 * Math.sin(d), 6) * 0.8 + Math.pow(0.5 + 0.5 * Math.sin(d * 2.7 + 1), 10) * 0.5;
          const cloud = fbm(n2, u * 2.5 + 3, v * 2.5, 3);
          if (c === 'r') return band > 0.18 ? [255, 200, 160, band * 150] : [110, 14, 6, clamp01(0.58 - cloud) * 130];
          return band > 0.18 ? [210, 210, 220, band * 95] : [0, 0, 0, clamp01(0.5 - cloud) * 90];
        }
      }
      void s;
      return [0, 0, 0, 0];
    });
  });
}

/**
 * 画一个棋子：面心在 (cx, cy)，半径 r。底下的侧边、投影会往下多占 r 的十几分之一。
 */
export function paintPiece(g: CanvasRenderingContext2D, cx: number, cy: number, r: number, t: PType, c: Color, look: Look = getLook(), dpr = 2): void {
  const st = pieceStyle(look.piece);
  const sd = c === 'r' ? st.r : st.b;
  const th = r * st.thick;

  // 1. 投影 + 侧边：棋子有厚度，底下露出一圈侧边
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = Math.max(2, r * 0.22);
  g.shadowOffsetY = Math.max(1, r * 0.1);
  g.fillStyle = sd.edge;
  g.beginPath();
  g.arc(cx, cy + th, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
  const side = g.createLinearGradient(cx - r, 0, cx + r, 0);
  side.addColorStop(0, sd.edge);
  side.addColorStop(0.35, sd.face[2]);
  side.addColorStop(1, sd.edge);
  g.fillStyle = side;
  g.beginPath();
  g.arc(cx, cy + th, r, 0, Math.PI * 2);
  g.fill();

  // 2. 棋面：光从左上来
  const face = g.createRadialGradient(cx - r * 0.38, cy - r * 0.42, r * 0.08, cx, cy, r * 1.15);
  face.addColorStop(0, sd.face[0]);
  face.addColorStop(0.55, sd.face[1]);
  face.addColorStop(1, sd.face[2]);
  g.fillStyle = face;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();

  // 3. 纹理
  const tex = pieceTexture(st, c, r * 2, Math.min(2, dpr));
  if (tex) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, r * 0.995, 0, Math.PI * 2);
    g.clip();
    g.drawImage(tex, cx - r, cy - r, r * 2, r * 2);
    g.restore();
  }

  // 4. 凸起的边沿：左上亮、右下暗
  if (st.id !== 'flat' && st.id !== 'ink') {
    const rim = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
    rim.addColorStop(0, 'rgba(255,255,255,0.65)');
    rim.addColorStop(0.5, 'rgba(255,255,255,0.08)');
    rim.addColorStop(1, 'rgba(0,0,0,0.32)');
    g.strokeStyle = rim;
    g.lineWidth = Math.max(1, r * 0.085);
    g.beginPath();
    g.arc(cx, cy, r * 0.955, 0, Math.PI * 2);
    g.stroke();
    // 边沿和棋面之间那道阴影：边沿是凸起来的
    g.strokeStyle = 'rgba(0,0,0,0.13)';
    g.lineWidth = Math.max(0.6, r * 0.03);
    g.beginPath();
    g.arc(cx, cy, r * 0.905, 0, Math.PI * 2);
    g.stroke();
  }

  // 5. 内圈刻线
  const ringR = st.rings ? [0.84, 0.76] : [0.82];
  for (const k of ringR) {
    const lw = st.rings ? Math.max(0.9, r * 0.04) : Math.max(1.3, r * 0.065);
    if (st.carve === 'deboss') {
      g.strokeStyle = 'rgba(255,255,255,0.5)';
      g.lineWidth = lw;
      g.beginPath();
      g.arc(cx + 0.5, cy + 0.6, r * k, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = sd.ring;
    g.lineWidth = lw;
    g.beginPath();
    if (st.carve === 'ink') {
      // 印章的圈：手画的，粗细不匀
      for (let a = 0; a <= 64; a++) {
        const ang = (a / 64) * Math.PI * 2;
        const wob = 1 + Math.sin(ang * 3 + (c === 'r' ? 0.7 : 2.1)) * 0.012 + Math.sin(ang * 7) * 0.006;
        const px = cx + Math.cos(ang) * r * k * wob;
        const py = cy + Math.sin(ang) * r * k * wob;
        if (a) g.lineTo(px, py);
        else g.moveTo(px, py);
      }
      g.lineWidth = Math.max(1.6, r * 0.08);
    } else g.arc(cx, cy, r * k, 0, Math.PI * 2);
    g.stroke();
  }

  // 6. 字
  const f = fontOf(look);
  const label = glyph(t, c, look);
  const size = Math.round(r * 1.22 * f.scale);
  g.font = `${f.weight} ${size}px ${f.family}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  const ty = cy + size * f.dy;
  // 隔离带：字和棋面之间描一圈棋面色，手机上棋子才五六十像素，字边不糊
  g.strokeStyle = sd.halo;
  g.lineWidth = Math.max(2, r * 0.17);
  g.strokeText(label, cx, ty);
  const fill = Array.isArray(sd.text)
    ? (() => {
        const gr = g.createLinearGradient(0, ty - size / 2, 0, ty + size / 2);
        gr.addColorStop(0, sd.text[0]);
        gr.addColorStop(1, sd.text[1]);
        return gr;
      })()
    : sd.text;
  const o = Math.max(0.6, r * 0.035);
  const darkFace = !!st.dark?.includes(c);
  if (st.carve === 'deboss') {
    // 阴刻：字是凹下去的，左上边缘背光（暗）、右下边缘受光（亮）
    g.fillStyle = darkFace ? 'rgba(0,0,0,0.55)' : 'rgba(40,22,6,0.45)';
    g.fillText(label, cx - o, ty - o);
    g.fillStyle = darkFace ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.75)';
    g.fillText(label, cx + o, ty + o);
  } else if (st.carve === 'emboss') {
    // 阳刻（铸出来、描金堆起来）：左上亮、右下暗
    g.fillStyle = 'rgba(255,255,255,0.45)';
    g.fillText(label, cx - o * 0.8, ty - o * 0.8);
    g.fillStyle = 'rgba(0,0,0,0.5)';
    g.fillText(label, cx + o, ty + o * 1.2);
  } else if (st.carve === 'ink') {
    // 墨：边上洇开一点
    g.save();
    g.shadowColor = typeof sd.text === 'string' ? sd.text : sd.text[1];
    g.shadowBlur = Math.max(1, r * 0.06);
    g.globalAlpha = 0.55;
    g.fillStyle = fill;
    g.fillText(label, cx, ty);
    g.restore();
  }
  g.fillStyle = fill;
  g.fillText(label, cx, ty);

  // 7. 高光：瓷、漆、玉、铜都亮
  if (st.gloss > 0) {
    g.save();
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.clip();
    g.translate(cx - r * 0.3, cy - r * 0.45);
    g.rotate(-0.55);
    g.scale(1, 0.55);
    const hl = g.createRadialGradient(0, 0, 0, 0, 0, r * 0.7);
    hl.addColorStop(0, `rgba(255,255,255,${st.gloss * 0.7})`);
    hl.addColorStop(0.5, `rgba(255,255,255,${st.gloss * 0.22})`);
    hl.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = hl;
    g.beginPath();
    g.arc(0, 0, r * 0.7, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }

  // 8. 外缘一道细线：和盘面分开
  g.strokeStyle = 'rgba(0,0,0,0.28)';
  g.lineWidth = 0.8;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.stroke();
}

