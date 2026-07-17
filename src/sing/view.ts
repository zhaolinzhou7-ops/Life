/** sing 模块共用的画布与动画循环小工具 */

export interface View {
  canvas: HTMLCanvasElement;
  g: CanvasRenderingContext2D;
  w: number;
  h: number;
  dispose: () => void;
}

/** 建一块自动适配 DPR 与窗口大小的画布 */
export function makeCanvas(parent: HTMLElement, className = 'sing-canvas'): View {
  const canvas = document.createElement('canvas');
  canvas.className = className;
  parent.appendChild(canvas);
  const g = canvas.getContext('2d')!;
  const view: View = { canvas, g, w: 0, h: 0, dispose: () => {} };

  const resize = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const rect = canvas.getBoundingClientRect();
    view.w = rect.width;
    view.h = rect.height;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  // 布局完成后再量一次尺寸
  requestAnimationFrame(resize);
  resize();
  window.addEventListener('resize', resize);
  view.dispose = () => {
    window.removeEventListener('resize', resize);
    canvas.remove();
  };
  return view;
}

/** requestAnimationFrame 循环，返回停止函数；fn 收到与上帧的间隔秒数 */
export function rafLoop(fn: (dt: number) => void): () => void {
  let id = 0;
  let last = performance.now();
  let stopped = false;
  const tick = (t: number) => {
    if (stopped) return;
    const dt = Math.min(0.1, (t - last) / 1000);
    last = t;
    fn(dt);
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => {
    stopped = true;
    cancelAnimationFrame(id);
  };
}

/** 把用户音高按整八度折叠到目标附近（唱低/高八度都算对，符合大众唱歌习惯） */
export function foldOctave(userMidi: number, targetMidi: number): number {
  return userMidi - Math.round((userMidi - targetMidi) / 12) * 12;
}

/** 简易按钮 */
export function btn(text: string, className: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.innerHTML = text;
  b.addEventListener('click', onClick);
  return b;
}
