/**
 * 换着花样出题：同一道题的局面，用不同的问法问。
 *
 * 用户原话："目前像眼力、战术之类的测验题目都千篇一律。这些东西都需要去向《天天象棋》看齐。"
 * 原来所有题都是一种问法——"看局面，走一步"。练眼力、练战术，问法应该跟着练的东西走：
 *   - 点子题（眼力）：点出你被捉的子 / 点出对方没有保护的大子。练的是"扫一眼全盘"，不用算；
 *   - 选择题（战术）：盘上画出几个候选着法 A / B / C / D，选一个。像实战里的"候选着"——先列出来再比；
 *   - 判断题：给一步棋，判它好不好。很多是真实对局里有人走过的错着（题目里的 blunder），看着最像好棋；
 *   - 认杀法：看杀局，说出这是什么杀法。图形有名字才记得住。
 *
 * 出题全用规则引擎和题库里已经核对过的答案，不在浏览器里现算引擎：
 * 选择题、判断题只用"只有这一手对"的题（答案唯一），别的着法一律算错——这是题库生成时皮卡鱼核对过的。
 */
import { applyMove, isInCheck, legalMoves, statusAfter, type Board, type Color, type Move } from './rules';
import { fromFen, moveToText, textToMove } from './notation';
import { attackersOf, hangingPieces, inPieces, PIECE_VALUE } from './teach';
import { pieceName } from './notation';
import { Board2D, type Arrow, type Mark } from './board2d';
import type { Puzzle } from './puzzles';
import type { MatePattern } from './library';
import type { Dim } from './save';

export type QuizType = 'tap' | 'choice' | 'judge' | 'name';

export interface QuizQ {
  type: QuizType;
  /** 题号：题型 + 原题号（第一次做才计分） */
  id: string;
  fen: string;
  /** 从哪一方看（棋盘下方） */
  me: Color;
  prompt: string;
  /** 点子题：要点到的格子；all = 要全部点到 */
  targets?: { x: number; y: number }[];
  /** 选择题、认杀法：选项 */
  options?: { label: string; text: string; move?: Move }[];
  correct?: number;
  /** 判断题：给出的那一步、它是不是好棋 */
  move?: Move;
  good?: boolean;
  /** 认杀法：盘上标出最后那一手 */
  last?: Move;
  explain: string;
  rating: number;
  dim: Dim;
}

const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));
const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const side = (c: Color) => (c === 'r' ? '红方' : '黑方');
const shuffle = <T>(a: T[], rnd = Math.random) => {
  const b = a.slice();
  for (let i = b.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
};

/** 点子题：你有子正被捉着（白丢 1.5 个兵以上），点出来 */
export function tapThreatened(p: Puzzle): QuizQ | null {
  const pos = fromFen(p.fen);
  if (!pos) return null;
  const me = pos.toMove;
  const hang = hangingPieces(pos.board, me).filter((h) => h.loss >= 150);
  if (!hang.length || hang.length > 2) return null;
  return {
    type: 'tap',
    id: `tap-threat:${p.id}`,
    fen: p.fen,
    me,
    prompt: hang.length === 1 ? '你有一个子正被对方捉着——点出来' : '你有两个子正被对方捉着——都点出来',
    targets: hang.map((h) => ({ x: h.x, y: h.y })),
    explain: hang.map((h) => `${h.name}被对方的${h.byName}捉着（${h.byText}），不管它就白丢约${inPieces(h.loss)}`).join('；') + '。走棋之前先扫一眼：自己哪个子挂着。',
    rating: Math.max(600, p.rating - 150),
    dim: 'safety',
  };
}

/** 对方的车马炮里，哪些没有子保护（被你吃掉他吃不回来） */
export function loosePieces(b: Board, opp: Color): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 9; x++) {
      const pc = b[y][x];
      if (!pc || pc.c !== opp || !'RHC'.includes(pc.t)) continue;
      // 把这一格换成我方的子，看对方有没有子能吃到这一格——能吃到就是有保护
      const nb = b.map((row) => row.slice());
      nb[y][x] = { t: pc.t, c: other(opp) };
      if (attackersOf(nb, x, y, opp).length === 0) out.push({ x, y });
    }
  return out;
}

/** 点子题：对方哪些大子没有保护，全部点出来 */
export function tapLoose(p: Puzzle): QuizQ | null {
  const pos = fromFen(p.fen);
  if (!pos) return null;
  const me = pos.toMove;
  const opp = other(me);
  const loose = loosePieces(pos.board, opp);
  if (!loose.length || loose.length > 3) return null;
  const names = loose.map((t) => pieceName(pos.board[t.y][t.x]!.t, opp));
  return {
    type: 'tap',
    id: `tap-loose:${p.id}`,
    fen: p.fen,
    me,
    prompt: '对方的车马炮里，哪些没有保护（你吃了他吃不回来）？全部点出来',
    targets: loose,
    explain: `没有保护的是：${names.join('、')}。没根的子是战术的靶子——捉双、抽将，捉的多半就是它们。`,
    rating: Math.max(600, p.rating - 100),
    dim: 'safety',
  };
}

/** 答案唯一的题才能出选择题、判断题：别的着法一律算错 */
export function uniqueAnswer(p: Puzzle): boolean {
  if (p.id.startsWith('cb-') || p.id.startsWith('own-')) return p.id.startsWith('cb-');
  if (p.kind === 'mate') return true;
  return p.goal === 'only' || p.goal === 'win' || p.goal === 'mate';
}

/** 看着像回事的错着：吃子、将军、动正解那个子，越像越靠前 */
function naturalWrong(b: Board, me: Color, answer: Move, also: Set<string>): Move[] {
  const scored = legal(b, me)
    .filter((m) => !(m.fx === answer.fx && m.fy === answer.fy && m.tx === answer.tx && m.ty === answer.ty))
    .filter((m) => !also.has(moveToText(b, m)))
    .map((m) => {
      const cap = b[m.ty][m.tx];
      let s = Math.random() * 40;
      if (cap) s += PIECE_VALUE[cap.t];
      if (isInCheck(applyMove(b, m), other(me))) s += 300;
      if (m.fx === answer.fx && m.fy === answer.fy) s += 160;
      return { m, s };
    });
  scored.sort((a, b2) => b2.s - a.s);
  return scored.map((x) => x.m);
}

function lineTail(p: Puzzle): string {
  const tail = (p.line ?? []).slice(1, 7);
  return tail.length ? `之后：${tail.join(' ')}${(p.line ?? []).length > 7 ? ' ……' : ''}` : '';
}

/** 选择题：A / B / C / D 四个候选着法，只有一个对 */
export function choiceQuestion(p: Puzzle, dim: Dim): QuizQ | null {
  if (!uniqueAnswer(p)) return null;
  const pos = fromFen(p.fen);
  if (!pos) return null;
  const me = pos.toMove;
  const ans = textToMove(pos.board, me, p.answer, legal(pos.board, me));
  if (!ans) return null;
  const wrong = naturalWrong(pos.board, me, ans, new Set(p.also ?? [])).slice(0, 3);
  if (wrong.length < 2) return null;
  const opts = shuffle([ans, ...wrong]);
  const labels = ['A', 'B', 'C', 'D'];
  return {
    type: 'choice',
    id: `choice:${p.id}`,
    fen: p.fen,
    me,
    prompt: `${p.kind === 'mate' || p.goal === 'mate' ? '哪一手能杀？' : '哪一手最好？'}盘上画了 ${opts.length} 个候选，选一个`,
    options: opts.map((m, i) => ({ label: labels[i], text: moveToText(pos.board, m), move: m })),
    correct: opts.indexOf(ans),
    explain: `正解是 ${p.answer}${p.mateIn ? `，${p.mateIn} 步杀` : ''}。${lineTail(p)}别的几手看着也像，但都放跑了机会——先把候选着列出来，再一个个比，这是实战里找好棋的办法。`,
    rating: Math.max(600, p.rating - 120),
    dim,
  };
}

/** 判断题：给一步棋（一半是正解、一半是看着像的错着），判它好不好 */
export function judgeQuestion(p: Puzzle, dim: Dim, rnd = Math.random): QuizQ | null {
  if (!uniqueAnswer(p) && !p.blunder) return null;
  const pos = fromFen(p.fen);
  if (!pos) return null;
  const me = pos.toMove;
  const ans = textToMove(pos.board, me, p.answer, legal(pos.board, me));
  if (!ans) return null;
  const good = rnd() < 0.5;
  let move: Move | null = ans;
  let fromGame = false;
  if (!good) {
    const bl = p.blunder ? textToMove(pos.board, me, p.blunder, legal(pos.board, me)) : null;
    if (bl) {
      move = bl;
      fromGame = true;
    } else {
      if (!uniqueAnswer(p)) return null;
      move = naturalWrong(pos.board, me, ans, new Set(p.also ?? []))[0] ?? null;
    }
  }
  if (!move) return null;
  const text = moveToText(pos.board, move);
  return {
    type: 'judge',
    id: `judge:${p.id}`,
    fen: p.fen,
    me,
    prompt: `${side(me)}走 ${text}——这一步好不好？`,
    move,
    good,
    explain: good
      ? `好棋：${text} 就是这里最好的一手${p.mateIn ? `，${p.mateIn} 步杀` : ''}。${lineTail(p)}`
      : `这一步不好${fromGame ? '（实战里真有人这么走错过）' : ''}。这里该走 ${p.answer}。${lineTail(p)}`,
    rating: Math.max(600, p.rating - 220),
    dim,
  };
}

/** 认杀法：杀局摆好（最后一手标出来），选出它的名字 */
export function nameQuestion(m: MatePattern, allNames: string[], rnd = Math.random): QuizQ | null {
  const pos = fromFen(m.fen);
  if (!pos) return null;
  let b = pos.board;
  let c = pos.toMove;
  let last: Move | null = null;
  for (const t of m.line) {
    const mv = textToMove(b, c, t, legal(b, c));
    if (!mv) return null;
    last = mv;
    b = applyMove(b, mv);
    c = other(c);
  }
  if (!last || statusAfter(b, c) === 'playing') return null;
  const wrong = shuffle(allNames.filter((n) => n !== m.name), rnd).slice(0, 3);
  const names = shuffle([m.name, ...wrong], rnd);
  const labels = ['A', 'B', 'C', 'D'];
  return {
    type: 'name',
    id: `name:${m.id}`,
    // 盘面摆的是杀完的样子，换成 FEN 存不下"最后一手"，单独记
    fen: m.fen,
    me: pos.toMove,
    prompt: '这是什么杀法？（最后一手已经标出来）',
    options: names.map((n, i) => ({ label: labels[i], text: n })),
    correct: names.indexOf(m.name),
    last,
    explain: `${m.name}：${m.shape}${m.why}`,
    rating: Math.max(600, m.rating - 100),
    dim: 'mate',
  };
}

/** 认杀法要把杀完的局面摆出来 */
function finalBoard(q: QuizQ, line: string[]): Board | null {
  const pos = fromFen(q.fen);
  if (!pos) return null;
  let b = pos.board;
  let c = pos.toMove;
  for (const t of line) {
    const mv = textToMove(b, c, t, legal(b, c));
    if (!mv) return null;
    b = applyMove(b, mv);
    c = other(c);
  }
  return b;
}

export interface QuizOpts {
  caption: string;
  /** 认杀法：杀法的着法（摆杀完的局面用） */
  line?: string[];
  /** 答完之后：返回这一题的计分说明（"杀法 1320 → 1334（+14）"），显示在讲解下面 */
  onAnswer: (correct: boolean) => string;
  onDone: (correct: boolean) => void;
  onExit: () => void;
}

const COLORS = ['rgba(46,140,220,0.92)', 'rgba(230,140,40,0.92)', 'rgba(150,90,210,0.92)', 'rgba(40,170,150,0.92)'];

/** 答一道花样题 */
export function runQuiz(host: HTMLElement, q: QuizQ, opts: QuizOpts): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-tr xq-quiz';
  wrap.dataset.quiz = q.type;
  host.appendChild(wrap);
  const pos = fromFen(q.fen);
  if (!pos) {
    wrap.innerHTML = '<div class="xq-tr-bad">这道题的局面读不出来，已跳过。</div>';
    setTimeout(() => opts.onDone(false), 600);
    return () => wrap.remove();
  }
  const TYPE_NAME: Record<QuizType, string> = { tap: '点子题', choice: '选择题', judge: '判断题', name: '认杀法' };
  wrap.innerHTML = `
    <div class="xq-tr-top">
      <button class="xq-tr-quit" title="退出练习">← 退出</button>
      <span class="xq-tr-cap">${opts.caption}</span>
      <span class="xq-tr-ask">${q.prompt}</span>
      <span class="xq-tr-side"><span class="xq-quiz-type">${TYPE_NAME[q.type]}</span> 难度 ${q.rating}</span>
    </div>
    <div class="xq-tr-board"></div>
    <div class="xq-tr-fb"></div>
    <div class="xq-tr-bar"></div>`;
  (wrap.querySelector('.xq-tr-quit') as HTMLButtonElement).onclick = () => opts.onExit();
  const elFb = wrap.querySelector('.xq-tr-fb') as HTMLElement;
  const elBar = wrap.querySelector('.xq-tr-bar') as HTMLElement;
  const board = q.type === 'name' && opts.line ? (finalBoard(q, opts.line) ?? pos.board) : pos.board;
  let answered = false;
  const picked: { x: number; y: number }[] = [];
  const view = new Board2D(wrap.querySelector('.xq-tr-board') as HTMLElement, { flip: q.me === 'b', onTap: (x, y) => onTap(x, y) });
  view.setBoard(board);

  const baseArrows = (): Arrow[] => {
    if (q.type === 'choice')
      return q.options!.map((o, i) => ({ fx: o.move!.fx, fy: o.move!.fy, tx: o.move!.tx, ty: o.move!.ty, color: COLORS[i], label: o.label }));
    if (q.type === 'judge') return [{ fx: q.move!.fx, fy: q.move!.fy, tx: q.move!.tx, ty: q.move!.ty, color: COLORS[0] }];
    if (q.type === 'name' && q.last) return [{ fx: q.last.fx, fy: q.last.fy, tx: q.last.tx, ty: q.last.ty, color: 'rgba(214,64,52,0.85)' }];
    return [];
  };
  view.setArrows(baseArrows());

  function finish(correct: boolean, detail = '') {
    answered = true;
    const score = opts.onAnswer(correct);
    elFb.className = `xq-tr-fb ${correct ? 'ok' : 'no'}`;
    elFb.innerHTML = `<div class="h">${correct ? '✅ 对了' : '❌ 不对'}${detail ? ` · ${detail}` : ''}</div><div class="l">${q.explain}</div>${
      score ? `<div class="r">${score}</div>` : ''
    }`;
    elBar.innerHTML = '<button class="xq-btn primary" id="xq-quiz-next">继续 →</button>';
    (elBar.querySelector('#xq-quiz-next') as HTMLButtonElement).onclick = () => opts.onDone(correct);
  }

  function onTap(x: number, y: number) {
    if (answered || q.type !== 'tap') return;
    const pc = board[y][x];
    if (!pc) return;
    const i = picked.findIndex((s) => s.x === x && s.y === y);
    if (i >= 0) picked.splice(i, 1);
    else picked.push({ x, y });
    view.setMarks(picked.map((s) => ({ x: s.x, y: s.y, kind: 'ring' }) as Mark));
    renderBar();
  }

  function submitTap() {
    const want = q.targets!;
    const hit = picked.filter((s) => want.some((t) => t.x === s.x && t.y === s.y));
    const correct = hit.length === want.length && picked.length === want.length;
    const marks: Mark[] = [
      ...want.map((t) => ({ x: t.x, y: t.y, kind: 'ring' as const })),
      ...picked.filter((s) => !want.some((t) => t.x === s.x && t.y === s.y)).map((s) => ({ x: s.x, y: s.y, kind: 'bad' as const })),
    ];
    view.setMarks(marks);
    finish(correct, correct ? '' : `应该点 ${want.length} 个，你点对了 ${hit.length} 个${picked.length > hit.length ? `，多点了 ${picked.length - hit.length} 个` : ''}`);
  }

  function pick(i: number) {
    if (answered) return;
    const correct = i === q.correct;
    if (q.type === 'choice') {
      const o = q.options!;
      view.setArrows(
        o.map((x, k) => ({
          fx: x.move!.fx,
          fy: x.move!.fy,
          tx: x.move!.tx,
          ty: x.move!.ty,
          color: k === q.correct ? 'rgba(46,160,90,0.95)' : k === i ? 'rgba(214,64,52,0.9)' : 'rgba(150,150,150,0.35)',
          label: x.label,
        })),
      );
    }
    finish(correct, q.options ? `${q.options[q.correct!].label}. ${q.options[q.correct!].text}` : '');
  }

  function renderBar() {
    if (answered) return;
    if (q.type === 'tap') {
      elBar.innerHTML = `<span class="xq-tr-note">点棋子选中，再点一次取消（已选 ${picked.length} 个）</span>
        <button class="xq-btn primary" id="xq-quiz-submit"${picked.length ? '' : ' disabled'}>确定</button>`;
      const b = elBar.querySelector('#xq-quiz-submit') as HTMLButtonElement;
      b.onclick = () => submitTap();
    } else if (q.type === 'judge') {
      elBar.innerHTML = `<button class="xq-btn" data-judge="good">👍 好棋</button><button class="xq-btn" data-judge="bad">👎 不好</button>`;
      elBar.querySelectorAll<HTMLButtonElement>('[data-judge]').forEach((b) => {
        b.onclick = () => {
          if (answered) return;
          const sayGood = b.dataset.judge === 'good';
          finish(sayGood === q.good, q.good ? '这一步是好棋' : '这一步不好');
        };
      });
    } else {
      elBar.innerHTML = q.options!
        .map((o, i) => `<button class="xq-btn xq-quiz-opt" data-opt="${i}"><b>${o.label}</b> ${o.text}</button>`)
        .join('');
      elBar.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) => (b.onclick = () => pick(Number(b.dataset.opt))));
    }
  }
  renderBar();

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqQuiz = {
      type: () => q.type,
      /** 答对：点到全部目标 / 选正确的选项 / 判对 */
      solve: () => {
        if (q.type === 'tap') {
          for (const t of q.targets!) onTap(t.x, t.y);
          submitTap();
        } else if (q.type === 'judge') (elBar.querySelector(`[data-judge="${q.good ? 'good' : 'bad'}"]`) as HTMLButtonElement).click();
        else pick(q.correct!);
      },
      miss: () => {
        if (q.type === 'tap') {
          const all = [];
          for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) if (board[y][x] && !q.targets!.some((t) => t.x === x && t.y === y)) all.push({ x, y });
          onTap(all[0].x, all[0].y);
          submitTap();
        } else if (q.type === 'judge') (elBar.querySelector(`[data-judge="${q.good ? 'bad' : 'good'}"]`) as HTMLButtonElement).click();
        else pick((q.correct! + 1) % q.options!.length);
      },
      answered: () => answered,
    };
  }

  return () => {
    view.dispose();
    wrap.remove();
  };
}
