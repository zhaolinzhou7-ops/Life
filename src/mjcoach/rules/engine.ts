/**
 * 麻将规则引擎（Mahjong Rule Engine）。
 *
 * 这是全系统唯一的裁判。发牌、摸牌、出牌、碰、杠、胡、定缺、换三张、血战、
 * 剩余牌、合法动作、牌型、番型、计分——只有它说了算。
 * AI 和教学层都只能「问」它，不能自己判断（AI 语言模型更不行）。
 *
 * 两条设计约束，别的地方都跟着它们走：
 *
 * 1. **完全确定性**。洗牌用种子，引擎内部一次 Math.random 都没有。
 *    给同一个种子 + 同一串动作，重放出来的牌局逐张一致——复盘才可信。
 * 2. **动作驱动**。引擎不主动等人，它只回答「现在轮到谁、他能做什么」（pending），
 *    外面（真人 UI / AI / 测试 / 回放）把 Action 喂进来。
 *    同一套引擎因此能被界面、AI 对战、自动化测试共用，不存在两套流程对不上的问题。
 */

import {
  Rng,
  countTotal,
  emptyCounts,
  hasSuit,
  suitOf,
  toCounts,
  type Counts,
  type Meld,
  type Suit,
  type TileId,
} from './tiles';
import type { RuleConfig, SwapDir } from './config';
import { bestTingFan, evaluateWin, waitingTiles, type WinScore } from './win';
import { settleDraw, type SettleRow } from './settle';

// ==================== 阶段 ====================

/** 一局牌的阶段。每个阶段有自己的合法动作集合 */
export type Phase =
  | 'init' // 未开始
  | 'swap' // 换三张
  | 'lack' // 定缺
  | 'turn' // 轮到某家行牌（已摸牌，等他出牌/杠/胡）
  | 'claim' // 别人打出牌后，等其他家响应（碰/杠/胡/过）
  | 'over'; // 结束

export const PHASE_NAME: Record<Phase, string> = {
  init: '准备',
  swap: '换三张',
  lack: '定缺',
  turn: '行牌',
  claim: '响应',
  over: '结算',
};

// ==================== 动作 ====================

export type Action =
  | { type: 'swap'; seat: number; tiles: TileId[] }
  | { type: 'lack'; seat: number; suit: Suit }
  | { type: 'discard'; seat: number; tile: TileId }
  | { type: 'peng'; seat: number; tile: TileId }
  | { type: 'gang'; seat: number; tile: TileId; kind: 'gang' | 'angang' | 'bugang' }
  | { type: 'hu'; seat: number; tile: TileId }
  | { type: 'pass'; seat: number };

export type ActionType = Action['type'];

/** 待决策：引擎停下来等谁、等什么 */
export interface Pending {
  seat: number;
  /** turn=自己回合（出牌/杠/自摸）；claim=响应别人的牌；swap/lack=开局两步 */
  kind: 'turn' | 'claim' | 'swap' | 'lack';
  options: Action[];
  /** claim 时是在响应哪张牌、谁打的 */
  tile?: TileId;
  from?: number;
}

// ==================== 状态 ====================

export interface WinRecord {
  tile: TileId;
  zimo: boolean;
  /** 点炮者，自摸为 -1 */
  payer: number;
  score: WinScore;
  /** 第几手牌时胡的 */
  turnIndex: number;
}

export interface PlayerState {
  seat: number;
  hand: Counts;
  melds: Meld[];
  discards: TileId[];
  /** 缺门，-1 = 未定 */
  lack: number;
  swapOut: TileId[];
  swapIn: TileId[];
  won: boolean;
  winCount: number;
  wins: WinRecord[];
  score: number;
  /** 收到的杠分，呼叫转移要用 */
  gangGains: { from: number; amount: number }[];
  /** 过水锁：放弃过的牌（cfg.win.passLock 打开才生效） */
  passed: TileId[];
  /** 血战到底里胡完下桌 */
  outOfPlay: boolean;
}

export interface GameEvent {
  type:
    | 'deal' | 'swap' | 'lack' | 'draw' | 'discard' | 'peng' | 'gang'
    | 'hu' | 'pass' | 'drawGame' | 'over';
  seat?: number;
  tile?: TileId;
  text?: string;
  data?: Record<string, unknown>;
}

export interface GameResult {
  /** 每家最终得分 */
  scores: number[];
  /** 流局结算明细（查大叔/查花猪） */
  drawRows: SettleRow[];
  winners: number[];
  /** 是否摸完牌墙流局 */
  exhausted: boolean;
}

export interface EngineOptions {
  config: RuleConfig;
  seed: number;
  /** 庄家座位 */
  dealer?: number;
  players?: number;
}

export class MahjongEngine {
  readonly cfg: RuleConfig;
  readonly seed: number;
  readonly players: PlayerState[];
  phase: Phase = 'init';
  wall: TileId[] = [];
  dealer: number;
  /** 当前行牌座位 */
  turn: number;
  /** 本局第几手（用于定位关键决策） */
  turnIndex = 0;
  /** 刚打出的牌 */
  lastDiscard: { seat: number; tile: TileId } | null = null;
  /** 刚摸进来的那张（turn 阶段展示用） */
  drawnTile: TileId | null = null;
  /** 换三张方向 */
  swapDir: SwapDir | null = null;
  result: GameResult | null = null;
  /** 完整动作日志：种子 + 这个日志 = 可以逐张重放本局 */
  readonly log: Action[] = [];
  readonly events: GameEvent[] = [];

  private rng: Rng;
  /** 待处理的响应队列（碰杠胡按优先级排好） */
  private claims: { seat: number; options: Action[]; priority: number }[] = [];
  private pendingSwaps: TileId[][] = [];
  /** 上一步是不是杠（决定杠上花/杠上炮） */
  private afterGang = false;
  private gangDiscardPending = false;
  /** 抢杠胡：正在补杠的那张 */
  private robbing: { seat: number; tile: TileId } | null = null;
  private robSucceeded = false;
  private listeners: ((e: GameEvent) => void)[] = [];

  constructor(opts: EngineOptions) {
    this.cfg = opts.config;
    this.seed = opts.seed;
    this.rng = new Rng(opts.seed);
    this.dealer = opts.dealer ?? 0;
    this.turn = this.dealer;
    const n = opts.players ?? 4;
    this.players = Array.from({ length: n }, (_, seat) => ({
      seat,
      hand: emptyCounts(),
      melds: [],
      discards: [],
      lack: -1,
      swapOut: [],
      swapIn: [],
      won: false,
      winCount: 0,
      wins: [],
      score: 0,
      gangGains: [],
      passed: [],
      outOfPlay: false,
    }));
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: GameEvent) {
    this.events.push(e);
    for (const fn of this.listeners) fn(e);
  }

  // ==================== 开局 ====================

  start() {
    const { suits, copies, handSize } = this.cfg.tiles;
    const wall: TileId[] = [];
    for (const s of suits) for (let r = 0; r < 9; r++) for (let i = 0; i < copies; i++) wall.push(s * 9 + r);
    this.wall = this.rng.shuffle(wall);
    for (let i = 0; i < handSize; i++) {
      for (let k = 0; k < this.players.length; k++) {
        const seat = (this.dealer + k) % this.players.length;
        this.players[seat].hand[this.drawTail()]++;
      }
    }
    this.emit({ type: 'deal', text: `发牌完毕，牌墙剩 ${this.wall.length} 张` });
    this.pendingSwaps = this.players.map(() => []);
    if (this.cfg.swap.enabled) {
      this.phase = 'swap';
    } else if (this.cfg.lack.enabled) {
      this.phase = 'lack';
    } else {
      this.beginTurn(this.dealer);
    }
  }

  private drawTail(): TileId {
    return this.wall.pop()!;
  }

  /** 杠后补牌从牌墙另一头拿，跟真人从海底摸一张是一个意思 */
  private drawHead(): TileId {
    return this.wall.shift()!;
  }

  /** 牌墙还剩多少可摸 */
  get wallLeft(): number {
    return Math.max(0, this.wall.length - this.cfg.draw.reserve);
  }

  // ==================== 合法动作 ====================

  /** 引擎现在等谁做什么。null = 不需要人决策（已结束） */
  pending(): Pending | null {
    if (this.phase === 'over') return null;
    if (this.phase === 'swap') {
      const seat = this.pendingSwaps.findIndex((s) => s.length === 0);
      if (seat < 0) return null;
      return { seat, kind: 'swap', options: this.swapOptions(seat) };
    }
    if (this.phase === 'lack') {
      const seat = this.players.findIndex((p) => p.lack < 0);
      if (seat < 0) return null;
      return {
        seat,
        kind: 'lack',
        options: this.cfg.tiles.suits.map((s) => ({ type: 'lack', seat, suit: s }) as Action),
      };
    }
    if (this.phase === 'claim') {
      const c = this.claims[0];
      if (!c) return null;
      return { seat: c.seat, kind: 'claim', options: c.options, tile: this.claimTile, from: this.claimFrom };
    }
    if (this.phase === 'turn') {
      return { seat: this.turn, kind: 'turn', options: this.turnOptions(this.turn) };
    }
    return null;
  }

  private claimTile: TileId = -1;
  private claimFrom = -1;

  /**
   * 换三张的候选：所有「同花色三张」的组合。
   * 组合数最多 C(9,3) 级别，直接枚举给教学层打分用。
   */
  swapOptions(seat: number): Action[] {
    const p = this.players[seat];
    const out: Action[] = [];
    const { count, sameSuit } = this.cfg.swap;
    if (!sameSuit) return out; // 非同花色玩法：由界面自由选，不枚举
    for (const s of this.cfg.tiles.suits) {
      const tiles: TileId[] = [];
      for (let r = 0; r < 9; r++) for (let i = 0; i < p.hand[s * 9 + r]; i++) tiles.push(s * 9 + r);
      if (tiles.length < count) continue;
      const combo = (start: number, cur: TileId[]) => {
        if (cur.length === count) {
          out.push({ type: 'swap', seat, tiles: [...cur] });
          return;
        }
        for (let i = start; i < tiles.length; i++) {
          // 同一张牌有多张时会产生重复组合，跳过
          if (i > start && tiles[i] === tiles[i - 1]) continue;
          cur.push(tiles[i]);
          combo(i + 1, cur);
          cur.pop();
        }
      };
      combo(0, []);
    }
    return out;
  }

  /** 自己回合能做什么：自摸 / 暗杠 / 补杠 / 出牌 */
  turnOptions(seat: number): Action[] {
    const p = this.players[seat];
    const out: Action[] = [];
    const cfg = this.cfg;

    // 自摸：必须是刚摸进来的那张才叫自摸。
    // 不能写成「手牌 3n+2 就能胡」——碰完手牌也是 3n+2，那时候只能打牌，
    // 想胡就该在别人打出时喊胡（胡的优先级本来就高于碰）。
    if (this.drawnTile !== null) {
      const win = evaluateWin(cfg, {
        hand: p.hand, melds: p.melds, lack: p.lack,
        winTile: this.drawnTile, zimo: true,
        gangFlower: this.afterGang, haidi: this.wallLeft === 0,
        firstRound: this.isFirstRound(seat), isDealer: seat === this.dealer,
      });
      if (win) out.push({ type: 'hu', seat, tile: this.drawnTile });
    }

    // 杠：牌墙不够就不给杠（杠完补不到牌）
    if (this.wallLeft >= cfg.gang.minWallToGang) {
      if (cfg.gang.concealed) {
        for (let t = 0; t < 27; t++) {
          if (p.hand[t] !== 4) continue;
          if (!cfg.lack.claimLackAllowed && suitOf(t) === p.lack) continue;
          out.push({ type: 'gang', seat, tile: t, kind: 'angang' });
        }
      }
      if (cfg.gang.added) {
        for (const m of p.melds) {
          if (m.kind !== 'peng') continue;
          if (p.hand[m.tile] < 1) continue;
          if (!cfg.lack.claimLackAllowed && suitOf(m.tile) === p.lack) continue;
          out.push({ type: 'gang', seat, tile: m.tile, kind: 'bugang' });
        }
      }
    }

    for (const t of this.legalDiscards(seat)) out.push({ type: 'discard', seat, tile: t });
    return out;
  }

  /** 能打哪些牌：有缺门牌时只能打缺门 */
  legalDiscards(seat: number): TileId[] {
    const p = this.players[seat];
    const mustLack =
      this.cfg.lack.enabled && this.cfg.lack.discardLackFirst && p.lack >= 0 && hasSuit(p.hand, p.lack);
    const out: TileId[] = [];
    for (let t = 0; t < 27; t++) {
      if (p.hand[t] === 0) continue;
      if (mustLack && suitOf(t) !== p.lack) continue;
      out.push(t);
    }
    return out;
  }

  /** 第一巡：还没人副露，且全桌打出的牌不超过一轮 */
  private isFirstRound(seat: number): boolean {
    if (this.players.some((p) => p.melds.length > 0)) return false;
    const discarded = this.players.reduce((n, p) => n + p.discards.length, 0);
    return seat === this.dealer ? discarded === 0 : discarded < this.players.length;
  }

  // ==================== 应用动作 ====================

  /** 走一步。非法动作直接抛错——宁可崩，也不能让一局错牌悄悄算完 */
  apply(a: Action) {
    const p = this.players[a.seat];
    if (!p) throw new Error(`没有这个座位：${a.seat}`);
    const pend = this.pending();
    if (!pend) throw new Error('当前不需要动作');
    if (pend.seat !== a.seat) throw new Error(`现在轮到 ${pend.seat} 号位，不是 ${a.seat} 号位`);
    if (!this.isLegal(pend, a)) throw new Error(`非法动作：${JSON.stringify(a)}（阶段 ${this.phase}）`);
    this.log.push(a);

    switch (a.type) {
      case 'swap': return this.doSwap(a.seat, a.tiles);
      case 'lack': return this.doLack(a.seat, a.suit);
      case 'discard': return this.doDiscard(a.seat, a.tile);
      case 'peng': return this.doPeng(a.seat, a.tile);
      case 'gang': return this.doGang(a.seat, a.tile, a.kind);
      case 'hu': return this.doHu(a.seat, a.tile);
      case 'pass': return this.doPass(a.seat);
    }
  }

  private isLegal(pend: Pending, a: Action): boolean {
    if (pend.kind === 'swap') {
      if (a.type !== 'swap') return false;
      const p = this.players[a.seat];
      if (a.tiles.length !== this.cfg.swap.count) return false;
      if (this.cfg.swap.sameSuit && new Set(a.tiles.map(suitOf)).size !== 1) return false;
      const need = toCounts(a.tiles);
      for (let t = 0; t < 27; t++) if (need[t] > p.hand[t]) return false;
      return true;
    }
    return pend.options.some((o) => JSON.stringify(o) === JSON.stringify(a));
  }

  // ---------- 换三张 ----------

  private doSwap(seat: number, tiles: TileId[]) {
    this.pendingSwaps[seat] = [...tiles];
    if (this.pendingSwaps.some((s) => s.length === 0)) return;

    const dirs = this.cfg.swap.directions;
    const dir: SwapDir = this.cfg.swap.directionPick === 'random' ? this.rng.pick(dirs) : this.cfg.swap.fixedDir;
    this.swapDir = dir;
    const n = this.players.length;
    const shift = dir === 'next' ? 1 : dir === 'prev' ? n - 1 : n / 2;
    for (let s = 0; s < n; s++) {
      for (const t of this.pendingSwaps[s]) this.players[s].hand[t]--;
      this.players[s].swapOut = [...this.pendingSwaps[s]];
    }
    for (let s = 0; s < n; s++) {
      const to = (s + shift) % n;
      for (const t of this.pendingSwaps[s]) {
        this.players[to].hand[t]++;
        this.players[to].swapIn.push(t);
      }
    }
    const dirName = { opposite: '对家', next: '下家（顺时针）', prev: '上家（逆时针）' }[dir];
    this.emit({ type: 'swap', text: `换三张 · ${dirName}`, data: { dir } });
    this.phase = this.cfg.lack.enabled ? 'lack' : 'turn';
    if (this.phase === 'turn') this.beginTurn(this.dealer);
  }

  // ---------- 定缺 ----------

  private doLack(seat: number, suit: Suit) {
    this.players[seat].lack = suit;
    this.emit({ type: 'lack', seat, data: { suit } });
    if (this.players.some((p) => p.lack < 0)) return;
    this.beginTurn(this.dealer);
  }

  // ---------- 行牌 ----------

  /** 轮到某家：先摸一张，再进入 turn 阶段等他决策 */
  private beginTurn(seat: number) {
    if (this.checkOver()) return;
    let s = seat;
    let guard = 0;
    while (this.players[s].outOfPlay) {
      s = (s + 1) % this.players.length;
      if (++guard > this.players.length) return this.finish(false); // 没人能打了，不算摸完牌墙
    }
    if (this.wallLeft <= 0) return this.finish(true);
    this.turn = s;
    this.turnIndex++;
    const t = this.drawTail();
    this.players[s].hand[t]++;
    this.drawnTile = t;
    this.afterGang = false;
    this.phase = 'turn';
    this.emit({ type: 'draw', seat: s, tile: t, data: { wallLeft: this.wallLeft } });
  }

  private doDiscard(seat: number, tile: TileId) {
    const p = this.players[seat];
    p.hand[tile]--;
    p.discards.push(tile);
    this.lastDiscard = { seat, tile };
    this.drawnTile = null;
    // 打出新牌，过水锁解除（自己摸过牌了）
    p.passed = [];
    this.emit({ type: 'discard', seat, tile });
    const gangPao = this.gangDiscardPending;
    this.gangDiscardPending = false;
    this.openClaims(seat, tile, { gangPao });
  }

  /**
   * 收集别家的响应，按 胡 > 杠 > 碰 排队。
   * 一炮多响时所有能胡的都要问到，所以胡不是问到一个就停。
   */
  private openClaims(from: number, tile: TileId, opts: { gangPao?: boolean; robKong?: boolean } = {}) {
    const cfg = this.cfg;
    const claims: { seat: number; options: Action[]; priority: number }[] = [];
    const n = this.players.length;
    for (let d = 1; d < n; d++) {
      const seat = (from + d) % n;
      const p = this.players[seat];
      if (p.outOfPlay) continue;

      // 胡（血流成河里胡满次数的家还能碰杠，只是不能再胡）
      const canHuAgain = p.winCount < cfg.bloody.maxWinPerPlayer;
      const locked = cfg.win.passLock && p.passed.includes(tile);
      if (canHuAgain && !locked) {
        const hand = p.hand.slice();
        hand[tile]++;
        const win = evaluateWin(cfg, {
          hand, melds: p.melds, lack: p.lack, winTile: tile, zimo: false,
          gangPao: opts.gangPao, qiangGang: opts.robKong, haidi: this.wallLeft === 0,
        });
        if (win) claims.push({ seat, options: [{ type: 'hu', seat, tile }, { type: 'pass', seat }], priority: 0 });
      }
      if (opts.robKong) continue; // 抢杠只问胡

      const lackBlocked = !cfg.lack.claimLackAllowed && suitOf(tile) === p.lack;
      if (lackBlocked) continue;
      const opt: Action[] = [];
      if (cfg.gang.exposed && p.hand[tile] === 3 && this.wallLeft >= cfg.gang.minWallToGang) {
        opt.push({ type: 'gang', seat, tile, kind: 'gang' });
      }
      if (p.hand[tile] >= 2) opt.push({ type: 'peng', seat, tile });
      if (opt.length) {
        opt.push({ type: 'pass', seat });
        claims.push({ seat, options: opt, priority: 1 });
      }
    }

    claims.sort((a, b) => a.priority - b.priority || ((a.seat - from + n) % n) - ((b.seat - from + n) % n));
    this.claims = claims;
    this.claimTile = tile;
    this.claimFrom = from;
    if (claims.length === 0) {
      if (opts.robKong) return this.finishRobKong();
      return this.afterDiscardSettled(from);
    }
    this.phase = 'claim';
  }

  private doPass(seat: number) {
    const c = this.claims.shift();
    if (this.cfg.win.passLock && c?.options.some((o) => o.type === 'hu')) {
      this.players[seat].passed.push(this.claimTile);
    }
    this.emit({ type: 'pass', seat, tile: this.claimTile });
    this.continueClaims();
  }

  private continueClaims() {
    if (this.claims.length > 0) {
      this.phase = 'claim';
      return;
    }
    if (this.robbing) return this.finishRobKong();
    this.afterDiscardSettled(this.claimFrom);
  }

  /** 没人要这张牌：下一家摸牌 */
  private afterDiscardSettled(from: number) {
    if (this.checkOver()) return;
    this.beginTurn((from + 1) % this.players.length);
  }

  private doPeng(seat: number, tile: TileId) {
    const p = this.players[seat];
    p.hand[tile] -= 2;
    p.melds.push({ kind: 'peng', tile, from: this.claimFrom });
    this.takeBackDiscard();
    this.claims = [];
    this.emit({ type: 'peng', seat, tile });
    // 碰完轮到他出牌，不摸牌
    this.turn = seat;
    this.drawnTile = null;
    this.afterGang = false;
    this.phase = 'turn';
  }

  private doGang(seat: number, tile: TileId, kind: 'gang' | 'angang' | 'bugang') {
    const p = this.players[seat];
    const cfg = this.cfg;
    if (kind === 'gang') {
      p.hand[tile] -= 3;
      p.melds.push({ kind: 'gang', tile, from: this.claimFrom });
      this.takeBackDiscard();
      this.claims = [];
      this.payGang(seat, cfg.gang.payExposed, [this.claimFrom]);
    } else if (kind === 'angang') {
      p.hand[tile] -= 4;
      p.melds.push({ kind: 'angang', tile, from: seat });
      this.payGang(seat, cfg.gang.payConcealed, this.othersOf(seat));
    } else {
      // 补杠：先别收钱，要等抢杠问完。被抢了这个杠根本不成立，钱收了还得退
      p.hand[tile] -= 1;
      const m = p.melds.find((x) => x.kind === 'peng' && x.tile === tile)!;
      m.kind = 'bugang';
      this.emit({ type: 'gang', seat, tile, data: { kind } });
      if (cfg.win.robKong) {
        this.robbing = { seat, tile };
        this.robSucceeded = false;
        this.openClaims(seat, tile, { robKong: true });
        return;
      }
      this.payGang(seat, cfg.gang.payAdded, this.othersOf(seat));
      this.afterGangDraw(seat);
      return;
    }
    this.emit({ type: 'gang', seat, tile, data: { kind } });
    this.afterGangDraw(seat);
  }

  /** 杠完补一张，然后还是他出牌；补的这张自摸就是杠上花 */
  private afterGangDraw(seat: number) {
    if (!this.cfg.gang.replacementDraw || this.wallLeft <= 0) {
      if (this.wallLeft <= 0) return this.finish(true);
      this.turn = seat;
      this.phase = 'turn';
      return;
    }
    const t = this.drawHead();
    this.players[seat].hand[t]++;
    this.drawnTile = t;
    this.afterGang = true;
    this.gangDiscardPending = true; // 这之后打出的牌被胡 = 杠上炮
    this.turn = seat;
    this.phase = 'turn';
    this.emit({ type: 'draw', seat, tile: t, data: { afterGang: true } });
  }

  private finishRobKong() {
    const rob = this.robbing!;
    const succeeded = this.robSucceeded;
    this.robbing = null;
    this.robSucceeded = false;
    // 没人抢成：补杠正式成立，这时候才收杠分，然后补牌
    if (!succeeded) {
      this.payGang(rob.seat, this.cfg.gang.payAdded, this.othersOf(rob.seat));
      this.afterGangDraw(rob.seat);
      return;
    }
    // 被抢杠：补杠不成立，那张牌退回成碰
    const p = this.players[rob.seat];
    const m = p.melds.find((x) => x.kind === 'bugang' && x.tile === rob.tile);
    if (m) m.kind = 'peng';
    if (this.checkOver()) return;
    this.beginTurn((rob.seat + 1) % this.players.length);
  }

  private othersOf(seat: number): number[] {
    return this.players.filter((q) => q.seat !== seat && !q.outOfPlay).map((q) => q.seat);
  }

  private payGang(seat: number, amount: number, payers: number[]) {
    for (const from of payers) {
      if (from === seat) continue;
      const q = this.players[from];
      if (q.outOfPlay) continue;
      q.score -= amount;
      this.players[seat].score += amount;
      this.players[seat].gangGains.push({ from, amount });
    }
  }

  private takeBackDiscard() {
    const d = this.lastDiscard;
    if (!d) return;
    const arr = this.players[d.seat].discards;
    if (arr[arr.length - 1] === d.tile) arr.pop();
  }

  // ---------- 胡 ----------

  private doHu(seat: number, tile: TileId) {
    const p = this.players[seat];
    const cfg = this.cfg;
    const zimo = this.phase === 'turn';
    const hand = p.hand.slice();
    if (!zimo) hand[tile]++;
    const score = evaluateWin(cfg, {
      hand, melds: p.melds, lack: p.lack, winTile: tile, zimo,
      gangFlower: zimo && this.afterGang,
      gangPao: !zimo && this.gangDiscardPending,
      qiangGang: !!this.robbing,
      haidi: this.wallLeft === 0,
      firstRound: zimo && this.isFirstRound(seat),
      isDealer: seat === this.dealer,
    })!;

    const payer = zimo ? -1 : this.claimFrom;
    p.wins.push({ tile, zimo, payer, score, turnIndex: this.turnIndex });
    p.winCount++;
    p.won = true;

    // 收钱
    if (zimo) {
      for (const q of this.players) {
        if (q.seat === seat || q.outOfPlay) continue;
        q.score -= score.fan;
        p.score += score.fan;
      }
    } else {
      this.players[payer].score -= score.fan;
      p.score += score.fan;
      // 呼叫转移：胡牌者先前收的杠分改由点炮者出
      if (cfg.gang.transferOnWin) {
        for (const g of p.gangGains) {
          if (g.from === payer) continue;
          this.players[g.from].score += g.amount;
          this.players[payer].score -= g.amount;
        }
        if (p.gangGains.length) p.gangGains = [];
      }
    }

    this.emit({ type: 'hu', seat, tile, data: { zimo, fan: score.fan, names: score.names } });

    if (cfg.bloody.mode === 'xuezhan') {
      // 胡了下桌，手牌原样亮着给别人看
      p.outOfPlay = true;
    } else if (cfg.bloody.mode === 'single') {
      p.outOfPlay = true;
      return this.finish(false);
    } else {
      // 血流成河：胡牌张不进手牌，手牌张数不变，接着打
      if (zimo && this.drawnTile !== null) {
        p.hand[this.drawnTile]--;
        this.drawnTile = null;
      }
    }

    if (zimo) {
      this.claims = [];
      if (this.checkOver()) return;
      return this.beginTurn((seat + 1) % this.players.length);
    }

    // 抢杠胡：牌是从补杠里抢的，不在牌河上，不能去动牌河
    if (this.robbing) {
      this.robSucceeded = true;
      this.claims.shift();
      this.claims = cfg.win.multiWin ? this.claims.filter((c) => c.options.some((o) => o.type === 'hu')) : [];
      if (this.checkOver()) return;
      return this.continueClaims();
    }

    // 点炮胡：这张牌从牌河拿走。一炮多响时后面还能胡的继续问，
    // 不开一炮多响就直接清空（碰杠机会也一起没了，牌已经被胡走）
    this.takeBackDiscard();
    this.claims.shift();
    this.claims = cfg.win.multiWin ? this.claims.filter((c) => c.options.some((o) => o.type === 'hu')) : [];
    if (this.checkOver()) return;
    this.continueClaims();
  }

  // ---------- 结束 ----------

  private checkOver(): boolean {
    const cfg = this.cfg;
    if (cfg.bloody.mode === 'xuezhan') {
      const winners = this.players.filter((p) => p.won).length;
      if (winners >= cfg.bloody.winnersToEnd) {
        this.finish(false);
        return true;
      }
      // 只剩一家还在打，也打不下去了
      if (this.players.filter((p) => !p.outOfPlay).length <= 1) {
        this.finish(false);
        return true;
      }
    }
    if (this.wallLeft <= 0) {
      this.finish(true);
      return true;
    }
    return false;
  }

  private finish(exhausted: boolean) {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.claims = [];
    const drawRows = exhausted
      ? settleDraw(this.cfg, this.players.map((p) => ({
          seat: p.seat,
          hand: p.hand,
          melds: p.melds,
          lack: p.lack,
          won: p.won,
          gangGains: p.gangGains,
          tingFan: p.won ? 0 : bestTingFan(this.cfg, p.hand, p.melds, p.lack),
        })))
      : [];
    for (const r of drawRows) this.players[r.seat].score += r.delta;
    this.result = {
      scores: this.players.map((p) => p.score),
      drawRows,
      winners: this.players.filter((p) => p.won).map((p) => p.seat),
      exhausted,
    };
    this.emit({ type: 'over', data: { exhausted } });
  }

  // ==================== 查询 ====================

  /** 某家听哪些牌 */
  waits(seat: number): TileId[] {
    const p = this.players[seat];
    if (countTotal(p.hand) % 3 !== 1) return [];
    return waitingTiles(this.cfg, p.hand, p.melds, p.lack);
  }

  isTing(seat: number): boolean {
    return this.waits(seat).length > 0;
  }

  /**
   * 某家视角能看见的牌：全场弃牌 + 全场副露 + 自己手牌。
   * 算「这张还剩几张」要用它——真人数牌数的也是这些。
   */
  seenBy(seat: number): Counts {
    const seen = emptyCounts();
    for (const p of this.players) {
      for (const t of p.discards) seen[t]++;
      for (const m of p.melds) seen[m.tile] += m.kind === 'peng' ? 3 : 4;
      // 血战到底里胡了的家亮牌，手牌也算看得见
      if (p.outOfPlay && p.seat !== seat) for (let t = 0; t < 27; t++) seen[t] += p.hand[t];
    }
    const own = this.players[seat].hand;
    for (let t = 0; t < 27; t++) seen[t] = Math.min(4, seen[t] + own[t]);
    return seen;
  }

  /** 快照：给 UI 渲染、给题库存局面。深拷贝，外面改不坏引擎 */
  snapshot(): GameSnapshot {
    return {
      phase: this.phase,
      turn: this.turn,
      turnIndex: this.turnIndex,
      wallLeft: this.wallLeft,
      drawnTile: this.drawnTile,
      lastDiscard: this.lastDiscard ? { ...this.lastDiscard } : null,
      swapDir: this.swapDir,
      dealer: this.dealer,
      players: this.players.map((p) => ({
        seat: p.seat,
        hand: p.hand.slice(),
        melds: p.melds.map((m) => ({ ...m })),
        discards: [...p.discards],
        lack: p.lack,
        swapOut: [...p.swapOut],
        swapIn: [...p.swapIn],
        won: p.won,
        winCount: p.winCount,
        wins: p.wins.map((w) => ({ ...w })),
        score: p.score,
        gangGains: p.gangGains.map((g) => ({ ...g })),
        passed: [...p.passed],
        outOfPlay: p.outOfPlay,
      })),
      result: this.result ? { ...this.result } : null,
    };
  }
}

export interface GameSnapshot {
  phase: Phase;
  turn: number;
  turnIndex: number;
  wallLeft: number;
  drawnTile: TileId | null;
  lastDiscard: { seat: number; tile: TileId } | null;
  swapDir: SwapDir | null;
  dealer: number;
  players: PlayerState[];
  result: GameResult | null;
}

/**
 * 重放：同一个种子 + 同一串动作 = 同一局牌。
 * 复盘、出题、回归测试全靠它。
 */
export function replay(cfg: RuleConfig, seed: number, actions: Action[], upto = Infinity): MahjongEngine {
  const e = new MahjongEngine({ config: cfg, seed });
  e.start();
  let n = 0;
  for (const a of actions) {
    if (n++ >= upto) break;
    if (e.phase === 'over') break;
    e.apply(a);
  }
  return e;
}
