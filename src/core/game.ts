import * as THREE from 'three';
import { CameraRig } from '../render/camera';
import { buildTerrain, mat } from '../render/models';
import { cellKey, cellToWorld, computeLayout, worldToCell, type MapDef, type MapLayout } from '../maps/maps';
import { Enemy } from '../entities/enemy';
import { Projectile } from '../entities/projectile';
import { Tower, TOWER_DEFS, buildCost } from '../entities/tower';
import type { EnemyKind, TowerKind } from '../render/models';
import { buildWave, type WaveDef, type SpawnItem } from './wave';
import { DIFFICULTIES, TOTAL_WAVES, waveBonus, waveGoldScale, type Difficulty } from './economy';
import { pickReward, type RewardPick } from './rewards';
import { Hud } from '../ui/hud';
import { recordEndless, recordResult } from './save';
import { Sfx } from '../audio';

/** 敌人被击杀时迸溅碎片的颜色 */
const KILL_COLOR: Record<EnemyKind, number> = {
  normal: 0x7cb342,
  fast: 0xffa726,
  tank: 0x78909c,
  fly: 0xab47bc,
  boss: 0xc62828,
};

type Phase = 'prep' | 'wave' | 'over';

/** 生成竖直渐变的天空贴图，避免大片纯黑背景 */
function makeSkyTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#25506e');
  g.addColorStop(0.55, '#16283a');
  g.addColorStop(1, '#0d1620');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 4, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export interface GameResult {
  won: boolean;
  wave: number;
  newRecord: boolean;
}

/** 一整局战斗。挂载到给定容器，负责渲染循环、交互与规则。 */
export class Battle {
  private scene = new THREE.Scene();
  private renderer: THREE.WebGLRenderer;
  private rig: CameraRig;
  private hud: Hud;
  private layout: MapLayout;
  private def: MapDef;
  private diff: Difficulty;

  private towers = new Map<string, Tower>();
  private enemies: Enemy[] = [];
  private projectiles: Projectile[] = [];
  private effects: { mesh: THREE.Mesh; life: number; max: number }[] = [];
  private particles: { mesh: THREE.Mesh; vel: THREE.Vector3; life: number; max: number; scale0: number }[] = [];
  private sparkGeo = new THREE.TetrahedronGeometry(0.07, 0);
  private endless: boolean;

  private gold: number;
  private lives: number;
  private maxLives: number;
  private globalDamageMul = 1;
  private wave = 0;
  private phase: Phase = 'prep';
  private paused = false;
  private speed = 1;

  private pendingSpawns: SpawnItem[] = [];
  private waveTimer = 0;
  private curWave: WaveDef | null = null;

  private selectedCell: string | null = null;
  private rangeRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();
  private clock = new THREE.Clock();
  private running = true;
  private onFinish: (r: GameResult) => void;

  constructor(
    container: HTMLElement,
    def: MapDef,
    diff: Difficulty,
    endless: boolean,
    onFinish: (r: GameResult) => void,
  ) {
    this.def = def;
    this.diff = diff;
    this.endless = endless;
    this.onFinish = onFinish;
    this.layout = computeLayout(def);
    const d = DIFFICULTIES[diff];
    this.gold = d.startGold;
    this.lives = d.lives;
    this.maxLives = d.lives;

    // 渲染器（PBR 色调映射 + 实时阴影）
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setClearColor(0x0f1720);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    // 灯光与天空
    this.scene.background = makeSkyTexture();
    this.scene.fog = new THREE.Fog(0x1b3145, 30, 60);
    const hemi = new THREE.HemisphereLight(0xcfe4ff, 0x2b3a2a, 0.75);
    this.scene.add(hemi);
    const ambient = new THREE.AmbientLight(0xffffff, 0.15);
    this.scene.add(ambient);
    // 主光（太阳）：暖白 + 柔和阴影
    const sun = new THREE.DirectionalLight(0xfff2df, 2.0);
    sun.position.set(10, 20, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.radius = 4;
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
    const sc = sun.shadow.camera;
    const span = Math.max(this.layout.def.cols, this.layout.def.rows) * 0.72 + 6;
    sc.left = -span;
    sc.right = span;
    sc.top = span;
    sc.bottom = -span;
    sc.near = 1;
    sc.far = 80;
    this.scene.add(sun);
    this.scene.add(sun.target);

    // 地形
    this.scene.add(buildTerrain(this.layout));

    // 射程指示圈
    this.rangeRing = new THREE.Mesh(
      new THREE.RingGeometry(0.95, 1, 40),
      new THREE.MeshBasicMaterial({ color: 0x40c4ff, transparent: true, opacity: 0.35, side: THREE.DoubleSide }),
    );
    this.rangeRing.rotation.x = -Math.PI / 2;
    this.rangeRing.visible = false;
    this.scene.add(this.rangeRing);

    // 相机与交互
    this.rig = new CameraRig(window.innerWidth / window.innerHeight, this.renderer.domElement, def.cols, def.rows);
    this.rig.focus(new THREE.Vector3(0, 0, 0));
    this.rig.onTap = (x, y) => this.handleTap(x, y);

    // HUD
    this.hud = new Hud({
      onStartWave: () => this.startWave(),
      onSpeedToggle: () => this.toggleSpeed(),
      onPauseToggle: () => this.togglePause(),
      onBuild: (k) => this.build(k),
      onUpgrade: () => this.upgradeSelected(),
      onSell: () => this.sellSelected(),
    });
    container.appendChild(this.hud.root);
    this.refreshHud();
    this.hud.setWaveButton('▶ 开始第 1 波', true);

    window.addEventListener('resize', this.onResize);
    this.loop();
  }

  private onResize = () => {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.rig.resize(window.innerWidth / window.innerHeight);
  };

  private refreshHud() {
    this.hud.setStats(this.lives, Math.floor(this.gold), this.wave, this.endless ? -1 : TOTAL_WAVES);
  }

  // ---------------------------------------------------------------- 交互
  private handleTap(clientX: number, clientY: number) {
    if (this.hud.radialOpen() || this.hud.panelOpen()) {
      this.hud.closeAll();
      this.selectedCell = null;
      this.rangeRing.visible = false;
      return;
    }
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.rig.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;

    const [c, r] = worldToCell(this.def, hit);
    const key = cellKey(c, r);
    if (c < 0 || r < 0 || c >= this.def.cols || r >= this.def.rows) return;

    const existing = this.towers.get(key);
    if (existing) {
      this.selectedCell = key;
      this.showRange(existing);
      this.hud.openTowerPanel(existing, this.gold);
    } else if (this.layout.build.has(key)) {
      this.selectedCell = key;
      this.rangeRing.visible = false;
      this.hud.openRadial(clientX, clientY, this.gold);
    }
  }

  private showRange(t: Tower) {
    this.rangeRing.visible = true;
    this.rangeRing.position.set(t.group.position.x, 0.3, t.group.position.z);
    this.rangeRing.scale.setScalar(t.stats.range);
  }

  private build(kind: TowerKind) {
    if (!this.selectedCell) return;
    const cost = buildCost(kind);
    if (this.gold < cost || this.towers.has(this.selectedCell)) return;
    const [c, r] = this.selectedCell.split(',').map(Number);
    const pos = cellToWorld(this.def, c, r, 0.35);
    const tower = new Tower(TOWER_DEFS[kind], pos, this.selectedCell);
    this.scene.add(tower.group);
    this.towers.set(this.selectedCell, tower);
    this.gold -= cost;
    this.refreshHud();
    Sfx.build();
    this.hud.showToast(`建造 ${TOWER_DEFS[kind].name}`);
  }

  private upgradeSelected() {
    if (!this.selectedCell) return;
    const t = this.towers.get(this.selectedCell);
    if (!t || t.maxLevel) return;
    const cost = t.upgradeCost();
    if (this.gold < cost) return;
    this.gold -= cost;
    t.upgrade();
    this.refreshHud();
    Sfx.upgrade();
    this.showRange(t);
    this.hud.openTowerPanel(t, this.gold);
    this.hud.showToast(`升级至 ${t.level} 级`);
  }

  private sellSelected() {
    if (!this.selectedCell) return;
    const t = this.towers.get(this.selectedCell);
    if (!t) return;
    this.gold += t.sellValue();
    this.scene.remove(t.group);
    this.towers.delete(this.selectedCell);
    this.selectedCell = null;
    this.rangeRing.visible = false;
    this.hud.closeAll();
    Sfx.sell();
    this.refreshHud();
  }

  // ---------------------------------------------------------------- 波次
  private startWave() {
    if (this.phase === 'wave' || this.phase === 'over') return;
    this.wave++;
    this.curWave = buildWave(this.wave, this.layout.paths.length);
    this.pendingSpawns = [...this.curWave.items];
    this.waveTimer = 0;
    this.phase = 'wave';
    this.hud.setWaveButton('进攻中…', false);
    this.hud.showToast(this.curWave.isBoss ? `⚠ 第 ${this.wave} 波 · BOSS 来袭` : `第 ${this.wave} 波开始`);
    if (this.curWave.isBoss) Sfx.boss();
    else Sfx.waveStart();
    this.refreshHud();
  }

  private spawnEnemy(item: SpawnItem) {
    const d = DIFFICULTIES[this.diff];
    const path = item.stats.flying
      ? this.layout.flyPaths[item.routeIndex % this.layout.flyPaths.length]
      : this.layout.paths[item.routeIndex % this.layout.paths.length];
    const hpMul = d.hpMul * (this.curWave?.hpScale ?? 1);
    const e = new Enemy(item.stats, hpMul, d.speedMul, path);
    this.scene.add(e.group);
    this.enemies.push(e);
  }

  private toggleSpeed() {
    this.speed = this.speed === 1 ? 2 : 1;
    this.hud.setSpeed(this.speed);
  }

  private togglePause() {
    this.paused = !this.paused;
    this.hud.setPaused(this.paused);
  }

  // ---------------------------------------------------------------- 主循环
  private loop = () => {
    if (!this.running) return;
    requestAnimationFrame(this.loop);
    let dt = this.clock.getDelta();
    dt = Math.min(dt, 0.05); // 防止后台切回时跳变
    if (!this.paused && this.phase !== 'over') {
      const steps = this.speed;
      for (let i = 0; i < steps; i++) this.step(dt);
    }
    this.renderer.render(this.scene, this.rig.camera);
  };

  private step(dt: number) {
    // 出怪调度
    if (this.phase === 'wave' && this.curWave) {
      this.waveTimer += dt;
      while (this.pendingSpawns.length && this.pendingSpawns[0].time <= this.waveTimer) {
        this.spawnEnemy(this.pendingSpawns.shift()!);
      }
    }

    // 敌人
    for (const e of this.enemies) {
      e.update(dt);
      if (e.reachedEnd && !e.dead) {
        e.dead = true;
        this.lives -= e.stats.kind === 'boss' ? 10 : 1;
        this.scene.remove(e.group);
        Sfx.loseLife();
        this.refreshHud();
        if (this.lives <= 0) {
          this.lives = 0;
          this.endGame(false);
          return;
        }
      }
    }

    // 塔开火
    for (const t of this.towers.values()) {
      const p = t.update(dt, this.enemies);
      if (p) {
        p.damage *= this.globalDamageMul; // 应用全局增伤奖励
        this.playFireSound(t.def.kind);
        this.scene.add(p.mesh);
        this.projectiles.push(p);
      }
    }

    // 弹体
    for (const p of this.projectiles) {
      const hits = p.update(dt);
      if (hits) this.resolveHit(p, hits);
    }

    // 清理
    this.enemies = this.enemies.filter((e) => {
      if (e.dead) {
        this.scene.remove(e.group);
        return false;
      }
      return true;
    });
    this.projectiles = this.projectiles.filter((p) => {
      if (p.done) {
        this.scene.remove(p.mesh);
        return false;
      }
      return true;
    });

    // 特效衰减
    this.effects = this.effects.filter((fx) => {
      fx.life -= dt;
      const k = fx.life / fx.max;
      fx.mesh.scale.setScalar(1 + (1 - k) * 2.2);
      (fx.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, k) * 0.6;
      if (fx.life <= 0) {
        this.scene.remove(fx.mesh);
        fx.mesh.geometry.dispose();
        return false;
      }
      return true;
    });

    // 命中/死亡碎片：抛物飞散并逐渐缩小
    this.particles = this.particles.filter((pt) => {
      pt.life -= dt;
      pt.vel.y -= 7 * dt;
      pt.mesh.position.addScaledVector(pt.vel, dt);
      pt.mesh.rotation.x += dt * 9;
      pt.mesh.rotation.y += dt * 7;
      pt.mesh.scale.setScalar(Math.max(0.01, pt.scale0 * (pt.life / pt.max)));
      if (pt.life <= 0) {
        this.scene.remove(pt.mesh);
        return false;
      }
      return true;
    });

    // 波次结束判定
    if (this.phase === 'wave' && this.pendingSpawns.length === 0 && this.enemies.length === 0) {
      this.finishWave();
    }
  }

  private resolveHit(p: Projectile, primary: Enemy[]) {
    const applyOne = (e: Enemy, dmg: number) => {
      if (e.dead) return;
      e.takeDamage(dmg);
      if (p.slowFactor < 1) e.applySlow(p.slowFactor, p.slowDuration);
      if (e.dead) {
        this.gold += Math.round(e.reward * DIFFICULTIES[this.diff].goldMul * waveGoldScale(this.wave));
        this.spawnDeath(e.position, KILL_COLOR[e.stats.kind], e.stats.kind === 'boss');
        Sfx.kill();
      } else {
        this.spawnSpark(p.position, p.slowFactor < 1 ? 0x81d4fa : 0xfff59d, 3);
      }
    };

    if (p.splash > 0) {
      // 溅射：命中点周围范围内全体
      const center = p.position;
      const rSq = p.splash * p.splash;
      for (const e of this.enemies) {
        if (e.dead || e.stats.flying) continue;
        const dx = e.position.x - center.x;
        const dz = e.position.z - center.z;
        if (dx * dx + dz * dz <= rSq) applyOne(e, p.damage);
      }
      this.spawnBlast(center, p.splash);
    } else {
      for (const e of primary) applyOne(e, p.damage);
    }
    this.refreshHud();
  }

  private spawnBlast(pos: THREE.Vector3, radius: number) {
    const m = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.4, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xff8a65, transparent: true, opacity: 0.6 }),
    );
    m.position.copy(pos);
    this.scene.add(m);
    this.effects.push({ mesh: m, life: 0.28, max: 0.28 });
  }

  private playFireSound(kind: TowerKind) {
    if (kind === 'arrow') Sfx.fireArrow();
    else if (kind === 'cannon') Sfx.fireCannon();
    else if (kind === 'frost') Sfx.fireFrost();
    else Sfx.fireBolt();
  }

  /** 命中火花：几片小碎片朝上迸溅 */
  private spawnSpark(pos: THREE.Vector3, color: number, count: number) {
    if (this.particles.length > 150) return;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat(color));
      m.position.set(pos.x, Math.max(0.3, pos.y), pos.z);
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8 + 0.3, Math.random() - 0.5).multiplyScalar(2.4);
      this.scene.add(m);
      this.particles.push({ mesh: m, vel, life: 0.32, max: 0.32, scale0: 1 });
    }
  }

  /** 死亡爆碎：更多碎片四散，Boss 更夸张 */
  private spawnDeath(pos: THREE.Vector3, color: number, big: boolean) {
    if (this.particles.length > 150) return;
    const count = big ? 16 : 7;
    const speed = big ? 4.2 : 2.8;
    const s0 = big ? 1.6 : 1;
    for (let i = 0; i < count; i++) {
      const m = new THREE.Mesh(this.sparkGeo, mat(color));
      m.position.set(pos.x, pos.y + 0.3, pos.z);
      const vel = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.9 + 0.2, Math.random() - 0.5)
        .normalize()
        .multiplyScalar(speed * (0.6 + Math.random() * 0.6));
      this.scene.add(m);
      this.particles.push({ mesh: m, vel, life: big ? 0.7 : 0.5, max: big ? 0.7 : 0.5, scale0: s0 });
    }
  }

  private finishWave() {
    const bonus = Math.round(waveBonus(this.wave) * DIFFICULTIES[this.diff].goldMul);
    this.gold += bonus;
    this.phase = 'prep';
    this.curWave = null;

    if (!this.endless && this.wave >= TOTAL_WAVES) {
      this.refreshHud();
      this.endGame(true);
      return;
    }

    // 随机奖励
    const reward = pickReward({
      wave: this.wave,
      goldMul: DIFFICULTIES[this.diff].goldMul,
      currentGold: this.gold,
      livesDeficit: this.maxLives - this.lives,
      canUpgrade: [...this.towers.values()].some((t) => !t.maxLevel),
    });
    this.applyReward(reward);

    this.refreshHud();
    this.hud.setWaveButton(`▶ 开始第 ${this.wave + 1} 波`, true);
    Sfx.reward();
    this.hud.showReward(bonus, reward);
  }

  private applyReward(r: RewardPick) {
    switch (r.kind) {
      case 'gold':
      case 'treasure':
      case 'interest':
        this.gold += r.amount;
        break;
      case 'repair':
        this.lives = Math.min(this.maxLives, this.lives + r.amount);
        break;
      case 'damage':
        this.globalDamageMul += r.amount;
        break;
      case 'upgrade':
        this.upgradeRandomTower();
        break;
    }
  }

  private upgradeRandomTower() {
    const candidates = [...this.towers.values()].filter((t) => !t.maxLevel);
    if (!candidates.length) return;
    const t = candidates[Math.floor(Math.random() * candidates.length)];
    t.upgrade();
    // 若正打开该塔面板，刷新显示
    if (this.selectedCell === t.cell) {
      this.showRange(t);
      this.hud.openTowerPanel(t, this.gold);
    }
  }

  private endGame(won: boolean) {
    this.phase = 'over';
    let record = false;
    if (this.endless) {
      record = recordEndless(this.def.id, this.diff, this.wave);
    } else {
      recordResult(this.def.id, this.diff, this.wave, won);
    }
    this.hud.closeAll();
    this.hud.setWaveButton(won ? '全部通关！' : '基地失守', false);
    if (won) Sfx.victory();
    else Sfx.defeat();
    // 稍作延迟，让玩家看清最后一刻
    setTimeout(() => this.onFinish({ won, wave: this.wave, newRecord: record }), won ? 900 : 700);
  }

  dispose() {
    this.running = false;
    window.removeEventListener('resize', this.onResize);
    this.rig.dispose();
    this.hud.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    this.sparkGeo.dispose();
    void mat; // 共享材质缓存跨局复用，无需释放
  }
}
