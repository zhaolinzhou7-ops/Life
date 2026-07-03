import * as THREE from 'three';
import { makeTowerMesh, type TowerKind } from '../render/models';
import { Projectile } from './projectile';
import type { Enemy } from './enemy';

export interface TowerLevelStats {
  damage: number;
  range: number;
  fireRate: number; // 每秒射击次数
  cost: number; // 升到该级的花费（1 级为建造价）
}

export interface TowerDef {
  kind: TowerKind;
  name: string;
  desc: string;
  color: number;
  projectileColor: number;
  projectileSpeed: number;
  splash: number;
  slowFactor: number; // 1 = 无减速
  slowDuration: number;
  canHitFlying: boolean;
  levels: TowerLevelStats[];
}

export const TOWER_DEFS: Record<TowerKind, TowerDef> = {
  arrow: {
    kind: 'arrow',
    name: '箭塔',
    desc: '攻速快、单体输出，性价比高的基础塔。',
    color: 0x8d6e63,
    projectileColor: 0xfff59d,
    projectileSpeed: 14,
    splash: 0,
    slowFactor: 1,
    slowDuration: 0,
    canHitFlying: true,
    levels: [
      { damage: 12, range: 2.6, fireRate: 1.6, cost: 80 },
      { damage: 22, range: 2.9, fireRate: 1.9, cost: 70 },
      { damage: 40, range: 3.3, fireRate: 2.2, cost: 130 },
    ],
  },
  cannon: {
    kind: 'cannon',
    name: '炮塔',
    desc: '范围溅射，克制密集的小怪群，不能打飞行兵。',
    color: 0x546e7a,
    projectileColor: 0xff8a65,
    projectileSpeed: 9,
    splash: 1.1,
    slowFactor: 1,
    slowDuration: 0,
    canHitFlying: false,
    levels: [
      { damage: 20, range: 2.4, fireRate: 0.8, cost: 120 },
      { damage: 36, range: 2.7, fireRate: 0.9, cost: 110 },
      { damage: 62, range: 3.0, fireRate: 1.0, cost: 190 },
    ],
  },
  frost: {
    kind: 'frost',
    name: '冰霜塔',
    desc: '命中减速敌人，控制型，配合输出塔效果拔群。',
    color: 0x4fc3f7,
    projectileColor: 0x81d4fa,
    projectileSpeed: 12,
    splash: 0,
    slowFactor: 0.55,
    slowDuration: 1.6,
    canHitFlying: true,
    levels: [
      { damage: 7, range: 2.5, fireRate: 1.3, cost: 100 },
      { damage: 12, range: 2.8, fireRate: 1.5, cost: 90 },
      { damage: 20, range: 3.1, fireRate: 1.7, cost: 160 },
    ],
  },
  bolt: {
    kind: 'bolt',
    name: '闪电塔',
    desc: '高伤害、攻速慢，专治重甲兵和 Boss 等高血目标。',
    color: 0x5c6bc0,
    projectileColor: 0xfff176,
    projectileSpeed: 22,
    splash: 0,
    slowFactor: 1,
    slowDuration: 0,
    canHitFlying: true,
    levels: [
      { damage: 55, range: 3.0, fireRate: 0.6, cost: 160 },
      { damage: 95, range: 3.3, fireRate: 0.7, cost: 150 },
      { damage: 165, range: 3.6, fireRate: 0.8, cost: 250 },
    ],
  },
};

export const TOWER_ORDER: TowerKind[] = ['arrow', 'cannon', 'frost', 'bolt'];

export function buildCost(kind: TowerKind): number {
  return TOWER_DEFS[kind].levels[0].cost;
}

export class Tower {
  def: TowerDef;
  level = 1; // 1..3
  group: THREE.Group;
  cell: string;
  private modelHolder: THREE.Group;
  private turret: THREE.Group | null = null;
  private cooldown = 0;
  private spinNodes: THREE.Object3D[] = [];
  /** 累计投入（用于计算出售返还） */
  invested: number;

  constructor(def: TowerDef, position: THREE.Vector3, cell: string) {
    this.def = def;
    this.cell = cell;
    this.invested = def.levels[0].cost;
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.modelHolder = new THREE.Group();
    this.group.add(this.modelHolder);
    this.rebuildModel();
  }

  private rebuildModel() {
    this.modelHolder.clear();
    this.spinNodes = [];
    const m = makeTowerMesh(this.def.kind, this.level);
    this.turret = m;
    m.traverse((o) => {
      if (o.name === 'spin') this.spinNodes.push(o);
    });
    this.modelHolder.add(m);
  }

  get stats(): TowerLevelStats {
    return this.def.levels[this.level - 1];
  }

  get maxLevel(): boolean {
    return this.level >= this.def.levels.length;
  }

  upgradeCost(): number {
    if (this.maxLevel) return 0;
    return this.def.levels[this.level].cost;
  }

  upgrade() {
    if (this.maxLevel) return;
    this.invested += this.def.levels[this.level].cost;
    this.level++;
    this.rebuildModel();
  }

  /** 出售返还 60% */
  sellValue(): number {
    return Math.floor(this.invested * 0.6);
  }

  canTarget(e: Enemy): boolean {
    if (e.stats.flying && !this.def.canHitFlying) return false;
    return true;
  }

  /**
   * 尝试开火。命中则返回新弹体，否则 null。
   * enemies 用于选取射程内最靠近终点的目标。
   */
  update(dt: number, enemies: Enemy[]): Projectile | null {
    for (const n of this.spinNodes) n.rotation.y += dt * 3;
    this.cooldown -= dt;

    // 选目标：射程内、可攻击、进度最靠前的
    const rangeSq = this.stats.range * this.stats.range;
    let best: Enemy | null = null;
    let bestProgress = -1;
    for (const e of enemies) {
      if (e.dead || e.reachedEnd || !this.canTarget(e)) continue;
      const dx = e.position.x - this.group.position.x;
      const dz = e.position.z - this.group.position.z;
      if (dx * dx + dz * dz > rangeSq) continue;
      const prog = e.segment + e.segT;
      if (prog > bestProgress) {
        bestProgress = prog;
        best = e;
      }
    }

    if (best) {
      // 转向目标
      if (this.turret) {
        const dir = best.position.clone().sub(this.group.position);
        this.turret.rotation.y = Math.atan2(dir.x, dir.z);
      }
      if (this.cooldown <= 0) {
        this.cooldown = 1 / this.stats.fireRate;
        return new Projectile({
          from: this.group.position.clone().setY(0.9),
          target: best,
          speed: this.def.projectileSpeed,
          damage: this.stats.damage,
          color: this.def.projectileColor,
          splash: this.def.splash,
          slowFactor: this.def.slowFactor,
          slowDuration: this.def.slowDuration,
        });
      }
    }
    return null;
  }
}
