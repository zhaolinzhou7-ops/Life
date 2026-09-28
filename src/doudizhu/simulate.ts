/**
 * 自动模拟：三个 AI 打完整一局，用来做批量验收。
 *
 * 这不是"跑通就行"的冒烟脚本，而是**当裁判用的**：每一步都独立复核一遍
 * AI 出的牌合不合法、是不是真的在它手上、有没有凭空多牌，
 * 而不是信任 game.ts 自己的校验。规则引擎和裁判互相独立，才查得出问题。
 */
import { cardsName, type Card } from './cards';
import {
  checkConsistency,
  createGame,
  legalBids,
  pass,
  placeBid,
  playCards,
  resolveAllPass,
  type GameOptions,
  type PlayRecord,
  type Seat,
} from './game';
import { analyzeMove, beats } from './patterns';
import { decideBid, decidePlay, publicViewFor, type Difficulty } from './ai';

export interface SimOptions {
  seed?: number;
  /** 三家各自的难度 */
  difficulties?: [Difficulty, Difficulty, Difficulty];
  config?: GameOptions['config'];
  /** 保留完整出牌记录（批量跑时可以关掉省内存） */
  keepHistory?: boolean;
}

export interface SimResult {
  seed: number;
  ok: boolean;
  /** 发现的问题，空数组表示这局完全正常 */
  problems: string[];
  landlord: Seat;
  bidScore: number;
  winner: 'landlord' | 'farmers';
  winnerSeat: Seat;
  rounds: number;
  /** 出牌次数（不含不要） */
  plays: number;
  passes: number;
  bombs: number;
  multiplier: number;
  scores: [number, number, number];
  spring: string;
  redeals: number;
  history?: PlayRecord[];
}

/** 一局的步数上限。正常一局不会超过 100 步，超了就是卡住了，必须报出来 */
const MAX_STEPS = 400;

export function simulateGame(opts: SimOptions = {}): SimResult {
  const seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const difficulties: [Difficulty, Difficulty, Difficulty] = opts.difficulties ?? ['hard', 'hard', 'hard'];
  const problems: string[] = [];
  const note = (s: string) => problems.push(s);

  let state = createGame({ seed, config: opts.config, humanSeat: 0 });
  // 模拟里没有真人，三家都由 AI 打
  state.players.forEach((p) => (p.isHuman = false));

  // ---- 叫地主 ----
  let bidSteps = 0;
  while (state.phase === 'bidding') {
    if (bidSteps++ > 40) {
      note('叫分阶段没有收敛，可能死循环');
      break;
    }
    const seat = state.currentPlayer;
    const legal = legalBids(state);
    const want = decideBid(state.players[seat].hand, state.highestBid, difficulties[seat]);
    const value = legal.includes(want) ? want : 0;
    const r = placeBid(state, seat, value);
    if (!r.ok) {
      note(`叫分被拒绝：${r.reason}`);
      break;
    }
    if (r.allPassed) {
      const before = state.redeals;
      state = resolveAllPass(state, { humanSeat: 0 });
      state.players.forEach((p) => (p.isHuman = false));
      if (state.phase === 'finished') break; // 流局
      if (state.redeals === before && state.phase === 'bidding') {
        note('三家都不叫之后没有推进');
        break;
      }
    }
  }

  if (state.phase === 'finished' && state.landlord === null) {
    // 流局，按配置是允许的
  }

  // ---- 出牌 ----
  let steps = 0;
  let plays = 0;
  let passes = 0;
  const seenIds = new Set<string>();

  while (state.phase === 'playing') {
    if (steps++ > MAX_STEPS) {
      note(`出牌超过 ${MAX_STEPS} 步还没结束，AI 可能卡死`);
      break;
    }
    const seat = state.currentPlayer;
    const before = state.players[seat].hand.length;
    const handIds = new Set(state.players[seat].hand.map((c) => c.id));
    const view = publicViewFor(state, seat);

    // 裁判独立检查 1：视角里不能含有别人的手牌
    if (Object.prototype.hasOwnProperty.call(view, 'players')) note('PublicView 里混进了完整牌局状态');

    const decision = decidePlay(view, difficulties[seat]);

    if (decision.action === 'pass') {
      if (state.currentMove === null) {
        note(`${state.players[seat].name} 在必须出牌时选择了不要`);
        break;
      }
      const r = pass(state, seat);
      if (!r.ok) {
        note(`不要被拒绝：${r.reason}`);
        break;
      }
      passes++;
      continue;
    }

    // ---- 裁判独立复核这手牌 ----
    const cards = decision.cards;
    if (!cards.length) {
      note(`${state.players[seat].name} 出了 0 张牌`);
      break;
    }
    if (new Set(cards.map((c) => c.id)).size !== cards.length) {
      note(`${state.players[seat].name} 同一张牌出了两次：${cardsName(cards)}`);
      break;
    }
    const notMine = cards.filter((c) => !handIds.has(c.id));
    if (notMine.length) {
      note(`${state.players[seat].name} 出了不在手里的牌：${cardsName(notMine)}（凭空产生）`);
      break;
    }
    const analysis = analyzeMove(cards);
    if (!analysis.isValid) {
      note(`${state.players[seat].name} 出了非法牌型 ${cardsName(cards)}：${analysis.reason}`);
      break;
    }
    if (state.currentMove && !beats(analysis.move, state.currentMove.move)) {
      note(`${state.players[seat].name} 出的 ${cardsName(cards)} 压不住桌面上的牌`);
      break;
    }

    const r = playCards(state, seat, cards);
    if (!r.ok) {
      note(`出牌被引擎拒绝：${r.reason}（${cardsName(cards)}）`);
      break;
    }
    plays++;

    // 裁判独立检查 2：手牌张数必须正好减少这么多
    const after = state.players[seat].hand.length;
    if (after !== before - cards.length) {
      note(`${state.players[seat].name} 出了 ${cards.length} 张，手牌却从 ${before} 变成 ${after}`);
      break;
    }
    // 裁判独立检查 3：同一张牌不能被打出两次
    for (const c of cards) {
      if (seenIds.has(c.id)) note(`牌 ${c.id} 被打出了两次`);
      seenIds.add(c.id);
    }

    const bad = checkConsistency(state);
    if (bad.length) {
      note(`状态校验失败：${bad.join('；')}`);
      break;
    }
  }

  // ---- 收尾核对 ----
  if (state.phase !== 'finished') note(`牌局结束时阶段是 ${state.phase}，应该是 finished`);
  if (state.phase === 'finished' && !state.result) note('结束了却没有结算结果');

  const result = state.result;
  if (result && result.landlord !== undefined && state.landlord !== null) {
    const sum = result.scores.reduce((a, b) => a + b, 0);
    if (sum !== 0) note(`结算分数之和是 ${sum}，应该是 0`);
    const winnerHand = state.players[result.winnerSeat].hand.length;
    if (winnerHand !== 0) note(`赢家手里还有 ${winnerHand} 张牌`);
  }

  const total =
    state.players.reduce((a, p) => a + p.hand.length, 0) + state.discards.length + (state.bottomRevealed ? 0 : 3);
  if (total !== 54) note(`收尾时牌总数是 ${total}，应该是 54`);

  return {
    seed,
    ok: problems.length === 0,
    problems,
    landlord: state.landlord ?? 0,
    bidScore: state.bidScore,
    winner: result?.winner ?? 'farmers',
    winnerSeat: result?.winnerSeat ?? 0,
    rounds: state.round,
    plays,
    passes,
    bombs: state.bombCount,
    multiplier: result?.multiplier ?? state.multiplier,
    scores: result?.scores ?? [0, 0, 0],
    spring: result?.spring ?? 'none',
    redeals: state.redeals,
    history: opts.keepHistory ? state.history : undefined,
  };
}

export interface BatchReport {
  games: number;
  failures: SimResult[];
  landlordWins: number;
  farmerWins: number;
  avgRounds: number;
  avgPlays: number;
  totalBombs: number;
  springs: number;
  redeals: number;
  maxRounds: number;
}

/** 批量模拟，验收用 */
export function simulateMany(count: number, opts: SimOptions = {}): BatchReport {
  const failures: SimResult[] = [];
  let landlordWins = 0;
  let rounds = 0;
  let plays = 0;
  let bombs = 0;
  let springs = 0;
  let redeals = 0;
  let maxRounds = 0;
  const baseSeed = opts.seed ?? 20260918;

  for (let i = 0; i < count; i++) {
    const r = simulateGame({ ...opts, seed: (baseSeed + i * 7919) >>> 0 });
    if (!r.ok) failures.push(r);
    if (r.winner === 'landlord') landlordWins++;
    rounds += r.rounds;
    plays += r.plays;
    bombs += r.bombs;
    if (r.spring !== 'none') springs++;
    redeals += r.redeals;
    maxRounds = Math.max(maxRounds, r.rounds);
  }

  return {
    games: count,
    failures,
    landlordWins,
    farmerWins: count - landlordWins,
    avgRounds: rounds / count,
    avgPlays: plays / count,
    totalBombs: bombs,
    springs,
    redeals,
    maxRounds,
  };
}

/** 把一局牌完整打印出来，排查用 */
export function replayText(history: PlayRecord[]): string {
  return history.map((h) => `[第${h.round}轮] ${h.text}`).join('\n');
}

export type { Card };
