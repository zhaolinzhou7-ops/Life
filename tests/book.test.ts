/**
 * 开局定式索引：求助和教练在开局要参照成熟定式，而不是只信浅层搜索。
 */
import { describe, expect, it } from 'vitest';
import { bookMoves, isBookMove } from '../src/xiangqi/book';
import { OPENINGS } from '../src/xiangqi/openings';
import { applyMove, initialBoard, legalMoves } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';

describe('开局定式', () => {
  it('开局第一步：定式里有中炮和仙人指路', () => {
    const texts = bookMoves(initialBoard(), 'r').map((b) => b.text);
    expect(texts).toContain('炮二平五');
    expect(texts).toContain('兵七进一');
  });

  it('每一套定式走下去，每一步都能在索引里查到，而且都是合法着法', () => {
    for (const o of OPENINGS) {
      let b = initialBoard();
      let c: 'r' | 'b' = 'r';
      for (const om of o.moves) {
        const m = textToMove(b, c, om.t, legalMoves(b, c));
        expect(m, `${o.name} 的 ${om.t} 不合法`).not.toBeNull();
        expect(isBookMove(b, c, m!), `${o.name} 的 ${om.t} 查不到`).toBe(true);
        b = applyMove(b, m!);
        c = c === 'r' ? 'b' : 'r';
      }
    }
  });

  it('说明只取一句话，不带标记', () => {
    for (const bm of bookMoves(initialBoard(), 'r')) {
      expect(bm.why).not.toMatch(/<[^>]+>/);
      expect(bm.why.split('。').filter(Boolean).length).toBe(1);
    }
  });

  it('定式之外的局面返回空', () => {
    const b = applyMove(initialBoard(), { fx: 0, fy: 9, tx: 0, ty: 8 }); // 车九进一
    expect(bookMoves(b, 'b')).toEqual([]);
  });
});
