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
import { AI_LEVEL_NAMES, AI_LEVEL_RATING, DIM_INFO, DIMS, opponentFor, type Dim } from './save';

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
      '一步杀、两步杀：对方子力齐全的实战局面里找杀，不做光将摆的必胜题',
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
      '连走几步的杀棋和组合：每一步都逼着对方走，算到将死或者子吃到手为止',
      '战术主题：捉双、牵制、引离、闪击、腾挪、封锁',
      '限时计算——把「算不出来」和「懒得算」分开，这是两个完全不同的病',
    ],
    why: '实战里错过的大便宜，多半是第一步看见了、第三步没算到。要练的是在真实局面里算到底，不是记杀法的名字。',
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
      '实用残局：单马对单士、车兵对车士、车马对单车……对方还有子、走错一步就和的那种；少子的一方练守和',
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
/** 实战里的证据：最近几盘、每盘漏几次（来自复盘） */
export interface GameEvidence {
  games: number;
  blundersPerGame: number | null;
}

/**
 * 出师还要看实战。做题分只说明"会不会做题"：原来光凭做题分出师，
 * 题做得顺的人很快被排到后面的阶段，可实战里照样每盘送子（用户原话："连大师我都下不赢"）。
 * 阶段一的目标本来就写着"把实战送子降到每盘不到一次"——那就拿实战的数来判。
 */
export function gameGate(stage: Stage, ev: GameEvidence | undefined): { ok: boolean; text: string } | null {
  if (!ev) return null;
  const need = stage.id === 1 ? { games: 3, max: 1 } : stage.id === 2 ? { games: 5, max: 0.6 } : null;
  if (!need) return null;
  const now = ev.blundersPerGame;
  const ok = ev.games >= need.games && now !== null && now <= need.max;
  const text =
    ev.games < need.games
      ? `实战漏着每盘 ≤${need.max} 次（至少 ${need.games} 盘复盘数据，现在 ${ev.games} 盘）`
      : `实战漏着每盘 ≤${need.max} 次（最近 ${ev.games} 盘平均 ${now}）`;
  return { ok, text };
}

export function stageFor(ratings: Record<Dim, { r: number }>, ev?: GameEvidence): Stage {
  for (const s of STAGES) {
    const passed = s.graduate.every((g) => ratings[g.dim].r >= g.rating) && (gameGate(s, ev)?.ok ?? true);
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

export type BlockKind = 'assess' | 'own' | 'srs' | 'lesson' | 'focus' | 'endgame' | 'game' | 'quiz' | 'timed' | 'opening' | 'combo' | 'ladder';

export interface Block {
  /** 一天里这一项的编号（assess / srs / lesson / focus / extra / game），打勾用 */
  id: string;
  /** 私教课：这一项是课的第几步（打勾看课的记录） */
  step?: number;
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
  /** 实战分和算进去的盘数（没有就是还没下过） */
  play?: { r: number; n: number } | null;
  /** 某一维还有多少道没做过的题 */
  fresh?: (d: Dim) => number;
  /** 星期几（0 = 周日）。不给就取今天；测试里固定下来 */
  day?: number;
  /** 测评过没有 */
  assessed?: boolean;
  /** 私教课：这节课下一步要做的（没在上课就是 null） */
  lesson?: { title: string; step: number; label: string; kind: string; dim?: Dim } | null;
  /** 布局复习今天到期几套 */
  openingDue?: number;
  /** 你自己棋局里走错、复盘存下来的局面：今天该重走的有几手（到期的 + 还没练过的） */
  ownDue?: number;
  /** 这些错着里最常见的毛病（"漏看威胁"），任务说明里点出来 */
  ownTop?: string;
  /** 最近几天的专项各练的哪一维（新的在后）：同一维连练三天、正确率也上去了，就换一维 */
  recentFocus?: Dim[];
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
 * 私教的每日任务：每天四五项、二十五到三十五分钟，做完一项打一个勾。
 *
 * 用户原话："我希望达到的效果是：每天把私教任务做完，棋艺就能稳步提升；而不是像现在这样总做些重复无效的内容。"
 * 原来的每日训练有三样是白花时间的：
 *   - 热身五道"比你水平简单"的杀法题——会的题再做一遍不涨棋；
 *   - "认一个新杀法图形"——用户原话"没必要细究到底叫闷宫还是马后炮"；
 *   - 布局、打谱、残局那几块点进去就回不来，做没做完也记不下来。
 * 现在的结构按研究和教练的经验排（详见 README）：
 *   ① 错题复习：只在有到期的错题时出现——重复要有目的，重复的是你错过的，不是你会的；
 *   ② 私教课的下一步：课题是从你的实战里挑出来的毛病，一步一步上，下节课先查作业；
 *   ③ 专项八题：练最弱的一维，难度跟着最近的正确率走（太顺加难、太难降难）；
 *      同一维连练三天、正确率也到七成了，换下一维——不在一处原地打转；
 *   ④ 一项轮换：每周小测 / 布局复习 / 中局组合 / 残局 / 绝地反杀 / 限时计算，按阶段和星期轮；
 *   ⑤ 实战一盘、下完看复盘：实战里的错着会自动进错题本，第二天回来找你——这是闭环。
 * 第一次来、还没测过也没下过：只有两项——测评、下一盘。
 */
export function dailyPlan(inp: TrainInput): Block[] {
  const { dueCount, accuracy, ratings } = inp;
  const play = inp.play;
  if (inp.assessed === false && (!play || play.n === 0)) {
    return [
      {
        id: 'assess',
        kind: 'assess',
        title: '水平测评',
        desc: '35 道题，题目跟着你的表现变难变易。测完才知道该从哪儿练起。',
        minutes: 20,
        why: '第一次来：先知道你在哪，后面每天的任务都按这个排。',
      },
      gameBlock(play),
    ];
  }
  const blocks: Block[] = [];

  // ⓪ 复盘错着重练：你自己棋局里走错的局面，复盘存下来，第二天开始按间隔回来找你。
  // 用户原话："私教要将复盘数据带入到日常训练中。针对我复盘表现不好、暴露出的弱项，自动生成到专属课程里让我反复训练。"
  const own = inp.ownDue ?? 0;
  if (own > 0) {
    const n = Math.min(6, own);
    blocks.push({
      id: 'own',
      kind: 'own',
      title: `复盘错着重练 ${n} 手`,
      desc: `你自己棋局里走错的局面，再走一遍正确的${inp.ownTop ? `（最多的是「${inp.ownTop}」）` : ''}。做对隔几天再来，做错明天再来。`,
      minutes: Math.max(3, n),
      count: n,
      why: '这几手是你在实战里真的走错过的——比题库里的题更值得练。',
    });
  }

  if (dueCount > 0) {
    const n = Math.min(10, dueCount);
    blocks.push({
      id: 'srs',
      kind: 'srs',
      title: `错题复习 ${n} 道`,
      desc: '按 1/3/7/21/60 天的间隔回来找你：做对了隔得更久，做错了明天再来。',
      minutes: Math.max(3, Math.ceil(n * 0.7)),
      count: n,
      why: '你已经证明过在这里会错——同一个坑不该掉第二次。',
    });
  }

  const lesson = inp.lesson;
  if (lesson) {
    blocks.push({
      id: 'lesson',
      kind: 'lesson',
      step: lesson.step,
      title: `私教课「${lesson.title}」第 ${lesson.step + 1} 步`,
      desc: lesson.label,
      minutes: lesson.kind === 'game' ? 15 : 8,
      why: '这一课的题目是从你自己的实战里挑出来的毛病。',
    });
  }

  // 专项：最弱的一维；私教课这一步已经在练它，或者已经连练三天而且正确率上来了，就换一维
  const focus = prescribeFocus(inp);
  let dim = focus.dim;
  let why = focus.why.replace(/<[^>]+>/g, '');
  const recent = inp.recentFocus ?? [];
  const stale = recent.length >= 3 && recent.slice(-3).every((d) => d === dim) && (accuracy(dim)?.acc ?? 0) >= 0.7;
  if ((lesson?.kind === 'drill' && lesson.dim === dim) || stale) {
    const second = [...DIMS].filter((d) => d !== dim).sort((a, b) => ratings[a].r - ratings[b].r)[0];
    why = stale
      ? `「${DIM_INFO[dim].name}」已经连练三天、正确率也上去了，今天换练第二弱的「${DIM_INFO[second].name}」。`
      : `「${DIM_INFO[dim].name}」私教课里正在练，专项换成第二弱的「${DIM_INFO[second].name}」。`;
    dim = second;
  }
  const b = biasFor(accuracy(dim));
  const fresh = inp.fresh?.(dim);
  blocks.push({
    id: 'focus',
    kind: 'focus',
    title: `专项：${DIM_INFO[dim].name} 8 题`,
    desc: `${DIM_INFO[dim].desc}${fresh !== undefined && fresh > 0 ? `（还有 ${fresh} 道没做过，先出新题）` : ''}`,
    minutes: 8,
    dim,
    count: 8,
    ratingBias: b.bias,
    why: b.note ? `${why}${b.note}。` : why,
  });

  blocks.push(extraBlock(inp));

  if (lesson?.kind !== 'game') blocks.push(gameBlock(play));
  return blocks;
}

/** 每天一项轮换：每周小测优先，其次到期的布局复习，再按阶段和星期轮 */
function extraBlock(inp: TrainInput): Block {
  if (inp.daysSinceQuiz >= 7) {
    return {
      id: 'extra',
      kind: 'quiz',
      title: '每周小测 10 题',
      desc: '五维各抽两题，不给提示。测出来的分直接更新五维雷达。',
      minutes: 6,
      count: 10,
      why: inp.daysSinceQuiz >= 900 ? '练而不测，涨没涨全靠感觉——每周一次，看趋势。' : `距离上次小测 ${inp.daysSinceQuiz} 天了。每周测一次，看练的东西有没有落到实处。`,
    };
  }
  if ((inp.openingDue ?? 0) > 0 && inp.stage.id >= 3) {
    return {
      id: 'extra',
      kind: 'opening',
      title: `布局复习 ${inp.openingDue} 套`,
      desc: '自己执一方把走过的主线再走一遍，按间隔重复回来。',
      minutes: 6,
      why: '学过的谱不复习，过两周就忘。',
    };
  }
  const BY_STAGE: Record<number, BlockKind[]> = {
    1: ['ladder', 'endgame', 'ladder', 'endgame'],
    2: ['combo', 'ladder', 'endgame', 'timed'],
    3: ['endgame', 'combo', 'ladder', 'timed'],
    4: ['opening', 'combo', 'endgame', 'ladder', 'timed'],
  };
  const list = BY_STAGE[Math.min(4, Math.max(1, inp.stage.id))];
  const kind = list[(inp.day ?? new Date().getDay()) % list.length];
  const EXTRA: Record<string, Omit<Block, 'id' | 'kind'>> = {
    ladder: {
      title: '绝地反杀 闯一关',
      desc: '对方下一步就能杀你，只有连续将军抢在他前面杀死他。',
      minutes: 6,
      why: '实战里最要命的时刻是"对方马上要杀我了"——先看自己有没有连将，常常是唯一的活路。',
    },
    endgame: {
      title: '实用残局 下到底',
      desc: '跟引擎下完：要赢的必须赢下来，要守的必须守和。',
      minutes: 8,
      why: '中局挣来的优势最后都要在残局兑现。',
    },
    combo: {
      title: '中局组合 5 题',
      desc: '连走几步才拿到便宜：走到子吃到手或者将死才算对。',
      minutes: 7,
      why: '一两步的战术练"看见"，组合练"算到底"。',
    },
    timed: {
      title: '限时计算 6 题',
      desc: '每题 45 秒，做错的再不限时重做一遍。',
      minutes: 8,
      why: '把"算不出来"和"懒得算"分开——两个病练法相反。',
    },
    opening: {
      title: '布局体系 过一套',
      desc: '先看讲解，再执一方自己走一遍。',
      minutes: 8,
      why: '要学的不是招法表，是每一手在干什么、对方走偏了怎么破。',
    },
  };
  return { id: 'extra', kind, ...EXTRA[kind] };
}

/** 实战一局：按实战分推荐对手 */
function gameBlock(play: { r: number; n: number } | null | undefined): Block {
  if (!play || play.n < 3) {
    const n = play?.n ?? 0;
    return {
      id: 'game',
      kind: 'game',
      title: '实战一盘，下完看复盘',
      desc: '和 AI 正常下完一盘，下完点复盘。',
      minutes: 15,
      why: `实战才下了 ${n} 盘——下够 3 盘，水平和每天的任务都改按实战定。`,
    };
  }
  const lv = opponentFor(play.r);
  return {
    id: 'game',
    kind: 'game',
    title: '实战一盘，下完看复盘',
    desc: `对手「${AI_LEVEL_NAMES[lv]}」（约 ${AI_LEVEL_RATING[lv]}，和你的实战分 ${play.r} 相当）。`,
    minutes: 15,
    why: '复盘会把你这盘走错的手存进错题本，明天回来找你——这一步不做，整个循环就断了。',
  };
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
