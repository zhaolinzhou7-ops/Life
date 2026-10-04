/**
 * 劣势推演：走错了一手，对手接下来**具体**怎么罚你。
 *
 * 用户原话："当我走得不对时，不能只是笼统地说当前没问题、后面会怎么样，而是要告诉我对手接下来会怎么应对、
 * 具体怎么走会导致我陷入劣势，这样才有用。"
 *
 * 不编：就是引擎对你这一手算出来的主变（双方都走最好的那一串）。这里只做三件事——
 *   1. 一手一手翻译成人话：谁走、走的什么、干了什么（吃子、捉子、将军、过河……）；
 *   2. 记账：这几步下来谁丢了什么子；
 *   3. 一句话结论：你是怎么一步步落到下风的。
 * 复盘里的"⚠️ 对手会这样罚你"、棋盘上的演示、对局里教练的提醒都用这一份。
 */
import { applyMove, isInCheck, legalMoves, type Board, type Color, type Move } from './rules';
import { PIECE_VALUE, inPieces, other } from './teach';
import { moveToText, pieceName } from './notation';
import { noteMove } from './movenote';
import { stepTags } from './plan';

export interface PunishStep {
  /** 这一步谁走：me = 走错的那一方 */
  who: 'me' | 'foe';
  move: Move;
  text: string;
  /** 这一步在干什么（一句话，来自 movenote：吃掉马、捉车、将军……） */
  note: string;
  tags: string[];
  /** 走之前的盘面（演示时要从这里画箭头） */
  before: Board;
}

export interface Punish {
  /** 第 0 步是你走错的那一手，后面是双方的最佳应对 */
  steps: PunishStep[];
  /** 你丢的子 / 你吃的子 */
  lost: string[];
  won: string[];
  /** 子力净得失（你的视角，负数 = 亏） */
  net: number;
  /** 一句话：对手怎么罚你 */
  summary: string;
}

const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

/**
 * line：从你走错的那一手开始的主变（line[0] 就是你走的那一手）。
 * maxPlies：最多翻译几手（含你那一手）。吃子还没吃完（最后一手是吃子、对方能吃回来）就多走一手，账才算得对。
 */
export function punishLine(
  before: Board,
  line: Move[],
  me: Color,
  maxPlies = 9,
  /** 称呼：走错的一方、另一方。复盘里对手走错时反过来——"对方走软了，你可以这样罚他" */
  names: { me: string; foe: string } = { me: '你', foe: '对手' },
): Punish | null {
  if (line.length < 2) return null;
  const steps: PunishStep[] = [];
  const lost: string[] = [];
  const won: string[] = [];
  let net = 0;
  let cur = before;
  let c: Color = me;
  let lastCap = -1;
  const cap = Math.min(line.length, maxPlies + 2);
  for (let i = 0; i < cap; i++) {
    // 罚完了就停：已经净亏一个子以上、而且最后一次吃子之后双方又各走了一步（吃回来的机会过去了），后面的着法不是重点
    if (steps.length >= 4 && net <= -150 && steps.length - 1 - lastCap >= 2) break;
    const m = line[i];
    if (!legalMoves(cur, c).some((x) => same(x, m))) break;
    const took = cur[m.ty][m.tx];
    if (took?.t === 'K') break;
    // 到了上限：这一手还在吃子（多半是吃回来）就再走一手、最多两手——不然账停在半截，"丢了个车"其实是兑车
    if (i >= maxPlies && !took) break;
    if (took) {
      lastCap = steps.length;
      const nm = pieceName(took.t, took.c);
      if (took.c === me) {
        lost.push(nm);
        net -= PIECE_VALUE[took.t];
      } else {
        won.push(nm);
        net += PIECE_VALUE[took.t];
      }
    }
    steps.push({
      who: c === me ? 'me' : 'foe',
      move: m,
      text: moveToText(cur, m),
      note: noteMove(cur, m, c).replace(/。$/, ''),
      tags: stepTags(cur, m, c, me),
      before: cur,
    });
    cur = applyMove(cur, m);
    c = other(c);
  }
  if (steps.length < 2) return null;
  return { steps, lost, won, net, summary: summaryOf(steps, lost, won, net, cur, me, names) };
}

/** 一句话结论：先说结果（丢了什么 / 被将死 / 被压住），再说是怎么发生的 */
function summaryOf(
  steps: PunishStep[],
  lost: string[],
  won: string[],
  net: number,
  end: Board,
  me: Color,
  names: { me: string; foe: string },
): string {
  const { me: I, foe: F } = names;
  const foeSteps = steps.filter((s) => s.who === 'foe');
  const first = foeSteps[0];
  const checks = foeSteps.filter((s) => s.tags.includes('将军')).length;
  const chases = foeSteps.filter((s) => s.tags.includes('捉子') || s.tags.includes('做杀')).length;
  const howFirst = first ? `${F}先 ${first.text}${first.tags.length ? `（${first.tags.slice(0, 2).join('、')}）` : ''}` : '';
  if (isInCheck(end, me) && !legalMoves(end, me).length) return `${howFirst}，几步之内就把${I === '你' ? '你' : I}将死了。`;
  if (net <= -150) {
    const lostWhat = lost.length ? `丢了${lost.join('、')}` : '';
    const back = won.length ? `，只换回${won.join('、')}` : '';
    return `${howFirst}，${checks >= 2 ? `连着将军逼${I}应将，` : chases ? '一路捉子抢先手，' : ''}这几步下来${I}${lostWhat}${back}——净亏${inPieces(net)}。`;
  }
  if (net >= 150) {
    return `${howFirst}。子力上${I}暂时不亏（还多${inPieces(net)}），但${F}拿到了先手，局面比走对的那一手差。`;
  }
  if (checks >= 2) return `${howFirst}，接着连将，${I}的将被赶出来，子力一时不亏，但阵形散了、先手全在${F}。`;
  if (chases >= 2) return `${howFirst}，接着又捉子，${I}一直在应付、自己的计划走不了——子力不亏，但先手丢了。`;
  return `${howFirst}，子力一时不亏，但${I}的子被压住、${F}的子占到好位置，局面慢慢落到下风。`;
}

/**
 * 对局里教练提醒用的短句：对方接什么、你怎么应、他再走什么，最后丢了什么。
 * 只说前三四手（提醒要短），结果按全线的账。
 */
export function punishBrief(p: Punish): string {
  const parts = p.steps.slice(1, 4).map((s) => `${s.who === 'foe' ? '对方' : '你'} ${s.text}${s.tags.length ? `（${s.tags.slice(0, 2).join('、')}）` : ''}`);
  const tail = p.net <= -150 ? `，算下去你丢${p.lost.join('、')}，净亏${inPieces(p.net)}` : '，先手落到对方手里';
  return `${parts.join('，')}${p.steps.length > 4 ? '……' : ''}${tail}。`;
}
