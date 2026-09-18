/**
 * 进步曲线的图。
 *
 * 只画一种图：随局数变化的折线（每局一个点 + 滚动平均一条线）。
 * 两条线共用一个纵轴（都是正确率），**绝不加第二个纵轴**——
 * 双轴是最容易骗人的图表形式，两条曲线的交叉点完全由刻度决定，没有含义。
 *
 * 配色用 scripts/validate_palette.js 在本应用的深色底（#161e27）上验过：
 *   #2aa87a / #4a8fd4 —— CVD 分离度 ΔE 15.6（deutan）、常视觉 17.5、对比度均 ≥3:1。
 * 两条线除了颜色还各自带直接标注和不同的笔触（点 vs 实线），
 * 所以色觉障碍用户也能分清，不靠颜色单独承载信息。
 */

import { el } from './common';
import type { ProgressPoint } from '../profile/progress';

const C_POINT = '#2aa87a'; // 每局正确率
const C_ROLL = '#4a8fd4'; // 滚动平均

const W = 320;
const H = 116;
// 左边距要放得下「100%」这四个字符，26 会把 1 切掉
const PAD = { l: 33, r: 10, t: 10, b: 18 };

export interface TrendOptions {
  points: ProgressPoint[];
  /** 滚动窗口，用于图例文案 */
  window: number;
}

export function trendChart(o: TrendOptions): HTMLElement {
  const pts = o.points;
  // 顶部留出一条给悬停提示，免得它压在曲线上
  const box = el('div', { style: 'position:relative;padding-top:28px' });

  if (pts.length < 3) {
    box.style.paddingTop = '0';
    box.appendChild(el('div.mc-empty', { style: 'padding:22px 10px', text: '打满 3 局之后这里会出现进步曲线。' }));
    return box;
  }

  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const x = (n: number) => PAD.l + (pts.length === 1 ? innerW / 2 : ((n - 1) / (pts.length - 1)) * innerW);
  const y = (v: number) => PAD.t + (1 - v) * innerH;

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', '100%');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `进步曲线：${pts.length} 局的决策正确率变化`);
  svg.style.cssText = 'display:block;height:auto;touch-action:pan-y';

  const add = (tag: string, attrs: Record<string, string | number>) => {
    const n = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    svg.appendChild(n);
    return n;
  };

  // 网格：只留 0/50/100 三条，且做得很淡——它是背景，不是内容
  for (const v of [0, 0.5, 1]) {
    add('line', {
      x1: PAD.l, x2: W - PAD.r, y1: y(v), y2: y(v),
      stroke: 'rgba(255,255,255,.08)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke',
    });
    add('text', {
      x: PAD.l - 5, y: y(v) + 3, 'text-anchor': 'end',
      fill: '#7d8a99', 'font-size': 8.5,
    }).textContent = `${v * 100}%`;
  }

  // 每局的点：细、小、不连线——它是原始数据，噪声大，不该抢戏
  for (const p of pts) {
    add('circle', { cx: x(p.n), cy: y(p.accuracy), r: 2.2, fill: C_POINT, opacity: 0.75 });
  }

  // 滚动平均：2px 实线，这条才是趋势
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.n).toFixed(1)},${y(p.rolling).toFixed(1)}`).join(' ');
  add('path', {
    d, fill: 'none', stroke: C_ROLL, 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round', 'vector-effect': 'non-scaling-stroke',
  });

  // 末点加一个环，并直接标数值——不给每个点标数字，只标最新的那个
  const last = pts[pts.length - 1];
  add('circle', { cx: x(last.n), cy: y(last.rolling), r: 3.6, fill: C_ROLL, stroke: '#161e27', 'stroke-width': 2 });
  const lbl = add('text', {
    x: Math.min(W - PAD.r, x(last.n) + 6), y: Math.max(PAD.t + 8, y(last.rolling) - 6),
    'text-anchor': x(last.n) > W - 60 ? 'end' : 'start',
    fill: '#e9eef4', 'font-size': 10, 'font-weight': 600,
  });
  lbl.textContent = `${Math.round(last.rolling * 100)}%`;

  // 横轴：只标首尾，中间的局数不重要
  add('text', { x: PAD.l, y: H - 5, fill: '#7d8a99', 'font-size': 8.5 }).textContent = `第 1 局`;
  add('text', { x: W - PAD.r, y: H - 5, 'text-anchor': 'end', fill: '#7d8a99', 'font-size': 8.5 }).textContent =
    `第 ${last.n} 局`;

  // ---------- 悬停 / 点按 ----------
  const tip = el('div', {
    style:
      'position:absolute;pointer-events:none;opacity:0;transition:opacity .12s;background:rgba(20,28,36,.97);' +
      'border:1px solid #2b3846;border-radius:8px;padding:5px 9px;font-size:11.5px;white-space:nowrap;z-index:5',
  });
  const cross = add('line', {
    x1: 0, x2: 0, y1: PAD.t, y2: H - PAD.b,
    stroke: 'rgba(255,255,255,.22)', 'stroke-width': 1, opacity: 0, 'vector-effect': 'non-scaling-stroke',
  });

  const pick = (clientX: number) => {
    const rect = svg.getBoundingClientRect();
    const vx = ((clientX - rect.left) / rect.width) * W;
    let best = pts[0];
    for (const p of pts) if (Math.abs(x(p.n) - vx) < Math.abs(x(best.n) - vx)) best = p;
    cross.setAttribute('x1', String(x(best.n)));
    cross.setAttribute('x2', String(x(best.n)));
    cross.setAttribute('opacity', '1');
    tip.textContent =
      `第 ${best.n} 局 · 正确率 ${Math.round(best.accuracy * 100)}% · 平均 ${Math.round(best.rolling * 100)}%` +
      ` · ${best.won ? '胡牌' : '没胡'} ${best.score > 0 ? '+' : ''}${best.score}`;
    tip.style.opacity = '1';
    // 用实测宽度夹住，写死一个数字迟早会在别的字号下溢出卡片
    const px = (x(best.n) / W) * rect.width;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(Math.max(0, rect.width - tw), px - tw / 2))}px`;
    tip.style.top = '0px';
  };
  const hide = () => {
    tip.style.opacity = '0';
    cross.setAttribute('opacity', '0');
  };
  svg.addEventListener('pointermove', (e) => pick((e as PointerEvent).clientX));
  svg.addEventListener('pointerdown', (e) => pick((e as PointerEvent).clientX));
  svg.addEventListener('pointerleave', hide);

  box.append(svg, tip);

  // 图例：两条系列一定要有图例，颜色不能是唯一的区分手段
  const legend = el('div', {
    style: 'display:flex;gap:14px;justify-content:center;margin-top:6px;font-size:11.5px;color:var(--mc-muted)',
  });
  const item = (color: string, shape: 'dot' | 'line', text: string) => {
    const wrap = el('span', { style: 'display:inline-flex;align-items:center;gap:5px' });
    wrap.appendChild(
      el('span', {
        style:
          shape === 'dot'
            ? `width:7px;height:7px;border-radius:50%;background:${color};display:inline-block`
            : `width:14px;height:2px;background:${color};display:inline-block`,
      }),
    );
    wrap.appendChild(el('span', { text }));
    return wrap;
  };
  legend.append(item(C_POINT, 'dot', '每局'), item(C_ROLL, 'line', `${o.window} 局平均`));
  box.appendChild(legend);

  return box;
}
