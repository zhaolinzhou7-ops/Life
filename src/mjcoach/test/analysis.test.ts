/**
 * 牌效率分析层的测试。
 *
 * 这一层的正确性没法像规则那样「非黑即白」，所以测的是**性质**：
 * 向听数的定义要自洽（听牌=0、和牌=-1、摸到进张必须减一），
 * 推荐要经得起常识检验（该缺孤张那门、不该拆现成面子）。
 */

import { check, checkTrue, suite } from './runner';
import { VARIANT_CHENGDU, VARIANT_TEACH } from '../rules/config';
import { parseCounts, tileName, tileOf, type Counts, type Meld } from '../rules/tiles';
import {
  decompose, describeStructure, lackLeft, shanten, shantenSevenPairs, shantenStandard, shantenWithLack, ukeire,
} from '../analysis/shanten';
import { analyzeDiscards, lossOf, severityOf, suitCohesion } from '../analysis/efficiency';
import { analyzeLack, fewestSuit, judgeLack } from '../analysis/dingque';
import { analyzeSwap, judgeSwap } from '../analysis/swap';
import { dangerOf, readOpponent, stanceAdvice, type OpponentRead } from '../analysis/defense';

const M = (r: number) => tileOf(0, r);
const S = (r: number) => tileOf(1, r);
const P = (r: number) => tileOf(2, r);

const read = (over: Partial<OpponentRead> = {}): OpponentRead => ({
  seat: 1, discards: [], lack: 2, ting: true, tingConfidence: 0.8, meldCount: 0, outOfPlay: false, ...over,
});

export function runAnalysisTests() {
  suite('向听数', () => {
    check('和牌的手牌向听 -1', -1, () => shantenStandard(parseCounts('123456789m 11s 222s'), 0));
    check('听牌的手牌向听 0', 0, () => shantenStandard(parseCounts('123456789m 11s 22s'), 0));
    check('2 条 4 条是坎张，所以这手也算听牌', 0, () =>
      shantenStandard(parseCounts('123456789m 11s 2s 4s'), 0));
    check('一向听：两张孤张连不起来', 1, () =>
      shantenStandard(parseCounts('123456789m 11s 2s 5s'), 0));
    check('副露一副后，手牌少三张也能算对', 0, () =>
      shantenStandard(parseCounts('123456m 78m 11s'), 1));
    check('七对听牌向听 0', 0, () => shantenSevenPairs(parseCounts('1133557799m 224s')));
    check('七对和牌向听 -1', -1, () => shantenSevenPairs(parseCounts('1133557799m 2244s')));
    check('综合向听会在标准型和七对里取小的', 0, () =>
      shanten(parseCounts('1133557799m 224s'), 0, true));
    check('关掉七对后同一手牌向听变差', true, () =>
      shanten(parseCounts('1133557799m 224s'), 0, false) > shanten(parseCounts('1133557799m 224s'), 0, true));
    check('缺门牌不算进面子：缺万时 123 万不算一副', true, () => {
      const hand = parseCounts('123m 123456s 11p 22p'); // 13 张
      return shantenWithLack(hand, 0, false, 0) > shanten(hand, 0, false);
    });
    check('手上还剩几张缺门牌', 3, () => lackLeft(parseCounts('123m 123456s 11p 22p'), 0));
    check('摸到进张，向听必须减 1', true, () => {
      const hand = parseCounts('123456789m 11s 2s 4s');
      const base = shanten(hand, 0, true);
      const uk = ukeire(hand, 0, true, -1);
      const work = hand.slice();
      return uk.tiles.length > 0 && uk.tiles.every((t) => {
        work[t]++;
        const sh = shanten(work, 0, true);
        work[t]--;
        return sh === base - 1;
      });
    });
    check('非进张摸了向听不会变好', true, () => {
      const hand = parseCounts('123456789m 11s 2s 4s');
      const base = shanten(hand, 0, true);
      const uk = new Set(ukeire(hand, 0, true, -1).tiles);
      const work = hand.slice();
      for (let t = 0; t < 27; t++) {
        if (uk.has(t) || work[t] >= 4) continue;
        work[t]++;
        const sh = shanten(work, 0, true);
        work[t]--;
        if (sh < base) return `摸 ${tileName(t)} 居然变好了`;
      }
      return true;
    });
    check('进张会扣掉已经见光的牌', true, () => {
      const hand = parseCounts('123456789m 11s 2s 4s');
      const seen: Counts = hand.slice();
      const before = ukeire(hand, 0, true, -1, seen).total;
      // 把 3 条全部当成已见
      seen[S(3)] = 4;
      const after = ukeire(hand, 0, true, -1, seen).total;
      return after < before;
    });
  });

  suite('手牌结构分解', () => {
    check('顺子能被认出来', true, () =>
      decompose(parseCounts('123s')).some((b) => b.kind === 'shunzi'));
    check('刻子能被认出来', true, () =>
      decompose(parseCounts('333s')).some((b) => b.kind === 'kezi'));
    check('34 条是两面搭子，等 2 条和 5 条', ['2条', '5条'], () => {
      const b = decompose(parseCounts('34s')).find((x) => x.kind === 'liangmian');
      return b ? b.waits.map(tileName) : '没认出来';
    });
    check('35 条是坎张，只等 4 条', ['4条'], () => {
      const b = decompose(parseCounts('35s')).find((x) => x.kind === 'kanzhang');
      return b ? b.waits.map(tileName) : '没认出来';
    });
    check('12 条是边张，只等 3 条', ['3条'], () => {
      const b = decompose(parseCounts('12s')).find((x) => x.kind === 'bianzhang');
      return b ? b.waits.map(tileName) : '没认出来';
    });
    check('89 条也是边张', 'bianzhang', () => decompose(parseCounts('89s'))[0].kind);
    check('孤张认得出来', 'gudan', () => decompose(parseCounts('5s'))[0].kind);
    check('结构摘要能读', '2 个顺子、1 个对子、1 个两面搭子', () =>
      describeStructure(decompose(parseCounts('123s 456s 99s 34m'))));
    check('优先拆成面子而不是拆成一堆搭子', 2, () =>
      decompose(parseCounts('123456s')).filter((b) => b.kind === 'shunzi').length);
  });

  suite('舍牌分析', () => {
    const base = (hand: string, lack = 2, melds: Meld[] = []) => ({
      cfg: VARIANT_CHENGDU, hand: parseCounts(hand), melds, lack, wallLeft: 40,
    });

    check('有缺门牌时只给缺门牌可打', true, () => {
      const a = analyzeDiscards(base('123p 123456s 11m 22m', 2));
      return a.options.every((o) => o.isLack);
    });
    check('缺门牌打完后才轮到比效率', true, () => {
      const a = analyzeDiscards(base('123456s 11m 22m 456m', 2));
      return a.options.length > 3 && a.options.every((o) => !o.isLack);
    });
    check('会优先选让自己听牌的那张', true, () => {
      // 123456789m + 11s + 2s4s5s：打掉 2 条剩 45 条两面听
      const a = analyzeDiscards(base('123456789m 11s 2s 4s 5s', 2));
      return a.best.ting;
    });
    check('两面听比坎张听更受青睐', '2条', () => {
      const a = analyzeDiscards(base('123456789m 11s 2s 4s 5s', 2));
      return a.best.name;
    });
    check('推荐打孤张而不是拆两面搭子', '9筒', () => {
      const a = analyzeDiscards(base('123456m 345s 34s 9p', 2));
      return a.best.name;
    });
    check('每个选项都带进张数', true, () => {
      const a = analyzeDiscards(base('123456s 11m 22m 456m', 2));
      return a.options.every((o) => typeof o.ukeire === 'number' && o.ukeire >= 0);
    });
    check('每个选项都说得出这张牌的角色', true, () => {
      const a = analyzeDiscards(base('123456s 11m 22m 456m', 2));
      return a.options.every((o) => o.role.length > 0);
    });
    check('听牌时会算出听哪些张', ['3条', '6条'], () => {
      const a = analyzeDiscards(base('123456789m 11s 2s 4s 5s', 2));
      return a.best.waits.map(tileName);
    });
    check('差距分级：一样的牌差距为 0', 'ok', () => {
      const a = analyzeDiscards(base('123456s 11m 22m 456m', 2));
      return severityOf(lossOf(a.best, a.best));
    });
    check('差距分级：把听牌拆了是重错', true, () => {
      const a = analyzeDiscards(base('123456789m 11s 2s 4s 5s', 2));
      const worst = a.options[a.options.length - 1];
      return ['major', 'blunder'].includes(severityOf(lossOf(a.best, worst)));
    });
    check('危险牌在别人听牌时会被扣分', true, () => {
      const safe = analyzeDiscards({ ...base('123456m 345s 34s 9p', 2), reads: [] });
      const risky = analyzeDiscards({
        ...base('123456m 345s 34s 9p', 2),
        reads: [read({ lack: 0, discards: [] })],
        wallLeft: 10,
      });
      return risky.best.danger >= safe.best.danger;
    });
  });

  suite('定缺分析', () => {
    check('孤张多的那门该缺（哪怕张数不是最少）', '万', () => {
      // 万：1 4 7 9 四张全孤；条：345 已成顺子；筒：搭子一堆
      const a = analyzeLack(VARIANT_CHENGDU, parseCounts('1479m 345s 678s 234p 5p'));
      return a.best.name;
    });
    // 万 5 张但全是孤张，条只有 3 张却是一副现成顺子——「哪门少缺哪门」在这里会给错答案
    check('张数最少的不一定该缺：这手该缺万，但最少的是条', ['万', '条'], () => {
      const hand = parseCounts('13579m 345s 23456p');
      const a = analyzeLack(VARIANT_CHENGDU, hand);
      return [a.best.name, ['万', '条', '筒'][fewestSuit(hand)]];
    });
    check('一门牌都没有时一定缺它', '筒', () =>
      analyzeLack(VARIANT_CHENGDU, parseCounts('123456789m 1234s')).best.name);
    check('三门都给出评分和排名', [1, 2, 3], () =>
      analyzeLack(VARIANT_CHENGDU, parseCounts('1479m 345s 678s 234p 5p')).options.map((o) => o.rank));
    check('每门都给得出理由', true, () =>
      analyzeLack(VARIANT_CHENGDU, parseCounts('1479m 345s 678s 234p 5p')).options.every((o) => o.reasons.length >= 2));
    check('结论是一句人话', true, () =>
      analyzeLack(VARIANT_CHENGDU, parseCounts('1479m 345s 678s 234p 5p')).verdict.includes('缺'));
    check('判卷：缺掉成形那门算失误', false, () => {
      const hand = parseCounts('1479m 345s 678s 234p 5p');
      return judgeLack(VARIANT_CHENGDU, hand, 1).correct;
    });
    check('判卷：缺孤张那门算正确', true, () => {
      const hand = parseCounts('1479m 345s 678s 234p 5p');
      return judgeLack(VARIANT_CHENGDU, hand, 0).correct;
    });
  });

  suite('换三张分析', () => {
    const hand = parseCounts('1479m 345s 678s 234p 5p'); // 13 张

    check('候选都是同一门的三张', true, () =>
      analyzeSwap(VARIANT_CHENGDU, hand).options.every((o) => new Set(o.tiles.map((t) => Math.floor(t / 9))).size === 1));
    check('推荐换出孤张最多的那门', '万', () => {
      const a = analyzeSwap(VARIANT_CHENGDU, hand);
      return ['万', '条', '筒'][a.best.suit];
    });
    check('不推荐拆现成顺子', 0, () => analyzeSwap(VARIANT_CHENGDU, hand).best.brokenMelds);
    check('换牌建议会和定缺建议对齐', true, () => analyzeSwap(VARIANT_CHENGDU, hand).matchesLackAdvice);
    check('判卷：换掉整副顺子会被指出来', true, () => {
      const j = judgeSwap(VARIANT_CHENGDU, hand, [S(3), S(4), S(5)]);
      return j.loss > 20 && !j.correct;
    });
    check('判卷：换掉孤张是最优解', true, () => {
      const a = analyzeSwap(VARIANT_CHENGDU, hand);
      const j = judgeSwap(VARIANT_CHENGDU, hand, a.best.tiles);
      return j.correct && j.rank === 1;
    });
    check('会给出在所有换法里的排名', true, () => {
      const j = judgeSwap(VARIANT_CHENGDU, hand, [S(3), S(4), S(5)]);
      return j.total > 1 && j.rank >= 1 && j.rank <= j.total;
    });
    check('教学版关掉换三张后不影响分析函数本身', true, () =>
      analyzeSwap(VARIANT_TEACH, hand).options.length > 0);
  });

  suite('防守', () => {
    check('他打过的牌是绝对安全的', 0, () =>
      dangerOf(M(5), [read({ discards: [M(5)] })]).value);
    check('他的缺门牌是绝对安全的', 0, () => dangerOf(P(5), [read({ lack: 2 })]).value);
    check('没人听牌时危险度很低', true, () =>
      dangerOf(M(5), [read({ ting: false, tingConfidence: 0.2 })]).value < 0.2);
    check('中张无筋最危险', true, () => {
      const mid = dangerOf(M(5), [read()]).value;
      const terminal = dangerOf(M(1), [read()]).value;
      return mid > terminal;
    });
    check('有筋的牌比无筋安全', true, () => {
      const suji = dangerOf(M(5), [read({ discards: [M(2), M(8)] })]).value;
      const nosuji = dangerOf(M(5), [read({ discards: [] })]).value;
      return suji < nosuji;
    });
    check('危险度一定说得出理由', true, () => dangerOf(M(5), [read()]).reason.length > 0);
    check('下桌的家不再构成威胁', 0, () => dangerOf(M(5), [read({ outOfPlay: true })]).value);
    check('读牌：开局不会判成听牌', false, () =>
      readOpponent({ seat: 1, discards: [M(1)], lack: 2, meldCount: 0, outOfPlay: false, round: 1 }).ting);
    check('读牌：打了很多轮 + 副露多，会判成听牌', true, () =>
      readOpponent({ seat: 1, discards: [M(1), M(2), M(5), S(5), S(4)], lack: 2, meldCount: 2, outOfPlay: false, round: 14 }).ting);
    check('攻守建议：自己听牌了就打', 'attack', () => stanceAdvice(0, [read()], 30).stance);
    check('攻守建议：没人听牌就放心做牌', 'attack', () =>
      stanceAdvice(2, [read({ ting: false })], 40).stance);
    check('攻守建议：自己远、别人听了要守', 'defend', () => stanceAdvice(3, [read()], 10).stance);
    checkTrue('攻守建议都带一句解释', '有解释', () => stanceAdvice(2, [read()], 20).text.length > 10);
  });

  suite('花色连贯度', () => {
    check('345 条算一副面子', 1, () => suitCohesion(parseCounts('345s'), 1).melds);
    check('1 4 7 万算三个孤张', 3, () => suitCohesion(parseCounts('147m'), 0).isolated);
    check('34 万算一个搭子', 1, () => suitCohesion(parseCounts('34m'), 0).partials);
    check('数张数不会跨门', 4, () => suitCohesion(parseCounts('1479m 345s'), 0).count);
  });
}
