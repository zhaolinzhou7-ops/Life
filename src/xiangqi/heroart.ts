/**
 * 出场人物的画：五个人物、五张水墨场景，全是手写的矢量图（SVG），零图片文件。
 *
 * 用户原话："出场动画：可以多一些不同的选择，比如关羽、哪吒这类 3D 神话人物的出场。整体仪式感要强一些，
 * 有水墨画、流光溢彩的感觉，做出那种非常美观的江湖侠气……或者找戴着斗笠、背后一把刀这类风格的图片。"
 *
 * 网上的人物图拿不准版权，所以自己画：人物是水墨剪影（轮廓有毛笔的毛边），身上只点几处颜色——
 * 关公的红脸绿巾、哪吒的混天绫和风火轮、女侠的白衣红穗、大圣的金箍棒和虎皮裙、刀客的红刀穗；
 * 背后一团泼墨。场景分成远山、中景、雾、近景几层，intro.ts 把它们摆进 3D 空间里、镜头往前推，
 * 各层移得快慢不同，就有了纵深（不是 3D 模型，是一层层画片的视差）。
 *
 * 每张画都是一个完整的 <svg> 字符串。id 都带前缀（人物 + 层），同一页里放几张也不会串。
 * 衣角、刀穗、飘带用 SVG 自带的动画（SMIL）飘；人物身上那道"流光"是一条斜着扫过去的亮带，只扫在人物身上。
 */

export type HeroId = 'daoke' | 'guangong' | 'nezha' | 'nvxia' | 'dasheng';

export interface HeroArt {
  /** 天空（最远，几乎不动） */
  sky: string;
  /** 远山 */
  far: string;
  /** 中景 */
  mid: string;
  /** 雾（单独一层，横着飘） */
  mist: string;
  /** 人物背后那一团泼墨 */
  splash: string;
  /** 人物 */
  fig: string;
  /** 近景（离镜头最近，虚一点） */
  near: string;
}

// ───────────────────────── 小工具 ─────────────────────────

const rng = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const n1 = (v: number) => (Math.round(v * 10) / 10).toString();

/** 背景层：竖版 400×800，铺满屏幕（多出来的裁掉） */
const scene = (inner: string) =>
  `<svg viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/** 毛笔的毛边：湍流把轮廓推歪一点 */
const rough = (id: string, scale = 4, freq = 0.04, seed = 3) =>
  `<filter id="${id}" x="-8%" y="-8%" width="116%" height="116%"><feTurbulence type="fractalNoise" baseFrequency="${freq}" numOctaves="2" seed="${seed}" result="t"/><feDisplacementMap in="SourceGraphic" in2="t" scale="${scale}" xChannelSelector="R" yChannelSelector="G"/></filter>`;

const blur = (id: string, sd: number) => `<filter id="${id}" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

/** 发光：原图 + 一圈模糊的光晕 */
const glow = (id: string, sd: number) =>
  `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur in="SourceGraphic" stdDeviation="${sd}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;

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

/** 祥云：几个圆鼓起来、底边平，外加一道卷 */
function cloud(cx: number, cy: number, w: number, fill: string, stroke: string, sw = 1.4) {
  const h = w * 0.32;
  const puffs = [
    [-0.36, 0.1, 0.2],
    [-0.14, -0.12, 0.27],
    [0.12, -0.2, 0.3],
    [0.36, 0.02, 0.22],
  ];
  let d = '';
  for (const [dx, dy, rr] of puffs) {
    const r0 = rr * w;
    d += `M${n1(cx + dx * w - r0)} ${n1(cy + dy * w)} a${n1(r0)} ${n1(r0)} 0 1 1 ${n1(r0 * 2)} 0 a${n1(r0)} ${n1(r0)} 0 1 1 ${n1(-r0 * 2)} 0 `;
  }
  d += `M${n1(cx - w * 0.56)} ${n1(cy + h * 0.2)} h${n1(w * 1.12)} v${n1(h * 0.5)} h${n1(-w * 1.12)} Z`;
  const curl = `M${n1(cx - w * 0.05)} ${n1(cy + h * 0.15)} a${n1(w * 0.09)} ${n1(w * 0.09)} 0 1 1 ${n1(w * 0.12)} ${n1(-w * 0.06)} a${n1(w * 0.05)} ${n1(w * 0.05)} 0 1 0 ${n1(-w * 0.06)} ${n1(w * 0.05)}`;
  return `<path d="${d}" fill="${fill}"/><path d="${curl}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

/** 摇摆：绕 (x, y) 来回转几度 */
const sway = (x: number, y: number, deg: number, dur: number, delay = 0) =>
  `<animateTransform attributeName="transform" type="rotate" values="0 ${x} ${y};${deg} ${x} ${y};${n1(-deg * 0.45)} ${x} ${y};0 ${x} ${y}" dur="${dur}s" begin="${delay}s" repeatCount="indefinite" calcMode="spline" keySplines=".45 0 .55 1;.45 0 .55 1;.45 0 .55 1"/>`;

/** 形状来回变（几组同结构的 d） */
const morph = (ds: string[], dur: number) =>
  `<animate attributeName="d" values="${[...ds, ds[0]].join(';')}" dur="${dur}s" repeatCount="indefinite" calcMode="spline" keySplines="${ds.map(() => '.45 0 .55 1').join(';')}"/>`;

/**
 * 人物：300×420，脚踩在 y≈405。sil 是剪影本身（流光只扫在它上面）；
 * 剪影外面一圈很淡的逆光描边由 intro.ts 的 CSS 加
 */
/**
 * 毛笔的笔触：一张 160×160 的小图（一道道干笔的丝、几团洇开的淡墨），平铺在人物身上正片叠底——
 * 平涂的颜色一压，就有了笔触，不再像剪纸。现画一次、留着（四边接得上，平铺看不出缝）
 */
let inkTile = '';
function inkTex(): string {
  if (inkTile || typeof document === 'undefined') return inkTile;
  const S = 160;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d');
  if (!g) return '';
  g.fillStyle = '#fff';
  g.fillRect(0, 0, S, S);
  const r = rng(91);
  const wrap = (draw: (dx: number, dy: number) => void) => {
    for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) draw(dx, dy);
  };
  for (let i = 0; i < 280; i++) {
    const x = r() * S;
    const y = r() * S;
    const len = 18 + r() * 70;
    const a = Math.PI / 2 + (r() - 0.5) * 0.55;
    const al = 0.04 + r() * 0.13;
    const lw = 0.5 + r() * 1.7;
    wrap((dx, dy) => {
      g.strokeStyle = `rgba(0,0,0,${al})`;
      g.lineWidth = lw;
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
      g.stroke();
    });
  }
  for (let i = 0; i < 14; i++) {
    const x = r() * S;
    const y = r() * S;
    const rr = 8 + r() * 24;
    const al = 0.05 + r() * 0.09;
    wrap((dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, rr);
      gr.addColorStop(0, `rgba(0,0,0,${al})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.fillRect(x + dx - rr, y + dy - rr, rr * 2, rr * 2);
    });
  }
  inkTile = cv.toDataURL('image/png');
  return inkTile;
}

function figure(p: string, defs: string, sil: string, extra = '') {
  const tex = inkTex();
  return (
    `<svg viewBox="0 0 300 420" xmlns="http://www.w3.org/2000/svg" overflow="visible"><defs>${defs}` +
    (tex ? `<pattern id="${p}tx" patternUnits="userSpaceOnUse" width="96" height="96"><image href="${tex}" width="96" height="96"/></pattern>` : '') +
    `<filter id="${p}w"><feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0"/></filter>` +
    `<mask id="${p}m" maskUnits="userSpaceOnUse" x="-40" y="-40" width="380" height="500"><use href="#${p}sil" filter="url(#${p}w)"/></mask>` +
    `<linearGradient id="${p}sh" gradientUnits="userSpaceOnUse" x1="-160" y1="0" x2="-84" y2="44">` +
    `<stop offset="0" stop-color="#fff4cf" stop-opacity="0"/><stop offset=".5" stop-color="#fff4cf" stop-opacity=".78"/><stop offset="1" stop-color="#fff4cf" stop-opacity="0"/>` +
    `<animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="840 0" begin="1.3s" dur="1.6s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .3 1"/></linearGradient>` +
    `${blur(p + 'sd', 5)}</defs>` +
    `<ellipse cx="150" cy="406" rx="100" ry="9" fill="#000" opacity=".38" filter="url(#${p}sd)"/>` +
    `<g id="${p}sil">${sil}</g>` +
    (tex ? `<rect x="-40" y="-40" width="380" height="500" fill="url(#${p}tx)" mask="url(#${p}m)" style="mix-blend-mode:multiply" opacity=".55"/>` : '') +
    `<rect x="-40" y="-40" width="380" height="500" fill="url(#${p}sh)" mask="url(#${p}m)" style="mix-blend-mode:screen"/>${extra}</svg>`
  );
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

// ───────────────────────── 刀客：雨夜竹林、孤月 ─────────────────────────

function bamboo(p: string, seed: number, stalks: [number, number, number][], ink: string) {
  const r = rng(seed);
  let body = '';
  let leaves = '';
  for (const [x0, w, lean] of stalks) {
    // 一节一节往上，节与节之间留一道细缝
    for (let y = 840; y > -60; ) {
      const h = 70 + r() * 40;
      const xa = x0 + lean * (840 - y);
      const xb = x0 + lean * (840 - (y - h));
      body += `M${n1(xa - w / 2)} ${n1(y)} L${n1(xb - w / 2)} ${n1(y - h + 3)} Q${n1(xb)} ${n1(y - h + 1)} ${n1(xb + w / 2)} ${n1(y - h + 3)} L${n1(xa + w / 2)} ${n1(y)} Z `;
      // 枝叶：长在节上，往下垂
      if (r() < 0.42 && y < 700) {
        const nx = xb;
        const ny = y - h;
        const side = r() < 0.5 ? -1 : 1;
        for (let k = 0; k < 4 + Math.floor(r() * 3); k++) {
          const ang = side * (18 + r() * 55) + (side < 0 ? 180 : 0);
          const sc = 0.8 + r() * 0.7;
          leaves += `<path d="M0 0 C12 -4.5 30 -4.5 48 0 C30 3.5 12 4.5 0 0 Z" transform="translate(${n1(nx + side * 8)} ${n1(ny + k * 3)}) rotate(${n1(ang)}) scale(${n1(sc)})"/>`;
        }
      }
      y -= h;
    }
  }
  return `<defs>${rough(p + 'r', 3, 0.06, seed)}${blur(p + 'b', 1.4)}</defs><g fill="${ink}" filter="url(#${p}b)"><g filter="url(#${p}r)"><path d="${body}"/>${leaves}</g></g>`;
}

function daoke(): HeroArt {
  const p = 'dk';
  const sky = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#7d7a74'], [0.42, '#c9c4b8'], [0.62, '#b3ada1'], [1, '#3e3b37']])}` +
      `<radialGradient id="${p}mh" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fffaf0" stop-opacity=".75"/><stop offset="1" stop-color="#fffaf0" stop-opacity="0"/></radialGradient>${blur(p + 'cb', 9)}</defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/>` +
      `<circle cx="228" cy="300" r="150" fill="url(#${p}mh)"/><circle cx="228" cy="300" r="64" fill="#f6f1e4"/>` +
      // 云丝从月亮前面拖过去
      `<g filter="url(#${p}cb)" fill="#6f6b64" opacity=".55"><ellipse cx="180" cy="286" rx="140" ry="9"/><ellipse cx="290" cy="318" rx="110" ry="7"/><ellipse cx="120" cy="250" rx="90" ry="6"/></g>`,
  );
  const far = scene(range(p + 'f', 3, 500, 70, 190, 7, '#3b3e42', 0.42, 1.3));
  const mid = scene(
    range(p + 'm', 11, 600, 40, 130, 6, '#232527', 0.72, 1.8) +
      `<defs>${vgrad(p + 'gd', [[0, '#1d1c1b', 0], [0.35, '#1d1c1b', 0.85], [1, '#100f0e']])}</defs><path d="M-20 660 Q100 640 200 652 Q300 664 420 646 L420 820 L-20 820 Z" fill="url(#${p}gd)"/>`,
  );
  const mist = scene(mistBands(p + 'mi', 5, [520, 600, 690], '#e7e2d6', 0.5));
  const near = scene(bamboo(p + 'n', 7, [[18, 13, 0.012], [54, 9, 0.02], [378, 11, -0.015]], '#121212'));
  const fig = figure(
    p,
    `${vgrad(p + 'cl', [[0, '#2b2723'], [1, '#0b0a09']])}${vgrad(p + 'hat', [[0, '#4a4238'], [1, '#14110e']])}` +
      `${rough(p + 'r', 2.6, 0.05, 9)}${glow(p + 'gl', 2.2)}`,
    `<g filter="url(#${p}r)">` +
      // 披风后摆：被风往右扯，两片燕尾
      `<path fill="url(#${p}cl)" d="M196 236 Q228 292 288 334 Q270 334 262 326 Q262 342 276 354 Q246 352 214 352 Z">${morph(
        [
          'M196 236 Q228 292 288 334 Q270 334 262 326 Q262 342 276 354 Q246 352 214 352 Z',
          'M196 236 Q232 286 294 322 Q276 326 268 318 Q270 336 286 346 Q250 350 214 352 Z',
          'M196 236 Q226 296 282 342 Q266 340 258 332 Q256 348 268 360 Q242 354 214 352 Z',
        ],
        1.7,
      )}</path>` +
      // 腿、靴
      `<path fill="#0d0c0b" d="M110 344 L103 398 Q116 406 134 400 L140 346 Z M160 346 L167 400 Q184 406 198 398 L191 344 Z"/>` +
      // 披风主体
      `<path fill="url(#${p}cl)" d="M98 160 Q150 140 202 160 Q214 220 218 290 Q220 330 214 352 Q150 362 86 352 Q80 300 84 250 Q88 200 98 160 Z"/>` +
      // 披风上的褶
      `<path fill="none" stroke="#3d3833" stroke-width="1.4" stroke-linecap="round" d="M122 190 Q118 260 116 340 M150 176 Q154 260 150 352 M182 188 Q190 260 196 340"/>` +
      // 腰带结、两条带子往右飘
      `<path fill="#0d0c0b" d="M120 262 Q150 268 182 262 L184 272 Q150 278 118 272 Z"/>` +
      `<g>${sway(184, 268, 6, 1.4)}<path fill="none" stroke="#151311" stroke-width="3.2" stroke-linecap="round" d="M184 268 Q214 276 236 296 M184 270 Q206 288 222 314"/></g>` +
      // 脖子、后脑的发髻
      `<path fill="#120f0d" d="M138 128 L162 128 L165 150 L135 150 Z"/>` +
      `<g>${sway(160, 138, 7, 1.5, 0.2)}<path fill="#0e0c0b" d="M158 134 Q186 140 206 132 Q196 146 174 148 Q190 154 214 148 Q192 162 160 150 Z"/></g>` +
      // 背上的刀：鞘从左下斜到右肩，刀柄、刀环从斗笠右边伸出来
      `<path fill="#17130f" d="M79.8 327.3 Q138 221 209.8 123.3 L218.2 128.7 Q146.5 226.4 88.2 332.7 Z"/>` +
      `<path fill="none" stroke="#c9a458" stroke-width="2.6" d="M118 272 L128 279 M170 190 L180 197 M206 133 L215 139"/>` +
      `<path fill="#c9a458" d="M78 324 Q76 336 86 338 Q92 336 90 330 Z"/>` +
      `<ellipse cx="216" cy="123" rx="11" ry="3.2" transform="rotate(32.5 216 123)" fill="#a8843f"/>` +
      `<line x1="217.5" y1="120.5" x2="232.5" y2="97" stroke="#1a1512" stroke-width="7"/>` +
      `<line x1="217.5" y1="120.5" x2="232.5" y2="97" stroke="#6e5c3c" stroke-width="7" stroke-dasharray="2 2.6" opacity=".7"/>` +
      `<circle cx="236" cy="91.5" r="5.2" fill="none" stroke="#d8b464" stroke-width="2.2"/>` +
      // 斗笠：往左压一点
      `<g transform="rotate(-5 150 104)">` +
      `<path fill="#0c0a09" d="M48 125 Q150 152 252 125 Q150 138 48 125 Z"/>` +
      `<path fill="url(#${p}hat)" d="M48 125 Q96 104 140 69 Q150 61 160 69 Q204 104 252 125 Q150 141 48 125 Z"/>` +
      `<path fill="none" stroke="#6a5f52" stroke-width=".8" opacity=".55" d="M150 66 L58 126 M150 66 L78 129 M150 66 L100 132 M150 66 L124 134 M150 66 L150 135 M150 66 L176 134 M150 66 L200 132 M150 66 L222 129 M150 66 L242 126"/>` +
      `<path fill="none" stroke="#6a5f52" stroke-width=".7" opacity=".45" d="M80 112 Q150 122 220 112 M104 96 Q150 103 196 96"/>` +
      `<circle cx="150" cy="64" r="3.4" fill="#0e0c0a"/></g>` +
      `</g>` +
      // 红刀穗（不加毛边，颜色要干净）
      `<g>${sway(238, 97, 10, 1.3)}<g transform="rotate(-28 238 97)"><path fill="none" stroke="#b3261e" stroke-width="1.6" d="M238 96 L238 104"/>` +
      `<circle cx="238" cy="105" r="3" fill="#c22b20"/><path fill="#b3261e" d="M235 107 Q230 126 233 146 Q238 150 244 146 Q246 126 241 107 Z"/>` +
      `<path fill="none" stroke="#7e140e" stroke-width=".8" d="M236 110 Q233 128 235 146 M238 110 L238 148 M240 110 Q243 128 242 146"/>` +
      `<rect x="234" y="110" width="8" height="3" fill="#d8b464"/></g></g>` +
      // 逆光：斗笠上沿、肩、刀环的一道金边
      `<g filter="url(#${p}gl)" fill="none" stroke="#f5dc9a" stroke-linecap="round"><path stroke-width="1.5" d="M52 121 Q98 99 142 66" transform="rotate(-5 150 104)"/>` +
      `<path stroke-width="1.3" d="M99 162 Q106 148 136 144"/><path stroke-width="1" opacity=".7" d="M86 250 Q84 300 88 348"/></g>`,
  );
  return { sky, far, mid, mist, near, fig, splash: splash(p + 's', 21, '#050505', '#151414', '#0b0b0b') };
}

// ───────────────────────── 关公：赤霞、战旗、祥云 ─────────────────────────

function flags(seed: number, ink: string) {
  const r = rng(seed);
  let s = '';
  for (let i = 0; i < 9; i++) {
    const x = 10 + r() * 380;
    const top = 470 + r() * 90;
    const h = 120 + r() * 60;
    const fw = 26 + r() * 22;
    const fh = 34 + r() * 18;
    s += `<rect x="${n1(x)}" y="${n1(top)}" width="2.2" height="${n1(h)}"/>`;
    s += `<path d="M${n1(x + 2)} ${n1(top + 4)} q${n1(fw * 0.5)} ${n1(-6)} ${n1(fw)} ${n1(4)} l${n1(-4)} ${n1(fh * 0.5)} l${n1(4)} ${n1(fh * 0.5)} q${n1(-fw * 0.5)} -8 ${n1(-fw)} 0 Z"/>`;
  }
  return `<g fill="${ink}">${s}</g>`;
}

function guangong(): HeroArt {
  const p = 'gg';
  const sky = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#150605'], [0.33, '#4a120c'], [0.56, '#9a3418'], [0.68, '#e09444'], [0.76, '#7a2a12'], [1, '#1c0806']])}` +
      `<radialGradient id="${p}h" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffe2a0" stop-opacity=".7"/><stop offset=".45" stop-color="#ffb860" stop-opacity=".22"/><stop offset="1" stop-color="#ff9a40" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/><circle cx="200" cy="330" r="190" fill="url(#${p}h)"/>` +
      // 头顶一圈光轮
      `<circle cx="200" cy="330" r="96" fill="none" stroke="#ffd98a" stroke-width="1.4" opacity=".55"/><circle cx="200" cy="330" r="104" fill="none" stroke="#ffd98a" stroke-width=".6" opacity=".35"/>`,
  );
  const far = scene(range(p + 'f', 5, 640, 50, 150, 8, '#1a0807', 0.7, 1.2) + `<g opacity=".72">${flags(4, '#1a0807')}</g>`);
  const mid = scene(
    `<g opacity=".9">${cloud(70, 452, 120, 'rgba(240,180,90,.22)', '#e9b45c')}${cloud(318, 420, 150, 'rgba(240,180,90,.2)', '#e9b45c')}${cloud(220, 520, 110, 'rgba(240,180,90,.16)', '#d99a48')}</g>` +
      range(p + 'm', 9, 720, 30, 90, 6, '#120504', 0.85, 2),
  );
  const mist = scene(mistBands(p + 'mi', 8, [560, 650], '#ffb070', 0.32));
  const near = scene(
    `<defs>${blur(p + 'nb', 2)}</defs><g filter="url(#${p}nb)" fill="#0c0403"><path d="M-20 820 L-20 700 Q30 680 70 720 Q100 740 120 820 Z"/><path d="M420 820 L420 690 Q370 676 336 716 Q310 746 296 820 Z"/></g>`,
  );
  const beard0 = 'M138 110 Q149 121 160 110 Q161 138 156 168 Q152 192 146 214 Q143 192 141 170 Q135 142 138 110 Z';
  const fig = figure(
    p,
    `${vgrad(p + 'rb', [[0, '#24543a'], [0.55, '#163726'], [1, '#08130d']])}${vgrad(p + 'cp', [[0, '#1d4630'], [1, '#050b07']])}` +
      `<linearGradient id="${p}bl" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#eef1f3"/><stop offset=".5" stop-color="#9aa3ab"/><stop offset="1" stop-color="#4a5158"/></linearGradient>` +
      `<radialGradient id="${p}fc" cx=".45" cy=".4" r=".6"><stop offset="0" stop-color="#c8392a"/><stop offset="1" stop-color="#6e140c"/></radialGradient>` +
      `<radialGradient id="${p}mr" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#fff3c0"/><stop offset=".5" stop-color="#d9a640"/><stop offset="1" stop-color="#6b4a14"/></radialGradient>` +
      `${rough(p + 'r', 2.4, 0.05, 4)}${glow(p + 'gl', 2.4)}`,
    // 披风往左飘
    `<g filter="url(#${p}r)"><path fill="url(#${p}cp)" d="M104 148 Q66 214 44 298 Q32 352 26 398 Q62 390 92 398 L112 160 Z">${morph(
      [
        'M104 148 Q66 214 44 298 Q32 352 26 398 Q62 390 92 398 L112 160 Z',
        'M104 148 Q60 210 36 292 Q22 346 14 390 Q56 388 92 398 L112 160 Z',
        'M104 148 Q70 218 50 302 Q40 356 34 402 Q66 392 92 398 L112 160 Z',
      ],
      2.1,
    )}</path>` +
      // 青龙偃月刀：杆、刀身、吞口、红缨
      `<rect x="229" y="112" width="6.5" height="296" fill="#1b1410"/><rect x="228" y="396" width="8.5" height="12" fill="#b8913f"/><rect x="228" y="198" width="8.5" height="5" fill="#b8913f"/>` +
      `</g>` +
      `<path fill="url(#${p}bl)" stroke="#2a2d31" stroke-width="1.2" d="M226 120 C196 108 182 66 204 18 C208 12 214 10 218 14 C214 24 220 34 238 44 C252 54 252 76 242 92 L256 98 L240 104 C238 110 238 116 238 120 Z"/>` +
      `<path fill="none" stroke="#3a3f45" stroke-width="1" opacity=".6" d="M228 112 C210 98 204 70 214 30"/>` +
      `<path fill="#c79a3e" stroke="#5a3e12" stroke-width=".8" d="M221 117 Q232 106 245 117 Q241 131 233 128 Q225 131 221 117 Z"/>` +
      `<g>${sway(232, 128, 8, 1.6)}<path fill="#b3261e" d="M230 126 C214 132 206 146 198 160 C210 152 218 150 224 148 C214 160 210 170 208 182 C220 168 228 156 234 130 Z"/></g>` +
      `<g filter="url(#${p}r)">` +
      // 绿袍
      `<path fill="url(#${p}rb)" d="M100 146 Q148 132 198 146 L214 230 Q222 320 232 398 Q150 412 64 398 Q76 320 86 230 Z"/>` +
      `<path fill="none" stroke="#0a1a11" stroke-width="1.6" d="M150 238 L150 400 M120 250 Q112 320 104 396 M180 250 Q188 320 198 396"/>` +
      // 甲：护肩、胸甲、护心镜、腰带
      `<path fill="#25221d" stroke="#c9a04a" stroke-width="1.4" d="M114 160 Q148 150 184 160 L178 228 Q148 236 120 228 Z"/>` +
      `<path fill="none" stroke="#8a6e33" stroke-width=".9" opacity=".8" d="M120 176 Q148 170 178 176 M121 192 Q148 186 177 192 M121 208 Q148 202 177 208"/>` +
      `<ellipse cx="102" cy="160" rx="23" ry="14" fill="#1f1c18" stroke="#c9a04a" stroke-width="1.4"/><ellipse cx="196" cy="160" rx="23" ry="14" fill="#1f1c18" stroke="#c9a04a" stroke-width="1.4"/>` +
      `<rect x="112" y="226" width="76" height="10" rx="2" fill="#3a2a10" stroke="#d6aa4c" stroke-width="1.2"/>` +
      `</g>` +
      `<circle cx="149" cy="190" r="11" fill="url(#${p}mr)"/><rect x="143" y="226" width="12" height="10" fill="#e8c062"/>` +
      `<g filter="url(#${p}r)">` +
      // 右臂握刀杆、左臂垂在大袖里
      `<path fill="url(#${p}rb)" d="M194 156 Q222 172 232 204 L222 222 Q206 198 186 186 Z"/><ellipse cx="232" cy="212" rx="8.5" ry="10" fill="#1a0f0b"/>` +
      `<path fill="url(#${p}rb)" d="M102 158 Q78 210 72 272 Q90 288 110 276 Q110 222 118 182 Z"/>` +
      // 脖子、脸
      `<rect x="140" y="116" width="18" height="22" fill="#5e120b"/>` +
      `</g>` +
      `<ellipse cx="149" cy="100" rx="15.5" ry="19.5" fill="url(#${p}fc)"/>` +
      // 卧蚕眉、丹凤眼
      `<path fill="none" stroke="#0b0807" stroke-linecap="round" stroke-width="3" d="M135 89 Q141 84 146 88 M152 88 Q157 84 164 89"/>` +
      `<path fill="none" stroke="#0b0807" stroke-linecap="round" stroke-width="1.6" d="M137 96 Q141 94 146 96 L134 92 M152 96 Q157 94 161 96 L165 92"/>` +
      `<path fill="none" stroke="#3a0805" stroke-width="1.2" d="M149 98 L147 106 L151 107"/>` +
      // 绿巾、巾带往左飘
      `<g filter="url(#${p}r)"><path fill="#2d6a45" stroke="#d6aa4c" stroke-width="1" d="M131 89 Q132 66 149 61 Q167 64 168 89 Q160 80 149 79 Q137 80 131 89 Z"/><path fill="#2d6a45" d="M145 62 Q149 48 156 58 Z"/>` +
      `<g>${sway(134, 80, -7, 1.7, 0.3)}<path fill="#24573a" d="M134 80 Q116 86 100 100 Q112 96 120 96 Q108 106 102 118 Q118 104 136 88 Z"/></g>` +
      // 五绺长髯，被风吹得往左偏
      `<g>${sway(148, 110, -3, 2.2)}<path fill="#0b0908" d="${beard0}">${morph(
        [
          beard0,
          'M138 110 Q149 121 160 110 Q159 140 153 170 Q147 194 140 216 Q139 194 139 170 Q134 142 138 110 Z',
          'M138 110 Q149 121 160 110 Q162 136 158 166 Q155 190 151 212 Q147 190 143 168 Q136 140 138 110 Z',
        ],
        2.4,
      )}</path><path fill="#0b0908" d="M137 112 Q130 140 126 176 Q132 158 140 140 Z M161 112 Q166 138 167 168 Q162 152 157 140 Z"/></g></g>` +
      // 逆光金边
      `<g filter="url(#${p}gl)" fill="none" stroke="#ffe0a0" stroke-linecap="round"><path stroke-width="1.4" d="M204 18 C182 66 196 108 226 120"/><path stroke-width="1.2" d="M80 168 Q90 150 112 146"/><path stroke-width="1.1" d="M218 150 Q206 144 188 146"/></g>`,
  );
  return { sky, far, mid, mist, near, fig, splash: splash(p + 's', 33, '#ffcf78', '#b8361a', '#e0a050') };
}

// ───────────────────────── 哪吒：闹海、火光 ─────────────────────────

function waves(p: string, seed: number, rows: [number, number, string, number][]) {
  const r = rng(seed);
  let s = `<defs>${rough(p + 'r', 3, 0.05, seed)}</defs><g filter="url(#${p}r)">`;
  for (const [y, amp, col, foam] of rows) {
    let d = `M-30 820 L-30 ${y}`;
    let crest = '';
    const step = 36 + r() * 18;
    for (let x = -30; x < 440; x += step) {
      const h = amp * (0.6 + r() * 0.6);
      // 尖浪头往右卷
      d += ` Q${n1(x + step * 0.55)} ${n1(y - h)} ${n1(x + step * 0.8)} ${n1(y - h * 0.7)} Q${n1(x + step * 0.92)} ${n1(y - h * 0.2)} ${n1(x + step)} ${n1(y)}`;
      crest += `M${n1(x + step * 0.3)} ${n1(y - h * 0.4)} Q${n1(x + step * 0.55)} ${n1(y - h * 1.02)} ${n1(x + step * 0.82)} ${n1(y - h * 0.7)} q${n1(-step * 0.12)} ${n1(h * 0.1)} ${n1(-step * 0.1)} ${n1(h * 0.32)} `;
    }
    d += ' L440 820 Z';
    s += `<path d="${d}" fill="${col}"/><path d="${crest}" fill="none" stroke="#f3efe6" stroke-width="${foam}" stroke-linecap="round" opacity=".85"/>`;
  }
  return s + '</g>';
}

function fireWheel(cx: number, cy: number, rr: number, id: string) {
  let spokes = '';
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    spokes += `M${n1(cx + Math.cos(a) * rr * 0.28)} ${n1(cy + Math.sin(a) * rr * 0.28)} L${n1(cx + Math.cos(a) * rr * 0.92)} ${n1(cy + Math.sin(a) * rr * 0.92)} `;
  }
  // 火舌往后（左下）拖
  const fl = `M${cx + rr * 0.6} ${cy - rr * 0.8} C${cx - rr * 0.6} ${cy - rr * 1.6} ${cx - rr * 2.2} ${cy - rr * 0.2} ${cx - rr * 2.8} ${cy + rr * 0.6} C${cx - rr * 2} ${cy + rr * 0.2} ${cx - rr * 1.6} ${cy + rr * 0.9} ${cx - rr * 2.2} ${cy + rr * 1.5} C${cx - rr * 1} ${cy + rr * 1.3} ${cx} ${cy + rr * 1.4} ${cx + rr * 0.7} ${cy + rr * 0.7} Z`;
  return (
    `<path d="${fl}" fill="url(#${id}fl)" filter="url(#${id}fg)" opacity=".95"/>` +
    `<g><animateTransform attributeName="transform" type="rotate" from="0 ${cx} ${cy}" to="360 ${cx} ${cy}" dur=".7s" repeatCount="indefinite"/>` +
    `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="#ffb43c" stroke-width="4.2"/><circle cx="${cx}" cy="${cy}" r="${rr * 0.3}" fill="#ffda7a"/>` +
    `<path d="${spokes}" stroke="#ff8a2a" stroke-width="2.2"/>` +
    `<path d="M${cx + rr} ${cy} l7 -3 l-2 6 Z M${cx - rr} ${cy} l-7 3 l2 -6 Z M${cx} ${cy + rr} l3 7 l-6 -2 Z M${cx} ${cy - rr} l-3 -7 l6 2 Z" fill="#ffcf5a"/></g>`
  );
}

function nezha(): HeroArt {
  const p = 'nz';
  const sky = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#0e070c'], [0.32, '#3b1016'], [0.55, '#8c2a18'], [0.68, '#e3742c'], [0.74, '#f6b25a'], [0.78, '#2a3a44'], [1, '#0d171d']])}` +
      `<radialGradient id="${p}h" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#ffd27a" stop-opacity=".75"/><stop offset=".5" stop-color="#ff7a30" stop-opacity=".25"/><stop offset="1" stop-color="#ff5a20" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/><circle cx="200" cy="380" r="210" fill="url(#${p}h)"/>`,
  );
  // 远处海上的礁石（海水江崖）
  const far = scene(range(p + 'f', 17, 610, 40, 120, 5, '#1b1214', 0.85, 3.2));
  const mid = scene(waves(p + 'm', 5, [[640, 26, '#14313b', 1.6], [690, 34, '#0f2730', 2]]));
  const mist = scene(mistBands(p + 'mi', 3, [600, 680], '#ffd0a0', 0.25));
  const near = scene(`<defs>${blur(p + 'nb', 1.8)}</defs><g filter="url(#${p}nb)">${waves(p + 'n', 9, [[752, 52, '#0a1d24', 3]])}</g>`);
  const ling = [
    'M126 172 C80 148 50 196 66 236 C82 276 140 266 172 252 C214 236 252 250 264 290 C274 324 248 352 218 344',
    'M126 172 C76 156 44 206 62 244 C80 282 142 270 176 256 C220 238 260 246 274 284 C286 318 262 350 232 348',
    'M126 172 C84 140 56 186 72 228 C88 268 138 262 168 248 C208 234 246 254 256 296 C264 330 236 354 206 342',
  ];
  const ling2 = [
    'M174 170 C212 150 236 112 220 80 C206 54 176 62 184 36',
    'M174 170 C218 156 246 118 232 84 C220 58 190 60 200 32',
    'M174 170 C206 144 228 106 210 76 C194 50 166 66 170 40',
  ];
  const fig = figure(
    p,
    `<linearGradient id="${p}flfl" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".4" stop-color="#ff7a2a"/><stop offset="1" stop-color="#c0261e" stop-opacity="0"/></linearGradient>` +
      `${blur(p + 'flfg', 1.6)}${vgrad(p + 'sk2', [[0, '#f0d6bc'], [1, '#c99a78']])}${rough(p + 'r', 2.2, 0.05, 6)}${glow(p + 'gl', 2.6)}${glow(p + 'gl2', 5)}` +
      `<linearGradient id="${p}rib" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e2382a"/><stop offset="1" stop-color="#8e1410"/></linearGradient>`,
    // 混天绫（身后那一圈）
    `<path fill="none" stroke="url(#${p}rib)" stroke-width="9" stroke-linecap="round" d="${ling[0]}">${morph(ling, 1.6)}</path>` +
      `<path fill="none" stroke="#ff8a6a" stroke-width="2.6" stroke-linecap="round" opacity=".55" d="${ling[0]}">${morph(ling, 1.6)}</path>` +
      // 火尖枪：从右上斜到左下
      `<line x1="70" y1="330" x2="252" y2="66" stroke="#2a1a12" stroke-width="4.5" stroke-linecap="round"/>` +
      `<g transform="translate(258 58) rotate(-55.35)"><path d="M-40 0 Q-30 -14 -18 -9 Q-24 -4 -20 0 Q-24 4 -18 9 Q-30 14 -40 0 Z" fill="#ff7a2a" filter="url(#${p}gl)"/>` +
      `<path d="M-38 -4.5 Q-18 -9 6 0 Q-18 9 -38 4.5 Z" fill="#e8ecef" stroke="#3a3f45" stroke-width=".8"/>` +
      `<g>${sway(-42, 0, 10, 1.1)}<path d="M-42 0 C-52 -10 -62 -6 -70 -14 C-64 -2 -66 6 -72 12 C-60 8 -52 8 -42 2 Z" fill="#c8261e"/></g></g>` +
      // 风火轮
      fireWheel(112, 372, 21, p + 'fl') +
      fireWheel(196, 384, 21, p + 'fl') +
      `<g filter="url(#${p}r)">` +
      // 腿（一前一后踩在轮上）
      `<path fill="url(#${p}sk2)" d="M138 268 L124 316 L110 352 L124 358 L140 320 L154 276 Z M156 276 L176 320 L190 366 L204 362 L190 318 L170 270 Z"/>` +
      `<path fill="#c8261e" d="M108 348 L128 352 L124 362 L104 358 Z M188 362 L208 358 L206 368 L188 370 Z"/>` +
      // 荷叶裙
      `<path fill="#3f7a4a" stroke="#1d3b22" stroke-width="1.2" d="M122 236 Q150 228 178 236 L190 274 Q172 266 162 282 Q150 268 140 282 Q130 266 110 274 Z"/>` +
      `<path fill="none" stroke="#1d3b22" stroke-width="1" d="M150 236 L150 272 M134 238 L124 270 M166 238 L176 270"/>` +
      // 身子、肚兜
      `<path fill="url(#${p}sk2)" d="M128 166 Q150 156 172 166 L172 238 Q150 246 128 238 Z"/>` +
      `<path fill="#c8261e" stroke="#e8b04a" stroke-width="1.2" d="M134 176 L166 176 L162 226 Q150 236 138 226 Z"/>` +
      // 左臂举乾坤圈、右臂握枪
      `<path fill="url(#${p}sk2)" d="M130 172 Q110 150 96 128 L104 122 Q120 140 138 162 Z"/>` +
      `<path fill="url(#${p}sk2)" d="M168 170 Q182 158 194 146 L200 152 Q188 168 174 180 Z"/>` +
      `<path fill="#e8b04a" d="M98 128 L106 124 L108 130 L100 134 Z M190 148 L198 144 L201 151 L193 154 Z"/>` +
      // 头：双髻、红头绳
      `<circle cx="150" cy="122" r="24" fill="url(#${p}sk2)"/>` +
      `<path fill="#141010" d="M126 118 Q128 94 150 92 Q172 94 174 118 Q164 104 150 104 Q136 104 126 118 Z"/>` +
      `<circle cx="128" cy="92" r="12.5" fill="#141010"/><circle cx="172" cy="92" r="12.5" fill="#141010"/>` +
      `</g>` +
      `<path fill="#d8261e" d="M134 100 l8 4 l-8 3 Z M166 100 l-8 4 l8 3 Z"/>` +
      // 眉眼：眉心一点火纹
      `<path fill="none" stroke="#141010" stroke-width="2.4" stroke-linecap="round" d="M138 116 L146 119 M162 116 L154 119"/>` +
      `<path fill="none" stroke="#141010" stroke-width="1.8" stroke-linecap="round" d="M139 124 Q143 122 147 124 M153 124 Q157 122 161 124"/>` +
      `<path fill="#d8261e" d="M150 105 Q147 110 150 114 Q153 110 150 105 Z"/><path fill="none" stroke="#a01810" stroke-width="1.4" stroke-linecap="round" d="M146 134 Q150 136 154 134"/>` +
      // 乾坤圈（金光）
      `<circle cx="86" cy="112" r="21" fill="none" stroke="#ffd25a" stroke-width="5.5" filter="url(#${p}gl2)"/><circle cx="86" cy="112" r="21" fill="none" stroke="#fff3c0" stroke-width="1.6"/>` +
      // 混天绫（身前那一段）
      `<path fill="none" stroke="url(#${p}rib)" stroke-width="7" stroke-linecap="round" d="${ling2[0]}">${morph(ling2, 1.4)}</path>`,
  );
  return { sky, far, mid, mist, near, fig, splash: splash(p + 's', 45, '#ffd070', '#d8441a', '#ff9a3a') };
}

// ───────────────────────── 女侠：月下、梅花 ─────────────────────────

function plum(p: string, seed: number) {
  const r = rng(seed);
  const segs: [number, number, number, number, number][] = [];
  const grow = (x: number, y: number, ang: number, len: number, w: number, depth: number) => {
    let cx = x;
    let cy = y;
    for (let i = 0; i < 3; i++) {
      ang += (r() - 0.5) * 0.7;
      const nx = cx + Math.cos(ang) * len / 3;
      const ny = cy + Math.sin(ang) * len / 3;
      segs.push([cx, cy, nx, ny, w * (1 - i * 0.22)]);
      cx = nx;
      cy = ny;
      if (depth > 0 && r() < 0.55) grow(cx, cy, ang + (r() < 0.5 ? -1 : 1) * (0.5 + r() * 0.6), len * 0.55, w * 0.55, depth - 1);
    }
  };
  grow(430, 40, Math.PI * 0.86, 230, 13, 3);
  grow(-20, 700, -Math.PI * 0.18, 150, 9, 2);
  let branch = '';
  for (const [a, b, c, d, w] of segs) branch += `<line x1="${n1(a)}" y1="${n1(b)}" x2="${n1(c)}" y2="${n1(d)}" stroke-width="${n1(Math.max(1.2, w))}"/>`;
  let flowers = '';
  for (const [, , c, d, w] of segs) {
    if (w > 7 || r() < 0.35) continue;
    const fx = c + (r() - 0.5) * 10;
    const fy = d + (r() - 0.5) * 10;
    const fr = 4 + r() * 3.5;
    let petals = '';
    for (let k = 0; k < 5; k++) {
      const a = (k * Math.PI * 2) / 5 + r();
      petals += `<circle cx="${n1(fx + Math.cos(a) * fr * 0.8)}" cy="${n1(fy + Math.sin(a) * fr * 0.8)}" r="${n1(fr * 0.62)}"/>`;
    }
    flowers += `<g fill="#d23a48" opacity="${n1(0.75 + r() * 0.25)}">${petals}</g><circle cx="${n1(fx)}" cy="${n1(fy)}" r="${n1(fr * 0.32)}" fill="#ffe0a8"/>`;
  }
  return `<defs>${rough(p + 'r', 3, 0.07, seed)}${blur(p + 'b', 1)}</defs><g filter="url(#${p}b)"><g stroke="#0b0d12" stroke-linecap="round" filter="url(#${p}r)">${branch}</g>${flowers}</g>`;
}

function nvxia(): HeroArt {
  const p = 'nx';
  const sky = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#060a13'], [0.38, '#122039'], [0.66, '#2b4260'], [1, '#0a111c']])}` +
      `<radialGradient id="${p}h" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#f4f0e2" stop-opacity=".6"/><stop offset=".4" stop-color="#c8d4e8" stop-opacity=".18"/><stop offset="1" stop-color="#c8d4e8" stop-opacity="0"/></radialGradient>` +
      `<radialGradient id="${p}mn" cx=".42" cy=".4" r=".6"><stop offset="0" stop-color="#fbf8ee"/><stop offset="1" stop-color="#e1dccb"/></radialGradient>${blur(p + 'mb', 4)}</defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/><circle cx="200" cy="290" r="230" fill="url(#${p}h)"/>` +
      `<circle cx="200" cy="290" r="118" fill="url(#${p}mn)"/>` +
      `<g filter="url(#${p}mb)" fill="#cfc8b3" opacity=".45"><ellipse cx="170" cy="260" rx="26" ry="18"/><ellipse cx="236" cy="318" rx="34" ry="20"/><ellipse cx="214" cy="232" rx="14" ry="10"/><ellipse cx="160" cy="330" rx="18" ry="12"/></g>`,
  );
  const far = scene(range(p + 'f', 23, 560, 60, 170, 7, '#0c1828', 0.75, 1.5));
  const mid = scene(range(p + 'm', 29, 660, 30, 110, 6, '#070d17', 0.9, 1.9));
  const mist = scene(mistBands(p + 'mi', 12, [520, 610, 700], '#c8d6ea', 0.35));
  const near = scene(plum(p + 'n', 31));
  const sleeve = [
    'M168 140 Q200 170 224 220 Q240 246 266 256 Q238 264 214 248 Q190 224 172 188 Z',
    'M168 140 Q204 166 232 214 Q250 238 278 244 Q246 258 218 244 Q192 222 172 188 Z',
    'M168 140 Q198 174 218 226 Q232 252 256 266 Q232 268 210 252 Q188 226 172 188 Z',
  ];
  const veil = [
    'M103 101 Q99 140 103 178 Q126 184 150 180 Q176 186 202 178 Q206 140 196 101 Z',
    'M103 101 Q101 140 107 176 Q130 182 152 178 Q180 182 208 172 Q210 136 196 101 Z',
    'M103 101 Q98 142 100 180 Q122 186 148 182 Q172 188 198 182 Q202 142 196 101 Z',
  ];
  const pibo = [
    'M96 232 C68 182 108 150 150 160 C200 172 232 150 272 120 C284 110 292 100 298 86',
    'M96 232 C66 186 104 146 150 154 C204 162 238 140 278 112 C290 104 298 94 304 80',
    'M96 232 C70 178 112 154 150 166 C196 180 228 160 266 130 C278 120 286 110 292 96',
  ];
  const fig = figure(
    p,
    `${vgrad(p + 'rb', [[0, '#fbfaf6'], [0.7, '#e3e6ea'], [1, '#b9c2cc']])}${rough(p + 'r', 1.8, 0.05, 8)}${glow(p + 'gl', 3)}` +
      `<linearGradient id="${p}bl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#8d98a4"/></linearGradient>`,
    // 披帛（身后）
    `<path fill="none" stroke="#cdbad6" stroke-width="5.5" stroke-linecap="round" opacity=".9" d="${pibo[0]}">${morph(pibo, 1.9)}</path>` +
      // 长发往右飘
      `<g>${sway(160, 120, 5, 1.8)}<path fill="#0c0c10" d="M160 110 Q198 130 214 180 Q226 220 252 242 Q216 238 196 202 Q182 172 158 140 Z"/></g>` +
      // 右袖往后飘
      `<path fill="url(#${p}rb)" stroke="#2b2a2a" stroke-width="1.2" d="${sleeve[0]}">${morph(sleeve, 1.7)}</path>` +
      // 裙摆
      `<g filter="url(#${p}r)"><path fill="url(#${p}rb)" stroke="#2b2a2a" stroke-width="1.3" d="M124 206 Q150 214 178 206 Q196 290 238 392 Q214 398 196 394 Q206 404 178 404 Q150 410 104 402 Q92 330 124 206 Z"/>` +
      `<path fill="none" stroke="#8b95a0" stroke-width="1" stroke-linecap="round" d="M140 222 Q132 300 128 398 M160 222 Q170 300 186 398 M176 230 Q196 300 220 386"/>` +
      // 上身、左袖（握剑那只手）
      `<path fill="url(#${p}rb)" stroke="#2b2a2a" stroke-width="1.2" d="M128 132 Q150 124 170 134 L178 210 Q150 218 122 210 Z"/>` +
      `<path fill="url(#${p}rb)" stroke="#2b2a2a" stroke-width="1.2" d="M130 138 Q104 170 92 230 Q86 262 102 276 Q116 262 118 240 Q122 200 140 160 Z"/></g>` +
      `<path fill="none" stroke="#9aa4ae" stroke-width=".9" d="M118 160 Q108 210 100 262"/>` +
      // 红腰带、两条穗子
      `<rect x="122" y="202" width="56" height="8" fill="#b3263a"/>` +
      `<g>${sway(172, 210, 7, 1.5)}<path fill="none" stroke="#b3263a" stroke-width="2.6" stroke-linecap="round" d="M172 210 Q190 250 214 290 M168 210 Q178 246 192 284"/></g>` +
      // 剑：倒提，剑尖往左下
      `<path fill="url(#${p}bl)" stroke="#3a4048" stroke-width=".6" d="M95 266 L101 269 L54 392 Z"/><path stroke="#ffffff" stroke-width=".7" opacity=".8" d="M98 268 L54 392"/>` +
      `<ellipse cx="99" cy="265" rx="9" ry="2.6" transform="rotate(19.5 99 265)" fill="#c9a458"/>` +
      `<line x1="100" y1="263" x2="104.5" y2="250" stroke="#2a2018" stroke-width="3.6"/><circle cx="105.5" cy="248" r="2.6" fill="#c9a458"/>` +
      `<g>${sway(106, 248, -10, 1.3)}<path fill="#c22a3a" d="M106 248 C96 236 90 238 82 226 C92 230 98 230 102 232 C94 222 94 214 92 204 C102 216 108 230 108 246 Z"/></g>` +
      `<ellipse cx="101.5" cy="259" rx="4.6" ry="5.4" fill="#efe2d4"/>` +
      // 头、帷帽、纱
      `<rect x="141" y="122" width="14" height="14" fill="#e9dccd"/><circle cx="148" cy="116" r="15" fill="#efe2d4"/><path fill="#0c0c10" d="M133 114 Q134 99 148 98 Q163 99 164 116 Q156 106 148 106 Q139 106 133 114 Z"/>` +
      `<path fill="#f3f0e6" fill-opacity=".52" stroke="#e8e4d8" stroke-width=".6" d="${veil[0]}">${morph(veil, 2)}</path>` +
      `<path fill="none" stroke="#ffffff" stroke-width=".35" opacity=".5" d="M112 104 L110 176 M124 103 L124 180 M136 102 L137 180 M160 102 L161 181 M172 102 L174 182 M184 103 L188 178"/>` +
      `<ellipse cx="150" cy="99" rx="47" ry="8.5" fill="#e9e4d6" stroke="#2b2a2a" stroke-width="1.2"/><path fill="#e9e4d6" stroke="#2b2a2a" stroke-width="1.2" d="M133 97 Q135 77 150 75 Q165 77 167 97 Z"/>` +
      // 月光描边
      `<g filter="url(#${p}gl)" fill="none" stroke="#ffffff" stroke-linecap="round" opacity=".8"><path stroke-width="1.2" d="M103 98 Q126 90 150 90"/><path stroke-width="1" d="M92 232 Q100 180 128 140"/></g>`,
  );
  return { sky, far, mid, mist, near, fig, splash: splash(p + 's', 57, '#e8eef8', '#5c7898', '#a8bcd6') };
}

// ───────────────────────── 大圣：云海、金光 ─────────────────────────

function cloudSea(seed: number, rows: [number, number, number, string, string][]) {
  const r = rng(seed);
  let s = '';
  for (const [y, w, count, fill, stroke] of rows) {
    for (let i = 0; i < count; i++) s += cloud(-20 + (i + r() * 0.6) * (440 / count), y + (r() - 0.5) * 20, w * (0.8 + r() * 0.5), fill, stroke, 1.6);
  }
  return s;
}

function dasheng(): HeroArt {
  const p = 'ds';
  let rays = '';
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const b = a + 0.06;
    rays += `M200 330 L${n1(200 + Math.cos(a) * 700)} ${n1(330 + Math.sin(a) * 700)} L${n1(200 + Math.cos(b) * 700)} ${n1(330 + Math.sin(b) * 700)} Z `;
  }
  const sky = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#2e2140'], [0.3, '#8a4a3a'], [0.5, '#e09a4a'], [0.62, '#ffe2a0'], [0.72, '#fff3d4'], [1, '#f2d7a0']])}` +
      `<radialGradient id="${p}h" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff8dc" stop-opacity=".95"/><stop offset=".35" stop-color="#ffd27a" stop-opacity=".35"/><stop offset="1" stop-color="#ffb040" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/>` +
      `<g opacity=".16" fill="#fff2c0"><animateTransform attributeName="transform" type="rotate" from="0 200 330" to="12 200 330" dur="6s" fill="freeze"/><path d="${rays}"/></g>` +
      `<circle cx="200" cy="330" r="170" fill="url(#${p}h)"/>`,
  );
  const far = scene(range(p + 'f', 41, 560, 80, 230, 6, '#4a3448', 0.62, 2.8) + `<g opacity=".85">${cloudSea(3, [[560, 90, 6, 'rgba(255,246,226,.85)', '#d9b878']])}</g>`);
  const mid = scene(cloudSea(7, [[640, 120, 5, 'rgba(255,248,232,.92)', '#c9a258'], [700, 140, 4, 'rgba(255,240,214,.95)', '#b89048']]));
  const mist = scene(mistBands(p + 'mi', 15, [600, 660], '#fff6e0', 0.55));
  const near = scene(`<defs>${blur(p + 'nb', 2.2)}</defs><g filter="url(#${p}nb)">${cloudSea(11, [[770, 190, 3, 'rgba(255,250,238,.96)', '#c09a50']])}</g>`);
  const feath = [
    ['M140 80 C118 22 62 -4 16 22 C62 2 116 28 146 80 Z', 'M140 80 C114 24 56 0 10 30 C58 6 112 30 146 80 Z', 'M140 80 C122 20 68 -6 24 16 C66 0 120 26 146 80 Z'],
    ['M158 80 C178 18 236 -4 286 22 C238 4 182 26 164 82 Z', 'M158 80 C182 20 244 0 294 30 C242 8 186 28 164 82 Z', 'M158 80 C174 16 228 -6 278 16 C232 0 178 24 164 82 Z'],
  ];
  const tail = 'M172 252 Q214 262 224 300 Q230 332 206 338 Q192 336 198 322 Q212 322 210 304 Q202 276 168 266 Z';
  const fig = figure(
    p,
    `<linearGradient id="${p}st" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#2a1a0a"/><stop offset=".5" stop-color="#4a3418"/><stop offset="1" stop-color="#140c05"/></linearGradient>` +
      `<linearGradient id="${p}gd" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#8a5a14"/><stop offset=".45" stop-color="#fff0b0"/><stop offset="1" stop-color="#a06a18"/></linearGradient>` +
      `${vgrad(p + 'cp', [[0, '#9a2418'], [1, '#4a0c08']])}${vgrad(p + 'ar', [[0, '#e0aa48'], [1, '#8a5a1c']])}${vgrad(p + 'cl', [[0, '#fffaf0'], [1, '#f0d69a']])}` +
      `${rough(p + 'r', 2.2, 0.05, 12)}${glow(p + 'gl', 2.4)}${glow(p + 'gl2', 6)}`,
    // 筋斗云
    `<g>${cloud(150, 384, 250, `url(#${p}cl)`, '#a8803a', 1.8)}${cloud(64, 398, 110, `url(#${p}cl)`, '#a8803a', 1.4)}${cloud(244, 400, 100, `url(#${p}cl)`, '#a8803a', 1.4)}</g>` +
      // 尾巴、披风
      `<g filter="url(#${p}r)"><path fill="#2a1a10" d="${tail}">${morph([tail, 'M172 252 Q218 258 230 296 Q238 328 214 336 Q200 336 204 322 Q218 320 216 302 Q206 272 168 266 Z', 'M172 252 Q210 266 218 304 Q222 336 198 340 Q186 336 192 324 Q206 324 204 306 Q198 280 168 266 Z'], 2)}</path>` +
      `<path fill="url(#${p}cp)" d="M120 146 Q170 140 200 156 Q240 220 272 320 Q238 314 222 330 Q208 300 186 286 L168 160 Z">${morph(
        [
          'M120 146 Q170 140 200 156 Q240 220 272 320 Q238 314 222 330 Q208 300 186 286 L168 160 Z',
          'M120 146 Q172 136 204 150 Q250 210 288 306 Q252 304 234 318 Q214 292 188 282 L168 160 Z',
          'M120 146 Q168 142 198 160 Q234 228 262 330 Q230 322 214 338 Q204 306 184 290 L168 160 Z',
        ],
        1.8,
      )}</path>` +
      // 腿、靴
      `<path fill="#2a2018" d="M120 286 L112 340 L106 372 L128 374 L138 336 L146 292 Z M156 292 L170 336 L180 372 L202 370 L192 334 L184 286 Z"/>` +
      `<path fill="#120c08" d="M102 366 L132 368 L134 380 L98 380 Z M176 366 L206 364 L210 378 L174 380 Z"/>` +
      // 虎皮裙
      `<path fill="#d8a030" stroke="#5a3a10" stroke-width="1.2" d="M116 232 Q150 244 186 232 L198 290 Q150 300 104 290 Z"/>` +
      `<path fill="none" stroke="#1a1008" stroke-width="2.4" stroke-linecap="round" d="M124 246 q4 8 0 16 M138 250 q-4 10 2 20 M156 250 q5 9 -1 20 M172 246 q-4 10 2 18 M186 252 q4 10 0 22 M114 270 q5 6 2 14 M130 276 q4 6 0 10 M166 278 q-3 6 0 10"/>` +
      // 锁子黄金甲
      `<path fill="url(#${p}ar)" stroke="#5a3a10" stroke-width="1.2" d="M124 150 Q150 140 176 150 L182 236 Q150 246 120 236 Z"/>` +
      `<path fill="none" stroke="#7a5216" stroke-width=".9" opacity=".8" d="M126 166 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0 M124 182 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0 M124 198 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0 M124 214 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0 q6 5 12 0"/>` +
      // 左臂抬起搭凉棚、右臂握棒
      `<path fill="url(#${p}ar)" stroke="#5a3a10" stroke-width="1" d="M128 154 Q104 140 98 118 L108 112 Q116 130 136 142 Z"/><path fill="#d9b48a" d="M100 118 L112 88 L120 90 L110 120 Z"/>` +
      `<path fill="#c9a07a" d="M110 84 L144 80 L146 87 L112 91 Z"/>` +
      `<path fill="url(#${p}ar)" stroke="#5a3a10" stroke-width="1" d="M172 154 Q200 170 222 196 L214 206 Q194 186 168 172 Z"/>` +
      // 头：毛脸、凤翅紫金冠
      `<circle cx="150" cy="106" r="21" fill="#4a3220"/>` +
      `</g>` +
      `<path fill="#d9b48a" d="M136 100 Q150 92 162 100 Q166 114 156 122 Q150 126 142 122 Q132 114 136 100 Z"/>` +
      `<circle cx="128.5" cy="107" r="5" fill="#d9b48a" stroke="#4a3220" stroke-width="2.2"/><circle cx="171.5" cy="107" r="5" fill="#d9b48a" stroke="#4a3220" stroke-width="2.2"/>` +
      `<path fill="none" stroke="#2a1a10" stroke-width="2.2" stroke-linecap="round" d="M138 99 Q144 95 149 99 M151 99 Q156 95 162 99"/>` +
      `<circle cx="148" cy="111" r="1.1" fill="#2a1a10"/><circle cx="152" cy="111" r="1.1" fill="#2a1a10"/>` +
      `<path fill="none" stroke="#2a1a10" stroke-width="1.4" stroke-linecap="round" d="M143 116 Q148 119 153 116"/>` +
      `<circle cx="143.5" cy="104" r="2.6" fill="#ffe27a" filter="url(#${p}gl2)"/><circle cx="155.5" cy="104" r="2.6" fill="#ffe27a" filter="url(#${p}gl2)"/>` +
      `<path fill="url(#${p}gd)" stroke="#6a4410" stroke-width="1" d="M129 92 Q150 76 171 92 L168 82 Q150 68 132 82 Z"/><circle cx="150" cy="76" r="4.2" fill="#d8261e"/>` +
      // 雉翎：两根长长地往后弯
      `<g fill="#3a1a10" stroke="#e0a848" stroke-width=".8"><path d="${feath[0][0]}">${morph(feath[0], 2.2)}</path><path d="${feath[1][0]}">${morph(feath[1], 2.4)}</path></g>` +
      // 金箍棒：两头金箍、中间乌铁
      `<rect x="222" y="24" width="8.5" height="372" rx="2" fill="url(#${p}st)"/>` +
      `<g filter="url(#${p}gl)"><rect x="220.5" y="20" width="11.5" height="34" rx="2" fill="url(#${p}gd)"/><rect x="220.5" y="362" width="11.5" height="34" rx="2" fill="url(#${p}gd)"/></g>` +
      `<ellipse cx="224" cy="200" rx="8" ry="9" fill="#4a3220"/>`,
  );
  return { sky, far, mid, mist, near, fig, splash: splash(p + 's', 69, '#fff4c8', '#e0a040', '#f0c060') };
}

const MAKERS: Record<HeroId, () => HeroArt> = { daoke, guangong, nezha, nvxia, dasheng };
const cache = new Map<HeroId, HeroArt>();
/**
 * 某个人物的整套画（第一次用时现画，留着）。
 * 每一层的 id 再套一层前缀（层名）：几层同时放在一页里，各层自己起的 id 难免撞上
 * （中景的山叫 ggm，人物的遮罩也叫 ggm，url(#ggm) 就指到山的渐变上去了，人物身上那道流光就漏出了人形）
 */
export function heroArt(id: HeroId): HeroArt {
  let a = cache.get(id);
  if (!a) {
    const raw = MAKERS[id]();
    const scoped = {} as HeroArt;
    for (const k of Object.keys(raw) as (keyof HeroArt)[]) scoped[k] = raw[k].replace(/(id="|url\(#|href="#)/g, `$1${k}-`);
    a = scoped;
    cache.set(id, a);
  }
  return a;
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
