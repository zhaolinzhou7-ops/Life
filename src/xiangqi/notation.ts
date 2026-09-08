/**
 * 中文记谱法（着法 ↔ 文字）与局面串（FEN）。
 *
 * 为什么要先做这个：不会读「炮二平五、马8进7」，任何棋书、棋谱、复盘记录都读不了，
 * 学棋的通道是断的。所以记谱是第一课，也是后面复盘、题库、定式数据的通用语言。
 *
 * 规则要点：
 *   - 红方用汉字数字，从红方视角**从右往左**数一~九 → 路号 = 9 - x
 *   - 黑方用阿拉伯数字，从黑方视角从右往左数 1~9 → 路号 = x + 1
 *   - 进 = 朝对方走（红 y 减小、黑 y 增大），退 = 朝自己走，平 = 横走
 *   - 车炮兵帅纵走记「步数」，马相仕纵走记「目标路号」
 *   - 同一路上有两个同种子时不写起始路号，改用 前/后（三个用 前/中/后，
 *     四五个兵用 一~五，从前往后数）
 */
import { COLS, ROWS, PTYPE_NAME, type Board, type Color, type Move, type PType, type Piece } from './rules';

/** 红方汉字数字（索引 1~9 有效） */
const CN = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const CN_INDEX = new Map(CN.map((s, i) => [s, i]));

/** 路号：红从右往左，黑从右往左（两边的"右"是相反方向） */
export const fileOf = (x: number, c: Color): number => (c === 'r' ? COLS - x : x + 1);
/** 路号反推列号 */
export const fileToX = (f: number, c: Color): number => (c === 'r' ? COLS - f : f - 1);
/** 该方的"前进"方向在 y 上的增量 */
export const forwardDy = (c: Color): number => (c === 'r' ? -1 : 1);

/** 把数字写成该方的记谱数字：红用汉字，黑用阿拉伯数字 */
const num = (n: number, c: Color): string => (c === 'r' ? CN[n] : String(n));
/** 反过来：把记谱数字读成整数，读不出返回 0 */
const unnum = (s: string): number => CN_INDEX.get(s) ?? (/^[1-9]$/.test(s) ? Number(s) : 0);

/** 纵走记步数的兵种（车炮兵帅）；马相仕记目标路号 */
const STEP_KINDS: ReadonlySet<PType> = new Set<PType>(['R', 'C', 'P', 'K']);

/**
 * 记谱用的子名。和棋盘上刻的字不完全一样：棋子实物黑炮常刻「砲」，
 * 但记谱通行写「炮」，两边都写炮才和棋书棋谱对得上（解析时两个都认）。
 */
export const pieceName = (t: PType, c: Color): string =>
  t === 'C' ? '炮' : PTYPE_NAME[t][c === 'r' ? 0 : 1];

/** 同色同兵种、且在同一路上的所有棋子，按「从前到后」排序返回其 y 坐标 */
function sameFileGroup(b: Board, x: number, t: PType, c: Color): number[] {
  const ys: number[] = [];
  for (let y = 0; y < ROWS; y++) {
    const p = b[y][x];
    if (p && p.t === t && p.c === c) ys.push(y);
  }
  // 红方越靠前 y 越小，黑方越靠前 y 越大
  ys.sort((a, d) => (c === 'r' ? a - d : d - a));
  return ys;
}

/** 多子同路时的前缀：前/中/后，四五个兵用 一~五 */
function rankPrefix(idx: number, total: number, c: Color): string {
  if (total <= 3) return ['前', '中', '后'][total === 2 ? (idx === 0 ? 0 : 2) : idx];
  return num(idx + 1, c);
}

/**
 * 着法 → 中文记谱，例如「炮二平五」「前马进七」「马8进7」。
 * b 是**走这步之前**的棋盘。
 */
export function moveToText(b: Board, m: Move): string {
  const p = b[m.fy][m.fx];
  if (!p) return '';
  const c = p.c;
  const name = pieceName(p.t, c);

  // 主语：同路多子写 前/后，否则写「子名 + 起始路号」
  const group = sameFileGroup(b, m.fx, p.t, c);
  let subject: string;
  if (group.length >= 2) {
    const idx = group.indexOf(m.fy);
    const prefix = rankPrefix(idx, group.length, c);
    // 「前马」这种写法里不再写起始路号
    subject = prefix + name;
  } else {
    subject = name + num(fileOf(m.fx, c), c);
  }

  // 谓语 + 宾语
  if (m.ty === m.fy) return `${subject}平${num(fileOf(m.tx, c), c)}`;
  const forward = (m.ty - m.fy) * forwardDy(c) > 0;
  const verb = forward ? '进' : '退';
  const obj = STEP_KINDS.has(p.t) ? Math.abs(m.ty - m.fy) : fileOf(m.tx, c);
  return `${subject}${verb}${num(obj, c)}`;
}

/** 一串着法转成带手数的谱文：`1. 炮二平五 马8进7` */
export function movesToText(start: Board, moves: Move[], applyMove: (b: Board, m: Move) => Board): string[] {
  const out: string[] = [];
  let b = start;
  for (const m of moves) {
    out.push(moveToText(b, m));
    b = applyMove(b, m);
  }
  return out;
}

/**
 * 中文记谱 → 着法。解析不出（写错、有歧义、该着法不存在）返回 null。
 * legal 传入当前该走方的合法着法，用来消歧并保证结果一定合法。
 */
export function textToMove(b: Board, c: Color, text: string, legal: Move[]): Move | null {
  const s = text.trim().replace(/\s+/g, '');
  if (s.length < 3) return null;

  const NAMES: PType[] = ['K', 'A', 'E', 'H', 'R', 'C', 'P'];
  const byName = (ch: string): PType | null =>
    ch === '砲' ? 'C' : (NAMES.find((t) => pieceName(t, c) === ch) ?? null);

  let t: PType | null = null;
  let candidates: Move[] = [];
  let rest = '';

  const PREFIX = ['前', '中', '后'];
  if (PREFIX.includes(s[0]) || (unnum(s[0]) > 0 && byName(s[1]))) {
    // 前/后/中 + 子名，或 一~五 + 兵
    t = byName(s[1]);
    if (!t) return null;
    rest = s.slice(2);
    // 找出所有「同路多子」的组，定位到具体那一个
    for (let x = 0; x < COLS; x++) {
      const group = sameFileGroup(b, x, t, c);
      if (group.length < 2) continue;
      const idx = PREFIX.includes(s[0])
        ? s[0] === '前'
          ? 0
          : s[0] === '中'
            ? 1
            : group.length - 1
        : unnum(s[0]) - 1;
      if (idx < 0 || idx >= group.length) continue;
      candidates.push(...legal.filter((mv) => mv.fx === x && mv.fy === group[idx]));
    }
  } else {
    t = byName(s[0]);
    if (!t) return null;
    const f = unnum(s[1]);
    if (!f) return null;
    const x = fileToX(f, c);
    rest = s.slice(2);
    // 单子写法：该路上只有一个该兵种时才成立
    const group = sameFileGroup(b, x, t, c);
    if (group.length !== 1) return null;
    candidates = legal.filter((mv) => mv.fx === x && mv.fy === group[0]);
  }

  if (rest.length !== 2) return null;
  const verb = rest[0];
  const n = unnum(rest[1]);
  if (!n) return null;

  const hit = candidates.filter((mv) => {
    if (verb === '平') return mv.ty === mv.fy && fileOf(mv.tx, c) === n;
    const forward = (mv.ty - mv.fy) * forwardDy(c) > 0;
    if (verb === '进' ? !forward : verb === '退' ? forward : true) return false;
    if (mv.ty === mv.fy) return false;
    return STEP_KINDS.has(t!) ? Math.abs(mv.ty - mv.fy) === n : fileOf(mv.tx, c) === n;
  });
  return hit.length === 1 ? hit[0] : null;
}

// ---------------- 局面串（象棋 FEN） ----------------
// 用国际通行的象棋 FEN，方便和现成的棋谱库、引擎互通。
// 大写红、小写黑；K将 A士 B象 N马 R车 C炮 P兵，从黑底线（y=0）写到红底线（y=9）。

const FEN_CH: Record<PType, string> = { K: 'k', A: 'a', E: 'b', H: 'n', R: 'r', C: 'c', P: 'p' };
const CH_FEN: Record<string, PType> = { k: 'K', a: 'A', b: 'E', n: 'H', r: 'R', c: 'C', p: 'P' };

/** 棋盘 → FEN（含走子方） */
export function toFen(b: Board, toMove: Color): string {
  const rows: string[] = [];
  for (let y = 0; y < ROWS; y++) {
    let row = '';
    let gap = 0;
    for (let x = 0; x < COLS; x++) {
      const p = b[y][x];
      if (!p) {
        gap++;
        continue;
      }
      if (gap) {
        row += gap;
        gap = 0;
      }
      const ch = FEN_CH[p.t];
      row += p.c === 'r' ? ch.toUpperCase() : ch;
    }
    if (gap) row += gap;
    rows.push(row);
  }
  return `${rows.join('/')} ${toMove === 'r' ? 'w' : 'b'}`;
}

/** FEN → 棋盘。格式不对返回 null */
export function fromFen(fen: string): { board: Board; toMove: Color } | null {
  const [pos, side = 'w'] = fen.trim().split(/\s+/);
  const rows = pos.split('/');
  if (rows.length !== ROWS) return null;
  const board: Board = Array.from({ length: ROWS }, () => Array<Piece | null>(COLS).fill(null));
  for (let y = 0; y < ROWS; y++) {
    let x = 0;
    for (const ch of rows[y]) {
      if (ch >= '1' && ch <= '9') {
        x += Number(ch);
        continue;
      }
      const t = CH_FEN[ch.toLowerCase()];
      if (!t || x >= COLS) return null;
      board[y][x] = { t, c: ch === ch.toUpperCase() ? 'r' : 'b' };
      x++;
    }
    if (x !== COLS) return null;
  }
  return { board, toMove: side === 'b' ? 'b' : 'r' };
}
