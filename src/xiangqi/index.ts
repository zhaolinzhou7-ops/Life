/** 象棋启动入口：开局设置（难度/棋子材质/对手）→ 玩家执红 vs AI 执黑 */
import {
  applyMove,
  cloneBoard,
  findKing,
  initialBoard,
  isInCheck,
  legalMoves,
  statusAfter,
  type Board,
  type Move,
} from './rules';
import { disposeAi, requestMove, warmupAi } from './aiclient';
import { runReview } from './review';
import { runCoach } from './coach';
import { renderGameList, renderHome, renderLevel } from './home';
import { archiveFromBoard, listGames as listArchived, openGame, type ArchivedGame } from './archive';
import {
  HINT_LEVELS,
  checkMove,
  getHintLevel,
  setHintLevel,
  showCoachPrompt,
  type HintLevel,
} from './livecoach';
import { initCoachProvider } from './llm';
import { XiangqiScene, type PieceTheme } from './scene3d';
import {
  isMuted,
  setMuted,
  sfxAlert,
  sfxKnock,
  sfxLose,
  sfxSlash,
  sfxTap,
  sfxWinBig,
  speak,
  startBgm,
  stopBgm,
  unlockAudio,
} from '../gamesfx';
import { CHARACTERS, avatarCanvas, pickLine, type Character } from '../characters';

// 深度是实测能跑到的层数（引擎约 140 万节点/秒），不是名义上限。
// jitter 是评估扰动，只给低难度用来模拟"看走眼"，高难度必须为 0。

/**
 * 对局节奏。
 *
 * 上一版把动画全删了之后出现一个新问题：**你一落子对方立刻就走**，
 * 没有一点下棋的呼吸感，很机械。但这跟"棋子位置不对"那个 bug 不是一回事——
 * 那个是把棋子抬离盘面，这个只是节奏。所以节奏可以调，悬浮不会回来。
 *
 * 两个参数：
 *   slide 落子平移的时长（棋子贴着盘面滑过去，永远以精确落点收尾）
 *   think 对手最少"想"多久。搜索本身在 Worker 里跑，这里只是不让它
 *         比这个时间更早把结果甩出来——真人不会零点二秒就落子。
 */
const TEMPOS = [
  { id: 'fast', name: '明快', desc: '落子即到，对手几乎秒回', slide: 0, think: 0 },
  { id: 'natural', name: '自然', desc: '有落子动作，对手会想一下（推荐）', slide: 0.22, think: 900 },
  { id: 'slow', name: '沉稳', desc: '慢一些，像面对面下棋', slide: 0.34, think: 1600 },
] as const;

/**
 * 五档难度。
 *
 * 弱档**不是随机走棋**——随机走棋会走出人类绝不会走的怪棋，
 * 陪练价值等于零，而且新手照着学会学坏。这里的做法是让引擎照常搜索，
 * 但给评估函数加扰动（jitter）并压低层数：它仍然遵守全部棋规、仍然会
 * 吃明显的子，只是**会看走眼**——和真正的初学者犯的错是同一类。
 *
 * 「专家」档留给以后接更强的引擎，现在不放空壳子占位。
 */
const LEVELS = [
  { id: 0, name: '入门', desc: '刚学会走子，常看走眼', depth: 2, jitter: 200, timeMs: 200 },
  { id: 1, name: '初级', desc: '会吃子，不太会算', depth: 4, jitter: 90, timeMs: 400 },
  { id: 2, name: '中级', desc: '有基本战术，抓得住漏着', depth: 7, jitter: 20, timeMs: 900 },
  { id: 3, name: '高级', desc: '算 10 层，抓子抓杀', depth: 10, jitter: 0, timeMs: 1800 },
  { id: 4, name: '大师', desc: '算 14 层，不留情面', depth: 14, jitter: 0, timeMs: 3500 },
];

const THEMES: { id: PieceTheme; name: string; emoji: string; desc: string }[] = [
  { id: 'jade', name: '和田玉', emoji: '💚', desc: '温润通透，金线刻字' },
  { id: 'wood', name: '紫檀木', emoji: '🟤', desc: '古朴厚重，传统手感' },
  { id: 'porcelain', name: '青花瓷', emoji: '🔷', desc: '洁白釉面，靛蓝刻痕' },
];

export function bootXiangqi(app: HTMLElement, onExit: (restart: boolean) => void): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-root';
  app.appendChild(wrap);

  let cleanupGame: (() => void) | null = null;
  let setupEl: HTMLElement | null = null;
  let disposeCoach: (() => void) | null = null;

  // 讲解器：配了后端就用后端（密钥留在后端，前端只发事实），没配就用离线模板。
  // 离线模板不是降级方案——没有任何 API 也必须能完整学棋。
  initCoachProvider(import.meta.env.VITE_COACH_API as string | undefined);

  const unlock = () => unlockAudio();
  window.addEventListener('pointerdown', unlock, { once: true });

  const clearAll = () => {
    cleanupGame?.();
    cleanupGame = null;
    disposeCoach?.();
    disposeCoach = null;
    setupEl?.remove();
    setupEl = null;
  };

  // ============ 首页：规格里的五个入口 ============
  //
  // 首页不堆功能，每个入口下面挂的是**当前状态**而不是功能说明——
  // 打开 App 第一秒就该知道今天该干什么，而不是自己在菜单里挑。
  function showHome() {
    clearAll();
    const dispose = renderHome(wrap, {
      onPlay: () => showSetup(),
      onTrainToday: () => openCoach('today'),
      onPuzzles: () => openCoach('puzzles'),
      onReview: (id) => showGameList(id),
      onLevel: () => showLevel(),
      onExit: () => onExit(false),
    });
    setupEl = { remove: dispose } as unknown as HTMLElement;
  }

  /** 打开学棋模块（测评 / 课程 / 题库都在里面） */
  function openCoach(_entry: 'today' | 'puzzles') {
    clearAll();
    disposeCoach = runCoach(wrap, showHome, (strip, depth, onFinish) => {
      // 让子定级的对局交回对弈流程：那边已经有完整的棋盘、复盘和结算
      disposeCoach?.();
      disposeCoach = null;
      const lv = Math.max(0, Math.min(LEVELS.length - 1, depth >= 14 ? 4 : depth >= 10 ? 3 : 2));
      startGame(
        lv,
        (localStorage.getItem('xq-theme') ?? 'jade') as PieceTheme,
        CHARACTERS[Number(localStorage.getItem('xq-rival') ?? 0) % CHARACTERS.length],
        (localStorage.getItem('xq-facing') ?? 'duel') === 'duel',
        Number(localStorage.getItem('xq-tempo') ?? 1),
        { strip, depth, onFinish },
      );
    });
  }

  // ============ 最近棋局 ============
  function showGameList(preferId?: string) {
    clearAll();
    const dispose = renderGameList(wrap, (g) => openArchivedReview(g), showHome);
    setupEl = { remove: dispose } as unknown as HTMLElement;
    // 首页那张"棋局复盘"卡片直接点进来时，自动打开最近一盘
    if (preferId) {
      const g = listArchived().find((x) => x.id === preferId);
      if (g) openArchivedReview(g);
    }
  }

  // ============ 我的水平 ============
  function showLevel() {
    clearAll();
    const dispose = renderLevel(wrap, showHome, () => openCoach('today'));
    setupEl = { remove: dispose } as unknown as HTMLElement;
  }

  /**
   * 复盘一盘**存档里的**棋。
   *
   * 和对局结束后的复盘走的是同一套 runReview，区别只在于棋盘要自己造一个——
   * 那时候场上有现成的 3D 棋盘，这里没有。两条路共用同一套分析和界面，
   * 就不会出现"历史复盘和刚下完的复盘讲得不一样"这种事。
   */
  function openArchivedReview(g: ArchivedGame) {
    const opened = openGame(g);
    clearAll();
    if (!opened) {
      const bad = document.createElement('div');
      bad.className = 'screen xq-setup';
      bad.innerHTML = '<h1>这盘棋读不出来</h1><div class="sub">存档可能损坏了，换一盘看看。</div>';
      const back = document.createElement('button');
      back.className = 'btn ghost';
      back.textContent = '← 返回';
      back.onclick = () => showGameList();
      bad.appendChild(back);
      wrap.appendChild(bad);
      setupEl = bad;
      return;
    }
    const theme = (localStorage.getItem('xq-theme') ?? 'jade') as PieceTheme;
    const scene = new XiangqiScene(wrap, () => {}, theme, (localStorage.getItem('xq-facing') ?? 'duel') === 'duel');
    scene.syncBoard(opened.start);
    const closeRv = runReview({
      host: wrap,
      scene,
      startBoard: opened.start,
      startColor: opened.startColor,
      moves: opened.moves,
      playerColor: g.side,
      playerWon: g.result === 'win',
      archiveId: g.id,
      onClose: () => {
        cleanupGame?.();
        showGameList();
      },
    });
    cleanupGame = () => {
      closeRv();
      scene.dispose();
      disposeAi();
      cleanupGame = null;
    };
  }

  // ============ 开局设置界面 ============
  function showSetup() {
    clearAll();

    let level = Number(localStorage.getItem('xq-level') ?? 1);
    let theme = (localStorage.getItem('xq-theme') ?? 'jade') as PieceTheme;
    let rival = Number(localStorage.getItem('xq-rival') ?? 2);
    let facing = (localStorage.getItem('xq-facing') ?? 'duel') as 'duel' | 'me';
    let tempo = Math.max(0, Math.min(TEMPOS.length - 1, Number(localStorage.getItem('xq-tempo') ?? 1)));
    let hint: HintLevel = getHintLevel();

    const s = document.createElement('div');
    s.className = 'screen xq-setup';
    setupEl = s;

    const render = () => {
      s.innerHTML = `<h1>楚河汉界</h1><div class="sub">选对手 · 定难度 · 挑棋子</div>`;

      // 对手
      const rivalLabel = document.createElement('div');
      rivalLabel.className = 'xq-sec';
      rivalLabel.textContent = '选择对手';
      s.appendChild(rivalLabel);
      const rivalRow = document.createElement('div');
      rivalRow.className = 'xq-rivals';
      CHARACTERS.forEach((c, i) => {
        const card = document.createElement('div');
        card.className = 'xq-rival' + (i === rival ? ' on' : '');
        card.style.setProperty('--c', c.color);
        card.appendChild(avatarCanvas(c, 76, i === rival ? 'happy' : 'idle'));
        const nm = document.createElement('div');
        nm.className = 'nm';
        nm.textContent = c.name;
        const st = document.createElement('div');
        st.className = 'st';
        st.textContent = c.style;
        card.appendChild(nm);
        card.appendChild(st);
        card.onclick = () => {
          rival = i;
          sfxTap();
          render();
        };
        rivalRow.appendChild(card);
      });
      s.appendChild(rivalRow);

      // 难度
      const lvLabel = document.createElement('div');
      lvLabel.className = 'xq-sec';
      lvLabel.textContent = '难度';
      s.appendChild(lvLabel);
      const lvRow = document.createElement('div');
      lvRow.className = 'diff-row';
      LEVELS.forEach((L) => {
        const card = document.createElement('div');
        card.className = 'card' + (L.id === level ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${L.name}</div>
          <div class="desc" style="text-align:center">${L.desc}</div>`;
        card.onclick = () => {
          level = L.id;
          sfxTap();
          render();
        };
        lvRow.appendChild(card);
      });
      s.appendChild(lvRow);

      // 棋子材质
      const thLabel = document.createElement('div');
      thLabel.className = 'xq-sec';
      thLabel.textContent = '棋子材质';
      s.appendChild(thLabel);
      const thRow = document.createElement('div');
      thRow.className = 'diff-row';
      THEMES.forEach((T) => {
        const card = document.createElement('div');
        card.className = 'card' + (T.id === theme ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${T.emoji} ${T.name}</div>
          <div class="desc" style="text-align:center">${T.desc}</div>`;
        card.onclick = () => {
          theme = T.id;
          sfxTap();
          render();
        };
        thRow.appendChild(card);
      });
      s.appendChild(thRow);

      // 棋子朝向
      const fLabel = document.createElement('div');
      fLabel.className = 'xq-sec';
      fLabel.textContent = '棋子朝向';
      s.appendChild(fLabel);
      const fRow = document.createElement('div');
      fRow.className = 'diff-row';
      ([['duel', '对坐摆放', '黑方字朝对面，像真人对弈'], ['me', '全部朝我', '双方字都朝你，方便识读']] as const).forEach(([id, nm, ds]) => {
        const card = document.createElement('div');
        card.className = 'card' + (facing === id ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${nm}</div>
          <div class="desc" style="text-align:center">${ds}</div>`;
        card.onclick = () => { facing = id; sfxTap(); render(); };
        fRow.appendChild(card);
      });
      s.appendChild(fRow);

      // 动画速度
      const tLabel = document.createElement('div');
      tLabel.className = 'xq-sec';
      tLabel.textContent = '对局节奏';
      s.appendChild(tLabel);
      const tRow = document.createElement('div');
      tRow.className = 'diff-row';
      TEMPOS.forEach((tp, i) => {
        const card = document.createElement('div');
        card.className = 'card' + (tempo === i ? ' selected' : '');
        card.innerHTML = `<div class="title" style="justify-content:center">${tp.name}</div>
          <div class="desc" style="text-align:center">${tp.desc}</div>`;
        card.onclick = () => { tempo = i; sfxTap(); render(); };
        tRow.appendChild(card);
      });
      s.appendChild(tRow);

      // 教练模式：这是本产品和普通对弈软件最大的区别，所以放在"开始"上面
      const hLabel = document.createElement('div');
      hLabel.className = 'xq-sec';
      hLabel.textContent = '教练模式';
      s.appendChild(hLabel);
      const hRow = document.createElement('div');
      hRow.className = 'diff-row';
      HINT_LEVELS.forEach((h) => {
        const c = document.createElement('div');
        c.className = 'card' + (hint === h.id ? ' selected' : '');
        c.innerHTML = `<div class="title" style="justify-content:center">${h.name}</div>
          <div class="desc" style="text-align:center">${h.desc}</div>`;
        c.onclick = () => { hint = h.id; sfxTap(); render(); };
        hRow.appendChild(c);
      });
      s.appendChild(hRow);
      const hNote = document.createElement('div');
      hNote.className = 'xq-note';
      hNote.textContent = '教练不会替你走棋，也不拦着你——只在你要掉坑的时候说一句，走不走由你定。';
      s.appendChild(hNote);

      const go = document.createElement('button');
      go.className = 'btn';
      go.textContent = '⚔️ 开始对弈';
      go.onclick = () => {
        localStorage.setItem('xq-level', String(level));
        localStorage.setItem('xq-theme', theme);
        localStorage.setItem('xq-rival', String(rival));
        localStorage.setItem('xq-facing', facing);
        localStorage.setItem('xq-tempo', String(tempo));
        setHintLevel(hint);
        s.remove();
        setupEl = null;
        startGame(level, theme, CHARACTERS[rival], facing === 'duel', tempo);
      };
      s.appendChild(go);

      const back = document.createElement('button');
      back.className = 'btn ghost';
      back.textContent = '← 返回首页';
      back.onclick = () => showHome();
      s.appendChild(back);
    };
    render();
    wrap.appendChild(s);
  }

  // ============ 对局 ============
  /**
   * @param handicap 让子局：对手（黑方）少几个马，以及固定的搜索深度；
   *                 下完把胜负回给 onFinish，由定级阶梯决定升降档
   */
  function startGame(
    level: number,
    theme: PieceTheme,
    rival: Character,
    flipBlack: boolean,
    tempoIdx = 1,
    handicap?: { strip: number; depth: number; onFinish: (won: boolean) => void },
  ) {
    const TEMPO = TEMPOS[Math.max(0, Math.min(TEMPOS.length - 1, tempoIdx))];
    const L = LEVELS[level];
    let board: Board = initialBoard();
    // 让子：把黑方的马拿掉。让子是教练给学生定级最老实的办法——
    // 让你两个马能赢、让一个马赢不了，水平就卡在这两档之间。
    if (handicap?.strip) {
      const spots: [number, number][] = [[1, 0], [7, 0]];
      for (let i = 0; i < handicap.strip && i < spots.length; i++) {
        const [hx, hy] = spots[i];
        board[hy][hx] = null;
      }
    }
    /**
     * 这一局真正的起始局面。
     *
     * 让子局不是标准开局，所以"重开"和"复盘"都不能拿 initialBoard() 当起点：
     * 重开会把让掉的马还给对手（定级立刻失真），复盘会把整盘棋摆在一个
     * 根本没出现过的局面上重算一遍，逐手评分全是错的——而界面上完全看不出来，
     * 用户只会觉得"这软件的复盘在胡说"。存一份快照，两处都用它。
     */
    const startSnapshot: Board = cloneBoard(board);
    /** 教练模式的提示档，开局时读一次，对局中可以在 HUD 里改 */
    let hintLevel: HintLevel = getHintLevel();

    let history: Board[] = [];
    /** 整盘的着法序列，复盘用。history 存的是局面，复盘要的是着法 */
    let moveLog: Move[] = [];
    let turn: 'r' | 'b' = 'r';
    let busy = false;
    let over = false;
    let selected: { x: number; y: number } | null = null;
    let aiTimer = 0;
    /** 每次轮到 AI 就自增，用于丢弃悔棋/重开后迟到的搜索结果 */
    let aiSeq = 0;
    let toastTimer = 0;
    let bubbleTimer = 0;
    /** 教练提示条。悔棋 / 重开 / 退出时都要收掉，否则会挂在屏幕上 */
    let closeCoachPrompt: (() => void) | null = null;
    /** 这一局存进存档之后的 id，复盘算完要把结论回填到它身上 */
    let archivedId: string | null = null;

    const scene = new XiangqiScene(wrap, (x, y) => onTap(x, y), theme, flipBlack);
    scene.setSlideSec(TEMPO.slide);
    scene.syncBoard(board);
    // 先把搜索线程热起来，别让第一步的回手慢一大截
    warmupAi(board, 'b');
    scene.dealIn();
    startBgm('guqin');

    // ---- HUD ----
    const hud = document.createElement('div');
    hud.className = 'xq-hud';
    hud.innerHTML = `
      <button class="moba-back xq-back">← 退出</button>
      <div class="xq-turn"><span id="xq-turn-dot"></span><span id="xq-turn-text">红方走棋</span></div>
      <div class="xq-actions">
        <button class="xq-btn" id="xq-mute">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="xq-btn" id="xq-hint">🧑‍🏫 ${HINT_LEVELS[hintLevel].name}</button>
        <button class="xq-btn" id="xq-undo">悔棋</button>
        <button class="xq-btn" id="xq-restart">重开</button>
      </div>`;
    wrap.appendChild(hud);
    (hud.querySelector('.xq-back') as HTMLButtonElement).onclick = () => showSetup();
    (hud.querySelector('#xq-undo') as HTMLButtonElement).onclick = () => undo();
    (hud.querySelector('#xq-restart') as HTMLButtonElement).onclick = () => restart();
    // 教练档就地循环切换：对局中途想安静一会儿不该逼人退出去改设置
    const hintBtn = hud.querySelector('#xq-hint') as HTMLButtonElement;
    hintBtn.onclick = () => {
      hintLevel = ((hintLevel + 1) % HINT_LEVELS.length) as HintLevel;
      setHintLevel(hintLevel);
      hintBtn.textContent = `🧑‍🏫 ${HINT_LEVELS[hintLevel].name}`;
      showToast(`教练：${HINT_LEVELS[hintLevel].name} —— ${HINT_LEVELS[hintLevel].desc}`);
    };
    const muteBtn = hud.querySelector('#xq-mute') as HTMLButtonElement;
    muteBtn.onclick = () => {
      setMuted(!isMuted());
      muteBtn.textContent = isMuted() ? '🔇' : '🔊';
    };

    // ---- 对手角色框 ----
    const rivalBox = document.createElement('div');
    rivalBox.className = 'xq-rivalbox';
    rivalBox.style.setProperty('--c', rival.color);
    const av = avatarCanvas(rival, 62);
    rivalBox.appendChild(av);
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = `<b>${rival.name}</b><span>${L.name} · ${rival.style}</span>`;
    rivalBox.appendChild(info);
    wrap.appendChild(rivalBox);

    const bubble = document.createElement('div');
    bubble.className = 'xq-bubble hidden';
    wrap.appendChild(bubble);
    const say = (text: string) => {
      bubble.textContent = text;
      bubble.classList.remove('hidden');
      bubble.classList.remove('pop');
      void bubble.offsetWidth;
      bubble.classList.add('pop');
      speak(text, rival.voice);
      rivalBox.classList.add('talking');
      clearTimeout(bubbleTimer);
      bubbleTimer = window.setTimeout(() => {
        bubble.classList.add('hidden');
        rivalBox.classList.remove('talking');
      }, 2600);
    };

    const toast = document.createElement('div');
    toast.className = 'moba-toast xq-toast';
    wrap.appendChild(toast);
    const showToast = (msg: string) => {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('show'), 1500);
    };

    const setTurnUI = (thinking = false) => {
      const dot = hud.querySelector('#xq-turn-dot') as HTMLElement;
      const txt = hud.querySelector('#xq-turn-text') as HTMLElement;
      if (!dot || !txt) return;
      dot.className = turn === 'r' ? 'red' : 'black';
      txt.textContent = over
        ? '对局结束'
        : thinking
          ? `${rival.name}思考中…`
          : turn === 'r'
            ? '轮到你走棋'
            : `${rival.name}走棋`;
    };

    setTimeout(() => say(pickLine(rival.lines.greet)), 700);

    // ---- 流程 ----
    function onTap(x: number, y: number) {
      if (busy || over || turn !== 'r') return;
      const p = board[y][x];
      if (selected) {
        const moves = legalMoves(board, 'r').filter((m) => m.fx === selected!.x && m.fy === selected!.y);
        const mv = moves.find((m) => m.tx === x && m.ty === y);
        if (mv) {
          tryMove(mv);
          return;
        }
      }
      if (p && p.c === 'r') {
        selected = { x, y };
        sfxTap();
        const moves = legalMoves(board, 'r').filter((m) => m.fx === x && m.fy === y);
        scene.select(
          selected,
          moves.map((m) => ({ x: m.tx, y: m.ty, capture: !!board[m.ty][m.tx] })),
        );
      } else {
        selected = null;
        scene.select(null);
      }
    }

    /**
     * 落子入口：先让教练看一眼。
     *
     * 教练**永远不替用户走棋**，也不禁止用户走。它只在你要掉坑的时候
     * 说一句，然后把决定权还给你——"换一手"还是"就这么走"由你定。
     * 坚持走错也照走，那一手会被复盘抓下来单独讲，印象比当场拦住深。
     */
    function tryMove(m: Move) {
      const risk = checkMove(hintLevel, board, m, 'r');
      if (!risk) {
        doMove(m);
        return;
      }
      busy = true; // 提示条开着的时候不接受别的点击
      sfxAlert();
      closeCoachPrompt?.();
      closeCoachPrompt = showCoachPrompt({
        host: wrap,
        level: hintLevel,
        before: board,
        move: m,
        me: 'r',
        risk,
        onProceed: () => {
          closeCoachPrompt = null;
          busy = false;
          doMove(m);
        },
        onCancel: () => {
          closeCoachPrompt = null;
          busy = false;
          selected = null;
          scene.select(null);
        },
      });
    }

    function doMove(m: Move) {
      busy = true;
      selected = null;
      const captured = !!board[m.ty][m.tx];
      const mover = board[m.fy][m.fx]!;
      history.push(board);
      moveLog.push(m);
      board = applyMove(board, m);
      turn = turn === 'r' ? 'b' : 'r';
      scene.hideCheck();
      scene.animateMove(m, () => {
        if (captured) {
          sfxSlash();
          if (mover.c === 'b') say(pickLine(rival.lines.capture ?? rival.lines.peng));
        } else sfxKnock();
        busy = false;
        afterMove();
      });
      setTurnUI(turn === 'b');
    }

    function afterMove() {
      const st = statusAfter(board, turn);
      if (st !== 'playing') {
        over = true;
        setTurnUI();
        const k = findKing(board, turn);
        if (k) scene.finishBlast(k[0], k[1]);
        setTimeout(() => showResult(st === 'red-win'), 700);
        return;
      }
      if (isInCheck(board, turn)) {
        const k = findKing(board, turn);
        if (k) scene.flashCheck(k[0], k[1]);
        showToast('将军！');
        sfxAlert();
        if (turn === 'r') say(pickLine(rival.lines.check ?? ['将军']));
        else speak('将军');
      }
      if (turn === 'b') {
        setTurnUI(true);
        // 搜索在 Worker 里跑，主线程继续放动画；思考期间对手头像有呼吸光效
        const myTurn = ++aiSeq;
        scene.setThinking(true);
        // 对手至少"想"这么久再落子。搜索本身在 Worker 里跑，这里只是压住
        // 结果不要来得太早——新手档 300ms 就算完了，秒回让人觉得对面是台机器。
        // 再加一点随机，免得每一步都卡在同一个时刻，那样同样很机械。
        const t0 = performance.now();
        const wait = TEMPO.think ? TEMPO.think * (0.75 + Math.random() * 0.5) : 0;
        requestMove(board, 'b', { maxDepth: handicap?.depth ?? L.depth, jitter: handicap ? 0 : L.jitter, timeMs: handicap ? 2000 : L.timeMs }).then((m) => {
          if (over || myTurn !== aiSeq) return; // 期间悔棋/重开了，丢弃这次结果
          const rest = Math.max(0, wait - (performance.now() - t0));
          aiTimer = window.setTimeout(() => {
            if (over || myTurn !== aiSeq) return;
            scene.setThinking(false);
            if (m) doMove(m);
          }, rest);
        });
      } else {
        setTurnUI();
        if (Math.random() < 0.14) say(pickLine(rival.lines.taunt));
      }
    }

    function undo() {
      closeCoachPrompt?.();
      closeCoachPrompt = null;
      if (busy || history.length === 0) return;
      clearTimeout(aiTimer);
      aiSeq++; // 作废正在跑的搜索
      scene.setThinking(false);
      const steps = turn === 'r' ? 2 : 1;
      for (let i = 0; i < steps && history.length > 0; i++) {
        board = history.pop()!;
        moveLog.pop();
      }
      turn = 'r';
      over = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      scene.setSlideSec(TEMPO.slide);
    scene.syncBoard(board);
    // 先把搜索线程热起来，别让第一步的回手慢一大截
    warmupAi(board, 'b');
      setTurnUI();
    }

    function restart() {
      closeCoachPrompt?.();
      closeCoachPrompt = null;
      archivedId = null;
      clearTimeout(aiTimer);
      aiSeq++;
      scene.setThinking(false);
      board = cloneBoard(startSnapshot); // 让子局要保留让掉的子
      history = [];
      moveLog = [];
      turn = 'r';
      over = false;
      busy = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      scene.setSlideSec(TEMPO.slide);
    scene.syncBoard(board);
    // 先把搜索线程热起来，别让第一步的回手慢一大截
    warmupAi(board, 'b');
      scene.dealIn();
      setTurnUI();
      setTimeout(() => say(pickLine(rival.lines.greet)), 500);
    }

    let resultEl: HTMLElement | null = null;
    let closeReview: (() => void) | null = null;
    /** 上一次结算的胜负，复盘要记进对局统计 */
    let lastWon = false;
    function showResult(playerWon: boolean) {
      lastWon = playerWon;
      handicap?.onFinish(playerWon);
      // 整盘存下来。存的是起始局面 + 着法序列，之后随时能翻回来复盘。
      // 存档在复盘之前就要落地——用户可能直接关掉不复盘，那盘棋也不能丢。
      if (moveLog.length >= 2 && !archivedId) {
        archivedId = archiveFromBoard(startSnapshot, 'r', moveLog, {
          side: 'r',
          result: playerWon ? 'win' : 'loss',
          level: handicap ? `让${handicap.strip}马` : L.name,
          rival: rival.name,
        });
      }
      if (playerWon) {
        sfxWinBig();
        setTimeout(() => say(pickLine(rival.lines.lose)), 500);
      } else {
        sfxLose();
        setTimeout(() => say(pickLine(rival.lines.win)), 400);
      }
      const s = document.createElement('div');
      s.className = 'screen moba-result xq-result';
      s.innerHTML = `
        <div class="xq-result-badge ${playerWon ? 'win' : 'lose'}">${playerWon ? '绝杀' : '败'}</div>
        <h1 style="color:${playerWon ? '#ffd76e' : '#ef5350'}">${playerWon ? '绝杀 · 红方胜' : `${rival.name} 胜`}</h1>
        <div class="sub">${playerWon ? `${rival.name}已被将死（${L.name}难度）` : '你的帅被将死了，再来一局？'}</div>`;
      // 复盘排在最前面：下完一盘最该做的是先看自己错在哪，而不是立刻再开一局
      const rv = document.createElement('button');
      rv.className = 'btn';
      rv.textContent = '📖 复盘这一局';
      rv.onclick = () => openReview();
      if (moveLog.length < 2) rv.style.display = 'none';

      const again = document.createElement('button');
      again.className = 'btn ghost';
      again.textContent = '再来一局';
      again.onclick = () => restart();
      const chg = document.createElement('button');
      chg.className = 'btn ghost';
      chg.textContent = '换对手 / 换难度';
      chg.onclick = () => showSetup();
      const back = document.createElement('button');
      back.className = 'btn ghost';
      back.textContent = '返回首页';
      back.onclick = () => showHome();
      s.appendChild(rv);
      s.appendChild(again);
      s.appendChild(chg);
      s.appendChild(back);
      wrap.appendChild(s);
      resultEl = s;
    }

    /** 打开复盘：暂时收起结算页与 HUD，把 3D 棋盘让给复盘界面 */
    function openReview() {
      if (closeReview) return;
      resultEl?.classList.add('xq-hidden');
      hud.classList.add('xq-hidden');
      rivalBox.classList.add('xq-hidden');
      closeReview = runReview({
        host: wrap,
        scene,
        startBoard: cloneBoard(startSnapshot),
        startColor: 'r',
        moves: moveLog.slice(),
        playerColor: 'r',
        playerWon: lastWon,
        archiveId: archivedId ?? undefined,
        onClose: () => {
          closeReview = null;
          resultEl?.classList.remove('xq-hidden');
          hud.classList.remove('xq-hidden');
          rivalBox.classList.remove('xq-hidden');
        },
      });
    }

    setTurnUI();

    // 开发期测试钩子：3D 棋盘靠射线拾取，自动化测试没法算出格子的屏幕坐标，
    // 这里把内部动作直接暴露出来。生产构建里 import.meta.env.DEV 为 false，整块会被摇掉。
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__xq = {
        tap: (x: number, y: number) => onTap(x, y),
        moves: () => moveLog.slice(),
        board: () => board,
        review: () => openReview(),
      };
    }

    cleanupGame = () => {
      closeReview?.();
      closeReview = null;
      closeCoachPrompt?.();
      closeCoachPrompt = null;
      clearTimeout(aiTimer);
      clearTimeout(toastTimer);
      clearTimeout(bubbleTimer);
      stopBgm();
      scene.dispose();
      disposeAi();
      hud.remove();
      rivalBox.remove();
      bubble.remove();
      toast.remove();
      resultEl?.remove();
    };
  }

  showHome();

  return () => {
    window.removeEventListener('pointerdown', unlock);
    cleanupGame?.();
    disposeCoach?.();
    stopBgm();
    wrap.remove();
  };
}
