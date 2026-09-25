/** 象棋启动入口：开局设置（难度/棋子材质/对手）→ 玩家执红 vs AI 执黑 */
import {
  applyMove,
  cloneBoard,
  findKing,
  initialBoard,
  isInCheck,
  kingsFacing,
  legalMoves,
  pseudoMoves,
  statusAfter,
  type Board,
  type Color,
  type Move,
} from './rules';
import { disposeAi, requestMove, warmupAi } from './aiclient';
import { engineBestMove, engineCapable, engineReady, loadEngine } from './fsf';
import type { Judged } from './analysis';
import { runReview } from './review';
import { runCoach, type CoachEntry } from './coach';
import { renderGameList, renderHome, renderLevel } from './home';
import { fromFen } from './notation';
import { archiveFromBoard, listGames as listArchived, openGame, type ArchivedGame } from './archive';
import {
  HINT_LEVELS,
  getHintLevel,
  judgeMove,
  lostNotice,
  mdToHtml,
  needsExact,
  readOpponent,
  setHintLevel,
  shouldWarn,
  showCoachPrompt,
  threatNotice,
  warnText,
  type HintLevel,
} from './livecoach';
import { initCoachProvider } from './llm';
import { hintOf, showBestHint } from './besthint';
import { bookMoves, isBookMove } from './book';
import { TIER_INFO, gapText } from './tiers';
import { Study } from './study';
import {
  END_TEXT,
  MOVE_LIMIT,
  drawOrForfeit,
  pliesSinceCapture,
  repetitionState,
  type GameEnd,
  type PlyRecord,
} from './endings';
import { mateInOne } from './teach';
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
  // 顶两档换专业引擎（Fairy-Stockfish）。浏览器跑不了时退回自家引擎，时间照旧
  { id: 5, name: '特级大师', desc: '专业引擎，职业棋手的水准', depth: 64, jitter: 0, timeMs: 4500, fsfMs: 1500 },
  { id: 6, name: '棋王', desc: '专业引擎全力以赴，几乎不犯错', depth: 64, jitter: 0, timeMs: 6500, fsfMs: 4000 },
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
  // 专业引擎一进象棋就开始加载：1.7MB，编译一两秒，第一次轮到你走棋时通常已经好了
  void loadEngine();

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
      // 专业引擎跑不起来（老浏览器、隐私模式禁了 service worker）时如实说一声，
      // 不然"专业引擎"几个字就是空头支票
      if (!engineCapable()) {
        const n = document.createElement('div');
        n.className = 'xq-note';
        n.textContent = '这个浏览器跑不了专业引擎（需要较新的 Chrome / Safari / Edge），教练和顶两档会用自带引擎，弱一些。';
        s.appendChild(n);
      }

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
     * 当前局面的研究（study.ts）。教练判棋、🔍 求助、议和时对手掂量局面，读的都是这一份——
     * 同一个局面只有一个裁判，教练和求助才不会一个说不行、一个说最好。
     * 轮到你走就开始算（你想棋的时间是白送的算力），你一落子就掐掉。
     */
    let study: Study | null = null;
    /** 每次落子/悔棋/重开都自增。教练等研究的那一小会儿里局面变了，这次判断就作废 */
    let moveToken = 0;
    /** 每一手走完之后的局面记录：重复局面、长将、自然限着都靠它 */
    let plies: PlyRecord[] = [];
    let startKey = toFen(board, 'r');
    /** 你每一手落子时引擎的判读。复盘直接用，保证复盘和对局里教练说的是同一套 */
    let bookAt = new Map<number, Judged>();
    /** 教练拦过、你坚持走了的那几手（第几手 → 教练当时的话），复盘里要标出来 */
    let coachFlags = new Map<number, string>();
    /** 教练在这个局面拦过哪些着法。求助推荐的恰好是其中一手时，要当面说清楚 */
    let warnedHere: { fen: string; keys: Set<string> } = { fen: '', keys: new Set() };
    /** "局面已经守不住了"一盘只说一次，说多了就是唠叨 */
    let lostSaid = false;
    /** 对手上一次拒绝议和是第几手：拒绝之后要隔几步才能再提 */
    let drawDeclinedAt = -99;
    /** 上一次夸你是第几手——夸得太勤就不值钱了 */
    let praisedAt = -99;
    /** 这一轮开始时对方有没有摆好一步杀。你解掉了要夸一句 */
    let threatAtTurn = false;
    /** 这一局怎么结束的 */
    let ending: GameEnd | null = null;
    /** 对手上一步是哪个引擎走的（测试用：顶两档要确认真的换成了专业引擎） */
    let lastAiEngine: 'fsf' | 'local' | null = null;

    const moveKey = (m: Move) => `${m.fx}${m.fy}${m.tx}${m.ty}`;
    const sameMove = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

    /** 拿到当前局面的研究；没有就开一个 */
    function ensureStudy(): Study {
      if (study && study.is(board, me)) return study;
      study?.stop();
      // 带上整盘的着法：引擎就知道哪些局面已经出现过（长将、重复）
      const s = new Study(board, me, { startFen: startKey, moves: moveLog.slice() });
      study = s;
      s.subscribe(() => onStudy(s));
      return s;
    }

    function dropStudy() {
      study?.stop();
      study = null;
    }

    /** 研究有进展：状态行刷新；算完之后如果局面已经没救，说一次实话 */
    function onStudy(s: Study) {
      if (s !== study || over || turn !== me) return;
      renderCoachLine();
      if (s.done && !lostSaid && hintLevel > 0) {
        // 入门到中级的对手会看走眼（搜索带扰动），高级以上不会
        const t = lostNotice(board, s.moves, !handicap && L.jitter === 0);
        if (t) {
          lostSaid = true;
          showLostNotice(t);
        }
      }
    }

    /** 轮到你走：开始研究这个局面，看一眼对方有没有摆好杀着，以及棋规上的提醒 */
    function prepareTurn() {
      if (over || turn !== me) return;
      if (hintLevel > 0) ensureStudy();
      const threat = threatNotice(board, me, hintLevel);
      threatAtTurn = !!threat;
      // 长将：棋规上是判负的，不管教练开没开都要说
      const rep = repetitionState(startKey, plies);
      if (rep.count >= 2 && rep.perpetual === me) {
        setCoachLine('局面已经重复了，而你每一步都在将军。再重复一次就是长将，按规则判负——这一步要变着。', 'warn');
      } else if (threat) {
        setCoachLine(threat, 'warn');
      } else {
        const quiet = pliesSinceCapture(plies);
        const last = moveLog.length ? moveLog[moveLog.length - 1] : null;
        const read = last && history.length && plies[plies.length - 1]?.mover === foe
          ? readOpponent(history[history.length - 1], last, foe, hintLevel)
          : null;
        if (quiet >= MOVE_LIMIT - 20) {
          setCoachLine(`已经 ${Math.floor(quiet / 2)} 回合没有吃子了，满 60 回合按规则判和。`, 'info');
        } else if (read) {
          setCoachLine(read, read.includes('在捉你的') ? 'warn' : 'info');
        } else setCoachLine(null);
      }
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
      </div>`;
    wrap.appendChild(hud);
    (hud.querySelector('.xq-back') as HTMLButtonElement).onclick = async () => {
      // 下到一半点退出，多半是手滑。问一句，别让一盘棋无声无息地没了
      if (!over && moveLog.length >= 4) {
        const ok = await askConfirm('退出会放弃这一局，不会记录。想留下记录的话，可以先认输再退出。', '退出', '接着下');
        if (!ok) return;
      }
      showSetup();
    };
    /**
     * 求助：告诉我这一步最优解。
     *
     * 用的是最高档的搜索预算，所以要等几秒。这段时间按钮要变成"算…"，
     * 并且不能重复点——重复点会同时排好几个搜索进 Worker，
     * 后面的对局回手会被它们堵住。
     */
    let closeBest: (() => void) | null = null;
    /** 求助的请求序号，用来丢弃迟到的结果 */
    let bestSeq = 0;
    const bestBtn = hud.querySelector('#xq-best') as HTMLButtonElement;
    bestBtn.onclick = () => {
      if (closeBest) {
        closeBest();
        return;
      }
      if (over) return;
      if (turn !== me) {
        showToast('等对手走完再问');
        return;
      }
      if (closeCoachPrompt) {
        showToast('先处理教练的提醒：换一手，或者就这么走');
        return;
      }
      hintsUsed++;
      const token = ++bestSeq;
      // 和教练读同一份研究：多数时候你想棋的这几秒里它已经算完了，一点开就有
      const s = ensureStudy();
      let off: () => void = () => {};
      const panel = showBestHint({
        host: wrap,
        board: scene,
        onClose: () => {
          off();
          closeBest = null;
          bestBtn.textContent = '🔍';
        },
      });
      const render = () => {
        if (token !== bestSeq || !s.is(board, me) || !s.moves.length) return;
        const r = hintOf(board, me, s.moves);
        const warned = r.best && warnedHere.fen === s.fen && warnedHere.keys.has(moveKey(r.best.move));
        const notes: string[] = [];
        if (warned) notes.push('刚才教练对这一手提醒过——那是还没算深时的初判。以这里算深之后的结论为准。');
        // 开局阶段引擎最弱：前几名只差十几分，选出来的可能是冷门棋。定式是更可靠的参照。
        // 引擎评得最高的那一手定式领衔；其它定式着法附在下面，并写明引擎怎么看它
        // 只有引擎精确排过名的定式着法才能领衔；没进前几名的（只知道上限）照样列出来，但不编分差
        const books = bookMoves(board, me)
          .map((bm) => ({ bm, at: r.ranked.find((x) => sameMove(x.move, bm.move)) }))
          .sort((a, b) => (a.at && !a.at.atLeast ? a.at.gap : 1e9) - (b.at && !b.at.atLeast ? b.at.gap : 1e9));
        // 领衔还要求引擎认为它和首选一样好（最优/次选）；差一档的就只作为参考列出来
        const top = books[0]?.at;
        const lead = top && !top.atLeast && (top.tier === 'best' || top.tier === 'good') ? books[0] : undefined;
        for (const { bm, at } of books.filter((x) => x !== lead).slice(0, 2)) {
          const eng = at && !at.atLeast ? `引擎评它「${TIER_INFO[at.tier].name}」${at.gap ? `，${gapText(at)}` : ''}。` : '';
          notes.push(`📚 ${lead ? '也是定式' : '定式'}（${bm.opening}）：<b>${bm.text}</b>——${bm.why}${eng}`);
        }
        panel.update(r, {
          depth: s.depth,
          done: s.done,
          note: notes.length ? notes.join('<br>') : undefined,
          book: lead ? lead.bm : undefined,
          engine: s.engine,
        });
      };
      off = s.subscribe(render);
      render();
      bestBtn.textContent = '✕';
      closeBest = () => {
        bestSeq++;
        off();
        panel.close();
        closeBest = null;
        bestBtn.textContent = '🔍';
      };
    };

    // 教练档就地循环切换：对局中途想安静一会儿不该逼人退出去改设置
    const hintBtn = hud.querySelector('#xq-hint') as HTMLButtonElement;
    hintBtn.onclick = () => {
      hintLevel = ((hintLevel + 1) % HINT_LEVELS.length) as HintLevel;
      setHintLevel(hintLevel);
      hintBtn.textContent = `🧑‍🏫${HINT_LEVELS[hintLevel].short}`;
      showToast(`教练：${HINT_LEVELS[hintLevel].name} —— ${HINT_LEVELS[hintLevel].desc}`);
      prepareTurn(); // 刚开教练，立刻把当前局面算上
      renderCoachLine();
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
    /**
     * 教练的一行字：平时显示教练在不在、算到第几层；有话说的时候（对方有杀着、
     * 你走了好棋、快到自然限着）就换成那句话。
     *
     * 这一行**一直占着位置**，只换内容不隐藏——忽隐忽现的话，棋盘会跟着上下跳。
     */
    const coachLine = document.createElement('div');
    coachLine.className = 'xq-coachline';
    play.appendChild(coachLine);
    let lineMsg: { text: string; kind: 'warn' | 'good' | 'info' } | null = null;
    let lineTimer = 0;
    function renderCoachLine() {
      if (lineMsg) {
        coachLine.className = `xq-coachline ${lineMsg.kind}`;
        coachLine.textContent = `${lineMsg.kind === 'warn' ? '⚠️' : lineMsg.kind === 'good' ? '👍' : '🧑‍🏫'} ${lineMsg.text}`;
        return;
      }
      coachLine.className = 'xq-coachline idle';
      if (hintLevel === 0) {
        coachLine.textContent = '🧑‍🏫 教练已关闭（点顶上的 🧑‍🏫 可以打开）';
        return;
      }
      const s = study && turn === me && !over && study.is(board, me) ? study : null;
      const depth = s ? ` · 已算 ${s.depth} 层${s.done ? '' : '…'}` : '';
      const who = s ? (s.engine === 'fsf' ? ' · 专业引擎' : ' · 自带引擎') : '';
      coachLine.textContent = `🧑‍🏫 教练在看（${HINT_LEVELS[hintLevel].name}）${depth}${who}`;
    }
    function setCoachLine(text: string | null, kind: 'warn' | 'good' | 'info' = 'info', ms = 0) {
      clearTimeout(lineTimer);
      lineMsg = text ? { text, kind } : null;
      renderCoachLine();
      if (text && ms) lineTimer = window.setTimeout(() => setCoachLine(null), ms);
    }

    const tray = document.createElement('div');
    tray.className = 'xq-tray';
    tray.innerHTML = `
      <div class="xq-tray-row" data-side="${foe}"><span class="who">对方吃掉</span><span class="pcs"></span></div>
      <div class="xq-tray-row" data-side="${me}"><span class="who">你吃掉</span><span class="pcs"></span><span class="bal"></span></div>
      <div class="xq-log"></div>`;
    play.appendChild(tray);
    const elLog = tray.querySelector('.xq-log') as HTMLElement;

    /**
     * 底部操作条：悔棋 / 求和 / 认输 / 重开。
     *
     * 原来悔棋、重开挤在顶上那一行，再加求和、认输就放不下了（390px 的手机上
     * 已经七样东西）。对局里的"对这一盘做决定"的按钮放到下面，拇指够得到；
     * 顶上只留退出、回合、静音、求助、教练这些"随时看一眼"的东西。
     */
    const bar = document.createElement('div');
    bar.className = 'xq-bar';
    bar.innerHTML = `
      <button class="xq-btn" id="xq-undo">↶ 悔棋</button>
      <button class="xq-btn" id="xq-draw">🤝 求和</button>
      <button class="xq-btn" id="xq-resign">🏳️ 认输</button>
      <button class="xq-btn" id="xq-restart">⟳ 重开</button>`;
    play.appendChild(bar);
    const drawBtn = bar.querySelector('#xq-draw') as HTMLButtonElement;
    (bar.querySelector('#xq-undo') as HTMLButtonElement).onclick = () => undo();
    (bar.querySelector('#xq-restart') as HTMLButtonElement).onclick = async () => {
      if (!over && moveLog.length >= 2) {
        const ok = await askConfirm('重开会放弃这一局，这一局不会记录。确定重开吗？', '重开', '接着下');
        if (!ok) return;
      }
      restart();
    };
    (bar.querySelector('#xq-resign') as HTMLButtonElement).onclick = async () => {
      if (over) return;
      const ok = await askConfirm('确定认输吗？这一局会记为负。认输之后可以直接复盘，找找是哪一步开始出问题的。', '认输', '接着下');
      if (ok && !over) endGame({ winner: foe, reason: 'resign' });
    };
    drawBtn.onclick = () => void offerDraw();

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
    const showToast = (msg: string, ms = 1500) => {
      toast.textContent = msg;
      toast.classList.add('show');
      clearTimeout(toastTimer);
      toastTimer = window.setTimeout(() => toast.classList.remove('show'), ms);
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
          void tryMove(mv);
          return;
        }
        // 点的是一个"按走法能到、但按规则不许"的点：说清楚为什么，别让人以为点不动是 bug
        if (!p || p.c !== me) {
          const why = illegalWhy(selected, { x, y });
          if (why) {
            showToast(why, 2600);
            return;
          }
        }
      }
      if (p && p.c === me) {
        selected = { x, y };
        sfxTap();
        const moves = legalMoves(board, me).filter((m) => m.fx === x && m.fy === y);
        if (!moves.length) {
          // 选中一个根本动不了的子，原来什么反应都没有。新手会以为点歪了，反复点
          showToast(
            isInCheck(board, me) ? '正在被将军：这个子解不了将，先应将' : '这个子现在没有能走的地方（被蹩腿、塞眼，或者一动就送将）',
            2600,
          );
        }
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
     * 按子的走法能到、按规则却不许走的原因。
     * 只解释两种最常见、最让新手困惑的：走完自己被将（含被牵制的子），以及将帅照面。
     */
    function illegalWhy(from: { x: number; y: number }, to: { x: number; y: number }): string | null {
      const pseudo = pseudoMoves(board, me).find((m) => m.fx === from.x && m.fy === from.y && m.tx === to.x && m.ty === to.y);
      if (!pseudo) return null;
      const nb = applyMove(board, pseudo);
      if (kingsFacing(nb)) return '不能这么走：走完两边的将帅会照面，按规则不允许';
      if (isInCheck(nb, me)) {
        return isInCheck(board, me)
          ? '不能这么走：你正在被将军，这一步解不了将'
          : '不能这么走：这个子一动，你的老将就被对方直接吃掉了（它在替老将挡着）';
      }
      return null;
    }

    /**
     * 通用的确认条：认输、重开、长将这些"走了就回不去"的操作都要先问一句。
     * 和教练提示条同一个位置、同一个样子，用户不用学新东西。
     */
    let closeConfirm: (() => void) | null = null;
    function askConfirm(text: string, okLabel: string, cancelLabel: string): Promise<boolean> {
      closeConfirm?.();
      return new Promise((resolve) => {
        const el = document.createElement('div');
        el.className = 'xq-tip sev2 xq-confirm';
        el.innerHTML = `
          <div class="xq-tip-body"><span class="xq-tip-icon">❓</span><span class="xq-tip-text"></span></div>
          <div class="xq-tip-bar">
            <button class="xq-btn" data-act="no"></button>
            <button class="xq-btn primary" data-act="yes"></button>
          </div>`;
        (el.querySelector('.xq-tip-text') as HTMLElement).innerHTML = mdToHtml(text);
        (el.querySelector('[data-act="no"]') as HTMLElement).textContent = cancelLabel;
        (el.querySelector('[data-act="yes"]') as HTMLElement).textContent = okLabel;
        wrap.appendChild(el);
        const done = (v: boolean) => {
          el.remove();
          closeConfirm = null;
          resolve(v);
        };
        closeConfirm = () => done(false);
        el.addEventListener('click', (e) => {
          const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
          if (act) done(act === 'yes');
        });
      });
    }

    /** 局面已经没救时的那句实话，附带认输的出口 */
    let closeLost: (() => void) | null = null;
    function showLostNotice(text: string) {
      closeLost?.();
      const el = document.createElement('div');
      el.className = 'xq-tip sev2 xq-lost';
      el.innerHTML = `
        <div class="xq-tip-body"><span class="xq-tip-icon">🧑‍🏫</span><span class="xq-tip-text"></span></div>
        <div class="xq-tip-bar">
          ${history.length ? '<button class="xq-btn" data-act="undo">↶ 悔一步</button>' : ''}
          <button class="xq-btn" data-act="resign">认输，去复盘</button>
          <button class="xq-btn primary" data-act="go">接着下</button>
        </div>`;
      (el.querySelector('.xq-tip-text') as HTMLElement).textContent = text;
      wrap.appendChild(el);
      const close = () => {
        el.remove();
        closeLost = null;
      };
      closeLost = close;
      el.addEventListener('click', (e) => {
        const act = (e.target as HTMLElement).closest('[data-act]')?.getAttribute('data-act');
        if (act === 'go') close();
        else if (act === 'undo') {
          // 刚走出一步坏棋就被告知"没救了"，最想做的往往是退回去重走
          close();
          lostSaid = false;
          undo();
        } else if (act === 'resign') {
          close();
          endGame({ winner: foe, reason: 'resign' }, true);
        }
      });
    }

    /** 把所有浮在棋盘上的提示条都收掉。提示条开着时 busy 是 true，收掉要一起复位，不然整盘卡死 */
    function dismissPanels() {
      bestSeq++;
      closeBest?.();
      closeLost?.();
      closeConfirm?.();
      if (closeCoachPrompt) {
        closeCoachPrompt();
        closeCoachPrompt = null;
        busy = false;
      }
    }

    /** 子力（不算将帅），用来判断对手占不占优 */
    const material = (b: Board, c: Color) => {
      let v = 0;
      for (const row of b) for (const p of row) if (p && p.c === c && p.t !== 'K') v += PIECE_VALUE[p.t];
      return v;
    };

    /** 假如走了这一手，棋会不会因为棋规（重复/长将/限着）当场结束 */
    function previewEnd(m: Move, mover: Color): GameEnd | null {
      const nb = applyMove(board, m);
      const next: Color = mover === 'r' ? 'b' : 'r';
      const rec: PlyRecord = { key: toFen(nb, next), mover, check: isInCheck(nb, next), capture: !!board[m.ty][m.tx] };
      return drawOrForfeit(nb, startKey, [...plies, rec]);
    }

    /**
     * 对手不许走的着法。
     *
     * 引擎的搜索看不见对局历史：占优时它会走回老局面（第三次重复就判和了，
     * 白白放掉一盘赢棋），或者一路将下去（长将判负）。这两种都挑出来不让它走。
     * 它子力落后时，走成重复和棋是合理的求和手段，那就不拦。
     */
    function aiAvoid(): Move[] {
      const ahead = material(board, foe) >= material(board, me);
      return legalMoves(board, foe).filter((m) => {
        const end = previewEnd(m, foe);
        if (!end) return false;
        if (end.winner === me) return true;
        return end.winner === null && end.reason === 'repetition' && ahead;
      });
    }

    /**
     * 求和。
     *
     * 对手真的会掂量局面：它读的是和教练同一份研究，占优就不和，并且告诉你为什么。
     * 学棋的人需要知道"对方为什么不和"——那本身就是在告诉你局面是谁好。
     */
    async function offerDraw() {
      if (over) return;
      if (turn !== me || busy) {
        showToast('轮到你走的时候才能提和');
        return;
      }
      if (moveLog.length - drawDeclinedAt < 6) {
        showToast(`${rival.name}刚拒绝过，过几步再提吧`);
        return;
      }
      // "才开局"看的是子还在不在，不只是步数：残局摆出来的局面哪怕第一步也可以谈和
      const onBoard = material(board, 'r') + material(board, 'b');
      const full = material(initialBoard(), 'r') * 2;
      if (moveLog.length < 20 && onBoard >= full * 0.85) {
        drawDeclinedAt = moveLog.length;
        say('才刚开局，下下看再说。');
        showToast(`${rival.name}拒绝了：开局才十来步，还没到谈和的时候`, 2600);
        return;
      }
      const token = moveToken;
      const s = ensureStudy();
      drawBtn.disabled = true;
      drawBtn.textContent = '🤝 …';
      await s.until((x) => x.depth >= x.minDepth, 3000);
      drawBtn.disabled = false;
      drawBtn.textContent = '🤝 求和';
      if (token !== moveToken || over || turn !== me) return;
      if (!s.best) {
        showToast(`${rival.name}还在想，等一下再提`);
        return;
      }
      // 研究是你的视角，取负就是对手的看法
      const theirs = -(s.best?.score ?? 0);
      if (theirs >= 150) {
        drawDeclinedAt = moveLog.length;
        say('我这边占优，接着下。');
        showToast(
          theirs > 9000 ? `${rival.name}拒绝了：他已经算到杀棋了` : `${rival.name}拒绝了：他觉得自己占优（算下去约多${inPieces(theirs)}）`,
          2800,
        );
        return;
      }
      // 均势：子多的时候还有得下，拒绝；下了很久或者子已经兑得差不多了，就和
      if (theirs > -150 && moveLog.length < 40 && onBoard > full * 0.4) {
        drawDeclinedAt = moveLog.length;
        say('局面还复杂，再下下看。');
        showToast(`${rival.name}拒绝了：局面还很复杂，双方都有机会，想再下下看`, 2800);
        return;
      }
      say(theirs <= -150 ? '局面对我不利……和了吧。' : '好，和了吧。');
      endGame({ winner: null, reason: 'agreed' });
    }

    /**
     * 落子入口：先让教练看一眼。
     *
     * 教练**永远不替用户走棋**，也不禁止用户走。它只在你要掉坑的时候
     * 说一句，然后把决定权还给你——"换一手"还是"就这么走"由你定。
     * 坚持走错也照走，那一手会被复盘抓下来单独讲，印象比当场拦住深。
     */
    async function tryMove(m: Move) {
      dismissPanels();
      const token = ++moveToken;

      // 棋规上当场判负的一手（长将第三次），不管教练开没开都要先说
      const ruleEnd = previewEnd(m, me);
      if (ruleEnd && ruleEnd.winner === foe) {
        busy = true;
        const ok = await askConfirm(
          '这一步走完，同一局面就第三次出现了，而且你每一步都在将军——按规则是**长将判负**。长将必须变着。',
          '还是走',
          '换一手',
        );
        busy = false;
        if (token !== moveToken || over) return;
        if (!ok) {
          selected = null;
          scene.select(null);
          return;
        }
        doMove(m);
        return;
      }

      // 关着教练，或者走的是开局定式——按定式走还被拦，那是教练的问题
      if (hintLevel === 0 || isBookMove(board, me, m)) {
        doMove(m);
        return;
      }

      // 教练要看到足够深才判。你秒落子时研究可能才刚开始，等它一小会儿（通常不到一秒）
      const s = ensureStudy();
      if (!s.done && s.depth < s.minDepth) {
        busy = true;
        setCoachLine('教练看一眼这一手…', 'info');
        await s.until((x) => x.depth >= x.minDepth, 2500);
        busy = false;
        setCoachLine(null);
        if (token !== moveToken || over || turn !== me || !s.is(board, me)) return;
      }
      let v = judgeMove(board, m, me, s.moves.length ? s.moves : null, { depth: s.depth, final: s.done });
      // 你走的这一手引擎只排了个大概（不在前几名里）：先精确算它，再决定拦不拦
      if (needsExact(v)) {
        busy = true;
        setCoachLine('教练算一下这一手…', 'info');
        await s.refine(m);
        busy = false;
        setCoachLine(null);
        if (token !== moveToken || over || turn !== me || !s.is(board, me)) return;
        v = judgeMove(board, m, me, s.moves, { depth: s.depth, final: s.done });
      }
      if (!shouldWarn(hintLevel, v)) {
        doMove(m);
        return;
      }
      const fen = toFen(board, me);
      if (warnedHere.fen !== fen) warnedHere = { fen, keys: new Set() };
      warnedHere.keys.add(moveKey(m));

      busy = true; // 提示条开着的时候不接受别的点击
      sfxAlert();
      const before = board;
      const ply = moveLog.length;
      closeCoachPrompt = showCoachPrompt({
        host: wrap,
        level: hintLevel,
        before,
        move: m,
        me,
        verdict: v,
        ply,
        board: scene,
        study: s,
        // 差得太多的棋分析里只有下限，补一次精确计算，把"至少少一个车"说成真实的后果
        refine: () => s.refine(m),
        onProceed: (retracted, finalV) => {
          closeCoachPrompt = null;
          busy = false;
          // 教练最后仍然认为有问题、你还是走了：记下来，复盘时专门指给你看
          if (!retracted) coachFlags.set(ply, warnText(3, finalV, before, m));
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

    /**
     * 你这一手落子时，把研究里对这一手的判读留下来（复盘用），顺便看看值不值得夸。
     *
     * 只会挑错的教练让人越下越怕。真正的好棋——尤其是"只此一手"和"解掉对方的杀"——
     * 要当场说出来，这比事后复盘里一句"最佳"有用得多。
     */
    function noteMyMove(m: Move) {
      const s = study;
      const ply = moveLog.length;
      if (!s || !s.is(board, me) || !s.moves.length) return;
      const idx = s.moves.findIndex((x) => sameMove(x.move, m));
      if (idx < 0) return;
      const best = s.moves[0];
      bookAt.set(ply, { best, played: s.moves[idx], depth: s.depth, engine: s.engine });
      if (hintLevel < 2 || ply - praisedAt < 6) return;
      const after = applyMove(board, m);
      if (threatAtTurn && !mateInOne(after, foe) && idx <= 2) {
        praisedAt = ply;
        setCoachLine(`解杀了！${moveToText(board, m)} 挡住了对方的杀着。`, 'good', 4000);
        return;
      }
      const second = s.moves[1];
      if (idx === 0 && second && s.depth >= 5 && best.score > -9000) {
        const lead = best.score - second.score;
        if (lead >= 200) {
          praisedAt = ply;
          setCoachLine(`好棋！${moveToText(board, m)} 是这里唯一站得住的一手，其它走法都至少差${inPieces(lead)}。`, 'good', 4500);
        }
      }
    }

    function doMove(m: Move) {
      busy = true;
      selected = null;
      moveToken++;
      if (turn === me) noteMyMove(m);
      else setCoachLine(null);
      // 局面变了，这一份研究就没用了。掐掉它，把算力还给对手的搜索
      dropStudy();
      closeLost?.();
      const captured = !!board[m.ty][m.tx];
      const mover = board[m.fy][m.fx]!;
      history.push(board);
      moveLog.push(m);
      board = applyMove(board, m);
      turn = turn === 'r' ? 'b' : 'r';
      plies.push({ key: toFen(board, turn), mover: mover.c, check: isInCheck(board, turn), capture: captured });
      scene.hideCheck();
      scene.animateMove(m, () => {
        if (captured) {
          sfxSlash();
          // 对手吃了你的子才轮到它得意；原来写死成黑方，执黑时变成你吃子它在笑
          if (mover.c === foe) say(pickLine(rival.lines.capture ?? rival.lines.peng));
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
      if (over) return;
      const st = statusAfter(board, turn);
      if (st !== 'playing') {
        // 原来这里是 showResult(st === 'red-win')——执黑赢了会显示"你输了"
        const mated = isInCheck(board, turn);
        const k = findKing(board, turn);
        if (k) scene.finishBlast(k[0], k[1]);
        endGame({ winner: turn === 'r' ? 'b' : 'r', reason: mated ? 'mate' : 'stalemate' });
        return;
      }
      const fin = drawOrForfeit(board, startKey, plies);
      if (fin) {
        endGame(fin);
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
        const avoid = aiAvoid();
        const local = () =>
          requestMove(board, foe, {
            maxDepth: handicap?.depth ?? L.depth,
            jitter: handicap ? 0 : L.jitter,
            timeMs: handicap ? 2000 : L.timeMs,
            avoid,
          });
        const fsfMs = !handicap && 'fsfMs' in L ? (L.fsfMs as number) : 0;
        const pick: Promise<Move | null> =
          fsfMs && engineReady()
            ? engineBestMove(board, foe, fsfMs, { startFen: startKey, moves: moveLog.slice() }, avoid).then((m) => {
                lastAiEngine = m ? 'fsf' : 'local';
                return m ?? local();
              })
            : ((lastAiEngine = 'local'), local());
        pick.then((m) => {
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
        prepareTurn(); // 轮到你了，趁你想棋先把这个局面算好
        if (Math.random() < 0.14) say(pickLine(rival.lines.taunt));
      }
    }

    function undo() {
      dismissPanels();
      pendingTap = null;
      if (history.length === 0) return;
      // 结局已定就不能悔了：认输、议和、判和都是双方认过的
      if (over && ending && ending.reason !== 'mate' && ending.reason !== 'stalemate') return;
      if (busy && !over) return;
      moveToken++;
      dropStudy();
      clearTimeout(aiTimer);
      aiSeq++; // 作废正在跑的搜索
      scene.setThinking(false);
      // 退到轮回自己为止：轮到自己就退两手（自己+对手），否则退一手
      const steps = turn === me ? 2 : 1;
      for (let i = 0; i < steps && history.length > 0; i++) {
        board = history.pop()!;
        moveLog.pop();
        plies.pop();
      }
      // 悔掉的那几手，留下的判读和"没听劝"的标记都不作数了
      for (const k of [...bookAt.keys()]) if (k >= moveLog.length) bookAt.delete(k);
      for (const k of [...coachFlags.keys()]) if (k >= moveLog.length) coachFlags.delete(k);
      turn = me;
      over = false;
      ending = null;
      busy = false;
      selected = null;
      resultEl?.remove();
      resultEl = null;
      refreshTray();
      refreshLog();
      scene.setLastMove(moveLog.length ? moveLog[moveLog.length - 1] : null);
      scene.setSlideSec(TEMPO.slide);
      scene.syncBoard(board);
      setTurnUI();
      prepareTurn();
    }

    function restart() {
      dismissPanels();
      hintsUsed = 0;
      pendingTap = null;
      moveToken++;
      dropStudy();
      plies = [];
      bookAt = new Map();
      coachFlags = new Map();
      lostSaid = false;
      drawDeclinedAt = -99;
      praisedAt = -99;
      ending = null;
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
      warmupAi(board, foe);
      scene.dealIn();
      scene.setLastMove(null);
      refreshTray();
      refreshLog();
      setTurnUI(turn !== me);
      setCoachLine(null);
      prepareTurn();
      setTimeout(() => say(pickLine(rival.lines.greet)), 500);
      // 执黑重开：红方先走，得由对手走第一步，不然两边都干等着
      if (turn !== me) setTimeout(() => afterMove(), 400);
    }

    let resultEl: HTMLElement | null = null;
    let closeReview: (() => void) | null = null;
    /** 上一次结算的胜负，复盘要记进对局统计 */
    let lastWon = false;

    /**
     * 一盘棋结束的唯一入口：将死、困毙、认输、议和、判和、长将判负都走这里。
     * 原来只有"将死"一条路，结算逻辑散在 afterMove 里，加一种结局就要复制一遍。
     */
    function endGame(end: GameEnd, thenReview = false) {
      if (ending) return;
      ending = end;
      over = true;
      moveToken++;
      clearTimeout(aiTimer);
      aiSeq++;
      scene.setThinking(false);
      dropStudy();
      dismissPanels();
      busy = false;
      setCoachLine(null);
      setTurnUI();
      const quick = end.reason !== 'mate' && end.reason !== 'stalemate';
      setTimeout(() => {
        if (ending !== end) return; // 期间悔棋/重开了
        showResult(end);
        if (thenReview) openReview();
      }, quick ? 250 : 700);
    }

    function showResult(end: GameEnd) {
      const result: 'win' | 'loss' | 'draw' = end.winner === null ? 'draw' : end.winner === me ? 'win' : 'loss';
      const playerWon = result === 'win';
      lastWon = playerWon;
      handicap?.onFinish(playerWon);
      // 整盘存下来。存的是起始局面 + 着法序列，之后随时能翻回来复盘。
      // 存档在复盘之前就要落地——用户可能直接关掉不复盘，那盘棋也不能丢。
      if (moveLog.length >= 2 && !archivedId) {
        archivedId = archiveFromBoard(startSnapshot, 'r', moveLog, {
          side: me,
          result,
          level: handicap ? `让${handicap.strip}马` : L.name,
          rival: rival.name,
        });
      }
      if (result === 'win') {
        sfxWinBig();
        setTimeout(() => say(pickLine(rival.lines.lose)), 500);
      } else if (result === 'loss') {
        sfxLose();
        setTimeout(() => say(pickLine(rival.lines.win)), 400);
      } else {
        sfxKnock();
      }
      const mySide = me === 'r' ? '红方' : '黑方';
      const badge = result === 'win' ? (end.reason === 'mate' ? '绝杀' : '胜') : result === 'loss' ? '败' : '和';
      const title = result === 'win' ? `${mySide}胜 · 你赢了` : result === 'loss' ? `${rival.name} 胜` : '和棋';
      const sub = (() => {
        switch (end.reason) {
          case 'mate':
            return playerWon ? `${rival.name}已被将死（${L.name}难度）` : '你被将死了，再来一局？';
          case 'stalemate':
            return playerWon ? `${rival.name}被困毙——无子可动，按规则判负` : '你被困毙了：没有一步合法的棋可走，按规则判负';
          case 'resign':
            return '你认输了。输棋不丢人，复盘找到那一步，这一局就没白下。';
          case 'perpetual-check':
            return playerWon ? `${rival.name}长将，按规则判负` : '你一直在将军（长将），同一局面出现三次，按规则判负。长将必须变着。';
          default:
            return END_TEXT[end.reason];
        }
      })();
      const s = document.createElement('div');
      s.className = 'screen moba-result xq-result';
      s.innerHTML = `
        <div class="xq-result-badge ${result === 'win' ? 'win' : result === 'loss' ? 'lose' : 'draw'}">${badge}</div>
        <h1 style="color:${result === 'win' ? '#ffd76e' : result === 'loss' ? '#ef5350' : '#cfd8dc'}">${title}</h1>
        <div class="sub">${sub}</div>
        ${hintsUsed > 0 ? `<div class="xq-usedhint">这一局用了 ${hintsUsed} 次求助——照着引擎走出来的棋不算你的水平，复盘的时候心里有个数。</div>` : ''}
        ${coachFlags.size > 0 ? `<div class="xq-usedhint">教练拦过你 ${coachFlags.size} 次、你坚持走了——复盘里这几手标了 🧑‍🏫，先看它们。</div>` : ''}`;
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
        // 对局里教练已经算过你每一手，复盘直接用——同一手棋，对局里和复盘里说法必须一样
        known: bookAt,
        coachFlags,
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
    renderCoachLine();
    prepareTurn();
    /*
     * 专业引擎是异步加载的。开局第一步如果它还没好，这一步的研究先用自带引擎顶着；
     * 它一加载好，就把当前这一步换成它重算——前提是你还没在这一步上做过任何决定
     * （教练没开过口、求助面板没开着），否则中途换裁判，前后说法就可能对不上。
     */
    void loadEngine().then((ok) => {
      if (!ok || over || turn !== me || busy) return;
      if (!study || study.engine !== 'local' || !study.is(board, me)) return;
      if (closeCoachPrompt || closeBest || warnedHere.fen === study.fen) return;
      dropStudy();
      prepareTurn();
      renderCoachLine();
    });
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
        analysisReady: () => !!study && study.is(board, me) && (study.depth >= study.minDepth || study.done),
        /** 对手上一步用的引擎 */
        aiEngine: () => lastAiEngine,
        /** 当前研究用的是哪个引擎 */
        engine: () => (study ? study.engine : engineReady() ? 'fsf' : 'local'),
        /** 研究进度：算到第几层、算完没有、目前的首选 */
        study: () =>
          study && study.is(board, me)
            ? { depth: study.depth, done: study.done, best: study.moves[0]?.move ?? null, score: study.moves[0]?.score ?? 0 }
            : null,
        /** 内部状态，排查"点了没反应"用 */
        state: () => ({ busy, over, turn, selected, tip: !!closeCoachPrompt, ending }),
        /** 直接走一手（绕过点击），测试用 */
        play: (m: Move) => void tryMove(m),
        offerDraw: () => offerDraw(),
        coachLine: () => coachLine.textContent,
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
          dismissPanels();
          board = parsed.board;
          turn = parsed.toMove;
          // 起始快照也要跟着换：复盘和重开都以它为准，不改的话
          // 复盘会把这一局摆在一个从来没下过的局面上重算
          startSnapshot = cloneBoard(board);
          startKey = toFen(board, turn);
          dropStudy();
          moveToken++;
          history = [];
          moveLog = [];
          plies = [];
          bookAt = new Map();
          coachFlags = new Map();
          lostSaid = false;
          drawDeclinedAt = -99;
          praisedAt = -99;
          ending = null;
          over = false;
          busy = false;
          selected = null;
          scene.syncBoard(board);
          scene.setLastMove(null);
          refreshTray();
          refreshLog();
          setTurnUI();
          prepareTurn();
          return true;
        },
      };
    }

    cleanupGame = () => {
      closeReview?.();
      closeReview = null;
      dropStudy();
      dismissPanels();
      clearTimeout(lineTimer);
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
