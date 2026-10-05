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
import { engineBestMove, engineCapable, engineReady, engineScoreMove, linesToMoveScores, loadEngine, search } from './pikafish';
import { runPlayout } from './playout';

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

/** 非杀法题：走出主变之外的一手，比引擎首选差不到这么多就算一样好（车≈1000） */
const ALT_TOLERANCE = 80;
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

  const start: Board = parsed.board;
  const me: Color = parsed.toMove;
  const foe: Color = me === 'r' ? 'b' : 'r';
  const allowHint = opts.allowHint !== false;
  const isMate = puzzle.kind === 'mate' || puzzle.goal === 'mate';
  const line = puzzle.line?.length ? puzzle.line : [puzzle.answer];
  /** 你一共要走几步 */
  const totalMine = Math.ceil(line.length / 2);
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
   *   其它题——比引擎首选差不到 ALT_TOLERANCE。
   * 引擎起不来返回 null（只能认主变）。
   */
  async function judgeAlt(before: Board, mv: Move): Promise<{ ok: boolean; why: string } | null> {
    if (!(await engineUp) || !engineReady()) return null;
    const h = history();
    const mine = await engineScoreMove(before, me, mv, { movetime: 1500, history: h });
    if (!mine) return null;
    const left = totalMine - myStep;
    if (isMate) {
      if (mine.mateIn !== undefined && mine.mateIn > 0) {
        return mine.mateIn <= left
          ? { ok: true, why: `这一手也杀得了（${mine.mateIn} 步之内将死）` }
          : { ok: false, why: `这一手也能杀，但要 ${mine.mateIn} 步，这题要在 ${left} 步之内杀死` };
      }
      return { ok: false, why: '走了这一手，就杀不成了' };
    }
    const r = await search({ board: before, color: me, history: h, movetime: 1200 }).promise;
    const best = linesToMoveScores(r.lines, before, me)[0];
    if (!best) return null;
    if (mine.mateIn !== undefined && mine.mateIn < 0) return { ok: false, why: `走了这一手，对方有 ${-mine.mateIn} 步杀` };
    if (best.mateIn !== undefined && best.mateIn > 0 && !(mine.mateIn !== undefined && mine.mateIn > 0)) {
      return { ok: false, why: `这里有 ${best.mateIn} 步杀，这一手放过了` };
    }
    const loss = best.score - mine.score;
    return loss <= ALT_TOLERANCE
      ? { ok: true, why: '皮卡鱼核对过：这一手和原谱一样好' }
      : { ok: false, why: `皮卡鱼核对过：这一手比最好的差了约 ${(loss / 100).toFixed(1)} 个兵` };
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
    if (onLine && text === line[ply]) ok = true;
    else if (onLine && ply === 0 && puzzle.also?.includes(text)) {
      // 一样好的着法一律算对：杀法题里同样步数的杀棋常常不止一手
      ok = true;
      note = `这手和 <b>${line[0]}</b> 一样好`;
      onLine = false;
    } else {
      elFb.className = 'xq-tr-fb tip';
      elFb.innerHTML = `<div class="l">你走的是 ${text}，不是原谱那一手——正在让皮卡鱼核对…</div>`;
      const j = await judgeAlt(before, mv);
      if (my !== token) return;
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

  async function afterRight(text: string, note: string) {
    const my = token;
    myStep++;
    ply++;
    // 将死了：杀法题就是要到这一步
    if (statusAfter(board, foe) !== 'playing') return solved(`✅ ${text}，将死！`);
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
    view.animateMove(reply, board, () => {
      if (my !== token) return;
      busy = false;
      view.setArrows([{ fx: reply!.fx, fy: reply!.fy, tx: reply!.tx, ty: reply!.ty, color: 'rgba(214,64,52,0.7)' }]);
      elFb.className = 'xq-tr-fb ok';
      elFb.innerHTML = `<div class="h">✅ ${text}　对方应 ${rt}</div><div class="l">接着走${isMate ? '，直到将死' : ''}。</div>`;
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

  async function wrong(text: string, why: string, before: Board) {
    const my = token;
    busy = false;
    answered = true;
    const right = onLine ? line[ply] : null;
    const rest = onLine ? line.slice(ply + 1).join(' ') : '';
    elFb.className = 'xq-tr-fb no';
    elFb.innerHTML = `
      <div class="h">❌ ${myStep ? `第 ${myStep + 1} 步` : ''}不对 · 你走的是 ${text}</div>
      <div class="l">${why ? why + '。' : ''}${
        right
          ? `这一步该走 <b>${right}</b>${ply === 0 && puzzle.also?.length ? `（走 ${puzzle.also.join('、')} 也一样）` : ''}${rest ? `　之后：${rest}` : ''}`
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
      <div class="r pun">正在算对方怎么惩罚这一手…</div>`;
    settle(false);
    if (!right) {
      const best = await expected(before, played.slice(0, -1)).catch(() => null);
      if (my !== token) return;
      const el = elFb.querySelector('.l');
      if (best && el) el.innerHTML += `这一步该走 <b>${moveToText(before, best)}</b>。`;
    }
    // 走错之后对方的最强应手——让你看见代价，而不是只被告知"错了"
    const snapshot = board;
    const reply = ((await engineUp) ? await engineBestMove(snapshot, foe, 1000, history()) : null) ?? (await requestMove(snapshot, foe, { maxDepth: 6, jitter: 0, timeMs: 1200 }));
    if (my !== token) return;
    const el = elFb.querySelector('.pun');
    if (!el) return;
    if (!reply) {
      el.remove();
      return;
    }
    el.innerHTML = `对方接下来会走 <b>${moveToText(snapshot, reply)}</b>。`;
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
        const ok = new Set([onLine ? line[ply] : '', ...(ply === 0 ? puzzle.also ?? [] : [])]);
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
      state: () => ({ ply, onLine, myStep, totalMine, answered, busy, practice, verdict }),
      hint: () => void hint(),
    };
  }

  return () => {
    token++;
    clearInterval(timer);
    disposePlayout?.();
    view.dispose();
    wrap.remove();
  };
}
