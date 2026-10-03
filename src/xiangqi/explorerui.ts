/**
 * 开局浏览器：任何一个局面，谱上有哪些走法、每一手什么意义；谱外的局面让皮卡鱼列候选着。
 *
 * 参考的是几款象棋软件最有用的那一块：
 *   - 象棋云库：每个局面列出所有候选着、各自的分数——"从老谱到野路子都有"；
 *   - 象棋巫师：开局自动识别，叫得出布局和变例的名字；能读棋谱、FEN；
 *   - 鹏飞象棋：分支棋谱、分析模式——想试哪一手就在盘上走，随时退回来。
 * 这里：谱上的走法来自布局体系（主线、变化、变招、错着）和邪门布局（套路、破解、上当），每一手讲意义；
 * 走出谱以后皮卡鱼接着给候选着（前四名、分数、主变），也讲这一手干了什么。
 */
import { applyMove, initialBoard, isInCheck, legalMoves, type Board, type Color, type Move } from './rules';
import { fromFen, moveToText, textToMove, toFen } from './notation';
import { Board2D, type Mark } from './board2d';
import { KIND_INFO, childrenAt, identify, linesAt, parseImport, type ExChild } from './explorer';
export { parseImport };
import { loadOpeningExtras } from './openings';
import { loadTrickExtras } from './tricks';
import { briefOf } from './movemeaning';
import { engineAnalyse, engineCapable, loadEngine } from './pikafish';
import type { MoveScore } from './ai';
import { evWords } from './coachnote';
export { evWords };

export interface ExplorerOpts {
  /** 从开局起先走这几手（中文记谱） */
  startMoves?: string[];
  /** 从这个局面开始（导入的 FEN） */
  fen?: string;
  onExit: () => void;
  /** 从当前局面开一盘实战（只在从开局起的局面上有） */
  onPlayFrom?: (moves: string[], me: Color) => void;
}

const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');
const same = (a: Move, b: Move) => a.fx === b.fx && a.fy === b.fy && a.tx === b.tx && a.ty === b.ty;

export function runExplorer(host: HTMLElement, opts: ExplorerOpts): () => void {
  const wrap = document.createElement('div');
  wrap.className = 'xq-rp xq-ex';
  host.appendChild(wrap);

  let root = opts.fen ? fromFen(opts.fen) : null;
  let rootBoard: Board = root ? root.board : initialBoard();
  let rootColor: Color = root ? root.toMove : 'r';
  /** 从 root 起走的着法 */
  let path: Move[] = [];
  /** 退回去以后还能再走回来的着法 */
  let redo: Move[] = [];
  let sel: { x: number; y: number } | null = null;
  let engineJob = 0;
  let lastEngine: MoveScore[] | null = null;
  let disposed = false;

  wrap.innerHTML = `
    <div class="xq-rp-head"><div class="t">📚 开局浏览器</div><div class="s" data-ex-name></div></div>
    <div class="xq-rp-board"></div>
    <div class="xq-rp-trail" data-ex-trail></div>
    <div class="xq-rp-bar" data-ex-bar></div>
    <div class="xq-rp-say" data-ex-last></div>
    <div class="xq-ex-sec" data-ex-book></div>
    <div class="xq-ex-sec" data-ex-engine></div>
    <div class="xq-rp-bar" data-ex-bar2></div>`;
  const $ = (sel: string) => wrap.querySelector(sel) as HTMLElement;
  const view = new Board2D($('.xq-rp-board'), { flip: false, onTap: (x, y) => onTap(x, y) });

  const pos = (): { board: Board; color: Color } => {
    let b = rootBoard;
    let c = rootColor;
    for (const m of path) {
      b = applyMove(b, m);
      c = other(c);
    }
    return { board: b, color: c };
  };
  const texts = (): string[] => {
    let b = rootBoard;
    const out: string[] = [];
    for (const m of path) {
      out.push(moveToText(b, m));
      b = applyMove(b, m);
    }
    return out;
  };
  const legal = (b: Board, c: Color) => legalMoves(b, c).filter((m) => !isInCheck(applyMove(b, m), c));

  function onTap(x: number, y: number) {
    const { board, color } = pos();
    if (sel) {
      const mv = legal(board, color).find((m) => m.fx === sel!.x && m.fy === sel!.y && m.tx === x && m.ty === y);
      if (mv) {
        sel = null;
        return go(mv);
      }
    }
    const p = board[y][x];
    if (p && p.c === color) {
      sel = { x, y };
      const marks: Mark[] = [{ x, y, kind: 'ring' }];
      for (const m of legal(board, color)) if (m.fx === x && m.fy === y) marks.push({ x: m.tx, y: m.ty, kind: 'dot' });
      view.setMarks(marks);
    } else {
      sel = null;
      view.setMarks([]);
    }
  }

  function go(m: Move) {
    const { board, color } = pos();
    if (!legal(board, color).some((x) => same(x, m))) return;
    if (redo.length && same(redo[redo.length - 1], m)) redo.pop();
    else redo = [];
    path.push(m);
    render();
  }
  function back() {
    const m = path.pop();
    if (m) redo.push(m);
    render();
  }
  function toStart() {
    while (path.length) redo.push(path.pop()!);
    render();
  }
  function forward() {
    const { board, color } = pos();
    const r = redo[redo.length - 1];
    if (r) return go(r);
    // 没有可以重做的：沿谱上第一种走法（主线优先）往下走
    const ch = childrenAt(board, color)[0];
    const m = ch ? textToMove(board, color, ch.t, legalMoves(board, color)) : null;
    if (m) go(m);
  }
  function jump(n: number) {
    while (path.length > n) redo.push(path.pop()!);
    render();
  }

  function tagsOf(ch: ExChild): string {
    return [...ch.kinds]
      .sort((a, b) => KIND_INFO[a].order - KIND_INFO[b].order)
      .map((k) => `<span class="xq-ex-tag k-${k}">${KIND_INFO[k].name}</span>`)
      .join('');
  }

  function firstSentence(s: string): string {
    const plain = s.replace(/<[^>]+>/g, '');
    const i = plain.indexOf('。');
    return i > 0 && i < 70 ? plain.slice(0, i + 1) : plain.slice(0, 70) + (plain.length > 70 ? '…' : '');
  }

  function render() {
    if (disposed) return;
    const { board, color } = pos();
    view.setBoard(board);
    view.setMarks([]);
    const last = path[path.length - 1];
    view.setArrows(last ? [{ fx: last.fx, fy: last.fy, tx: last.tx, ty: last.ty }] : []);
    sel = null;
    const tx = texts();
    // 叫什么布局
    const fromStart = !opts.fen || root === null;
    const id = fromStart && path.length ? identify(path) : null;
    const lines = linesAt(board, color);
    const inBook = lines.length > 0 || (!path.length && fromStart);
    $('[data-ex-name]').innerHTML = path.length
      ? `${id ? `<b>${id.name}</b>` : ''}${
          inBook ? ' · <span class="ok">谱上</span>' : ` · <span class="warn">出谱${id?.bookPly ? `（第 ${id.bookPly} 手以后）` : ''}，皮卡鱼接着算</span>`
        }`
      : opts.fen
        ? '导入的局面'
        : '开局：红方先走';
    // 走过的着法
    const startNo = fromStart ? 0 : rootColor === 'b' ? 1 : 0;
    $('[data-ex-trail]').innerHTML =
      `<span data-jump="0" class="${path.length ? '' : 'on'}">开局</span> ` +
      tx
        .map((t, i) => {
          const k = i + startNo;
          return `<span data-jump="${i + 1}" class="${i === tx.length - 1 ? 'on' : ''}">${k % 2 === 0 ? `${k / 2 + 1}.` : ''}${t}</span>`;
        })
        .join(' ');
    $('[data-ex-trail]').querySelectorAll<HTMLElement>('[data-jump]').forEach((el) => (el.onclick = () => jump(Number(el.dataset.jump))));
    // 上一手的意义
    const elLast = $('[data-ex-last]');
    if (last) {
      let prevB = rootBoard;
      let prevC = rootColor;
      for (const m of path.slice(0, -1)) {
        prevB = applyMove(prevB, m);
        prevC = other(prevC);
      }
      const t = moveToText(prevB, last);
      const ch = childrenAt(prevB, prevC).find((x) => x.t === t);
      elLast.className = 'xq-rp-say';
      elLast.innerHTML = `<div class="h">${prevC === 'r' ? '红' : '黑'} ${t}${ch ? ` ${tagsOf(ch)}` : ''}</div><div class="w">${
        ch ? ch.why : `${briefOf(prevB, last, prevC)}。<span class="dim">（谱外的一手）</span>`
      }${ch?.ev !== undefined ? `<br><span class="dim">走完：${evWords(ch.ev)}</span>` : ''}</div>`;
    } else {
      elLast.className = 'xq-rp-say intro';
      elLast.innerHTML = `<div class="w">点下面谱上的走法往下走，每一手都讲意义；也可以直接在棋盘上走任何一手——走出谱以后，皮卡鱼列出这里的候选着。
        这里收着 <b>布局体系</b>（主线、变化、变招、错着）和 <b>邪门布局</b>（套路、破解、上当）。</div>`;
    }
    // 谱上的走法
    const kids = childrenAt(board, color);
    const elBook = $('[data-ex-book]');
    if (kids.length) {
      elBook.innerHTML = `<div class="hd">谱上的走法（${kids.length}）<span class="dim">——轮到${color === 'r' ? '红' : '黑'}方</span></div>`;
      for (const ch of kids) {
        const el = document.createElement('button');
        el.className = 'xq-ex-move';
        el.dataset.exMove = ch.t;
        el.innerHTML = `<div class="m"><b>${ch.t}</b>${tagsOf(ch)}${ch.ev !== undefined ? `<span class="ev">${evWords(ch.ev)}</span>` : ''}</div>
          <div class="d">${firstSentence(ch.why)}</div>${
            ch.lines.size ? `<div class="l">${[...ch.lines].slice(0, 2).join('；')}${ch.lines.size > 2 ? ` 等 ${ch.lines.size} 条谱` : ''}</div>` : ''
          }`;
        el.onclick = () => {
          const m = textToMove(board, color, ch.t, legalMoves(board, color));
          if (m) go(m);
        };
        elBook.appendChild(el);
      }
    } else {
      elBook.innerHTML = `<div class="hd">谱上没有这个局面</div><div class="dim">下面是皮卡鱼的候选着。</div>`;
    }
    // 引擎候选着：谱外自动算；谱上的点一下再算（不打扰看谱）
    const elEng = $('[data-ex-engine]');
    lastEngine = null;
    if (!kids.length) void runEngine();
    else {
      elEng.innerHTML = `<button class="xq-btn ghost" data-ex-ask>🔍 让皮卡鱼列这里的候选着</button>`;
      (elEng.querySelector('[data-ex-ask]') as HTMLButtonElement).onclick = () => void runEngine();
    }
    renderBars();
  }

  async function runEngine() {
    const job = ++engineJob;
    const { board, color } = pos();
    const elEng = $('[data-ex-engine]');
    if (!engineCapable()) {
      elEng.innerHTML = '<div class="dim">这个浏览器跑不了皮卡鱼。</div>';
      return;
    }
    elEng.innerHTML = '<div class="hd">皮卡鱼的候选着</div><div class="dim">正在算…</div>';
    const ok = await loadEngine();
    if (job !== engineJob || disposed) return;
    if (!ok) {
      elEng.innerHTML = '<div class="dim">皮卡鱼没起来，稍后再试。</div>';
      return;
    }
    const res = await engineAnalyse(board, color, { movetime: 1500, multipv: 4 });
    if (job !== engineJob || disposed) return;
    if (!res?.length) {
      elEng.innerHTML = '<div class="dim">没有可走的着法。</div>';
      return;
    }
    lastEngine = res.filter((x) => !x.bound).slice(0, 4);
    const sgn = color === 'r' ? 1 : -1;
    elEng.innerHTML = '<div class="hd">皮卡鱼的候选着 <span class="dim">（深算 1.5 秒，前四名）</span></div>';
    for (const ms of lastEngine) {
      const t = moveToText(board, ms.move);
      let b = board;
      let c = color;
      const pv: string[] = [];
      for (const m of ms.pv.slice(0, 5)) {
        if (!legalMoves(b, c).some((x) => same(x, m))) break;
        pv.push(moveToText(b, m));
        b = applyMove(b, m);
        c = other(c);
      }
      const ev = ms.mateIn !== undefined ? (ms.mateIn > 0 ? 30000 : -30000) * sgn : ms.score * sgn;
      const el = document.createElement('button');
      el.className = 'xq-ex-move';
      el.dataset.exEngine = t;
      el.innerHTML = `<div class="m"><b>${t}</b><span class="ev">${ms.mateIn !== undefined ? `${ms.mateIn > 0 ? '' : '被'}${Math.abs(ms.mateIn)} 步杀` : evWords(ev)}</span></div>
        <div class="d">${briefOf(board, ms.move, color)}。</div><div class="l">主变：${pv.join(' ')}</div>`;
      el.onclick = () => go(ms.move);
      elEng.appendChild(el);
    }
  }

  function renderBars() {
    $('[data-ex-bar]').innerHTML = `<button class="xq-btn" data-ex-act="start">⏮ 开局</button><button class="xq-btn" data-ex-act="back">← 上一手</button><button class="xq-btn primary" data-ex-act="fwd">下一手 →</button>`;
    const fromStart = !opts.fen;
    $('[data-ex-bar2]').innerHTML =
      `<button class="xq-btn" data-ex-act="import">📥 导入棋谱/FEN</button>` +
      (opts.onPlayFrom && fromStart ? `<button class="xq-btn" data-ex-act="play">⚔️ 从这里下</button>` : '') +
      `<button class="xq-btn ghost" data-ex-act="out">← 返回</button>`;
    wrap.querySelectorAll<HTMLButtonElement>('[data-ex-act]').forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.exAct;
        if (a === 'start') toStart();
        else if (a === 'back') back();
        else if (a === 'fwd') forward();
        else if (a === 'import') showImport();
        else if (a === 'play') opts.onPlayFrom?.(texts(), pos().color);
        else if (a === 'out') opts.onExit();
      };
    });
  }

  function showImport() {
    const box = document.createElement('div');
    box.className = 'xq-ex-import';
    box.innerHTML = `<div class="box">
        <b>导入棋谱或 FEN</b>
        <p class="dim">中文记谱（比如"1. 炮二平五 马8进7 2. 马二进三 车9平8"，回合号可有可无），或者一行 FEN。</p>
        <textarea rows="5" data-ex-text></textarea>
        <div class="err" data-ex-err></div>
        <div class="row"><button class="xq-btn primary" data-act="ok">导入</button><button class="xq-btn ghost" data-act="cancel">取消</button></div>
      </div>`;
    wrap.appendChild(box);
    const ta = box.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();
    (box.querySelector('[data-act="cancel"]') as HTMLButtonElement).onclick = () => box.remove();
    (box.querySelector('[data-act="ok"]') as HTMLButtonElement).onclick = () => {
      const r = parseImport(ta.value);
      if (r.fen) {
        const f = fromFen(r.fen.split(/\s+/).slice(0, 2).join(' ').replace(/ r$/, ' w'));
        if (!f) return;
        opts.fen = r.fen;
        root = f;
        rootBoard = f.board;
        rootColor = f.toMove;
        path = [];
        redo = [];
        box.remove();
        return render();
      }
      if (r.moves?.length) {
        opts.fen = undefined;
        root = null;
        rootBoard = initialBoard();
        rootColor = 'r';
        path = [];
        redo = [];
        let b = rootBoard;
        let c: Color = 'r';
        for (const t of r.moves) {
          const m = textToMove(b, c, t, legalMoves(b, c))!;
          path.push(m);
          b = applyMove(b, m);
          c = other(c);
        }
        box.remove();
        render();
        if (r.error) {
          $('[data-ex-name]').insertAdjacentHTML('beforeend', `<br><span class="warn">${r.error}</span>`);
        }
        return;
      }
      (box.querySelector('[data-ex-err]') as HTMLElement).textContent = r.error ?? '读不出来';
    };
  }

  // 起手的几步
  if (opts.startMoves?.length) {
    let b = rootBoard;
    let c = rootColor;
    for (const t of opts.startMoves) {
      const m = textToMove(b, c, t, legalMoves(b, c));
      if (!m) break;
      path.push(m);
      b = applyMove(b, m);
      c = other(c);
    }
  }
  render();
  // 布局变招、江湖布局变化的数据按需加载，到了就重画一遍（谱上的走法会多出来）
  void Promise.all([loadOpeningExtras(), loadTrickExtras()]).then(() => render());

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__xqExplorer = {
      path: () => texts(),
      fen: () => toFen(pos().board, pos().color),
      go: (t: string) => {
        const { board, color } = pos();
        const m = textToMove(board, color, t, legalMoves(board, color));
        if (m) go(m);
        return !!m;
      },
      back,
      children: () => childrenAt(pos().board, pos().color).map((c) => c.t),
      engine: () => (lastEngine ? lastEngine.map((x) => moveToText(pos().board, x.move)) : null),
    };
  }

  return () => {
    disposed = true;
    engineJob++;
    view.dispose();
    wrap.remove();
  };
}
