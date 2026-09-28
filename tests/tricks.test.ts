/**
 * 邪门布局破解的数据：着法都走得通、认得出、陪练走得对、破解算定式。
 * 引擎层面的结论（邪门着亏多少、破解是不是最好、上当亏多少）由 tools/check-tricks.ts 让皮卡鱼复核，
 * 这里锁死的是数据本身的一致性。
 */
import { describe, expect, it } from 'vitest';
import { TRICKS, trickAt, trickMoveFor, walkMoves } from '../src/xiangqi/tricks';
import { bookMoves, isBookMove } from '../src/xiangqi/book';
import { initialBoard, legalMoves } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';

describe('邪门布局数据', () => {
  it('每一条的套路、破解、上当都走得通', () => {
    for (const t of TRICKS) {
      expect(walkMoves([...t.pre, t.trick.t]), t.id).not.toBeNull();
      expect(walkMoves([...t.pre, t.trick.t, ...t.refute.map((s) => s.t)]), `${t.id} 破解`).not.toBeNull();
      expect(walkMoves([...t.pre, t.trick.t, ...t.trap.map((s) => s.t)]), `${t.id} 上当`).not.toBeNull();
    }
  });

  it('邪门着是 by 那一方走的；备选破解也走得通', () => {
    for (const t of TRICKS) {
      const pre = walkMoves(t.pre)!;
      expect(pre.color, t.id).toBe(t.by);
      const w = walkMoves([...t.pre, t.trick.t])!;
      for (const alt of t.refute[0].alts ?? []) expect(textToMove(w.board, w.color, alt, legalMoves(w.board, w.color)), alt).not.toBeNull();
    }
  });

  it('写进数据的结论本身说得通：邪门着亏、上当比破解差得多', () => {
    for (const t of TRICKS) {
      expect(t.verified.trickLoss, t.id).toBeGreaterThanOrEqual(60);
      expect(t.verified.trapLoss, t.id).toBeGreaterThanOrEqual(150);
    }
  });

  it('id 不重复，两边都有', () => {
    expect(new Set(TRICKS.map((t) => t.id)).size).toBe(TRICKS.length);
    expect(TRICKS.some((t) => t.by === 'r')).toBe(true);
    expect(TRICKS.some((t) => t.by === 'b')).toBe(true);
  });
});

describe('认出邪门着', () => {
  it('邪门着刚走完的局面认得出，开局认不出', () => {
    for (const t of TRICKS) {
      const w = walkMoves([...t.pre, t.trick.t])!;
      expect(trickAt(w.board, w.color)?.id, t.id).toBe(t.id);
    }
    expect(trickAt(initialBoard(), 'r')).toBeNull();
  });
});

describe('陪练走邪门布局', () => {
  it('开局就能走红方的邪门套路', () => {
    const r = trickMoveFor([], 'r', undefined, () => 0);
    expect(r).not.toBeNull();
    const w = walkMoves([...r!.trick.pre, r!.trick.trick.t])!;
    expect(r!.move).toEqual(w.moves[0]);
  });

  it('挑定了一条就一直走它', () => {
    const t = TRICKS.find((x) => x.id === 'shunpao-zhongzu-check')!;
    const w = walkMoves(['炮二平五', '炮8平5'])!;
    const r = trickMoveFor(w.moves, 'r', t.id);
    expect(r?.trick.id).toBe(t.id);
    expect(moveToText(w.board, r!.move)).toBe('炮五进四');
  });

  it('你一架中炮，黑方的几条套路都能接上', () => {
    const w = walkMoves(['炮二平五'])!;
    const ids = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const r = trickMoveFor(w.moves, 'b', undefined, () => i / 40);
      if (r) ids.add(r.trick.id);
    }
    expect(ids.size).toBeGreaterThanOrEqual(3);
  });

  it('你走出了套路之外，对手照常下', () => {
    const w = walkMoves(['兵三进一'])!;
    expect(trickMoveFor(w.moves, 'b')).toBeNull();
  });
});

describe('破解算定式', () => {
  it('邪门着之后，破解那一手（和备选）在定式里，教练不拦', () => {
    for (const t of TRICKS) {
      const w = walkMoves([...t.pre, t.trick.t])!;
      const books = bookMoves(w.board, w.color);
      expect(books.some((b) => b.text === t.refute[0].t && b.opening.includes('破解')), t.id).toBe(true);
      for (const alt of t.refute[0].alts ?? []) {
        expect(isBookMove(w.board, w.color, textToMove(w.board, w.color, alt, legalMoves(w.board, w.color))!)).toBe(true);
      }
    }
  });

  it('上当那一手不在定式里', () => {
    for (const t of TRICKS) {
      const w = walkMoves([...t.pre, t.trick.t])!;
      const m = textToMove(w.board, w.color, t.trap[0].t, legalMoves(w.board, w.color))!;
      expect(isBookMove(w.board, w.color, m), t.id).toBe(false);
    }
  });
});
