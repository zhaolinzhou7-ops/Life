/**
 * AI 第二步：候选出牌生成 + 合法性过滤。
 *
 * 生成的每一手都**保证合法**：所有牌都在手上，牌型经过 analyzeMove 复核，
 * 桌面有牌时一定压得住。AI 出非法牌是最难查的一类 bug——界面上只表现为
 * "轮到 AI 就卡住了"，所以这里宁可多做一次复核。
 *
 * 带牌（三带、飞机翅膀、四带二）不穷举所有组合，而是按"拆得最不心疼"挑一套：
 * 散牌最便宜，拆对子贵，拆三张更贵，拆炸弹和王基本不干。
 * 穷举翅膀会让候选数量爆炸到几千个，AI 会明显卡顿，收益却很小。
 */
import {
  MAX_CHAIN_RANK,
  RANK_2,
  RANK_3,
  RANK_JOKER_BIG,
  RANK_JOKER_SMALL,
  sortCards,
  type Card,
  type Rank,
} from '../cards';
import { analyzeMove, type Move, type MoveType } from '../patterns';
import { toCounts, type RankCounts } from './analysis';

/** 把一组「点数 -> 张数」的需求兑换成手牌里的具体牌 */
function take(byRank: Map<Rank, Card[]>, rank: Rank, n: number, used: Set<string>): Card[] | null {
  const list = (byRank.get(rank) ?? []).filter((c) => !used.has(c.id));
  if (list.length < n) return null;
  const picked = list.slice(0, n);
  for (const c of picked) used.add(c.id);
  return picked;
}

function groupHand(hand: readonly Card[]): Map<Rank, Card[]> {
  const m = new Map<Rank, Card[]>();
  for (const c of hand) {
    const l = m.get(c.rank);
    if (l) l.push(c);
    else m.set(c.rank, [c]);
  }
  return m;
}

/**
 * 拆一张牌出去的「心疼程度」。数字越小越舍得出。
 * 这是 AI 牌感的一部分：同样是带一张，带散 3 和带一张 2 完全是两回事。
 */
function breakCost(rank: Rank, leftover: number): number {
  let cost = rank; // 点数越大越舍不得
  if (leftover === 2) cost += 24; // 拆对子
  else if (leftover === 3) cost += 48; // 拆三张
  else if (leftover >= 4) cost += 400; // 拆炸弹，基本不干
  if (rank === RANK_2) cost += 26;
  if (rank === RANK_JOKER_SMALL) cost += 70;
  if (rank === RANK_JOKER_BIG) cost += 90;
  return cost;
}

/** 从剩余牌里挑 n 张最舍得出的单牌当翅膀 */
function pickSingleWings(rest: RankCounts, n: number): Rank[] | null {
  const pool: { rank: Rank; cost: number }[] = [];
  for (let r = RANK_3; r <= RANK_JOKER_BIG; r++) {
    if (!rest[r]) continue;
    // 炸弹不拆来当翅膀（规则上也不允许）
    if (rest[r] >= 4) continue;
    for (let i = 0; i < rest[r]; i++) pool.push({ rank: r, cost: breakCost(r, rest[r]) + i * 6 });
  }
  if (pool.length < n) return null;
  pool.sort((a, b) => a.cost - b.cost);
  const chosen = pool.slice(0, n).map((p) => p.rank);
  // 翅膀不能正好是王炸（规则不允许）
  if (n === 2 && chosen.includes(RANK_JOKER_SMALL) && chosen.includes(RANK_JOKER_BIG)) {
    if (pool.length <= 2) return null;
    return [pool[0].rank, pool[2].rank];
  }
  return chosen;
}

/** 从剩余牌里挑 n 个最舍得出的对子当翅膀 */
function pickPairWings(rest: RankCounts, n: number): Rank[] | null {
  const pool: { rank: Rank; cost: number }[] = [];
  for (let r = RANK_3; r <= RANK_2; r++) {
    if (rest[r] !== 2 && rest[r] !== 3) continue; // 恰好一对，或从三张里拆一对
    pool.push({ rank: r, cost: breakCost(r, rest[r]) + (rest[r] === 3 ? 30 : 0) });
  }
  if (pool.length < n) return null;
  pool.sort((a, b) => a.cost - b.cost);
  return pool.slice(0, n).map((p) => p.rank);
}

/** 构造一手牌：主体 + 翅膀，最后用 analyzeMove 复核一遍 */
function build(hand: readonly Card[], body: [Rank, number][], wings: [Rank, number][]): Move | null {
  const byRank = groupHand(hand);
  const used = new Set<string>();
  const cards: Card[] = [];
  for (const [rank, n] of [...body, ...wings]) {
    const got = take(byRank, rank, n, used);
    if (!got) return null;
    cards.push(...got);
  }
  const r = analyzeMove(cards);
  return r.isValid ? r.move : null;
}

/** 剩余计数：扣掉主体之后手上还有什么 */
function leftoverCounts(counts: RankCounts, body: [Rank, number][]): RankCounts {
  const rest = counts.slice();
  for (const [r, n] of body) rest[r] -= n;
  return rest;
}

interface GenOptions {
  /** 只生成能压住这手牌的候选 */
  table?: Move | null;
  /** 是否生成炸弹/王炸（残局里有时要留着） */
  allowBombs?: boolean;
  /** 是否生成四带二（拆炸弹的打法，主动出牌时一般不考虑） */
  allowFourWithTwo?: boolean;
}

/**
 * 候选生成主入口。
 * table 为空 = 自由出牌，生成所有牌型；否则只生成压得住的。
 */
export function generateCandidates(hand: readonly Card[], opts: GenOptions = {}): Move[] {
  const table = opts.table ?? null;
  const allowBombs = opts.allowBombs ?? true;
  const counts = toCounts(hand);
  const out: Move[] = [];
  const seen = new Set<string>();

  const push = (m: Move | null) => {
    if (!m) return;
    const key = m.cards.map((c) => c.id).sort().join(',');
    if (seen.has(key)) return;
    seen.add(key);
    out.push(m);
  };

  const wantType = table?.type ?? null;
  const wantLen = table?.length ?? 0;
  const minRank = table ? table.mainRank : -1;
  /** 跟牌时只生成同型同长；自由出牌时该类型是否要生成 */
  const need = (t: MoveType, len = 1) => (wantType === null ? true : wantType === t && wantLen === len);

  // ---- 单牌 / 对子 / 三张 ----
  for (let r = RANK_3; r <= RANK_JOKER_BIG; r++) {
    if (!counts[r]) continue;
    if (need('single') && r > minRankFor('single', table, minRank)) push(build(hand, [[r, 1]], []));
    if (counts[r] >= 2 && r <= RANK_2 && need('pair') && r > minRankFor('pair', table, minRank)) {
      push(build(hand, [[r, 2]], []));
    }
    if (counts[r] >= 3 && r <= RANK_2) {
      if (need('triple') && r > minRankFor('triple', table, minRank)) push(build(hand, [[r, 3]], []));
      // 三带一 / 三带二
      if (need('triple_single') && r > minRankFor('triple_single', table, minRank)) {
        const rest = leftoverCounts(counts, [[r, 3]]);
        const w = pickSingleWings(rest, 1);
        if (w) push(build(hand, [[r, 3]], [[w[0], 1]]));
      }
      if (need('triple_pair') && r > minRankFor('triple_pair', table, minRank)) {
        const rest = leftoverCounts(counts, [[r, 3]]);
        const w = pickPairWings(rest, 1);
        if (w) push(build(hand, [[r, 3]], [[w[0], 2]]));
      }
    }
  }

  // ---- 顺子 / 连对 / 三顺 ----
  const chainSpecs = [
    { per: 1 as const, type: 'straight' as MoveType, min: 5 },
    { per: 2 as const, type: 'double_straight' as MoveType, min: 3 },
    { per: 3 as const, type: 'triple_straight' as MoveType, min: 2 },
  ];
  for (const spec of chainSpecs) {
    for (let from = RANK_3; from <= MAX_CHAIN_RANK; from++) {
      if (counts[from] < spec.per) continue;
      for (let to = from + spec.min - 1; to <= MAX_CHAIN_RANK; to++) {
        let okRun = true;
        for (let r = from; r <= to; r++) if (counts[r] < spec.per) { okRun = false; break; }
        if (!okRun) break;
        const len = to - from + 1;
        if (!need(spec.type, len)) continue;
        if (table && to <= minRank) continue;
        const body: [Rank, number][] = [];
        for (let r = from; r <= to; r++) body.push([r, spec.per]);
        push(build(hand, body, []));
      }
    }
  }

  // ---- 飞机带翅膀 ----
  for (const kind of ['single', 'pair'] as const) {
    const type: MoveType = kind === 'single' ? 'plane_single' : 'plane_pair';
    for (let from = RANK_3; from <= MAX_CHAIN_RANK; from++) {
      if (counts[from] < 3) continue;
      for (let to = from + 1; to <= MAX_CHAIN_RANK; to++) {
        let okRun = true;
        for (let r = from; r <= to; r++) if (counts[r] < 3) { okRun = false; break; }
        if (!okRun) break;
        const groups = to - from + 1;
        if (!need(type, groups)) continue;
        if (table && to <= minRank) continue;
        const body: [Rank, number][] = [];
        for (let r = from; r <= to; r++) body.push([r, 3]);
        const rest = leftoverCounts(counts, body);
        const wings = kind === 'single' ? pickSingleWings(rest, groups) : pickPairWings(rest, groups);
        if (!wings) continue;
        const wingSpec: [Rank, number][] = wings.map((r) => [r, kind === 'single' ? 1 : 2]);
        push(build(hand, body, wingSpec));
      }
    }
  }

  // ---- 四带二 / 四带两对 ----
  // 主动出牌时默认不生成：拆掉炸弹去带两张散牌，绝大多数时候是亏的。
  const wantFour = opts.allowFourWithTwo ?? (table !== null && (wantType === 'four_two_singles' || wantType === 'four_two_pairs'));
  if (wantFour) {
    for (let r = RANK_3; r <= RANK_2; r++) {
      if (counts[r] !== 4) continue;
      const body: [Rank, number][] = [[r, 4]];
      const rest = leftoverCounts(counts, body);
      if (need('four_two_singles') && r > minRankFor('four_two_singles', table, minRank)) {
        const w = pickSingleWings(rest, 2);
        if (w) push(build(hand, body, w.map((x) => [x, 1] as [Rank, number])));
      }
      if (need('four_two_pairs') && r > minRankFor('four_two_pairs', table, minRank)) {
        const w = pickPairWings(rest, 2);
        if (w && w[0] !== w[1]) push(build(hand, body, w.map((x) => [x, 2] as [Rank, number])));
      }
    }
  }

  // ---- 炸弹 / 王炸：可以压任何普通牌型 ----
  if (allowBombs) {
    for (let r = RANK_3; r <= RANK_2; r++) {
      if (counts[r] !== 4) continue;
      if (table && table.type === 'bomb' && r <= table.mainRank) continue;
      if (table && table.type === 'rocket') continue;
      push(build(hand, [[r, 4]], []));
    }
    if (counts[RANK_JOKER_SMALL] && counts[RANK_JOKER_BIG]) {
      push(build(hand, [[RANK_JOKER_SMALL, 1], [RANK_JOKER_BIG, 1]], []));
    }
  }

  return out;
}

/** 跟牌时的点数下限；自由出牌时没有下限 */
function minRankFor(type: MoveType, table: Move | null, minRank: number): number {
  if (!table) return -1;
  return table.type === type ? minRank : -1;
}

/** 只留下真正压得住桌面的候选（双保险，防止生成逻辑有疏漏） */
export function filterLegal(moves: Move[], hand: readonly Card[], table: Move | null): Move[] {
  const ids = new Set(hand.map((c) => c.id));
  return moves.filter((m) => {
    if (!m.cards.every((c) => ids.has(c.id))) return false;
    if (new Set(m.cards.map((c) => c.id)).size !== m.cards.length) return false;
    const re = analyzeMove(m.cards);
    if (!re.isValid) return false;
    if (!table) return true;
    if (m.type === 'rocket') return true;
    if (m.type === 'bomb') return table.type === 'bomb' ? m.mainRank > table.mainRank : table.type !== 'rocket';
    if (table.type === 'bomb' || table.type === 'rocket') return false;
    return m.type === table.type && m.length === table.length && m.mainRank > table.mainRank;
  });
}

/** 给 UI 的「提示」：找一手能压住桌面的牌（挑最省的） */
export function hintMove(hand: readonly Card[], table: Move | null): Card[] | null {
  const moves = filterLegal(generateCandidates(hand, { table }), hand, table);
  if (!moves.length) return null;
  moves.sort((a, b) => {
    // 先不动炸弹，再挑张数少、点数小的
    const bombA = a.type === 'bomb' || a.type === 'rocket' ? 1 : 0;
    const bombB = b.type === 'bomb' || b.type === 'rocket' ? 1 : 0;
    if (bombA !== bombB) return bombA - bombB;
    if (a.cards.length !== b.cards.length) return a.cards.length - b.cards.length;
    return a.mainRank - b.mainRank;
  });
  return sortCards(moves[0].cards);
}
