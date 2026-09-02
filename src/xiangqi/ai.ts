/**
 * 中国象棋搜索引擎。
 *
 * 为什么不直接用 rules.ts 的走法生成：rules.legalMoves 对每个伪合法走法都要
 * 克隆整个棋盘再做一次将军检查，一次调用约 58µs，搜索里 90% 的时间都耗在这儿，
 * 实测只能跑到 2.5 万节点/秒、四层深度——那个强度下看不到两步杀，就是"很傻"。
 *
 * 这里另起一套搜索专用核心：扁平 Int8Array 棋盘 + 就地 make/unmake（零分配）
 * + 增量 Zobrist + 定长开放寻址置换表。rules.ts 保持原样给界面用。
 */
import { COLS, ROWS, type Board, type Color, type Move } from './rules';

// ---------------- 棋子编码 ----------------
// 低 3 位是兵种，第 4 位是颜色（0=红 1=黑），0 表示空格
const K = 1, A = 2, E = 3, H = 4, R = 5, C = 6, P = 7;
const BLACK = 8;
const SQ = COLS * ROWS; // 90

/** 子力价值（厘兵） */
const VAL = new Int32Array([0, 60000, 220, 220, 450, 1000, 500, 100]);

// ---------------- 位置价值表（红方视角，y=9 是红底线） ----------------
const PAWN_T = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [90, 90, 110, 120, 120, 120, 110, 90, 90],
  [90, 90, 110, 120, 120, 120, 110, 90, 90],
  [70, 90, 110, 110, 110, 110, 110, 90, 70],
  [70, 70, 70, 70, 70, 70, 70, 70, 70],
  [0, 0, 0, 20, 25, 20, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0],
];
const HORSE_T = [
  [0, -4, 0, 0, 0, 0, 0, -4, 0],
  [0, 2, 4, 4, 2, 4, 4, 2, 0],
  [4, 2, 8, 8, 4, 8, 8, 2, 4],
  [2, 6, 8, 6, 10, 6, 8, 6, 2],
  [4, 12, 16, 14, 12, 14, 16, 12, 4],
  [6, 16, 14, 18, 16, 18, 14, 16, 6],
  [8, 24, 18, 24, 20, 24, 18, 24, 8],
  [12, 14, 16, 20, 18, 20, 16, 14, 12],
  [4, 10, 28, 16, 8, 16, 28, 10, 4],
  [4, 8, 16, 12, 4, 12, 16, 8, 4],
];
const ROOK_T = [
  [-2, 10, 6, 14, 12, 14, 6, 10, -2],
  [8, 4, 8, 16, 8, 16, 8, 4, 8],
  [4, 8, 6, 14, 12, 14, 6, 8, 4],
  [6, 10, 8, 14, 14, 14, 8, 10, 6],
  [12, 16, 14, 20, 20, 20, 14, 16, 12],
  [12, 14, 12, 18, 18, 18, 12, 14, 12],
  [12, 18, 16, 22, 22, 22, 16, 18, 12],
  [12, 12, 12, 18, 18, 18, 12, 12, 12],
  [16, 20, 18, 24, 26, 24, 18, 20, 16],
  [14, 14, 12, 18, 16, 18, 12, 14, 14],
];
const CANNON_T = [
  [6, 4, 0, -10, -12, -10, 0, 4, 6],
  [2, 2, 0, -4, -14, -4, 0, 2, 2],
  [2, 2, 0, -10, -8, -10, 0, 2, 2],
  [0, 0, -2, 4, 10, 4, -2, 0, 0],
  [0, 0, 0, 2, 8, 2, 0, 0, 0],
  [-2, 0, 4, 2, 6, 2, 4, 0, -2],
  [0, 0, 0, 2, 4, 2, 0, 0, 0],
  [4, 0, 8, 6, 10, 6, 8, 0, 4],
  [0, 2, 4, 6, 6, 6, 4, 2, 0],
  [0, 0, 2, 6, 6, 6, 2, 0, 0],
];

/** 展平成 [兵种][格子]，黑方查表时用镜像格 */
const PST: (Int16Array | null)[] = new Array(8).fill(null);
{
  const flat = (t: number[][]) => {
    const a = new Int16Array(SQ);
    for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) a[y * COLS + x] = t[y][x];
    return a;
  };
  PST[P] = flat(PAWN_T);
  PST[H] = flat(HORSE_T);
  PST[R] = flat(ROOK_T);
  PST[C] = flat(CANNON_T);
}
/** 上下镜像：黑方用 */
const MIRROR = new Int8Array(SQ);
for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) MIRROR[y * COLS + x] = (ROWS - 1 - y) * COLS + x;

const MATE = 50000;

// ---------------- Zobrist ----------------
// 用两张 32 位表：z1 做索引，z2 做校验，等效 64 位，避免置换表误命中。
const Z1 = new Int32Array(16 * SQ);
const Z2 = new Int32Array(16 * SQ);
let Z1_SIDE = 0;
let Z2_SIDE = 0;
{
  // xorshift32，固定种子保证可复现
  let s = 0x9e3779b9;
  const rnd = () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5; s |= 0;
    return s;
  };
  for (let i = 0; i < 16 * SQ; i++) { Z1[i] = rnd(); Z2[i] = rnd(); }
  Z1_SIDE = rnd();
  Z2_SIDE = rnd();
}

// ---------------- 置换表（定长开放寻址） ----------------
const TT_BITS = 20;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const ttKey = new Int32Array(TT_SIZE);
const ttCheck = new Int32Array(TT_SIZE);
const ttScore = new Int32Array(TT_SIZE);
const ttMove = new Int32Array(TT_SIZE);
const ttDepth = new Int8Array(TT_SIZE);
const ttFlag = new Int8Array(TT_SIZE); // 0=精确 1=下界 2=上界
let ttGen = 0;
const ttAge = new Int8Array(TT_SIZE);

// ---------------- 引擎状态 ----------------
const bd = new Int8Array(SQ);
let kingSq = [0, 0]; // [红, 黑]
let h1 = 0;
let h2 = 0;
let side = 0; // 0=红 1=黑

const MAX_PLY = 64;
const MOVE_CAP = 128;
/** 每层的走法缓冲，避免搜索中分配 */
const moveBuf = new Int32Array(MAX_PLY * MOVE_CAP);
const scoreBuf = new Int32Array(MAX_PLY * MOVE_CAP);
/** make/unmake 的被吃子栈 */
const capStack = new Int8Array(MAX_PLY);
/** 路径上的局面校验值，用于重复局面判定 */
const pathKey = new Int32Array(MAX_PLY + 8);
const killers = new Int32Array(MAX_PLY * 2);
const history = new Int32Array(SQ * SQ);

let nodes = 0;
let deadline = 0;
let stopped = false;
let reachedDepth = 0;

// ---------------- 基础工具 ----------------
const px = (i: number) => i % COLS;
const py = (i: number) => (i / COLS) | 0;
const isBlack = (p: number) => (p & BLACK) !== 0;
const colorOf = (p: number) => (p & BLACK) >>> 3;

function inPalace(x: number, y: number, s: number) {
  if (x < 3 || x > 5) return false;
  return s === 0 ? y >= 7 && y <= 9 : y >= 0 && y <= 2;
}
/** 是否还在本方半场（象不过河） */
function ownHalf(y: number, s: number) {
  return s === 0 ? y >= 5 : y <= 4;
}

function zIdx(p: number, i: number) {
  return ((p & 15) * SQ + i) | 0;
}

function put(i: number, p: number) {
  bd[i] = p;
  const z = zIdx(p, i);
  h1 ^= Z1[z];
  h2 ^= Z2[z];
  if ((p & 7) === K) kingSq[colorOf(p)] = i;
}
function clr(i: number) {
  const p = bd[i];
  if (p) {
    const z = zIdx(p, i);
    h1 ^= Z1[z];
    h2 ^= Z2[z];
  }
  bd[i] = 0;
}

// ---------------- 走法编码：from | to<<7 ----------------
const mFrom = (m: number) => m & 127;
const mTo = (m: number) => (m >>> 7) & 127;
const mk = (f: number, t: number) => (f | (t << 7)) | 0;

// ---------------- 走法生成（伪合法） ----------------
const HORSE_LEG = [
  [1, 0, 2, 1], [1, 0, 2, -1], [-1, 0, -2, 1], [-1, 0, -2, -1],
  [0, 1, 1, 2], [0, 1, -1, 2], [0, -1, 1, -2], [0, -1, -1, -2],
];
const DIR4 = [[0, 1], [0, -1], [1, 0], [-1, 0]];
const DIAG4 = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

/** 生成 s 方全部伪合法走法，写入 moveBuf[base..]，返回数量 */
function genMoves(s: number, base: number): number {
  let n = 0;
  for (let i = 0; i < SQ; i++) {
    const p = bd[i];
    if (p === 0 || colorOf(p) !== s) continue;
    const x = px(i);
    const y = py(i);
    const t = p & 7;

    if (t === K) {
      for (let d = 0; d < 4; d++) {
        const tx = x + DIR4[d][0];
        const ty = y + DIR4[d][1];
        if (!inPalace(tx, ty, s)) continue;
        const j = ty * COLS + tx;
        const q = bd[j];
        if (q === 0 || colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
      }
    } else if (t === A) {
      for (let d = 0; d < 4; d++) {
        const tx = x + DIAG4[d][0];
        const ty = y + DIAG4[d][1];
        if (!inPalace(tx, ty, s)) continue;
        const j = ty * COLS + tx;
        const q = bd[j];
        if (q === 0 || colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
      }
    } else if (t === E) {
      for (let d = 0; d < 4; d++) {
        const dx = DIAG4[d][0] * 2;
        const dy = DIAG4[d][1] * 2;
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) continue;
        if (!ownHalf(ty, s)) continue; // 不过河
        if (bd[(y + dy / 2) * COLS + (x + dx / 2)] !== 0) continue; // 塞象眼
        const j = ty * COLS + tx;
        const q = bd[j];
        if (q === 0 || colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
      }
    } else if (t === H) {
      for (let d = 0; d < 8; d++) {
        const lg = HORSE_LEG[d];
        const lx = x + lg[0];
        const ly = y + lg[1];
        if (lx < 0 || lx >= COLS || ly < 0 || ly >= ROWS) continue;
        if (bd[ly * COLS + lx] !== 0) continue; // 蹩马腿
        const tx = x + lg[2];
        const ty = y + lg[3];
        if (tx < 0 || tx >= COLS || ty < 0 || ty >= ROWS) continue;
        const j = ty * COLS + tx;
        const q = bd[j];
        if (q === 0 || colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
      }
    } else if (t === R) {
      for (let d = 0; d < 4; d++) {
        const dx = DIR4[d][0];
        const dy = DIR4[d][1];
        let tx = x + dx;
        let ty = y + dy;
        while (tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS) {
          const j = ty * COLS + tx;
          const q = bd[j];
          if (q === 0) moveBuf[base + n++] = mk(i, j);
          else {
            if (colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
            break;
          }
          tx += dx;
          ty += dy;
        }
      }
    } else if (t === C) {
      for (let d = 0; d < 4; d++) {
        const dx = DIR4[d][0];
        const dy = DIR4[d][1];
        let tx = x + dx;
        let ty = y + dy;
        let jumped = false;
        while (tx >= 0 && tx < COLS && ty >= 0 && ty < ROWS) {
          const j = ty * COLS + tx;
          const q = bd[j];
          if (!jumped) {
            if (q === 0) moveBuf[base + n++] = mk(i, j);
            else jumped = true;
          } else if (q !== 0) {
            if (colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
            break;
          }
          tx += dx;
          ty += dy;
        }
      }
    } else {
      // 兵/卒
      const fwd = s === 0 ? -1 : 1;
      const ty = y + fwd;
      if (ty >= 0 && ty < ROWS) {
        const j = ty * COLS + x;
        const q = bd[j];
        if (q === 0 || colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
      }
      const crossed = s === 0 ? y <= 4 : y >= 5;
      if (crossed) {
        for (const dx of [-1, 1]) {
          const tx = x + dx;
          if (tx < 0 || tx >= COLS) continue;
          const j = y * COLS + tx;
          const q = bd[j];
          if (q === 0 || colorOf(q) !== s) moveBuf[base + n++] = mk(i, j);
        }
      }
    }
  }
  return n;
}

/**
 * s 方的将是否被攻击。
 * 直线方向上「第一个子是车或将」同时覆盖了车照将和将帅对脸两种情况。
 */
function inCheck(s: number): boolean {
  const ks = kingSq[s];
  const kx = px(ks);
  const ky = py(ks);
  const enemy = s ^ 1;

  for (let d = 0; d < 4; d++) {
    const dx = DIR4[d][0];
    const dy = DIR4[d][1];
    let x = kx + dx;
    let y = ky + dy;
    let seen = 0;
    while (x >= 0 && x < COLS && y >= 0 && y < ROWS) {
      const q = bd[y * COLS + x];
      if (q !== 0) {
        seen++;
        if (seen === 1) {
          const t = q & 7;
          if (colorOf(q) === enemy && (t === R || t === K)) return true;
        } else {
          if (colorOf(q) === enemy && (q & 7) === C) return true;
          break;
        }
      }
      x += dx;
      y += dy;
    }
  }

  // 马：反查 8 个马位并验蹩腿
  for (let d = 0; d < 8; d++) {
    const lg = HORSE_LEG[d];
    const hx = kx - lg[2];
    const hy = ky - lg[3];
    if (hx < 0 || hx >= COLS || hy < 0 || hy >= ROWS) continue;
    const q = bd[hy * COLS + hx];
    if (q === 0 || colorOf(q) !== enemy || (q & 7) !== H) continue;
    const lx = hx + lg[0];
    const ly = hy + lg[1];
    if (lx < 0 || lx >= COLS || ly < 0 || ly >= ROWS) continue;
    if (bd[ly * COLS + lx] === 0) return true;
  }

  // 兵：敌兵正面吃 / 过河后横吃
  const efwd = enemy === 0 ? -1 : 1;
  const fy = ky - efwd;
  if (fy >= 0 && fy < ROWS) {
    const q = bd[fy * COLS + kx];
    if (q !== 0 && colorOf(q) === enemy && (q & 7) === P) return true;
  }
  for (const dx of [-1, 1]) {
    const sx = kx + dx;
    if (sx < 0 || sx >= COLS) continue;
    const q = bd[ky * COLS + sx];
    if (q !== 0 && colorOf(q) === enemy && (q & 7) === P) {
      const crossed = enemy === 0 ? ky <= 4 : ky >= 5;
      if (crossed) return true;
    }
  }
  return false;
}

// ---------------- make / unmake ----------------
function makeMove(m: number, ply: number) {
  const f = mFrom(m);
  const t = mTo(m);
  const moving = bd[f];
  capStack[ply] = bd[t];
  if (bd[t]) clr(t);
  clr(f);
  put(t, moving);
  side ^= 1;
  h1 ^= Z1_SIDE;
  h2 ^= Z2_SIDE;
}
function unmakeMove(m: number, ply: number) {
  const f = mFrom(m);
  const t = mTo(m);
  const moving = bd[t];
  clr(t);
  put(f, moving);
  const cap = capStack[ply];
  if (cap) put(t, cap);
  side ^= 1;
  h1 ^= Z1_SIDE;
  h2 ^= Z2_SIDE;
}

// ---------------- 评估 ----------------
function evaluate(): number {
  let s = 0;
  for (let i = 0; i < SQ; i++) {
    const p = bd[i];
    if (p === 0) continue;
    const t = p & 7;
    const blk = isBlack(p);
    let v = VAL[t];
    const tb = PST[t];
    if (tb) v += tb[blk ? MIRROR[i] : i];
    if (t === A || t === E) {
      const y = py(i);
      const yy = blk ? ROWS - 1 - y : y;
      if (yy >= 7) v += 12; // 士象守家
    }
    s += blk ? -v : v;
  }
  // 返回「红方视角」分数
  return s;
}
/** 走子方视角的评估 */
const evalSide = () => (side === 0 ? evaluate() : -evaluate());

// ---------------- 走法排序 ----------------
function scoreMoves(base: number, n: number, ttM: number, ply: number) {
  const k0 = killers[ply * 2];
  const k1 = killers[ply * 2 + 1];
  for (let i = 0; i < n; i++) {
    const m = moveBuf[base + i];
    if (m === ttM) {
      scoreBuf[base + i] = 1 << 30;
      continue;
    }
    const victim = bd[mTo(m)];
    if (victim !== 0) {
      const attacker = bd[mFrom(m)];
      scoreBuf[base + i] = 1000000 + VAL[victim & 7] * 10 - VAL[attacker & 7];
    } else if (m === k0) scoreBuf[base + i] = 900000;
    else if (m === k1) scoreBuf[base + i] = 899000;
    else scoreBuf[base + i] = history[mFrom(m) * SQ + mTo(m)];
  }
}
/** 选择排序：只在需要时挑出当前最好的一手，省掉整体排序 */
function pickMove(base: number, n: number, i: number) {
  let best = i;
  for (let j = i + 1; j < n; j++) if (scoreBuf[base + j] > scoreBuf[base + best]) best = j;
  if (best !== i) {
    const tm = moveBuf[base + i]; moveBuf[base + i] = moveBuf[base + best]; moveBuf[base + best] = tm;
    const ts = scoreBuf[base + i]; scoreBuf[base + i] = scoreBuf[base + best]; scoreBuf[base + best] = ts;
  }
}

/** 当前路径上是否出现过同一局面（简化的循环判定） */
function isRepetition(ply: number): boolean {
  for (let i = ply - 2; i >= 0; i -= 2) if (pathKey[i] === h2) return true;
  return false;
}

function timeUp(): boolean {
  if ((nodes & 2047) === 0 && Date.now() > deadline) stopped = true;
  return stopped;
}

// ---------------- 静态搜索 ----------------
function quiescence(alpha: number, beta: number, ply: number): number {
  nodes++;
  if (timeUp()) return alpha;
  const stand = evalSide();
  if (stand >= beta) return stand;
  if (stand > alpha) alpha = stand;
  if (ply >= MAX_PLY - 2) return stand;

  const base = ply * MOVE_CAP;
  const n = genMoves(side, base);
  // 只看吃子
  let cnt = 0;
  for (let i = 0; i < n; i++) {
    const m = moveBuf[base + i];
    if (bd[mTo(m)] !== 0) {
      moveBuf[base + cnt] = m;
      const victim = bd[mTo(m)];
      const attacker = bd[mFrom(m)];
      scoreBuf[base + cnt] = VAL[victim & 7] * 10 - VAL[attacker & 7];
      cnt++;
    }
  }
  const me = side;
  for (let i = 0; i < cnt; i++) {
    pickMove(base, cnt, i);
    const m = moveBuf[base + i];
    makeMove(m, ply);
    if (inCheck(me)) { unmakeMove(m, ply); continue; }
    const v = -quiescence(-beta, -alpha, ply + 1);
    unmakeMove(m, ply);
    if (stopped) return alpha;
    if (v >= beta) return v;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

// ---------------- 主搜索 ----------------
function negamax(depth: number, alpha: number, beta: number, ply: number, canNull: boolean): number {
  if (stopped) return alpha;
  nodes++;
  if (timeUp()) return alpha;

  if (ply > 0 && isRepetition(ply)) return 0; // 循环判和
  pathKey[ply] = h2;

  const me = side;
  const checked = inCheck(me);
  if (checked) depth++; // 被将军延伸，别在将军中间停下来评估

  if (depth <= 0) return quiescence(alpha, beta, ply);

  // 置换表
  const ti = h1 & TT_MASK;
  let ttM = 0;
  if (ttKey[ti] === h1 && ttCheck[ti] === h2) {
    ttM = ttMove[ti];
    if (ply > 0 && ttDepth[ti] >= depth) {
      const sc = ttScore[ti];
      const fl = ttFlag[ti];
      if (fl === 0) return sc;
      if (fl === 1 && sc >= beta) return sc;
      if (fl === 2 && sc <= alpha) return sc;
    }
  }

  // 空着裁剪：让对手连走两步仍压不下 beta，说明这里已经很好，可以剪
  if (canNull && !checked && depth >= 3 && ply > 0 && Math.abs(beta) < MATE - 1000) {
    const st = evalSide();
    if (st >= beta) {
      side ^= 1;
      h1 ^= Z1_SIDE;
      h2 ^= Z2_SIDE;
      const Rr = depth > 6 ? 3 : 2;
      const v = -negamax(depth - 1 - Rr, -beta, -beta + 1, ply + 1, false);
      side ^= 1;
      h1 ^= Z1_SIDE;
      h2 ^= Z2_SIDE;
      if (stopped) return alpha;
      if (v >= beta) return beta;
    }
  }

  const base = ply * MOVE_CAP;
  const n = genMoves(me, base);
  scoreMoves(base, n, ttM, ply);

  let best = -Infinity;
  let bestM = 0;
  const origAlpha = alpha;
  let legal = 0;

  for (let i = 0; i < n; i++) {
    pickMove(base, n, i);
    const m = moveBuf[base + i];
    const isCap = bd[mTo(m)] !== 0;
    makeMove(m, ply);
    if (inCheck(me)) { unmakeMove(m, ply); continue; } // 伪合法 → 过滤掉送将
    legal++;

    let v: number;
    if (legal === 1) {
      v = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
    } else {
      // 后期着法缩减 + 零窗口试探
      let red = 0;
      if (depth >= 3 && legal > 3 && !isCap && !checked) red = 1 + (legal > 8 ? 1 : 0);
      v = -negamax(depth - 1 - red, -alpha - 1, -alpha, ply + 1, true);
      if (v > alpha && (red > 0 || v < beta)) v = -negamax(depth - 1, -beta, -alpha, ply + 1, true);
    }
    unmakeMove(m, ply);
    if (stopped) return best > -Infinity ? best : alpha;

    if (v > best) { best = v; bestM = m; }
    if (v > alpha) alpha = v;
    if (alpha >= beta) {
      if (!isCap) {
        const kb = ply * 2;
        if (killers[kb] !== m) { killers[kb + 1] = killers[kb]; killers[kb] = m; }
        history[mFrom(m) * SQ + mTo(m)] += depth * depth;
      }
      break;
    }
  }

  if (legal === 0) return -MATE + ply; // 将死或困毙

  // 置换表写入：深度优先 + 世代替换
  if (ttKey[ti] !== h1 || ttDepth[ti] <= depth || ttAge[ti] !== ttGen) {
    ttKey[ti] = h1;
    ttCheck[ti] = h2;
    ttScore[ti] = best;
    ttMove[ti] = bestM;
    ttDepth[ti] = depth;
    ttFlag[ti] = best <= origAlpha ? 2 : best >= beta ? 1 : 0;
    ttAge[ti] = ttGen;
  }
  return best;
}

// ---------------- 对外接口 ----------------
export interface SearchOpts {
  maxDepth: number;
  timeMs: number;
  /** 评估扰动幅度，低难度用来"看走眼" */
  jitter: number;
}

/** 把界面用的 Board 装载进扁平棋盘 */
function load(b: Board, color: Color) {
  bd.fill(0);
  h1 = 0;
  h2 = 0;
  const TYPE: Record<string, number> = { K, A, E, H, R, C, P };
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (!p) continue;
      put(y * COLS + x, TYPE[p.t] | (p.c === 'b' ? BLACK : 0));
    }
  }
  side = color === 'r' ? 0 : 1;
  if (side === 1) { h1 ^= Z1_SIDE; h2 ^= Z2_SIDE; }
}

const toMove = (m: number): Move => ({
  fx: px(mFrom(m)), fy: py(mFrom(m)), tx: px(mTo(m)), ty: py(mTo(m)),
});

/** 上一次搜索实际到达的深度与节点数（用于自测） */
export const lastSearch = { depth: 0, nodes: 0 };

export function think(b: Board, color: Color, opts: SearchOpts): Move | null {
  load(b, color);
  deadline = Date.now() + opts.timeMs;
  stopped = false;
  nodes = 0;
  reachedDepth = 0;
  ttGen = (ttGen + 1) & 127;
  killers.fill(0);
  for (let i = 0; i < history.length; i++) history[i] = (history[i] / 8) | 0;

  const base = 0;
  const n = genMoves(side, base);
  const me = side;
  // 过滤出真正合法的根着法
  const roots: number[] = [];
  for (let i = 0; i < n; i++) {
    const m = moveBuf[base + i];
    makeMove(m, 0);
    if (!inCheck(me)) roots.push(m);
    unmakeMove(m, 0);
  }
  if (roots.length === 0) return null;
  if (roots.length === 1) { lastSearch.depth = 0; lastSearch.nodes = 0; return toMove(roots[0]); }

  let best = roots[0];
  let bestScore = 0;

  for (let d = 1; d <= opts.maxDepth; d++) {
    let alpha = -Infinity;
    let localBest = 0;
    let localScore = -Infinity;
    // 上一轮最好的一手先搜
    const idx = roots.indexOf(best);
    if (idx > 0) { roots.splice(idx, 1); roots.unshift(best); }

    for (const m of roots) {
      makeMove(m, 0);
      let v = -negamax(d - 1, -Infinity, -alpha, 1, true);
      unmakeMove(m, 0);
      if (stopped) break;
      if (opts.jitter > 0) v += (Math.random() * 2 - 1) * opts.jitter;
      if (localBest === 0 || v > alpha) { alpha = v; localBest = m; localScore = v; }
    }
    if (localBest !== 0 && !stopped) {
      best = localBest;
      bestScore = localScore;
      reachedDepth = d;
    }
    if (stopped || Date.now() > deadline) break;
    if (bestScore > MATE - 200) break; // 已有杀棋
  }

  lastSearch.depth = reachedDepth;
  lastSearch.nodes = nodes;
  return toMove(best);
}

/** 为 color 选出走子。depth/时限/抖动由难度决定 */
export function bestMove(b: Board, color: Color, depth = 4, jitter = 1, timeMs = 1200): Move | null {
  return think(b, color, { maxDepth: depth, timeMs, jitter });
}

/**
 * 走法生成自测：统计 depth 层的合法走法总数。
 * 用来和 rules.ts 的慢速实现对拍，确保这套快速核心的规则没写漏
 * （蹩马腿、塞象眼、炮翻山、士象活动范围、将帅对脸都要一致）。
 */
export function perft(b: Board, color: Color, depth: number): number {
  load(b, color);
  return perftInner(depth, 0);
}
function perftInner(depth: number, ply: number): number {
  if (depth === 0) return 1;
  const base = ply * MOVE_CAP;
  const n = genMoves(side, base);
  const me = side;
  let total = 0;
  const local = new Int32Array(n);
  for (let i = 0; i < n; i++) local[i] = moveBuf[base + i];
  for (let i = 0; i < n; i++) {
    const m = local[i];
    makeMove(m, ply);
    if (!inCheck(me)) total += perftInner(depth - 1, ply + 1);
    unmakeMove(m, ply);
  }
  return total;
}
