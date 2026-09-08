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
  totalSolved,
  getHistory,
  type Dim,
} from './save';
import { Assessment, diagnose, type AssessResult } from './assess';
import { loadPuzzles, pickNear, byId, type Puzzle, type PuzzleKind } from './puzzles';
import { runPuzzle } from './train';
import { STAGES, stageFor, graduateStatus, dailyPlan, focusDim, nextMilestone, type Block } from './curriculum';

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
  const clear = () => {
    disposeScreen?.();
    disposeScreen = null;
    wrap.innerHTML = '';
  };

  // ---------------- 首页 ----------------
  function showHome() {
    clear();
    const rs = getRatings();
    const overall = overallOf(rs);
    const rank = rankOf(overall);
    const ci = confidenceOf(rs);
    const assessed = isAssessed();
    const { streak } = getStreak();
    const srs = srsCount();
    const solved = totalSolved();

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-home';
    scr.innerHTML = `
      <h1>♟️ 学棋</h1>
      <div class="sub">${
        assessed
          ? `当前 <b>${rank.name}</b> · ${overall} 分 <span class="ci">±${ci}</span>`
          : '先花 20 分钟测一下，才知道该从哪儿练起'
      }</div>
      <div class="xq-chips">
        ${streak > 0 ? `<span class="xq-chip">🔥 连续 <b>${streak}</b> 天</span>` : ''}
        ${solved > 0 ? `<span class="xq-chip">✅ 做过 <b>${solved}</b> 题</span>` : ''}
        ${srs.due > 0 ? `<span class="xq-chip warn">📌 <b>${srs.due}</b> 道错题待复习</span>` : ''}
      </div>`;

    if (assessed) scr.appendChild(radarCard(rs));

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
        t: '🧩 专项练习',
        d: assessed
          ? `按你的水平出题。现在在${stage.emoji} 阶段${stage.id}，建议先练「${DIM_INFO[focusDim(stage, rs)].name}」。`
          : '五个方向随便挑一个练。测评之后这里会按你的水平自动调难度。',
        go: () => showPickDim(),
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
      <div class="sub">${rank.desc}</div>`;
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
      <p class="dim">⚠️ 说清楚题库的边界：现在这批题是引擎自动生成并逐题验证过的，
      难度最高约 <b>${res.ceiling || 1600}</b> 分，在 <b>900~1300</b> 这一段测得最准
      （实测偏差 ±60 以内）。如果你已经在这个区间之上，测出来的分会<b>偏低</b>，
      带 ≥ 号的那几项就是顶到天花板了——那时候看实战复盘的漏着数比看这个分更靠谱。</p>`;
    scr.appendChild(advice);

    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = `开始练「${DIM_INFO[rec].name}」`;
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
  function runOne(p: Puzzle, dim: Dim | null, caption: string, done: (ok: boolean) => void) {
    clear();
    const host = document.createElement('div');
    host.className = 'xq-coach-stage';
    wrap.appendChild(host);
    disposeScreen = runPuzzle(host, p, {
      caption,
      allowHint: true,
      onDone: (r) => {
        // 用了提示不算做对：算对了会把评分虚抬，下次出的题就偏难
        const ok = r.correct && !r.usedHint;
        // 错题重练不计分（dim 为 null）：那些题你见过，做对可能只是记住了答案，
        // 拿它涨分会把水平估高。复习只管有没有真的记牢，不管分数。
        if (dim) updateRating(dim, p.rating, ok);
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

  // ---------------- 今日训练 ----------------
  function showToday() {
    clear();
    const rs = getRatings();
    const stage = stageFor(rs);
    const focus = focusDim(stage, rs);
    const due = srsCount().due;
    const blocks = dailyPlan(stage, focus, due);
    const total = blocks.reduce((a, b) => a + b.minutes, 0);

    const scr = document.createElement('div');
    scr.className = 'screen xq-coach-report';
    scr.innerHTML = `
      <h1>今日训练</h1>
      <div class="sub">${stage.emoji} 阶段${stage.id} · ${stage.name} — ${stage.goal}</div>
      <div class="xq-chips"><span class="xq-chip">⏱ 约 <b>${total}</b> 分钟</span></div>`;

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
    startPractice(b.dim ?? weakestDim(getRatings()), b.count ?? 10, goNext, b.ratingBias ?? 40);
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

  showHome();

  return () => {
    clear();
    wrap.remove();
  };
}
