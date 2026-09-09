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
import { DIM_INFO, DIMS, type Dim } from './save';

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

export type BlockKind = 'warmup' | 'srs' | 'focus' | 'mate-shape' | 'endgame' | 'game' | 'quiz' | 'timed' | 'opening' | 'replay';

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
  /**
   * **今天为什么要练这一块**——用你自己的数据说话。
   *
   * 这是和"按模板排课"最大的区别。学生凭什么信今天该练眼力？
   * 因为"最近 6 盘你丢的分里 58% 是漏着"。说得出数字的处方才有人照做。
   */
  why?: string;
}

/** 每日训练需要的全部输入：分数、实战丢分、最近正确率、错题数 */
export interface TrainInput {
  stage: Stage;
  ratings: Record<Dim, { r: number }>;
  /** 最近若干盘实战里，各维累计丢了多少分 */
  loss: { by: Record<Dim, number>; games: number; total: number };
  /** 最近这一维的做题正确率，题量不够给 null */
  accuracy: (d: Dim) => { acc: number; n: number } | null;
  dueCount: number;
  /** 距离上次测验多少天，用来决定今天要不要插一场小测 */
  daysSinceQuiz: number;
}

/**
 * 正确率维持在 70~85% 时进步最快。
 *
 * 这是刻意练习最硬的一条：高于这个区间说明你在做已经会的题——舒服但不涨棋；
 * 低于这个区间说明在硬啃，错得太多学不到东西还打击信心。
 * 所以难度不该由我拍板，而是**跟着你最近的正确率自动走**。
 */
export function biasFor(acc: { acc: number; n: number } | null): { bias: number; note: string } {
  if (!acc) return { bias: 0, note: '' };
  const pct = Math.round(acc.acc * 100);
  if (acc.acc >= 0.85) return { bias: 130, note: `最近 ${acc.n} 道对了 ${pct}%，题偏简单了，今天加难度` };
  if (acc.acc <= 0.55) return { bias: -130, note: `最近 ${acc.n} 道只对了 ${pct}%，先降难度把手感找回来` };
  return { bias: 0, note: `最近 ${acc.n} 道对了 ${pct}%，难度正合适` };
}

/**
 * 今天该主攻哪一维。
 *
 * **优先看实战丢分，而不是看做题分数低。** 这是专业教练和普通教材最大的分别：
 * 做题分只说明你会不会做题，而你输棋是因为实战里分从某个地方漏掉了。
 * 一个人可以残局题做得很好，实战照样把多子的残局走成和棋。
 *
 * 实战样本不够（少于 3 盘）才退回按分数挑——那时候只能先信做题分。
 */
export function prescribeFocus(inp: TrainInput): { dim: Dim; why: string } {
  const { loss, stage, ratings } = inp;
  if (loss.games >= 3 && loss.total > 200) {
    let top: Dim = 'safety';
    for (const d of DIMS) if (loss.by[d] > loss.by[top]) top = d;
    const share = Math.round((loss.by[top] / loss.total) * 100);
    if (share >= 25) {
      return {
        dim: top,
        why: `最近 ${loss.games} 盘实战，你丢的分里 <b>${share}%</b> 出在「${DIM_INFO[top].name}」上——这是你现在最贵的漏洞，今天就练它。`,
      };
    }
  }
  const d = focusDim(stage, ratings);
  return {
    dim: d,
    why:
      loss.games < 3
        ? `实战样本还不够（${loss.games} 盘），今天先按分数最低的一维排：「${DIM_INFO[d].name}」。多下几盘之后，训练会改成按你实战丢分排。`
        : `五维丢分比较均匀，按阶段${stage.id}的重点排：「${DIM_INFO[d].name}」。`,
  };
}

/**
 * 每天 25 分钟的结构。
 *
 * 25 分钟是刻意选的：在注意力窗口之内，而且每天都能坚持——
 * 一次练两小时、然后三周不碰，效果远不如每天 25 分钟。
 *
 * 五块的顺序也是有讲究的，对应一节正经课的结构：
 *   热身（唤醒）→ 错题（补漏）→ 专项（在能力边缘练）→ 阶段内容（新东西）
 *   → 实战 + 复盘（把练的东西用出来，再从实战里发现下一个漏洞）
 * 最后一步是闭环：复盘会把你这盘走错的手做成题，明天进错题本。
 */
export function dailyPlan(inp: TrainInput): Block[] {
  const { stage, dueCount, accuracy } = inp;
  const focus = prescribeFocus(inp);
  const blocks: Block[] = [
    {
      kind: 'warmup',
      title: '热身：5 道杀法题',
      desc: '比你当前水平略简单，快速找手感。重点是一眼认出图形，别硬算。',
      minutes: 3,
      dim: 'mate',
      count: 5,
      ratingBias: -150,
      why: '开局先做几道有把握的，是为了把"看图形"的状态唤醒，不是为了练难题。',
    },
  ];

  if (dueCount > 0) {
    blocks.push({
      kind: 'srs',
      title: `错题重练（${dueCount} 道）`,
      desc: '按 1/3/7/21/60 天的间隔回来找你。同一个坑不该掉第二次。',
      minutes: Math.min(8, 2 + Math.ceil(dueCount * 0.5)),
      count: dueCount,
      why: '这些题一半是你自己实战里走错的局面。重做比做新题划算得多——你已经证明过这里会错。',
    });
  }

  // 每周一场小测：不测就不知道练的东西有没有落到实处
  if (inp.daysSinceQuiz >= 7) {
    blocks.push({
      kind: 'quiz',
      title: '每周小测（10 题）',
      desc: '五维各抽两题，不给提示。测出来的分直接更新你的五维雷达。',
      minutes: 6,
      count: 10,
      why:
        inp.daysSinceQuiz >= 900
          ? '你还没做过小测。练而不测，涨没涨全靠感觉——每周一次，10 题，够看出趋势。'
          : `距离上次小测 ${inp.daysSinceQuiz} 天了。练而不测，涨没涨全靠感觉——每周一次，10 题，够看出趋势。`,
    });
  }

  const b = biasFor(accuracy(focus.dim));
  blocks.push({
    kind: 'focus',
    title: `今日专项：${DIM_INFO[focus.dim].name}`,
    desc: DIM_INFO[focus.dim].desc,
    minutes: 8,
    dim: focus.dim,
    count: 8,
    ratingBias: b.bias,
    why: b.note ? `${focus.why}<br>${b.note}。` : focus.why,
  });

  /**
   * 每周轮换一项"专业训练里最容易被业余跳过"的内容。
   *
   * 这三样都不是天天做的东西，但一样都不能没有：
   *   限时计算 —— 把"算不出来"和"懒得算"分开，这两个病练法相反
   *   布局定式 —— 到 1500 以上布局才成为真瓶颈，但那时候临时补来不及
   *   打谱     —— 最老的一项训练，练的是"先自己想一手"的习惯
   * 按星期几轮，保证一周里每样都轮得到，又不会天天占时间。
   */
  const rotate = new Date().getDay();
  if (rotate === 2 && stage.id >= 2) {
    blocks.push({
      kind: 'timed',
      title: '限时计算（6 题）',
      desc: '每题 45 秒，做错的再不限时重做一遍。',
      minutes: 8,
      why: '「算不出来」和「懒得算」在不限时的时候长得一模一样，但练法完全相反：一个练习惯，一个练能力。分不清就会用错药。',
    });
  } else if (rotate === 4 && stage.id >= 3) {
    blocks.push({
      kind: 'opening',
      title: '布局定式：过一套',
      desc: '中炮对屏风马 / 反宫马 / 仙人指路。看完再用猜着法过一遍。',
      minutes: 8,
      why: '布局排在后面不是因为不重要，是因为前面没练好时布局那点便宜守不住。你现在到阶段3了，可以开始补。',
    });
  } else if (rotate === 6) {
    blocks.push({
      kind: 'replay',
      title: '打谱：猜着法',
      desc: '一手一手过棋谱，轮到你先自己想一手再看原谱。',
      minutes: 10,
      why: '看谱的时候人人都觉得"这手我也想得到"，先走一遍才知道想不想得到。周末时间宽裕，适合做这个。',
    });
  }

  // 阶段一二练图形识别，阶段三之后重心转到残局——这就是专业课的顺序
  if (stage.id <= 2) {
    blocks.push({
      kind: 'mate-shape',
      title: '杀法图形：认一个新图形',
      desc: '马后炮、闷宫、双车错…… 有名字的杀棋一共就那么多。认熟了是条件反射，这比多算两层管用。',
      minutes: 5,
      why: '这个阶段最划算的投入是"认图形"。图形有名字才记得住，记住了下次一眼就认出来。',
    });
  } else {
    blocks.push({
      kind: 'endgame',
      title: '残局实战：下到底',
      desc: '摆好局面跟引擎下完——多子必须赢下来，少子必须守和。',
      minutes: 7,
      why: '中局挣来的优势最后都要在残局兑现。多一个马走成和棋，比中局失误还可惜。',
    });
  }

  blocks.push({
    kind: 'game',
    title: '实战一局 + 复盘',
    desc: '做题练的是识别，实战练的是运用，两样都得有。',
    minutes: 7,
    why: '复盘不是走个过场：它会把你这盘走错的手做成题存进错题本，明天回来找你。这一步不做，整个循环就断了。',
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

// ---------------- 月度目标 ----------------

export interface MonthGoal {
  /** 一句话目标 */
  title: string;
  /** 怎么算达成——必须是可检验的，不能是"感觉进步了" */
  check: string;
  kind: 'rating' | 'behavior' | 'content';
}

/**
 * 这个月的目标。
 *
 * 【为什么必须有可检验的标准】"多练练""提高眼力"这种目标没法证伪，
 * 一个月后你不知道自己做到没有，只能凭感觉——而感觉是最不可靠的。
 * 教练开的目标一定是可检验的：分数到多少、每盘漏着降到几次、
 * 哪几类残局能下出结果。做到没做到，一查便知。
 *
 * 【为什么涨幅只敢写 +60】按每天 25 分钟、每周 6 天，一个月约 10 小时。
 * 集中练一维，60 分是个不算离谱的预期；写 +200 好看但会让人一个月后
 * 觉得自己失败。宁可保守。
 */
export function monthGoals(
  focus: Dim,
  ratings: Record<Dim, { r: number }>,
  stage: Stage,
  blundersPerGame: number | null,
): MonthGoal[] {
  const goals: MonthGoal[] = [
    {
      kind: 'rating',
      title: `把「${DIM_INFO[focus].name}」从 ${ratings[focus].r} 推到 ${ratings[focus].r + 60}`,
      check: `一个月后做一次完整测评，这一维 ≥ ${ratings[focus].r + 60} 分`,
    },
  ];
  if (blundersPerGame !== null && blundersPerGame > 0.8) {
    goals.push({
      kind: 'behavior',
      title: `实战漏着从每盘 ${blundersPerGame.toFixed(1)} 次降到 0.8 次以下`,
      check: '看最近 10 盘的复盘统计——这个数字比分数更能说明问题',
    });
  } else {
    goals.push({
      kind: 'behavior',
      title: '保持每盘漏着不超过 0.8 次',
      check: '看最近 10 盘的复盘统计。这个数守不住，分数涨了也是虚的',
    });
  }
  const need = stage.graduate.filter((g) => ratings[g.dim].r < g.rating);
  if (need.length) {
    goals.push({
      kind: 'content',
      title: `向阶段${stage.id}出师标准推进：${need.map((g) => `${DIM_INFO[g.dim].name} ${g.rating}`).join('、')}`,
      check: `差 ${need.map((g) => `${DIM_INFO[g.dim].name} ${g.rating - ratings[g.dim].r} 分`).join('、')}`,
    });
  } else {
    goals.push({
      kind: 'content',
      title: `阶段${stage.id}已达标，这个月开始啃阶段${Math.min(4, stage.id + 1)}的内容`,
      check: '下一阶段的出师标准里至少有一项过线',
    });
  }
  return goals;
}

/** 按本周主攻的维度，把周计划里"专项"那几天写实 */
export function weekFor(focus: Dim): WeekDay[] {
  return WEEK_PLAN.map((d) =>
    d.title === '常规训练'
      ? { ...d, desc: `热身 + 错题 + <b>${DIM_INFO[focus].name}</b>专项 + 实战复盘` }
      : d,
  );
}

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
