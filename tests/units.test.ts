import { describe, expect, it } from 'vitest';
import { NEGLIGIBLE, pawns } from '../src/xiangqi/teach';

// 评估里提的：复盘里同一手棋标着"优 好棋"，下面又写"他该走 卒3进1：比他这手多得约 3 分（约 0.0 个兵）"；
// 局面差几分、实战分、准确率都叫"分"
describe('局面差多少一律说"几个兵"', () => {
  it('一位小数，十个兵以上取整', () => {
    expect(pawns(3)).toBe('0.0 个兵');
    expect(pawns(40)).toBe('0.4 个兵');
    expect(pawns(-250)).toBe('2.5 个兵');
    expect(pawns(1000)).toBe('10 个兵');
  });

  it('差不到 0.3 个兵算一样好（引擎算两次都能差这么多）', () => {
    expect(NEGLIGIBLE).toBe(30);
  });
});
