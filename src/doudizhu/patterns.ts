/**
 * 牌型识别与比较。
 *
 * 这是整个规则引擎最核心的一层：**输入一组牌，输出它是什么牌型**，
 * 以及**两手牌谁压得住谁**。UI 和 AI 都只调这里，不许自己数牌。
 *
 * 识别结果里 mainRank 的约定（比较时只看它）：
 *   顺子/连对/飞机 -> 主体连续段的**最大点数**
 *   三带/四带       -> 三张或四张的点数（带的牌不参与比较）
 *   王炸           -> RANK_JOKER_BIG
 * length 的约定：
 *   顺子/连对 -> 张数 / 对数；飞机 -> 三张的组数；其余为 1。
 * 只有「牌型相同 且 length 相同」才能互相比较，这条是斗地主比较规则的骨架。
 */
import {
  MAX_CHAIN_RANK,
  RANK_JOKER_BIG,
  RANK_JOKER_SMALL,
  countByRank,
  groupByRank,
  rankLabel,
  sortCards,
  type Card,
  type Rank,
} from './cards';

export type MoveType =
  | 'single' // 单牌
  | 'pair' // 对子
  | 'triple' // 三张
  | 'triple_single' // 三带一
  | 'triple_pair' // 三带二（带一对）
  | 'straight' // 单顺（≥5 张连续）
  | 'double_straight' // 双顺 / 连对（≥3 对连续）
  | 'triple_straight' // 三顺 / 飞机不带翅膀（≥2 组连续三张）
  | 'plane_single' // 飞机带单牌
  | 'plane_pair' // 飞机带对子
  | 'four_two_singles' // 四带二（两张单牌）
  | 'four_two_pairs' // 四带两对
  | 'bomb' // 炸弹（四张相同）
  | 'rocket'; // 王炸

export const MOVE_TYPE_NAMES: Record<MoveType, string> = {
  single: '单牌',
  pair: '对子',
  triple: '三张',
  triple_single: '三带一',
  triple_pair: '三带二',
  straight: '顺子',
  double_straight: '连对',
  triple_straight: '飞机',
  plane_single: '飞机带单',
  plane_pair: '飞机带对',
  four_two_singles: '四带二',
  four_two_pairs: '四带两对',
  bomb: '炸弹',
  rocket: '王炸',
};

/** 一手合法的牌 */
export interface Move {
  type: MoveType;
  /** 组成这手牌的牌（已排序） */
  cards: Card[];
  /** 主体长度：顺子张数 / 对数 / 飞机组数，其余为 1 */
  length: number;
  /** 比较大小用的核心点数 */
  mainRank: Rank;
  /** 附带牌的点数（三带、四带、飞机翅膀），不参与比较，仅供 AI 和 UI 参考 */
  attachments: Rank[];
}

/** 识别结果：合法时带 move，不合法时带一句**说得清楚**的原因 */
export type MoveAnalysis =
  | { isValid: true; move: Move }
  | { isValid: false; reason: string };

const ok = (
  type: MoveType,
  cards: readonly Card[],
  mainRank: Rank,
  length = 1,
  attachments: Rank[] = [],
): MoveAnalysis => ({
  isValid: true,
  move: { type, cards: sortCards(cards), length, mainRank, attachments },
});

const fail = (reason: string): MoveAnalysis => ({ isValid: false, reason });

/** 点数是否能进顺子/连对/飞机的主体（3..A，排除 2 和双王） */
const chainable = (rank: Rank) => rank <= MAX_CHAIN_RANK;

/** 一组点数是否连续升序 */
function isConsecutive(ranks: Rank[]): boolean {
  for (let i = 1; i < ranks.length; i++) if (ranks[i] !== ranks[i - 1] + 1) return false;
  return true;
}

/** 顺子类牌型里出现 2 或王时的统一说法，提示要具体到哪张牌 */
function chainBlocker(ranks: Rank[]): string | null {
  const bad = ranks.filter((r) => !chainable(r));
  if (!bad.length) return null;
  const names = [...new Set(bad)].map(rankLabel).join('、');
  return `${names} 不能用来接顺子（2 和大小王不参与连牌）`;
}

/**
 * 牌型识别主入口。
 *
 * 匹配顺序是有意设计的：先炸弹王炸，再固定张数的小牌型，再"纯"连牌
 * （单顺/双顺/三顺），最后才是飞机带翅膀和四带二。
 * 这样 333444 会被读成三顺而不是"飞机带 1.5 张"，33334444 会被读成
 * 飞机带两单而不是四带两对——和主流斗地主的判法一致。
 */
export function analyzeMove(input: readonly Card[]): MoveAnalysis {
  const cards = sortCards(input);
  const n = cards.length;
  if (n === 0) return fail('还没有选牌');

  const counts = countByRank(cards);
  const ranks = [...counts.keys()].sort((a, b) => a - b);
  const groupSizes = ranks.map((r) => counts.get(r)!);
  const maxCount = Math.max(...groupSizes);

  // 同点数超过 4 张 = 用了两副牌，属于数据错误
  if (maxCount > 4) return fail(`${rankLabel(ranks[groupSizes.indexOf(maxCount)])} 出现了 ${maxCount} 张，一副牌里最多 4 张`);

  // ---- 王炸：唯一可以由两张不同点数组成的"对" ----
  if (n === 2 && counts.get(RANK_JOKER_SMALL) === 1 && counts.get(RANK_JOKER_BIG) === 1) {
    return ok('rocket', cards, RANK_JOKER_BIG);
  }

  // ---- 炸弹 ----
  if (n === 4 && ranks.length === 1) return ok('bomb', cards, ranks[0]);

  // ---- 固定张数的基础牌型 ----
  if (n === 1) return ok('single', cards, ranks[0]);

  if (n === 2) {
    if (ranks.length === 1) return ok('pair', cards, ranks[0]);
    return fail('两张牌只能出对子，大小王一起出才是王炸');
  }

  if (n === 3) {
    if (ranks.length === 1) return ok('triple', cards, ranks[0]);
    return fail('三张牌只能出三张相同的牌');
  }

  if (n === 4) {
    const triple = ranks.find((r) => counts.get(r) === 3);
    if (triple !== undefined) {
      const attach = ranks.filter((r) => r !== triple);
      return ok('triple_single', cards, triple, 1, attach);
    }
    // 不在这里直接报错：3456 和 3344 落到下面的连牌分支才能拿到
    // "顺子至少要 5 张" / "连对至少要 3 对" 这种有用的提示
  }

  if (n === 5) {
    const triple = ranks.find((r) => counts.get(r) === 3);
    const pair = ranks.find((r) => counts.get(r) === 2);
    if (triple !== undefined && pair !== undefined) return ok('triple_pair', cards, triple, 1, [pair]);
    // 五张也可能是顺子，交给下面的连牌分支
  }

  // ---- 纯连牌：单顺 / 双顺 / 三顺 ----
  if (ranks.length >= 2 && groupSizes.every((c) => c === groupSizes[0])) {
    const per = groupSizes[0];
    const len = ranks.length;
    const blocker = chainBlocker(ranks);
    const consecutive = isConsecutive(ranks);
    if (per === 1 && n >= 5) {
      if (blocker) return fail(blocker);
      if (!consecutive) return fail(`顺子要点数连续，${cards.map((c) => c.label).join(' ')} 中间断了`);
      return ok('straight', cards, ranks[len - 1], len);
    }
    if (per === 2 && len >= 3) {
      if (blocker) return fail(blocker);
      if (!consecutive) return fail('连对要求点数连续，比如 33 44 55');
      return ok('double_straight', cards, ranks[len - 1], len);
    }
    if (per === 3 && len >= 2) {
      if (blocker) return fail(blocker);
      if (!consecutive) return fail('飞机要求三张的点数连续，比如 333 444');
      return ok('triple_straight', cards, ranks[len - 1], len);
    }
    // per === 1 且 n < 5：可能是想出顺子但张数不够
    if (per === 1 && n >= 2) {
      if (consecutive && !blocker) return fail(`顺子至少要 5 张，现在只有 ${n} 张`);
    }
    if (per === 2 && len === 2) return fail('连对至少要 3 对，比如 33 44 55');
  }

  // ---- 飞机带翅膀 ----
  const plane = tryPlane(cards, counts, ranks, n);
  if (plane) return plane;

  // ---- 四带二 / 四带两对 ----
  const four = tryFourWithTwo(cards, counts, ranks, n);
  if (four) return four;

  return fail(describeMismatch(counts, ranks, n));
}

/** 找出所有「count>=3 且 <=A」的连续点数段，飞机的主体只能从这里取 */
function tripleRuns(counts: Map<Rank, number>, ranks: Rank[]): Rank[][] {
  const bodyRanks = ranks.filter((r) => counts.get(r)! >= 3 && chainable(r));
  const runs: Rank[][] = [];
  let cur: Rank[] = [];
  for (const r of bodyRanks) {
    if (cur.length && r === cur[cur.length - 1] + 1) cur.push(r);
    else {
      if (cur.length) runs.push(cur);
      cur = [r];
    }
  }
  if (cur.length) runs.push(cur);
  return runs;
}

/**
 * 飞机带单 / 飞机带对。
 *
 * 张数决定组数：4n 张 -> n 组三张 + n 张单；5n 张 -> n 组三张 + n 对。
 * 主体必须是连续的三张段，所以要在每个连续段里滑窗试。
 */
function tryPlane(cards: Card[], counts: Map<Rank, number>, ranks: Rank[], n: number): MoveAnalysis | null {
  const runs = tripleRuns(counts, ranks);
  if (!runs.length) return null;

  for (const wingKind of ['single', 'pair'] as const) {
    const per = wingKind === 'single' ? 4 : 5;
    if (n % per !== 0) continue;
    const groups = n / per;
    if (groups < 2) continue;
    for (const run of runs) {
      if (run.length < groups) continue;
      for (let s = 0; s + groups <= run.length; s++) {
        const body = run.slice(s, s + groups);
        const rest = subtractTriples(counts, body);
        if (!rest) continue;
        const wings = checkWings(rest, groups, wingKind);
        if (!wings) continue;
        const bodyCards = takeCards(cards, body, 3);
        const wingCards = cards.filter((c) => !bodyCards.includes(c));
        return ok(
          wingKind === 'single' ? 'plane_single' : 'plane_pair',
          [...bodyCards, ...wingCards],
          body[body.length - 1],
          groups,
          wings,
        );
      }
    }
  }
  return null;
}

/** 从计数表里扣掉主体的三张，返回剩余计数；不够扣返回 null */
function subtractTriples(counts: Map<Rank, number>, body: Rank[]): Map<Rank, number> | null {
  const rest = new Map(counts);
  for (const r of body) {
    const c = (rest.get(r) ?? 0) - 3;
    if (c < 0) return null;
    if (c === 0) rest.delete(r);
    else rest.set(r, c);
  }
  return rest;
}

/**
 * 翅膀合法性。
 * - 带单：正好 groups 张，允许两张同点数当两个单（主流判法），
 *   但**不能拆炸弹当翅膀**，也不能把王炸当两张单带走。
 * - 带对：正好 groups 个对子，每个对子恰好 2 张。
 */
function checkWings(rest: Map<Rank, number>, groups: number, kind: 'single' | 'pair'): Rank[] | null {
  const total = [...rest.values()].reduce((a, b) => a + b, 0);
  if (kind === 'single') {
    if (total !== groups) return null;
    for (const c of rest.values()) if (c === 4) return null; // 翅膀里藏着炸弹，不许拆
    if (rest.get(RANK_JOKER_SMALL) && rest.get(RANK_JOKER_BIG)) return null; // 不许把王炸当翅膀
    const out: Rank[] = [];
    for (const [r, c] of rest) for (let i = 0; i < c; i++) out.push(r);
    return out.sort((a, b) => a - b);
  }
  if (total !== groups * 2) return null;
  for (const c of rest.values()) if (c !== 2) return null;
  return [...rest.keys()].sort((a, b) => a - b);
}

/** 按点数取牌：每个点数取 per 张（取排序靠前的，保证结果稳定） */
function takeCards(cards: Card[], ranks: Rank[], per: number): Card[] {
  const groups = groupByRank(cards);
  const out: Card[] = [];
  for (const r of ranks) out.push(...(groups.get(r) ?? []).slice(0, per));
  return out;
}

/**
 * 四带二 / 四带两对。
 * 四带两对要求**两个不同点数的对子**——4444+5555 那种按主流判法算飞机带两单，
 * 不算四带两对，所以这里明确排除同点数拆成两对。
 */
function tryFourWithTwo(cards: Card[], counts: Map<Rank, number>, ranks: Rank[], n: number): MoveAnalysis | null {
  const fours = ranks.filter((r) => counts.get(r) === 4);
  if (!fours.length) return null;
  for (const four of fours) {
    const rest = new Map(counts);
    rest.delete(four);
    const total = [...rest.values()].reduce((a, b) => a + b, 0);
    const bodyCards = takeCards(cards, [four], 4);
    const restCards = cards.filter((c) => !bodyCards.includes(c));
    if (n === 6 && total === 2) {
      const attach: Rank[] = [];
      for (const [r, c] of rest) for (let i = 0; i < c; i++) attach.push(r);
      return ok('four_two_singles', [...bodyCards, ...restCards], four, 1, attach.sort((a, b) => a - b));
    }
    if (n === 8 && total === 4) {
      const pairRanks = [...rest.entries()].filter(([, c]) => c === 2).map(([r]) => r);
      if (pairRanks.length === 2) {
        return ok('four_two_pairs', [...bodyCards, ...restCards], four, 1, pairRanks.sort((a, b) => a - b));
      }
    }
  }
  return null;
}

/**
 * 都没匹配上时，给一句**具体**的话。
 * "出牌失败"对玩家毫无帮助，得告诉他差在哪：是张数不够、中间断了，还是根本不成型。
 */
function describeMismatch(counts: Map<Rank, number>, ranks: Rank[], n: number): string {
  const singles = ranks.filter((r) => counts.get(r) === 1);
  // 全单牌：多半是想出顺子
  if (singles.length === ranks.length && ranks.length === n) {
    if (n < 5) return `顺子至少要 5 张连续的牌，现在只有 ${n} 张`;
    const blocker = chainBlocker(ranks);
    if (blocker) return blocker;
    return `这 ${n} 张牌不连续，顺子要像 3 4 5 6 7 这样一张接一张`;
  }
  const pairs = ranks.filter((r) => counts.get(r) === 2);
  if (pairs.length === ranks.length && n >= 4) {
    const blocker = chainBlocker(ranks);
    if (blocker) return blocker;
    if (n === 4) return '连对至少要 3 对，比如 33 44 55';
    return '连对要求点数连续，比如 33 44 55 66';
  }
  const triples = ranks.filter((r) => counts.get(r)! >= 3);
  if (triples.length >= 2) return '飞机要求三张的点数连续，且带的牌张数要对上（n 组三张带 n 张单或 n 对）';
  if (triples.length === 1) {
    return `三带只能带 1 张或 1 对，现在多带了 ${n - 3} 张`;
  }
  if (n === 4) return '四张牌只能出炸弹（四张相同）或三带一';
  return `选中的 ${n} 张牌凑不成任何牌型`;
}

/** 便捷判断：这组牌是不是一手合法的牌 */
export function isValidMove(cards: readonly Card[]): boolean {
  return analyzeMove(cards).isValid;
}

/** 便捷取值：合法就返回 Move，不合法返回 null */
export function toMove(cards: readonly Card[]): Move | null {
  const r = analyzeMove(cards);
  return r.isValid ? r.move : null;
}

export const isBomb = (m: Move) => m.type === 'bomb' || m.type === 'rocket';

/**
 * 比较：challenger 能不能压住 table 上的牌。
 *
 * 规则骨架：
 * - 桌面没牌 -> 任何合法牌型都能出；
 * - 王炸最大，压一切；
 * - 炸弹压所有普通牌型，炸弹之间比点数；
 * - 其余必须**同牌型同长度**，比 mainRank；
 * - 不同的普通牌型之间互不相压（顺子压不了连对，哪怕张数一样）。
 */
export function beats(challenger: Move, table: Move | null): boolean {
  if (!table) return true;
  if (challenger.type === 'rocket') return true;
  if (table.type === 'rocket') return false;
  if (challenger.type === 'bomb') {
    if (table.type === 'bomb') return challenger.mainRank > table.mainRank;
    return true; // 炸弹压普通牌型
  }
  if (table.type === 'bomb') return false;
  if (challenger.type !== table.type) return false;
  if (challenger.length !== table.length) return false;
  return challenger.mainRank > table.mainRank;
}

/** 比较的对外入口：同时做识别和比较，给 UI 用（带具体错误原因） */
export type CompareResult =
  | { ok: true; move: Move }
  | { ok: false; reason: string };

export function compareMoves(selected: readonly Card[], table: Move | null): CompareResult {
  const analysis = analyzeMove(selected);
  if (!analysis.isValid) return { ok: false, reason: analysis.reason };
  const move = analysis.move;
  if (beats(move, table)) return { ok: true, move };
  if (!table) return { ok: true, move };
  const tableName = MOVE_TYPE_NAMES[table.type];
  if (table.type === 'rocket') return { ok: false, reason: '王炸最大，压不住了' };
  if (table.type === 'bomb' && !isBomb(move)) {
    return { ok: false, reason: `上家是炸弹（${rankLabel(table.mainRank)}），只能用更大的炸弹或王炸压` };
  }
  if (move.type !== table.type) {
    return { ok: false, reason: `上家出的是${tableName}，你得出同样的${tableName}（或者炸弹）` };
  }
  if (move.length !== table.length) {
    const unit = table.type === 'double_straight' ? '对' : table.type.startsWith('plane') || table.type === 'triple_straight' ? '组' : '张';
    return { ok: false, reason: `上家的${tableName}是 ${table.length} ${unit}，你出的是 ${move.length} ${unit}，张数要一样` };
  }
  return { ok: false, reason: `没上家大：上家是 ${rankLabel(table.mainRank)}，你出的是 ${rankLabel(move.mainRank)}` };
}

/** 一手牌的文字说明，用于日志/回放/AI 解释 */
export function describeMove(move: Move): string {
  const name = MOVE_TYPE_NAMES[move.type];
  switch (move.type) {
    case 'straight':
      return `${move.length} 张${name}（到 ${rankLabel(move.mainRank)}）`;
    case 'double_straight':
      return `${move.length} 连对（到 ${rankLabel(move.mainRank)}）`;
    case 'triple_straight':
    case 'plane_single':
    case 'plane_pair':
      return `${move.length} 组${name}（到 ${rankLabel(move.mainRank)}）`;
    case 'rocket':
      return '王炸';
    case 'bomb':
      return `${rankLabel(move.mainRank)} 炸弹`;
    default:
      return `${rankLabel(move.mainRank)} ${name}`;
  }
}
