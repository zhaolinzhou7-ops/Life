/**
 * 象棋配音：吃车、将军、绝杀（困毙）的喊声，出场人物的开场白。
 *
 * 终局再说一句（大获全胜、胜败乃兵家常事、握手言和）。
 *
 * 用户原话："出场、开局，以及吃子、将军、绝杀等关键节点，都要有浑厚的人声配音（男声或女声），比如喊出'将军'这种，
 * 不要只有电子打击音。"
 * 录音是离线生成好的（tools/gen-voice.py：开源语音合成念、处理成浑厚的喊声、再让语音识别把每一句听一遍对过字），
 * 放在 src/xiangqi/voice/，每句十几 KB；用到哪句才下载哪句，解码一次留着。
 * 走 gamesfx 的总线（同一个混响、同一个压缩），喊话时配乐让一让（xqMusicDuck）。
 *
 * 报着法（xqAnnounce）：每走一步念一声"炮二平五"——天天象棋这些软件的语音包，核心就是这个。
 * 九百多句整句念好的着法拼在一个长音频里（tools/gen-announce.py，一个嗓子两三 MB），旁边一份 json 记每句的起止；
 * 默认关着（只在关键几步喊）；样式页打开了、开第一盘棋时才下载。
 * 几句话排着队说：先报"车二进六"，再喊"将军！"，不会两句叠在一起（busyUntil）。
 */
import { isMuted, musicCore } from './gamesfx';
import { xqMusicDuck } from './xqmusic';

const FILES = import.meta.glob('./xiangqi/voice/*.mp3', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const INDEX = import.meta.glob('./xiangqi/voice/announce.json', { query: '?url', import: 'default', eager: true }) as Record<string, string>;
const urlOf = (name: string) => FILES[`./xiangqi/voice/${name}.mp3`];

/** 对局里喊的几句 */
export type Shout = 'jiangjun' | 'jiesha' | 'kunbi' | 'chiche' | 'win' | 'lose' | 'draw';
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
  preloadVoice((['jiangjun', 'jiesha', 'kunbi', 'chiche', 'win', 'lose', 'draw'] as Shout[]).map((s) => `${k}-${s}`));
}

/** 最近一次喊的是哪一句（测试看） */
export let lastSaid = '';

/** 排队：上一句说到什么时候（音频时钟）。新的一句最早从这里接着说 */
let busyUntil = 0;

/**
 * 说一句。seg：从长音频里切一段（报着法用）；maxLag：排队排到比约好的晚这么多毫秒就不说了
 * （报着法用——落了好几步还在念第一步，不如不念）
 */
async function play(name: string, delayMs: number, vol: number, seg?: [number, number], maxLag = Infinity, label = name) {
  if (isMuted()) return;
  // 约好的是"从现在起多少毫秒"：第一次要先下载、解码，等下来的这段时间要从延迟里扣掉，不然话就晚了
  const due = performance.now() + delayMs;
  const buf = await load(name);
  const core = musicCore();
  if (!buf || !core || isMuted()) return;
  // 报着法那份长音频第一次要下载两 MB：等下来已经晚了一秒多（对手可能都走了），这一句就不念了
  if (performance.now() - due > maxLag + 300) return;
  delayMs = Math.max(0, due - performance.now());
  const want = core.c.currentTime + delayMs / 1000;
  const t0 = Math.max(want, busyUntil + 0.06);
  if ((t0 - want) * 1000 > maxLag) return;
  // 切段两头各多让 40 毫秒（MP3 解码前头可能多出一小截，宁可带一点静音也不切掉字头）
  const off = seg ? Math.max(0, seg[0] - 0.04) : 0;
  const dur = seg ? seg[1] + 0.08 : buf.duration;
  busyUntil = t0 + dur - (seg ? 0.08 : 0.25);
  const src = core.c.createBufferSource();
  src.buffer = buf;
  const g = core.c.createGain();
  g.gain.value = vol * getVoiceVolume();
  src.connect(g).connect(core.outAt(0));
  if (seg) src.start(t0, off, dur);
  else src.start(t0);
  const lead = Math.max(0, (t0 - core.c.currentTime) * 1000);
  window.setTimeout(() => {
    lastSaid = label;
    if (typeof document !== 'undefined') document.documentElement.dataset.xqSaid = label;
    // 喊声、开场白压过一切：配乐压到两成（报着法只是念一声，压到四成）
    xqMusicDuck(seg ? 0.4 : 0.2, dur * 0.9);
  }, lead);
}

// ───────────────────────── 报着法 ─────────────────────────

const VOL_KEY = 'xq-vol-voice';
/** 配音音量 0～1（默认 1） */
export function getVoiceVolume(): number {
  try {
    const v = Number(localStorage.getItem(VOL_KEY) ?? 1);
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 1;
  } catch {
    return 1;
  }
}
export function setVoiceVolume(v: number) {
  try {
    localStorage.setItem(VOL_KEY, String(Math.max(0, Math.min(1, v))));
  } catch {
    /* 存不下就这一次有效 */
  }
}

const ANN_KEY = 'xq-announce';
/**
 * 报着法开没开。默认关：用户原话"不是每一步都要说话，就是关键的那几步"——
 * 平时只喊吃车、将军、绝杀；想听每一步记谱的，在样式页打开。配音选了"不要"就都不念
 */
export function getAnnounce(): boolean {
  try {
    return localStorage.getItem(ANN_KEY) === '1';
  } catch {
    return false;
  }
}
export function setAnnounce(on: boolean) {
  try {
    localStorage.setItem(ANN_KEY, on ? '1' : '0');
  } catch {
    /* 存不下就这一次有效 */
  }
}

interface AnnIndex {
  phrases: string[];
  m?: [number, number][];
  f?: [number, number][];
}
let annIndex: Promise<{ at: Map<string, number>; idx: AnnIndex } | null> | null = null;
function loadIndex() {
  if (annIndex) return annIndex;
  const url = INDEX['./xiangqi/voice/announce.json'];
  annIndex = url
    ? fetch(url)
        .then((r) => r.json() as Promise<AnnIndex>)
        .then((idx) => ({ idx, at: new Map(idx.phrases.map((p, i) => [p, i])) }))
        .catch(() => null)
    : Promise.resolve(null);
  return annIndex;
}

const CN = '零一二三四五六七八九';
/** 记谱 → 念法：黑方的阿拉伯数字也念一二三，"砲"念"炮" */
export const announceKey = (text: string) => text.replace(/[1-9]/g, (d) => CN[Number(d)]).replace('砲', '炮');

/** 开局时调一下：报着法那份长音频先下载、解码好 */
export function preloadAnnounce() {
  const k = getVoiceKind();
  if (k === 'off' || !getAnnounce()) return;
  void loadIndex();
  void load(`announce-${k}`);
}

/**
 * 念一步着法（"炮二平五"）。关了、静音、说不出来（没有这一句）都不念。
 * 对局里排队排晚了就不念了；wait：样式页上点了试听——第一次要等长音频下载完，等多久都念
 */
export function xqAnnounce(text: string, delayMs = 0, wait = false) {
  const k = getVoiceKind();
  if (k === 'off' || !getAnnounce() || isMuted()) return;
  void loadIndex().then((a) => {
    const i = a?.at.get(announceKey(text));
    const seg = i === undefined ? undefined : a!.idx[k]?.[i];
    if (seg) void play(`announce-${k}`, delayMs, 0.95, seg, wait ? Infinity : 900, `announce:${announceKey(text)}`);
  });
}

/** 喊一句（按设置的男声/女声；关掉了就不喊） */
export function xqShout(s: Shout, delayMs = 0) {
  const k = getVoiceKind();
  if (k === 'off') return;
  void play(`${k}-${s}`, delayMs, 1);
}

/** 出场人物的开场白（人物自己的嗓子；配音关掉了就不念） */
export function xqHeroLine(hero: string, delayMs = 0) {
  if (getVoiceKind() === 'off') return;
  void play(`hero-${hero}`, delayMs, 1);
}
