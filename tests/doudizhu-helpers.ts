/**
 * 斗地主测试用的小工具：用字符串摆牌，比手写 Card 对象可读得多。
 *
 * 写法："34567" / "333 444 55" / "3-3" 表示同点数的第二张（花色不同）。
 * 点数用一个字符：3456789 T J Q K A 2，X=小王 D=大王。
 */
import { createDeck, sortCards, type Card, type Rank } from '../src/doudizhu/cards';

const CHAR_TO_RANK: Record<string, Rank> = {
  '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14, '2': 15, X: 16, D: 17,
};

/**
 * 按点数取牌：同一个点数重复出现就自动换花色，
 * 所以 "333" 拿到的是三张不同花色的 3，符合真实牌局。
 */
export function hand(spec: string): Card[] {
  const deck = createDeck();
  const used = new Set<string>();
  const out: Card[] = [];
  for (const ch of spec.replace(/[\s,|]/g, '')) {
    const rank = CHAR_TO_RANK[ch.toUpperCase()];
    if (rank === undefined) throw new Error(`看不懂的牌：${ch}`);
    const card = deck.find((c) => c.rank === rank && !used.has(c.id));
    if (!card) throw new Error(`${ch} 用超过 4 张了`);
    used.add(card.id);
    out.push(card);
  }
  return sortCards(out);
}

/** 牌面点数序列，断言时比 id 直观 */
export const ranksOf = (cards: readonly Card[]) => cards.map((c) => c.rank).sort((a, b) => a - b);

/**
 * 一次摆多家的牌。
 *
 * 单独调用 hand() 各摆各的，会从同一副新牌里重复取到同一张（比如两家都拿 ♠3），
 * 摆出一个现实里不存在的牌局。这个函数从**同一副牌**里分配，杜绝这种事。
 */
export function hands(...specs: string[]): Card[][] {
  const deck = createDeck();
  const used = new Set<string>();
  return specs.map((spec) => {
    const out: Card[] = [];
    for (const ch of spec.replace(/[\s,|]/g, '')) {
      const rank = CHAR_TO_RANK[ch.toUpperCase()];
      if (rank === undefined) throw new Error(`看不懂的牌：${ch}`);
      const card = deck.find((c) => c.rank === rank && !used.has(c.id));
      if (!card) throw new Error(`${ch} 在这一副牌里已经用完 4 张了`);
      used.add(card.id);
      out.push(card);
    }
    return sortCards(out);
  });
}
