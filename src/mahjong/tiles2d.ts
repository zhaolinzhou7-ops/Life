/** 麻将 2D 牌面绘制：程序化牌图 + 立体厚度，供 2.5D 布局渲染使用 */
import { rankOf, suitOf, type TileId } from './rules';

/** 牌面图案（高分辨率离屏缓存，绘制时缩放） */
const FACE_W = 132;
const FACE_H = 200; // 贴近立牌 1.5 的高宽比，缩放时不变形
const faceCache = new Map<number, HTMLCanvasElement>();

function renderFace(t: TileId): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const dpr = 2;
  cv.width = FACE_W * dpr;
  cv.height = FACE_H * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);
  const W = FACE_W;
  const H = FACE_H;

  // 透明底：象牙面由牌体精灵负责。若在这里填底色，刻痕用的偏移拷贝
  // 会把不透明底一层层叠上来，图案颜色会被洗白。

  const s = suitOf(t);
  const r = rankOf(t);
  const CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

  if (s === 0) {
    // 万：上数字下"萬"（放大 + 描边，小尺寸下也看得清）
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineJoin = 'round';
    const glyph = (ch: string, cy: number, size: number, col: string, bold: number) => {
      g.font = `bold ${size}px "KaiTi","STKaiti","SimHei",serif`;
      if (bold > 0) {
        g.lineWidth = size * bold;
        g.strokeStyle = col;
        g.strokeText(ch, W / 2, cy);
      }
      g.fillStyle = col;
      g.fillText(ch, W / 2, cy);
    };
    // 数字占主视觉（远看就靠它认牌）；「萬」笔画密，缩小且不描边，否则小尺寸下会糊成一坨
    glyph(CN[r - 1], H * 0.3, W * 0.66, '#c0392b', 0.05);
    glyph('萬', H * 0.775, W * 0.42, '#17357d', 0);
  } else if (s === 2) {
    // 筒：同心圆阵列
    const dot = (cx: number, cy: number, rad: number, col: string) => {
      const dg = g.createRadialGradient(cx - rad * 0.3, cy - rad * 0.3, rad * 0.1, cx, cy, rad);
      dg.addColorStop(0, col);
      dg.addColorStop(1, shade(col, -40));
      g.fillStyle = dg;
      g.beginPath();
      g.arc(cx, cy, rad, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2;
      g.strokeStyle = 'rgba(0,0,0,0.3)';
      g.stroke();
      g.beginPath();
      g.arc(cx, cy, rad * 0.42, 0, Math.PI * 2);
      g.fillStyle = '#fdf8ec';
      g.fill();
    };
    const C = ['#1b56b8', '#c0392b', '#1e8449'];
    const cx = W / 2;
    const cy = H / 2;
    if (r === 1) {
      dot(cx, cy, W * 0.3, '#c0392b');
    } else {
      const layouts: Record<number, [number, number][]> = {
        2: [[0, -1], [0, 1]],
        3: [[-1, -1.1], [0, 0], [1, 1.1]],
        4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
        5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
        6: [[-1, -1.15], [1, -1.15], [-1, 0], [1, 0], [-1, 1.15], [1, 1.15]],
        7: [[-1, -1.5], [0, -1.2], [1, -0.9], [-1, 0.25], [1, 0.25], [-1, 1.4], [1, 1.4]],
        8: [[-1, -1.5], [1, -1.5], [-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5], [-1, 1.5], [1, 1.5]],
        9: [[-1, -1.15], [0, -1.15], [1, -1.15], [-1, 0], [0, 0], [1, 0], [-1, 1.15], [0, 1.15], [1, 1.15]],
      };
      const rad = r <= 4 ? W * 0.18 : W * 0.128;
      const sp = r <= 4 ? W * 0.25 : r <= 6 ? W * 0.215 : W * 0.185;
      layouts[r].forEach(([gx, gy], i) => dot(cx + gx * sp, cy + gy * sp * 1.15, rad, C[i % 3]));
    }
  } else {
    // 条：竹节（1 条为雀鸟）
    if (r === 1) {
      // 简笔雀鸟
      g.fillStyle = '#1e8449';
      g.beginPath();
      g.ellipse(W / 2, H * 0.55, W * 0.17, H * 0.16, 0, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(W / 2 + W * 0.02, H * 0.36, W * 0.1, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#c0392b';
      g.beginPath();
      g.moveTo(W / 2 + W * 0.11, H * 0.35);
      g.lineTo(W / 2 + W * 0.24, H * 0.39);
      g.lineTo(W / 2 + W * 0.11, H * 0.42);
      g.closePath();
      g.fill();
      // 尾羽
      g.strokeStyle = '#1e8449';
      g.lineWidth = W * 0.045;
      g.lineCap = 'round';
      for (const a of [-0.35, 0, 0.35]) {
        g.beginPath();
        g.moveTo(W / 2 - W * 0.1, H * 0.63);
        g.lineTo(W / 2 - W * 0.3, H * 0.78 + a * H * 0.1);
        g.stroke();
      }
      g.fillStyle = '#fff';
      g.beginPath();
      g.arc(W / 2 + W * 0.05, H * 0.34, W * 0.025, 0, Math.PI * 2);
      g.fill();
    } else {
      const stick = (cx: number, cy: number, col: string, len: number) => {
        const sg = g.createLinearGradient(cx - 6, cy, cx + 6, cy);
        sg.addColorStop(0, shade(col, -25));
        sg.addColorStop(0.4, col);
        sg.addColorStop(1, shade(col, -35));
        g.fillStyle = sg;
        g.beginPath();
        g.roundRect(cx - W * 0.062, cy - len / 2, W * 0.124, len, W * 0.05);
        g.fill();
        // 竹节
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(cx - W * 0.062, cy - len * 0.18);
        g.lineTo(cx + W * 0.062, cy - len * 0.18);
        g.moveTo(cx - W * 0.062, cy + len * 0.18);
        g.lineTo(cx + W * 0.062, cy + len * 0.18);
        g.stroke();
      };
      const C = ['#1e8449', '#c0392b', '#1b56b8'];
      const rows: Record<number, [number, number][]> = {
        2: [[0, -0.62], [0, 0.62]],
        3: [[0, -0.95], [0, 0], [0, 0.95]],
        4: [[-0.55, -0.62], [0.55, -0.62], [-0.55, 0.62], [0.55, 0.62]],
        5: [[-0.62, -0.78], [0.62, -0.78], [0, 0], [-0.62, 0.78], [0.62, 0.78]],
        6: [[-0.66, -0.72], [0, -0.72], [0.66, -0.72], [-0.66, 0.72], [0, 0.72], [0.66, 0.72]],
        7: [[0, -1.05], [-0.66, -0.1], [0, -0.1], [0.66, -0.1], [-0.66, 0.88], [0, 0.88], [0.66, 0.88]],
        8: [[-0.66, -1.0], [0, -1.0], [0.66, -1.0], [-0.33, 0], [0.33, 0], [-0.66, 1.0], [0, 1.0], [0.66, 1.0]],
        9: [[-0.66, -1.0], [0, -1.0], [0.66, -1.0], [-0.66, 0], [0, 0], [0.66, 0], [-0.66, 1.0], [0, 1.0], [0.66, 1.0]],
      };
      const len = r <= 3 ? H * 0.26 : H * 0.24;
      rows[r].forEach(([gx, gy], i) => stick(W / 2 + gx * W * 0.28, H / 2 + gy * H * 0.27, C[i % 3], len));
    }
  }
  faceCacheStore(t, cv);
  return cv;
}

function faceCacheStore(t: TileId, cv: HTMLCanvasElement) {
  faceCache.set(t, cv);
}

export function faceImage(t: TileId): HTMLCanvasElement {
  return faceCache.get(t) ?? renderFace(t);
}

/** 图案的单色剪影（黑/白），用来做刻进牌面的暗影与受光边 */
const tintCache = new Map<string, HTMLCanvasElement>();
function faceTinted(t: TileId, color: string): HTMLCanvasElement {
  const key = t + color;
  const hit = tintCache.get(key);
  if (hit) return hit;
  const src = faceImage(t);
  const cv = document.createElement('canvas');
  cv.width = src.width;
  cv.height = src.height;
  const g = cv.getContext('2d')!;
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in'; // 只保留图案形状，整体换成单色
  g.fillStyle = color;
  g.fillRect(0, 0, cv.width, cv.height);
  tintCache.set(key, cv);
  return cv;
}

function shade(hex: string, amt: number) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.roundRect(x, y, w, h, r);
}

export interface TileStyle {
  /** 抬起高度（选中） */
  lift?: number;
  /** 是否变暗（不可打/已弃） */
  dim?: boolean;
  /** 高亮边框色 */
  glow?: string;
}

// ---------------- 材质纹理 ----------------

/**
 * 质感的三个来源：统一的光照方向、材质本身的细微纹理、以及接触阴影。
 * 原来的牌是纯色圆角矩形 + 一道线性渐变，所以看着像矢量插画而不是实物。
 * 全场光都假定来自左上方。
 */

/** 象牙细纹（一次生成，之后当图案平铺） */
let grainPat: CanvasPattern | null = null;
function grain(g: CanvasRenderingContext2D): CanvasPattern | null {
  if (grainPat) return grainPat;
  const n = 64;
  const cv = document.createElement('canvas');
  cv.width = n;
  cv.height = n;
  const c2 = cv.getContext('2d')!;
  const img = c2.createImageData(n, n);
  for (let i = 0; i < n * n; i++) {
    // 偏暖的细颗粒：象牙/胶木表面的微观不均匀
    const v = 128 + (Math.random() - 0.5) * 46;
    img.data[i * 4] = v + 6;
    img.data[i * 4 + 1] = v + 2;
    img.data[i * 4 + 2] = v - 4;
    img.data[i * 4 + 3] = 255;
  }
  c2.putImageData(img, 0, 0);
  grainPat = g.createPattern(cv, 'repeat');
  return grainPat;
}

/** 已渲染好的牌面精灵：材质计算只做一次，之后逐帧只是一次 drawImage */
const spriteCache = new Map<number, { cv: HTMLCanvasElement; pad: number }>();

function tileSprite(t: TileId, w: number, h: number) {
  const wi = Math.round(w);
  const hi = Math.round(h);
  const key = t * 1000000 + wi * 1000 + hi;
  const hit = spriteCache.get(key);
  if (hit) return hit;

  const dpr = 2;
  const pad = Math.ceil(Math.max(3, w * 0.22)); // 给阴影留出余量
  const cv = document.createElement('canvas');
  cv.width = (wi + pad * 2) * dpr;
  cv.height = (hi + pad * 2) * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr);

  const x = pad;
  const y = pad;
  const depth = Math.max(2, hi * 0.12);
  const r = Math.max(2, wi * 0.15);
  const bevel = Math.max(1, wi * 0.075);

  // 1) 接触阴影：随高度偏移并模糊，物体因此"落"在桌面上
  g.save();
  g.shadowColor = 'rgba(0,0,0,0.42)';
  g.shadowBlur = Math.max(2.5, wi * 0.16);
  g.shadowOffsetX = wi * 0.045;
  g.shadowOffsetY = wi * 0.09;
  g.fillStyle = '#000';
  roundRect(g, x, y + depth * 0.4, wi, hi, r);
  g.fill();
  g.restore();

  // 2) 牌体侧面（厚度）：底部比顶面暗，才有立体
  const sg = g.createLinearGradient(x, y + hi - depth, x, y + hi + depth);
  sg.addColorStop(0, '#d8cdb0');
  sg.addColorStop(1, '#a2977c');
  g.fillStyle = sg;
  roundRect(g, x, y + hi - depth * 0.6, wi, depth * 1.6, r * 0.8);
  g.fill();

  // 3) 倒角环：左上受光、右下背光，这一圈是"厚度"的关键
  const bg = g.createLinearGradient(x, y, x + wi * 0.9, y + hi);
  bg.addColorStop(0, '#fffefb');
  bg.addColorStop(0.45, '#f4ead1');
  bg.addColorStop(1, '#c8bda0');
  g.fillStyle = bg;
  roundRect(g, x, y, wi, hi, r);
  g.fill();

  // 4) 顶面（内缩一个倒角宽度）
  const fg = g.createLinearGradient(x, y, x + wi * 0.4, y + hi);
  fg.addColorStop(0, '#fffdf6');
  fg.addColorStop(0.5, '#faf2df');
  fg.addColorStop(1, '#efe4c9');
  g.fillStyle = fg;
  roundRect(g, x + bevel, y + bevel * 0.7, wi - bevel * 2, hi - depth * 0.5 - bevel * 1.4, r * 0.7);
  g.fill();

  // 4b) 凹槽边缘：真麻将牌的字面是内凹的，凸起的边框会在上/左投下一道暗边，
  //     下/右则被反射光提亮。这一对明暗是"牌"最容易被认出来的特征。
  {
    const pxx = x + bevel;
    const pyy = y + bevel * 0.7;
    const pw = wi - bevel * 2;
    const ph = hi - depth * 0.5 - bevel * 1.4;
    const lip = Math.max(0.8, wi * 0.06);
    g.save();
    roundRect(g, pxx, pyy, pw, ph, r * 0.7);
    g.clip();
    const shTop = g.createLinearGradient(0, pyy, 0, pyy + lip);
    shTop.addColorStop(0, 'rgba(122,100,58,0.34)');
    shTop.addColorStop(1, 'rgba(122,100,58,0)');
    g.fillStyle = shTop;
    g.fillRect(pxx, pyy, pw, lip);
    const shLeft = g.createLinearGradient(pxx, 0, pxx + lip, 0);
    shLeft.addColorStop(0, 'rgba(122,100,58,0.26)');
    shLeft.addColorStop(1, 'rgba(122,100,58,0)');
    g.fillStyle = shLeft;
    g.fillRect(pxx, pyy, lip, ph);
    const hiBot = g.createLinearGradient(0, pyy + ph - lip, 0, pyy + ph);
    hiBot.addColorStop(0, 'rgba(255,255,255,0)');
    hiBot.addColorStop(1, 'rgba(255,255,255,0.62)');
    g.fillStyle = hiBot;
    g.fillRect(pxx, pyy + ph - lip, pw, lip);
    const hiRight = g.createLinearGradient(pxx + pw - lip, 0, pxx + pw, 0);
    hiRight.addColorStop(0, 'rgba(255,255,255,0)');
    hiRight.addColorStop(1, 'rgba(255,255,255,0.5)');
    g.fillStyle = hiRight;
    g.fillRect(pxx + pw - lip, pyy, lip, ph);
    g.restore();
  }

  // 5) 象牙细纹：叠一层极淡的颗粒，消掉"纯色塑料"感
  const pat = grain(g);
  if (pat) {
    g.save();
    roundRect(g, x + bevel, y + bevel * 0.7, wi - bevel * 2, hi - depth * 0.5 - bevel * 1.4, r * 0.7);
    g.clip();
    g.globalAlpha = 0.09;
    g.globalCompositeOperation = 'overlay';
    g.fillStyle = pat;
    g.fillRect(x, y, wi, hi);
    g.restore();
  }

  // 6) 牌面图案，做成刻进牌里的：
  //    右下压一道暗影（凹槽底），左上补一道受光边（凹槽上沿），最后盖原色图案
  const img = faceImage(t);
  const ipad = wi * 0.055;
  const iw = wi - ipad * 2;
  const ih = hi - depth * 0.85 - ipad * 1.9;
  const ix = x + ipad;
  const iy = y + ipad * 0.9;
  const off = Math.max(0.45, wi * 0.02);
  g.save();
  g.globalAlpha = 0.3;
  g.drawImage(faceTinted(t, '#4a3a1e'), ix + off, iy + off, iw, ih);
  g.globalAlpha = 0.5;
  g.drawImage(faceTinted(t, '#ffffff'), ix - off * 0.8, iy - off * 0.8, iw, ih);
  g.restore();
  g.drawImage(img, ix, iy, iw, ih);

  // 7) 顶面斜向高光：一道很淡的清漆反光
  g.save();
  roundRect(g, x + bevel, y + bevel * 0.7, wi - bevel * 2, hi - depth * 0.5 - bevel * 1.4, r * 0.7);
  g.clip();
  const sheen = g.createLinearGradient(x, y, x + wi * 1.1, y + hi * 0.8);
  sheen.addColorStop(0, 'rgba(255,255,255,0.20)');
  sheen.addColorStop(0.34, 'rgba(255,255,255,0.05)');
  sheen.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sheen;
  g.fillRect(x, y, wi, hi);
  g.restore();

  // 8) 外轮廓：极细的暗边，把牌从背景上"切"出来
  g.lineWidth = 0.9;
  g.strokeStyle = 'rgba(96,76,42,0.5)';
  roundRect(g, x + 0.45, y + 0.45, wi - 0.9, hi - 0.9, r);
  g.stroke();

  const rec = { cv, pad };
  if (spriteCache.size > 900) spriteCache.clear();
  spriteCache.set(key, rec);
  return rec;
}

/**
 * 画一张正面朝上的立牌。
 * x,y 为牌面左上角，w,h 为牌面尺寸。材质走离屏精灵缓存，逐帧只 drawImage。
 */
export function drawTile(
  g: CanvasRenderingContext2D,
  t: TileId,
  x: number,
  y: number,
  w: number,
  h: number,
  st: TileStyle = {},
) {
  const lift = st.lift ?? 0;
  const ty = y - lift;
  const sp = tileSprite(t, w, h);
  const wi = Math.round(w);
  const hi = Math.round(h);
  const r = Math.max(2, wi * 0.15);

  g.drawImage(sp.cv, x - sp.pad, ty - sp.pad, wi + sp.pad * 2, hi + sp.pad * 2);

  if (st.dim) {
    g.save();
    g.fillStyle = 'rgba(10,20,14,0.42)';
    roundRect(g, x, ty, wi, hi, r);
    g.fill();
    g.restore();
  }
  if (st.glow) {
    g.save();
    g.lineWidth = 2.2;
    g.strokeStyle = st.glow;
    g.shadowColor = st.glow;
    g.shadowBlur = 10;
    roundRect(g, x + 1, ty + 1, wi - 2, hi - 2, r);
    g.stroke();
    g.restore();
  }
}

/** 画牌背（立着的，用于对家/左右家手牌） */
export function drawBack(
  g: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  vertical = false,
) {
  const r = Math.max(2, Math.min(w, h) * 0.16);
  g.save();
  g.fillStyle = 'rgba(0,0,0,0.25)';
  roundRect(g, x + 1, y + 2, w, h, r);
  g.fill();
  // 牌背绿色
  const bg = g.createLinearGradient(x, y, vertical ? x + w : x, vertical ? y : y + h);
  bg.addColorStop(0, '#3aa876');
  bg.addColorStop(1, '#1f7a52');
  g.fillStyle = bg;
  roundRect(g, x, y, w, h, r);
  g.fill();
  // 象牙侧条
  g.fillStyle = '#efe6d0';
  if (vertical) roundRect(g, x + w * 0.74, y, w * 0.26, h, r * 0.6);
  else roundRect(g, x, y + h * 0.74, w, h * 0.26, r * 0.6);
  g.fill();
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(0,0,0,0.25)';
  roundRect(g, x + 0.5, y + 0.5, w - 1, h - 1, r);
  g.stroke();
  g.restore();
}

