/**
 * 牌型识别与比较的单元测试。
 *
 * 规则引擎是整个游戏的地基：牌型判错，AI 会出非法牌，玩家会被无理由拒绝，
 * 而且这类错误在界面上表现为"莫名其妙出不了牌"，极难排查。
 * 所以这里逐个牌型测，并且**重点测边界**：2 和王不能进顺子、张数差一张、
 * 长度不同不能比、炸弹压制关系。
 */
import { describe, expect, it } from 'vitest';
import { analyzeMove, beats, compareMoves, toMove, type MoveType } from '../src/doudizhu/patterns';
import { hand } from './doudizhu-helpers';

/** 断言某组牌被识别成指定牌型，并返回 move 供进一步断言 */
function expectType(spec: string, type: MoveType) {
  const r = analyzeMove(hand(spec));
  if (!r.isValid) throw new Error(`${spec} 应该是 ${type}，却被判为非法：${r.reason}`);
  expect(r.move.type).toBe(type);
  return r.move;
}

function expectInvalid(spec: string) {
  const r = analyzeMove(hand(spec));
  expect(r.isValid).toBe(false);
  return r.isValid ? '' : r.reason;
}

describe('基础牌型', () => {
  it('单牌', () => {
    expect(expectType('3', 'single').mainRank).toBe(3);
    expect(expectType('D', 'single').mainRank).toBe(17);
  });

  it('对子', () => {
    expect(expectType('33', 'pair').mainRank).toBe(3);
    expect(expectType('22', 'pair').mainRank).toBe(15);
  });

  it('大小王不是对子，是王炸', () => {
    expect(expectType('XD', 'rocket').mainRank).toBe(17);
  });

  it('三张', () => {
    expect(expectType('KKK', 'triple').mainRank).toBe(13);
  });

  it('两张不同点数不成牌', () => {
    expect(expectInvalid('34')).toContain('对子');
  });
});

describe('三带', () => {
  it('三带一', () => {
    const m = expectType('5556', 'triple_single');
    expect(m.mainRank).toBe(5);
    expect(m.attachments).toEqual([6]);
  });

  it('三带二（带一对）', () => {
    const m = expectType('55566', 'triple_pair');
    expect(m.mainRank).toBe(5);
    expect(m.attachments).toEqual([6]);
  });

  it('三带一里带的是王也可以', () => {
    expect(expectType('555D', 'triple_single').attachments).toEqual([17]);
  });

  it('三带两张不同的单牌不合法', () => {
    expect(expectInvalid('55567')).toBeTruthy();
  });
});

describe('顺子（单顺）', () => {
  it('5 张连续成顺子，mainRank 取最大', () => {
    const m = expectType('34567', 'straight');
    expect(m.length).toBe(5);
    expect(m.mainRank).toBe(7);
  });

  it('12 张最长顺子 3..A', () => {
    expect(expectType('3456789TJQKA', 'straight').length).toBe(12);
  });

  it('4 张连续不够，提示张数', () => {
    expect(expectInvalid('3456')).toContain('5 张');
  });

  it('顺子不能包含 2', () => {
    expect(expectInvalid('TJQKA2')).toContain('2');
  });

  it('顺子不能包含王', () => {
    expect(expectInvalid('JQKAXD')).toBeTruthy();
    expect(expectInvalid('TJQKAX')).toContain('王');
  });

  it('A 之后不能接 2 绕回 3', () => {
    expect(expectInvalid('QKA23')).toBeTruthy();
  });

  it('中间断了不算顺子', () => {
    expect(expectInvalid('34568')).toContain('连续');
  });
});

describe('双顺（连对）', () => {
  it('3 对连续', () => {
    const m = expectType('334455', 'double_straight');
    expect(m.length).toBe(3);
    expect(m.mainRank).toBe(5);
  });

  it('2 对不够', () => {
    expect(expectInvalid('3344')).toContain('3 对');
  });

  it('连对不能带 2', () => {
    expect(expectInvalid('KKAA22')).toContain('2');
  });

  it('连对不能用王', () => {
    expect(expectInvalid('AAXD')).toBeTruthy();
  });

  it('断开的两对不算连对', () => {
    expect(expectInvalid('335566')).toBeTruthy();
  });
});

describe('三顺 / 飞机不带翅膀', () => {
  it('两组连续三张', () => {
    const m = expectType('333444', 'triple_straight');
    expect(m.length).toBe(2);
    expect(m.mainRank).toBe(4);
  });

  it('三组连续三张', () => {
    expect(expectType('333444555', 'triple_straight').length).toBe(3);
  });

  it('三顺不能包含 2', () => {
    expect(expectInvalid('AAA222')).toContain('2');
  });

  it('不连续的两组三张不合法', () => {
    expect(expectInvalid('333555')).toBeTruthy();
  });
});

describe('飞机带翅膀', () => {
  it('飞机带两单', () => {
    const m = expectType('33344478', 'plane_single');
    expect(m.length).toBe(2);
    expect(m.mainRank).toBe(4);
    expect(m.attachments).toEqual([7, 8]);
  });

  it('翅膀是一对拆成两单也算（主流判法）', () => {
    expect(expectType('33344455', 'plane_single').attachments).toEqual([5, 5]);
  });

  it('飞机带两对', () => {
    const m = expectType('3334446677', 'plane_pair');
    expect(m.length).toBe(2);
    expect(m.attachments).toEqual([6, 7]);
  });

  it('三组飞机带三单', () => {
    expect(expectType('333444555789', 'plane_single').length).toBe(3);
  });

  it('三组飞机带三对', () => {
    expect(expectType('333444555778899', 'plane_pair').length).toBe(3);
  });

  it('翅膀不能拆炸弹', () => {
    // 333 444 + 7777 当四个单牌：炸弹不许被拆成翅膀
    expect(expectInvalid('3334447777')).toBeTruthy();
  });

  it('翅膀不能是王炸', () => {
    expect(expectInvalid('333444XD')).toBeTruthy();
  });

  it('翅膀张数对不上不合法', () => {
    expect(expectInvalid('3334447')).toBeTruthy();
    expect(expectInvalid('333444789')).toBeTruthy();
  });

  it('飞机主体必须连续', () => {
    expect(expectInvalid('33355578')).toBeTruthy();
  });

  it('AAA 222 不能当飞机', () => {
    expect(expectInvalid('AAA22234')).toBeTruthy();
  });
});

describe('炸弹与王炸', () => {
  it('四张相同是炸弹', () => {
    expect(expectType('7777', 'bomb').mainRank).toBe(7);
  });

  it('王炸', () => {
    expect(expectType('XD', 'rocket').type).toBe('rocket');
  });

  it('单独一张王是单牌', () => {
    expect(expectType('X', 'single').mainRank).toBe(16);
  });
});

describe('四带二', () => {
  it('四带两张单牌', () => {
    const m = expectType('777756', 'four_two_singles');
    expect(m.mainRank).toBe(7);
    expect(m.attachments).toEqual([5, 6]);
  });

  it('四带一对（当两张单）也合法', () => {
    expect(expectType('777755', 'four_two_singles').mainRank).toBe(7);
  });

  it('四带两对', () => {
    const m = expectType('77775566', 'four_two_pairs');
    expect(m.mainRank).toBe(7);
    expect(m.attachments).toEqual([5, 6]);
  });

  it('四带两对必须是两个不同点数的对子', () => {
    // 7777 5555：按主流判法读成飞机带两单（5,7 不连续 -> 非法），不算四带两对
    expect(expectInvalid('77775555')).toBeTruthy();
  });

  it('四带三张不合法', () => {
    expect(expectInvalid('7777568')).toBeTruthy();
  });
});

describe('比较：同牌型比核心点数', () => {
  const m = (s: string) => toMove(hand(s))!;

  it('单牌', () => {
    expect(beats(m('5'), m('4'))).toBe(true);
    expect(beats(m('4'), m('5'))).toBe(false);
    expect(beats(m('2'), m('A'))).toBe(true);
    expect(beats(m('X'), m('2'))).toBe(true);
    expect(beats(m('D'), m('X'))).toBe(true);
  });

  it('对子', () => {
    expect(beats(m('AA'), m('KK'))).toBe(true);
    expect(beats(m('33'), m('22'))).toBe(false);
  });

  it('顺子比最大点数，长度必须一样', () => {
    expect(beats(m('45678'), m('34567'))).toBe(true);
    expect(beats(m('345678'), m('34567'))).toBe(false); // 6 张压不了 5 张
    expect(beats(m('34567'), m('345678'))).toBe(false);
  });

  it('连对', () => {
    expect(beats(m('445566'), m('334455'))).toBe(true);
    expect(beats(m('33445566'), m('334455'))).toBe(false);
  });

  it('飞机比三张的最大点数', () => {
    expect(beats(m('44455578'), m('33344456'))).toBe(true);
    expect(beats(m('333444JQ'), m('33344456'))).toBe(false); // 主体相同，带的牌不参与比较
  });

  it('三带比三张的点数，不看带的牌', () => {
    expect(beats(m('5553'), m('4442'))).toBe(true);
    expect(beats(m('444D'), m('5553'))).toBe(false);
  });

  it('不同牌型互不相压', () => {
    expect(beats(m('33445566'), m('3456789T'))).toBe(false); // 4 连对 vs 8 张顺子，张数一样也压不了
    expect(beats(m('5556'), m('55566'))).toBe(false);
  });
});

describe('比较：炸弹压制关系', () => {
  const m = (s: string) => toMove(hand(s))!;

  it('炸弹压普通牌型', () => {
    expect(beats(m('3333'), m('AAA22'))).toBe(true);
    expect(beats(m('3333'), m('3456789TJQKA'))).toBe(true);
  });

  it('普通牌型压不了炸弹', () => {
    expect(beats(m('AAA22'), m('3333'))).toBe(false);
    expect(beats(m('2'), m('3333'))).toBe(false);
  });

  it('大炸弹压小炸弹', () => {
    expect(beats(m('4444'), m('3333'))).toBe(true);
    expect(beats(m('3333'), m('4444'))).toBe(false);
  });

  it('王炸压一切，包括炸弹', () => {
    expect(beats(m('XD'), m('2222'))).toBe(true);
    expect(beats(m('XD'), m('3'))).toBe(true);
    expect(beats(m('2222'), m('XD'))).toBe(false);
  });

  it('桌面为空时任何合法牌都能出', () => {
    expect(beats(m('3'), null)).toBe(true);
  });
});

describe('compareMoves 给出的提示要说得清楚', () => {
  const m = (s: string) => toMove(hand(s))!;

  it('张数不够的顺子要说清差在哪', () => {
    const r = compareMoves(hand('3456'), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('5 张');
  });

  it('牌型不同要点名上家出的是什么', () => {
    const r = compareMoves(hand('3344'), m('345'.concat('67')));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason.length).toBeGreaterThan(6);
  });

  it('长度不同要说清要几张', () => {
    const r = compareMoves(hand('456789'), m('34567'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('一样');
  });

  it('没上家大要报出两边的点数', () => {
    const r = compareMoves(hand('3'), m('5'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('5');
  });

  it('上家是炸弹时提示只能用更大的炸弹', () => {
    const r = compareMoves(hand('AAA22'), m('3333'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('炸弹');
  });

  it('提示里不能只有"出牌失败"这种废话', () => {
    const r = compareMoves(hand('3457'), null);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).not.toBe('出牌失败');
  });
});
