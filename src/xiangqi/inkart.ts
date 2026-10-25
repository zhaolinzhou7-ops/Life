/**
 * 水墨的几样小画（SVG 字符串，现画，零图片文件）：
 *   - splash：一团被湍流撕开毛边的泼墨（结果页"胜""败"背后、对局大字"绝杀"背后）；
 *   - inkBackdrop：对局画面的底，很暗的夜色远山。
 * 以前出场人物（刀客、关公……）也是在这里手画的矢量图；后来出场全换成了用户给的整幅画（intro.ts），那些画就删了。
 */

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** 背景层：竖版 400×800，铺满屏幕（多出来的裁掉） */
const scene = (inner: string) =>
  `<svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/** 毛笔的毛边：湍流把轮廓推歪一点 */
const rough = (id: string, scale = 4, freq = 0.04, seed = 3) =>
  `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;

const blur = (id: string, sd: number) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** 竖直渐变 */
const vgrad = (id: string, stops: [number, string, number?][]) =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${stops
    .map(([o, c, a]) => `<stop offset="${o}" stop-color="${c}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`)
    .join('')}</linearGradient>`;

/**
 * 一列山：几座峰叠在一起，取最高的轮廓；峰顶浓、山脚淡进雾里（水墨山的画法）。
 * sharp 越大峰越尖
 */
function range(id: string, seed: number, base: number, hMin: number, hMax: number, n: number, color: string, alpha: number, sharp = 1.6) {
  const r = rng(seed);
  const pk = Array.from({ length: n }, () => ({ x: -40 + r() * 480, h: hMin + r() * (hMax - hMin), w: 46 + r() * 80 }));
  let d = `M-30 820 L-30 ${base}`;
  for (let x = -30; x <= 430; x += 5) {
    let y = 0;
    for (const p of pk) {
      const u = Math.abs(x - p.x) / p.w;
      if (u < 1) y = Math.max(y, p.h * Math.pow(Math.cos((u * Math.PI) / 2), sharp));
    }
    d += ` L${x} ${n1(base - y + (r() - 0.5) * 2.4)}`;
  }
  d += ' L430 820 Z';
  // 皴笔：峰上几道顺着坡往下的短线（浓一点）
  let strokes = '';
  for (const p of pk) {
    for (let i = 0; i < 3; i++) {
      const sx = p.x + (r() - 0.5) * p.w * 0.6;
      const u = Math.min(0.95, Math.abs(sx - p.x) / p.w);
      const top = base - p.h * Math.pow(Math.cos((u * Math.PI) / 2), sharp) + 6;
      const len = 18 + r() * 34;
      const dir = sx < p.x ? -1 : 1;
      strokes += `M${n1(sx)} ${n1(top)} q${n1(dir * 6)} ${n1(len * 0.5)} ${n1(dir * 3)} ${n1(len)} `;
    }
  }
  return (
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${base - hMax}" x2="0" y2="${base + 70}">` +
    `<stop offset="0" stop-color="${color}" stop-opacity="${alpha}"/><stop offset=".55" stop-color="${color}" stop-opacity="${n1(alpha * 0.55)}"/>` +
    `<stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient>${rough(id + 'r', 5, 0.03, seed)}</defs>` +
    `<g filter="url(#${id}r)"><path d="${d}" fill="url(#${id})"/>` +
    `<path d="${strokes}" fill="none" stroke="${color}" stroke-opacity="${n1(alpha * 0.8)}" stroke-width="1.6" stroke-linecap="round"/></g>`
  );
}

/** 一团雾：几片横着的、很虚的亮色 */
function mistBands(id: string, seed: number, ys: number[], color: string, alpha: number) {
  const r = rng(seed);
  let s = `<defs>${blur(id, 16)}</defs><g filter="url(#${id})" fill="${color}">`;
  for (const y of ys) {
    for (let i = 0; i < 3; i++) {
      s += `<ellipse cx="${n1(-20 + r() * 440)}" cy="${n1(y + (r() - 0.5) * 30)}" rx="${n1(120 + r() * 120)}" ry="${n1(14 + r() * 16)}" opacity="${n1(alpha * (0.6 + r() * 0.4))}"/>`;
    }
  }
  return s + '</g>';
}

/** 泼墨：一团被湍流撕开毛边的墨，四周甩出墨点（结果页"绝杀""胜""败"背后也用这一团） */
export function splash(p: string, seed: number, inner: string, outer: string, dots: string) {
  const r = rng(seed);
  let drops = '';
  for (let i = 0; i < 26; i++) {
    const a = r() * Math.PI * 2;
    const d = 130 + r() * 70;
    const rr = 1.5 + r() * r() * 9;
    drops += `<circle cx="${n1(200 + Math.cos(a) * d)}" cy="${n1(200 + Math.sin(a) * d * 0.9)}" r="${n1(rr)}"/>`;
  }
  // 几道甩出去的墨痕
  let flicks = '';
  for (let i = 0; i < 7; i++) {
    const a = r() * Math.PI * 2;
    const d0 = 95 + r() * 20;
    const d1 = d0 + 40 + r() * 60;
    const w = 4 + r() * 7;
    const x0 = 200 + Math.cos(a) * d0;
    const y0 = 200 + Math.sin(a) * d0;
    const x1 = 200 + Math.cos(a) * d1;
    const y1 = 200 + Math.sin(a) * d1;
    const nx = -Math.sin(a) * w;
    const ny = Math.cos(a) * w;
    flicks += `M${n1(x0 + nx)} ${n1(y0 + ny)} L${n1(x1)} ${n1(y1)} L${n1(x0 - nx)} ${n1(y0 - ny)} Z `;
  }
  return (
    `<svg viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg" overflow="visible"><defs>` +
    `<radialGradient id="${p}g" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="${inner}"/><stop offset=".62" stop-color="${outer}"/><stop offset="1" stop-color="${outer}" stop-opacity=".55"/></radialGradient>` +
    `<filter id="${p}f" x="-30%" y="-30%" width="160%" height="160%"><feTurbulence type="fractalNoise" baseFrequency=".018" numOctaves="4" seed="${seed}" result="t"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="t" scale="78" xChannelSelector="R" yChannelSelector="G"/></filter>` +
    `${rough(p + 'r', 6, 0.08, seed + 1)}</defs>` +
    `<g filter="url(#${p}f)"><ellipse cx="200" cy="200" rx="128" ry="118" fill="url(#${p}g)"/><ellipse cx="150" cy="150" rx="70" ry="52" fill="${outer}" opacity=".7"/>` +
    `<ellipse cx="262" cy="248" rx="62" ry="44" fill="${outer}" opacity=".65"/></g>` +
    `<g fill="${dots}" filter="url(#${p}r)">${drops}<path d="${flicks}"/></g></svg>`
  );
}

/**
 * 对局画面的底：深青色的夜，远处两列水墨山、一条雾，右上一轮很淡的月亮。
 * 颜色压得很暗、对比很低——棋盘才是主角，这一层只让四周不再是一块平涂的底色
 */
export function inkBackdrop(): string {
  const p = 'bg';
  const raw = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#1f2d3a'], [0.5, '#182430'], [1, '#111a24']])}` +
      `<radialGradient id="${p}mh" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#dfe8f0" stop-opacity=".16"/><stop offset="1" stop-color="#dfe8f0" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/>` +
      `<radialGradient id="${p}mn" cx=".42" cy=".4" r=".6"><stop offset="0" stop-color="#e6eef4" stop-opacity=".1"/><stop offset=".8" stop-color="#e6eef4" stop-opacity=".06"/><stop offset="1" stop-color="#e6eef4" stop-opacity="0"/></radialGradient>` +
      `<circle cx="318" cy="118" r="110" fill="url(#${p}mh)"/><circle cx="318" cy="118" r="36" fill="url(#${p}mn)"/>` +
      range(p + 'f', 51, 640, 60, 170, 7, '#0b121a', 0.5, 1.4) +
      mistBands(p + 'mi', 19, [650], '#9fb4c8', 0.05) +
      range(p + 'm', 57, 740, 30, 110, 6, '#080d13', 0.7, 1.9),
  );
  return raw;
}
