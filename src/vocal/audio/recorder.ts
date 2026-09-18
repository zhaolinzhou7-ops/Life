/**
 * 麦克风采集（Audio Input 层）。
 *
 * 为什么不用 MediaRecorder：它给的是压缩后的 webm/opus，要解码才能拿到样本，
 * 而且编码器会做它自己的处理。分析需要**原始 PCM**，所以这里直接从
 * AudioWorklet 把每一个采样点取出来。
 *
 * AudioWorklet 通过 Blob URL 加载，不需要额外的构建配置；
 * 万一被 CSP 挡了（少数环境），自动降级到 ScriptProcessorNode——
 * 它虽然被标为废弃，但至今所有浏览器都还支持，做兜底正合适。
 */

import { audioCtx } from './context';

export type MicState = 'idle' | 'asking' | 'ready' | 'denied' | 'unsupported' | 'error';

export interface Recording {
  samples: Float32Array;
  sampleRate: number;
  /** 录音第一个采样点对应的 AudioContext 时间，用于和伴奏对齐 */
  startCtxTime: number;
  durationSec: number;
}

/** 录音时长硬上限：再长内存吃不消，分析也会把问题平均掉 */
export const MAX_RECORD_SEC = 480;

const WORKLET_SRC = `
class VocalRecorder extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(4096);
    this.at = 0;
    this.started = false;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    if (!this.started) {
      this.started = true;
      this.port.postMessage({ type: 'start', time: currentTime });
    }
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.at++] = ch[i];
      if (this.at === this.buf.length) {
        this.port.postMessage({ type: 'data', chunk: this.buf });
        this.buf = new Float32Array(4096);
        this.at = 0;
      }
    }
    return true;
  }
}
registerProcessor('vocal-recorder', VocalRecorder);
`;

/**
 * Worklet 模块每个 AudioContext 只能注册一次——第二次 registerProcessor
 * 同名会抛错。训练模式里每一步都要 start/stop 一次录音，所以必须缓存这个 Promise，
 * 否则从第二步起就会一路降级到 ScriptProcessor。
 */
let workletReady: Promise<void> | null = null;

function ensureWorklet(ctx: AudioContext): Promise<void> {
  if (!workletReady) {
    const url = URL.createObjectURL(new Blob([WORKLET_SRC], { type: 'application/javascript' }));
    workletReady = ctx
      .audioWorklet.addModule(url)
      .finally(() => URL.revokeObjectURL(url));
    // 失败就把缓存清掉，下次还能再试一次（也可能一直失败，那就走降级路径）
    workletReady.catch(() => {
      workletReady = null;
    });
  }
  return workletReady;
}

export class Recorder {
  private chunks: Float32Array[] = [];
  private total = 0;
  private recording = false;
  private startTime = 0;
  private node: AudioWorkletNode | ScriptProcessorNode | null = null;
  /** 0 增益的接地节点：Worklet/ScriptProcessor 必须接到图上才会被调度 */
  private sink: GainNode | null = null;
  private onLimit: (() => void) | null = null;

  private constructor(
    private ctx: AudioContext,
    private stream: MediaStream,
    private source: MediaStreamAudioSourceNode,
    readonly analyser: AnalyserNode,
    private buf: Float32Array<ArrayBuffer>,
  ) {}

  /** 申请麦克风权限并建好采集链路。被拒绝会抛错，调用方负责给出人话提示 */
  static async create(): Promise<Recorder> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('unsupported');
    }
    const ctx = audioCtx();
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        // 回声消除留着：用外放伴奏时能挡掉大部分漏音。
        echoCancellation: true,
        // 降噪关掉：它会把弱唱的尾音一起吃掉，音准分析会受影响。
        noiseSuppression: false,
        // 自动增益必须关：它会把动态范围抹平，那正是我们要测的东西之一。
        autoGainControl: false,
      },
    });
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0;
    source.connect(analyser);
    return new Recorder(ctx, stream, source, analyser, new Float32Array(analyser.fftSize));
  }

  /** 最近一帧的时域波形，实时音高检测和电平表都用它 */
  readFrame(): Float32Array {
    this.analyser.getFloatTimeDomainData(this.buf);
    return this.buf;
  }

  /** 最近一帧的音量（线性 RMS） */
  readLevel(): number {
    const b = this.readFrame();
    let s = 0;
    for (let i = 0; i < b.length; i++) s += b[i] * b[i];
    return Math.sqrt(s / b.length);
  }

  get isRecording(): boolean {
    return this.recording;
  }

  /** 已录制时长（秒） */
  get elapsed(): number {
    return this.total / this.ctx.sampleRate;
  }

  /**
   * 开始录制原始 PCM。
   * @param onLimit 到达时长上限时回调（调用方应当自动停止）
   */
  async start(onLimit?: () => void): Promise<void> {
    if (this.recording) return;
    this.chunks = [];
    this.total = 0;
    this.startTime = this.ctx.currentTime;
    this.onLimit = onLimit ?? null;
    this.recording = true;

    const limit = MAX_RECORD_SEC * this.ctx.sampleRate;
    const push = (chunk: Float32Array) => {
      if (!this.recording) return;
      this.chunks.push(chunk);
      this.total += chunk.length;
      if (this.total >= limit) {
        this.recording = false;
        this.onLimit?.();
      }
    };

    const sink = this.ctx.createGain();
    sink.gain.value = 0;
    sink.connect(this.ctx.destination);
    this.sink = sink;

    try {
      await ensureWorklet(this.ctx);
      const node = new AudioWorkletNode(this.ctx, 'vocal-recorder');
      node.port.onmessage = (e: MessageEvent) => {
        const d = e.data as { type: string; chunk?: Float32Array; time?: number };
        if (d.type === 'start' && typeof d.time === 'number') this.startTime = d.time;
        else if (d.type === 'data' && d.chunk) push(d.chunk);
      };
      this.source.connect(node);
      node.connect(sink);
      this.node = node;
    } catch {
      // 降级路径：ScriptProcessor 虽已废弃，但至今所有浏览器都还支持，兜底最稳
      const node = this.ctx.createScriptProcessor(4096, 1, 1);
      node.onaudioprocess = (e) => push(new Float32Array(e.inputBuffer.getChannelData(0)));
      this.source.connect(node);
      node.connect(sink);
      this.node = node;
    }
  }

  /** 停止并取回整段录音 */
  stop(): Recording {
    this.recording = false;
    if (this.node) {
      try {
        this.source.disconnect(this.node);
        this.node.disconnect();
      } catch {
        // 已断开
      }
      if ('port' in this.node) this.node.port.onmessage = null;
      else (this.node as ScriptProcessorNode).onaudioprocess = null;
      this.node = null;
    }
    if (this.sink) {
      this.sink.disconnect();
      this.sink = null;
    }
    const samples = new Float32Array(this.total);
    let o = 0;
    for (const c of this.chunks) {
      samples.set(c, o);
      o += c.length;
    }
    this.chunks = [];
    return {
      samples,
      sampleRate: this.ctx.sampleRate,
      startCtxTime: this.startTime,
      durationSec: samples.length / this.ctx.sampleRate,
    };
  }

  /** 释放麦克风。必须调用——否则浏览器标签页上的录音红点不会消失 */
  dispose(): void {
    this.recording = false;
    try {
      this.node?.disconnect();
      this.source.disconnect();
    } catch {
      // 忽略
    }
    for (const t of this.stream.getTracks()) t.stop();
  }
}

/** 把 getUserMedia 的异常翻译成用户能照做的提示 */
export function micErrorMessage(e: unknown): { state: MicState; text: string; fix: string } {
  const name = e instanceof Error ? e.name : String(e);
  const msg = e instanceof Error ? e.message : '';
  if (msg === 'unsupported' || name === 'TypeError') {
    return {
      state: 'unsupported',
      text: '这个浏览器不支持网页录音',
      fix: '换用 Chrome / Edge / Safari 的较新版本；另外网页必须是 https 或 localhost 才允许用麦克风。',
    };
  }
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return {
      state: 'denied',
      text: '麦克风权限被拒绝了',
      fix: '点一下地址栏左边的锁/摄像头图标，把麦克风改成「允许」，然后刷新页面。',
    };
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return {
      state: 'error',
      text: '没有找到可用的麦克风',
      fix: '检查一下麦克风有没有插好、系统里是否被禁用了。',
    };
  }
  if (name === 'NotReadableError') {
    return {
      state: 'error',
      text: '麦克风被其他程序占用了',
      fix: '关掉正在用麦克风的应用（会议软件、录音软件等）再试。',
    };
  }
  return { state: 'error', text: '打开麦克风失败', fix: `错误信息：${name}。刷新页面重试一次看看。` };
}
