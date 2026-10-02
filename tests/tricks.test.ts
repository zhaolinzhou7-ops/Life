/**
 * 邪门布局破解的数据：着法都走得通、认得出、陪练走得对、破解算定式。
 * 引擎层面的结论（邪门着亏多少、破解是不是最好、上当亏多少）由 tools/check-tricks.ts 让皮卡鱼复核，
 * 这里锁死的是数据本身的一致性。
 */
import { describe, expect, it } from 'vitest';
import { TRICKS, ledger, lineToTrap, pitfalls, refuteLine, sacrificeAt, trapLine, trickAt, trickMoveFor, trickStageAt, walkMoves } from '../src/xiangqi/tricks';
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
    for (const n of ['弃马十三着', '敢死炮', '铁滑车', '双铁滑车', '急进中兵', '叠炮', '瞎眼狗', '龟背炮']) expect(names, n).toContain(n);
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

  it('挑定了一条就一直走它：弃马十三着十步铺垫一手不差', () => {
    const t = TRICKS.find((x) => x.id === 'qima-shisan')!;
    const w = walkMoves(['炮二平五', '炮8平5'])!;
    const r = trickMoveFor(w.moves, 'r', t.id);
    expect(r?.trick.id).toBe(t.id);
    expect(moveToText(w.board, r!.move)).toBe('马二进三');
    const w2 = walkMoves(t.pre)!;
    expect(moveToText(w2.board, trickMoveFor(w2.moves, 'r', t.id)!.move)).toBe('车九进一');
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
    const w = walkMoves(['炮二进二', '炮8平5', '炮二平八', '炮2进5'])!;
    const r = trickMoveFor(w.moves, 'r', 'gansipao-red');
    expect(r?.trick.id).toBe('gansipao-red');
    expect(moveToText(w.board, r!.move)).toBe('马八进七');
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
    const w = walkMoves(['炮二平五', '车1进1'])!;
    const alt = bookMoves(w.board, w.color).find((b) => b.text === '炮五进四')!;
    expect(alt.why).toContain('中卒');
    expect(alt.why).not.toContain('马是白送的');
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

describe('套路讲透', () => {
  // 用户原话："对方走这一步是什么意思、陷阱到底在哪里，肯定都有陷阱，这些要讲明白。"
  it('套路的每一手都有自己的说明，不再是一句"布局的正常着法"', () => {
    for (const t of TRICKS) {
      expect(t.preWhy.length, t.id).toBe(t.pre.length);
      for (const w of t.preWhy) {
        expect(w.length, t.id).toBeGreaterThan(4);
        expect(w, t.id).not.toContain('布局的正常着法');
      }
    }
  });

  it('陷阱拆解五样都写了：表面上、陷阱在哪、上当之后、怎么认出来、破了之后', () => {
    for (const t of TRICKS) {
      for (const k of ['looks', 'bait', 'punish', 'spot', 'after'] as const) expect(t.anatomy[k].length, `${t.id} ${k}`).toBeGreaterThan(15);
    }
  });

  it('"上当之后"写的着法和上当谱一致：上当谱的每一手都按顺序出现', () => {
    for (const t of TRICKS) {
      let at = 0;
      for (const s of t.trap) {
        const i = t.anatomy.punish.indexOf(s.t, at);
        expect(i, `${t.id}：上当之后没写到 ${s.t}`).toBeGreaterThanOrEqual(0);
        at = i + s.t.length;
      }
    }
  });

  it('"破了之后"从破解的关键一手讲起', () => {
    for (const t of TRICKS) expect(t.anatomy.after, t.id).toContain(t.refute[t.trapAfter ?? 0].t);
  });
});

describe('宁失一子，不失一先：账本和坑', () => {
  // 用户原话："讲究的是'宁失一子，不失一先'……要以象棋棋王的水平去破解，把这几个布局的精髓给讲透。"
  it('每一条都写了精髓', () => {
    for (const t of TRICKS) expect(t.essence.length, t.id).toBeGreaterThan(80);
  });

  it('账本：上当、破解两条线每一手都有子力差和局面分', () => {
    for (const t of TRICKS) {
      for (const w of ['trap', 'refute'] as const) {
        const L = ledger(t, w);
        expect(L.score.length, `${t.id} ${w}`).toBeGreaterThan(t.pre.length + 2);
        expect(L.material.length, `${t.id} ${w}`).toBe(L.score.length);
      }
    }
  });

  it('真弃了子的套路：吃到手那一刻他的子力少了，局面分却没少那么多——差出来的就是先手', () => {
    const sac = ['tiehuache', 'shuang-tiehuache', 'gansipao-red', 'diepao', 'qima-shisan', 'tiehuache-black', 'gansipao-black', 'xiayangou'];
    for (const id of sac) {
      const t = TRICKS.find((x) => x.id === id)!;
      const s = sacrificeAt(t);
      expect(s, id).not.toBeNull();
      expect(s!.material, id).toBeLessThan(-90);
    }
    // 红方这几套的先手是实打实的（黑方的几套，引擎看送的子换不回多少先手，界面上照实说）
    for (const id of ['tiehuache', 'shuang-tiehuache', 'gansipao-red', 'diepao', 'qima-shisan']) {
      const s = sacrificeAt(TRICKS.find((x) => x.id === id)!)!;
      expect(s.score, `${id} 局面分比子力差高`).toBeGreaterThan(s.material);
    }
    // 弃马十三着：少一个马，引擎却判他领先
    const q = sacrificeAt(TRICKS.find((x) => x.id === 'qima-shisan')!)!;
    expect(q.material).toBeLessThanOrEqual(-400);
    expect(q.score).toBeGreaterThan(0);
  });

  it('坑：深算标出来的错着里有上当那一手；弃马十三着两个坑（吃马、退马）', () => {
    for (const t of TRICKS) {
      const ps = pitfalls(t);
      const fork = lineToTrap(t).length;
      expect(ps.some((p) => p.ply === fork && p.played === t.trap[0].t), t.id).toBe(true);
    }
    const q = pitfalls(TRICKS.find((x) => x.id === 'qima-shisan')!).map((p) => p.played);
    expect(q).toEqual(['炮2进7', '马7退8']);
  });

  it('其它常见错着写在破解方该走的位置上', () => {
    for (const t of TRICKS) {
      for (const w of t.wrong ?? []) {
        expect(w.at % 2, `${t.id} ${w.t}`).toBe(0);
        const p = walkMoves([...t.pre, t.trick.t, ...t.refute.slice(0, w.at).map((s) => s.t)])!;
        expect(textToMove(p.board, p.color, w.t, legalMoves(p.board, p.color)), `${t.id} ${w.t}`).not.toBeNull();
        expect(w.loss, `${t.id} ${w.t}`).toBeGreaterThanOrEqual(120);
      }
    }
  });
});
