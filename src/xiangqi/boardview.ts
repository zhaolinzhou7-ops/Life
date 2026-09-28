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
import { Board2D, type Mark } from './board2d';
import { applyMove, type Board, type Move } from './rules';

export class BoardView {
  private view: Board2D;
  private host: HTMLElement;
  private board: Board | null = null;
  /** 落子后的轻微延时，纯粹为了节奏，不做位移动画——棋子一帧都不离开交叉点 */
  private slideMs = 0;

  constructor(parent: HTMLElement, onTap: (x: number, y: number) => void, flip = false) {
    this.host = document.createElement('div');
    this.host.className = 'xq-boardwrap';
    parent.appendChild(this.host);
    this.view = new Board2D(this.host, { flip, coords: true, onTap });
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
   * 这里**不做棋子飞行动画**：棋子离开交叉点的那一瞬间，盘面就是错的，
   * 而"棋子位置不对"是这个项目修过的历史 bug。节奏感由 slideMs 这个纯等待
   * 提供——落子即到，然后停一下再往下走，既准确又不机械。
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

  /** 3D 版本有发牌动画，2D 没有——保留这个方法只是为了调用方不用分支 */
  dealIn() {
    /* 正视棋盘直接摆好，不需要入场动画 */
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

  setArrows(arrows: { fx: number; fy: number; tx: number; ty: number; color?: string }[]) {
    this.view.setArrows(arrows);
  }

  dispose() {
    this.view.dispose();
    this.host.remove();
  }
}
