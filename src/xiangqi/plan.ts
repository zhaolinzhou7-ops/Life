/**
 * 计划：这一步之后该往哪儿走，对方又想干什么。
 *
 * 教练原来只会说"最优是哪一手"。可下棋的人真正想知道的是**思路**：
 *   这一手是为了什么？接下来两三步怎么走？走完局面会变成什么样？
 *   对方现在在打什么主意？
 * 只报一手棋，用户下一步照样不知道该干什么；讲清计划，下一步他自己就能找到。
 *
 * 计划不是编出来的：它就是引擎算出来的主变（双方最佳应对的那一串），
 * 这里做的只是把它翻译成人话——每一步在干什么（将军、吃子、过河、帅助攻……），
 * 走完之后子力怎么变、会不会简化成残局、书上那个残局是赢是和。
 * 对方的想法用"让他连走两步"的办法问引擎：如果现在轮到他，他最想走什么。
 * 这就是职业棋手说的"先看对方的威胁"。
 */
import type { MoveScore } from './ai';
import { applyMove, isInCheck, legalMoves, type Board, type Color, type Move } from './rules';
import { PIECE_VALUE, inPieces, other } from './teach';
import { moveToText, pieceName } from './notation';
import { intentsOf, type Intent } from './deepcoach';
import { classifyEndgame, isEndgame, type EndgameInfo } from './endgame';
import { engineAnalyse, engineReady } from './pikafish';
import { requestAnalysis } from './aiclient';

export interface PlanStep {
  who: 'me' | 'foe';
  text: string;
  /** 这一步在干什么：将军、吃车、过河…… */
  tags: string[];
}

export type PlanKind =
  | 'mate'
  | 'defend-mate'
  | 'win-material'
  | 'sacrifice'
  | 'exchange'
  | 'attack'
  | 'positional';

export interface Plan {
  kind: PlanKind;
  /** 一句话的目标："3 步杀"、"得子：净赚一个马"、"兑车，简化成车兵对士象全" */
  goal: string;
  steps: PlanStep[];
  /** 这一串走完，子力的净得失（你的视角） */
  materialDelta: number;
  /** 这一串走完进入了残局（原来不是） */
  endgame?: EndgameInfo;
  /** 局面判断："你占优（约多一个马炮）" */
  outlook: string;
}

const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

const TAG: Partial<Record<Intent, string>> = {
  check: '将军',
  'mate-threat': '做杀',
  threat: '捉子',
  defend: '保护',
  escape: '逃子',
  block: '垫将',
  develop: '出子',
  cross: '过河',
  center: '占中',
  connect: '连环',
  guard: '补士象',
};

/** 一步棋的标签。吃子写明吃的是什么；帅（将）动了在残局里叫助攻 */
export function stepTags(before: Board, m: Move, mover: Color, me: Color): string[] {
  const piece = before[m.fy][m.fx];
  if (!piece) return [];
  const out: string[] = [];
  const took = before[m.ty][m.tx];
  for (const i of intentsOf(before, m, mover)) {
    if (i === 'capture' && took) out.push(`吃${pieceName(took.t, took.c)}`);
    else if (TAG[i]) out.push(TAG[i]!);
  }
  if (piece.t === 'K' && !isInCheck(before, mover)) {
    const k = pieceName('K', mover);
    out.push(mover === me && isEndgame(before) ? `${k}助攻` : `走${k}`);
  }
  if (piece.t === 'P' && !out.includes('过河') && !took) {
    const forward = mover === 'r' ? m.ty < m.fy : m.ty > m.fy;
    if (forward) out.push('进兵');
  }
  if (isInCheck(before, mover) && !out.includes('垫将')) out.push('应将');
  return [...new Set(out)];
}

/** 你的视角的分数说成一句局面判断 */
export function outlookOf(score: number, mateIn?: number): string {
  if (mateIn !== undefined) return mateIn > 0 ? `你 ${mateIn} 步杀` : `对方 ${-mateIn} 步杀`;
  const a = Math.abs(score);
  if (a < 60) return '均势';
  const who = score > 0 ? '你' : '对方';
  if (a >= 1900) return `${who}大优（约多两个车）`;
  if (a >= 900) return `${who}大优（约多一个车）`;
  if (a >= 420) return `${who}占优（约多一个马炮）`;
  if (a >= 150) return `${who}稍优（约多${Math.round(a / 100)}个兵）`;
  return `${who}略好`;
}

/** 把一串吃掉的子写成"车、马" */
const namesOf = (list: { t: string; c: Color }[]) =>
  list.map((p) => pieceName(p.t as never, p.c)).join('、');

/**
 * 从引擎的主变读出计划。
 * best 是这个局面引擎的首选（带主变 pv，pv[0] 就是这一手）。
 */
export function planOf(board: Board, me: Color, best: MoveScore, maxPlies = 7): Plan {
  const foe = other(me);
  const outlook = outlookOf(best.score, best.mateIn);
  const pv = best.pv?.length ? best.pv : [best.move];
  const steps: PlanStep[] = [];
  let cur = board;
  let c: Color = me;
  let gained = 0;
  let lost = 0;
  const took: { t: string; c: Color }[] = [];
  const gave: { t: string; c: Color }[] = [];
  let checks = 0;
  const limit = best.mateIn !== undefined && best.mateIn > 0 ? Math.min(2 * best.mateIn - 1, 11) : maxPlies;
  for (const m of pv.slice(0, limit)) {
    // 主变里的每一手都要在我们的规则下合法；不合法就截断（引擎和我们对规则的理解有出入时）
    if (!legalMoves(cur, c).some((x) => same(x, m))) break;
    const cap = cur[m.ty][m.tx];
    // 吃将只会出现在不合法的局面里（摆出来的局面本身就在被将军）：到此为止，不往下编
    if (cap?.t === 'K') break;
    if (cap) {
      if (c === me) {
        gained += PIECE_VALUE[cap.t];
        took.push(cap);
      } else {
        lost += PIECE_VALUE[cap.t];
        gave.push(cap);
      }
    }
    if (c === me && isInCheck(applyMove(cur, m), foe)) checks++;
    steps.push({ who: c === me ? 'me' : 'foe', text: moveToText(cur, m), tags: stepTags(cur, m, c, me) });
    cur = applyMove(cur, m);
    c = other(c);
  }
  const delta = gained - lost;
  const endgame = !isEndgame(board) && isEndgame(cur) ? classifyEndgame(cur, me) ?? undefined : undefined;
  const base = { steps, materialDelta: delta, endgame, outlook };

  if (best.mateIn !== undefined && best.mateIn > 0) {
    const mine = steps.filter((s) => s.who === 'me').length;
    const how =
      mine && checks === mine
        ? '一路将军到底，对方怎么应都逃不掉'
        : '中间有几步不将军，是在封住将的去路——对方照样逃不掉';
    return { ...base, kind: 'mate', goal: `${best.mateIn} 步杀：${how}` };
  }
  if (best.mateIn !== undefined && best.mateIn < 0) {
    return {
      ...base,
      kind: 'defend-mate',
      goal: `对方已经有 ${-best.mateIn} 步杀。这是最顽强的走法：尽量拖长，等对方走错`,
    };
  }
  const simplify = endgame ? `，简化成「${endgame.name}」${endgame.book ? `（书上${endgame.book.result === 'win' ? '例胜' : '例和'}）` : ''}` : '';
  if (delta >= 150) {
    return { ...base, kind: 'win-material', goal: `得子：这样走下去净赚${inPieces(delta)}（吃掉${namesOf(took)}）${simplify}` };
  }
  if (delta <= -150 && best.score > -150) {
    return {
      ...base,
      kind: 'sacrifice',
      goal: `弃子抢攻：先送出${inPieces(-delta)}，换来${checks >= 2 ? '连续将军的攻势' : '更好的位置和攻势'}`,
    };
  }
  if (gained >= 300 && lost >= 300) {
    return { ...base, kind: 'exchange', goal: `兑子：用${namesOf(gave)}换对方的${namesOf(took)}${simplify}` };
  }
  if (checks >= 2) {
    return { ...base, kind: 'attack', goal: '连将抢攻：用将军逼着对方的将走，自己的子趁机跟上' };
  }
  // 局面型：数一数我方这几步主要在干什么
  const freq = new Map<string, number>();
  for (const s of steps) {
    if (s.who !== 'me') continue;
    for (const t of s.tags) if (!t.startsWith('吃')) freq.set(t, (freq.get(t) ?? 0) + 1);
  }
  const top = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([t]) => t);
  const goal = top.length
    ? `${top.join('、')}${simplify}：先把子力放到好位置，再找机会`
    : `稳住局面${simplify}：没有急着要做的事，先把子力摆好，等对方露出破绽`;
  return { ...base, kind: 'positional', goal };
}

/** 计划写成一段 HTML（求助面板、复盘、残局练习共用） */
export function planHtml(p: Plan): string {
  const steps = p.steps
    .map(
      (s) =>
        `<span class="st ${s.who}">${s.who === 'me' ? '你' : '对方'} <b>${s.text}</b>${
          s.tags.length ? `<em>${s.tags.join('、')}</em>` : ''
        }</span>`,
    )
    .join('<i>→</i>');
  const eg = p.endgame?.book?.note ? `<div class="eg">📘 ${p.endgame.book.book}：${p.endgame.book.note}</div>` : '';
  return `<div class="xq-plan"><div class="goal">📋 <b>计划</b>：${p.goal}</div>
    <div class="line">${steps}</div>${eg}<div class="out">走完之后：${p.outlook}</div></div>`;
}

// ───────────────────────── 对方的想法 ─────────────────────────

export interface Threat {
  move: Move;
  text: string;
  tags: string[];
  /** 不管它的话大约亏多少（你的视角，正数 = 亏） */
  loss: number;
  /** 对方几步杀 */
  mateIn?: number;
  /** 对方想走的那一串 */
  line: string[];
  /** 他要吃的是你的什么子 */
  prize?: string;
  /** 他第一手就直接吃（否则是先做准备，下一步再吃） */
  direct?: boolean;
}

/**
 * 对方现在在打什么主意：假设轮到他走，他最想走哪一手、能得到什么。
 *
 * 原理是"空着"：让对方连走两步。一个局面里如果让对方白走一步他就能吃掉你一个马，
 * 那他现在就在威胁这个马——这是职业棋手每一步都会先问自己的问题。
 *
 * 威胁有多大，看的是**他那一串着法实际吃到了什么**（或者能不能杀），而不是分数差：
 * 分数差里还混着"你对他的威胁"——他白走一步正好逃掉你要吃的子，分数也会差一个马，
 * 可那是你的机会，不是他的威胁。第一版就是这么把"对方逃马"说成了"你要丢马"。
 * 你正被将军时不问（威胁就是这个将军）。
 */
export async function opponentIdea(board: Board, me: Color, _myScore: number, movetime = 700): Promise<Threat | null> {
  if (isInCheck(board, me)) return null;
  const foe = other(me);
  // 对方被将着军时"让他连走"不成立（他得先应将）
  if (isInCheck(board, foe)) return null;
  const moves = engineReady()
    ? await engineAnalyse(board, foe, { movetime, multipv: 1 })
    : await requestAnalysis(board, foe, { maxDepth: 5, timeMs: movetime, jitter: 0 });
  const top = moves?.find((x) => !x.bound);
  if (!top) return null;
  const mate = top.mateIn !== undefined && top.mateIn > 0 ? top.mateIn : undefined;
  // 沿着他的主变走几步（他、你、他、你），算他净吃到多少。
  // 你吃回来只算"吃回他刚落下的那个子"：你在别处吃他的子，是你的机会，和他的威胁是两回事——
  // 两边互相捉子时，不能拿"我也能吃他一个"把"他要吃我一个"抵掉，那样会说成"对方没有威胁"
  const line: string[] = [];
  let cur = board;
  let c: Color = foe;
  let gain = 0;
  let prize: { t: string; c: Color } | null = null;
  let landed: Move | null = null;
  for (const m of (top.pv?.length ? top.pv : [top.move]).slice(0, 4)) {
    if (!legalMoves(cur, c).some((x) => same(x, m))) break;
    const cap = cur[m.ty][m.tx];
    if (cap?.t === 'K') break;
    if (c === foe) {
      if (cap) {
        const v = PIECE_VALUE[cap.t];
        gain += v;
        if (!prize || v > PIECE_VALUE[prize.t as keyof typeof PIECE_VALUE]) prize = cap;
      }
      landed = m;
    } else if (cap && landed && m.tx === landed.tx && m.ty === landed.ty) {
      gain -= PIECE_VALUE[cap.t];
    }
    if (line.length < 3) line.push(moveToText(cur, m));
    cur = applyMove(cur, m);
    c = other(c);
  }
  if (!mate && gain < 150) return null;
  return {
    move: top.move,
    text: moveToText(board, top.move),
    tags: stepTags(board, top.move, foe, me),
    loss: Math.max(0, gain),
    mateIn: mate,
    line,
    prize: prize ? pieceName(prize.t as never, prize.c) : undefined,
    direct: !!board[top.move.ty][top.move.tx],
  };
}

/** 对方想法的一句话 */
export function threatText(t: Threat): string {
  const what = t.tags.length ? `（${t.tags.join('、')}）` : '';
  if (t.mateIn) return `对方在做杀：如果你不管，他走 <b>${t.text}</b>${what}，${t.mateIn} 步就能将死你。`;
  const take = t.prize ? (t.direct ? `直接吃你的${t.prize}` : `接下来要吃你的${t.prize}`) : '';
  return `对方想走 <b>${t.text}</b>${what}${take ? `，${take}` : ''}——不管的话大约亏${inPieces(t.loss)}。`;
}
