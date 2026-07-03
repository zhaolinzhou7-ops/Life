/** 每波守住后的随机奖励：定义奖励池并按权重抽取 */

export type RewardKind = 'gold' | 'treasure' | 'repair' | 'damage' | 'upgrade' | 'interest';

export interface RewardPick {
  kind: RewardKind;
  /** 金币类为金额；伤害为增伤比例；维修为恢复生命；升级为 1 */
  amount: number;
  emoji: string;
  name: string;
  desc: string;
}

export interface RewardInput {
  wave: number;
  goldMul: number;
  currentGold: number;
  /** 基地已损失的生命（maxLives - lives），>0 才可能抽到维修 */
  livesDeficit: number;
  /** 是否存在未满级、可免费升级的塔 */
  canUpgrade: boolean;
}

/** 依据当前局势抽取一个奖励（会剔除不适用的项） */
export function pickReward(inp: RewardInput): RewardPick {
  const pool: { kind: RewardKind; weight: number }[] = [
    { kind: 'gold', weight: 32 },
    { kind: 'treasure', weight: 8 },
    { kind: 'damage', weight: 18 },
    { kind: 'interest', weight: 15 },
  ];
  if (inp.livesDeficit > 0) pool.push({ kind: 'repair', weight: 16 });
  if (inp.canUpgrade) pool.push({ kind: 'upgrade', weight: 14 });

  const total = pool.reduce((s, p) => s + p.weight, 0);
  let roll = Math.random() * total;
  let kind: RewardKind = 'gold';
  for (const p of pool) {
    roll -= p.weight;
    if (roll <= 0) {
      kind = p.kind;
      break;
    }
  }

  switch (kind) {
    case 'gold': {
      const base = 45 + inp.wave * 6;
      const amount = Math.round(base * (0.8 + Math.random() * 0.6) * inp.goldMul);
      return { kind, amount, emoji: '💰', name: '金币补给', desc: `获得 ${amount} 金币` };
    }
    case 'treasure': {
      const amount = Math.round((170 + inp.wave * 16) * inp.goldMul);
      return { kind, amount, emoji: '💎', name: '巨额宝箱！', desc: `一次性获得 ${amount} 金币` };
    }
    case 'interest': {
      const amount = Math.max(20, Math.min(240, Math.round(inp.currentGold * 0.15)));
      return { kind, amount, emoji: '📈', name: '战争红利', desc: `按存款利息返还 ${amount} 金币` };
    }
    case 'damage':
      return { kind, amount: 0.1, emoji: '⚔️', name: '武器强化', desc: '全部防御塔伤害永久 +10%' };
    case 'repair': {
      const amount = Math.min(inp.livesDeficit, inp.wave >= 15 ? 3 : 2);
      return { kind, amount, emoji: '🛡️', name: '基地维修', desc: `修复基地，恢复 ${amount} 点生命` };
    }
    case 'upgrade':
      return { kind, amount: 1, emoji: '⭐', name: '免费升级', desc: '随机一座防御塔免费升一级' };
  }
}
