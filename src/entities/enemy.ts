import * as THREE from 'three';
import { makeEnemyMesh, makeHpBar, type EnemyKind } from '../render/models';

export interface EnemyStats {
  kind: EnemyKind;
  baseHp: number;
  speed: number; // 每秒世界单位
  reward: number;
  flying: boolean;
  hpBarWidth: number;
}

export const ENEMY_STATS: Record<EnemyKind, EnemyStats> = {
  normal: { kind: 'normal', baseHp: 42, speed: 1.35, reward: 8, flying: false, hpBarWidth: 0.5 },
  fast: { kind: 'fast', baseHp: 26, speed: 2.5, reward: 9, flying: false, hpBarWidth: 0.5 },
  tank: { kind: 'tank', baseHp: 135, speed: 0.9, reward: 16, flying: false, hpBarWidth: 0.7 },
  fly: { kind: 'fly', baseHp: 60, speed: 1.7, reward: 14, flying: true, hpBarWidth: 0.6 },
  boss: { kind: 'boss', baseHp: 900, speed: 0.72, reward: 120, flying: false, hpBarWidth: 1.0 },
};

export class Enemy {
  stats: EnemyStats;
  group: THREE.Group;
  hp: number;
  maxHp: number;
  reward: number;
  path: THREE.Vector3[];
  segment = 0;
  segT = 0;
  reachedEnd = false;
  dead = false;
  /** 减速：剩余时间与倍率 */
  slowTimer = 0;
  slowFactor = 1;
  private hpBar: { group: THREE.Group; set: (r: number) => void };
  private spinNodes: THREE.Object3D[] = [];

  constructor(stats: EnemyStats, hpMul: number, speedMul: number, path: THREE.Vector3[]) {
    this.stats = stats;
    this.maxHp = stats.baseHp * hpMul;
    this.hp = this.maxHp;
    this.reward = stats.reward;
    this.path = path;
    this.speed = stats.speed * speedMul;

    this.group = new THREE.Group();
    const model = makeEnemyMesh(stats.kind);
    this.group.add(model);
    model.traverse((o) => {
      if (o.name === 'spin') this.spinNodes.push(o);
    });

    this.hpBar = makeHpBar(stats.hpBarWidth);
    this.hpBar.group.position.y = stats.kind === 'boss' ? 1.6 : 1.0;
    this.group.add(this.hpBar.group);

    this.group.position.copy(path[0]);
  }

  private speed: number;

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  takeDamage(dmg: number): number {
    if (this.dead) return 0;
    const before = this.hp;
    this.hp -= dmg;
    this.hpBar.set(this.hp / this.maxHp);
    if (this.hp <= 0) {
      this.dead = true;
      return before; // 溢出伤害不影响，返回实际造成
    }
    return dmg;
  }

  applySlow(factor: number, duration: number) {
    // 取更强的减速；刷新持续时间
    if (factor < this.slowFactor || this.slowTimer <= 0) this.slowFactor = factor;
    this.slowTimer = Math.max(this.slowTimer, duration);
  }

  update(dt: number) {
    if (this.dead || this.reachedEnd) return;

    if (this.slowTimer > 0) {
      this.slowTimer -= dt;
      if (this.slowTimer <= 0) this.slowFactor = 1;
    }

    let move = this.speed * this.slowFactor * dt;
    while (move > 0 && this.segment < this.path.length - 1) {
      const a = this.path[this.segment];
      const b = this.path[this.segment + 1];
      const segLen = a.distanceTo(b);
      const remain = segLen * (1 - this.segT);
      if (move < remain) {
        this.segT += move / segLen;
        move = 0;
      } else {
        move -= remain;
        this.segment++;
        this.segT = 0;
      }
    }

    if (this.segment >= this.path.length - 1) {
      this.reachedEnd = true;
      this.group.position.copy(this.path[this.path.length - 1]);
      return;
    }

    const a = this.path[this.segment];
    const b = this.path[this.segment + 1];
    const pos = a.clone().lerp(b, this.segT);
    this.group.position.copy(pos);

    // 朝向前进方向
    const dir = b.clone().sub(a);
    if (dir.lengthSq() > 0.0001) {
      this.group.rotation.y = Math.atan2(dir.x, dir.z);
    }

    for (const n of this.spinNodes) n.rotation.y += dt * 4;
    // 减速时染上冰蓝色调（通过缩放血条不做，简单起见跳过着色）
  }
}
