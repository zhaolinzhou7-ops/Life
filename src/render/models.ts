import * as THREE from 'three';
import { cellKey, cellToWorld, type MapLayout } from '../maps/maps';

/** 共享材质缓存，避免重复创建 */
const matCache = new Map<number, THREE.MeshLambertMaterial>();
export function mat(color: number): THREE.MeshLambertMaterial {
  let m = matCache.get(color);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color });
    matCache.set(color, m);
  }
  return m;
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
  const h = 1 + level * 0.18; // 等级越高越高大
  const baseMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.35, 8), mat(0x78909c));
  baseMesh.position.y = 0.35 + 0.175;
  g.add(baseMesh);

  switch (kind) {
    case 'arrow': {
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.26, 0.7 * h, 8), mat(0x8d6e63));
      body.position.y = 0.7 + 0.35 * h;
      g.add(body);
      const top = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.4, 8), mat(0xa1887f));
      top.position.y = 0.7 + 0.7 * h + 0.2;
      g.add(top);
      break;
    }
    case 'cannon': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.32, 10, 8), mat(0x546e7a));
      body.position.y = 0.7 + 0.25;
      g.add(body);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.14, 0.55 + level * 0.1, 8), mat(0x37474f));
      barrel.rotation.x = Math.PI / 3;
      barrel.position.set(0, 1.05, 0.25);
      g.add(barrel);
      break;
    }
    case 'frost': {
      const crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.3 + level * 0.05, 0),
        new THREE.MeshLambertMaterial({ color: 0x81d4fa, emissive: 0x0277bd }),
      );
      crystal.position.y = 0.7 + 0.45 * h;
      crystal.name = 'spin';
      g.add(crystal);
      break;
    }
    case 'bolt': {
      const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.14, 0.9 * h, 6), mat(0x5c6bc0));
      rod.position.y = 0.7 + 0.45 * h;
      g.add(rod);
      const orb = new THREE.Mesh(
        new THREE.SphereGeometry(0.2, 10, 8),
        new THREE.MeshLambertMaterial({ color: 0xfff176, emissive: 0xf9a825 }),
      );
      orb.position.y = 0.7 + 0.9 * h + 0.15;
      orb.name = 'spin';
      g.add(orb);
      break;
    }
  }

  // 等级标记：塔基上的金环
  for (let i = 0; i < level; i++) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.035, 6, 16), mat(0xffd54f));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.42 + i * 0.12;
    g.add(ring);
  }
  return g;
}

// ---------------------------------------------------------------- 敌人模型

export type EnemyKind = 'normal' | 'fast' | 'tank' | 'fly' | 'boss';

export function makeEnemyMesh(kind: EnemyKind): THREE.Group {
  const g = new THREE.Group();
  switch (kind) {
    case 'normal': {
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.22, 3, 8), mat(0xe57373));
      body.position.y = 0.35;
      g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), mat(0xffcdd2));
      head.position.y = 0.68;
      g.add(head);
      break;
    }
    case 'fast': {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 6), mat(0xffb74d));
      body.position.y = 0.3;
      g.add(body);
      break;
    }
    case 'tank': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.5), mat(0x8d6e63));
      body.position.y = 0.35;
      g.add(body);
      const armor = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.56), mat(0x5d4037));
      armor.position.y = 0.56;
      g.add(armor);
      break;
    }
    case 'fly': {
      const body = new THREE.Mesh(new THREE.TetrahedronGeometry(0.24, 0), mat(0xba68c8));
      body.name = 'spin';
      g.add(body);
      const wingGeo = new THREE.BoxGeometry(0.5, 0.03, 0.16);
      const wing = new THREE.Mesh(wingGeo, mat(0x9575cd));
      g.add(wing);
      break;
    }
    case 'boss': {
      const body = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), mat(0xc62828));
      body.position.y = 0.55;
      g.add(body);
      for (let i = 0; i < 6; i++) {
        const spike = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 5), mat(0x880e4f));
        const a = (i / 6) * Math.PI * 2;
        spike.position.set(Math.cos(a) * 0.42, 0.55, Math.sin(a) * 0.42);
        spike.rotation.z = -a - Math.PI / 2;
        spike.rotateOnWorldAxis(new THREE.Vector3(0, 1, 0), -a);
        g.add(spike);
      }
      const crown = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.24, 5), mat(0xffd54f));
      crown.position.y = 1.05;
      g.add(crown);
      break;
    }
  }
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
