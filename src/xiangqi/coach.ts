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
  weakestDim,
  overallOf,
  confidenceOf,
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
import { loadPuzzles, pickNear, byId, ratingRange, type Puzzle, type PuzzleKind } from './puzzles';
import { runPuzzle } from './train';
import { loadLibrary, matesByName, endgamesByName, type EndgamePos } from './library';
import { runPlayout } from './playout';
import { Board2D } from './board2d';
import { fromFen } from './notation';
import { STAGES, stageFor, graduateStatus, dailyPlan, focusDim, nextMilestone, WEEK_PLAN, PRO_PRINCIPLES, prescribeFocus, monthGoals, weekFor, type Block } from './curriculum';

const DIM_KIND: Record<Dim, PuzzleKind> = {
  safety: 'safety',
  mate: 'mate',
  tactic: 'tactic',
  endgame: 'endgame',
  opening: 'opening',
};

export function runCoach(root: HTMLElement, onExit: () => void): () => void {
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
    const overall = overallOf(rs);
    const rank = rankOf(overall);
    const ci = confidenceOf(rs);
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
        assessed
          ? `当前 <b>${rank.name}</b> · ${overall} 分 <span class="ci">±${ci}（内部刻度）</span>`
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

    const stage = stageFor(rs);
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
    const rank = rankOf(overall);
    const weak = weakestDim(rs);

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    const satCount = DIMS.filter((d) => res.saturated[d] && !missing.includes(d)).length;
    scr.innerHTML = `
      <h1>测评结果</h1>
      <div class="xq-rank-big">${satCount >= 3 ? '≥ ' : ''}${rank.name} <span>${
        satCount >= 3 ? `${overall} 分以上` : `${overall} 分 ±${res.ci}`
      }</span></div>
      <div class="sub">${rank.desc}</div>
      <div class="sub xq-scale-note">这套分只是这个软件自己的尺子，粗略对照大概是天天象棋的<b>${
        ttNear(overall).name
      }</b>——两边的尺子本来就不是一把，别太当真，看它<b>往哪个方向动</b>就够了。</div>`;
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

    const stage = stageFor(rs);
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
    const stage = stageFor(rs);
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
      onDone: (r) => {
        // 用了提示不算做对：算对了会把评分虚抬，下次出的题就偏难
        const ok = r.correct && !r.usedHint;
        // 错题重练不计分（dim 为 null）：那些题你见过，做对可能只是记住了答案，
        // 拿它涨分会把水平估高。复习只管有没有真的记牢，不管分数。
        const eff = effectiveRating(p.id, p.rating);
        if (dim) {
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
          updateRating('mate', p.rating, ok);
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
        <p class="dim">每个局面的"是胜是和"都是引擎实测出来的：先下到底，<b>下成和还不算数</b>，
        要换更强的一档再试一次、还赢不了才记"和"；结论已经确定的组合（单车例胜双士、
        单车例和士象全……）还要和定式对得上，对不上的局面根本不进库。</p>
        <p class="dim">所以同一个名目下会有的能赢、有的只能和——<b>摆法不同结果就不同，这正是要练的东西</b>。
        先自己判断这局是赢是和，再下到底验证。判断力才是残局功力的核心。</p>
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
      const wins = g.items.filter((i) => i.target === 'win').length;
      // 还没全部判断过就先不说有几个是胜局——那等于替你把判断做了
      const guessedAll = g.items.every((i) => guesses[i.id]);
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
        if (!guess) {
          el.innerHTML = `
            <div class="title">局面 ${i + 1}<span class="tag">先判断</span></div>
            <div class="xq-eg-thumb"></div>
            <div class="desc">看一眼这个局面，你觉得强的一方能赢下来，还是只能和？</div>
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
    return conflict
      ? `<br><span class="dim">棋书上：${e.book}。引擎这一局没走出胜果——胜势要靠技术兑现，兑不出来就是和。</span>`
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
      onDone: (r) => {
        // 你在标着「和棋」的局面里赢了：说明这个标注保守了，以你的结果为准。
        // 引擎的判定是最好的自动近似，但它不是裁判。
        if (r === 'win' && e.target === 'draw') markBeatDraw(e.id);
        // 达成目标才算过：胜局必须赢，和局守和即可
        if (r === 'win' || (r === 'draw' && e.target === 'draw')) {
          markEndgameCleared(e.id);
          updateRating('endgame', e.rating, true);
        } else {
          updateRating('endgame', e.rating, false);
        }
        checkIn();
        runEndgame(g, i); // "再来一次"
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
    const stage = stageFor(rs);
    const due = srsCount().due;
    const loss = lossProfile(10);
    const blocks = dailyPlan({
      stage,
      ratings: rs,
      loss,
      accuracy: (d) => recentAccuracy(d),
      dueCount: due,
      daysSinceQuiz: daysSinceQuiz(),
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
      go.textContent = '去下一局 →';
      go.onclick = onExit; // 回到象棋一级菜单，从那里进对弈
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
    const stage = stageFor(rs);
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
        <p><b>${rankOf(overall).name} · ${overall} 分</b>（本 App 内部刻度，粗略对照天天象棋
        <b>${ttNear(overall).name}</b>）。${
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
    const cur = stageFor(rs);
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
          .join('　')}</div>`;
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
  if (getDeclared()) showHome();
  else askLevel(showHome);

  return () => {
    clear();
    wrap.remove();
  };
}
