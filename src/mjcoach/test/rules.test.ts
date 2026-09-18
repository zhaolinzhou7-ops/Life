/**
 * 规则测试套件（Rule Test Suite）。
 *
 * 每条四川麻将规则至少一条用例，输出里能直接看到
 * 规则名称 / 测试案例 / 预期结果 / 实际结果 / PASS·FAIL。
 * 规则有多个版本的（见 config.DIVERGENCES），分别按 A/B/C 三套方案各测一遍，
 * 确认不同配置真的会产生不同结果——不然「规则可配置」就是句空话。
 */

import { check, checkThrows, checkTrue, suite } from './runner';
import {
  VARIANT_CHENGDU, VARIANT_TEACH, VARIANT_XUELIU, deriveVariant, listVariants,
} from '../rules/config';
import {
  formatHand, parseCounts, parseHand, tileOf, tileName, toCounts, Rng,
  type Meld,
} from '../rules/tiles';
import {
  bestTingFan, canWinShape, evaluateWin, isAllTriplets, isSevenPairs, isStandardWin, scoreWin, waitingTiles,
} from '../rules/win';
import { MahjongEngine, replay, type Action } from '../rules/engine';
import { settleDraw } from '../rules/settle';

const M = (r: number) => tileOf(0, r); // 万
const S = (r: number) => tileOf(1, r); // 条
const P = (r: number) => tileOf(2, r); // 筒
const peng = (t: number): Meld => ({ kind: 'peng', tile: t, from: 1 });

/**
 * 「路人甲」手牌：13 张全是筒，孤张为主，碰不到别人打的万/条，自己也胡不了。
 * 摆它是为了让响应顺序只由被测的那两家决定，不被随机手牌干扰。
 */
const NEUTRAL = '147258369p 1472p';

/** 开一局并把换三张/定缺按指定选择走完，回到正式行牌 */
function boot(cfg = VARIANT_CHENGDU, seed = 20240917) {
  const e = new MahjongEngine({ config: cfg, seed });
  e.start();
  for (;;) {
    const p = e.pending();
    if (!p) break;
    if (p.kind === 'swap') e.apply(p.options[0]);
    else if (p.kind === 'lack') e.apply(p.options[0]);
    else break;
  }
  return e;
}

/** 直接摆牌：测试要的是特定局面，不是等随机发到 */
function setHand(e: MahjongEngine, seat: number, hand: string, melds: Meld[] = [], lack = -1) {
  const p = e.players[seat];
  p.hand = parseCounts(hand);
  p.melds = melds;
  if (lack >= 0) p.lack = lack;
}

export function runRuleTests() {
  // ==================== 牌与工具 ====================
  suite('牌的表示', () => {
    check('编码：3万 的 id', 2, () => M(3));
    check('编码：1条 的 id', 9, () => S(1));
    check('编码：9筒 的 id', 26, () => P(9));
    check('名称：id 26', '9筒', () => tileName(26));
    check('简写解析 "123m" 得到三张万', ['1万', '2万', '3万'], () => parseHand('123m').map(tileName));
    check('简写解析中文 "3万4条"', ['3万', '4条'], () => parseHand('3万4条').map(tileName));
    check('简写回写', '123m 55s', () => formatHand(parseHand('123m 55s')));
    check('一副牌共 108 张', 108, () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 1 });
      e.start();
      return e.wall.length + e.players.reduce((n, p) => n + p.hand.reduce((a, b) => a + b, 0), 0);
    });
    check('同一种子洗出同一副牌', true, () => {
      const a = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 99 });
      const b = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 99 });
      a.start(); b.start();
      return JSON.stringify(a.wall) === JSON.stringify(b.wall);
    });
    check('不同种子洗出不同牌', false, () => {
      const a = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 1 });
      const b = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 2 });
      a.start(); b.start();
      return JSON.stringify(a.wall) === JSON.stringify(b.wall);
    });
  });

  // ==================== 胡牌规则 ====================
  suite('胡牌规则 · 牌型', () => {
    check('标准型：123m456m789m11s222s 可胡', true, () => isStandardWin(parseCounts('123456789m 11s 222s')));
    check('差一张：123m456m789m11s22s 不可胡', false, () => isStandardWin(parseCounts('123456789m 11s 22s')));
    check('将牌在别门也算：111m222m333m444m 11p', true, () => isStandardWin(parseCounts('111222333444m 11p')));
    check('顺子不能跨花色：789m12s3s 不成面子', false, () => isStandardWin(parseCounts('789m 123s 111p 22p 99m')));
    check('七对：11223344556677m', true, () => isSevenPairs(parseCounts('11223344556677m')));
    check('七对：有单张不算', false, () => isSevenPairs(parseCounts('1122334455667m 8m')));
    check('龙七对牌型也满足七对判定', true, () => isSevenPairs(parseCounts('11112233445566m')));
    check('对对胡：111m222m333s44p + 碰', true, () => isAllTriplets(parseCounts('111222m 333s 44p')));
    check('对对胡：手里四张不算刻子', false, () => isAllTriplets(parseCounts('1111222m 333s 44p')));
  });

  suite('胡牌规则 · 定缺限制', () => {
    const cfg = VARIANT_CHENGDU;
    check('手上有缺门牌一律不能胡', false, () =>
      canWinShape(cfg, parseCounts('123456789m 11s 222s'), [], 1));
    check('缺门是筒、手上没筒，可以胡', true, () =>
      canWinShape(cfg, parseCounts('123456789m 11s 222s'), [], 2));
    // 注意 11223344556677m 本身也是 123+123+456+456+77 的标准型，验门清得挑个只能靠七对胡的牌
    check('七对有碰过就不算（必须门清）', false, () =>
      canWinShape(cfg, parseCounts('1133557799m 2244s'), [peng(P(1))], 2));
    check('同一手牌门清时可以七对胡', true, () =>
      canWinShape(cfg, parseCounts('1133557799m 2244s'), [], 2));
    check('关掉缺门限制后同一手牌能胡', true, () => {
      const noLack = deriveVariant(cfg, { lack: { winRequiresNoLack: false } }, 'x', 'x');
      return canWinShape(noLack, parseCounts('123456789m 11s 222s'), [], 1);
    });
  });

  suite('胡牌规则 · 听牌', () => {
    const cfg = VARIANT_CHENGDU;
    check('单钓：四副面子齐了，单吊 5 条', ['5条'], () =>
      waitingTiles(cfg, parseCounts('123456789m 111s 5s'), [], 2).map(tileName));
    check('两面：条子 1234 听 1 条和 4 条', ['1条', '4条'], () =>
      waitingTiles(cfg, parseCounts('123456789m 1234s'), [], 2).map(tileName));
    check('两面：123m456m78m 11s + 碰 听 6m9m', ['6万', '9万'], () =>
      waitingTiles(cfg, parseCounts('12345678m 11s'), [peng(P(1))], 2).map(tileName).slice(0, 9)
        .filter((n) => n === '6万' || n === '9万'));
    check('缺门牌在手时听牌数为 0', 0, () =>
      waitingTiles(cfg, parseCounts('123456789m 111s 5s'), [], 1).length);
    check('听牌判断不把缺门牌算进听张', true, () =>
      waitingTiles(cfg, parseCounts('12345678m 11s'), [peng(P(1))], 2).every((t) => t < 18));
  });

  // ==================== 番型与计分 ====================
  suite('番型计分 · 成都血战到底', () => {
    const cfg = VARIANT_CHENGDU;
    const sc = (hand: string, melds: Meld[] = [], opts: Partial<Parameters<typeof scoreWin>[1]> = {}) =>
      scoreWin(cfg, { hand: parseCounts(hand), melds, lack: -1, winTile: 0, zimo: false, ...opts });

    check('平胡 1 番', 1, () => sc('123456789m 11s 222s').fan);
    check('平胡番型名', ['平胡'], () => sc('123456789m 11s 222s').names);
    check('对对胡 ×2', 2, () => sc('111222m 333s 999s 44p').fan);
    check('清一色 ×4', 4, () => sc('123456789m 234m 11m').fan);
    check('清一色 + 对对胡 = ×8', 8, () => sc('111222333m 999m 44m').fan);
    // 七对系列的手牌要混着两门，不然会连清一色一起算进去
    check('七对 ×4', 4, () => sc('1133557799m 2244s').fan);
    check('龙七对 ×8（且不再算七对）', 8, () => sc('11113355m 2244s 99s').fan);
    check('龙七对番型名只列龙七对', ['龙七对'], () => sc('11113355m 2244s 99s').names);
    check('双龙七对 ×16', 16, () => sc('11112222m 3344s 55s').fan);
    check('自摸翻倍：平胡自摸 = 2', 2, () => sc('123456789m 11s 222s', [], { zimo: true }).fan);
    check('根：手里四张相同 ×2', 2, () => sc('1111m 23m 456m 789s 99s').fan);
    check('根：番型名里带次数', ['平胡', '根'], () => sc('1111m 23m 456m 789s 99s').names);
    check('杠上花 ×2', 2, () => sc('123456789m 11s 222s', [], { zimo: false, gangFlower: true }).fan);
    check('金钩钓 ×4（四副露单吊）', 4, () =>
      sc('11s', [peng(M(1)), peng(M(2)), peng(M(3)), peng(M(4))]).fan);
    check('金钩钓成立后不再重复算对对胡', ['金钩钓'], () =>
      sc('11s', [peng(M(1)), peng(M(2)), peng(M(3)), peng(M(4))]).names);
    check('封顶 64：清一色龙七对自摸也不超过', 64, () =>
      sc('11112233445566m', [], { zimo: true }).fan);
    check('清一色 + 龙七对 未封顶前是 32', 32, () => sc('11112233445566m').fan);
  });

  suite('番型计分 · 规则方案差异', () => {
    const hand = '11113355m 2244s 99s'; // 龙七对，混两门（避开清一色干扰）
    check('A 成都：龙七对 ×8', 8, () =>
      scoreWin(VARIANT_CHENGDU, { hand: parseCounts(hand), melds: [], lack: -1, winTile: 0, zimo: false }).fan);
    check('C 教学版：没有龙七对，按七对 ×4', 4, () =>
      scoreWin(VARIANT_TEACH, { hand: parseCounts(hand), melds: [], lack: -1, winTile: 0, zimo: false }).fan);
    check('C 教学版会说明哪些番型被本规则关掉', true, () =>
      scoreWin(VARIANT_TEACH, { hand: parseCounts(hand), melds: [], lack: -1, winTile: 0, zimo: false })
        .suppressed.includes('龙七对'));
    check('B 血流成河开启门清番', true, () =>
      scoreWin(VARIANT_XUELIU, { hand: parseCounts('123456789m 11s 222s'), melds: [], lack: -1, winTile: 0, zimo: false })
        .names.includes('门清'));
    check('A 成都不算门清', false, () =>
      scoreWin(VARIANT_CHENGDU, { hand: parseCounts('123456789m 11s 222s'), melds: [], lack: -1, winTile: 0, zimo: false })
        .names.includes('门清'));
    check('教学版封顶 16', 16, () =>
      scoreWin(VARIANT_TEACH, { hand: parseCounts('111122223333m 44m'), melds: [], lack: -1, winTile: 0, zimo: true }).fan);
    check('起胡番数：要求 4 番时平胡不能胡', null, () => {
      const hi = deriveVariant(VARIANT_CHENGDU, { win: { minFan: 4 } }, 'x', 'x');
      return evaluateWin(hi, { hand: parseCounts('123456789m 11s 222s'), melds: [], lack: 2, winTile: 0, zimo: false });
    });
    check('起胡番数：要求 4 番时清一色可以胡', 4, () => {
      const hi = deriveVariant(VARIANT_CHENGDU, { win: { minFan: 4 } }, 'x', 'x');
      return evaluateWin(hi, { hand: parseCounts('123456789m 11m 234m'), melds: [], lack: 2, winTile: 0, zimo: false })?.fan;
    });
    check('番数加法制（scoring=addFan）也能算', 8, () => {
      const add = deriveVariant(VARIANT_CHENGDU, { fan: { scoring: 'addFan' } }, 'x', 'x');
      // 清一色 4 + 对对胡 2 → 2^6=64，封顶 64；换个小的验证：平胡 1 + 自摸 2 = 2^3 = 8
      return scoreWin(add, { hand: parseCounts('123456789m 11s 222s'), melds: [], lack: -1, winTile: 0, zimo: true }).fan;
    });
  });

  // ==================== 换三张 ====================
  suite('换三张', () => {
    check('候选只给同花色三张组合', true, () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 7 });
      e.start();
      return e.swapOptions(0).every((o) => o.type === 'swap' && new Set(o.tiles.map((t) => Math.floor(t / 9))).size === 1);
    });
    check('候选都是手上真有的牌', true, () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 7 });
      e.start();
      const hand = e.players[0].hand;
      return e.swapOptions(0).every((o) => {
        if (o.type !== 'swap') return false;
        const need = toCounts(o.tiles);
        return need.every((n, t) => n <= hand[t]);
      });
    });
    checkThrows('拒绝：三张不同花色', () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 7 });
      e.start();
      e.apply({ type: 'swap', seat: 0, tiles: [M(1), S(1), P(1)] });
    });
    checkThrows('拒绝：换两张', () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 7 });
      e.start();
      const o = e.swapOptions(0)[0];
      if (o.type !== 'swap') throw new Error('no option');
      e.apply({ type: 'swap', seat: 0, tiles: o.tiles.slice(0, 2) });
    });
    check('换完每家还是 13 张', [13, 13, 13, 13], () => {
      const e = boot();
      return e.players.map((p) => p.hand.reduce((a, b) => a + b, 0) - (e.turn === p.seat && e.drawnTile !== null ? 1 : 0));
    });
    check('换三张方向是三选一', true, () => {
      const e = boot();
      return ['opposite', 'next', 'prev'].includes(e.swapDir!);
    });
    check('换出去的牌确实到了对应那家手上', true, () => {
      const e = boot();
      const dir = e.swapDir!;
      const shift = dir === 'next' ? 1 : dir === 'prev' ? 3 : 2;
      for (let s = 0; s < 4; s++) {
        const to = (s + shift) % 4;
        const got = toCounts(e.players[to].swapIn);
        const sent = toCounts(e.players[s].swapOut);
        if (!sent.every((n, t) => n <= got[t])) return false;
      }
      return true;
    });
    check('C 教学版关闭换三张，直接进定缺', 'lack', () => {
      const e = new MahjongEngine({ config: VARIANT_TEACH, seed: 5 });
      e.start();
      return e.phase;
    });
  });

  // ==================== 定缺 ====================
  suite('定缺', () => {
    check('定缺前不能出牌', 'lack', () => {
      const e = new MahjongEngine({ config: VARIANT_CHENGDU, seed: 11 });
      e.start();
      while (e.pending()?.kind === 'swap') e.apply(e.pending()!.options[0]);
      return e.pending()!.kind;
    });
    check('四家都定缺后才开始行牌', 'turn', () => boot().phase);
    check('手上有缺门牌时只能打缺门', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, '123m 456s 789p 11p 5p', [], 0); // 缺万，手上有万
      return e.legalDiscards(seat).every((t) => t < 9);
    });
    check('打光缺门后可以自由出牌', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, '123456s 789p 11p 5p', [], 0); // 缺万且手上没万
      return e.legalDiscards(seat).length > 3;
    });
    checkThrows('拒绝：手上有缺门牌却打别门', () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, '123m 456s 789p 11p 5p', [], 0);
      e.apply({ type: 'discard', seat, tile: S(4) });
    });
    check('不能碰缺门牌', 0, () => {
      const e = boot();
      const from = e.turn;
      setHand(e, from, '9m 123456s 789p 11p 55p', [], 0); // 14 张，缺万，只能先打 9 万
      setHand(e, (from + 1) % 4, '99m 12345s 789p 11p 5p', [], 0); // 缺万，手上两张 9 万也不能碰
      setHand(e, (from + 2) % 4, NEUTRAL, [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: M(9) });
      const pend = e.pending();
      return pend && pend.kind === 'claim' ? pend.options.filter((o) => o.type === 'peng').length : 0;
    });
  });

  // ==================== 摸牌与出牌 ====================
  suite('摸牌与出牌', () => {
    check('轮到自己时手牌 14 张（13 + 摸的）', 14, () => {
      const e = boot();
      return e.players[e.turn].hand.reduce((a, b) => a + b, 0);
    });
    check('出牌后手牌回到 13 张', 13, () => {
      const e = boot();
      const seat = e.turn;
      e.apply({ type: 'discard', seat, tile: e.legalDiscards(seat)[0] });
      return e.players[seat].hand.reduce((a, b) => a + b, 0);
    });
    check('打出的牌进了自己的牌河', 1, () => {
      const e = boot();
      const seat = e.turn;
      e.apply({ type: 'discard', seat, tile: e.legalDiscards(seat)[0] });
      return e.players[seat].discards.length;
    });
    check('牌墙每摸一张少一张', -1, () => {
      const e = boot();
      const before = e.wallLeft;
      const seat = e.turn;
      e.apply({ type: 'discard', seat, tile: e.legalDiscards(seat)[0] });
      while (e.pending()?.kind === 'claim') e.apply({ type: 'pass', seat: e.pending()!.seat });
      return e.wallLeft - before;
    });
    checkThrows('拒绝：不是自己的回合出牌', () => {
      const e = boot();
      const other = (e.turn + 1) % 4;
      e.apply({ type: 'discard', seat: other, tile: e.players[other].hand.findIndex((n) => n > 0) });
    });
    checkThrows('拒绝：打一张手上没有的牌', () => {
      const e = boot();
      const seat = e.turn;
      const missing = e.players[seat].hand.findIndex((n) => n === 0);
      e.apply({ type: 'discard', seat, tile: missing });
    });
  });

  // ==================== 碰 ====================
  suite('碰', () => {
    const setupPeng = () => {
      const e = boot();
      const from = e.turn;
      const other = (from + 1) % 4;
      setHand(e, from, '123456s 99s 789p 11p 5p', [], 0); // 14 张，缺万且无万，可自由出牌
      setHand(e, other, '99s 12345s 789p 11p 5p', [], 0); // 13 张，手上两张 9 条
      setHand(e, (from + 2) % 4, NEUTRAL, [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(9) });
      return { e, from, other };
    };
    check('别人打出我有两张的牌，会给碰的选项', true, () => {
      const { e } = setupPeng();
      return e.pending()!.options.some((o) => o.type === 'peng');
    });
    check('碰完手牌少 2 张、副露多 1 组', [11, 1], () => {
      const { e, other } = setupPeng();
      e.apply({ type: 'peng', seat: other, tile: S(9) });
      return [e.players[other].hand.reduce((a, b) => a + b, 0), e.players[other].melds.length];
    });
    check('碰完轮到碰的人出牌，且不补摸', true, () => {
      const { e, other } = setupPeng();
      const wall = e.wallLeft;
      e.apply({ type: 'peng', seat: other, tile: S(9) });
      return e.phase === 'turn' && e.turn === other && e.wallLeft === wall && e.drawnTile === null;
    });
    check('被碰走的牌从牌河里拿掉', 0, () => {
      const { e, from, other } = setupPeng();
      e.apply({ type: 'peng', seat: other, tile: S(9) });
      return e.players[from].discards.length;
    });
    check('过：不碰就轮到下家摸牌', true, () => {
      const { e, from } = setupPeng();
      while (e.pending()?.kind === 'claim') e.apply({ type: 'pass', seat: e.pending()!.seat });
      return e.turn === (from + 1) % 4 && e.drawnTile !== null;
    });
  });

  // ==================== 杠 ====================
  suite('杠', () => {
    /** 14 张：四张 1 条可暗杠 */
    const GANG_HAND = '1111s 23456s 789p 11p';
    check('手上四张给暗杠选项', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, GANG_HAND, [], 0);
      return e.turnOptions(seat).some((o) => o.type === 'gang' && o.kind === 'angang');
    });
    check('暗杠：每家赔 2，自己 +6', [6, -2, -2, -2], () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, GANG_HAND, [], 0);
      e.apply({ type: 'gang', seat, tile: S(1), kind: 'angang' });
      return [0, 1, 2, 3].map((i) => e.players[(seat + i) % 4].score);
    });
    check('杠完补一张，还是自己出牌', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, GANG_HAND, [], 0);
      e.apply({ type: 'gang', seat, tile: S(1), kind: 'angang' });
      return e.turn === seat && e.phase === 'turn' && e.drawnTile !== null;
    });
    check('杠完手上多一张（杠是四张占一副面子）', 11, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, GANG_HAND, [], 0);
      e.apply({ type: 'gang', seat, tile: S(1), kind: 'angang' });
      return e.players[seat].hand.reduce((a, b) => a + b, 0);
    });
    check('明杠：点杠那家赔 2', [2, -2], () => {
      const e = boot();
      const from = e.turn;
      const other = (from + 1) % 4;
      setHand(e, from, '123456s 9s 789p 11p 55p', [], 0);
      setHand(e, other, '999s 12345s 789p 11p', [], 0);
      setHand(e, (from + 2) % 4, NEUTRAL, [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(9) });
      e.apply({ type: 'gang', seat: other, tile: S(9), kind: 'gang' });
      return [e.players[other].score, e.players[from].score];
    });
    check('补杠：碰过再摸到第四张可以补杠', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, '9s 123456s 789p 11p', [peng(S(9))], 0); // 11 张手牌 + 一副碰 = 14
      return e.turnOptions(seat).some((o) => o.type === 'gang' && o.kind === 'bugang');
    });
    check('缺门牌不能杠', false, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, '1111m 23456s 789p 11p', [], 0); // 缺万
      return e.turnOptions(seat).some((o) => o.type === 'gang');
    });
    check('牌墙不够时不给杠', false, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, GANG_HAND, [], 0);
      e.wall.length = 0;
      return e.turnOptions(seat).some((o) => o.type === 'gang');
    });
    check('杠后补的牌自摸算杠上花', true, () => {
      const e = boot();
      const seat = e.turn;
      // 杠掉 1 条后剩 234567s + 99s + 45s，补到 3 条正好 234/345/567/99 成胡
      setHand(e, seat, '1111s 234567s 99s 45s', [], 0);
      e.wall = [S(3), ...e.wall];
      e.apply({ type: 'gang', seat, tile: S(1), kind: 'angang' });
      const hu = e.turnOptions(seat).find((o) => o.type === 'hu');
      if (!hu) return false;
      e.apply(hu);
      return e.players[seat].wins[0].score.names.includes('杠上花');
    });
  });

  // ==================== 胡牌流程 ====================
  suite('胡牌流程', () => {
    /** 14 张自摸型：123m456m789m + 11条 + 222条，缺筒 */
    const ZIMO_HAND = '123456789m 11s 222s';
    /** 13 张听 2 条（1条3条坎张），缺筒 */
    const TING_2S = '123456789m 11s 13s';
    /** 打 2 条的那家：14 张，缺万且无万 */
    const DISCARD_2S = '2s 123456s 789p 11p 55p';

    /** 把一次响应问到底，能胡就胡 */
    const resolveClaims = (e: MahjongEngine) => {
      let guard = 0;
      while (e.pending()?.kind === 'claim' && guard++ < 8) {
        const p = e.pending()!;
        e.apply(p.options.find((o) => o.type === 'hu') ?? { type: 'pass', seat: p.seat });
      }
    };

    check('自摸：能胡时出现胡的选项', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, ZIMO_HAND, [], 2);
      e.drawnTile = S(2);
      return e.turnOptions(seat).some((o) => o.type === 'hu');
    });
    check('点炮：别人打出我要的牌会问胡', true, () => {
      const e = boot();
      const from = e.turn;
      setHand(e, from, DISCARD_2S, [], 0);
      setHand(e, (from + 1) % 4, TING_2S, [], 2);
      setHand(e, (from + 2) % 4, NEUTRAL, [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(2) });
      return e.pending()!.options.some((o) => o.type === 'hu');
    });
    check('点炮后：胡家 +番、点炮家 -番、数额相等', true, () => {
      const e = boot();
      const from = e.turn;
      const other = (from + 1) % 4;
      setHand(e, from, DISCARD_2S, [], 0);
      setHand(e, other, TING_2S, [], 2);
      setHand(e, (from + 2) % 4, NEUTRAL, [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(2) });
      e.apply({ type: 'hu', seat: other, tile: S(2) });
      return e.players[other].score > 0 && e.players[from].score < 0
        && e.players[other].score === -e.players[from].score;
    });
    check('自摸：三家各赔一份', true, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, ZIMO_HAND, [], 2);
      e.drawnTile = S(2);
      const hu = e.turnOptions(seat).find((o) => o.type === 'hu');
      if (!hu) return '没给胡的选项';
      e.apply(hu);
      const others = [1, 2, 3].map((d) => e.players[(seat + d) % 4].score);
      return others.every((s) => s === others[0] && s < 0) && e.players[seat].score === -others[0] * 3;
    });
    check('一炮多响：两家同时胡同一张', 2, () => {
      const e = boot();
      const from = e.turn;
      setHand(e, from, DISCARD_2S, [], 0);
      setHand(e, (from + 1) % 4, TING_2S, [], 2);
      setHand(e, (from + 2) % 4, '123456789p 11s 13s', [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(2) });
      resolveClaims(e);
      return e.players.filter((p) => p.won).length;
    });
    check('关闭一炮多响后只有一家能胡', 1, () => {
      const single = deriveVariant(VARIANT_CHENGDU, { win: { multiWin: false } }, 'x', 'x');
      const e = boot(single, 33);
      const from = e.turn;
      setHand(e, from, DISCARD_2S, [], 0);
      setHand(e, (from + 1) % 4, TING_2S, [], 2);
      setHand(e, (from + 2) % 4, '123456789p 11s 13s', [], 0);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(2) });
      resolveClaims(e);
      return e.players.filter((p) => p.won).length;
    });
    check('胡的优先级高于碰：先问胡的那家', true, () => {
      const e = boot();
      const from = e.turn;
      const pengSeat = (from + 1) % 4;
      const huSeat = (from + 2) % 4;
      setHand(e, from, DISCARD_2S, [], 0);
      setHand(e, pengSeat, '22s 13456s 789p 11p 5p', [], 0);
      setHand(e, huSeat, TING_2S, [], 2);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(2) });
      const pend = e.pending()!;
      return pend.seat === huSeat && pend.options.some((o) => o.type === 'hu');
    });
    check('胡家放弃后，碰家才轮到', true, () => {
      const e = boot();
      const from = e.turn;
      const pengSeat = (from + 1) % 4;
      const huSeat = (from + 2) % 4;
      setHand(e, from, DISCARD_2S, [], 0);
      setHand(e, pengSeat, '22s 13456s 789p 11p 5p', [], 0);
      setHand(e, huSeat, TING_2S, [], 2);
      setHand(e, (from + 3) % 4, NEUTRAL, [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(2) });
      e.apply({ type: 'pass', seat: huSeat });
      const pend = e.pending()!;
      return pend.seat === pengSeat && pend.options.some((o) => o.type === 'peng');
    });
  });

  // ==================== 血战 / 血流 ====================
  suite('血战到底', () => {
    const ZIMO_HAND = '123456789m 11s 222s';
    /** 摆好自摸局面并胡掉 */
    const zimoWin = (e: MahjongEngine) => {
      const seat = e.turn;
      setHand(e, seat, ZIMO_HAND, [], 2);
      e.drawnTile = S(2);
      const hu = e.turnOptions(seat).find((o) => o.type === 'hu');
      if (!hu) return -1;
      e.apply(hu);
      return seat;
    };

    check('胡了的家下桌，不再被问动作', true, () => {
      const e = boot();
      const seat = zimoWin(e);
      return seat >= 0 && e.players[seat].outOfPlay && e.turn !== seat;
    });
    check('三家胡完，本局结束', 'over', () => {
      const e = boot();
      for (let d = 0; d < 3; d++) {
        if (zimoWin(e) < 0) return `第 ${d + 1} 家胡不了`;
        if (e.phase === 'over') break;
      }
      return e.phase;
    });
    check('血战到底：三家胡完时胡家数为 3', 3, () => {
      const e = boot();
      for (let d = 0; d < 3; d++) {
        if (zimoWin(e) < 0) break;
        if (e.phase === 'over') break;
      }
      return e.players.filter((p) => p.won).length;
    });
    check('血流成河：胡了继续打，不下桌', false, () => {
      const e = boot(VARIANT_XUELIU, 77);
      const seat = zimoWin(e);
      return seat < 0 ? '胡不了' : e.players[seat].outOfPlay;
    });
    check('血流成河：胡完手牌还是 13 张', 13, () => {
      const e = boot(VARIANT_XUELIU, 77);
      const seat = zimoWin(e);
      return seat < 0 ? '胡不了' : e.players[seat].hand.reduce((a, b) => a + b, 0);
    });
    check('血流成河：同一家可以胡第二次', 2, () => {
      const e = boot(VARIANT_XUELIU, 77);
      const seat = zimoWin(e);
      if (seat < 0) return '胡不了';
      // 转一圈回到他，再摆一次自摸
      let guard = 0;
      while (e.turn !== seat && e.phase !== 'over' && guard++ < 40) {
        const p = e.pending();
        if (!p) break;
        e.apply(p.options.find((o) => o.type === 'discard') ?? p.options[p.options.length - 1]);
      }
      if (e.turn !== seat) return '没转回来';
      setHand(e, seat, ZIMO_HAND, [], 2);
      e.drawnTile = S(2);
      const hu = e.turnOptions(seat).find((o) => o.type === 'hu');
      if (hu) e.apply(hu);
      return e.players[seat].winCount;
    });
    check('教学版：一家胡就结束', 'over', () => {
      const e = boot(VARIANT_TEACH, 88);
      zimoWin(e);
      return e.phase;
    });
  });

  // ==================== 流局与查叫 ====================
  suite('流局结算 · 查大叔查花猪', () => {
    const cfg = VARIANT_CHENGDU;
    const mk = (hand: string, lack: number, tingFan: number, gang: { from: number; amount: number }[] = []) =>
      ({ hand: parseCounts(hand), melds: [] as Meld[], lack, won: false, gangGains: gang, tingFan });

    check('花猪赔给其他三家各 16', -48, () => {
      const rows = settleDraw(cfg, [
        { seat: 0, ...mk('123m 456s 789p 11p 5p', 0, 0) },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 1) },
      ]);
      return rows[0].delta;
    });
    check('花猪被标成 huazhu', 'huazhu', () => {
      const rows = settleDraw(cfg, [
        { seat: 0, ...mk('123m 456s 789p 11p 5p', 0, 0) },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 1) },
      ]);
      return rows[0].status;
    });
    check('未听牌赔听牌家（按听牌家的番数）', -6, () => {
      const rows = settleDraw(cfg, [
        // 缺万且手上没万（不是花猪），但没听牌 → 大叔，赔三家各 2 番
        { seat: 0, ...mk('13579s 2468p 123p 1p', 0, 0) },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 2) },
      ]);
      return rows[0].delta;
    });
    check('听牌家之间不互相结算', 0, () => {
      const rows = settleDraw(cfg, [
        { seat: 0, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 2) },
      ]);
      return rows.reduce((a, r) => a + Math.abs(r.delta), 0);
    });
    check('花猪要退还收过的杠分', -50, () => {
      const rows = settleDraw(cfg, [
        { seat: 0, ...mk('123m 456s 789p 11p 5p', 0, 0, [{ from: 1, amount: 2 }]) },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 1) },
      ]);
      return rows[0].delta;
    });
    check('已胡的家不参与查叫', 0, () => {
      const rows = settleDraw(cfg, [
        { seat: 0, hand: parseCounts('123456789s 11s 2s'), melds: [], lack: 0, won: true, gangGains: [], tingFan: 0 },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 2) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 2) },
      ]);
      return rows[0].delta;
    });
    check('教学版不查花猪不查叫：全场 0', 0, () => {
      const rows = settleDraw(VARIANT_TEACH, [
        { seat: 0, ...mk('123m 456s 789p 11p 5p', 0, 0) },
        { seat: 1, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 2, ...mk('123456789s 11s 2s', 0, 1) },
        { seat: 3, ...mk('123456789s 11s 2s', 0, 1) },
      ]);
      return rows.reduce((a, r) => a + Math.abs(r.delta), 0);
    });
    check('查大叔赔付估番：金钩钓单吊听 1 条 = 4 番', 4, () =>
      bestTingFan(VARIANT_CHENGDU, parseCounts('1s'), [peng(M(1)), peng(M(2)), peng(M(3)), peng(M(4))], 2));
    check('没听牌的估番为 0', 0, () =>
      bestTingFan(VARIANT_CHENGDU, parseCounts('13579s 2468p 123p 1p'), [], 0));
  });

  // ==================== 边界情况 ====================
  suite('边界情况', () => {
    check('最后一张牌摸完即流局', 'over', () => {
      const e = boot();
      e.wall.length = 1;
      const seat = e.turn;
      e.apply({ type: 'discard', seat, tile: e.legalDiscards(seat)[0] });
      let guard = 0;
      while (e.pending()?.kind === 'claim' && guard++ < 8) e.apply({ type: 'pass', seat: e.pending()!.seat });
      // 还剩 1 张：下家摸走后牌墙为 0，再打一张就该结束
      if (e.phase === 'over') return 'over';
      const s2 = e.turn;
      e.apply({ type: 'discard', seat: s2, tile: e.legalDiscards(s2)[0] });
      guard = 0;
      while (e.pending()?.kind === 'claim' && guard++ < 8) e.apply({ type: 'pass', seat: e.pending()!.seat });
      return e.phase;
    });
    check('流局时 result.exhausted 为真', true, () => {
      const e = boot();
      e.wall.length = 0;
      const seat = e.turn;
      e.apply({ type: 'discard', seat, tile: e.legalDiscards(seat)[0] });
      let guard = 0;
      while (e.pending()?.kind === 'claim' && guard++ < 8) e.apply({ type: 'pass', seat: e.pending()!.seat });
      return e.result?.exhausted ?? false;
    });
    check('已下桌的家不出现在响应队列里', true, () => {
      const e = boot();
      const winner = e.turn;
      setHand(e, winner, '123456789m 11s 222s', [], 2);
      e.drawnTile = S(2);
      const hu = e.turnOptions(winner).find((o) => o.type === 'hu');
      if (!hu) return '胡不了';
      e.apply(hu);
      // 摆一张三家都能碰的牌，确认下桌那家不会被问
      const from = e.turn;
      setHand(e, from, '123456s 99s 789p 11p 5p', [], 0);
      for (let d = 1; d < 4; d++) setHand(e, (from + d) % 4, '99s 12345s 789p 11p 5p', [], 0);
      e.apply({ type: 'discard', seat: from, tile: S(9) });
      let guard = 0;
      const asked: number[] = [];
      while (e.pending()?.kind === 'claim' && guard++ < 8) {
        asked.push(e.pending()!.seat);
        e.apply({ type: 'pass', seat: e.pending()!.seat });
      }
      return asked.length > 0 && !asked.includes(winner);
    });
    check('引擎拒绝在结束后继续动作', true, () => {
      const e = boot();
      e.wall.length = 0;
      const seat = e.turn;
      e.apply({ type: 'discard', seat, tile: e.legalDiscards(seat)[0] });
      let guard = 0;
      while (e.pending()?.kind === 'claim' && guard++ < 8) e.apply({ type: 'pass', seat: e.pending()!.seat });
      return e.pending() === null;
    });
    check('全场分数守恒（和为 0）', 0, () => {
      const e = boot();
      const seat = e.turn;
      setHand(e, seat, '1111s 23456s 789p 11p', [], 0);
      e.apply({ type: 'gang', seat, tile: S(1), kind: 'angang' });
      return e.players.reduce((a, p) => a + p.score, 0);
    });
  });

  // ==================== 回放 ====================
  suite('牌局回放', () => {
    check('同种子同动作可以逐张重放', true, () => {
      const e = boot();
      const acts: Action[] = [];
      let guard = 0;
      while (e.phase !== 'over' && guard++ < 60) {
        const p = e.pending();
        if (!p) break;
        const a = p.options.find((o) => o.type === 'discard') ?? p.options[p.options.length - 1];
        acts.push(a);
        e.apply(a);
      }
      const r = replay(VARIANT_CHENGDU, e.seed, e.log);
      return JSON.stringify(r.snapshot()) === JSON.stringify(e.snapshot());
    });
    check('回放到中途可以拿到当时的局面', true, () => {
      const e = boot();
      const half = Math.max(1, Math.floor(e.log.length / 2));
      const r = replay(VARIANT_CHENGDU, e.seed, e.log, half);
      return r.log.length === Math.min(half, e.log.length);
    });
    check('快照是深拷贝，改不坏引擎', true, () => {
      const e = boot();
      const s = e.snapshot();
      s.players[0].hand[0] = 99;
      return e.players[0].hand[0] !== 99;
    });
  });

  // ==================== 规则方案完整性 ====================
  suite('规则方案', () => {
    check('内置三套方案', 3, () => listVariants().length);
    check('每套方案的番型表都齐全', true, () =>
      listVariants().every((v) => v.fan.table.length === 17));
    check('deriveVariant 只改指定项，其它继承', true, () => {
      const d = deriveVariant(VARIANT_CHENGDU, { win: { minFan: 5 } }, 'd', 'D');
      return d.win.minFan === 5 && d.gang.payConcealed === VARIANT_CHENGDU.gang.payConcealed
        && d.fan.cap === VARIANT_CHENGDU.fan.cap;
    });
    check('deriveVariant 不会污染原方案', 1, () => {
      deriveVariant(VARIANT_CHENGDU, { win: { minFan: 5 } }, 'd', 'D');
      return VARIANT_CHENGDU.win.minFan;
    });
  });

  // ==================== 随机对局不变量 ====================
  suite('随机对局不变量（200 局）', () => {
    let bad = '';
    let finished = 0;
    let exhausted = 0;
    let wins = 0;
    for (let g = 0; g < 200 && !bad; g++) {
      const cfg = [VARIANT_CHENGDU, VARIANT_XUELIU, VARIANT_TEACH][g % 3];
      const rng = new Rng(g * 7919 + 13);
      const e = new MahjongEngine({ config: cfg, seed: g * 104729 + 7 });
      e.start();
      let steps = 0;
      while (e.phase !== 'over' && steps++ < 4000) {
        const pend = e.pending();
        if (!pend) break;
        // 随机合法动作，但优先胡（不然血战永远打不完）
        const hu = pend.options.find((o) => o.type === 'hu');
        const a = hu ?? pend.options[rng.int(pend.options.length)];
        try {
          e.apply(a);
        } catch (err) {
          bad = `第 ${g} 局动作被拒：${(err as Error).message}`;
          break;
        }
        // 张数不变式：手牌 + 副露占用张数 = 13 或 14，每杠一次多一张
        // （杠用四张牌顶一副面子，所以摸回来的那张不会让总数回落，这是麻将本来的算法）
        for (const p of e.players) {
          if (p.outOfPlay) continue;
          const kongs = p.melds.filter((m) => m.kind !== 'peng').length;
          const n = p.hand.reduce((x, y) => x + y, 0) + p.melds.reduce((x, m) => x + (m.kind === 'peng' ? 3 : 4), 0);
          if (n !== 13 + kongs && n !== 14 + kongs) {
            bad = `第 ${g} 局 ${p.seat} 号位张数错：${n}（${kongs} 个杠）`;
            break;
          }
        }
        if (bad) break;
      }
      if (bad) break;
      if (e.phase !== 'over') { bad = `第 ${g} 局没能正常结束（${steps} 步）`; break; }
      finished++;
      if (e.result?.exhausted) exhausted++;
      wins += e.result?.winners.length ?? 0;
      const sum = e.players.reduce((a, p) => a + p.score, 0);
      if (sum !== 0) { bad = `第 ${g} 局分数不守恒：${sum}`; break; }
    }
    check('200 局全部正常结束', 200, () => (bad ? bad : finished));
    check('没有非法动作、张数与分数始终守恒', '通过', () => (bad ? bad : '通过'));
    checkTrue('确实有牌局打到胡牌（不是每局都流局）', '有人胡牌', () => wins > 0);
    checkTrue('确实有牌局打到流局（覆盖查叫分支）', '有流局', () => exhausted > 0);
  });
}
