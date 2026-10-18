/**
 * 各档对手全部用皮卡鱼（Pikafish）走棋，靠两样东西控制棋力：
 *
 *   1. **搜索量按节点数给，不按时间给**。按时间给的话，同一档在旧手机上算得浅、
 *      在新电脑上算得深，棋力跟着设备走；节点数到哪台机器上都一样。
 *      节点少 = 算得浅 = 深一点的战术看不见——这正是人会犯的错。
 *   2. **从前几名里按分差随机挑**，而不是永远走第一名：分差越小越可能被挑中
 *      （温度 temp），亏得太多的不挑（maxLoss），偶尔"看走眼"（slip）放宽一次。
 *      挑的都是引擎前几名里的着法，不会出现人绝不会走的怪棋。
 *
 * 这个皮卡鱼版本没有 Skill Level / UCI_Elo 这类开关，所以削弱在这里做。
 * 每一档值多少分（AI_LEVEL_RATING）是拿 tools/calibrate-levels.ts 和旧引擎各档
 * 对下实测出来的，不是估的。
 */
import type { Move } from './rules';

export interface LevelCfg {
  /** 每步搜多少个节点（和设备快慢无关）。不给就用 movetime */
  nodes?: number;
  /** 每步最多想多久（毫秒）。和 nodes 一起给时只是封顶：先到哪个算哪个 */
  movetime?: number;
  /** 看前几名 */
  multipv: number;
  /** 分差温度（车≈1000）：越大越随便 */
  temp: number;
  /** 比最好的一手亏这么多以上的不挑 */
  maxLoss: number;
  /** 每步有这么大概率"看走眼"：上限放宽到 slipLoss */
  slip: number;
  slipLoss: number;
}

export interface Cand {
  move: Move;
  /** 走棋方视角，车≈1000 */
  score: number;
  mateIn?: number;
}

/**
 * 从引擎的前几名里挑一手。cands 按引擎名次排好（第一名在前）。
 * 纯函数（随机数从外面给），浏览器和离线校准工具用的是同一份。
 */
export function chooseMove(cands: Cand[], cfg: LevelCfg, rand: () => number = Math.random): Move | null {
  if (!cands.length) return null;
  const best = cands[0];
  // 一步杀谁都不会放过；要被一步杀时引擎第一名就是唯一的解，也不乱挑
  if (cfg.multipv <= 1 || (best.mateIn !== undefined && best.mateIn > 0 && best.mateIn <= 1)) return best.move;
  const cap = rand() < cfg.slip ? cfg.slipLoss : cfg.maxLoss;
  const pool = cands
    .map((c) => ({ c, loss: Math.max(0, best.score - c.score) }))
    // 自己走进一步杀的不挑（引擎名次里会出现被杀的着法，但人再弱也看得见"下一步就被将死"）
    .filter(({ c, loss }) => loss <= cap && !(c.mateIn !== undefined && c.mateIn < 0 && c.mateIn >= -1 && !(best.mateIn !== undefined && best.mateIn < 0)));
  if (pool.length <= 1) return best.move;
  const w = pool.map(({ loss }) => Math.exp(-loss / Math.max(1, cfg.temp)));
  let r = rand() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) {
    r -= w[i];
    if (r <= 0) return pool[i].c.move;
  }
  return pool[pool.length - 1].c.move;
}

/**
 * 十四档的配置：国手往下是削弱过的皮卡鱼，国手 · 二段往上不削弱、只差算多深。
 * 每一档值多少分见 save.ts 的 AI_LEVEL_RATING（对下实测）。
 * 同一个引擎，节点数和温度差一点强弱就差很多（5000 节点和 7000 节点对下是 2.5 比 13.5），
 * 所以高级、大师两档只差一小步——实战分落在一千三到一千五的人最多，这一段不能断。
 */
export const PIKA_LEVELS: LevelCfg[] = [
  { nodes: 600, multipv: 8, temp: 220, maxLoss: 700, slip: 0.15, slipLoss: 1500 },
  { nodes: 1500, multipv: 7, temp: 140, maxLoss: 450, slip: 0.08, slipLoss: 1000 },
  { nodes: 2500, multipv: 6, temp: 110, maxLoss: 380, slip: 0.06, slipLoss: 900 },
  { nodes: 5000, multipv: 6, temp: 80, maxLoss: 280, slip: 0.05, slipLoss: 600 },
  // 大师
  { nodes: 6000, multipv: 6, temp: 72, maxLoss: 250, slip: 0.045, slipLoss: 550 },
  // 大师 · 二段
  { nodes: 8000, multipv: 6, temp: 62, maxLoss: 220, slip: 0.04, slipLoss: 480 },
  // 大师 · 三段（新）：补大师 · 二段和特级大师之间一百六十分的空。
  // 先试的 1 万节点对特级大师 40 盘 +15 =5 -20，几乎一样强，退到 9000 节点、挑得松一点，正好落在中间
  { nodes: 9000, multipv: 5, temp: 58, maxLoss: 210, slip: 0.038, slipLoss: 460 },
  // 特级大师
  { nodes: 12000, multipv: 5, temp: 50, maxLoss: 180, slip: 0.03, slipLoss: 400 },
  // 特级大师 · 二段、三段、国手：节点越来越多，挑着法越来越认真，看走眼越来越少。
  // 国手原来试的是 8 万节点、只在前两名里挑：对棋王 5 盘一胜四和，和棋王分不开，退到 5 万节点、温度放一点
  { nodes: 20000, multipv: 4, temp: 35, maxLoss: 130, slip: 0.02, slipLoss: 300 },
  { nodes: 40000, multipv: 3, temp: 22, maxLoss: 80, slip: 0.01, slipLoss: 200 },
  { nodes: 50000, multipv: 2, temp: 16, maxLoss: 60, slip: 0.008, slipLoss: 160 },
  // 下面三档不再削弱：每步都走引擎认定的第一名，只差算多深。
  // 用户原话："最高水平的应该没有漏招才对，每一步都必须精准。"
  // 原来棋王是"每步想 3 秒"：电脑上算 45 万个局面，手机慢两三倍，估计只有一二十万——同一档换台设备就弱一截。
  // 现在按节点数给，到哪台设备上都算这么多（movetime 只是封顶，免得特别慢的手机一步想太久）。
  // tools/top-level-check.ts 实测（36 个中局局面，拿 400 万节点复核）：20 万节点以上没有一手亏到一个兵，
  // 100 万节点最多亏 0.4 个兵。
  // 国手 · 二段（新）
  { nodes: 150000, movetime: 8000, multipv: 1, temp: 0, maxLoss: 0, slip: 0, slipLoss: 0 },
  // 棋王：全力
  { nodes: 450000, movetime: 15000, multipv: 1, temp: 0, maxLoss: 0, slip: 0, slipLoss: 0 },
  // 棋圣（新）：全力再加码
  { nodes: 1200000, movetime: 25000, multipv: 1, temp: 0, maxLoss: 0, slip: 0, slipLoss: 0 },
];
