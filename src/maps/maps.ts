import * as THREE from 'three';

/** 地图定义：网格尺寸 + 每条进攻路线的路径拐点（网格坐标 [列, 行]） */
export interface MapDef {
  id: string;
  name: string;
  desc: string;
  cols: number;
  rows: number;
  /** 每个元素是一条地面进攻路线（多个出生口时有多条） */
  routes: [number, number][][];
}

export const MAPS: MapDef[] = [
  {
    id: 'valley',
    name: '蜿蜒山谷',
    desc: '单一入口，S 形长路径，防守纵深充足，适合熟悉玩法。',
    cols: 11,
    rows: 14,
    routes: [
      [
        [1, 0],
        [1, 3],
        [9, 3],
        [9, 7],
        [1, 7],
        [1, 11],
        [9, 11],
        [9, 13],
      ],
    ],
  },
  {
    id: 'twin',
    name: '双路汇流',
    desc: '两个入口双线进攻，中段汇合，需要兼顾两路火力。',
    cols: 13,
    rows: 14,
    routes: [
      [
        [2, 0],
        [2, 5],
        [6, 5],
        [6, 13],
      ],
      [
        [10, 0],
        [10, 9],
        [6, 9],
        [6, 13],
      ],
    ],
  },
];

/** 经过计算的地图布局：路面格、可建格、世界坐标路径等 */
export interface MapLayout {
  def: MapDef;
  road: Set<string>;
  build: Set<string>;
  /** 每条地面路线的世界坐标路径点 */
  paths: THREE.Vector3[][];
  /** 每条路线对应的飞行直线路径（出生点直飞终点） */
  flyPaths: THREE.Vector3[][];
  end: THREE.Vector3;
  spawns: THREE.Vector3[];
}

export const cellKey = (c: number, r: number) => `${c},${r}`;

export function cellToWorld(def: MapDef, c: number, r: number, y = 0): THREE.Vector3 {
  return new THREE.Vector3(c - def.cols / 2 + 0.5, y, r - def.rows / 2 + 0.5);
}

export function worldToCell(def: MapDef, p: THREE.Vector3): [number, number] {
  return [Math.floor(p.x + def.cols / 2), Math.floor(p.z + def.rows / 2)];
}

export function computeLayout(def: MapDef): MapLayout {
  const road = new Set<string>();
  for (const route of def.routes) {
    for (let i = 0; i < route.length - 1; i++) {
      const [c0, r0] = route[i];
      const [c1, r1] = route[i + 1];
      const dc = Math.sign(c1 - c0);
      const dr = Math.sign(r1 - r0);
      let c = c0;
      let r = r0;
      road.add(cellKey(c, r));
      while (c !== c1 || r !== r1) {
        c += dc;
        r += dr;
        road.add(cellKey(c, r));
      }
    }
  }

  // 可建格位：紧邻路面（8 邻域）的非路面格
  const build = new Set<string>();
  for (let c = 0; c < def.cols; c++) {
    for (let r = 0; r < def.rows; r++) {
      if (road.has(cellKey(c, r))) continue;
      outer: for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (road.has(cellKey(c + dc, r + dr))) {
            build.add(cellKey(c, r));
            break outer;
          }
        }
      }
    }
  }

  const paths = def.routes.map((route) => route.map(([c, r]) => cellToWorld(def, c, r, 0.25)));
  const end = paths[0][paths[0].length - 1].clone();
  const spawns = paths.map((p) => p[0].clone());
  const flyPaths = spawns.map((s) => [s.clone().setY(1.8), end.clone().setY(1.8)]);

  return { def, road, build, paths, flyPaths, end, spawns };
}
