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
  weakestDim,
  overallOf,
  honestLevel,
  gameEvidence,
  getPlay,
  suggestLevel,
  AI_LEVEL_NAMES,
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
  totalSolved,
  getHistory,
  getDeclared,
  setDeclared,
  TT_LEVELS,
  ttLevelById,
  markEndgameCleared,
  markBeatDraw,
  getBeatDraw,
  markMateCleared,
  getCleared,
  playStats,
  calibratePuzzle,
  calibratedCount,
  effectiveRating,
  type Dim,
} from './save';
import { Assessment, diagnose, type AssessResult } from './assess';
import { loadPuzzles, pickNear, byId, ratingRange, freshCount, combos, type Puzzle, type PuzzleKind } from './puzzles';
import { runPuzzle } from './train';
import { loadLibrary, matesByName, endgamesByName, type EndgamePos } from './library';
import { runPlayout } from './playout';
import mateLadderData from './mateladder.json';
import { runReplay } from './replay';
import type { Color, Move } from './rules';
import { OPENINGS, SYSTEM_ORDER, moveNote, type Opening } from './openings';
import { judgeAgainst } from './altjudge';
import { TRICKS, refuteLine, trapLine, walkMoves, type TrickOpening } from './tricks';
import { outlookOf } from './plan';
import { roleOf } from './endgame';
import { inPieces } from './teach';
import { Board2D } from './board2d';
import { fromFen, toFen } from './notation';
import { STAGES, stageFor, gameGate, graduateStatus, dailyPlan, focusDim, nextMilestone, WEEK_PLAN, PRO_PRINCIPLES, prescribeFocus, monthGoals, weekFor, type Block } from './curriculum';

/** 残局阶梯的题（tools/gen-mate-ladder.ts 生成，merge-mate-ladder 并成这一份） */
const MATE_LADDER = mateLadderData as unknown as {
  id: string;
  name: string;
  category: string;
  material: string;
  fen: string;
  you: Color;
  mateIn: number;
  solved: number;
  line: string[];
  tier: number;
}[];

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
export type CoachEntry = 'home' | 'today' | 'puzzles';

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
    wrap.appendChild(scr);
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
      if (pruneSrs((id) => !!byId(id)) > 0 && wrap.querySelector('.xq-coach-home')) showHome();
    });
  }

  // ---------------- 首页 ----------------
  function showHome() {
    clear();
    pruneOnce();
    const rs = getRatings();
    const lv = honestLevel();
    const rank = rankOf(lv.r);
    const assessed = isAssessed();
    const { streak } = getStreak();
    const srs = srsCount();
    const solved = totalSolved();
    const decl = ttLevelById(getDeclared() ?? '');
    const cal = calibratedCount();
    const cleared = getCleared();

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `
      <h1>♟️ 学棋</h1>
      <div class="sub">${
        lv.source === 'play'
          ? `实战水平 <b>${rank.name}</b> · ${lv.r} 分 <span class="ci">（按 ${lv.games} 盘对弈的输赢）</span>`
          : assessed
            ? `做题估计 <b>${rank.name}？</b> <span class="ci">还要下几盘实战确认——水平以实战为准</span>`
            : '先花 20 分钟测一下，才知道该从哪儿练起'
      }${decl ? `<br><span class="ci">你自报：天天象棋 ${decl.name}</span>` : ''}</div>
      <div class="xq-chips">
        ${streak > 0 ? `<span class="xq-chip">🔥 连续 <b>${streak}</b> 天</span>` : ''}
        ${solved > 0 ? `<span class="xq-chip">✅ 做过 <b>${solved}</b> 题</span>` : ''}
        ${srs.due > 0 ? `<span class="xq-chip warn">📌 <b>${srs.due}</b> 道错题待复习</span>` : ''}
        ${cal > 0 ? `<span class="xq-chip">🎚 已按你的成绩校准 <b>${cal}</b> 道题</span>` : ''}
      </div>`;

    if (assessed) scr.appendChild(radarCard(rs));

    // 实战表现——做题分有天花板，这个没有。强手要看的是这一块
    const ps = playStats();
    if (ps) {
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
            ? '再下几盘就能看出趋势。这几个数没有天花板，比做题分更适合衡量真实水平。'
            : ps.trend > 0
              ? `比之前 ${ps.games} 盘平均亏损<b>降了 ${ps.trend} 分</b>——在涨棋。`
              : `比之前 ${ps.games} 盘平均亏损高了 ${-ps.trend} 分，最近可能下得急了。`
        }</div>`;
      scr.appendChild(card);
    }

    const list = document.createElement('div');
    list.className = 'card-list';

    const stage = stageFor(rs, gameEvidence());
    const cards: { t: string; d: string; go: () => void; hide?: boolean }[] = [
      {
        t: `📅 今日训练 · ${stage.emoji} 阶段${stage.id} ${stage.name}`,
        d: `${stage.goal}。一共 25 分钟：热身杀法 → 错题重练 → 专项 → 实战复盘。`,
        go: () => showToday(),
        hide: !assessed,
      },
      {
        t: assessed ? '🔁 重新测评' : '🎯 水平测评（先做这个）',
        d: assessed
          ? '练一段时间再测一次，看看五维各涨了多少。'
          : '35 道题、约 20 分钟。题目难度跟着你的表现走——答对就加难，答错就降。测完给一张五维诊断。',
        go: () => startAssessment(),
      },
      {
        t: `📌 错题重练${srs.due ? `（今天 ${srs.due} 道）` : ''}`,
        d: srs.total
          ? '做错的题会按 1/3/7/21/60 天的间隔回来找你，直到真的记住为止。'
          : '还没有错题。做错的题会自动进这里，按遗忘曲线安排重练。',
        go: () => startReview(),
        hide: srs.total === 0,
      },
      {
        t: `⚔️ 杀法图形${cleared.mates.length ? `（已掌握 ${cleared.mates.length}）` : ''}`,
        d: '马后炮、闷宫、双车错、铁门栓、大刀剜心…… 有名字的杀棋一共就那么多，认熟了就是条件反射。这是涨棋最快的一块。',
        go: () => showMateList(),
      },
      {
        t: `🏁 实用残局${cleared.endgames.length ? `（已过 ${cleared.endgames.length}）` : ''}`,
        d: '摆好局面跟引擎下到底——多子必须赢下来，少子必须守和。不到分出结果不算过。',
        go: () => showEndgameList(),
      },
      {
        t: '🧠 中局组合',
        d: '要连走好几步才拿到便宜的得子和杀棋，按步数（2–3 / 4–5 / 6 步以上）和主题（连将杀、弃子、抽将、捉双……）分开练。每一步都判，走到便宜拿到手才算对。',
        go: () => void showCombos(),
      },
      {
        t: `🪜 残局阶梯${Object.keys(mlStars()).length ? `（已过 ${Object.keys(mlStars()).length}）` : ''}`,
        d: '5 步杀 → 10 步杀 → 15 步杀 → 20 步杀，按子力体系分组，和皮卡鱼下到将死。从终点往回学：先练最后几步怎么收，再一档档往前推。',
        go: () => showMateLadder(),
      },
      {
        t: `🗡 邪门布局破解${tricksDone().size ? `（已练 ${tricksDone().size}/${TRICKS.length}）` : ''}`,
        d: '炮打中卒、炮打底马、急冲中兵、炮过河骚扰……江湖套路本身都是亏的，专门赌你应错。每一条都讲清它赌什么、怎么破，引擎逐条验证过。',
        go: () => showTricks(),
      },
      {
        t: '🧩 专项练习',
        d: assessed
          ? `按你的水平出题。现在在${stage.emoji} 阶段${stage.id}，建议先练「${DIM_INFO[focusDim(stage, rs)].name}」。`
          : '五个方向随便挑一个练。测评之后这里会按你的水平自动调难度。',
        go: () => showPickDim(),
      },
      {
        t: `📋 我的训练方案${daysSinceAssess() >= 28 ? '（该月测了）' : ''}`,
        d: '你现在什么水平、为什么输棋、这个月的目标、每周怎么排、怎么判断有没有进步——一页说完。',
        go: () => showProgram(),
      },
      {
        t: '📜 打谱',
        d: '一手一手过棋谱，轮到你的时候先自己想一手再看原谱。看的时候都觉得"我也想得到"，先走一遍才知道。',
        go: () => void showGames(),
      },
      {
        t: '⏱ 限时计算',
        d: '限时做一遍，错的再不限时做一遍——把"算不出来"和"懒得算"分开。这是两个完全不同的病，练法相反。',
        go: () => void startTimed(),
      },
      {
        t: '📖 布局定式',
        d: '中炮对屏风马、中炮对反宫马、仙人指路。每一手都讲"在干什么"，还能用猜着法过一遍——光看谱你会以为自己都想得到。',
        go: () => showOpenings(),
      },
      {
        t: `📏 让子定级 · ${LADDER[getLadder().rung].name}`,
        d: '做题分有天花板，让子没有。跟引擎下让子棋，量的是你的实战棋力——这是教练给学生定级最老实的办法。',
        go: () => showLadder(),
      },
      {
        t: '🗺️ 学习路线',
        d: '四个阶段、每阶段练什么、出师标准是什么、大概要多久。',
        go: () => showRoadmap(),
      },
      {
        t: '📈 成长曲线',
        d: '每次测评的五维变化。涨棋是阶梯式的，会有平台期，看曲线比看感觉准。',
        go: () => showGrowth(),
        hide: getHistory().length === 0,
      },
    ];

    for (const c of cards) {
      if (c.hide) continue;
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.innerHTML = `<div class="title">${c.t}</div><div class="desc">${c.d}</div>`;
      el.onclick = c.go;
      list.appendChild(el);
    }
    scr.appendChild(list);

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = onExit;
    scr.appendChild(back);
    wrap.appendChild(scr);
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
    wrap.appendChild(scr);

    const a = new Assessment();
    await a.init();
    if (!wrap.isConnected) return;
    if (a.total === 0) {
      scr.innerHTML = `<div class="xq-loading">题库还没生成，测评暂时用不了。</div>`;
      const b = document.createElement('button');
      b.className = 'btn ghost';
      b.textContent = '← 返回';
      b.onclick = showHome;
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  // ---------------- 专项练习 ----------------
  function showPickDim() {
    clear();
    const rs = getRatings();
    const stage = stageFor(rs, gameEvidence());
    const rec = focusDim(stage, rs);
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `<h1>专项练习</h1><div class="sub">题目难度按你这一维的当前水平自动挑。
      现在在${stage.emoji} 阶段${stage.id}「${stage.name}」，带推荐标的是这一阶段该练的。</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const d of DIMS) {
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.innerHTML = `<div class="title">${DIM_INFO[d].emoji} ${DIM_INFO[d].name} <span class="tag">${rs[d].r}</span>${
        d === rec ? '<span class="tag warn">本阶段推荐</span>' : ''
      }</div><div class="desc">${DIM_INFO[d].desc}</div>`;
      el.onclick = () => startPractice(d);
      list.appendChild(el);
      if (d === 'opening') {
        const tk = document.createElement('div');
        tk.className = 'card home-card';
        tk.innerHTML = `<div class="title">🗡 邪门布局破解</div><div class="desc">炮打中卒、炮打底马、急冲中兵……
          江湖套路专门赌你应错。看它赌什么、上当会怎样、怎么破，再自己走一遍。</div>`;
        tk.onclick = () => showTricks();
        list.appendChild(tk);
      }
      // 残局题只练"一步正着"；残局真正的功夫是下到底——入口就放在残局题旁边，不用再去找
      if (d === 'endgame') {
        const eg = document.createElement('div');
        eg.className = 'card home-card';
        eg.innerHTML = `<div class="title">🏁 实用残局 · 下到底</div><div class="desc">摆好残局跟引擎下到底：多子必须赢下来，少子必须守和。
          教练一直陪着算，每一手告诉你还赢不赢、还守不守得住，卡住了给你计划。</div>`;
        eg.onclick = () => void showEndgameList();
        list.appendChild(eg);
        const ml = document.createElement('div');
        ml.className = 'card home-card';
        ml.innerHTML = `<div class="title">🪜 残局阶梯 · 5 / 10 / 15 / 20 步杀</div><div class="desc">同一个残局从终点往回切：先练最后 5 步怎么收，
          再往前推到 10 步、15 步、20 步。和皮卡鱼下到将死，按用了几步给星。</div>`;
        ml.onclick = () => showMateLadder();
        list.appendChild(ml);
      }
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  /** 一组 10 题的专项练习 */
  async function startPractice(dim: Dim, count = 10, then?: () => void, bias = 40) {
    clear();
    await loadPuzzles();
    if (!wrap.isConnected) return;
    const used = new Set<string>();
    let i = 0;
    let right = 0;
    const TOTAL = count;

    const step = () => {
      if (i >= TOTAL) {
        if (then) then();
        else finishSession(`${DIM_INFO[dim].emoji} ${DIM_INFO[dim].name}练习`, right, TOTAL, () => startPractice(dim));
        return;
      }
      const r = getRatings()[dim].r;
      // 默认略微往上挑：练在能力边缘涨得最快，正确率维持在七八成。
      // 热身块传负的 bias，用略简单的题找手感。
      const p = pickNear(DIM_KIND[dim], r + bias, used);
      if (!p) {
        if (then) then();
        else finishSession(`${DIM_INFO[dim].name}练习`, right, i, () => showHome());
        return;
      }
      used.add(p.id);
      i++;
      runOne(p, dim, `${DIM_INFO[dim].name} ${i}/${TOTAL}`, (ok) => {
        if (ok) right++;
        step();
      });
    };
    step();
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
      runOne(p, dim, `小测 ${i}/${plan.length} · ${DIM_INFO[dim].name}`, (ok) => {
        if (ok) right++;
        step();
      }, false);
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
    go.textContent = then ? '继续今天的训练 →' : '返回';
    go.onclick = () => (then ? then() : showHome());
    scr.appendChild(go);
    wrap.appendChild(scr);
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
        if (then) then();
        else finishSession('错题重练', right, list.length, () => showHome());
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
    back.onclick = showHome;
    scr.appendChild(back);
    scr.appendChild(early);
    wrap.appendChild(scr);
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
      showHome();
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
      onExit: () => showHome(),
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

  function finishSession(title: string, right: number, total: number, again: () => void) {
    clear();
    checkIn();
    const { streak } = getStreak();
    const rate = total ? Math.round((right / total) * 100) : 0;
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>${title}完成</h1>
      <div class="xq-rank-big">${right}/${total} <span>正确率 ${rate}%</span></div>
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
    a.textContent = '再来一组';
    a.onclick = again;
    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = '返回学棋首页';
    b.onclick = showHome;
    scr.appendChild(a);
    scr.appendChild(b);
    wrap.appendChild(scr);
  }

  // ---------------- 杀法图形 ----------------
  async function showMateList() {
    clear();
    await loadLibrary();
    if (!wrap.isConnected) return;
    const groups = matesByName();
    const cleared = new Set(getCleared().mates);
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `
      <h1>⚔️ 杀法图形</h1>
      <div class="sub">有名字的杀棋。先看图形长什么样，再做题把它认熟</div>
      <div class="xq-advice">
        <b>为什么先背图形</b>
        <p>真人高手不是每步现算，是<b>一眼认出来</b>——看到马在卧槽位就想到马后炮。
        杀法图形是有限的、有名字的，认熟了就变成条件反射，这才是"棋感"的真实来源。</p>
        <p class="dim">下面每个图形都是引擎生成并验证过的：解唯一、步数准确，且几何上确实是这个形状。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const g of groups) {
      const done = g.items.filter((i) => cleared.has(i.id)).length;
      const el = document.createElement('div');
      el.className = 'card home-card';
      el.innerHTML = `
        <div class="title">${g.name}<span class="tag">${g.items.length} 题</span>${
          done === g.items.length ? '<span class="tag warn">已掌握</span>' : done ? `<span class="tag">${done}/${g.items.length}</span>` : ''
        }</div>
        <div class="desc">${g.shape}</div>`;
      el.onclick = () => showMateLesson(g);
      list.appendChild(el);
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  /** 一个图形一课：先讲清楚形状和道理，再连做几题 */
  function showMateLesson(g: ReturnType<typeof matesByName>[number]) {
    clear();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>${g.name}</h1>
      <div class="xq-advice">
        <b>图形</b><p>${g.shape}</p>
        <b>为什么成立</b><p>${g.why}</p>
      </div>
      <div class="sub">一共 ${g.items.length} 题，从一步杀开始，逐步加长</div>`;
    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = '开始练这个图形 →';
    go.onclick = () => runMateSeries(g, 0, 0);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showMateList;
    scr.appendChild(go);
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function runMateSeries(g: ReturnType<typeof matesByName>[number], i: number, right: number) {
    if (i >= g.items.length) {
      checkIn();
      finishSession(`${g.name}`, right, g.items.length, () => runMateSeries(g, 0, 0));
      return;
    }
    const p = g.items[i];
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    disposeScreen = runPuzzle(
      host,
      { id: p.id, kind: 'mate', fen: p.fen, answer: p.answer, also: p.also, line: p.line, mateIn: p.mateIn, rating: p.rating },
      {
        caption: `${g.name} ${i + 1}/${g.items.length}`,
        allowHint: true,
        onDone: (r) => {
          const ok = r.correct && !r.usedHint;
          if (firstAttempt(p.id)) updateRating('mate', p.rating, ok);
          if (ok) {
            markRight(p.id);
            markMateCleared(p.id);
          } else markWrong(p.id);
          runMateSeries(g, i + 1, right + (ok ? 1 : 0));
        },
      },
    );
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
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
    wrap.appendChild(scr);
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

  function runEndgame(g: ReturnType<typeof endgamesByName>[number], i: number) {
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
      onRestart: () => runEndgame(g, i),
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
      },
      onExit: () => {
        checkIn();
        showEndgameGroup(g);
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

  // ---------------- 今日训练 ----------------
  function showToday() {
    clear();
    const rs = getRatings();
    const stage = stageFor(rs, gameEvidence());
    const due = srsCount().due;
    const loss = lossProfile(10);
    const blocks = dailyPlan({
      stage,
      ratings: rs,
      loss,
      accuracy: (d) => recentAccuracy(d),
      dueCount: due,
      daysSinceQuiz: daysSinceQuiz(),
      play: getPlay(),
      fresh: (d) => freshCount(DIM_KIND[d]).fresh,
    });
    const total = blocks.reduce((a, b) => a + b.minutes, 0);

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>今日训练</h1>
      <div class="sub">${stage.emoji} 阶段${stage.id} · ${stage.name} — ${stage.goal}</div>
      <div class="xq-chips"><span class="xq-chip">⏱ 约 <b>${total}</b> 分钟</span>${
        loss.games ? `<span class="xq-chip">📊 依据最近 <b>${loss.games}</b> 盘实战</span>` : ''
      }</div>
      ${lossCard(loss)}`;

    const list = document.createElement('div');
    list.className = 'xq-block-list';
    blocks.forEach((b, i) => {
      const el = document.createElement('div');
      el.className = 'xq-block';
      el.innerHTML = `
        <div class="n">${i + 1}</div>
        <div class="bd">
          <div class="t">${b.title}<span class="m">${b.minutes} 分钟</span></div>
          <div class="d">${b.desc}</div>
          ${b.why ? `<div class="w">${b.why}</div>` : ''}
        </div>`;
      el.onclick = () => runBlock(b, blocks, i);
      list.appendChild(el);
    });
    scr.appendChild(list);

    const start = document.createElement('button');
    start.className = 'btn';
    start.textContent = '开始今天的训练 →';
    start.onclick = () => runBlock(blocks[0], blocks, 0);
    scr.appendChild(start);

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
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

  /** 跑一个训练块；做完自动接下一块，最后一块结束回今日训练页 */
  function runBlock(b: Block, all: Block[], idx: number) {
    const goNext = () => {
      const next = all[idx + 1];
      if (next) runBlock(next, all, idx + 1);
      else {
        checkIn();
        showToday();
      }
    };
    if (b.kind === 'game') {
      // 实战不在学棋里做，交回对弈流程——那边已经有完整的对局与复盘
      clear();
      const scr = document.createElement('div');
      scr.className = 'screen xq-coach-report';
      scr.innerHTML = `
        <h1>实战一局</h1>
        <div class="sub">${b.desc}</div>
        <div class="xq-advice"><b>怎么下才算练到</b>
          <p>每步走之前先扫一遍：对方的车、炮、马分别能打到哪。下完<b>一定要点复盘</b>——
          引擎会逐手标出你哪里走坏了、该走什么，那才是这一局真正的价值。</p></div>`;
      const go = document.createElement('button');
      go.className = 'btn';
      const play = getPlay();
      const lv = play && play.n >= 3 ? suggestLevel(play.r) : undefined;
      if (startFrom) {
        go.textContent = lv !== undefined ? `⚔️ 直接开始（对手：${AI_LEVEL_NAMES[lv]}）` : '⚔️ 直接开始一盘';
        go.onclick = () => startFrom([], 'r', lv);
      } else {
        go.textContent = '去下一局 →';
        go.onclick = onExit; // 回到象棋一级菜单，从那里进对弈
      }
      const skip = document.createElement('button');
      skip.className = 'btn ghost';
      skip.textContent = '今天先跳过实战';
      skip.onclick = goNext;
      scr.appendChild(go);
      scr.appendChild(skip);
      wrap.appendChild(scr);
      return;
    }
    if (b.kind === 'srs') {
      startReview(goNext);
      return;
    }
    if (b.kind === 'quiz') {
      void startQuiz(goNext);
      return;
    }
    if (b.kind === 'timed') {
      void startTimed(goNext);
      return;
    }
    if (b.kind === 'opening') {
      showOpenings();
      return;
    }
    if (b.kind === 'replay') {
      void showGames();
      return;
    }
    if (b.kind === 'mate-shape') {
      void loadLibrary().then(() => {
        if (!wrap.isConnected) return;
        const cleared = new Set(getCleared().mates);
        const groups = matesByName();
        const next = pickByLevel(groups, cleared, getRatings().mate.r);
        if (!next) return goNext();
        showMateLesson(next);
      });
      return;
    }
    if (b.kind === 'endgame') {
      void loadLibrary().then(() => {
        if (!wrap.isConnected) return;
        const cleared = new Set(getCleared().endgames);
        const next = pickByLevel(endgamesByName(), new Set(getCleared().endgames), getRatings().endgame.r);
        void cleared;
        if (!next) return goNext();
        showEndgameGroup(next);
      });
      return;
    }
    startPractice(b.dim ?? weakestDim(getRatings()), b.count ?? 10, goNext, b.ratingBias ?? 40);
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
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
      go.textContent = then ? '继续今天的训练 →' : '返回';
      go.onclick = () => (then ? then() : showHome());
      scr.appendChild(go);
      wrap.appendChild(scr);
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
    const tk = document.createElement('div');
    tk.className = 'card home-card';
    tk.innerHTML = `<div class="title">🗡 邪门布局破解<span class="tag">${TRICKS.length} 条</span></div>
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
        el.innerHTML = `<div class="title">${o.name}<span class="tag">${o.side === 'red' ? '先手' : '后手'}</span></div>
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function showOpening(o: Opening) {
    clear();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    const flagged = o.moves.filter((m) => m.book && m.loss && m.loss >= 60);
    scr.innerHTML = `<h1>${o.name}</h1><div class="sub">${o.tag}</div>
      <div class="xq-advice"><b>核心思路——要记住的是这个</b><p>${o.idea}</p>
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
    if (o.variations.length) {
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.textContent = '变化';
      scr.appendChild(h);
      o.variations.forEach((v, k) => {
        const row = document.createElement('div');
        row.className = 'card home-card';
        row.dataset.variation = String(k);
        row.innerHTML = `<div class="title">${v.name}</div><div class="desc">从第 ${Math.floor(v.at / 2) + 1} 回合分出去，再走 ${Math.ceil(
          v.moves.length / 2,
        )} 回合 · ${v.final}</div>`;
        row.onclick = () => runOpening(o, undefined, k);
        scr.appendChild(row);
      });
    }
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showOpenings;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function runOpening(o: Opening, guessFor: Color | undefined, variation?: number) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const v = variation === undefined ? null : o.variations[variation];
    const line = v ? [...o.moves.slice(0, v.at), ...v.moves] : o.moves;
    disposeScreen = runReplay(host, {
      title: v ? `${o.name} · ${v.name}` : o.name,
      subtitle: guessFor ? `你执${guessFor === 'r' ? '红' : '黑'}：先自己走，再看原谱（走了别的，皮卡鱼判是不是一样好）` : '讲解：每一手都说明在做什么',
      intro: v ? `变化：${v.name}。前 ${v.at} 手和主线一样，从这里分出去。` : o.idea,
      moves: line.map((m) => ({ t: m.t, why: moveNote(m) })),
      guessFor,
      startAt: v ? v.at : undefined,
      judge: guessFor ? (b, c, mine, exp) => judgeAgainst(b, c, mine, exp) : undefined,
      notes: [o.breaks, ...o.traps],
      onExit: () => showOpening(o),
    });
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
    { name: '6 步以上', min: 6, max: 99 },
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  /** 一组 10 道：没做过的先出，难度贴近你的战术分 */
  function runComboSession(items: Puzzle[], title: string) {
    const seen = attemptedMap();
    const r = getRatings().tactic.r;
    const order = [...items].sort((a, b) => {
      const fa = a.id in seen ? 1 : 0;
      const fb = b.id in seen ? 1 : 0;
      return fa - fb || Math.abs(a.rating - r) - Math.abs(b.rating - r);
    });
    const pick = order.slice(0, 10);
    let i = 0;
    let right = 0;
    const step = () => {
      if (i >= pick.length) return finishSession(`中局组合 · ${title}`, right, pick.length, () => void showCombos());
      const p = pick[i++];
      runOne(p, 'tactic', `${title} ${i}/${pick.length} · ${(p.themes ?? []).join('、')}`, (ok) => {
        if (ok) right++;
        step();
      });
    };
    step();
  }

  // ---------------- 残局阶梯：5 / 10 / 15 / 20 步杀 ----------------
  const ML_KEY = 'xq-mate-ladder';
  const ML_TIERS = [5, 10, 15, 20];
  /** 每一档的参考难度分（第一次做、没用提示悔棋、两星以上算做对） */
  const ML_RATING: Record<number, number> = { 5: 1000, 10: 1250, 15: 1450, 20: 1650 };
  const ML_CATS = ['兵类', '马类', '炮类', '车类', '组合'];
  function mlStars(): Record<string, number> {
    try {
      return JSON.parse(localStorage.getItem(ML_KEY) ?? '{}') as Record<string, number>;
    } catch {
      return {};
    }
  }
  function setMlStars(id: string, n: number) {
    const s = mlStars();
    if ((s[id] ?? 0) >= n) return;
    s[id] = n;
    try {
      localStorage.setItem(ML_KEY, JSON.stringify(s));
    } catch {
      /* 存不下就算了 */
    }
  }
  const mlTier = (t: number) => MATE_LADDER.filter((x) => x.tier === t);
  /** 上一档过了一半（最多要求 5 道）才解锁下一档：阶梯要一级一级上 */
  function mlUnlocked(k: number): boolean {
    if (k === 0) return true;
    const prev = mlTier(ML_TIERS[k - 1]);
    const st = mlStars();
    return prev.filter((x) => (st[x.id] ?? 0) > 0).length >= Math.min(5, Math.ceil(prev.length / 2));
  }

  function showMateLadder() {
    clear();
    const st = mlStars();
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `<h1>🪜 残局阶梯</h1>
      <div class="sub">5 步杀 → 10 步杀 → 15 步杀 → 20 步杀，一档一档往上走</div>
      <div class="xq-advice"><b>为什么这样排</b>
        <p>每一题都是皮卡鱼两边下到将死、再从终点往回切出来的：同一个残局，最后 5 步怎么收在第一档，
        再往前推 5 步在第二档……<b>从终点往回学</b>，前面的每一步你都知道是为了走到哪个杀法。</p>
        <p>每题都和皮卡鱼下到将死（它会用最顽强的守法）。用最快步数杀死 ★★★，多走几步 ★★，杀死了但绕得远 ★。
        靠提示、悔棋杀死的只给一颗星。上一档过一半，下一档才解锁。</p>
      </div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    ML_TIERS.forEach((t, k) => {
      const items = mlTier(t);
      if (!items.length) return;
      const done = items.filter((x) => (st[x.id] ?? 0) > 0).length;
      const stars = items.reduce((a, x) => a + (st[x.id] ?? 0), 0);
      const open = mlUnlocked(k);
      const el = document.createElement('div');
      el.className = `card home-card${open ? '' : ' locked'}`;
      el.dataset.tier = String(t);
      el.innerHTML = `<div class="title">${t} 步杀<span class="tag">${items.length} 题</span>${
        open ? (done ? `<span class="tag warn">已过 ${done} · ${stars}★</span>` : '') : '<span class="tag">🔒 上一档过一半解锁</span>'
      }</div><div class="desc">${[...new Set(items.map((x) => x.category))].join('、')}</div>`;
      if (open) el.onclick = () => showMateTier(t);
      list.appendChild(el);
    });
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function showMateTier(t: number) {
    clear();
    const st = mlStars();
    const items = mlTier(t);
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `<h1>${t} 步杀</h1><div class="sub">按子力体系分组：同一类残局的杀法思路是相通的</div>`;
    const list = document.createElement('div');
    list.className = 'card-list';
    for (const cat of [...ML_CATS, ...new Set(items.map((x) => x.category))]) {
      const group = items.filter((x) => x.category === cat);
      if (!group.length || list.querySelector(`[data-cat="${cat}"]`)) continue;
      const h = document.createElement('div');
      h.className = 'xq-sec';
      h.dataset.cat = cat;
      h.textContent = cat;
      list.appendChild(h);
      for (const it of group) {
        const el = document.createElement('div');
        el.className = 'card home-card';
        el.dataset.ml = it.id;
        const n = st[it.id] ?? 0;
        el.innerHTML = `<div class="title">${it.material}<span class="tag">最快 ${it.mateIn} 步</span>${
          n ? `<span class="tag warn">${'★'.repeat(n)}</span>` : ''
        }</div><div class="desc">你执${it.you === 'r' ? '红' : '黑'}，皮卡鱼守</div>`;
        el.onclick = () => runMateLadder(it);
        list.appendChild(el);
      }
    }
    scr.appendChild(list);
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showMateLadder;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function runMateLadder(it: (typeof MATE_LADDER)[number]) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const N = it.mateIn;
    const tips = [
      `最快 ${N} 步能杀。先想清楚最后的杀法图形是什么，再倒推前面每一步在为它做什么。`,
      '对方会用最顽强的守法。走不动的时候点 🔍，看引擎的计划——但用了提示只给一颗星。',
    ];
    disposeScreen = runPlayout(host, {
      fen: it.fen,
      you: it.you,
      target: 'win',
      par: N,
      goal: `🎯 将死对方：<b>${N}</b> 步内 ★★★`,
      title: `${N} 步杀 · ${it.material}`,
      subtitle: `${it.category} · 残局阶梯 ${it.tier} 步档`,
      tips,
      onRestart: () => runMateLadder(it),
      onDone: (r, my, stats) => {
        const stars = r !== 'win' ? 0 : stats.hints || stats.undos ? 1 : my <= N ? 3 : my <= N + Math.max(2, Math.round(N * 0.3)) ? 2 : 1;
        if (stars) setMlStars(it.id, stars);
        if (firstAttempt(it.id)) updateRating('endgame', ML_RATING[it.tier] ?? 1200, stars >= 2);
        checkIn();
      },
      onExit: () => showMateTier(it.tier),
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
      <h1>🗡 邪门布局破解</h1>
      <div class="sub">江湖套路本身都是亏的，专门赌你应错</div>
      <div class="xq-advice"><b>破邪门，记住三句话</b>
        <p>① <b>先看能不能吃</b>：送到嘴边的子先数保护，被将军先看能不能吃掉将军的子。<br>
        ② <b>不跟着乱打</b>：他不出子光骚扰，你就正常出子；跟着他换子、打底马，等于帮他出子。<br>
        ③ <b>用出子去捉</b>：单个子冲过来，出一个子捉它，他退一步，你白赚两步。<br>
        ④ <b>吃了子，舍得还</b>：敢死炮、铁滑车送的子该吃；他出车来捉时，别恋子——弃还一子、棋形工整，比被捉死强。</p>
        <p class="dim">江湖上有名号的（敢死炮、铁滑车、叠炮、瞎眼狗）名号写在名字里；同一个名号各地走法不一，
        这里收的是引擎复核过的那一种。每一条的结论都是皮卡鱼逐条复核过的：这一手本身亏多少、破解是不是最好、上当亏多少。
        有的套路坑在第二步（吃完之后），会单独标出"第二关"。</p>
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function showTrick(t: TrickOpening) {
    clear();
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const v = t.verified;
    const k = t.trapAfter ?? 0;
    const line = [...t.pre, t.trick.t].join(' ');
    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `<h1>${t.name}</h1>
      <div class="sub">对方执${sideWord(t.by)} · 你执${sideWord(me)}破解 · ${t.level}</div>
      <div class="xq-advice">
        <b>套路：它在赌什么</b><p>${t.lure}</p>
        <p class="dim">着法：${line}</p>
        <b>怎么破</b><p><b>${t.refute[0].t}</b>——${t.refute[0].why}</p>
        ${
          k
            ? `<b>第二关</b><p>对方 <b>${t.refute[k - 1].t}</b>（${t.refute[k - 1].why}）这时走 <b>${t.refute[k].t}</b>——${t.refute[k].why}</p>`
            : ''
        }
        <b>要记住的道理</b><p>${t.principle}</p>
        <p class="dim">引擎复核：这一步邪门棋本身就亏约${inPieces(v.trickLoss)}；按破解走，局面是「${outlookOf(v.refuteScore)}」；
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
    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showTricks;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  function runTrick(t: TrickOpening, mode: 'refute' | 'trap' | 'guess') {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    const me: Color = t.by === 'r' ? 'b' : 'r';
    const pre = t.pre.map((x) => ({ t: x, why: '布局的正常着法。' }));
    const trick = { t: t.trick.t, why: `<b>邪门着。</b>${t.trick.why}` };
    // 陷阱在第二关的：先按破解走到分岔处，再接上当的那几手
    const tail = mode === 'trap' ? [...t.refute.slice(0, t.trapAfter ?? 0), ...trapLine(t)] : refuteLine(t);
    const moves = [...pre, trick, ...tail];
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
      onFinish: (right, tried) => {
        if (mode === 'guess' && tried && right === tried) markTrickDone(t.id);
      },
      // 破解那几手走完不算完：接着和皮卡鱼下到胜势
      next: mode === 'trap' ? undefined : { label: '🏁 接着破解到底', run: () => runTrickFull(t) },
      onExit: () => showTrick(t),
    });
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
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
    act.textContent = sinceAssess >= 28 ? '🔁 去做这个月的完整测评' : '📅 开始今天的训练';
    act.onclick = () => (sinceAssess >= 28 ? startAssessment() : showToday());
    scr.appendChild(act);

    const road = document.createElement('button');
    road.className = 'btn ghost';
    road.textContent = '🗺️ 看四个阶段的完整内容';
    road.onclick = showRoadmap;
    scr.appendChild(road);

    const back = document.createElement('button');
    back.className = 'btn ghost';
    back.textContent = '← 返回';
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
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
    back.onclick = showHome;
    scr.appendChild(back);
    wrap.appendChild(scr);
  }

  // 第一次进学棋先问一句水平——不然报出来的分你没有参照系
  const land = () => {
    if (entry === 'today') showToday();
    else if (entry === 'puzzles') showPickDim();
    else showHome();
  };
  if (getDeclared()) land();
  else askLevel(land);

  // 开发期测试钩子：直接打开某一道题 / 某一条套路的"破解到底"（生产构建会被摇掉）
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqCoach = {
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
    };
  }

  return () => {
    clear();
    wrap.remove();
  };
}
