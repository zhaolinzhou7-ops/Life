/**
 * 课程表：四个阶段 + 每天 25 分钟的训练结构。
 *
 * 排序的依据不是传统的「开局—中局—残局」，而是**业余棋手到底为什么输棋**：
 *   漏着 ~60%   残局走不出结果 ~25%   布局吃亏 ~10%   算得不够深 少数
 * 所以顺序必须是：不漏着 → 算得清 → 残局 → 布局。
 *
 * 市面上多数象棋 App 把顺序搞反了——一上来讲定式，背了一堆招法，
 * 实战照样第 20 步送车。那是"练了不涨棋"的主要原因。
 *
 * 另一条原则：**毕业看能力，不看天数**。每个阶段有明确的出师标准，
 * 达标才放行，否则就在这一阶段继续磨。
 */
import { DIM_INFO, type Dim } from './save';

export interface Stage {
  id: number;
  name: string;
  emoji: string;
  /** 这一阶段要解决什么问题 */
  goal: string;
  /** 大致需要多久（每天 25 分钟、每周 6 天） */
  weeks: string;
  /** 主要练哪几维 */
  focus: Dim[];
  /** 出师标准：达标才进下一阶段 */
  graduate: { dim: Dim; rating: number }[];
  /** 这一阶段具体学什么 */
  topics: string[];
  /** 为什么先练这个 */
  why: string;
}

export const STAGES: Stage[] = [
  {
    id: 1,
    name: '不漏着',
    emoji: '👁',
    goal: '把实战送子降到每盘不到一次',
    weeks: '约 4 周',
    focus: ['safety', 'mate'],
    graduate: [
      { dim: 'safety', rating: 1150 },
      { dim: 'mate', rating: 1100 },
    ],
    topics: [
      '中文记谱法（第一课就学，不然棋书棋谱全读不了）',
      '子力价值与兑子原则：车 1000 / 炮 500 / 马 450 / 士象 220 / 兵 100',
      '一步杀 200 题——重点是<b>认图形</b>，不是硬算',
      '走之前扫一遍：对方的车、炮、马分别能打到哪',
    ],
    why: '你现在输棋，绝大多数不是因为算得浅，是因为根本没看见对方那一手。先把眼睛练出来，比学什么都值。',
  },
  {
    id: 2,
    name: '算得清',
    emoji: '⚔️',
    goal: '三步杀稳定，能算清 5 步的强制着法',
    weeks: '约 8 周',
    focus: ['mate', 'tactic'],
    graduate: [
      { dim: 'mate', rating: 1400 },
      { dim: 'tactic', rating: 1300 },
    ],
    topics: [
      '经典杀法图形：马后炮、铁门栓、双车错、天地炮、大刀剜心、闷宫、重炮、白脸将',
      '战术主题：捉双、牵制、引离、闪击、腾挪、封锁',
      '限时计算——把「算不出来」和「懒得算」分开，这是两个完全不同的病',
    ],
    why: '杀法图形是有限的，认熟了就是条件反射。真人高手不是每步现算，是一眼认出来。',
  },
  {
    id: 3,
    name: '残局功力',
    emoji: '🏁',
    goal: '多子必赢，少子能守和',
    weeks: '约 10 周',
    focus: ['endgame'],
    graduate: [{ dim: 'endgame', rating: 1450 }],
    topics: [
      '实用残局按经典顺序：单车对士象全 → 单马对单士 → 单炮士象全 → 车兵对车士象全 → 马炮兵 → 高低兵',
      '什么时候该兑子进残局——这才是残局知识真正变现的地方',
      '每个残局都要跟引擎<b>下到底</b>，不到赢/和不算过',
    ],
    why: '残局是可以算准的，所以它练的是精确。而且中局优势最后都要靠残局兑现——多一个马走成和棋，比中局失误还可惜。',
  },
  {
    id: 4,
    name: '布局与中局',
    emoji: '📖',
    goal: '有自己的一套开局，中局有计划',
    weeks: '约 12 周',
    focus: ['opening', 'tactic'],
    graduate: [{ dim: 'opening', rating: 1450 }],
    topics: [
      '选一套先手（中炮）+ 一套后手（屏风马 / 反宫马），别贪多',
      '讲思路不背招：中炮想干什么，屏风马凭什么反击',
      '常见陷阱与破解',
      '中局：子力协调、要子还是要势、攻王与守王',
      '打谱：胡荣华 / 许银川 / 王天一 的经典对局',
    ],
    why: '布局放到最后不是因为它不重要，是因为前面三样没练好时，布局占的那点便宜根本守不住。',
  },
];

/** 按当前五维水平判断该在第几阶段：前面阶段的出师标准全达标才往后走 */
export function stageFor(ratings: Record<Dim, { r: number }>): Stage {
  for (const s of STAGES) {
    const passed = s.graduate.every((g) => ratings[g.dim].r >= g.rating);
    if (!passed) return s;
  }
  return STAGES[STAGES.length - 1];
}

/**
 * 今天该练哪一维：取**本阶段该练的那几维里最弱的那个**，而不是全局最弱。
 *
 * 这一条很要紧。整套课程的论点就是"别一上来练布局"，
 * 如果只按全局最弱来挑，阶段一的学生一开局分低就被派去练布局，
 * 等于自己打自己的脸。阶段没到，那一维再弱也先不碰。
 */
export function focusDim(stage: Stage, ratings: Record<Dim, { r: number }>): Dim {
  return stage.focus.reduce((a, d) => (ratings[d].r < ratings[a].r ? d : a), stage.focus[0]);
}

/** 距离出师还差什么，说具体数字而不是"再练练" */
export function graduateStatus(stage: Stage, ratings: Record<Dim, { r: number }>) {
  return stage.graduate.map((g) => ({
    dim: g.dim,
    name: DIM_INFO[g.dim].name,
    need: g.rating,
    now: ratings[g.dim].r,
    ok: ratings[g.dim].r >= g.rating,
  }));
}

// ---------------- 每日训练 ----------------

export type BlockKind = 'warmup' | 'srs' | 'focus' | 'mate-shape' | 'endgame' | 'game';

export interface Block {
  kind: BlockKind;
  title: string;
  desc: string;
  minutes: number;
  /** 这一块练哪一维（复习块没有固定维度） */
  dim?: Dim;
  /** 出几题 */
  count?: number;
  /** 难度偏移：热身要比当前水平简单一点，找手感用的 */
  ratingBias?: number;
}

/**
 * 每天 25 分钟的结构。
 *
 * 25 分钟是刻意选的：在注意力窗口之内，而且每天都能坚持——
 * 一次练两小时、然后三周不碰，效果远不如每天 25 分钟。
 */
export function dailyPlan(stage: Stage, focus: Dim, dueCount: number): Block[] {
  const blocks: Block[] = [
    {
      kind: 'warmup',
      title: '热身：5 道杀法题',
      desc: '比你当前水平略简单，快速找手感。重点是一眼认出图形，别硬算。',
      minutes: 3,
      dim: 'mate',
      count: 5,
      ratingBias: -150,
    },
  ];

  if (dueCount > 0) {
    blocks.push({
      kind: 'srs',
      title: `错题重练（${dueCount} 道）`,
      desc: '按 1/3/7/21/60 天的间隔回来找你。同一个坑不该掉第二次。',
      minutes: 5,
      count: dueCount,
    });
  }

  // 阶段一二练图形识别，阶段三之后重心转到残局——这就是专业课的顺序
  if (stage.id <= 2) {
    blocks.push({
      kind: 'mate-shape',
      title: '杀法图形：认一个新图形',
      desc: '马后炮、闷宫、双车错…… 有名字的杀棋一共就那么多。认熟了是条件反射，这比多算两层管用。',
      minutes: 6,
    });
  } else {
    blocks.push({
      kind: 'endgame',
      title: '残局实战：下到底',
      desc: '摆好局面跟引擎下完——多子必须赢下来，少子必须守和。中局的优势最后都要靠这个兑现。',
      minutes: 8,
    });
  }

  blocks.push({
    kind: 'focus',
    title: `今日专项：${DIM_INFO[focus].name}`,
    desc: `${DIM_INFO[focus].desc}。${stage.emoji} 阶段${stage.id}「${stage.name}」主练这一维，也是这一阶段里你最弱的。`,
    minutes: 6,
    dim: focus,
    count: 8,
  });

  blocks.push({
    kind: 'game',
    title: '实战一局 + 复盘',
    desc: '做题练的是识别，实战练的是运用，两样都得有。下完一定要复盘——不复盘等于白下。',
    minutes: 7,
  });

  return blocks;
}

// ---------------- 周计划 ----------------

/**
 * 只有"每天练什么"是不够的。专业训练是按周组织的：
 * 平日短时高频保持手感，周末安排一次长局——因为**慢棋才练得到深度计算**，
 * 快棋只练直觉。两者缺一不可，这是职业队最基本的安排方式。
 */
export interface WeekDay {
  label: string;
  title: string;
  desc: string;
  minutes: number;
}

export const WEEK_PLAN: WeekDay[] = [
  { label: '周一', title: '常规训练', desc: '热身 + 错题 + 专项 + 实战复盘', minutes: 25 },
  { label: '周二', title: '常规训练', desc: '同上。重点还是把当前阶段那一维往上推', minutes: 25 },
  { label: '周三', title: '常规训练', desc: '同上', minutes: 25 },
  { label: '周四', title: '常规训练', desc: '同上', minutes: 25 },
  { label: '周五', title: '常规训练', desc: '同上', minutes: 25 },
  {
    label: '周六',
    title: '长局日',
    desc: '和高难度 AI 下一盘慢棋，每步认真想。下完做<b>逐手复盘</b>，把每一处失误都过一遍。慢棋练的是深度计算，这是平日快棋补不上的。',
    minutes: 60,
  },
  {
    label: '周日',
    title: '休息 / 复盘周',
    desc: '不做新题。翻一遍这周的错题本和对局记录，看看失误是不是集中在同一类——<b>发现规律比多做十道题有用</b>。',
    minutes: 20,
  },
];

/** 专业训练里几条最容易被业余忽略的原则 */
export const PRO_PRINCIPLES: { title: string; body: string }[] = [
  {
    title: '每天练，别攒着周末一次练完',
    body: '每天 25 分钟远胜过每周一次 3 小时。棋感靠的是高频接触，长间隔之后手感会掉，等于每次都从头找状态。',
  },
  {
    title: '正确率维持在 70~85% 最有效',
    body: '题太简单没收益，太难只剩挫败。刻意练习的核心就是卡在能力边缘。本 App 会自动把难度调到这个区间，别自己去挑简单的刷。',
  },
  {
    title: '错题一定要回头做',
    body: '做错的当下看一眼答案，第二天就忘了。间隔重复（1/3/7/21/60 天）是为了卡在"快要忘"的那个点上把题送回来，那时候记得最牢。',
  },
  {
    title: '不复盘的对局等于白下',
    body: '业余和专业最大的差距不在下棋，在复盘。你输的那盘里一定有一步是转折点，找出来才有价值——这也是本 App 每局都自动帮你标出来的原因。',
  },
  {
    title: '布局放到最后学',
    body: '前面三样（不漏着、算得清、残局）没练好的时候，布局占的那点便宜守不住。「背了一堆定式还是不涨棋」就是这么来的。',
  },
  {
    title: '慢棋和快棋都要有',
    body: '快棋练直觉和图形识别，慢棋练深度计算。只下快棋会养成"想都不想就走"的习惯，只下慢棋则形不成条件反射。',
  },
];

/** 从当前水平到目标水平大概要多久，按每天 25 分钟、每周 6 天估 */
export const TIME_TABLE: { from: number; to: number; label: string; time: string }[] = [
  { from: 0, to: 1100, label: '入门 → 新手', time: '2~3 周' },
  { from: 1100, to: 1300, label: '初级 → 中级', time: '6~8 周' },
  { from: 1300, to: 1500, label: '中级 → 高级', time: '3~4 个月' },
  { from: 1500, to: 1700, label: '高级 → 准专业', time: '6~9 个月' },
  { from: 1700, to: 2000, label: '准专业 → 专业级', time: '1~2 年，且要大量实战与打谱' },
];

export function nextMilestone(overall: number) {
  return TIME_TABLE.find((t) => overall < t.to) ?? TIME_TABLE[TIME_TABLE.length - 1];
}
