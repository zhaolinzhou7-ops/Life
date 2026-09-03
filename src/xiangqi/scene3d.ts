/** 象棋 3D 场景：木纹棋盘、刻字棋子、走子/吃子动画与触摸拾取（不含规则） */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLS, ROWS, PTYPE_NAME, type Board, type Color, type Move, type PType } from './rules';

const CELL = 1;
const BOARD_T = 0.5; // 棋盘厚度
const TOP_Y = BOARD_T / 2; // 棋盘上表面
const PIECE_R = 0.42;
const PIECE_H = 0.26;

const cellToWorld = (x: number, y: number) =>
  new THREE.Vector3((x - (COLS - 1) / 2) * CELL, TOP_Y, (y - (ROWS - 1) / 2) * CELL);

interface Tween {
  t: number;
  dur: number;
  /** 真实起始时刻（ms）：按墙钟推进，低帧率设备也能准时播完 */
  start: number;
  update: (k: number) => void;
  onDone?: () => void;
}

interface PieceMesh {
  mesh: THREE.Group;
  x: number;
  y: number;
  /** 兵种与颜色：思考指示要定位黑将 */
  t: PType;
  c: Color;
}

/** 棋盘面：木纹 + 网格线 + 九宫斜线 + 楚河汉界 */
function makeBoardTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = Math.round((W * (ROWS + 1)) / (COLS + 1));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const cell = W / (COLS + 1);
  const ox = cell;
  const oy = cell;

  // 木底
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#d9a86a');
  grad.addColorStop(0.5, '#cf9a55');
  grad.addColorStop(1, '#c98f4a');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 木纹
  g.globalAlpha = 0.16;
  for (let i = 0; i < 70; i++) {
    const y = Math.random() * H;
    g.strokeStyle = Math.random() < 0.5 ? '#8a5a28' : '#eec98d';
    g.lineWidth = 1 + Math.random() * 2;
    g.beginPath();
    g.moveTo(0, y);
    for (let x = 0; x <= W; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * 6);
    g.stroke();
  }
  g.globalAlpha = 1;

  const px = (x: number) => ox + x * cell;
  const py = (y: number) => oy + ((y * (H - 2 * oy)) / (ROWS - 1));

  g.strokeStyle = '#4a2f14';
  g.lineWidth = 3;
  // 横线
  for (let y = 0; y < ROWS; y++) {
    g.beginPath();
    g.moveTo(px(0), py(y));
    g.lineTo(px(COLS - 1), py(y));
    g.stroke();
  }
  // 竖线（中间断开为河界）
  for (let x = 0; x < COLS; x++) {
    if (x === 0 || x === COLS - 1) {
      g.beginPath();
      g.moveTo(px(x), py(0));
      g.lineTo(px(x), py(ROWS - 1));
      g.stroke();
    } else {
      g.beginPath();
      g.moveTo(px(x), py(0));
      g.lineTo(px(x), py(4));
      g.moveTo(px(x), py(5));
      g.lineTo(px(x), py(ROWS - 1));
      g.stroke();
    }
  }
  // 九宫斜线
  for (const [y0, y1] of [
    [0, 2],
    [7, 9],
  ]) {
    g.beginPath();
    g.moveTo(px(3), py(y0));
    g.lineTo(px(5), py(y1));
    g.moveTo(px(5), py(y0));
    g.lineTo(px(3), py(y1));
    g.stroke();
  }
  // 兵/炮位标记
  const mark = (x: number, y: number) => {
    const s = cell * 0.12;
    const gap = cell * 0.06;
    g.lineWidth = 2.5;
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      if ((x === 0 && sx < 0) || (x === COLS - 1 && sx > 0)) continue;
      g.beginPath();
      g.moveTo(px(x) + sx * gap, py(y) + sy * (gap + s));
      g.lineTo(px(x) + sx * gap, py(y) + sy * gap);
      g.lineTo(px(x) + sx * (gap + s), py(y) + sy * gap);
      g.stroke();
    }
  };
  for (const x of [0, 2, 4, 6, 8]) {
    mark(x, 3);
    mark(x, 6);
  }
  mark(1, 2);
  mark(7, 2);
  mark(1, 7);
  mark(7, 7);

  // 楚河汉界
  g.fillStyle = '#4a2f14';
  g.font = `bold ${cell * 0.62}px "KaiTi","STKaiti",serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const ry = (py(4) + py(5)) / 2;
  g.fillText('楚 河', px(2), ry);
  g.fillText('漢 界', px(6), ry);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 棋子材质主题 */
export type PieceTheme = 'jade' | 'wood' | 'porcelain';

interface ThemeDef {
  /** 棋子底色（面纹理） */
  faceInner: string;
  faceOuter: string;
  /** 侧面/底面颜色 */
  side: number;
  bottom: number;
  /** 物理材质参数 */
  roughness: number;
  clearcoat: number;
  transmission: number;
  /** 红黑两方的刻字与描边色 */
  redInk: string;
  blackInk: string;
  ringRed: string;
  ringBlack: string;
}

/** 三套材质：红黑两方各有独立的棋身配色（真实象棋红黑两副子） */
export const PIECE_THEMES: Record<PieceTheme, ThemeDef & { sideBlack: number; bottomBlack: number; faceInnerBlack: string; faceOuterBlack: string }> = {
  jade: {
    // 红方＝暖白玉，黑方＝墨玉（青碧），两副明显不同
    faceInner: '#fdf6e6',
    faceOuter: '#e8d5a8',
    faceInnerBlack: '#dff0e6',
    faceOuterBlack: '#8fbfa8',
    side: 0xe6d3a4,
    bottom: 0xc8b184,
    sideBlack: 0x6fae94,
    bottomBlack: 0x4d8770,
    roughness: 0.14,
    clearcoat: 1,
    transmission: 0.12,
    redInk: '#c1121f',
    blackInk: '#0f3b2c',
    ringRed: '#c8a02c',
    ringBlack: '#1f5c46',
  },
  wood: {
    // 红方＝浅黄杨木，黑方＝深紫檀
    faceInner: '#f7e3b8',
    faceOuter: '#dfbc81',
    faceInnerBlack: '#a87f52',
    faceOuterBlack: '#7c5533',
    side: 0xd0a468,
    bottom: 0xa87c42,
    sideBlack: 0x6f4a2c,
    bottomBlack: 0x53341d,
    roughness: 0.36,
    clearcoat: 0.85,
    transmission: 0,
    redInk: '#b81d24',
    blackInk: '#241309',
    ringRed: '#a3161c',
    ringBlack: '#2b1a0e',
  },
  porcelain: {
    // 红方＝白釉描红，黑方＝青花靛蓝
    faceInner: '#ffffff',
    faceOuter: '#f0e8e2',
    faceInnerBlack: '#f4f8ff',
    faceOuterBlack: '#c3d6ee',
    side: 0xf6f2ee,
    bottom: 0xd8cfc7,
    sideBlack: 0xdae7f7,
    bottomBlack: 0xa9bdd6,
    roughness: 0.07,
    clearcoat: 1,
    transmission: 0,
    redInk: '#cf1020',
    blackInk: '#12357e',
    ringRed: '#cf1020',
    ringBlack: '#12357e',
  },
};

/** 车削出真实棋子轮廓：底盘略收、腰身微鼓、顶面边缘凸起形成刻字凹槽 */
function pieceProfile(): THREE.Vector2[] {
  const R = PIECE_R;
  const H = PIECE_H;
  return [
    new THREE.Vector2(0, 0),
    new THREE.Vector2(R * 0.9, 0),
    new THREE.Vector2(R * 0.97, H * 0.08),
    new THREE.Vector2(R * 1.0, H * 0.3),
    new THREE.Vector2(R * 1.0, H * 0.62),
    new THREE.Vector2(R * 0.97, H * 0.82),
    new THREE.Vector2(R * 0.93, H * 0.93),
    new THREE.Vector2(R * 0.88, H * 0.985),
    new THREE.Vector2(R * 0.8, H), // 顶面外圈（凸边）
    new THREE.Vector2(R * 0.76, H * 0.965), // 内凹一点点 → 刻字凹槽
    new THREE.Vector2(0, H * 0.96),
  ];
}

/** 棋子顶面：底色 + 金/彩刻环 + 字。flip=true 时字倒转（供对面玩家正读） */
function makeFaceTexture(char: string, ink: string, ring: string, theme: ThemeDef, flip: boolean): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(S * 0.4, S * 0.35, S * 0.1, S / 2, S / 2, S * 0.58);
  grad.addColorStop(0, theme.faceInner);
  grad.addColorStop(1, theme.faceOuter);
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);

  g.save();
  g.translate(S / 2, S / 2);
  if (flip) g.rotate(Math.PI);
  // 双刻环（外细内粗，金属感）
  g.strokeStyle = ring;
  g.lineWidth = 8;
  g.beginPath();
  g.arc(0, 0, S * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.55)';
  g.lineWidth = 2;
  g.beginPath();
  g.arc(0, 0, S * 0.37, 0, Math.PI * 2);
  g.stroke();
  // 字
  g.fillStyle = ink;
  g.font = `bold ${S * 0.52}px "KaiTi","STKaiti",serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.5)';
  g.shadowBlur = 4;
  g.shadowOffsetY = 2;
  g.fillText(char, 0, S * 0.02);
  g.restore();

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 山水画卷背景：宣纸底色、层叠远山、雾霭与淡日 */
/** 桌面木纹：年轮被低频噪声推歪，再叠细纹与污渍 */
function makeTableTexture(): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 多层不同频率的扭曲叠加，避免年轮变成规则条带（那会像灯芯绒）
      const warp =
        Math.sin(x * 0.0075) * 38 + Math.sin(x * 0.019) * 13 + Math.sin(x * 0.041 + y * 0.004) * 5;
      const ring = Math.sin((y + warp) * 0.115) * 0.5 + 0.5;
      const fine = Math.sin((y + warp) * 0.9) * 0.1;
      const v = 152 + (ring - 0.5) * 26 + fine * 20 + (Math.random() - 0.5) * 10;
      const i = (y * W + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, v * 1.06));
      img.data[i + 1] = Math.max(0, Math.min(255, v * 0.92));
      img.data[i + 2] = Math.max(0, Math.min(255, v * 0.74));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(1.25, 1.25);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeShanshuiTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  // 宣纸渐变天空（构图集中在上部 1/3，桌沿以上可见区域）
  // 暮色天：原来是宣纸白，在暗色木桌上方会变成一条发白的亮带，
  // 整幅画面因此割裂。压暗之后远山改用浅色雾霭反衬，山水的意思还在。
  const sky = g.createLinearGradient(0, 0, 0, H * 0.4);
  sky.addColorStop(0, '#3d4a4d');
  sky.addColorStop(0.55, '#39433f');
  sky.addColorStop(1, '#38403a');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H * 0.4);
  // 下半部不再平涂：往下渐暗成室内环境光。
  // 原来这里是一整块 #8fa096，占了屏幕大半，视觉上就是一片"灰底"，
  // 棋盘浮在上面没有归属感。压暗之后注意力自然落到受光的棋盘上。
  const room = g.createLinearGradient(0, H * 0.38, 0, H);
  room.addColorStop(0, '#38403a');
  room.addColorStop(0.18, '#5d6a62');
  room.addColorStop(0.5, '#333c37');
  room.addColorStop(1, '#171c1a');
  g.fillStyle = room;
  g.fillRect(0, H * 0.38, W, H * 0.62);
  // 淡日
  g.globalAlpha = 0.55;
  const sun = g.createRadialGradient(W * 0.72, H * 0.09, 6, W * 0.72, H * 0.09, 70);
  sun.addColorStop(0, 'rgba(246,216,168,0.55)');
  sun.addColorStop(1, 'rgba(246,216,168,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H * 0.3);
  g.globalAlpha = 1;
  // 层叠远山（水墨浓淡）
  const layers = [
    { y: H * 0.15, amp: 42, col: 'rgba(150,172,168,0.20)' },
    { y: H * 0.19, amp: 58, col: 'rgba(122,146,142,0.24)' },
    { y: H * 0.24, amp: 74, col: 'rgba(92,116,112,0.30)' },
    { y: H * 0.3, amp: 88, col: 'rgba(64,84,80,0.42)' },
  ];
  layers.forEach((L, li) => {
    g.fillStyle = L.col;
    g.beginPath();
    g.moveTo(0, H);
    for (let x = 0; x <= W; x += 8) {
      const y =
        L.y -
        Math.abs(Math.sin(x * 0.004 + li * 2.1)) * L.amp -
        Math.sin(x * 0.013 + li * 5) * L.amp * 0.3;
      g.lineTo(x, y);
    }
    g.lineTo(W, H);
    g.closePath();
    g.fill();
  });
  // 雾霭横带
  for (let i = 0; i < 3; i++) {
    const y = H * (0.17 + i * 0.055);
    const mist = g.createLinearGradient(0, y - 24, 0, y + 24);
    mist.addColorStop(0, 'rgba(232,228,210,0)');
    mist.addColorStop(0.5, 'rgba(232,228,210,0.4)');
    mist.addColorStop(1, 'rgba(232,228,210,0)');
    g.fillStyle = mist;
    g.fillRect(0, y - 24, W, 48);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const faceCache = new Map<string, THREE.CanvasTexture>();

export class XiangqiScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private pieces: PieceMesh[] = [];
  private pieceRoot = new THREE.Group();
  private markerRoot = new THREE.Group();
  private tweens: Tween[] = [];
  private raf = 0;
  private thinking = false;
  private disposed = false;
  private selected: PieceMesh | null = null;
  private checkRing: THREE.Mesh;
  private lastFrom!: THREE.Mesh;
  private lastTo!: THREE.Mesh;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private impactRing!: THREE.Mesh;
  private shakeT = 0;
  private shakeAmp = 0;
  private camBase = new THREE.Vector3();
  private checkT = -1;
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);
  private clock = new THREE.Clock();

  constructor(
    container: HTMLElement,
    private onTap: (x: number, y: number) => void,
    private theme: PieceTheme = 'jade',
    /** true=黑方棋子倒转（双方对坐各自正读）；false=全部朝向玩家 */
    private flipBlack = true,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // 背景：程序化山水画卷（远山 + 雾霭 + 宣纸色天空）
    this.scene.background = makeShanshuiTexture();
    // 雾：远端桌沿融进环境色，没有雾时桌子边缘会像贴纸一样硬切
    this.scene.fog = new THREE.Fog(0x272e2a, 16, 44);

    // IBL 环境反射：漆面棋子的真实高光
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    // 灯光
    // 半球光原来 0.8，把阴影全填平了——阴影读不出来，物体就没有体积。
    // 压到 0.34，让主光的投影真正起作用。
    const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x2a241a, 0.34);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0d6, 2.1);
    sun.position.set(5, 12, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    sc.left = -8;
    sc.right = 8;
    sc.top = 8;
    sc.bottom = -8;
    sc.far = 40;
    this.scene.add(sun);

    // 冷色补光从反侧来：只提亮暗部轮廓，不产生第二组阴影
    const fill = new THREE.DirectionalLight(0x9fc4ff, 0.42);
    fill.position.set(-7, 5, -5);
    this.scene.add(fill);
    // 头顶暖射灯：棋盘中心一圈热点，像棋牌室吊灯
    const spot = new THREE.PointLight(0xffe0b0, 11, 26, 2);
    spot.position.set(0, 10.5, 1.5);
    this.scene.add(spot);

    // 桌面：深色木纹。原来是平涂灰绿（0x3c4038），大面积纯色最没质感。
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 0.4, 48),
      new THREE.MeshStandardMaterial({
        map: makeTableTexture(),
        color: 0x6a5238,
        roughness: 0.88,
        metalness: 0.02,
      }),
    );
    table.position.y = -0.45;
    table.receiveShadow = true;
    this.scene.add(table);

    // 棋盘
    const bw = (COLS + 1) * CELL;
    const bh = (ROWS + 1) * CELL;
    const woodSide = new THREE.MeshStandardMaterial({ color: 0x8a5a28, roughness: 0.8 });
    const topMat = new THREE.MeshStandardMaterial({ map: makeBoardTexture(), roughness: 0.72 });
    const board = new THREE.Mesh(new THREE.BoxGeometry(bw, BOARD_T, bh), [
      woodSide,
      woodSide,
      topMat,
      woodSide,
      woodSide,
      woodSide,
    ]);
    board.receiveShadow = true;
    board.castShadow = true;
    this.scene.add(board);
    // 底座（深色漆木）
    const basePad = new THREE.Mesh(
      new THREE.BoxGeometry(bw + 0.5, 0.24, bh + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x3a2410, roughness: 0.7 }),
    );
    basePad.position.y = -BOARD_T / 2 - 0.12;
    basePad.receiveShadow = true;
    this.scene.add(basePad);

    // ===== 镶金边框：四条鎏金包边 + 四角兽首铆钉 =====
    const goldMat = new THREE.MeshPhysicalMaterial({
      color: 0xd4a72c,
      metalness: 1,
      roughness: 0.22,
      clearcoat: 1,
      clearcoatRoughness: 0.1,
    });
    const frameW = 0.42;
    const frameH = BOARD_T + 0.18;
    const mkBar = (w: number, d: number, x: number, z: number) => {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, frameH, d), goldMat);
      bar.position.set(x, 0.02, z);
      bar.castShadow = true;
      bar.receiveShadow = true;
      this.scene.add(bar);
    };
    mkBar(bw + frameW * 2, frameW, 0, -bh / 2 - frameW / 2);
    mkBar(bw + frameW * 2, frameW, 0, bh / 2 + frameW / 2);
    mkBar(frameW, bh, -bw / 2 - frameW / 2, 0);
    mkBar(frameW, bh, bw / 2 + frameW / 2, 0);
    // 四角铆钉（球）
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const stud = new THREE.Mesh(new THREE.SphereGeometry(frameW * 0.42, 20, 14), goldMat);
        stud.position.set(sx * (bw / 2 + frameW / 2), frameH / 2 - 0.02, sz * (bh / 2 + frameW / 2));
        stud.castShadow = true;
        this.scene.add(stud);
      }
    // 边框内侧刻线（细金环）
    const inlay = new THREE.Mesh(
      new THREE.RingGeometry(0.001, 0.002, 4),
      new THREE.MeshBasicMaterial({ color: 0xffd76e, toneMapped: false }),
    );
    inlay.visible = false;
    this.scene.add(inlay);

    // 绝杀/吃子 冲击特效环（复用）
    this.impactRing = new THREE.Mesh(
      new THREE.RingGeometry(0.5, 0.72, 44),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(3.2, 2.2, 0.6),
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        toneMapped: false,
      }),
    );
    this.impactRing.rotation.x = -Math.PI / 2;
    this.impactRing.position.y = TOP_Y + 0.03;
    this.scene.add(this.impactRing);

    this.scene.add(this.pieceRoot);
    this.scene.add(this.markerRoot);

    // 将军提示环
    this.checkRing = new THREE.Mesh(
      new THREE.RingGeometry(PIECE_R + 0.08, PIECE_R + 0.22, 32),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 0.5, 0.5), transparent: true, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.checkRing.rotation.x = -Math.PI / 2;
    this.checkRing.visible = false;
    this.scene.add(this.checkRing);

    // 最后一步标记（起点小环 + 终点角框）
    const mkMark = (color: number, inner: number, outer: number) => {
      const m = new THREE.Mesh(
        new THREE.RingGeometry(inner, outer, 28),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
      );
      m.rotation.x = -Math.PI / 2;
      m.visible = false;
      this.scene.add(m);
      return m;
    };
    this.lastFrom = mkMark(0x8bc34a, 0.12, 0.2);
    this.lastTo = mkMark(0xffc107, PIECE_R + 0.05, PIECE_R + 0.15);

    // 相机（红方视角，按屏幕比例自适应拉远保证全盘可见）+ 入场动画
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
    const camEnd = this.fitCameraPos();
    const camStart = camEnd.clone().multiplyScalar(1.4);
    this.camera.position.copy(camStart);
    this.camera.lookAt(0, 0, -0.3);
    this.addTween(1.1, (k) => {
      this.camera.position.lerpVectors(camStart, this.fitCameraPos(), 1 - (1 - k) ** 3);
      this.camera.lookAt(0, 0, -0.3);
    });

    // Bloom 辉光后处理
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.5, 0.4, 1.15);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer);
    this.loop();
  }

  // ---------- 公共接口 ----------

  /** 开局入场：棋子从高空逐个砸落（带弹跳），配相机推近 */
  dealIn() {
    this.pieces.forEach((p, i) => {
      const target = cellToWorld(p.x, p.y);
      const mesh = p.mesh;
      const delay = i * 0.012;
      mesh.position.set(target.x, TOP_Y + 2.6 + Math.random() * 1.2, target.z);
      mesh.scale.setScalar(0.6);
      mesh.visible = false;
      this.addTween(
        delay + 0.26,
        (k) => {
          const kk = Math.max(0, (k * (delay + 0.26) - delay) / 0.26);
          if (kk <= 0) return;
          mesh.visible = true;
          const e = kk * kk; // 加速下落
          mesh.position.y = THREE.MathUtils.lerp(TOP_Y + 2.6, TOP_Y, e);
          mesh.scale.setScalar(0.6 + kk * 0.4);
        },
        () => {
          mesh.position.copy(target);
          mesh.visible = true;
          // 落地压扁回弹
          this.addTween(0.24, (k) => {
            const s = 1 + Math.sin(k * Math.PI) * 0.22 * (1 - k);
            mesh.scale.set(s, 1 / s, s);
          });
          if (i === this.pieces.length - 1) this.shake(0.05);
        },
      );
    });
  }

  /** 重建全部棋子（初始化 / 悔棋 / 重开） */
  syncBoard(b: Board) {
    for (const p of this.pieces) this.pieceRoot.remove(p.mesh);
    this.pieces = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const p = b[y][x];
        if (!p) continue;
        // 黑方棋子文字倒转，双方各自正读（真实对坐摆放）
        const mesh = this.makePiece(PTYPE_NAME[p.t][p.c === 'r' ? 0 : 1], p.c === 'b', this.flipBlack);
        mesh.position.copy(cellToWorld(x, y));
        this.pieceRoot.add(mesh);
        this.pieces.push({ mesh, x, y, t: p.t, c: p.c });
      }
    this.select(null);
    this.checkRing.visible = false;
    this.lastFrom.visible = false;
    this.lastTo.visible = false;
  }

  /** 选中棋子（浮起）并显示可走点 */
  select(cell: { x: number; y: number } | null, targets: { x: number; y: number; capture: boolean }[] = []) {
    if (this.selected) {
      const s = this.selected;
      this.addTween(0.15, (k) => (s.mesh.position.y = TOP_Y + (1 - k) * 0.35));
      this.selected = null;
    }
    this.markerRoot.clear();
    if (!cell) return;
    const pm = this.pieceAt(cell.x, cell.y);
    if (!pm) return;
    this.selected = pm;
    this.addTween(0.15, (k) => (pm.mesh.position.y = TOP_Y + k * 0.35));
    for (const t of targets) {
      const marker = t.capture
        ? new THREE.Mesh(
            new THREE.RingGeometry(PIECE_R + 0.05, PIECE_R + 0.16, 28),
            new THREE.MeshBasicMaterial({ color: 0xff7043, transparent: true, opacity: 0.95, side: THREE.DoubleSide }),
          )
        : new THREE.Mesh(
            new THREE.CircleGeometry(0.15, 20),
            new THREE.MeshBasicMaterial({ color: 0x66ff8f, transparent: true, opacity: 0.9 }),
          );
      marker.rotation.x = -Math.PI / 2;
      const p = cellToWorld(t.x, t.y);
      marker.position.set(p.x, TOP_Y + 0.02, p.z);
      marker.userData.cell = { x: t.x, y: t.y };
      this.markerRoot.add(marker);
    }
  }

  /** 执行走子动画（含吃子） */
  animateMove(m: Move, onDone: () => void) {
    const mover = this.pieceAt(m.fx, m.fy);
    if (!mover) {
      onDone();
      return;
    }
    this.select(null);
    const victim = this.pieceAt(m.tx, m.ty);
    if (victim) {
      this.pieces = this.pieces.filter((p) => p !== victim);
      const vm = victim.mesh;
      const dir = new THREE.Vector3(vm.position.x * 0.25 + (Math.random() - 0.5), 0, vm.position.z * 0.25).normalize();
      this.addTween(
        0.5,
        (k) => {
          vm.position.x += dir.x * 0.09;
          vm.position.z += dir.z * 0.09;
          vm.position.y = TOP_Y + Math.sin(k * Math.PI) * 1.1;
          vm.rotation.x += 0.15;
          vm.rotation.z += 0.12;
          vm.scale.setScalar(1 - k * 0.8);
        },
        () => this.pieceRoot.remove(vm),
      );
    }
    const from = cellToWorld(m.fx, m.fy);
    const to = cellToWorld(m.tx, m.ty);
    mover.x = m.tx;
    mover.y = m.ty;
    const mesh = mover.mesh;
    const LIFT = 1.15; // 抬起高度（模拟手拿起棋子）
    // 第一段：抓起（快速抬高 + 轻微倾斜）
    this.addTween(
      0.16,
      (k) => {
        mesh.position.y = TOP_Y + LIFT * (1 - (1 - k) ** 2);
        mesh.rotation.z = k * 0.12;
        mesh.scale.setScalar(1 + k * 0.08);
      },
      () => {
        // 第二段：空中平移
        this.addTween(
          0.26,
          (k) => {
            const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
            mesh.position.x = from.x + (to.x - from.x) * e;
            mesh.position.z = from.z + (to.z - from.z) * e;
            mesh.position.y = TOP_Y + LIFT + Math.sin(k * Math.PI) * 0.18;
          },
          () => {
            // 第三段：拍下（加速落地 + 压扁回弹）
            this.addTween(
              0.14,
              (k) => {
                mesh.position.y = TOP_Y + LIFT * (1 - k * k);
                mesh.rotation.z = 0.12 * (1 - k);
              },
              () => {
                mesh.position.copy(to);
                mesh.rotation.z = 0;
                // 落地弹性
                this.addTween(0.22, (k) => {
                  const s = 1 + Math.sin(k * Math.PI) * 0.16 * (1 - k);
                  mesh.scale.set(s, 1 / s, s);
                });
                this.impact(to.x, to.z, victim ? 1 : 0.55);
                this.shake(victim ? 0.09 : 0.03);
                // 落点标记
                this.lastFrom.position.set(from.x, TOP_Y + 0.02, from.z);
                this.lastTo.position.set(to.x, TOP_Y + 0.02, to.z);
                this.lastFrom.visible = true;
                this.lastTo.visible = true;
                onDone();
              },
            );
          },
        );
      },
    );
  }

  /** 落子/吃子冲击波 */
  private impact(x: number, z: number, power = 1) {
    this.impactRing.position.set(x, TOP_Y + 0.03, z);
    const mat = this.impactRing.material as THREE.MeshBasicMaterial;
    this.addTween(0.5, (k) => {
      this.impactRing.scale.setScalar(0.5 + k * 3.2 * power);
      mat.opacity = (1 - k) * 0.95 * power;
    });
  }

  /** 相机震屏 */
  private shake(amp: number) {
    this.camBase.copy(this.camera.position);
    this.shakeAmp = amp;
    this.shakeT = 0;
  }

  /** 绝杀大特效：金色冲击波连爆 + 强震屏 */
  finishBlast(x: number, y: number) {
    const p = cellToWorld(x, y);
    for (let i = 0; i < 3; i++) {
      setTimeout(() => this.impact(p.x, p.z, 1.6), i * 160);
    }
    this.shake(0.22);
  }

  /**
   * 对手思考指示：黑将轻微起伏 + 呼吸光。
   * 搜索已经移到 Worker，主线程能持续放这个动画，玩家不会觉得游戏卡死了。
   */
  setThinking(on: boolean) {
    this.thinking = on;
    if (!on) {
      const k = this.pieces.find((p) => p.t === 'K' && p.c === 'b');
      if (k) k.mesh.position.y = TOP_Y;
    }
  }

  /** 高亮某格上的将（将军提示） */
  flashCheck(x: number, y: number) {
    const p = cellToWorld(x, y);
    this.checkRing.position.set(p.x, TOP_Y + 0.03, p.z);
    this.checkRing.visible = true;
    this.checkT = 0;
  }
  hideCheck() {
    this.checkRing.visible = false;
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointer);
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- 内部 ----------

  private pieceAt(x: number, y: number): PieceMesh | null {
    return this.pieces.find((p) => p.x === x && p.y === y) ?? null;
  }

  /** 造一枚棋子：车削棋身 + 凹槽内的刻字面。isBlack 决定配色与倒转（对坐正读） */
  private makePiece(char: string, isBlack: boolean, flip: boolean): THREE.Group {
    const t = PIECE_THEMES[this.theme];
    const g = new THREE.Group();
    const key = `${this.theme}-${char}-${isBlack}-${flip}`;
    let face = faceCache.get(key);
    if (!face) {
      const themeForSide = isBlack
        ? { ...t, faceInner: t.faceInnerBlack, faceOuter: t.faceOuterBlack }
        : t;
      face = makeFaceTexture(
        char,
        isBlack ? t.blackInk : t.redInk,
        isBlack ? t.ringBlack : t.ringRed,
        themeForSide,
        isBlack && flip,
      );
      faceCache.set(key, face);
    }

    // 棋身（车削轮廓，360° 旋转）
    const bodyMat = new THREE.MeshPhysicalMaterial({
      color: isBlack ? t.sideBlack : t.side,
      roughness: t.roughness,
      clearcoat: t.clearcoat,
      clearcoatRoughness: 0.1,
      transmission: t.transmission,
      thickness: t.transmission > 0 ? 0.55 : 0,
      ior: 1.5,
    });
    const body = new THREE.Mesh(new THREE.LatheGeometry(pieceProfile(), 48), bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);

    // 刻字面（嵌在顶部凹槽里，略低于凸边）
    const faceMat = new THREE.MeshPhysicalMaterial({
      map: face,
      roughness: Math.max(0.08, t.roughness - 0.04),
      clearcoat: t.clearcoat,
      clearcoatRoughness: 0.08,
    });
    const topFace = new THREE.Mesh(new THREE.CircleGeometry(PIECE_R * 0.78, 48), faceMat);
    topFace.rotation.x = -Math.PI / 2;
    topFace.position.y = PIECE_H * 0.968;
    topFace.receiveShadow = true;
    g.add(topFace);

    // 底盘阴影垫（增强落桌立体感）
    const shadowPad = new THREE.Mesh(
      new THREE.CircleGeometry(PIECE_R * 1.02, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.18 }),
    );
    shadowPad.rotation.x = -Math.PI / 2;
    shadowPad.position.y = 0.004;
    g.add(shadowPad);
    return g;
  }

  private addTween(dur: number, update: (k: number) => void, onDone?: () => void) {
    this.tweens.push({ t: 0, dur, start: performance.now(), update, onDone });
  }

  /** 计算能容纳整个棋盘的相机位置（约 55° 俯角） */
  private fitCameraPos(): THREE.Vector3 {
    const aspect = window.innerWidth / window.innerHeight;
    const halfW = ((COLS - 1) / 2) * CELL + 1.4; // 半宽 + 棋子/边距
    const halfD = ((ROWS - 1) / 2) * CELL + 2.0;
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const distW = halfW / (tanV * aspect);
    const distD = (halfD / tanV) * 0.78;
    const dist = Math.max(distW, distD, 11);
    const pitch = THREE.MathUtils.degToRad(56);
    return new THREE.Vector3(0, Math.sin(pitch) * dist, Math.cos(pitch) * dist + 0.6);
  }

  private onResize = () => {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.camera.position.copy(this.fitCameraPos());
    this.camera.lookAt(0, 0, -0.3);
  };

  private onPointer = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.boardPlane, hit)) return;
    const x = Math.round(hit.x / CELL + (COLS - 1) / 2);
    const y = Math.round(hit.z / CELL + (ROWS - 1) / 2);
    if (x < 0 || x >= COLS || y < 0 || y >= ROWS) return;
    this.onTap(x, y);
  };

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    // 震屏（衰减正弦）
    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      const decay = Math.exp(-this.shakeT * 7);
      const a = this.shakeAmp * decay;
      this.camera.position.set(
        this.camBase.x + Math.sin(this.shakeT * 62) * a,
        this.camBase.y + Math.cos(this.shakeT * 51) * a,
        this.camBase.z + Math.sin(this.shakeT * 44) * a * 0.6,
      );
      this.camera.lookAt(0, 0, -0.3);
      if (decay < 0.02) {
        this.shakeAmp = 0;
        this.camera.position.copy(this.camBase);
        this.camera.lookAt(0, 0, -0.3);
      }
    }
    const nowMs = performance.now();
    for (const tw of this.tweens) {
      tw.t = (nowMs - tw.start) / 1000;
      tw.update(Math.min(1, tw.t / tw.dur));
    }
    const done = this.tweens.filter((t) => t.t >= t.dur);
    this.tweens = this.tweens.filter((t) => t.t < t.dur);
    for (const t of done) t.onDone?.();

    if (this.checkRing.visible) {
      this.checkT += dt;
      const k = 0.7 + Math.sin(this.checkT * 7) * 0.3;
      (this.checkRing.material as THREE.MeshBasicMaterial).opacity = k;
    }
    // 对手思考中：黑将起伏，给"人在想"的观感
    if (this.thinking) {
      const k = this.pieces.find((p) => p.t === 'K' && p.c === 'b');
      if (k) k.mesh.position.y = TOP_Y + 0.16 + Math.sin(nowMs / 230) * 0.1;
    }
    // 选中棋子轻微悬浮
    if (this.selected) {
      this.selected.mesh.position.y = TOP_Y + 0.35 + Math.sin(performance.now() / 260) * 0.04;
    }
    this.composer.render();
  };
}
