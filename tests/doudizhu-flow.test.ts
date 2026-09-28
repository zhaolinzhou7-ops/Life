/**
 * 牌局流程测试：发牌、叫地主、底牌、出牌、不要、连续不要、出完、结算。
 *
 * 重点不是"能跑通"，而是那些**错了也不会立刻报错**的地方：
 * 底牌有没有真的进地主手里、连续两次不要之后该谁出、倍数算得对不对、
 * 结算分数是不是零和。这些错了，玩家只会觉得"怪怪的"，却说不出哪里不对。
 */
import { describe, expect, it } from 'vitest';
import { createDeck, createRng, deal, sortCards } from '../src/doudizhu/cards';
import {
  checkConsistency,
  createGame,
  legalBids,
  pass,
  placeBid,
  playCards,
  resolveAllPass,
  serialize,
  deserialize,
  totalMultiplier,
  type GameState,
  type Seat,
} from '../src/doudizhu/game';
import { hand } from './doudizhu-helpers';

describe('牌库与发牌', () => {
  it('一副牌 54 张，没有重复 id', () => {
    const deck = createDeck();
    expect(deck.length).toBe(54);
    expect(new Set(deck.map((c) => c.id)).size).toBe(54);
  });

  it('每个点数 4 张，大小王各 1 张', () => {
    const deck = createDeck();
    for (let r = 3; r <= 15; r++) expect(deck.filter((c) => c.rank === r).length).toBe(4);
    expect(deck.filter((c) => c.rank === 16).length).toBe(1);
    expect(deck.filter((c) => c.rank === 17).length).toBe(1);
  });

  it('发牌 17/17/17 + 3 张底牌，一张不多一张不少', () => {
    const r = deal(createRng(42));
    expect(r.hands.map((h) => h.length)).toEqual([17, 17, 17]);
    expect(r.bottom.length).toBe(3);
    const all = [...r.hands.flat(), ...r.bottom];
    expect(all.length).toBe(54);
    expect(new Set(all.map((c) => c.id)).size).toBe(54);
  });

  it('同一个种子发出来的牌完全一样（可复现，才能回放）', () => {
    const a = deal(createRng(777));
    const b = deal(createRng(777));
    expect(a.hands[0].map((c) => c.id)).toEqual(b.hands[0].map((c) => c.id));
    expect(a.bottom.map((c) => c.id)).toEqual(b.bottom.map((c) => c.id));
  });

  it('不同种子发出来的牌不一样（洗牌真的洗了）', () => {
    const a = deal(createRng(1));
    const b = deal(createRng(2));
    expect(a.hands[0].map((c) => c.id)).not.toEqual(b.hands[0].map((c) => c.id));
  });

  it('手牌是排好序的', () => {
    const r = deal(createRng(9));
    for (const h of r.hands) expect(h.map((c) => c.order)).toEqual(sortCards(h).map((c) => c.order));
  });
});

describe('叫地主', () => {
  it('开局是叫分阶段，三家各 17 张，没有地主', () => {
    const g = createGame({ seed: 1 });
    expect(g.phase).toBe('bidding');
    expect(g.landlord).toBe(null);
    expect(g.players.every((p) => p.hand.length === 17)).toBe(true);
    expect(checkConsistency(g)).toEqual([]);
  });

  it('只能不叫或者叫更高的分', () => {
    const g = createGame({ seed: 2, firstBidder: 0 });
    expect(legalBids(g)).toEqual([0, 1, 2, 3]);
    placeBid(g, 0, 2);
    expect(legalBids(g)).toEqual([0, 3]);
    const bad = placeBid(g, 1, 1);
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('2');
  });

  it('叫 3 分直接封顶，不用问后面的人', () => {
    const g = createGame({ seed: 3, firstBidder: 0 });
    const r = placeBid(g, 0, 3);
    expect(r.settled).toBe(true);
    expect(g.landlord).toBe(0);
    expect(g.bidScore).toBe(3);
    expect(g.phase).toBe('playing');
  });

  it('一人一次，最高分当地主', () => {
    const g = createGame({ seed: 4, firstBidder: 0 });
    placeBid(g, 0, 1);
    placeBid(g, 1, 2);
    const r = placeBid(g, 2, 0);
    expect(r.settled).toBe(true);
    expect(g.landlord).toBe(1);
    expect(g.bidScore).toBe(2);
  });

  it('地主拿到 3 张底牌，变成 20 张，且由地主先出', () => {
    const g = createGame({ seed: 5, firstBidder: 0 });
    const bottomIds = g.bottom.map((c) => c.id);
    placeBid(g, 0, 3);
    expect(g.players[0].hand.length).toBe(20);
    expect(g.players[1].hand.length).toBe(17);
    expect(g.players[2].hand.length).toBe(17);
    const handIds = g.players[0].hand.map((c) => c.id);
    for (const id of bottomIds) expect(handIds).toContain(id);
    expect(g.bottomRevealed).toBe(true);
    expect(g.currentPlayer).toBe(0);
    expect(checkConsistency(g)).toEqual([]);
  });

  it('还没轮到就叫分会被拒绝', () => {
    const g = createGame({ seed: 6, firstBidder: 0 });
    const r = placeBid(g, 2, 3);
    expect(r.ok).toBe(false);
  });

  it('三家都不叫：按配置重新发牌', () => {
    let g = createGame({ seed: 7, firstBidder: 0, config: { onAllPass: 'redeal' } });
    placeBid(g, 0, 0);
    placeBid(g, 1, 0);
    const r = placeBid(g, 2, 0);
    expect(r.allPassed).toBe(true);
    g = resolveAllPass(g);
    expect(g.phase).toBe('bidding');
    expect(g.redeals).toBe(1);
    expect(g.players.every((p) => p.hand.length === 17)).toBe(true);
    expect(checkConsistency(g)).toEqual([]);
  });

  it('三家都不叫：配置成随机指定时直接定一个地主', () => {
    let g = createGame({ seed: 8, firstBidder: 0, config: { onAllPass: 'random' } });
    placeBid(g, 0, 0);
    placeBid(g, 1, 0);
    placeBid(g, 2, 0);
    g = resolveAllPass(g);
    expect(g.phase).toBe('playing');
    expect(g.landlord).not.toBe(null);
    expect(g.players[g.landlord!].hand.length).toBe(20);
  });
});

/** 开一局并把地主定成 seat，方便测出牌 */
function gameWithLandlord(seed: number, seat: Seat = 0): GameState {
  const g = createGame({ seed, firstBidder: seat });
  placeBid(g, seat, 3);
  return g;
}

describe('出牌与不要', () => {
  it('地主先出，第一手不能不要', () => {
    const g = gameWithLandlord(11, 0);
    expect(g.currentPlayer).toBe(0);
    const r = pass(g, 0);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不能不要');
  });

  it('出不在手里的牌会被拒绝', () => {
    const g = gameWithLandlord(12, 0);
    const notMine = g.players[1].hand[0];
    const r = playCards(g, 0, [notMine]);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('不在手牌里');
  });

  it('还没轮到就出牌会被拒绝', () => {
    const g = gameWithLandlord(13, 0);
    const r = playCards(g, 1, [g.players[1].hand[0]]);
    expect(r.ok).toBe(false);
  });

  it('出牌之后手牌减少、弃牌堆增加、轮到下家', () => {
    const g = gameWithLandlord(14, 0);
    const card = g.players[0].hand[0];
    const before = g.players[0].hand.length;
    const r = playCards(g, 0, [card]);
    expect(r.ok).toBe(true);
    expect(g.players[0].hand.length).toBe(before - 1);
    expect(g.discards.map((c) => c.id)).toContain(card.id);
    expect(g.currentPlayer).toBe(1);
    expect(checkConsistency(g)).toEqual([]);
  });

  it('压不住的牌会被拒绝，并说明原因', () => {
    const g = createGame({
      seed: 15,
      firstBidder: 0,
      debug: { landlord: 0, hands: [hand('5'), hand('3'), hand('4')] as never },
    });
    playCards(g, 0, hand('5'));
    const r = playCards(g, 1, g.players[1].hand);
    expect(r.ok).toBe(false);
    expect(r.reason).toBeTruthy();
    expect(r.reason).not.toBe('出牌失败');
  });

  it('连续两家不要：回到出牌那家，自由出牌，轮次 +1', () => {
    const g = gameWithLandlord(16, 0);
    playCards(g, 0, [g.players[0].hand[0]]);
    const round = g.round;
    pass(g, 1);
    const r = pass(g, 2);
    expect(r.newRound).toBe(true);
    expect(g.currentPlayer).toBe(0);
    expect(g.currentMove).toBe(null);
    expect(g.passCount).toBe(0);
    expect(g.round).toBe(round + 1);
  });

  it('只有一家不要时轮转到下一家，桌面牌还在', () => {
    const g = gameWithLandlord(17, 0);
    playCards(g, 0, [g.players[0].hand[0]]);
    pass(g, 1);
    expect(g.currentPlayer).toBe(2);
    expect(g.currentMove).not.toBe(null);
    expect(g.passCount).toBe(1);
  });
});

describe('倍数与结算', () => {
  it('炸弹翻倍，王炸也翻倍', () => {
    const g = createGame({
      seed: 21,
      debug: {
        landlord: 0,
        hands: [hand('3333444'), hand('55566'), hand('77788')] as never,
      },
    });
    expect(totalMultiplier(g)).toBe(3); // 叫分 3 × 倍数 1
    playCards(g, 0, hand('3333'));
    expect(g.bombCount).toBe(1);
    expect(g.multiplier).toBe(2);
    expect(totalMultiplier(g)).toBe(6);
  });

  it('地主出完牌 -> 地主赢，分数是零和', () => {
    const g = createGame({
      seed: 22,
      debug: { landlord: 0, hands: [hand('3'), hand('55566'), hand('77788')] as never },
    });
    const r = playCards(g, 0, hand('3'));
    expect(r.finished).toBe(true);
    expect(g.phase).toBe('finished');
    expect(g.result!.winner).toBe('landlord');
    expect(g.result!.scores.reduce((a, b) => a + b, 0)).toBe(0);
    expect(g.result!.scores[0]).toBeGreaterThan(0);
    expect(g.result!.scores[1]).toBeLessThan(0);
  });

  it('农民出完牌 -> 农民赢，两个农民都加分', () => {
    const g = createGame({
      seed: 23,
      debug: { landlord: 0, hands: [hand('33'), hand('4'), hand('77788')] as never, currentPlayer: 0 },
    });
    playCards(g, 0, hand('3'));
    const r = playCards(g, 1, g.players[1].hand);
    expect(r.finished).toBe(true);
    expect(g.result!.winner).toBe('farmers');
    expect(g.result!.scores[1]).toBeGreaterThan(0);
    expect(g.result!.scores[2]).toBeGreaterThan(0);
    expect(g.result!.scores[0]).toBeLessThan(0);
    expect(g.result!.scores.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('春天：农民一张没出，倍数翻倍', () => {
    const g = createGame({
      seed: 24,
      debug: { landlord: 0, hands: [hand('3'), hand('4'), hand('5')] as never },
    });
    playCards(g, 0, hand('3'));
    expect(g.result!.spring).toBe('spring');
    expect(g.result!.multiplier).toBe(2);
  });

  it('反春：地主只出了开局那一手就被打光', () => {
    const g = createGame({
      seed: 25,
      debug: { landlord: 0, hands: [hand('33'), hand('4'), hand('5')] as never },
    });
    playCards(g, 0, hand('3'));
    playCards(g, 1, hand('4'));
    expect(g.phase).toBe('finished');
    expect(g.result!.spring).toBe('anti-spring');
    expect(g.result!.multiplier).toBe(2);
  });

  it('地主赢的分是农民的两倍', () => {
    const g = createGame({
      seed: 26,
      debug: { landlord: 1, hands: [hand('55566'), hand('3'), hand('77788')] as never, currentPlayer: 1 },
    });
    playCards(g, 1, hand('3'));
    const s = g.result!.scores;
    expect(s[1]).toBe(-2 * s[0]);
    expect(s[0]).toBe(s[2]);
  });
});

describe('状态一致性自检', () => {
  it('正常牌局每一步都通过', () => {
    const g = gameWithLandlord(31, 0);
    expect(checkConsistency(g)).toEqual([]);
    playCards(g, 0, [g.players[0].hand[0]]);
    expect(checkConsistency(g)).toEqual([]);
    pass(g, 1);
    expect(checkConsistency(g)).toEqual([]);
  });

  it('手动把一张牌复制一份 -> 立刻被查出来', () => {
    const g = gameWithLandlord(32, 0);
    g.players[1].hand.push(g.players[1].hand[0]);
    const problems = checkConsistency(g);
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.join()).toMatch(/不止一次|牌数/);
  });

  it('手动删掉一张牌 -> 立刻被查出来', () => {
    const g = gameWithLandlord(33, 0);
    g.players[2].hand.pop();
    expect(checkConsistency(g).length).toBeGreaterThan(0);
  });

  it('地主标记错了 -> 被查出来', () => {
    const g = gameWithLandlord(34, 0);
    g.players[1].isLandlord = true;
    expect(checkConsistency(g).join()).toContain('地主标记');
  });

  it('出牌引擎发现状态坏掉时直接抛错，不让错误牌局继续', () => {
    const g = gameWithLandlord(35, 0);
    g.players[1].hand.pop();
    expect(() => playCards(g, 0, [g.players[0].hand[0]])).toThrow(/状态异常/);
  });
});

describe('序列化', () => {
  it('存下来再读回去，牌局一模一样', () => {
    const g = gameWithLandlord(41, 0);
    playCards(g, 0, [g.players[0].hand[0]]);
    pass(g, 1);
    const json = serialize(g);
    const back = deserialize(json);
    expect(back.players.map((p) => p.hand.map((c) => c.id))).toEqual(g.players.map((p) => p.hand.map((c) => c.id)));
    expect(back.currentPlayer).toBe(g.currentPlayer);
    expect(back.round).toBe(g.round);
    expect(back.discards.length).toBe(g.discards.length);
    expect(serialize(back)).toBe(json);
  });

  it('牌局状态是纯数据，没有函数/类实例', () => {
    const g = gameWithLandlord(42, 0);
    const json = JSON.parse(serialize(g));
    expect(typeof json).toBe('object');
    expect(json.players[0].hand[0]).toHaveProperty('id');
    expect(json.players[0].hand[0]).toHaveProperty('rank');
  });

  it('出牌记录足够回放：每条都有轮次、座位和具体的牌', () => {
    const g = gameWithLandlord(43, 0);
    playCards(g, 0, [g.players[0].hand[0]]);
    const play = g.history.find((h) => h.kind === 'play')!;
    expect(play.seat).toBe(0);
    expect(play.cards!.length).toBe(1);
    expect(play.moveType).toBe('single');
    expect(play.round).toBeGreaterThan(0);
  });
});
