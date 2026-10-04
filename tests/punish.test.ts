/**
 * 劣势推演和走子动画的纯逻辑部分：
 *   - 走错一手之后，对手怎么罚：每一手翻译成人话、记账、一句结论；罚完了就停，不往下拖；
 *   - 换盘面时认得出"只差一步棋"（才走动画），一次跳好几手不认；马走折线。
 */
import { describe, expect, it } from 'vitest';
import { applyMove, initialBoard, type Board, type Move } from '../src/xiangqi/rules';
import { walkMoves } from '../src/xiangqi/tricks';
import { punishBrief, punishLine } from '../src/xiangqi/punish';
import { pathOf, singleMove } from '../src/xiangqi/board2d';

const line = (texts: string[]) => {
  const w = walkMoves(texts);
  if (!w) throw new Error('走不通：' + texts.join(' '));
  return w.moves;
};

describe('劣势推演', () => {
  // 炮二平五 马8进7 马二进三 车9平8 之后红方炮五进四打中卒：马7进5 吃炮
  const pre = line(['炮二平五', '马8进7', '马二进三', '车9平8']);
  let before: Board = initialBoard();
  for (const m of pre) before = applyMove(before, m);
  const full = line(['炮二平五', '马8进7', '马二进三', '车9平8', '炮五进四', '马7进5', '炮八平五', '马2进3', '车一平二', '士6进5', '车二进四', '炮2进5']);
  const pv = full.slice(pre.length);

  it('一手一手说出来：你走错的那一手、对手怎么吃、记账、结论', () => {
    const p = punishLine(before, pv, 'r')!;
    expect(p).not.toBeNull();
    expect(p.steps[0]).toMatchObject({ who: 'me', text: '炮五进四' });
    expect(p.steps[1]).toMatchObject({ who: 'foe', text: '马7进5' });
    expect(p.steps[1].note).toContain('炮');
    expect(p.lost).toEqual(['炮']);
    expect(p.won).toEqual(['卒']);
    expect(p.net).toBe(-400);
    expect(p.summary).toContain('对手先 马7进5');
    expect(p.summary).toMatch(/丢了炮.*只换回卒/);
  });

  it('罚完了就停：净亏一个子、吃回来的机会过去了，后面的闲着不往下列', () => {
    const p = punishLine(before, pv, 'r')!;
    expect(p.steps.length).toBe(4);
  });

  it('对局里的短句：对方接什么、你怎么应，最后丢了什么', () => {
    const s = punishBrief(punishLine(before, pv, 'r')!);
    expect(s).toMatch(/^对方 马7进5/);
    expect(s).toContain('丢炮');
  });

  it('对手走软的那一手反过来说："你"是罚他的一方', () => {
    const p = punishLine(before, pv, 'r', 9, { me: '对方', foe: '你' })!;
    expect(p.summary).toMatch(/^你先 马7进5/);
    expect(p.summary).toContain('对方丢了炮');
  });

  it('主变里有走不通的着法就截断，不编', () => {
    const bad: Move = { fx: 0, fy: 0, tx: 0, ty: 5 };
    const p = punishLine(before, [pv[0], pv[1], bad, pv[3]], 'r');
    expect(p!.steps.length).toBe(2);
    expect(punishLine(before, [pv[0]], 'r')).toBeNull();
  });
});

describe('走子动画认得出一步棋', () => {
  const b0 = initialBoard();
  const ms = line(['炮二平五', '马8进7', '马二进三']);
  const b1 = applyMove(b0, ms[0]);
  const b2 = applyMove(b1, ms[1]);

  it('只差一步：认出是哪一步（前进、倒着翻回去都认）', () => {
    expect(singleMove(b0, b1)).toEqual(ms[0]);
    expect(singleMove(b1, b0)).toEqual({ fx: ms[0].tx, fy: ms[0].ty, tx: ms[0].fx, ty: ms[0].fy });
  });

  it('一次跳两手、或者盘面没变：不当成一步', () => {
    expect(singleMove(b0, b2)).toBeNull();
    expect(singleMove(b1, b1)).toBeNull();
  });

  it('吃子也认得出', () => {
    const cap = line(['炮二平五', '马8进7', '炮五进四']);
    let b = b0;
    for (const m of cap.slice(0, 2)) b = applyMove(b, m);
    expect(singleMove(b, applyMove(b, cap[2]))).toEqual(cap[2]);
  });

  it('马走折线（先直走一格马腿，再斜走），车炮直走', () => {
    const horse = ms[2]; // 马二进三
    const p = pathOf(horse, 'H');
    expect(p.length).toBe(3);
    expect(p[1]).toEqual([horse.fx, horse.fy - 1]);
    expect(pathOf(ms[0], 'C').length).toBe(2);
  });
});
