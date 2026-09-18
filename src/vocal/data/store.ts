/**
 * 本地存档。
 *
 * 隐私是这个文件的设计前提，不是附加功能：
 *   · 所有数据只存在这台设备上，没有服务器，没有账号；
 *   · **录音默认一律不保存**——唱完分析完，离开页面就没了。
 *     想留的用户要自己按「保存这次录音」，而且可以设定多久自动清掉；
 *   · 指标存档里不含音频，也不含逐帧轨迹，只有屏幕上显示过的那些数字；
 *   · 随时可以一键删除全部数据。
 */

import type { PerformanceReport } from '../analysis/types';
import { DEFAULT_CONFIG, type ProviderConfig } from '../ai/provider';
import type { VoiceType } from '../training/runner';
import type { SessionSummary } from './types';

const KEY_SETTINGS = 'vocal-settings';
const KEY_SESSIONS = 'vocal-sessions';
const KEY_REPORTS = 'vocal-reports';
const KEY_TRAINING = 'vocal-training';

/** 录音保留策略。默认 never——不保存 */
export type KeepAudio = 'never' | 'days7' | 'days30' | 'forever';

export const KEEP_AUDIO_LABEL: Record<KeepAudio, string> = {
  never: '不保存（推荐）',
  days7: '保留 7 天',
  days30: '保留 30 天',
  forever: '一直保留，直到我手动删除',
};

/** 跟唱时的提示强度 */
export type GuideLevel = 'novice' | 'normal' | 'exam';

export interface Settings {
  provider: ProviderConfig;
  /** 设备延迟校准值（毫秒） */
  latencyMs: number;
  /** 是否真的做过校准。没校准时节奏分析会拒绝下抢拍/拖拍的结论 */
  calibrated: boolean;
  keepAudio: KeepAudio;
  guideLevel: GuideLevel;
  /** 跟唱前奏是否打节拍 */
  leadClicks: boolean;
  /** 伴奏音量 0~1 */
  accompanimentVolume: number;
  /**
   * 粗略声部，只在还没测到音域时用来决定练习的起始音。
   * 唱过一次之后就以实测音域为准，这个值不再起作用。
   */
  voiceType: VoiceType | null;
}

export const DEFAULT_SETTINGS: Settings = {
  provider: { ...DEFAULT_CONFIG },
  latencyMs: 0,
  calibrated: false,
  keepAudio: 'never',
  guideLevel: 'novice',
  leadClicks: true,
  accompanimentVolume: 0.18,
  voiceType: null,
};

/** 保留最近多少次的完整报告（逐音复盘要用）。摘要则全部保留 */
const MAX_REPORTS = 20;
const MAX_SESSIONS = 300;

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // 隐私模式 / 数据损坏 / 存储被禁用
    return fallback;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- 设置

export function getSettings(): Settings {
  const s = read<Partial<Settings>>(KEY_SETTINGS, {});
  return {
    ...DEFAULT_SETTINGS,
    ...s,
    provider: { ...DEFAULT_SETTINGS.provider, ...(s.provider ?? {}) },
  };
}

export function saveSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  write(KEY_SETTINGS, next);
  return next;
}

// ---------------------------------------------------------------- 会话记录

export function getSessions(): SessionSummary[] {
  return read<SessionSummary[]>(KEY_SESSIONS, []);
}

/** 按时间倒序（最新在前） */
export function recentSessions(limit = 20): SessionSummary[] {
  return [...getSessions()].sort((a, b) => b.at - a.at).slice(0, limit);
}

export function addSession(s: SessionSummary): void {
  const all = getSessions();
  all.push(s);
  all.sort((a, b) => a.at - b.at);
  write(KEY_SESSIONS, all.slice(-MAX_SESSIONS));
}

/** 标记某次记录是否留存了录音。保存/删除录音后要同步，否则界面会出现「播放」但点了没声 */
export function setSessionAudioFlag(id: string, hasAudio: boolean): void {
  const all = getSessions();
  const t = all.find((s) => s.id === id);
  if (!t) return;
  t.hasAudio = hasAudio;
  write(KEY_SESSIONS, all);
}

export function getReport(id: string): PerformanceReport | null {
  const map = read<Record<string, PerformanceReport>>(KEY_REPORTS, {});
  return map[id] ?? null;
}

/** 存完整报告，只保留最近 MAX_REPORTS 份，老的自动丢弃 */
export function saveReport(id: string, report: PerformanceReport): void {
  const map = read<Record<string, PerformanceReport>>(KEY_REPORTS, {});
  map[id] = report;
  const ids = Object.keys(map).sort((a, b) => (map[a].at ?? 0) - (map[b].at ?? 0));
  while (ids.length > MAX_REPORTS) {
    const drop = ids.shift()!;
    delete map[drop];
  }
  if (!write(KEY_REPORTS, map)) {
    // 存不下就只留这一份，保证当前这次复盘能用
    write(KEY_REPORTS, { [id]: report });
  }
}

/** 某首歌的历次成绩（进步曲线用） */
export function sessionsOfSong(refId: string): SessionSummary[] {
  return getSessions()
    .filter((s) => s.refId === refId)
    .sort((a, b) => a.at - b.at);
}

// ---------------------------------------------------------------- 训练记录

export interface TrainingRecord {
  at: number;
  exerciseId: string;
  /** 完成度 0~1 */
  done: number;
  /** 本次得分（各练习自定义口径，0~100） */
  score: number | null;
  /** 这条练习里唱到的最高音（高音类用来画音域成长） */
  peakMidi: number | null;
  minutes: number;
}

export function getTraining(): TrainingRecord[] {
  return read<TrainingRecord[]>(KEY_TRAINING, []);
}

export function addTraining(rec: TrainingRecord): void {
  const all = getTraining();
  all.push(rec);
  write(KEY_TRAINING, all.slice(-500));
}

/** 今天已经练了多少分钟 */
export function todayMinutes(): number {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return getTraining()
    .filter((t) => t.at >= start.getTime())
    .reduce((a, b) => a + b.minutes, 0);
}

/** 连续练习天数 */
export function streakDays(): number {
  const days = new Set(
    [...getTraining().map((t) => t.at), ...getSessions().map((s) => s.at)].map((t) =>
      new Date(t).toLocaleDateString('sv'),
    ),
  );
  let streak = 0;
  const d = new Date();
  for (;;) {
    const key = d.toLocaleDateString('sv');
    if (!days.has(key)) {
      // 今天还没练不算断签，从昨天开始数
      if (streak === 0 && days.size) {
        d.setDate(d.getDate() - 1);
        if (days.has(d.toLocaleDateString('sv'))) continue;
      }
      break;
    }
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

// ---------------------------------------------------------------- 录音（IndexedDB）

const DB_NAME = 'vocal-audio';
const STORE = 'clips';

interface StoredClip {
  id: string;
  at: number;
  sampleRate: number;
  /** 16bit PCM，比 Float32 省一半空间，回放和复盘都够用 */
  pcm: ArrayBuffer;
  /**
   * 用户明确点了「保存这次录音」。
   * 这类录音不受保留策略影响——显式操作不该被默认设置悄悄推翻，
   * 要删得由用户自己来删。
   */
  pinned?: boolean;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('打不开本地数据库'));
  });
}

function toPcm16(samples: Float32Array): ArrayBuffer {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out.buffer;
}

function fromPcm16(buf: ArrayBuffer): Float32Array {
  const src = new Int16Array(buf);
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = src[i] / 0x8000;
  return out;
}

/**
 * 保存一段录音。
 * @param pinned true 表示这是用户手动点「保存」留下的，不受保留策略清理
 */
export async function saveAudio(
  id: string,
  samples: Float32Array,
  sampleRate: number,
  pinned = false,
): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const clip: StoredClip = { id, at: Date.now(), sampleRate, pcm: toPcm16(samples), pinned };
    tx.objectStore(STORE).put(clip);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('保存录音失败'));
  });
  db.close();
}

export async function loadAudio(id: string): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const db = await openDb();
  const clip = await new Promise<StoredClip | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve(req.result as StoredClip | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return clip ? { samples: fromPcm16(clip.pcm), sampleRate: clip.sampleRate } : null;
}

export async function deleteAudio(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
  db.close();
}

export async function listAudioIds(): Promise<{ id: string; at: number; bytes: number; pinned: boolean }[]> {
  try {
    const db = await openDb();
    const all = await new Promise<StoredClip[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result as StoredClip[]);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return all.map((c) => ({ id: c.id, at: c.at, bytes: c.pcm.byteLength, pinned: !!c.pinned }));
  } catch {
    return [];
  }
}

/**
 * 按保留策略清掉过期录音。每次进入应用时跑一次。
 * 这是「不需要时不长期保存」这条要求的执行点——不能只写在设置页面上。
 */
export async function pruneAudio(): Promise<number> {
  const { keepAudio } = getSettings();
  const clips = await listAudioIds();
  if (!clips.length) return 0;
  const days = keepAudio === 'days7' ? 7 : keepAudio === 'days30' ? 30 : null;
  let removed = 0;
  for (const c of clips) {
    if (c.pinned) continue; // 用户手动留下的，不动
    const expired =
      keepAudio === 'never' || (days !== null && Date.now() - c.at > days * 86400_000);
    if (expired) {
      await deleteAudio(c.id);
      removed++;
    }
  }
  if (removed) {
    // 存档里的 hasAudio 也要同步，否则界面会出现「播放」但点了没声
    const all = getSessions();
    const alive = new Set((await listAudioIds()).map((c) => c.id));
    for (const s of all) if (s.hasAudio && !alive.has(s.id)) s.hasAudio = false;
    write(KEY_SESSIONS, all);
  }
  return removed;
}

/** 一键清空所有本地数据 */
export async function wipeAll(): Promise<void> {
  for (const k of [KEY_SETTINGS, KEY_SESSIONS, KEY_REPORTS, KEY_TRAINING, 'vocal-curves']) {
    try {
      localStorage.removeItem(k);
    } catch {
      // 忽略
    }
  }
  try {
    const clips = await listAudioIds();
    for (const c of clips) await deleteAudio(c.id);
  } catch {
    // 忽略
  }
}

/** 删除单次记录（含它的录音） */
export async function deleteSession(id: string): Promise<void> {
  const all = getSessions().filter((s) => s.id !== id);
  write(KEY_SESSIONS, all);
  const map = read<Record<string, PerformanceReport>>(KEY_REPORTS, {});
  delete map[id];
  write(KEY_REPORTS, map);
  await deleteAudio(id);
}

/** 粗略统计本地占了多少空间，设置页面展示用 */
export async function storageUsage(): Promise<{ metricsKb: number; audioMb: number; clips: number }> {
  let metrics = 0;
  for (const k of [KEY_SETTINGS, KEY_SESSIONS, KEY_REPORTS, KEY_TRAINING, 'vocal-curves']) {
    try {
      metrics += (localStorage.getItem(k) ?? '').length;
    } catch {
      // 忽略
    }
  }
  const clips = await listAudioIds();
  const bytes = clips.reduce((a, c) => a + c.bytes, 0);
  return {
    metricsKb: Math.round(metrics / 1024),
    audioMb: Math.round((bytes / 1048576) * 10) / 10,
    clips: clips.length,
  };
}

// ---------------------------------------------------------------- 音高曲线

const KEY_CURVES = 'vocal-curves';
/** 曲线比报告更占地方，只留最近几次——够用来回看最近的练习就行 */
const MAX_CURVES = 8;

/**
 * 压缩过的音高曲线：[时间(厘秒), 音高(十分之一半音), ...] 交替存放。
 * 只存有声帧、每 30ms 取一个点，够画图又不会把 localStorage 撑爆。
 * 这不是录音——它是已经显示在分析页上的那条线，不含任何音频内容。
 */
export type PackedCurve = number[];

export function packCurve(frames: { t: number; midi: number; voiced: boolean }[]): PackedCurve {
  const out: PackedCurve = [];
  let lastT = -1;
  for (const f of frames) {
    if (!f.voiced) continue;
    if (f.t - lastT < 0.029) continue;
    lastT = f.t;
    out.push(Math.round(f.t * 100), Math.round(f.midi * 10));
  }
  return out;
}

export function unpackCurve(c: PackedCurve): { t: number; midi: number; voiced: boolean }[] {
  const out: { t: number; midi: number; voiced: boolean }[] = [];
  for (let i = 0; i + 1 < c.length; i += 2) {
    const t = c[i] / 100;
    // 相邻点间隔超过 0.1 秒说明中间断过，插一个静音点把线断开
    const prev = out[out.length - 1];
    if (prev && t - prev.t > 0.1) out.push({ t: prev.t + 0.001, midi: 0, voiced: false });
    out.push({ t, midi: c[i + 1] / 10, voiced: true });
  }
  return out;
}

export function saveCurve(id: string, curve: PackedCurve): void {
  const map = read<Record<string, { at: number; c: PackedCurve }>>(KEY_CURVES, {});
  map[id] = { at: Date.now(), c: curve };
  const ids = Object.keys(map).sort((a, b) => map[a].at - map[b].at);
  while (ids.length > MAX_CURVES) delete map[ids.shift()!];
  if (!write(KEY_CURVES, map)) write(KEY_CURVES, { [id]: { at: Date.now(), c: curve } });
}

export function getCurve(id: string): PackedCurve | null {
  return read<Record<string, { at: number; c: PackedCurve }>>(KEY_CURVES, {})[id]?.c ?? null;
}
