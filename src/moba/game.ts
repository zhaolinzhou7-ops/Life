/** MOBA 战斗引擎：世界模拟、战斗、敌方 AI、相机与 Canvas 渲染 */
import {
  BASE,
  COLORS,
  E_DIST,
  HERO,
  LAYOUT,
  MAX_LEVEL,
  MIN_ATTACK_INTERVAL,
  MINION,
  PASSIVE_GOLD,
  Q_RADIUS,
  Q_RANGE,
  Q_SPEED,
  R_RADIUS,
  R_RANGE,
  SHOP,
  SHOP_RANGE,
  SKILLS,
  SPAWN,
  START_GOLD,
  TOWER,
  W_RADIUS,
  W_SLOW,
  W_SLOW_TIME,
  WORLD,
  XP_TABLE,
  skillDamage,
  type Team,
  type Vec,
} from './config';
import type { Controls } from './input';

type Kind = 'hero' | 'minion' | 'tower' | 'base';

interface Unit {
  kind: Kind;
  team: Team;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  radius: number;
  dead: boolean;
}

interface Minion extends Unit {
  kind: 'minion';
  atkCd: number;
  slowTimer: number;
  slowAmt: number;
  swing: number; // 攻击动画 0..1
  seed: number; // 用于个体差异（走路相位等）
}

interface Structure extends Unit {
  kind: 'tower' | 'base';
  atkCd: number;
  order: number; // 0 = 最靠近中路，最先可被攻击
  label: string;
}

interface Hero extends Unit {
  kind: 'hero';
  isPlayer: boolean;
  mana: number;
  maxMana: number;
  level: number;
  xp: number;
  atkCd: number;
  faceX: number;
  faceY: number;
  moveX: number;
  moveY: number;
  cd: Record<string, number>;
  respawn: number;
  slowTimer: number;
  slowAmt: number;
  kills: number;
  deaths: number;
  up: { atk: number; hp: number; as: number; ms: number };
  swing: number; // 攻击挥砍动画 0..1
  walk: number; // 走路相位累积
}

interface Projectile {
  x: number;
  y: number;
  team: Team;
  dmg: number;
  radius: number;
  color: string;
  source: Hero | null;
  // 追踪弹
  target?: Unit;
  speed?: number;
  // 直线弹
  vx?: number;
  vy?: number;
  range?: number;
  traveled?: number;
  pierce?: boolean;
  hit?: Set<Unit>;
}

interface FloatText {
  x: number;
  y: number;
  vy: number;
  life: number;
  text: string;
  color: string;
  size: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

interface Ring {
  x: number;
  y: number;
  life: number;
  max: number;
  r: number;
  color: string;
}

export interface MobaResult {
  won: boolean;
  time: number;
}

const XP_RANGE = 560;

function len(x: number, y: number): number {
  return Math.hypot(x, y);
}

export class MobaGame {
  player: Hero;
  enemy: Hero;
  minions: Minion[] = [];
  structures: Structure[] = [];
  private projectiles: Projectile[] = [];
  private floats: FloatText[] = [];
  private particles: Particle[] = [];
  private rings: Ring[] = [];

  gold = START_GOLD;
  time = 0;
  over = false;
  private ended = false;
  shopMsg = '';

  private waveTimer: Record<Team, number> = { ally: 3, enemy: 3 };
  private pending: Record<Team, number> = { ally: 0, enemy: 0 };
  private spawnTimer: Record<Team, number> = { ally: 0, enemy: 0 };

  private cam = { x: LAYOUT.allyT1.x, y: LAYOUT.allyT1.y };

  constructor(private onEnd: (r: MobaResult) => void) {
    this.buildStructures();
    this.player = this.makeHero('ally', true);
    this.enemy = this.makeHero('enemy', false);
    this.cam.x = this.player.x;
    this.cam.y = this.player.y;
  }

  private buildStructures() {
    const mk = (
      team: Team,
      kind: 'tower' | 'base',
      p: Vec,
      order: number,
      label: string,
    ): Structure => ({
      kind,
      team,
      x: p.x,
      y: p.y,
      hp: kind === 'base' ? BASE.hp : TOWER.hp,
      maxHp: kind === 'base' ? BASE.hp : TOWER.hp,
      radius: kind === 'base' ? BASE.radius : TOWER.radius,
      dead: false,
      atkCd: 0,
      order,
      label,
    });
    this.structures.push(
      mk('enemy', 'tower', LAYOUT.enemyT1, 0, '一塔'),
      mk('enemy', 'tower', LAYOUT.enemyT2, 1, '二塔'),
      mk('enemy', 'base', LAYOUT.enemyBase, 2, '水晶'),
      mk('ally', 'tower', LAYOUT.allyT1, 0, '一塔'),
      mk('ally', 'tower', LAYOUT.allyT2, 1, '二塔'),
      mk('ally', 'base', LAYOUT.allyBase, 2, '水晶'),
    );
  }

  private makeHero(team: Team, isPlayer: boolean): Hero {
    const base = team === 'ally' ? LAYOUT.allyBase : LAYOUT.enemyBase;
    const faceY = team === 'ally' ? -1 : 1;
    const h: Hero = {
      kind: 'hero',
      team,
      isPlayer,
      x: base.x,
      y: base.y + (team === 'ally' ? -90 : 90),
      hp: HERO.hp,
      maxHp: HERO.hp,
      radius: HERO.radius,
      dead: false,
      mana: HERO.mana,
      maxMana: HERO.mana,
      level: 1,
      xp: 0,
      atkCd: 0,
      faceX: 0,
      faceY,
      moveX: 0,
      moveY: 0,
      cd: { Q: 0, W: 0, E: 0, R: 0 },
      respawn: 0,
      slowTimer: 0,
      slowAmt: 0,
      kills: 0,
      deaths: 0,
      up: { atk: 0, hp: 0, as: 0, ms: 0 },
      swing: 0,
      walk: 0,
    };
    return h;
  }

  // ---- 英雄派生数值 ----
  private heroDmg(h: Hero): number {
    return HERO.dmg + HERO.dmgPerLevel * (h.level - 1) + h.up.atk * 14;
  }
  private heroMaxHp(h: Hero): number {
    return HERO.hp + HERO.hpPerLevel * (h.level - 1) + h.up.hp * 130;
  }
  private heroMaxMana(h: Hero): number {
    return HERO.mana + HERO.manaPerLevel * (h.level - 1);
  }
  private heroInterval(h: Hero): number {
    return Math.max(MIN_ATTACK_INTERVAL, HERO.attackInterval - h.up.as * 0.05);
  }
  private heroSpeed(h: Hero): number {
    let s = HERO.speed + h.up.ms * 14;
    if (h.slowTimer > 0) s *= 1 - h.slowAmt;
    return s;
  }
  /** 重算最大生命/法力，增益部分同步补到当前值 */
  private refreshStats(h: Hero) {
    const nm = this.heroMaxHp(h);
    if (nm > h.maxHp) h.hp += nm - h.maxHp;
    h.maxHp = nm;
    const nmp = this.heroMaxMana(h);
    if (nmp > h.maxMana) h.mana += nmp - h.maxMana;
    h.maxMana = nmp;
  }

  // ================= 主循环 =================
  update(dt: number, controls: Controls) {
    if (this.over) return;
    this.time += dt;
    this.gold += PASSIVE_GOLD * dt;

    this.updateSpawns(dt);
    this.updateHeroInput(controls);
    this.updateEnemyAI();
    this.updateHeroes(dt);
    this.updateMinions(dt);
    this.updateStructures(dt);
    this.updateProjectiles(dt);
    this.updateFx(dt);

    // 相机跟随玩家
    const p = this.player;
    const tx = p.dead ? this.cam.x : p.x;
    const ty = p.dead ? this.cam.y : p.y;
    this.cam.x += (tx - this.cam.x) * Math.min(1, dt * 6);
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6);

    this.updateSkillUI(controls);
  }

  private updateSpawns(dt: number) {
    for (const team of ['ally', 'enemy'] as Team[]) {
      this.waveTimer[team] -= dt;
      if (this.waveTimer[team] <= 0) {
        this.waveTimer[team] = MINION.waveInterval;
        this.pending[team] += MINION.waveSize;
      }
      if (this.pending[team] > 0) {
        this.spawnTimer[team] -= dt;
        if (this.spawnTimer[team] <= 0) {
          this.spawnTimer[team] = MINION.waveGap;
          this.pending[team]--;
          this.spawnMinion(team);
        }
      }
    }
  }

  private spawnMinion(team: Team) {
    const s = SPAWN[team];
    const m: Minion = {
      kind: 'minion',
      team,
      x: s.x + (Math.random() * 60 - 30),
      y: s.y + (Math.random() * 30 - 15),
      hp: MINION.hp,
      maxHp: MINION.hp,
      radius: MINION.radius,
      dead: false,
      atkCd: 0,
      slowTimer: 0,
      slowAmt: 0,
      swing: 0,
      seed: Math.random() * Math.PI * 2,
    };
    this.minions.push(m);
  }

  // ---- 玩家输入 ----
  private updateHeroInput(controls: Controls) {
    const p = this.player;
    p.moveX = controls.move.x;
    p.moveY = controls.move.y;
    if (!p.dead) {
      for (const key of controls.consumeSkills()) this.castSkill(p, key);
    } else {
      controls.consumeSkills();
    }
  }

  // ---- 敌方 AI ----
  private updateEnemyAI() {
    const e = this.enemy;
    const p = this.player;
    if (e.dead) {
      e.moveX = 0;
      e.moveY = 0;
      return;
    }
    const towardBaseY = 1; // 敌方向下推进（玩家基地在下方）
    const hpFrac = e.hp / e.maxHp;
    const distToP = p.dead ? Infinity : len(p.x - e.x, p.y - e.y);
    const support = this.countNear(e.x, e.y, 260, 'enemy');
    const ownTower = this.frontStructure('enemy');

    let dx = 0;
    let dy = 0;

    if (hpFrac < 0.32 || (distToP < 220 && hpFrac < 0.5 && support === 0)) {
      // 撤退：朝己方（上方）基地/塔
      const ref = ownTower ?? this.baseOf('enemy');
      dx = ref.x - e.x;
      dy = ref.y - e.y - 40;
      if (!p.dead && e.cd.E <= 0 && distToP < 260) this.castSkill(e, 'E');
    } else if (
      !p.dead &&
      distToP < HERO.aggroRange &&
      (hpFrac >= p.hp / p.maxHp - 0.12 || support > 0)
    ) {
      // 交战：靠近玩家到攻击距离
      e.faceX = (p.x - e.x) / (distToP || 1);
      e.faceY = (p.y - e.y) / (distToP || 1);
      const desired = HERO.range * 0.85;
      if (distToP > desired) {
        dx = p.x - e.x;
        dy = p.y - e.y;
      } else if (distToP < desired * 0.6) {
        dx = e.x - p.x;
        dy = e.y - p.y;
      }
      // 释放技能
      if (e.cd.R <= 0 && e.level >= SKILLS.R.unlockLevel && distToP < R_RANGE && p.hp / p.maxHp < 0.55) {
        this.castSkill(e, 'R');
      }
      if (e.cd.W <= 0 && distToP < W_RADIUS * 0.9) this.castSkill(e, 'W');
      if (e.cd.Q <= 0 && distToP < Q_RANGE) this.castSkill(e, 'Q');
      if (e.cd.E <= 0 && distToP > desired * 1.4 && distToP < 320) this.castSkill(e, 'E');
    } else {
      // 推线：沿中线向玩家基地方向前进，攻击最近敌方结构/小兵
      const frontAlly = this.frontStructure('ally');
      const tgtY = frontAlly ? frontAlly.y - 60 : LAYOUT.allyBase.y;
      dx = LANEcenter - e.x;
      dy = towardBaseY * (tgtY - e.y);
      // 别越塔太深：如果领先小兵太远则等待
      const nearestAllyMinion = this.nearestMinion(e.x, e.y, 'ally', 260);
      if (!nearestAllyMinion && support === 0 && e.y > (frontAlly ? frontAlly.y - 220 : 0)) {
        dx = (frontAlly ? frontAlly.x : LANEcenter) - e.x;
        dy = -30; // 略微后撤等兵
      }
    }

    const l = len(dx, dy);
    if (l > 4) {
      e.moveX = dx / l;
      e.moveY = dy / l;
    } else {
      e.moveX = 0;
      e.moveY = 0;
    }
  }

  private countNear(x: number, y: number, r: number, team: Team): number {
    let n = 0;
    for (const m of this.minions) if (!m.dead && m.team === team && len(m.x - x, m.y - y) < r) n++;
    return n;
  }

  private baseOf(team: Team): Structure {
    return this.structures.find((s) => s.team === team && s.kind === 'base')!;
  }

  // ---- 英雄模拟 ----
  private updateHeroes(dt: number) {
    for (const h of [this.player, this.enemy]) {
      if (h.slowTimer > 0) h.slowTimer -= dt;
      if (h.swing > 0) h.swing = Math.max(0, h.swing - dt * 3.2);
      for (const k of Object.keys(h.cd)) if (h.cd[k] > 0) h.cd[k] -= dt;

      if (h.dead) {
        h.respawn -= dt;
        if (h.respawn <= 0) this.revive(h);
        continue;
      }

      // 再生
      h.hp = Math.min(h.maxHp, h.hp + HERO.hpRegen * dt);
      h.mana = Math.min(h.maxMana, h.mana + HERO.manaRegen * dt);

      // 移动
      const mv = len(h.moveX, h.moveY);
      if (mv > 0.18) {
        const sp = this.heroSpeed(h);
        const nx = h.moveX / mv;
        const ny = h.moveY / mv;
        h.x += nx * sp * dt;
        h.y += ny * sp * dt;
        h.faceX = nx;
        h.faceY = ny;
        h.walk += dt * 9;
      } else {
        // 静止时朝向最近敌人
        const t = this.basicTarget(h);
        if (t) {
          const d = len(t.x - h.x, t.y - h.y) || 1;
          h.faceX = (t.x - h.x) / d;
          h.faceY = (t.y - h.y) / d;
        }
      }
      this.clampToWorld(h);

      // 普攻
      if (h.atkCd > 0) h.atkCd -= dt;
      if (h.atkCd <= 0) {
        const t = this.basicTarget(h);
        if (t) {
          this.fireHoming(h.x, h.y, t, this.heroDmg(h), h, COLORS[h.team].light, HERO.projSpeed);
          h.atkCd = this.heroInterval(h);
          h.swing = 1;
          const d = len(t.x - h.x, t.y - h.y) || 1;
          h.faceX = (t.x - h.x) / d;
          h.faceY = (t.y - h.y) / d;
        }
      }
    }
  }

  private revive(h: Hero) {
    const base = this.baseOf(h.team);
    h.dead = false;
    h.x = base.x + (h.team === 'ally' ? -90 : 90);
    h.y = base.y + (h.team === 'ally' ? -90 : 90);
    h.hp = h.maxHp;
    h.mana = h.maxMana;
    this.ring(h.x, h.y, 60, COLORS[h.team].light);
  }

  /** 普攻目标：优先敌方英雄，其次最近小兵，最后可攻击结构 */
  private basicTarget(h: Hero): Unit | null {
    const R = HERO.range;
    const foe = h.team === 'ally' ? this.enemy : this.player;
    if (!foe.dead && len(foe.x - h.x, foe.y - h.y) <= R) return foe;
    const m = this.nearestMinion(h.x, h.y, other(h.team), R);
    if (m) return m;
    const s = this.frontStructure(other(h.team));
    if (s && len(s.x - h.x, s.y - h.y) <= R + s.radius) return s;
    return null;
  }

  private nearestMinion(x: number, y: number, team: Team, maxD: number): Minion | null {
    let best: Minion | null = null;
    let bd = maxD;
    for (const m of this.minions) {
      if (m.dead || m.team !== team) continue;
      const d = len(m.x - x, m.y - y);
      if (d < bd) {
        bd = d;
        best = m;
      }
    }
    return best;
  }

  /** 某队最靠前（可被攻击）的结构 */
  private frontStructure(team: Team): Structure | null {
    let best: Structure | null = null;
    for (const s of this.structures) {
      if (s.dead || s.team !== team) continue;
      if (!best || s.order < best.order) best = s;
    }
    return best;
  }
  private isFront(s: Structure): boolean {
    return this.frontStructure(s.team) === s;
  }

  // ---- 小兵模拟 ----
  private updateMinions(dt: number) {
    for (const m of this.minions) {
      if (m.dead) continue;
      if (m.slowTimer > 0) m.slowTimer -= dt;
      if (m.swing > 0) m.swing = Math.max(0, m.swing - dt * 3.2);
      if (m.atkCd > 0) m.atkCd -= dt;

      const foeTeam = other(m.team);
      // 目标：附近敌方英雄/小兵，或最前结构
      let target: Unit | null = this.nearestEnemyForMinion(m, foeTeam);
      if (!target) {
        const s = this.frontStructure(foeTeam);
        if (s) target = s;
      }

      if (target) {
        const d = len(target.x - m.x, target.y - m.y);
        const reach = MINION.range + target.radius;
        if (d <= reach) {
          if (m.atkCd <= 0) {
            this.dealDamage(target, MINION.dmg, null);
            m.atkCd = MINION.attackInterval;
            m.swing = 1;
            this.spark(target.x, target.y, COLORS[m.team].light);
          }
        } else {
          this.stepToward(m, target.x, target.y, this.minionSpeed(m) * dt);
        }
      } else {
        // 沿中线推进
        const goalY = m.team === 'ally' ? 0 : WORLD.h;
        this.stepToward(m, LANEcenter, m.y + (goalY - m.y), this.minionSpeed(m) * dt);
      }
      this.separateMinion(m);
      this.clampToWorld(m);
    }
    this.minions = this.minions.filter((m) => !m.dead);
  }

  private minionSpeed(m: Minion): number {
    return m.slowTimer > 0 ? MINION.speed * (1 - m.slowAmt) : MINION.speed;
  }

  private nearestEnemyForMinion(m: Minion, foeTeam: Team): Unit | null {
    const acq = 190;
    let best: Unit | null = null;
    let bd = acq;
    const foeHero = foeTeam === 'ally' ? this.player : this.enemy;
    if (!foeHero.dead) {
      const d = len(foeHero.x - m.x, foeHero.y - m.y);
      if (d < bd) {
        bd = d;
        best = foeHero;
      }
    }
    for (const o of this.minions) {
      if (o.dead || o.team !== foeTeam) continue;
      const d = len(o.x - m.x, o.y - m.y);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  }

  private separateMinion(m: Minion) {
    for (const o of this.minions) {
      if (o === m || o.dead) continue;
      const dx = m.x - o.x;
      const dy = m.y - o.y;
      const d = len(dx, dy);
      const min = m.radius + o.radius;
      if (d > 0 && d < min) {
        const push = (min - d) / 2;
        m.x += (dx / d) * push;
        m.y += (dy / d) * push;
      }
    }
  }

  // ---- 结构（塔/基地）模拟 ----
  private updateStructures(dt: number) {
    for (const s of this.structures) {
      if (s.dead) continue;
      if (s.atkCd > 0) s.atkCd -= dt;
      const range = s.kind === 'base' ? BASE.range : TOWER.range;
      const dmg = s.kind === 'base' ? BASE.dmg : TOWER.dmg;
      const interval = s.kind === 'base' ? BASE.attackInterval : TOWER.attackInterval;
      if (s.atkCd > 0) continue;
      const foeTeam = other(s.team);
      // 优先小兵，其次英雄
      let target: Unit | null = this.nearestMinion(s.x, s.y, foeTeam, range);
      if (!target) {
        const foe = foeTeam === 'ally' ? this.player : this.enemy;
        if (!foe.dead && len(foe.x - s.x, foe.y - s.y) <= range) target = foe;
      }
      if (target) {
        this.fireHoming(s.x, s.y - s.radius, target, dmg, null, COLORS[s.team].main, 560);
        s.atkCd = interval;
      }
    }
  }

  // ---- 弹体 ----
  private fireHoming(
    x: number,
    y: number,
    target: Unit,
    dmg: number,
    source: Hero | null,
    color: string,
    speed: number,
  ) {
    this.projectiles.push({ x, y, team: source ? source.team : this.teamOfPos(target), dmg, radius: 6, color, source, target, speed });
  }
  private teamOfPos(target: Unit): Team {
    return other(target.team);
  }

  private updateProjectiles(dt: number) {
    for (const p of this.projectiles) {
      if (p.target) {
        // 追踪弹
        if (p.target.dead) {
          p.dmg = -1;
          continue;
        }
        const dx = p.target.x - p.x;
        const dy = p.target.y - p.y;
        const d = len(dx, dy);
        const step = (p.speed ?? 500) * dt;
        if (d <= step + p.target.radius) {
          this.dealDamage(p.target, p.dmg, p.source);
          this.spark(p.target.x, p.target.y, p.color);
          p.dmg = -1;
        } else {
          p.x += (dx / d) * step;
          p.y += (dy / d) * step;
        }
      } else if (p.vx !== undefined && p.vy !== undefined) {
        // 直线穿透弹
        const step = len(p.vx, p.vy) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.traveled = (p.traveled ?? 0) + step;
        for (const u of this.lineTargets(p.team)) {
          if (u.dead) continue;
          if (p.hit?.has(u)) continue;
          if (len(u.x - p.x, u.y - p.y) <= p.radius + u.radius) {
            this.dealDamage(u, p.dmg, p.source);
            this.spark(u.x, u.y, p.color);
            p.hit?.add(u);
            if (!p.pierce) {
              p.dmg = -1;
              break;
            }
          }
        }
        if ((p.traveled ?? 0) >= (p.range ?? 400)) p.dmg = -1;
      }
    }
    this.projectiles = this.projectiles.filter((p) => p.dmg >= 0);
  }

  private lineTargets(team: Team): Unit[] {
    const foe = other(team);
    const list: Unit[] = [];
    for (const m of this.minions) if (m.team === foe) list.push(m);
    const fh = foe === 'ally' ? this.player : this.enemy;
    list.push(fh);
    const s = this.frontStructure(foe);
    if (s) list.push(s);
    return list;
  }

  // ================= 技能 =================
  private castSkill(h: Hero, key: string) {
    const def = SKILLS[key];
    if (!def || h.dead) return;
    if (h.level < def.unlockLevel) return;
    if (h.cd[key] > 0 || h.mana < def.mana) return;
    h.mana -= def.mana;
    h.cd[key] = def.cooldown;
    const fx = h.faceX;
    const fy = h.faceY;
    const flen = len(fx, fy) || 1;
    const dirx = fx / flen;
    const diry = fy / flen;

    if (key === 'Q') {
      this.projectiles.push({
        x: h.x + dirx * h.radius,
        y: h.y + diry * h.radius,
        team: h.team,
        dmg: skillDamage('Q', h.level),
        radius: Q_RADIUS,
        color: COLORS[h.team].light,
        source: h,
        vx: dirx * Q_SPEED,
        vy: diry * Q_SPEED,
        range: Q_RANGE,
        traveled: 0,
        pierce: true,
        hit: new Set<Unit>(),
      });
    } else if (key === 'W') {
      this.ring(h.x, h.y, W_RADIUS, COLORS[h.team].main);
      for (const u of this.aoeTargets(h.team, h.x, h.y, W_RADIUS)) {
        this.dealDamage(u, skillDamage('W', h.level), h);
        this.applySlow(u, W_SLOW, W_SLOW_TIME);
      }
    } else if (key === 'E') {
      h.x += dirx * E_DIST;
      h.y += diry * E_DIST;
      this.clampToWorld(h);
      this.ring(h.x, h.y, 44, COLORS[h.team].light);
    } else if (key === 'R') {
      const foe = h.team === 'ally' ? this.enemy : this.player;
      let tx = h.x + dirx * R_RANGE * 0.6;
      let ty = h.y + diry * R_RANGE * 0.6;
      if (!foe.dead && len(foe.x - h.x, foe.y - h.y) <= R_RANGE) {
        tx = foe.x;
        ty = foe.y;
      }
      this.ring(tx, ty, R_RADIUS, '#ffd54f');
      for (let i = 0; i < 14; i++) this.particles.push({ x: tx, y: ty, vx: (Math.random() - 0.5) * 260, vy: (Math.random() - 0.5) * 260, life: 0.5, max: 0.5, r: 5, color: '#fff59d' });
      for (const u of this.aoeTargets(h.team, tx, ty, R_RADIUS)) {
        this.dealDamage(u, skillDamage('R', h.level), h);
      }
    }
  }

  private aoeTargets(team: Team, x: number, y: number, r: number): Unit[] {
    const foe = other(team);
    const out: Unit[] = [];
    for (const m of this.minions) if (!m.dead && m.team === foe && len(m.x - x, m.y - y) <= r + m.radius) out.push(m);
    const fh = foe === 'ally' ? this.player : this.enemy;
    if (!fh.dead && len(fh.x - x, fh.y - y) <= r + fh.radius) out.push(fh);
    const s = this.frontStructure(foe);
    if (s && len(s.x - x, s.y - y) <= r + s.radius) out.push(s);
    return out;
  }

  private applySlow(u: Unit, amt: number, time: number) {
    if (u.kind === 'hero' || u.kind === 'minion') {
      (u as Hero | Minion).slowTimer = time;
      (u as Hero | Minion).slowAmt = amt;
    }
  }

  // ================= 伤害与击杀 =================
  private dealDamage(target: Unit, amount: number, attacker: Hero | null) {
    if (target.dead) return;
    if ((target.kind === 'tower' || target.kind === 'base') && !this.isFront(target as Structure)) return;
    target.hp -= amount;
    this.floatText(target.x, target.y - target.radius - 6, Math.round(amount).toString(), attacker?.isPlayer ? '#fff' : '#ffcdd2', 15);
    if (target.hp <= 0) {
      target.dead = true;
      this.onKill(target, attacker);
    }
  }

  private onKill(target: Unit, attacker: Hero | null) {
    this.puff(target.x, target.y, COLORS[target.team].main, target.radius);
    // 经验：给对方所有在范围内的英雄
    let xp = 0;
    let gold = 0;
    if (target.kind === 'minion') {
      xp = MINION.xpOnDeath;
      gold = MINION.goldOnKill;
    } else if (target.kind === 'tower') {
      xp = TOWER.xpOnDeath;
      gold = TOWER.goldOnKill;
      this.floatText(target.x, target.y - 50, '防御塔被摧毁', '#ffca28', 20);
    } else if (target.kind === 'base') {
      this.finish(target.team === 'enemy');
      return;
    } else if (target.kind === 'hero') {
      xp = 160;
      gold = 220;
      const h = target as Hero;
      h.deaths++;
      h.respawn = 5 + h.level * 1.6;
      this.floatText(target.x, target.y - 40, '英雄阵亡!', '#ff8a80', 22);
    }

    const victimTeam = target.team;
    for (const hero of [this.player, this.enemy]) {
      if (hero.team === victimTeam) continue;
      if (hero.dead) continue;
      if (len(hero.x - target.x, hero.y - target.y) <= XP_RANGE) this.gainXp(hero, xp);
    }
    // 金币：击杀者
    if (attacker) {
      if (attacker.team === 'ally') this.gold += gold;
      if (target.kind === 'hero') attacker.kills++;
      // 击杀者若不在经验范围也补一份经验
      if (len(attacker.x - target.x, attacker.y - target.y) > XP_RANGE) this.gainXp(attacker, xp);
    }
  }

  private gainXp(h: Hero, amount: number) {
    if (h.level >= MAX_LEVEL) return;
    h.xp += amount;
    while (h.level < MAX_LEVEL && h.xp >= XP_TABLE[h.level]) {
      h.level++;
      this.refreshStats(h);
      this.ring(h.x, h.y, 40, '#ffe082');
      if (h.isPlayer) this.floatText(h.x, h.y - 44, '升级! Lv.' + h.level, '#ffe082', 20);
    }
  }

  private finish(playerWon: boolean) {
    if (this.ended) return;
    this.ended = true;
    this.over = true;
    this.onEnd({ won: playerWon, time: this.time });
  }

  // ================= 商店 =================
  canShop(): boolean {
    const base = this.baseOf('ally');
    return !this.player.dead && len(this.player.x - base.x, this.player.y - base.y) <= SHOP_RANGE;
  }
  itemCost(id: string, count: number): number {
    const it = SHOP.find((s) => s.id === id)!;
    return it.baseCost + it.costStep * count;
  }
  buy(id: string): boolean {
    const key = id as keyof Hero['up'];
    const count = this.player.up[key];
    const cost = this.itemCost(id, count);
    if (!this.canShop()) {
      this.shopMsg = '需回到己方水晶附近购买';
      return false;
    }
    if (this.gold < cost) {
      this.shopMsg = '金币不足';
      return false;
    }
    this.gold -= cost;
    this.player.up[key]++;
    this.refreshStats(this.player);
    this.shopMsg = '购买成功';
    this.ring(this.player.x, this.player.y, 40, '#ffd54f');
    return true;
  }

  // ================= 工具 =================
  private stepToward(u: Unit, tx: number, ty: number, dist: number) {
    const dx = tx - u.x;
    const dy = ty - u.y;
    const d = len(dx, dy);
    if (d <= dist || d === 0) {
      return;
    }
    u.x += (dx / d) * dist;
    u.y += (dy / d) * dist;
  }
  private clampToWorld(u: Unit) {
    u.x = Math.max(80, Math.min(WORLD.w - 80, u.x));
    u.y = Math.max(90, Math.min(WORLD.h - 90, u.y));
  }
  // ---- FX ----
  private floatText(x: number, y: number, text: string, color: string, size: number) {
    this.floats.push({ x, y, vy: -34, life: 0.9, text, color, size });
  }
  private spark(x: number, y: number, color: string) {
    for (let i = 0; i < 4; i++)
      this.particles.push({ x, y, vx: (Math.random() - 0.5) * 130, vy: (Math.random() - 0.5) * 130, life: 0.3, max: 0.3, r: 3, color });
  }
  private puff(x: number, y: number, color: string, r: number) {
    const n = Math.min(20, 6 + Math.floor(r / 3));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 40 + Math.random() * 120;
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 0.6, max: 0.6, r: 3 + Math.random() * 3, color });
    }
  }
  private ring(x: number, y: number, r: number, color: string) {
    this.rings.push({ x, y, r, life: 0.5, max: 0.5, color });
  }
  private updateFx(dt: number) {
    for (const f of this.floats) {
      f.y += f.vy * dt;
      f.life -= dt;
    }
    this.floats = this.floats.filter((f) => f.life > 0);
    for (const p of this.particles) {
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.life -= dt;
    }
    this.particles = this.particles.filter((p) => p.life > 0);
    for (const r of this.rings) r.life -= dt;
    this.rings = this.rings.filter((r) => r.life > 0);
  }

  private updateSkillUI(controls: Controls) {
    const p = this.player;
    for (const key of ['Q', 'W', 'E', 'R']) {
      const def = SKILLS[key];
      const locked = p.level < def.unlockLevel;
      const cdFrac = def.cooldown > 0 ? Math.max(0, p.cd[key]) / def.cooldown : 0;
      const ready = !locked && p.cd[key] <= 0 && p.mana >= def.mana;
      controls.setSkillUI(key, cdFrac, ready, locked);
    }
  }

  // ================= 渲染 =================
  render(ctx: CanvasRenderingContext2D, cssW: number, cssH: number) {
    const scale = Math.max(0.42, Math.min(1.0, cssW / 560));
    const halfW = cssW / 2 / scale;
    const halfH = cssH / 2 / scale;
    const camX = Math.max(halfW, Math.min(WORLD.w - halfW, this.cam.x));
    const camY = Math.max(halfH, Math.min(WORLD.h - halfH, this.cam.y));
    const toX = (wx: number) => (wx - camX) * scale + cssW / 2;
    const toY = (wy: number) => (wy - camY) * scale + cssH / 2;

    ctx.clearRect(0, 0, cssW, cssH);
    this.drawTerrain(ctx, toX, toY, scale, camX, camY, halfW, halfH);

    // 结构攻击范围环（淡）
    for (const s of this.structures) {
      if (s.dead) continue;
      const range = s.kind === 'base' ? BASE.range : TOWER.range;
      ctx.beginPath();
      ctx.arc(toX(s.x), toY(s.y), range * scale, 0, Math.PI * 2);
      ctx.fillStyle = s.team === 'ally' ? 'rgba(64,196,255,0.05)' : 'rgba(255,90,106,0.05)';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = s.team === 'ally' ? 'rgba(64,196,255,0.16)' : 'rgba(255,90,106,0.16)';
      ctx.stroke();
    }

    // 地面光环（技能，画在单位下方）
    for (const r of this.rings) {
      const k = r.life / r.max;
      ctx.save();
      ctx.translate(toX(r.x), toY(r.y));
      ctx.scale(1, 0.52);
      ctx.beginPath();
      ctx.arc(0, 0, r.r * scale * (1.05 - k * 0.3), 0, Math.PI * 2);
      ctx.strokeStyle = r.color;
      ctx.globalAlpha = k;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    // 深度排序绘制（含地面阴影）
    const list: (Structure | Minion | Hero)[] = [...this.structures, ...this.minions];
    if (!this.enemy.dead) list.push(this.enemy);
    if (!this.player.dead) list.push(this.player);
    list.sort((a, b) => a.y - b.y);
    for (const u of list) {
      if (u.kind === 'minion') this.drawMinion(ctx, u as Minion, toX, toY, scale);
      else if (u.kind === 'hero') this.drawHero(ctx, u as Hero, toX, toY, scale);
      else this.drawStructure(ctx, u as Structure, toX, toY, scale);
    }

    // 弹体（带辉光）
    for (const p of this.projectiles) {
      const px = toX(p.x);
      const py = toY(p.y);
      const rr = Math.max(3, p.radius * scale);
      ctx.globalAlpha = 0.3;
      ctx.beginPath();
      ctx.arc(px, py, rr * 2.1, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(px, py, rr, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, rr * 0.62, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    // 粒子
    for (const p of this.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.beginPath();
      ctx.arc(toX(p.x), toY(p.y), p.r * scale, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 飘字
    ctx.textAlign = 'center';
    for (const f of this.floats) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life / 0.5));
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.fillStyle = f.color;
      ctx.font = `bold ${Math.round(f.size * scale + 4)}px sans-serif`;
      ctx.strokeText(f.text, toX(f.x), toY(f.y));
      ctx.fillText(f.text, toX(f.x), toY(f.y));
    }
    ctx.globalAlpha = 1;

    if (this.player.dead) this.drawRespawn(ctx, cssW, cssH);
    this.drawMinimap(ctx, cssW);
  }

  private drawTerrain(
    ctx: CanvasRenderingContext2D,
    toX: (n: number) => number,
    toY: (n: number) => number,
    scale: number,
    camX: number,
    camY: number,
    halfW: number,
    halfH: number,
  ) {
    const w = halfW * 2 * scale + 4;
    // 草地底色渐变
    const grad = ctx.createLinearGradient(0, toY(0), 0, toY(WORLD.h));
    grad.addColorStop(0, '#2a5a34');
    grad.addColorStop(0.5, '#245029');
    grad.addColorStop(1, '#2a5a34');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w + 8, halfH * 2 * scale + 8);

    const hash = (i: number, j: number) => {
      const n = Math.sin(i * 127.1 + j * 311.7) * 43758.5453;
      return n - Math.floor(n);
    };
    // 草地纹理（网格散点，随视野裁剪）
    const step = 46;
    const x0 = Math.floor((camX - halfW) / step) * step;
    const x1 = camX + halfW;
    const y0 = Math.floor((camY - halfH) / step) * step;
    const y1 = camY + halfH;
    for (let gx = x0; gx <= x1; gx += step) {
      for (let gy = y0; gy <= y1; gy += step) {
        const h1 = hash(gx, gy);
        const jx = gx + (hash(gx + 1, gy) - 0.5) * step * 0.8;
        const jy = gy + (hash(gx, gy + 1) - 0.5) * step * 0.8;
        const sx = toX(jx);
        const sy = toY(jy);
        const light = h1 > 0.5;
        ctx.fillStyle = light ? 'rgba(120,190,110,0.18)' : 'rgba(20,55,25,0.22)';
        ctx.beginPath();
        ctx.ellipse(sx, sy, 4 * scale, 2.4 * scale, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 兵线：石板路
    const laneW = 150 * scale;
    const lx = toX(LANEcenter);
    ctx.fillStyle = '#7c6a4d';
    ctx.fillRect(lx - laneW / 2, 0, laneW, halfH * 2 * scale + 8);
    ctx.fillStyle = '#8a7757';
    ctx.fillRect(lx - laneW / 2 + 3, 0, laneW - 6, halfH * 2 * scale + 8);
    // 石板横缝
    ctx.strokeStyle = 'rgba(60,50,35,0.4)';
    ctx.lineWidth = 1;
    const brick = 46 * scale;
    for (let sy = toY(0) % brick; sy < halfH * 2 * scale + 8; sy += brick) {
      ctx.beginPath();
      ctx.moveTo(lx - laneW / 2, sy);
      ctx.lineTo(lx + laneW / 2, sy);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(40,32,20,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(lx - laneW / 2, toY(LAYOUT.enemyBase.y), laneW, toY(LAYOUT.allyBase.y) - toY(LAYOUT.enemyBase.y));

    // 河道（中路，带流动高光）
    const midY = (LAYOUT.enemyT1.y + LAYOUT.allyT1.y) / 2;
    const riverTop = toY(midY - 95);
    const riverH = 190 * scale;
    ctx.fillStyle = '#1f5f74';
    ctx.fillRect(0, riverTop, w + 8, riverH);
    ctx.fillStyle = '#2a7590';
    ctx.fillRect(0, riverTop + riverH * 0.18, w + 8, riverH * 0.64);
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#bfe9f5';
    ctx.lineWidth = 2;
    for (let k = 0; k < 4; k++) {
      const yy = riverTop + riverH * (0.28 + k * 0.16);
      ctx.beginPath();
      for (let sx = 0; sx <= w; sx += 14) {
        const yoff = Math.sin(sx * 0.05 + this.time * 1.6 + k) * 3 * scale;
        if (sx === 0) ctx.moveTo(sx, yy + yoff);
        else ctx.lineTo(sx, yy + yoff);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // 基地区域彩色光晕
    for (const team of ['ally', 'enemy'] as Team[]) {
      const b = this.baseOf(team);
      const g = ctx.createRadialGradient(toX(b.x), toY(b.y), 0, toX(b.x), toY(b.y), 360 * scale);
      g.addColorStop(0, team === 'ally' ? 'rgba(64,196,255,0.16)' : 'rgba(255,90,106,0.16)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w + 8, halfH * 2 * scale + 8);
    }

    // 草丛（两侧，固定散布）
    for (let i = 0; i < 46; i++) {
      const side = i % 2 === 0 ? 1 : -1;
      const bx = LANEcenter + side * (150 + hash(i, 3) * 300);
      const by = 200 + hash(i, 7) * (WORLD.h - 400);
      if (Math.abs(by - camY) > halfH + 60 || Math.abs(bx - camX) > halfW + 60) continue;
      const sx = toX(bx);
      const sy = toY(by);
      const rad = (16 + hash(i, 9) * 10) * scale;
      ctx.fillStyle = 'rgba(10,40,18,0.5)';
      ctx.beginPath();
      ctx.ellipse(sx, sy + 3, rad, rad * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = i % 3 === 0 ? '#2e6b34' : '#357a3c';
      ctx.beginPath();
      ctx.ellipse(sx, sy, rad, rad * 0.72, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(150,210,140,0.25)';
      ctx.beginPath();
      ctx.ellipse(sx - rad * 0.3, sy - rad * 0.3, rad * 0.4, rad * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private shadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number) {
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(x, y, rx, rx * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawStructure(
    ctx: CanvasRenderingContext2D,
    s: Structure,
    toX: (n: number) => number,
    toY: (n: number) => number,
    scale: number,
  ) {
    const c = COLORS[s.team];
    const x = toX(s.x);
    const gy = toY(s.y);
    const r = s.radius * scale;
    this.shadow(ctx, x, gy + 2, r * 1.05);

    if (s.dead) {
      // 废墟
      ctx.fillStyle = '#4a4038';
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        ctx.beginPath();
        ctx.ellipse(x + Math.cos(a) * r * 0.5, gy + Math.sin(a) * r * 0.25, r * 0.32, r * 0.22, a, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = 'rgba(60,60,60,0.6)';
      ctx.beginPath();
      ctx.ellipse(x, gy, r * 0.7, r * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }

    const front = this.isFront(s);
    if (s.kind === 'base') {
      // 水晶基地：底座平台 + 悬浮旋转水晶
      ctx.fillStyle = '#5c5142';
      ctx.beginPath();
      ctx.ellipse(x, gy, r * 1.1, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#6f634f';
      ctx.beginPath();
      ctx.ellipse(x, gy - 3 * scale, r * 0.9, r * 0.42, 0, 0, Math.PI * 2);
      ctx.fill();
      // 台柱
      ctx.fillStyle = c.dark;
      ctx.fillRect(x - r * 0.5, gy - r * 0.9, r, r * 0.9);
      // 悬浮水晶
      const cy = gy - r * 1.3 + Math.sin(this.time * 2) * 4 * scale;
      const cs = r * 0.7;
      ctx.save();
      ctx.translate(x, cy);
      ctx.rotate(this.time * 0.8);
      const gg = ctx.createLinearGradient(0, -cs, 0, cs);
      gg.addColorStop(0, c.light);
      gg.addColorStop(1, c.main);
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(0, -cs);
      ctx.lineTo(cs * 0.6, 0);
      ctx.lineTo(0, cs);
      ctx.lineTo(-cs * 0.6, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      // 辉光
      ctx.globalAlpha = 0.4;
      ctx.fillStyle = c.light;
      ctx.beginPath();
      ctx.arc(x, cy, cs * 1.1, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      this.hpBar(ctx, x, gy - r * 2.1, r * 2, s.hp / s.maxHp, c.main);
    } else {
      // 防御塔：石身 + 团队顶冠 + 能量球
      const h = r * 2.6;
      // 塔身梯形
      ctx.fillStyle = '#6a6258';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.7, gy);
      ctx.lineTo(x - r * 0.5, gy - h);
      ctx.lineTo(x + r * 0.5, gy - h);
      ctx.lineTo(x + r * 0.7, gy);
      ctx.closePath();
      ctx.fill();
      // 亮面
      ctx.fillStyle = '#7c746a';
      ctx.beginPath();
      ctx.moveTo(x - r * 0.5, gy - h);
      ctx.lineTo(x, gy - h);
      ctx.lineTo(x + r * 0.1, gy);
      ctx.lineTo(x - r * 0.7, gy);
      ctx.closePath();
      ctx.fill();
      // 砖缝
      ctx.strokeStyle = 'rgba(40,36,30,0.4)';
      ctx.lineWidth = 1;
      for (let k = 1; k < 4; k++) {
        const yy = gy - (h * k) / 4;
        ctx.beginPath();
        ctx.moveTo(x - r * (0.7 - 0.05 * k), yy);
        ctx.lineTo(x + r * (0.7 - 0.05 * k), yy);
        ctx.stroke();
      }
      // 顶冠（团队色）
      ctx.fillStyle = c.dark;
      ctx.fillRect(x - r * 0.62, gy - h - r * 0.34, r * 1.24, r * 0.4);
      ctx.fillStyle = c.main;
      for (let k = 0; k < 3; k++) {
        ctx.fillRect(x - r * 0.62 + k * r * 0.46, gy - h - r * 0.6, r * 0.3, r * 0.3);
      }
      // 能量球
      const oy = gy - h - r * 0.05;
      ctx.fillStyle = c.light;
      ctx.beginPath();
      ctx.arc(x, oy, r * 0.26 + Math.sin(this.time * 3) * scale, 0, Math.PI * 2);
      ctx.fill();
      this.hpBar(ctx, x, gy - h - r * 0.9, r * 1.7, s.hp / s.maxHp, c.main);
    }

    if (front) {
      ctx.strokeStyle = 'rgba(255,202,40,0.9)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(x, gy, r * 1.15, r * 0.55, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  private drawMinion(
    ctx: CanvasRenderingContext2D,
    m: Minion,
    toX: (n: number) => number,
    toY: (n: number) => number,
    scale: number,
  ) {
    const c = COLORS[m.team];
    const x = toX(m.x);
    const gy = toY(m.y);
    const u = Math.max(3.2, 9 * scale); // 基本单位
    const phase = this.time * 7 + m.seed;
    const bob = Math.abs(Math.sin(phase)) * u * 0.28;
    const fwd = m.team === 'ally' ? -1 : 1; // 前进方向（屏幕 y）
    this.shadow(ctx, x, gy + 1, u * 1.15);

    const bodyTop = gy - bob;
    // 腿
    ctx.strokeStyle = '#3a3027';
    ctx.lineWidth = Math.max(1.5, u * 0.34);
    const legSwing = Math.sin(phase) * u * 0.4;
    ctx.beginPath();
    ctx.moveTo(x - u * 0.25, bodyTop - u * 0.7);
    ctx.lineTo(x - u * 0.25 + legSwing, gy);
    ctx.moveTo(x + u * 0.25, bodyTop - u * 0.7);
    ctx.lineTo(x + u * 0.25 - legSwing, gy);
    ctx.stroke();
    // 躯干（团队战袍）
    ctx.fillStyle = c.main;
    this.roundRectPath(ctx, x - u * 0.55, bodyTop - u * 1.9, u * 1.1, u * 1.35, u * 0.3);
    ctx.fill();
    ctx.fillStyle = c.dark;
    ctx.fillRect(x - u * 0.55, bodyTop - u * 0.9, u * 1.1, u * 0.35); // 腰带
    // 手臂 + 武器（长矛）
    const sw = m.swing > 0 ? m.swing : 0;
    const armY = bodyTop - u * 1.5;
    const tip = fwd * (u * 1.6 + sw * u * 1.2);
    ctx.strokeStyle = '#caa14e';
    ctx.lineWidth = Math.max(1, u * 0.22);
    ctx.beginPath();
    ctx.moveTo(x + u * 0.4, armY);
    ctx.lineTo(x + u * 0.4, armY + tip);
    ctx.stroke();
    ctx.fillStyle = '#d8dde3';
    ctx.beginPath();
    ctx.arc(x + u * 0.4, armY + tip, u * 0.22, 0, Math.PI * 2);
    ctx.fill();
    // 头 + 头盔
    ctx.fillStyle = '#e8b98f';
    ctx.beginPath();
    ctx.arc(x, bodyTop - u * 2.25, u * 0.52, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.arc(x, bodyTop - u * 2.42, u * 0.55, Math.PI, Math.PI * 2);
    ctx.fill();

    if (m.hp < m.maxHp) this.hpBar(ctx, x, bodyTop - u * 3.1, u * 1.8, m.hp / m.maxHp, c.light);
  }

  private roundRectPath(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
  }

  private drawHero(
    ctx: CanvasRenderingContext2D,
    h: Hero,
    toX: (n: number) => number,
    toY: (n: number) => number,
    scale: number,
  ) {
    const c = COLORS[h.team];
    const x = toX(h.x);
    const gy = toY(h.y);
    const u = h.radius * scale * 0.95;

    this.shadow(ctx, x, gy + 2, u * 1.35);

    // 脚下标记环
    ctx.save();
    ctx.translate(x, gy);
    ctx.scale(1, 0.45);
    ctx.rotate(this.time * (h.isPlayer ? 1.3 : -1.0));
    ctx.strokeStyle = h.isPlayer ? '#ffd54f' : c.main;
    ctx.lineWidth = 3;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2;
      ctx.moveTo(Math.cos(a) * u * 1.3, Math.sin(a) * u * 1.3);
      ctx.arc(0, 0, u * 1.3, a, a + 0.9);
    }
    ctx.stroke();
    ctx.restore();

    const bob = Math.abs(Math.sin(h.walk)) * u * 0.22;
    const top = gy - bob;
    const side = h.faceX >= 0 ? 1 : -1;

    // 披风
    ctx.fillStyle = c.dark;
    ctx.beginPath();
    ctx.moveTo(x - u * 0.55, top - u * 2.5);
    ctx.quadraticCurveTo(x - u * (1.1 + Math.sin(this.time * 4) * 0.15), top - u * 0.6, x - u * 0.3, top);
    ctx.lineTo(x + u * 0.3, top);
    ctx.quadraticCurveTo(x + u * (1.1 + Math.sin(this.time * 4 + 1) * 0.15), top - u * 0.6, x + u * 0.55, top - u * 2.5);
    ctx.closePath();
    ctx.fill();

    // 腿
    ctx.strokeStyle = '#2c2a33';
    ctx.lineWidth = u * 0.4;
    const legSwing = Math.sin(h.walk) * u * 0.5;
    ctx.beginPath();
    ctx.moveTo(x - u * 0.3, top - u * 0.9);
    ctx.lineTo(x - u * 0.3 + legSwing, gy);
    ctx.moveTo(x + u * 0.3, top - u * 0.9);
    ctx.lineTo(x + u * 0.3 - legSwing, gy);
    ctx.stroke();

    // 躯干护甲
    const g = ctx.createLinearGradient(x - u, 0, x + u, 0);
    g.addColorStop(0, c.dark);
    g.addColorStop(0.5, c.main);
    g.addColorStop(1, c.dark);
    ctx.fillStyle = g;
    this.roundRectPath(ctx, x - u * 0.7, top - u * 2.5, u * 1.4, u * 1.75, u * 0.4);
    ctx.fill();
    // 胸甲高光
    ctx.fillStyle = h.isPlayer ? '#ffe9a8' : c.light;
    ctx.beginPath();
    ctx.moveTo(x, top - u * 2.2);
    ctx.lineTo(x + u * 0.28, top - u * 1.7);
    ctx.lineTo(x, top - u * 1.2);
    ctx.lineTo(x - u * 0.28, top - u * 1.7);
    ctx.closePath();
    ctx.fill();
    // 肩甲
    ctx.fillStyle = c.light;
    ctx.beginPath();
    ctx.arc(x - u * 0.72, top - u * 2.3, u * 0.42, 0, Math.PI * 2);
    ctx.arc(x + u * 0.72, top - u * 2.3, u * 0.42, 0, Math.PI * 2);
    ctx.fill();

    // 武器（大剑）+ 挥砍
    const chestY = top - u * 1.9;
    const sw = h.swing;
    ctx.save();
    ctx.translate(x + side * u * 0.75, chestY);
    const rest = side * 0.4;
    const raise = side * (-1.9);
    const ang = rest + (raise - rest) * sw;
    ctx.rotate(ang);
    // 剑
    ctx.fillStyle = '#e6ebf2';
    this.roundRectPath(ctx, -u * 0.12, -u * 2.4, u * 0.24, u * 2.4, u * 0.1);
    ctx.fill();
    ctx.fillStyle = '#b8c0cc';
    ctx.fillRect(-u * 0.05, -u * 2.4, u * 0.05, u * 2.4);
    ctx.fillStyle = '#8a6d3b'; // 护手
    ctx.fillRect(-u * 0.4, -u * 0.15, u * 0.8, u * 0.18);
    ctx.restore();
    // 挥砍弧光
    if (sw > 0.35) {
      ctx.globalAlpha = (sw - 0.35) * 1.2;
      ctx.strokeStyle = c.light;
      ctx.lineWidth = u * 0.5;
      ctx.beginPath();
      ctx.arc(x, chestY, u * 2.1, side > 0 ? -1.2 : Math.PI + 0.0, side > 0 ? 0.6 : Math.PI + 1.2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 头 + 头盔 + 面甲
    const headY = top - u * 3.1;
    ctx.fillStyle = '#e8b98f';
    ctx.beginPath();
    ctx.arc(x, headY, u * 0.62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c.main;
    ctx.beginPath();
    ctx.arc(x, headY - u * 0.12, u * 0.66, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.fillRect(x - u * 0.66, headY - u * 0.18, u * 1.32, u * 0.16);
    // 头冠/羽饰
    ctx.fillStyle = h.isPlayer ? '#ffd54f' : '#7a1f24';
    ctx.beginPath();
    ctx.moveTo(x, headY - u * 1.35);
    ctx.lineTo(x + u * 0.18, headY - u * 0.7);
    ctx.lineTo(x - u * 0.18, headY - u * 0.7);
    ctx.closePath();
    ctx.fill();

    // 等级徽章
    const bx = x - u * 1.1;
    const by = headY - u * 0.2;
    ctx.fillStyle = '#12100a';
    ctx.beginPath();
    ctx.arc(bx, by, u * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#ffca28';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#ffe082';
    ctx.font = `bold ${Math.round(u * 0.7)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(h.level.toString(), bx, by + 0.5);
    ctx.textBaseline = 'alphabetic';

    // 血/蓝条
    const barY = headY - u * 1.7;
    const bw = Math.max(u * 3, 42 * scale);
    this.hpBar(ctx, x, barY, bw, h.hp / h.maxHp, h.isPlayer ? '#66bb6a' : c.main);
    this.hpBar(ctx, x, barY + bw * 0.11, bw, h.mana / h.maxMana, '#5c6bc0', true);
  }

  private hpBar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    w: number,
    frac: number,
    color: string,
    thin = false,
  ) {
    const h = thin ? 3 : 5;
    const x = cx - w / 2;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - 1, cy - 1, w + 2, h + 2);
    ctx.fillStyle = color;
    ctx.fillRect(x, cy, w * Math.max(0, Math.min(1, frac)), h);
  }

  private drawRespawn(ctx: CanvasRenderingContext2D, cssW: number, cssH: number) {
    ctx.fillStyle = 'rgba(8,12,18,0.55)';
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('阵亡', cssW / 2, cssH / 2 - 14);
    ctx.font = 'bold 22px sans-serif';
    ctx.fillStyle = '#ffca28';
    ctx.fillText(`${Math.ceil(this.player.respawn)} 秒后复活`, cssW / 2, cssH / 2 + 22);
  }

  private drawMinimap(ctx: CanvasRenderingContext2D, cssW: number) {
    const w = 92;
    const h = w * (WORLD.h / WORLD.w);
    const pad = 10;
    const ox = cssW - w - pad;
    const oy = pad + 44;
    ctx.fillStyle = 'rgba(6,20,14,0.72)';
    ctx.fillRect(ox, oy, w, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, w, h);
    const mx = (wx: number) => ox + (wx / WORLD.w) * w;
    const my = (wy: number) => oy + (wy / WORLD.h) * h;
    for (const s of this.structures) {
      if (s.dead) continue;
      ctx.fillStyle = COLORS[s.team].main;
      const sz = s.kind === 'base' ? 5 : 3;
      ctx.fillRect(mx(s.x) - sz / 2, my(s.y) - sz / 2, sz, sz);
    }
    for (const m of this.minions) {
      ctx.fillStyle = COLORS[m.team].light;
      ctx.fillRect(mx(m.x) - 1, my(m.y) - 1, 2, 2);
    }
    for (const hh of [this.enemy, this.player]) {
      if (hh.dead) continue;
      ctx.beginPath();
      ctx.arc(mx(hh.x), my(hh.y), hh.isPlayer ? 3.5 : 3, 0, Math.PI * 2);
      ctx.fillStyle = hh.isPlayer ? '#fff' : COLORS[hh.team].main;
      ctx.fill();
      if (hh.isPlayer) {
        ctx.strokeStyle = COLORS.ally.main;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }
}

const LANEcenter = 500;

function other(team: Team): Team {
  return team === 'ally' ? 'enemy' : 'ally';
}
