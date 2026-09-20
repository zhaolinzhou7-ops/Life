/**
 * 评估函数测试。
 *
 * 评估函数是整个产品水平的天花板：引擎脑子里没有的东西，教练就讲不出来。
 * 重写之后这里逐项验证它真的懂这些象棋要素，而不是只会数子。
 */
import { describe, expect, it } from 'vitest';
import { TERM_NAMES, evaluatePosition, evaluateTerms, resetEngine } from '../src/xiangqi/ai';
import { initialBoard } from '../src/xiangqi/rules';
import { bare, board, put } from './helpers';

const T = { MAT: 0, PST: 1, HORSE: 2, ROOK: 3, CANNON: 4, KING: 5, PAWN: 6 };

describe('分项齐全', () => {
  it('七个分项都有名字，界面不会显示 undefined', () => {
    expect(TERM_NAMES.length).toBe(7);
    for (const n of TERM_NAMES) expect(n.length).toBeGreaterThan(0);
  });

  it('开局是均势', () => {
    expect(Math.abs(evaluatePosition(initialBoard()))).toBeLessThan(200);
  });

  it('开局双方对称，所有分项都接近 0', () => {
    const t = evaluateTerms(initialBoard());
    for (let i = 0; i < 7; i++) expect(Math.abs(t[i]), `${TERM_NAMES[i]} 不该有偏向`).toBeLessThan(120);
  });
});

describe('马腿——象棋里最容易被忽略、又最要命的一条', () => {
  it('四条腿被堵死的马，评分明显低于四条腿全通的马', () => {
    const free = bare();
    put(free, 4, 5, 'n'); // 黑马在空地中央
    const stuck = bare();
    put(stuck, 4, 5, 'n');
    for (const [x, y] of [[4, 4], [4, 6], [3, 5], [5, 5]] as const) put(stuck, x, y, 'p');
    // 黑方视角：被堵的那只马这一项要差
    expect(evaluateTerms(stuck)[T.HORSE]).toBeGreaterThan(evaluateTerms(free)[T.HORSE]);
  });

  it('自己的子把自己的马堵住，一样算数', () => {
    const a = bare();
    put(a, 4, 5, 'H');
    const b = bare();
    put(b, 4, 5, 'H');
    for (const [x, y] of [[4, 4], [4, 6], [3, 5], [5, 5]] as const) put(b, x, y, 'P');
    // 红方视角：堵住之后马这一项要降（把兵的位置分抵消掉看趋势）
    expect(evaluateTerms(b)[T.HORSE]).toBeLessThan(evaluateTerms(a)[T.HORSE]);
  });
});

describe('车路——车的价值几乎全在通不通', () => {
  it('空地上的车比被堵死的车值钱', () => {
    const open = bare();
    put(open, 4, 5, 'R');
    const boxed = bare();
    put(boxed, 4, 5, 'R');
    for (const [x, y] of [[4, 4], [4, 6], [3, 5], [5, 5]] as const) put(boxed, x, y, 'P');
    expect(evaluateTerms(open)[T.ROOK]).toBeGreaterThan(evaluateTerms(boxed)[T.ROOK]);
  });

  it('肋道（三路五路）上的车有加分', () => {
    const rib = bare();
    put(rib, 3, 5, 'R');
    const side = bare();
    put(side, 1, 5, 'R');
    expect(evaluateTerms(rib)[T.ROOK]).toBeGreaterThan(evaluateTerms(side)[T.ROOK]);
  });
});

describe('炮——空头炮是象棋里最凶的位置之一', () => {
  it('和对方老将同一直线且中间无子（空头炮）明显加分', () => {
    // 黑将在 (3,0)。红炮摆到三路且中间清空 = 空头炮
    const hollow = bare();
    put(hollow, 3, 6, 'C');
    const plain = bare();
    put(plain, 0, 6, 'C');
    expect(evaluateTerms(hollow)[T.CANNON]).toBeGreaterThan(evaluateTerms(plain)[T.CANNON]);
  });

  it('中间隔一个子（架好了）也加分，但不如空头炮', () => {
    const hollow = bare();
    put(hollow, 3, 6, 'C');
    const withScreen = bare();
    put(withScreen, 3, 6, 'C');
    put(withScreen, 3, 3, 'p');
    const a = evaluateTerms(hollow)[T.CANNON];
    const b = evaluateTerms(withScreen)[T.CANNON];
    expect(b).toBeGreaterThan(0);
    expect(a).toBeGreaterThan(b);
  });
});

describe('将帅安全', () => {
  it('老将那一路被对方的车直接照住，安全分要降', () => {
    const safe = bare();
    put(safe, 0, 3, 'r');
    const exposed = bare();
    put(exposed, 4, 3, 'r'); // 黑车照住红帅所在的四路（红帅在 (4,9)）
    expect(evaluateTerms(exposed)[T.KING]).toBeLessThan(evaluateTerms(safe)[T.KING]);
  });

  it('士象齐全比光杆司令安全', () => {
    const guarded = bare();
    put(guarded, 3, 9, 'A');
    put(guarded, 5, 9, 'A');
    expect(evaluateTerms(guarded)[T.KING]).toBeGreaterThan(evaluateTerms(bare())[T.KING]);
  });
});

describe('兵卒', () => {
  it('过河兵比没过河的兵值钱，越靠近底线越值钱', () => {
    const home = bare();
    put(home, 4, 6, 'P');
    const crossed = bare();
    put(crossed, 4, 4, 'P');
    const deep = bare();
    put(deep, 4, 1, 'P');
    const a = evaluateTerms(home)[T.PAWN];
    const b = evaluateTerms(crossed)[T.PAWN];
    const c = evaluateTerms(deep)[T.PAWN];
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });
});

describe('总分仍然以子力为主——位置分不能喧宾夺主', () => {
  it('多一个车一定压过任何位置上的便宜', () => {
    resetEngine();
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    put(b, 0, 9, 'R'); // 红方多一个车（1000）
    // 给黑方位置上的便宜，但**不能给子力**——给一只马就变成"多车对多马"，
    // 那验的是子力差不是位置分（上一版这个用例就是这么写错的）
    put(b, 4, 6, 'p'); // 过河卒
    put(b, 3, 6, 'p'); // 又一个过河卒
    // 两个过河卒加上位置分也不该抵消一个车
    expect(evaluatePosition(b)).toBeGreaterThan(500);
  });
});
