/**
 * 学棋中心：测评 → 诊断 → 专项练习 → 错题重练。
 *
 * 设计上最要紧的一条：**分数要分维度给**。只报一个"你 1350 分"没用，
 * 学生不知道该练什么；五边形一摊开，短板一眼就看得出来，
 * 后面的课程也才有依据从哪一维切入。
 */
import {
  DIMS,
  DIM_INFO,
  rankOf,
  ttNear,
  getRatings,
  recordAssessment,
  isAssessed,
  updateRating,
  firstAttempt,
  attemptedMap,
  todayNum,
  weakestDim,
  overallOf,
  honestLevel,
  gameEvidence,
  getPlay,
  AI_LEVEL_NAMES,
  opponentFor,
  getStreak,
  checkIn,
  markWrong,
  markRight,
  dueCards,
  allDueSoon,
  srsCount,
  pruneSrs,
  lossProfile,
  recentAccuracy,
  daysSinceQuiz,
  markQuizDone,
  daysSinceAssess,
  getGames,
  LADDER,
  getLadder,
  recordLadder,
  guessEndgame,
  getEgGuesses,
  getHistory,
  getDeclared,
  setDeclared,
  TT_LEVELS,
  markEndgameCleared,
  markBeatDraw,
  getBeatDraw,
  getCleared,
  playStats,
  calibratePuzzle,
  effectiveRating,
  getOwnPuzzles,
  ownStatus,
  type Dim,
} from './save';
import { Assessment, diagnose, type AssessResult } from './assess';
import { loadPuzzles, pickNear, byId, ratingRange, freshCount, combos, type Puzzle, type PuzzleKind } from './puzzles';
import { runPuzzle } from './train';
import { loadLibrary, matesByName, endgamesByName, type EndgamePos } from './library';
import { runPlayout } from './playout';
import { runReplay } from './replay';
import { runQuiz, tapThreatened, tapLoose, choiceQuestion, judgeQuestion, type QuizQ } from './quiz';
import type { Color, Move } from './rules';
import { OPENINGS, SYSTEM_ORDER, loadOpeningExtras, moveNote, type Opening } from './openings';
import { runExplorer } from './explorerui';
import { judgeAgainst } from './altjudge';
import { keyNote } from './movemeaning';
import { keyMove, keyTag, lineSummary, withKey } from './coachnote';
import { TRICKS, ledger, lineEvs, lineToTrap, loadTrickExtras, pitfalls, refuteLine, sacrificeAt, trapLine, trickVars, walkMoves, type TrickOpening, type TrickVar } from './tricks';
import { outlookOf } from './plan';
import { listGames } from './archive';
import { setHintLevel, getHintLevel } from './livecoach';
import { CHECK_GAMES, checkLesson, closeIntro, getLessonLog, habitCounts, markStep, planLesson, ratePerGame, startLesson, themeName, type Lesson, type Step } from './tutor';
import { roleOf } from './endgame';
import { ERR_INFO, inPieces, type ErrTag } from './teach';
import { Board2D } from './board2d';
import { fromFen, toFen } from './notation';
import { STAGES, stageFor, gameGate, graduateStatus, dailyPlan, focusDim, nextMilestone, WEEK_PLAN, PRO_PRINCIPLES, prescribeFocus, monthGoals, weekFor, type Block, type TrainInput } from './curriculum';
import { lastWeek, markTask, recentFocus, todayPlan, type DayStore } from './daytasks';
import { foldLong, liftBack } from './navbar';

type TrickVarKind = TrickVar['kind'];

/** 绝地反杀的一关（tools/gen-counterkill.ts 生成，merge-counterkill 并成 counterkill.json） */
interface CounterKill {
  id: string;
  fen: string;
  mateIn: number;
  /** 示范解法：红方每一步（几乎都是将军）+ 黑方最顽强的应法，最后一手将死 */
  line: string[];
  /** 红方每一步都将军 */
  allChecks: boolean;
  /** 中间不将军的步数（0～3） */
  quiet: number;
  /** 引擎浅算几层才看得出这是杀棋——越深越难 */
  seeDepth?: number;
  /** 轮到黑走的话，他一步就杀红的着法 */
  threat: string[];
  red: string;
  black: string;
  chapter: number;
  rating: number;
}
/** 题库只有进绝地反杀才用得到：按需加载，不拖慢首页 */
let COUNTERKILL: CounterKill[] = [];
let ckLoading: Promise<void> | null = null;
function loadCounterKill(): Promise<void> {
  ckLoading ??= import('./counterkill.json')
    .then((m) => {
      COUNTERKILL = (m.default ?? m) as unknown as CounterKill[];
    })
    .catch(() => {
      // 加载失败不能把学棋拖垮：页面显示为空，下次再试
      ckLoading = null;
    });
  return ckLoading;
}

const DIM_KIND: Record<Dim, PuzzleKind> = {
  safety: 'safety',
  mate: 'mate',
  tactic: 'tactic',
  endgame: 'endgame',
  opening: 'opening',
};

/**
 * 进入学棋模块时直接落在哪一屏。
 *
 * 首页的「今日训练」和「战术训练」是两个不同的入口，点进来却看到同一个
 * 菜单的话，用户会以为自己点错了。所以由调用方指定落点。
 */
export type CoachEntry = 'home' | 'today' | 'puzzles' | 'tutor' | 'progress' | 'own';

export function runCoach(
  root: HTMLElement,
  onExit: () => void,
  /** 开一局让子定级棋。学棋模块自己不管对弈，交回对弈流程去下 */
  startLadder?: (strip: number, lv: number, onFinish: (won: boolean) => void) => void,
  entry: CoachEntry = 'home',
  /**
   * 开一局实战。moves 非空：从那串着法之后的局面开一盘练习局（练破解，不计分）；
   * moves 为空：正常开一盘（按 level 选对手，计入实战分）
   */
  startFrom?: (moves: Move[], me: Color, level?: number) => void,
  /** 打开"棋风画像"（象棋模块的我的水平页，不在学棋里） */
  openLevel?: () => void,
): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-coach';
  root.appendChild(wrap);

  let disposeScreen: (() => void) | null = null;
  /** 当前这一屏上的小棋盘（残局卡片的缩略图）。换屏时必须停掉，否则渲染循环会一直跑 */
  let thumbs: Board2D[] = [];
  const clear = () => {
    disposeScreen?.();
    disposeScreen = null;
    for (const t of thumbs) t.dispose();
    thumbs = [];
    wrap.innerHTML = '';
  };

  // ---------------- 自报级别 ----------------
  /**
   * 先问一句「你在天天象棋大概什么水平」。
   *
   * 两个作用：一是给测评一个靠谱的起点（少走好几题弯路），
   * 二是给你一个能对上号的参照——本 App 的分是内部刻度，
   * 光报一个"1350 分"你根本不知道是高是低。
   */
  function askLevel(then: () => void) {
    clear();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `
      <h1>先对个坐标</h1>
      <div class="sub">你在天天象棋大概什么水平？没玩过也没关系。</div>
      <div class="xq-advice" style="margin-top:12px">
        <b>为什么问这个</b>
        <p>本 App 的分数是<b>内部刻度</b>——按"引擎要搜几层才找得到这一手"定出来的题目难度，
        和天天象棋的等级分不是一回事，两边不能换算。</p>
        <p class="dim">这里只用你报的级别决定第一题出多难，测几题之后就完全按你的实际表现走，报错了也会自动纠正。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const L of TT_LEVELS) {
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.innerHTML = `<div class="title">${L.name}</div><div class="desc">${L.desc}</div>`;
      el.onclick = () => {
        setDeclared(L.id);
        then();
      };
      list.appendChild(el);
    }
    scr.appendChild(list);
    // 这一屏原来没有返回键。它是进学棋看到的第一屏，没有出口就等于
    // 一进来就被关在里面——用户反馈的"练习模式退不出去"就是从这儿开始的。
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 先不测，返回';
    back.onclick = onExit;
    scr.appendChild(back);
    mount(scr);
  }

  /**
   * 题库到了之后清一遍错题本：把指向已经不存在的题目的卡删掉。
   *
   * 题库会变（修数据时删过错题，实战抓的题也会被 200 道上限挤掉），
   * 卡不清的话首页会显示"12 道待复习"而点进去只有 8 道。
   */
  let pruned = false;
  function pruneOnce() {
    if (pruned) return;
    pruned = true;
    void loadPuzzles().then(() => {
      // 真的清掉了才重画首页——没清掉就重画会白闪一下
      if (pruneSrs((id) => !!byId(id)) > 0 && wrap.querySelector('.xq-hub')) showHome();
    });
  }

  // ---------------- 私教首页（唯一的训练入口） ----------------
  /**
   * 私教首页。用户原话："希望有一个统一的私教入口，点进去之后能通过层级菜单一级一级往下选，
   * 清晰地告诉我应该怎么做、怎么训练。""现在界面上的信息太多、太繁杂了，看起来很费劲。"
   * 原来学棋首页十八张卡片、外加雷达图和实战统计，首页上还有今日训练、战术训练、私教三个重叠的入口。现在一屏三块：
   *   📅 今天的任务——做完就涨棋的那张清单（curriculum.dailyPlan 排、daytasks 存），做完一项打一个勾；
   *   自己选着练——四个大类，点进去再选；
   *   我的进度——水平、五维、实战表现、成长曲线、学习路线。
   * 每一行只有一句话，道理放到点进去以后。
   */
  function showHome() {
    clear();
    pruneOnce();
    pendingTick = null;
    menuBack = () => showHome();
    crumbs = ['私教'];
    const lv = honestLevel();
    const rank = rankOf(lv.r);
    const assessed = isAssessed();
    const { streak } = getStreak();
    const srs = srsCount();
    const day = planToday();
    const doneIds = taskDoneSet(day);
    const left = day.blocks.filter((b) => !doneIds.has(b.id));
    const week = lastWeek();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home xq-hub';
    scr.innerHTML = `
      <h1>🧑‍🏫 私教</h1>
      <div class="xq-hub-me">
        <b>${lv.source === 'play' || assessed ? rank.name : '还没定级'}</b>
        <span>${lv.source === 'play' ? `实战 ${lv.r} 分` : assessed ? `做题估计 ${lv.r} 分，待实战确认` : '先做一次测评'}</span>
        ${streak ? `<span>🔥 连续 ${streak} 天</span>` : ''}
      </div>
      <div class="xq-today" data-today>
        <div class="hd"><b>📅 今天的任务</b><span class="n">${day.blocks.length - left.length}/${day.blocks.length}</span></div>
        <div class="xq-week" title="最近七天">${week.map((w) => `<i class="${w.full ? 'full' : w.any ? 'any' : ''}"></i>`).join('')}<span>这周做完 ${week.filter((w) => w.full).length} 天</span></div>
        <div class="xq-tasks"></div>
      </div>`;
    const tasks = scr.querySelector('.xq-tasks') as HTMLElement;
    for (const b of day.blocks) {
      const done = doneIds.has(b.id);
      const row = document.createElement('button');
      row.className = `xq-task${done ? ' done' : ''}${!done && b === left[0] ? ' next' : ''}`;
      row.dataset.task = b.id;
      row.innerHTML = `<span class="ck">${done ? '✓' : ''}</span><span class="tx"><b>${b.title}</b><em>${b.desc}</em></span><span class="mi">${b.minutes} 分钟</span>`;
      row.onclick = () => runTask(b);
      tasks.appendChild(row);
    }
    const go = document.createElement('button');
    go.className = 'btn xq-today-go';
    go.dataset.act = 'today-go';
    if (left.length) {
      go.textContent = doneIds.size ? `继续：${left[0].title} →` : `开始今天的任务（约 ${left.reduce((a, b) => a + b.minutes, 0)} 分钟）→`;
      go.onclick = () => runTask(left[0]);
    } else {
      go.textContent = '✓ 今天的任务都做完了，明天见';
      go.disabled = true;
    }
    (scr.querySelector('[data-today]') as HTMLElement).appendChild(go);
    // 这一项为什么要做：只给下一项说一句，说多了没人看
    if (left[0]?.why) {
      const why = document.createElement('div');
      why.className = 'xq-today-why';
      why.textContent = left[0].why;
      (scr.querySelector('[data-today]') as HTMLElement).appendChild(why);
    }

    const sec = (t: string) => {
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.textContent = t;
      scr.appendChild(h);
    };
    sec('自己选着练');
    const list = document.createElement('div');
    list.className = 'card-list';
    scr.appendChild(list);
    const ops = dueOpenings().length;
    const lessonNow = planLesson(tutorInput());
    const own = ownStatus();
    const ownDueN = own.filter((x) => x.due).length;
    for (const it of [
      ...(own.length
        ? [
            {
              icon: '🎯',
              t: '我的专属课',
              d: '从你自己棋局的复盘里来：按毛病归成几门课，走错的局面反复练到会',
              badge: ownDueN ? `${ownDueN} 手该练` : `${own.filter((x) => x.mastered).length}/${own.length} 过关`,
              go: () => showOwnCourse(),
              act: 'm-own',
            },
          ]
        : []),
      {
        icon: '🧑‍🏫',
        t: `私教课 · ${lessonNow.theme === 'intro' ? '见面课' : themeName(lessonNow.theme)}`,
        d: '一节课只讲一件事：先看你的实战，再练、带练一盘，下节课先查作业',
        go: () => showTutor(),
        act: 'm-tutor',
      },
      { icon: '⚔️', t: '杀法与战术', d: '战术题、杀法题、眼力、中局组合、绝地反杀、限时计算', go: () => showMenu('tactics'), act: 'm-tactics' },
      { icon: '🏁', t: '残局', d: '残局题、实用残局下到底', go: () => showMenu('endgame'), act: 'm-endgame' },
      { icon: '📖', t: '布局', d: '布局体系、江湖布局破解、开局浏览器', go: () => showMenu('opening'), act: 'm-opening', badge: ops ? `🔁 ${ops} 套该复习` : '' },
      { icon: '♟', t: '实战与打谱', d: '下一盘、让子定级、打谱', go: () => showMenu('play'), act: 'm-play' },
      ...(srs.total ? [{ icon: '📌', t: '错题本', d: srs.due ? `今天 ${srs.due} 道到期` : `一共 ${srs.total} 道，今天没有到期的`, go: () => void startReview(), act: 'm-srs' }] : []),
    ])
      list.appendChild(menuRow(it));
    sec('我的进度');
    const list2 = document.createElement('div');
    list2.className = 'card-list';
    scr.appendChild(list2);
    list2.appendChild(menuRow({ icon: '📊', t: '水平和进步', d: '五维能力、实战表现、成长曲线、学习路线', go: () => showMenu('progress'), act: 'm-progress' }));
    mount(scr, onExit);
  }

  /** 菜单里的一行：图标 + 标题 + 一句话 + 角标 */
  function menuRow(it: { icon: string; t: string; d: string; go: () => void; act?: string; badge?: string }): HTMLElement {
    const el = document.createElement('div');
    el.className = 'card home-card xq-menu-row';
    if (it.act) el.dataset.act = it.act;
    el.innerHTML = `<div class="title">${it.icon} ${it.t}${it.badge ? `<span class="tag warn">${it.badge}</span>` : ''}</div><div class="desc">${it.d}</div>`;
    el.onclick = it.go;
    return el;
  }

  type MenuId = 'tactics' | 'endgame' | 'opening' | 'play' | 'progress';
  /**
   * 二级菜单：一个大类一页。从这里点进去的每一屏，左上角"← 返回"都回到这一页。
   */
  function showMenu(id: MenuId) {
    clear();
    menuBack = () => showMenu(id);
    const rs = getRatings();
    const r = (d: Dim) => `${rs[d].r}`;
    const play = getPlay();
    const lvl = play && play.n >= 3 ? opponentFor(play.r) : undefined;
    type Item = { icon: string; t: string; d: string; go: () => void; act?: string; badge?: string };
    const M: Record<MenuId, { title: string; sub: string; items: Item[] }> = {
      tactics: {
        title: '杀法与战术',
        sub: '题目难度跟着你的分数走，先出没做过的。',
        items: [
          { icon: '🎯', t: '战术题', d: '捉双、牵制、闪击这些赢子手段', badge: r('tactic'), go: () => void startPractice('tactic'), act: 'p-tactic' },
          { icon: '⚔️', t: '杀法题', d: '实战局面里找杀：对方子力还在，算到将死为止', badge: r('mate'), go: () => void startPractice('mate'), act: 'p-mate' },
          { icon: '👁', t: '眼力：不漏子', d: '看不看得见对方的威胁，会不会白送子', badge: r('safety'), go: () => void startPractice('safety'), act: 'p-safety' },
          { icon: '🧠', t: '中局组合', d: '连走几步才拿到便宜，按步数分档', go: () => void showCombos(), act: 'combos' },
          { icon: '🔥', t: '绝地反杀', d: '对方下一步就杀你，只有连将反杀——闯关', go: () => void showCounterKill(), act: 'counterkill' },
          { icon: '⏱', t: '限时计算', d: '每题 45 秒，错的再不限时做一遍', go: () => void startTimed(), act: 'timed' },
          { icon: '📅', t: `每日一题${dailyDone() ? '（今天做过了 ✓）' : ''}`, d: '单双日轮着出绝地反杀和中局组合', go: () => void startDaily(), act: 'daily' },
        ],
      },
      endgame: {
        title: '残局',
        sub: '只出要真本事的：对方还有子的残局、走错一步就和的技术残局、少子守和。',
        items: [
          { icon: '🧩', t: '残局题', d: '这一手该怎么走', badge: r('endgame'), go: () => void startPractice('endgame'), act: 'p-endgame' },
          { icon: '🏁', t: '实用残局：下到底', d: '跟引擎下完：要赢的赢下来，要守的守和', go: () => void showEndgameList(), act: 'endgames' },
        ],
      },
      opening: {
        title: '布局',
        sub: '先看讲解，再执一方自己走一遍。',
        items: [
          { icon: '📖', t: '布局体系', d: '屏风马、过宫炮、士角炮、飞相局……主线、变招、错着', badge: dueOpenings().length ? `🔁 ${dueOpenings().length} 套该复习` : '', go: () => showOpenings(), act: 'openings' },
          { icon: '🗡', t: '江湖布局破解', d: '弃马十三着、铁滑车、敢死炮……坑在哪、怎么破', go: () => showTricks(), act: 'tricks' },
          { icon: '📚', t: '开局浏览器', d: '任何一个局面谱上有哪些走法，出谱后皮卡鱼接着算', go: () => showExplorer(undefined, () => showMenu('opening')), act: 'explorer' },
          { icon: '🎯', t: '布局题', d: '开局这一手该怎么走', badge: r('opening'), go: () => void startPractice('opening'), act: 'p-opening' },
        ],
      },
      play: {
        title: '实战与打谱',
        sub: '做题练的是识别，实战练的是运用，两样都得有。',
        items: [
          ...(startFrom ? [{ icon: '⚔️', t: '下一盘', d: lvl !== undefined ? `对手「${AI_LEVEL_NAMES[lvl]}」，和你的实战分相当` : '和 AI 下一盘完整的棋', go: () => startFrom([], 'r', lvl), act: 'play-game' }] : []),
          { icon: '📏', t: `让子定级 · ${LADDER[getLadder().rung].name}`, d: '让子棋量的是实战棋力，没有天花板', go: () => showLadder(), act: 'ladder' },
          { icon: '📜', t: '打谱', d: '一手一手过棋谱，先自己想一手再看原谱', go: () => void showGames(), act: 'games' },
        ],
      },
      progress: {
        title: '水平和进步',
        sub: '',
        items: [
          ...(getHistory().length ? [{ icon: '📈', t: '成长曲线', d: '五维分数这几周怎么变的', go: () => showGrowth(), act: 'growth' }] : []),
          { icon: '🗺️', t: '学习路线', d: '四个阶段，每个阶段练什么、出师标准', go: () => showRoadmap(), act: 'roadmap' },
          { icon: '📋', t: '训练方案', d: '这个月的目标和每周安排', go: () => showProgram(), act: 'program' },
          ...(openLevel ? [{ icon: '🔍', t: '棋风画像', d: '你最常犯的毛病、对局统计', go: () => openLevel(), act: 'level' }] : []),
          { icon: '🔁', t: isAssessed() ? '重新测评' : '水平测评', d: '35 道题，约 20 分钟', go: () => void startAssessment(), act: 'assess' },
        ],
      },
    };
    const m = M[id];
    crumbs = ['私教', m.title];
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.dataset.menu = id;
    scr.innerHTML = `<h1>${m.title}</h1>${m.sub ? `<div class="sub">${m.sub}</div>` : ''}`;
    if (id === 'progress') {
      if (isAssessed()) scr.appendChild(radarCard(rs));
      const pc = playCard();
      if (pc) scr.appendChild(pc);
      const loss = lossProfile(10);
      scr.insertAdjacentHTML('beforeend', lossCard(loss));
    }
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const it of m.items) list.appendChild(menuRow(it));
    scr.appendChild(list);
    mount(scr, () => showHome());
  }

  /** 实战表现：做题分有天花板，这个没有 */
  function playCard(): HTMLElement | null {
    const ps = playStats();
    if (!ps) return null;
    const card = document.createElement('div');
    card.className = 'xq-play-card';
    card.innerHTML = `
      <div class="hd">📊 实战表现 <span>最近 ${ps.games} 盘</span></div>
      <div class="row">
        <div><b>${ps.blundersPerGame}</b><span>漏着/盘</span></div>
        <div><b>${ps.mistakesPerGame}</b><span>失误/盘</span></div>
        <div><b>${ps.avgLoss}</b><span>平均亏损</span></div>
        <div><b>${ps.winRate}%</b><span>胜率</span></div>
      </div>
      <div class="ft">${
        ps.trend === null
          ? '再下几盘就能看出趋势。'
          : ps.trend > 0
            ? `比之前 ${ps.games} 盘平均亏损<b>降了 ${ps.trend} 分</b>——在涨棋。`
            : `比之前 ${ps.games} 盘平均亏损高了 ${-ps.trend} 分，最近可能下得急了。`
      }</div>`;
    return card;
  }

  // ---------------- 顶栏：每一屏左上角都有返回 ----------------
  /** 从菜单点进去的那一屏，返回回到哪：私教首页或者那个菜单 */
  let menuBack: () => void = () => showHome();
  /** 现在在哪（顶栏上显示"私教 › 布局"） */
  let crumbs: string[] = ['私教'];
  /**
   * 从"今天的任务"进去的残局、布局、闯关：真下完了才打勾（中途退出不算）。
   * 下完的那一刻调 finishTask()；回到私教首页就清掉。
   */
  let pendingTick: (() => void) | null = null;
  function finishTask() {
    pendingTick?.();
    pendingTick = null;
  }
  /**
   * 挂上一屏：顶上加一条"← 返回 + 现在在哪"，屏幕底下原来那个"← 返回"按钮挪上来（不重复放）。
   * 用户原话："有些界面甚至没有返回键"——返回统一放左上角、固定不动，滚到哪都点得到。
   * back 不给：用这一屏自己底下那个返回按钮的去处；那个也没有，就回到点进来的菜单。
   */
  function mount(scr: HTMLElement, back?: () => void) {
    liftBack(scr, crumbs.join(' › '), back, () => menuBack());
    foldLong(scr);
    wrap.appendChild(scr);
  }

  // ---------------- 今天的任务 ----------------
  /** 排今天的任务要的全部输入 */
  function planInput(): TrainInput {
    const rs = getRatings();
    return {
      stage: stageFor(rs, gameEvidence()),
      ratings: rs,
      loss: lossProfile(10),
      accuracy: (d) => recentAccuracy(d),
      // 错题复习只数题库里的；自己棋局来的那些单独一项（复盘错着重练）
      dueCount: dueCards(999).filter((c) => !c.id.startsWith('own-')).length,
      ownDue: ownDueList().length,
      ownTop: topTagName(ownDueList()),
      daysSinceQuiz: daysSinceQuiz(),
      play: getPlay(),
      fresh: (d) => freshCount(DIM_KIND[d]).fresh,
      assessed: isAssessed(),
      lesson: lessonNext(),
      openingDue: dueOpenings().length,
      recentFocus: recentFocus(),
    };
  }
  /** 今天的清单：一天之内不变 */
  function planToday(): DayStore {
    return todayPlan(() => dailyPlan(planInput()));
  }
  /** 私教课下一步要做的（没测过、或者课上完了等检查，返回 null） */
  function lessonNext(): TrainInput['lesson'] {
    if (!isAssessed() && !listGames().length) return null;
    const inp = tutorInput();
    const lesson = planLesson(inp);
    const cur = inp.log[inp.log.length - 1];
    const inProgress = !!cur && cur.theme === lesson.theme && cur.done.length < cur.steps;
    const done = new Set(inProgress ? cur.done : []);
    const i = lesson.steps.findIndex((_, k) => !done.has(k));
    if (i < 0) return null;
    const st = lesson.steps[i];
    if (st.kind === 'assess') return null;
    return { title: lesson.title, step: i, label: st.label, kind: st.kind, dim: st.kind === 'drill' ? st.dim : undefined };
  }
  /**
   * 哪几项做完了：打过勾的，再加上看得出来做过的——
   * 今天定清单之后下过一盘棋、测评过了、到期的错题清空了、私教课那一步记上了。
   * （从别的入口做的也算：在"错题本"里把错题做完了，清单上那一项照样打勾。）
   */
  function taskDoneSet(day: DayStore): Set<string> {
    const s = new Set(day.done);
    const log = getLessonLog();
    const cur = log[log.length - 1];
    for (const b of day.blocks) {
      if (b.kind === 'game' && listGames().some((g) => g.ts >= day.at)) s.add(b.id);
      if (b.kind === 'assess' && isAssessed()) s.add(b.id);
      if (b.kind === 'srs' && !dueCards(999).some((c) => !c.id.startsWith('own-'))) s.add(b.id);
      if (b.kind === 'own' && !ownDueList().length) s.add(b.id);
      if (b.kind === 'lesson' && b.step !== undefined && cur && cur.ts <= Date.now() && cur.done.includes(b.step)) s.add(b.id);
    }
    return s;
  }
  // ---------------- 我的专属课：复盘出来的错着 ----------------
  /** 今天该重走的：到期的，或者存进来还没练过的；错得多的、亏得多的排前面 */
  function ownDueList(): Puzzle[] {
    return ownStatus()
      .filter((x) => x.due)
      .sort((a, b) => b.wrong - a.wrong || (b.p.from?.loss ?? 0) - (a.p.from?.loss ?? 0))
      .map((x) => x.p);
  }
  function topTagName(list: Puzzle[]): string | undefined {
    const n = new Map<ErrTag, number>();
    for (const p of list) if (p.tag) n.set(p.tag, (n.get(p.tag) ?? 0) + 1);
    const top = [...n.entries()].sort((a, b) => b[1] - a[1])[0];
    return top ? ERR_INFO[top[0]].name : undefined;
  }
  /** 毛病对应练哪一维的同类题（走软的按那一手所在的阶段，见题目自己的 kind） */
  const TAG_DIM: Record<ErrTag, Dim | null> = {
    hang: 'safety',
    'missed-threat': 'safety',
    'walk-into-mate': 'safety',
    greedy: 'tactic',
    'missed-mate': 'mate',
    slow: null,
  };

  /**
   * 我的专属课。用户原话："私教要将复盘数据带入到日常训练中。针对我复盘表现不好、暴露出的弱项，
   * 自动生成到专属课程里让我反复训练，这样才有针对性。"
   *
   * 每盘棋复盘完，你走错的那几手（失误、漏着、亏一个半兵以上的不佳）自动存进来，记着是哪种毛病、哪天那盘第几回合、
   * 你当时走的是哪一手。这里按毛病归成几门课：先重走你自己走错的局面，再做同类题；
   * 每一手按 1/3/7/21/60 天的间隔回来，连对五次才算过关。每天任务清单里的"复盘错着重练"就是从这里出的。
   */
  function showOwnCourse() {
    clear();
    menuBack = () => showOwnCourse();
    crumbs = ['私教', '我的专属课'];
    const os = ownStatus();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home xq-own';
    scr.dataset.own = '';
    if (!os.length) {
      scr.innerHTML = `<h1>🎯 我的专属课</h1>
        <div class="sub">还没有内容：下完一盘、复盘之后，你走错的局面会自动存进这里，按毛病归类，隔几天回来找你。</div>`;
      if (startFrom) {
        const go = document.createElement('button');
        go.className = 'btn';
        go.textContent = '⚔️ 先下一盘';
        const play = getPlay();
        go.onclick = () => startFrom([], 'r', play && play.n >= 3 ? opponentFor(play.r) : undefined);
        scr.appendChild(go);
      }
      mount(scr, () => showHome());
      return;
    }
    // 这一版之前存的错着没记是哪种毛病：单独一组，不硬塞进"走软"
    type G = ErrTag | 'old';
    const INFO = (t: G) => (t === 'old' ? { name: '早先存的错着', desc: '更新前复盘存下来的，当时没记是哪种毛病', advice: '重走一遍正确的那一手，想清楚当时少看了什么。' } : ERR_INFO[t]);
    const groups = new Map<G, typeof os>();
    for (const x of os) {
      const t: G = x.p.tag ?? 'old';
      groups.set(t, [...(groups.get(t) ?? []), x]);
    }
    // 按"还没过关的那几手一共亏了多少分"排：送掉一个炮比两手走软贵得多
    const cost = (xs: typeof os) => xs.filter((x) => !x.mastered).reduce((a, x) => a + (x.p.from?.loss ?? 100), 0);
    const order = [...groups.entries()].sort((a, b) => cost(b[1]) - cost(a[1]) || b[1].length - a[1].length);
    const [topTag, topList] = order[0];
    const dueAll = os.filter((x) => x.due).length;
    const days = new Set(os.map((x) => x.p.from?.d ?? '')).size;
    scr.innerHTML = `<h1>🎯 我的专属课</h1>
      <div class="sub">从你 ${days} 天的对局复盘里来：一共 ${os.length} 手，已过关 ${os.filter((x) => x.mastered).length} 手。每一手隔 1/3/7/21/60 天回来一次，连对五次算过关。</div>
      <div class="xq-advice" data-keep><b>${
        topTag === 'old' ? `先把早先存的错着练掉（${topList.length} 手）` : `你现在最贵的毛病：${INFO(topTag).name}（${topList.length} 手，一共亏了约${inPieces(cost(topList))}）`
      }</b>
        <p>${INFO(topTag).desc}。</p><p>👉 ${INFO(topTag).advice}</p></div>`;
    if (dueAll) {
      const go = document.createElement('button');
      go.className = 'btn';
      go.dataset.act = 'own-due';
      go.textContent = `▶ 今天该练的 ${Math.min(8, dueAll)} 手`;
      go.onclick = () => void loadPuzzles().then(() => runOwnSession(ownDueList().slice(0, 8), '复盘错着重练'));
      scr.appendChild(go);
    }
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const [tag, items] of order) {
      const left = items.filter((x) => !x.mastered);
      const due = items.filter((x) => x.due).length;
      const el = document.createElement('div');
      el.className = 'card home-card xq-own-row';
      el.dataset.ownTag = tag;
      const recent = items
        .slice(-3)
        .reverse()
        .map((x) => (x.p.blunder ? `${x.p.from ? `${x.p.from.d.slice(5)} 第${x.p.from.round}回合` : '实战里'}走了 ${x.p.blunder}` : '实战里走错过'))
        .join('；');
      el.innerHTML = `<div class="title">${INFO(tag).name} · ${items.length} 手<span class="tag ${due ? 'warn' : ''}">${
        due ? `${due} 手该练` : `${items.length - left.length}/${items.length} 过关`
      }</span></div>
        <div class="desc">${INFO(tag).desc}</div>
        <div class="desc dim">最近：${recent}</div>`;
      el.onclick = () => {
        // 没过关的先来（该练的排最前）；都过关了就整门再过一遍
        const pick = (left.length ? left : items)
          .slice()
          .sort((a, b) => Number(b.due) - Number(a.due) || b.wrong - a.wrong)
          .map((x) => x.p)
          .slice(0, 8);
        const dim = (tag !== 'old' && TAG_DIM[tag]) || (pick[0]?.kind as Dim);
        void loadPuzzles().then(() => runOwnSession(pick, `专属课 · ${INFO(tag).name}`, undefined, () => void startPractice(dim, 6)));
      };
      list.appendChild(el);
    }
    scr.appendChild(list);
    mount(scr, () => showHome());
  }

  /**
   * 重走一组你自己走错的局面。题目上写着是哪天那盘第几回合、什么毛病；做错了明天再来，做对了隔得更久。
   * then：从"今天的任务"进来的，做完打勾回清单。more：做完自己的局面，接着做同类题（"练这一门"用）。
   */
  function runOwnSession(list: Puzzle[], title: string, then?: () => void, more?: () => void) {
    let k = 0;
    let right = 0;
    const next = () => {
      if (k >= list.length) {
        finishSession(title, right, list.length, () => runOwnSession(list, title, then, more), '', then);
        const rep = wrap.querySelector('.xq-coach-report');
        if (more && !then && rep) {
          const b = document.createElement('button');
          b.className = 'btn';
          b.dataset.act = 'own-more';
          b.textContent = '▶ 接着做 6 道同类题';
          b.onclick = more;
          rep.insertBefore(b, rep.querySelector(':scope > .btn'));
        }
        return;
      }
      const p = list[k++];
      const f = p.from;
      const tagName = p.tag ? ERR_INFO[p.tag].name : '';
      const cap = `${title} ${k}/${list.length}${f ? ` · ${f.d.slice(5)} 那盘第 ${f.round} 回合` : ''}${tagName && !title.includes(tagName) ? ` · ${tagName}` : ''}`;
      runOne(p, null, cap, (ok) => {
        if (ok) right++;
        next();
      });
    };
    next();
  }

  /** 做一项任务：做完打勾、回私教首页 */
  function runTask(b: Block) {
    menuBack = () => showHome();
    crumbs = ['私教'];
    const done = () => {
      markTask(b.id);
      checkIn();
      showHome();
    };
    // 下到底的那几种：退出时不打勾，真下完了（finishTask）才打
    const back = () => {
      checkIn();
      showHome();
    };
    const tickOnFinish = () => (pendingTick = () => markTask(b.id));
    switch (b.kind) {
      case 'assess':
        void startAssessment();
        return;
      case 'own': {
        const list = ownDueList().slice(0, b.count ?? 6);
        if (!list.length) return done();
        void loadPuzzles().then(() => runOwnSession(list, '复盘错着重练', done));
        return;
      }
      case 'srs':
        void startReview(done);
        return;
      case 'lesson':
        showTutor();
        return;
      case 'focus':
        void startPractice(b.dim ?? weakestDim(getRatings()), b.count ?? 8, done, b.ratingBias ?? 0);
        return;
      case 'quiz':
        void startQuiz(done);
        return;
      case 'timed':
        void startTimed(done);
        return;
      case 'combo':
        void loadPuzzles().then(() => {
          if (!wrap.isConnected) return;
          const all = combos();
          if (!all.length) return done();
          runComboSession(all, '今日组合', 5, undefined, done);
        });
        return;
      case 'ladder':
        void loadCounterKill().then(() => {
          if (!wrap.isConnected) return;
          const it = nextCounterKill();
          if (!it) return done();
          tickOnFinish();
          runCounterKill(it, back);
        });
        return;
      case 'endgame':
        void loadLibrary().then(() => {
          if (!wrap.isConnected) return;
          const cleared = new Set(getCleared().endgames);
          const g = pickByLevel(endgamesByName(), cleared, getRatings().endgame.r);
          if (!g) return done();
          const i = Math.max(0, g.items.findIndex((x) => !cleared.has(x.id)));
          tickOnFinish();
          runEndgame(g, i, back);
        });
        return;
      case 'opening': {
        const due = dueOpenings();
        tickOnFinish();
        if (due.length) return runOpeningReview(due, back);
        // 还没走过的那一套（先手后手按这套是谁的布局）
        const o = OPENINGS.find((x) => openingBest(x.id) === null) ?? OPENINGS[0];
        runOpening(o, o.side === 'red' ? 'r' : 'b', undefined, back);
        return;
      }
      case 'game': {
        // 带着"下完看复盘"直接开一盘：对手按实战分挑，下完的棋会自动算进今天的任务
        const play = getPlay();
        const lv = play && play.n >= 3 ? opponentFor(play.r) : undefined;
        if (startFrom) startFrom([], 'r', lv);
        else onExit();
        return;
      }
    }
  }

  /** 五维雷达图 */
  function radarCard(rs: ReturnType<typeof getRatings>): HTMLElement {
    const card = document.createElement('div');
    card.className = 'xq-radar-card';
    const cv = document.createElement('canvas');
    cv.className = 'xq-radar';
    card.appendChild(cv);

    const legend = document.createElement('div');
    legend.className = 'xq-radar-legend';
    const weak = weakestDim(rs);
    legend.innerHTML = DIMS.map(
      (d) =>
        `<span class="xq-radar-item${d === weak ? ' weak' : ''}">${DIM_INFO[d].emoji} ${DIM_INFO[d].name} <b>${rs[d].r}</b></span>`,
    ).join('');
    card.appendChild(legend);

    // 布局完成后再画，否则量不到尺寸
    requestAnimationFrame(() => drawRadar(cv, rs));
    return card;
  }

  function drawRadar(cv: HTMLCanvasElement, rs: ReturnType<typeof getRatings>) {
    const r = cv.getBoundingClientRect();
    if (r.width < 10) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(r.width * dpr);
    cv.height = Math.round(r.height * dpr);
    const g = cv.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const cx = r.width / 2;
    const cy = r.height / 2 + 4;
    const R = Math.min(r.width, r.height) / 2 - 26;
    const LO = 700;
    const HI = 2000;
    const at = (i: number, v: number): [number, number] => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / DIMS.length;
      const t = Math.max(0.08, Math.min(1, (v - LO) / (HI - LO)));
      return [cx + Math.cos(a) * R * t, cy + Math.sin(a) * R * t];
    };

    g.clearRect(0, 0, r.width, r.height);
    // 参考环：正好落在段位分界上，一眼看出离下一档还差多少
    for (const [v, label] of [
      [1100, '初级'],
      [1500, '高级'],
      [1900, '专业'],
    ] as [number, string][]) {
      g.beginPath();
      DIMS.forEach((_, i) => {
        const [x, y] = at(i, v);
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.closePath();
      g.strokeStyle = 'rgba(255,255,255,0.13)';
      g.lineWidth = 1;
      g.stroke();
      const [lx, ly] = at(0, v);
      g.fillStyle = 'rgba(255,255,255,0.3)';
      g.font = '9px system-ui';
      g.textAlign = 'center';
      g.fillText(label, lx, ly - 3);
    }
    // 轴
    DIMS.forEach((_, i) => {
      const [x, y] = at(i, HI);
      g.beginPath();
      g.moveTo(cx, cy);
      g.lineTo(x, y);
      g.strokeStyle = 'rgba(255,255,255,0.1)';
      g.stroke();
    });
    // 数据面
    g.beginPath();
    DIMS.forEach((d, i) => {
      const [x, y] = at(i, rs[d].r);
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    });
    g.closePath();
    g.fillStyle = 'rgba(255,178,64,0.26)';
    g.fill();
    g.strokeStyle = '#ffb240';
    g.lineWidth = 2;
    g.stroke();
    DIMS.forEach((d, i) => {
      const [x, y] = at(i, rs[d].r);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fillStyle = '#ffd76e';
      g.fill();
    });
    // 维度名
    g.font = '11px system-ui';
    g.fillStyle = 'rgba(255,255,255,0.72)';
    DIMS.forEach((d, i) => {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / DIMS.length;
      const x = cx + Math.cos(a) * (R + 15);
      const y = cy + Math.sin(a) * (R + 15);
      g.textAlign = Math.abs(Math.cos(a)) < 0.3 ? 'center' : Math.cos(a) > 0 ? 'left' : 'right';
      g.textBaseline = Math.abs(Math.cos(a)) < 0.3 ? (Math.sin(a) > 0 ? 'top' : 'bottom') : 'middle';
      g.fillText(DIM_INFO[d].name, x, y);
    });
  }

  // ---------------- 测评 ----------------
  async function startAssessment() {
    clear();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-load';
    scr.innerHTML = '<div class="xq-loading">正在准备题目…</div>';
    mount(scr);

    const a = new Assessment();
    await a.init();
    if (!wrap.isConnected) return;
    if (a.total === 0) {
      scr.innerHTML = `<div class="xq-loading">题库还没生成，测评暂时用不了。</div>`;
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.textContent = '← 返回';
      b.onclick = () => menuBack();
      scr.appendChild(b);
      return;
    }

    const missing = DIMS.filter((d) => !a.testable.includes(d));
    nextQuestion(a, missing);
  }

  function nextQuestion(a: Assessment, missing: Dim[]) {
    const q = a.next();
    if (!q) {
      finishAssessment(a, missing);
      return;
    }
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    // 顶部进度条：知道还剩几题，心里有底
    const bar = document.createElement('div');
    bar.className = 'xq-prog';
    bar.innerHTML = `<i style="width:${((q.index - 1) / q.total) * 100}%"></i>`;
    host.appendChild(bar);

    disposeScreen = runPuzzle(host, q.puzzle, {
      caption: `测评 ${q.index}/${q.total} · ${DIM_INFO[q.dim].emoji} ${DIM_INFO[q.dim].name}`,
      allowHint: false,
      // 测评要控制时长：主变照样一步步走完，残局不再接着下到底
      playToEnd: false,
      // 中途退出：这一轮作废，下次重新测（只测一半的分数不准，不如不记）
      onExit: () => menuBack(),
      onDone: (r) => {
        a.answer(r.correct);
        calibratePuzzle(q.puzzle.id, q.puzzle.rating, getRatings()[q.dim].r, r.correct);
        if (!r.correct) markWrong(q.puzzle.id);
        else markRight(q.puzzle.id);
        nextQuestion(a, missing);
      },
    });
  }

  function finishAssessment(a: Assessment, missing: Dim[]) {
    const res = a.result();
    const log = a.getLog();
    // 没测到的维度不能编分数，保持原样
    const dims = { ...res.dims };
    const prev = getRatings();
    for (const d of missing) dims[d] = prev[d].r;
    recordAssessment(dims);
    checkIn();
    showReport(res, log, missing);
  }

  // ---------------- 诊断报告 ----------------
  function showReport(res: AssessResult, log: ReturnType<Assessment['getLog']>, missing: Dim[]) {
    clear();
    const rs = getRatings();
    const overall = overallOf(rs);
    const lv = honestLevel();
    const rank = rankOf(Math.min(overall, lv.r));
    const weak = weakestDim(rs);

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    const satCount = DIMS.filter((d) => res.saturated[d] && !missing.includes(d)).length;
    scr.innerHTML = `
      <h1>测评结果</h1>
      <div class="xq-rank-big">做题分 ${satCount >= 3 ? '≥ ' : ''}${overall}<span>${satCount >= 3 ? '题库到顶了' : `±${res.ci}`}</span></div>
      <div class="sub">五维里哪一维弱，下面看得清清楚楚——这是测评最有用的地方。</div>
      <div class="sub xq-scale-note"><b>但做题分不等于棋力。</b>题是静止的、你知道这里有棋；实战里没人提醒你。
      所以"你是什么水平"要看实战：${
        lv.source === 'play'
          ? `按你 ${lv.games} 盘对弈的输赢，现在是 <b>${rankOf(lv.r).name}（实战分 ${lv.r}）</b>，粗略相当于天天象棋「${ttNear(lv.r).name}」。`
          : `先下几盘（关掉教练更准），教练按输赢定你的水平。在那之前，按做题暂估 <b>${rank.name}</b>。`
      }</div>`;
    scr.appendChild(radarCard(rs));

    const detail = document.createElement('div');
    detail.className = 'xq-report-list';
    detail.innerHTML = DIMS.map((d) => {
      const gone = missing.includes(d);
      return `<div class="xq-report-row${d === weak && !gone ? ' weak' : ''}">
        <div class="hd">${DIM_INFO[d].emoji} ${DIM_INFO[d].name}
          <b>${gone ? '—' : (res.saturated[d] ? '≥' : '') + rs[d].r}</b>${
            d === weak && !gone ? '<span class="tag">最弱</span>' : ''
          }</div>
        <div class="ds">${gone ? '题库里暂时没有这类题，这次没测。' : diagnose(log, d)}</div>
      </div>`;
    }).join('');
    scr.appendChild(detail);

    const stage = stageFor(rs, gameEvidence());
    const rec = focusDim(stage, rs);
    const advice = document.createElement('div');
    advice.className = 'xq-advice';
    advice.innerHTML = `
      <b>接下来练什么</b>
      <p>你现在在 <b>${stage.emoji} 阶段${stage.id}「${stage.name}」</b>，先练
      <b>${DIM_INFO[rec].name}</b>（${DIM_INFO[rec].desc}）。</p>
      ${
        rec !== weak
          ? `<p>你分最低的其实是「${DIM_INFO[weak].name}」，但<b>先不动它</b>——
             业余棋手输棋六成是漏着、两成半是残局走不出结果，布局只占一成。
             顺序必须是 <b>不漏着 → 算得清 → 残局 → 布局</b>。
             前面几样没练好的时候，布局占的那点便宜根本守不住，
             这也正是"背了一堆定式还是不涨棋"的原因。</p>`
          : `<p>业余棋手输棋六成是漏着、两成半是残局走不出结果，所以顺序上
             <b>不漏着 → 算得清 → 残局 → 布局</b>，不要一上来背定式。</p>`
      }
      <p class="dim">题做得越多分数越准。现在的 ±${res.ci} 分是按你答的 ${log.length} 题算出来的。</p>
      <p class="dim">⚠️ 说清楚这套分数的边界。各维能测到的上限取决于题库里最难的题
      ——<b>这几个数是从当前题库直接算的，不是写死的</b>：${DIMS.map(
        (d) => `${DIM_INFO[d].name} ${ratingRange(DIM_KIND[d])[1] || '—'}`,
      ).join('、')}。
      顶到上限的那几维会显示 ≥ 号，意思是<b>真实水平只会更高</b>，这个数只是下限。</p>
      <p class="dim">如果你本来就比这个区间强（比如天天象棋业 6 以上），
      别太当真这个分，看首页的 <b>实战表现</b>（每盘漏着数、平均亏损）更准——
      那是从你真实对局里量的，没有天花板。</p>`;
    scr.appendChild(advice);

    // 测完最该看的不是"去练哪一维"，而是**完整的方案**——
    // 一个教练测完之后交给你的是一份处方，不是一句"你去练眼力吧"
    const plan = document.createElement('button');
    plan.className = 'btn';
    plan.textContent = '📋 看我的训练方案 →';
    plan.onclick = showProgram;
    scr.appendChild(plan);

    const go = document.createElement('button');
    go.className = 'btn ghost';
    go.textContent = `直接开始练「${DIM_INFO[rec].name}」`;
    go.onclick = () => startPractice(rec);
    scr.appendChild(go);

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '返回学棋首页';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  /** 一组 10 题的专项练习 */
  async function startPractice(dim: Dim, count = 10, then?: () => void, bias = 40) {
    clear();
    await loadPuzzles();
    if (dim === 'mate') await loadLibrary();
    if (!wrap.isConnected) return;
    const used = new Set<string>();
    let i = 0;
    let right = 0;
    const TOTAL = count;
    const startR = getRatings()[dim].r;
    let last = '';

    const step = () => {
      if (i >= TOTAL) {
        finishSession(`${DIM_INFO[dim].emoji} ${DIM_INFO[dim].name}练习`, right, TOTAL, () => startPractice(dim), scoreLine(dim, startR), then);
        return;
      }
      const r = getRatings()[dim].r;
      // 默认略微往上挑：练在能力边缘涨得最快，正确率维持在七八成。
      // 热身块传负的 bias，用略简单的题找手感。
      const p = pickNear(DIM_KIND[dim], r + bias, used);
      if (!p) {
        if (then && !i) then();
        else finishSession(`${DIM_INFO[dim].name}练习`, right, i, () => menuBack(), scoreLine(dim, startR), then);
        return;
      }
      used.add(p.id);
      i++;
      const before = getRatings()[dim].r;
      const cap = `${DIM_INFO[dim].name} ${i}/${TOTAL}${last ? ` · 上一题 ${last}` : ''}`;
      const after = (ok: boolean) => {
        if (ok) right++;
        const d = getRatings()[dim].r - before;
        last = d ? `${d > 0 ? '+' : ''}${d}` : '';
        step();
      };
      // 换着花样问：同一个局面，眼力题可能让你点出被捉的子，战术题可能出成选择题
      const q = variedQuestion(p, dim);
      if (q) runQuizOne(q, cap, after);
      else runOne(p, dim, cap, after);
    };
    step();
  }

  /** 这一组下来某一维的分动了多少："杀法分 1320 → 1356（+36）" */
  function scoreLine(dim: Dim, startR: number): string {
    const now = getRatings()[dim].r;
    const d = now - startR;
    return `${DIM_INFO[dim].name}分 ${startR} → ${now}（${d > 0 ? '+' : ''}${d}）`;
  }

  /**
   * 换着花样出题。
   * 用户原话："目前像眼力、战术之类的测验题目都千篇一律。这些东西都需要去向《天天象棋》看齐。"
   * 一组里大约一半还是"走一步"的老问法（那是根本），另一半换成点子题、选择题、判断题。
   */
  function variedQuestion(p: Puzzle, dim: Dim): QuizQ | null {
    const r = Math.random();
    if (dim === 'safety') {
      if (r < 0.3) return tapThreatened(p) ?? tapLoose(p);
      if (r < 0.48) return tapLoose(p);
      if (r < 0.62) return judgeQuestion(p, dim);
      return null;
    }
    if (dim === 'tactic') {
      if (r < 0.3) return choiceQuestion(p, dim);
      if (r < 0.5) return judgeQuestion(p, dim);
      return null;
    }
    // 杀法不再出"认杀法"（看杀局选名字）：用户原话"题目分类没必要细究到底叫闷宫还是马后炮"——
    // 实战里要的是找得到杀，不是叫得出名字
    if (dim === 'mate') {
      if (r < 0.3) return choiceQuestion(p, dim);
      return null;
    }
    return null;
  }

  /** 答一道花样题：答完当场显示这一题让分数动了多少（赢加输减） */
  function runQuizOne(q: QuizQ, caption: string, done: (ok: boolean) => void, scored = true) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const line = q.type === 'name' ? matesByName().flatMap((g) => g.items).find((m) => `name:${m.id}` === q.id)?.line : undefined;
    disposeScreen = runQuiz(host, q, {
      caption,
      line,
      onExit: () => menuBack(),
      onAnswer: (ok) => {
        if (!scored) return '';
        // 只有第一次做计分：做过的题再做对，多半是记住了答案
        if (!firstAttempt(q.id)) return '这道题做过了，这次不计分';
        const before = getRatings()[q.dim].r;
        updateRating(q.dim, q.rating, ok);
        const after = getRatings()[q.dim].r;
        const d = after - before;
        return `${DIM_INFO[q.dim].name}分 ${before} → ${after}（${d > 0 ? '+' : ''}${d}）`;
      },
      onDone: done,
    });
  }

  /**
   * 每周小测：五维各两题，**不给提示**，做完直接更新五维雷达。
   *
   * 为什么要和日常练习分开：日常做题的分是边练边动的，混着提示、混着重复
   * 做过的题，不适合当水平的读数。单独一场不给提示、每维题量固定的小测才干净，
   * 也才看得出这一周练的东西有没有落到实处。
   *
   * 只有 10 题，测不出精确的绝对水平，但**足够看趋势**——而看趋势正是它的用途。
   */
  async function startQuiz(then?: () => void) {
    clear();
    await loadPuzzles();
    await loadLibrary();
    if (!wrap.isConnected) return;
    const used = new Set<string>();
    const plan: Dim[] = [];
    for (const d of DIMS) plan.push(d, d); // 五维各两题
    const before = { ...getRatings() };
    let i = 0;
    let right = 0;

    const step = () => {
      if (i >= plan.length) {
        markQuizDone();
        showQuizResult(before, right, plan.length, then);
        return;
      }
      const dim = plan[i];
      const p = pickNear(DIM_KIND[dim], getRatings()[dim].r, used);
      if (!p) {
        i++;
        step();
        return;
      }
      used.add(p.id);
      i++;
      const cap = `小测 ${i}/${plan.length} · ${DIM_INFO[dim].name}`;
      const after = (ok: boolean) => {
        if (ok) right++;
        step();
      };
      const q = variedQuestion(p, dim);
      if (q) runQuizOne(q, cap, after);
      else runOne(p, dim, cap, after, false);
    };
    step();
  }

  /** 小测结果：重点不是这次考了多少，而是**和上次比动了多少** */
  function showQuizResult(
    before: Record<Dim, { r: number; n: number }>,
    right: number,
    total: number,
    then?: () => void,
  ) {
    clear();
    const now = getRatings();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    const rows = DIMS.map((d) => {
      const diff = now[d].r - before[d].r;
      const sign = diff > 0 ? '+' : '';
      const cls = diff > 0 ? 'up' : diff < 0 ? 'down' : '';
      return `<div class="row"><span class="k">${DIM_INFO[d].emoji} ${DIM_INFO[d].name}</span>
        <span class="v">${now[d].r}</span>
        <span class="d ${cls}">${diff === 0 ? '—' : sign + diff}</span></div>`;
    }).join('');
    scr.innerHTML = `
      <h1>小测结果</h1>
      <div class="xq-rank-big">${right} / ${total}</div>
      <div class="xq-quiz-rows">${rows}</div>
      <div class="xq-advice"><b>怎么看这个结果</b>
        <p>10 题测不出精确水平，看的是<b>方向</b>：某一维连着几周往下走，说明那块练法不对或者练得不够；
        全都不动，说明难度没跟上——题太简单了做对也不涨分。</p></div>`;
    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = then ? '完成，回到今天的任务 →' : '← 返回';
    go.onclick = () => (then ? then() : menuBack());
    scr.appendChild(go);
    mount(scr, then);
  }

  // ---------------- 错题重练 ----------------
  async function startReview(then?: () => void) {
    clear();
    await loadPuzzles();
    if (!wrap.isConnected) return;
    const cards = dueCards(12);
    let list = cards.map((c) => byId(c.id)).filter((p): p is Puzzle => !!p);
    if (!list.length) {
      if (then) {
        then();
        return;
      }
      // 有错题但今天都没到期：说清楚为什么，并给一个"提前练"的出口。
      // 直接弹回首页会让人以为按钮坏了。
      showNoDue();
      return;
    }
    let i = 0;
    let right = 0;
    const step = () => {
      if (i >= list.length) {
        finishSession('错题重练', right, list.length, () => void startReview(), '', then);
        return;
      }
      const p = list[i];
      i++;
      runOne(p, null, `错题重练 ${i}/${list.length}`, (ok) => {
        if (ok) right++;
        step();
      });
    };
    step();
  }

  /** 错题本里有题、但今天一道都没到期 */
  function showNoDue() {
    clear();
    const all = srsCount();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>今天没有到期的错题</h1>
      <div class="sub">错题本里存着 <b>${all.total}</b> 道，按 1/3/7/21/60 天的间隔安排重练</div>
      <div class="xq-advice">
        <b>为什么不让你现在就练</b>
        <p>刚做错的题，隔一天再做才有意义——立刻重做只是在抄刚看过的答案，
        记不住。间隔重复就是卡着"快要忘了"的那个点把题送回来，那时候记的最牢。</p>
      </div>`;
    const early = document.createElement('button');
    early.className = 'btn ghost';
    early.textContent = '还是想现在练一组';
    early.onclick = () => startReviewEarly();
    const back = document.createElement('button');
    back.className = 'btn';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    scr.appendChild(early);
    mount(scr);
  }

  /** 不管到没到期，抽错题本里错得最多的几道来练 */
  async function startReviewEarly() {
    clear();
    await loadPuzzles();
    if (!wrap.isConnected) return;
    const list = allDueSoon(10)
      .map((c) => byId(c.id))
      .filter((p): p is Puzzle => !!p);
    if (!list.length) {
      menuBack();
      return;
    }
    let i = 0;
    let right = 0;
    const step = () => {
      if (i >= list.length) {
        finishSession('错题重练', right, list.length, () => showHome());
        return;
      }
      const p = list[i];
      i++;
      runOne(p, null, `错题重练 ${i}/${list.length}`, (ok) => {
        if (ok) right++;
        step();
      });
    };
    step();
  }

  /** 做一道题：判分、更新评分与错题本 */
  function runOne(
    p: Puzzle,
    dim: Dim | null,
    caption: string,
    done: (ok: boolean) => void,
    /** 测验要关掉提示：给了提示就测不准，和正式测评一个道理 */
    allowHint = true,
  ) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    disposeScreen = runPuzzle(host, p, {
      caption,
      allowHint,
      // 练习中途随时能走。答不完不让退是最容易把人逼走的设计
      onExit: () => menuBack(),
      onDone: (r) => {
        // 用了提示不算做对：算对了会把评分虚抬，下次出的题就偏难
        const ok = r.correct && !r.usedHint;
        // 错题重练不计分（dim 为 null）：那些题你见过，做对可能只是记住了答案，
        // 拿它涨分会把水平估高。复习只管有没有真的记牢，不管分数。
        const eff = effectiveRating(p.id, p.rating);
        // 只有第一次做计分：做过的题再做对，多半是记住了答案
        const first = firstAttempt(p.id);
        if (dim && first) {
          const before = getRatings()[dim].r;
          updateRating(dim, eff, ok);
          // 同一次 Elo 的另一边：反过来修正这道题的难度。
          // 引擎标的难度衡量的是机器的难度，你的成绩才是人的难度。
          calibratePuzzle(p.id, p.rating, before, ok);
        }
        if (ok) markRight(p.id);
        else markWrong(p.id);
        done(ok);
      },
    });
  }

  /**
   * 一组做完的小结。leave 给了（从"今天的任务"进来的）：不给"再来一组"，
   * 只有"回到今天的任务"——不管点哪个返回，这一项都打上勾。
   */
  function finishSession(title: string, right: number, total: number, again: () => void, score = '', leave?: () => void) {
    clear();
    checkIn();
    const { streak } = getStreak();
    const rate = total ? Math.round((right / total) * 100) : 0;
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>${title}完成</h1>
      <div class="xq-rank-big">${right}/${total} <span>正确率 ${rate}%</span></div>
      ${score ? `<div class="xq-score-line" data-score>${score}</div>` : ''}
      <div class="sub">${
        rate >= 85
          ? '这一档太轻松了，下一组会自动加难。'
          : rate >= 55
            ? '正确率落在 55~85% 这一档最好——难度正卡在你的能力边缘，进步最快。'
            : '这一组偏难了，下一组会自动降下来。做错的题已经进错题本，过几天会回来找你。'
      }</div>
      ${streak > 0 ? `<div class="xq-chips"><span class="xq-chip">🔥 连续 <b>${streak}</b> 天</span></div>` : ''}`;
    const a = document.createElement('button');
    a.className = 'btn';
    a.textContent = leave ? '✓ 完成，回到今天的任务 →' : '再来一组';
    a.onclick = leave ?? again;
    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = '← 返回';
    b.onclick = () => (leave ?? menuBack)();
    scr.appendChild(a);
    scr.appendChild(b);
    mount(scr);
  }

  // ---------------- 实用残局 ----------------
  async function showEndgameList() {
    clear();
    await loadLibrary();
    if (!wrap.isConnected) return;
    const groups = endgamesByName();
    const cleared = new Set(getCleared().endgames);
    const guesses = getEgGuesses();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `
      <h1>🏁 实用残局</h1>
      <div class="sub">摆好局面跟引擎下到底，不到分出结果不算过</div>
      <div class="xq-advice">
        <b>残局为什么排这么前</b>
        <p>残局是<b>可以算准的</b>——子少、变化收敛，练的是精确不是感觉。
        而且中局的优势最后都要靠残局兑现：多一个马走成和棋，比中局失误还可惜。</p>
        <p class="dim">每个局面的"是胜是和"都是皮卡鱼实测出来的：算得出杀的直接是胜局；算不出的，
        让它自己跟自己<b>下到底</b>（和你练的时候同一套规则：60 回合不吃子判和、三次重复判和），
        下成和的换更长的时间再下一次，还和才记"和"。老局面也按这个办法复核了一遍，改正了 15 个判错的。</p>
        <p class="dim">同一个名目下会有的能赢、有的只能和——<b>摆法不同结果就不同，这正是要练的东西</b>。
        你是进攻方时，先判断这局能不能赢，再下到底验证；你是守方时，守住就算过。
        已经是死和的局面，引擎会提前判和，不用走满 60 回合。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    // 十六类平铺太长，按车/马/炮/兵/组合分段——专业残局课本也是这么分的
    let lastCat = '';
    for (const g of groups.slice().sort((a, b) => a.category.localeCompare(b.category))) {
      if (g.category !== lastCat) {
        lastCat = g.category;
        const h = document.createElement('div');
        h.className = 'xq-sec';
        h.textContent = g.category;
        list.appendChild(h);
      }
      const done = g.items.filter((i) => cleared.has(i.id)).length;
      const wins = g.items.filter((i) => i.target === 'win' && roleOf(i) === 'att').length;
      // 还没全部判断过就先不说有几个是胜局——那等于替你把判断做了
      const guessedAll = g.items.filter((i) => roleOf(i) === 'att').every((i) => guesses[i.id]);
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.innerHTML = `
        <div class="title">${g.name}<span class="tag">${g.category}</span>${
          done === g.items.length ? '<span class="tag warn">已过</span>' : done ? `<span class="tag">${done}/${g.items.length}</span>` : ''
        }</div>
        <div class="desc">${g.material}　·　${g.items.length} 个局面${
          guessedAll ? `（其中 ${wins} 个是胜局）` : ''
        }<br>${g.goal}</div>`;
      el.onclick = () => showEndgameGroup(g);
      list.appendChild(el);
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  function showEndgameGroup(g: ReturnType<typeof endgamesByName>[number]) {
    clear();
    const cleared = new Set(getCleared().endgames);
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>${g.name}</h1>
      <div class="sub">${g.material}</div>
      <div class="xq-advice">
        <b>这一局练什么</b><p>${g.goal}</p>
        <b>要领</b><ul style="margin:6px 0 0;padding-left:18px;line-height:1.75">${g.tips
          .map((t) => `<li>${t}</li>`)
          .join('')}</ul>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    const guesses = getEgGuesses();
    const beaten = new Set(getBeatDraw());
    g.items.forEach((e, i) => {
      const el = document.createElement('div');
      el.className = 'card home-card';
      // 没猜过就先不揭晓。残局功力的核心是"判断这局是胜是和"，
      // 直接把答案印在卡片上，等于把这一课删掉了
      const render = () => {
        const guess = guesses[e.id];
        // 你是守方：不问"能赢还是只能和"——你是少子的一方，谈不上赢。直接说清这一局要你干什么
        if (roleOf(e) === 'def') {
          el.innerHTML = `
            <div class="title">局面 ${i + 1}<span class="tag">守和练习</span>
              ${cleared.has(e.id) ? '<span class="tag">已过</span>' : ''}</div>
            <div class="xq-eg-thumb"></div>
            <div class="desc">对方子力占优，<b>你是守方</b>：守住就算过（引擎判定和棋、60 回合不吃子、三次重复都算守住）。${
              e.reason ? `<br><span class="dim">引擎实测：${drawWhy(e)}</span>` : ''
            }${bookNote(e)}</div>`;
          showThumb(el, e);
          el.onclick = () => runEndgame(g, i);
          return;
        }
        if (!guess) {
          el.innerHTML = `
            <div class="title">局面 ${i + 1}<span class="tag">先判断</span></div>
            <div class="xq-eg-thumb"></div>
            <div class="desc">你是进攻方（子力占优）。看一眼这个局面：你能赢下来，还是只能和？</div>
            <div class="xq-eg-guess">
              <button class="xq-btn" data-g="win">能赢</button>
              <button class="xq-btn" data-g="draw">只能和</button>
            </div>`;
          showThumb(el, e);
          el.querySelectorAll<HTMLButtonElement>('[data-g]').forEach((btn) => {
            btn.onclick = (ev) => {
              ev.stopPropagation();
              const gv = btn.dataset.g as 'win' | 'draw';
              guesses[e.id] = gv;
              guessEndgame(e.id, gv, e.target);
              render();
            };
          });
          el.onclick = null;
          return;
        }
        const beat = beaten.has(e.id); // 你在这个标着和棋的局面里真赢过
        const right = beat ? guess === 'win' : guess === e.target;
        el.innerHTML = `
          <div class="title">局面 ${i + 1}
            <span class="tag ${e.target === 'win' || beat ? 'warn' : ''}">${
              beat ? '你赢过' : e.target === 'win' ? '你能赢' : '和棋'
            }</span>
            ${cleared.has(e.id) ? '<span class="tag">已过</span>' : ''}</div>
          <div class="desc">${right ? '✅ 你判断对了' : `❌ 你猜的是「${guess === 'win' ? '能赢' : '和棋'}」`}　·　${
            e.target === 'win' ? '把优势下成胜势' : '守住这个和棋'
          }${
            beat
              ? '<br><span class="dim">⚑ 这局引擎判的是和，但<b>你实际赢下来了</b>——以你的结果为准。引擎的残局技术有限，它下不出来的胜果，懂技术的人下得出来。</span>'
              : e.reason
                ? `<br><span class="dim">引擎实测：${drawWhy(e)}</span>`
                : ''
          }${beat ? '' : bookNote(e)}</div>
          <div class="xq-eg-thumb"></div>`;
        showThumb(el, e);
        el.onclick = () => runEndgame(g, i);
      };
      render();
      list.appendChild(el);
    });
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showEndgameList;
    scr.appendChild(back);
    mount(scr);
  }

  /**
   * 卡片上的小棋盘。
   *
   * 少了它这一屏就没意义——问"你觉得这局能不能赢"却不给看局面，
   * 那不叫判断，叫瞎猜。执黑的局面要翻过来，让"你"永远在下方。
   */
  function showThumb(card: HTMLElement, e: EndgamePos) {
    const host = card.querySelector('.xq-eg-thumb') as HTMLElement | null;
    const parsed = host && fromFen(e.fen);
    if (!host || !parsed) return;
    const bd = new Board2D(host, { flip: e.you === 'b' });
    bd.setBoard(parsed.board);
    thumbs.push(bd);
  }

  /**
   * 把"这个结果怎么来的"说成人话。
   *
   * 标"和"有两种完全不同的意思：局面本来就是和棋，还是**在 60 回合无吃子
   * 判和这条规则下走不出胜果**。后者可能和棋书上的理论结论不一样
   * （比如单车对马双士，书上说例胜，但要走的步数超过这条规则），
   * 不写清楚就会被当成软件算错了。
   */
  function drawWhy(e: EndgamePos): string {
    if (e.target === 'win') return `${Math.ceil(e.plies / 2)} 回合内能将死`;
    if (e.reason?.includes('无吃子')) return '打到 60 回合无吃子判和——这是规则判的和，不一定是理论和棋';
    if (e.reason?.includes('重复')) return '双方都走不出变化，三次重复判和';
    if (e.reason?.includes('未分')) return `打了 ${Math.ceil(e.plies / 2)} 回合还是没分出胜负`;
    return e.reason ?? '';
  }

  /**
   * 实测结果和棋书结论不一致时，把这件事说破。
   *
   * 马炮对士象全书上是例胜，但要走很多步很精确的棋，引擎在 60 回合内走不出来，
   * 实测就记成"和"。不说明白的话，懂棋的人只会觉得这软件算错了——
   * 而事实是：**这一局的胜势要靠技术兑现，兑现不了就是和**，这本身才是该学的东西。
   */
  function bookNote(e: EndgamePos): string {
    if (!e.book) return '';
    const conflict = e.target === 'draw' && /例胜|胜势/.test(e.book);
    // 反过来：书上例和，这个局面却能赢——守方的士象没摆好，正是要你找突破的地方
    const loose = e.target === 'win' && /例和/.test(e.book);
    return conflict
      ? `<br><span class="dim">棋书上：${e.book}。引擎这一局没走出胜果——胜势要靠技术兑现，兑不出来就是和。</span>`
      : loose
        ? `<br><span class="dim">棋书上：${e.book}。可这个局面守方的士象没摆好，引擎实测能赢——找到突破口就是这一局要练的。</span>`
        : `<br><span class="dim">棋书上：${e.book}</span>`;
  }

  function runEndgame(g: ReturnType<typeof endgamesByName>[number], i: number, exit?: () => void) {
    const e: EndgamePos = g.items[i];
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    disposeScreen = runPlayout(host, {
      fen: e.fen,
      you: e.you,
      target: e.target,
      title: e.name,
      subtitle: `${e.material} · 局面 ${i + 1}`,
      tips: e.tips,
      book: e.book,
      onRestart: () => runEndgame(g, i, exit),
      onDone: (r, _moves, st) => {
        // 你在标着「和棋」的局面里赢了：说明这个标注保守了，以你的结果为准。
        // 引擎的判定是最好的自动近似，但它不是裁判。
        if (r === 'win' && e.target === 'draw') markBeatDraw(e.id);
        // 达成目标才算过：胜局必须赢（下到将死），和局守和即可。
        // 过关照记；计分只看第一次，而且靠提示、悔棋下出来的不加分
        const pass = r === 'win' || (r === 'draw' && e.target === 'draw');
        if (pass) markEndgameCleared(e.id);
        if (firstAttempt(`eg:${e.id}`)) updateRating('endgame', e.rating, pass && !st.hints && !st.undos);
        checkIn();
        finishTask();
      },
      onExit: () => {
        checkIn();
        (exit ?? (() => showEndgameGroup(g)))();
      },
    });
  }

  /**
   * "你的分都丢在哪儿"——今日训练的依据，直接摆给你看。
   *
   * 不摆出来的话，"今天练眼力"就只是一句安排；摆出来之后它是一个结论：
   * 最近这几盘，你的分确实主要漏在那一维上。
   */
  function lossCard(loss: ReturnType<typeof lossProfile>): string {
    if (!loss.games || loss.total < 100) {
      return `<div class="xq-advice"><b>还没有足够的实战数据</b>
        <p>训练安排现在按你的<b>做题分数</b>排。等你下够 3 盘并复盘之后，
        会改成按<b>实战丢分</b>排——那才是你真正在输棋的地方。做题会做不等于实战用得上。</p></div>`;
    }
    const rows = DIMS.map((d) => ({ d, v: loss.by[d] }))
      .sort((a, b) => b.v - a.v)
      .filter((r) => r.v > 0);
    const max = rows[0]?.v || 1;
    return `<div class="xq-advice"><b>最近 ${loss.games} 盘，你的分丢在哪儿</b>
      <div class="xq-lossbars">${rows
        .map(
          (r) => `<div class="row"><span class="k">${DIM_INFO[r.d].name}</span>
            <span class="bar"><i style="width:${Math.round((r.v / max) * 100)}%"></i></span>
            <span class="v">${Math.round((r.v / loss.total) * 100)}%</span></div>`,
        )
        .join('')}</div>
      <p class="dim">按引擎复盘逐手归因：漏杀算杀法，开局十二手内算布局，子力很少时算残局，
      被对方立刻吃子算眼力，其余算战术。</p></div>`;
  }

  /**
   * 从还没过的组里挑**难度最贴近你水平**的那一组。
   *
   * 原来是 `groups.find(还没过的第一个)`——顺序完全取决于数据文件里的排列。
   * 残局现在有十六类，从"单马对单士"到"车炮对士象全"跨度很大，
   * 按文件顺序发等于随机给你一课。练在能力边缘才涨得快，这条对残局同样成立。
   */
  function pickByLevel<T extends { items: { id: string; rating: number }[] }>(
    groups: T[],
    cleared: Set<string>,
    myRating: number,
  ): T | undefined {
    const open = groups.filter((g) => g.items.some((i) => !cleared.has(i.id)));
    const pool = open.length ? open : groups;
    if (!pool.length) return undefined;
    const avg = (g: T) => g.items.reduce((a, i) => a + i.rating, 0) / g.items.length;
    return pool.reduce((best, g) => (Math.abs(avg(g) - myRating) < Math.abs(avg(best) - myRating) ? g : best), pool[0]);
  }

  // ---------------- 打谱 ----------------
  /**
   * 打谱：**先自己想一手，再看谱怎么走。**
   *
   * 这是专业训练里最老的一项，而它起作用的地方不是"看"，是"猜"。
   * 看谱的时候人人都觉得"这手我也想得到"，真让你先走一遍才知道想不想得到。
   *
   * ⚠️ 这里的谱**不是名局**，得说清楚：
   *   · 名局要有可靠的棋谱来源，我没有。**凭印象编一份署着真人名字的对局
   *     是不能做的**——那是伪造真实人物的记录，比留个空白糟糕得多。
   *   · 纯引擎自战也不行：实测让引擎从头下，第 1 手走"炮八进四"、
   *     第 3 手"将5进1"——它没有开局库，开局分支太多，十层搜索看不出所以然。
   *     拿那种谱打，学到的全是坏习惯。
   * 所以是**开局按已验证的定式走完，之后交给引擎自战**。开局是书上的，
   * 中局是引擎的，两段都站得住。等有了可靠的名局棋谱再补。
   */
  async function showGames() {
    clear();
    const games = (await import('./games.json')).default as {
      id: string;
      name: string;
      result: string;
      opening: string;
      bookPlies: number;
      moves: { t: string; why?: string }[];
    }[];
    if (!wrap.isConnected) return;
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>打谱</h1>
      <div class="sub">先自己想一手，再看谱怎么走</div>
      <div class="xq-advice"><b>这些谱是怎么来的——先说清楚</b>
        <p><b>不是名局。</b>名局要有可靠的棋谱来源，我没有；而凭印象编一份署着
        真人名字的对局是不能做的，那是伪造记录。</p>
        <p>也不是纯引擎自战——实测让引擎从头下，第 1 手"炮八进四"、第 3 手"将5进1"，
        它<b>没有开局库</b>，开局阶段看不出所以然。拿那种谱打只会学坏。</p>
        <p>所以这里是<b>开局按定式走完、中局之后交给引擎</b>：开局是书上的，
        中局是引擎的。打谱真正起作用的是"猜着法"这个动作，这一点对中局同样成立。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const g of games) {
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.innerHTML = `<div class="title">${g.name}<span class="tag">${g.result}</span></div>
        <div class="desc">${g.moves.length} 手 · 前 ${g.bookPlies} 手是「${g.opening}」定式，之后是引擎自战</div>`;
      el.onclick = () => {
        clear();
        const host = document.createElement('div');
        host.className = 'xq-coach-stage';
        wrap.appendChild(host);
        disposeScreen = runReplay(host, {
          title: g.name,
          subtitle: '猜着法：轮到红方时先自己走一手',
          intro: `前 ${g.bookPlies} 手是「${g.opening}」的定式走法，之后是引擎自战。轮到红方时会先让你走，再揭晓原谱。`,
          moves: g.moves,
          guessFor: 'r',
          notes: [
            '猜不中很正常，甚至猜中率低反而说明这谱对你有东西可学。',
            '重点是看清<b>原谱为什么那么走</b>，不是比谁猜得多。',
            '同一局隔几天再打一遍，看看这次能不能猜中上次没猜中的地方。',
          ],
          onExit: () => void showGames(),
        });
      };
      list.appendChild(el);
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  // ---------------- 限时计算 ----------------
  /**
   * 限时计算：**把「算不出来」和「懒得算」分开。**
   *
   * 这两个病在不限时的时候长得一模一样——都是做错。但它们的练法完全相反：
   * 「懒得算」要练的是习惯（每步落子前强迫自己算一遍），
   * 「算不出来」要练的是能力（从更简单的题往上垒）。
   * 分不清就会用错药，练半天没效果。
   *
   * 分法很简单：**限时做一遍，错的题再不限时做一遍**。
   *   限时错、不限时对  → 你算得出来，只是没去算
   *   两次都错          → 真的算不出来
   */
  async function startTimed(then?: () => void) {
    clear();
    await loadPuzzles();
    if (!wrap.isConnected) return;
    const dim: Dim = 'tactic';
    const TOTAL = 6;
    const LIMIT = 45;
    const used = new Set<string>();
    const missed: Puzzle[] = [];
    let i = 0;
    let inTime = 0;

    const round1 = () => {
      if (i >= TOTAL) return round2();
      const p = pickNear(DIM_KIND[dim], getRatings()[dim].r - 60, used);
      if (!p) return round2();
      used.add(p.id);
      i++;
      clear();
      const host = document.createElement('div');
      host.className = 'xq-coach-stage';
      wrap.appendChild(host);
      disposeScreen = runPuzzle(host, p, {
        caption: `限时计算 ${i}/${TOTAL} · 每步 ${LIMIT} 秒`,
        allowHint: false,
        timeLimit: LIMIT,
        playToEnd: false,
        onExit: () => menuBack(),
        onDone: (r) => {
          if (r.correct) inTime++;
          else missed.push(p);
          round1();
        },
      });
    };

    /** 第二轮：把限时没做出来的题**不限时**再给一遍 */
    let j = 0;
    let solvedUnlimited = 0;
    const round2 = () => {
      if (!missed.length) return report();
      if (j >= missed.length) return report();
      const p = missed[j];
      j++;
      clear();
      const host = document.createElement('div');
      host.className = 'xq-coach-stage';
      wrap.appendChild(host);
      disposeScreen = runPuzzle(host, p, {
        caption: `不限时重做 ${j}/${missed.length} · 这次慢慢算`,
        allowHint: false,
        playToEnd: false,
        onExit: () => menuBack(),
        onDone: (r) => {
          if (r.correct) solvedUnlimited++;
          round2();
        },
      });
    };

    const report = () => {
      clear();
      const lazy = solvedUnlimited;
      const cant = missed.length - solvedUnlimited;
      const scr = document.createElement('div');
      scr.className = 'screen xq-coach-report';
      scr.innerHTML = `
        <h1>限时计算 · 诊断</h1>
        <div class="xq-rank-big">${inTime} / ${TOTAL}<span>在 ${LIMIT} 秒内做对</span></div>
        <div class="xq-advice"><b>没做出来的那 ${missed.length} 道，分成两类</b>
          <div class="xq-goal"><b>没去算：${lazy} 道</b>
            <span>限时做错，不限时就做对了。<b>你算得出来，只是当时没算。</b>
            这是习惯问题——实战里每步落子前强迫自己把对方的应手过一遍，比做一百道题管用。</span></div>
          <div class="xq-goal"><b>算不出来：${cant} 道</b>
            <span>给了时间也没做出来。这是能力问题，得从更简单的题往上垒，
            急不得。硬啃比自己水平高两档的题只会打击信心。</span></div>
          <p class="dim">${
            lazy > cant
              ? '你的主要问题是<b>没去算</b>——这其实是好消息，习惯比能力好改。下棋时慢一点，落子前数三秒。'
              : cant > lazy
                ? '你的主要问题是<b>算不出来</b>——按部就班往上垒就行，别急着做难题。'
                : '两类各占一半。先解决"没去算"，那个见效快。'
          }</p>
        </div>`;
      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = then ? '完成，回到今天的任务 →' : '← 返回';
      go.onclick = () => (then ? then() : menuBack());
      scr.appendChild(go);
      mount(scr, then);
    };

    round1();
  }

  // ---------------- 布局定式 ----------------
  /**
   * 布局课。**讲思路，不背招法。**
   *
   * 之前布局这一维只有"别早早亏子"的题，没有"中炮想干什么"。
   * 招法背下来只能应付一模一样的局面，思路懂了才能应付变着——
   * 而实战里对手基本不会跟你走一模一样的谱。
   *
   * 两种练法：先看一遍（讲解），再用猜着法过一遍。看的时候人人都觉得
   * "这手我也想得到"，真让你先走一遍才知道想不想得到。
   */
  function showOpenings() {
    clear();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>布局体系</h1>
      <div class="sub">每一套：怎么走、为什么这么走、对方怎么破</div>
      <div class="xq-advice"><b>怎么学布局才涨棋</b>
        <p>每一套主线走到 15 回合左右：前面几个回合是定式谱，后面由皮卡鱼深算延伸，
        <b>每一手都配一句在干什么</b>，双方选择最多的地方补了变化。</p>
        <p>建议顺序：先 📖 看一遍主线和"怎么破"，再用 🎯 <b>自己执一方走一遍</b>——走了谱外的着法，
        皮卡鱼会判它是不是一样好。光看谱会以为自己都想得到，自己走一遍才知道。</p>
        <p class="dim">布局在业余对局里只占输棋原因的一成左右；漏着和残局没练好时，布局的便宜守不住。
        到了一千五以上，布局才是真瓶颈。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    const due = dueOpenings();
    const srsAll = Object.keys(opSrs()).length;
    if (srsAll) {
      const rv = document.createElement('div');
      rv.className = `card home-card${due.length ? ' hot' : ''}`;
      rv.dataset.act = 'op-review';
      rv.innerHTML = `<div class="title">🔁 布局复习${due.length ? `<span class="tag warn">今天 ${due.length} 套</span>` : '<span class="tag">今天没有到期的</span>'}</div>
        <div class="desc">自己走过的主线会按 1 / 3 / 7 / 21 / 60 天的间隔回来找你：猜中八成以上下次隔得更久，没到八成明天再来。
        ${due.length ? `今天要复习：${due.map(([o, c]) => `${o.name}（执${c === 'r' ? '红' : '黑'}）`).join('、')}。` : `一共排着 ${srsAll} 套。`}</div>`;
      if (due.length) rv.onclick = () => runOpeningReview(due);
      list.appendChild(rv);
    }
    const ex = document.createElement('div');
    ex.className = 'card home-card';
    ex.dataset.act = 'explorer';
    ex.innerHTML = `<div class="title">📚 开局浏览器<span class="tag">所有布局 · 所有变招</span></div>
      <div class="desc">任何一个局面，谱上有哪些走法（主线、变化、变招、错着、邪门）一目了然，每一手讲意义；
      走出谱以后皮卡鱼接着列候选着。能导入棋谱、FEN，对局里的布局也能拿来查。</div>`;
    ex.onclick = () => showExplorer();
    list.appendChild(ex);
    const tk = document.createElement('div');
    tk.className = 'card home-card';
    tk.innerHTML = `<div class="title">🗡 江湖布局破解<span class="tag">${TRICKS.length} 条</span></div>
      <div class="desc">对手不按定式走、专走江湖套路时怎么办。</div>`;
    tk.onclick = () => showTricks();
    list.appendChild(tk);
    const systems = [...SYSTEM_ORDER, ...OPENINGS.map((o) => o.system).filter((x) => !SYSTEM_ORDER.includes(x))];
    for (const sys of [...new Set(systems)]) {
      const items = OPENINGS.filter((o) => o.system === sys);
      if (!items.length) continue;
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.textContent = sys;
      list.appendChild(h);
      for (const o of items) {
        const el = document.createElement('div');
        el.className = 'card home-card';
        el.dataset.opening = o.id;
        const best = openingBest(o.id);
        const srs = [opSrs()[`${o.id}:r`], opSrs()[`${o.id}:b`]].filter(Boolean);
        const nextDue = srs.length ? Math.min(...srs.map((x) => x.due)) - todayNum() : null;
        el.innerHTML = `<div class="title">${o.name}<span class="tag">${o.side === 'red' ? '先手' : '后手'}</span>${
          best !== null ? `<span class="tag ${best >= 80 ? 'ok' : 'warn'}">已走 ${best}%</span>` : ''
        }${nextDue !== null ? `<span class="tag${nextDue <= 0 ? ' warn' : ''}">${nextDue <= 0 ? '该复习了' : `${nextDue} 天后复习`}</span>` : ''}</div>
          <div class="desc">${o.tag}<br><span class="dim">主线 ${Math.ceil(o.moves.length / 2)} 回合${
            o.variations.length ? ` · ${o.variations.length} 个变化` : ''
          }</span></div>`;
        el.onclick = () => showOpening(o);
        list.appendChild(el);
      }
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  function showOpening(o: Opening) {
    clear();
    // 变招大扩充的数据按需加载：到了以后，还停在这一屏就重画（变招、错着列出来）
    const before = o.variations.length;
    void loadOpeningExtras().then(() => {
      if (o.variations.length !== before && wrap.querySelector(`[data-op-page="${o.id}"]`)) showOpening(o);
    });
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    const flagged = o.moves.filter((m) => m.book && m.loss && m.loss >= 60);
    scr.dataset.opPage = o.id;
    scr.innerHTML = `<h1>${o.name}</h1><div class="sub">${o.tag}</div>
      <div class="xq-advice" data-keep><b>核心思路——要记住的是这个</b><p>${o.idea}</p>
        <b>${o.side === 'red' ? '对方怎么破' : '怎么破'}</b><p>${o.breaks}</p>
        <b>容易踩的坑</b><ul>${o.traps.map((t) => `<li>${t}</li>`).join('')}</ul>
        <p class="dim">主线 ${Math.ceil(o.moves.length / 2)} 回合，${o.final}。${
          flagged.length ? `谱上 ${flagged.map((m) => m.t).join('、')} 引擎不太认可，讲解里有说明。` : ''
        }每一手都让皮卡鱼核对过。</p>
      </div>`;
    const mk = (label: string, fn: () => void, act?: string) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.onclick = fn;
      if (act) b.dataset.act = act;
      scr.appendChild(b);
    };
    mk('📖 看主线（每一手都讲）', () => runOpening(o, undefined), 'op-watch');
    mk('🎯 你执红走一遍', () => runOpening(o, 'r'), 'op-red');
    mk('🎯 你执黑走一遍', () => runOpening(o, 'b'), 'op-black');
    if (startFrom) mk(`⚔️ 从主线走完的局面实战（你执${o.side === 'red' ? '红' : '黑'}）`, () => playFromOpening(o.moves.map((m) => m.t), o.side === 'red' ? 'r' : 'b'), 'op-play');
    const firstAt = o.variations.length ? Math.min(...o.variations.map((v) => v.at)) : 0;
    mk('📚 在开局浏览器里看：每个分岔点有哪些变招', () => showExplorer(o.moves.slice(0, firstAt).map((m) => m.t), () => showOpening(o)), 'op-explorer');
    const seen = seenLines();
    const seenOf = (k: number) => seen.has(`op:${o.id}:${o.variations[k].name}`);
    // 抽查：随机挑一条（没看过的优先），对方改走的那一手摆出来，你执另一方接着走
    const drillable = o.variations.map((v, k) => (v.moves.length >= 4 ? k : -1)).filter((k) => k >= 0);
    if (drillable.length) {
      mk('🎲 抽一条变化自己走：对方改走了，你怎么应', () => {
        const k = pickOne(drillable, seenOf)!;
        const v = o.variations[k];
        runOpening(o, (v.at + 1) % 2 === 0 ? 'r' : 'b', k, undefined, true);
      }, 'op-drill');
    }
    // 变化分两组：原来的变化和变招（和主线差不多一样好）一组，错着（看着自然、其实亏）一组
    const groups: [string, string, number[]][] = [
      ['变化和变招', '和主线差不多一样好的另一路走法，每一手讲意义', o.variations.map((v, k) => (v.kind !== 'trap' ? k : -1)).filter((k) => k >= 0)],
      ['错着', '看着很自然、其实要亏的一手，看对方怎么惩罚', o.variations.map((v, k) => (v.kind === 'trap' ? k : -1)).filter((k) => k >= 0)],
    ];
    for (const [title, sub, ks] of groups) {
      if (!ks.length) continue;
      const h = document.createElement('div');
      h.className = 'xq-sec';
      const nSeen = ks.filter(seenOf).length;
      h.innerHTML = `${title}（${ks.length}${nSeen ? `，看过 ${nSeen}` : ''}）<span class="dim">　${sub}</span>`;
      scr.appendChild(h);
      for (const k of ks.sort((a, b) => o.variations[a].at - o.variations[b].at)) {
        const v = o.variations[k];
        const row = document.createElement('div');
        row.className = 'card home-card';
        row.dataset.variation = String(k);
        row.innerHTML = `<div class="title">${v.name}${v.kind === 'alt' ? '<span class="tag">变招</span>' : v.kind === 'trap' ? '<span class="tag warn">错着</span>' : ''}${
          seenOf(k) ? '<span class="tag ok">✓ 看过</span>' : ''
        }</div><div class="desc">从第 ${Math.floor(v.at / 2) + 1} 回合分出去，再走 ${Math.ceil(
          v.moves.length / 2,
        )} 回合 · ${v.final}</div>`;
        row.onclick = () => runOpening(o, undefined, k);
        scr.appendChild(row);
      }
    }
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showOpenings;
    scr.appendChild(back);
    mount(scr);
  }

  /** 布局自己走过的成绩：key = 套路 id + 执哪方（+ 变化号），值 = 最好的一次猜对几成 */
  const OP_KEY = 'xq-openings-done';
  function openingScores(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(OP_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }
  function setOpeningScore(key: string, pct: number) {
    const s = openingScores();
    if ((s[key] ?? -1) >= pct) return;
    s[key] = pct;
    try {
      localStorage.setItem(OP_KEY, JSON.stringify(s));
    } catch {
      /* 存不下就算了 */
    }
  }
  /** 这一套最好的成绩（主线红黑两边取高的） */
  const openingBest = (id: string) => {
    const s = openingScores();
    const v = [s[`${id}:r`], s[`${id}:b`]].filter((x) => x !== undefined);
    return v.length ? Math.max(...v) : null;
  };

  function runOpening(o: Opening, guessFor: Color | undefined, variation?: number, exit?: () => void, drill = false) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const v = variation === undefined ? null : o.variations[variation];
    const line = v ? [...o.moves.slice(0, v.at), ...v.moves] : o.moves;
    // 教练讲解：这一段（主线从头，变化从分岔处）里局面变化最大的一手标成"关键一手"，收尾加一段教练小结
    const segStart = v ? v.at : 0;
    const evBefore = segStart > 0 ? o.moves[segStart - 1].ev : 0;
    const firstMover: Color = segStart % 2 === 0 ? 'r' : 'b';
    const seg = line.slice(segStart).map((m) => ({ t: m.t, why: moveNote(m), ev: m.ev }));
    const keyed = withKey(seg, evBefore, firstMover);
    const summary = lineSummary({ kind: v ? (v.kind ?? 'var') : 'main', moves: seg, evBefore, firstMover, ply0: segStart, mainMove: v ? o.moves[v.at]?.t : undefined });
    const moves = [...line.slice(0, segStart).map((m) => ({ t: m.t, why: moveNote(m) })), ...keyed].map((m, i) => ({
      t: m.t,
      why: m.why,
      known: v ? undefined : knownAt(o, i),
    }));
    const sideOf = (ply: number) => (ply % 2 === 0 ? '红' : '黑');
    // 抽查：对方那一手（分岔的那一手）摆出来，你执另一方接着走
    const drillIntro =
      drill && v
        ? `抽查：前面照主线摆好，第 ${Math.floor(v.at / 2) + 1} 回合${sideOf(v.at)}方走了 <b>${v.moves[0].t}</b>（${v.moves[0].why.replace(/<[^>]+>/g, '').split('。')[0]}）。
           你执${sideOf(v.at + 1)}，接下来怎么走？走了谱外的着法，皮卡鱼判是不是一样好。`
        : '';
    disposeScreen = runReplay(host, {
      title: v ? `${o.name} · ${v.name}` : o.name,
      subtitle: guessFor ? `你执${guessFor === 'r' ? '红' : '黑'}：先自己走，再看原谱（走了别的，皮卡鱼判是不是一样好）` : '讲解：每一手都说明在做什么',
      intro: drillIntro
        ? drillIntro
        : v
          ? `${v.kind === 'trap' ? '错着' : v.kind === 'alt' ? '变招' : '变化'}：${v.name}。前 ${v.at} 手和主线一样，从这里分出去。${
              v.kind === 'trap' ? '这一手看着很自然，其实要亏——看对方怎么惩罚。' : v.kind === 'alt' ? '这一手和主线差不多一样好，换一条路走。' : ''
            }每一手都讲它的意义：防住了什么、威胁什么、引擎怎么看；局面变化最大的那一手标着 ⭐。`
          : o.idea,
      moves,
      guessFor,
      startAt: v ? (drill ? v.at + 1 : v.at) : undefined,
      judge: guessFor ? (b, c, mine, exp) => judgeAgainst(b, c, mine, exp) : undefined,
      onFinish: (right, tried) => {
        if (v) markSeen(`op:${o.id}:${v.name}`);
        if (guessFor && tried) {
          const pct = Math.round((right / tried) * 100);
          setOpeningScore(`${o.id}:${guessFor}${v ? `:${variation}` : ''}`, pct);
          // 主线自己走过一遍，就排进布局复习（间隔重复）
          if (!v) scheduleOpening(`${o.id}:${guessFor}`, pct);
        }
        if (guessFor) checkIn();
        if (guessFor && tried) finishTask();
      },
      outro: `<b>${v ? v.final : o.final}</b>（皮卡鱼评估）。${summary}${v ? '' : `<br>${o.breaks}`}`,
      notes: o.traps,
      // 谱走完了，中局才开始：从这个局面和对手接着下，把布局的思路用到实战里
      next: startFrom
        ? { label: '⚔️ 从这里接着下', run: () => playFromOpening(line.map((m) => m.t), guessFor ?? (o.side === 'red' ? 'r' : 'b')) }
        : undefined,
      onExit: exit ?? (() => showOpening(o)),
    });
  }

  // ---------------- 看过的变化（打勾） ----------------
  const SEEN_KEY = 'xq-seen-lines';
  function seenLines(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(SEEN_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }
  function markSeen(key: string) {
    const s = seenLines();
    if (s.has(key)) return;
    s.add(key);
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify([...s]));
    } catch {
      /* 存不下就算了 */
    }
  }
  /** 抽一条：没看过的优先 */
  function pickOne<T>(items: T[], seen: (x: T) => boolean): T | undefined {
    const fresh = items.filter((x) => !seen(x));
    const pool = fresh.length ? fresh : items;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  /**
   * 主线第 i 手那里谱上还收着哪些走法：变招算对，错着说清楚错在哪、对方怎么罚（下一手就是惩罚）。
   * 执一方自己走主线时用：走到这些不用等皮卡鱼核对。
   */
  function knownAt(o: Opening, i: number): { t: string; ok: boolean; note: string }[] | undefined {
    // 原来的变化里有几条引擎认为差一点（0.6 个兵以上）的，不直接算对，交给皮卡鱼判
    const fine = (v: Opening['variations'][number]) => v.kind === 'trap' || !((v.moves[0].loss ?? 0) >= 60 || v.moves[0].why.includes('引擎更想走'));
    const out = o.variations
      .filter((v) => v.at === i && v.moves[0] && v.moves[0].t !== o.moves[i]?.t && fine(v))
      .map((v) => {
        const punish = v.moves[1];
        return v.kind === 'trap'
          ? {
              t: v.moves[0].t,
              ok: false,
              note: `这是谱上收着的错着——看着自然，其实要亏${punish ? `：对方走 <b>${punish.t}</b>（${keyNote(punish.why.replace(/<[^>]+>/g, '').split('。')[0])}）` : ''}。布局页"错着"一组里有这一路的全程`,
            }
          : { t: v.moves[0].t, ok: true, note: `谱上的${v.kind === 'alt' ? '变招' : '变化'}「${v.name}」，布局页里能看这一路怎么走下去` };
      });
    return out.length ? out : undefined;
  }

  // ---------------- 布局复习（间隔重复） ----------------
  /**
   * 参考 Chessable 的 MoveTrainer：学过的谱不复习，过两周就忘。主线自己走过一遍（🎯 执红/执黑走一遍）就排进复习：
   * 猜中八成以上，下次隔得更久（1 → 3 → 7 → 21 → 60 天）；没到八成，打回明天重来。
   */
  const OP_SRS_KEY = 'xq-op-srs';
  const OP_SRS_DAYS = [1, 3, 7, 21, 60];
  type OpSrs = Record<string, { box: number; due: number; last: number }>;
  function opSrs(): OpSrs {
    try {
      return JSON.parse(localStorage.getItem(OP_SRS_KEY) ?? '{}') as OpSrs;
    } catch {
      return {};
    }
  }
  function scheduleOpening(key: string, pct: number) {
    const all = opSrs();
    const cur = all[key];
    const box = pct >= 80 ? Math.min(OP_SRS_DAYS.length - 1, cur ? cur.box + 1 : 0) : 0;
    all[key] = { box, due: todayNum() + OP_SRS_DAYS[box], last: pct };
    try {
      localStorage.setItem(OP_SRS_KEY, JSON.stringify(all));
    } catch {
      /* 存不下就算了 */
    }
  }
  /** 今天到期的布局复习：[布局, 执哪方] */
  function dueOpenings(): [Opening, Color][] {
    const all = opSrs();
    const today = todayNum();
    return Object.entries(all)
      .filter(([, x]) => x.due <= today)
      .sort((a, b) => a[1].due - b[1].due)
      .map(([k]) => {
        const [id, side] = k.split(':');
        const o = OPENINGS.find((x) => x.id === id);
        return o ? ([o, side as Color] as [Opening, Color]) : null;
      })
      .filter((x): x is [Opening, Color] => !!x);
  }
  /** 一套一套复习下去，走完一套接下一套 */
  function runOpeningReview(queue: [Opening, Color][], end: () => void = () => showOpenings()) {
    const [head, ...rest] = queue;
    if (!head) return end();
    // 变招数据先到（走到谱上的变招、错着当场认得出、讲解也是新的），加载失败照样开始
    void loadOpeningExtras().then(() => runOpening(head[0], head[1], undefined, () => (rest.length ? runOpeningReview(rest, end) : end())));
  }

  /** 开局浏览器：谱上所有走法 + 皮卡鱼候选着；startMoves 先走好，back 是返回去哪 */
  function showExplorer(startMoves?: string[], back?: () => void) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    disposeScreen = runExplorer(host, {
      startMoves,
      onExit: back ?? (() => showOpenings()),
      onPlayFrom: startFrom ? (texts, me) => playFromOpening(texts, me) : undefined,
    });
  }

  /** 从布局谱的终局和对手接着下（对手按实战分推荐的档位） */
  function playFromOpening(texts: string[], me: Color) {
    const w = walkMoves(texts);
    if (!w || !startFrom) return;
    const play = getPlay();
    startFrom(w.moves, me, play && play.n >= 3 ? opponentFor(play.r) : undefined);
  }

  // ---------------- 中局组合：按主题、按步数 ----------------
  const COMBO_THEMES: { id: string; why: string }[] = [
    { id: '连将杀', why: '每一步都将军，一直将到死。对方只能应将，你握着全部主动。' },
    { id: '杀', why: '杀法里有一步不将军的"安静着"——封住退路、腾出位置，下一步才杀得死。' },
    { id: '弃子', why: '先送一个子，换来更大的东西：杀棋、捉双、或者把对方的防守子引开。' },
    { id: '抽将', why: '走开一个子，后面的子将军（闪将）；走开的那个子顺手吃子或捉子，对方应将就顾不上。' },
    { id: '捉双', why: '一步同时捉两个子，对方只救得了一个。' },
    { id: '将军抽子', why: '将军的同时捉着另一个子，对方应完将，那个子就丢了。' },
    { id: '组合', why: '几步连续的得子手段，没有单一的名字，但每一步都是逼着对方走的。' },
  ];
  const COMBO_TIERS = [
    { name: '2–3 步', min: 2, max: 3 },
    { name: '4–5 步', min: 4, max: 5 },
    { name: '6–7 步', min: 6, max: 99 },
  ];

  async function showCombos() {
    clear();
    await loadPuzzles();
    if (!wrap.isConnected) return;
    const all = combos();
    const seen = attemptedMap();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `<h1>🧠 中局组合</h1>
      <div class="sub">要连走好几步、每一步都逼着对方走的得子和杀棋</div>
      <div class="xq-advice"><b>怎么练</b>
        <p>每一题都要<b>走到便宜真正拿到手</b>（子吃到手、对方吃不回来，或者将死）才算对，中间每一步都判。
        题目是从对局里找出来的：那一刻只有这一路能赢，别的走法都放跑了机会。</p>
        <p>先按步数从短到长练，再按主题专项练——认熟了主题，实战里看一眼就知道"这里有没有组合"。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    const sec = (t: string) => {
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.textContent = t;
      list.appendChild(h);
    };
    const card = (title: string, desc: string, items: Puzzle[], key: string) => {
      if (!items.length) return;
      const done = items.filter((p) => p.id in seen).length;
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.dataset.combo = key;
      el.innerHTML = `<div class="title">${title}<span class="tag">${items.length} 题</span>${
        done ? `<span class="tag warn">做过 ${done}</span>` : ''
      }</div><div class="desc">${desc}</div>`;
      el.onclick = () => runComboSession(items, title);
      list.appendChild(el);
    };
    sec('按步数');
    for (const t of COMBO_TIERS) card(t.name, `要连走 ${t.name}才拿到便宜`, all.filter((p) => (p.steps ?? 0) >= t.min && (p.steps ?? 0) <= t.max), `steps-${t.min}`);
    sec('按主题');
    for (const th of COMBO_THEMES) card(th.id, th.why, all.filter((p) => p.themes?.includes(th.id)), `theme-${th.id}`);
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  /** 一组 10 道：没做过的先出，难度贴近你的战术分 */
  function runComboSession(items: Puzzle[], title: string, count = 10, onDone: () => void = () => void showCombos(), leave?: () => void) {
    const seen = attemptedMap();
    const r = getRatings().tactic.r;
    const order = [...items].sort((a, b) => {
      const fa = a.id in seen ? 1 : 0;
      const fb = b.id in seen ? 1 : 0;
      return fa - fb || Math.abs(a.rating - r) - Math.abs(b.rating - r);
    });
    const pick = order.slice(0, count);
    let i = 0;
    let right = 0;
    const step = () => {
      if (i >= pick.length) return finishSession(`中局组合 · ${title}`, right, pick.length, onDone, '', leave);
      const p = pick[i++];
      runOne(p, 'tactic', `${title} ${i}/${pick.length} · ${(p.themes ?? []).join('、')}`, (ok) => {
        if (ok) right++;
        step();
      });
    };
    step();
  }

  // ---------------- 每日一题 ----------------
  /** 每天固定一道（按日期挑，谁打开都是同一道），单日中局组合、双日绝地反杀 */
  const DAILY_KEY = 'xq-daily';
  function dailyDone(): boolean {
    try {
      return (JSON.parse(localStorage.getItem(DAILY_KEY) ?? '{}') as Record<string, boolean>)[String(todayNum())] === true;
    } catch {
      return false;
    }
  }
  function markDaily() {
    try {
      const d = JSON.parse(localStorage.getItem(DAILY_KEY) ?? '{}') as Record<string, boolean>;
      d[String(todayNum())] = true;
      // 只留最近一个月，存档不会越攒越大
      for (const k of Object.keys(d)) if (Number(k) < todayNum() - 31) delete d[k];
      localStorage.setItem(DAILY_KEY, JSON.stringify(d));
    } catch {
      /* 存不下就算了 */
    }
  }
  async function startDaily() {
    const day = todayNum();
    const back = () => {
      markDaily();
      checkIn();
      menuBack();
    };
    if (day % 2 === 0) {
      await loadCounterKill();
      if (!wrap.isConnected) return;
      // 前三章里挑：每日一题不该一上来就是七步杀
      const pool = COUNTERKILL.filter((x) => x.chapter <= 3);
      const it = pool[(day * 7919) % Math.max(1, pool.length)];
      if (it) return runCounterKill(it, back);
    }
    await loadPuzzles();
    if (!wrap.isConnected) return;
    const pool = combos();
    const p = pool[(day * 7919) % Math.max(1, pool.length)];
    if (!p) return menuBack();
    runOne(p, 'tactic', `每日一题 · ${(p.themes ?? []).join('、')}`, () => back());
  }

  // ---------------- 绝地反杀：黑方下一步就杀你，只有连将反杀 ----------------
  /**
   * 用户原话："不要出那些优势非常明显、纯粹去算最优步数的必胜局……要那种形势很危急的：
   * 我是红棋，对方是黑棋且下一步就能绝杀我，而我必须通过连续将军或者连环杀法，最后绝地反杀。"
   *
   * 闯关的结构照着天天象棋的残局闯关：分章、每章若干关、最后一关是关底，过一半才开下一章；
   * 星级：第一次不看提示做对 ★★★，重做做对 ★★，用了提示做对 ★。
   */
  const CK_KEY = 'xq-counterkill';
  const CK_CHAPTERS = [
    { n: 1, name: '背水一战', desc: '三步杀：每一步都要将军，让他只能应将，一步也腾不出手来杀你。' },
    { n: 2, name: '绝处逢生', desc: '四步杀：车马炮轮着上，一个子将完下一个子接着将，将的节奏不能断。' },
    { n: 3, name: '反戈一击', desc: '五步杀：常常要先弃一个子——送掉一个车马，把他的士象引开，后面的将军才连得起来。' },
    { n: 4, name: '力挽狂澜', desc: '六、七步杀：要算到底。中间可能有一步不将军——那一步必须同时挡住他的杀，又让他下一步只能应你。' },
    { n: 5, name: '起死回生', desc: '八、九步杀：引擎都要算十几层才看得见。先想清楚最后用什么杀法收尾，再倒着找怎么把他的将赶过去。' },
    { n: 6, name: '逆转乾坤', desc: '十步以上的长杀：几乎每一步都只有唯一解，走偏一步，他就杀你。' },
  ];
  const CN = '一二三四五六七八九';
  function ckStars(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(CK_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }
  function setCkStars(id: string, n: number) {
    const s = ckStars();
    if ((s[id] ?? 0) >= n) return;
    s[id] = n;
    try {
      localStorage.setItem(CK_KEY, JSON.stringify(s));
    } catch {
      /* 存不下就算了 */
    }
  }
  const ckChapter = (n: number) => COUNTERKILL.filter((x) => x.chapter === n);
  /** 上一章过一半（最多要求 6 关）才开下一章：闯关要一关一关闯 */
  function ckUnlocked(n: number): boolean {
    if (n <= 1) return true;
    const prev = ckChapter(n - 1);
    const st = ckStars();
    return prev.filter((x) => (st[x.id] ?? 0) > 0).length >= Math.min(6, Math.ceil(prev.length / 2));
  }
  const ckName = (n: number) => CK_CHAPTERS.find((c) => c.n === n)?.name ?? `第 ${n} 章`;

  async function showCounterKill() {
    clear();
    await loadCounterKill();
    if (!wrap.isConnected) return;
    const st = ckStars();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `<h1>🔥 绝地反杀</h1>
      <div class="sub">黑方下一步就能杀你，你的子还不如他多——只有连续将军，抢在他前面杀死他</div>
      <div class="xq-advice"><b>怎么闯</b>
        <p>每一关都是<b>红先</b>，黑方已经有一步杀棋等着你。你的每一步都得将军（个别关中间有一步不将军，但下一步就杀，他来不及），
        <b>走一步闲着，他马上杀你</b>。走错了会演给你看他怎么杀。</p>
        <p>每一关都让皮卡鱼核对过：红方只有这一路能活，第二好的走法就是被杀。第一次不用提示做对 ★★★，重做做对 ★★，用了提示 ★。
        上一章过一半，下一章才开。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const c of CK_CHAPTERS) {
      const items = ckChapter(c.n);
      if (!items.length) continue;
      const done = items.filter((x) => (st[x.id] ?? 0) > 0).length;
      const stars = items.reduce((a, x) => a + (st[x.id] ?? 0), 0);
      const open = ckUnlocked(c.n);
      const el = document.createElement('div');
      el.className = `card home-card${open ? '' : ' locked'}`;
      el.dataset.ckChapter = String(c.n);
      el.innerHTML = `<div class="title">第${CN[c.n - 1]}章 · ${c.name}<span class="tag">${items.length} 关</span>${
        open ? (done ? `<span class="tag warn">已过 ${done} · ${stars}★</span>` : '') : '<span class="tag">🔒 上一章过一半解锁</span>'
      }</div><div class="desc">${c.desc}</div>`;
      if (open) el.onclick = () => showCkChapter(c.n);
      list.appendChild(el);
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  /** 一章的关卡格子：1、2、3……最后一关是关底 */
  function showCkChapter(n: number) {
    clear();
    const st = ckStars();
    const items = ckChapter(n);
    const c = CK_CHAPTERS.find((x) => x.n === n)!;
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `<h1>第${CN[n - 1]}章 · ${c.name}</h1><div class="sub">${c.desc}</div>`;
    const grid = document.createElement('div');
    grid.className = 'xq-ck-grid';
    items.forEach((it, k) => {
      const b = document.createElement('button');
      const boss = k === items.length - 1;
      const sn = st[it.id] ?? 0;
      b.className = `xq-ck-level${sn ? ' done' : ''}${boss ? ' boss' : ''}`;
      b.dataset.ck = it.id;
      b.innerHTML = `<b>${boss ? '👑' : k + 1}</b><i>${sn ? '★'.repeat(sn) + '☆'.repeat(3 - sn) : `${it.mateIn} 步`}</i>`;
      b.title = `红 ${it.red} vs 黑 ${it.black} · ${it.mateIn} 步${it.allChecks ? '连将杀' : '连杀'}`;
      b.onclick = () => runCounterKill(it);
      grid.appendChild(b);
    });
    scr.appendChild(grid);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => void showCounterKill();
    scr.appendChild(back);
    mount(scr);
  }

  /** 每日训练里的"闯一关"：已开的章里，按顺序第一道还没过的 */
  function nextCounterKill(): CounterKill | null {
    const st = ckStars();
    for (const c of CK_CHAPTERS) {
      if (!ckUnlocked(c.n)) break;
      const todo = ckChapter(c.n).find((x) => !st[x.id]);
      if (todo) return todo;
    }
    return COUNTERKILL.find((x) => (st[x.id] ?? 0) < 3 && ckUnlocked(x.chapter)) ?? null;
  }

  function runCounterKill(it: CounterKill, exit?: () => void) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const items = ckChapter(it.chapter);
    const k = items.findIndex((x) => x.id === it.id);
    const boss = k === items.length - 1;
    const puzzle: Puzzle = {
      id: it.id,
      kind: 'mate',
      goal: 'mate',
      fen: it.fen,
      answer: it.line[0],
      line: it.line,
      mateIn: it.mateIn,
      rating: it.rating,
      threat: it.threat,
      prompt: `红先 ${it.mateIn} 步${it.allChecks ? '连将' : ''}杀`,
    };
    const back = exit ?? (() => showCkChapter(it.chapter));
    disposeScreen = runPuzzle(host, puzzle, {
      caption: `第${CN[it.chapter - 1]}章 ${ckName(it.chapter)} · ${boss ? '关底' : `第 ${k + 1} 关`}`,
      onExit: back,
      onDone: (r) => {
        const first = firstAttempt(it.id);
        const stars = r.correct ? (r.usedHint ? 1 : first ? 3 : 2) : 0;
        if (stars) setCkStars(it.id, stars);
        // 只有第一次计分：算进"杀法"这一维
        if (first) updateRating('mate', it.rating, r.correct && !r.usedHint);
        checkIn();
        finishTask();
        back();
      },
    });
  }

  // ---------------- 邪门布局破解 ----------------
  const TRICKS_KEY = 'xq-tricks-done';
  /** 已经亲手破过的套路（"你来破解"全对） */
  function tricksDone(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(TRICKS_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }
  function markTrickDone(id: string) {
    const s = tricksDone();
    s.add(id);
    try {
      localStorage.setItem(TRICKS_KEY, JSON.stringify([...s]));
    } catch {
      /* 存不下就算了 */
    }
  }

  /** 破解到底过关的套路（和皮卡鱼下到将死或胜势已定） */
  const TRICKS_FULL_KEY = 'xq-tricks-full';
  function tricksFull(): Set<string> {
    try {
      return new Set(JSON.parse(localStorage.getItem(TRICKS_FULL_KEY) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  }
  function markTrickFull(id: string) {
    const s = tricksFull();
    s.add(id);
    try {
      localStorage.setItem(TRICKS_FULL_KEY, JSON.stringify([...s]));
    } catch {
      /* 存不下就算了 */
    }
  }

  /** 破解到底：胜势要到这么多（车≈1000）引擎才认"赢定了" */
  const TRICK_WIN_AT = 800;

  /**
   * 破解到底：破解那几手走完之后，和皮卡鱼接着下——它执走邪门的一方，全力抵抗。
   * 下到将死，或者引擎连续几步确认胜势已定（约多一个大子），才算"完全破解"。
   * 用户原话："江湖布局这些都是只有一步……需要做到将死才行，或者完全破解才行"。
   */
  function runTrickFull(t: TrickOpening) {
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const w = walkMoves([...t.pre, t.trick.t, ...t.refute.map((x) => x.t)]);
    if (!w) return;
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    disposeScreen = runPlayout(host, {
      fen: toFen(w.board, w.color),
      you: me,
      target: 'win',
      winAt: TRICK_WIN_AT,
      goal: '🎯 把优势兑现：<b>将死</b>对方，或者走到引擎确认<b>胜势已定</b>',
      title: `破解到底 · ${t.name}`,
      subtitle: `破解的 ${Math.ceil(t.refute.length / 2)} 手已经摆好，对手换成皮卡鱼全力抵抗`,
      tips: [t.principle, '领先之后先把子力出齐、把将护好，再去抢攻；别急着换子，也别贪吃对方送的子。'],
      onRestart: () => runTrickFull(t),
      onDone: (r, _n, st) => {
        if (r === 'win' && !st.hints && !st.undos) markTrickFull(t.id);
      },
      onExit: () => showTrick(t),
    });
  }

  const sideWord = (c: Color) => (c === 'r' ? '红' : '黑');

  function showTricks() {
    clear();
    const done = tricksDone();
    const full = tricksFull();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>🗡 江湖布局破解</h1>
      <div class="sub">江湖套路本身都是亏的，专门赌你应错</div>
      <div class="xq-advice"><b>江湖套路的精髓：宁失一子，不失一先</b>
        <p>弃马十三着、铁滑车、敢死炮、瞎眼狗……这些套路都是先送你一点东西（一匹马、一门炮、一个卒，或者一条中路），
        换几步先手。所以破解它们要算两本账：<b>子力</b>谁多谁少，<b>先手</b>值多少。每一条都画了账本——
        你吃到子那一刻他少了多少子力、引擎却判他落后多少（甚至领先），中间差的就是先手的价钱。</p>
        <p>① <b>先问他要换什么</b>：弃马十三着换的是"中炮打中卒将军"，先补士把这一手废掉，马不吃也赢了先手。<br>
        ② <b>送的子多半该吃，坑在吃完以后</b>：铁滑车、敢死炮吃了以后他追着捉——别不管它，也别恋子，该还就还。<br>
        ③ <b>一条线看到底</b>：叠炮、龟背炮、瞎眼狗的坑都在一条直线上——谁是炮架、谁在后面，看清了再动。<br>
        ④ <b>门板别乱开</b>：中路只剩一个中卒挡着的时候，急进中兵就在等你顶卒。</p>
        <p class="dim">每一条都由皮卡鱼深算复核（每个局面 10 秒、约 18 层）：邪门着本身亏多少、破解是不是最好、上当亏多少、
        还有哪些常见错着；坑是用"浅算看着好、深算亏一个半兵以上"找出来的。同一个名号各地走法不一，这里收的是有出处、引擎复核过的那一种。</p>
        <p><b>破解几手不算完</b>：每一条都可以 🏁 破解到底——破解摆好之后和皮卡鱼接着下，
        下到将死、或者引擎确认胜势已定，才算"完全破解"。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const side of ['r', 'b'] as const) {
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.textContent = side === 'r' ? '对方执红走邪门（你执黑破解）' : '对方执黑走邪门（你执红破解）';
      list.appendChild(h);
      for (const t of TRICKS.filter((x) => x.by === side)) {
        const el = document.createElement('div');
        el.className = 'card home-card';
        el.dataset.trick = t.id;
        el.innerHTML = `<div class="title">${t.name}<span class="tag">${t.level}</span>${
          t.trapAfter ? '<span class="tag">两关</span>' : ''
        }${full.has(t.id) ? '<span class="tag warn">完全破解</span>' : done.has(t.id) ? '<span class="tag warn">已破</span>' : ''}</div><div class="desc">${t.lure}</div>`;
        el.onclick = () => showTrick(t);
        list.appendChild(el);
      }
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  /** 几个兵（一位小数），给账本用 */
  const bing = (v: number) => `${(Math.abs(v) / 100).toFixed(1)} 个兵`;
  /** 第几手（从 0 起）→ 第几回合 */
  const roundOf = (ply: number) => Math.floor(ply / 2) + 1;

  /**
   * 账本："宁失一子，不失一先"画出来。
   * 上当那条线上，设套方的子力差（虚线）和引擎局面分（红线），再加破解那条线的局面分（绿线）——
   * 子力掉下去、红线没跟着掉，中间那一截就是他用子换来的先手。
   */
  function ledgerHtml(t: TrickOpening): string {
    const tr = ledger(t, 'trap');
    const rf = ledger(t, 'refute');
    if (!tr.score.length) return '';
    const n = Math.max(tr.score.length, rf.score.length, 2);
    const W = 340;
    const H = 168;
    const L = 30;
    const R = 8;
    const T = 10;
    const B = 20;
    const CAP = 1200;
    const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
    const y = (v: number) => T + ((CAP - Math.max(-CAP, Math.min(CAP, v))) / (2 * CAP)) * (H - T - B);
    const path = (a: number[]) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(' ');
    const grid = [1000, 500, 0, -500, -1000]
      .map(
        (v) =>
          `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" class="${v ? 'g' : 'z'}"/><text x="${L - 4}" y="${y(v) + 3}" text-anchor="end">${v > 0 ? '+' : ''}${v / 100}</text>`,
      )
      .join('');
    const fork = lineToTrap(t).length;
    const sac = sacrificeAt(t);
    // 子力差画在"吃到他送的子"的那条线上：多数是上当那条线；敢死炮这种"不吃就被他先吃"的，是破解那条线
    const onRefute = sac?.line === 'refute';
    const mat = (onRefute ? rf : tr).material;
    const svg = `<svg class="xq-ledger" viewBox="0 0 ${W} ${H}" role="img" aria-label="账本：子力和局面分">
      ${grid}
      <line x1="${x(fork)}" x2="${x(fork)}" y1="${T}" y2="${H - B}" class="fork"/>
      <text x="${x(fork) + 3}" y="${T + 9}" class="lbl">分岔</text>
      <path d="${path(rf.score)}" class="rf"/>
      <path d="${path(mat)}" class="mat"/>
      <path d="${path(tr.score)}" class="ev"/>
      ${sac ? `<circle cx="${x(sac.ply)}" cy="${y(sac.material)}" r="3.5" class="mat-dot"/><circle cx="${x(sac.ply)}" cy="${y(sac.score)}" r="3.5" class="${onRefute ? 'rf-dot' : 'ev-dot'}"/>` : ''}
      <text x="${L}" y="${H - 5}" class="lbl">开局</text><text x="${W - R}" y="${H - 5}" text-anchor="end" class="lbl">第 ${n} 手</text>
    </svg>`;
    const who = (v: number) =>
      v >= 20000 ? '他把你将死' : v <= -20000 ? '你把他将死' : Math.abs(v) < 60 ? '两边差不多' : v > 0 ? `他领先 ${bing(v)}` : `他落后 ${bing(v)}`;
    const lastTr = tr.score[tr.score.length - 1];
    const lastRf = rf.score[rf.score.length - 1];
    const gain = sac ? sac.score - sac.material : 0;
    const sacText = !sac
      ? `这一套他一个子都没少：他送的是一条线、一个兵，换的是你的阵形。`
      : sac.line === 'trap' && sac.score >= 300
        ? `走到第 ${roundOf(sac.ply)} 回合，你吃下他送的东西：他的子力<b>少了 ${bing(sac.material)}</b>，引擎却判${who(sac.score)}——
           送的子是饵，你吃下去就站进了他的圈套。`
        : gain >= 50
        ? `走到第 ${roundOf(sac.ply)} 回合，你把他送的子吃到手：他的子力<b>少了 ${bing(sac.material)}</b>，引擎却判${who(sac.score)}——
           子力和局面分之间差的这 <b>${bing(gain)}</b>，就是他用子换来的先手。`
        : `走到第 ${roundOf(sac.ply)} 回合，你把他送的子吃到手：他的子力<b>少了 ${bing(sac.material)}</b>，引擎判${who(sac.score)}——
           送出去的子<b>没换来先手</b>，这一套本身不成立，全靠你后面应错。`;
    return `<div class="xq-advice xq-ledger-box" data-ledger data-keep>
        <b>📒 这套棋的账：宁失一子，不失一先</b>
        <p>${t.essence}</p>
        ${svg}
        <p class="xq-ledger-legend"><span class="ev">━ 上当这条线：他的局面分</span><span class="rf">━ 按破解走：他的局面分</span><span class="mat">┅ ${onRefute ? '按破解走' : '上当这条线'}：他的子力差</span>（单位：兵，都换成设套一方的视角）</p>
        <p>${sacText}上当这条线走到最后，${who(lastTr)}；按破解走，${who(lastRf)}。</p>
      </div>`;
  }

  /** 坑在哪几步：上当那条线上深算标出来的错着 + 其它常见错着 */
  function pitfallHtml(t: TrickOpening): string {
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const ps = pitfalls(t);
    const items = ps.map(
      (p) =>
        `<li>第 ${roundOf(p.ply)} 回合${sideWord(me)}走 <b>${p.played}</b>：该走 <b>${p.best}</b>，这一手差约${inPieces(p.loss)}${p.loss >= 2500 ? '（直接输棋）' : ''}</li>`,
    );
    const wr = (t.wrong ?? []).map(
      (w) =>
        `<li>${w.at ? `${t.refute.slice(0, w.at).map((s) => s.t).join(' ')} 之后` : `他刚走完 ${t.trick.t}`}，走 <b>${w.t}</b>：${w.why}<span class="dim">（比 ${t.refute[w.at].t} 差约${inPieces(w.loss)}）</span></li>`,
    );
    if (!items.length && !wr.length) return '';
    return `${items.length ? `<p><b>⚠️ 坑在哪几步</b>（皮卡鱼深算，被骗一方的错着）：</p><ol class="xq-trick-steps" data-pitfalls>${items.join('')}</ol>` : ''}${
      wr.length ? `<p><b>其它常见的错着</b>：</p><ul class="xq-trick-steps" data-wrong>${wr.join('')}</ul>` : ''
    }`;
  }

  function showTrick(t: TrickOpening) {
    clear();
    // 变化和新讲解按需加载：到了以后，还停在这一屏就重画（变化列出来）
    const nVars = trickVars(t.id).length;
    void loadTrickExtras().then(() => {
      if (trickVars(t.id).length !== nVars && wrap.querySelector(`[data-trick-page="${t.id}"]`)) showTrick(t);
    });
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const v = t.verified;
    const k = t.trapAfter ?? 0;
    const line = [...t.pre, t.trick.t].join(' ');
    const preMiss = new Map(pitfalls(t).filter((p) => p.ply < t.pre.length).map((p) => [p.ply, p]));
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.dataset.trickPage = t.id;
    scr.innerHTML = `<h1>${t.name}</h1>
      <div class="sub">${t.alias ? `又叫${t.alias} · ` : ''}对方执${sideWord(t.by)} · 你执${sideWord(me)}破解 · ${t.level}</div>
      <div class="xq-advice" data-keep>
        <b>套路：它在赌什么</b><p>${t.lure}</p>
      </div>
      ${ledgerHtml(t)}
      <div class="xq-advice">
        <b>这套是怎么走出来的（每一手的意思）</b>
        <ol class="xq-trick-steps">${[...t.pre.map((m, i) => ({ t: m, why: t.preWhy[i] })), { t: t.trick.t, why: `<b>邪门着。</b>${t.trick.why}` }]
          .map((m, i) => {
            const pm = preMiss.get(i);
            return `<li><b>${i % 2 === 0 ? '红' : '黑'} ${m.t}</b>　${m.why}${pm ? `<span class="dim">（引擎：该走 ${pm.best}，这一手差约${inPieces(pm.loss)}）</span>` : ''}</li>`;
          })
          .join('')}</ol>
        <p class="dim">着法：${line}</p>
      </div>
      <div class="xq-advice xq-trick-anatomy" data-keep data-anatomy>
        <b>🔍 陷阱拆解</b>
        <p><b>表面上：</b>${t.anatomy.looks}</p>
        <p><b>陷阱在哪：</b>${t.anatomy.bait}</p>
        <p><b>上当之后：</b>${t.anatomy.punish}<span class="dim">（引擎算：比破解差约${inPieces(v.trapLoss)}）</span></p>
        <p><b>怎么认出来：</b>${t.anatomy.spot}</p>
        ${pitfallHtml(t)}
      </div>
      <div class="xq-advice" data-keep>
        <b>怎么破</b><p><b>${t.refute[0].t}</b>——${t.refute[0].why}</p>
        ${
          k
            ? `<b>第二关</b><p>对方 <b>${t.refute[k - 1].t}</b>（${t.refute[k - 1].why}）这时走 <b>${t.refute[k].t}</b>——${t.refute[k].why}</p>`
            : ''
        }
        <b>破了之后他会怎么走</b><p>${t.anatomy.after}</p>
        <b>要记住的道理</b><p>${t.principle}</p>
        <p class="dim">引擎复核（深算，每个局面约 18 层）：这一步邪门棋本身就亏约${inPieces(v.trickLoss)}；按破解走，局面是「${outlookOf(v.refuteScore)}」；
        ${k ? `第二关要是走 ${t.trap[0].t}（${t.trap[0].why.replace(/。$/, '')}）` : `上当的话（${t.trap[0].t}）`}，比破解差约${inPieces(v.trapLoss)}。</p>
      </div>`;
    const mk = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'btn';
      b.textContent = label;
      b.onclick = fn;
      scr.appendChild(b);
      return b;
    };
    mk('📖 看套路和破解', () => runTrick(t, 'refute')).dataset.act = 'trick-show';
    mk('⚠️ 看上当会怎样', () => runTrick(t, 'trap')).dataset.act = 'trick-trap';
    mk(`🎯 你来破解（你执${sideWord(me)}）`, () => runTrick(t, 'guess')).dataset.act = 'trick-guess';
    mk(`🏁 破解到底：和皮卡鱼下到胜势${tricksFull().has(t.id) ? '（已完全破解）' : ''}`, () => runTrickFull(t)).dataset.act = 'trick-full';
    if (startFrom) {
      mk('⚔️ 从这里实战', () => {
        const w = walkMoves([...t.pre, t.trick.t]);
        if (w) startFrom(w.moves, me);
      }).dataset.act = 'trick-play';
    }
    mk('📚 在开局浏览器里看这一套的所有分支', () => showExplorer([...t.pre, t.trick.t], () => showTrick(t))).dataset.act = 'trick-explorer';
    // 江湖布局的变化：他不按套路走、另一种破法、你走错了
    const vars = trickVars(t.id);
    const seen = seenLines();
    const seenOf = (k: number) => seen.has(`trick:${t.id}:${vars[k].name}`);
    const devs = vars.map((v, k) => (v.kind === 'dev' && v.moves.length >= 3 ? k : -1)).filter((k) => k >= 0);
    if (devs.length) {
      mk('🎲 抽一条：他不按套路走，你怎么接', () => runTrickVar(t, pickOne(devs, seenOf)!, true)).dataset.act = 'trick-drill';
    }
    const groups: [TrickVarKind, string, string][] = [
      ['dev', '他不按套路走', '江湖套路走法多变：他换一手，你认不认得、怎么接'],
      ['alt', '另一种破法', '和正解差不多一样好的应法，练习时走这些也算对'],
      ['wrong', '你走错了', '看着自然、其实亏的应法，看他怎么罚'],
    ];
    for (const [kind, title, sub] of groups) {
      const ks = vars.map((v, k) => (v.kind === kind ? k : -1)).filter((k) => k >= 0);
      if (!ks.length) continue;
      const nSeen = ks.filter(seenOf).length;
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.innerHTML = `${title}（${ks.length}${nSeen ? `，看过 ${nSeen}` : ''}）<span class="dim">　${sub}</span>`;
      scr.appendChild(h);
      for (const k of ks) {
        const v = vars[k];
        const row = document.createElement('div');
        row.className = 'card home-card';
        row.dataset.trickVar = String(k);
        row.innerHTML = `<div class="title">${v.name}${kind === 'wrong' ? '<span class="tag warn">错着</span>' : kind === 'alt' ? '<span class="tag ok">也能破</span>' : '<span class="tag">他改走</span>'}${
          seenOf(k) ? '<span class="tag ok">✓ 看过</span>' : ''
        }</div><div class="desc">${v.note ? `${v.note}<br>` : ''}再走 ${Math.ceil(v.moves.length / 2)} 回合 · ${v.final}</div>`;
        row.onclick = () => runTrickVar(t, k);
        scr.appendChild(row);
      }
    }
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showTricks;
    scr.appendChild(back);
    mount(scr);
  }

  function runTrick(t: TrickOpening, mode: 'refute' | 'trap' | 'guess', exit?: () => void) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const pre = t.pre.map((x, i) => ({ t: x, why: t.preWhy[i] ?? '' }));
    const trick = { t: t.trick.t, why: `<b>邪门着。</b>${t.trick.why}` };
    // 陷阱在第二关的：先按破解走到分岔处，再接上当的那几手
    const tail = mode === 'trap' ? [...t.refute.slice(0, t.trapAfter ?? 0), ...trapLine(t)] : refuteLine(t);
    // 上当那条线上，深算标出来的错着当场点出来：坑在哪一步、该走什么
    const miss = new Map(mode === 'trap' ? pitfalls(t).map((p) => [p.ply, p]) : []);
    // 教练讲解：邪门着之后，局面变化最大的那一手标"关键一手"（已经标了"坑"的不重复标），收尾一段教练小结。
    // 邪门着本身亏多少课里已经讲了，从它后面一手算起
    const base = [...pre, trick, ...tail];
    const evs = lineEvs(t, mode === 'trap' ? 'trap' : 'refute');
    const from = pre.length + 1;
    const nEv = Math.max(0, Math.min(base.length, evs.length) - from);
    const evBefore = from > 0 ? (evs[from - 1] ?? 0) : 0;
    const seg = base.slice(from, from + nEv).map((m, j) => ({ t: m.t, why: m.why, ev: evs[from + j] }));
    const victim: Color = t.by === 'r' ? 'b' : 'r';
    const km = nEv ? keyMove(seg, evBefore, victim) : null;
    const keyPly = km && !miss.has(from + km.i) ? from + km.i : -1;
    const summary = nEv ? lineSummary({ kind: mode === 'trap' ? 'fall' : 'refute', moves: seg, evBefore, firstMover: victim, ply0: from }) : '';
    // 你来破解：走到谱上收着的另一种破法直接算对，走到"你走错了"那几手当场点名、说出他怎么罚
    const knownBy = new Map<number, { t: string; ok: boolean; note: string }[]>();
    if (mode === 'guess') {
      for (const v of trickVars(t.id)) {
        if (v.kind === 'dev') continue;
        const at = pre.length + 1 + v.at;
        const punish = v.moves[1];
        const item =
          v.kind === 'alt'
            ? { t: v.moves[0].t, ok: true, note: `另一种破法，课里"变化"一组有这一路` }
            : {
                t: v.moves[0].t,
                ok: false,
                note: `这是常见的错着——${v.note ? v.note.replace(/。$/, '') : '看着自然，其实亏'}${punish ? `：他接着走 <b>${punish.t}</b>（${keyNote(punish.why.replace(/<[^>]+>/g, '').split('。')[0])}）` : ''}`,
              };
        knownBy.set(at, [...(knownBy.get(at) ?? []), item]);
      }
    }
    const moves = base.map((m, i) => {
      const p = miss.get(i);
      const why = p
        ? `⚠️ <b>坑：</b>这里该走 <b>${p.best}</b>（这一手差约${inPieces(p.loss)}）。${m.why}`
        : i === keyPly && km
          ? `${keyTag(km, i % 2 === 0 ? 'r' : 'b')}${m.why}`
          : m.why;
      return { ...m, why, known: knownBy.get(i) };
    });
    disposeScreen = runReplay(host, {
      title: t.name,
      subtitle:
        mode === 'trap' ? '上当会怎样：最常见的错误应法' : mode === 'guess' ? `你来破解：你执${sideWord(me)}，先走再对答案` : '套路和破解，每一手都讲在干什么',
      intro:
        mode === 'trap'
          ? `${t.lure}<br><br>下面是<b>上当</b>的走法——${
              t.trapAfter ? `前面 ${t.trapAfter / 2} 手是对的（子吃到手了），坑在后面，` : ''
            }看清楚它为什么亏，下次一眼认出来。`
          : mode === 'guess'
            ? `套路已经摆好：对方刚走了 <b>${t.trick.t}</b>。${t.trick.why}<br><br>该你了：怎么破？`
            : t.lure,
      moves,
      guessFor: mode === 'guess' ? me : undefined,
      startAt: mode === 'guess' ? pre.length + 1 : undefined,
      judge: mode === 'guess' ? (b, c, mine, exp) => judgeAgainst(b, c, mine, exp) : undefined,
      notes: [t.principle],
      outro: summary,
      onFinish: (right, tried) => {
        if (mode === 'guess' && tried && right === tried) markTrickDone(t.id);
      },
      // 破解那几手走完不算完：接着和皮卡鱼下到胜势
      next: mode === 'trap' || exit ? undefined : { label: '🏁 接着破解到底', run: () => runTrickFull(t) },
      onExit: exit ?? (() => showTrick(t)),
    });
  }

  /**
   * 江湖布局的一条变化：前面照破解谱摆好，从分岔那一手起每一手讲意义，收尾一段教练小结。
   * drill：抽查——他改走的那一手摆出来，你执破解方接着走。
   */
  function runTrickVar(t: TrickOpening, k: number, drill = false, exit?: () => void) {
    const v = trickVars(t.id)[k];
    if (!v) return showTrick(t);
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const R = refuteLine(t);
    const prefix = [
      ...t.pre.map((x, i) => ({ t: x, why: t.preWhy[i] ?? '' })),
      { t: t.trick.t, why: `<b>邪门着。</b>${t.trick.why}` },
      ...R.slice(0, v.at).map((x) => ({ t: x.t, why: x.why })),
    ];
    const ply0 = prefix.length;
    const evs = lineEvs(t, 'refute');
    const evBefore = evs[ply0 - 1] ?? 0;
    const firstMover: Color = ply0 % 2 === 0 ? 'r' : 'b';
    const summary = lineSummary({ kind: v.kind, moves: v.moves, evBefore, firstMover, ply0, mainMove: R[v.at]?.t });
    const round = Math.floor(ply0 / 2) + 1;
    const first = v.moves[0];
    const what = first.why.replace(/<[^>]+>/g, '').split('。')[0];
    const intro = drill
      ? `抽查：前面照破解谱摆好，第 ${round} 回合他没按套路走，改走了 <b>${first.t}</b>（${what}）。你执${sideWord(me)}，怎么接？走了谱外的着法，皮卡鱼判是不是一样好。`
      : v.kind === 'dev'
        ? `他不按套路走：前面照破解谱摆好，第 ${round} 回合他改走 <b>${first.t}</b>（${what}），原来谱上是 ${R[v.at]?.t ?? ''}。认不认得出、怎么接——每一手都讲它的意义，局面变化最大的那一手标着 ⭐。`
        : v.kind === 'alt'
          ? `另一种破法：第 ${round} 回合走 <b>${first.t}</b>（${what}），谱上是 ${R[v.at]?.t ?? ''}，引擎认为差不多一样好。看这一路怎么走下去。`
          : `你走错了：第 ${round} 回合走 <b>${first.t}</b>——看着自然，其实亏。${v.note ?? ''}看他怎么罚，正解是 ${R[v.at]?.t ?? ''}。`;
    disposeScreen = runReplay(host, {
      title: `${t.name} · ${v.name}`,
      subtitle: drill ? `抽查：你执${sideWord(me)}，先走再对答案` : '江湖布局的变化，每一手都讲在干什么',
      intro,
      moves: [...prefix, ...withKey(v.moves, evBefore, firstMover)],
      guessFor: drill ? me : undefined,
      startAt: drill ? ply0 + 1 : ply0,
      judge: drill ? (b, c, mine, exp) => judgeAgainst(b, c, mine, exp) : undefined,
      outro: `<b>${v.final}</b>（皮卡鱼评估）。${summary}`,
      notes: [t.principle],
      onFinish: () => markSeen(`trick:${t.id}:${v.name}`),
      onExit: exit ?? (() => showTrick(t)),
    });
  }

  // ---------------- 私教 ----------------
  /** 私教排课要的数据：实战存档、测评、上过的课、错题本里实战来的题 */
  function tutorInput() {
    const ownByDim: Partial<Record<Dim, number>> = {};
    for (const p of getOwnPuzzles()) {
      const d = p.kind as Dim;
      ownByDim[d] = (ownByDim[d] ?? 0) + 1;
    }
    return { games: listGames(), assessed: isAssessed(), ratings: getRatings(), log: getLessonLog(), ownByDim };
  }

  /**
   * 私教：一节课只讲一件事。
   * 开口之前先摆证据（最近实战里哪种毛病多少次），上一节课先检查作业，
   * 然后三条要点 → 你自己走错的局面 → 同类题 → 带练一盘。课怎么排在 tutor.ts。
   */
  function showTutor() {
    clear();
    const inp = tutorInput();
    const lesson = planLesson(inp);
    const log = inp.log;
    const cur = log[log.length - 1];
    const inProgress = !!cur && cur.done.length < cur.steps && cur.theme === lesson.theme;
    const done = new Set(inProgress ? cur.done : []);
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report xq-tutor';
    // 上一节课的作业检查
    const prev = [...log].reverse().find((r) => r.done.length >= r.steps && r.theme !== 'intro');
    let prevHtml = '';
    if (prev) {
      const c = checkLesson(prev, inp.games);
      const name = themeName(prev.theme);
      prevHtml =
        prev.theme === 'endgame' || prev.theme === 'opening'
          ? `<p>上节课（${prev.d}）补的是「${name}」。</p>`
          : c
            ? `<p>上节课（${prev.d}）练「${name}」：上课前每盘 <b>${prev.before ?? 0}</b> 次，之后 ${c.n} 盘每盘 <b>${c.after}</b> 次——${
                c.passed ? '<b>少了，过关</b> ✓' : '没怎么少，今天换个角度再练'
              }。</p>`
            : `<p>上节课（${prev.d}）练「${name}」：作业是下 ${CHECK_GAMES} 盘实战、下完看复盘，现在还不够，下次再检查。</p>`;
    }
    const habits = habitCounts(inp.games).slice(0, 5);
    const reviewed = inp.games.filter((g) => g.review).slice(0, 8);
    const evidence = habits.length
      ? `<table class="xq-tutor-habits"><tr><th>毛病</th><th>次数</th><th>每盘</th></tr>${habits
          .map((h) => `<tr><td>${themeName(h.tag)}</td><td>${h.count}</td><td>${ratePerGame(reviewed, h.tag) ?? '—'}</td></tr>`)
          .join('')}</table><p class="dim">最近 ${reviewed.length} 盘复盘过的实战。只数复盘过的棋——没复盘的棋私教看不到你哪里走坏了。</p>`
      : `<p class="dim">${inp.games.length ? '最近的实战还没有复盘过，或者复盘里没有明显的毛病。' : '还没有实战记录。'}下完棋看一下复盘，私教就有教案了。</p>`;
    scr.innerHTML = `<h1>🧑‍🏫 私教</h1>
      <div class="sub">一节课只讲一件事：先看证据，再讲三条，当堂练，下节课检查</div>
      ${prevHtml ? `<div class="xq-advice" data-keep data-tutor-check><b>📋 先检查作业</b>${prevHtml}</div>` : ''}
      <div class="xq-advice xq-tutor-lesson" data-keep data-tutor-lesson="${lesson.theme}">
        <b>今天这一课：${lesson.title}</b>
        <p>${lesson.why}</p>
        <ol class="xq-trick-steps">${lesson.points.map((x) => `<li>${x}</li>`).join('')}</ol>
      </div>`;
    const steps = document.createElement('div');
    steps.className = 'card-list';
    lesson.steps.forEach((st, i) => {
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.dataset.tutorStep = String(i);
      const ok = done.has(i) || (st.kind === 'assess' && isAssessed());
      el.innerHTML = `<div class="title">${ok ? '✅' : `${i + 1}.`} ${st.label}</div><div class="desc">${stepDesc(st)}</div>`;
      el.onclick = () => runTutorStep(lesson, i);
      steps.appendChild(el);
    });
    scr.appendChild(steps);
    const tail = document.createElement('div');
    tail.innerHTML = `<div class="xq-advice"><b>📝 作业和下节课</b><p>${lesson.check}</p></div>
      <div class="xq-advice" data-tutor-evidence><b>📊 私教看到的你</b>${evidence}</div>
      ${
        log.length
          ? `<div class="xq-advice"><b>🗂 上过的课</b><ul class="xq-trick-steps">${[...log]
              .reverse()
              .slice(0, 8)
              .map(
                (r) =>
                  `<li>${r.d} · ${themeName(r.theme)}${r.round > 1 ? `（第 ${r.round} 次）` : ''} · ${
                    r.done.length < r.steps ? `上了 ${r.done.length}/${r.steps}` : r.passed === true ? '过关' : r.passed === false ? '没过，又练了一遍' : '上完了'
                  }</li>`,
              )
              .join('')}</ul></div>`
          : ''
      }`;
    scr.appendChild(tail);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  function stepDesc(st: Step): string {
    switch (st.kind) {
      case 'own':
        return `从错题本里挑你实战中走错的局面（${st.n} 道）：同样的毛病，用你自己的棋来改最记得住。`;
      case 'drill':
        return `${DIM_INFO[st.dim].name}题 ${st.n} 道，难度按你现在的水平挑。`;
      case 'trick': {
        const t = TRICKS.find((x) => x.id === st.id);
        return t ? `${t.name}：你来破解，走错了当场讲。` : '邪门布局破解。';
      }
      case 'counterkill':
        return `绝地反杀 ${st.n} 关：对方下一步就杀你，只有连将能活。`;
      case 'game':
        return '教练开「教学提示」陪你下一盘（会读出对方每一步的意图；这个设置会留着，想关在对局里点"教"切换）。下完一定看复盘——复盘结论就是下节课的教案。';
      case 'assess':
        return '35 道题、约 20 分钟，题目难度跟着你的表现走，测完给一张五维诊断。';
    }
  }

  /** 上课：第 i 步。做完回到私教这一屏，打上勾 */
  function runTutorStep(lesson: Lesson, i: number) {
    startLesson(lesson, listGames());
    const st = lesson.steps[i];
    const back = () => {
      markStep(i);
      closeIntro();
      showTutor();
    };
    switch (st.kind) {
      case 'own': {
        const own = getOwnPuzzles()
          .filter((p) => st.dims.includes(p.kind as Dim))
          .slice(-st.n)
          .reverse();
        let k = 0;
        const next = () => {
          if (k >= own.length) return back();
          const p = own[k++];
          runOne(p, null, `你的实战错题 ${k}/${own.length}`, () => next());
        };
        if (own.length) next();
        else back();
        return;
      }
      case 'drill':
        void startPractice(st.dim, st.n, back);
        return;
      case 'trick': {
        const t = TRICKS.find((x) => x.id === st.id);
        if (t) runTrick(t, 'guess', back);
        else back();
        return;
      }
      case 'counterkill': {
        let left = st.n;
        const next = async () => {
          await loadCounterKill();
          const it = left-- > 0 ? nextCounterKill() : null;
          if (!it) return back();
          runCounterKill(it, () => void next());
        };
        void next();
        return;
      }
      case 'game': {
        markStep(i);
        closeIntro();
        // 带练：教练开"教学提示"——会读出对方每一步的意图，还能追问为什么
        if (getHintLevel() < 3) setHintLevel(3);
        const play = getPlay();
        const lv = play && play.n >= 3 ? opponentFor(play.r) : undefined;
        if (startFrom) startFrom([], 'r', lv);
        else onExit();
        return;
      }
      case 'assess':
        markStep(i);
        void startAssessment();
        return;
    }
  }

  // ---------------- 让子定级 ----------------
  /**
   * 让子阶梯：**唯一没有天花板、而且量的是实战能力的读数**。
   *
   * 做题分有两个硬伤：一是受题库里最难那道题的限制，业 6 以上很快顶到上限；
   * 二是它衡量的是"会不会做题"，而做题会做和实战下得出来是两回事。
   * 教练历来的定级办法是让子——让你两个马能赢、让一个马赢不了，
   * 水平就卡在这两档之间。让子让完了就换更强的一档皮卡鱼，尺子可以一直延伸下去。
   */
  function showLadder() {
    clear();
    const st = getLadder();
    const cur = LADDER[st.rung];
    const here = st.log.filter((x) => x.rung === st.rung).slice(-3);
    const wins = here.filter((x) => x.won).length;

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>让子定级</h1>
      <div class="sub">跟皮卡鱼下让子棋，用"能赢到哪一档"量你的实战棋力</div>
      <div class="xq-rank-big">${cur.name}<span>${cur.desc}</span></div>
      <div class="xq-advice"><b>为什么要有这一项</b>
        <p>做题分有两个硬伤：<b>受题库里最难那道题限制</b>（业 6 以上很快就顶到上限，
        再练分也不动了），而且它量的是"会不会做题"——做题会做和实战下得出来是两回事。</p>
        <p>让子这把尺子<b>没有上限</b>，量的也是实战能力。让你两个马能赢、让一个马赢不了，
        水平就卡在这两档之间。这是教练给学生定级最老实的办法。</p>
        <p class="dim">规则：在同一档<b>赢够两盘</b>才升档，连输两盘降一档。只赢一盘不算——
        运气成分太大，真人教练看的也是稳不稳，不是偶尔赢一次。</p>
      </div>`;

    const list = document.createElement('div');
    list.className = 'xq-stage-list';
    LADDER.forEach((r, i) => {
      const log = st.log.filter((x) => x.rung === i);
      const el = document.createElement('div');
      el.className = `xq-stage${i === st.rung ? ' cur' : ''}${i < st.rung ? ' done' : ''}`;
      el.innerHTML = `
        <div class="hd">${r.name}<span class="wk">约 ${r.approx} 分</span>
          ${i < st.rung ? '<span class="ok">已通过</span>' : i === st.rung ? '<span class="now">当前</span>' : ''}</div>
        <div class="goal">${r.desc}</div>
        ${log.length ? `<div class="grad">战绩：${log.filter((x) => x.won).length} 胜 ${log.filter((x) => !x.won).length} 负</div>` : ''}`;
      list.appendChild(el);
    });
    scr.appendChild(list);

    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = `⚔️ 下一盘「${cur.name}」${wins ? `（这一档已赢 ${wins}/2）` : ''}`;
    go.onclick = () => {
      if (!startLadder) return;
      startLadder(cur.strip, cur.lv, (won) => {
        const r = recordLadder(won);
        void r;
      });
    };
    scr.appendChild(go);
    if (!startLadder) {
      const note = document.createElement('div');
      note.className = 'xq-advice';
      note.innerHTML = '<p class="dim">这一版还没接上对弈入口。</p>';
      scr.appendChild(note);
    }

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  // ---------------- 我的训练方案 ----------------
  /**
   * 测评之后该交出来的东西：**一份写着你自己数字的处方**，不是一张通用课程表。
   *
   * 一个教练带你，第一次测完之后会告诉你六件事：
   *   1. 你现在什么水平（而且要说清这个读数有多准）
   *   2. 你为什么输棋（分门别类，用你自己的对局说话）
   *   3. 这个月的目标是什么（**必须可检验**，不能是"提高眼力"）
   *   4. 每天练什么、每周怎么排
   *   5. 往后几个阶段的路线和大致时间
   *   6. 怎么判断到底有没有进步
   * 这一页就是这六件事。少了任何一件，"训练方案"都只是课程表。
   */
  function showProgram() {
    clear();
    const rs = getRatings();
    const stage = stageFor(rs, gameEvidence());
    const overall = overallOf(rs);
    const loss = lossProfile(10);
    const games = getGames().slice(-10);
    const bpg = games.length ? games.reduce((a, g) => a + g.blunders, 0) / games.length : null;
    const focus = prescribeFocus({
      stage,
      ratings: rs,
      loss,
      accuracy: (d) => recentAccuracy(d),
      dueCount: srsCount().due,
      daysSinceQuiz: daysSinceQuiz(),
    });
    const goals = monthGoals(focus.dim, rs, stage, bpg);
    const hist = getHistory();
    const ci = hist.length ? '' : '';
    void ci;
    const sinceAssess = daysSinceAssess();

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>我的训练方案</h1>
      <div class="sub">按你的测评结果和最近的实战数据生成，会随着你的表现自动调整</div>

      <div class="xq-advice"><b>① 你现在的水平</b>
        <p>${
          honestLevel().source === 'play'
            ? `<b>实战 ${rankOf(honestLevel().r).name} · ${honestLevel().r} 分</b>（按对弈输赢，粗略对照天天象棋 <b>${ttNear(honestLevel().r).name}</b>）。`
            : `<b>还没有实战水平</b>：${honestLevel().note}`
        }做题分 ${overall}（只用来比五维哪一维弱）。${
          hist.length
            ? `上次完整测评是 ${sinceAssess} 天前。`
            : '你还没做过完整测评，下面这些数字是按做题记录估的，先去测一次会准得多。'
        }</p>
        <div class="xq-lossbars">${DIMS.map((d) => {
          const w = Math.round(((rs[d].r - 600) / 1200) * 100);
          return `<div class="row"><span class="k">${DIM_INFO[d].name}</span>
            <span class="bar"><i style="width:${Math.max(4, Math.min(100, w))}%;background:${
              d === focus.dim ? 'linear-gradient(90deg,#e8703d,#e0433a)' : 'linear-gradient(90deg,#4a8fd4,#3ec46d)'
            }"></i></span><span class="v">${rs[d].r}</span></div>`;
        }).join('')}</div>
        <p class="dim">红色那一维是这个月的主攻方向。分数只是内部刻度，别和别家的等级分换算——
        真正要看的是它<b>往哪个方向动</b>。</p>
      </div>

      <div class="xq-advice"><b>② 你为什么输棋</b>
        <p>${focus.why}</p>
        ${
          bpg !== null
            ? `<p>最近 ${games.length} 盘，平均每盘 <b>${bpg.toFixed(1)}</b> 次漏着。
               业余棋手输棋六成是漏着——<b>这个数字比分数更能说明问题</b>。</p>`
            : '<p class="dim">还没有对局记录。下几盘并复盘之后，这里会告诉你分具体丢在哪。</p>'
        }
      </div>

      <div class="xq-advice"><b>③ 这个月的目标</b>
        ${goals
          .map(
            (g) => `<div class="xq-goal"><b>${g.title}</b><span>怎么算达成：${g.check}</span></div>`,
          )
          .join('')}
        <p class="dim">涨幅只写 +60 是刻意保守的：每天 25 分钟、每周 6 天，一个月约 10 小时，
        集中练一维 60 分是个不算离谱的预期。写 +200 好看，但一个月后只会让你觉得自己失败。</p>
      </div>`;

    // ④ 一周怎么排
    const week = document.createElement('div');
    week.className = 'xq-week';
    week.innerHTML =
      `<div class="xq-sec2">④ 一周怎么排</div>` +
      weekFor(focus.dim)
        .map(
          (d) => `<div class="xq-week-row${d.minutes > 30 ? ' long' : ''}">
          <span class="d">${d.label}</span>
          <span class="t">${d.title}<span class="m">${d.minutes} 分钟</span></span>
          <span class="s">${d.desc}</span>
        </div>`,
        )
        .join('');
    scr.appendChild(week);

    // ⑤ 路线 ⑥ 怎么判断有没有进步
    const tail = document.createElement('div');
    const ms = nextMilestone(overall);
    tail.innerHTML = `
      <div class="xq-advice"><b>⑤ 往后的路线</b>
        <p>你在 ${stage.emoji} <b>阶段${stage.id}「${stage.name}」</b>——${stage.goal}。
        出师标准：${graduateStatus(stage, rs)
          .map((g) => `${g.name} ${g.need}（现在 ${g.now}${g.ok ? ' ✅' : ''}）`)
          .join('、')}。</p>
        <p>下一个台阶是 <b>${ms.label}</b>，按每天 25 分钟、每周 6 天大约 <b>${ms.time}</b>。
        中间会有两到六周的平台期——那不是没进步，是在把学到的东西固化。</p>
        <p class="dim">四个阶段的完整内容在「学习路线」里。顺序是按"业余棋手为什么输棋"排的，
        不是传统的开局→中局→残局。</p>
      </div>

      <div class="xq-advice"><b>⑥ 怎么知道有没有进步</b>
        <p>三条一起看，缺一条都会骗自己：</p>
        <ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
          <li><b>每周小测</b>（10 题，五维各两题，不给提示）——看方向，一周一次</li>
          <li><b>每月完整测评</b>（三十多题，自适应难度）——看真实涨幅${
            sinceAssess >= 28 ? '，<b class="warn-t">你已经该测了</b>' : `，还有 ${Math.max(0, 28 - sinceAssess)} 天`
          }</li>
          <li><b>实战每盘漏着次数</b>——最实在的一条。做题会做不等于实战不漏</li>
        </ul>
        <p class="dim">只看做题分数最容易自我感觉良好：题做熟了分自然涨，实战照样送子。
        所以第三条必须一起看。</p>
      </div>`;
    scr.appendChild(tail);

    const act = document.createElement('button');
    act.className = 'btn';
    act.textContent = sinceAssess >= 28 ? '🔁 去做这个月的完整测评' : '📅 去做今天的任务';
    act.onclick = () => (sinceAssess >= 28 ? startAssessment() : showHome());
    scr.appendChild(act);

    const road = document.createElement('button');
    road.className = 'btn ghost';
    road.textContent = '🗺️ 看四个阶段的完整内容';
    road.onclick = showRoadmap;
    scr.appendChild(road);

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  // ---------------- 学习路线 ----------------
  function showRoadmap() {
    clear();
    const rs = getRatings();
    const cur = stageFor(rs, gameEvidence());
    const overall = overallOf(rs);
    const ms = nextMilestone(overall);

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>学习路线</h1>
      <div class="sub">按「业余棋手到底为什么输棋」排的顺序，不是传统的开局→中局→残局</div>
      <div class="xq-advice">
        <b>下一个台阶：${ms.label}</b>
        <p>按每天 25 分钟、每周 6 天，大约 <b>${ms.time}</b>。</p>
        <p class="dim">涨棋是阶梯式的，中间会有两到六周的平台期。平台期不是没进步，是在把学到的东西固化。</p>
      </div>`;

    const list = document.createElement('div');
    list.className = 'xq-stage-list';
    for (const st of STAGES) {
      const status = graduateStatus(st, rs);
      const passed = status.every((g) => g.ok);
      const isCur = st.id === cur.id;
      const el = document.createElement('div');
      el.className = `xq-stage${isCur ? ' cur' : ''}${passed ? ' done' : ''}`;
      el.innerHTML = `
        <div class="hd">${st.emoji} 阶段${st.id} · ${st.name}
          <span class="wk">${st.weeks}</span>
          ${passed ? '<span class="ok">已达标</span>' : isCur ? '<span class="now">进行中</span>' : ''}
        </div>
        <div class="goal">🎯 ${st.goal}</div>
        <div class="why">${st.why}</div>
        <ul>${st.topics.map((t) => `<li>${t}</li>`).join('')}</ul>
        <div class="grad">出师标准：${status
          .map((g) => `${g.name} ${g.need} 分<b class="${g.ok ? 'ok' : ''}">（现在 ${g.now}）</b>`)
          .join('　')}${(() => {
          const gate = gameGate(st, gameEvidence());
          return gate ? `　<b class="${gate.ok ? 'ok' : ''}">${gate.text}</b>` : '';
        })()}</div>`;
      list.appendChild(el);
    }
    scr.appendChild(list);

    // 周计划：只有"每天练什么"不够，专业训练是按周组织的
    const week = document.createElement('div');
    week.className = 'xq-week';
    week.innerHTML =
      `<div class="xq-sec2">一周怎么安排</div>` +
      WEEK_PLAN.map(
        (d) => `<div class="xq-week-row${d.minutes > 30 ? ' long' : ''}">
          <span class="d">${d.label}</span>
          <span class="t">${d.title}<span class="m">${d.minutes} 分钟</span></span>
          <span class="s">${d.desc}</span>
        </div>`,
      ).join('');
    scr.appendChild(week);

    const pri = document.createElement('div');
    pri.className = 'xq-principles';
    pri.innerHTML =
      `<div class="xq-sec2">专业训练里最容易被忽略的几条</div>` +
      PRO_PRINCIPLES.map((p) => `<div class="xq-pri"><b>${p.title}</b><p>${p.body}</p></div>`).join('');
    scr.appendChild(pri);

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  // ---------------- 成长曲线 ----------------
  function showGrowth() {
    clear();
    const hist = getHistory();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = '<h1>成长曲线</h1><div class="sub">每次测评的五维变化</div>';
    const rows = hist
      .slice()
      .reverse()
      .map((h) => {
        const d = DIMS.map((k) => `${DIM_INFO[k].name} ${h.dims[k]}`).join(' · ');
        return `<div class="xq-report-row"><div class="hd">${h.d} <b>${h.overall}</b></div><div class="ds">${d}</div></div>`;
      })
      .join('');
    const box = document.createElement('div');
    box.className = 'xq-report-list';
    box.innerHTML = rows || '<div class="xq-loading">还没有测评记录。</div>';
    scr.appendChild(box);
    if (hist.length >= 2) {
      const first = hist[0];
      const last = hist[hist.length - 1];
      const diff = last.overall - first.overall;
      const tip = document.createElement('div');
      tip.className = 'xq-advice';
      tip.innerHTML = `<b>${diff >= 0 ? `比第一次测评涨了 ${diff} 分` : `比第一次测评低了 ${-diff} 分`}</b>
        <p class="dim">${
          diff > 0 && diff < 40
            ? '涨幅不大很正常——涨棋是阶梯式的，中间会有两到六周的平台期，那段时间是在固化，不是没进步。'
            : diff <= 0
              ? '分数没涨甚至回落，多半是最近实战少了。做题练的是识别，实战练的是运用，两样都得有。'
              : '保持住，接着按最弱的一维练。'
        }</p>`;
      scr.appendChild(tip);
    }
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = () => menuBack();
    scr.appendChild(back);
    mount(scr);
  }

  // 第一次进学棋先问一句水平——不然报出来的分你没有参照系
  const land = () => {
    if (entry === 'puzzles') showMenu('tactics');
    else if (entry === 'tutor') showTutor();
    else if (entry === 'progress') showMenu('progress');
    else if (entry === 'own') showOwnCourse();
    else showHome();
  };
  if (getDeclared()) land();
  else askLevel(land);

  // 开发期测试钩子：直接打开某一道题 / 某一条套路的"破解到底"（生产构建会被摇掉）
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqCoach = {
      /** 回到学棋首页（逐屏体检用） */
      home: () => showHome(),
      /** 直接打开某个二级菜单（tactics / endgame / opening / play / progress） */
      menu: (id: MenuId) => showMenu(id),
      /** 我的专属课 */
      own: () => showOwnCourse(),
      puzzle: async (id: string) => {
        await loadPuzzles();
        const p = byId(id);
        if (p) runOne(p, null, `测试 ${id}`, () => showHome());
        return !!p;
      },
      trickFull: (id: string) => {
        const t = TRICKS.find((x) => x.id === id);
        if (t) runTrickFull(t);
        return !!t;
      },
      /** 直接打开实用残局第一组的第一个局面（量"下到底"那一屏的按钮用） */
      endgame: async () => {
        await loadLibrary();
        const g = endgamesByName()[0];
        if (g) runEndgame(g, 0);
        return !!g;
      },
    };
  }

  return () => {
    clear();
    wrap.remove();
  };
}
