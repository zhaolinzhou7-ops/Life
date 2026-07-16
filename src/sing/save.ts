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

interface SaveData {
  range?: VoiceRange;
  best: Record<string, BestScore>;
  birdBest: number;
}

function load(): SaveData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<SaveData>;
      return { range: d.range, best: d.best ?? {}, birdBest: d.birdBest ?? 0 };
    }
  } catch {
    // 隐私模式或数据损坏时忽略
  }
  return { best: {}, birdBest: 0 };
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
