/**
 * 象棋配音：开局、吃子、将军、绝杀的喊声，出场人物的开场白。
 *
 * 终局再说一句（大获全胜、胜败乃兵家常事、握手言和）。
 *
 * 用户原话："出场、开局，以及吃子、将军、绝杀等关键节点，都要有浑厚的人声配音（男声或女声），比如喊出'将军'这种，
 * 不要只有电子打击音。"
 * 录音是离线生成好的（tools/gen-voice.py：开源语音合成念、处理成浑厚的喊声、再让语音识别把每一句听一遍对过字），
 * 放在 src/xiangqi/voice/，每句十几 KB；用到哪句才下载哪句，解码一次留着。
 * 走 gamesfx 的总线（同一个混响、同一个压缩），喊话时配乐让一让（xqMusicDuck）。
 */
import { isMuted, musicCore } from './gamesfx';
import { xqMusicDuck } from './xqmusic';

const FILES = import.meta.glob('./xiangqi/voice/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const urlOf = (name: string) => FILES[`./xiangqi/voice/${name}.mp3`];

/** 对局里喊的几句 */
export type Shout = 'kaiju' | 'jiangjun' | 'jiesha' | 'kunbi' | 'chiche' | 'chima' | 'chipao' | 'win' | 'lose' | 'draw';
/** 配音：男声、女声、不要 */
export type VoiceKind = 'm' | 'f' | 'off';

const KEY = 'xq-voice';
export function getVoiceKind(): VoiceKind {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'm' || v === 'f' || v === 'off') return v;
  } catch {
    /* 读不出来按默认 */
  }
  return 'm';
}
export function setVoiceKind(v: VoiceKind) {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* 存不下就这一次有效 */
  }
}

const decoded = new Map<string, Promise<AudioBuffer | null>>();
function load(name: string): Promise<AudioBuffer | null> {
  const had = decoded.get(name);
  if (had) return had;
  const url = urlOf(name);
  const core = musicCore();
  const p =
    url && core
      ? fetch(url)
          .then((r) => r.arrayBuffer())
          .then((b) => core.c.decodeAudioData(b))
          .catch(() => null)
      : Promise.resolve(null);
  decoded.set(name, p);
  return p;
}

/** 先把这几句拉下来（开局时调一下，第一次将军就不用等下载） */
export function preloadVoice(names: string[]) {
  for (const n of names) void load(n);
}
/** 对局要用的那几句（按现在的男声/女声） */
export function preloadShouts() {
  const k = getVoiceKind();
  if (k === 'off') return;
  preloadVoice((['kaiju', 'jiangjun', 'jiesha', 'kunbi', 'chiche', 'chima', 'chipao', 'win', 'lose', 'draw'] as Shout[]).map((s) => `${k}-${s}`));
}

/** 最近一次喊的是哪一句（测试看） */
export let lastSaid = '';

async function play(name: string, delayMs: number, vol: number) {
  if (isMuted()) return;
  // 约好的是"从现在起多少毫秒"：第一次要先下载、解码，等下来的这段时间要从延迟里扣掉，不然话就晚了
  const due = performance.now() + delayMs;
  const buf = await load(name);
  const core = musicCore();
  if (!buf || !core || isMuted()) return;
  delayMs = Math.max(0, due - performance.now());
  const t0 = core.c.currentTime + delayMs / 1000;
  const src = core.c.createBufferSource();
  src.buffer = buf;
  const g = core.c.createGain();
  g.gain.value = vol;
  src.connect(g).connect(core.outAt(0));
  src.start(t0);
  lastSaid = name;
  if (typeof document !== 'undefined') document.documentElement.dataset.xqSaid = name;
  window.setTimeout(() => xqMusicDuck(0.4, buf.duration * 0.9), delayMs);
}

/** 喊一句（按设置的男声/女声；关掉了就不喊） */
export function xqShout(s: Shout, delayMs = 0) {
  const k = getVoiceKind();
  if (k === 'off') return;
  void play(`${k}-${s}`, delayMs, 0.95);
}

/** 出场人物的开场白（人物自己的嗓子；配音关掉了就不念） */
export function xqHeroLine(hero: string, delayMs = 0) {
  if (getVoiceKind() === 'off') return;
  void play(`hero-${hero}`, delayMs, 1);
}
