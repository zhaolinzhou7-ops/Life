/** 难度分级数值 */
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyDef {
  label: string;
  /** 敌人血量倍率 */
  hpMul: number;
  /** 敌人移速倍率 */
  speedMul: number;
  /** 初始金币 */
  startGold: number;
  /** 击杀/波次奖励倍率 */
  goldMul: number;
  /** 基地生命 */
  lives: number;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  easy: { label: '简单', hpMul: 0.72, speedMul: 0.9, startGold: 620, goldMul: 1.2, lives: 25 },
  normal: { label: '中等', hpMul: 1.0, speedMul: 1.0, startGold: 480, goldMul: 1.0, lives: 20 },
  hard: { label: '困难', hpMul: 1.32, speedMul: 1.08, startGold: 400, goldMul: 0.85, lives: 15 },
};

export const DIFFICULTY_ORDER: Difficulty[] = ['easy', 'normal', 'hard'];

export const TOTAL_WAVES = 25;

/** 敌人血量随波次的成长曲线 */
export function waveHpScale(wave: number): number {
  const w = wave - 1;
  return 1 + 0.2 * w + 0.011 * w * w;
}

/** 击杀奖励随波次微涨 */
export function waveGoldScale(wave: number): number {
  return 1 + 0.03 * wave;
}

/** 波次通关奖励 */
export function waveBonus(wave: number): number {
  return 40 + 8 * wave;
}
