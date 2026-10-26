/**
 * 对局画面的底，跟着棋盘走：水墨的几套（还有木盘、玉盘这些）还是原来那幅很暗的夜色远山（inkart.inkBackdrop），
 * 敦煌飞天配一幅大漠的黄昏：一弯新月，几条飞天的飘带，层层沙丘，远处一座九层楼。
 *
 * 用户原话："棋盘以及画面在增加一些特色……除了水墨色彩，其他形式的也可以在增加一些。"
 * 原来还有星河（深空）、霓虹（夜里的城、数据雨）、烽火（烧着的城墙）三幅，跟着那三套棋盘一起拿掉了
 * （用户原话："那些特别让人眼花的棋盘样式把它取消掉"）。
 *
 * 分两张 SVG：底下那张静止（带模糊滤镜，只画一次），上面那张只有会眨眼的几颗星，不带滤镜——
 * 动的时候只重画这几小块，不会每帧把整幅带模糊的画重算一遍。颜色都压得很暗：棋盘才是主角。
 */
import type { BoardId } from './boardtheme';
import { blur, inkBackdrop, n1, rng, scene, vgrad } from './inkart';

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
  return board === 'dunhuang' ? desertBackdrop() : inkBackdrop();
}

/** 换棋盘的时候要不要换底：只有换到另一幅的时候才换 */
export const backdropKey = (board: BoardId) => (board === 'dunhuang' ? board : 'ink');
