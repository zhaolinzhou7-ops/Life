/**
 * 做题界面：摆出局面，**一手一手走到底**。
 *
 * 原来只判第一手：找到了第一步就算对，后面怎么杀、怎么把子赢下来都不管。
 * 用户原话："都是只有一步，应该很难有效果，需要做到将死才行"。现在：
 *
 *   - 杀法题要一直走到将死；战术题要把整条主变走完（子真的赢到手）。
 *   - 每一步都判：照着主变走的直接对；走出别的着法，让皮卡鱼判它是不是一样好
 *     （杀法题要求还能在剩下的步数里杀死），一样好就算对，接着下，对方改由皮卡鱼来应。
 *   - 残局题主变走完还没完：接着和皮卡鱼下到底——进攻方下到将死，守方守成和棋。
 *   - 中间哪一步错了，这题就算错，当场演出对方怎么惩罚你；可以从头再走一遍（不计分）。
 *   - 守和的题走成了死和（双方只剩一马/一炮、或者谁都没有进攻子力）就算做完，不用再一步步走。用户原话：
 *     "比如我方一个马、对方一个马一个兵……吃完之后就开始走和棋，要走很多步，这就没有意义。"
 *
 * 两个教学上的讲究照旧：
 *   1. **提示分三级**——直接给答案等于没练。先告诉你该动哪个子，
 *      还想不出再告诉你往哪走，最后才给整手。用了提示不计分但进错题本。
 *   2. **走错要看见反驳**——只说"错了"学不到东西，必须把对方怎么惩罚你演出来。
 */
import { fromFen, moveToText, textToMove, toFen } from './notation';
import { legalMoves, applyMove, isInCheck, statusAfter, type Board, type Color, type Move } from './rules';
import { movesFromTexts, openLineLab } from './linelab';
import { Board2D, type Mark } from './board2d';
import { requestMove } from './aiclient';
import { promptOf, type Puzzle } from './puzzles';
import { engineAnalyse, engineBestMove, engineCapable, engineReady, engineScoreMove, loadEngine } from './pikafish';
import type { MoveScore } from './ai';
import { runPlayout } from './playout';
import { isWon, whatItDoes, wrongTalk } from './coachexplain';
import { evalWords } from './analysis';
import { holds, holdsOk } from './holds';
import { retireOwnPuzzle } from './save';
import { bareMinors, noAttackers } from './endings';
import { minorsDead } from './minors';
import { holdXqMusic } from '../xqmusic';

export interface PuzzleResult {
  correct: boolean;
  usedHint: boolean;
  /** 限时模式下有没有超时 */
  timedOut?: boolean;
  /** 从出题到做完用了多少秒 */
  seconds?: number;
  /** 你走对了几步、一共几步（残局下到底的部分不算在里面） */
  steps?: number;
  stepsTotal?: number;
}

export interface PuzzleOpts {
  /** 顶部说明，比如「测评 3/35」 */
  caption?: string;
  /** 开场的一段话，放在棋盘下面的提示框里（顶上那一行放不下长话，比如"找回好棋"要说清楚原来走的哪一手、亏了多少） */
  lead?: string;
  /** 是否允许提示。测评时要关掉，不然测不准 */
  allowHint?: boolean;
  /**
   * 限时（秒），**每一步**都限这么久。0 或不填 = 不限时。
   *
   * 为什么要有限时这一档：**「算不出来」和「懒得算」是两个完全不同的病**，
   * 而不限时的时候它们长得一模一样——都是做错。不限时你会一直盯着看，
   * 最后蒙一个；限时逼你在时间内给出答案，做错之后再给你不限时重做一遍，
   * 两次的差别就把病因分出来了：限时错、不限时对 = 你算得出来只是没去算；
   * 两次都错 = 是真的算不出来。前者练的是习惯，后者练的是能力，
   * 练法完全不同。
   */
  timeLimit?: number;
  /**
   * 残局题主变走完之后，要不要接着和皮卡鱼下到底（默认要）。
   * 测评、限时计算要控制时长，关掉——主变照样要一步步走完。
   */
  playToEnd?: boolean;
  /** 答完之后点"继续"触发 */
  onDone: (r: PuzzleResult) => void;
  /**
   * 中途退出。
   *
   * 原来没有这个：一旦开始十道题的练习，不答完十道就出不去——
   * 顶上只有题号，底下只有提示和跳过。用户想走的时候只能刷新页面。
   * 任何会占满屏幕的流程都必须留一个出口，这是底线。
   */
  onExit?: () => void;
}

/**
 * 主变之外的一手站不站得住：不只比分差，还看最后的结果（holds.ts，和离线复核题库是同一份）。
 * 用户原话："我觉得要从深度思考的决定、从最终的结果，再去判定这个走法合不合适。"
 * 头一次核对只算 1.5 秒（手机上十二三层）：要判你错之前，再算这么久确认一遍
 */
const CONFIRM_MS = 5000;
/** 皮卡鱼核对主变之外的一手：对不对、为什么，以及同一次搜索里你这手和最好那手的分数和主变（讲解要用） */
interface AltJudge {
  ok: boolean;
  why: string;
  best?: MoveScore;
  mine?: MoveScore;
}
const sameMove = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

/** 等皮卡鱼加载最多等这么久 */
const ENGINE_WAIT = 15000;

function within(p: Promise<boolean>, ms: number): Promise<boolean> {
  return Promise.race([p, new Promise<boolean>((r) => setTimeout(() => r(false), ms))]);
}

/** 残局题要下到底的话，目标是什么：领先够多的要赢（下到将死），接近均势的守和；落后的不下 */
export function endgameTarget(p: Puzzle): 'win' | 'draw' | null {
  if (p.kind !== 'endgame' || p.ev === undefined) return null;
  if (p.goal === 'mate' || p.ev >= 300) return 'win';
  if (Math.abs(p.ev) < 150) return 'draw';
  return null;
}

export function runPuzzle(host: HTMLElement, puzzle: Puzzle, opts: PuzzleOpts): () => void {
  const parsed = fromFen(puzzle.fen);
  const wrap = document.createElement('div');
  wrap.className = 'xq-tr';
  host.appendChild(wrap);

  if (!parsed) {
    wrap.innerHTML = '<div class="xq-tr-bad">这道题的局面读不出来，已跳过。</div>';
    setTimeout(() => opts.onDone({ correct: false, usedHint: false }), 600);
    return () => wrap.remove();
  }
  // 残局题放配乐（一道接一道不断，见 holdXqMusic）。用户原话："在做残局和做复盘的时候，音乐也可以默认打开"
  const releaseMusic = puzzle.kind === 'endgame' ? holdXqMusic('endgame', 0.3) : () => {};

  const start: Board = parsed.board;
  const me: Color = parsed.toMove;
  const foe: Color = me === 'r' ? 'b' : 'r';
  const allowHint = opts.allowHint !== false;
  const isMate = puzzle.kind === 'mate' || puzzle.goal === 'mate';
  const line = puzzle.line?.length ? puzzle.line : [puzzle.answer];
  /** 你一共要走几步 */
  const baseMine = Math.ceil(line.length / 2);
  /** 你一共要走几步：杀法题走了一手慢一点的杀，步数跟着放宽（见 judgeAlt） */
  let totalMine = baseMine;
  const target = opts.playToEnd === false ? null : endgameTarget(puzzle);
  const engineUp = engineCapable() ? within(loadEngine(), ENGINE_WAIT) : Promise.resolve(false);

  let board: Board = start;
  /** 走过的着法（从题目局面起，双方都有） */
  let played: Move[] = [];
  /** 下一手在主变里的位置（偶数 = 轮到你） */
  let ply = 0;
  /** 还在主变上。你走了一样好的别的着法之后就离开主变，由皮卡鱼接着应 */
  let onLine = true;
  let myStep = 0;
  let selected: { x: number; y: number } | null = null;
  let hintLevel = 0;
  let usedHint = false;
  /** 这一题的结果已经定了（做完、做错、跳过、超时） */
  let answered = false;
  /** 第一次的结果：从头再走一遍不改它 */
  let verdict: PuzzleResult | null = null;
  /** 从头再走一遍（练习，不计分） */
  let practice = false;
  let busy = false;
  /** 每次重来加一：之前没回来的引擎结果作废 */
  let token = 0;
  const startedAt = Date.now();
  let stepAt = Date.now();
  const limit = opts.timeLimit ?? 0;
  let timer = 0;
  let disposePlayout: (() => void) | null = null;
  /** 最近一次皮卡鱼核对（判错之后讲解直接用这一份，不再另算——另算的"该走什么"会和判分对不上） */
  let lastJudge: AltJudge | null = null;

  wrap.innerHTML = `
    <div class="xq-tr-top">
      ${opts.onExit ? '<button class="xq-tr-quit" title="退出练习">← 退出</button>' : ''}
      <span class="xq-tr-cap">${opts.caption ?? ''}</span>
      <span class="xq-tr-ask">${promptOf(puzzle)}${puzzle.mateIn && !puzzle.prompt ? `（${puzzle.mateIn} 步杀）` : ''}</span>
      <span class="xq-tr-side"><i class="who ${me}">${me === 'r' ? '红方走' : '黑方走'}</i><span>难度 ${puzzle.rating}</span></span>
    </div>
    <div class="xq-tr-steps"></div>
    ${
      puzzle.threat?.length
        ? `<div class="xq-tr-threat">⚠️ 对方下一步就能杀你：你走一步闲着就输。<button class="xq-tr-threat-btn">👁 看他怎么杀</button></div>`
        : ''
    }
    <div class="xq-tr-board"></div>
    ${limit ? '<div class="xq-tr-clock"><i></i><span></span></div>' : ''}
    <div class="xq-tr-fb"></div>
    <div class="xq-tr-bar"></div>`;

  const elQuit = wrap.querySelector('.xq-tr-quit') as HTMLButtonElement | null;
  if (elQuit) elQuit.onclick = () => opts.onExit!();
  const elBoard = wrap.querySelector('.xq-tr-board') as HTMLElement;
  const elSteps = wrap.querySelector('.xq-tr-steps') as HTMLElement;
  const elFb = wrap.querySelector('.xq-tr-fb') as HTMLElement;
  const elBar = wrap.querySelector('.xq-tr-bar') as HTMLElement;

  // 执黑的题把棋盘转过来，让"自己"永远在下方，符合实战视角
  const view = new Board2D(elBoard, { flip: me === 'b', onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);

  // 绝地反杀：看对方的杀着（不算提示——看清楚危险在哪是读局面的一部分，看完照样得自己找出连将）
  const elThreat = wrap.querySelector('.xq-tr-threat-btn') as HTMLButtonElement | null;
  if (elThreat && puzzle.threat?.length) {
    let shown = false;
    elThreat.onclick = () => {
      if (ply > 0) return;
      shown = !shown;
      const arrows = shown
        ? puzzle.threat!.map((t) => textToMove(start, foe, t, legalMoves(start, foe))).filter((m): m is Move => !!m)
        : [];
      view.setArrows(arrows.map((m) => ({ fx: m.fx, fy: m.fy, tx: m.tx, ty: m.ty, color: 'rgba(214,64,52,0.85)' })));
      elThreat.textContent = shown ? `他的杀着：${puzzle.threat!.join('、')}（再点收起）` : '👁 看他怎么杀';
    };
  }

  /** 我方合法着法 */
  const legal = () => legalMoves(board, me).filter((m) => !isInCheck(applyMove(board, m), me));
  const history = () => ({ startFen: toFen(start, me), moves: played.slice() });

  function renderSteps() {
    const goal = isMate ? '走到将死' : target ? '主变走完再下到底' : '整条走完';
    elSteps.textContent = `${practice ? '再走一遍（不计分）· ' : ''}第 ${Math.min(myStep + 1, totalMine)} / ${totalMine} 步 · ${goal}${
      onLine ? '' : ' · 已离开原谱，皮卡鱼接着应'
    }`;
  }

  function marksFor(sel: { x: number; y: number } | null): Mark[] {
    if (!sel) return [];
    const out: Mark[] = [{ x: sel.x, y: sel.y, kind: 'ring' }];
    for (const m of legal()) if (m.fx === sel.x && m.fy === sel.y) out.push({ x: m.tx, y: m.ty, kind: 'dot' });
    return out;
  }

  function onTap(x: number, y: number) {
    if (answered || busy) return;
    const p = board[y][x];
    if (selected) {
      const mv = legal().find((m) => m.fx === selected!.x && m.fy === selected!.y && m.tx === x && m.ty === y);
      if (mv) {
        void submit(mv);
        return;
      }
    }
    if (p && p.c === me) {
      selected = { x, y };
      view.setMarks(marksFor(selected));
    } else {
      selected = null;
      view.setMarks([]);
    }
  }

  /**
   * 主变之外的一手，让皮卡鱼判：
   *   杀法题——走完还能在剩下的步数里杀死；
   *   其它题——比引擎首选差不到 ALT_TOLERANCE，或者局面已经赢定了、这一手保住了胜势。
   * 引擎起不来返回 null（只能认主变）。
   */
  async function judgeAlt(before: Board, mv: Move): Promise<AltJudge | null> {
    if (!(await engineUp) || !engineReady()) return null;
    const h = history();
    const left = totalMine - myStep;
    if (isMate) {
      const mine = await engineScoreMove(before, me, mv, { movetime: 1500, history: h });
      if (!mine) return null;
      if (mine.mateIn !== undefined && mine.mateIn > 0) {
        if (mine.mateIn <= left) return { ok: true, why: `这一手也杀得了（${mine.mateIn} 步之内将死）`, mine };
        /*
         * 慢一点的杀也是杀。用户原话："还是存在必胜残局在找最佳步数"——能杀死就算对，不苛求最快的那条；
         * 步数放宽到这条杀要的步数（20 步以内），接着下到将死为止。告诉你最快是几步，下次能看得更快。
         */
        if (mine.mateIn <= 20) {
          totalMine = myStep + mine.mateIn;
          return { ok: true, why: `这一手也能杀，要 ${mine.mateIn} 步——最快是 ${left} 步，接着把它杀死`, mine };
        }
        return { ok: false, why: `这一手要 ${mine.mateIn} 步才杀得了，绕得太远了——这里 ${left} 步就能杀`, mine };
      }
      return {
        ok: false,
        why: isWon(mine) ? '走了这一手就杀不成了（局面还是大优，但这题练的是找杀）' : '走了这一手，就杀不成了',
        mine,
      };
    }
    /*
     * 你这一手和最好的那一手要在**同一次搜索**里比。原来是三次各算各的：一次算你这手、一次算最好的、
     * 判错之后再算一次"该走什么"——搜索时间不同分数就差出一个兵上下，于是出现了
     * "你走的是 帅五退一……这一步该走 帅五退一"（用户截图）：你走的就是首选，却被判差了 0.9 个兵。
     */
    const rule = (best: MoveScore, mine: MoveScore, deep: boolean): AltJudge => {
      const by = deep ? '皮卡鱼算深了再核对' : '皮卡鱼核对过';
      const pawns = ((best.score - mine.score) / 100).toFixed(1);
      // 判法和离线复核题库是同一份（holds.ts）：不只比分差，还看最后的结果一样不一样
      const h = holds(best, mine, { same: sameMove(best.move, mv) });
      const why = (() => {
        switch (h) {
          case 'same':
            return `${by}：这就是它的首选`;
          case 'close':
            return `${by}：这一手和最好的差不多`;
          case 'won':
            // 已经赢定了的局面：保住胜势就行，不苛求最快赢的那一手（用户原话："还是存在必胜残局在找最佳步数"）
            return `已经赢定了：这一手保住了胜势（${evalWords(me === 'r' ? mine.score : -mine.score, mine.mateIn === undefined ? undefined : me === 'r' ? mine.mateIn : -mine.mateIn)}），不必非走最快的那一手`;
          case 'result':
            return `${by}：这一手比最好的少约 ${pawns} 个兵，可局面一样站得住，最后的结果一样`;
          case 'mated':
            return `走了这一手，对方有 ${-(mine.mateIn ?? 0)} 步杀`;
          case 'missed-mate':
            return `这里有 ${best.mateIn} 步杀，这一手放过了`;
          case 'lost-win':
            return `${by}：这一手把赢定的棋走没了（少了约 ${pawns} 个兵）`;
          case 'to-lost':
            return `${by}：走了这一手局面就输定了（少了约 ${pawns} 个兵）`;
          default:
            return `${by}：这一手比最好的差了约 ${pawns} 个兵`;
        }
      })();
      return { ok: holdsOk(h), why, best, mine };
    };
    const list = await engineAnalyse(before, me, { movetime: 1500, multipv: 3, include: mv, history: h });
    const best = list?.find((s) => !s.bound);
    const mine = list?.find((s) => !s.bound && sameMove(s.move, mv));
    if (!best || !mine) return null;
    const quick = rule(best, mine, false);
    // 要判你错、又不是一眼就输（被杀、丢大子）的：算深一点再定——浅算的分差常常是假的
    if (quick.ok || (mine.mateIn !== undefined && mine.mateIn < 0) || best.score - mine.score >= 900) return quick;
    elFb.innerHTML = `<div class="l">你走的是 ${moveToText(before, mv)}——皮卡鱼算深一点再核对…</div>`;
    const deep = await engineAnalyse(before, me, { movetime: CONFIRM_MS, multipv: 2, include: mv, history: h });
    const best2 = deep?.find((s) => !s.bound);
    const mine2 = deep?.find((s) => !s.bound && sameMove(s.move, mv));
    return best2 && mine2 ? rule(best2, mine2, true) : quick;
  }

  /** 这一步该走什么：在主变上就是主变，离开了就问皮卡鱼。b / moves 是轮到你时的局面和着法 */
  async function expected(b: Board = board, moves: Move[] = played): Promise<Move | null> {
    if (onLine) return textToMove(b, me, line[ply], legalMoves(b, me));
    if (!(await engineUp)) return null;
    return engineBestMove(b, me, 1000, { startFen: toFen(start, me), moves: moves.slice() });
  }

  async function submit(mv: Move) {
    const my = token;
    busy = true;
    selected = null;
    view.setMarks([]);
    view.setArrows([]);
    const before = board;
    const text = moveToText(before, mv);
    let ok = false;
    let note = '';
    lastJudge = null;
    if (onLine && text === line[ply]) ok = true;
    else if (onLine && ply === 0 && puzzle.also?.includes(text)) {
      // 一样好的着法一律算对：杀法题里同样步数的杀棋常常不止一手
      ok = true;
      note = `这手和 <b>${line[0]}</b> 一样好`;
      onLine = false;
    } else if (onLine && puzzle.ok?.[myStep]?.includes(text)) {
      // 离线深算过（tools/deep-audit + deep-apply）：这一步走这手，最后的结果和原谱一样
      ok = true;
      note = `皮卡鱼深算过：这一手和原谱的 <b>${line[ply]}</b> 一样站得住`;
      onLine = false;
    } else {
      elFb.className = 'xq-tr-fb tip';
      elFb.innerHTML = `<div class="l">你走的是 ${text}，不是原谱那一手——正在让皮卡鱼核对…</div>`;
      const j = await judgeAlt(before, mv);
      if (my !== token) return;
      lastJudge = j;
      if (j?.ok) {
        ok = true;
        note = j.why;
        onLine = false;
      } else {
        note = j ? j.why : '皮卡鱼没加载起来，这一步只认原谱';
      }
    }
    board = applyMove(before, mv);
    played.push(mv);
    view.animateMove(mv, board, () => {
      if (my !== token) return;
      if (ok) void afterRight(text, note);
      else void wrong(text, note, before);
    });
  }

  /**
   * 守和的题（不是杀法、原来就不领先）走成了死和：谁都赢不了了，题就做完了。
   * 各剩一马/一炮的子摆得别扭时会有杀，先让皮卡鱼看一眼（minors.ts）；引擎起不来就只认谁都没有进攻子力的
   */
  async function deadDrawNow(toMove: Color): Promise<string | null> {
    if (isMate || (puzzle.ev ?? 0) >= 150) return null;
    if (noAttackers(board)) return '双方都没有能进攻的子了';
    if (!bareMinors(board, toMove)) return null;
    if (!(await engineUp) || !engineReady()) return null;
    return (await minorsDead(board, toMove, history())) ? '双方各只剩一个马或炮' : null;
  }

  async function afterRight(text: string, note: string) {
    const my = token;
    myStep++;
    ply++;
    // 将死了：杀法题就是要到这一步
    if (statusAfter(board, foe) !== 'playing') return solved(`✅ ${text}，将死！`);
    const dead = await deadDrawNow(foe);
    if (my !== token) return;
    if (dead) return solved(`✅ ${text}——${dead}，已经是和棋，不用再走了`);
    // 主变里已经没有你的下一步了（最后剩对方一手应着也不用再走）
    const lineDone = onLine ? ply + 1 >= line.length : myStep >= totalMine;
    if (lineDone) {
      // 残局题：主变走完还要下到底（杀法残局也在这里：下到将死为止）
      if (target) return toPlayout(text);
      // 离开原谱之后按引擎的杀法在走，步数用完还没杀死
      if (isMate && !onLine) return failNoMate(text);
      return solved(`✅ ${text}${note ? `（${note}）` : ''}——整条走完了`);
    }
    elFb.className = 'xq-tr-fb ok';
    elFb.innerHTML = `<div class="h">✅ ${text}${note ? `　<span class="l">${note}</span>` : ''}</div><div class="l">对方在应…</div>`;
    // 对方应一手：主变上照谱走，离开了由皮卡鱼走（它会走最顽强的那一手）
    let reply: Move | null = null;
    if (onLine && ply < line.length) {
      reply = textToMove(board, foe, line[ply], legalMoves(board, foe).filter((m) => !isInCheck(applyMove(board, m), foe)));
      if (!reply) onLine = false;
    }
    if (!reply) {
      reply = (await engineUp) ? await engineBestMove(board, foe, 800, history()) : null;
      reply ??= await requestMove(board, foe, { maxDepth: 8, jitter: 0, timeMs: 900 });
    }
    if (my !== token) return;
    if (!reply) return solved(`✅ ${text}——对方无路可走了`);
    const rt = moveToText(board, reply);
    board = applyMove(board, reply);
    played.push(reply);
    ply++;
    view.animateMove(reply, board, async () => {
      if (my !== token) return;
      // 对方这一手（比如吃掉你最后一个兵）走成了死和：守和的题照样算做完
      const dead = await deadDrawNow(me);
      if (my !== token) return;
      if (dead) return solved(`✅ ${text}　对方应 ${rt}——${dead}，已经是和棋，不用再走了`);
      busy = false;
      view.setArrows([{ fx: reply!.fx, fy: reply!.fy, tx: reply!.tx, ty: reply!.ty, color: 'rgba(214,64,52,0.7)' }]);
      elFb.className = 'xq-tr-fb ok';
      // 皮卡鱼核对时说的那句（"这一手也能杀，要 3 步——最快是 2 步""已经赢定了……"）对方应完也留着
      elFb.innerHTML = `<div class="h">✅ ${text}　对方应 ${rt}</div>${note ? `<div class="l">${note}</div>` : ''}<div class="l">接着走${isMate ? '，直到将死' : ''}。</div>`;
      hintLevel = 0;
      stepAt = Date.now();
      renderSteps();
      renderBar();
    });
  }

  function solved(head: string) {
    busy = false;
    answered = true;
    view.clearMarks();
    elFb.className = 'xq-tr-fb ok';
    elFb.innerHTML = `<div class="h">${head}</div>${
      puzzle.line.length > 1 ? `<div class="l">原谱：${puzzle.line.join(' ')}</div>` : ''
    }${
      puzzle.blunder
        ? puzzle.id.startsWith('own-')
          ? `<div class="r">这是你自己那盘棋里的局面——当时你走的是 <b>${puzzle.blunder}</b>，这次走对了。</div>`
          : `<div class="r">这个局面是从真实对局里抓的——当时那盘棋走的是 <b>${puzzle.blunder}</b>，亏了子。</div>`
        : ''
    }`;
    settle(true);
  }

  /** 残局题：主变走完了，接着和皮卡鱼下到底。达成目标才算做对 */
  function toPlayout(text: string) {
    busy = true;
    elFb.className = 'xq-tr-fb ok';
    elFb.innerHTML = `<div class="h">✅ ${text}——前面几步都对了</div>
      <div class="l">残局要下到底才算：接着和皮卡鱼下，${target === 'win' ? '一直下到<b>将死</b>' : '<b>守成和棋</b>'}。</div>`;
    elBar.innerHTML = '<button class="xq-btn primary" id="xq-tr-on">接着下到底 →</button><button class="xq-btn ghost" id="xq-tr-giveup">不下了（这题算错）</button>';
    (elBar.querySelector('#xq-tr-on') as HTMLButtonElement).onclick = () => startPlayout();
    (elBar.querySelector('#xq-tr-giveup') as HTMLButtonElement).onclick = () => {
      answered = true;
      elFb.className = 'xq-tr-fb no';
      elFb.innerHTML = '<div class="h">没下到底</div><div class="l">残局的功夫在后面几十步，下次坚持下完。</div>';
      settle(false);
    };
  }

  function startPlayout() {
    const fen = toFen(board, foe);
    let first: PuzzleResult | null = null;
    const launch = () => {
      disposePlayout?.();
      wrap.hidden = true;
      disposePlayout = runPlayout(host, {
        fen,
        you: me,
        target: target!,
        title: '残局下到底',
        subtitle: `${promptOf(puzzle)} · 前面 ${myStep} 步已经走对`,
        tips: [],
        onDone: (r, _n, st) => {
          if (first) return; // 再来一次的不计分
          const pass = r === 'win' || (r === 'draw' && target === 'draw');
          if (pass && (st.hints || st.undos)) usedHint = true;
          first = result(pass);
        },
        onRestart: () => launch(),
        onExit: () => {
          disposePlayout?.();
          disposePlayout = null;
          opts.onDone(verdict ?? first ?? result(false));
        },
      });
    };
    launch();
  }

  function result(correct: boolean): PuzzleResult {
    return {
      correct: correct && !practice,
      usedHint: usedHint || hintLevel > 0,
      seconds: Math.round((Date.now() - startedAt) / 100) / 10,
      steps: myStep,
      stepsTotal: totalMine,
    };
  }

  /** 定下这一题的结果（第一次作数），底下换成"继续 / 再走一遍" */
  function settle(correct: boolean, timedOut = false) {
    clearInterval(timer);
    if (!verdict) verdict = { ...result(correct), timedOut };
    const r = verdict;
    elBar.innerHTML = `<button class="xq-btn primary" id="xq-tr-next">继续 →</button>
      <button class="xq-btn ghost" id="xq-tr-again">从头再走一遍</button>`;
    (elBar.querySelector('#xq-tr-next') as HTMLButtonElement).onclick = () => opts.onDone(r);
    (elBar.querySelector('#xq-tr-again') as HTMLButtonElement).onclick = () => restart();
    // 原谱别只写一串字：在棋盘上一步步走给你看，走到哪一步还能问"这里还有哪几种走法"
    if (puzzle.line.length > 1 && !elFb.querySelector('[data-lab-open]')) {
      const b = document.createElement('button');
      b.className = 'xq-lab-open';
      b.dataset.labOpen = '';
      b.textContent = '▶ 在棋盘上一步步看原谱（还能看别的走法）';
      b.onclick = () =>
        openLineLab({
          board: start,
          turn: me,
          line: movesFromTexts(start, me, puzzle.line),
          title: '原谱 · 一步步看',
          intro: promptOf(puzzle),
        });
      elFb.appendChild(b);
    }
  }

  /** 这一步除了原谱，深算过一样站得住的那几手 */
  const okHere = () => [...new Set([...(ply === 0 ? (puzzle.also ?? []) : []), ...(puzzle.ok?.[myStep] ?? [])])];

  async function wrong(text: string, why: string, before: Board) {
    const my = token;
    busy = false;
    answered = true;
    const right = onLine ? line[ply] : null;
    const rest = onLine ? line.slice(ply + 1).join(' ') : '';
    const mv = played[played.length - 1];
    const j = lastJudge;
    // 该走的那一手：在主变上就是原谱那一手；离开了用**同一次核对**里皮卡鱼的首选——不再另算一次（另算会和判分对不上）
    const engineBest = j?.best && !sameMove(j.best.move, mv) ? j.best : null;
    const bestText = right ?? (engineBest ? moveToText(before, engineBest.move) : null);
    elFb.className = 'xq-tr-fb no';
    elFb.innerHTML = `
      <div class="h">❌ ${myStep ? `第 ${myStep + 1} 步` : ''}不对 · 你走的是 ${text}</div>
      <div class="l">${why ? why + '。' : ''}${
        bestText
          ? `这一步该走 <b>${bestText}</b>${right && okHere().length ? `（走 ${okHere().join('、')} 也一样）` : ''}${rest ? `　之后：${rest}` : ''}`
          : ''
      }</div>
      ${
        puzzle.id.startsWith('own-') && !engineReady()
          ? '<div class="r dim">这是从你自己的对局里抓的题，皮卡鱼没加载起来时只对着引擎首选判分——走出另一手一样好的也会算错。</div>'
          : ''
      }
      ${
        puzzle.blunder && !myStep
          ? puzzle.id.startsWith('own-')
            ? `<div class="r">实战里你在这里走的是 ${puzzle.blunder}——${puzzle.blunder === text ? '又是同一手，这个坑明天还会回来找你' : '这次换了一手，还是没走到点子上'}。</div>`
            : `<div class="r">别灰心——这个局面是从真实对局里抓的，当时那盘棋也走错了（走的是 ${puzzle.blunder}）。</div>`
          : ''
      }
      <div class="r pun">🧑‍🏫 教练在算：对方会怎么接、该走的那一手好在哪……</div>`;
    settle(false);
    const el = () => elFb.querySelector('.pun') as HTMLElement | null;
    /*
     * 教练讲解（用户原话："教练讲解再细致一些"）：你这手在干什么、对方会怎么一手手接（最后算账）、
     * 该走的那手在干什么和这一路的计划、两边差多少。核对时已经算过的直接用。
     */
    const histBefore = { startFen: toFen(start, me), moves: played.slice(0, -1) };
    let mine = j?.mine && (j.mine.pv?.length ?? 0) >= 2 ? j.mine : null;
    let best: MoveScore | null = engineBest;
    const rightMove = right ? textToMove(before, me, right, legalMoves(before, me)) : null;
    if ((await engineUp) && engineReady()) {
      if (!mine || (!best && !rightMove)) {
        const list = await engineAnalyse(before, me, { movetime: 1200, multipv: 2, include: mv, history: histBefore });
        if (my !== token) return;
        mine ??= list?.find((s) => !s.bound && sameMove(s.move, mv)) ?? null;
        if (!rightMove) best ??= list?.find((s) => !s.bound && !sameMove(s.move, mv)) ?? null;
      }
      if (rightMove) {
        // 原谱那一手的分和后续：讲"该走的好在哪"要用它，不能拿引擎别的首选来讲
        best = (j?.best && sameMove(j.best.move, rightMove) ? j.best : null) ?? (await engineScoreMove(before, me, rightMove, { movetime: 900, history: histBefore }));
        if (my !== token) return;
      }
    }
    const box = el();
    if (!box) return;
    if (mine) {
      box.outerHTML = `${wrongTalk(before, me, mine, { best, bestText: bestText ?? undefined })}
        ${(mine.pv?.length ?? 0) >= 3 ? '<button class="xq-talk-lab" data-talk-lab>▶ 在棋盘上一步步看对方怎么接</button>' : ''}`;
      const btn = elFb.querySelector('[data-talk-lab]') as HTMLButtonElement | null;
      if (btn)
        btn.onclick = () =>
          openLineLab({
            board: before,
            turn: me,
            line: mine!.pv,
            me,
            flip: me === 'b',
            title: `你走 ${text} · 对方怎么接`,
            intro: `你走的是 ${text}——点「下一步」看对方怎么接，每一步都能点「🔀 几种走法」换一条路`,
          });
      const reply = mine.pv[1];
      if (reply) view.setArrows([{ fx: reply.fx, fy: reply.fy, tx: reply.tx, ty: reply.ty, color: 'rgba(214,64,52,0.92)' }]);
      return;
    }
    // 皮卡鱼起不来：退回自带引擎，至少说出对方下一手
    const snapshot = board;
    const reply = await requestMove(snapshot, foe, { maxDepth: 6, jitter: 0, timeMs: 1200 });
    if (my !== token) return;
    const b2 = el();
    if (!b2) return;
    if (!reply) {
      b2.remove();
      return;
    }
    b2.innerHTML = `对方接下来会走 <b>${moveToText(snapshot, reply)}</b>：${whatItDoes(snapshot, reply, foe, me)}。`;
    view.setArrows([{ fx: reply.fx, fy: reply.fy, tx: reply.tx, ty: reply.ty, color: 'rgba(214,64,52,0.92)' }]);
  }

  function failNoMate(text: string) {
    busy = false;
    answered = true;
    elFb.className = 'xq-tr-fb no';
    elFb.innerHTML = `<div class="h">❌ ${text}：步数用完了，还没将死</div><div class="l">原谱：${puzzle.line.join(' ')}</div>`;
    settle(false);
  }

  /** 从头再走一遍：局面复原，结果不改（第一次作数） */
  function restart() {
    token++;
    practice = true;
    board = start;
    played = [];
    ply = 0;
    onLine = true;
    myStep = 0;
    totalMine = baseMine;
    hintLevel = 0;
    answered = false;
    busy = false;
    selected = null;
    view.setBoard(board);
    view.clearMarks();
    view.setArrows([]);
    elFb.className = 'xq-tr-fb';
    elFb.innerHTML = '<div class="l">再走一遍，这次不计分——把每一步为什么这么走想清楚。</div>';
    renderSteps();
    renderBar();
  }

  /** 三级提示：动哪个子 → 往哪走 → 整手 */
  async function hint() {
    if (answered || busy) return;
    const my = token;
    hintLevel++;
    usedHint = true;
    const sol = await expected();
    if (!sol || my !== token) return;
    const text = moveToText(board, sol);
    if (hintLevel === 1) {
      view.setMarks([{ x: sol.fx, y: sol.fy, kind: 'ring' }]);
      elFb.className = 'xq-tr-fb tip';
      elFb.innerHTML = '<div class="l">💡 该动的是圈出来的那个子。</div>';
    } else if (hintLevel === 2) {
      const dir =
        sol.ty === sol.fy ? '横着走' : (sol.ty - sol.fy) * (me === 'r' ? -1 : 1) > 0 ? '往前走' : '往后退';
      view.setMarks([{ x: sol.fx, y: sol.fy, kind: 'ring' }]);
      elFb.className = 'xq-tr-fb tip';
      elFb.innerHTML = `<div class="l">💡 这个子要${dir}。</div>`;
    } else {
      view.setMarks([{ x: sol.fx, y: sol.fy, kind: 'ring' }]);
      view.setArrows([{ fx: sol.fx, fy: sol.fy, tx: sol.tx, ty: sol.ty }]);
      elFb.className = 'xq-tr-fb tip';
      elFb.innerHTML = `<div class="l">💡 这一步是 <b>${text}</b>，照着走。</div>`;
    }
    renderBar();
  }

  function renderBar() {
    if (answered) return;
    elBar.innerHTML = allowHint
      ? `<button class="xq-btn" id="xq-tr-hint">💡 提示${hintLevel ? `（已用 ${hintLevel}/3）` : ''}</button>
         <button class="xq-btn ghost" id="xq-tr-skip">看答案</button>`
      : `<span class="xq-tr-note">${
          limit ? '限时题不给提示——限时就是要逼你自己算' : '这一轮不给提示，凭自己判断就好'
        }</span>`;
    const h = elBar.querySelector('#xq-tr-hint') as HTMLButtonElement | null;
    if (h) h.onclick = () => void hint();
    const s = elBar.querySelector('#xq-tr-skip') as HTMLButtonElement | null;
    if (s)
      s.onclick = () => {
        if (busy) return;
        answered = true;
        elFb.className = 'xq-tr-fb no';
        elFb.innerHTML = `<div class="h">看了答案</div><div class="l">${
          onLine ? `这一步：<b>${line[ply]}</b>　原谱：${puzzle.line.join(' ')}` : `原谱：${puzzle.line.join(' ')}`
        }</div>`;
        settle(false);
      };
  }

  // 限时：每一步走一条读秒进度条，到点自动判超时
  if (limit) {
    const clock = wrap.querySelector('.xq-tr-clock') as HTMLElement;
    const barI = clock.querySelector('i') as HTMLElement;
    const barT = clock.querySelector('span') as HTMLElement;
    timer = window.setInterval(() => {
      if (answered) {
        clearInterval(timer);
        return;
      }
      if (busy) {
        stepAt = Date.now();
        return;
      }
      const left = Math.max(0, limit - (Date.now() - stepAt) / 1000);
      barI.style.width = `${(left / limit) * 100}%`;
      barT.textContent = `${left.toFixed(0)}s`;
      clock.classList.toggle('hot', left <= limit * 0.25);
      if (left <= 0) {
        clearInterval(timer);
        answered = true;
        elFb.className = 'xq-tr-fb no';
        elFb.innerHTML = `<div class="h">⏱ 时间到${myStep ? `（走到第 ${myStep + 1} 步）` : ''}</div>
          <div class="l">${onLine ? `这一步：<b>${line[ply]}</b>　` : ''}原谱：${puzzle.line.join(' ')}</div>
          <div class="r">时间到不等于你不会。等会儿会把这道题<b>不限时</b>再给你一次——
          两次的差别能分清是"算不出来"还是"没去算"。</div>`;
        settle(false, true);
      }
    }, 100);
  }

  renderSteps();
  renderBar();
  if (opts.lead) {
    elFb.className = 'xq-tr-fb tip';
    elFb.innerHTML = `<div class="l">${opts.lead}</div>`;
  }

  /*
   * 自己棋局里的题：先看一眼这个局面是不是本来就赢定了（第二好的走法也大优）。
   * 是的话这不是错着，是"赢棋里少赢一点"——从专属课拿掉，这一题保住胜势的走法都算对（judgeAlt 本来就这么判）。
   * 早先存进来的题没有这个检查，这里顺手清掉；新的复盘在存的时候就不收这种局面了。
   */
  let wonAnyway = false;
  if (puzzle.id.startsWith('own-') && !isMate) {
    void (async () => {
      if (!(await engineUp) || !engineReady()) return;
      const list = await engineAnalyse(start, me, { movetime: 900, multipv: 2, history: { startFen: toFen(start, me), moves: [] } });
      const top = (list ?? []).filter((x) => !x.bound);
      if (top.length < 2 || !isWon(top[0]) || !isWon(top[1])) return;
      wonAnyway = true;
      retireOwnPuzzle(puzzle.id);
      const note = document.createElement('div');
      note.className = 'r xq-tr-won';
      note.textContent = '🏁 这个局面本来就赢定了（第二好的走法也是大优）——不是错着，已经从「我的专属课」里拿掉。这一题保住胜势的走法都算对。';
      if (!elFb.textContent?.trim()) elFb.className = 'xq-tr-fb tip';
      elFb.appendChild(note);
    })();
  }

  // 开发期测试钩子：做题界面靠点棋盘操作，自动化测试算不出格子的屏幕坐标，
  // 这里把内部动作直接暴露出来。生产构建里整块会被摇掉（同 index.ts 的 __xq）。
  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqTrain = {
      tap: (x: number, y: number) => onTap(x, y),
      answer: () => puzzle.answer,
      /** 走这一步的正解（主变上的那一手；离开主变就问引擎） */
      playRight: () => {
        if (answered || busy) return false;
        const m = onLine ? legal().find((mv) => moveToText(board, mv) === line[ply]) : null;
        if (m) void submit(m);
        return !!m;
      },
      /** 随便走一手错的（不是这一步的正解） */
      playWrong: () => {
        if (answered || busy) return false;
        const ok = new Set([onLine ? line[ply] : '', ...(onLine ? okHere() : [])]);
        const m = legal().find((mv) => !ok.has(moveToText(board, mv)));
        if (m) void submit(m);
        return !!m;
      },
      /** 走指定的一手（记谱） */
      play: (t: string) => {
        if (answered || busy) return false;
        const m = legal().find((mv) => moveToText(board, mv) === t);
        if (m) void submit(m);
        return !!m;
      },
      state: () => ({ ply, onLine, myStep, totalMine, answered, busy, practice, verdict, wonAnyway }),
      hint: () => void hint(),
    };
  }

  return () => {
    releaseMusic();
    token++;
    clearInterval(timer);
    disposePlayout?.();
    view.dispose();
    wrap.remove();
  };
}
