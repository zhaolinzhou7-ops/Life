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
  type Color,
  type Move,
} from './rules';
import { disposeAi, requestAnalysis, requestMove, warmupAi } from './aiclient';
import type { MoveScore } from './ai';
import { runReview } from './review';
import { runCoach, type CoachEntry } from './coach';
import { renderGameList, renderHome, renderLevel } from './home';
import { fromFen } from './notation';
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
import { askBest, showBestHint } from './besthint';
import { BoardView } from './boardview';
import { PIECE_VALUE, inPieces } from './teach';
import { moveToText, pieceName, toFen } from './notation';
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

/**
 * 对局节奏。
 *
 * slide 落子之后停顿多久（棋子一帧都不离开交叉点，这只是节奏，不是位移动画）
 * think 对手最少"想"多久——搜索在 Worker 里跑，这里只是不让结果来得太早，
 *       真人不会零点二秒就落子。
 */
const TEMPOS = [
  { id: 'fast', name: '明快', desc: '落子即到，对手几乎秒回', slide: 0, think: 0 },
  { id: 'natural', name: '自然', desc: '有落子动作，对手会想一下（推荐）', slide: 0.18, think: 700 },
  { id: 'slow', name: '沉稳', desc: '慢一些，像面对面下棋', slide: 0.3, think: 1400 },
] as const;

/**
 * 难度档。
 *
 * **不再用"算 N 层"做卖点。**
 * 重写评估函数之后出现一件反直觉的事：新评估每秒算的节点少了四成，
 * 同样时间只能搜到更浅的层数，但真打一场是 3 胜 0 负 9 和——它更强。
 * 层数和棋力根本不是一回事，拿层数当宣传语既不准也没意义，
 * 所以改成描述"它下起来是什么样"。
 *
 * 时间也整体砍短了：原来顶档每步 14 秒，等得人想关掉。
 * 评估变强之后，同样的钱能买到更多棋力，没必要再用时间硬堆。
 */
const LEVELS = [
  { id: 0, name: '入门', desc: '刚学会走子，常看走眼', depth: 64, jitter: 200, timeMs: 200 },
  { id: 1, name: '初级', desc: '会吃明显的子，不太会算', depth: 64, jitter: 90, timeMs: 400 },
  { id: 2, name: '中级', desc: '有基本战术，抓得住你的漏着', depth: 64, jitter: 25, timeMs: 900 },
  { id: 3, name: '高级', desc: '不送子，会抓你的弱点', depth: 64, jitter: 0, timeMs: 1800 },
  { id: 4, name: '大师', desc: '抓杀抓子，很难占到他便宜', depth: 64, jitter: 0, timeMs: 2800 },
  { id: 5, name: '特级大师', desc: '位置感强，每步想约 4 秒', depth: 64, jitter: 0, timeMs: 4500 },
  { id: 6, name: '棋王', desc: '目前最强，每步想约 6 秒', depth: 64, jitter: 0, timeMs: 6500 },
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

  /** 打开学棋模块（测评 / 课程 / 题库都在里面），直接落到对应的那一屏 */
  function openCoach(entry: CoachEntry) {
    clearAll();
    disposeCoach = runCoach(wrap, showHome, (strip, depth, onFinish) => {
      // 让子定级的对局交回对弈流程：那边已经有完整的棋盘、复盘和结算
      disposeCoach?.();
      disposeCoach = null;
      const lv = Math.max(0, Math.min(LEVELS.length - 1, depth >= 14 ? 4 : depth >= 10 ? 3 : 2));
      startGame(
        lv,
        CHARACTERS[Number(localStorage.getItem('xq-rival') ?? 0) % CHARACTERS.length],
        Number(localStorage.getItem('xq-tempo') ?? 1),
        { strip, depth, onFinish },
      );
    }, entry);
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
    const dispose = renderLevel(wrap, showHome, () => openCoach('home'));
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
    const scene = new BoardView(wrap, () => {}, g.side === 'b');
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

    let level = Math.max(0, Math.min(LEVELS.length - 1, Number(localStorage.getItem('xq-level') ?? 1) || 0));
    let rival = Number(localStorage.getItem('xq-rival') ?? 2);
    let tempo = Math.max(0, Math.min(TEMPOS.length - 1, Number(localStorage.getItem('xq-tempo') ?? 1)));
    let hint: HintLevel = getHintLevel();
    let sidePick = (localStorage.getItem('xq-side') ?? 'r') as 'r' | 'b' | 'x';

    const s = document.createElement('div');
    s.className = 'screen xq-setup';
    setupEl = s;

    const render = () => {
      s.innerHTML = `<h1>楚河汉界</h1><div class="sub">选对手 · 定难度 · 定教练</div>`;

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

      // 执哪一方
      const sideLabel = document.createElement('div');
      sideLabel.className = 'xq-sec';
      sideLabel.textContent = '你执哪一方';
      s.appendChild(sideLabel);
      const sideRow = document.createElement('div');
      sideRow.className = 'diff-row';
      ([
        ['r', '执红先行', '红方先走，主动权在你'],
        ['b', '执黑后行', '让对手先出招，练应对'],
        ['x', '随机', '每局开始时掷一次'],
      ] as const).forEach(([id, nm, ds]) => {
        const c = document.createElement('div');
        c.className = 'card' + (sidePick === id ? ' selected' : '');
        c.innerHTML = `<div class="title" style="justify-content:center">${nm}</div>
          <div class="desc" style="text-align:center">${ds}</div>`;
        c.onclick = () => { sidePick = id; sfxTap(); render(); };
        sideRow.appendChild(c);
      });
      s.appendChild(sideRow);

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
        localStorage.setItem('xq-rival', String(rival));
        localStorage.setItem('xq-tempo', String(tempo));
        setHintLevel(hint);
        localStorage.setItem('xq-side', sidePick);
        s.remove();
        setupEl = null;
        const myColor: Color = sidePick === 'x' ? (Math.random() < 0.5 ? 'r' : 'b') : sidePick;
        startGame(level, CHARACTERS[rival], tempo, undefined, myColor);
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
    rival: Character,
    tempoIdx = 1,
    handicap?: { strip: number; depth: number; onFinish: (won: boolean) => void },
    /** 你执哪一方。不传默认执红 */
    myColor: Color = 'r',
  ) {
    /**
     * 你执哪一方、对手执哪一方。
     *
     * 整个对局流程原来把"我"写死成红方，红方永远先行、永远在棋盘下方。
     * 现在这两个变量是唯一的真相来源，下面所有判断都从它们出发——
     * 留任何一处写死的 'r'，执黑时就会出现"轮到你走棋但点不动"这种鬼问题。
     */
    const me: Color = myColor;
    const foe: Color = me === 'r' ? 'b' : 'r';

    const TEMPO = TEMPOS[Math.max(0, Math.min(TEMPOS.length - 1, tempoIdx))];
    // 夹一下：存档里可能留着旧版本的档位号。越界会让 L 变成 undefined，
    // 然后在读 L.depth 的时候整局白屏——为了省一行防御而白屏不值得。
    const L = LEVELS[Math.max(0, Math.min(LEVELS.length - 1, level))];
    let board: Board = initialBoard();
    // 让子：把黑方的马拿掉。让子是教练给学生定级最老实的办法——
    // 让你两个马能赢、让一个马赢不了，水平就卡在这两档之间。
    if (handicap?.strip) {
      // 让子拿掉的是**对手**的马，对手不一定是黑方
      const spots: [number, number][] = foe === 'b' ? [[1, 0], [7, 0]] : [[1, 9], [7, 9]];
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
    let startSnapshot: Board = cloneBoard(board);
    /** 教练模式的提示档，开局时读一次，对局中可以在 HUD 里改 */
    let hintLevel: HintLevel = getHintLevel();

    let history: Board[] = [];
    /** 整盘的着法序列，复盘用。history 存的是局面，复盘要的是着法 */
    let moveLog: Move[] = [];
    /** 红方永远先行，这是棋规；执黑时就是对手先走 */
    let turn: Color = 'r';
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
    /**
     * 这一局用了几次求助。
     *
     * 要记下来，而且要如实告诉用户。用引擎的最优解走出来的棋，
     * 拿去算"你的水平提高了"是自欺欺人——学棋软件最不该做的就是
     * 帮用户伪造进步。
     */
    let hintsUsed = 0;
    /**
     * 当前局面的引擎分析，以及它对应的是哪个局面。
     *
     * 轮到你走的时候就在后台把这个局面算好——**你想棋的那几秒是白送的算力**。
     * 等你落子时结果早就在手里，教练能立刻用引擎的口径判这一手好不好，
     * 而不是只能拿静态兑子看看有没有子被吃。
     */
    let analysis: MoveScore[] | null = null;
    let analysisFor = '';
    let analysisSeq = 0;

    /** 轮到玩家时启动分析。教练档关着就不算，省电 */
    function prefetchAnalysis() {
      if (hintLevel === 0 || over || turn !== me) {
        analysis = null;
        return;
      }
      const key = toFen(board, me);
      if (analysisFor === key && analysis) return;
      analysis = null;
      analysisFor = key;
      const seq = ++analysisSeq;
      // 预算压得比较短是有原因的：Worker 是单线程的，这份分析没算完之前
      // 对手的搜索排在它后面。多数人想一手棋不止一秒，900ms 基本算得完，
      // 又不会在你秒落子的时候把对手的回手也拖慢。
      requestAnalysis(board, me, { maxDepth: 8, timeMs: 900, jitter: 0 }).then((r) => {
        // 期间悔棋/重开/又走了一手，这份结果就作废了。
        // 拿错局面的分数去判一手棋，比不判更糟。
        if (seq !== analysisSeq) return;
        analysis = r;
      });
    }

    /**
     * 棋盘和托盘装在同一个纵向容器里，整组垂直居中。
     *
     * 手机屏比棋盘高，留白是躲不掉的；但留白**平均分在上下**看起来是设计，
     * 全挤在中间一条缝里看起来就是没做完。所以不单独定位这两块，
     * 让它们作为一个整体居中。
     */
    const play = document.createElement('div');
    play.className = 'xq-play';
    wrap.appendChild(play);
    // 执黑时把棋盘转过来，让自己这一方永远在下方——这是所有棋类软件的惯例，
    // 也是唯一符合"坐在棋盘这一侧"直觉的摆法
    const scene = new BoardView(play, (x, y) => onTap(x, y), me === 'b');
    scene.setSlideSec(TEMPO.slide);
    scene.syncBoard(board);
    // 先把搜索线程热起来，别让第一步的回手慢一大截
    warmupAi(board, foe);
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
        <button class="xq-btn" id="xq-best" title="问最优解：告诉我这一步该走哪">🔍</button>
        <button class="xq-btn" id="xq-hint" title="教练提示档位">🧑‍🏫${HINT_LEVELS[hintLevel].short}</button>
        <button class="xq-btn" id="xq-undo">悔棋</button>
        <button class="xq-btn" id="xq-restart">重开</button>
      </div>`;
    wrap.appendChild(hud);
    (hud.querySelector('.xq-back') as HTMLButtonElement).onclick = () => showSetup();
    (hud.querySelector('#xq-undo') as HTMLButtonElement).onclick = () => undo();
    (hud.querySelector('#xq-restart') as HTMLButtonElement).onclick = () => restart();
    /**
     * 求助：告诉我这一步最优解。
     *
     * 用的是最高档的搜索预算，所以要等几秒。这段时间按钮要变成"算…"，
     * 并且不能重复点——重复点会同时排好几个搜索进 Worker，
     * 后面的对局回手会被它们堵住。
     */
    let closeBest: (() => void) | null = null;
    let bestBusy = false;
    /** 求助的请求序号，用来丢弃迟到的结果 */
    let bestSeq = 0;
    const bestBtn = hud.querySelector('#xq-best') as HTMLButtonElement;
    bestBtn.onclick = async () => {
      if (closeBest) {
        bestSeq++; // 作废在跑的那次求助
        closeBest();
        return;
      }
      if (bestBusy || over) return;
      if (turn !== me) {
        showToast('等对手走完再问');
        return;
      }
      bestBusy = true;
      bestBtn.textContent = '…';
      hintsUsed++;
      const token = ++bestSeq;
      const panel = showBestHint({
        host: wrap,
        board: scene,
        onClose: () => {
          closeBest = null;
          bestBtn.textContent = '🔍';
        },
      });
      closeBest = () => {
        panel.close();
        closeBest = null;
        bestBtn.textContent = '🔍';
      };
      const snapshot = toFen(board, turn);
      try {
        const r = await askBest(board, me);
        // 算的过程中如果面板被关了、或者已经走了别的棋，这份结果就作废——
        // 拿上一个局面的"最优解"画在新盘面上是彻头彻尾的误导
        if (token === bestSeq && toFen(board, turn) === snapshot) panel.update(r);
        else closeBest?.();
      } catch {
        closeBest?.();
        showToast('这一手没算出来，再试一次');
      }
      bestBusy = false;
      // 用序号判面板还在不在，别去判 closeBest：它刚在上面被赋过值，
      // TypeScript 会认定它一定非空，而实际上回调可能已经把它清掉了
      if (token === bestSeq) bestBtn.textContent = '✕';
    };

    // 教练档就地循环切换：对局中途想安静一会儿不该逼人退出去改设置
    const hintBtn = hud.querySelector('#xq-hint') as HTMLButtonElement;
    hintBtn.onclick = () => {
      hintLevel = ((hintLevel + 1) % HINT_LEVELS.length) as HintLevel;
      setHintLevel(hintLevel);
      hintBtn.textContent = `🧑‍🏫${HINT_LEVELS[hintLevel].short}`;
      showToast(`教练：${HINT_LEVELS[hintLevel].name} —— ${HINT_LEVELS[hintLevel].desc}`);
      if (turn === me) prefetchAnalysis(); // 刚开教练，立刻把当前局面算上
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

    /**
     * 吃子托盘 + 棋谱。
     *
     * 手机屏比棋盘高得多，棋盘再怎么放大也只能占中间一块，上下必然空着。
     * 与其空着，不如放这两样**下棋的人真的会看**的东西：
     *   吃子对比 —— 一眼知道自己是赚是亏，这是判断该兑子还是该避战的依据
     *   棋谱     —— 对着记谱学棋是基本功，而且回看"刚才那几手"很常用
     * 这也是原来 3D 版本一直缺的：盘面之外什么信息都没有。
     */
    const tray = document.createElement('div');
    tray.className = 'xq-tray';
    tray.innerHTML = `
      <div class="xq-tray-row" data-side="${foe}"><span class="who">对方吃掉</span><span class="pcs"></span></div>
      <div class="xq-tray-row" data-side="${me}"><span class="who">你吃掉</span><span class="pcs"></span><span class="bal"></span></div>
      <div class="xq-log"></div>`;
    play.appendChild(tray);
    const elLog = tray.querySelector('.xq-log') as HTMLElement;

    /** 对比起始局面，数出双方各被吃了哪些子 */
    function refreshTray() {
      const count = (b: Board, c: 'r' | 'b') => {
        const m = new Map<string, number>();
        for (const row of b) for (const p of row) if (p && p.c === c) m.set(p.t, (m.get(p.t) ?? 0) + 1);
        return m;
      };
      let bal = 0;
      for (const side of [me, foe] as const) {
        const was = count(startSnapshot, side);
        const now = count(board, side);
        const lost: string[] = [];
        let v = 0;
        for (const [t, n] of was) {
          const gone = n - (now.get(t) ?? 0);
          for (let i = 0; i < gone; i++) lost.push(pieceName(t as never, side));
          v += gone * PIECE_VALUE[t as never];
        }
        // side 这一方被吃掉了 v 分：是对方的损失就算我赚
        bal += side === foe ? v : -v;
        const row = tray.querySelector(`.xq-tray-row[data-side="${side}"]`) as HTMLElement;
        const pcs = row.querySelector('.pcs') as HTMLElement;
        pcs.innerHTML = lost.length
          ? lost.map((n) => `<i class="${side}">${n}</i>`).join('')
          : '<span class="none">还没吃到子</span>';
      }
      const elBal = tray.querySelector('.bal') as HTMLElement;
      // 正数=你赚，用"多一个马"这种说法，比裸分数好懂
      elBal.textContent = bal === 0 ? '子力均等' : bal > 0 ? `你多 ${inPieces(bal)}` : `你少 ${inPieces(-bal)}`;
      elBal.className = `bal ${bal > 0 ? 'up' : bal < 0 ? 'down' : ''}`;
    }

    /** 棋谱：一行横着滚，永远把最新一手滚到眼前 */
    function refreshLog() {
      let cur: Board = startSnapshot;
      const parts: string[] = [];
      moveLog.forEach((m, i) => {
        const txt = moveToText(cur, m);
        if (i % 2 === 0) parts.push(`<b>${i / 2 + 1}.</b>`);
        parts.push(`<span class="${i % 2 === 0 ? 'r' : 'b'}">${txt}</span>`);
        cur = applyMove(cur, m);
      });
      elLog.innerHTML = parts.length ? parts.join('') : '<span class="none">棋谱会显示在这里</span>';
      elLog.scrollLeft = elLog.scrollWidth;
    }

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

    /**
     * 思考读秒。
     *
     * 顶上两档每步要想七秒到十四秒。没有任何变化的"思考中…"挂十几秒，
     * 用户会以为软件卡死了——高难度档最容易因此被误判成 bug。
     */
    let thinkTimer = 0;
    let thinkStart = 0;
    const setTurnUI = (thinking = false) => {
      const dot = hud.querySelector('#xq-turn-dot') as HTMLElement;
      const txt = hud.querySelector('#xq-turn-text') as HTMLElement;
      if (!dot || !txt) return;
      dot.className = turn === 'r' ? 'red' : 'black';
      clearInterval(thinkTimer);
      if (over) {
        txt.textContent = '对局结束';
        return;
      }
      if (!thinking) {
        txt.textContent = turn === me ? '轮到你走棋' : `${rival.name}走棋`;
        return;
      }
      thinkStart = Date.now();
      const tick = () => {
        const sec = Math.floor((Date.now() - thinkStart) / 1000);
        // 两秒以内不显示数字，免得快档一闪一闪的
        txt.textContent = sec >= 2 ? `${rival.name}思考中… ${sec}s` : `${rival.name}思考中…`;
      };
      tick();
      thinkTimer = window.setInterval(tick, 500);
    };

    setTimeout(() => say(pickLine(rival.lines.greet)), 700);

    // ---- 流程 ----
    /**
     * 落子动画还没播完时收到的点击，先存起来，播完再补上。
     *
     * 对手走完之后有一小段落子动画，这期间 busy 还是 true，但 HUD 已经
     * 显示"轮到你走棋"了。手快的人这一下点击会被**悄无声息地吃掉**——
     * 界面说该你走，你点了却没反应，只能再点一次。
     * 这种吃输入的毛病最招人烦，而且完全看不出是 bug，只会觉得"这软件不跟手"。
     */
    let pendingTap: { x: number; y: number } | null = null;

    function onTap(x: number, y: number) {
      if (over || turn !== me) return;
      if (busy) {
        pendingTap = { x, y };
        return;
      }
      const p = board[y][x];
      if (selected) {
        const moves = legalMoves(board, me).filter((m) => m.fx === selected!.x && m.fy === selected!.y);
        const mv = moves.find((m) => m.tx === x && m.ty === y);
        if (mv) {
          tryMove(mv);
          return;
        }
      }
      if (p && p.c === me) {
        selected = { x, y };
        sfxTap();
        const moves = legalMoves(board, me).filter((m) => m.fx === x && m.fy === y);
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
      bestSeq++;
      closeBest?.();
      const verdict = checkMove(hintLevel, board, m, me, analysisFor === toFen(board, me) ? analysis : null);
      if (!verdict) {
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
        me,
        verdict,
        ply: moveLog.length,
        board: scene,
        analysis: analysisFor === toFen(board, me) ? analysis : null,
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
        // 动画期间攒下的那一下点击，现在补上
        const p = pendingTap;
        pendingTap = null;
        if (p && !busy && !over && turn === me) onTap(p.x, p.y);
      });
      refreshTray();
      refreshLog();
      setTurnUI(turn === foe);
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
        if (turn === me) say(pickLine(rival.lines.check ?? ['将军']));
        else speak('将军');
      }
      if (turn === foe) {
        setTurnUI(true);
        // 搜索在 Worker 里跑，主线程继续放动画；思考期间对手头像有呼吸光效
        const myTurn = ++aiSeq;
        scene.setThinking(true);
        // 对手至少"想"这么久再落子。搜索本身在 Worker 里跑，这里只是压住
        // 结果不要来得太早——新手档 300ms 就算完了，秒回让人觉得对面是台机器。
        // 再加一点随机，免得每一步都卡在同一个时刻，那样同样很机械。
        const t0 = performance.now();
        const wait = TEMPO.think ? TEMPO.think * (0.75 + Math.random() * 0.5) : 0;
        requestMove(board, foe, { maxDepth: handicap?.depth ?? L.depth, jitter: handicap ? 0 : L.jitter, timeMs: handicap ? 2000 : L.timeMs }).then((m) => {
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
        prefetchAnalysis(); // 轮到你了，趁你想棋先把这个局面算好
        if (Math.random() < 0.14) say(pickLine(rival.lines.taunt));
      }
    }

    function undo() {
      bestSeq++;
      closeBest?.();
      closeCoachPrompt?.();
      closeCoachPrompt = null;
      pendingTap = null;
      if (busy || history.length === 0) return;
      clearTimeout(aiTimer);
      aiSeq++; // 作废正在跑的搜索
      scene.setThinking(false);
      // 退到轮回自己为止：轮到自己就退两手（自己+对手），否则退一手
      const steps = turn === me ? 2 : 1;
      for (let i = 0; i < steps && history.length > 0; i++) {
        board = history.pop()!;
        moveLog.pop();
      }
      turn = me;
      over = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      refreshTray();
      refreshLog();
      analysisSeq++; // 作废在跑的分析：它算的是悔棋之前那个局面
      prefetchAnalysis();
      scene.setLastMove(moveLog.length ? moveLog[moveLog.length - 1] : null);
      scene.setSlideSec(TEMPO.slide);
    scene.syncBoard(board);
    // 先把搜索线程热起来，别让第一步的回手慢一大截
    warmupAi(board, foe);
      setTurnUI();
    }

    function restart() {
      bestSeq++;
      closeBest?.();
      hintsUsed = 0;
      closeCoachPrompt?.();
      closeCoachPrompt = null;
      pendingTap = null;
      archivedId = null;
      clearTimeout(aiTimer);
      aiSeq++;
      scene.setThinking(false);
      board = cloneBoard(startSnapshot); // 让子局要保留让掉的子
      history = [];
      moveLog = [];
      turn = 'r'; // 红方先行是棋规，和你执哪一方无关
      over = false;
      busy = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      scene.setSlideSec(TEMPO.slide);
    scene.syncBoard(board);
    // 先把搜索线程热起来，别让第一步的回手慢一大截
    warmupAi(board, foe);
      scene.dealIn();
      scene.setLastMove(null);
      refreshTray();
      refreshLog();
      analysisSeq++;
      prefetchAnalysis();
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
          side: me,
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
        <div class="sub">${playerWon ? `${rival.name}已被将死（${L.name}难度）` : '你被将死了，再来一局？'}</div>
        ${hintsUsed > 0 ? `<div class="xq-usedhint">这一局用了 ${hintsUsed} 次求助——照着引擎走出来的棋不算你的水平，复盘的时候心里有个数。</div>` : ''}`;
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
        playerColor: me,
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

    refreshTray();
    refreshLog();
    setTurnUI(turn !== me);
    prefetchAnalysis();
    /*
     * 执黑时红方先行，开局这一手得由对手走。
     * 原来的流程只有"我走完 → afterMove → 轮到对手"这一条路径，
     * 开局没人触发，执黑就会卡在空棋盘上谁也不动。
     */
    if (turn !== me) setTimeout(() => afterMove(), 400);

    // 开发期测试钩子：3D 棋盘靠射线拾取，自动化测试没法算出格子的屏幕坐标，
    // 这里把内部动作直接暴露出来。生产构建里 import.meta.env.DEV 为 false，整块会被摇掉。
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__xq = {
        tap: (x: number, y: number) => onTap(x, y),
        moves: () => moveLog.slice(),
        board: () => board,
        review: () => openReview(),
        /** 当前轮到谁 */
        turn: () => turn,
        /** 我方现在能走的所有着法，自动化测试拿它来随便走一手 */
        legal: () => legalMoves(board, turn),
        /** 把一手棋转成中文记谱，测试拿它和教练的推荐对字符串 */
        textOf: (m: Move) => moveToText(board, m),
        /** 当前的引擎分析有没有就绪，测试用它避免抢跑 */
        analysisReady: () => analysisFor === toFen(board, me) && !!analysis,
        /** 内部状态，排查"点了没反应"用 */
        state: () => ({ busy, over, turn, selected, tip: !!closeCoachPrompt }),
        fen: () => toFen(board, turn),
        /**
         * 直接摆一个局面。
         *
         * 加这个钩子是因为界面层有些东西只有摆特定局面才测得到——
         * 教练模式要在"真的会送子"的那一手才弹提示，而从开局走到那种局面
         * 要十几手，中间还要看对手怎么应，测试根本没法稳定复现。
         * 生产构建里 import.meta.env.DEV 为 false，整块会被摇掉。
         */
        setBoard: (fen: string) => {
          const parsed = fromFen(fen);
          if (!parsed) return false;
          // 和 undo/restart 一样，必须作废正在跑的搜索。
          // 不然对手那边算的是**旧局面**的着法，等它算完回来就照着新棋盘走，
          // 走出来的是一手风马牛不相及的棋，整局状态当场乱掉。
          clearTimeout(aiTimer);
          aiSeq++;
          scene.setThinking(false);
          closeCoachPrompt?.();
          closeCoachPrompt = null;
          board = parsed.board;
          turn = parsed.toMove;
          // 起始快照也要跟着换：复盘和重开都以它为准，不改的话
          // 复盘会把这一局摆在一个从来没下过的局面上重算
          startSnapshot = cloneBoard(board);
          history = [];
          moveLog = [];
          over = false;
          busy = false;
          selected = null;
          scene.syncBoard(board);
          setTurnUI();
          return true;
        },
      };
    }

    cleanupGame = () => {
      closeReview?.();
      closeReview = null;
      closeCoachPrompt?.();
      closeCoachPrompt = null;
      clearTimeout(aiTimer);
      clearInterval(thinkTimer);
      clearTimeout(toastTimer);
      clearTimeout(bubbleTimer);
      stopBgm();
      scene.dispose();
      disposeAi();
      hud.remove();
      rivalBox.remove();
      bubble.remove();
      toast.remove();
      play.remove();
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
