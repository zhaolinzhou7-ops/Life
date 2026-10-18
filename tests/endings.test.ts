/**
 * 将死之外的结局：重复局面、长将、自然限着、无进攻子力。
 * 原来的对局只认将死——来回走同样几步，棋永远下不完。
 */
import { describe, expect, it } from 'vitest';
import {
  MOVE_LIMIT,
  bareMinors,
  drawOrForfeit,
  noAttackers,
  pliesSinceCapture,
  repetitionState,
  type PlyRecord,
} from '../src/xiangqi/endings';
import { fromFen } from '../src/xiangqi/notation';
import { initialBoard } from '../src/xiangqi/rules';
import { obviousDraw } from '../src/xiangqi/library';

const rec = (key: string, mover: 'r' | 'b', check = false, capture = false): PlyRecord => ({ key, mover, check, capture });

/** A→B→A→B→A…：红走到 B，黑走回 A */
function cycle(n: number, redChecks: boolean, blackChecks = false): PlyRecord[] {
  const out: PlyRecord[] = [];
  for (let i = 0; i < n; i++) {
    out.push(rec(i % 2 === 0 ? 'B' : 'A', i % 2 === 0 ? 'r' : 'b', i % 2 === 0 ? redChecks : blackChecks));
  }
  return out;
}

describe('重复局面', () => {
  it('同一局面第三次出现才判，第二次只是计数', () => {
    expect(repetitionState('A', cycle(2, false)).count).toBe(2);
    expect(drawOrForfeit(initialBoard(), 'A', cycle(2, false))).toBeNull();
    expect(repetitionState('A', cycle(4, false)).count).toBe(3);
  });

  it('双方都没将军：作和', () => {
    const end = drawOrForfeit(initialBoard(), 'A', cycle(4, false));
    expect(end).toEqual({ winner: null, reason: 'repetition' });
  });

  it('一方每一步都在将军、另一方没有：长将方判负', () => {
    const end = drawOrForfeit(initialBoard(), 'A', cycle(4, true));
    expect(end).toEqual({ winner: 'b', reason: 'perpetual-check' });
  });

  it('双方都在将军：互将，作和', () => {
    const end = drawOrForfeit(initialBoard(), 'A', cycle(4, true, true));
    expect(end?.winner).toBeNull();
  });

  it('循环里有一步没将军，就不算长将', () => {
    const p = cycle(4, true);
    p[2] = { ...p[2], check: false };
    expect(repetitionState('A', p).perpetual).toBeNull();
  });

  it('第二次出现时就能看出谁在长将——对局里拿它提前警告', () => {
    expect(repetitionState('A', cycle(2, true)).perpetual).toBe('r');
  });
});

describe('自然限着', () => {
  it('从最后一次吃子往后数', () => {
    const p = [rec('x1', 'r', false, true), rec('x2', 'b'), rec('x3', 'r')];
    expect(pliesSinceCapture(p)).toBe(2);
  });

  it('满 60 回合没吃子作和，差一步不作和', () => {
    const p: PlyRecord[] = [];
    for (let i = 0; i < MOVE_LIMIT - 1; i++) p.push(rec(`k${i}`, i % 2 ? 'b' : 'r'));
    expect(drawOrForfeit(initialBoard(), 'start', p)).toBeNull();
    p.push(rec('last', 'b'));
    expect(drawOrForfeit(initialBoard(), 'start', p)).toEqual({ winner: null, reason: 'move-limit' });
  });
});

describe('无进攻子力', () => {
  it('只剩将士象：和', () => {
    const b = fromFen('3aka3/9/4b4/9/9/9/9/4B4/4A4/3K5 w')!.board;
    expect(noAttackers(b)).toBe(true);
    expect(drawOrForfeit(b, 'x', [rec('y', 'r')])).toEqual({ winner: null, reason: 'no-attackers' });
  });

  it('还有一个兵就不算', () => {
    const b = fromFen('3aka3/9/4b4/9/9/9/4P4/4B4/4A4/3K5 w')!.board;
    expect(noAttackers(b)).toBe(false);
  });
});

describe('双方各只剩一个马或炮：引擎看过没杀就作和', () => {
  // 用户原话："明显各自只剩一个马还要走半天，或者明显和局（比如各自剩一个炮）还要走很多步……直接判定即可"
  const pos = (fen: string) => fromFen(fen)!;
  it('马对马、炮对炮、马对炮（带士象也一样）：子力上算这一类；光看子力不判（有的摆法有杀，要引擎看过）', () => {
    for (const fen of [
      '3k5/4a4/9/9/2n6/9/6N2/9/4A4/4K4 w', // 马对马
      '4k4/9/4b4/9/9/2c6/9/6C2/9/3K5 w', // 炮对炮
      '3ak4/9/9/9/5n3/9/9/4C4/9/4K4 b', // 马对炮
    ]) {
      const p = pos(fen);
      expect(bareMinors(p.board, p.toMove)).toBe(true);
      expect(drawOrForfeit(p.board, fen, [])).toBeNull();
    }
  });
  it('这一步就能吃掉对方最后那个子：先不判（吃完单马对光将还有得赢）', () => {
    const p = pos('3k5/9/9/9/9/9/9/9/1n7/3NK4 w'); // 红马（日字）吃得到黑马
    expect(bareMinors(p.board, p.toMove)).toBe(false);
  });
  it('还有车或兵就不判', () => {
    expect(bareMinors(pos('3k5/9/9/9/2n6/9/4P1N2/9/9/4K4 w').board, 'r')).toBe(false);
    expect(bareMinors(pos('3k5/9/9/9/2n6/9/6N2/9/9/R3K4 w').board, 'r')).toBe(false);
  });
  it('只有一方有马炮（另一方光将或士象）不归这条管——单马胜单士是书上的赢棋', () => {
    expect(bareMinors(pos('3k5/4a4/9/9/9/9/6N2/9/9/4K4 w').board, 'r')).toBe(false);
  });
  it('有杀的摆法（tools/minor-draw-check.ts 找到的：黑马堵在自家将前面，炮士象全九步杀）子力上也算这一类——所以要引擎把关', () => {
    const p = pos('4k4/4n4/9/9/9/6B2/9/4K4/4A4/1CBA5 w');
    expect(bareMinors(p.board, p.toMove)).toBe(true);
  });
});

describe('残局库：一眼就是和棋的守和题不出', () => {
  it('对方只剩一个马 / 炮 / 兵还要你守和：不出；对方还有两个进攻子：出', () => {
    expect(obviousDraw({ fen: '3k5/9/9/9/9/9/2p6/6N2/9/4K4 w', you: 'r', target: 'draw' })).toBe(true); // 马对兵
    expect(obviousDraw({ fen: '3akc3/4a4/9/9/9/9/9/9/4A4/3AK4 w', you: 'r', target: 'draw' })).toBe(true); // 双士对炮
    expect(obviousDraw({ fen: '3k5/9/9/9/9/2n6/2p6/6N2/9/4K4 w', you: 'r', target: 'draw' })).toBe(false); // 马对马兵：要真守
    expect(obviousDraw({ fen: '3k5/9/9/9/9/9/9/9/9/r3K4 w', you: 'r', target: 'draw' })).toBe(false); // 对方有车
    expect(obviousDraw({ fen: '3k5/9/9/9/9/9/2p6/6N2/9/4K4 w', you: 'r', target: 'win' })).toBe(false); // 要赢的题不归这条
  });
});

describe('各只剩一个马或炮：判和之前让引擎看一眼（minors.ts）', () => {
  it('马对马、炮对炮：没杀、分差很小，判和（测试里没有皮卡鱼，走自带引擎那条路）', async () => {
    const { minorsDead } = await import('../src/xiangqi/minors');
    for (const fen of ['3k5/4a4/9/9/2n6/9/6N2/9/4A4/4K4 w', '4k4/9/4b4/9/9/2c6/9/6C2/9/3K5 w']) {
      const p = fromFen(fen)!;
      expect(await minorsDead(p.board, p.toMove), fen).toBe(true);
    }
  });
});
