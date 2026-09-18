/** 全应用共用一个 AudioContext：麦克风、伴奏、回放都挂在它上面，时间轴才对得齐。 */

let ctx: AudioContext | null = null;
let master: GainNode | null = null;

export function audioCtx(): AudioContext {
  if (!ctx) {
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.7;
    master.connect(ctx.destination);
  }
  return ctx;
}

export function masterGain(): GainNode {
  audioCtx();
  return master!;
}

/** 浏览器要求音频必须由用户手势解锁，所以每个「开始」按钮都要调一次 */
export function resumeAudio(): void {
  const c = audioCtx();
  if (c.state === 'suspended') void c.resume();
}

export function isAudioReady(): boolean {
  return ctx !== null && ctx.state === 'running';
}
