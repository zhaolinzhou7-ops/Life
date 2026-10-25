/**
 * 棋盘、棋子样式选择：上面一块实时预览，下面依次是现成搭配、棋盘、棋子、字体、繁体字，
 * 再往下是出场人物、配音（男声女声）、对局特效开关——"好不好看、好不好听"的事都在这一页。
 * 点哪一项当场换，所有棋盘（包括正在下的那一盘）都跟着换；存在 localStorage，下次打开还是这一套。
 */
import { Board2D } from './board2d';
import {
  BOARDS,
  DEFAULT_LOOK,
  boardStyle,
  FONTS,
  PIECES,
  PRESETS,
  boardPadY,
  ensureFont,
  fontOf,
  getLook,
  onLook,
  paintBoard,
  paintPiece,
  presetOf,
  setLook,
  type Look,
} from './boardtheme';
import { applyMove, initialBoard, legalMoves, type Color, type PType } from './rules';
import { textToMove } from './notation';
import { liftBack } from './navbar';
import { fxEnabled, setFxEnabled } from './fx';
import { HEROES, getHeroPick, playHeroIntro, preloadHero, setHeroPick, type HeroPick } from './intro';
import { heroArt, type HeroId } from './heroart';
import { getAnnounce, getVoiceKind, getVoiceVolume, preloadAnnounce, setAnnounce, setVoiceKind, setVoiceVolume, xqAnnounce, xqShout, type VoiceKind } from '../xqvoice';
import { getXqMusicVolume, setXqMusicVolume } from '../xqmusic';
import { unlockAudio } from '../gamesfx';

/** 预览用的局面：开局走了几步，红黑各种子都在、有子过了河 */
function sampleBoard() {
  let b = initialBoard();
  let c: Color = 'r';
  for (const t of ['炮二平五', '马8进7', '马二进三', '车9平8', '车一平二', '炮8进4', '兵三进一', '马2进3']) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) break;
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return b;
}

/**
 * 一张小样：棋盘左上角那几格 + 几个棋子。
 * big：看棋子、字体用——棋子画大（半径是高的几成），x、y 是占宽高的几成，底下还是这套棋盘
 */
function swatch(look: Look, w: number, h: number, pieces: { x: number; y: number; t: PType; c: Color }[], big = 0, river = false): HTMLCanvasElement {
  const cv = document.createElement('canvas');
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(h * dpr);
  cv.style.width = `${w}px`;
  cv.style.height = `${h}px`;
  const g = cv.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  // 三行格子正好放得下：最上一行的棋子到第三行的棋子都完整露出来
  const c = (h - 4) / 3.2;
  // river：典藏棋盘的画在楚河汉界正中那两格，小样就对着那里（第 3～6 条横线、第 2～6 路）
  const x0 = river ? w / 2 - 4 * c : c * 0.62 + 6;
  const y0 = river ? h / 2 - 4.5 * c : c * boardPadY(false) + 4;
  paintBoard(g, { x0, y0, c, cols: 9, rows: 10, flip: false, coords: false, dpr }, look);
  for (const p of pieces) {
    const cx = big ? p.x * w : x0 + p.x * c;
    const cy = big ? p.y * h : y0 + p.y * c;
    paintPiece(g, cx, cy, big ? h * big : c * 0.44, p.t, p.c, look, dpr);
  }
  return cv;
}

/** 出场人物的小样：天空 + 人物（id 换个前缀，和正在演的那一场不串） */
function heroThumb(id: HeroId): HTMLElement {
  const a = heroArt(id);
  const re = (svg: string) => svg.replace(/(id="|url\(#|href="#)/g, '$1t');
  const el = document.createElement('div');
  el.className = 'xq-hero-pic';
  el.innerHTML = `<div class="sky">${re(a.sky)}</div><div class="fig">${re(a.fig)}</div>`;
  // 小样停在一个姿势上（流光扫过去之后）：五张一直飘着，这一页开着就一直在耗电
  requestAnimationFrame(() =>
    el.querySelectorAll('svg').forEach((s) => {
      s.setCurrentTime(3.2);
      s.pauseAnimations();
    }),
  );
  return el;
}
function textThumb(cls: string, text: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `xq-hero-pic ${cls}`;
  el.innerHTML = `<span>${text}</span>`;
  return el;
}

export function renderLookPicker(host: HTMLElement, onBack: () => void): () => void {
  const s = document.createElement('div');
  s.className = 'screen xq-setup xq-look';
  host.appendChild(s);
  s.innerHTML = `<h1>样式、出场、配音</h1><div class="sub">点一下当场换，正在下的棋也跟着换</div>`;

  // 实时预览
  const pv = document.createElement('div');
  pv.className = 'xq-look-preview';
  s.appendChild(pv);
  const view = new Board2D(pv, { coords: true });
  view.setBoard(sampleBoard());
  view.setLastMove({ fx: 1, fy: 0, tx: 2, ty: 2 });
  view.setMarks([
    { x: 1, y: 7, kind: 'ring' },
    { x: 1, y: 6, kind: 'dot' },
    { x: 1, y: 5, kind: 'dot' },
    { x: 1, y: 3, kind: 'dot' },
  ]);

  const body = document.createElement('div');
  s.appendChild(body);

  const section = (title: string, note?: string) => {
    const h = document.createElement('div');
    h.className = 'xq-sec';
    h.textContent = title;
    body.appendChild(h);
    if (note) {
      const n = document.createElement('div');
      n.className = 'xq-note';
      n.textContent = note;
      body.appendChild(n);
    }
    const grid = document.createElement('div');
    grid.className = 'xq-look-grid';
    body.appendChild(grid);
    return grid;
  };
  const card = (grid: HTMLElement, name: string, desc: string, on: boolean, art: () => HTMLElement, pick: () => void, attr: Record<string, string>) => {
    const el = document.createElement('button');
    el.className = `card xq-look-card${on ? ' selected' : ''}`;
    for (const [k, v] of Object.entries(attr)) el.dataset[k] = v;
    const pic = document.createElement('div');
    pic.className = 'pic';
    el.appendChild(pic);
    const t = document.createElement('div');
    t.className = 'title';
    t.textContent = name;
    el.appendChild(t);
    const d = document.createElement('div');
    d.className = 'desc';
    d.textContent = desc;
    el.appendChild(d);
    el.onclick = pick;
    grid.appendChild(el);
    // 小样要按像素算材质：一张一张排着画，不卡住界面
    queue.push(() => {
      if (el.isConnected) pic.appendChild(art());
    });
  };

  let queue: (() => void)[] = [];
  let timer = 0;
  const pump = () => {
    const job = queue.shift();
    if (job) job();
    timer = queue.length ? window.setTimeout(pump, 0) : 0;
  };

  const render = () => {
    const look = getLook();
    body.innerHTML = '';
    queue = [];
    if (timer) clearTimeout(timer);

    const pre = section('现成的搭配', presetOf(look) ? undefined : '现在是你自己搭的。');
    for (const p of PRESETS) {
      card(
        pre,
        p.name,
        p.desc,
        presetOf(look)?.id === p.id,
        () =>
          boardStyle(p.look.board).premium
            ? swatch(p.look, 160, 84, [{ x: 2, y: 3, t: 'P', c: 'b' }, { x: 6, y: 6, t: 'P', c: 'r' }], 0, true)
            : swatch(p.look, 160, 84, [
                { x: 0, y: 0, t: 'R', c: 'b' },
                { x: 2, y: 0, t: 'E', c: 'b' },
                { x: 1, y: 2, t: 'C', c: 'r' },
              ]),
        () => setLook(p.look),
        { preset: p.id },
      );
    }

    const bd = section('棋盘');
    for (const b of BOARDS) {
      // 典藏（带画、会动）的几种标个 ✨
      card(
        bd,
        b.premium ? `✨ ${b.name}` : b.name,
        b.desc,
        look.board === b.id,
        () => (b.premium ? swatch({ ...look, board: b.id }, 160, 84, [], 0, true) : swatch({ ...look, board: b.id }, 160, 84, [{ x: 1, y: 2, t: 'C', c: 'r' }])),
        () => setLook({ board: b.id }),
        { board: b.id },
      );
    }

    const pc = section('棋子');
    for (const p of PIECES) {
      card(
        pc,
        p.name,
        p.desc,
        look.piece === p.id,
        () =>
          swatch(
            { ...look, piece: p.id },
            160,
            84,
            [
              { x: 0.3, y: 0.47, t: 'K', c: 'r' },
              { x: 0.7, y: 0.47, t: 'K', c: 'b' },
            ],
            0.33,
          ),
        () => setLook({ piece: p.id }),
        { piece: p.id },
      );
    }

    const ft = section('字体', '前四种字体随软件带着（开源字体，每个只有几 KB），换到哪台手机上都一样；黑体用手机自带的。');
    for (const f of FONTS) {
      card(
        ft,
        f.name,
        f.desc,
        look.font === f.id,
        () =>
          swatch(
            { ...look, font: f.id },
            160,
            84,
            [
              { x: 0.19, y: 0.47, t: 'H', c: 'r' },
              { x: 0.5, y: 0.47, t: 'C', c: 'b' },
              { x: 0.81, y: 0.47, t: 'P', c: 'r' },
            ],
            0.27,
          ),
        () => setLook({ font: f.id }),
        { font: f.id },
      );
    }

    // 繁体字
    const tr = document.createElement('label');
    tr.className = 'xq-look-trad';
    const ok = fontOf(look).trad;
    tr.innerHTML = `<input type="checkbox" ${look.trad ? 'checked' : ''} ${ok ? '' : 'disabled'}> <span>繁体字（帥將、馬車、漢界）</span>${
      ok ? '' : '<em>这款字体只有简体</em>'
    }`;
    (tr.querySelector('input') as HTMLInputElement).onchange = (e) => setLook({ trad: (e.target as HTMLInputElement).checked });
    body.appendChild(tr);

    // 出场人物：开局前谁来亮相（intro.ts）。点一位当场演一遍
    const hp = getHeroPick();
    const hs = section('出场人物', '开局之前，一位人物在水墨里亮相、报名号，然后才摆棋。点一位当场看一遍；对局里点一下屏幕就跳过。');
    const pickHero = (v: HeroPick) => {
      setHeroPick(v);
      render();
      if (v !== 'random' && v !== 'off') {
        unlockAudio();
        void playHeroIntro(v);
      }
    };
    card(hs, '随机', '每盘换一位，不和上一盘重复', hp === 'random', () => textThumb('xq-hero-rand', '五位轮流'), () => pickHero('random'), { hero: 'random' });
    for (const h of HEROES) card(hs, h.label, h.desc, hp === h.id, () => heroThumb(h.id), () => pickHero(h.id), { hero: h.id });
    card(hs, '不演', '直接摆棋开局', hp === 'off', () => textThumb('xq-hero-off', '直接开局'), () => pickHero('off'), { hero: 'off' });

    // 配音：开局、吃车马炮、将军、绝杀时喊一声（xqvoice.ts）。点一下试听"将军！"
    const vk = getVoiceKind();
    const vs = section('配音', '开局、吃车马炮、将军、绝杀时喊一声，终局说一句，出场人物报名号；还能报着法。点一下试听。');
    const pickVoice = (v: VoiceKind) => {
      setVoiceKind(v);
      render();
      unlockAudio();
      if (v !== 'off') xqShout('jiangjun');
    };
    const VOICES: [VoiceKind, string, string, string][] = [
      ['m', '男声', '浑厚、带一点戏台的回响', '将军！'],
      ['f', '女声', '清亮、干脆', '将军！'],
      ['off', '不要配音', '只留锣鼓和棋子声', '……'],
    ];
    for (const [v, name, desc, word] of VOICES) card(vs, name, desc, vk === v, () => textThumb(`xq-voice-${v}`, word), () => pickVoice(v), { voice: v });
    // 报着法：每走一步念出记谱（天天象棋这些软件语音包的核心）。一个嗓子两三 MB，开了才下载
    const an = document.createElement('label');
    an.className = 'xq-look-trad';
    an.dataset.act = 'announce-toggle';
    an.innerHTML = `<input type="checkbox" ${getAnnounce() ? 'checked' : ''} ${vk === 'off' ? 'disabled' : ''}> <span>报着法：双方每走一步念出记谱（"炮二平五""马8进7"）</span>${
      vk === 'off' ? '<em>配音关着</em>' : ''
    }`;
    (an.querySelector('input') as HTMLInputElement).onchange = (e) => {
      const on = (e.target as HTMLInputElement).checked;
      setAnnounce(on);
      if (on) {
        unlockAudio();
        preloadAnnounce();
        xqAnnounce('炮二平五', 0, true);
      }
    };
    body.appendChild(an);

    // 音量：配乐、配音分开调（专业软件都分开：有人只想听报棋不想听音乐，有人反过来）
    const vols = document.createElement('div');
    vols.className = 'xq-look-vols';
    vols.innerHTML = `<label data-act="vol-music"><span>🎵 配乐音量</span><input type="range" min="0" max="100" value="${Math.round(getXqMusicVolume() * 100)}"></label>
      <label data-act="vol-voice"><span>🗣 配音音量</span><input type="range" min="0" max="100" value="${Math.round(getVoiceVolume() * 100)}"></label>`;
    (vols.querySelector('[data-act="vol-music"] input') as HTMLInputElement).oninput = (e) => setXqMusicVolume(Number((e.target as HTMLInputElement).value) / 100);
    (vols.querySelector('[data-act="vol-voice"] input') as HTMLInputElement).onchange = (e) => {
      setVoiceVolume(Number((e.target as HTMLInputElement).value) / 100);
      unlockAudio();
      xqShout('jiangjun');
    };
    body.appendChild(vols);

    // 对局特效：开局入场、吃子碎裂、将军、绝杀（fx.ts）。不是样式，但"好不好看"的事都在这一页
    const fx = document.createElement('label');
    fx.className = 'xq-look-trad';
    fx.dataset.act = 'fx-toggle';
    fx.innerHTML = `<input type="checkbox" ${fxEnabled() ? 'checked' : ''}> <span>对局特效（出场人物、开局入场、吃子、吃车、将军、绝杀）</span>`;
    (fx.querySelector('input') as HTMLInputElement).onchange = (e) => setFxEnabled((e.target as HTMLInputElement).checked);
    body.appendChild(fx);

    const reset = document.createElement('button');
    reset.className = 'btn ghost';
    reset.dataset.act = 'look-reset';
    reset.textContent = '恢复默认样式';
    reset.onclick = () => setLook(DEFAULT_LOOK);
    body.appendChild(reset);

    timer = window.setTimeout(pump, 0);
  };

  // 字体小样要等字体加载完才画得对：先把几个随包字体都拉下来（每个几 KB）
  for (const f of FONTS) void ensureFont(f.id);
  preloadHero();
  render();
  const off = onLook(render);

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← 返回';
  back.onclick = onBack;
  s.appendChild(back);
  liftBack(s, '棋盘样式');

  return () => {
    off();
    if (timer) clearTimeout(timer);
    view.dispose();
    s.remove();
  };
}
