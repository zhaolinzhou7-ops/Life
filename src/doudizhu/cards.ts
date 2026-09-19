/**
 * 斗地主牌库：54 张牌的数据结构、洗牌、发牌。
 *
 * 两个硬性约定，后面所有模块都依赖它们：
 * 1. **牌型判断只看 rank 数字，永远不看 label 字符串**。名字是给人看的，
 *    一旦有人用 "2" 去比大小，2 就会排在 10 后面，错得很隐蔽。
 * 2. **每张牌有全局唯一 id**，同点数不同花色也是两张不同的牌。
 *    没有唯一 id，从手牌里"移除这张牌"就只能按点数删，选中三张 5 里的哪两张
 *    会变成随机的，回放和一致性校验也无从做起。
 */

/** 花色：四门 + 王（王没有花色，单独一类） */
export type Suit = 'spade' | 'heart' | 'club' | 'diamond' | 'joker';

/**
 * 点数权重。斗地主里 2 比 A 大、王最大，所以不能直接用面值。
 * 3..10 = 3..10，J=11 Q=12 K=13 A=14 2=15 小王=16 大王=17。
 * 顺子只能用 3..A（<= RANK_A），这条在牌型识别里反复用到。
 */
export type Rank = number;

export const RANK_3 = 3;
export const RANK_A = 14;
export const RANK_2 = 15;
export const RANK_JOKER_SMALL = 16;
export const RANK_JOKER_BIG = 17;

/** 顺子/连对/飞机的点数上界：到 A 为止，2 和王都不能参与 */
export const MAX_CHAIN_RANK = RANK_A;

export interface Card {
  /** 全局唯一标识，如 "S3" "HK" "jo-s"。同一副牌里不会重复 */
  readonly id: string;
  readonly suit: Suit;
  /** 比较大小用的点数权重，见 Rank */
  readonly rank: Rank;
  /** 显示名："3" "J" "2" "小王" */
  readonly label: string;
  /** 排序权重：先按点数，同点数按固定花色序，保证手牌排列稳定 */
  readonly order: number;
}

const SUIT_SYMBOL: Record<Suit, string> = {
  spade: '♠',
  heart: '♥',
  club: '♣',
  diamond: '♦',
  joker: '',
};

const SUIT_ORDER: Record<Suit, number> = {
  spade: 3,
  heart: 2,
  club: 1,
  diamond: 0,
  joker: 4,
};

const SUIT_CODE: Record<Suit, string> = {
  spade: 'S',
  heart: 'H',
  club: 'C',
  diamond: 'D',
  joker: 'J',
};

/** 点数 -> 显示名 */
export function rankLabel(rank: Rank): string {
  switch (rank) {
    case 11:
      return 'J';
    case 12:
      return 'Q';
    case 13:
      return 'K';
    case 14:
      return 'A';
    case 15:
      return '2';
    case RANK_JOKER_SMALL:
      return '小王';
    case RANK_JOKER_BIG:
      return '大王';
    default:
      return String(rank);
  }
}

export const isJoker = (c: Card) => c.suit === 'joker';
export const isRed = (c: Card) => c.suit === 'heart' || c.suit === 'diamond' || c.rank === RANK_JOKER_BIG;
export const suitSymbol = (c: Card) => SUIT_SYMBOL[c.suit];

/** 牌面文字，用于日志和 AI 解释："♠3" "大王" */
export function cardName(c: Card): string {
  return isJoker(c) ? c.label : `${SUIT_SYMBOL[c.suit]}${c.label}`;
}

export function cardsName(cards: readonly Card[]): string {
  return sortCards(cards).map(cardName).join(' ');
}

function makeCard(suit: Suit, rank: Rank): Card {
  const label = rankLabel(rank);
  const id = suit === 'joker' ? (rank === RANK_JOKER_BIG ? 'jo-big' : 'jo-small') : `${SUIT_CODE[suit]}${rank}`;
  return { id, suit, rank, label, order: rank * 10 + SUIT_ORDER[suit] };
}

const SUITS: Suit[] = ['spade', 'heart', 'club', 'diamond'];

/** 一副新牌：3..A、2、小王、大王，共 54 张，顺序固定（未洗） */
export function createDeck(): Card[] {
  const deck: Card[] = [];
  for (let rank = RANK_3; rank <= RANK_2; rank++) {
    for (const suit of SUITS) deck.push(makeCard(suit, rank));
  }
  deck.push(makeCard('joker', RANK_JOKER_SMALL));
  deck.push(makeCard('joker', RANK_JOKER_BIG));
  return deck;
}

/**
 * 可复现的伪随机数发生器（mulberry32）。
 *
 * 用它而不是 Math.random 的原因：牌局状态要可序列化、可复盘。
 * 存下种子就能一模一样地重放一整局，出了 bug 也能拿种子复现。
 */
export function createRng(seed: number) {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Rng = () => number;

/** Fisher-Yates 洗牌，原地打乱并返回同一个数组 */
export function shuffle<T>(items: T[], rng: Rng): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}

/** 手牌排序：大的在右（升序），同点数按花色定序，保证每次渲染位置一致 */
export function sortCards(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => a.order - b.order);
}

/** 从大到小，AI 拆牌时更顺手 */
export function sortCardsDesc(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => b.order - a.order);
}

export interface DealResult {
  /** 三家手牌，各 17 张，已排序 */
  hands: [Card[], Card[], Card[]];
  /** 底牌 3 张 */
  bottom: Card[];
}

/** 洗牌并发牌：17 / 17 / 17 + 3 张底牌 */
export function deal(rng: Rng): DealResult {
  const deck = shuffle(createDeck(), rng);
  const hands: [Card[], Card[], Card[]] = [[], [], []];
  for (let i = 0; i < 51; i++) hands[i % 3].push(deck[i]);
  return {
    hands: [sortCards(hands[0]), sortCards(hands[1]), sortCards(hands[2])],
    bottom: sortCards(deck.slice(51)),
  };
}

/** 按点数分组：rank -> 该点数的牌，便于牌型识别和 AI 拆牌 */
export function groupByRank(cards: readonly Card[]): Map<Rank, Card[]> {
  const map = new Map<Rank, Card[]>();
  for (const c of cards) {
    const list = map.get(c.rank);
    if (list) list.push(c);
    else map.set(c.rank, [c]);
  }
  return map;
}

/** 点数计数表：rank -> 张数 */
export function countByRank(cards: readonly Card[]): Map<Rank, number> {
  const map = new Map<Rank, number>();
  for (const c of cards) map.set(c.rank, (map.get(c.rank) ?? 0) + 1);
  return map;
}

/** 从 from 里按 id 移除 cards；缺牌直接抛错（说明上层状态已经坏了，不能继续） */
export function removeCards(from: readonly Card[], cards: readonly Card[]): Card[] {
  const drop = new Set(cards.map((c) => c.id));
  const rest = from.filter((c) => !drop.has(c.id));
  if (from.length - rest.length !== drop.size) {
    throw new Error(`removeCards: 手牌里找不到要移除的牌（期望移除 ${drop.size} 张，实际 ${from.length - rest.length} 张）`);
  }
  return rest;
}

/** 手牌里是否包含这些牌（按唯一 id 判定） */
export function containsAll(hand: readonly Card[], cards: readonly Card[]): boolean {
  const ids = new Set(hand.map((c) => c.id));
  return cards.every((c) => ids.has(c.id));
}
