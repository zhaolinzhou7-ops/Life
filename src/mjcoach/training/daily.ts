/**
 * 今日训练：把实战里的问题变成题。
 *
 * 这是整个产品闭环的接头处：
 *   打一局 → 复盘发现问题 → **今日训练（本文件）** → 练完 → 再实战
 *
 * 出题优先级：
 *   1. 错题本里到期该复习的（间隔重复，忘了正好补）
 *   2. 用真实牌局里打错的那一手直接出题——「你上一局就是这里错的」比任何题库都有说服力
 *   3. 用画像里最弱的那一项补足剩下的
 *
 * 每天的题固定：同一天进来看到的是同一组题，答完才换。
 * 不这么做的话，用户刷新一次就换一批题，练习就失去了「今天练完了」的确定感。
 */

import { VARIANT_CHENGDU, getVariant } from '../rules/config';
import { toTiles, type TileId } from '../rules/tiles';
import { analyzeDiscards } from '../analysis/efficiency';
import { ERROR_INFO, type ErrorType } from '../replay/analyze';
import { loadGames, rewind, type GameRecord, type DecisionRecord } from '../replay/record';
import {
  dueSrsCards, loadProfile, todayNum, trainingPlan, type Profile,
} from '../profile/store';
import {
  ALL_LESSONS, makePuzzle, type Lesson, type Puzzle,
} from './bank';

export interface DailySet {
  day: number;
  puzzles: Puzzle[];
  /** 每道题为什么出给你 */
  reasons: string[];
  /** 今日训练的主题 */
  theme: string;
  /** 主题说明 */
  themeDesc: string;
}

const DAILY_COUNT = 5;

/** 错误类型 → 最合适的课 */
function lessonFor(type: ErrorType, difficulty: 1 | 2 | 3 = 2): Lesson {
  const byType = ALL_LESSONS.filter((l) => l.type === type);
  if (!byType.length) return ALL_LESSONS.find((l) => l.id === 'eff-basic')!;
  // 优先选难度接近的
  return byType.sort((a, b) => Math.abs(a.difficulty - difficulty) - Math.abs(b.difficulty - difficulty))[0];
}

/**
 * 从真实牌局的一个决策点造题。
 * 这类题最有价值：局面是你自己打出来的，答案是当时就该选的那个。
 */
export function puzzleFromDecision(game: GameRecord, d: DecisionRecord): Puzzle | null {
  if (d.kind !== 'discard') return null;
  let engine;
  try {
    engine = rewind(game, d.index);
  } catch {
    return null; // 牌谱来自旧版本、重放不出来，就跳过，不能让训练页崩掉
  }
  const cfg = getVariant(game.configId);
  const p = engine.players[game.heroSeat];
  if (engine.phase !== 'turn' || engine.turn !== game.heroSeat) return null;

  const a = analyzeDiscards({
    cfg, hand: p.hand, melds: p.melds, lack: p.lack,
    seen: engine.seenBy(game.heroSeat),
    wallLeft: engine.wallLeft,
    legal: engine.legalDiscards(game.heroSeat),
  });
  if (a.options.length < 2) return null;

  const best = a.best;
  const chosen = a.options.find((o) => o.tile === (d.chose as number));
  const explain =
    `**这是你上一局第 ${d.turnIndex} 手的真实局面。**\n\n` +
    (best.ting
      ? `打 ${best.name} 就听牌了，听 ${best.waits.length} 种牌。`
      : `打 ${best.name} 之后还能摸 ${best.ukeire} 张有效牌。`) +
    (chosen && chosen.tile !== best.tile
      ? `\n\n当时你打的是 ${chosen.name}，只剩 ${chosen.ukeire} 张进张${chosen.shanten > best.shanten ? `，而且离听牌更远了` : ''}。`
      : '') +
    `\n\n${best.name} 在你手里是${best.role}。`;

  return {
    id: `real-${game.id}-${d.index}`,
    kind: 'discard',
    type: 'efficiency',
    lessonId: 'discard-mid',
    title: '你的真实牌局',
    prompt: `这是你上一局打过的局面（第 ${d.turnIndex} 手）。这次，你会打哪张？`,
    difficulty: 2,
    hand: toTiles(p.hand),
    melds: p.melds,
    lack: p.lack,
    configId: game.configId,
    answer: best.tile,
    accept: a.options.filter((o) => best.score - o.score < 4).map((o) => o.tile),
    explain,
    hints: [
      '先看手上还有没有缺门牌。',
      '把牌拆成面子、搭子、孤张，孤张最先走。',
      `最优解留下 ${best.ukeire} 张进张。`,
    ],
    seed: d.index,
  };
}

/** 生成今天的训练 */
export function buildDaily(profile?: Profile): DailySet {
  const p = profile ?? loadProfile();
  const day = todayNum();
  const puzzles: Puzzle[] = [];
  const reasons: string[] = [];
  const used = new Set<string>();

  const push = (pz: Puzzle | null, reason: string) => {
    if (!pz || used.has(pz.id) || puzzles.length >= DAILY_COUNT) return;
    used.add(pz.id);
    puzzles.push(pz);
    reasons.push(reason);
  };

  // 1. 错题本到期的
  for (const card of dueSrsCards(p)) {
    if (puzzles.length >= 2) break; // 复习最多占两道，剩下的留给新题
    const lesson = ALL_LESSONS.find((l) => l.id === (card.payload.lessonId as string)) ?? lessonFor(card.type);
    push(makePuzzle(lesson, Number(card.payload.seed ?? day)), `错题复习：上次做错了 ${card.wrongCount} 次`);
  }

  // 2. 真实牌局里打错的那几手
  const games = loadGames().slice(0, 6);
  const realMistakes: { g: GameRecord; d: DecisionRecord }[] = [];
  for (const g of games) {
    for (const d of g.decisions) {
      if (d.kind === 'discard' && (d.severity === 'major' || d.severity === 'blunder')) {
        realMistakes.push({ g, d });
      }
    }
  }
  realMistakes.sort((a, b) => b.d.loss - a.d.loss);
  for (const { g, d } of realMistakes.slice(0, 2)) {
    push(puzzleFromDecision(g, d), `来自你 ${new Date(g.startedAt).toLocaleDateString('sv')} 的那一局`);
  }

  // 3. 按弱项补齐
  const plan = trainingPlan(p);
  let planIdx = 0;
  let guard = 0;
  while (puzzles.length < DAILY_COUNT && guard++ < 30) {
    const item = plan[planIdx % plan.length];
    planIdx++;
    const skill = p.skills[item.type];
    const diff: 1 | 2 | 3 = skill.samples < 10 ? 1 : skill.errors / Math.max(1, skill.samples) > 0.3 ? 1 : 2;
    const lesson = lessonFor(item.type, diff);
    push(makePuzzle(lesson, day * 31 + guard * 7 + planIdx), item.reason);
  }

  // 主题：今天练得最多的那一类
  const counts = new Map<ErrorType, number>();
  for (const pz of puzzles) counts.set(pz.type, (counts.get(pz.type) ?? 0) + 1);
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const theme = top ? ERROR_INFO[top[0]].name : '综合';
  const themeDesc = top ? ERROR_INFO[top[0]].desc : '各项都练一点';

  return { day, puzzles, reasons, theme, themeDesc };
}

/** 专项训练：指定一课，生成一组题 */
export function buildLessonSet(lessonId: string, seed = Date.now() % 100000): { lesson: Lesson; puzzles: Puzzle[] } | null {
  const lesson = ALL_LESSONS.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const puzzles: Puzzle[] = [];
  const seen = new Set<string>();
  for (let i = 0; puzzles.length < lesson.count && i < lesson.count * 12; i++) {
    const pz = makePuzzle(lesson, seed + i * 977, VARIANT_CHENGDU);
    if (pz && !seen.has(pz.id)) {
      seen.add(pz.id);
      puzzles.push(pz);
    }
  }
  return { lesson, puzzles };
}

/** 今日训练完成情况存在这里，同一天不重复要求做 */
const DONE_KEY = 'mjcoach-daily-done-v1';

export function loadDailyDone(): { day: number; done: string[] } {
  try {
    const raw = localStorage.getItem(DONE_KEY);
    if (!raw) return { day: todayNum(), done: [] };
    const o = JSON.parse(raw) as { day: number; done: string[] };
    return o.day === todayNum() ? o : { day: todayNum(), done: [] };
  } catch {
    return { day: todayNum(), done: [] };
  }
}

export function markDailyDone(puzzleId: string) {
  const cur = loadDailyDone();
  if (!cur.done.includes(puzzleId)) cur.done.push(puzzleId);
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify(cur));
  } catch {
    /* 存不下就存不下，不影响做题 */
  }
}

export type { Puzzle, TileId };
