/**
 * 对局怎么结束：将死/困毙之外的那些规矩。
 *
 * 原来的对局只认"将死"一种结局。于是：
 *   - 双方来回走同样几步，棋永远下不完（没有重复局面判和）；
 *   - 一方一直将军也不犯规（没有长将判负）；
 *   - 双方都只剩士象，还得硬下下去（没有"无进攻子力"判和）；
 *   - 几十个回合没人吃子，也永远不会和（没有自然限着）。
 * 这些都是实际下棋一定会碰到的，缺了任何一条，都会让人觉得"这软件不懂棋"。
 *
 * 规则取中国象棋竞赛规则里最常用、最没有争议的部分：
 *   - 同一局面第三次出现：一方每一步都在将军、另一方没有 → 长将方判负；否则作和。
 *   - 连续 60 回合（120 步）没有吃子：作和。
 *   - 双方都没有车马炮兵（只剩将士象）：作和。
 *   - 双方各只剩一个马或炮（马对马、炮对炮、马对炮），都没有车和兵：书上的和棋，直接作和。
 * 长捉等更细的裁决涉及"捉"的认定，争议大，这里不做。
 */
import { applyMove, isInCheck, legalMoves, type Board, type Color } from './rules';

export type EndReason =
  | 'mate'
  | 'stalemate'
  | 'resign'
  | 'agreed'
  | 'repetition'
  | 'perpetual-check'
  | 'move-limit'
  | 'no-attackers'
  | 'bare-minors';

export interface GameEnd {
  /** 赢家；和棋为 null */
  winner: Color | null;
  reason: EndReason;
}

/** 一手棋走完之后要记下的东西 */
export interface PlyRecord {
  /** 走完之后的局面（含轮到谁走） */
  key: string;
  /** 走的是哪一方 */
  mover: Color;
  /** 这一手有没有将军 */
  check: boolean;
  /** 这一手有没有吃子 */
  capture: boolean;
}

/** 自然限着：60 回合 = 120 步 */
export const MOVE_LIMIT = 120;

export const END_TEXT: Record<EndReason, string> = {
  mate: '将死',
  stalemate: '困毙',
  resign: '认输',
  agreed: '双方议和',
  repetition: '重复局面判和',
  'perpetual-check': '长将判负',
  'move-limit': '60 回合未吃子，自然限着作和',
  'no-attackers': '双方都没有进攻子力，作和',
  'bare-minors': '双方各只剩一个马或炮，谁也赢不了，作和',
};

/**
 * 重复局面的裁决。
 *
 * @param startKey 起始局面
 * @param plies    到目前为止的每一手
 * @returns count 当前局面出现了几次；perpetual 是"在这段循环里每一步都在将军"的一方
 */
export function repetitionState(
  startKey: string,
  plies: PlyRecord[],
): { count: number; perpetual: Color | null } {
  if (!plies.length) return { count: 1, perpetual: null };
  const cur = plies[plies.length - 1].key;
  // -1 代表起始局面
  const at: number[] = [];
  if (startKey === cur) at.push(-1);
  plies.forEach((p, i) => {
    if (p.key === cur) at.push(i);
  });
  const count = at.length;
  if (count < 2) return { count, perpetual: null };
  // 看最近这一段循环：从倒数第三次（不够三次就从第一次）出现之后开始
  const from = at[Math.max(0, count - 3)] + 1;
  const window = plies.slice(from);
  const allCheck = (c: Color) => {
    const mine = window.filter((p) => p.mover === c);
    return mine.length > 0 && mine.every((p) => p.check);
  };
  const r = allCheck('r');
  const b = allCheck('b');
  return { count, perpetual: r && !b ? 'r' : b && !r ? 'b' : null };
}

/** 从最后一手往回数，多少步没有吃子了 */
export function pliesSinceCapture(plies: PlyRecord[]): number {
  let n = 0;
  for (let i = plies.length - 1; i >= 0 && !plies[i].capture; i--) n++;
  return n;
}

/** 双方都只剩将士象：谁也将不死谁 */
export function noAttackers(b: Board): boolean {
  for (const row of b) for (const p of row) if (p && (p.t === 'R' || p.t === 'H' || p.t === 'C' || p.t === 'P')) return false;
  return true;
}

/**
 * 双方各只剩一个马或炮（没有车、没有兵）：马对马、炮对炮、马对炮，书上都是和棋。
 * 用户原话："明显各自只剩一个马还要走半天，或者明显和局（比如各自剩一个炮）还要走很多步……直接判定即可。"
 * 这一步就能吃掉对方最后那个子的不算（吃完是单马/单炮对光将或士象，可能还有得赢）。
 * 这里只看子力；子摆得别扭时会有杀，所以判和之前还要让引擎看一眼（minors.ts），不放进 drawOrForfeit。
 */
export function bareMinors(b: Board, toMove: Color): boolean {
  const minors: Record<Color, { x: number; y: number }[]> = { r: [], b: [] };
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 9; x++) {
      const p = b[y][x];
      if (!p) continue;
      if (p.t === 'R' || p.t === 'P') return false;
      if (p.t === 'H' || p.t === 'C') minors[p.c].push({ x, y });
    }
  if (minors.r.length !== 1 || minors.b.length !== 1) return false;
  const foe: Color = toMove === 'r' ? 'b' : 'r';
  const target = minors[foe][0];
  const canTake = legalMoves(b, toMove).some((m) => m.tx === target.x && m.ty === target.y && !isInCheck(applyMove(b, m), toMove));
  return !canTake;
}

/**
 * 将死/困毙以外的结局判定。每走完一手调一次。
 * 返回 null = 棋还没完。
 */
export function drawOrForfeit(board: Board, startKey: string, plies: PlyRecord[]): GameEnd | null {
  const rep = repetitionState(startKey, plies);
  if (rep.count >= 3) {
    if (rep.perpetual) return { winner: rep.perpetual === 'r' ? 'b' : 'r', reason: 'perpetual-check' };
    return { winner: null, reason: 'repetition' };
  }
  if (pliesSinceCapture(plies) >= MOVE_LIMIT) return { winner: null, reason: 'move-limit' };
  if (noAttackers(board)) return { winner: null, reason: 'no-attackers' };
  return null;
}
