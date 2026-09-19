/**
 * 朗读（TTS）
 *
 * 用浏览器自带的 speechSynthesis。不引第三方语音服务，原因有三：
 * 离线可用、不产生费用、孩子的学习内容不需要发到任何服务器上去合成。
 *
 * 代价是音色取决于设备。所以这里做了挑音色的逻辑：优先挑英式/美式的
 * 女声或儿童声，实在没有再退回系统默认。听起来的差别对孩子影响很大——
 * 一个机械的合成音会让人不想听第二遍。
 *
 * 三个真实世界的坑，都在这里处理掉：
 *  1. voices 是异步加载的，页面刚打开时 getVoices() 往往是空数组
 *  2. 部分浏览器要求首次播放必须由用户手势触发
 *  3. Chrome 上超过大约 15 秒的朗读会被静默掐断，长文本必须切句
 */

type Synth = typeof window.speechSynthesis;

function synth(): Synth | null {
  if (typeof window === 'undefined') return null;
  return window.speechSynthesis ?? null;
}

export function ttsAvailable(): boolean {
  return !!synth() && typeof window.SpeechSynthesisUtterance === 'function';
}

let cachedVoice: SpeechSynthesisVoice | null = null;
let voicesReady = false;

/** 挑一个尽量适合孩子的英语音色 */
function pickVoice(): SpeechSynthesisVoice | null {
  const s = synth();
  if (!s) return null;
  const voices = s.getVoices();
  if (!voices.length) return null;

  const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  if (!en.length) return null;

  const score = (v: SpeechSynthesisVoice) => {
    let n = 0;
    const name = v.name.toLowerCase();
    // 这些是各平台上听起来比较自然的英语音色
    if (/(samantha|karen|moira|tessa|serena|allison|ava|google us english|google uk english female)/.test(name)) n += 6;
    if (/(female|woman|girl|kid|child)/.test(name)) n += 3;
    if (/^en-us/i.test(v.lang)) n += 2;
    if (/^en-gb/i.test(v.lang)) n += 1;
    if (v.localService) n += 1; // 本地音色不需要联网，延迟低
    return n;
  };
  return en.slice().sort((a, b) => score(b) - score(a))[0] ?? en[0];
}

/** voices 异步到位后重新挑一次 */
function ensureVoice(): SpeechSynthesisVoice | null {
  if (cachedVoice) return cachedVoice;
  cachedVoice = pickVoice();
  if (!voicesReady) {
    const s = synth();
    if (s && 'onvoiceschanged' in s) {
      s.onvoiceschanged = () => {
        cachedVoice = pickVoice();
      };
      voicesReady = true;
    }
  }
  return cachedVoice;
}

export interface SpeakOptions {
  /** 语速。给孩子默认放慢到 0.85 */
  rate?: number;
  pitch?: number;
  /** 读完（或失败）时回调。失败也会回调，界面不能等一个永远不来的 onEnd */
  onEnd?: () => void;
  /** 每个词开始时回调，用于高亮当前朗读的词 */
  onWord?: (charIndex: number) => void;
}

let currentUtter: SpeechSynthesisUtterance | null = null;
let queue: string[] = [];

export function cancelSpeech(): void {
  queue = [];
  currentUtter = null;
  try {
    synth()?.cancel();
  } catch {
    // 某些浏览器在没有任何朗读时调 cancel 会抛，忽略
  }
}

/**
 * 朗读一段英文。
 *
 * 长文本按句切开排队，规避 Chrome 的长句静默截断。
 * 任何异常都会走到 onEnd——界面依赖 onEnd 推进流程，不能让它丢。
 */
export function speak(text: string, opt: SpeakOptions = {}): void {
  const s = synth();
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!s || !clean || !ttsAvailable()) {
    opt.onEnd?.();
    return;
  }

  cancelSpeech();

  // 按句切，每句不超过 160 字符
  const parts: string[] = [];
  for (const sentence of clean.split(/(?<=[.!?])\s+/)) {
    if (sentence.length <= 160) parts.push(sentence);
    else {
      for (let i = 0; i < sentence.length; i += 160) parts.push(sentence.slice(i, i + 160));
    }
  }
  queue = parts.slice(1);

  const makeUtter = (t: string, isLast: boolean) => {
    const u = new SpeechSynthesisUtterance(t);
    const v = ensureVoice();
    if (v) u.voice = v;
    u.lang = v?.lang ?? 'en-US';
    u.rate = opt.rate ?? 0.85;
    u.pitch = opt.pitch ?? 1.08;
    u.volume = 1;
    if (opt.onWord) {
      u.onboundary = (e) => {
        if (e.name === 'word' || e.name === undefined) opt.onWord?.(e.charIndex);
      };
    }
    const next = () => {
      if (currentUtter !== u) return; // 已经被 cancel 了
      const nxt = queue.shift();
      if (nxt) {
        const nu = makeUtter(nxt, !queue.length);
        currentUtter = nu;
        try {
          s.speak(nu);
        } catch {
          opt.onEnd?.();
        }
      } else if (isLast || !queue.length) {
        currentUtter = null;
        opt.onEnd?.();
      }
    };
    u.onend = next;
    // 出错也要往下走。最常见的是浏览器还没拿到用户手势就调用了 speak
    u.onerror = next;
    return u;
  };

  const first = makeUtter(parts[0] ?? clean, parts.length <= 1);
  currentUtter = first;
  try {
    s.speak(first);
  } catch {
    opt.onEnd?.();
  }
}

/** 朗读并返回 Promise，方便在流程里 await */
export function speakAsync(text: string, opt: Omit<SpeakOptions, 'onEnd'> = {}): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve();
    };
    // 兜底超时：某些设备上 onEnd 不触发，不能让整个学习流程卡死在这里
    const cap = Math.min(12000, 2200 + text.length * 90);
    const timer = setTimeout(finish, cap);
    speak(text, {
      ...opt,
      onEnd: () => {
        clearTimeout(timer);
        finish();
      },
    });
  });
}

/**
 * 有些浏览器要求第一次朗读必须发生在用户手势的同步调用里。
 * 首页的 START 按钮会调一次这个，把「解锁」这件事一次性做掉。
 */
export function warmUpSpeech(): void {
  const s = synth();
  if (!s || !ttsAvailable()) return;
  try {
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    s.speak(u);
    ensureVoice();
  } catch {
    // 解锁失败不影响后续，只是第一次朗读可能没声音
  }
}
