/**
 * 私教：一对一带你练。
 *
 * 用户原话："你要看一下《天天象棋》里的'私教'功能是怎么运转的，思考怎么才能当好一个象棋私教。"
 * 天天象棋是 2025 年 3 月（4.2.7.4 版）上的"私教"，和对局结算的五维图、对局总结一起出的；
 * 公开能查到的只有这一句版本说明，具体怎么运转查不到，所以这里不照抄，按"一个好的私教该干什么"来做：
 *
 *   1. **先看你的棋，再开口**：最近复盘过的实战里，你在哪一类错误上丢分最多——证据是数出来的
 *      （"最近 6 盘里漏看威胁 9 次，每盘 1.5 次"），不是凭印象贴标签；
 *   2. **一节课只讲一件事**：一个主题、三条要点，讲完马上练；
 *   3. **先练你自己走错的局面**：实战里走错的那一手早就存进了错题本，私教先拿它出题，不够再从题库补同一类；
 *   4. **带练一盘**：教练开"教学提示"陪你下一盘，盯着这一课的毛病；
 *   5. **下节课先检查作业**：这一课的毛病在之后的实战里少了没有——
 *      少了三成以上就过关、换下一个主题；没少就换个角度再练一遍；实战不够就先去下棋，不瞎判。
 *
 * 这个文件只管"该上什么课、上得怎么样"（纯计算，单测锁死）；界面在 coach.ts 的 showTutor。
 */
import type { ArchivedGame } from './archive';
import type { ErrTag } from './teach';
import type { Dim } from './save';

/** 一节课的主题：实战里的五种毛病 + 两块按测评补的短板 + 第一次见面 */
export type Theme = ErrTag | 'endgame' | 'opening' | 'intro';

/** 课上的一步 */
export type Step =
  /** 你自己实战里走错的局面（错题本里的实战题），按维度挑 */
  | { kind: 'own'; dims: Dim[]; n: number; label: string }
  /** 题库里同一类的题 */
  | { kind: 'drill'; dim: Dim; n: number; label: string }
  /** 一条邪门布局：你来破解 */
  | { kind: 'trick'; id: string; label: string }
  /** 绝地反杀闯几关 */
  | { kind: 'counterkill'; n: number; label: string }
  /** 带练一盘：教练开"教学提示" */
  | { kind: 'game'; label: string }
  /** 水平测评 */
  | { kind: 'assess'; label: string };

export interface Lesson {
  theme: Theme;
  title: string;
  /** 为什么今天上这一课：证据 */
  why: string;
  /** 三条要点：这节课要讲的东西 */
  points: string[];
  steps: Step[];
  /** 下节课怎么检查 */
  check: string;
  /** 同一个主题第几次上（换个角度） */
  round: number;
}

/** 存下来的一节课 */
export interface LessonRecord {
  /** 开课时间 */
  ts: number;
  d: string;
  theme: Theme;
  round: number;
  /** 这节课的第几步做完了 */
  done: number[];
  steps: number;
  /** 开课时，这个毛病在之前的实战里每盘几次（复盘过的棋） */
  before: number | null;
  /** 检查结果：之后的实战里每盘几次；过关没有 */
  after?: number | null;
  passed?: boolean;
}

export interface TutorInput {
  /** 最近的实战（新的在前），带复盘结论的才算证据 */
  games: ArchivedGame[];
  /** 测评过没有、各维的分 */
  assessed: boolean;
  ratings: Record<Dim, { r: number }>;
  /** 上过的课（旧的在前） */
  log: LessonRecord[];
  /** 实战错题（错题本里实战来的那些）各维有几道 */
  ownByDim: Partial<Record<Dim, number>>;
}

/** 每种毛病：课题、三条要点、练什么 */
const THEMES: Record<Exclude<Theme, 'intro'>, { title: string; points: string[]; steps: (round: number) => Step[]; dims: Dim[] }> = {
  hang: {
    title: '落子三问：这一步走过去，谁能吃它？',
    dims: ['safety'],
    points: [
      '每一步落子之前问三句：这个子走过去，对方谁能吃它？我有几个子保护它？被吃了，我吃回来划不划算？',
      '最容易送的是"走过去才没保护"的子：马跳进对方阵地、炮打完兵停在原地、车冲得太深回不来。',
      '还要看"走开以后"：你挪开一个子，可能给对方的炮让出了炮架，或者解开了对方的马腿。',
    ],
    steps: (r) => [
      { kind: 'own', dims: ['safety', 'tactic'], n: 3, label: '先看你自己送过的子' },
      { kind: 'drill', dim: 'safety', n: r > 1 ? 8 : 6, label: '眼力题：哪个子没保护、哪一步不亏' },
      { kind: 'game', label: '带练一盘：每一步落子前三问' },
    ],
  },
  greedy: {
    title: '吃子先算账：我吃多少，他吃回多少',
    dims: ['safety', 'tactic'],
    points: [
      '吃之前算一笔账：我吃到的子值多少，对方吃回来的值多少（车 10、炮 5、马 4.5、士象 2.2、兵 1，按兵算）。',
      '送到嘴边的子，先把它后面那条线看到底：龟背炮的 7 卒后面有马有炮，车一吃就被打掉；铁滑车、敢死炮送的子能吃，可吃完马上要看他在捉谁。',
      '吃子也要走一步，吃完那个子常常站在没保护的地方——"宁失一子，不失一先"，反过来说就是：贪一个子，常常丢一步先。',
    ],
    steps: (r) => [
      { kind: 'own', dims: ['safety', 'tactic'], n: 3, label: '先看你自己贪过的子' },
      { kind: 'trick', id: r % 2 ? 'guibeipao' : 'tiehuache', label: r % 2 ? '龟背炮：卒后面藏着炮' : '铁滑车：吃了马以后别贪第二个' },
      { kind: 'drill', dim: 'tactic', n: 6, label: '战术题：算清楚再吃' },
      { kind: 'game', label: '带练一盘：吃子之前先算账' },
    ],
  },
  'missed-threat': {
    title: '对方每走一步，先问"他想干什么"',
    dims: ['safety'],
    points: [
      '对方走完，先别想自己的计划：他这一步捉了谁？下一步能不能将军？能吃什么？',
      '扫威胁按顺序：车（直线、横线）→ 炮（隔一个子打）→ 马（先看马腿）→ 过河兵（横着也能吃）。',
      '看见威胁有四种应法：躲开、保护、挡住、反击（比他更凶的威胁）。先选不丢先手的那一种。',
    ],
    steps: (r) => [
      { kind: 'drill', dim: 'safety', n: r > 1 ? 8 : 6, label: '眼力题：点出被捉的子' },
      { kind: 'own', dims: ['safety'], n: 3, label: '你实战里漏看的那几手' },
      { kind: 'trick', id: 'xiayangou', label: '瞎眼狗：车对准的不是兵，是兵后面的马' },
      { kind: 'game', label: '带练一盘：对方每一步先问他想干什么' },
    ],
  },
  'walk-into-mate': {
    title: '进攻之前，先看自己的九宫',
    dims: ['mate', 'safety'],
    points: [
      '进攻前先看自己的帅：对方的车、马、炮离九宫有几步？有没有"一步将军、两步杀"的路线？',
      '帅前面的中线别空着（急进中兵就是等你开门，空头炮一架，士象都上不来）；士角别让车占住（弃马十三着就是从士角杀进来的）。',
      '对方的攻势已经到了，先补士、飞象、调子回防——多吃一个子顶不住一步杀。',
    ],
    steps: (r) => [
      { kind: 'trick', id: r % 2 ? 'qima-shisan' : 'jijin-zhongbing', label: r % 2 ? '弃马十三着：没补士，十三步被杀' : '急进中兵：中卒是将的门板' },
      { kind: 'drill', dim: 'mate', n: 6, label: '杀法题：认清楚别人怎么杀你' },
      { kind: 'own', dims: ['mate', 'safety'], n: 3, label: '你实战里被将死前的那一手' },
      { kind: 'game', label: '带练一盘：进攻前先看自己的九宫' },
    ],
  },
  'missed-mate': {
    title: '将军优先：能杀先杀',
    dims: ['mate'],
    points: [
      '每一步先把所有将军的着法过一遍：对方怎么应？应完我还能不能接着将？',
      '杀法有图形：马后炮、重炮、闷宫、双车错、铁门栓……认熟了，看一眼就知道能不能杀。',
      '对方下一步就能杀你的时候，只有连将才能抢在他前面——这就是"绝地反杀"要练的。',
    ],
    steps: (r) => [
      { kind: 'drill', dim: 'mate', n: r > 1 ? 8 : 6, label: '杀法题' },
      { kind: 'counterkill', n: 2, label: '绝地反杀两关：只有连将才能活' },
      { kind: 'own', dims: ['mate'], n: 3, label: '你实战里漏掉的杀' },
      { kind: 'game', label: '带练一盘：每一步先找将军' },
    ],
  },
  slow: {
    title: '每一步都要有目的：抢先手',
    dims: ['tactic', 'opening'],
    points: [
      '开局先把车马炮出齐，别一个子连走两三步；兵只动有用的（活马、通车）。',
      '中局每一步问一句：走完之后，对方是不是必须应我？逼着对方应的叫先手，抢到一步就多一步。',
      '"宁失一子，不失一先"：江湖套路就是拿子换先手——反过来，你白走一步，就等于把半个子送给了对方。',
    ],
    steps: () => [
      { kind: 'trick', id: 'gansipao-red', label: '敢死炮：吃了炮别恋子，趁他捉你多出子' },
      { kind: 'drill', dim: 'tactic', n: 6, label: '战术题：找最主动的一手' },
      { kind: 'own', dims: ['tactic', 'opening'], n: 3, label: '你实战里走软的那几手' },
      { kind: 'game', label: '带练一盘：每一步都要逼他应' },
    ],
  },
  endgame: {
    title: '残局：多子要赢下来，少子要守住',
    dims: ['endgame'],
    points: [
      '残局先数子：谁多什么、能不能赢——车对士象全、马炮对单士象这些结论要背下来，别把赢棋走和、把和棋走输。',
      '帅（将）要参战：残局里帅是一个能打的子，占中、助攻、守底线都靠它。',
      '对方下一步就杀你的时候，别想着慢慢赢，只有连将能救命。',
    ],
    steps: () => [
      { kind: 'drill', dim: 'endgame', n: 6, label: '残局题' },
      { kind: 'counterkill', n: 2, label: '绝地反杀两关' },
      { kind: 'own', dims: ['endgame'], n: 3, label: '你实战里残局走坏的那几手' },
    ],
  },
  opening: {
    title: '布局：出子、占线，别被套路骗',
    dims: ['opening'],
    points: [
      '开局十步以内：车马炮出齐、车占通路、中路有保护——做到这三条，布局就不会吃大亏。',
      '江湖套路都是"送你一点东西换先手"：先问他要换什么，送的子能不能吃、吃完他捉谁。',
      '中路只剩一个中卒挡着的时候别动它，士、象、中炮先上来。',
    ],
    steps: (r) => [
      { kind: 'trick', id: r % 2 ? 'tiehuache' : 'jijin-zhongbing', label: r % 2 ? '铁滑车' : '急进中兵' },
      { kind: 'trick', id: r % 2 ? 'xiayangou' : 'gansipao-red', label: r % 2 ? '瞎眼狗' : '敢死炮' },
      { kind: 'drill', dim: 'opening', n: 6, label: '开局题' },
    ],
  },
};

/** 一盘复盘过的棋里某个毛病出现了几次 */
const countIn = (g: ArchivedGame, theme: Theme) => (g.review?.tags?.[theme as ErrTag] ?? 0);

/**
 * 这个毛病在一批复盘过的棋里平均每盘几次；复盘过的不到 minGames 盘返回 null（不够下结论）。
 */
export function ratePerGame(games: ArchivedGame[], theme: Theme, minGames = 1): number | null {
  const rev = games.filter((g) => g.review);
  if (rev.length < minGames) return null;
  return Math.round((rev.reduce((s, g) => s + countIn(g, theme), 0) / rev.length) * 10) / 10;
}

/** 最近复盘过的棋里，各个毛病一共几次（只看最近 8 盘复盘过的） */
export function habitCounts(games: ArchivedGame[]): { tag: ErrTag; count: number; games: number }[] {
  const rev = games.filter((g) => g.review).slice(0, 8);
  const by = new Map<ErrTag, { count: number; games: number }>();
  for (const g of rev) {
    for (const [k, v] of Object.entries(g.review!.tags ?? {})) {
      if (!v) continue;
      const cur = by.get(k as ErrTag) ?? { count: 0, games: 0 };
      cur.count += v;
      cur.games++;
      by.set(k as ErrTag, cur);
    }
  }
  return [...by.entries()].map(([tag, x]) => ({ tag, ...x })).sort((a, b) => b.count - a.count || b.games - a.games);
}

/** 过关的标准：之后的实战里，这个毛病每盘少了三成以上（或者干脆没再出现） */
export const PASS_DROP = 0.3;
/** 检查作业至少要等几盘复盘过的实战 */
export const CHECK_GAMES = 2;

/**
 * 检查上一节课：之后的实战够不够、毛病少了没有。
 * 返回 null 表示实战还不够，没法判。
 */
export function checkLesson(rec: LessonRecord, games: ArchivedGame[]): { after: number; passed: boolean; n: number } | null {
  if (rec.theme === 'intro' || rec.theme === 'endgame' || rec.theme === 'opening') return null;
  const later = games.filter((g) => g.ts > rec.ts && g.review);
  if (later.length < CHECK_GAMES) return null;
  const after = ratePerGame(later, rec.theme)!;
  const before = rec.before ?? 0;
  const passed = after === 0 || (before > 0 && after <= before * (1 - PASS_DROP));
  return { after, passed, n: later.length };
}

const NAMES: Record<Theme, string> = {
  hang: '送子',
  greedy: '贪吃',
  'missed-threat': '漏看威胁',
  'walk-into-mate': '漏将',
  'missed-mate': '漏杀',
  slow: '走软',
  endgame: '残局',
  opening: '布局',
  intro: '见面课',
};
export const themeName = (t: Theme) => NAMES[t];

/** 测评五维里最弱的一维（只在残局、布局两块里挑——前三块的毛病由实战证据决定） */
function weakSide(ratings: Record<Dim, { r: number }>): 'endgame' | 'opening' {
  return ratings.endgame.r <= ratings.opening.r ? 'endgame' : 'opening';
}

/**
 * 今天上什么课。
 *
 * 次序：
 *   1. 上一节课没上完 → 接着上；
 *   2. 什么证据都没有（没测评、没有复盘过的实战）→ 见面课：先测一下、下一盘让教练看看；
 *   3. 上一节课的毛病还没过关（之后的实战里没少）→ 同一个主题换个角度再上一遍；
 *   4. 最近实战里出现最多、而且还没过关的毛病；
 *   5. 实战里没什么毛病了（或者都过关了）→ 测评里残局、布局哪块弱补哪块。
 */
export function planLesson(inp: TutorInput): Lesson {
  const last = inp.log[inp.log.length - 1];
  if (last && last.done.length < last.steps) return buildLesson(last.theme, last.round, inp, '上节课还没上完，接着来。');

  const reviewed = inp.games.filter((g) => g.review);
  if (!inp.assessed && !reviewed.length) return buildLesson('intro', 1, inp, '我们第一次见面：我还不知道你的棋是什么样，先测一下、再下一盘给我看看。');

  // 上一节课的作业检查
  const passedThemes = new Set(inp.log.filter((r) => r.passed).map((r) => r.theme));
  /** 上一节课的作业还没法检查（之后的实战不够）：今天先上别的，不重复上同一课 */
  let pending: Theme | null = null;
  if (last && last.theme !== 'intro') {
    const c = checkLesson(last, inp.games);
    if (c && !c.passed) {
      return buildLesson(
        last.theme,
        last.round + 1,
        inp,
        `上节课练的是「${NAMES[last.theme]}」。之后 ${c.n} 盘实战里每盘还有 ${c.after} 次（上课前每盘 ${last.before ?? 0} 次），没怎么少——换个角度再练一遍。`,
      );
    }
    if (c?.passed) passedThemes.add(last.theme);
    else if (!c && last.passed === undefined && last.theme !== 'endgame' && last.theme !== 'opening') pending = last.theme;
  }

  const habits = habitCounts(inp.games).filter((h) => !passedThemes.has(h.tag) && h.tag !== pending);
  const note = pending ? `（上节课「${NAMES[pending]}」的作业还没法检查：之后复盘过的实战不到 ${CHECK_GAMES} 盘。）` : '';
  if (habits.length) {
    const h = habits[0];
    const n = reviewed.slice(0, 8).length;
    const rounds = inp.log.filter((r) => r.theme === h.tag).length;
    return buildLesson(
      h.tag,
      rounds + 1,
      inp,
      `最近 ${n} 盘复盘过的实战里，「${NAMES[h.tag]}」一共 ${h.count} 次，出现在 ${h.games} 盘里——这是你现在丢分最多的地方。${note}`,
    );
  }
  const side = weakSide(inp.ratings);
  const rounds = inp.log.filter((r) => r.theme === side).length;
  return buildLesson(
    side,
    rounds + 1,
    inp,
    reviewed.length
      ? `最近的实战里没有哪一种毛病特别突出${passedThemes.size ? '（练过的都过关了）' : ''}。测评里「${NAMES[side]}」是你相对弱的一块，今天补它。${note}`
      : `还没有复盘过的实战，先按测评来：「${NAMES[side]}」是你相对弱的一块。${note}`,
  );
}

function buildLesson(theme: Theme, round: number, inp: TutorInput, why: string): Lesson {
  if (theme === 'intro') {
    return {
      theme,
      title: '见面课：先让我看看你的棋',
      why,
      points: [
        '私教不是题库：我得先知道你在哪里丢分，才知道该教什么。',
        '测评量的是"会不会做题"，实战量的是"下棋时看不看得见"——两样我都要看。',
        '下完那盘棋记得看复盘：复盘的结论（哪一手亏、是什么毛病）就是我下节课的教案。',
      ],
      // 两步都一直列着（测过了界面上就打勾）：步数一变，已经打的勾就对不上了
      steps: [
        { kind: 'assess', label: '水平测评（约 20 分钟）' },
        { kind: 'game', label: '下一盘给我看看（下完看复盘）' },
      ],
      check: '下节课我会看这盘棋的复盘：你在哪一类错误上丢分最多，就从哪一课开始。',
      round,
    };
  }
  const th = THEMES[theme];
  const steps = th.steps(round).filter((s) => s.kind !== 'own' || s.dims.some((d) => (inp.ownByDim[d] ?? 0) > 0));
  const isHabit = theme !== 'endgame' && theme !== 'opening';
  return {
    theme,
    title: round > 1 ? `${th.title}（第 ${round} 次，换个角度）` : th.title,
    why,
    points: th.points,
    steps,
    check: isHabit
      ? `作业：接下来下 ${CHECK_GAMES} 盘以上实战，下完都看一下复盘。下节课我先数「${NAMES[theme]}」每盘还有几次——少了三成以上就过关，换下一课。`
      : `作业：把今天的题做完，再下一盘实战。下节课看实战里有没有新的毛病；没有的话接着补测评里弱的那一块。`,
    round,
  };
}

// ───────────────────────── 存档 ─────────────────────────

const KEY = 'xq-tutor';

export function getLessonLog(): LessonRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as LessonRecord[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveLog(log: LessonRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log.slice(-60)));
  } catch {
    /* 存不下就算了，课照上 */
  }
}

/** 开一节课（同一节课没上完就不重复开） */
export function startLesson(l: Lesson, games: ArchivedGame[], now = Date.now()): LessonRecord[] {
  const log = getLessonLog();
  const last = log[log.length - 1];
  if (last && last.done.length < last.steps && last.theme === l.theme) return log;
  // 上一节课的检查结果落档（新开一课之前）
  if (last && last.passed === undefined) {
    const c = checkLesson(last, games);
    if (c) {
      last.after = c.after;
      last.passed = c.passed;
    }
  }
  const before = l.theme === 'intro' || l.theme === 'endgame' || l.theme === 'opening' ? null : ratePerGame(games.filter((g) => g.ts <= now).slice(0, 8), l.theme);
  log.push({ ts: now, d: new Date(now).toLocaleDateString('sv'), theme: l.theme, round: l.round, done: [], steps: l.steps.length, before });
  saveLog(log);
  return log;
}

/** 这节课的第 i 步做完了 */
export function markStep(i: number): LessonRecord[] {
  const log = getLessonLog();
  const last = log[log.length - 1];
  if (last && !last.done.includes(i)) {
    last.done.push(i);
    saveLog(log);
  }
  return log;
}

/** 第一次见面课上完就算"过了"——它没有毛病可检查 */
export function closeIntro(): void {
  const log = getLessonLog();
  const last = log[log.length - 1];
  if (last && last.theme === 'intro' && last.done.length >= last.steps) {
    last.passed = true;
    saveLog(log);
  }
}
