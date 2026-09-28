/**
 * 残局知识与计划：认出是什么残局、书上怎么说、主变翻成人话。
 * 定论错一条就是教错棋，所以每条都要和残局库（引擎实战验证过的）对得上。
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { attackLabel, classifyEndgame, endgameHeadline, fullLabel, guardLabel, isEndgame, sideMaterial } from '../src/xiangqi/endgame';
import { outlookOf, planOf, stepTags } from '../src/xiangqi/plan';
import { allEndgames, loadLibrary } from '../src/xiangqi/library';
import { fromFen, textToMove } from '../src/xiangqi/notation';
import { initialBoard, legalMoves, type Move } from '../src/xiangqi/rules';
import { analyze, resetEngine } from '../src/xiangqi/ai';

const board = (fen: string) => fromFen(fen)!.board;
const mv = (fen: string, text: string): Move => {
  const p = fromFen(fen)!;
  const m = textToMove(p.board, p.toMove, text, legalMoves(p.board, p.toMove));
  if (!m) throw new Error('走不了：' + text);
  return m;
};

beforeAll(async () => {
  await loadLibrary();
});

describe('子力的叫法', () => {
  it('士象全、单缺象、双士、光将', () => {
    const b = board('2bakab2/9/9/9/9/9/9/9/9/4K4 w');
    expect(guardLabel(sideMaterial(b, 'b'))).toBe('士象全');
    expect(fullLabel(sideMaterial(b, 'r'))).toBe('光将');
    expect(guardLabel(sideMaterial(board('3akab2/9/9/9/9/9/9/9/9/4K4 w'), 'b'))).toBe('单缺象');
    expect(guardLabel(sideMaterial(board('3aka3/9/9/9/9/9/9/9/9/4K4 w'), 'b'))).toBe('双士');
  });

  it('两个车叫双车，车在前兵在后', () => {
    const b = board('4k4/9/9/9/2P6/9/9/9/R7R/4K4 w');
    expect(attackLabel(sideMaterial(b, 'r'))).toBe('双车兵');
  });

  it('沉底的兵单独数出来：老兵只能横走', () => {
    const b = board('P3k4/9/9/9/2P6/9/9/9/9/4K4 w');
    const m = sideMaterial(b, 'r');
    expect(m.P).toBe(2);
    expect(m.bottomP).toBe(1);
    expect(m.liveP).toBe(1);
  });
});

describe('认出残局', () => {
  it('开局不是残局', () => {
    expect(isEndgame(initialBoard())).toBe(false);
    expect(classifyEndgame(initialBoard(), 'r')).toBeNull();
  });

  it('单车对士象全：书上例和，要说破"多一个车也赢不了"', () => {
    const b = board('2b1kab2/4aR3/9/9/9/9/9/9/9/4K4 w');
    const e = classifyEndgame(b, 'r')!;
    expect(e.name).toBe('车对士象全');
    expect(e.attacker).toBe('r');
    expect(e.book?.result).toBe('draw');
    // 引擎分数说你多一个车，但这是和棋：要当面说清
    const h = endgameHeadline(e, 'r', 900);
    expect(h).toContain('书上');
    expect(h).toContain('多子不等于能赢');
  });

  it('你是守方时，要领讲怎么守；你是进攻方时讲怎么赢', () => {
    const b = board('2b1kab2/4aR3/9/9/9/9/9/9/9/4K4 w');
    expect(classifyEndgame(b, 'b')!.tips.join('')).toContain('士象不要散');
    expect(classifyEndgame(b, 'r')!.tips.join('')).toContain('帅');
  });

  it('子力相当就不分进攻方', () => {
    const e = classifyEndgame(board('3k5/9/9/9/9/9/9/r8/R8/4K4 w'), 'r')!;
    expect(e.attacker).toBeNull();
    expect(e.name).toBe('车对车');
  });

  it('残局库里的每一组都能认出来，并且找得到对应的练习', () => {
    const all = allEndgames();
    expect(all.length).toBeGreaterThan(10);
    for (const pos of all) {
      const p = fromFen(pos.fen)!;
      const e = classifyEndgame(p.board, pos.you);
      expect(e, pos.name).not.toBeNull();
      expect(e!.practice, pos.name).toBeDefined();
      // 同一个子力组合可能有进攻/守和两组：挑中的一组，你在里面的角色要和这个局面一致
      expect(e!.practice!.items.length).toBeGreaterThan(0);
    }
  });

  it('书上的定论和残局库里的书面结论不冲突', () => {
    for (const pos of allEndgames()) {
      const p = fromFen(pos.fen)!;
      const e = classifyEndgame(p.board, pos.you)!;
      if (!e.book || !pos.book) continue;
      const libWin = /例胜|胜势|车胜/.test(pos.book);
      const libDraw = /例和/.test(pos.book);
      if (libWin) expect(e.book.result, pos.name).toBe('win');
      if (libDraw) expect(e.book.result, pos.name).toBe('draw');
    }
  });
});

describe('计划', () => {
  it('杀棋：目标就是 N 步杀，步骤一路写到将死', () => {
    // 红方双车错：一步杀
    const fen = '3k5/9/9/9/9/9/9/9/3R5/3RK4 w';
    resetEngine();
    const a = analyze(board(fen), 'r', { maxDepth: 3, timeMs: 30000, jitter: 0 }).moves;
    const p = planOf(board(fen), 'r', a[0]);
    expect(p.kind).toBe('mate');
    expect(p.goal).toContain('步杀');
    expect(p.steps[0].who).toBe('me');
    expect(p.steps[0].tags).toContain('将军');
  });

  it('得子：主变里净赚一个车，目标写明吃掉了什么', () => {
    // 红车直接吃掉没有保护的黑车
    const fen = '3k5/9/9/9/r8/9/9/9/R8/4K4 w';
    const m = mv(fen, '车九进四');
    const p = planOf(board(fen), 'r', { move: m, score: 1000, pv: [m] });
    expect(p.kind).toBe('win-material');
    expect(p.goal).toContain('车');
    expect(p.materialDelta).toBe(1000);
  });

  it('吃子之后进入残局：认出是什么残局', () => {
    // 双方车马炮兵加起来 7 个，红车吃掉黑马后只剩 6 个——进入残局
    const fen = '2bakab2/r8/9/8p/4n4/9/2P3P2/1C7/4R4/4K4 w';
    const m = mv(fen, '车五进四');
    const p = planOf(board(fen), 'r', { move: m, score: 450, pv: [m] });
    expect(p.kind).toBe('win-material');
    expect(p.endgame).toBeDefined();
    expect(p.goal).toContain('简化成');
    expect(p.steps[0].tags).toContain('吃马');
  });

  it('步骤标签：将军、吃子、帅助攻、进兵', () => {
    const fen = '3k5/9/9/9/2P6/9/9/9/9/4K4 w';
    const b = board(fen);
    expect(stepTags(b, mv(fen, '兵七进一'), 'r', 'r')).toContain('进兵');
    expect(stepTags(b, mv(fen, '帅五平四'), 'r', 'r')).toContain('帅助攻');
  });

  it('局面判断的说法', () => {
    expect(outlookOf(0)).toBe('均势');
    expect(outlookOf(1000)).toContain('你大优');
    expect(outlookOf(-500)).toContain('对方占优');
    expect(outlookOf(0, 3)).toBe('你 3 步杀');
    expect(outlookOf(0, -2)).toBe('对方 2 步杀');
  });
});

describe('残局练习的反馈：看结果变没变，不只看分数', async () => {
  const { drillVerdict } = await import('../src/xiangqi/endgame');
  it('要赢的局：把赢棋走成和棋，要悔棋', () => {
    const v = drillVerdict('win', { score: 49990, mateIn: 5 }, { score: 40 }, false);
    expect(v.kind).toBe('threw-win');
    expect(v.bad).toBe(true);
    expect(v.text).toContain('和势');
  });
  it('要赢的局：还是杀，只是多绕了几步——不算错，但要说', () => {
    const v = drillVerdict('win', { score: 49990, mateIn: 3 }, { score: 49980, mateIn: 8 }, false);
    expect(v.kind).toBe('slow');
    expect(v.bad).toBe(false);
  });
  it('要赢的局：大优势下少赚一点，只要还是赢棋就算可以', () => {
    const v = drillVerdict('win', { score: 1800 }, { score: 1300 }, false);
    expect(v.kind).toBe('good');
  });
  it('要守和的局：一步让对方有杀，守不住了', () => {
    const v = drillVerdict('draw', { score: -150 }, { score: -49990, mateIn: -4 }, false);
    expect(v.kind).toBe('lost-hold');
    expect(v.text).toContain('4 步');
  });
  it('走的就是首选：好棋', () => {
    expect(drillVerdict('draw', { score: -100 }, { score: -100 }, true).kind).toBe('best');
  });
});
