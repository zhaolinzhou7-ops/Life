/**
 * 语音识别
 *
 * 用浏览器的 Web Speech API。它的现实情况必须先说清楚，因为整个跟读流程
 * 的降级设计都建立在这上面：
 *
 *  · Safari / Chrome 支持，Firefox 至今不支持
 *  · Chrome 的识别要联网（音频会发到 Google 的服务）
 *  · 第一次调用会弹麦克风授权，孩子或家长可能直接点拒绝
 *  · 孩子声音小、吐字不清、环境吵，识别为空是常态不是异常
 *
 * 所以这一层的职责不只是"拿到文本"，更重要的是**把各种失败分清楚**，
 * 让界面能给出不同的应对：不支持 → 直接走「我说啦」按钮；
 * 拒绝授权 → 告诉家长怎么开，同时照样能学；没听到 → 鼓励再说一次。
 *
 * 永远不会因为麦克风不可用就卡住学习流程。跟读拿不到声音时，
 * 孩子点一下「我说啦」就继续——学习节奏比数据完整更重要。
 */

export type RecogError = 'not-supported' | 'denied' | 'no-speech' | 'network' | 'aborted' | 'unknown';

export interface RecogResult {
  ok: boolean;
  transcript: string;
  error?: RecogError;
  /** 给家长看的人话说明。儿童端不显示 */
  detail?: string;
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onspeechend: (() => void) | null;
}

type Ctor = new () => SpeechRecognitionLike;

function ctor(): Ctor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function recognizerAvailable(): boolean {
  return !!ctor();
}

export const ERROR_TEXT: Record<RecogError, string> = {
  'not-supported': '这个浏览器不支持语音识别（Firefox 目前就不支持）。跟读环节会改成点一下确认，学习内容不受影响。',
  denied: '麦克风权限被拒绝了。可以在浏览器地址栏左侧的图标里重新允许；不开也能继续学，跟读会改成点一下确认。',
  'no-speech': '没有听到声音。可能是孩子声音太小，或者麦克风被别的程序占用了。',
  network: '语音识别需要联网（Chrome 的识别在云端做）。现在连不上，跟读会改成点一下确认。',
  aborted: '这次识别被中断了。',
  unknown: '语音识别出了点问题。',
};

let active: SpeechRecognitionLike | null = null;

/** 停掉正在进行的识别。切页面时必须调，否则麦克风指示灯会一直亮着 */
export function stopListening(): void {
  try {
    active?.abort();
  } catch {
    // 已经结束了
  }
  active = null;
}

export interface ListenOptions {
  /** 最长听多久（毫秒）。孩子不会一直说，给太长只会让他等 */
  timeoutMs?: number;
  lang?: string;
  /** 开始收音时回调，用于界面显示"正在听" */
  onStart?: () => void;
}

/**
 * 听一次，拿到一段文本。
 *
 * 无论成功失败都会 resolve，不会 reject——调用方不需要写 try/catch，
 * 也就不会出现某个分支忘了处理导致流程卡死。
 */
export function listenOnce(opt: ListenOptions = {}): Promise<RecogResult> {
  const C = ctor();
  if (!C) {
    return Promise.resolve({
      ok: false,
      transcript: '',
      error: 'not-supported',
      detail: ERROR_TEXT['not-supported'],
    });
  }

  stopListening();

  return new Promise<RecogResult>((resolve) => {
    let settled = false;
    const done = (r: RecogResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        rec.stop();
      } catch {
        // 已经停了
      }
      if (active === rec) active = null;
      resolve(r);
    };

    const rec = new C();
    active = rec;
    rec.lang = opt.lang ?? 'en-US';
    rec.continuous = false;
    rec.interimResults = false;
    rec.maxAlternatives = 3;

    const timer = setTimeout(() => {
      done({ ok: false, transcript: '', error: 'no-speech', detail: ERROR_TEXT['no-speech'] });
    }, opt.timeoutMs ?? 6000);

    rec.onresult = (e) => {
      // 取所有候选里最长的那个：孩子说得短，识别引擎常把完整的那条排在后面
      let best = '';
      const first = e.results?.[0];
      if (first) {
        for (let i = 0; i < first.length; i++) {
          const t = first[i]?.transcript ?? '';
          if (t.trim().length > best.length) best = t.trim();
        }
      }
      done({ ok: !!best, transcript: best, error: best ? undefined : 'no-speech' });
    };

    rec.onerror = (e) => {
      const raw = String(e?.error ?? '');
      const map: Record<string, RecogError> = {
        'not-allowed': 'denied',
        'service-not-allowed': 'denied',
        'no-speech': 'no-speech',
        network: 'network',
        aborted: 'aborted',
        'audio-capture': 'denied',
      };
      const err = map[raw] ?? 'unknown';
      done({ ok: false, transcript: '', error: err, detail: ERROR_TEXT[err] });
    };

    rec.onend = () => {
      // 正常结束但没有 result：当作没听到
      done({ ok: false, transcript: '', error: 'no-speech', detail: ERROR_TEXT['no-speech'] });
    };

    try {
      opt.onStart?.();
      rec.start();
    } catch {
      done({ ok: false, transcript: '', error: 'unknown', detail: ERROR_TEXT.unknown });
    }
  });
}

/**
 * 麦克风权限状态查询。
 *
 * 只为了让家长端能显示"当前是否已授权"，不用它来决定流程——
 * permissions API 在不少浏览器上不支持或者返回 prompt，不可靠。
 */
export async function micPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const p = navigator.permissions as unknown as
      | { query(d: { name: string }): Promise<{ state: string }> }
      | undefined;
    if (!p?.query) return 'unknown';
    const st = await p.query({ name: 'microphone' });
    if (st.state === 'granted' || st.state === 'denied' || st.state === 'prompt') return st.state;
    return 'unknown';
  } catch {
    return 'unknown';
  }
}
