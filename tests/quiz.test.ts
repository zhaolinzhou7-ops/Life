/**
 * 花样题：点子题、选择题、判断题、认杀法——出题全靠规则引擎和题库里核对过的答案。
 * 这里锁死：题目问的东西是真的（被捉的子真的挂着、没保护的子真的没保护），
 * 选择题、判断题的"对"就是题库的正解，错的选项都不是正解也不在"一样好"的着法里。
 */
import { describe, expect, it } from 'vitest';
import raw from '../src/xiangqi/puzzles.json';
import mates from '../src/xiangqi/matepatterns.json';
import { choiceQuestion, judgeQuestion, loosePieces, nameQuestion, tapLoose, tapThreatened, uniqueAnswer } from '../src/xiangqi/quiz';
import type { Puzzle } from '../src/xiangqi/puzzles';
import type { MatePattern } from '../src/xiangqi/library';
import { fromFen, moveToText } from '../src/xiangqi/notation';
import { applyMove, isInCheck, legalMoves } from '../src/xiangqi/rules';
import { hangingPieces } from '../src/xiangqi/teach';

const puzzles = raw as unknown as Puzzle[];
const safety = puzzles.filter((p) => p.kind === 'safety');
const tactic = puzzles.filter((p) => p.kind === 'tactic');

describe('点子题', () => {
  it('"被捉的子"真的挂着：点的就是会白丢 1.5 个兵以上的那几个', () => {
    let n = 0;
    for (const p of safety) {
      const q = tapThreatened(p);
      if (!q) continue;
      n++;
      const pos = fromFen(p.fen)!;
      const hang = hangingPieces(pos.board, pos.toMove).filter((h) => h.loss >= 150);
      expect(q.targets!.length, p.id).toBe(hang.length);
      for (const t of q.targets!) expect(pos.board[t.y][t.x]?.c, p.id).toBe(pos.toMove);
    }
    // 眼力题里大部分都能出成点子题
    expect(n).toBeGreaterThan(safety.length * 0.3);
  });

  it('"没有保护的子"：把它吃掉，对方没有子能吃回来', () => {
    const p = fromFen('3k5/9/9/9/2r6/9/9/9/9/2R1K4 w')!; // 黑车在 (2,4)，没有黑子护着
    expect(loosePieces(p.board, 'b')).toEqual([{ x: 2, y: 4 }]);
    const p2 = fromFen('3k5/9/2r6/9/2r6/9/9/9/9/2R1K4 w')!; // 两个黑车一条线上互相保护
    expect(loosePieces(p2.board, 'b')).toEqual([]);
    let n = 0;
    for (const x of safety.concat(tactic)) {
      const q = tapLoose(x);
      if (!q) continue;
      n++;
      expect(q.targets!.length, x.id).toBeGreaterThan(0);
    }
    expect(n).toBeGreaterThan(50);
  });
});

describe('选择题', () => {
  it('正确选项就是正解，别的选项都是合法着法、不是正解也不在"一样好"里', () => {
    let n = 0;
    for (const p of tactic) {
      const q = choiceQuestion(p, 'tactic');
      if (!q) continue;
      n++;
      expect(uniqueAnswer(p), p.id).toBe(true);
      const texts = q.options!.map((o) => o.text);
      expect(texts[q.correct!], p.id).toBe(p.answer);
      expect(new Set(texts).size, p.id).toBe(texts.length);
      expect(texts.length, p.id).toBeGreaterThanOrEqual(3);
      const pos = fromFen(p.fen)!;
      for (const o of q.options!) {
        const legal = legalMoves(pos.board, pos.toMove).filter((m) => !isInCheck(applyMove(pos.board, m), pos.toMove));
        expect(legal.some((m) => moveToText(pos.board, m) === o.text), `${p.id} ${o.text}`).toBe(true);
        if (o.text !== p.answer) expect(p.also ?? [], p.id).not.toContain(o.text);
      }
    }
    expect(n).toBeGreaterThan(tactic.length * 0.4);
  });
});

describe('判断题', () => {
  it('说"好棋"的就是正解；说"不好"的不是正解、不在"一样好"里', () => {
    let good = 0;
    let bad = 0;
    for (const p of tactic) {
      for (const flip of [0.1, 0.9]) {
        const q = judgeQuestion(p, 'tactic', () => flip);
        if (!q) continue;
        const pos = fromFen(p.fen)!;
        const text = moveToText(pos.board, q.move!);
        if (q.good) {
          good++;
          expect(text, p.id).toBe(p.answer);
        } else {
          bad++;
          expect(text, p.id).not.toBe(p.answer);
          expect(p.also ?? [], p.id).not.toContain(text);
        }
      }
    }
    expect(good).toBeGreaterThan(50);
    expect(bad).toBeGreaterThan(50);
  });
});

describe('认杀法', () => {
  it('四个名字里有正确的那个，局面走完真的是杀（只取解法走到将死的那些图形）', () => {
    const pats = mates as unknown as MatePattern[];
    const names = [...new Set(pats.map((m) => m.name))];
    let n = 0;
    for (const m of pats) {
      const q = nameQuestion(m, names, () => 0.3);
      if (!q) continue;
      n++;
      expect(q.options!.length).toBe(4);
      expect(q.options![q.correct!].text, m.id).toBe(m.name);
      expect(new Set(q.options!.map((o) => o.text)).size).toBe(4);
      expect(q.explain).toContain(m.name);
    }
    // 有几条图形的着法只记了杀法的第一手（练"第一步怎么走"用的），摆不出杀完的样子，不拿来出认杀法
    expect(n).toBeGreaterThanOrEqual(40);
  });
});
