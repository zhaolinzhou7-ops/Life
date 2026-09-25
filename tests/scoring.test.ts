/**
 * 评分：每一手的准确率、称号（妙手/唯一着/最佳…），以及一方整盘的准确率。
 * 分数要"说得通"：好棋高分、漏着低分、一手漏着能把整盘分数拉下来。
 */
import { describe, expect, it } from 'vitest';
import {
  evalWords,
  gameAccuracy,
  labelOf,
  moveAccuracy,
  phaseAt,
  reviewMove,
  summarize,
  winPct,
  type Judged,
} from '../src/xiangqi/analysis';
import { initialBoard } from '../src/xiangqi/rules';
import { fromFen } from '../src/xiangqi/notation';

const mv = (fx: number, fy: number, tx: number, ty: number) => ({ fx, fy, tx, ty });

describe('胜率', () => {
  it('均势 50%，多一个车九成以上，杀棋就是 100 / 0', () => {
    expect(winPct(0)).toBeCloseTo(50, 5);
    expect(winPct(1000)).toBeGreaterThan(90);
    expect(winPct(-1000)).toBeLessThan(10);
    expect(winPct(100)).toBeGreaterThan(54);
    expect(winPct(100)).toBeLessThan(58);
    expect(winPct(0, 3)).toBe(100);
    expect(winPct(0, -2)).toBe(0);
  });

  it('多两个车之后再亏一个兵几乎不掉胜率；均势亏一个兵掉得多——这就是用胜率打分的理由', () => {
    const lateDrop = winPct(2000) - winPct(1900);
    const evenDrop = winPct(0) - winPct(-100);
    expect(evenDrop).toBeGreaterThan(lateDrop * 5);
  });
});

describe('每一手的准确率', () => {
  it('没掉胜率 100 分，掉得越多分越低', () => {
    expect(moveAccuracy(60, 60)).toBe(100);
    expect(moveAccuracy(60, 70)).toBe(100); // 比引擎首选还好（搜索误差）也是 100
    const a5 = moveAccuracy(60, 55);
    const a20 = moveAccuracy(60, 40);
    expect(a5).toBeGreaterThan(70);
    expect(a5).toBeLessThan(90);
    expect(a20).toBeLessThan(50);
    expect(moveAccuracy(90, 5)).toBeLessThan(5);
  });

  it('整盘：一手漏着能把分数明显拉下来，不会被几十手好棋摊平', () => {
    const clean = Array(30).fill(95);
    const oneBlunder = [...Array(29).fill(95), 0];
    expect(gameAccuracy(clean)).toBe(95);
    expect(gameAccuracy(oneBlunder)).toBeLessThan(gameAccuracy(clean) - 5);
  });
});

describe('称号', () => {
  const b = initialBoard();
  const judged = (best: number, played: number, same: boolean, extra: Partial<Judged> = {}): Judged => ({
    best: { move: mv(7, 9, 6, 7), score: best, pv: [mv(7, 9, 6, 7)] },
    played: { move: same ? mv(7, 9, 6, 7) : mv(1, 9, 2, 7), score: played, pv: [same ? mv(7, 9, 6, 7) : mv(1, 9, 2, 7)] },
    depth: 12,
    ...extra,
  });

  it('就是引擎首选：最佳', () => {
    const r = reviewMove(b, 0, 'r', judged(20, 20, true));
    expect(r.isBest).toBe(true);
    expect(labelOf(r)).toBe('top');
    expect(r.accuracy).toBe(100);
  });

  it('不是首选但只差一点：好棋，不是最佳', () => {
    const r = reviewMove(b, 0, 'r', judged(20, 5, false));
    expect(labelOf(r)).toBe('best');
    expect(r.accuracy).toBeGreaterThan(90);
  });

  it('其它走法都差出两个兵以上：唯一着', () => {
    const r = reviewMove(b, 0, 'r', judged(20, 20, true, { second: -300 }));
    expect(labelOf(r)).toBe('only');
  });

  it('已经赢定的局面不评唯一着（怎么走都赢）', () => {
    const r = reviewMove(b, 0, 'r', judged(3000, 3000, true, { second: 2000 }));
    expect(labelOf(r)).toBe('top');
  });

  it('大亏：漏着，准确率很低', () => {
    const r = reviewMove(b, 0, 'r', judged(20, -1100, false));
    expect(labelOf(r)).toBe('blunder');
    expect(r.accuracy).toBeLessThan(20);
  });

  it('妙手：弃子而引擎认为是最好的', () => {
    // 红车走到黑车嘴边（能被白吃），但假设引擎认为这就是最好的一手——这就是弃子
    const pos = fromFen('4k4/4r4/9/9/9/9/4R4/9/9/3K5 w')!.board;
    const sac = mv(4, 6, 4, 2);
    const j: Judged = {
      best: { move: sac, score: 200, pv: [sac] },
      played: { move: sac, score: 200, pv: [sac] },
      depth: 14,
    };
    const r = reviewMove(pos, 30, 'r', j);
    expect(r.badge).toBe('brilliant');
    expect(labelOf(r)).toBe('brilliant');
  });
});

describe('局面说成人话', () => {
  it('均势、优势、杀棋', () => {
    expect(evalWords(20)).toBe('均势');
    expect(evalWords(1000)).toContain('红');
    expect(evalWords(1000)).toContain('一个车');
    expect(evalWords(-500)).toContain('黑');
    expect(evalWords(0, 3)).toBe('红方 3 步杀');
    expect(evalWords(0, -2)).toBe('黑方 2 步杀');
  });
});

describe('阶段', () => {
  it('前 12 回合是开局，子少了是残局', () => {
    expect(phaseAt(initialBoard(), 5)).toBe('opening');
    expect(phaseAt(initialBoard(), 40)).toBe('middle');
    expect(phaseAt(fromFen('3k5/9/9/9/9/9/9/9/4R4/4K4 w')!.board, 40)).toBe('endgame');
  });
});

describe('整盘汇总', () => {
  it('每种称号各几手、每方准确率、分阶段准确率', () => {
    const b = initialBoard();
    const mk = (ply: number, color: 'r' | 'b', best: number, played: number, same: boolean) =>
      reviewMove(b, ply, color, {
        best: { move: mv(7, 9, 6, 7), score: best, pv: [] },
        played: { move: same ? mv(7, 9, 6, 7) : mv(1, 9, 2, 7), score: played, pv: [] },
        depth: 10,
      });
    const moves = [mk(0, 'r', 20, 20, true), mk(1, 'b', 0, -1200, false), mk(2, 'r', 30, 25, false), mk(3, 'b', 0, 0, true)];
    const rep = summarize(moves);
    expect(rep.counts.r.top).toBe(1);
    expect(rep.counts.r.best).toBe(1);
    expect(rep.counts.b.blunder).toBe(1);
    expect(rep.stats.r.accuracy).toBeGreaterThan(rep.stats.b.accuracy);
    expect(rep.phaseAcc.r.opening).toBe(rep.stats.r.accuracy);
  });
});
