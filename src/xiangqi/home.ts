/**
 * 首页、最近棋局、我的水平。
 *
 * 规格第三条写得很明白：**首页不要堆功能**。所以这里只有五个入口，
 * 而且每个入口下面挂一句"现在的状态"——不是功能说明，是当前数据：
 *   今日训练 → 今天还有几道错题要复习
 *   棋局复盘 → 上一盘输了还是赢了、最该改哪一手
 *   我的水平 → 现在几段、最近在犯什么毛病
 *
 * 这样做的理由：学习类产品的首页不该是功能菜单，该是**进度面板**。
 * 用户打开 App 的第一秒就该知道"今天该干什么"，而不是自己挑功能。
 */
import { Board2D } from './board2d';
import {
  buildProfile,
  trainingFocus,
  type Profile,
} from './insight';
import { listGames, openGame, type ArchivedGame } from './archive';
import { ERR_INFO } from './teach';
import {
  DIM_INFO,
  DIMS,
  getRatings,
  getStreak,
  isAssessed,
  overallOf,
  getGames,
  playStats,
  recentGameAccuracy,
  rankOf,
  srsCount,
  totalSolved,
  ttNear,
} from './save';

export interface HomeActions {
  onPlay: () => void;
  onTrainToday: () => void;
  onPuzzles: () => void;
  /** 打开某一盘的复盘；没传 id 就打开最近一盘 */
  onReview: (id?: string) => void;
  onLevel: () => void;
  onExit: () => void;
  /**
   * 有一盘没下完的棋（被系统杀掉的后台页面、刷新、手滑关掉）。
   * 手机浏览器切到后台一会儿就可能被回收，辛辛苦苦下了三十步的棋不能就这么没了。
   */
  resume?: { label: string; go: () => void; drop: () => void };
}

const card = (title: string, desc: string, badge: string, go: () => void): HTMLElement => {
  const el = document.createElement('button');
  el.className = 'card home-card xq-home-card';
  el.innerHTML = `
    <div class="title">${title}</div>
    <div class="desc">${desc}</div>
    ${badge ? `<div class="xq-home-badge">${badge}</div>` : ''}`;
  el.onclick = go;
  return el;
};

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

/** 一盘棋的结果文字 */
const resultText = (g: ArchivedGame) => (g.result === 'win' ? '胜' : g.result === 'loss' ? '负' : '和');

// ───────────────────────── 首页 ─────────────────────────

export function renderHome(host: HTMLElement, act: HomeActions): () => void {
  const s = document.createElement('div');
  s.className = 'screen xq-setup xq-home';
  host.appendChild(s);

  const games = listGames();
  const profile = buildProfile(games);
  const srs = srsCount();
  const streak = getStreak();
  const rs = getRatings();
  const overall = overallOf(rs);
  const last = games[0];

  s.innerHTML = `
    <h1>楚河汉界</h1>
    <div class="sub">下棋 → 复盘 → 找到问题 → 专项训练 → 再下棋</div>`;

  // 顶部状态条：三个最该知道的数字
  const strip = document.createElement('div');
  strip.className = 'xq-home-strip';
  strip.innerHTML = `
    <div><b>${games.length}</b><span>对局</span></div>
    <div><b>${isAssessed() ? rankOf(overall).name : '未测'}</b><span>水平</span></div>
    <div><b>${streak.streak}</b><span>天连续</span></div>`;
  s.appendChild(strip);

  if (act.resume) {
    const r = act.resume;
    const box = document.createElement('div');
    box.className = 'xq-resume';
    box.innerHTML = `
      <div class="txt"><b>⏯ 有一盘没下完</b><span></span></div>
      <button class="xq-btn primary" data-act="go">继续</button>
      <button class="xq-btn" data-act="drop">不要了</button>`;
    (box.querySelector('.txt span') as HTMLElement).textContent = r.label;
    box.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
      if (a === 'go') r.go();
      else if (a === 'drop') {
        r.drop();
        box.remove();
      }
    });
    s.appendChild(box);
  }

  const list = document.createElement('div');
  list.className = 'card-list';

  // ① 开始对弈
  list.appendChild(
    card(
      '⚔️ 开始对弈',
      '和 AI 下一盘完整的棋。教练会在旁边看着，走出明显有问题的一手会提醒你。',
      '',
      act.onPlay,
    ),
  );

  // ② 今日训练
  const focus = trainingFocus(profile);
  list.appendChild(
    card(
      '🎯 今日训练',
      srs.due > 0
        ? `今天有 ${srs.due} 道错题要复习，另外按你最近的问题安排了${DIM_INFO[focus.kind].name}练习。`
        : profile.enough
          ? focus.why
          : '按你的水平安排今天练什么。还没测过水平的话，会先花几分钟测一下。',
      srs.due > 0 ? `${srs.due}` : '',
      act.onTrainToday,
    ),
  );

  // ③ 棋局复盘
  list.appendChild(
    card(
      '📖 棋局复盘',
      last
        ? `上一盘：${last.d} · ${esc(last.level)} · ${resultText(last)}${
            last.review?.headline ? ` —— ${esc(last.review.headline)}` : ''
          }`
        : '还没有棋局记录。下完一盘之后，这里可以逐手看你走得怎么样。',
      last && !last.review ? '未分析' : '',
      () => act.onReview(),
    ),
  );

  // ④ 战术训练
  list.appendChild(
    card(
      '🧩 战术训练',
      `杀法、捉双、牵制、残局——分类专项练。已经做对 ${totalSolved()} 道。`,
      '',
      act.onPuzzles,
    ),
  );

  // ⑤ 我的水平
  list.appendChild(
    card(
      '📊 我的水平',
      profile.enough && profile.habits.length
        ? `你最常犯的是「${profile.habits[0].name}」。点进来看完整的棋风画像。`
        : isAssessed()
          ? `当前 ${rankOf(overall).name} · ${overall} 分。五维能力、对局统计都在这里。`
          : '还没测过水平。测一次大约 20 分钟，之后练什么都按你的短板安排。',
      '',
      act.onLevel,
    ),
  );

  s.appendChild(list);

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← 返回合集首页';
  back.onclick = act.onExit;
  s.appendChild(back);

  return () => s.remove();
}

// ───────────────────────── 最近棋局 ─────────────────────────

export function renderGameList(
  host: HTMLElement,
  onOpen: (g: ArchivedGame) => void,
  onBack: () => void,
): () => void {
  const s = document.createElement('div');
  s.className = 'screen xq-setup xq-gamelist';
  host.appendChild(s);
  const games = listGames();

  s.innerHTML = `<h1>最近棋局</h1><div class="sub">点一盘，逐手看你走得怎么样</div>`;

  if (!games.length) {
    const empty = document.createElement('div');
    empty.className = 'xq-empty';
    empty.innerHTML = `
      <div class="big">还没有下过棋</div>
      <div>下完一盘之后，整盘棋会自动存在这里。<br>随时能翻回来，看每一手的好坏和该走什么。</div>`;
    s.appendChild(empty);
  } else {
    const list = document.createElement('div');
    list.className = 'xq-glist';
    for (const g of games) {
      const row = document.createElement('button');
      row.className = `xq-grow ${g.result}`;
      const plies = Math.ceil(g.moves.length / 4 / 2);
      const rv = g.review;
      row.innerHTML = `
        <span class="r">${resultText(g)}</span>
        <span class="mid">
          <b>${esc(g.level)}${g.rival ? ` · ${esc(g.rival)}` : ''}</b>
          <i>${g.d} · ${plies} 回合 · 执${g.side === 'r' ? '红' : '黑'}</i>
        </span>
        <span class="tail">${
          rv
            ? `${typeof rv.accuracy === 'number' ? `<em class="acc">准确率 ${rv.accuracy}</em>` : ''}<em class="${rv.blunders ? 'bad' : ''}">漏着 ${rv.blunders}</em><em>失误 ${rv.mistakes}</em>`
            : '<em class="dim">未分析</em>'
        }</span>`;
      row.onclick = () => onOpen(g);
      list.appendChild(row);
    }
    s.appendChild(list);
  }

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← 返回';
  back.onclick = onBack;
  s.appendChild(back);
  return () => s.remove();
}

// ───────────────────────── 我的水平 ─────────────────────────

export function renderLevel(host: HTMLElement, onBack: () => void, onAssess: () => void): () => void {
  const s = document.createElement('div');
  s.className = 'screen xq-setup xq-level';
  host.appendChild(s);
  const thumbs: Board2D[] = [];

  const games = listGames();
  const profile = buildProfile(games);
  const rs = getRatings();
  const overall = overallOf(rs);
  const ps = playStats();
  const acc = recentGameAccuracy(10);

  s.innerHTML = `<h1>我的水平</h1><div class="sub">全部来自你自己的对局和做题记录</div>`;

  // ---- 段位 ----
  const rank = document.createElement('div');
  rank.className = 'xq-rankbox';
  rank.innerHTML = isAssessed()
    ? `<div class="big">${rankOf(overall).name}</div>
       <div class="num">${overall} 分</div>
       <div class="note">${rankOf(overall).desc}。大致相当于天天象棋的「${ttNear(overall).name}」，
       但两边的尺子本来就不是同一把，只能当个粗对照。</div>`
    : `<div class="big">还没测</div>
       <div class="note">测一次大约 20 分钟，题目难度会跟着你的表现自动调。测完才知道该先练哪一块。</div>`;
  s.appendChild(rank);

  if (!isAssessed()) {
    const go = document.createElement('button');
    go.className = 'btn';
    go.textContent = '开始测评';
    go.onclick = onAssess;
    s.appendChild(go);
  }

  // ---- 五维 ----
  const dimSec = document.createElement('div');
  dimSec.className = 'xq-sec';
  dimSec.textContent = '五项能力';
  s.appendChild(dimSec);
  const bars = document.createElement('div');
  bars.className = 'xq-dims';
  const maxR = Math.max(1600, ...DIMS.map((d) => rs[d].r));
  for (const d of DIMS) {
    const r = rs[d];
    const row = document.createElement('div');
    row.className = 'xq-dimrow';
    row.innerHTML = `
      <span class="nm">${DIM_INFO[d].emoji} ${DIM_INFO[d].name}</span>
      <span class="bar"><i style="width:${Math.max(4, (r.r / maxR) * 100)}%"></i></span>
      <span class="v">${r.n ? r.r : '—'}</span>`;
    row.title = DIM_INFO[d].desc;
    bars.appendChild(row);
  }
  s.appendChild(bars);

  // ---- 对局统计 ----
  const statSec = document.createElement('div');
  statSec.className = 'xq-sec';
  statSec.textContent = '对局统计';
  s.appendChild(statSec);
  const stats = document.createElement('div');
  stats.className = 'xq-statgrid';
  stats.innerHTML = `
    <div><b>${profile.games}</b><span>总对局</span></div>
    <div><b>${profile.wins}</b><span>胜</span></div>
    <div><b>${profile.losses}</b><span>负</span></div>
    <div><b>${profile.draws}</b><span>和</span></div>
    <div><b>${acc ? acc.avg : '—'}</b><span>近期准确率</span></div>
    <div><b>${ps ? ps.avgLoss : '—'}</b><span>平均每手亏</span></div>
    <div><b>${ps ? `${ps.winRate}%` : '—'}</b><span>近期胜率</span></div>
    <div><b>${totalSolved()}</b><span>做对的题</span></div>`;
  s.appendChild(stats);

  if (ps?.trend != null) {
    const t = document.createElement('div');
    t.className = `xq-trend ${ps.trend > 0 ? 'up' : 'down'}`;
    t.textContent =
      ps.trend > 0
        ? `📉 和更早的对局比，你平均每手少亏 ${ps.trend} 分——在涨棋。`
        : `📈 最近平均每手多亏 ${-ps.trend} 分，可能是在挑战更难的对手，也可能是状态问题。`;
    s.appendChild(t);
  }

  /*
   * 准确率走势：最近几盘一盘一根柱子。
   * 跟自己比才有意义——准确率和对手强弱、局面复杂度都有关系，
   * 但同一个人连着下，柱子往上走就是在涨棋。
   */
  const accs = getGames()
    .filter((g) => typeof g.accuracy === 'number')
    .slice(-12);
  if (accs.length >= 2) {
    const sec = document.createElement('div');
    sec.className = 'xq-sec';
    sec.textContent = '准确率走势（最近几盘）';
    s.appendChild(sec);
    const bars = document.createElement('div');
    bars.className = 'xq-accbars';
    bars.innerHTML = accs
      .map((g) => {
        const a = g.accuracy ?? 0;
        const tone = a >= 85 ? 'hi' : a >= 65 ? 'mid' : 'lo';
        return `<div class="bar ${tone}" title="${g.d}"><i style="height:${Math.max(6, a)}%"></i><span>${a}</span></div>`;
      })
      .join('');
    s.appendChild(bars);
  }

  // ---- 错误画像 ----
  const pSec = document.createElement('div');
  pSec.className = 'xq-sec';
  pSec.textContent = '我的棋风画像';
  s.appendChild(pSec);
  s.appendChild(renderProfile(profile));

  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← 返回';
  back.onclick = onBack;
  s.appendChild(back);

  return () => {
    for (const t of thumbs) t.dispose();
    s.remove();
  };
}

/**
 * 画像区块。
 *
 * 样本不够的时候**显示的是"还不够"**，而不是随便给几个标签。
 * 这一条是产品规格里点名的：不能凭空给用户贴标签。
 */
export function renderProfile(p: Profile): HTMLElement {
  const box = document.createElement('div');
  box.className = 'xq-profile';

  const sum = document.createElement('div');
  sum.className = 'xq-profile-sum';
  sum.innerHTML = p.summary.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\n\n/g, '<br><br>');
  box.appendChild(sum);

  if (!p.enough) return box;

  if (p.traits.length) {
    const traits = document.createElement('div');
    traits.className = 'xq-traits';
    for (const t of p.traits) {
      const el = document.createElement('div');
      el.className = `xq-trait ${t.tone}`;
      el.innerHTML = `
        <div class="h">${t.tone === 'good' ? '✅' : '⚠️'} ${esc(t.name)}</div>
        <div class="d">${esc(t.desc)}</div>
        <div class="e">依据：${esc(t.evidence)}</div>`;
      traits.appendChild(el);
    }
    box.appendChild(traits);
  }

  if (p.habits.length) {
    const hSec = document.createElement('div');
    hSec.className = 'xq-habits';
    hSec.innerHTML = '<div class="hd">常犯的错误</div>';
    for (const h of p.habits) {
      const el = document.createElement('div');
      el.className = 'xq-habit';
      el.innerHTML = `
        <div class="top"><b>${esc(h.name)}</b><span>${h.count} 次 · ${h.games} 盘出现过</span></div>
        <div class="bar"><i style="width:${Math.round(h.share * 100)}%"></i></div>
        <div class="ad">${esc(ERR_INFO[h.tag].desc)}。<b>${esc(h.advice)}</b></div>`;
      hSec.appendChild(el);
    }
    box.appendChild(hSec);
  }
  return box;
}

/** 从存档打开一盘棋，读不出来时给上层一个明确的失败 */
export const openArchived = openGame;
