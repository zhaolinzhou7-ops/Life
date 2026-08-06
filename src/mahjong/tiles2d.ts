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

  // 象牙底 + 顶部高光
  const grad = g.createLinearGradient(0, 0, W * 0.4, H);
  grad.addColorStop(0, '#fffdf6');
  grad.addColorStop(0.45, '#fbf3e0');
  grad.addColorStop(1, '#f2e6cc');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

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

/**
 * 画一张正面朝上的立牌（带底部厚度，2.5D 立体感）。
 * x,y 为牌面左上角，w,h 为牌面尺寸。
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
  const depth = Math.max(2, h * 0.13); // 底部厚度
  const r = Math.max(2, w * 0.14);

  g.save();
  // 投影
  g.fillStyle = 'rgba(0,0,0,0.28)';
  roundRect(g, x + 1, ty + depth * 0.7, w, h, r);
  g.fill();

  // 侧面（厚度）
  g.fillStyle = '#c9bfa4';
  roundRect(g, x, ty + h - depth, w, depth * 2, r);
  g.fill();

  // 牌面
  const fg = g.createLinearGradient(x, ty, x, ty + h);
  fg.addColorStop(0, '#fffdf7');
  fg.addColorStop(1, '#f0e6cf');
  g.fillStyle = fg;
  roundRect(g, x, ty, w, h, r);
  g.fill();

  // 图案（留白压到最小，牌面尽量占满）
  const img = faceImage(t);
  const pad = w * 0.04;
  g.drawImage(img, x + pad, ty + pad, w - pad * 2, h - depth * 0.8 - pad * 2);

  // 边框
  g.lineWidth = 1;
  g.strokeStyle = 'rgba(120,96,52,0.45)';
  roundRect(g, x + 0.5, ty + 0.5, w - 1, h - 1, r);
  g.stroke();

  if (st.dim) {
    g.fillStyle = 'rgba(10,20,14,0.42)';
    roundRect(g, x, ty, w, h, r);
    g.fill();
  }
  if (st.glow) {
    g.lineWidth = 2.4;
    g.strokeStyle = st.glow;
    g.shadowColor = st.glow;
    g.shadowBlur = 10;
    roundRect(g, x + 1, ty + 1, w - 2, h - 2, r);
    g.stroke();
    g.shadowBlur = 0;
  }
  g.restore();
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

