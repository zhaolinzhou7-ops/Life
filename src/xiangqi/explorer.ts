/**
 * 开局树：把所有布局（主线、变化、变招、错着）和邪门布局（套路、破解、上当）并成一棵按局面索引的树。
 *
 * 两个用处：
 *   1. 开局浏览器（explorerui.ts）：任何一个谱上的局面，列出谱上所有走法（主线、变招、错着、邪门），
 *      每一手讲意义——参考象棋云库"每个局面列出所有候选着"、象棋巫师"开局自动识别"；
 *   2. 开局识别：一盘棋走到哪儿还在谱上、叫什么布局、第几手出谱（对局、复盘里显示）。
 *
 * 按局面（FEN）索引，不按着法顺序：换个次序走到同一个局面也认得出（转换）。
 */
import { applyMove, initialBoard, legalMoves, type Board, type Color, type Move } from './rules';
import { fromFen, moveToText, textToMove, toFen } from './notation';
import { OPENINGS, type LineMove } from './openings';
import { TRICKS, lineToTrap, refuteLine, trapLine, trickVars } from './tricks';

/** 这一手在谱上是什么身份 */
export type BranchKind = 'main' | 'var' | 'alt' | 'trap' | 'trick' | 'refute' | 'fall';

export const KIND_INFO: Record<BranchKind, { name: string; order: number }> = {
  main: { name: '主线', order: 0 },
  var: { name: '变化', order: 1 },
  alt: { name: '变招', order: 2 },
  refute: { name: '破解', order: 3 },
  trick: { name: '邪门', order: 4 },
  trap: { name: '错着', order: 5 },
  fall: { name: '上当', order: 6 },
};

export interface ExChild {
  /** 中文记谱 */
  t: string;
  /** 这一手的意义 */
  why: string;
  /** 走完之后红方视角的局面分（有就给） */
  ev?: number;
  kinds: Set<BranchKind>;
  /** 走完之后这个局面属于哪些谱 */
  lines: Set<string>;
  /** 定式（人写的）说明 */
  book?: boolean;
}

interface ExNode {
  children: Map<string, ExChild>;
  /** 走到这个局面的谱（名字） */
  lines: Set<string>;
  /** 这些谱分别属于哪套布局（id），邪门布局记 trick:<id> */
  owners: Set<string>;
}

let tree: Map<string, ExNode> | null = null;
let builtWith = -1;

const key = (b: Board, c: Color) => toFen(b, c);

function node(map: Map<string, ExNode>, k: string): ExNode {
  let n = map.get(k);
  if (!n) {
    n = { children: new Map(), lines: new Set(), owners: new Set() };
    map.set(k, n);
  }
  return n;
}

/** 把一条谱挂到树上：texts 从开局起；kinds[i] 是第 i 手的身份 */
function addLine(
  map: Map<string, ExNode>,
  name: string,
  owner: string,
  steps: { t: string; why: string; ev?: number; book?: boolean; kind: BranchKind }[],
) {
  let b = initialBoard();
  let c: Color = 'r';
  let here = node(map, key(b, c));
  for (const s of steps) {
    const m = textToMove(b, c, s.t, legalMoves(b, c));
    if (!m) return;
    let ch = here.children.get(s.t);
    if (!ch) {
      ch = { t: s.t, why: s.why, ev: s.ev, kinds: new Set(), lines: new Set(), book: s.book };
      here.children.set(s.t, ch);
    } else if ((s.book && !ch.book) || (!ch.why && s.why) || (!ch.book && !s.book && s.why.length > ch.why.length && s.kind !== 'fall')) {
      // 人写的定式说明优先；都不是人写的，留讲得更多的那一句
      ch.why = s.why;
      ch.book = s.book;
      if (s.ev !== undefined) ch.ev = s.ev;
    }
    if (ch.ev === undefined && s.ev !== undefined) ch.ev = s.ev;
    ch.kinds.add(s.kind);
    ch.lines.add(name);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
    here = node(map, key(b, c));
    here.lines.add(name);
    here.owners.add(owner);
  }
}

/** 变化数（布局补充数据加载以后会变多）——变了就重建 */
// 布局的变化、江湖布局的变化（两份按需加载的数据）到了，树就要重建
const version = () => OPENINGS.reduce((s, o) => s + o.variations.length, 0) + TRICKS.reduce((s, t) => s + trickVars(t.id).length, 0) * 1000;

function build(): Map<string, ExNode> {
  const map = new Map<string, ExNode>();
  const lm = (m: LineMove, kind: BranchKind) => ({ t: m.t, why: m.why, ev: m.ev, book: m.book, kind });
  for (const o of OPENINGS) addLine(map, o.name, o.id, o.moves.map((m) => lm(m, 'main')));
  for (const o of OPENINGS) {
    for (const v of o.variations) {
      const kind: BranchKind = v.kind === 'trap' ? 'trap' : v.kind === 'alt' ? 'alt' : 'var';
      addLine(map, `${o.name} · ${v.name}`, o.id, [...o.moves.slice(0, v.at).map((m) => lm(m, 'main')), ...v.moves.map((m) => lm(m, kind))]);
    }
  }
  for (const t of TRICKS) {
    const name = `邪门布局「${t.name}」`;
    const head = [...t.pre.map((x, i) => ({ t: x, why: t.preWhy[i] ?? '', book: true, kind: 'trick' as BranchKind })), { t: t.trick.t, why: `邪门着。${t.trick.why}`, book: true, kind: 'trick' as BranchKind }];
    addLine(map, name, `trick:${t.id}`, [...head, ...refuteLine(t).map((s, i) => ({ t: s.t, why: s.why, book: i < t.refute.length, kind: 'refute' as BranchKind }))]);
    const k = t.trapAfter ?? 0;
    addLine(map, `${name} · 上当`, `trick:${t.id}`, [
      ...head,
      ...t.refute.slice(0, k).map((s) => ({ t: s.t, why: s.why, book: true, kind: 'refute' as BranchKind })),
      ...trapLine(t).map((s, i) => ({ t: s.t, why: s.why, book: i < t.trap.length, kind: 'fall' as BranchKind })),
    ]);
    // 江湖布局的变化：他改走（还是邪门那一方的路数）、另一种破法、你走错了（上当）
    const R = refuteLine(t);
    for (const v of trickVars(t.id)) {
      const kind: BranchKind = v.kind === 'dev' ? 'trick' : v.kind === 'alt' ? 'refute' : 'fall';
      addLine(map, `${name} · ${v.name}`, `trick:${t.id}`, [
        ...head,
        ...R.slice(0, v.at).map((s, i) => ({ t: s.t, why: s.why, book: i < t.refute.length, kind: 'refute' as BranchKind })),
        ...v.moves.map((m) => ({ t: m.t, why: m.why, ev: m.ev, kind })),
      ]);
    }
    void lineToTrap;
  }
  return map;
}

function getTree(): Map<string, ExNode> {
  const v = version();
  if (!tree || v !== builtWith) {
    tree = build();
    builtWith = v;
  }
  return tree;
}

/** 这个局面在谱上吗；在的话，谱上的所有走法（按身份排好） */
export function childrenAt(b: Board, c: Color): ExChild[] {
  const n = getTree().get(key(b, c));
  if (!n) return [];
  const rank = (ch: ExChild) => Math.min(...[...ch.kinds].map((k) => KIND_INFO[k].order));
  return [...n.children.values()].sort((a, b2) => rank(a) - rank(b2) || b2.lines.size - a.lines.size);
}

/** 走到这个局面的谱的名字 */
export function linesAt(b: Board, c: Color): string[] {
  return [...(getTree().get(key(b, c))?.lines ?? [])];
}

export function inBook(b: Board, c: Color): boolean {
  return getTree().has(key(b, c));
}

// ───────────────────────── 开局识别 ─────────────────────────

/** 红方第一手的叫法（ECCO 那样的大类；谱上没有的起手也叫得出名字） */
const FIRST: Record<string, string> = {
  炮二平五: '中炮',
  炮八平五: '中炮',
  兵七进一: '仙人指路',
  兵三进一: '仙人指路',
  相三进五: '飞相局',
  相七进五: '飞相局',
  马二进三: '起马局',
  马八进七: '起马局',
  炮二平六: '过宫炮',
  炮八平四: '过宫炮',
  炮二平四: '士角炮',
  炮八平六: '士角炮',
  仕四进五: '上仕局',
  仕六进五: '上仕局',
  兵一进一: '九尾龟（边兵局）',
  兵九进一: '九尾龟（边兵局）',
  马二进一: '边马局',
  马八进九: '边马局',
  车一进一: '横车（铁滑车）',
  车九进一: '横车（铁滑车）',
  炮二进二: '巡河炮',
  炮八进二: '巡河炮',
};
/** 后手对中炮的体系（叫"中炮对 X"） */
const BLACK_SYSTEMS = ['屏风马', '三步虎', '反宫马', '单提马', '左炮封车'];
/** 对中炮的应法 */
const VS_CENTRAL: Record<string, string> = {
  马8进7: '中炮对进马',
  马2进3: '中炮对进马',
  炮8平5: '顺炮',
  炮2平5: '列炮',
  卒7进1: '中炮对进卒',
  卒3进1: '中炮对进卒',
  象3进5: '中炮对飞象',
  象7进5: '中炮对飞象',
  炮8平6: '中炮对反宫马',
  炮2平4: '中炮对反宫马',
};

export interface OpeningId {
  /** 叫什么布局 */
  name: string;
  /** 还在谱上的最后一手（从 1 数）；0 = 一手都不在谱上 */
  bookPly: number;
  /** 谱上一共能走到第几手（在谱上走到头就是 bookPly） */
  outAt?: number;
  /** 是不是邪门布局 */
  trick?: boolean;
}

/** 一盘棋（从开局起的着法）是什么布局、走到第几手出谱 */
export function identify(moves: Move[]): OpeningId | null {
  const map = getTree();
  let b = initialBoard();
  let c: Color = 'r';
  let lastIn = 0;
  let lastNode: ExNode | null = null;
  // 不在第一个谱外的局面就停：换个次序走（中间经过谱外的局面）也可能转回谱上
  for (let i = 0; i < Math.min(moves.length, 60); i++) {
    b = applyMove(b, moves[i]);
    c = c === 'r' ? 'b' : 'r';
    const n = map.get(key(b, c));
    if (!n) continue;
    lastIn = i + 1;
    lastNode = n;
  }
  let name = '';
  if (lastNode) {
    const owners = [...lastNode.owners];
    const tricks = owners.filter((o) => o.startsWith('trick:'));
    const ops = OPENINGS.filter((o) => owners.includes(o.id));
    // 布局谱上也有这个局面（弃马十三着的前几手就是顺炮）：叫布局的名字；只有邪门布局走到的局面才叫邪门布局
    if (tricks.length && !ops.length) {
      const t = TRICKS.find((x) => `trick:${x.id}` === tricks[0]);
      if (t) name = `邪门布局「${t.name}」`;
    }
    if (!name && ops.length === 1) {
      const o = ops[0];
      const mainHere = [...lastNode.lines].includes(o.name);
      const v = [...lastNode.lines].find((l) => l.startsWith(`${o.name} · `));
      name = mainHere || !v ? o.name : v;
    } else if (!name && ops.length > 1) {
      // 几套布局还共用这个局面：叫体系的名字（中炮对屏风马、顺炮、飞相局……）
      const systems = [...new Set(ops.map((o) => o.system))];
      const f = firstName(moves);
      if (systems.length === 1) name = BLACK_SYSTEMS.includes(systems[0]) && f.startsWith('中炮') ? `中炮对${systems[0]}` : systems[0];
      else name = f;
    }
  }
  if (!name) name = firstName(moves);
  if (!name) return null;
  return { name, bookPly: lastIn, trick: name.startsWith('邪门布局') };
}

/** 只看头两手的叫法 */
export function firstName(moves: Move[]): string {
  if (!moves.length) return '';
  const b0 = initialBoard();
  const t0 = moveToText(b0, moves[0]);
  const first = FIRST[t0] ?? '';
  if (!first || moves.length < 2) return first;
  if (first === '中炮') {
    const t1 = moveToText(applyMove(b0, moves[0]), moves[1]);
    // 顺炮 / 列炮看黑炮和红炮是不是同一侧
    if (t1 === '炮8平5' || t1 === '炮2平5') {
      const sameSide = (t0 === '炮二平五') === (t1 === '炮8平5');
      return sameSide ? '顺炮' : '列炮';
    }
    return VS_CENTRAL[t1] ?? '中炮';
  }
  return first;
}

/** 着法串（中文）→ Move[]；走不通返回 null */
export function parseMoves(texts: string[]): Move[] | null {
  let b = initialBoard();
  let c: Color = 'r';
  const out: Move[] = [];
  for (const t of texts) {
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) return null;
    out.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return out;
}

/** 导入：FEN，或者一串中文着法（"1. 炮二平五 马8进7 2. 马二进三 ……"） */
export function parseImport(text: string): { fen?: string; moves?: string[]; error?: string } {
  const s = text.trim();
  if (!s) return { error: '没有内容' };
  // FEN：八个斜杠、后面跟 w/b/r
  if (/^[rnbakcpRNBAKCPheHE1-9]+(\/[rnbakcpRNBAKCPheHE1-9]+){9}\s+[wbr]/.test(s)) {
    return fromFen(s.split(/\s+/).slice(0, 2).join(' ').replace(/ r$/, ' w')) ? { fen: s } : { error: 'FEN 读不出来' };
  }
  const norm = s
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/\d+\s*[.．、]/g, ' ')
    .replace(/[,，;；。()（）]/g, ' ');
  const tokens = norm.split(/\s+/).filter((x) => x.length >= 4);
  let b = initialBoard();
  let c: Color = 'r';
  const moves: string[] = [];
  for (const tk of tokens) {
    const t = tk.slice(0, 4);
    const m = textToMove(b, c, t, legalMoves(b, c));
    if (!m) return moves.length ? { moves, error: `第 ${moves.length + 1} 手「${t}」走不通，读到这里为止` } : { error: `「${t}」走不通` };
    moves.push(moveToText(b, m));
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return moves.length ? { moves } : { error: '没找到着法' };
}

