/**
 * 复盘分析：一局打完，告诉用户「你哪里打错了、下次该怎么打」。
 *
 * 产品原则里最重要的一条落在这个文件：
 * **不要把几十个普通操作全部评价一遍**。
 * 一局牌玩家要做三四十个决策，其中绝大多数是显而易见的（比如只能打缺门）。
 * 把它们全列出来，用户第一次会看，第二次就直接关掉了。
 * 所以这里只挑真正影响结果的那几个——按「亏了多少」排序，取前几个，
 * 而且同类错误只留最典型的一个，避免「你打错了 8 次舍牌」这种没法消化的反馈。
 *
 * 同时必须写清楚做得好的地方。只挨骂的软件没人愿意打开第二次。
 */

import { getVariant } from '../rules/config';
import { SUIT_NAMES, tileName, tilesName, type TileId } from '../rules/tiles';
import { severityOf, type Severity } from '../analysis/efficiency';
import {
  DECISION_NAME, durationOf, rewind,
  type DecisionKind, type DecisionRecord, type GameRecord,
} from './record';

/** 错误分类：和「专项训练」的分类一一对应，这样复盘才能直接生成训练 */
export type ErrorType =
  | 'swap' // 换三张判断失误
  | 'lack' // 定缺选择不合理
  | 'efficiency' // 舍牌效率低
  | 'ting' // 错过听牌机会
  | 'defense' // 防守判断错误
  | 'gang' // 杠牌决策问题
  | 'peng'; // 碰牌决策问题

export const ERROR_INFO: Record<ErrorType, { name: string; emoji: string; desc: string; train: string }> = {
  swap: { name: '换三张', emoji: '🔄', desc: '开局换牌选得不好，等于一开始就少了底子', train: '换三张专项' },
  lack: { name: '定缺', emoji: '🎯', desc: '缺门选错，整局都在打无用的牌', train: '定缺专项' },
  efficiency: { name: '舍牌效率', emoji: '⚡', desc: '打出的牌让进张变少，离听牌更远了', train: '舍牌效率专项' },
  ting: { name: '听牌判断', emoji: '👂', desc: '有听牌的机会没抓住，或者把听牌拆了', train: '听牌专项' },
  defense: { name: '防守', emoji: '🛡️', desc: '别人听牌时打了危险牌', train: '防守专项' },
  gang: { name: '杠的判断', emoji: '💥', desc: '该杠没杠，或者杠了反而把牌搞坏', train: '杠牌专项' },
  peng: { name: '碰的判断', emoji: '🀄', desc: '碰了不该碰的，把手牌碰成一堆废牌', train: '碰牌专项' },
};

export const ERROR_TYPES: ErrorType[] = ['lack', 'swap', 'efficiency', 'ting', 'defense', 'gang', 'peng'];

export interface KeyMoment {
  decision: DecisionRecord;
  type: ErrorType;
  severity: Severity;
  /** 标题，一句话说清楚发生了什么 */
  title: string;
  /** 你选了什么 */
  yours: string;
  /** 更好的选择 */
  better: string;
  /** 为什么 */
  why: string;
  /** 大白话版本 */
  simple: string;
}

export interface Highlight {
  title: string;
  detail: string;
}

export interface GameReport {
  gameId: string;
  /** 基本数据 */
  basics: {
    result: string;
    resultKind: 'win' | 'lose' | 'draw';
    score: number;
    duration: number;
    configName: string;
    modeName: string;
    swap: string;
    lack: string;
    huInfo: string;
    decisions: number;
  };
  /** 关键失误，已按严重程度排序并去重 */
  keyMoments: KeyMoment[];
  /** 做得好的地方 */
  highlights: Highlight[];
  /** 各类错误的次数统计 */
  errorCounts: Record<ErrorType, number>;
  /** 各类决策的平均损失，用来更新用户画像 */
  errorLoss: Record<ErrorType, { count: number; totalLoss: number; sampled: number }>;
  /** 下一步训练建议 */
  suggestions: { type: ErrorType; text: string; priority: number }[];
  /** 一句话总评 */
  verdict: string;
}

/** 决策类型 → 错误分类 */
function errorTypeOf(d: DecisionRecord): ErrorType {
  switch (d.kind) {
    case 'swap': return 'swap';
    case 'lack': return 'lack';
    case 'gang': return 'gang';
    case 'peng': return 'peng';
    case 'discard': {
      const det = d.detail as { missedTing?: boolean; dangerLoss?: boolean };
      if (det?.missedTing) return 'ting';
      if (det?.dangerLoss) return 'defense';
      return 'efficiency';
    }
    default: return 'efficiency';
  }
}

function describeChoice(kind: DecisionKind, v: number | number[]): string {
  if (kind === 'lack') return `缺${SUIT_NAMES[v as number]}`;
  if (Array.isArray(v)) return tilesName(v);
  return tileName(v as number);
}

/** 生成一条关键失误的文案 */
function toKeyMoment(d: DecisionRecord): KeyMoment {
  const type = errorTypeOf(d);
  const sev = d.severity;
  const yours = describeChoice(d.kind, d.chose);
  const better = describeChoice(d.kind, d.best);
  const det = d.detail as Record<string, unknown>;

  // 换三张和定缺发生在开牌之前，写「第 0 手」会让人莫名其妙
  let title = d.turnIndex > 0 ? `第 ${d.turnIndex} 手 · ${DECISION_NAME[d.kind]}` : `开局 · ${DECISION_NAME[d.kind]}`;
  let why = '';
  let simple = '';

  if (type === 'ting') {
    title += '：错过听牌';
    why = `打 ${better} 就直接听牌了（听 ${((det.bestWaits as number[]) ?? []).map(tileName).join('、') || '—'}），` +
      `打 ${yours} 还差 ${d.shanten} 张。听牌和没听牌，在查大叔的时候就是天壤之别。`;
    simple = '你手上已经能听牌了，但打错了一张，白白多等一圈。';
  } else if (type === 'efficiency') {
    title += '：进张变少';
    why = `打 ${better} 之后能摸的有效牌有 ${d.bestUkeire} 张，打 ${yours} 只剩 ${d.ukeire} 张。` +
      `${det.role ? `${yours} 在你手里是${det.role}，` : ''}少了 ${d.bestUkeire - d.ukeire} 张进张，等于多等一两圈。`;
    simple = '这张牌其实还有用，打掉之后能摸的好牌变少了。';
  } else if (type === 'defense') {
    title += '：打了危险牌';
    why = `当时有人像是听牌了，${yours} 属于${det.dangerReason ?? '危险张'}；${better} 要安全得多。` +
      `血战到底里点一炮，后面还要继续赔，代价比想象中大。`;
    simple = '别人快胡了，这张牌太危险，应该先打安全的。';
  } else if (type === 'lack') {
    title += '：定缺不合理';
    why = `${better}更合适：${((det.bestReasons as string[]) ?? []).join('；')}。` +
      `你选的${yours}${det.chosenReason ? `——${det.chosenReason}` : ''}。`;
    simple = '缺门选错了，整局都在打没用的牌。';
  } else if (type === 'swap') {
    title += '：换三张换错了';
    why = `换 ${better} 更好：${((det.bestReasons as string[]) ?? []).join('；')}。` +
      `你换出的 ${yours}${det.brokenMelds ? `拆掉了 ${det.brokenMelds} 副已经成形的面子` : '把还有用的牌送走了'}。`;
    simple = '换牌的时候把有用的牌换出去了，开局就吃亏。';
  } else if (type === 'gang') {
    title += '：杠的判断';
    why = (det.reason as string) ?? '这个杠让手牌变差了，杠分挣的没有牌型亏的多。';
    simple = '杠不一定划算，把手牌拆散就得不偿失。';
  } else {
    title += '：碰的判断';
    why = (det.reason as string) ?? '这一碰之后手牌反而更难听牌了。';
    simple = '碰之前要想一下：碰完我还剩什么、打得出去吗。';
  }

  return { decision: d, type, severity: sev, title, yours, better, why, simple };
}

/**
 * 挑关键节点。
 * 规则：
 *   - 只看 minor 以上的（ok 的不打扰用户）
 *   - 同一类型最多留 2 个，避免刷屏
 *   - 总共最多 5 个
 *   - 定缺和换三张只有一次机会，只要不是最优就一定要说
 */
export function pickKeyMoments(decisions: DecisionRecord[], max = 5): KeyMoment[] {
  const scored = decisions
    .filter((d) => d.severity !== 'ok')
    .map(toKeyMoment)
    .sort((a, b) => b.decision.loss - a.decision.loss);

  const perType = new Map<ErrorType, number>();
  const out: KeyMoment[] = [];
  // 开局两步优先保留
  for (const m of scored) {
    if (m.type !== 'lack' && m.type !== 'swap') continue;
    out.push(m);
    perType.set(m.type, 1);
  }
  for (const m of scored) {
    if (out.length >= max) break;
    if (m.type === 'lack' || m.type === 'swap') continue;
    const n = perType.get(m.type) ?? 0;
    if (n >= 2) continue;
    perType.set(m.type, n + 1);
    out.push(m);
  }
  return out.sort((a, b) => a.decision.index - b.decision.index);
}

/** 找出做得好的地方。只夸具体的事，不说「你打得不错」这种空话 */
export function pickHighlights(rec: GameRecord, decisions: DecisionRecord[]): Highlight[] {
  const out: Highlight[] = [];
  const good = decisions.filter((d) => d.severity === 'ok');
  const total = decisions.length || 1;

  const lack = decisions.find((d) => d.kind === 'lack');
  if (lack && lack.severity === 'ok') {
    out.push({ title: '定缺选对了', detail: `开局缺${SUIT_NAMES[lack.chose as number]}是这手牌的最优选择，这一步很多人会选错。` });
  }
  const swap = decisions.find((d) => d.kind === 'swap');
  if (swap && swap.severity === 'ok') {
    out.push({ title: '换三张换得干净', detail: `换出 ${tilesName(swap.chose as number[])}，没有动到已经成形的牌。` });
  }
  const ratio = good.length / total;
  if (ratio >= 0.8 && total >= 8) {
    out.push({ title: '出牌整体稳', detail: `${total} 个决策里有 ${good.length} 个是最优或接近最优（${Math.round(ratio * 100)}%）。` });
  }
  const bestTing = decisions.filter((d) => (d.detail as { ting?: boolean })?.ting);
  if (bestTing.length) {
    out.push({ title: '抓住了听牌机会', detail: `本局有 ${bestTing.length} 次在该听牌的时候听上了。` });
  }
  if (rec.heroWon) {
    out.push({
      title: rec.heroWinNames.length ? `胡牌：${rec.heroWinNames.join('·')}` : '胡牌',
      detail: `${rec.heroFan} 番，净得 ${rec.scores[rec.heroSeat] > 0 ? '+' : ''}${rec.scores[rec.heroSeat]} 分。`,
    });
  } else if (!decisions.some((d) => d.severity === 'blunder')) {
    out.push({ title: '没有大错', detail: '这局虽然没胡，但没有出现明显失误，牌不好的时候能不亏就是赢。' });
  }
  return out.slice(0, 4);
}

/** 生成完整的本局报告 */
export function buildReport(rec: GameRecord): GameReport {
  const cfg = getVariant(rec.configId);
  const decisions = rec.decisions;
  const keyMoments = pickKeyMoments(decisions);
  const highlights = pickHighlights(rec, decisions);

  const errorCounts = Object.fromEntries(ERROR_TYPES.map((t) => [t, 0])) as Record<ErrorType, number>;
  const errorLoss = Object.fromEntries(
    ERROR_TYPES.map((t) => [t, { count: 0, totalLoss: 0, sampled: 0 }]),
  ) as Record<ErrorType, { count: number; totalLoss: number; sampled: number }>;

  for (const d of decisions) {
    const t = errorTypeOf(d);
    errorLoss[t].sampled++;
    errorLoss[t].totalLoss += d.loss;
    if (d.severity !== 'ok') {
      errorCounts[t]++;
      errorLoss[t].count++;
    }
  }

  const score = rec.scores[rec.heroSeat] ?? 0;
  const resultKind: 'win' | 'lose' | 'draw' = rec.heroWon ? 'win' : rec.exhausted ? 'draw' : 'lose';
  const lackDec = decisions.find((d) => d.kind === 'lack');
  const swapDec = decisions.find((d) => d.kind === 'swap');

  // 训练建议：按「出错次数 × 平均损失」排，只给最该练的两三项
  const suggestions = ERROR_TYPES.map((t) => {
    const e = errorLoss[t];
    const avg = e.sampled ? e.totalLoss / e.sampled : 0;
    const priority = e.count * 10 + avg;
    return { type: t, priority, text: '' };
  })
    .filter((s) => s.priority > 4)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 3)
    .map((s) => ({
      ...s,
      text: `${ERROR_INFO[s.type].emoji} ${ERROR_INFO[s.type].name}：本局出现 ${errorCounts[s.type]} 次问题，建议做${ERROR_INFO[s.type].train}。`,
    }));

  let verdict: string;
  const blunders = decisions.filter((d) => d.severity === 'blunder').length;
  if (rec.heroWon && blunders === 0) verdict = '这局打得漂亮：牌走得顺，也没有明显失误。';
  else if (rec.heroWon) verdict = '胡是胡了，但中间有几步走了弯路，看看下面的关键节点。';
  else if (blunders > 0) verdict = `这局有 ${blunders} 处明显失误，先把它们看懂，比多打十局都有用。`;
  else if (resultKind === 'draw') verdict = '流局。牌型没做起来的时候，能保住听牌不被查叫就算及格。';
  else verdict = '这局没上，但失误不多——麻将本来就有运气成分，按正确的方法打就行。';

  return {
    gameId: rec.id,
    basics: {
      result: resultKind === 'win' ? `胡牌 ${rec.heroFan} 番` : resultKind === 'draw' ? '流局' : '没胡',
      resultKind,
      score,
      duration: durationOf(rec),
      configName: cfg.name,
      modeName: rec.mode,
      swap: swapDec ? `换出 ${tilesName(swapDec.chose as number[])}` : '本局不换三张',
      lack: lackDec ? `缺${SUIT_NAMES[lackDec.chose as number]}` : '—',
      huInfo: rec.heroWon ? rec.heroWinNames.join('·') : resultKind === 'draw' ? '流局' : '未胡牌',
      decisions: decisions.length,
    },
    keyMoments,
    highlights,
    errorCounts,
    errorLoss,
    suggestions,
    verdict,
  };
}

/** 复盘时间线：把每一步做成可点的节点 */
export interface TimelineNode {
  index: number;
  turnIndex: number;
  seat: number;
  text: string;
  kind: string;
  /** 是不是玩家的关键决策 */
  key: boolean;
  severity?: Severity;
}

export function buildTimeline(rec: GameRecord): TimelineNode[] {
  const keyIdx = new Map(rec.decisions.map((d) => [d.index, d]));
  const out: TimelineNode[] = [];
  const names = ['你', '下家', '对家', '上家'];
  const nameOf = (seat: number) => (seat === rec.heroSeat ? '你' : names[(seat - rec.heroSeat + 4) % 4]);

  rec.actions.forEach((a, i) => {
    const d = keyIdx.get(i);
    let text = '';
    switch (a.type) {
      case 'swap': text = `${nameOf(a.seat)} 换出 ${tilesName(a.tiles)}`; break;
      case 'lack': text = `${nameOf(a.seat)} 定缺${SUIT_NAMES[a.suit]}`; break;
      case 'discard': text = `${nameOf(a.seat)} 打 ${tileName(a.tile)}`; break;
      case 'peng': text = `${nameOf(a.seat)} 碰 ${tileName(a.tile)}`; break;
      case 'gang': text = `${nameOf(a.seat)} ${a.kind === 'angang' ? '暗杠' : a.kind === 'bugang' ? '补杠' : '明杠'} ${tileName(a.tile)}`; break;
      case 'hu': text = `${nameOf(a.seat)} 胡 ${tileName(a.tile)}`; break;
      case 'pass': text = `${nameOf(a.seat)} 过`; break;
    }
    out.push({
      index: i,
      turnIndex: d?.turnIndex ?? 0,
      seat: a.seat,
      text,
      kind: a.type,
      key: !!d && d.severity !== 'ok',
      severity: d?.severity,
    });
  });
  return out;
}

/** 把牌局倒回某个决策点，复盘界面要在那个局面上摆牌 */
export function stateAt(rec: GameRecord, index: number) {
  return rewind(rec, index).snapshot();
}

/** 严重程度 → 颜色，UI 统一用这一份 */
export const SEVERITY_COLOR: Record<Severity, string> = {
  ok: '#4a9d5b',
  minor: '#d0a23a',
  major: '#e08040',
  blunder: '#d9534f',
};

export { severityOf };
export type { Severity, TileId };
