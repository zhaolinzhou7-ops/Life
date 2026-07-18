/** 象棋 3D 场景：木纹棋盘、刻字棋子、走子/吃子动画与触摸拾取（不含规则） */
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { COLS, ROWS, PTYPE_NAME, type Board, type Move } from './rules';

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
  update: (k: number) => void;
  onDone?: () => void;
}

interface PieceMesh {
  mesh: THREE.Group;
  x: number;
  y: number;
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

/** 棋子顶面：木底 + 刻环 + 字 */
function makeFaceTexture(char: string, color: string): THREE.CanvasTexture {
  const S = 256;
  const cv = document.createElement('canvas');
  cv.width = S;
  cv.height = S;
  const g = cv.getContext('2d')!;
  const grad = g.createRadialGradient(S * 0.4, S * 0.35, S * 0.1, S / 2, S / 2, S * 0.55);
  grad.addColorStop(0, '#f4dcae');
  grad.addColorStop(1, '#e0b877');
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  g.strokeStyle = color;
  g.lineWidth = 7;
  g.beginPath();
  g.arc(S / 2, S / 2, S * 0.42, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = color;
  g.font = `bold ${S * 0.52}px "KaiTi","STKaiti",serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  // 轻微阴影模拟刻痕
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 3;
  g.shadowOffsetY = 2;
  g.fillText(char, S / 2, S / 2 + S * 0.02);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 山水画卷背景：宣纸底色、层叠远山、雾霭与淡日 */
function makeShanshuiTexture(): THREE.CanvasTexture {
  const W = 1024;
  const H = 1024;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d')!;
  // 宣纸渐变天空（构图集中在上部 1/3，桌沿以上可见区域）
  const sky = g.createLinearGradient(0, 0, 0, H * 0.4);
  sky.addColorStop(0, '#ece5d2');
  sky.addColorStop(0.55, '#cfd4c8');
  sky.addColorStop(1, '#8fa096');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, H * 0.4);
  g.fillStyle = '#8fa096';
  g.fillRect(0, H * 0.4, W, H);
  // 淡日
  g.globalAlpha = 0.55;
  const sun = g.createRadialGradient(W * 0.72, H * 0.09, 6, W * 0.72, H * 0.09, 70);
  sun.addColorStop(0, '#f6d8a8');
  sun.addColorStop(1, 'rgba(246,216,168,0)');
  g.fillStyle = sun;
  g.fillRect(0, 0, W, H * 0.3);
  g.globalAlpha = 1;
  // 层叠远山（水墨浓淡）
  const layers = [
    { y: H * 0.15, amp: 42, col: 'rgba(90,110,105,0.4)' },
    { y: H * 0.19, amp: 58, col: 'rgba(70,92,88,0.55)' },
    { y: H * 0.24, amp: 74, col: 'rgba(52,72,68,0.7)' },
    { y: H * 0.3, amp: 88, col: 'rgba(38,54,50,0.85)' },
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
  private disposed = false;
  private selected: PieceMesh | null = null;
  private checkRing: THREE.Mesh;
  private lastFrom!: THREE.Mesh;
  private lastTo!: THREE.Mesh;
  private composer!: EffectComposer;
  private bloom!: UnrealBloomPass;
  private checkT = -1;
  private boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TOP_Y);
  private clock = new THREE.Clock();

  constructor(
    container: HTMLElement,
    private onTap: (x: number, y: number) => void,
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
    // IBL 环境反射：漆面棋子的真实高光
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.35;

    // 灯光
    const hemi = new THREE.HemisphereLight(0xdfeaff, 0x3a3226, 0.8);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
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

    // 桌面（深色石案，衬山水背景）
    const table = new THREE.Mesh(
      new THREE.CylinderGeometry(16, 16, 0.4, 48),
      new THREE.MeshStandardMaterial({ color: 0x3c4038, roughness: 0.92 }),
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
    // 底座
    const basePad = new THREE.Mesh(
      new THREE.BoxGeometry(bw + 0.5, 0.24, bh + 0.5),
      new THREE.MeshStandardMaterial({ color: 0x5d3a16, roughness: 0.85 }),
    );
    basePad.position.y = -BOARD_T / 2 - 0.12;
    basePad.receiveShadow = true;
    this.scene.add(basePad);

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

  /** 重建全部棋子（初始化 / 悔棋 / 重开） */
  syncBoard(b: Board) {
    for (const p of this.pieces) this.pieceRoot.remove(p.mesh);
    this.pieces = [];
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const p = b[y][x];
        if (!p) continue;
        const mesh = this.makePiece(PTYPE_NAME[p.t][p.c === 'r' ? 0 : 1], p.c === 'r' ? '#c62828' : '#22303a');
        mesh.position.copy(cellToWorld(x, y));
        this.pieceRoot.add(mesh);
        this.pieces.push({ mesh, x, y });
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
    this.addTween(
      0.42,
      (k) => {
        const e = 1 - (1 - k) ** 2;
        mover.mesh.position.lerpVectors(from, to, e);
        mover.mesh.position.y = TOP_Y + Math.sin(k * Math.PI) * 0.55;
      },
      () => {
        mover.mesh.position.copy(to);
        // 落点标记
        this.lastFrom.position.set(from.x, TOP_Y + 0.02, from.z);
        this.lastTo.position.set(to.x, TOP_Y + 0.02, to.z);
        this.lastFrom.visible = true;
        this.lastTo.visible = true;
        onDone();
      },
    );
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

  private makePiece(char: string, color: string): THREE.Group {
    const g = new THREE.Group();
    const key = char + color;
    let face = faceCache.get(key);
    if (!face) {
      face = makeFaceTexture(char, color);
      faceCache.set(key, face);
    }
    const side = new THREE.MeshPhysicalMaterial({ color: 0xc99a5b, roughness: 0.35, clearcoat: 1, clearcoatRoughness: 0.15 });
    const top = new THREE.MeshPhysicalMaterial({ map: face, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.12 });
    const bottom = new THREE.MeshPhysicalMaterial({ color: 0xa87c42, roughness: 0.5, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(PIECE_R, PIECE_R * 1.02, PIECE_H, 36), [side, top, bottom]);
    body.position.y = PIECE_H / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    g.add(body);
    return g;
  }

  private addTween(dur: number, update: (k: number) => void, onDone?: () => void) {
    this.tweens.push({ t: 0, dur, update, onDone });
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
    for (const tw of this.tweens) {
      tw.t += dt;
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
    // 选中棋子轻微悬浮
    if (this.selected) {
      this.selected.mesh.position.y = TOP_Y + 0.35 + Math.sin(performance.now() / 260) * 0.04;
    }
    this.composer.render();
  };
}
