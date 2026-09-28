/**
 * 教练和求助必须是同一个裁判。
 *
 * 用户原话："都要被将死了，还不允许我出将，说会丢兵，结果我让他提示又有这一步。"
 *
 * 根因有两层：
 *   1. 教练用 0.9 秒的浅层分析（或者干脆是静态兑子）判，求助用 6.5 秒的深层分析——
 *      两个裁判，两个结论。
 *   2. 就算引擎数据在手，报警的话还是从静态兑子里取（"会丢兵"），
 *      和引擎的结论（"这是唯一活路"）同时出现在屏幕上。
 *
 * 这里用真实局面把几条规矩钉死。
 */
import { describe, expect, it } from 'vitest';
import { analyze, resetEngine, type MoveScore } from '../src/xiangqi/ai';
import { checkMove, judgeMove, lostNotice, shouldWarn, threatNotice, warnText } from '../src/xiangqi/livecoach';
import { hintOf } from '../src/xiangqi/besthint';
import { fromFen, moveToText } from '../src/xiangqi/notation';
import { isInCheck, legalMoves, type Board } from '../src/xiangqi/rules';
import { MIN_JUDGE_DEPTH } from '../src/xiangqi/study';
import { mateInOne, moveRisk } from '../src/xiangqi/teach';

const deep = (b: Board, depth = 5, margin?: number): MoveScore[] => {
  resetEngine();
  return analyze(b, 'r', { maxDepth: depth, timeMs: 60000, jitter: 0, margin }).moves;
};

/**
 * 被兵将军，出帅是引擎的首选；而静态兑子认为出帅"吃到的不如丢掉的多"。
 * 这是从自对弈里筛出来的真实局面，正好是用户描述的那一幕。
 */
const FACING_MATE = 'rCbakab1r/9/9/p1p1p1p2/6c2/C8/2P1P1P1P/N3BpN1B/4AK3/7R1 w';
/**
 * 没被将军，但对方摆好了一步杀；退帅是深算之后的首选，静态兑子却说"对方在捉你的子，你没管"。
 * 只算 2 层时退帅排第五、落后 271——标准档会拦，旧版就是这么拦错的。
 */
const THREAT = 'rnbakabn1/4cR1C1/c8/2p5r/4p1p2/6B2/p1P1P1p1P/RCNKBAN2/9/5A3 w';
/** 红方怎么走都会被杀（最顽强也是三步杀） */
const LOST = '9/9/4k4/6P2/9/6r2/1r7/9/4A4/3K5 w';

describe('快被将死时：教练不许拦求助推荐的那一手', () => {
  const b = fromFen(FACING_MATE)!.board;

  it('局面确实是"被将军、出帅是首选、静态兑子却说出帅有风险"', () => {
    expect(isInCheck(b, 'r')).toBe(true);
    const a = deep(b);
    const kingMove = a[0].move;
    expect(b[kingMove.fy][kingMove.fx]!.t).toBe('K');
    expect(moveRisk(b, kingMove, 'r'), '静态兑子应该会对出帅报风险——这正是旧版报警的来源').not.toBeNull();
  }, 60000);

  it('同一份分析：求助推荐的那一手，教练在任何档位都不拦', () => {
    const a = deep(b);
    const hint = hintOf(b, 'r', a).best!;
    for (const lv of [1, 2, 3] as const) {
      expect(checkMove(lv, b, hint.move, 'r', a), `${lv} 档拦了求助推荐的 ${hint.text}`).toBeNull();
    }
  }, 60000);

  it('有引擎数据时，报警的话绝不从静态兑子里拿', () => {
    const a = deep(b);
    for (const m of legalMoves(b, 'r')) {
      const v = judgeMove(b, m, 'r', a);
      if (!shouldWarn(2, v) || !v.risk) continue;
      const t = warnText(2, v, b, m);
      expect(t, `${moveToText(b, m)} 的报警用了静态兑子的话`).not.toBe(v.risk.brief);
    }
  }, 60000);

  it('被将军时不另外报"威胁"——那一条由"将军！"负责', () => {
    expect(threatNotice(b, 'r', 3)).toBeNull();
  });
});

describe('对方摆好了杀着：浅层会拦错，够深就不拦', () => {
  const b = fromFen(THREAT)!.board;
  const kingText = '帅六退一';
  const kingOf = (a: MoveScore[]) => a.find((s) => moveToText(b, s.move) === kingText)!;

  it('只算 2 层：退帅会被标准档拦下——这就是旧版"不让出将"的来源', () => {
    const a = deep(b, 2, 300);
    expect(checkMove(2, b, kingOf(a).move, 'r', a)).not.toBeNull();
  }, 60000);

  it('算到教练放行的最低深度以上，退帅不再被拦', () => {
    for (const d of [MIN_JUDGE_DEPTH, MIN_JUDGE_DEPTH + 1]) {
      const a = deep(b, d, 300);
      expect(checkMove(2, b, kingOf(a).move, 'r', a), `算 ${d} 层时拦了退帅`).toBeNull();
    }
  }, 60000);

  it('轮到你走时就提醒"对方有杀着"，而且点名是哪一手', () => {
    const k = mateInOne(b, 'b')!;
    expect(k).not.toBeNull();
    const t = threatNotice(b, 'r', 2)!;
    expect(t).toContain('将死');
    expect(t).toContain(moveToText(b, k));
    expect(threatNotice(b, 'r', 1)).not.toContain(moveToText(b, k)); // 轻提示不点名
    expect(threatNotice(b, 'r', 0)).toBeNull();
  });
});

describe('局面已经输定：不再逐手唠叨，只说一次实话', () => {
  const b = fromFen(LOST)!.board;

  it('怎么走都被杀时，只有"走完立刻被将死"的那几手还值得拦', () => {
    const a = deep(b, 5);
    expect(a[0].mateIn!).toBeLessThan(0);
    for (const m of legalMoves(b, 'r')) {
      const v = judgeMove(b, m, 'r', a);
      expect(v.lost).toBe(true);
      expect(shouldWarn(3, v), `输定的局面里拦了 ${moveToText(b, m)}`).toBe(v.mateNext && v.rank !== 1);
    }
  }, 60000);

  it('那句实话要说出几步杀，并给出最顽强的一手', () => {
    const a = deep(b, 5);
    const t = lostNotice(b, a)!;
    expect(t).toContain(`${-a[0].mateIn!} 步杀`);
    expect(t).toContain(moveToText(b, a[0].move));
    expect(t).toContain('认输');
  }, 60000);

  it('对手是会看走眼的弱档时，不劝认输，而是说"它不一定看得见"', () => {
    const a = deep(b, 5);
    const t = lostNotice(b, a, false)!;
    expect(t).toContain('不一定看得见');
    expect(t).not.toContain('认输');
  }, 60000);

  it('还有得下的局面不说这句话', () => {
    const a = deep(fromFen(FACING_MATE)!.board, 4);
    const t = lostNotice(fromFen(FACING_MATE)!.board, a);
    if (a[0].score > -1500) expect(t).toBeNull();
  }, 60000);
});

describe('错过杀棋要说', () => {
  it('首选能杀、这一手不能：标准档要拦，而且说的是"你有杀棋"', () => {
    const b = fromFen(LOST)!.board;
    // 借黑方视角：黑方在这个局面里有杀
    const bb = fromFen(LOST.replace(' w', ' b'))!.board;
    resetEngine();
    const a = analyze(bb, 'b', { maxDepth: 5, timeMs: 60000, jitter: 0 }).moves;
    expect(a[0].mateIn!).toBeGreaterThan(0);
    const slack = a.find((s) => !(s.mateIn !== undefined && s.mateIn > 0));
    if (!slack) return; // 每一手都能杀，那就没有"错过"
    const v = judgeMove(bb, slack.move, 'b', a);
    expect(v.missedMate).toBe(true);
    expect(shouldWarn(2, v)).toBe(true);
    expect(warnText(2, v, bb, slack.move)).toContain('杀棋');
    void b;
  }, 60000);
});

describe('窗口分析：省时间，但不能省掉正确性', () => {
  const b = fromFen(FACING_MATE)!.board;

  it('只有下限的着法一定比首选差出 margin 以上', () => {
    const a = deep(b, 4, 300);
    const top = a[0].score;
    for (const s of a.filter((x) => x.bound)) expect(s.score).toBeLessThanOrEqual(top - 300);
  }, 60000);

  it('首选和全窗口分析一致', () => {
    const full = deep(b, 4);
    const win = deep(b, 4, 300);
    expect(win[0].score).toBe(full[0].score);
  }, 60000);

  it('只有下限的着法照样会被拦（差得多就是差得多），并且标明"以上"', () => {
    const a = deep(b, 4, 300);
    const s = a.find((x) => x.bound);
    if (!s) return;
    const v = judgeMove(b, s.move, 'r', a);
    expect(v.lossAtLeast).toBe(true);
    expect(shouldWarn(2, v)).toBe(!v.lost || v.mateNext);
  }, 60000);
});

describe('读对方上一步', () => {
  it('对方新捉了你的车：标准档就说，轻提示不说', async () => {
    const { board } = await import('./helpers');
    const { readOpponent } = await import('../src/xiangqi/livecoach');
    const b = board(
      'r . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    const m = { fx: 0, fy: 0, tx: 0, ty: 5 };
    expect(readOpponent(b, m, 'b', 2)).toContain('捉你的车');
    expect(readOpponent(b, m, 'b', 3)).toContain('捉你的车');
    expect(readOpponent(b, m, 'b', 1)).toBeNull();
  });

  it('教学档：没捉子的一步也说出对方的意图', async () => {
    const { readOpponent } = await import('../src/xiangqi/livecoach');
    const { initialBoard } = await import('../src/xiangqi/rules');
    // 黑方开局炮 8 平 5（中炮）：占中
    const t = readOpponent(initialBoard(), { fx: 7, fy: 2, tx: 4, ty: 2 }, 'b', 3);
    expect(t).toContain('占中');
    expect(readOpponent(initialBoard(), { fx: 7, fy: 2, tx: 4, ty: 2 }, 'b', 2)).toBeNull();
  });
});
