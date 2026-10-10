/**
 * 教练讲一手棋：做题走错、选择题选错、复盘试下，用的都是这一份。
 *
 * 用户原话："教练讲解再细致一些。"原来走错只有一句"皮卡鱼核对过：这一手比最好的差了约 0.9 个兵。
 * 这一步该走 X。对方接下来会走 Y。"——知道错了，不知道错在哪、对方怎么占便宜、该走的那手好在哪。
 * 这里按教练讲棋的顺序说四件事：
 *   1. 你这一手在干什么（吃子、捉子、将军、出车……按盘面说，不编）；
 *   2. 对方会怎么接：引擎对你这一手算出来的主变，一手一手翻译，最后算账——丢了什么、被将死、还是先手没了；
 *   3. 该走哪一手、它在干什么、这一路的计划（可以点开在棋盘上一步步看）；
 *   4. 两边差多少：走对是什么局面、你这手之后是什么局面。
 * 着法和分数都是皮卡鱼算的，讲解只是把它翻译成人话。
 */
import { applyMove, type Board, type Color, type Move } from './rules';
import type { MoveScore } from './ai';
import { evalWords } from './analysis';
import { moveToText } from './notation';
import { noteMove } from './movenote';
import { lineSteps, punishLine } from './punish';
import { planHtml, planOf, stepTags } from './plan';
import { inPieces } from './teach';

export { WON_KEEP, isWon } from './analysis';

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const red = (c: Color, s: { score: number; mateIn?: number }) => ({
  score: c === 'r' ? s.score : -s.score,
  mate: s.mateIn === undefined ? undefined : c === 'r' ? s.mateIn : -s.mateIn,
});
const words = (c: Color, s: { score: number; mateIn?: number }) => {
  const r = red(c, s);
  return evalWords(r.score, r.mate);
};

/** 一手棋在干什么：movenote 的一句话 + 标签（吃车、捉马、将军、过河……） */
export function whatItDoes(before: Board, m: Move, mover: Color, me: Color = mover): string {
  const note = noteMove(before, m, mover).replace(/。$/, '');
  const tags = stepTags(before, m, mover, me);
  return `${note}${tags.length && !tags.every((t) => note.includes(t.replace(/^吃/, ''))) ? `（${tags.slice(0, 3).join('、')}）` : ''}`;
}

/** 这一串着法往后几手，一手一手说：谁走、走什么、在干什么。first 是第一手谁走，me 是称呼"你"的那一方 */
export function lineTalk(before: Board, line: Move[], first: Color, me: Color, max = 5): string {
  const steps = lineSteps(before, line, first, me, max);
  if (!steps.length) return '';
  return `<ol class="xq-talk-line">${steps
    .map((s) => `<li class="${s.who}"><span class="w">${s.who === 'me' ? '你' : '对方'}</span><b>${s.text}</b><em>${s.note}${s.tags.length ? `（${s.tags.slice(0, 2).join('、')}）` : ''}</em></li>`)
    .join('')}</ol>`;
}

export interface WrongTalkOpts {
  /** 该走的那一手：原谱上的（在主变上）或者皮卡鱼的首选。没有就只讲你这一手 */
  best?: MoveScore | null;
  /** 原谱上该走的那一手的记谱（比引擎首选优先：题目的答案就是它） */
  bestText?: string;
  /** "你"是哪一方（默认就是走这一手的一方） */
  me?: Color;
}

/**
 * 走错一手的完整讲解（HTML）。mine：你这一手（带主变，pv[0] 就是这一手）；before：走之前的局面；mover：谁走的。
 */
export function wrongTalk(before: Board, mover: Color, mine: MoveScore, o: WrongTalkOpts = {}): string {
  const me = o.me ?? mover;
  const foe = other(mover);
  const mv = mine.move;
  const parts: string[] = [];
  // 1. 你这一手在干什么
  parts.push(`<div class="xq-talk-row"><span class="k">你这手</span><b>${moveToText(before, mv)}</b>：${whatItDoes(before, mv, mover, me)}。</div>`);
  // 2. 对方怎么接：主变一手手翻译 + 算账
  const pv = mine.pv?.length && mine.pv[0].fx === mv.fx && mine.pv[0].fy === mv.fy && mine.pv[0].tx === mv.tx && mine.pv[0].ty === mv.ty ? mine.pv : [mv];
  const p = pv.length >= 2 ? punishLine(before, pv, mover, 7, { me: '你', foe: '对方' }) : null;
  if (p) {
    const rows = p.steps
      .slice(1)
      .map((s) => `<li class="${s.who === 'me' ? 'me' : 'foe'}"><span class="w">${s.who === 'me' ? '你' : '对方'}</span><b>${s.text}</b><em>${s.note}${s.tags.length ? `（${s.tags.slice(0, 2).join('、')}）` : ''}</em></li>`)
      .join('');
    parts.push(`<div class="xq-talk-row"><span class="k">对方会这样接</span></div><ol class="xq-talk-line">${rows}</ol><div class="xq-talk-sum">${p.summary}</div>`);
  } else if (pv.length >= 2) {
    const after = applyMove(before, mv);
    parts.push(`<div class="xq-talk-row"><span class="k">对方会接</span><b>${moveToText(after, pv[1])}</b>：${whatItDoes(after, pv[1], foe, me)}。</div>`);
  }
  // 3. 该走哪一手、好在哪
  const best = o.best;
  if (best) {
    const bt = o.bestText ?? moveToText(before, best.move);
    const plan = planOf(before, mover, best, 7);
    parts.push(
      // 这一路的目标和后续在下面的计划里（planHtml 自带"📋 计划：目标"和"在棋盘上一步步看"）
      `<div class="xq-talk-row good"><span class="k">该走</span><b>${bt}</b>：${whatItDoes(before, best.move, mover, me)}。</div>${planHtml(plan)}`,
    );
    // 4. 差多少
    const diff = best.mateIn === undefined && mine.mateIn === undefined ? best.score - mine.score : null;
    parts.push(
      `<div class="xq-talk-row dim">走 ${bt}：${words(mover, best)}；走 ${moveToText(before, mv)}：${words(mover, mine)}${
        diff !== null && diff >= 30 ? `——差约 ${diff} 分（${inPieces(diff)}）` : ''
      }。</div>`,
    );
  }
  return `<div class="xq-talk" data-talk>${parts.join('')}</div>`;
}
