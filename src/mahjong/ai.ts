/** 麻将 AI：定缺、出牌与碰杠决策（听牌优先 + 搭子启发式） */
import { suitOf, rankOf, waitingTiles, type Counts, type TileId } from './rules';

/** 定缺：选牌最少的一门 */
export function chooseLack(c: Counts): number {
  let best = 0;
  let bestN = Infinity;
  for (let s = 0; s < 3; s++) {
    let n = 0;
    for (let r = 0; r < 9; r++) n += c[s * 9 + r];
    if (n < bestN) {
      bestN = n;
      best = s;
    }
  }
  return best;
}

/** 单张牌对手牌的保留价值（越低越该打） */
function tileValue(c: Counts, t: TileId): number {
  const r = rankOf(t);
  let v = 0;
  if (c[t] >= 2) v += 6 * (c[t] - 1); // 对子/刻子
  const s = suitOf(t);
  const at = (rr: number) => (rr >= 1 && rr <= 9 ? c[s * 9 + rr - 1] : 0);
  v += (at(r - 1) + at(r + 1)) * 3; // 两面/边搭
  v += (at(r - 2) + at(r + 2)) * 1.2; // 坎搭
  v += 1 - Math.abs(5 - r) * 0.12; // 中张略优
  return v;
}

/** 选择要打的牌：先清缺门；否则优先打出后能听牌（听口越宽越好）的牌，再退回搭子价值 */
export function chooseDiscard(c: Counts, lack: number, noMelds = true): TileId {
  // 有缺门必须先打缺门（打价值最低的那张）
  let lackBest = -1;
  let lackVal = Infinity;
  for (let t = 0; t < 27; t++) {
    if (c[t] > 0 && suitOf(t) === lack) {
      const v = tileValue(c, t);
      if (v < lackVal) {
        lackVal = v;
        lackBest = t;
      }
    }
  }
  if (lackBest >= 0) return lackBest;

  // 尝试每种打法：能听牌的打法绝对优先，听的张数（含剩余枚数权重）越多越好
  let best = -1;
  let bestWaits = -1;
  let bestVal = Infinity;
  for (let t = 0; t < 27; t++) {
    if (c[t] === 0) continue;
    c[t]--;
    const waits = waitingTiles(c, noMelds, lack);
    let w = 0;
    for (const wt of waits) w += 4 - c[wt]; // 剩余可摸/可点的枚数
    c[t]++;
    const v = tileValue(c, t);
    if (w > bestWaits || (w === bestWaits && v < bestVal)) {
      bestWaits = w;
      bestVal = v;
      best = t;
    }
  }
  return best;
}

/** 是否碰：缺门牌不碰；对对倾向或边张更愿意碰 */
export function wantPeng(_c: Counts, t: TileId, lack: number, pengCount: number): boolean {
  if (suitOf(t) === lack) return false;
  const r = rankOf(t);
  if (pengCount >= 2) return true; // 已经在做对对胡
  if (r <= 2 || r >= 8) return true; // 边张搭子价值低，碰划算
  return Math.random() < 0.55;
}

/** 是否明杠（别人打出第 4 张）：缺门不杠，其余都杠（根翻倍） */
export function wantGang(t: TileId, lack: number): boolean {
  return suitOf(t) !== lack;
}
