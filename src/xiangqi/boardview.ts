/**
 * 对局棋盘：把 2D 教学棋盘接成对局流程认识的样子。
 *
 * 原来对局用的是 3D 斜视棋盘（scene3d.ts），学棋和残局用的是 2D 正视棋盘
 * （board2d.ts）。两套并存有两个问题：
 *
 *   1. **斜视看不清**。45 度透视下，越靠上的格子越扁，九宫和河界被压缩，
 *      判断"这个车照到哪一格"要在脑子里做一次反投影。棋谱、棋书、所有
 *      教学材料都是正视平面图，学棋的人眼睛认的就是那个样子。
 *   2. **两套视觉语言**。在对局里练出来的读盘习惯，到了做题界面要重学一遍。
 *      同一个产品里，棋盘应该只有一种长相。
 *
 * 所以对局也改用 2D 正视。这个类只做一件事：把 board2d 包装成对局流程
 * 原本调用的那组方法（syncBoard / select / animateMove / flashCheck…），
 * 这样对局和复盘的代码几乎不用改，也就不会在搬运过程中搬出新 bug。
 */
import { Board2D, type Arrow, type Badge, type Mark } from './board2d';
import { BoardFx } from './fx';
import { BoardAmbient } from './ambient';
import { applyMove, type Board, type Color, type Move, type Piece } from './rules';

export class BoardView {
  private view: Board2D;
  private host: HTMLElement;
  /** 特效层：开局入场、吃子、将军、绝杀（fx.ts） */
  private fx: BoardFx;
  private amb: BoardAmbient;
  private board: Board | null = null;
  /** 落子后的轻微延时，纯粹为了节奏，不做位移动画——棋子一帧都不离开交叉点 */
  private slideMs = 0;

  /** 临时接管点棋盘（复盘里的"试下"）：给了就不再走构造时的那个回调 */
  private tapOverride?: (x: number, y: number) => void;

  constructor(parent: HTMLElement, onTap: (x: number, y: number) => void, flip = false) {
    this.host = document.createElement('div');
    this.host.className = 'xq-boardwrap';
    parent.appendChild(this.host);
    this.view = new Board2D(this.host, { flip, coords: true, onTap: (x, y) => (this.tapOverride ?? onTap)(x, y) });
    this.fx = new BoardFx(this.host, this.view);
    // 典藏棋盘会动的那一层（流光、河水、薄雾、金粉）
    this.amb = new BoardAmbient(this.host, this.view);
  }

  setTapOverride(fn: ((x: number, y: number) => void) | undefined) {
    this.tapOverride = fn;
  }

  syncBoard(b: Board) {
    this.board = b;
    this.view.setBoard(b);
  }

  /** 选中某个子并标出它能走的点；传 null 取消选中 */
  select(sel: { x: number; y: number } | null, moves?: { x: number; y: number; capture?: boolean }[]) {
    if (!sel) {
      this.view.setMarks([]);
      return;
    }
    const marks: Mark[] = [{ x: sel.x, y: sel.y, kind: 'ring' }];
    for (const m of moves ?? []) marks.push({ x: m.x, y: m.y, kind: m.capture ? 'bad' : 'dot' });
    this.view.setMarks(marks);
  }

  /**
   * 走一手。
   *
   * 盘面立刻换成走完的样子（"棋子位置不对"是这个项目修过的历史 bug，盘面绝不跟着动画走）；
   * 棋子沿路线滑过去、留一道渐隐的路线，是 board2d 换盘面时自己画的，只是画法。
   * 节奏感仍由 slideMs 这个等待提供。
   */
  animateMove(m: Move, onDone: () => void) {
    /*
     * 这一手要自己应用到盘面上。
     *
     * 对局流程是「先改自己的 board 变量，再叫棋盘走这一手」，它**不会**
     * 额外调一次 syncBoard——3D 版本是在动画内部更新自己的棋子位置的。
     * 照搬成 2D 时如果只重画旧盘面，结果就是**棋盘永远慢一手**：
     * 棋谱上写着"炮八平五"，盘上那只炮还在原地。这种错位在代码里完全看不出来，
     * 只有真的打开界面走一手才会发现。
     */
    if (this.board) {
      this.board = applyMove(this.board, m);
      this.view.setBoard(this.board);
    }
    this.view.setLastMove(m, true); // 对局里淡出，别让蓝框一直挂在盘上
    this.view.setMarks([]);
    if (this.slideMs <= 0) {
      requestAnimationFrame(() => onDone());
      return;
    }
    window.setTimeout(onDone, this.slideMs);
  }

  setSlideSec(sec: number) {
    this.slideMs = Math.max(0, Math.round(sec * 1000));
  }

  flashCheck(x: number, y: number) {
    this.view.setCheck({ x, y });
  }

  hideCheck() {
    this.view.setCheck(null);
  }

  /** 分出胜负时把被将死的老将圈住，让结果一眼看得见落点在哪 */
  finishBlast(x: number, y: number) {
    this.view.setCheck({ x, y });
  }

  /** 开局入场：棋盘从斜着转平、棋子一排排落下、"开局"印章（fx.ts）。盘面本身早就摆好了 */
  dealIn() {
    this.fx.opening();
  }

  /** 吃子特效（等走的子落下再炸）；吃车是那一声"锵" */
  fxCapture(x: number, y: number, victim: Piece, by: Color) {
    this.fx.capture(x, y, victim, by);
  }

  /** 将军：从将军的子到老将一道光、"将军"大字 */
  fxCheck(kx: number, ky: number, from: { x: number; y: number }[], byMe: boolean) {
    this.fx.check(kx, ky, from, byMe);
  }

  /** 绝杀（困毙）：老将倒下、大字、烟花或墨烟 */
  fxMate(kx: number, ky: number, king: Piece, win: boolean, word: string) {
    this.fx.mate(kx, ky, king, win, word);
  }

  /** 悔棋、重开：还在演的特效收掉（倒下的老将扶起来） */
  fxReset() {
    this.fx.reset();
  }

  /** 对手思考时给棋盘加一层淡淡的呼吸，让人知道在等什么 */
  setThinking(on: boolean) {
    this.host.classList.toggle('thinking', on);
  }

  setFlip(f: boolean) {
    this.view.setFlip(f);
  }

  setLastMove(m: Move | null, fade = true) {
    this.view.setLastMove(m, fade);
  }

  /** 棋子上的评级角标（复盘逐手、对局里自己那一手）；传 null 去掉 */
  setBadge(b: Badge | null) {
    this.view.setBadge(b);
  }

  setArrows(arrows: Arrow[]) {
    this.view.setArrows(arrows);
  }

  /** 点带 id 的箭头时回调（复盘：点"最佳"那条箭头看后续） */
  setArrowTap(fn: ((id: string) => void) | undefined) {
    this.view.setArrowTap(fn);
  }

  dispose() {
    this.amb.dispose();
    this.fx.dispose();
    this.view.dispose();
    this.host.remove();
  }
}
