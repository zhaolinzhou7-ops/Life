/**
 * 对局画面的底，跟着棋盘走：水墨的几套（还有木盘、玉盘这些）还是原来那幅很暗的夜色远山（inkart.inkBackdrop），
 * 水墨以外的几套典藏各配一幅：
 *   - 星河夜弈：深空、一条斜着的银河、几团星云，地平线一抹黑山；
 *   - 霓虹赛博：夜里的城，楼上一格格霓虹窗，地平线一道洋红的光，底下透视的霓虹地网，天上落"数据雨"（棋子的字）；
 *   - 烽火沙场：被火光映红的夜，远处城墙、两座烽火台在烧，黑烟往上冒；
 *   - 敦煌飞天：大漠的黄昏，一弯新月，几条飞天的飘带，层层沙丘，远处一座九层楼。
 *
 * 用户原话："棋盘以及画面在增加一些特色……除了水墨色彩，其他形式的也可以在增加一些。"
 *
 * 每幅分两张 SVG：底下那张静止（带模糊滤镜，只画一次），上面那张只有会动的小东西（星星眨眼、火苗、火星、数据雨），
 * 不带滤镜——动的时候只重画这些小块，不会每帧把整幅带模糊的画重算一遍。颜色都压得很暗：棋盘才是主角。
 */
import type { BoardId } from './boardtheme';
import { blur, inkBackdrop, mistBands, n1, range, rng, scene, vgrad } from './inkart';

/** 会动的那一张：和底图同一个坐标（400×800，铺满裁边） */
const live = (inner: string) => `<svg class="xq-bg-live" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" xmlns="http://www.w3.org/2000/svg">${inner}</svg>`;

/** 撒星：n 颗，大小亮暗不一；每隔几颗挑一颗会眨眼（放到会动的那一张） */
function starField(seed: number, n: number, yMax: number, color = '#ffffff'): { still: string; tw: string } {
  const r = rng(seed);
  let still = '';
  let tw = '';
  for (let i = 0; i < n; i++) {
    const x = r() * 400;
    const y = Math.pow(r(), 1.3) * yMax;
    const s = 0.4 + Math.pow(r(), 3) * 1.5;
    const a = 0.25 + r() * 0.6;
    if (i % 8 === 0) tw += `<circle class="tw" cx="${n1(x)}" cy="${n1(y)}" r="${n1(s + 0.4)}" fill="${color}" style="animation-delay:${n1(-r() * 4)}s;animation-duration:${n1(2.4 + r() * 2.6)}s"/>`;
    else still += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(s)}" fill="${color}" fill-opacity="${n1(a)}"/>`;
  }
  return { still, tw };
}

function starBackdrop(): string {
  const p = 'sb';
  const r = rng(77);
  const { still, tw } = starField(31, 260, 800, '#eef2ff');
  // 银河里的星尘：顺着斜带撒
  let dust = '';
  for (let i = 0; i < 420; i++) {
    const t = r() * 1.3 - 0.15;
    const off = ((r() + r() + r()) / 3 - 0.5) * 120;
    const x = -40 + t * 480 + off * 0.47;
    const y = 690 - t * 520 + off * 0.88;
    dust += `<circle cx="${n1(x)}" cy="${n1(y)}" r="${n1(0.3 + r() * 0.7)}" fill-opacity="${n1(0.2 + r() * 0.5)}"/>`;
  }
  const glint = (x: number, y: number, s: number) =>
    `<g transform="translate(${x} ${y})"><circle r="${s * 3}" fill="url(#${p}gl)"/><path d="M${-s * 4} 0H${s * 4}M0 ${-s * 4}V${s * 4}" stroke="#e8eeff" stroke-opacity=".7" stroke-width="${n1(s * 0.25)}"/></g>`;
  const bg = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#070a22'], [0.45, '#0c0f2e'], [0.75, '#120c2c'], [1, '#05060f']])}${blur(p + 'b', 22)}${blur(p + 'b2', 6)}` +
      `<radialGradient id="${p}gl"><stop offset="0" stop-color="#f2f5ff" stop-opacity=".9"/><stop offset=".3" stop-color="#b8c6ff" stop-opacity=".25"/><stop offset="1" stop-color="#b8c6ff" stop-opacity="0"/></radialGradient></defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/>` +
      // 星云：紫的、青的、玫红的几团
      `<g filter="url(#${p}b)"><circle cx="70" cy="190" r="110" fill="#5a2a8c" opacity=".38"/><circle cx="340" cy="640" r="130" fill="#1b5f88" opacity=".32"/>` +
      `<circle cx="310" cy="110" r="80" fill="#8a2a6c" opacity=".22"/><circle cx="120" cy="560" r="90" fill="#3a2a90" opacity=".25"/>` +
      // 银河：一条斜着的亮带
      `<ellipse cx="200" cy="400" rx="520" ry="70" transform="rotate(-62 200 400)" fill="#7c70ff" opacity=".2"/></g>` +
      `<g filter="url(#${p}b2)"><ellipse cx="200" cy="400" rx="460" ry="20" transform="rotate(-62 200 400)" fill="#e8e0ff" opacity=".22"/></g>` +
      `<g fill="#f0eeff">${dust}</g><g>${still}</g>` +
      glint(318, 92, 2.4) + glint(64, 330, 1.8) + glint(352, 470, 1.6) + glint(150, 120, 1.4) +
      range(p + 'm', 23, 770, 20, 70, 6, '#03040b', 0.95, 1.5),
  );
  return bg + live(tw);
}

function neonBackdrop(): string {
  const p = 'nb';
  const r = rng(311);
  const hz = 640;
  // 楼：一排高高低低的方块，窗户一格格亮着（青、洋红、暖黄）
  let blds = '';
  let wins = '';
  for (let x = -12; x < 412; ) {
    const w = 16 + r() * 34;
    const h = 40 + Math.pow(r(), 1.6) * 190;
    blds += `<rect x="${n1(x)}" y="${n1(hz - h)}" width="${n1(w + 1)}" height="${n1(h)}"/>`;
    // 楼顶的天线
    if (r() < 0.3) blds += `<rect x="${n1(x + w / 2)}" y="${n1(hz - h - 18)}" width="1.2" height="18"/>`;
    for (let wy = hz - h + 6; wy < hz - 6; wy += 7) {
      for (let wx = x + 3; wx < x + w - 4; wx += 6) {
        if (r() < 0.24) {
          const c = r() < 0.5 ? '#3af0ff' : r() < 0.6 ? '#ff4fd8' : '#ffcf6a';
          wins += `<rect x="${n1(wx)}" y="${n1(wy)}" width="3" height="3.4" fill="${c}" fill-opacity="${n1(0.25 + r() * 0.5)}"/>`;
        }
      }
    }
    x += w + 1 + r() * 4;
  }
  // 地网：透视的线，往地平线中间收
  let grid = '';
  for (let i = -12; i <= 12; i++) grid += `M200 ${hz}L${200 + i * 70} 820`;
  for (let k = 1; k < 12; k++) {
    const y = hz + Math.pow(k / 11, 2.1) * 170;
    grid += `M-10 ${n1(y)}H410`;
  }
  // 太阳：洋红到橘黄的一个大圆，下半截一道道横着切开（合成波那种）
  let cuts = '';
  for (let k = 0; k < 7; k++) cuts += `<rect x="90" y="${n1(hz - 70 + k * 10 + k * k * 0.6)}" width="220" height="${n1(1.2 + k * 0.7)}" fill="#000"/>`;
  const bg = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#04030c'], [0.5, '#110726'], [0.78, '#2a0a3a'], [0.8, '#0a0414'], [1, '#05040c']])}${blur(p + 'b', 10)}${blur(p + 'b2', 3)}` +
      `${vgrad(p + 'sun', [[0, '#ffb35a'], [0.6, '#ff4f9a'], [1, '#c22aff']])}` +
      `<mask id="${p}m"><rect width="400" height="800" fill="#fff"/>${cuts}</mask>` +
      `${vgrad(p + 'fl', [[0, '#3af0ff', 0.55], [1, '#3af0ff', 0.12]])}</defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/>` +
      `<g filter="url(#${p}b)" opacity=".55"><circle cx="200" cy="${hz - 40}" r="120" fill="#ff3fa4" opacity=".35"/></g>` +
      `<circle cx="200" cy="${hz - 40}" r="86" fill="url(#${p}sun)" opacity=".5" mask="url(#${p}m)"/>` +
      `<g fill="#06030d">${blds}</g><g>${wins}</g>` +
      `<g filter="url(#${p}b2)"><rect x="-10" y="${hz - 2}" width="420" height="5" fill="#ff4fd8" opacity=".8"/></g>` +
      `<rect x="-10" y="${hz - 0.6}" width="420" height="1.4" fill="#ffd0f4"/>` +
      `<path d="${grid}" stroke="url(#${p}fl)" stroke-width="1" fill="none"/>`,
  );
  // 数据雨：天上一列列往下落的字（棋子的那几个字），很淡
  const chars = '车马炮相仕帅兵将士象卒砲01';
  let rain = '';
  for (let i = 0; i < 16; i++) {
    const x = 8 + i * 25 + r() * 8;
    let col = '';
    const n = 6 + Math.floor(r() * 8);
    for (let k = 0; k < n; k++) col += `<text x="${n1(x)}" y="${k * 15}" fill-opacity="${n1(((k + 1) / n) * 0.9)}">${chars[Math.floor(r() * chars.length)]}</text>`;
    rain += `<g class="rain" style="animation-duration:${n1(7 + r() * 8)}s;animation-delay:${n1(-r() * 12)}s">${col}</g>`;
  }
  return bg + live(`<g class="rain-all" fill="#3af0ff" font-size="12" font-family="system-ui,sans-serif">${rain}</g><rect class="hz" x="-10" y="${hz - 3}" width="420" height="6" fill="#ff4fd8"/>`);
}

function warBackdrop(): string {
  const p = 'wb';
  const r = rng(907);
  const wall = 700;
  // 城墙：一排垛口
  let cren = `M-10 820V${wall}`;
  for (let x = -10; x < 410; x += 16) cren += `H${x + 8}V${wall - 9}H${x + 16}V${wall}`;
  cren += 'V820Z';
  // 烽火台：梯形的台子，顶上一堆火
  const tower = (x: number, w: number, h: number) =>
    `<path d="M${x - w / 2} ${wall + 2}L${x - w * 0.36} ${wall - h}H${x + w * 0.36}L${x + w / 2} ${wall + 2}Z"/>` +
    `<path d="M${x - w * 0.42} ${wall - h}h${w * 0.84}v-8h-${w * 0.14}v4h-${w * 0.14}v-4h-${w * 0.14}v4h-${w * 0.14}v-4h-${w * 0.14}v4h-${w * 0.14}z"/>`;
  const towers = [
    [72, 46, 92],
    [322, 54, 120],
  ] as const;
  // 黑烟：一串越往上越大越淡的团
  let smoke = '';
  for (const [x, , h] of towers) {
    for (let k = 0; k < 9; k++) {
      const y = wall - h - 20 - k * 48;
      smoke += `<ellipse cx="${n1(x + Math.sin(k * 0.8) * 14 + k * 9)}" cy="${n1(y)}" rx="${n1(16 + k * 9)}" ry="${n1(14 + k * 6)}" opacity="${n1(0.5 - k * 0.045)}"/>`;
    }
  }
  // 旗：城墙上几面
  let flags = '';
  for (const x of [130, 188, 250]) {
    flags += `<rect x="${x}" y="${wall - 56}" width="1.6" height="56"/><path class="flag" d="M${x + 1.6} ${wall - 56}q12 -3 26 2t26 -1v20q-12 4 -26 -1t-26 2z"/>`;
  }
  const bg = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#0a0403'], [0.4, '#1d0806'], [0.68, '#3e1208'], [0.84, '#6a2208'], [1, '#160704']])}${blur(p + 'b', 26)}${blur(p + 'b2', 9)}</defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/>` +
      `<g filter="url(#${p}b)"><ellipse cx="200" cy="690" rx="320" ry="110" fill="#ff5a12" opacity=".3"/><ellipse cx="322" cy="${wall - 130}" rx="70" ry="60" fill="#ff7a1a" opacity=".35"/><ellipse cx="72" cy="${wall - 100}" rx="56" ry="50" fill="#ff7a1a" opacity=".3"/></g>` +
      mistBands(p + 'c', 41, [90, 170], '#3a1208', 0.5) +
      range(p + 'm', 61, 668, 30, 110, 7, '#1a0805', 0.9, 1.4) +
      `<g filter="url(#${p}b2)" fill="#140806">${smoke}</g>` +
      `<g fill="#0b0402"><path d="${cren}"/>${towers.map(([x, w, h]) => tower(x, w, h)).join('')}${flags}</g>`,
  );
  // 会动的：两堆火一明一暗，火星往上飞
  const fire = (x: number, y: number, s: number) =>
    `<g class="fire" style="transform-origin:${x}px ${y}px"><circle cx="${x}" cy="${y - s * 0.4}" r="${s * 1.7}" fill="url(#${p}fg)"/>` +
    `<path d="M${x - s} ${y}q${s * 0.2} ${-s * 1.4} ${s * 0.6} ${-s * 2.2}q${s * 0.1} ${s * 0.9} ${s * 0.5} ${s * 0.9}q${s * 0.3} ${-s * 0.9} ${s * 0.1} ${-s * 1.8}q${s * 1.1} ${s * 1.2} ${s * 0.8} ${s * 3.1}z" fill="url(#${p}ff)"/></g>`;
  let embers = '';
  for (let i = 0; i < 26; i++) {
    const [tx, , th] = towers[i % 2];
    const x = i < 16 ? tx + (r() - 0.5) * 40 : r() * 400;
    const y = i < 16 ? wall - th - 6 : 690 + r() * 60;
    embers += `<circle class="em" cx="${n1(x)}" cy="${n1(y)}" r="${n1(0.8 + r() * 1.4)}" style="animation-duration:${n1(3 + r() * 4)}s;animation-delay:${n1(-r() * 6)}s;--dx:${n1((r() - 0.5) * 40)}px"/>`;
  }
  return (
    bg +
    live(
      `<defs><radialGradient id="${p}fg"><stop offset="0" stop-color="#ffb040" stop-opacity=".7"/><stop offset="1" stop-color="#ff5a10" stop-opacity="0"/></radialGradient>` +
        `${vgrad(p + 'ff', [[0, '#fff2b0'], [0.4, '#ffb030'], [1, '#e8400c']])}</defs>` +
        towers.map(([x, , h]) => fire(x, wall - h - 8, x > 200 ? 12 : 10)).join('') +
        `<g fill="#ffb050">${embers}</g>`,
    )
  );
}

function desertBackdrop(): string {
  const p = 'db';
  const { still, tw } = starField(53, 90, 420, '#fff2dc');
  // 一层沙丘：平滑起伏，脊线上一道受光的亮边
  const dune = (seed: number, base: number, amp: number, fill: string, crest: string) => {
    const r = rng(seed);
    const k1 = 1 + r() * 1.5;
    const k2 = 2 + r() * 2;
    const ph = r() * 6;
    let d = `M-10 ${base}`;
    for (let x = -10; x <= 410; x += 6) {
      const y = base - amp * (0.55 * Math.sin((x / 400) * Math.PI * k1 + ph) + 0.3 * Math.sin((x / 400) * Math.PI * k2 + ph * 2) + 0.4);
      d += `L${x} ${n1(y)}`;
    }
    return `<path d="${d}L410 820L-10 820Z" fill="${fill}"/><path d="${d}" fill="none" stroke="${crest}" stroke-width="1.4"/>`;
  };
  // 九层楼（莫高窟那座）：一层层的檐，越往上越窄
  let pag = '';
  const px = 96;
  let py = 652;
  for (let k = 0; k < 7; k++) {
    const w = 46 - k * 5;
    const h = 9 - k * 0.5;
    pag += `<rect x="${n1(px - w * 0.38)}" y="${n1(py - h)}" width="${n1(w * 0.76)}" height="${n1(h)}"/>`;
    pag += `<path d="M${n1(px - w / 2 - 3)} ${n1(py - h)}Q${px} ${n1(py - h - 5)} ${n1(px + w / 2 + 3)} ${n1(py - h)}L${n1(px + w * 0.38)} ${n1(py - h - 3)}H${n1(px - w * 0.38)}Z"/>`;
    py -= h + 3;
  }
  pag += `<rect x="${px - 0.8}" y="${n1(py - 10)}" width="1.6" height="10"/>`;
  // 飘带：天上几条长长的、带弯的彩带（飞天的衣袂）
  const ribbon = (d: string, c: string, w: number, o: number) => `<path d="${d}" stroke="${c}" stroke-width="${w}" stroke-opacity="${o}" fill="none" stroke-linecap="round"/>`;
  const bg = scene(
    `<defs>${vgrad(p + 'sk', [[0, '#100a1c'], [0.38, '#26162e'], [0.62, '#5c2e34'], [0.78, '#a85a38'], [0.86, '#5a2c18'], [1, '#2a140a']])}${blur(p + 'b', 18)}${blur(p + 'b2', 2)}` +
      `<radialGradient id="${p}mg"><stop offset="0" stop-color="#ffe9b8" stop-opacity=".35"/><stop offset="1" stop-color="#ffe9b8" stop-opacity="0"/></radialGradient>` +
      `<mask id="${p}cm"><rect width="400" height="800" fill="#fff"/><circle cx="312" cy="104" r="24" fill="#000"/></mask></defs>` +
      `<rect width="400" height="800" fill="url(#${p}sk)"/><g>${still}</g>` +
      // 一弯新月
      `<circle cx="300" cy="112" r="70" fill="url(#${p}mg)"/><circle cx="300" cy="112" r="26" fill="#f6e0a8" mask="url(#${p}cm)"/>` +
      `<g filter="url(#${p}b)"><ellipse cx="200" cy="640" rx="300" ry="70" fill="#ff9a50" opacity=".25"/></g>` +
      `<g filter="url(#${p}b2)">` +
      ribbon('M-20 210C60 160 110 260 190 220S320 140 430 190', '#c8432c', 3.2, 0.32) +
      ribbon('M-20 236C80 200 120 290 210 250S330 180 430 222', '#3e9a80', 2.4, 0.28) +
      ribbon('M30 300C90 270 150 330 230 300S350 260 420 290', '#d8a548', 1.8, 0.26) +
      `</g>` +
      dune(5, 672, 40, '#4a2516', 'rgba(220,140,80,0.22)') +
      `<g fill="#2e160c">${pag}</g>` +
      dune(9, 726, 46, '#33190e', 'rgba(230,150,90,0.25)') +
      dune(14, 784, 40, '#1e0e07', 'rgba(230,150,90,0.2)'),
  );
  return bg + live(tw);
}

/** 这块棋盘配哪一幅底（没单配的都是水墨远山） */
export function backdropFor(board: BoardId): string {
  switch (board) {
    case 'xinghe':
      return starBackdrop();
    case 'neon':
      return neonBackdrop();
    case 'fenghuo':
      return warBackdrop();
    case 'dunhuang':
      return desertBackdrop();
    default:
      return inkBackdrop();
  }
}

/** 换棋盘的时候要不要换底：只有换到另一幅的时候才换 */
export const backdropKey = (board: BoardId) => (['xinghe', 'neon', 'fenghuo', 'dunhuang'].includes(board) ? board : 'ink');
