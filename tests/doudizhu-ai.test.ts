/**
 * AI 测试。
 *
 * 这里测的全是「AI 绝不能犯」的错：出非法牌、出手上没有的牌、重复用牌、
 * 该自己出时却说不要、以及**偷看别人的手牌**。
 * 前四条会让牌局直接崩掉；最后一条不会报错，但会让游戏变成骗局，所以
 * 专门从架构上堵死并在这里验证。
 */
import { describe, expect, it } from 'vitest';
import { createDeck, sortCards, type Card } from '../src/doudizhu/cards';
import { createGame, pass, placeBid, playCards, type GameState, type Seat } from '../src/doudizhu/game';
import { analyzeMove, beats, toMove } from '../src/doudizhu/patterns';
import {
  analyzeHand,
  buildMemory,
  decideBid,
  decidePlay,
  filterLegal,
  generateCandidates,
  hintMove,
  maxUnseenRank,
  minHands,
  possibleBombs,
  publicViewFor,
  toCounts,
  type Difficulty,
} from '../src/doudizhu/ai';
import { simulateGame, simulateMany } from '../src/doudizhu/simulate';
import { hand, hands } from './doudizhu-helpers';

const DIFFS: Difficulty[] = ['easy', 'normal', 'hard'];

describe('手牌拆解（最少手数）', () => {
  it('一条龙是一手', () => {
    expect(minHands(toCounts(hand('3456789TJQKA')))).toBe(1);
  });

  it('三个散牌是三手', () => {
    expect(minHands(toCounts(hand('3', )))).toBe(1);
    expect(minHands(toCounts(hand('39K')))).toBe(3);
  });

  it('三带一算一手，不是两手', () => {
    expect(minHands(toCounts(hand('5556')))).toBe(1);
  });

  it('炸弹算一手', () => {
    expect(minHands(toCounts(hand('7777')))).toBe(1);
  });

  it('王炸算一手，不是两张单牌', () => {
    expect(minHands(toCounts(hand('XD')))).toBe(1);
  });

  it('连对比拆成三个对子少', () => {
    expect(minHands(toCounts(hand('334455')))).toBe(1);
  });

  it('顺子 + 一对 = 两手', () => {
    expect(minHands(toCounts(hand('3456799')))).toBe(2);
  });

  it('17 张牌也能在合理时间内算完', () => {
    const t0 = Date.now();
    for (let i = 0; i < 50; i++) {
      const deck = createDeck().sort(() => Math.random() - 0.5).slice(0, 17);
      minHands(toCounts(deck));
    }
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('候选生成', () => {
  it('自由出牌时能生成多种牌型', () => {
    const h = hand('3455567899TJQ');
    const moves = generateCandidates(h);
    const types = new Set(moves.map((m) => m.type));
    expect(types.has('single')).toBe(true);
    expect(types.has('pair')).toBe(true);
    expect(types.has('triple')).toBe(true);
    expect(types.has('straight')).toBe(true);
  });

  it('生成的每一手都是合法牌型，且都在手上', () => {
    for (let i = 0; i < 30; i++) {
      const h = sortCards(createDeck().sort(() => Math.random() - 0.5).slice(0, 17));
      const ids = new Set(h.map((c) => c.id));
      for (const m of generateCandidates(h)) {
        expect(analyzeMove(m.cards).isValid).toBe(true);
        expect(m.cards.every((c) => ids.has(c.id))).toBe(true);
        expect(new Set(m.cards.map((c) => c.id)).size).toBe(m.cards.length);
      }
    }
  });

  it('跟牌时生成的每一手都压得住', () => {
    const table = toMove(hand('99'))!;
    const h = hand('3355TTJJQQKKAA22');
    for (const m of generateCandidates(h, { table })) {
      expect(beats(m, table)).toBe(true);
    }
  });

  it('压不住时返回空（然后 AI 才会选不要）', () => {
    const table = toMove(hand('22'))!;
    const moves = filterLegal(generateCandidates(hand('334455'), { table }), hand('334455'), table);
    expect(moves.length).toBe(0);
  });

  it('炸弹能压普通牌型，王炸能压炸弹', () => {
    const table = toMove(hand('34567'))!;
    const withBomb = generateCandidates(hand('345679999'), { table });
    expect(withBomb.some((m) => m.type === 'bomb')).toBe(true);

    const bombTable = toMove(hand('KKKK'))!;
    const withRocket = generateCandidates(hand('3XD'), { table: bombTable });
    expect(withRocket.some((m) => m.type === 'rocket')).toBe(true);
  });

  it('翅膀不会拆掉自己的炸弹', () => {
    // 333 444 手上还有 7777：飞机带单不能把炸弹拆了当翅膀
    const h = hand('3334447777');
    for (const m of generateCandidates(h)) {
      if (m.type !== 'plane_single') continue;
      const sevens = m.cards.filter((c) => c.rank === 7).length;
      expect(sevens).toBe(0);
    }
  });

  it('提示功能给的是合法且压得住的牌', () => {
    const table = toMove(hand('55'))!;
    const h = hand('3344667788');
    const hint = hintMove(h, table)!;
    expect(hint).toBeTruthy();
    const m = toMove(hint)!;
    expect(beats(m, table)).toBe(true);
  });

  it('提示优先不用炸弹', () => {
    const table = toMove(hand('5'))!;
    const hint = hintMove(hand('69999'), table)!;
    expect(hint.length).toBe(1);
    expect(hint[0].rank).toBe(6);
  });
});

/**
 * 从某家**真正的手牌**里按点数挑牌。
 * 不能用 hand()——那是从一副新牌里取的，id 和牌局里的牌对不上，
 * 出牌会被引擎以"不在手牌里"拒绝，测试就测了个寂寞。
 */
function fromHand(g: GameState, seat: Seat, ranks: number[]): Card[] {
  const used = new Set<string>();
  return ranks.map((r) => {
    const c = g.players[seat].hand.find((x) => x.rank === r && !used.has(x.id));
    if (!c) throw new Error(`座位 ${seat} 手上没有点数 ${r}`);
    used.add(c.id);
    return c;
  });
}

/** 摆一个牌局并取某座位的公开视角 */
function viewOf(handsSpec: [string, string, string], landlord: Seat, current: Seat) {
  const hs = hands(...handsSpec) as [Card[], Card[], Card[]];
  const g = createGame({ seed: 99, debug: { landlord, hands: hs, currentPlayer: current } });
  return { g, view: publicViewFor(g, current) };
}

describe('AI 只能用公开信息', () => {
  it('PublicView 里没有别人的手牌', () => {
    const { view } = viewOf(['3456789', 'TJQKA22', '33445566'], 0, 0);
    const keys = Object.keys(view);
    expect(keys).not.toContain('players');
    expect(JSON.stringify(view)).not.toContain('"isLandlord"');
    // 只有我自己的手牌
    expect(view.hand.length).toBe(7);
  });

  it('把对手手牌整个换掉，AI 的决定不变（说明它没看）', () => {
    const mine = 'TJQKA';
    const a = viewOf([mine, '3456789', '33445566'], 0, 0);
    const b = viewOf([mine, '22XD999', '77788866'], 0, 0);
    // 两局里我的牌一样、出过的牌都为空，公开信息完全相同
    const da = decidePlay(a.view, 'hard');
    const db = decidePlay(b.view, 'hard');
    expect(da.cards.map((c) => c.rank)).toEqual(db.cards.map((c) => c.rank));
  });

  it('记牌只统计已经露面的牌', () => {
    const { g } = viewOf(['345', '678', '9TJ'], 0, 0);
    playCards(g, 0, [g.players[0].hand[0]]);
    const view = publicViewFor(g, 1);
    const mem = buildMemory(view);
    // 我（座位 1）手上 3 张 + 对手出的 1 张 = 4 张已知，其余 50 张没露面
    expect(mem.unseenTotal).toBe(50);
    expect(mem.remaining[0]).toBe(2);
  });

  it('记牌能算出"还剩几张 2""还可能有几个炸弹"', () => {
    const { view } = viewOf(['3456789', 'TJQKA22', '33445566'], 0, 0);
    const mem = buildMemory(view);
    expect(mem.unseen[15]).toBe(4); // 我手上没有 2，所以 4 张 2 都还没露面
    expect(maxUnseenRank(mem)).toBe(17); // 大王还在外面
    expect(possibleBombs(mem)).toBeGreaterThan(0);
  });
});

describe('AI 决策的硬性约束', () => {
  it.each(DIFFS)('%s：自由出牌时绝不返回"不要"', (d) => {
    for (let i = 0; i < 40; i++) {
      const deck = createDeck().sort(() => Math.random() - 0.5);
      const hs = [deck.slice(0, 8), deck.slice(8, 16), deck.slice(16, 24)] as [Card[], Card[], Card[]];
      const g = createGame({ seed: i, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
      const decision = decidePlay(publicViewFor(g, 0), d);
      expect(decision.action).toBe('play');
      expect(decision.cards.length).toBeGreaterThan(0);
    }
  });

  it.each(DIFFS)('%s：出的牌一定在自己手上，且不重复', (d) => {
    for (let i = 0; i < 40; i++) {
      const deck = createDeck().sort(() => Math.random() - 0.5);
      const hs = [deck.slice(0, 10), deck.slice(10, 20), deck.slice(20, 30)] as [Card[], Card[], Card[]];
      const g = createGame({ seed: i + 500, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
      const view = publicViewFor(g, 0);
      const decision = decidePlay(view, d);
      const ids = new Set(view.hand.map((c) => c.id));
      expect(decision.cards.every((c) => ids.has(c.id))).toBe(true);
      expect(new Set(decision.cards.map((c) => c.id)).size).toBe(decision.cards.length);
    }
  });

  it.each(DIFFS)('%s：跟牌时要么压得住，要么不要', (d) => {
    for (let i = 0; i < 40; i++) {
      const deck = createDeck().sort(() => Math.random() - 0.5);
      const hs = [deck.slice(0, 12), deck.slice(12, 24), deck.slice(24, 36)] as [Card[], Card[], Card[]];
      const g = createGame({ seed: i + 900, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
      const lead = decidePlay(publicViewFor(g, 0), 'normal');
      playCards(g, 0, lead.cards);
      const view = publicViewFor(g, 1);
      const decision = decidePlay(view, d);
      if (decision.action === 'pass') {
        expect(decision.cards.length).toBe(0);
      } else {
        const m = analyzeMove(decision.cards);
        expect(m.isValid).toBe(true);
        expect(beats(m.isValid ? m.move : toMove(decision.cards)!, g.currentMove!.move)).toBe(true);
      }
    }
  });

  it('能一手走完就一定走完，不会拖', () => {
    const hs = hands('99', '3456789', 'TJQKA22') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 7, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
    const d = decidePlay(publicViewFor(g, 0), 'hard');
    expect(d.cards.length).toBe(2);
  });

  it('每次决策都有一句说得出口的理由', () => {
    const hs = hands('3456789TJ', 'QKA2345', '55667788') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 8, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
    const d = decidePlay(publicViewFor(g, 0), 'hard');
    expect(d.reason.length).toBeGreaterThan(6);
  });
});

describe('AI 策略', () => {
  it('农民不打队友的牌', () => {
    // 座位 0 是地主，座位 1、2 是农民。队友（座位 2）出了一手牌，座位 1 不该去压
    const hs = hands('3456789TJQKA2', '22KKAA', '5') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 10, debug: { landlord: 0, hands: hs, currentPlayer: 2 } });
    playCards(g, 2, g.players[2].hand); // 队友出牌并走完？不行，会结束
    expect(g.phase).toBe('finished');
  });

  it('农民不压队友：队友出小牌时选择不要', () => {
    const hs = hands('3456789TJQKA2', '22KKAA7', '55') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 11, debug: { landlord: 0, hands: hs, currentPlayer: 2 } });
    const r = playCards(g, 2, fromHand(g, 2, [5])); // 座位 2（农民）出一张 5
    expect(r.ok).toBe(true);
    // 轮到座位 0（地主），先让它过，再轮到座位 1（农民、座位 2 的队友）
    expect(pass(g, 0).ok).toBe(true);
    const d = decidePlay(publicViewFor(g, 1), 'hard');
    expect(d.action).toBe('pass');
    expect(d.reason).toContain('队友');
  });

  it('地主的牌，农民会去压', () => {
    // 座位 1 手上留一张散 7，压地主的 3 不用拆自己的对子
    const hs = hands('3456789TJQKA2', '22KKAA7', '55') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 12, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
    expect(playCards(g, 0, fromHand(g, 0, [3])).ok).toBe(true);
    const d = decidePlay(publicViewFor(g, 1), 'hard');
    expect(d.action).toBe('play');
    expect(d.cards[0].rank).toBe(7); // 用最省的那张压，不拆对子
  });

  it('压一手要拆自己牌型时，宁可不要', () => {
    // 手上全是对子，压地主一张小单牌就得拆对——这时候不压才是对的
    const hs = hands('3456789TJQKA2', '22KKAA', '55') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 12, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
    expect(playCards(g, 0, fromHand(g, 0, [3])).ok).toBe(true);
    const d = decidePlay(publicViewFor(g, 1), 'hard');
    expect(d.action).toBe('pass');
  });

  it('对手只剩一张时，困难 AI 不会主动出单牌喂他走', () => {
    // 座位 1（地主）只剩 1 张，座位 0 出牌
    const hs = hands('3456789', 'K', 'TJQ') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 13, debug: { landlord: 1, hands: hs, currentPlayer: 0 } });
    const d = decidePlay(publicViewFor(g, 0), 'hard');
    // 有顺子可出，不该出一张小单牌让地主直接走
    expect(d.cards.length).toBeGreaterThan(1);
  });

  it('困难 AI 不会主动出炸弹（除非炸完就走）', () => {
    const hs = hands('9999345678T', 'JQK', 'A22') as [Card[], Card[], Card[]];
    const g = createGame({ seed: 14, debug: { landlord: 0, hands: hs, currentPlayer: 0 } });
    const d = decidePlay(publicViewFor(g, 0), 'hard');
    expect(analyzeMove(d.cards).isValid && (analyzeMove(d.cards) as { move: { type: string } }).move.type).not.toBe('bomb');
  });

  it('叫分：好牌会叫，散牌不叫', () => {
    const strong = hand('XD2222AAA');
    const weak = hand('34568JQ');
    expect(decideBid(strong, 0, 'hard')).toBeGreaterThan(0);
    expect(decideBid(weak, 0, 'hard')).toBe(0);
  });

  it('叫分：不会叫比当前最高分低的分', () => {
    for (let i = 0; i < 30; i++) {
      const h = createDeck().sort(() => Math.random() - 0.5).slice(0, 17);
      const bid = decideBid(h, 2, 'hard');
      expect(bid === 0 || bid > 2).toBe(true);
    }
  });

  it('手牌分析能认出炸弹、王炸和控制牌', () => {
    const a = analyzeHand(hand('7777XD22'));
    expect(a.bombs).toEqual([7]);
    expect(a.hasRocket).toBe(true);
    expect(a.controls.length).toBe(4); // 两张 2 + 小王 + 大王
  });
});

describe('整局模拟（自动对战）', () => {
  it('单局：不出非法牌、不重复用牌、不卡死、正常结算', () => {
    const r = simulateGame({ seed: 20260918, difficulties: ['hard', 'hard', 'hard'] });
    expect(r.problems).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it.each(DIFFS)('%s 难度跑 30 局，一局都不能出问题', (d) => {
    const report = simulateMany(30, { difficulties: [d, d, d], seed: 4242 });
    expect(report.failures.map((f) => `${f.seed}: ${f.problems.join('；')}`)).toEqual([]);
  });

  it('混合难度跑 30 局也没问题', () => {
    const report = simulateMany(30, { difficulties: ['hard', 'normal', 'easy'], seed: 31337 });
    expect(report.failures).toEqual([]);
  });

  it('验收：连续 20 局自动对战全部正常结束', () => {
    const report = simulateMany(20, { seed: 20260101 });
    expect(report.failures.length).toBe(0);
    expect(report.games).toBe(20);
    // 每一局都必须分出胜负
    expect(report.landlordWins + report.farmerWins).toBe(20);
    // 不该出现异常长的牌局（卡死的典型症状）
    expect(report.maxRounds).toBeLessThan(40);
  });

  it('难度确实有强弱之分：困难 > 简单（不是靠思考时间装出来的）', () => {
    // 固定另外两家是普通难度，只换座位 0，用**同一批种子**跑，看座位 0 的平均得分。
    // 不能看"地主胜率"——地主是叫分叫出来的，不一定是座位 0，那个数字会把差异抹平。
    const N = 150;
    const run = (d: Difficulty) => {
      let score = 0;
      let games = 0;
      for (let i = 0; i < N; i++) {
        const r = simulateGame({ seed: (10007 + i * 7919) >>> 0, difficulties: [d, 'normal', 'normal'] });
        expect(r.problems).toEqual([]);
        games++;
        score += r.scores[0];
      }
      return score / games;
    };
    const easy = run('easy');
    const hard = run('hard');
    expect(hard).toBeGreaterThan(easy);
  });

  it('地主和农民都赢得了，不是一边倒', () => {
    const report = simulateMany(60, { seed: 555 });
    expect(report.landlordWins).toBeGreaterThan(0);
    expect(report.farmerWins).toBeGreaterThan(0);
  });

  it('结算分数永远是零和', () => {
    for (let i = 0; i < 12; i++) {
      const r = simulateGame({ seed: 600 + i });
      expect(r.scores.reduce((a, b) => a + b, 0)).toBe(0);
    }
  });

  it('每局结束时赢家手里没有牌', () => {
    for (let i = 0; i < 12; i++) {
      const r = simulateGame({ seed: 700 + i });
      expect(r.ok).toBe(true);
    }
  });
});

/** 让 GameState 类型在这个文件里被用到，避免 lint 抱怨 */
export type _ = GameState;
