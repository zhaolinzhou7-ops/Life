/**
 * AI 第三、四、五步：局面评价 -> 策略选择 -> 执行。
 *
 * 分三档难度，差别在**看得多远**，不是在"想多久"：
 *   简单：只看自己这手牌出得顺不顺；不记牌，不配合队友，炸弹乱用。
 *   普通：算出完这手之后自己还剩几手，会留控制牌，会避免拆炸弹。
 *   困难：加上记牌推断（对手还剩什么）、队友配合（不打队友、给队友喂牌）、
 *        炸弹管理（只在关键时刻炸）、残局处理（对手剩一张时不喂单牌）。
 *
 * 所有决策只基于 PublicView，看不到别人手牌——见 memory.ts 的说明。
 */
import { RANK_2, RANK_JOKER_BIG, sortCards, type Card, type Rank } from '../cards';
import { MOVE_TYPE_NAMES, describeMove, isBomb, type Move } from '../patterns';
import type { Seat } from '../game';
import { analyzeHand, minHandsCached, toCounts } from './analysis';
import { filterLegal, generateCandidates } from './candidates';
import {
  buildMemory,
  isUnbeatableMove,
  maxUnseenRank,
  type CardMemory,
  type PublicView,
} from './memory';

export type Difficulty = 'easy' | 'normal' | 'hard';

export const DIFFICULTY_NAMES: Record<Difficulty, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
};

export interface Decision {
  action: 'play' | 'pass';
  cards: Card[];
  /** 为什么这么打——学习模式会把它显示出来 */
  reason: string;
}

/** 我在这局里的身份和对手 */
interface Role {
  isLandlord: boolean;
  /** 队友座位（农民才有） */
  teammate: Seat | null;
  /** 我要拦的人：农民拦地主，地主拦两个农民 */
  enemies: Seat[];
  /** 对手里剩牌最少的那家还剩几张 */
  enemyMinCards: number;
  teammateCards: number;
}

function roleOf(view: PublicView): Role {
  const isLandlord = view.seat === view.landlord;
  const seats = [0, 1, 2] as Seat[];
  const enemies = isLandlord ? seats.filter((s) => s !== view.seat) : [view.landlord];
  const teammate = isLandlord ? null : (seats.find((s) => s !== view.seat && s !== view.landlord) ?? null);
  return {
    isLandlord,
    teammate,
    enemies,
    enemyMinCards: Math.min(...enemies.map((s) => view.handCounts[s])),
    teammateCards: teammate === null ? 99 : view.handCounts[teammate],
  };
}

/** 一手牌"用掉了多大的牌"：越大越心疼 */
function moveCost(move: Move): number {
  let cost = 0;
  for (const c of move.cards) {
    cost += Math.max(0, c.rank - 10) * 1.2;
    if (c.rank === RANK_2) cost += 2;
    if (c.rank >= 16) cost += 5;
  }
  if (move.type === 'bomb') cost += 22;
  if (move.type === 'rocket') cost += 34;
  return cost;
}

interface Evaluation {
  score: number;
  /** 出完这手之后还剩几手 */
  handsAfter: number;
  /** 出完就赢 */
  winsNow: boolean;
}

/**
 * 局面评价：出了这手之后，我的处境好不好。
 *
 * 主线是**手数**：出一手牌应该让"我还要出几次"减少 1。如果出了一手牌手数没变
 * （比如从对子里拆一张出去），那这手多半是亏的。
 * 在这之上再叠：直接走完（无限大）、用掉的牌值不值、剩下的牌有没有控制力。
 */
function evaluate(view: PublicView, move: Move, role: Role, difficulty: Difficulty, mem: CardMemory): Evaluation {
  const rest = view.hand.filter((c) => !move.cards.some((m) => m.id === c.id));
  const winsNow = rest.length === 0;
  if (winsNow) return { score: 100000, handsAfter: 0, winsNow: true };

  const handsBefore = minHandsCached(toCounts(view.hand));
  const handsAfter = difficulty === 'easy' ? handsBefore - 1 : minHandsCached(toCounts(rest));

  let score = 0;
  // 手数减少是主要收益
  score += (handsBefore - handsAfter) * 30;
  // 同样减一手，出得多的更划算
  score += move.cards.length * 1.2;
  // 用掉的大牌要扣分
  score -= moveCost(move) * (difficulty === 'easy' ? 0.4 : 1);

  if (difficulty !== 'easy') {
    const restAnalysis = analyzeHand(rest);
    // 手里留着控制牌（2、王、炸弹）才抢得回出牌权
    score += restAnalysis.controls.length * 1.5 + restAnalysis.bombs.length * 6 + (restAnalysis.hasRocket ? 8 : 0);
    // 只剩一手牌就是"下一轮拿到出牌权就赢"，非常值钱
    if (handsAfter === 1) score += 25;
    if (handsAfter === 2) score += 8;
  }

  if (difficulty === 'hard') {
    // 记牌：出完这手之后，剩下的牌里还有没有别人压不住的
    if (isUnbeatableMove(mem, move) && !isBomb(move)) score += 6;
    // 对手快走完了，别再留慢牌
    if (role.enemyMinCards <= 3) score += move.cards.length * 2.5;
  }

  return { score, handsAfter, winsNow: false };
}

/** 炸弹该不该现在用 */
function shouldUseBomb(view: PublicView, role: Role, difficulty: Difficulty, rest: Card[]): boolean {
  if (rest.length === 0) return true; // 炸完就走，随便炸
  if (difficulty === 'easy') return true; // 简单 AI 不管这些
  // 对手马上要走完了，炸
  if (role.enemyMinCards <= 2) return true;
  // 炸完之后自己一手就能走完，值
  if (minHandsCached(toCounts(rest)) <= 1) return true;
  if (difficulty === 'normal') return role.enemyMinCards <= 4;
  // 困难：再看一层——倍数已经很高时炸弹更贵，别乱炸
  if (role.enemyMinCards <= 5 && view.multiplier < 8) return true;
  return false;
}

/** 生成候选并按评价排序 */
function rankedCandidates(view: PublicView, role: Role, difficulty: Difficulty, mem: CardMemory) {
  const table = view.currentMove?.move ?? null;
  const leading = table === null;
  const raw = generateCandidates(view.hand, {
    table,
    allowBombs: true,
    // 主动出牌时只有残局才考虑四带二（拆炸弹）
    allowFourWithTwo: !leading || view.hand.length <= 8,
  });
  const legal = filterLegal(raw, view.hand, table);
  return legal
    .map((move) => {
      const rest = view.hand.filter((c) => !move.cards.some((m) => m.id === c.id));
      return { move, rest, ...evaluate(view, move, role, difficulty, mem) };
    })
    .sort((a, b) => b.score - a.score);
}

/** 主动出牌（桌面没牌，必须出） */
function decideLead(view: PublicView, role: Role, difficulty: Difficulty, mem: CardMemory): Decision {
  const ranked = rankedCandidates(view, role, difficulty, mem);
  if (!ranked.length) {
    // 理论上不可能：手上有牌就一定能出单张。留个兜底，绝不让 AI 卡住
    const fallback = sortCards(view.hand)[0];
    return { action: 'play', cards: [fallback], reason: '只能出一张单牌' };
  }

  // 一手走完直接走
  const win = ranked.find((r) => r.winsNow);
  if (win) return { action: 'play', cards: win.move.cards, reason: `这一手打完就走完了：${describeMove(win.move)}` };

  const adjusted = ranked.map((r) => {
    let score = r.score;
    const move = r.move;

    // 主动出牌不炸，除非炸完就能走
    if (isBomb(move) && difficulty !== 'easy') score -= 200;

    if (difficulty !== 'easy') {
      // 别一上来就送大牌：主动出牌优先出小的、长的
      if (move.type === 'single' && move.mainRank >= RANK_2) score -= 14;
      // 残局：对手只剩一张时，出单牌等于直接喂他走
      if (role.enemyMinCards === 1 && move.type === 'single' && move.mainRank < maxUnseenRank(mem)) {
        score -= 60;
      }
      // 对手只剩一张，出多张牌逼他接不上
      if (role.enemyMinCards === 1 && move.cards.length >= 2) score += 20;
    }

    if (difficulty === 'hard' && !role.isLandlord && role.teammate !== null) {
      // 队友快走完了，喂小牌给他接
      if (role.teammateCards <= 2) {
        if (move.type === 'single' && move.mainRank <= 10) score += 26;
        if (move.type === 'single' && move.mainRank >= 14) score -= 20;
      }
      // 地主快走完了，先出压得住的大牌把节奏掐住
      if (role.enemyMinCards <= 3 && isUnbeatableMove(mem, move)) score += 22;
    }

    if (difficulty === 'hard' && role.isLandlord) {
      // 地主：先把长牌型打出去，把散牌留到后面靠大牌收
      if (move.cards.length >= 5) score += 10;
    }

    return { ...r, score };
  });
  adjusted.sort((a, b) => b.score - a.score);

  const best = adjusted[0];
  return { action: 'play', cards: best.move.cards, reason: explainLead(best.move, role, difficulty, mem, best.handsAfter) };
}

/** 跟牌（桌面有牌，可以压也可以不要） */
function decideFollow(view: PublicView, role: Role, difficulty: Difficulty, mem: CardMemory): Decision {
  const table = view.currentMove!;
  const ranked = rankedCandidates(view, role, difficulty, mem);
  if (!ranked.length) return { action: 'pass', cards: [], reason: '压不住，只能不要' };

  // 能一手走完就走，什么都别想了
  const win = ranked.find((r) => r.winsNow);
  if (win) return { action: 'play', cards: win.move.cards, reason: `压过去正好走完：${describeMove(win.move)}` };

  const tableIsTeammate = !role.isLandlord && role.teammate !== null && table.seat === role.teammate;

  // ---- 不打队友 ----
  if (tableIsTeammate && difficulty !== 'easy') {
    // 队友的牌别人也压不住，让他继续坐庄
    const teammateSafe = difficulty === 'hard' ? isUnbeatableMove(mem, table.move) : true;
    // 例外：地主马上要走完了，这时候抢回出牌权比配合重要
    const urgent = role.enemyMinCards <= 2;
    if (!urgent && (teammateSafe || role.teammateCards <= 5)) {
      return { action: 'pass', cards: [], reason: `${describeMove(table.move)} 是队友出的，不打队友的牌` };
    }
  }
  // 简单 AI 也做最基本的配合：队友出的牌不压
  if (tableIsTeammate && difficulty === 'easy' && Math.random() < 0.6) {
    return { action: 'pass', cards: [], reason: '队友出的牌，不压' };
  }

  const candidates = ranked.filter((r) => {
    if (!isBomb(r.move)) return true;
    return shouldUseBomb(view, role, difficulty, r.rest);
  });
  if (!candidates.length) return { action: 'pass', cards: [], reason: '只剩炸弹能压，现在炸不划算，先不要' };

  const adjusted = candidates.map((r) => {
    let score = r.score;
    const move = r.move;
    // 跟牌时用小的压：能压住就行，不必用大牌
    score -= move.mainRank * 0.8;
    if (difficulty !== 'easy') {
      // 对手快走完了，压制比省牌重要
      if (role.enemyMinCards <= 2) score += 40;
      else if (role.enemyMinCards <= 4) score += 15;
      // 拆掉自己的结构去压，不值
      if (r.handsAfter >= minHandsCached(toCounts(view.hand))) score -= 24;
    }
    if (difficulty === 'hard' && !role.isLandlord) {
      // 地主出的牌，能压尽量压
      if (table.seat === view.landlord) score += 12;
    }
    return { ...r, score };
  });
  adjusted.sort((a, b) => b.score - a.score);
  const best = adjusted[0];

  // 值不值得压：拆了自己的牌去压一手无关紧要的牌，不如不要
  const handsNow = minHandsCached(toCounts(view.hand));
  const worth =
    difficulty === 'easy'
      ? true
      : best.handsAfter < handsNow ||
        role.enemyMinCards <= 3 ||
        (role.isLandlord && view.hand.length <= 6) ||
        isBomb(best.move);

  if (!worth) {
    return {
      action: 'pass',
      cards: [],
      reason: `压得住，但要拆掉自己的牌型（${MOVE_TYPE_NAMES[best.move.type]}），不划算，先不要`,
    };
  }

  return {
    action: 'play',
    cards: best.move.cards,
    reason: explainFollow(best.move, table.move, role, difficulty, mem, best.handsAfter),
  };
}

/** AI 决策主入口 */
export function decidePlay(view: PublicView, difficulty: Difficulty = 'normal'): Decision {
  const role = roleOf(view);
  const mem = buildMemory(view);
  const decision = view.currentMove ? decideFollow(view, role, difficulty, mem) : decideLead(view, role, difficulty, mem);

  // 最后一道保险：自由出牌时绝不能返回"不要"，否则牌局会卡死
  if (!view.currentMove && decision.action === 'pass') {
    const fallback = sortCards(view.hand)[0];
    return { action: 'play', cards: [fallback], reason: '该我先出牌' };
  }
  return decision;
}

// ---------------------------------------------------------------- 出牌解释

function explainLead(move: Move, role: Role, difficulty: Difficulty, mem: CardMemory, handsAfter: number): string {
  const what = describeMove(move);
  const bits: string[] = [];
  if (role.enemyMinCards === 1 && move.cards.length >= 2) {
    bits.push(`${role.isLandlord ? '农民' : '地主'}只剩 1 张，出多张牌他就接不上`);
  } else if (!role.isLandlord && role.teammateCards <= 2 && move.type === 'single' && move.mainRank <= 10) {
    bits.push('队友只剩一两张，出张小牌让他接着走');
  } else if (move.cards.length >= 5) {
    bits.push('先把长牌型打出去，散牌留到后面用大牌收');
  } else if (move.type === 'single' && move.mainRank <= 8) {
    bits.push('先把小散牌处理掉，保留手里的大牌');
  } else if (move.type === 'pair' || move.type === 'triple') {
    bits.push('出成组的牌，不打散手里的结构');
  }
  if (difficulty === 'hard' && isUnbeatableMove(mem, move)) bits.push('这手牌现在已经没人压得住了');
  bits.push(`出完还剩 ${handsAfter} 手`);
  return `出${what}：${bits.join('，')}。`;
}

function explainFollow(
  move: Move,
  table: Move,
  role: Role,
  difficulty: Difficulty,
  mem: CardMemory,
  handsAfter: number,
): string {
  const bits: string[] = [];
  if (isBomb(move)) {
    bits.push(role.enemyMinCards <= 2 ? `对家只剩 ${role.enemyMinCards} 张，再不炸就来不及了` : '这个时候炸最划算');
  } else if (role.enemyMinCards <= 3) {
    bits.push(`对家只剩 ${role.enemyMinCards} 张，必须压住`);
  } else {
    bits.push(`用最小的${MOVE_TYPE_NAMES[move.type]}压住就够了，大牌留着`);
  }
  if (difficulty === 'hard' && isUnbeatableMove(mem, move) && !isBomb(move)) bits.push('而且这手已经没人压得住');
  bits.push(`出完还剩 ${handsAfter} 手`);
  return `用 ${describeMove(move)} 压 ${describeMove(table)}：${bits.join('，')}。`;
}

// ---------------------------------------------------------------- 叫分

/** AI 叫分：难度越高越懂得"牌好才敢叫" */
export function decideBid(hand: Card[], highestBid: number, difficulty: Difficulty): number {
  const a = analyzeHand(hand);
  let want = 0;
  let score = 0;
  score += Math.max(0, 9 - a.hands) * 1.6;
  score += a.bombs.length * 2.4;
  score += a.hasRocket ? 3 : 0;
  score += (a.counts[RANK_JOKER_BIG] ? 1.2 : 0) + (a.counts[16] ? 0.8 : 0);
  score += a.counts[RANK_2] * 0.9;
  score += a.counts[14] * 0.4;

  if (difficulty === 'easy') score += (Math.random() - 0.35) * 2.5; // 简单 AI 会乱叫
  if (score >= 7.2) want = 3;
  else if (score >= 5.4) want = 2;
  else if (score >= 3.6) want = 1;

  return want > highestBid ? want : 0;
}

/** 给真人玩家的叫分建议，学习模式里用 */
export function bidAdvice(hand: Card[]): { suggest: number; reason: string } {
  const a = analyzeHand(hand);
  const parts: string[] = [`手牌能拆成 ${a.hands} 手`];
  if (a.bombs.length) parts.push(`有 ${a.bombs.length} 个炸弹`);
  if (a.hasRocket) parts.push('有王炸');
  if (a.counts[RANK_2]) parts.push(`${a.counts[RANK_2]} 张 2`);
  const suggest = a.hands <= 6 || a.bombs.length || a.hasRocket ? (a.hands <= 5 ? 3 : 2) : a.hands <= 8 ? 1 : 0;
  return {
    suggest,
    reason: suggest === 0 ? `${parts.join('、')}，牌偏散，建议不叫` : `${parts.join('、')}，建议叫 ${suggest} 分`,
  };
}

/** 学习模式：真人出牌后，看看 AI 会怎么出 */
export function reviewHumanPlay(
  view: PublicView,
  played: Card[] | null,
  difficulty: Difficulty = 'hard',
): { better: boolean; suggestion: Decision; text: string } {
  const suggestion = decidePlay(view, difficulty);
  const playedIds = played ? played.map((c) => c.id).sort().join(',') : '';
  const suggestIds = suggestion.cards.map((c) => c.id).sort().join(',');
  const same = played === null ? suggestion.action === 'pass' : playedIds === suggestIds;
  if (same) return { better: false, suggestion, text: '这手打得和最优解一致。' };
  return {
    better: true,
    suggestion,
    text: suggestion.action === 'pass' ? '这一手其实可以不要，留着牌型更好。' : `这里有更好的选择：${suggestion.reason}`,
  };
}

export type { Rank };
