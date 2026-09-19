/**
 * 斗地主牌局状态机。
 *
 * 一条硬规矩：**所有牌局状态都在 GameState 里，而且必须可 JSON 序列化**。
 * UI 只读它、只通过这里的函数改它。做到这一点，保存牌局、回放、复盘、
 * 将来联网和 AI 复算才有可能；否则状态散落在 DOM 和闭包里，什么都做不了。
 *
 * 另一条：每次动作结束都跑一次 assertConsistent()，54 张牌一张不多一张不少。
 * 牌局里"凭空多一张牌"这类 bug 一旦漏过去，会在几十步之后才炸，
 * 到那时根本查不出是哪一步错的，所以必须在出错的当下就拦住。
 */
import {
  cardsName,
  createRng,
  deal,
  removeCards,
  sortCards,
  type Card,
  type Rng,
} from './cards';
import {
  MOVE_TYPE_NAMES,
  analyzeMove,
  beats,
  describeMove,
  isBomb,
  type Move,
} from './patterns';

export type Seat = 0 | 1 | 2;
export type Phase = 'bidding' | 'playing' | 'finished';

export const nextSeat = (s: Seat): Seat => (((s + 1) % 3) as Seat);

/** 规则开关。做成配置是因为斗地主各地打法不同，写死在代码里以后改不动 */
export interface RuleConfig {
  /** 底分 */
  baseScore: number;
  /** 三家都不叫时：重新发牌 / 随机指定地主 / 直接流局 */
  onAllPass: 'redeal' | 'random' | 'draw';
  /** 最多重发几次，防止极端情况下无限重发 */
  maxRedeals: number;
  /** 炸弹（含王炸）是否翻倍 */
  bombDoubles: boolean;
  /** 是否算春天 / 反春 */
  spring: boolean;
}

export const DEFAULT_RULES: RuleConfig = {
  baseScore: 1,
  onAllPass: 'redeal',
  maxRedeals: 3,
  bombDoubles: true,
  spring: true,
};

export interface PlayerState {
  seat: Seat;
  name: string;
  isHuman: boolean;
  hand: Card[];
  /** 这一局叫的分，null = 还没轮到 */
  bid: number | null;
  isLandlord: boolean;
}

export interface TableMove {
  seat: Seat;
  move: Move;
}

/** 一条牌局记录，足够用来完整回放 */
export interface PlayRecord {
  round: number;
  seat: Seat;
  kind: 'bid' | 'play' | 'pass' | 'landlord' | 'redeal';
  bid?: number;
  cards?: Card[];
  moveType?: Move['type'];
  /** 给人看的一句话 */
  text: string;
}

export type SpringKind = 'none' | 'spring' | 'anti-spring';

export interface GameResult {
  winner: 'landlord' | 'farmers';
  /** 先出完牌的人 */
  winnerSeat: Seat;
  landlord: Seat;
  baseScore: number;
  /** 叫分 */
  bidScore: number;
  /** 炸弹和春天累计的倍数 */
  multiplier: number;
  bombCount: number;
  spring: SpringKind;
  /** 三家各自的得分（正负），和为 0 */
  scores: [number, number, number];
  /** 结束时三家剩余张数 */
  remaining: [number, number, number];
}

export interface GameState {
  /** 随机种子：存下它就能一模一样地复现这一局 */
  seed: number;
  config: RuleConfig;
  players: PlayerState[];
  /** 底牌 3 张 */
  bottom: Card[];
  /** 底牌是否已经亮给所有人看（确定地主后亮） */
  bottomRevealed: boolean;
  landlord: Seat | null;
  currentPlayer: Seat;
  /** 桌面上待压的牌；null = 自由出牌 */
  currentMove: TableMove | null;
  /** 最近一次成功出牌（不因为一轮结束而清空），UI 和回放要用 */
  lastValidMove: TableMove | null;
  /** 本轮连续「不要」的人数，到 2 就结束一轮 */
  passCount: number;
  /** 叫分阶段：已经叫过的人次 */
  bidTurns: number;
  /** 当前最高叫分与叫主 */
  highestBid: number;
  highestBidder: Seat | null;
  /** 第一个叫分的人 */
  firstBidder: Seat;
  /** 叫分（地主分），也是底分之上的第一层倍数 */
  bidScore: number;
  /** 炸弹/春天累计倍数 */
  multiplier: number;
  bombCount: number;
  phase: Phase;
  result: GameResult | null;
  history: PlayRecord[];
  /** 已经打出去的牌（所有人），记牌器和一致性校验都要用 */
  discards: Card[];
  /** 每家出过的牌，AI 记牌用 */
  playedBySeat: [Card[], Card[], Card[]];
  /** 每家出牌次数（不含不要），算春天要用 */
  playCounts: [number, number, number];
  round: number;
  redeals: number;
  /**
   * 这一局是不是调试摆出来的。
   * 摆牌局天然不满 54 张（比如只发 3 张测残局），所以一致性校验里
   * "牌总数必须是 54""农民必须 17 张"这两条要跳过；
   * 但**查重复牌、查阶段、查记录对不对得上**照查不误——
   * 调试局同样不许出现假牌。
   */
  debug: boolean;
}

export interface DebugSetup {
  hands?: [string[], string[], string[]] | [Card[], Card[], Card[]];
  bottom?: Card[];
  landlord?: Seat;
  currentPlayer?: Seat;
  phase?: Phase;
}

export interface GameOptions {
  seed?: number;
  names?: [string, string, string];
  /** 真人坐哪个位置，其余是 AI */
  humanSeat?: Seat;
  config?: Partial<RuleConfig>;
  /** 第一个叫分的人，不传则按种子随机 */
  firstBidder?: Seat;
  /** 调试用：直接摆一副指定的牌，只在开发环境使用 */
  debug?: DebugSetup;
}

const DEFAULT_NAMES: [string, string, string] = ['你', '小满', '陈伯'];

/** 开一局新牌局：洗牌、发牌、进入叫分阶段 */
export function createGame(opts: GameOptions = {}): GameState {
  const seed = opts.seed ?? (Math.floor(Math.random() * 0xffffffff) >>> 0);
  const rng = createRng(seed);
  const config = { ...DEFAULT_RULES, ...opts.config };
  const humanSeat = opts.humanSeat ?? 0;
  const names = opts.names ?? DEFAULT_NAMES;

  const dealt = deal(rng);
  const firstBidder = opts.firstBidder ?? ((Math.floor(rng() * 3) as Seat));

  const state: GameState = {
    seed,
    config,
    players: [0, 1, 2].map((i) => ({
      seat: i as Seat,
      name: names[i],
      isHuman: i === humanSeat,
      hand: dealt.hands[i],
      bid: null,
      isLandlord: false,
    })),
    bottom: dealt.bottom,
    bottomRevealed: false,
    landlord: null,
    currentPlayer: firstBidder,
    currentMove: null,
    lastValidMove: null,
    passCount: 0,
    bidTurns: 0,
    highestBid: 0,
    highestBidder: null,
    firstBidder,
    bidScore: 0,
    multiplier: 1,
    bombCount: 0,
    phase: 'bidding',
    result: null,
    history: [],
    discards: [],
    playedBySeat: [[], [], []],
    playCounts: [0, 0, 0],
    round: 1,
    redeals: 0,
    debug: false,
  };

  if (opts.debug) applyDebug(state, opts.debug, rng);
  assertConsistent(state);
  return state;
}

/**
 * 调试摆牌：直接指定手牌/底牌/地主/当前玩家。
 * 只给开发环境用（UI 层用 import.meta.env.DEV 挡住），
 * 但摆完之后照样跑一致性校验——调试局也不许出现假牌。
 */
function applyDebug(state: GameState, debug: DebugSetup, rng: Rng) {
  state.debug = true;
  if (debug.hands) {
    const hands = debug.hands as Card[][];
    for (let i = 0; i < 3; i++) if (hands[i]) state.players[i].hand = sortCards(hands[i]);
  }
  if (debug.bottom) state.bottom = sortCards(debug.bottom);
  if (debug.landlord !== undefined) {
    state.landlord = debug.landlord;
    state.players.forEach((p) => (p.isLandlord = p.seat === debug.landlord));
    state.bidScore = state.bidScore || 3;
    state.highestBid = state.bidScore;
    state.highestBidder = debug.landlord;
    state.bottomRevealed = true;
    state.currentPlayer = debug.landlord;
    // 指定了地主就等于跳过叫分，直接开打
    state.phase = 'playing';
  }
  if (debug.currentPlayer !== undefined) state.currentPlayer = debug.currentPlayer;
  if (debug.phase) state.phase = debug.phase;
  void rng;
}

// ---------------------------------------------------------------- 叫地主

export interface BidOutcome {
  ok: boolean;
  reason?: string;
  /** 这次叫分之后是否定下了地主 */
  settled: boolean;
  /** 三家都不叫，按配置重发/流局 */
  allPassed: boolean;
}

/** 当前这个人可以叫的分：0（不叫）以及所有比当前最高分大的分 */
export function legalBids(state: GameState): number[] {
  if (state.phase !== 'bidding') return [];
  const out = [0];
  for (let v = state.highestBid + 1; v <= 3; v++) out.push(v);
  return out;
}

/** 叫分。value = 0 表示不叫 */
export function placeBid(state: GameState, seat: Seat, value: number): BidOutcome {
  if (state.phase !== 'bidding') return { ok: false, reason: '现在不是叫地主阶段', settled: false, allPassed: false };
  if (state.currentPlayer !== seat) return { ok: false, reason: '还没轮到你叫分', settled: false, allPassed: false };
  if (!legalBids(state).includes(value)) {
    return { ok: false, reason: `只能不叫或者叫比 ${state.highestBid} 分更高的分`, settled: false, allPassed: false };
  }

  state.players[seat].bid = value;
  state.bidTurns++;
  if (value > state.highestBid) {
    state.highestBid = value;
    state.highestBidder = seat;
  }
  state.history.push({
    round: 0,
    seat,
    kind: 'bid',
    bid: value,
    text: value === 0 ? `${state.players[seat].name} 不叫` : `${state.players[seat].name} 叫 ${value} 分`,
  });

  // 叫到 3 分直接封顶，不用再问后面的人
  if (value === 3) {
    settleLandlord(state, seat, 3);
    return { ok: true, settled: true, allPassed: false };
  }

  // 一人一次，三次叫完
  if (state.bidTurns >= 3) {
    if (state.highestBidder !== null) {
      settleLandlord(state, state.highestBidder, state.highestBid);
      return { ok: true, settled: true, allPassed: false };
    }
    return { ok: true, settled: false, allPassed: true };
  }

  state.currentPlayer = nextSeat(seat);
  assertConsistent(state);
  return { ok: true, settled: false, allPassed: false };
}

/** 定地主：把底牌给他，进入出牌阶段，由地主先出 */
function settleLandlord(state: GameState, seat: Seat, bid: number) {
  state.landlord = seat;
  state.bidScore = bid;
  state.players.forEach((p) => (p.isLandlord = p.seat === seat));
  state.players[seat].hand = sortCards([...state.players[seat].hand, ...state.bottom]);
  state.bottomRevealed = true;
  state.currentPlayer = seat;
  state.phase = 'playing';
  state.round = 1;
  state.history.push({
    round: 0,
    seat,
    kind: 'landlord',
    bid,
    cards: [...state.bottom],
    text: `${state.players[seat].name} 以 ${bid} 分成为地主，底牌 ${cardsName(state.bottom)}`,
  });
  assertConsistent(state);
}

/**
 * 三家都不叫的处理。按配置重发 / 随机指定 / 流局。
 * 返回新的 state（重发会换一副牌，所以是新对象）。
 */
export function resolveAllPass(state: GameState, opts: GameOptions = {}): GameState {
  const { onAllPass, maxRedeals } = state.config;
  if (onAllPass === 'redeal' && state.redeals < maxRedeals) {
    const next = createGame({
      ...opts,
      seed: (state.seed * 1664525 + 1013904223) >>> 0,
      config: state.config,
      humanSeat: state.players.findIndex((p) => p.isHuman) as Seat,
      names: state.players.map((p) => p.name) as [string, string, string],
      firstBidder: nextSeat(state.firstBidder),
    });
    next.redeals = state.redeals + 1;
    next.history.push({ round: 0, seat: state.firstBidder, kind: 'redeal', text: '三家都不叫，重新发牌' });
    return next;
  }
  if (onAllPass === 'random') {
    const rng = createRng(state.seed ^ 0x9e3779b9);
    settleLandlord(state, Math.floor(rng() * 3) as Seat, 1);
    return state;
  }
  // 流局：没有地主，直接结束，三家 0 分
  state.phase = 'finished';
  state.result = {
    winner: 'farmers',
    winnerSeat: state.firstBidder,
    landlord: state.firstBidder,
    baseScore: state.config.baseScore,
    bidScore: 0,
    multiplier: 0,
    bombCount: 0,
    spring: 'none',
    scores: [0, 0, 0],
    remaining: state.players.map((p) => p.hand.length) as [number, number, number],
  };
  return state;
}

// ---------------------------------------------------------------- 出牌

export interface PlayOutcome {
  ok: boolean;
  /** 不合法时的**具体**原因，直接拿去给玩家看 */
  reason?: string;
  move?: Move;
  /** 这一手打完之后牌局是否结束 */
  finished: boolean;
  /** 这一手之后是否开了新的一轮（两家都不要） */
  newRound: boolean;
}

/** 当前这个人是不是必须出牌（自由出牌时不能不要） */
export function mustPlay(state: GameState): boolean {
  return state.phase === 'playing' && state.currentMove === null;
}

/** 出牌 */
export function playCards(state: GameState, seat: Seat, cards: readonly Card[]): PlayOutcome {
  if (state.phase !== 'playing') return { ok: false, reason: '现在不是出牌阶段', finished: false, newRound: false };
  if (state.currentPlayer !== seat) return { ok: false, reason: '还没轮到你出牌', finished: false, newRound: false };
  if (!cards.length) return { ok: false, reason: '还没有选牌', finished: false, newRound: false };

  const player = state.players[seat];
  const ids = new Set(player.hand.map((c) => c.id));
  if (!cards.every((c) => ids.has(c.id))) {
    return { ok: false, reason: '出的牌不在手牌里', finished: false, newRound: false };
  }
  if (new Set(cards.map((c) => c.id)).size !== cards.length) {
    return { ok: false, reason: '同一张牌不能出两次', finished: false, newRound: false };
  }

  const analysis = analyzeMove(cards);
  if (!analysis.isValid) return { ok: false, reason: analysis.reason, finished: false, newRound: false };
  const move = analysis.move;

  if (state.currentMove && !beats(move, state.currentMove.move)) {
    const table = state.currentMove.move;
    const tableName = MOVE_TYPE_NAMES[table.type];
    let reason: string;
    if (table.type === 'rocket') reason = '王炸最大，压不住';
    else if (table.type === 'bomb' && !isBomb(move)) reason = `上家是炸弹，只能用更大的炸弹或王炸压`;
    else if (move.type !== table.type) reason = `上家出的是${tableName}，你得出同样的${tableName}（或者炸弹）`;
    else if (move.length !== table.length) reason = `上家的${tableName}有 ${table.length} 组，你出的是 ${move.length} 组，要一样长`;
    else reason = `没上家大，压不住`;
    return { ok: false, reason, finished: false, newRound: false };
  }

  // ---- 真正落子 ----
  player.hand = removeCards(player.hand, move.cards);
  state.discards.push(...move.cards);
  state.playedBySeat[seat].push(...move.cards);
  state.playCounts[seat]++;
  state.currentMove = { seat, move };
  state.lastValidMove = { seat, move };
  state.passCount = 0;
  if (state.config.bombDoubles && isBomb(move)) {
    state.multiplier *= 2;
    state.bombCount++;
  }
  state.history.push({
    round: state.round,
    seat,
    kind: 'play',
    cards: [...move.cards],
    moveType: move.type,
    text: `${player.name} 出 ${describeMove(move)}：${cardsName(move.cards)}`,
  });

  if (player.hand.length === 0) {
    finish(state, seat);
    assertConsistent(state);
    return { ok: true, move, finished: true, newRound: false };
  }

  state.currentPlayer = nextSeat(seat);
  assertConsistent(state);
  return { ok: true, move, finished: false, newRound: false };
}

/** 不要（过） */
export function pass(state: GameState, seat: Seat): PlayOutcome {
  if (state.phase !== 'playing') return { ok: false, reason: '现在不是出牌阶段', finished: false, newRound: false };
  if (state.currentPlayer !== seat) return { ok: false, reason: '还没轮到你', finished: false, newRound: false };
  if (state.currentMove === null) {
    return { ok: false, reason: '现在该你先出牌，不能不要', finished: false, newRound: false };
  }

  state.passCount++;
  state.history.push({ round: state.round, seat, kind: 'pass', text: `${state.players[seat].name} 不要` });

  // 另外两家都不要 -> 这一轮结束，由最后出牌的人重新自由出牌
  if (state.passCount >= 2) {
    const leader = state.currentMove.seat;
    state.currentMove = null;
    state.passCount = 0;
    state.currentPlayer = leader;
    state.round++;
    assertConsistent(state);
    return { ok: true, finished: false, newRound: true };
  }

  state.currentPlayer = nextSeat(seat);
  assertConsistent(state);
  return { ok: true, finished: false, newRound: false };
}

// ---------------------------------------------------------------- 结算

function finish(state: GameState, winnerSeat: Seat) {
  const landlord = state.landlord!;
  const landlordWon = winnerSeat === landlord;
  const farmers = [0, 1, 2].filter((s) => s !== landlord) as Seat[];

  let spring: SpringKind = 'none';
  let multiplier = state.multiplier;
  if (state.config.spring) {
    if (landlordWon && farmers.every((s) => state.playCounts[s] === 0)) {
      spring = 'spring'; // 春天：农民一张牌都没出上
      multiplier *= 2;
    } else if (!landlordWon && state.playCounts[landlord] === 1) {
      spring = 'anti-spring'; // 反春：地主只出了开局那一手
      multiplier *= 2;
    }
  }

  const unit = state.config.baseScore * state.bidScore * multiplier;
  const scores: [number, number, number] = [0, 0, 0];
  scores[landlord] = landlordWon ? 2 * unit : -2 * unit;
  for (const f of farmers) scores[f] = landlordWon ? -unit : unit;

  state.phase = 'finished';
  state.currentMove = null;
  state.result = {
    winner: landlordWon ? 'landlord' : 'farmers',
    winnerSeat,
    landlord,
    baseScore: state.config.baseScore,
    bidScore: state.bidScore,
    multiplier,
    bombCount: state.bombCount,
    spring,
    scores,
    remaining: state.players.map((p) => p.hand.length) as [number, number, number],
  };
  state.history.push({
    round: state.round,
    seat: winnerSeat,
    kind: 'play',
    text: `${state.players[winnerSeat].name} 出完了牌，${landlordWon ? '地主' : '农民'}获胜`,
  });
}

// ---------------------------------------------------------------- 一致性校验

/**
 * 每个动作之后都要跑的自检。
 *
 * 检查的都是"一旦发生就说明代码有 bug"的事：牌总数不是 54、同一张牌出现两次、
 * 当前玩家越界、阶段和地主对不上。发现了就直接抛错——继续打下去只会产生
 * 一局假牌局，还会把错误藏得更深。
 */
export function checkConsistency(state: GameState): string[] {
  const problems: string[] = [];
  const all: Card[] = [
    ...state.players.flatMap((p) => p.hand),
    ...state.discards,
    ...(state.bottomRevealed ? [] : state.bottom),
  ];
  if (!state.debug && all.length !== 54) problems.push(`牌总数是 ${all.length}，应该是 54`);

  const seen = new Set<string>();
  for (const c of all) {
    if (seen.has(c.id)) problems.push(`牌 ${c.id} 出现了不止一次`);
    seen.add(c.id);
  }

  if (state.currentPlayer < 0 || state.currentPlayer > 2) problems.push(`当前玩家 ${state.currentPlayer} 越界`);
  if (state.phase === 'playing' && state.landlord === null) problems.push('已进入出牌阶段却没有地主');
  if (state.phase === 'bidding' && state.landlord !== null) problems.push('还在叫分阶段却已经有地主');
  if (state.landlord !== null) {
    const lord = state.players.filter((p) => p.isLandlord);
    if (lord.length !== 1) problems.push(`地主标记有 ${lord.length} 个`);
    // 地主手牌 + 已出 = 20，农民 = 17
    if (!state.debug) {
      for (const p of state.players) {
        const total = p.hand.length + state.playedBySeat[p.seat].length;
        const expect = p.isLandlord ? 20 : 17;
        if (total !== expect) problems.push(`${p.name} 的牌数是 ${total}，应该是 ${expect}`);
      }
    }
  } else if (!state.debug) {
    for (const p of state.players) {
      if (p.hand.length !== 17) problems.push(`${p.name} 叫分阶段手牌 ${p.hand.length} 张，应该是 17 张`);
    }
  }
  if (state.bottom.length !== 3) problems.push(`底牌 ${state.bottom.length} 张，应该是 3 张`);
  if (state.passCount < 0 || state.passCount > 2) problems.push(`passCount = ${state.passCount} 不合理`);
  if (state.currentMove === null && state.passCount !== 0 && state.phase === 'playing') {
    problems.push('桌面没有牌时 passCount 应该是 0');
  }
  if (state.phase === 'finished' && !state.result) problems.push('牌局结束了却没有结算结果');

  const discardIds = new Set(state.discards.map((c) => c.id));
  const bySeat = state.playedBySeat.flat();
  if (bySeat.length !== state.discards.length) problems.push('分座位记录的出牌数和总出牌数对不上');
  for (const c of bySeat) if (!discardIds.has(c.id)) problems.push(`${c.id} 记在某家名下却不在弃牌堆里`);

  return problems;
}

/** 开发期的硬断言：发现状态异常立刻抛错，不让错误牌局继续 */
export function assertConsistent(state: GameState): void {
  const problems = checkConsistency(state);
  if (problems.length) {
    throw new Error(`牌局状态异常：\n- ${problems.join('\n- ')}`);
  }
}

// ---------------------------------------------------------------- 序列化

/** 存档/回放用：GameState 本身就是纯数据，直接 JSON 即可 */
export function serialize(state: GameState): string {
  return JSON.stringify(state);
}

export function deserialize(json: string): GameState {
  const state = JSON.parse(json) as GameState;
  assertConsistent(state);
  return state;
}

/** 深拷贝，AI 试算和回放用 */
export function cloneState(state: GameState): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

/** 给 UI 的便捷读取 */
export const landlordSeat = (s: GameState) => s.landlord;
export const isFarmer = (s: GameState, seat: Seat) => s.landlord !== null && s.landlord !== seat;
export const teammatesOf = (s: GameState, seat: Seat): Seat[] =>
  s.landlord === null || s.landlord === seat ? [] : ([0, 1, 2] as Seat[]).filter((x) => x !== seat && x !== s.landlord);
/** 当前总倍数（叫分 × 炸弹/春天） */
export const totalMultiplier = (s: GameState) => s.bidScore * s.multiplier;
