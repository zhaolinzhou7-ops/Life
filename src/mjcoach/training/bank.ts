/**
 * 题库与出题器。
 *
 * 不用手写题库，而是**按种子生成 + 用分析层验证**。三个理由：
 *   1. 手写几百道题既慢又容易写错，而答案错了的教学题比没有更糟
 *   2. 生成的题目答案由同一套分析层算出来，和实战里的建议永远一致
 *   3. 想练多少道有多少道，还能按用户弱项定向出题
 *
 * 关键是**筛题**：随机牌大多没有明确答案（第一名和第二名差不多），
 * 这种题拿来考人是耍流氓。所以每道题都要求最优解和次优解拉开足够差距，
 * 差距不够就换一手牌重新生成。难度就是靠这个差距阈值调的——
 * 简单题差距大（一眼能看出来），难题差距小（要算一算）。
 */

import { VARIANT_CHENGDU, type RuleConfig } from '../rules/config';
import {
  RANK_COUNT, Rng, SUIT_NAMES, tileName, tilesName, toCounts,
  type Counts, type Meld, type Suit, type TileId,
} from '../rules/tiles';
import { waitingTiles } from '../rules/win';
import { analyzeDiscards } from '../analysis/efficiency';
import { analyzeLack } from '../analysis/dingque';
import { analyzeSwap } from '../analysis/swap';
import { shantenWithLack } from '../analysis/shanten';
import { readOpponent, type OpponentRead } from '../analysis/defense';
import type { ErrorType } from '../replay/analyze';

export type PuzzleKind = 'discard' | 'lack' | 'swap' | 'ting' | 'claim' | 'quiz';

export interface PuzzleChoice {
  key: string;
  text: string;
  /** 牌型题里这个选项对应的牌 */
  tiles?: TileId[];
}

export interface Puzzle {
  id: string;
  kind: PuzzleKind;
  /** 对应哪一项能力，答完要写回画像 */
  type: ErrorType;
  lessonId: string;
  title: string;
  /** 题干 */
  prompt: string;
  difficulty: 1 | 2 | 3;
  /** 局面 */
  hand: TileId[];
  melds: Meld[];
  lack: number;
  configId: string;
  /** 情景信息（残局/防守题要用） */
  scene?: { wallLeft: number; reads: OpponentRead[]; sceneText: string };
  /** 选择题的选项；牌型题为空，直接点手牌作答 */
  choices?: PuzzleChoice[];
  /** 正确答案：出牌题是 tile，定缺题是花色，换三张是三张牌，选择题是 key */
  answer: number | number[] | string;
  /** 可接受的答案（并列最优时不能判错） */
  accept: (number | string)[];
  /** 判对之后的解释 */
  explain: string;
  /** 分级提示：想不出来时一层层给 */
  hints: string[];
  /** 生成参数，用于「再来一道类似的」和错题重现 */
  seed: number;
}

export interface Lesson {
  id: string;
  title: string;
  desc: string;
  kind: PuzzleKind;
  type: ErrorType;
  difficulty: 1 | 2 | 3;
  /** 一组几道题 */
  count: number;
}

export interface Course {
  id: string;
  name: string;
  emoji: string;
  desc: string;
  lessons: Lesson[];
}

// ==================== 课程表 ====================

export const COURSES: Course[] = [
  {
    id: 'basic',
    name: '基础',
    emoji: '📗',
    desc: '第一次打四川麻将，先把牌和规则认全',
    lessons: [
      { id: 'know-tiles', title: '认识牌', desc: '万条筒各是什么样，一共多少张', kind: 'quiz', type: 'efficiency', difficulty: 1, count: 6 },
      { id: 'basic-rules', title: '基本规则', desc: '定缺、换三张、碰杠、血战到底都是什么', kind: 'quiz', type: 'efficiency', difficulty: 1, count: 8 },
      { id: 'win-condition', title: '胡牌条件', desc: '什么样的牌算胡，什么样的不算', kind: 'quiz', type: 'ting', difficulty: 1, count: 8 },
    ],
  },
  {
    id: 'inter',
    name: '进阶',
    emoji: '📘',
    desc: '四川麻将真正的门槛：换三张、定缺、牌效率',
    lessons: [
      { id: 'swap-basic', title: '换三张', desc: '哪三张该换出去', kind: 'swap', type: 'swap', difficulty: 1, count: 5 },
      { id: 'lack-basic', title: '定缺', desc: '该缺哪一门，为什么不是「哪门少缺哪门」', kind: 'lack', type: 'lack', difficulty: 1, count: 5 },
      { id: 'eff-basic', title: '牌效率入门', desc: '孤张、搭子、面子，先打哪个', kind: 'discard', type: 'efficiency', difficulty: 1, count: 5 },
      { id: 'discard-mid', title: '舍牌选择', desc: '两个搭子只能留一个的时候怎么选', kind: 'discard', type: 'efficiency', difficulty: 2, count: 5 },
    ],
  },
  {
    id: 'tactic',
    name: '战术',
    emoji: '📙',
    desc: '听牌、进张、杠、防守，打得稳靠这些',
    lessons: [
      { id: 'ting-read', title: '听牌判断', desc: '这手牌听什么', kind: 'ting', type: 'ting', difficulty: 1, count: 5 },
      { id: 'ting-choose', title: '听牌选择', desc: '有两种听法，选哪种', kind: 'discard', type: 'ting', difficulty: 2, count: 5 },
      { id: 'gang-choice', title: '杠的判断', desc: '这个杠该不该杠', kind: 'claim', type: 'gang', difficulty: 2, count: 5 },
      { id: 'defense-basic', title: '防守入门', desc: '别人听牌了，打哪张最安全', kind: 'discard', type: 'defense', difficulty: 2, count: 5 },
    ],
  },
  {
    id: 'real',
    name: '实战',
    emoji: '📕',
    desc: '真实牌局里最难的三种局面',
    lessons: [
      { id: 'midgame', title: '中盘决策', desc: '牌过半，攻还是守', kind: 'discard', type: 'efficiency', difficulty: 3, count: 5 },
      { id: 'xuezhan', title: '血战决策', desc: '有人已经胡了下桌，剩下的怎么打', kind: 'discard', type: 'defense', difficulty: 3, count: 5 },
      { id: 'endgame', title: '残局决策', desc: '牌墙剩十几张，还追不追', kind: 'discard', type: 'defense', difficulty: 3, count: 5 },
    ],
  },
];

export const ALL_LESSONS: Lesson[] = COURSES.flatMap((c) => c.lessons);
export const lessonById = (id: string) => ALL_LESSONS.find((l) => l.id === id);
export const courseOfLesson = (id: string) => COURSES.find((c) => c.lessons.some((l) => l.id === id));

// ==================== 发牌工具 ====================

/** 从一副完整的牌里发 n 张，可限制只用某几门 */
function deal(rng: Rng, n: number, suits: number[]): TileId[] {
  const wall: TileId[] = [];
  for (const s of suits) for (let r = 0; r < RANK_COUNT; r++) for (let i = 0; i < 4; i++) wall.push(s * RANK_COUNT + r);
  rng.shuffle(wall);
  return wall.slice(0, n).sort((a, b) => a - b);
}

/** 难度 → 最优解和次优解要拉开多少差距。差距越小越难判断 */
const MARGIN: Record<1 | 2 | 3, [number, number]> = {
  1: [26, 1e9], // 一眼能看出来
  2: [12, 26],
  3: [5, 12], // 要算一算才知道
};

const inMargin = (m: number, d: 1 | 2 | 3) => m >= MARGIN[d][0] && m < MARGIN[d][1];

// ==================== 各类出题器 ====================

function makeDiscardPuzzle(
  lesson: Lesson,
  seed: number,
  cfg: RuleConfig,
  opts: { defense?: boolean; endgame?: boolean; xuezhan?: boolean } = {},
): Puzzle | null {
  const rng = new Rng(seed);
  // 缺门已经打完的中盘局面：只用两门牌，手上 14 张
  const lackSuit = rng.int(3) as Suit;
  const suits = [0, 1, 2].filter((s) => s !== lackSuit);
  const hand = deal(rng, 14, suits);
  const counts = toCounts(hand);

  const wallLeft = opts.endgame ? 8 + rng.int(8) : opts.defense ? 18 + rng.int(10) : 30 + rng.int(20);
  const reads: OpponentRead[] = [];
  let sceneText = '';

  if (opts.defense || opts.endgame || opts.xuezhan) {
    // 造一个「有人听牌」的场景：给他一串弃牌，让筋牌判断有依据
    const threatSeat = 1 + rng.int(3);
    const theirDiscards = deal(new Rng(seed * 31 + 7), 6, [lackSuit, suits[rng.int(2)]]);
    reads.push(
      readOpponent({
        seat: threatSeat,
        discards: theirDiscards,
        lack: lackSuit,
        meldCount: 1 + rng.int(2),
        outOfPlay: false,
        round: 14,
      }),
    );
    const who = ['', '下家', '对家', '上家'][threatSeat];
    sceneText = opts.xuezhan
      ? `${who}已经碰了 ${reads[0].meldCount} 副，看起来快听牌了；另有一家刚刚胡牌下桌。牌墙还剩 ${wallLeft} 张。`
      : opts.endgame
        ? `牌墙只剩 ${wallLeft} 张，${who}看起来已经听牌（他打过 ${tilesName(theirDiscards)}）。`
        : `${who}看起来已经听牌了，他打过 ${tilesName(theirDiscards)}。牌墙还剩 ${wallLeft} 张。`;
    reads[0].ting = true;
    reads[0].tingConfidence = 0.75;
  }

  const a = analyzeDiscards({
    cfg, hand: counts, melds: [], lack: lackSuit,
    reads, wallLeft,
    seen: counts,
  });
  if (a.options.length < 3) return null;
  const margin = a.options[0].score - a.options[1].score;
  if (!inMargin(margin, lesson.difficulty)) return null;

  const best = a.options[0];
  // 并列最优也算对
  const accept = a.options.filter((o) => a.options[0].score - o.score < 4).map((o) => o.tile);

  const explain =
    (best.ting
      ? `打 ${best.name} 之后直接听牌，听 ${tilesName(best.waits)}。`
      : `打 ${best.name} 之后还差 ${best.shanten} 张听牌，能摸的有效牌有 ${best.ukeire} 张，是所有打法里最宽的。`) +
    `${best.name} 在你手里是${best.role}。` +
    (opts.defense || opts.endgame ? `\n\n这一步还要看安全：${best.dangerReason}。` : '') +
    `\n\n对比一下：打 ${a.options[1].name} 只有 ${a.options[1].ukeire} 张进张${
      a.options[1].shanten > best.shanten ? `，而且还差 ${a.options[1].shanten} 张才听牌` : ''
    }。`;

  const hints = [
    `先看缺门：你缺${SUIT_NAMES[lackSuit]}，手上已经没有了，所以这一步可以自由选。`,
    `数一下每张牌周围有没有伙伴——孤零零的那张通常就是答案。`,
    best.ting ? '这手牌其实已经能听牌了，找出那张多余的。' : `最优解能留下 ${best.ukeire} 张进张，你的选择留下几张？`,
  ];

  return {
    id: `d-${lesson.id}-${seed}`,
    kind: 'discard',
    type: lesson.type,
    lessonId: lesson.id,
    title: lesson.title,
    prompt: opts.defense || opts.endgame || opts.xuezhan ? `${sceneText}\n你该打哪张？` : '这手牌，你该打哪一张？',
    difficulty: lesson.difficulty,
    hand,
    melds: [],
    lack: lackSuit,
    configId: cfg.id,
    scene: reads.length ? { wallLeft, reads, sceneText } : undefined,
    answer: best.tile,
    accept,
    explain,
    hints,
    seed,
  };
}

function makeLackPuzzle(lesson: Lesson, seed: number, cfg: RuleConfig): Puzzle | null {
  const rng = new Rng(seed);
  const hand = deal(rng, 13, [0, 1, 2]);
  const counts = toCounts(hand);
  const a = analyzeLack(cfg, counts);
  if (!inMargin(a.margin, lesson.difficulty)) return null;

  const best = a.best;
  const second = a.options[1];
  const explain =
    `${a.verdict}\n\n` +
    a.options.map((o) => `**${o.rank}. 缺${o.name}**（${o.count} 张）：${o.reasons.join('；')}`).join('\n') +
    `\n\n注意：缺${best.name}不一定是张数最少的那门。真正要比的是「打掉这门之后，剩下两门离听牌还有多远」——` +
    `缺${best.name}后还差 ${best.shantenAfter} 张，缺${second.name}后还差 ${second.shantenAfter} 张。`;

  return {
    id: `l-${lesson.id}-${seed}`,
    kind: 'lack',
    type: 'lack',
    lessonId: lesson.id,
    title: lesson.title,
    prompt: '这手牌，你该定缺哪一门？',
    difficulty: lesson.difficulty,
    hand,
    melds: [],
    lack: -1,
    configId: cfg.id,
    choices: [0, 1, 2].map((s) => ({ key: String(s), text: `缺${SUIT_NAMES[s]}` })),
    answer: best.suit,
    accept: a.options.filter((o) => a.best.score - o.score < 6).map((o) => o.suit),
    explain,
    hints: [
      '别只数张数。先看每门里有没有已经成形的面子。',
      '把某一门整个拿掉，剩下的牌还差几张听牌？三门各试一次。',
      `${best.name}里有 ${best.isolated} 张孤张、${best.melds} 副面子。`,
    ],
    seed,
  };
}

function makeSwapPuzzle(lesson: Lesson, seed: number, cfg: RuleConfig): Puzzle | null {
  const rng = new Rng(seed);
  const hand = deal(rng, 13, [0, 1, 2]);
  const counts = toCounts(hand);
  const a = analyzeSwap(cfg, counts);
  if (a.options.length < 4) return null;
  if (!inMargin(a.margin, lesson.difficulty)) return null;

  const best = a.best;
  const explain =
    `${a.verdict}\n\n**为什么**\n` +
    best.reasons.map((x) => `· ${x}`).join('\n') +
    `\n\n换三张和定缺要连着想：换出去的最好就是你打算缺的那门。` +
    (a.matchesLackAdvice ? `这手牌正好建议缺${SUIT_NAMES[best.suit]}，方向一致。` : '');

  return {
    id: `s-${lesson.id}-${seed}`,
    kind: 'swap',
    type: 'swap',
    lessonId: lesson.id,
    title: lesson.title,
    prompt: '选三张同花色的牌换出去。',
    difficulty: lesson.difficulty,
    hand,
    melds: [],
    lack: -1,
    configId: cfg.id,
    answer: best.tiles,
    accept: [],
    explain,
    hints: [
      '先决定换哪一门——通常是你打算缺的那门。',
      '在那一门里挑互相搭不上的三张，别拆已经连好的。',
      `最优解是 ${best.text}。`,
    ],
    seed,
  };
}

function makeTingPuzzle(lesson: Lesson, seed: number, cfg: RuleConfig): Puzzle | null {
  const rng = new Rng(seed);
  const lackSuit = rng.int(3) as Suit;
  const suits = [0, 1, 2].filter((s) => s !== lackSuit);
  const hand = deal(rng, 13, suits);
  const counts = toCounts(hand);
  const sh = shantenWithLack(counts, 0, cfg.win.sevenPairs, lackSuit);
  if (sh !== 0) return null;
  const waits = waitingTiles(cfg, counts, [], lackSuit);
  if (waits.length === 0 || waits.length > 4) return null;

  // 造干扰项：听的牌 + 几张没听的
  const wrong: TileId[] = [];
  const rng2 = new Rng(seed * 17 + 3);
  while (wrong.length < 3) {
    const t = suits[rng2.int(2)] * RANK_COUNT + rng2.int(RANK_COUNT);
    if (!waits.includes(t) && !wrong.includes(t)) wrong.push(t);
  }
  const choices: PuzzleChoice[] = [
    { key: 'a', text: tilesName(waits), tiles: waits },
    { key: 'b', text: tilesName([waits[0], wrong[0]].sort((a, b) => a - b)), tiles: [waits[0], wrong[0]] },
    { key: 'c', text: tilesName(wrong.slice(0, 2).sort((a, b) => a - b)), tiles: wrong.slice(0, 2) },
    { key: 'd', text: tilesName([wrong[2]]), tiles: [wrong[2]] },
  ];
  rng2.shuffle(choices);

  return {
    id: `t-${lesson.id}-${seed}`,
    kind: 'ting',
    type: 'ting',
    lessonId: lesson.id,
    title: lesson.title,
    prompt: `你缺${SUIT_NAMES[lackSuit]}。这手牌听什么？`,
    difficulty: lesson.difficulty,
    hand,
    melds: [],
    lack: lackSuit,
    configId: cfg.id,
    choices,
    answer: choices.find((c) => c.text === tilesName(waits))!.key,
    accept: [],
    explain:
      `这手牌听 **${tilesName(waits)}**。\n\n` +
      `判断方法：把手牌拆成「面子 + 面子 + 面子 + 面子 + 将」，看还缺哪一张。` +
      `记住缺门（${SUIT_NAMES[lackSuit]}）的牌永远不算听张——就算牌型上能凑，有缺门牌也胡不了。`,
    hints: [
      '先把已经成形的顺子和刻子挑出来。',
      '剩下的部分差一张就能成面子或成对——那张就是听的牌。',
      `一共听 ${waits.length} 种。`,
    ],
    seed,
  };
}

function makeGangPuzzle(lesson: Lesson, seed: number, cfg: RuleConfig): Puzzle | null {
  const rng = new Rng(seed);
  const lackSuit = rng.int(3) as Suit;
  const suits = [0, 1, 2].filter((s) => s !== lackSuit);
  const hand = deal(rng, 11, suits);
  const counts = toCounts(hand);
  // 找一张手上正好三张的牌，假设别人打出第四张
  const triples: TileId[] = [];
  for (let t = 0; t < 27; t++) if (counts[t] === 3) triples.push(t);
  if (triples.length === 0) return null;
  const tile = triples[rng.int(triples.length)];

  const before = shantenWithLack(counts, 0, cfg.win.sevenPairs, lackSuit);
  const after = counts.slice();
  after[tile] -= 3;
  const shAfter = shantenWithLack(after, 1, false, lackSuit);
  const good = shAfter <= before;

  return {
    id: `g-${lesson.id}-${seed}`,
    kind: 'claim',
    type: 'gang',
    lessonId: lesson.id,
    title: lesson.title,
    prompt: `你缺${SUIT_NAMES[lackSuit]}，手上有三张 ${tileName(tile)}。现在别人打出第四张，杠不杠？`,
    difficulty: lesson.difficulty,
    hand,
    melds: [],
    lack: lackSuit,
    configId: cfg.id,
    choices: [
      { key: 'gang', text: '杠' },
      { key: 'pass', text: '不杠' },
    ],
    answer: good ? 'gang' : 'pass',
    accept: [],
    explain: good
      ? `**该杠。**杠之前还差 ${before} 张听牌，杠完还是 ${shAfter} 张，牌型没变差，还白拿杠分。` +
        `杠的钱是当场就收的，不用等胡牌。`
      : `**不该杠。**杠之前还差 ${before} 张听牌，杠完变成 ${shAfter} 张——这三张牌本来能和旁边的牌连成顺子，` +
        `杠掉就把那条路堵死了。杠分是小钱，把牌做黄了是大亏。` +
        `\n\n另外提醒：手上有四张一样的牌时，如果在做七对，更不能杠——四张牌算两对，杠了就只剩一副面子。`,
    hints: [
      '杠完这三张就锁死了，不能再拿去凑顺子。',
      '算一下：杠之前还差几张听牌，杠之后呢？',
      good ? '这三张本来也用不上别的地方。' : '这三张旁边还有牌，拆开更值钱。',
    ],
    seed,
  };
}

// ==================== 规则知识题（手写） ====================

interface QuizItem {
  lessonId: string;
  q: string;
  choices: string[];
  answer: number;
  explain: string;
}

const QUIZZES: QuizItem[] = [
  {
    lessonId: 'know-tiles',
    q: '四川麻将一共用多少张牌？',
    choices: ['108 张', '136 张', '144 张', '112 张'],
    answer: 0,
    explain: '四川麻将只用万、条、筒三门，每门 1~9 各四张，3×9×4 = 108 张。没有东南西北中发白，也没有花牌。',
  },
  {
    lessonId: 'know-tiles',
    q: '下面哪一门牌在四川麻将里**不存在**？',
    choices: ['万', '条', '筒', '风牌（东南西北）'],
    answer: 3,
    explain: '四川麻将去掉了所有字牌，这也是它节奏快、清一色好做的原因之一。',
  },
  {
    lessonId: 'know-tiles',
    q: '「条」这一门牌，民间还常叫它什么？',
    choices: ['索', '饼', '万子', '花'],
    answer: 0,
    explain: '条=索，筒=饼，这是各地对同一门牌的不同叫法，听牌友说「索子」就是条。',
  },
  {
    lessonId: 'know-tiles',
    q: '同一种牌最多有几张？',
    choices: ['3 张', '4 张', '5 张', '不限'],
    answer: 1,
    explain: '每种牌四张。所以你手上有两张 5 万时，场上最多还剩两张——这是算进张的基础。',
  },
  {
    lessonId: 'know-tiles',
    q: '起手每人多少张牌？',
    choices: ['13 张', '14 张', '16 张', '17 张'],
    answer: 0,
    explain: '每人起手 13 张，轮到自己时摸一张变 14 张，打出一张再回到 13 张。',
  },
  {
    lessonId: 'know-tiles',
    q: '3 万、4 万、5 万这样连着的三张牌叫什么？',
    choices: ['刻子', '顺子', '对子', '搭子'],
    answer: 1,
    explain: '连着的三张叫顺子，三张一样的叫刻子，两张一样的叫对子，差一张成面子的两张叫搭子。',
  },
  {
    lessonId: 'basic-rules',
    q: '「定缺」是什么意思？',
    choices: [
      '选一门牌，这一门不能碰杠',
      '选一门牌，胡牌时手上不能有这门牌',
      '选一门牌，这一门算翻倍',
      '选一门牌，别人不能打这门',
    ],
    answer: 1,
    explain: '定缺是四川麻将的灵魂：开局选一门作为「缺门」，胡牌时手上一张都不能有。而且手上还有缺门牌时，必须优先打缺门。',
  },
  {
    lessonId: 'basic-rules',
    q: '四川麻将可以「吃」别人打出的牌吗？',
    choices: ['可以，和普通麻将一样', '不可以，只能碰和杠', '只有上家的牌可以吃', '只有定缺后可以吃'],
    answer: 1,
    explain: '四川麻将没有吃。这让牌局节奏更快，也让碰的选择变得更重要——碰错了没法用吃来补救。',
  },
  {
    lessonId: 'basic-rules',
    q: '「换三张」换的三张牌必须满足什么？',
    choices: ['必须是同一花色', '必须是连着的三张', '必须是三张一样的', '没有限制'],
    answer: 0,
    explain: '必须同花色。方向由系统随机决定：给对家、给下家或给上家，三家同时换。',
  },
  {
    lessonId: 'basic-rules',
    q: '「血战到底」里，有人胡牌之后会怎样？',
    choices: ['本局立刻结束', '胡牌的人下桌，其余人继续打', '所有人重新摸牌', '胡牌的人可以继续胡'],
    answer: 1,
    explain: '胡了的人亮牌下桌，剩下的人继续打，直到三家都胡了或者牌摸完。所以「不是第一个胡」也很重要——最后那个没胡的要赔钱。',
  },
  {
    lessonId: 'basic-rules',
    q: '流局时手上还留着缺门牌，会怎样？',
    choices: ['没事', '算「花猪」，要重罚', '只是不能胡', '扣一半分'],
    answer: 1,
    explain: '这叫花猪，要赔给其他没花猪的家，是新手最容易踩的坑。好在多数平台强制先打缺门，只要照规则打就不会出现。',
  },
  {
    lessonId: 'basic-rules',
    q: '流局时没听牌的人要做什么？',
    choices: ['不用做什么', '赔给听牌的人，俗称「查大叔」', '扣自己一半分', '下一局不能上桌'],
    answer: 1,
    explain: '这叫查叫（查大叔）：没听牌的赔给听牌的，赔多少按听牌那家能胡的最大番数算。所以牌快没了的时候，能听上一口就别放弃。',
  },
  {
    lessonId: 'basic-rules',
    q: '「呼叫转移」指的是什么？',
    choices: [
      '杠牌可以转让给别人',
      '胡牌者之前收的杠分，改由点炮的人承担',
      '可以把缺门转给下家',
      '胡牌后分数转给庄家',
    ],
    answer: 1,
    explain: '你杠牌赢的钱，在你被人点炮胡了之后，要由点炮那个人替大家赔。所以点炮给一个杠了很多次的人，代价会突然变得很大。',
  },
  {
    lessonId: 'basic-rules',
    q: '自己摸到第四张、之前已经碰过这张牌，这种杠叫什么？',
    choices: ['暗杠', '明杠', '补杠（弯杠）', '抢杠'],
    answer: 2,
    explain: '碰过之后再摸到第四张叫补杠。补杠时别人如果正好胡这张牌，可以「抢杠胡」，所以补杠不是完全没风险。',
  },
  {
    lessonId: 'win-condition',
    q: '标准的胡牌牌型是什么？',
    choices: ['四个面子 + 一对将', '五个面子', '七个对子或四面子一将', '三个面子 + 两对'],
    answer: 2,
    explain: '四川麻将有两种胡型：标准型「四面子 + 一对将」，以及七对（七个对子，必须门清）。',
  },
  {
    lessonId: 'win-condition',
    q: '碰过牌之后，还能用七对胡吗？',
    choices: ['能', '不能，七对必须门清', '碰一次还可以', '看平台规则'],
    answer: 1,
    explain: '七对要求手上 14 张全是自己的对子，碰过或明杠过就破了门清，不能再算七对。暗杠也会破坏七对（四张被锁成一副面子）。',
  },
  {
    lessonId: 'win-condition',
    q: '手上还有一张缺门牌，牌型刚好凑成四面子一将，能胡吗？',
    choices: ['能胡', '不能胡', '能胡但不算番', '只能自摸胡'],
    answer: 1,
    explain: '不能。缺门是硬条件，只要手上还有一张缺门牌，牌型再漂亮也不能胡。这是四川麻将和别的麻将最大的区别之一。',
  },
  {
    lessonId: 'win-condition',
    q: '「龙七对」是什么？',
    choices: ['七个对子里有四张一样的', '七个对子全是同一门', '七个对子都是连号', '七对加自摸'],
    answer: 0,
    explain: '七对里有四张完全相同的牌，那四张算两对，叫龙七对，番数比普通七对翻一倍。注意：有四张的时候千万别去杠。',
  },
  {
    lessonId: 'win-condition',
    q: '「金钩钓」指的是哪种牌型？',
    choices: ['全是幺九', '四副都碰杠出去，手上只剩一张单吊', '连续四个顺子', '全部自摸'],
    answer: 1,
    explain: '手上的牌全部碰杠亮在外面，只剩一张等着配对，叫金钩钓（也叫独钓）。碰得越多手牌越少，这时候打出去的每一张都很关键。',
  },
  {
    lessonId: 'win-condition',
    q: '「清一色」是什么意思？',
    choices: ['全是同一花色', '全是单数牌', '全是刻子', '全是幺九'],
    answer: 0,
    explain: '整副牌（含碰杠）只有一门花色。四川麻将定缺之后本来就只剩两门，所以清一色比想象中好做，是性价比很高的大牌。',
  },
  {
    lessonId: 'win-condition',
    q: '「根」是什么？',
    choices: ['四张一样的牌（含杠）', '连续九张', '三个刻子', '同花色的将牌'],
    answer: 0,
    explain: '凑齐四张相同的牌就算一根，不管是杠出来的还是握在手里的，每根翻一倍。',
  },
  {
    lessonId: 'win-condition',
    q: '一张牌同时被两家胡，怎么算？',
    choices: ['只有下家能胡', '两家都能胡，叫一炮多响', '重新打', '点炮的人可以选'],
    answer: 1,
    explain: '多数四川玩法允许一炮多响：所有能胡的人都胡，点炮那家要挨个赔。所以打危险牌之前要想清楚，一炮可能赔好几份。',
  },
];

// ==================== 出题主入口 ====================

/** 生成一道题。失败会自动换种子重试，最多 200 次 */
export function makePuzzle(lesson: Lesson, seed: number, cfg: RuleConfig = VARIANT_CHENGDU): Puzzle | null {
  if (lesson.kind === 'quiz') {
    const pool = QUIZZES.filter((q) => q.lessonId === lesson.id);
    if (!pool.length) return null;
    const item = pool[seed % pool.length];
    return {
      id: `q-${lesson.id}-${seed % pool.length}`,
      kind: 'quiz',
      type: lesson.type,
      lessonId: lesson.id,
      title: lesson.title,
      prompt: item.q,
      difficulty: lesson.difficulty,
      hand: [],
      melds: [],
      lack: -1,
      configId: cfg.id,
      choices: item.choices.map((t, i) => ({ key: String(i), text: t })),
      answer: String(item.answer),
      accept: [],
      explain: item.explain,
      hints: ['先排除明显不对的两个选项。'],
      seed,
    };
  }

  for (let i = 0; i < 200; i++) {
    const s = seed * 7919 + i * 104729;
    let p: Puzzle | null = null;
    switch (lesson.kind) {
      case 'discard':
        p = makeDiscardPuzzle(lesson, s, cfg, {
          defense: lesson.id === 'defense-basic',
          endgame: lesson.id === 'endgame',
          xuezhan: lesson.id === 'xuezhan',
        });
        break;
      case 'lack': p = makeLackPuzzle(lesson, s, cfg); break;
      case 'swap': p = makeSwapPuzzle(lesson, s, cfg); break;
      case 'ting': p = makeTingPuzzle(lesson, s, cfg); break;
      case 'claim': p = makeGangPuzzle(lesson, s, cfg); break;
      default: return null;
    }
    if (p) return p;
  }
  return null;
}

/** 生成一整组题 */
export function makeLessonSet(lesson: Lesson, seed: number, cfg: RuleConfig = VARIANT_CHENGDU): Puzzle[] {
  const out: Puzzle[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < lesson.count && i < lesson.count * 12; i++) {
    const p = makePuzzle(lesson, seed + i * 13, cfg);
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push(p);
    }
  }
  return out;
}

/** 判卷 */
export function judge(puzzle: Puzzle, given: number | number[] | string): { correct: boolean; note: string } {
  if (puzzle.kind === 'swap') {
    const want = [...(puzzle.answer as number[])].sort((a, b) => a - b).join(',');
    const got = [...(given as number[])].sort((a, b) => a - b).join(',');
    return { correct: want === got, note: want === got ? '' : `最优是 ${tilesName(puzzle.answer as number[])}` };
  }
  if (typeof puzzle.answer === 'string') {
    const ok = String(given) === puzzle.answer;
    return { correct: ok, note: ok ? '' : '' };
  }
  const g = given as number;
  const ok = g === puzzle.answer || puzzle.accept.includes(g);
  let note = '';
  if (!ok) {
    note = puzzle.kind === 'lack'
      ? `最优是缺${SUIT_NAMES[puzzle.answer as number]}`
      : `最优是打 ${tileName(puzzle.answer as number)}`;
  }
  return { correct: ok, note };
}

/** 再来一道类似的：同一课、换个种子 */
export function similarPuzzle(p: Puzzle, cfg: RuleConfig = VARIANT_CHENGDU): Puzzle | null {
  const lesson = lessonById(p.lessonId);
  if (!lesson) return null;
  return makePuzzle(lesson, p.seed + 1013, cfg);
}

export type { Counts };
