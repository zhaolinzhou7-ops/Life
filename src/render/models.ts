import * as THREE from 'three';
import { cellKey, cellToWorld, type MapLayout } from '../maps/maps';

/** 共享材质缓存，避免重复创建（PBR 标准材质，配合实时阴影更有真实感） */
const matCache = new Map<number, THREE.MeshStandardMaterial>();
export function mat(color: number): THREE.MeshStandardMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.04 });
    matCache.set(color, m);
  }
  return m;
}

/** 递归开启投影/受影 */
export function enableShadows(obj: THREE.Object3D, cast = true, receive = true) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.castShadow = cast;
      m.receiveShadow = receive;
    }
  });
}

const COLORS = {
  grass: 0x5da24a,
  grassDark: 0x54923f,
  road: 0x8f7a5f,
  roadEdge: 0x77654e,
  slot: 0x6d787f,
  slotTop: 0x86939c,
  tree: 0x2e7d32,
  treeDark: 0x1b5e20,
  trunk: 0x6d4c41,
  rock: 0x9e9e9e,
};

/** 构建整张地图的静态地形（地面、路面、格位、装饰、出生口、基地） */
export function buildTerrain(layout: MapLayout): THREE.Group {
  const g = new THREE.Group();
  const { def, road, build } = layout;

  // 大地面
  const ground = new THREE.Mesh(
    new THREE.BoxGeometry(def.cols + 6, 0.5, def.rows + 6),
    mat(COLORS.grass),
  );
  ground.position.y = -0.25;
  g.add(ground);

  const roadGeo = new THREE.BoxGeometry(1, 0.24, 1);
  const slotGeo = new THREE.BoxGeometry(0.92, 0.3, 0.92);
  const slotTopGeo = new THREE.BoxGeometry(0.8, 0.06, 0.8);

  for (let c = 0; c < def.cols; c++) {
    for (let r = 0; r < def.rows; r++) {
      const key = cellKey(c, r);
      const p = cellToWorld(def, c, r);
      if (road.has(key)) {
        const m = new THREE.Mesh(roadGeo, mat(COLORS.road));
        m.position.set(p.x, 0.12, p.z);
        g.add(m);
      } else if (build.has(key)) {
        const m = new THREE.Mesh(slotGeo, mat(COLORS.slot));
        m.position.set(p.x, 0.15, p.z);
        g.add(m);
        const top = new THREE.Mesh(slotTopGeo, mat(COLORS.slotTop));
        top.position.set(p.x, 0.33, p.z);
        g.add(top);
      } else if (Math.random() < 0.28) {
        // 草地装饰：树或石头
        const d = Math.random() < 0.7 ? makeTree() : makeRock();
        d.position.set(p.x + (Math.random() - 0.5) * 0.4, 0, p.z + (Math.random() - 0.5) * 0.4);
        g.add(d);
      }
    }
  }

  for (const s of layout.spawns) {
    const portal = makePortal();
    portal.position.set(s.x, 0, s.z);
    g.add(portal);
  }
  const base = makeBase();
  base.position.set(layout.end.x, 0, layout.end.z);
  g.add(base);

  enableShadows(g);
  return g;
}

function makeTree(): THREE.Group {
  const t = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.3, 5), mat(COLORS.trunk));
  trunk.position.y = 0.15;
  t.add(trunk);
  const s = 0.7 + Math.random() * 0.5;
  const leaf = new THREE.Mesh(
    new THREE.ConeGeometry(0.28 * s, 0.7 * s, 6),
    mat(Math.random() < 0.5 ? COLORS.tree : COLORS.treeDark),
  );
  leaf.position.y = 0.3 + 0.35 * s;
  t.add(leaf);
  return t;
}

function makeRock(): THREE.Group {
  const g = new THREE.Group();
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.16 + Math.random() * 0.1, 0), mat(COLORS.rock));
  rock.position.y = 0.1;
  rock.rotation.set(Math.random(), Math.random(), Math.random());
  g.add(rock);
  return g;
}

/** 敌人出生口：暗色传送门拱环 */
function makePortal(): THREE.Group {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.09, 8, 16), mat(0x7b1fa2));
  ring.position.y = 0.6;
  g.add(ring);
  const core = new THREE.Mesh(
    new THREE.CircleGeometry(0.42, 16),
    new THREE.MeshBasicMaterial({ color: 0x4a148c, side: THREE.DoubleSide }),
  );
  core.position.y = 0.6;
  g.add(core);
  return g;
}

/** 我方基地：发光水晶 */
function makeBase(): THREE.Group {
  const g = new THREE.Group();
  const pedestal = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 0.3, 8), mat(0x90a4ae));
  pedestal.position.y = 0.15;
  g.add(pedestal);
  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.42, 0),
    new THREE.MeshLambertMaterial({ color: 0x40c4ff, emissive: 0x0288d1 }),
  );
  crystal.position.y = 0.95;
  crystal.name = 'crystal';
  g.add(crystal);
  return g;
}

// ---------------------------------------------------------------- 塔模型

export type TowerKind = 'arrow' | 'cannon' | 'frost' | 'bolt';

export function makeTowerMesh(kind: TowerKind, level: number): THREE.Group {
  const g = new THREE.Group();
  const h = 1 + level * 0.15; // 等级越高越高大

  // 通用石质塔基（径向对称，旋转不穿帮）+ 石块纹理
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.46, 0.42, 8), mat(0x9aa7b0));
  base.position.y = 0.21;
  g.add(base);
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.12, 8), mat(0x6b757d));
  rim.position.y = 0.42;
  g.add(rim);
  // 塔基砖石点缀
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const brick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.1, 0.06), mat(0x7d8991));
    brick.position.set(Math.cos(a) * 0.42, 0.2, Math.sin(a) * 0.42);
    brick.rotation.y = -a;
    g.add(brick);
  }

  switch (kind) {
    case 'arrow': {
      // 木塔身 + 顶部十字弩台
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.22, 0.6 * h, 8), mat(0x8d6e63));
      shaft.position.y = 0.48 + 0.3 * h;
      g.add(shaft);
      const deckY = 0.48 + 0.6 * h;
      const deck = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.24, 0.12, 8), mat(0xa1887f));
      deck.position.y = deckY;
      g.add(deck);
      // 护栏
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.14, 4), mat(0x6d4c41));
        post.position.set(Math.cos(a) * 0.24, deckY + 0.11, Math.sin(a) * 0.24);
        g.add(post);
      }
      // 弩臂 + 弩身 + 待发的箭（朝 +Z）
      const bow = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.06), mat(0x5d4037));
      bow.position.set(0, deckY + 0.16, 0.1);
      g.add(bow);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.42), mat(0x6d4c41));
      stock.position.set(0, deckY + 0.16, 0.12);
      g.add(stock);
      const boltHead = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.18, 6), mat(0xd7ccc8));
      boltHead.rotation.x = Math.PI / 2;
      boltHead.position.set(0, deckY + 0.16, 0.42);
      g.add(boltHead);
      break;
    }
    case 'cannon': {
      // 半球炮塔 + 前伸炮管 + 铆钉
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        mat(0x607d8b),
      );
      dome.position.y = 0.52;
      g.add(dome);
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.1, 12), mat(0x37474f));
      collar.position.y = 0.52;
      g.add(collar);
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.13, 0.5 + level * 0.08, 10),
        mat(0x2f3e46),
      );
      barrel.rotation.x = Math.PI / 2.4;
      barrel.position.set(0, 0.64, 0.26);
      g.add(barrel);
      const muzzle = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.08, 10), mat(0x1c262b));
      muzzle.rotation.x = Math.PI / 2.4;
      muzzle.position.set(0, 0.73, 0.46);
      g.add(muzzle);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2;
        const rivet = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat(0x263238));
        rivet.position.set(Math.cos(a) * 0.28, 0.56, Math.sin(a) * 0.28);
        g.add(rivet);
      }
      break;
    }
    case 'frost': {
      // 冰柱 + 发光核心 + 环绕碎冰
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.2, 0.5 * h, 6), mat(0x4fc3f7));
      pillar.position.y = 0.48 + 0.25 * h;
      g.add(pillar);
      const coreY = 0.48 + 0.5 * h + 0.14;
      const core = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.2 + level * 0.04, 0),
        new THREE.MeshLambertMaterial({ color: 0xb3e5fc, emissive: 0x29b6f6, emissiveIntensity: 0.7 }),
      );
      core.position.y = coreY;
      core.name = 'spin';
      g.add(core);
      const shardHolder = new THREE.Group();
      shardHolder.name = 'spin';
      shardHolder.position.y = coreY;
      const shards = 3 + level;
      for (let i = 0; i < shards; i++) {
        const a = (i / shards) * Math.PI * 2;
        const shard = new THREE.Mesh(new THREE.TetrahedronGeometry(0.09, 0), mat(0x81d4fa));
        shard.position.set(Math.cos(a) * 0.28, 0, Math.sin(a) * 0.28);
        shardHolder.add(shard);
      }
      g.add(shardHolder);
      break;
    }
    case 'bolt': {
      // 特斯拉线圈：金属柱 + 铜环 + 发光电球
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.16, 0.42 * h, 8), mat(0x455a64));
      post.position.y = 0.48 + 0.21 * h;
      g.add(post);
      const topY = 0.48 + 0.42 * h;
      for (let i = 0; i < 3; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.17 - i * 0.03, 0.028, 6, 14), mat(0xb08d57));
        t.rotation.x = Math.PI / 2;
        t.position.y = topY + 0.05 + i * 0.09;
        g.add(t);
      }
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.15 + level * 0.03, 12, 10),
        new THREE.MeshLambertMaterial({ color: 0xfff59d, emissive: 0xfbc02d, emissiveIntensity: 0.85 }),
      );
      orb.position.y = topY + 0.05 + 3 * 0.09 + 0.16;
      orb.name = 'spin';
      g.add(orb);
      // 顶部尖针
      const prong = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.14, 5), mat(0xcfd8dc));
      prong.position.y = orb.position.y + 0.2;
      g.add(prong);
      break;
    }
  }

  // 等级标记：塔基金环
  for (let i = 0; i < level; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.035, 6, 16), mat(0xffd54f));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.13 + i * 0.1;
    g.add(ring);
  }
  enableShadows(g);
  return g;
}

// ---------------------------------------------------------------- 敌人模型

export type EnemyKind = 'normal' | 'fast' | 'tank' | 'fly' | 'boss';

/** 给模型加一对眼睛（朝 +Z，即前进方向）。glow=发光的邪恶眼睛 */
function addEyes(parent: THREE.Object3D, y: number, z: number, spread: number, size = 0.05, glow = false) {
  const pupilMat = glow ? new THREE.MeshBasicMaterial({ color: 0xff5252 }) : mat(0x1a1a1a);
  for (const sx of [-1, 1]) {
    if (!glow) {
      const white = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), mat(0xffffff));
      white.position.set(sx * spread, y, z);
      parent.add(white);
    }
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(size * (glow ? 0.95 : 0.55), 6, 5), pupilMat);
    pupil.position.set(sx * spread, y, z + size * 0.55);
    parent.add(pupil);
  }
}

export function makeEnemyMesh(kind: EnemyKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'normal': {
      // 小妖精：圆滚身体、尖耳朵、大眼睛、小脚
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), mat(0x7cb342));
      body.scale.set(1, 1.12, 0.92);
      body.position.y = 0.32;
      g.add(body);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mat(0xaed581));
      belly.scale.set(1, 1.1, 0.6);
      belly.position.set(0, 0.28, 0.14);
      g.add(belly);
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.18, 5), mat(0x689f38));
        ear.position.set(sx * 0.16, 0.5, -0.02);
        ear.rotation.z = sx * 0.5;
        g.add(ear);
        const foot = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 5), mat(0x558b2f));
        foot.scale.set(1, 0.6, 1.3);
        foot.position.set(sx * 0.1, 0.06, 0.03);
        g.add(foot);
      }
      addEyes(g, 0.4, 0.16, 0.08, 0.055);
      break;
    }
    case 'fast': {
      // 疾风斥候：流线猎犬，前倾冲刺姿态
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.26, 4, 8), mat(0xffa726));
      body.rotation.x = Math.PI / 2;
      body.position.set(0, 0.26, -0.02);
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 7), mat(0xffb74d));
      head.position.set(0, 0.3, 0.22);
      g.add(head);
      const snout = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.16, 6), mat(0xffcc80));
      snout.rotation.x = Math.PI / 2;
      snout.position.set(0, 0.27, 0.36);
      g.add(snout);
      for (const sx of [-1, 1]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.12, 5), mat(0xf57c00));
        ear.position.set(sx * 0.07, 0.4, 0.18);
        ear.rotation.set(-0.6, 0, sx * 0.3);
        g.add(ear);
        const legF = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 5), mat(0xf57c00));
        legF.position.set(sx * 0.09, 0.11, 0.12);
        g.add(legF);
        const legB = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 5), mat(0xf57c00));
        legB.position.set(sx * 0.09, 0.11, -0.14);
        g.add(legB);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.24, 5), mat(0xffb74d));
      tail.rotation.x = -Math.PI / 2.4;
      tail.position.set(0, 0.34, -0.28);
      g.add(tail);
      addEyes(g, 0.33, 0.3, 0.06, 0.04);
      break;
    }
    case 'tank': {
      // 重甲兵：厚重装甲、头盔、肩甲、发光目视
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.4, 0.46), mat(0x78909c));
      body.position.y = 0.36;
      g.add(body);
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.3, 0.08), mat(0x546e7a));
      plate.position.set(0, 0.36, 0.23);
      g.add(plate);
      const bolt1 = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), mat(0x37474f));
      bolt1.position.set(-0.14, 0.46, 0.27);
      g.add(bolt1);
      const bolt2 = bolt1.clone();
      bolt2.position.x = 0.14;
      g.add(bolt2);
      const helm = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.18, 0.34), mat(0x455a64));
      helm.position.y = 0.64;
      g.add(helm);
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), mat(0xb0bec5));
      crest.position.y = 0.76;
      g.add(crest);
      for (const sx of [-1, 1]) {
        const pad = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6, 0, Math.PI * 2, 0, Math.PI / 2), mat(0x37474f));
        pad.position.set(sx * 0.26, 0.5, 0);
        g.add(pad);
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.18, 0.16), mat(0x546e7a));
        leg.position.set(sx * 0.12, 0.1, 0);
        g.add(leg);
      }
      addEyes(g, 0.62, 0.18, 0.08, 0.04, true);
      break;
    }
    case 'fly': {
      // 飞行兵：菱形核心 + 拍动双翼 + 发光眼
      const body = new THREE.Mesh(new THREE.OctahedronGeometry(0.2, 0), mat(0xab47bc));
      body.name = 'spin';
      g.add(body);
      for (const sx of [-1, 1]) {
        const flap = new THREE.Group();
        flap.name = sx < 0 ? 'wingL' : 'wingR';
        const wing = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.03, 0.24), mat(0xce93d8));
        wing.position.x = sx * 0.24;
        flap.add(wing);
        const edge = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 4), mat(0x8e24aa));
        edge.rotation.z = sx * Math.PI / 2;
        edge.position.x = sx * 0.44;
        flap.add(edge);
        g.add(flap);
      }
      addEyes(g, 0.02, 0.15, 0.06, 0.04, true);
      break;
    }
    case 'boss': {
      // 巨兽：庞大身躯、犄角、背刺、发光巨眼、王冠
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 10), mat(0xc62828));
      body.scale.set(1, 1.02, 1);
      body.position.y = 0.56;
      g.add(body);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), mat(0x8d1414));
      belly.scale.set(1, 0.9, 0.55);
      belly.position.set(0, 0.5, 0.26);
      g.add(belly);
      // 犄角
      for (const sx of [-1, 1]) {
        const horn = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.32, 6), mat(0xf5f5f5));
        horn.position.set(sx * 0.22, 0.9, 0.06);
        horn.rotation.set(-0.3, 0, sx * 0.5);
        g.add(horn);
      }
      // 背刺
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.3, 5), mat(0x7f0e0e));
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.42, 0.56, Math.sin(a) * 0.42);
        spike.rotation.z = -a - Math.PI / 2;
        spike.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -a);
        g.add(spike);
      }
      // 血盆大口
      const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.05), mat(0x2a0000));
      mouth.position.set(0, 0.44, 0.42);
      g.add(mouth);
      addEyes(g, 0.64, 0.34, 0.13, 0.075, true);
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.26, 5), mat(0xffd54f));
      crown.position.y = 1.08;
      g.add(crown);
      break;
    }
  }
  enableShadows(g);
  return g;
}

/** 血条：两个 Sprite（底 + 前景），前景按血量比例缩放 */
export function makeHpBar(width: number): { group: THREE.Group; set: (ratio: number) => void } {
  const group = new THREE.Group();
  const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x263238, depthTest: false }));
  bg.scale.set(width, 0.09, 1);
  group.add(bg);
  const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x66bb6a, depthTest: false }));
  fg.scale.set(width, 0.09, 1);
  fg.position.z = 0.001;
  group.add(fg);
  group.renderOrder = 999;
  const set = (ratio: number) => {
    const r = Math.max(0, Math.min(1, ratio));
    fg.scale.x = width * r;
    fg.position.x = (-width * (1 - r)) / 2;
    (fg.material as THREE.SpriteMaterial).color.setHex(r > 0.5 ? 0x66bb6a : r > 0.25 ? 0xffb300 : 0xe53935);
  };
  return { group, set };
}
