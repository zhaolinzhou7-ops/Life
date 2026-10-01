/**
 * 邪门布局破解的数据：着法都走得通、认得出、陪练走得对、破解算定式。
 * 引擎层面的结论（邪门着亏多少、破解是不是最好、上当亏多少）由 tools/check-tricks.ts 让皮卡鱼复核，
 * 这里锁死的是数据本身的一致性。
 */
import { describe, expect, it } from 'vitest';
import { TRICKS, lineToTrap, refuteLine, trapLine, trickAt, trickMoveFor, trickStageAt, walkMoves } from '../src/xiangqi/tricks';
import { bookMoves, isBookMove } from '../src/xiangqi/book';
import { initialBoard, legalMoves, statusAfter } from '../src/xiangqi/rules';
import { moveToText, textToMove } from '../src/xiangqi/notation';

describe('邪门布局数据', () => {
  it('每一条的套路、破解、上当都走得通', () => {
    for (const t of TRICKS) {
      expect(walkMoves([...t.pre, t.trick.t]), t.id).not.toBeNull();
      expect(walkMoves([...t.pre, t.trick.t, ...t.refute.map((s) => s.t)]), `${t.id} 破解`).not.toBeNull();
      expect(walkMoves([...lineToTrap(t), ...t.trap.map((s) => s.t)]), `${t.id} 上当`).not.toBeNull();
    }
  });

  it('第二关的位置标得对：轮到破解方，而且破解在那之后还有着法', () => {
    for (const t of TRICKS) {
      const k = t.trapAfter ?? 0;
      expect(k % 2, t.id).toBe(0);
      expect(t.refute.length, t.id).toBeGreaterThan(k);
    }
  });

  it('江湖上最常碰到的几种都收了', () => {
    const names = TRICKS.map((t) => t.name).join(' ');
    for (const n of ['敢死炮', '铁滑车', '双铁滑车', '叠炮', '瞎眼狗']) expect(names, n).toContain(n);
    // 敢死炮红黑两边都有
    expect(TRICKS.filter((t) => t.name.includes('敢死炮')).map((t) => t.by).sort()).toEqual(['b', 'r']);
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

  it('第二关认得出：子吃到手、对方出车来捉的那个局面', () => {
    const staged = TRICKS.filter((t) => t.trapAfter);
    expect(staged.length).toBeGreaterThanOrEqual(3);
    for (const t of staged) {
      const w = walkMoves(lineToTrap(t))!;
      expect(trickStageAt(w.board, w.color)?.id, t.id).toBe(t.id);
      expect(trickAt(w.board, w.color), t.id).toBeNull();
    }
    for (const t of TRICKS.filter((x) => !x.trapAfter)) {
      const w = walkMoves([...t.pre, t.trick.t])!;
      expect(trickStageAt(w.board, w.color), t.id).toBeNull();
    }
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

  it('敢死炮：你吃了炮，它还会按套路跳马出车来捉，把你带到第二关', () => {
    const w = walkMoves(['炮八进二', '马2进3', '炮八平二', '炮8进5'])!;
    const r = trickMoveFor(w.moves, 'r', 'gansipao-red');
    expect(r?.trick.id).toBe('gansipao-red');
    expect(moveToText(w.board, r!.move)).toBe('马二进三');
  });

  it('铁滑车：开局车一进一，单、双铁滑车都能接上', () => {
    const w = walkMoves(['车一进一', '炮8进7'])!;
    expect(moveToText(w.board, trickMoveFor(w.moves, 'r', 'tiehuache')!.move)).toBe('炮二平五');
    expect(moveToText(w.board, trickMoveFor(w.moves, 'r', 'shuang-tiehuache')!.move)).toBe('车九进一');
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

  it('上当那一手不在定式里（第二关的在第二关比）', () => {
    for (const t of TRICKS) {
      const w = walkMoves(lineToTrap(t))!;
      const m = textToMove(w.board, w.color, t.trap[0].t, legalMoves(w.board, w.color))!;
      expect(isBookMove(w.board, w.color, m), t.id).toBe(false);
    }
  });

  it('备选破法在求助里配的是它自己的理由，不套用正解的', () => {
    const w = walkMoves(['炮二平五', '炮2进7'])!;
    const alt = bookMoves(w.board, w.color).find((b) => b.text === '车九平八')!;
    expect(alt.why).toContain('吃回');
    expect(alt.why).not.toContain('不急着');
  });

  it('第二关的破解也算定式：求助里以它领衔，教练不拦', () => {
    for (const t of TRICKS.filter((x) => x.trapAfter)) {
      const w = walkMoves(lineToTrap(t))!;
      const k = t.trapAfter!;
      expect(bookMoves(w.board, w.color).some((b) => b.text === t.refute[k].t && b.opening.includes('破解')), t.id).toBe(true);
    }
  });
});

describe('破解走得够深', () => {
  // 用户原话："破解往往不是三四步的事，可能需要十几步甚至更深入的思考"
  it('每一条破解谱从邪门着之后至少走 10 个回合（除非中途已经将死）', () => {
    for (const t of TRICKS) {
      const line = refuteLine(t);
      const w = walkMoves([...t.pre, t.trick.t, ...line.map((s) => s.t)]);
      expect(w, `${t.id} 破解谱走不通`).not.toBeNull();
      if (statusAfter(w!.board, w!.color) === 'playing') expect(line.length, t.id).toBeGreaterThanOrEqual(20);
    }
  });

  it('上当谱也延伸到对方把便宜兑现，每一手都有说明', () => {
    for (const t of TRICKS) {
      const line = trapLine(t);
      const w = walkMoves([...lineToTrap(t), ...line.map((s) => s.t)]);
      expect(w, `${t.id} 上当谱走不通`).not.toBeNull();
      const short = walkMoves([...lineToTrap(t), ...t.trap.map((s) => s.t)])!;
      if (statusAfter(short.board, short.color) === 'playing') expect(line.length, t.id).toBeGreaterThan(t.trap.length);
      for (const s of [...refuteLine(t), ...line]) expect(s.why.length, `${t.id} ${s.t}`).toBeGreaterThan(1);
    }
  });
});
