import { ENEMY_STATS, type EnemyStats } from '../entities/enemy';
import { TOTAL_WAVES, waveHpScale } from './economy';

export interface SpawnItem {
  stats: EnemyStats;
  /** 出生使用的路线索引 */
  routeIndex: number;
  /** 相对波次开始的出生时间（秒） */
  time: number;
}

export interface WaveDef {
  index: number; // 1..TOTAL_WAVES
  isBoss: boolean;
  items: SpawnItem[];
  /** 该波敌人的血量倍率（叠加难度） */
  hpScale: number;
}

/** 依据波次号程序化生成一波敌人（在若干路线间分配） */
export function buildWave(wave: number, routeCount: number): WaveDef {
  const isBoss = wave % 5 === 0;
  const hpScale = waveHpScale(wave);
  const items: SpawnItem[] = [];
  let t = 0;

  const push = (kind: keyof typeof ENEMY_STATS, gap: number) => {
    items.push({
      stats: ENEMY_STATS[kind],
      routeIndex: items.length % routeCount,
      time: t,
    });
    t += gap;
  };

  if (isBoss) {
    // Boss 波：前排小兵护送 + Boss
    const escort = 4 + Math.floor(wave / 5) * 2;
    for (let i = 0; i < escort; i++) push(i % 2 === 0 ? 'normal' : 'tank', 0.6);
    t += 1;
    push('boss', 0);
    if (wave >= 15) {
      t += 0.5;
      for (let i = 0; i < 3; i++) push('fly', 0.7);
    }
  } else {
    const count = 8 + wave; // 数量随波次增加
    for (let i = 0; i < count; i++) {
      let kind: keyof typeof ENEMY_STATS = 'normal';
      const roll = Math.random();
      if (wave >= 3 && roll < 0.28) kind = 'fast';
      else if (wave >= 5 && roll < 0.45) kind = 'tank';
      else if (wave >= 8 && roll > 0.82) kind = 'fly';
      const gap = kind === 'fast' ? 0.45 : kind === 'tank' ? 0.9 : 0.6;
      push(kind, gap);
    }
  }

  return { index: wave, isBoss, items, hpScale };
}

export function totalWaves(): number {
  return TOTAL_WAVES;
}
