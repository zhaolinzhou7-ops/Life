/**
 * 判错与讲解这一轮：
 *   - 赢定了的局面：保住胜势的着法都算对；"第二好的走法也赢定了"的题不出；
 *   - 教练讲解：你这手在干什么、对方会这样接、该走什么、差多少。
 * 用户原话："有bug，还是存在必胜残局在找最佳步数……教练讲解再细致一些。"
 */
import { describe, expect, it } from 'vitest';
import { initialBoard, legalMoves, applyMove, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { textToMove } from '../src/xiangqi/notation';
import { isWon, WON_KEEP } from '../src/xiangqi/analysis';
import { wrongTalk, whatItDoes } from '../src/xiangqi/coachexplain';
import { loadPuzzles, wonAnyway } from '../src/xiangqi/puzzles';
import type { MoveScore } from '../src/xiangqi/ai';

/** 一串中文记谱 → 着法（从 b 起、c 先走） */
function moves(b: Board, c: Color, texts: string[]): Move[] {
  const out: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) throw new Error(`走不通：${t}`);
    out.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return out;
}

describe('赢定了的局面', () => {
  it('大优（约多一个马以上）或者有杀算赢定；被杀、小优不算', () => {
    expect(isWon({ score: WON_KEEP })).toBe(true);
    expect(isWon({ score: 1500 })).toBe(true);
    expect(isWon({ score: 300 })).toBe(false);
    expect(isWon({ score: 0, mateIn: 3 })).toBe(true);
    expect(isWon({ score: 2000, mateIn: -2 })).toBe(false);
  });

  it('第二好的走法也赢定了的题不出；杀法题照出', () => {
    expect(wonAnyway({ goal: 'win', ev2: 900 })).toBe(true);
    expect(wonAnyway({ goal: 'only', ev2: 120 })).toBe(false);
    expect(wonAnyway({ goal: 'mate', ev2: 2000 })).toBe(false);
    expect(wonAnyway({ goal: 'best' })).toBe(false);
  });

  it('题库里一道"第二好的走法也赢定了"的题都不出，非杀法题都算过第二名', async () => {
    const all = await loadPuzzles();
    expect(all.length).toBeGreaterThan(700);
    expect(all.filter((p) => wonAnyway(p))).toHaveLength(0);
    expect(all.filter((p) => p.goal !== 'mate' && p.ev2 === undefined)).toHaveLength(0);
  });
});

describe('教练讲解：走错一手', () => {
  const b = initialBoard();
  const [bing] = moves(b, 'r', ['兵三进一']);
  const minePv = moves(b, 'r', ['兵三进一', '炮8平5', '马二进三', '马8进7']);
  const bestPv = moves(b, 'r', ['炮二平五', '马8进7', '马二进三']);
  const mine: MoveScore = { move: bing, score: -40, pv: minePv };
  const best: MoveScore = { move: bestPv[0], score: 60, pv: bestPv };

  it('四件事都讲：你这手在干什么、对方怎么接（一手手）、该走什么、差多少', () => {
    const html = wrongTalk(b, 'r', mine, { best });
    const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    expect(text).toContain('你这手 兵三进一');
    expect(text).toContain('对方会这样接');
    expect(text).toContain('炮8平5');
    expect(text).toContain('该走 炮二平五');
    expect(text).toMatch(/差约 100 分/);
  });

  it('该走的和你走的不会是同一手：原谱的记谱优先', () => {
    const html = wrongTalk(b, 'r', mine, { best, bestText: '炮二平五' });
    const said = [...html.matchAll(/该走<\/span><b>([^<]+)<\/b>/g)].map((m) => m[1]);
    expect(said).toEqual(['炮二平五']);
    expect(said).not.toContain('兵三进一');
  });

  it('一手棋在干什么：按盘面说', () => {
    expect(whatItDoes(b, best.move, 'r').length).toBeGreaterThan(2);
  });
});
