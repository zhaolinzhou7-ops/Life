/**
 * 牌局记录。
 *
 * 第一版存：日期、地主是谁、我是什么身份、胜负、倍数、完整出牌记录。
 * 出牌记录现在只用来看「战绩详情」，但格式是按**将来能完整回放**设计的
 * （每条都带轮次、座位、具体的牌），所以以后做复盘不用改存档格式。
 */
import type { GameResult, PlayRecord, Seat } from './game';

const KEY = 'doudizhu.records.v1';
const MAX_RECORDS = 60;

export interface GameRecord {
  /** 开局时间戳 */
  at: number;
  seed: number;
  /** 我坐哪 */
  mySeat: Seat;
  landlord: Seat;
  /** 我是不是地主 */
  iAmLandlord: boolean;
  names: [string, string, string];
  bidScore: number;
  multiplier: number;
  bombCount: number;
  spring: GameResult['spring'];
  winner: GameResult['winner'];
  /** 我这局的得分 */
  myScore: number;
  scores: [number, number, number];
  difficulty: string;
  /** 完整出牌记录，将来做回放用 */
  history: PlayRecord[];
}

export interface Stats {
  total: number;
  wins: number;
  landlordGames: number;
  landlordWins: number;
  farmerGames: number;
  farmerWins: number;
  net: number;
  bestStreak: number;
  currentStreak: number;
}

function read(): GameRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as GameRecord[];
    return Array.isArray(list) ? list : [];
  } catch {
    // 存档被写坏、隐私模式读不到——都不该让游戏打不开
    return [];
  }
}

function write(list: GameRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX_RECORDS)));
  } catch {
    // 配额满了就算了，记录丢了不影响玩
  }
}

export function loadRecords(): GameRecord[] {
  return read();
}

export function saveRecord(record: GameRecord): void {
  const list = read();
  list.unshift(record);
  write(list);
}

export function clearRecords(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* 同上 */
  }
}

export function computeStats(list: GameRecord[] = read()): Stats {
  let wins = 0;
  let landlordGames = 0;
  let landlordWins = 0;
  let net = 0;
  let bestStreak = 0;
  let currentStreak = 0;
  let running = 0;

  // list 是倒序（最新在前），算连胜要从最早的一局往后数
  for (const r of [...list].reverse()) {
    const won = r.iAmLandlord ? r.winner === 'landlord' : r.winner === 'farmers';
    if (won) {
      wins++;
      running++;
      bestStreak = Math.max(bestStreak, running);
    } else running = 0;
    if (r.iAmLandlord) {
      landlordGames++;
      if (won) landlordWins++;
    }
    net += r.myScore;
  }
  currentStreak = running;

  return {
    total: list.length,
    wins,
    landlordGames,
    landlordWins,
    farmerGames: list.length - landlordGames,
    farmerWins: wins - landlordWins,
    net,
    bestStreak,
    currentStreak,
  };
}

/** 设置项（难度、教学模式、倒计时）也存在本地 */
export interface Settings {
  difficulty: 'easy' | 'normal' | 'hard';
  /** 学习模式：显示 AI 的出牌理由和对我的建议 */
  coach: boolean;
  /** 出牌倒计时秒数，0 = 不限时 */
  clock: number;
  sound: boolean;
  animations: boolean;
  onAllPass: 'redeal' | 'random';
}

const SETTINGS_KEY = 'doudizhu.settings.v1';

export const DEFAULT_SETTINGS: Settings = {
  difficulty: 'normal',
  coach: false,
  clock: 30,
  sound: true,
  animations: true,
  onAllPass: 'redeal',
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* 存不进去也不影响这一局 */
  }
}
