/**
 * AI 陪练：四个水平档。
 *
 * 关键设计：**不靠随机走牌制造低难度**。
 * 随机 AI 有两个致命问题——它不像人，而且用户从它身上学不到任何东西。
 * 真人新手不是乱打，而是「有一套错的章法」：
 *   哪门少缺哪门、见碰就碰、舍不得拆对子、从不数别人打过什么。
 * 所以这里的分档方式是**决策深度**：每高一档，就多考虑一层真人高手会考虑的东西。
 *
 *   新手 只看单张牌好不好看          —— 会犯典型新手错误，用户容易赢，但错得有教学价值
 *   初级 会算向听，但不数牌不防守     —— 正常人打了几个月的水平
 *   中级 向听 + 进张 + 数牌 + 基础防守 —— 茶馆里打得不错的那种
 *   高级 再加番型规划、弃胡判断、杠的风险评估
 *
 * 所有档位都必须只从引擎给的合法动作里选——AI 不许自己判断规则。
 */

import type { Action, Pending } from '../rules/engine';
import { MahjongEngine } from '../rules/engine';
import {
  RANK_COUNT, Rng, rankOf, suitOf, type Counts, type TileId,
} from '../rules/tiles';
import { analyzeDiscards, fanPotential } from '../analysis/efficiency';
import { analyzeLack, fewestSuit } from '../analysis/dingque';
import { analyzeSwap } from '../analysis/swap';
import { readOpponent, type OpponentRead } from '../analysis/defense';
import { shantenWithLack } from '../analysis/shanten';

export type AiLevel = 'beginner' | 'novice' | 'intermediate' | 'advanced';

export interface AiProfile {
  id: AiLevel;
  name: string;
  /** 一句话描述，选对手时给用户看 */
  desc: string;
  /** 会做什么、不会做什么，让用户知道自己在跟谁打 */
  traits: string[];
  color: string;
}

export const AI_PROFILES: Record<AiLevel, AiProfile> = {
  beginner: {
    id: 'beginner',
    name: '新手',
    desc: '刚学会打，会犯典型新手错误',
    traits: ['哪门牌少就缺哪门', '见碰就碰', '舍不得拆对子', '完全不看别人打了什么'],
    color: '#67c23a',
  },
  novice: {
    id: 'novice',
    name: '初级',
    desc: '会往胡牌方向走，但不防守',
    traits: ['会算还差几张听牌', '碰之前会想一下划不划算', '不数牌', '不防守，该打就打'],
    color: '#409eff',
  },
  intermediate: {
    id: 'intermediate',
    name: '中级',
    desc: '牌效率正常，会基本防守',
    traits: ['向听 + 进张一起算', '会数场上还剩几张', '别人像听牌时会躲危险张', '杠之前会看值不值'],
    color: '#e6a23c',
  },
  advanced: {
    id: 'advanced',
    name: '高级',
    desc: '算得清、会做大牌、也会弃和',
    traits: ['会规划清一色/对对胡这类大牌', '危险时果断弃和保分', '杠会评估风险', '残局会算剩余张数'],
    color: '#f56c6c',
  },
};

export const AI_LEVELS: AiLevel[] = ['beginner', 'novice', 'intermediate', 'advanced'];

/**
 * 三家对手的档位。
 * 真实牌桌上三个人水平从来不一样，混搭比「三个克隆人」更像在打牌，
 * 也更有教学价值：你会看到同一张牌，新手碰了、高手没碰。
 * 混搭时取「低一档 / 本档 / 高一档」，越界就夹住。
 */
export function spreadLevels(level: AiLevel, mixed: boolean): AiLevel[] {
  if (!mixed) return [level, level, level];
  const i = AI_LEVELS.indexOf(level);
  return [
    AI_LEVELS[Math.max(0, i - 1)],
    AI_LEVELS[i],
    AI_LEVELS[Math.min(AI_LEVELS.length - 1, i + 1)],
  ];
}

/** 每档的策略参数。只有这一张表控制差异，改起来一目了然 */
interface Policy {
  /**
   * 出牌时脑子里在算什么：
   *   tileLook 只看单张牌好不好看（新手）
   *   shanten  会算还差几张听牌（初级）
   *   full     向听 + 进张 + 数牌 + 防守（中级以上）
   */
  plan: 'tileLook' | 'shanten' | 'full';
  /** 会不会数已见牌 */
  countsSeen: boolean;
  /** 防守权重，0 = 完全不防 */
  defense: number;
  /** 会不会为番型牺牲一点效率 */
  fanPlanning: boolean;
  /** 碰的倾向：>1 爱碰，<1 谨慎 */
  pengBias: number;
  /** 杠的倾向 */
  gangBias: number;
  /** 定缺是否用「哪门少缺哪门」这种简化规则 */
  naiveLack: boolean;
  /** 换三张是否只看张数 */
  naiveSwap: boolean;
  /** 看错牌的概率（真人手滑，不是用来降难度的主要手段） */
  slip: number;
  /** 落后且别人听牌时会不会弃和 */
  canFold: boolean;
}

const POLICIES: Record<AiLevel, Policy> = {
  beginner: { plan: 'tileLook', countsSeen: false, defense: 0, fanPlanning: false, pengBias: 2.2, gangBias: 2, naiveLack: true, naiveSwap: true, slip: 0.16, canFold: false },
  novice: { plan: 'shanten', countsSeen: false, defense: 0, fanPlanning: false, pengBias: 1.1, gangBias: 1.2, naiveLack: false, naiveSwap: true, slip: 0.06, canFold: false },
  intermediate: { plan: 'full', countsSeen: true, defense: 0.8, fanPlanning: false, pengBias: 1, gangBias: 1, naiveLack: false, naiveSwap: false, slip: 0.015, canFold: false },
  advanced: { plan: 'full', countsSeen: true, defense: 1.15, fanPlanning: true, pengBias: 0.95, gangBias: 0.9, naiveLack: false, naiveSwap: false, slip: 0, canFold: true },
};

/**
 * 新手眼里的「牌好不好看」：只看这一张牌本身热不热闹，不考虑整手结构。
 * 这就是为什么新手会留着一对没用的 9 万到最后——对子看起来就是比孤张值钱。
 */
function noviceTileValue(hand: Counts, t: TileId): number {
  const s = suitOf(t);
  const r = rankOf(t);
  const at = (rr: number) => (rr >= 1 && rr <= RANK_COUNT ? hand[s * RANK_COUNT + rr - 1] : 0);
  let v = 0;
  if (hand[t] >= 2) v += 9 * (hand[t] - 1); // 对子/刻子看得很重
  v += (at(r - 1) + at(r + 1)) * 2.5;
  v += (at(r - 2) + at(r + 2)) * 0.8;
  v += 1 - Math.abs(5 - r) * 0.1; // 中张稍好
  return v;
}

/** 从引擎读出各家的公开情报（只用看得见的，不偷看手牌） */
function readsFor(engine: MahjongEngine, seat: number): OpponentRead[] {
  const round = Math.max(...engine.players.map((p) => p.discards.length));
  return engine.players
    .filter((p) => p.seat !== seat)
    .map((p) =>
      readOpponent({
        seat: p.seat,
        discards: p.discards,
        lack: p.lack,
        meldCount: p.melds.length,
        outOfPlay: p.outOfPlay,
        round,
      }),
    );
}

/** 主入口：给定局面和待决策，返回一个合法动作 */
export function decide(level: AiLevel, engine: MahjongEngine, pending: Pending, rng: Rng): Action {
  const pol = POLICIES[level];
  switch (pending.kind) {
    case 'swap': return decideSwap(engine, pending, pol, rng);
    case 'lack': return decideLack(engine, pending, pol);
    case 'turn': return decideTurn(engine, pending, pol, rng);
    case 'claim': return decideClaim(engine, pending, pol, rng);
  }
}

// ---------------- 换三张 ----------------

function decideSwap(engine: MahjongEngine, pending: Pending, pol: Policy, rng: Rng): Action {
  const p = engine.players[pending.seat];
  if (pol.naiveSwap) {
    // 只看张数：从张数最少（但够三张）的那门里随手挑三张
    const counts = [0, 1, 2].map((s) => {
      let n = 0;
      for (let r = 0; r < RANK_COUNT; r++) n += p.hand[s * RANK_COUNT + r];
      return { s, n };
    }).filter((x) => x.n >= engine.cfg.swap.count).sort((a, b) => a.n - b.n);
    const suit = counts.length ? counts[0].s : 0;
    const same = pending.options.filter((o) => o.type === 'swap' && suitOf(o.tiles[0]) === suit);
    if (same.length) return same[rng.int(same.length)];
    return pending.options[rng.int(pending.options.length)];
  }
  const best = analyzeSwap(engine.cfg, p.hand, pol.countsSeen ? engine.seenBy(pending.seat) : undefined).best;
  const key = [...best.tiles].sort((a, b) => a - b).join(',');
  const match = pending.options.find(
    (o) => o.type === 'swap' && [...o.tiles].sort((a, b) => a - b).join(',') === key,
  );
  return match ?? pending.options[0];
}

// ---------------- 定缺 ----------------

function decideLack(engine: MahjongEngine, pending: Pending, pol: Policy): Action {
  const p = engine.players[pending.seat];
  // 新手就信「哪门少缺哪门」——这正是我们要教用户别犯的错
  const suit = pol.naiveLack ? fewestSuit(p.hand) : analyzeLack(engine.cfg, p.hand, p.melds).best.suit;
  return pending.options.find((o) => o.type === 'lack' && o.suit === suit) ?? pending.options[0];
}

// ---------------- 自己回合 ----------------

function decideTurn(engine: MahjongEngine, pending: Pending, pol: Policy, rng: Rng): Action {
  const seat = pending.seat;
  const p = engine.players[seat];

  // 能胡一定胡（所有档位一致：不胡牌的 AI 不是水平低，是坏掉了）
  const hu = pending.options.find((o) => o.type === 'hu');
  if (hu) return hu;

  // 杠：新手见杠就杠；中级以上要看杠完会不会把手牌拆散、危不危险
  const gangs = pending.options.filter((o) => o.type === 'gang');
  if (gangs.length) {
    const g = gangs[0];
    if (g.type === 'gang' && shouldGang(engine, seat, g.tile, g.kind, pol)) return g;
  }

  const discards = pending.options.filter((o) => o.type === 'discard');
  if (discards.length === 0) return pending.options[0];
  if (discards.length === 1) return discards[0];

  // 手滑：真人偶尔看走眼，但这不是制造难度的主要手段
  if (pol.slip > 0 && rng.next() < pol.slip) return discards[rng.int(discards.length)];

  const legal = discards.map((o) => (o.type === 'discard' ? o.tile : 0));

  // 新手：不算向听，只比单张牌好不好看，所以会留着没用的对子到最后
  if (pol.plan === 'tileLook') {
    let best = legal[0];
    let bestV = Infinity;
    for (const t of legal) {
      const v = noviceTileValue(p.hand, t);
      if (v < bestV) { bestV = v; best = t; }
    }
    return { type: 'discard', seat, tile: best };
  }

  // 初级：会算向听，但不数牌、不防守
  if (pol.plan === 'shanten') {
    const a = analyzeDiscards({
      cfg: engine.cfg, hand: p.hand, melds: p.melds, lack: p.lack,
      legal, wallLeft: engine.wallLeft,
    });
    return { type: 'discard', seat, tile: a.best.tile };
  }

  // 中级 / 高级：全套
  const seen = pol.countsSeen ? engine.seenBy(seat) : undefined;
  const reads = pol.defense > 0 ? readsFor(engine, seat) : [];
  const a = analyzeDiscards({
    cfg: engine.cfg, hand: p.hand, melds: p.melds, lack: p.lack,
    seen, reads, legal, wallLeft: engine.wallLeft,
  });

  let options = a.options;

  // 高级：落后又打不赢的时候弃和，专打安全张
  if (pol.canFold && shouldFold(engine, a.currentShanten, reads)) {
    options = [...a.options].sort((x, y) => x.danger - y.danger || y.ukeire - x.ukeire);
    return { type: 'discard', seat, tile: options[0].tile };
  }

  // 防守权重按档位再调一次（analyzeDiscards 里已经算过一遍基础危险度）
  if (pol.defense !== 1 && reads.length) {
    options = [...a.options].sort(
      (x, y) => (y.score - y.danger * 100 * (pol.defense - 1)) - (x.score - x.danger * 100 * (pol.defense - 1)),
    );
  }

  // 高级：做大牌的苗头明显时，容忍一点效率损失
  if (pol.fanPlanning) {
    const pot = fanPotential(engine.cfg, p.hand, p.melds, p.lack);
    if (pot.qingyise > 0.72 && a.currentShanten >= 1) {
      const main = mainSuit(p.hand, p.lack);
      const offSuit = options.filter((o) => suitOf(o.tile) !== main);
      if (offSuit.length && offSuit[0].score > options[0].score - 45) {
        return { type: 'discard', seat, tile: offSuit[0].tile };
      }
    }
  }

  return { type: 'discard', seat, tile: options[0].tile };
}

function mainSuit(hand: Counts, lack: number): number {
  const n = [0, 0, 0];
  for (let t = 0; t < 27; t++) n[suitOf(t)] += hand[t];
  let best = 0;
  let bn = -1;
  for (let s = 0; s < 3; s++) {
    if (s === lack) continue;
    if (n[s] > bn) { bn = n[s]; best = s; }
  }
  return best;
}

/** 该不该杠：杠了会不会把手牌拆散、牌墙够不够、是不是把听牌杠没了 */
function shouldGang(engine: MahjongEngine, seat: number, tile: TileId, kind: string, pol: Policy): boolean {
  if (pol.gangBias >= 2) return true; // 新手：见杠就杠
  const p = engine.players[seat];
  const allowSeven = engine.cfg.win.sevenPairs && p.melds.length === 0;
  const before = shantenWithLack(p.hand, p.melds.length, allowSeven, p.lack);
  const after = p.hand.slice();
  if (kind === 'angang') after[tile] -= 4;
  else after[tile] -= 1;
  const shAfter = shantenWithLack(after, p.melds.length + (kind === 'angang' ? 1 : 0), false, p.lack);
  if (shAfter > before) return false; // 杠完更远了，不杠
  // 七对路线绝对不能暗杠（四张是两对，杠了就没了）
  if (allowSeven && kind === 'angang') {
    let pairs = 0;
    for (let t = 0; t < 27; t++) if (p.hand[t] >= 2) pairs++;
    if (pairs >= 5) return false;
  }
  // 牌墙太少时杠等于把摸牌机会送人
  if (engine.wallLeft < 8 && pol.gangBias < 1) return false;
  return true;
}

/** 该不该弃和：自己还远、别人听了、牌墙也不多了 */
function shouldFold(engine: MahjongEngine, myShanten: number, reads: OpponentRead[]): boolean {
  const threats = reads.filter((r) => !r.outOfPlay && r.ting).length;
  if (threats === 0) return false;
  if (myShanten <= 1) return false;
  return myShanten >= 3 || engine.wallLeft <= 14;
}

// ---------------- 响应别人的牌 ----------------

function decideClaim(engine: MahjongEngine, pending: Pending, pol: Policy, rng: Rng): Action {
  const seat = pending.seat;
  const p = engine.players[seat];
  const pass = pending.options.find((o) => o.type === 'pass')!;

  const hu = pending.options.find((o) => o.type === 'hu');
  if (hu) return hu; // 能胡就胡

  const tile = pending.tile!;
  const gang = pending.options.find((o) => o.type === 'gang');
  const peng = pending.options.find((o) => o.type === 'peng');

  if (gang && shouldGang(engine, seat, tile, 'gang', pol)) return gang;
  if (!peng) return pass;

  // 新手：见碰就碰（碰完一手废牌是新手最典型的毛病）
  if (pol.pengBias >= 2) return rng.next() < 0.9 ? peng : pass;

  const allowSeven = engine.cfg.win.sevenPairs && p.melds.length === 0;
  const before = shantenWithLack(p.hand, p.melds.length, allowSeven, p.lack);
  const after = p.hand.slice();
  after[tile] -= 2;
  const shAfter = shantenWithLack(after, p.melds.length + 1, false, p.lack);

  if (shAfter < before) return peng; // 碰了更近，碰
  if (shAfter > before) return pass; // 碰了更远，不碰
  // 持平：做对对胡、或者边张刻子时碰划算
  const pengCount = p.melds.filter((m) => m.kind === 'peng').length;
  const r = rankOf(tile);
  const worth = pengCount >= 1 || r <= 2 || r >= 8;
  if (!worth) return pass;
  // 高级：碰完会不会没牌打（手上全是缺门/危险张）也要想
  if (pol.canFold) {
    const reads = readsFor(engine, seat);
    if (reads.some((x) => x.ting) && before >= 3) return pass;
  }
  return rng.next() < pol.pengBias * 0.8 ? peng : pass;
}

/**
 * 跑完一局：用于自动模拟、出题和回归测试。
 * 每个座位可以配不同档位的 AI。
 */
export function playOut(
  engine: MahjongEngine,
  levels: AiLevel[],
  seed = 1,
  maxSteps = 4000,
): { steps: number; ok: boolean; error?: string } {
  const rng = new Rng(seed);
  let steps = 0;
  while (engine.phase !== 'over' && steps < maxSteps) {
    const pending = engine.pending();
    if (!pending) break;
    const level = levels[pending.seat % levels.length];
    const action = decide(level, engine, pending, rng);
    try {
      engine.apply(action);
    } catch (e) {
      return { steps, ok: false, error: `${level} 出了非法动作：${(e as Error).message}` };
    }
    steps++;
  }
  return { steps, ok: engine.phase === 'over' };
}
