/**
 * 音准分析。产品的核心功能之一。
 *
 * 输出的不是一个「82 分」，而是四个能各自解释清楚的指标：
 *   音准   —— 平均偏了多少音分
 *   命中率 —— 有多少比例的时间落在容差内
 *   稳定性 —— 长音过程中音高漂不漂
 *   高音   —— 高音区单独拿出来看
 * 外加逐音复盘（绿/黄/红），点进去能看到「这个音你唱成了什么」。
 */

import type { PitchTrack } from '../dsp/pitch';
import { percentile } from '../dsp/pitch';
import { foldOctave, midiToName } from '../dsp/notes';
import type { IntonationReport, Metric, NoteLevel, NoteReview, RangeInfo, Reference } from './types';
import { NO_METRIC, medianOf, scoreByAnchors, stddev } from './types';

/** 容差：±50 音分（半个半音）。这是「听上去是这个音」的通行边界 */
export const TOLERANCE_CENTS = 50;
/** 偏差超过这个数就不是「不准」而是「唱成了别的音」 */
const WRONG_NOTE_CENTS = 150;
/** 计算平均偏差时的封顶，避免一个离谱的错音毁掉整体读数 */
const CLAMP_CENTS = 250;
/** 长音的门槛：短于这个的音谈不上「稳不稳」 */
const SUSTAIN_SEC = 0.45;

const ACCURACY_ANCHORS: [number, number][] = [
  [0, 100], [10, 96], [20, 89], [30, 81], [40, 73], [50, 66],
  [70, 54], [100, 40], [150, 24], [250, 6], [400, 0],
];
const STABILITY_ANCHORS: [number, number][] = [
  [0, 100], [8, 94], [15, 87], [25, 77], [35, 67], [50, 54],
  [75, 38], [110, 20], [180, 0],
];

/** 从整段轨迹统计音域 */
export function computeRange(track: PitchTrack): RangeInfo | null {
  const v = track.frames.filter((f) => f.voiced).map((f) => f.midi);
  if (v.length < 20) return null;
  // 用 2/98 分位而不是最值：极值几乎总是起音的滑音或破音的毛刺
  const lo = percentile(v, 0.02);
  const hi = percentile(v, 0.98);
  return {
    lo,
    hi,
    span: hi - lo,
    comfortLo: percentile(v, 0.1),
    comfortHi: percentile(v, 0.9),
    n: v.length,
  };
}

interface NoteEval {
  review: NoteReview;
  /** 该音符窗口内每帧的偏差（音分） */
  devs: number[];
  dur: number;
  targetMidi: number;
}

/** 逐个目标音评估 */
function evalNotes(track: PitchTrack, ref: Reference): NoteEval[] {
  const out: NoteEval[] = [];
  const frames = track.frames;
  let cursor = 0;

  ref.notes.forEach((rn, idx) => {
    // 掐掉起音的前一小段：起音几乎总是从下面滑上来的，
    // 算进去会让每个音都显得「偏低」，那是算法的锅不是用户的
    const skip = Math.min(0.08, rn.dur * 0.25);
    const from = rn.start + skip;
    const to = rn.start + rn.dur;

    while (cursor > 0 && frames[cursor - 1] && frames[cursor - 1].t >= from) cursor--;
    while (cursor < frames.length && frames[cursor].t < from) cursor++;

    const devs: number[] = [];
    const folded: number[] = [];
    let total = 0;
    for (let i = cursor; i < frames.length && frames[i].t < to; i++) {
      total++;
      if (!frames[i].voiced) continue;
      const fm = foldOctave(frames[i].midi, rn.midi);
      folded.push(fm);
      devs.push((fm - rn.midi) * 100);
    }

    const expected = Math.max(1, total);
    const coverage = devs.length / expected;
    const review: NoteReview = {
      ref: idx,
      start: rn.start,
      end: to,
      targetMidi: rn.midi,
      lyric: rn.lyric,
      section: rn.section,
      phrase: rn.phrase,
      sungMidi: null,
      cents: null,
      timing: null,
      hit: 0,
      level: 'miss',
      issues: [],
    };

    // 覆盖不到三成就是没唱（换气、走神、不会唱）
    if (coverage < 0.3 || devs.length < 3) {
      review.issues.push(coverage < 0.05 ? '这个音没出声' : '只唱到一点点就断了');
      out.push({ review, devs: [], dur: rn.dur, targetMidi: rn.midi });
      return;
    }

    const cents = medianOf(devs);
    const hit = devs.filter((d) => Math.abs(d) <= TOLERANCE_CENTS).length / devs.length;
    review.sungMidi = medianOf(folded);
    review.cents = cents;
    review.hit = hit;
    review.level = levelOf(cents, hit);
    review.issues = issuesOf(cents, hit, devs, rn.midi, review.sungMidi);
    out.push({ review, devs, dur: rn.dur, targetMidi: rn.midi });
  });

  return out;
}

function levelOf(cents: number, hit: number): NoteLevel {
  const a = Math.abs(cents);
  if (a > 70 || hit < 0.35) return 'red';
  if (a > 35 || hit < 0.7) return 'yellow';
  return 'green';
}

function issuesOf(cents: number, hit: number, devs: number[], target: number, sung: number): string[] {
  const out: string[] = [];
  const a = Math.abs(cents);
  if (a > WRONG_NOTE_CENTS) {
    out.push(`唱成了 ${midiToName(sung)}，目标是 ${midiToName(target)}`);
  } else if (a > 35) {
    out.push(`${cents > 0 ? '偏高' : '偏低'} ${Math.round(a)} 音分`);
  }
  const drift = stddev(devs);
  if (devs.length > 25 && drift > 45) out.push(`唱的过程中音高在飘（±${Math.round(drift)} 音分）`);
  if (hit < 0.5 && a <= 35) out.push('音高在容差边缘反复进出，不够稳');
  return out;
}

/** 汇总成音准报告 */
export function analyzeIntonation(track: PitchTrack, ref: Reference | null): IntonationReport {
  const range = computeRange(track);

  if (!ref || !ref.notes.length) {
    // 自由演唱：没有目标音高，就只能说音域和长音稳不稳
    return {
      accuracy: NO_METRIC('音分', '这次是自由演唱，没有目标旋律可比，不给音准分'),
      hitRate: NO_METRIC('%', '没有目标旋律，无法计算命中率'),
      stability: sustainStability(track),
      highNotes: NO_METRIC('音分', '没有目标旋律，无法单独评估高音区'),
      bias: null,
      range,
      notes: [],
    };
  }

  const evals = evalNotes(track, ref);
  const sung = evals.filter((e) => e.devs.length > 0);
  const notes = evals.map((e) => e.review);

  if (!sung.length) {
    return {
      accuracy: NO_METRIC('音分', '整首歌几乎没有检测到你的声音'),
      hitRate: NO_METRIC('%', '整首歌几乎没有检测到你的声音'),
      stability: NO_METRIC('音分', '整首歌几乎没有检测到你的声音'),
      highNotes: NO_METRIC('音分', '整首歌几乎没有检测到你的声音'),
      bias: null,
      range,
      notes,
    };
  }

  // ---- 音准：按时长加权的平均绝对偏差 ----
  let wSum = 0;
  let wTotal = 0;
  const allDevs: number[] = [];
  for (const e of sung) {
    const m = medianOf(e.devs.map((d) => Math.max(-CLAMP_CENTS, Math.min(CLAMP_CENTS, d))));
    wSum += Math.abs(m) * e.dur;
    wTotal += e.dur;
    allDevs.push(...e.devs);
  }
  const meanAbs = wTotal > 0 ? wSum / wTotal : 0;
  const wrong = sung.filter((e) => Math.abs(e.review.cents ?? 0) > WRONG_NOTE_CENTS).length;
  const accuracy: Metric = {
    score: scoreByAnchors(meanAbs, ACCURACY_ANCHORS),
    raw: Math.round(meanAbs),
    unit: '音分',
    n: sung.length,
    why:
      `${sung.length} 个音平均偏离目标 ${Math.round(meanAbs)} 音分` +
      `（100 音分 = 1 个半音）` +
      (wrong > 0 ? `，其中 ${wrong} 个音偏差超过半音以上，属于唱错音` : ''),
  };

  // ---- 命中率 ----
  const hitFrames = allDevs.filter((d) => Math.abs(d) <= TOLERANCE_CENTS).length;
  const hitRate: Metric = {
    score: Math.round((hitFrames / allDevs.length) * 100),
    raw: Math.round((hitFrames / allDevs.length) * 1000) / 10,
    unit: '%',
    n: allDevs.length,
    why: `发声的 ${(allDevs.length / 100).toFixed(1)} 秒里，有 ${((hitFrames / allDevs.length) * 100).toFixed(0)}% 的时间落在 ±${TOLERANCE_CENTS} 音分的容差内`,
  };

  // ---- 稳定性：长音内部的音高漂移 ----
  const sustained = sung.filter((e) => e.dur >= SUSTAIN_SEC && e.devs.length >= 30);
  let stability: Metric;
  if (sustained.length < 2) {
    stability = NO_METRIC('音分', `这首歌里够长的音（≥${SUSTAIN_SEC} 秒）不足 2 个，稳定性没法评`);
  } else {
    const drifts = sustained.map((e) => stddev(e.devs));
    const avg = drifts.reduce((a, b) => a + b, 0) / drifts.length;
    stability = {
      score: scoreByAnchors(avg, STABILITY_ANCHORS),
      raw: Math.round(avg),
      unit: '音分',
      n: sustained.length,
      why: `${sustained.length} 个长音，唱的过程中音高平均上下浮动 ±${Math.round(avg)} 音分`,
    };
  }

  // ---- 高音区 ----
  const pitches = ref.notes.map((n) => n.midi);
  const hiThresh = percentile(pitches, 0.8);
  const highs = sung.filter((e) => e.targetMidi >= hiThresh && e.targetMidi >= (range?.comfortHi ?? 0) - 2);
  let highNotes: Metric;
  if (highs.length < 3) {
    highNotes = NO_METRIC('音分', '这次唱到的高音太少（不足 3 个），高音稳定度先不评');
  } else {
    const hiDevs = highs.flatMap((e) => e.devs);
    const hiBias = medianOf(hiDevs);
    const hiDrift = stddev(hiDevs);
    // 高音看两件事：准不准 + 稳不稳，各占一半
    const s = Math.round(
      scoreByAnchors(Math.abs(hiBias), ACCURACY_ANCHORS) * 0.5 +
        scoreByAnchors(hiDrift, STABILITY_ANCHORS) * 0.5,
    );
    const top = Math.max(...highs.map((e) => e.targetMidi));
    highNotes = {
      score: s,
      raw: Math.round(hiBias),
      unit: '音分',
      n: highs.length,
      why:
        `最高的 ${highs.length} 个音（${midiToName(hiThresh)} 及以上，最高到 ${midiToName(top)}）` +
        `平均${hiBias < 0 ? '偏低' : '偏高'} ${Math.abs(Math.round(hiBias))} 音分，抖动 ±${Math.round(hiDrift)} 音分`,
    };
  }

  return {
    accuracy,
    hitRate,
    stability,
    highNotes,
    bias: Math.round(medianOf(allDevs)),
    range,
    notes,
  };
}

/** 自由演唱模式下的稳定性：拿最长的那些持续音来看 */
function sustainStability(track: PitchTrack): Metric {
  const frames = track.frames;
  const runs: number[][] = [];
  let cur: number[] = [];
  for (const f of frames) {
    if (f.voiced) cur.push(f.midi);
    else {
      if (cur.length >= 45) runs.push(cur);
      cur = [];
    }
  }
  if (cur.length >= 45) runs.push(cur);
  if (runs.length < 1) {
    return NO_METRIC('音分', '没有找到 0.45 秒以上的持续发声，稳定性没法评');
  }
  // 只看相对自身中位数的漂移，所以唱的是什么音无所谓
  const drifts = runs.map((r) => {
    const med = medianOf(r);
    return stddev(r.map((m) => (m - med) * 100));
  });
  const avg = drifts.reduce((a, b) => a + b, 0) / drifts.length;
  return {
    score: scoreByAnchors(avg, STABILITY_ANCHORS),
    raw: Math.round(avg),
    unit: '音分',
    n: runs.length,
    why: `${runs.length} 段持续发声，音高平均上下浮动 ±${Math.round(avg)} 音分`,
  };
}
