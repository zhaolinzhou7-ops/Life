/**
 * 首页、最近棋局、我的水平（棋风画像）。
 *
 * 规格第三条写得很明白：**首页不要堆功能**。用户也说"界面上的信息太多、太繁杂了"——
 * 所以首页只有三个入口，每个入口下面挂一句"现在的状态"：
 *   私教     → 今天的任务做了几项（练棋的一切都在私教里，一级一级往下选）
 *   下一盘   → 和 AI 下一盘
 *   我的棋局 → 上一盘输了还是赢了、最该改哪一手
 *
 * 这样做的理由：学习类产品的首页不该是功能菜单，该是**进度面板**。
 * 用户打开 App 的第一秒就该知道"今天该干什么"，而不是自己挑功能。
 */
import { Board2D } from './board2d';
import { buildProfile, type Profile } from './insight';
import { archiveFromBoard, getGame, listGames, openGame, type ArchivedGame } from './archive';
import { parseImport, parseMoves } from './explorer';
import { initialBoard, type Color } from './rules';
import { ERR_INFO } from './teach';
import { todayProgress } from './daytasks';
import { liftBack } from './navbar';
import {
  DIM_INFO,
  DIMS,
  getRatings,
  getStreak,
  isAssessed,
  honestLevel,
  getPlay,
  backfillPlay,
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
  /** 私教：一节课只讲一件事 */
  onTutor?: () => void;
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
  backfillPlay(games);
  const srs = srsCount();
  const streak = getStreak();
  const lv = honestLevel();
  const last = games[0];

  s.innerHTML = `
    <h1>楚河汉界</h1>
    <div class="sub">下棋 → 复盘 → 找到问题 → 专项训练 → 再下棋</div>`;

  // 顶部状态条：三个最该知道的数字
  const strip = document.createElement('div');
  strip.className = 'xq-home-strip';
  strip.innerHTML = `
    <div><b>${games.length}</b><span>对局</span></div>
    <div><b>${lv.source === 'play' ? rankOf(lv.r).name : isAssessed() ? `${rankOf(lv.r).name}?` : '未定'}</b><span>${lv.source === 'play' ? '实战水平' : '水平（待实战确认）'}</span></div>
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

  // 首页只留三件事（用户原话："界面上的信息太多、太繁杂了……布局、战术、杀法、残局这些内容到处都是，非常混乱。
  // 我希望有一个统一的私教入口"）：练棋全在私教里，一级一级往下选；下棋；看自己的棋。
  const list = document.createElement('div');
  list.className = 'card-list';
  const prog = todayProgress();
  const coach = card(
    '🧑‍🏫 私教',
    !isAssessed() && !games.length
      ? '第一次来：先做个水平测评，之后每天给你排好任务。'
      : prog
        ? prog.done >= prog.total
          ? '今天的任务都做完了 ✓ 想多练可以自己选。'
          : `今天的任务做了 ${prog.done}/${prog.total}，接着做。`
        : '今天的任务排好了：错题、私教课、专项、实战，二三十分钟。',
    srs.due > 0 ? `${srs.due}` : '',
    act.onTutor ?? act.onTrainToday,
  );
  coach.classList.add('primary');
  coach.dataset.home = 'coach';
  list.appendChild(coach);
  const playCard = card('⚔️ 下一盘', '和 AI 下一盘完整的棋，教练在旁边看着。', '', act.onPlay);
  playCard.dataset.home = 'play';
  list.appendChild(playCard);
  const gamesCard = card(
    '📖 我的棋局',
    last
      ? `上一盘：${last.d} · ${esc(last.level)} · ${resultText(last)}${last.review?.headline ? ` —— ${esc(last.review.headline)}` : ''}`
      : '下完的棋都存在这里：逐手复盘、找回好棋，也能导入别处的棋谱。',
    last && !last.review ? '未分析' : '',
    () => act.onReview(),
  );
  gamesCard.dataset.home = 'games';
  list.appendChild(gamesCard);
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

  // 导入一盘棋来复盘：天天象棋、东萍、象棋巫师复制出来的中文棋谱都行。导进来的棋照样逐手打分、
  // 走错的存进错题本，私教也拿它当证据（象棋巫师、东萍"读棋谱"那一块）
  const imp = document.createElement('button');
  imp.className = 'btn';
  imp.dataset.act = 'import-game';
  imp.textContent = '📥 导入棋谱复盘（天天象棋等复制来的棋谱）';
  imp.onclick = () => {
    const form = document.createElement('div');
    form.className = 'xq-import-form';
    form.innerHTML = `<b>导入一盘棋</b>
      <p class="dim">粘贴整盘的中文棋谱，比如"1. 炮二平五 马8进7 2. 马二进三 车9平8 ……"（回合号可有可无）。导进来照样逐手打分、走错的存进错题本，私教也会参考。</p>
      <textarea rows="6" data-imp-text></textarea>
      <div class="row">你执：<label><input type="radio" name="imp-side" value="r" checked> 红</label><label><input type="radio" name="imp-side" value="b"> 黑</label></div>
      <div class="row">结果：<label><input type="radio" name="imp-res" value="win" checked> 赢</label><label><input type="radio" name="imp-res" value="loss"> 输</label><label><input type="radio" name="imp-res" value="draw"> 和</label></div>
      <div class="err" data-imp-err></div>
      <button class="btn" data-imp-go>导入并复盘</button>`;
    imp.replaceWith(form);
    (form.querySelector('[data-imp-go]') as HTMLButtonElement).onclick = () => {
      const text = (form.querySelector('[data-imp-text]') as HTMLTextAreaElement).value;
      const err = form.querySelector('[data-imp-err]') as HTMLElement;
      const r = parseImport(text);
      if (!r.moves || r.moves.length < 4) {
        err.textContent = r.fen ? '这里要整盘的棋谱（着法），FEN 请到"开局浏览器"里导入。' : r.error ?? '至少要四手棋';
        return;
      }
      const moves = parseMoves(r.moves);
      if (!moves) {
        err.textContent = '棋谱走不通';
        return;
      }
      const side = (form.querySelector('input[name="imp-side"]:checked') as HTMLInputElement).value as Color;
      const result = (form.querySelector('input[name="imp-res"]:checked') as HTMLInputElement).value as ArchivedGame['result'];
      const id = archiveFromBoard(initialBoard(), 'r', moves, { side, result, level: '导入的棋谱' });
      const g = getGame(id);
      if (g) onOpen(g);
    };
  };
  const back = document.createElement('button');
  back.className = 'btn ghost';
  back.textContent = '← 返回';
  back.onclick = onBack;
  s.appendChild(imp);
  s.appendChild(back);
  liftBack(s, '我的棋局');
  return () => s.remove();
}

// ───────────────────────── 我的水平 ─────────────────────────

export function renderLevel(host: HTMLElement, onBack: () => void, onAssess: () => void): () => void {
  const s = document.createElement('div');
  s.className = 'screen xq-setup xq-level';
  host.appendChild(s);
  const thumbs: Board2D[] = [];

  const games = listGames();
  backfillPlay(games);
  const profile = buildProfile(games);
  const rs = getRatings();
  const lv = honestLevel();
  const play = getPlay();
  const ps = playStats();
  const acc = recentGameAccuracy(10);

  s.innerHTML = `<h1>我的水平</h1><div class="sub">全部来自你自己的对局和做题记录</div>`;

  // ---- 段位 ----
  const rank = document.createElement('div');
  rank.className = 'xq-rankbox';
  // 水平以实战为准：跟 AI 下棋的输赢。做题分只看五维里哪一维弱
  const recentPlay = play?.log.slice(-5).map((x) => `${x.who}${x.res === 1 ? '胜' : x.res === 0.5 ? '和' : '负'}`).join('、');
  rank.innerHTML =
    lv.source === 'play'
      ? `<div class="big">${rankOf(lv.r).name}</div>
       <div class="num">实战分 ${lv.r}</div>
       <div class="note">${rankOf(lv.r).desc}。按 ${lv.games} 盘对弈的输赢算的${recentPlay ? `（最近：${recentPlay}）` : ''}，
       粗略相当于天天象棋「${ttNear(lv.r).name}」——两边的尺子不是同一把，只能当个粗对照。
       ${lv.note ? `<br><b>${lv.note}</b>` : ''}</div>`
      : isAssessed()
        ? `<div class="big">${rankOf(lv.r).name}？</div>
       <div class="num">做题估分 ${lv.r}（待实战确认）</div>
       <div class="note">${lv.note}<br>做题分只说明你<b>会不会做题</b>：题是静止的、知道这里有棋，实战里没人提醒你。
       所以你是什么水平，最终看你下得赢哪一档对手。</div>`
        : `<div class="big">还没测</div>
       <div class="note">测一次大约 20 分钟，题目难度会跟着你的表现自动调。测完、再下几盘棋，才知道你的水平和该先练哪一块。</div>`;
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
  dimSec.textContent = '五项能力（做题分，只用来比哪一项弱）';
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
  liftBack(s, '私教 › 水平和进步 › 棋风画像');

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
