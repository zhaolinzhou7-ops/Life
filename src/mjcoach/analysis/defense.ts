/**
 * 防守：这张打出去有多危险。
 *
 * 四川麻将没有字牌、没有吃，防守比日麻粗糙但也更讲究——
 * 定缺让每家只剩两门，别人打出的牌门类信息量很大；
 * 血战到底里还有人已经胡了下桌，剩下的人更要防。
 *
 * 判断链条（越前面越硬）：
 *   现物（他打过的牌）→ 绝对安全，他不能胡自己打过的（本产品不做过水规则时也成立）
 *   他的缺门          → 绝对安全，缺门牌他胡不了
 *   筋牌              → 比较安全（他打过 4 万，3 万 6 万的两面就不会点）
 *   壁牌              → 某张四张都看得见，它两边的搭子不成立
 *   幺九              → 比中张安全
 *   中张无筋          → 最危险
 */

import { RANK_COUNT, rankOf, suitOf, tileName, type Counts, type TileId } from '../rules/tiles';

/** 对某一家的「读牌」结果，由引擎的公开信息推出来，不许偷看手牌 */
export interface OpponentRead {
  seat: number;
  /** 他打过的牌 */
  discards: TileId[];
  /** 他的缺门 */
  lack: number;
  /** 估计他听牌了吗 */
  ting: boolean;
  /** 听牌把握 0~1 */
  tingConfidence: number;
  /** 他副露了几副（副露越多，牌型越硬） */
  meldCount: number;
  /** 已经胡了下桌 */
  outOfPlay: boolean;
}

export interface Danger {
  /** 0 = 绝对安全，1 = 极危险 */
  value: number;
  reason: string;
}

/** 单家的危险度 */
function dangerFrom(tile: TileId, read: OpponentRead, seen?: Counts): Danger {
  if (read.outOfPlay) return { value: 0, reason: '已下桌' };
  if (read.lack >= 0 && suitOf(tile) === read.lack) {
    return { value: 0, reason: `${tileName(tile)}是他的缺门，他胡不了` };
  }
  if (read.discards.includes(tile)) {
    return { value: 0, reason: '他自己打过这张（现物）' };
  }
  if (!read.ting) {
    return { value: 0.12 * read.tingConfidence + read.meldCount * 0.04, reason: '他大概率还没听牌' };
  }

  const s = suitOf(tile);
  const r = rankOf(tile);
  const base = 0.55 + read.tingConfidence * 0.25 + read.meldCount * 0.05;

  // 筋：他打过 r-3 或 r+3，那么 r 的两面听就不成立
  const hasDiscard = (rank: number) =>
    rank >= 1 && rank <= RANK_COUNT && read.discards.includes(s * RANK_COUNT + rank - 1);
  const lowSuji = hasDiscard(r - 3);
  const highSuji = hasDiscard(r + 3);
  if (r >= 4 && r <= 6 && lowSuji && highSuji) {
    return { value: base * 0.45, reason: `两头都有筋（他打过 ${r - 3} 和 ${r + 3}），两面听不到` };
  }
  if ((r <= 3 && highSuji) || (r >= 7 && lowSuji)) {
    return { value: base * 0.55, reason: `有筋（他打过 ${r <= 3 ? r + 3 : r - 3}）` };
  }

  // 壁：某张已经四张见光，靠它的搭子就不存在了
  if (seen) {
    const wallAt = (rank: number) => rank >= 1 && rank <= RANK_COUNT && seen[s * RANK_COUNT + rank - 1] >= 4;
    if ((wallAt(r - 1) && wallAt(r + 1)) || (r <= 2 && wallAt(r + 1)) || (r >= 8 && wallAt(r - 1))) {
      return { value: base * 0.6, reason: '旁边的牌已经全部见光（壁），搭子搭不起来' };
    }
  }

  if (r === 1 || r === 9) return { value: base * 0.6, reason: '幺九牌，相对安全' };
  if (r === 2 || r === 8) return { value: base * 0.8, reason: '靠边的牌，比中张安全一点' };
  return { value: base, reason: '中张无筋，是最容易点炮的一类' };
}

/** 对全桌取最危险的一家 */
export function dangerOf(tile: TileId, reads: OpponentRead[], seen?: Counts): Danger {
  if (reads.length === 0) return { value: 0, reason: '暂时没人听牌' };
  let worst: Danger = { value: 0, reason: '各家都不像听牌' };
  for (const r of reads) {
    const d = dangerFrom(tile, r, seen);
    if (d.value > worst.value) worst = { value: d.value, reason: `${d.reason}` };
  }
  return worst;
}

/**
 * 从公开信息估某家有没有听牌。
 * 只能用看得见的东西：他打了几张、打的都是什么、副露几副、最近有没有开始打中张。
 * 这不是作弊式的「偷看手牌判断」，而是真人也能做的推断。
 */
export function readOpponent(input: {
  seat: number;
  discards: TileId[];
  lack: number;
  meldCount: number;
  outOfPlay: boolean;
  /** 本局已经打了几轮 */
  round: number;
}): OpponentRead {
  const { discards, meldCount, round } = input;
  let conf = 0;
  // 打的轮数越多越可能听牌
  conf += Math.min(0.45, round / 18);
  // 副露越多，进度越快
  conf += Math.min(0.25, meldCount * 0.1);
  // 最近三张都在打中张（4-6），说明他手里已经没废牌了
  const recent = discards.slice(-3);
  const mid = recent.filter((t) => rankOf(t) >= 4 && rankOf(t) <= 6).length;
  if (recent.length === 3) conf += mid * 0.08;
  // 开局连打幺九是正常摸牌节奏，不算听牌信号
  conf = Math.max(0, Math.min(1, conf));
  return {
    seat: input.seat,
    discards,
    lack: input.lack,
    ting: conf >= 0.55,
    tingConfidence: conf,
    meldCount,
    outOfPlay: input.outOfPlay,
  };
}

/** 一句话说清楚现在该攻还是该守 */
export function stanceAdvice(myShanten: number, reads: OpponentRead[], wallLeft: number): { stance: 'attack' | 'balance' | 'defend'; text: string } {
  const threats = reads.filter((r) => !r.outOfPlay && r.ting).length;
  if (myShanten <= 0) {
    return { stance: 'attack', text: '你已经听牌了，别人也听牌也照打——听牌不追就等于白听。' };
  }
  if (threats === 0) {
    return { stance: 'attack', text: '暂时没人像听牌，放心按效率打，先把牌做起来。' };
  }
  if (myShanten <= 1 && wallLeft > 20) {
    return { stance: 'balance', text: `有 ${threats} 家像听牌了，你还差一张听牌，可以打，但尽量选安全的那张。` };
  }
  if (myShanten >= 3 || wallLeft <= 12) {
    return { stance: 'defend', text: `有 ${threats} 家像听牌，你自己还差 ${myShanten} 张，牌墙也不多了——这时候保住不点炮比硬做牌值钱。` };
  }
  return { stance: 'balance', text: `有 ${threats} 家像听牌，攻守各半：能不拆牌就打安全张。` };
}
