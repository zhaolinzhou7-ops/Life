/** 麻将 3D 场景：绿呢桌、立体麻将牌、四家布局与动画（不含规则） */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { rankOf, suitOf, type Meld, type TileId } from './rules';

const TW = 0.72; // 牌宽
const TH = 1.0; // 牌高
const TD = 0.42; // 牌厚
const GAP = 0.02;

/** 牌面纹理（万/条/筒图案，程序化绘制） */
function drawFace(t: TileId): HTMLCanvasElement {
  const W = 128;
  const H = 176;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  // 象牙底
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#fdf7e8');
  grad.addColorStop(1, '#f0e4c8');
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);

  const s = suitOf(t);
  const r = rankOf(t);
  if (s === 0) {
    // 万：数字 + 萬
    const nums = '一二三四五六七八九';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = '#c62828';
    g.font = 'bold 62px "KaiTi","STKaiti",serif';
    g.fillText(nums[r - 1], W / 2, H * 0.28);
    g.fillStyle = '#1b3d8f';
    g.font = 'bold 66px "KaiTi","STKaiti",serif';
    g.fillText('萬', W / 2, H * 0.7);
  } else if (s === 2) {
    // 筒：圆圈阵列
    const circle = (x: number, y: number, rad: number, color: string) => {
      g.beginPath();
      g.arc(x, y, rad, 0, Math.PI * 2);
      g.fillStyle = color;
      g.fill();
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,0.35)';
      g.stroke();
      g.beginPath();
      g.arc(x, y, rad * 0.45, 0, Math.PI * 2);
      g.fillStyle = '#fdf7e8';
      g.fill();
    };
    const C = ['#1b3d8f', '#c62828', '#2e7d32'];
    const cx = W / 2;
    const cy = H / 2;
    if (r === 1) circle(cx, cy, 34, '#c62828');
    else {
      // 常规网格布局
      const layouts: Record<number, [number, number][]> = {
        2: [[0, -1], [0, 1]],
        3: [[-1, -1], [0, 0], [1, 1]],
        4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
        5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
        6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
        7: [[-1, -1.4], [0, -1.1], [1, -0.8], [-1, 0.3], [1, 0.3], [-1, 1.4], [1, 1.4]],
        8: [[-1, -1.5], [1, -1.5], [-1, -0.5], [1, -0.5], [-1, 0.5], [1, 0.5], [-1, 1.5], [1, 1.5]],
        9: [[-1, -1], [0, -1], [1, -1], [-1, 0], [0, 0], [1, 0], [-1, 1], [0, 1], [1, 1]],
      };
      const rad = r <= 4 ? 20 : 14;
      const sp = r <= 4 ? 30 : r <= 6 ? 26 : 22;
      layouts[r].forEach(([gx, gy], i) => circle(cx + gx * sp, cy + gy * sp * 1.15, rad, C[i % 3]));
    }
  } else {
    // 条：竹条（1 条画鸟）
    if (r === 1) {
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = '80px serif';
      g.fillText('🐦', W / 2, H / 2);
    } else {
      const stick = (x: number, y: number, color: string) => {
        g.fillStyle = color;
        g.beginPath();
        g.roundRect(x - 7, y - 22, 14, 44, 6);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.45)';
        g.fillRect(x - 2, y - 20, 3, 40);
        g.fillStyle = color;
        g.beginPath();
        g.ellipse(x, y, 10, 4, 0, 0, Math.PI * 2);
        g.fill();
      };
      const C = ['#2e7d32', '#c62828', '#1b3d8f'];
      const rows: Record<number, [number, number][]> = {
        2: [[0, -0.7], [0, 0.7]],
        3: [[0, -1], [0, 0], [0, 1]],
        4: [[-0.6, -0.7], [0.6, -0.7], [-0.6, 0.7], [0.6, 0.7]],
        5: [[-0.7, -0.8], [0.7, -0.8], [0, 0], [-0.7, 0.8], [0.7, 0.8]],
        6: [[-0.7, -0.8], [0, -0.8], [0.7, -0.8], [-0.7, 0.8], [0, 0.8], [0.7, 0.8]],
        7: [[0, -1], [-0.7, -0.05], [0, -0.05], [0.7, -0.05], [-0.7, 0.95], [0, 0.95], [0.7, 0.95]],
        8: [[-0.7, -1], [0, -1], [0.7, -1], [-0.35, -0.0], [0.35, -0.0], [-0.7, 1], [0, 1], [0.7, 1]],
        9: [[-0.7, -1], [0, -1], [0.7, -1], [-0.7, 0], [0, 0], [0.7, 0], [-0.7, 1], [0, 1], [0.7, 1]],
      };
      rows[r].forEach(([gx, gy], i) => stick(W / 2 + gx * 42, H / 2 + gy * 48, C[i % 3]));
    }
  }
  // 边框
  g.strokeStyle = 'rgba(120,90,40,0.35)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, W - 4, H - 4);
  return cv;
}

const faceTexCache = new Map<number, THREE.CanvasTexture>();
function faceTex(t: TileId): THREE.CanvasTexture {
  let tex = faceTexCache.get(t);
  if (!tex) {
    tex = new THREE.CanvasTexture(drawFace(t));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    faceTexCache.set(t, tex);
  }
  return tex;
}

/** 绿呢桌布纹理：中心亮四周暗 + 细噪点 */
function makeFeltTexture(): THREE.CanvasTexture {
  const S = 512;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const rad = g.createRadialGradient(S / 2, S / 2, S * 0.1, S / 2, S / 2, S * 0.72);
  rad.addColorStop(0, '#2c8a58');
  rad.addColorStop(0.6, '#1e6b45');
  rad.addColorStop(1, '#14492f');
  g.fillStyle = rad;
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.025)' : 'rgba(0,0,0,0.04)';
    g.fillRect(Math.random() * S, Math.random() * S, 1.4, 1.4);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let ivoryMat: THREE.MeshPhysicalMaterial | null = null;
let backMat: THREE.MeshPhysicalMaterial | null = null;
function sharedMats() {
  // 清漆材质：象牙牌身/翡翠牌背都有真实反光
  if (!ivoryMat)
    ivoryMat = new THREE.MeshPhysicalMaterial({
      color: 0xf5ecd7,
      roughness: 0.32,
      clearcoat: 0.8,
      clearcoatRoughness: 0.18,
    });
  if (!backMat)
    backMat = new THREE.MeshPhysicalMaterial({
      color: 0x27825c,
      roughness: 0.3,
      clearcoat: 1,
      clearcoatRoughness: 0.12,
    });
  return { ivoryMat: ivoryMat!, backMat: backMat! };
}

const faceMatCache = new Map<number, THREE.MeshPhysicalMaterial>();

/** 创建一张牌。face 朝 +Z */
export function makeTile(t: TileId): THREE.Mesh {
  const { ivoryMat, backMat } = sharedMats();
  let faceMat = faceMatCache.get(t);
  if (!faceMat) {
    faceMat = new THREE.MeshPhysicalMaterial({
      map: faceTex(t),
      roughness: 0.3,
      clearcoat: 0.9,
      clearcoatRoughness: 0.15,
    });
    faceMatCache.set(t, faceMat);
  }
  const geo = new THREE.BoxGeometry(TW, TH, TD);
  // 材质顺序：+x -x +y -y +z(face) -z(back)
  const mesh = new THREE.Mesh(geo, [ivoryMat, ivoryMat, ivoryMat, ivoryMat, faceMat, backMat]);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

interface Tween {
  t: number;
  dur: number;
  /** 真实起始时刻（ms）：按墙钟推进，低帧率设备也能准时播完 */
  start: number;
  update: (k: number) => void;
  onDone?: () => void;
}

/** 座位朝向：0 玩家(下) 1 右 2 对家(上) 3 左；返回朝桌心的旋转角 */
const seatAngle = (seat: number) => (seat * Math.PI) / 2; // 绕 y

export class MahjongScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private raycaster = new THREE.Raycaster();
  private tweens: Tween[] = [];
  private raf = 0;
  private disposed = false;
  private clock = new THREE.Clock();

  private handRoot = new THREE.Group(); // 玩家手牌
  private handScene = new THREE.Scene(); // 手牌独立正交层
  private handCam!: THREE.OrthographicCamera;
  private handHalfW = 5.45;
  private handHalfH = 13;
  private handMeshes: THREE.Mesh[] = [];
  private hitBoxes: THREE.Mesh[] = [];
  private selectedIdx = -1;
  private oppRoots: THREE.Group[] = []; // 三家牌背
  private discardRoots: THREE.Group[] = [];
  private discardCounts = [0, 0, 0, 0];
  private meldRoots: THREE.Group[] = [];
  private winRoots: THREE.Group[] = [];
  private flashRing!: THREE.Mesh;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private shakeT = 0;
  private shakeAmp = 0;
  private camBase = new THREE.Vector3();

  constructor(
    container: HTMLElement,
    private onTileTap: (index: number) => void,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene.background = new THREE.Color(0x14231c);

    // IBL 环境反射：让清漆材质有真实高光
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environment = envTex;
    this.scene.environmentIntensity = 0.3;
    this.handScene.environment = envTex;
    this.handScene.environmentIntensity = 0.45;

    const hemi = new THREE.HemisphereLight(0xe8f2ff, 0x2c3a26, 0.55);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff3e0, 1.45);
    sun.position.set(4, 14, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    sc.left = -12;
    sc.right = 12;
    sc.top = 12;
    sc.bottom = -12;
    sc.far = 50;
    this.scene.add(sun);

    // 桌面：带光照感的绿呢纹理 + 木边
    const felt = new THREE.Mesh(
      new THREE.BoxGeometry(15.4, 0.3, 15.4),
      new THREE.MeshStandardMaterial({ map: makeFeltTexture(), roughness: 0.95 }),
    );
    felt.position.y = -0.15;
    felt.receiveShadow = true;
    this.scene.add(felt);
    const rim = new THREE.Mesh(
      new THREE.BoxGeometry(16.6, 0.5, 16.6),
      new THREE.MeshStandardMaterial({ color: 0x5d3a16, roughness: 0.75 }),
    );
    rim.position.y = -0.31;
    rim.receiveShadow = true;
    this.scene.add(rim);
    // 中央装饰圈
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.5, 1.62, 48),
      new THREE.MeshBasicMaterial({ color: 0x3aa06b, side: THREE.DoubleSide }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.005;
    this.scene.add(ring);
    // 头顶暖色吊灯感
    const lamp = new THREE.PointLight(0xffd9a0, 6, 26, 1.8);
    lamp.position.set(0, 7.5, 0);
    this.scene.add(lamp);
    // 装饰牌墙：四边各两层码好的牌背
    const { ivoryMat, backMat } = sharedMats();
    const wallGeo = new THREE.BoxGeometry(TW, TH, TD);
    for (let s = 0; s < 4; s++) {
      const g = new THREE.Group();
      g.rotation.y = (s * Math.PI) / 2;
      for (let i = 0; i < 15; i++) {
        for (let lv = 0; lv < 2; lv++) {
          const m = new THREE.Mesh(wallGeo, [ivoryMat, ivoryMat, ivoryMat, ivoryMat, backMat, ivoryMat]);
          m.position.set(-((14 * (TW + 0.02)) / 2) + i * (TW + 0.02), TD / 2 + lv * (TD + 0.01), 6.9);
          m.rotation.x = -Math.PI / 2;
          m.castShadow = lv === 1;
          g.add(m);
        }
      }
      this.scene.add(g);
    }
    // 碰杠冲击环（复用，触发时展开）
    this.flashRing = new THREE.Mesh(
      new THREE.RingGeometry(0.8, 1.05, 40),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.8, 0.5), transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false }),
    );
    this.flashRing.rotation.x = -Math.PI / 2;
    this.flashRing.position.y = 0.02;
    this.scene.add(this.flashRing);

    for (let s = 0; s < 4; s++) {
      const opp = new THREE.Group();
      const disc = new THREE.Group();
      const meld = new THREE.Group();
      const win = new THREE.Group();
      this.scene.add(opp, disc, meld, win);
      this.oppRoots.push(opp);
      this.discardRoots.push(disc);
      this.meldRoots.push(meld);
      this.winRoots.push(win);
    }
    // 手牌正交层：自带灯光，叠加渲染在桌面之上
    this.handScene.add(this.handRoot);
    this.handScene.add(new THREE.AmbientLight(0xffffff, 1.1));
    const handDir = new THREE.DirectionalLight(0xfff3e0, 1.6);
    handDir.position.set(2, 6, 8);
    this.handScene.add(handDir);
    this.handCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50);
    this.handCam.position.set(0, 0, 12);

    this.camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 100);
    this.fitCamera();

    // Bloom 辉光后处理（灯光/特效发光）
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.5,
      0.4,
      1.15,
    );
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    window.addEventListener('resize', this.onResize);
    this.renderer.domElement.addEventListener('pointerdown', this.onPointer);
    this.loop();
  }

  // ---------- 玩家手牌（独立正交层：永远正面朝你，抬离屏幕底部手势条） ----------
  private handBaseY() {
    // 上抬约 1.1 单位，避开手机底部 home indicator / 手势条，避免点击被系统拦截
    return -this.handHalfH + TH * 0.72 + 1.15;
  }
  /** 手牌行在正交层的坐标 */
  private handSlot(i: number, n: number, drawnSeparate: boolean): THREE.Vector3 {
    const isDrawn = drawnSeparate && i === n - 1;
    const baseN = drawnSeparate ? n - 1 : n;
    const w = TW + GAP;
    const x0 = -((baseN - 1) * w) / 2;
    const x = isDrawn ? x0 + baseN * w + 0.3 : x0 + i * w;
    return new THREE.Vector3(x, this.handBaseY(), 0);
  }

  setPlayerHand(tiles: TileId[], drawnSeparate: boolean) {
    this.handRoot.clear();
    this.handMeshes = [];
    this.hitBoxes = [];
    this.selectedIdx = -1;
    tiles.forEach((t, i) => {
      const m = makeTile(t);
      const p = this.handSlot(i, tiles.length, drawnSeparate);
      m.position.copy(p);
      m.rotation.x = -0.08; // 微微后仰，保留立体感
      m.userData.handIndex = i;
      this.handRoot.add(m);
      this.handMeshes.push(m);

      // 不可见的大点击判定区（手指容错）：比牌宽 1.6 倍、向上延伸 2.4 倍
      const hit = new THREE.Mesh(
        new THREE.PlaneGeometry(TW * 1.6, TH * 2.4),
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }),
      );
      hit.position.set(p.x, p.y + TH * 0.5, p.z + TD);
      hit.userData.handIndex = i;
      this.handRoot.add(hit);
      this.hitBoxes.push(hit);
    });
  }

  selectTile(idx: number) {
    this.handMeshes.forEach((m, i) => {
      const fromY = m.position.y;
      const toY = this.handBaseY() + (i === idx ? 0.42 : 0);
      const fromS = m.scale.x;
      const toS = i === idx ? 1.14 : 1;
      if (Math.abs(fromY - toY) < 0.01 && Math.abs(fromS - toS) < 0.01) return;
      this.addTween(0.12, (k) => {
        m.position.y = THREE.MathUtils.lerp(fromY, toY, k);
        m.scale.setScalar(THREE.MathUtils.lerp(fromS, toS, k));
      });
    });
    this.selectedIdx = idx;
  }
  get selected() {
    return this.selectedIdx;
  }

  // ---------- 对家牌背 ----------
  setOpponentCount(seat: number, count: number) {
    const root = this.oppRoots[seat];
    root.clear();
    const w = TW + GAP;
    for (let i = 0; i < count; i++) {
      const { ivoryMat, backMat } = sharedMats();
      const m = new THREE.Mesh(new THREE.BoxGeometry(TW, TH, TD), [ivoryMat, ivoryMat, ivoryMat, ivoryMat, backMat, ivoryMat]);
      m.castShadow = true;
      m.position.set(-((count - 1) * w) / 2 + i * w, TH / 2 + 0.02, 5.4);
      root.add(m);
    }
    root.rotation.y = seatAngle(seat);
    // 站立、面向桌心（背对外）
    root.children.forEach((c) => ((c as THREE.Mesh).rotation.x = -0.1));
  }

  // ---------- 出牌区 ----------
  /** 打出一张牌（从该家手牌区飞到弃牌区，躺平面朝上）。
   *  牌加入按座位整体旋转的组里，组内只做局部位移/翻转，任何座位都不会面朝下 */
  discard(seat: number, tile: TileId): number {
    const root = this.discardRoots[seat];
    root.rotation.y = seatAngle(seat);
    const idx = this.discardCounts[seat]++;
    const row = Math.floor(idx / 6);
    const col = idx % 6;
    const pos = new THREE.Vector3(-(5 * (TW + 0.05)) / 2 + col * (TW + 0.05), TD / 2 + 0.001, 2.1 + row * (TH + 0.06));
    const start = new THREE.Vector3(0, TH / 2 + 0.6, 4.6);
    const m = makeTile(tile);
    m.position.copy(start);
    m.rotation.x = -0.4;
    root.add(m);
    this.addTween(0.4, (k) => {
      const e = 1 - (1 - k) ** 2;
      m.position.lerpVectors(start, pos, e);
      m.position.y = pos.y + Math.sin(k * Math.PI) * 0.7 + (1 - e) * 0.5;
      m.rotation.x = THREE.MathUtils.lerp(-0.4, -Math.PI / 2, e);
    });
    return 0.4;
  }

  /** 移走该家最后一张弃牌（被碰/杠拿走） */
  takeLastDiscard(seat: number) {
    const root = this.discardRoots[seat];
    const m = root.children[root.children.length - 1] as THREE.Mesh | undefined;
    if (m) root.remove(m);
    if (this.discardCounts[seat] > 0) this.discardCounts[seat]--;
  }

  // ---------- 副露（碰/杠） ----------
  setMelds(seat: number, melds: Meld[]) {
    const root = this.meldRoots[seat];
    root.clear();
    root.rotation.y = seatAngle(seat);
    melds.forEach((meld, mi) => {
      const n = meld.kind === 'peng' ? 3 : 4;
      for (let i = 0; i < n; i++) {
        const hidden = meld.kind === 'angang';
        const m = makeTile(meld.tile);
        m.position.set(3.9 - mi * 2.6 - i * (TW + 0.03), TD / 2, 4.1);
        m.rotation.x = hidden ? Math.PI / 2 : -Math.PI / 2; // 暗杠盖着
        root.add(m);
      }
    });
  }

  // ---------- 胡牌亮牌 ----------
  showWin(seat: number, tiles: TileId[]) {
    if (seat === 0) return; // 玩家自己的手牌本来就可见
    this.oppRoots[seat].clear();
    const root = this.winRoots[seat];
    root.clear();
    root.rotation.y = seatAngle(seat);
    const w = TW + 0.03;
    tiles.forEach((t, i) => {
      const m = makeTile(t);
      m.position.set(-((tiles.length - 1) * w) / 2 + i * w, TD / 2, 5.2);
      m.rotation.x = -Math.PI / 2;
      root.add(m);
    });
  }

  /** 碰/杠冲击特效：该家副露区金色冲击环 + 缩放脉冲 */
  flashMeld(seat: number) {
    const p = new THREE.Vector3(2.6, 0.03, 4.1).applyAxisAngle(new THREE.Vector3(0, 1, 0), seatAngle(seat));
    this.flashRing.position.set(p.x, 0.03, p.z);
    const mat = this.flashRing.material as THREE.MeshBasicMaterial;
    this.addTween(0.55, (k) => {
      this.flashRing.scale.setScalar(0.6 + k * 2.6);
      mat.opacity = (1 - k) * 0.9;
    });
    // 副露牌组弹跳
    const root = this.meldRoots[seat];
    this.addTween(0.3, (k) => {
      const s = 1 + Math.sin(k * Math.PI) * 0.18;
      root.scale.setScalar(s);
    });
  }

  /** 碰/杠/胡 大特效：金色冲击波 + 粒子爆发 + 震屏（杠/胡更猛） */
  bigFlash(seat: number, kind: 'peng' | 'gang' | 'win') {
    const dir = seatAngle(seat);
    const center = new THREE.Vector3(0, 0.6, 3.4).applyAxisAngle(new THREE.Vector3(0, 1, 0), dir);
    const power = kind === 'win' ? 1.9 : kind === 'gang' ? 1.5 : 0.95;
    const color =
      kind === 'win' ? new THREE.Color(4, 2.6, 0.8) : kind === 'gang' ? new THREE.Color(3.4, 1.6, 0.5) : new THREE.Color(2.2, 1.8, 3.2);

    // 地面冲击波（多重）
    const rings = kind === 'peng' ? 1 : kind === 'gang' ? 2 : 3;
    for (let i = 0; i < rings; i++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 0.9, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, side: THREE.DoubleSide, toneMapped: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(center.x, 0.04, center.z);
      this.scene.add(ring);
      const mat = ring.material as THREE.MeshBasicMaterial;
      const delay = i * 0.13;
      this.addTween(
        0.62 + delay,
        (k) => {
          const kk = Math.max(0, (k * (0.62 + delay) - delay) / 0.62);
          ring.scale.setScalar(0.4 + kk * 4.2 * power);
          mat.opacity = (1 - kk) * 0.95;
        },
        () => this.scene.remove(ring),
      );
    }

    // 粒子爆发（金色碎片）
    const n = Math.round(18 * power);
    const pmat = new THREE.MeshBasicMaterial({ color, toneMapped: false, transparent: true });
    for (let i = 0; i < n; i++) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), pmat.clone());
      p.position.copy(center);
      this.scene.add(p);
      const a = Math.random() * Math.PI * 2;
      const sp = 2.4 + Math.random() * 3.2 * power;
      const vx = Math.cos(a) * sp;
      const vz = Math.sin(a) * sp;
      const vy = 3.2 + Math.random() * 3.4 * power;
      const rot = new THREE.Vector3(Math.random() * 8, Math.random() * 8, Math.random() * 8);
      const life = 0.85;
      this.addTween(
        life,
        (k) => {
          const t = k * life;
          p.position.set(center.x + vx * t, center.y + vy * t - 9.4 * t * t, center.z + vz * t);
          p.rotation.set(rot.x * t, rot.y * t, rot.z * t);
          (p.material as THREE.MeshBasicMaterial).opacity = 1 - k;
          p.scale.setScalar(1 - k * 0.5);
        },
        () => this.scene.remove(p),
      );
    }

    // 强光闪 + 震屏
    const flashLight = new THREE.PointLight(kind === 'peng' ? 0x9fb8ff : 0xffd08a, 0, 22);
    flashLight.position.set(center.x, 3.2, center.z);
    this.scene.add(flashLight);
    this.addTween(
      0.45,
      (k) => {
        flashLight.intensity = (1 - k) * 42 * power;
      },
      () => this.scene.remove(flashLight),
    );
    this.shake(0.06 * power);
  }

  /** 相机震屏 */
  private shake(amp: number) {
    this.camBase.copy(this.camera.position);
    this.shakeAmp = amp;
    this.shakeT = 0;
  }

  /** 摸牌小动画：一张背牌飞向该家 */
  drawAnim(seat: number): number {
    const { ivoryMat, backMat } = sharedMats();
    const m = new THREE.Mesh(new THREE.BoxGeometry(TW, TH, TD), [ivoryMat, ivoryMat, ivoryMat, ivoryMat, backMat, backMat]);
    const end = new THREE.Vector3(0, TH / 2 + 0.4, 4.8).applyAxisAngle(new THREE.Vector3(0, 1, 0), seatAngle(seat));
    m.position.set(0, 2.2, 0);
    this.scene.add(m);
    this.addTween(
      0.3,
      (k) => {
        m.position.lerpVectors(new THREE.Vector3(0, 2.2, 0), end, k);
        m.rotation.y = seatAngle(seat) * k;
      },
      () => this.scene.remove(m),
    );
    return 0.3;
  }

  reset() {
    this.handRoot.clear();
    this.handMeshes = [];
    this.discardCounts = [0, 0, 0, 0];
    for (const r of [...this.oppRoots, ...this.discardRoots, ...this.meldRoots, ...this.winRoots]) r.clear();
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
  private fitCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    const need = 5.5; // 桌面可视半宽（越小桌子越占满屏幕，越沉浸）
    const tanV = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    const dist = Math.max(need / (tanV * aspect), 9.5);
    this.camera.aspect = aspect;
    this.camera.position.set(0, dist * 0.62, 5.0 + dist * 0.78);
    this.camera.lookAt(0, 0, 1.1);
    this.camera.updateProjectionMatrix();
    // 手牌正交层：宽度固定容纳 14 张 + 摸牌位，高度按屏幕比例
    this.handHalfW = 5.45; // 更小 = 牌更大更好点
    this.handHalfH = this.handHalfW / aspect;
    this.handCam.left = -this.handHalfW;
    this.handCam.right = this.handHalfW;
    this.handCam.top = this.handHalfH;
    this.handCam.bottom = -this.handHalfH;
    this.handCam.updateProjectionMatrix();
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.composer.setSize(window.innerWidth, window.innerHeight);
    this.bloom.resolution.set(window.innerWidth, window.innerHeight);
    this.fitCamera();
  };

  private onPointer = (e: PointerEvent) => {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(new THREE.Vector2(nx, ny), this.handCam);
    const hits = this.raycaster.intersectObjects(this.hitBoxes, false);
    if (hits.length > 0) {
      const idx = hits[0].object.userData.handIndex as number;
      this.onTileTap(idx);
    }
  };

  private addTween(dur: number, update: (k: number) => void, onDone?: () => void) {
    this.tweens.push({ t: 0, dur, start: performance.now(), update, onDone });
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const nowMs = performance.now();
    for (const tw of this.tweens) {
      tw.t = (nowMs - tw.start) / 1000;
      tw.update(Math.min(1, tw.t / tw.dur));
    }
    // 震屏（衰减）
    if (this.shakeAmp > 0.0005) {
      this.shakeT += dt;
      const decay = Math.exp(-this.shakeT * 6.5);
      const a = this.shakeAmp * decay;
      this.camera.position.set(
        this.camBase.x + Math.sin(this.shakeT * 58) * a,
        this.camBase.y + Math.cos(this.shakeT * 47) * a,
        this.camBase.z + Math.sin(this.shakeT * 41) * a * 0.6,
      );
      this.camera.lookAt(0, 0, 1.1);
      if (decay < 0.02) {
        this.shakeAmp = 0;
        this.camera.position.copy(this.camBase);
        this.camera.lookAt(0, 0, 1.1);
      }
    }
    const done = this.tweens.filter((t) => t.t >= t.dur);
    this.tweens = this.tweens.filter((t) => t.t < t.dur);
    for (const t of done) t.onDone?.();
    // 双层渲染：composer（主场景 + Bloom）→ 清深度 → 手牌正交层
    this.renderer.autoClear = false;
    this.composer.render();
    this.renderer.clearDepth();
    this.renderer.render(this.handScene, this.handCam);
  };
}
