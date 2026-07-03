import * as THREE from 'three';
import { mat } from '../render/models';
import type { Enemy } from './enemy';

export interface ProjectileOpts {
  from: THREE.Vector3;
  target: Enemy;
  speed: number;
  damage: number;
  color: number;
  /** 溅射半径（0 为单体） */
  splash?: number;
  /** 命中减速：倍率与持续 */
  slowFactor?: number;
  slowDuration?: number;
  /** 闪电为瞬发直线，非抛射 */
  instant?: boolean;
}

export class Projectile {
  mesh: THREE.Object3D;
  target: Enemy;
  speed: number;
  damage: number;
  splash: number;
  slowFactor: number;
  slowDuration: number;
  done = false;
  private pos: THREE.Vector3;

  constructor(opts: ProjectileOpts) {
    this.target = opts.target;
    this.speed = opts.speed;
    this.damage = opts.damage;
    this.splash = opts.splash ?? 0;
    this.slowFactor = opts.slowFactor ?? 1;
    this.slowDuration = opts.slowDuration ?? 0;
    this.pos = opts.from.clone();

    const m = new THREE.Mesh(new THREE.SphereGeometry(this.splash > 0 ? 0.16 : 0.1, 8, 6), mat(opts.color));
    m.position.copy(this.pos);
    this.mesh = m;
  }

  /** 返回命中的敌人列表（供外层结算伤害与减速），未命中返回 null */
  update(dt: number): Enemy[] | null {
    if (this.done) return null;
    if (this.target.dead || this.target.reachedEnd) {
      // 目标没了：飞向最后已知位置直至到达再消失
      this.done = true;
      return null;
    }
    const tp = this.target.position.clone().setY(0.5);
    const dir = tp.clone().sub(this.pos);
    const dist = dir.length();
    const step = this.speed * dt;
    if (dist <= step + 0.15) {
      this.pos.copy(tp);
      this.mesh.position.copy(this.pos);
      this.done = true;
      return [this.target];
    }
    dir.normalize();
    this.pos.addScaledVector(dir, step);
    this.mesh.position.copy(this.pos);
    return null;
  }

  get position(): THREE.Vector3 {
    return this.pos;
  }
}
