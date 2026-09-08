/**
 * 题库的加载与选题。
 *
 * 题目全部由 tools/gen-puzzles.ts 离线生成、并且**每一道都过了引擎验证**
 * （答案唯一、步数准确、初始不将军），所以这里不用再校验，只管挑题。
 *
 * 题库按需加载：首页不该为了显示一个"开始测评"按钮就下几百 KB 题目。
 */
import type { Dim } from './save';
import { getOwnPuzzles, effectiveRating } from './save';

export type PuzzleKind = 'mate' | 'tactic' | 'safety' | 'endgame' | 'opening';

export interface Puzzle {
  id: string;
  kind: PuzzleKind;
  fen: string;
  answer: string;
  line: string[];
  mateIn?: number;
  rating: number;
  /**
   * 这道题是从真实对局里"有人在这里走错了"提取出来的，这是那手错着。
   *
   * 有这个字段的题比随机造的更值得做：错误选项是**真的有人选过**的，
   * 说明它看起来足够像好棋——那才是做题时真正的障碍。
   */
  blunder?: string;
}

/** 题型就是能力维度，一一对应 */
export const KIND_DIM: Record<PuzzleKind, Dim> = {
  mate: 'mate',
  tactic: 'tactic',
  safety: 'safety',
  endgame: 'endgame',
  opening: 'opening',
};

export const KIND_NAME: Record<PuzzleKind, string> = {
  mate: '杀法',
  tactic: '战术',
  safety: '眼力',
  endgame: '残局',
  opening: '布局',
};

/** 每类题的提问方式不一样，问对了学生才知道在找什么 */
export const KIND_PROMPT: Record<PuzzleKind, string> = {
  mate: '找出杀棋',
  tactic: '找出赢子的一手',
  safety: '只有一步不亏子，找出来',
  endgame: '这个残局，哪一手才对？',
  opening: '开局这一手该怎么走？',
};

let cache: Puzzle[] | null = null;
let loading: Promise<Puzzle[]> | null = null;

/** 加载题库（只下载一次） */
export function loadPuzzles(): Promise<Puzzle[]> {
  if (cache) return Promise.resolve(cache);
  if (loading) return loading;
  loading = import('./puzzles.json')
    .then((m) => {
      cache = ((m.default ?? m) as Puzzle[]).slice();
      return cache;
    })
    .catch(() => {
      // 题库缺失时不能把整个学棋模块拖垮，返回空表让上层提示
      cache = [];
      return cache;
    });
  return loading;
}

export function allPuzzles(): Puzzle[] {
  return cache ?? [];
}

export function byKind(kind: PuzzleKind): Puzzle[] {
  return (cache ?? []).filter((p) => p.kind === kind);
}

export function byId(id: string): Puzzle | undefined {
  // own- 开头的是你自己实战里的漏着，存在存档里而不是题库里
  if (id.startsWith('own-')) return getOwnPuzzles().find((p) => p.id === id);
  return (cache ?? []).find((p) => p.id === id);
}

/**
 * 挑一道难度最贴近 rating 的题。
 *
 * 不取"最接近的那一道"而是在最接近的若干道里随机——否则同一个分数段
 * 每次都出同一道题，第二次做就成了背答案。
 */
export function pickNear(kind: PuzzleKind, rating: number, exclude: Set<string>, pool = 6): Puzzle | null {
  const cand = byKind(kind).filter((p) => !exclude.has(p.id));
  if (!cand.length) return null;
  // 按**自校准后**的难度挑题：你做过的题，难度已经按你的实际表现修正过，
  // 比引擎标称的准。没做过的题就用标称值。
  const dist = (p: Puzzle) => Math.abs(effectiveRating(p.id, p.rating) - rating);
  cand.sort((a, b) => dist(a) - dist(b));
  const n = Math.min(pool, cand.length);
  return cand[(Math.random() * n) | 0];
}

/** 某一类题的难度跨度，用来告诉用户这类题能测到什么范围 */
export function ratingRange(kind: PuzzleKind): [number, number] {
  const list = byKind(kind);
  if (!list.length) return [0, 0];
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of list) {
    if (p.rating < lo) lo = p.rating;
    if (p.rating > hi) hi = p.rating;
  }
  return [lo, hi];
}
