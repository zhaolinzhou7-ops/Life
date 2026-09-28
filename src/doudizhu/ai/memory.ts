/**
 * AI 记牌器。
 *
 * **这一层的存在本身就是一道安全栏。** AI 只拿得到 PublicView——里面有我自己的
 * 手牌、公开的底牌、每家出过的牌、每家剩几张，**没有别人手里具体是什么牌**。
 * 类型上就拿不到，所以"AI 偷看真人手牌"这种事在结构上不可能发生，
 * 不需要靠自觉，也能写成测试。
 *
 * 在这个前提下，AI 能推断的是：**哪些牌还没露面**。
 * 我的手牌 + 所有人出过的牌 + 我看得见的底牌，剩下的就是两个对手手里的牌。
 */
import { RANK_2, RANK_3, RANK_JOKER_BIG, RANK_JOKER_SMALL, createDeck, type Card, type Rank } from '../cards';
import type { Move } from '../patterns';
import type { GameState, Seat, TableMove } from '../game';
import { EMPTY_COUNTS, toCounts, type RankCounts } from './analysis';

/**
 * 一个座位能看到的全部信息。AI 的所有函数都只收这个，不收 GameState。
 * 少了 players[].hand，就没有任何途径读到别人的手牌。
 */
export interface PublicView {
  seat: Seat;
  /** 我自己的手牌 */
  hand: Card[];
  landlord: Seat;
  /** 底牌：确定地主后对所有人公开 */
  bottom: Card[];
  /** 三家各剩几张（公开信息） */
  handCounts: [number, number, number];
  /** 三家出过的牌（公开信息） */
  playedBySeat: [Card[], Card[], Card[]];
  currentMove: TableMove | null;
  multiplier: number;
  round: number;
  /** 本轮里在我之前"不要"的人 */
  passedSeats: Seat[];
}

/** 从牌局状态里裁出某个座位的公开视角。**这是唯一一处把 state 转成 AI 输入的地方** */
export function publicViewFor(state: GameState, seat: Seat): PublicView {
  if (state.landlord === null) throw new Error('还没定地主，构造不出出牌视角');
  const passed: Seat[] = [];
  // 从历史里回溯本轮谁已经不要了
  for (let i = state.history.length - 1; i >= 0; i--) {
    const h = state.history[i];
    if (h.kind === 'pass') passed.push(h.seat);
    else if (h.kind === 'play') break;
  }
  return {
    seat,
    hand: [...state.players[seat].hand],
    landlord: state.landlord,
    bottom: state.bottomRevealed ? [...state.bottom] : [],
    handCounts: state.players.map((p) => p.hand.length) as [number, number, number],
    playedBySeat: [
      [...state.playedBySeat[0]],
      [...state.playedBySeat[1]],
      [...state.playedBySeat[2]],
    ],
    currentMove: state.currentMove,
    multiplier: state.multiplier,
    round: state.round,
    passedSeats: passed,
  };
}

export interface CardMemory {
  /** 还没露面的牌（= 两个对手手上的牌）的点数分布 */
  unseen: RankCounts;
  /** 还没露面的总张数 */
  unseenTotal: number;
  /** 各家出过的牌 */
  playedBy: [RankCounts, RankCounts, RankCounts];
  /** 各家剩余张数 */
  remaining: [number, number, number];
  /** 我知道在地主手里的底牌（他还没打出去的那部分） */
  knownInLandlordHand: RankCounts;
}

/**
 * 记牌：算出还没露面的牌。
 *
 * 一副 54 张 = 我的手牌 + 三家已出的牌 + 两个对手手上的牌。
 * 底牌已经进了地主手里，所以不单独扣，但它是**公开的**，
 * 高难度 AI 会用它推断地主的牌型（比如底牌开出一对 2）。
 */
export function buildMemory(view: PublicView): CardMemory {
  const unseen = EMPTY_COUNTS();
  for (const c of createDeck()) unseen[c.rank]++;
  for (const c of view.hand) unseen[c.rank]--;
  for (const seatCards of view.playedBySeat) for (const c of seatCards) unseen[c.rank]--;

  const playedBy: [RankCounts, RankCounts, RankCounts] = [
    toCounts(view.playedBySeat[0]),
    toCounts(view.playedBySeat[1]),
    toCounts(view.playedBySeat[2]),
  ];

  // 底牌里还没被地主打出去的那几张，是"已知在地主手上"的牌
  const knownInLandlordHand = EMPTY_COUNTS();
  if (view.seat !== view.landlord) {
    const lordPlayed = playedBy[view.landlord].slice();
    for (const c of view.bottom) {
      if (lordPlayed[c.rank] > 0) lordPlayed[c.rank]--;
      else knownInLandlordHand[c.rank]++;
    }
  }

  let unseenTotal = 0;
  for (let r = RANK_3; r <= RANK_JOKER_BIG; r++) {
    if (unseen[r] < 0) unseen[r] = 0; // 理论上不会发生，兜底防止负数传播
    unseenTotal += unseen[r];
  }

  return {
    unseen,
    unseenTotal,
    playedBy,
    remaining: view.handCounts,
    knownInLandlordHand,
  };
}

/** 某个点数还剩几张没露面 */
export const unseenOf = (mem: CardMemory, rank: Rank) => mem.unseen[rank];

/** 还没露面的最大单牌点数；没有牌了返回 -1 */
export function maxUnseenRank(mem: CardMemory): Rank {
  for (let r = RANK_JOKER_BIG; r >= RANK_3; r--) if (mem.unseen[r] > 0) return r;
  return -1;
}

/** 对手是否还可能有王炸 */
export function rocketPossible(mem: CardMemory): boolean {
  return mem.unseen[RANK_JOKER_SMALL] > 0 && mem.unseen[RANK_JOKER_BIG] > 0;
}

/** 对手还可能有几个炸弹（点数上还凑得齐四张的） */
export function possibleBombs(mem: CardMemory): number {
  let n = 0;
  for (let r = RANK_3; r <= RANK_2; r++) if (mem.unseen[r] === 4) n++;
  return n + (rocketPossible(mem) ? 1 : 0);
}

/**
 * 这张单牌现在安全吗——出去之后还有没有人压得住。
 * 用于"记牌教学"和高难度 AI 判断手里的牌是不是已经变成绝对控制牌。
 */
export function isUnbeatableSingle(mem: CardMemory, rank: Rank): boolean {
  return maxUnseenRank(mem) < rank;
}

/** 这手牌还有没有人压得住（只看普通牌型，不算炸弹） */
export function isUnbeatableMove(mem: CardMemory, move: Move): boolean {
  switch (move.type) {
    case 'rocket':
      return true;
    case 'single':
      return isUnbeatableSingle(mem, move.mainRank);
    case 'pair': {
      for (let r = move.mainRank + 1; r <= RANK_2; r++) if (mem.unseen[r] >= 2) return false;
      return !rocketPossible(mem) && possibleBombs(mem) === 0;
    }
    case 'bomb': {
      for (let r = move.mainRank + 1; r <= RANK_2; r++) if (mem.unseen[r] === 4) return false;
      return !rocketPossible(mem);
    }
    default:
      // 复杂牌型的严格判断收益不大，保守地认为可能被压
      return false;
  }
}

/**
 * 记牌教学用的问答素材："现在还可能剩几张 2？""地主可能还有炸弹吗？"
 * 这些数字全部来自公开信息，玩家自己也能数出来。
 */
export interface MemoryFacts {
  twosLeft: number;
  smallJokerLeft: boolean;
  bigJokerLeft: boolean;
  possibleBombs: number;
  rocketPossible: boolean;
  biggestOutstanding: Rank;
  remaining: [number, number, number];
}

export function memoryFacts(mem: CardMemory): MemoryFacts {
  return {
    twosLeft: mem.unseen[RANK_2],
    smallJokerLeft: mem.unseen[RANK_JOKER_SMALL] > 0,
    bigJokerLeft: mem.unseen[RANK_JOKER_BIG] > 0,
    possibleBombs: possibleBombs(mem),
    rocketPossible: rocketPossible(mem),
    biggestOutstanding: maxUnseenRank(mem),
    remaining: mem.remaining,
  };
}
