/** 存档用的数据结构。单独一个文件，避免 data 层和 ai 层互相 import 成环。 */

import type { PerformanceReport } from '../analysis/types';

/** 一次演唱/训练的摘要。只存指标，不存录音，也不存逐帧轨迹 */
export interface SessionSummary {
  id: string;
  at: number;
  mode: 'song' | 'free' | 'exercise';
  refId: string | null;
  title: string;
  transpose: number;
  durationSec: number;
  overall: number | null;
  accuracy: number | null;
  hitRate: number | null;
  stability: number | null;
  rhythm: number | null;
  highNotes: number | null;
  rangeLo: number | null;
  rangeHi: number | null;
  /** 舒适音域（去掉最极端 10% 后的范围），比绝对音域更能代表可用音域 */
  comfortLo: number | null;
  comfortHi: number | null;
  longestNoteSec: number;
  dynamicRangeDb: number;
  /** 本次最突出问题的类型，用于统计「常见问题」 */
  topFinding: string | null;
  topFindingTitle: string | null;
  /** 是否留存了录音（录音单独存 IndexedDB，默认不留） */
  hasAudio: boolean;
}

export function summarize(r: PerformanceReport, id: string, hasAudio: boolean): SessionSummary {
  return {
    id,
    at: r.at,
    mode: r.mode,
    refId: r.refId,
    title: r.refTitle,
    transpose: r.transpose,
    durationSec: Math.round(r.duration * 10) / 10,
    overall: r.overall,
    accuracy: r.intonation.accuracy.score,
    hitRate: r.intonation.hitRate.score,
    stability: r.intonation.stability.score,
    rhythm: r.rhythm?.timing.score ?? null,
    highNotes: r.intonation.highNotes.score,
    rangeLo: r.intonation.range?.lo ?? null,
    rangeHi: r.intonation.range?.hi ?? null,
    comfortLo: r.intonation.range?.comfortLo ?? null,
    comfortHi: r.intonation.range?.comfortHi ?? null,
    longestNoteSec: r.voice.longestNoteSec,
    dynamicRangeDb: r.voice.dynamicRangeDb,
    topFinding: r.findings[0]?.kind ?? null,
    topFindingTitle: r.findings[0]?.title ?? null,
    hasAudio,
  };
}
