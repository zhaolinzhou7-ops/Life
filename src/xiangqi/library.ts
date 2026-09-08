/**
 * 内容库：杀法图形 + 实用残局。
 *
 * 两个库都是「引擎生成 + 引擎验证」出来的，不是我凭记忆写的：
 *   杀法图形——先由引擎造出唯一解的 N 回合杀，再用几何判定认出这是哪种图形
 *   实用残局——给定子力组合造局面，由引擎双方对下到底，实测是胜是和
 *
 * 一开始我是反过来做的（手工摆图形再验），12 个图形 12 个都不对：
 * 有的起手就已经将着军、有的根本不成杀、有的答案不唯一。棋盘几何错一格，
 * 题就是错的，而错的教材比没有教材更糟。所以正确性必须由可执行的判定担保。
 */
import type { Color } from './rules';

// ---------------- 杀法图形 ----------------

export interface MatePattern {
  id: string;
  /** 图形名字。记住名字才谈得上迁移——下次一眼认出来 */
  name: string;
  /** 这个图形长什么样 */
  shape: string;
  /** 为什么成立 */
  why: string;
  fen: string;
  /** 正解首着（中文记谱） */
  answer: string;
  /** 和正解一样快的其它杀法，判对错时一起算对 */
  also?: string[];
  /** 完整杀法 */
  line: string[];
  mateIn: number;
  rating: number;
}

// ---------------- 实用残局 ----------------

export interface EndgamePos {
  id: string;
  name: string;
  category: string;
  material: string;
  fen: string;
  you: Color;
  /**
   * 这一局的结果：你能赢，还是只能守和。
   *
   * 怎么定的（第一版这里出过大错，值得写清楚）：
   *   1. 引擎双方实战下到底，用的是**较强设置**；
   *   2. 下成和不算数——要换更强的一档再试一次，还赢不了才记"和"。
   *      第一版就是缺了这一步，把"引擎不会走"记成了"这局是和棋"，
   *      于是单车对双士这种教科书例胜被标成"只能和"，教了个假结论；
   *   3. 结论已经确定的子力组合（单车对双士例胜、单车对士象全例和……）
   *      还要和定式对得上，对不上的局面直接不入库。
   *
   * 同一个名目下结果不一样是正常的——摆法不同，结果就不同。
   * "先判断这局是赢是和"本身就是残局功力的核心，所以界面上会先让你猜。
   */
  target: 'win' | 'draw';
  goal: string;
  tips: string[];
  plies: number;
  /**
   * 这个结果是怎么走出来的：将死/困毙、60 回合无吃子、三次重复、打满没分出胜负。
   *
   * 标"和"有两种完全不同的意思——局面本来就是和棋，还是**在 60 回合无吃子
   * 判和这条规则下走不出胜果**。后者可能和棋书上的理论结论不一样，
   * 界面上必须说清楚，否则会被当成软件算错了。
   */
  reason?: string;
  rating: number;
}

let mateCache: MatePattern[] | null = null;
let egCache: EndgamePos[] | null = null;
let loading: Promise<void> | null = null;

/** 两个库一起按需加载，不进首屏 */
export function loadLibrary(): Promise<void> {
  if (mateCache && egCache) return Promise.resolve();
  if (loading) return loading;
  loading = Promise.all([
    import('./matepatterns.json').then((m) => {
      mateCache = ((m.default ?? m) as MatePattern[]).slice();
    }),
    import('./endgamelib.json').then((m) => {
      egCache = ((m.default ?? m) as EndgamePos[]).slice();
    }),
  ])
    .then(() => undefined)
    .catch(() => {
      // 数据缺失时不能把整个学棋模块拖垮
      mateCache ??= [];
      egCache ??= [];
    });
  return loading;
}

export const allMatePatterns = (): MatePattern[] => mateCache ?? [];
export const allEndgames = (): EndgamePos[] => egCache ?? [];

/** 杀法图形按名字分组，界面按「一个图形一课」来组织 */
export function matesByName(): { name: string; shape: string; why: string; items: MatePattern[] }[] {
  const map = new Map<string, MatePattern[]>();
  for (const p of allMatePatterns()) {
    const arr = map.get(p.name) ?? [];
    arr.push(p);
    map.set(p.name, arr);
  }
  return [...map.entries()]
    .map(([name, items]) => {
      items.sort((a, b) => a.mateIn - b.mateIn || a.rating - b.rating);
      return { name, shape: items[0].shape, why: items[0].why, items };
    })
    .sort((a, b) => a.items[0].rating - b.items[0].rating);
}

/** 残局按子力组合分组 */
export function endgamesByName(): { name: string; category: string; material: string; goal: string; tips: string[]; items: EndgamePos[] }[] {
  const map = new Map<string, EndgamePos[]>();
  for (const e of allEndgames()) {
    const arr = map.get(e.name) ?? [];
    arr.push(e);
    map.set(e.name, arr);
  }
  return [...map.entries()].map(([name, items]) => ({
    name,
    category: items[0].category,
    material: items[0].material,
    goal: items[0].goal,
    tips: items[0].tips,
    items,
  }));
}

export const mateById = (id: string) => allMatePatterns().find((p) => p.id === id);
export const endgameById = (id: string) => allEndgames().find((e) => e.id === id);
