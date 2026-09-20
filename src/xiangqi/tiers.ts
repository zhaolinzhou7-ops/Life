/**
 * 走法梯次与棋理解释。
 *
 * 用户的原话是："我需要他指导的是全局层面的走法梯次：最优选走哪里、
 * 次选走哪里，哪些是良、哪些是中或差，而不是只盯着单个子。"
 *
 * 这个模块干两件事：
 *   1. 把引擎排出来的**整张着法表**分成梯次，一眼看清这个局面有哪些选择、
 *      各自差多少。这比"你这手错了"有用得多——下棋是在一堆候选里选，
 *      不是在对错之间选。
 *   2. 用**评估分项的差值**解释为什么，而不是我手写的那几条启发式。
 *      分项是引擎真正在算的东西（马腿、车路、炮架、将帅安全、兵卒推进），
 *      所以解释和棋力是同一套口径，不会出现"教练说好、引擎说坏"。
 */
import { applyMove, type Board, type Color, type Move } from './rules';
import { TERM_NAMES, evaluateTerms } from './ai';
import { moveToText } from './notation';
import { inPieces } from './teach';
import { INTENT_INFO, intentsOf } from './deepcoach';

export type Tier = 'best' | 'good' | 'fine' | 'ok' | 'poor' | 'bad';

export const TIER_INFO: Record<Tier, { name: string; color: string; desc: string }> = {
  best: { name: '最优', color: '#3ec46d', desc: '引擎的首选' },
  good: { name: '次选', color: '#7ec46d', desc: '和首选基本一样好，风格不同而已' },
  fine: { name: '良', color: '#c9c48a', desc: '站得住，略逊于首选' },
  ok: { name: '中', color: '#e8a33d', desc: '能走，但明显让出了一些东西' },
  poor: { name: '差', color: '#e8703d', desc: '这一手会让局面变坏' },
  bad: { name: '劣', color: '#e0433a', desc: '基本等于把局面送掉' },
};

/**
 * 按和首选的分差分梯次。
 *
 * 阈值按「兵 = 100」定：30 分以内人根本分不出差别，算同一档；
 * 差到一个马炮（450）以上，那已经是能决定胜负的差距了。
 */
export function tierOf(gap: number): Tier {
  if (gap <= 0) return 'best';
  if (gap <= 30) return 'good';
  if (gap <= 90) return 'fine';
  if (gap <= 250) return 'ok';
  if (gap <= 600) return 'poor';
  return 'bad';
}

export interface RankedMove {
  move: Move;
  text: string;
  score: number;
  gap: number;
  tier: Tier;
  /** 走完之后双方的最佳应对，已经是记谱 */
  line: string[];
  /** 这一手在棋理上做了什么（来自评估分项的变化） */
  why: string;
}

/** 杀棋分在四万以上，不能拿它做减法 */
const MATEISH = 9000;

/**
 * 把一手棋在棋理上做了什么，用分项差说出来。
 *
 * 只报**变化最大的两项**。全报一遍就又变成流水账了，而下棋的人
 * 一次只需要记住一件事。
 */
export function termReason(before: Board, m: Move, me: Color, pv?: Move[]): string {
  return diffTerms(evaluateTerms(before), evaluateTerms(atEnd(before, m, pv)), me);
}

/**
 * 走完这一手**以及它的主变**之后的局面。
 *
 * 为什么不能只看走完一手的局面：吃子的那一手在静态上永远"净赚子力"，
 * 哪怕下一步就要赔一个炮回去。拿那个局面去解释，会得出
 * "改走首选的话反而净亏子力"这种和结论正好相反的话。
 * 顺着主变走到底，兑子结算完了再看，才和引擎的判断是同一回事。
 */
function atEnd(before: Board, m: Move, pv?: Move[]): Board {
  const line = pv && pv.length ? pv : [m];
  let cur = before;
  for (const mv of line.slice(0, 8)) cur = applyMove(cur, mv);
  return cur;
}

function diffTerms(a: Int32Array, b: Int32Array, me: Color): string {
  const sgn = me === 'r' ? 1 : -1;
  const diffs: { name: string; d: number }[] = [];
  for (let i = 0; i < TERM_NAMES.length; i++) {
    const d = (b[i] - a[i]) * sgn;
    if (Math.abs(d) >= 12) diffs.push({ name: TERM_NAMES[i], d });
  }
  if (!diffs.length) return '';
  diffs.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));

  /** 每一项该怎么用象棋的话讲 */
  const say = (name: string, d: number): string => {
    const up = d > 0;
    switch (name) {
      case '马': return up ? '马活了（腿通、位置前压）' : '马被蹩住或退到了没用的地方';
      case '车': return up ? '车路打通了' : '车路被闷住了';
      case '炮': return up ? '炮找到了架子或者对准了对方老将' : '炮失去了架子，变成哑炮';
      case '将帅': return up ? '自家老将更安全了' : '自家老将那一路被照住了';
      case '兵卒': return up ? '兵向前推进，越过河的兵值钱得多' : '兵的推进受阻';
      case '子力': return up ? '净赚子力' : '净亏子力';
      case '位置': return up ? '子力站到了更好的位置' : '子力站到了更差的位置';
      default: return '';
    }
  };
  return diffs
    .slice(0, 2)
    .map((x) => say(x.name, x.d))
    .filter(Boolean)
    .join('；');
}

/**
 * 把引擎的着法表整理成梯次。
 *
 * 注意**不裁剪成三手**。用户要看的就是"这个局面一共有哪些选择"，
 * 只给三手等于又把视野缩回去了。默认给 8 手，足够看清梯次分布。
 */
export function rankMoves(
  before: Board,
  me: Color,
  scored: { move: Move; score: number; pv: Move[] }[],
  limit = 999,
): RankedMove[] {
  if (!scored.length) return [];
  const best = scored[0].score;
  return scored.slice(0, limit).map((s, idx) => {
    /*
     * 分差。**不能因为出现杀棋分就把差距一律算成 0。**
     *
     * 上一版是"两边都在杀棋区间就当作没差距"，结果在一个红方必胜的残局里，
     * 七手棋全被标成"最优"，其中还包括一手会被白吃车的棋——
     * 而下面紧接着又说"你的车会被吃掉"，自己打自己的脸。
     *
     * 杀棋分是 MATE 减去步数，所以**直接相减本来就是有意义的**：
     * 差值就是"快几步成杀"。真正需要特殊处理的只有一种情况：
     * 首选能成杀、这一手不能，那是质变，不是几十分的差距。
     */
    const bestMate = Math.abs(best) > MATEISH;
    const thisMate = Math.abs(s.score) > MATEISH;
    const gap = bestMate && !thisMate ? 9999 : Math.max(0, best - s.score);
    const line: string[] = [];
    let cur = before;
    for (const mv of s.pv.slice(0, 6)) {
      line.push(moveToText(cur, mv));
      cur = applyMove(cur, mv);
    }
    return {
      move: s.move,
      text: moveToText(before, s.move),
      score: s.score,
      gap,
      tier: tierOf(gap),
      line,
      // 只给靠前的几手算棋理说明：后面那些本来也不会推荐，算了白算
      /*
       * 每一手写"它想干什么"，用**意图**而不是分项差。
       *
       * 分项差是拿两个局面相减，而每手的主变长度不一样、轮到谁走也不一样，
       * 相减出来的东西没有可比性——上一版就因此把引擎的首选描述成
       * "净亏子力、马被蹩住"，自相矛盾。
       * 意图是纯规则算出来的（将军/捉子/出动大子/过河/占中…），
       * 不依赖任何比较基准，说出来永远成立。
       */
      why: idx < 6 ? intentNames(before, s.move, me) : '',
    };
  });
}

/** 这一手想干什么，用意图标签串起来 */
export function intentNames(before: Board, m: Move, me: Color): string {
  const names = intentsOf(before, m, me)
    .filter((i) => i !== 'quiet')
    .map((i) => INTENT_INFO[i].name);
  return names.length ? names.join('、') : '';
}

/** 一句话说清你这一手在梯次里的位置 */
export function placeInTiers(ranked: RankedMove[], played: Move): { rank: number; tier: Tier; gap: number } | null {
  const i = ranked.findIndex(
    (r) => r.move.fx === played.fx && r.move.fy === played.fy && r.move.tx === played.tx && r.move.ty === played.ty,
  );
  if (i < 0) return null;
  return { rank: i + 1, tier: ranked[i].tier, gap: ranked[i].gap };
}

/**
 * 梯次表的文字版。
 *
 * 显示前 `top` 手，**外加用户实走的那一手**——哪怕它排在第十五名。
 * 他最想知道的就是"我这手排第几、差多少"，把它省掉等于白做了这张表。
 */
export function tierTable(ranked: RankedMove[], played?: Move, top = 6): string[] {
  const isPlayed = (r: RankedMove) =>
    !!played && r.move.fx === played.fx && r.move.fy === played.fy && r.move.tx === played.tx && r.move.ty === played.ty;
  const shown = ranked.slice(0, top);
  const mineIdx = ranked.findIndex(isPlayed);
  if (mineIdx >= top) shown.push(ranked[mineIdx]);
  return shown.map((r) => {
    const mine = isPlayed(r);
    const gap = r.gap === 0 ? '' : r.gap >= 9999 ? '（首选是杀棋）' : `落后 ${r.gap}`;
    const skip = mineIdx >= top && r === ranked[mineIdx] && mineIdx > top ? `　（第 ${mineIdx + 1} 名）` : '';
    return `${TIER_INFO[r.tier].name}　**${r.text}**　${gap}${skip}${mine ? '　← 你走的' : ''}${r.why ? `\n　　${r.why}` : ''}`;
  });
}

export { inPieces };
