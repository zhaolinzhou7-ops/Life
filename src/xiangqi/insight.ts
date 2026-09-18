/**
 * 错误画像与棋风画像。
 *
 * 产品规格里有一句必须守住的话：**这是基于真实棋局数据的行为分析，
 * 不是凭空给用户贴标签**。所以这个模块只做一件事——
 * 把存档里已经发生过的事实做统计，够了才下结论，不够就明说不够。
 *
 * 具体守则：
 *   1. 每一条结论都必须能指出证据（"最近 8 盘里有 5 盘出现过"）
 *   2. 样本不够（少于 3 盘）不出画像，只说"再下几盘"
 *   3. 只报**占比明显**的毛病，不把每种错误都列出来凑数——
 *      列十条等于没重点，用户不会看
 *   4. 不说"你性格急躁"这种棋盘外的话，只说棋盘上量得到的行为
 */
import { isInCheck, type Board, type Color, type Move } from './rules';
import { ERR_INFO, other, type ErrTag } from './teach';
import { openGame, replay, type ArchivedGame } from './archive';

/** 一条错误习惯 */
export interface Habit {
  tag: ErrTag;
  name: string;
  /** 一共犯了几次 */
  count: number;
  /** 占全部失误的比例 0..1 */
  share: number;
  /** 出现在几盘棋里 */
  games: number;
  advice: string;
}

/** 一条棋风特征 */
export interface Trait {
  id: string;
  name: string;
  /** 给用户看的描述 */
  desc: string;
  /** 证据，必须是数出来的 */
  evidence: string;
  /** 正面特征还是要改的地方 */
  tone: 'good' | 'warn';
}

export interface Profile {
  /** 统计了多少盘 */
  games: number;
  /** 其中复盘分析过的有几盘（只有分析过的才有错误标签） */
  reviewed: number;
  /** 样本够不够下结论 */
  enough: boolean;
  wins: number;
  losses: number;
  draws: number;
  /** 平均对局长度（你走的手数） */
  avgPlies: number;
  habits: Habit[];
  traits: Trait[];
  /** 一段话的画像。够不够样本都有话说，但话不一样 */
  summary: string;
}

/** 样本门槛：少于这个数不下结论 */
const MIN_GAMES = 3;
/** 一种毛病占比低于这个就不单列，免得画像上一堆噪音 */
const MIN_SHARE = 0.15;

// ───────────────────────── 行为统计（重放棋局数出来） ─────────────────────────

export interface Behaviour {
  /** 你走的手数 */
  plies: number;
  /** 你吃子的次数 */
  captures: number;
  /** 你将军的次数 */
  checks: number;
  /** 对方吃你子的次数 */
  lost: number;
  /** 你被将军的次数 */
  checked: number;
}

/**
 * 重放一盘棋，数出双方的行为。
 *
 * 为什么要重放而不是存起来：存下来的字段迟早会和真实棋谱对不上
 * （改了统计口径、老存档没有新字段），而重放永远以棋谱为准。
 * 一盘 60 手重放一次不到 1 毫秒，没必要为它牺牲正确性。
 */
export function behaviourOf(start: Board, moves: Move[], startColor: Color, me: Color): Behaviour {
  const boards = replay(start, moves);
  const b: Behaviour = { plies: 0, captures: 0, checks: 0, lost: 0, checked: 0 };
  let turn = startColor;
  moves.forEach((m, i) => {
    const before = boards[i];
    const after = boards[i + 1];
    const took = !!before[m.ty][m.tx];
    if (turn === me) {
      b.plies++;
      if (took) b.captures++;
      if (isInCheck(after, other(me))) b.checks++;
    } else {
      if (took) b.lost++;
      if (isInCheck(after, me)) b.checked++;
    }
    turn = other(turn);
  });
  return b;
}

/** 把一盘存档重放成行为统计；存档读不出来返回 null */
export function behaviourOfGame(g: ArchivedGame): Behaviour | null {
  const opened = openGame(g);
  if (!opened) return null;
  return behaviourOf(opened.start, opened.moves, opened.startColor, g.side);
}

// ───────────────────────── 画像 ─────────────────────────

/**
 * 从存档里生成画像。
 *
 * 输入是存档数组而不是直接读 localStorage——这样它是个纯函数，
 * 可以拿构造好的数据测出确定的结果。画像这种东西一旦写成
 * "读全局状态然后返回一段话"，就永远测不了，也就永远不知道它有没有在胡说。
 */
export function buildProfile(games: ArchivedGame[]): Profile {
  const n = games.length;
  const reviewedGames = games.filter((g) => g.review);
  const wins = games.filter((g) => g.result === 'win').length;
  const losses = games.filter((g) => g.result === 'loss').length;
  const draws = games.filter((g) => g.result === 'draw').length;

  // 行为统计：能重放的就重放，读不出来的跳过
  const behaviours = games.map(behaviourOfGame).filter((b): b is Behaviour => !!b);
  const sum = behaviours.reduce(
    (a, b) => ({
      plies: a.plies + b.plies,
      captures: a.captures + b.captures,
      checks: a.checks + b.checks,
      lost: a.lost + b.lost,
      checked: a.checked + b.checked,
    }),
    { plies: 0, captures: 0, checks: 0, lost: 0, checked: 0 },
  );
  const avgPlies = behaviours.length ? Math.round(sum.plies / behaviours.length) : 0;

  // 错误标签统计
  const counts: Partial<Record<ErrTag, number>> = {};
  const inGames: Partial<Record<ErrTag, number>> = {};
  for (const g of reviewedGames) {
    for (const [k, v] of Object.entries(g.review!.tags ?? {})) {
      const tag = k as ErrTag;
      if (!v) continue;
      counts[tag] = (counts[tag] ?? 0) + v;
      inGames[tag] = (inGames[tag] ?? 0) + 1;
    }
  }
  const totalErrors = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);

  const habits: Habit[] = (Object.keys(counts) as ErrTag[])
    .map((tag) => ({
      tag,
      name: ERR_INFO[tag].name,
      count: counts[tag]!,
      share: totalErrors ? counts[tag]! / totalErrors : 0,
      games: inGames[tag] ?? 0,
      advice: ERR_INFO[tag].advice,
    }))
    .filter((h) => h.share >= MIN_SHARE || h.count >= 3)
    .sort((a, b) => b.count - a.count);

  const enough = n >= MIN_GAMES && reviewedGames.length >= 1;
  const traits = enough ? buildTraits(sum, behaviours.length, habits, games) : [];

  return {
    games: n,
    reviewed: reviewedGames.length,
    enough,
    wins,
    losses,
    draws,
    avgPlies,
    habits,
    traits,
    summary: summaryOf({ n, enough, habits, traits, wins, losses }),
  };
}

/**
 * 棋风特征。每一条都必须配一个数出来的证据。
 *
 * 阈值是按业余对局的常见分布定的，不是拍脑袋：
 * 平均一盘 40 手里将军 4 次以上已经明显偏攻，吃子率超过三成是主动换子型。
 */
function buildTraits(
  sum: Behaviour,
  gameCount: number,
  habits: Habit[],
  games: ArchivedGame[],
): Trait[] {
  const out: Trait[] = [];
  const perGame = (v: number) => (gameCount ? v / gameCount : 0);
  const checkRate = perGame(sum.checks);
  const capRate = sum.plies ? sum.captures / sum.plies : 0;
  const lossRate = sum.plies ? sum.lost / sum.plies : 0;

  if (checkRate >= 4) {
    out.push({
      id: 'aggressive',
      name: '进攻意识强',
      desc: '你喜欢主动出击，常常逼着对方应付你。',
      evidence: `平均每盘将军 ${checkRate.toFixed(1)} 次`,
      tone: 'good',
    });
  } else if (checkRate <= 1 && gameCount >= 3) {
    out.push({
      id: 'passive',
      name: '偏保守',
      desc: '你很少主动去攻对方的将，多数时间在应对。适当找机会进攻，局面会好带很多。',
      evidence: `平均每盘只将军 ${checkRate.toFixed(1)} 次`,
      tone: 'warn',
    });
  }

  if (capRate >= 0.3) {
    out.push({
      id: 'trader',
      name: '爱换子',
      desc: '你出手很果断，见子就换。换子本身没错，关键是每次都要算清楚赚还是亏。',
      evidence: `你走的棋里有 ${Math.round(capRate * 100)}% 是吃子`,
      tone: 'good',
    });
  }

  if (lossRate >= 0.22) {
    out.push({
      id: 'leaky',
      name: '子力容易流失',
      desc: '对方吃你子的频率偏高，多半是落子前没检查自己的子有没有人保护。',
      evidence: `对方平均每 ${Math.round(1 / lossRate)} 手就能吃你一个子`,
      tone: 'warn',
    });
  }

  // 残局薄弱：输掉的棋是不是都拖得特别长
  const longLosses = games.filter((g) => g.result === 'loss' && g.moves.length / 4 >= 70).length;
  const totalLosses = games.filter((g) => g.result === 'loss').length;
  if (totalLosses >= 3 && longLosses / totalLosses >= 0.6) {
    out.push({
      id: 'endgame-weak',
      name: '残局吃亏',
      desc: '你输的棋多数是拖到后面才输的，说明中局撑得住，残局技术还差一口气。',
      evidence: `${totalLosses} 盘负局里有 ${longLosses} 盘拖过 70 回合`,
      tone: 'warn',
    });
  }

  // 开局重复犯错：把画像和错误标签接起来
  const h = habits.find((x) => x.tag === 'missed-threat');
  if (h && h.share >= 0.3) {
    out.push({
      id: 'self-focused',
      name: '只看自己不看对方',
      desc: '你的失误里有很大一块是"对方已经在捉子了，你还在忙自己的"。这是习惯问题，改起来最快。',
      evidence: `${h.count} 次漏看威胁，占全部失误的 ${Math.round(h.share * 100)}%`,
      tone: 'warn',
    });
  }

  const g2 = habits.find((x) => x.tag === 'greedy');
  if (g2 && g2.share >= 0.25) {
    out.push({
      id: 'greedy',
      name: '容易贪吃',
      desc: '见到能吃的子就吃，没算后面那一下。吃之前多花三秒算笔账，这一条能省掉你一半的输棋。',
      evidence: `${g2.count} 次贪吃，占全部失误的 ${Math.round(g2.share * 100)}%`,
      tone: 'warn',
    });
  }

  return out;
}

/** 把画像写成一段话。样本不够就老实说不够 */
function summaryOf(x: {
  n: number;
  enough: boolean;
  habits: Habit[];
  traits: Trait[];
  wins: number;
  losses: number;
}): string {
  if (x.n === 0) return '还没有对局记录。下完一盘并复盘之后，这里会告诉你自己的棋是什么样子。';
  if (!x.enough) {
    return `已经有 ${x.n} 盘记录了。再下 ${Math.max(1, MIN_GAMES - x.n)} 盘并复盘，我就能说清楚你的棋风和常犯的毛病——样本太少的时候下结论是不负责任的。`;
  }

  const good = x.traits.filter((t) => t.tone === 'good');
  const warn = x.traits.filter((t) => t.tone === 'warn');
  const parts: string[] = [];

  if (good.length) parts.push(`你${good.map((t) => t.name).join('、')}`);
  if (warn.length) parts.push(`${good.length ? '但' : '你目前'}${warn[0].desc}`);
  if (!good.length && !warn.length) parts.push('你的棋路比较均衡，没有特别突出的偏向。');

  if (x.habits.length) {
    const h = x.habits[0];
    parts.push(`\n\n最该先改的一条是**${h.name}**：${ERR_INFO[h.tag].desc}。${h.advice}`);
  }
  return parts.join('');
}

/** 给 AI 教练对话用的习惯清单（简化成讲解层的形状） */
export function habitsForCoach(p: Profile): { name: string; count: number; advice: string }[] {
  return p.habits.slice(0, 3).map((h) => ({ name: h.name, count: h.count, advice: h.advice }));
}

/**
 * 根据画像决定**今天该练什么**。
 *
 * 这是"实战 → 找问题 → 出题 → 训练"闭环里的出题那一环：
 * 不按你分低的那一维出题，按你**实战里真的在丢分**的那一类出题。
 */
export function trainingFocus(p: Profile): { kind: 'safety' | 'mate' | 'tactic' | 'endgame' | 'opening'; why: string } {
  const top = p.habits[0];
  if (!top) {
    return { kind: 'safety', why: '还没有足够的对局数据，先从最基础的眼力题开始——不送子是所有水平的地基。' };
  }
  const map: Record<ErrTag, 'safety' | 'mate' | 'tactic' | 'endgame' | 'opening'> = {
    hang: 'safety',
    greedy: 'safety',
    'missed-threat': 'safety',
    'walk-into-mate': 'mate',
    'missed-mate': 'mate',
    slow: 'tactic',
  };
  const kind = map[top.tag];
  return {
    kind,
    why: `你最近 ${top.games} 盘棋里出现了 ${top.count} 次「${top.name}」，所以今天练这一类。`,
  };
}
