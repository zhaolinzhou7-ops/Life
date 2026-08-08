/** 唱歌应用的本地存档：音域、每首歌最高分、声控小鸟最高分 */

const KEY = 'sing-save';

export interface VoiceRange {
  lo: number; // 最低 MIDI
  hi: number; // 最高 MIDI
}

export interface BestScore {
  score: number; // 0~100
  stars: number; // 0~3
}

/** 高音训练营的进度 */
export interface CoachProgress {
  /** 进行到第几天（1~30） */
  day: number;
  /** 已完成的天 */
  done: number[];
  /** 最后一次完成训练的日期 YYYY-MM-DD */
  lastDate: string;
  /** 连续打卡天数 */
  streak: number;
  /** 每次训练记录下的当日最高音（音域成长曲线） */
  peaks: { d: string; midi: number }[];
  /** 换声点（第一次破音/变虚的位置），训练营会围绕它安排起始音 */
  bridge?: number;
  /** 声部：low=偏男声，high=偏女声。影响练习起始音 */
  voice?: 'low' | 'high';
}

interface SaveData {
  range?: VoiceRange;
  best: Record<string, BestScore>;
  birdBest: number;
  keys: Record<string, number>; // 每首歌记住的移调
  coach: CoachProgress;
}

const EMPTY_COACH: CoachProgress = { day: 1, done: [], lastDate: '', streak: 0, peaks: [] };

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      return {
        range: d.range,
        best: d.best ?? {},
        birdBest: d.birdBest ?? 0,
        keys: d.keys ?? {},
        coach: { ...EMPTY_COACH, ...(d.coach ?? {}) },
      };
    }
  } catch {
    // 隐私模式或数据损坏时忽略
  }
  return { best: {}, birdBest: 0, keys: {}, coach: { ...EMPTY_COACH } };
}

function store(d: SaveData) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    // 写入失败忽略
  }
}

export function getRange(): VoiceRange | null {
  return load().range ?? null;
}

export function setRange(r: VoiceRange) {
  const d = load();
  d.range = r;
  store(d);
}

export function getBest(songId: string): BestScore | null {
  return load().best[songId] ?? null;
}

/** 记录成绩，返回是否刷新纪录 */
export function setBest(songId: string, score: number, stars: number): boolean {
  const d = load();
  const old = d.best[songId];
  if (old && old.score >= score) return false;
  d.best[songId] = { score, stars };
  store(d);
  return true;
}

/** 全部歌曲的累计成绩（主页成就展示用） */
export function getTotals(): { stars: number; sung: number } {
  const d = load();
  let stars = 0;
  let sung = 0;
  for (const id in d.best) {
    sung++;
    stars += d.best[id].stars;
  }
  return { stars, sung };
}

/** 上次为这首歌选的调（没记录返回 null） */
export function getSongKey(songId: string): number | null {
  return load().keys[songId] ?? null;
}

export function setSongKey(songId: string, key: number) {
  const d = load();
  d.keys[songId] = key;
  store(d);
}

// ---------- 高音训练营 ----------

const today = () => new Date().toLocaleDateString('sv');

export function getCoach(): CoachProgress {
  return load().coach;
}

export function setVoiceType(voice: 'low' | 'high') {
  const d = load();
  d.coach.voice = voice;
  store(d);
}

export function setBridge(midi: number) {
  const d = load();
  d.coach.bridge = midi;
  store(d);
}

/** 完成一天的训练：推进进度、记录连续天数与当日最高音 */
export function completeDay(day: number, peakMidi: number): CoachProgress {
  const d = load();
  const c = d.coach;
  const t = today();
  if (!c.done.includes(day)) c.done.push(day);
  // 连续打卡：昨天练过就 +1，否则重新计数（同一天重复练不重复加）
  if (c.lastDate !== t) {
    const y = new Date(Date.now() - 86400000).toLocaleDateString('sv');
    c.streak = c.lastDate === y ? c.streak + 1 : 1;
    c.lastDate = t;
  }
  c.day = Math.min(30, Math.max(c.day, day + 1));
  if (peakMidi > 0) {
    const last = c.peaks[c.peaks.length - 1];
    // 同一天只保留当天最高的那个
    if (last && last.d === t) last.midi = Math.max(last.midi, peakMidi);
    else c.peaks.push({ d: t, midi: peakMidi });
    if (c.peaks.length > 60) c.peaks.shift();
  }
  store(d);
  return c;
}

/** 历史最高音（用于「比第一天高了几个音」） */
export function peakStats(): { first: number; best: number; latest: number } {
  const p = load().coach.peaks;
  if (!p.length) return { first: 0, best: 0, latest: 0 };
  return {
    first: p[0].midi,
    best: p.reduce((a, b) => Math.max(a, b.midi), 0),
    latest: p[p.length - 1].midi,
  };
}

export function getBirdBest(): number {
  return load().birdBest;
}

export function setBirdBest(score: number): boolean {
  const d = load();
  if (score <= d.birdBest) return false;
  d.birdBest = score;
  store(d);
  return true;
}
