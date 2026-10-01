/**
 * 引擎延伸的着法配的说明：只说看得出来的事，而且名字要叫对（黑方是卒、象、士，不是兵、相、仕）。
 */
import { describe, expect, it } from 'vitest';
import { noteMove } from '../src/xiangqi/movenote';
import { applyMove, initialBoard, legalMoves, type Board, type Color } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';

function at(texts: string[]): { b: Board; c: Color } {
  let b = initialBoard();
  let c: Color = 'r';
  for (const t of texts) {
    b = applyMove(b, textToMove(b, c, t, legalMoves(b, c))!);
    c = c === 'r' ? 'b' : 'r';
  }
  return { b, c };
}
const note = (pre: string[], t: string) => {
  const { b, c } = at(pre);
  return noteMove(b, textToMove(b, c, t, legalMoves(b, c))!, c);
};

describe('着法说明', () => {
  it('黑方的卒叫卒，红方的兵叫兵', () => {
    expect(note(['炮二平五'], '卒7进1')).toContain('卒');
    expect(note(['炮二平五'], '卒7进1')).not.toContain('兵');
    expect(note([], '兵七进一')).toContain('兵');
  });

  it('飞中相说巩固中防，飞边相不这么说', () => {
    expect(note([], '相三进五')).toContain('中防');
    expect(note([], '相三进一')).not.toContain('中防');
  });

  it('架中炮、出直车、跳正马', () => {
    expect(note([], '炮二平五')).toContain('中炮');
    expect(note(['炮二平五', '马8进7', '马二进三', '车9平8'], '车一平二')).toContain('车');
    expect(note([], '马二进三')).toContain('正马');
  });

  it('吃子说吃了什么；将军说将军', () => {
    // 炮打中卒：对方马能吃回来，说清楚是拿炮换卒
    expect(note(['炮二平五', '马8进7'], '炮五进四')).toContain('用炮换卒');
    // 对方也架了中炮：打中卒隔着黑炮将军，没有子吃得回来
    const s = note(['炮二平五', '炮8平5'], '炮五进四');
    expect(s).toContain('吃掉卒');
    expect(s).toContain('将军');
  });

  it('一句话，句号结尾，不带标记', () => {
    const s = note([], '炮二平五');
    expect(s.endsWith('。')).toBe(true);
    expect(s).not.toMatch(/<[^>]+>/);
  });
});
