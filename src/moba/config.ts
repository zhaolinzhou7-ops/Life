/** MOBA 核心配置：世界布局、数值、技能与商店定义 */

export type Team = 'ally' | 'enemy';

export interface Vec {
  x: number;
  y: number;
}

/** 世界尺寸（世界坐标，单位≈像素） */
export const WORLD = { w: 1000, h: 2800 };

/** 单路推塔的中线 X */
export const LANE_X = 500;

/** 结构（基地/防御塔）在世界中的坐标 */
export const LAYOUT = {
  enemyBase: { x: LANE_X, y: 250 },
  enemyT2: { x: LANE_X, y: 760 },
  enemyT1: { x: LANE_X, y: 1200 },
  allyT1: { x: LANE_X, y: 1600 },
  allyT2: { x: LANE_X, y: 2040 },
  allyBase: { x: LANE_X, y: 2550 },
};

/** 小兵出兵点（略微偏离基地，避免卡在基地里） */
export const SPAWN = {
  enemy: { x: LANE_X, y: LAYOUT.enemyBase.y + 120 },
  ally: { x: LANE_X, y: LAYOUT.allyBase.y - 120 },
};

/** 每队颜色 */
export const COLORS: Record<Team, { main: string; light: string; dark: string }> = {
  ally: { main: '#40c4ff', light: '#8fe0ff', dark: '#1c6f9c' },
  enemy: { main: '#ff5a6a', light: '#ff9aa4', dark: '#9c2530' },
};

/** 小兵数值 */
export const MINION = {
  hp: 130,
  dmg: 13,
  range: 34,
  attackInterval: 1.0,
  speed: 58,
  radius: 13,
  goldOnKill: 28,
  xpOnDeath: 38,
  waveSize: 4,
  waveInterval: 22, // 秒
  waveGap: 0.45, // 同一波内每只间隔
};

/** 防御塔数值 */
export const TOWER = {
  hp: 1650,
  dmg: 92,
  range: 300,
  attackInterval: 1.1,
  radius: 38,
  goldOnKill: 160,
  xpOnDeath: 220,
};

/** 基地（水晶）数值 */
export const BASE = {
  hp: 3200,
  dmg: 120,
  range: 330,
  attackInterval: 1.3,
  radius: 66,
};

/** 英雄基础数值（1 级） */
export const HERO = {
  hp: 640,
  hpPerLevel: 78,
  mana: 320,
  manaPerLevel: 24,
  hpRegen: 7, // 每秒
  manaRegen: 9, // 每秒
  dmg: 56,
  dmgPerLevel: 9,
  range: 155,
  attackInterval: 0.72,
  speed: 168,
  radius: 20,
  projSpeed: 620,
  aggroRange: 560,
};

/** 升级经验阈值（到达该等级所需累计经验） */
export const XP_TABLE = [0, 120, 280, 500, 780, 1120, 1520, 2000, 2560, 3200];
export const MAX_LEVEL = XP_TABLE.length;

/** 全局金币被动收入（每秒） */
export const PASSIVE_GOLD = 2.2;
export const START_GOLD = 150;

export interface SkillDef {
  key: string;
  name: string;
  desc: string;
  mana: number;
  cooldown: number;
  unlockLevel: number;
}

/** 四个主动技能（英雄双方共用一套） */
export const SKILLS: Record<string, SkillDef> = {
  Q: { key: 'Q', name: '能量弹', desc: '向前发射穿透弹，命中造成爆发伤害', mana: 55, cooldown: 5, unlockLevel: 1 },
  W: { key: 'W', name: '震荡新星', desc: '身周爆发，伤害并减速附近敌人', mana: 70, cooldown: 9, unlockLevel: 1 },
  E: { key: 'E', name: '疾冲', desc: '朝当前方向瞬移一段距离', mana: 40, cooldown: 8, unlockLevel: 1 },
  R: { key: 'R', name: '雷霆审判', desc: '召唤天雷，对目标区域造成巨额伤害', mana: 100, cooldown: 42, unlockLevel: 6 },
};

/** 技能数值随等级成长 */
export function skillDamage(key: string, level: number): number {
  switch (key) {
    case 'Q':
      return 78 + 16 * level;
    case 'W':
      return 56 + 12 * level;
    case 'R':
      return 240 + 34 * level;
    default:
      return 0;
  }
}

export const Q_RANGE = 540;
export const Q_SPEED = 780;
export const Q_RADIUS = 16;
export const W_RADIUS = 190;
export const W_SLOW = 0.45;
export const W_SLOW_TIME = 1.6;
export const E_DIST = 210;
export const R_RADIUS = 150;
export const R_RANGE = 560;

export interface ShopItem {
  id: string;
  icon: string;
  name: string;
  desc: string;
  baseCost: number;
  costStep: number;
}

/** 商店：可反复购买，价格递增。只有在己方基地附近才能购买 */
export const SHOP: ShopItem[] = [
  { id: 'atk', icon: '⚔️', name: '力量水晶', desc: '攻击力 +14', baseCost: 120, costStep: 45 },
  { id: 'hp', icon: '❤️', name: '生命宝石', desc: '最大生命 +130', baseCost: 120, costStep: 45 },
  { id: 'as', icon: '⚡', name: '疾速符文', desc: '攻击间隔 -0.05s', baseCost: 160, costStep: 70 },
  { id: 'ms', icon: '👟', name: '疾行之靴', desc: '移动速度 +14', baseCost: 150, costStep: 80 },
];

export const SHOP_RANGE = 420; // 距己方基地多近可购物
export const MIN_ATTACK_INTERVAL = 0.34;
