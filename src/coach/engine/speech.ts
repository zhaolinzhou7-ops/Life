/**
 * 语音层：录音识别（ASR）与朗读（TTS）
 *
 * ──────────── 这个文件最重要的部分是它**不做**什么 ────────────
 *
 * 浏览器能给我们的只有：识别出来的文本、识别器自己的置信度、以及我们自己
 * 掐的时间。拿不到音素、拿不到基频、拿不到时长对齐。
 *
 * 所以这里**不会**输出"发音准确率 87.3%"这种数字（第 22 节）。
 * 那个数字需要声学模型逐音素比对，我们没有。编一个出来的代价是：用户按着
 * 这个分数练三个月，练的是一个不存在的指标。
 *
 * 能诚实给出的是这些，每一个都标了口径：
 *   · 识别文本与目标句的**词级比对** —— 但要写清"没对上的词可能是没读准，
 *     也可能是识别器没听清"，这两件事我们分辨不了
 *   · 说话时长 —— 真实计时
 *   · 语速（词/分钟）—— 由上面两个真实值推出来
 *   · 开口用时 —— 从点下录音到出现第一个词，反映"要在心里翻译多久"
 *   · 识别器置信度 —— 明确标注这是**识别器有多确定**，不是你发音有多准
 *
 * ──────────── 降级 ────────────
 * 浏览器不支持、没有麦克风权限、识别失败、没有声音、网络断了——
 * 每一种都要能落到"打字"这条路上，而不是卡住。口语练习的价值在于
 * 组织句子，打字虽然少了发音这一环，但组织句子那一环还在。
 */

import type { Measured } from '../types';
import { measured } from '../types';
import { words } from './morph';

// ——— 浏览器类型声明。SpeechRecognition 还不在标准 lib.dom 里 ———
interface SpeechRecognitionAlternativeLike {
  transcript: string;
  confidence: number;
}
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  length: number;
  [index: number]: SpeechRecognitionAlternativeLike;
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const asrSupported = (): boolean => getRecognitionCtor() !== null;

export const ttsSupported = (): boolean =>
  typeof window !== 'undefined' && 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

/** 识别失败的原因。每一种在界面上都要有不同的说法，不能一律"出错了" */
export type AsrFailure =
  | 'unsupported' // 浏览器不支持
  | 'denied' // 用户拒绝了麦克风权限
  | 'no-speech' // 开了麦但没说话
  | 'audio' // 麦克风本身有问题
  | 'network' // 识别服务连不上（多数实现要联网）
  | 'aborted' // 用户主动取消
  | 'unknown';

export const FAILURE_TEXT: Record<AsrFailure, { title: string; detail: string; canRetry: boolean }> = {
  unsupported: {
    title: '这个浏览器不支持语音识别',
    detail: '桌面版 Chrome 和 Edge 支持得最好。你可以改用打字，练习内容完全一样，只是少了发音这一环。',
    canRetry: false,
  },
  denied: {
    title: '没有拿到麦克风权限',
    detail: '在地址栏左侧的图标里把麦克风改成"允许"，然后再试一次。也可以先用打字。',
    canRetry: true,
  },
  'no-speech': {
    title: '没听到声音',
    detail: '可能是麦克风被静音了，或者说得太轻。再试一次，或者改用打字。',
    canRetry: true,
  },
  audio: {
    title: '麦克风打不开',
    detail: '检查一下有没有别的程序正在占用麦克风。也可以先用打字。',
    canRetry: true,
  },
  network: {
    title: '语音识别服务连不上',
    detail: '浏览器的语音识别通常需要联网。检查一下网络，或者改用打字。',
    canRetry: true,
  },
  aborted: { title: '录音已取消', detail: '', canRetry: true },
  unknown: { title: '语音识别没成功', detail: '再试一次，或者改用打字。', canRetry: true },
};

function mapError(code: string): AsrFailure {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'denied';
    case 'no-speech':
      return 'no-speech';
    case 'audio-capture':
      return 'audio';
    case 'network':
      return 'network';
    case 'aborted':
      return 'aborted';
    default:
      return 'unknown';
  }
}

export interface AsrResult {
  transcript: string;
  /** 识别器对自己有多确定。**不是**发音准确率 */
  confidence?: number;
  /** 从开始录音到收到第一个词，毫秒。真实计时 */
  timeToFirstWordMs?: number;
  /** 录音总时长，毫秒。真实计时 */
  durationMs: number;
}

export interface AsrHandle {
  stop(): void;
  cancel(): void;
}

/**
 * 开始一次语音识别。
 *
 * 刻意不返回 Promise：口语练习需要看到实时的中间结果（用户说到一半就能
 * 看到字出来，心里有底），Promise 只能给最终结果。
 */
export function startAsr(cb: {
  onInterim?: (text: string) => void;
  onResult: (r: AsrResult) => void;
  onError: (f: AsrFailure) => void;
  lang?: string;
  /** 多久没说话就自动停。默认 12 秒 */
  silenceMs?: number;
}): AsrHandle | null {
  const Ctor = getRecognitionCtor();
  if (!Ctor) {
    cb.onError('unsupported');
    return null;
  }

  const rec = new Ctor();
  rec.lang = cb.lang ?? 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  rec.maxAlternatives = 1;

  const started = Date.now();
  let firstWordAt: number | undefined;
  let finalText = '';
  let bestConfidence: number | undefined;
  let settled = false;
  let cancelled = false;

  const timer = window.setTimeout(() => {
    try {
      rec.stop();
    } catch {
      // 已经停了
    }
  }, cb.silenceMs ?? 12000);

  const finish = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (cancelled) return;
    const text = finalText.trim();
    if (!text) {
      cb.onError('no-speech');
      return;
    }
    cb.onResult({
      transcript: text,
      confidence: bestConfidence,
      timeToFirstWordMs: firstWordAt ? firstWordAt - started : undefined,
      durationMs: Date.now() - started,
    });
  };

  rec.onresult = (e) => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      const alt = r[0];
      if (!alt) continue;
      if (!firstWordAt && alt.transcript.trim()) firstWordAt = Date.now();
      if (r.isFinal) {
        finalText += (finalText ? ' ' : '') + alt.transcript.trim();
        // 取所有片段里最低的置信度：一段话里最不确定的那块才是风险所在
        if (typeof alt.confidence === 'number' && alt.confidence > 0) {
          bestConfidence = bestConfidence === undefined ? alt.confidence : Math.min(bestConfidence, alt.confidence);
        }
      } else {
        interim += alt.transcript;
      }
    }
    if (interim && cb.onInterim) cb.onInterim((finalText + ' ' + interim).trim());
  };

  rec.onerror = (e) => {
    if (settled) return;
    const f = mapError(e.error);
    // no-speech 时如果其实已经识别到东西了，就当成功处理
    if (f === 'no-speech' && finalText.trim()) {
      finish();
      return;
    }
    settled = true;
    clearTimeout(timer);
    if (!cancelled) cb.onError(f);
  };

  rec.onend = finish;

  try {
    rec.start();
  } catch {
    clearTimeout(timer);
    cb.onError('unknown');
    return null;
  }

  return {
    stop() {
      try {
        rec.stop();
      } catch {
        finish();
      }
    },
    cancel() {
      cancelled = true;
      settled = true;
      clearTimeout(timer);
      try {
        rec.abort();
      } catch {
        // 忽略
      }
    },
  };
}

// ═══════════════════════ 朗读 ═══════════════════════

let cachedVoice: SpeechSynthesisVoice | null | undefined;

/** 挑一个英语嗓音。挑不到就用默认的，不要因此拒绝朗读 */
function pickVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice !== undefined) return cachedVoice;
  if (!ttsSupported()) return (cachedVoice = null);
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null; // 还没加载好，下次再问
  const prefer = ['Samantha', 'Daniel', 'Google US English', 'Microsoft Aria', 'Alex'];
  cachedVoice =
    voices.find((v) => prefer.some((p) => v.name.includes(p))) ??
    voices.find((v) => v.lang.startsWith('en-US')) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null;
  return cachedVoice;
}

export interface SpeakHandle {
  stop(): void;
}

/**
 * 朗读一段文本。
 *
 * rate 是真实传给合成器的倍率，所以"慢速/正常/快速"是真的在改语速，
 * 不是界面上写着慢速、实际放的还是同一段。
 */
export function speak(
  text: string,
  opts: { rate?: number; onEnd?: () => void; onError?: () => void } = {},
): SpeakHandle | null {
  if (!ttsSupported()) {
    opts.onError?.();
    return null;
  }
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'en-US';
    u.rate = opts.rate ?? 0.95;
    const v = pickVoice();
    if (v) u.voice = v;
    u.onend = () => opts.onEnd?.();
    u.onerror = () => opts.onError?.();
    window.speechSynthesis.speak(u);
    return {
      stop() {
        try {
          window.speechSynthesis.cancel();
        } catch {
          // 忽略
        }
      },
    };
  } catch {
    opts.onError?.();
    return null;
  }
}

export function stopSpeaking(): void {
  if (ttsSupported()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // 忽略
    }
  }
}

// ═══════════════════════ 跟读比对 ═══════════════════════

export interface ShadowWord {
  word: string;
  /** hit = 识别文本里有；miss = 没有 */
  hit: boolean;
}

export interface ShadowResult {
  words: ShadowWord[];
  matched: number;
  total: number;
  metrics: Record<string, Measured>;
  /** 这次比对的口径说明，必须显示在结果旁边 */
  caveat: string;
}

/**
 * 跟读比对：目标句 vs 识别文本。
 *
 * 用最长公共子序列做对齐，而不是逐词比——用户多说一个 the 不应该导致
 * 后面全错位。LCS 能正确处理插入和删除。
 */
export function compareShadow(target: string, transcript: string, durationMs?: number): ShadowResult {
  const t = words(target);
  const s = words(transcript);

  // LCS 回溯，标出目标句里哪些词在识别文本中出现了
  const n = t.length;
  const m = s.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = t[i] === s[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: ShadowWord[] = [];
  let i = 0;
  let j = 0;
  while (i < n) {
    if (j < m && t[i] === s[j]) {
      out.push({ word: t[i], hit: true });
      i++;
      j++;
    } else if (j < m && dp[i + 1][j] < dp[i][j + 1]) {
      j++;
    } else {
      out.push({ word: t[i], hit: false });
      i++;
    }
  }

  const matched = out.filter((w) => w.hit).length;
  const metrics: Record<string, Measured> = {
    matchedWords: measured(matched, 'asr', `目标句 ${n} 个词里，识别文本中出现了几个`, '词'),
    totalWords: measured(n, 'counted', '目标句的词数', '词'),
  };
  if (durationMs && durationMs > 500 && s.length) {
    metrics.wpm = measured(
      Math.round((s.length / (durationMs / 1000)) * 60),
      'timed',
      '识别出的词数 ÷ 录音时长。含停顿，所以比"纯说话语速"偏低',
      '词/分',
    );
  }

  return {
    words: out,
    matched,
    total: n,
    metrics,
    caveat:
      '这里比对的是**语音识别出来的文字**和目标句。没对上的词，可能是读得不准，也可能只是识别器没听清——这两件事浏览器分辨不了，所以不给发音评分。',
  };
}

/** 自由表达时能诚实给出的那几个指标 */
export function freeSpeechMetrics(r: AsrResult): Record<string, Measured> {
  const n = words(r.transcript).length;
  const out: Record<string, Measured> = {
    spokenWords: measured(n, 'counted', '识别出来的词数', '词'),
    durationSec: measured(Math.round(r.durationMs / 100) / 10, 'timed', '从开始录音到结束的真实时长', '秒'),
  };
  if (r.durationMs > 1000 && n) {
    out.wpm = measured(
      Math.round((n / (r.durationMs / 1000)) * 60),
      'timed',
      '识别词数 ÷ 录音时长。含停顿，母语者日常对话大约 140~170',
      '词/分',
    );
  }
  if (r.timeToFirstWordMs !== undefined) {
    out.timeToFirstWord = measured(
      Math.round(r.timeToFirstWordMs / 100) / 10,
      'timed',
      '从按下录音到说出第一个词。这个数越大，说明在心里翻译的时间越长',
      '秒',
    );
  }
  if (r.confidence !== undefined) {
    out.asrConfidence = measured(
      Math.round(r.confidence * 100),
      'asr',
      '语音识别器对自己识别结果的把握程度。**这不是发音评分**——识别器听不清可能是口音，也可能是环境噪音或网络问题',
      '%',
    );
  }
  return out;
}
