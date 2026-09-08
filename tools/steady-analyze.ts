/**
 * 「搜到指定层数才算数」的分析。
 *
 * 【为什么要专门做这个】引擎的搜索是按毫秒截断的：时限一到就返回当前层数的
 * 结果，而返回值里并不写着"我没搜够"。于是同一个局面，机器闲时和忙时会得到
 * 不同的结论——这在这个项目里造成过两次实打实的数据错误：
 *
 *   · 残局：机器上还跑着别的任务时，「单车对马双士」判出 0 胜 4 和；
 *     机器空下来重跑是 3 胜 1 和。搜不到层数 → 引擎变弱 → 赢不下来 → 记成"和"。
 *   · 杀法题：全量修完之后体检又报出一道题漏了一手同样快的杀法。
 *     两次用的是同一组参数，差别只在当时机器忙不忙。
 *
 * **离线生成的数据不能随机器负载而变。** analyze() 本来就返回真正搜到的
 * 层数，只是之前没人看它。这里把它用起来：搜不够就加时重试，实在搜不到
 * 就明说，而不是拿一个半截结果当结论。
 */
import { analyze, type Analysis } from '../src/xiangqi/ai';
import type { Board, Color } from '../src/xiangqi/rules';

export interface SteadyResult extends Analysis {
  /** 是否真的搜到了要求的层数。false 表示这个结果不该拿去写进数据 */
  full: boolean;
}

/**
 * 一直加时直到真的搜到 depth 层。
 *
 * @param timeMs 第一次给多少时间，之后每次翻倍
 * @param tries  最多试几次
 */
export function steadyAnalyze(
  b: Board,
  c: Color,
  depth: number,
  timeMs = 4000,
  tries = 4,
): SteadyResult {
  let t = timeMs;
  let a: Analysis = { moves: [], depth: 0, nodes: 0 };
  for (let i = 0; i < tries; i++) {
    a = analyze(b, c, { maxDepth: depth, timeMs: t, jitter: 0 });
    if (a.depth >= depth) return { ...a, full: true };
    t *= 2;
  }
  return { ...a, full: false };
}
