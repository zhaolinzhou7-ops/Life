/**
 * 表现分析（Performance Analysis 层）——把下面各层的结果拼成一份完整报告。
 *
 * 这一层的产出是**结构化事实**：哪些音偏了多少、哪些地方拖了拍、
 * 最突出的问题是什么。它不写教学语言，那是 AI 层的活儿。
 * 分层的好处是：换掉 AI 供应商、或者压根没有 AI，事实这部分都不变。
 */

import { trackPitch, type PitchTrack } from '../dsp/pitch';
import { extractFeatures, type AudioFeatures } from '../dsp/features';
import { midiToName } from '../dsp/notes';
import { segmentNotes, longestVoicedRun } from './segment';
import { analyzeIntonation } from './intonation';
import { analyzeRhythm } from './rhythm';
import { checkQuality } from './quality';
import type {
  Finding,
  PerformanceReport,
  Reference,
  SungNote,
} from './types';
import { medianOf } from './types';

/** 分析结果：report 可以存档，track/sung 太大只留在内存里给界面画图用 */
export interface AnalysisResult {
  report: PerformanceReport;
  track: PitchTrack;
  sung: SungNote[];
  features: AudioFeatures;
}

export interface AnalyzeOptions {
  mode?: 'song' | 'free' | 'exercise';
  /** 已校准的设备延迟（秒） */
  latency?: number;
  /** 用户是否做过延迟校准 */
  calibrated?: boolean;
}

export function analyzePerformance(
  samples: Float32Array,
  sampleRate: number,
  ref: Reference | null,
  opts: AnalyzeOptions = {},
): AnalysisResult {
  const mode = opts.mode ?? (ref ? 'song' : 'free');
  const track = trackPitch(samples, sampleRate);
  const features = extractFeatures(samples, sampleRate, track);
  const quality = checkQuality(features, mode);
  const sung = segmentNotes(track);
  const intonation = analyzeIntonation(track, ref);
  const rhythm = analyzeRhythm(sung, ref, { latency: opts.latency, calibrated: opts.calibrated });

  // 把入拍偏差写回逐音复盘，并让「拍子差太多」也能把一个音判成黄/红
  if (ref) {
    for (const nr of intonation.notes) {
      const off = rhythm.offsets[nr.ref];
      if (off === null || off === undefined) continue;
      const adj = off - rhythm.systematicOffset;
      nr.timing = adj;
      const ms = Math.round(Math.abs(adj) * 1000);
      if (Math.abs(adj) > 0.35) {
        nr.issues.push(`起音${adj > 0 ? '晚' : '早'}了 ${ms} 毫秒`);
        if (nr.level === 'green' || nr.level === 'yellow') nr.level = 'red';
      } else if (Math.abs(adj) > 0.18) {
        nr.issues.push(`起音${adj > 0 ? '偏晚' : '偏早'} ${ms} 毫秒`);
        if (nr.level === 'green') nr.level = 'yellow';
      }
    }
  }

  const sections = summarizeSections(ref, intonation.notes);
  const findings = buildFindings(intonation, rhythm, features, ref, track);
  const overall = overallScore(intonation, rhythm);

  const report: PerformanceReport = {
    at: Date.now(),
    mode,
    refId: ref?.id ?? null,
    refTitle: ref?.title ?? '自由演唱',
    transpose: ref?.transpose ?? 0,
    duration: track.duration,
    quality,
    intonation,
    rhythm: ref ? rhythm : null,
    voice: {
      dynamicRangeDb: Math.round(features.dynamicRangeDb * 10) / 10,
      meanDb: Math.round(features.meanDb * 10) / 10,
      centroidHz: Math.round(features.centroidHz),
      flatness: Math.round(features.flatness * 1000) / 1000,
      jitterPct: Math.round(features.jitterPct * 100) / 100,
      shimmerPct: Math.round(features.shimmerPct * 100) / 100,
      perturbationBasisSec: Math.round(features.perturbationBasisSec * 10) / 10,
      snrDb: Math.round(features.snrDb),
      longestNoteSec: Math.round(longestVoicedRun(track) * 10) / 10,
    },
    overall,
    sections,
    findings,
  };

  return { report, track, sung, features };
}

/** 综合分：各维度加权，只对「评得出来」的维度求平均 */
function overallScore(
  intonation: PerformanceReport['intonation'],
  rhythm: PerformanceReport['rhythm'],
): number | null {
  if (intonation.accuracy.score === null) return null;
  const parts: [number | null, number][] = [
    [intonation.accuracy.score, 0.34],
    [intonation.hitRate.score, 0.2],
    [intonation.stability.score, 0.18],
    [rhythm?.timing.score ?? null, 0.16],
    [intonation.highNotes.score, 0.12],
  ];
  let sum = 0;
  let w = 0;
  for (const [s, weight] of parts) {
    if (s === null) continue;
    sum += s * weight;
    w += weight;
  }
  return w > 0 ? Math.round(sum / w) : null;
}

function summarizeSections(
  ref: Reference | null,
  notes: PerformanceReport['intonation']['notes'],
): PerformanceReport['sections'] {
  if (!ref) return [];
  return ref.sections.map((sec, si) => {
    const mine = notes.filter((n) => n.section === si && n.cents !== null);
    if (!mine.length) {
      return { kind: sec.kind, name: sec.name, accuracy: null, hitRate: null, worstNote: null };
    }
    const acc = mine.reduce((a, n) => a + Math.abs(n.cents!), 0) / mine.length;
    const hit = mine.reduce((a, n) => a + n.hit, 0) / mine.length;
    let worst: number | null = null;
    let worstV = -1;
    for (const n of mine) {
      const v = Math.abs(n.cents!);
      if (v > worstV) {
        worstV = v;
        worst = n.ref;
      }
    }
    return {
      kind: sec.kind,
      name: sec.name,
      accuracy: Math.round(acc),
      hitRate: Math.round(hit * 100),
      worstNote: worst,
    };
  });
}

/**
 * 找出这次演唱最突出的问题，按严重度排序。
 *
 * 这是整个产品最关键的一步：AI 层和训练推荐都建立在它上面。
 * 每条 finding 都必须带着具体数字和具体位置——
 * 「你音准不太好」不是 finding，「副歌那四个高音平均低了 61 音分」才是。
 */
function buildFindings(
  intonation: PerformanceReport['intonation'],
  rhythm: PerformanceReport['rhythm'],
  features: AudioFeatures,
  ref: Reference | null,
  track: PitchTrack,
): Finding[] {
  const out: Finding[] = [];
  const notes = intonation.notes;
  const sungNotes = notes.filter((n) => n.cents !== null);

  // ---- 系统性偏高/偏低 ----
  if (sungNotes.length >= 6 && intonation.bias !== null && Math.abs(intonation.bias) > 22) {
    const sign = intonation.bias < 0 ? -1 : 1;
    const same = sungNotes.filter((n) => Math.sign(n.cents!) === sign).length;
    const ratio = same / sungNotes.length;
    if (ratio > 0.6) {
      const flat = sign < 0;
      out.push({
        kind: flat ? 'flat' : 'sharp',
        severity: Math.min(1, Math.abs(intonation.bias) / 90),
        title: `整体${flat ? '偏低' : '偏高'} ${Math.abs(intonation.bias)} 音分`,
        evidence: `${sungNotes.length} 个音里有 ${same} 个（${Math.round(ratio * 100)}%）都${flat ? '低' : '高'}于目标，说明这不是偶然跑调，是稳定地整体${flat ? '压' : '顶'}着唱。`,
        refs: sungNotes.filter((n) => Math.sign(n.cents!) === sign).slice(0, 8).map((n) => n.ref),
      });
    }
  }

  // ---- 高音区偏低（最常见也最要紧的问题） ----
  const hi = intonation.highNotes;
  if (hi.score !== null && hi.raw !== null && hi.raw < -30) {
    const hiNotes = ref
      ? notes.filter((n) => n.cents !== null && n.cents < -30 && n.targetMidi >= (intonation.range?.comfortHi ?? 0) - 2)
      : [];
    out.push({
      kind: 'highNoteFlat',
      severity: Math.min(1, Math.abs(hi.raw) / 100 + 0.25),
      title: `高音区平均低了 ${Math.abs(hi.raw)} 音分`,
      evidence: hi.why,
      refs: hiNotes.slice(0, 8).map((n) => n.ref),
    });
  }

  // ---- 长音飘 ----
  if (intonation.stability.raw !== null && intonation.stability.raw > 32) {
    const drifty = notes.filter((n) => n.issues.some((s) => s.includes('在飘')));
    out.push({
      kind: 'unstableLongNote',
      severity: Math.min(1, intonation.stability.raw / 110),
      title: `长音撑不住，音高平均飘 ±${intonation.stability.raw} 音分`,
      evidence: intonation.stability.why,
      refs: drifty.slice(0, 6).map((n) => n.ref),
    });
  }

  // ---- 漏唱 ----
  if (notes.length >= 8) {
    const missed = notes.filter((n) => n.level === 'miss');
    if (missed.length > notes.length * 0.15) {
      out.push({
        kind: 'miss',
        severity: Math.min(1, missed.length / notes.length + 0.2),
        title: `有 ${missed.length} 个音（占 ${Math.round((missed.length / notes.length) * 100)}%）没唱出来`,
        evidence: `这些位置要么没出声，要么只出了一点声就断了。常见原因是不熟歌、换气点没安排好，或者音太高够不着。`,
        refs: missed.slice(0, 8).map((n) => n.ref),
      });
    }
  }

  // ---- 节奏 ----
  if (rhythm && !rhythm.degraded && rhythm.timing.score !== null) {
    const total = rhythm.rushCount + rhythm.dragCount + rhythm.onTimeCount;
    // 抢拍/拖拍是绝对结论，分不清设备延迟时就不下结论（见 rhythm.ts）
    if (!rhythm.absoluteTrustworthy) {
      // 什么都不报，notice 已经在报告里说明了原因
    } else if (total > 0 && rhythm.dragCount > total * 0.35 && rhythm.dragCount >= 3) {
      out.push({
        kind: 'drag',
        severity: Math.min(1, rhythm.dragCount / total + 0.1),
        title: `${rhythm.dragCount}/${total} 个音起拍偏晚（拖拍）`,
        evidence: rhythm.timing.why,
        refs: lateRefs(rhythm, +1),
      });
    } else if (total > 0 && rhythm.rushCount > total * 0.35 && rhythm.rushCount >= 3) {
      out.push({
        kind: 'rush',
        severity: Math.min(1, rhythm.rushCount / total + 0.1),
        title: `${rhythm.rushCount}/${total} 个音起拍偏早（抢拍）`,
        evidence: rhythm.timing.why,
        refs: lateRefs(rhythm, -1),
      });
    }
    if (rhythm.steadiness.raw !== null && rhythm.steadiness.raw > 70) {
      out.push({
        kind: 'unsteady',
        severity: Math.min(1, rhythm.steadiness.raw / 260),
        title: `节奏忽快忽慢，入拍偏差离散度 ±${rhythm.steadiness.raw} 毫秒`,
        evidence: rhythm.steadiness.why,
        refs: [],
      });
    }
  }

  // ---- 音域够不着 ----
  //
  // 这里很容易写出一个假阳性：拿「歌里最高的几个音」去比「用户音域的 90 分位」，
  // 那必然恒成立——唱得再好也会被告知「超出你的音域」。
  // 真正的证据只有两种：① 你从头到尾就没发出过那么高的音；
  // ② 那些高音你唱了，但唱塌了（漏唱或明显偏低）。
  if (ref && intonation.range) {
    const unreached = ref.notes.filter((n) => n.midi > intonation.range!.hi + 1);
    const struggled = notes.filter(
      (n) =>
        n.targetMidi >= intonation.range!.comfortHi - 1 &&
        (n.level === 'miss' || (n.cents !== null && n.cents < -70)),
    );
    if (unreached.length >= 3 || struggled.length >= 3) {
      const top = Math.max(...ref.notes.map((n) => n.midi));
      const why =
        unreached.length >= 3
          ? `这首歌有 ${unreached.length} 个音高过你这次唱到的最高音 ${midiToName(intonation.range.hi)}，你一次都没够上去。`
          : `${midiToName(intonation.range.comfortHi)} 往上的音里有 ${struggled.length} 个没唱住（漏掉或明显偏低）。`;
      out.push({
        kind: 'rangeLimit',
        severity: Math.min(0.85, Math.max(unreached.length, struggled.length) / Math.max(6, ref.notes.length) + 0.35),
        title: `这首歌的高音超出了你目前够得着的范围`,
        evidence:
          `${why}你这次的舒适音域是 ${midiToName(intonation.range.comfortLo)}~${midiToName(intonation.range.comfortHi)}，` +
          `这首歌最高到 ${midiToName(top)}。硬顶容易费嗓，先降 2~4 个半音唱熟，再慢慢往上挪。`,
        refs: struggled.slice(0, 8).map((n) => n.ref),
      });
    }
  }

  // ---- 力度从头到尾一个样 ----
  if (features.voicedSec > 8 && features.dynamicRangeDb > 0 && features.dynamicRangeDb < 5.5) {
    out.push({
      kind: 'dynamicsFlat',
      severity: 0.3,
      title: `音量几乎没有变化（动态范围只有 ${features.dynamicRangeDb.toFixed(1)} dB）`,
      evidence:
        `从头到尾都是一个力度。这不影响音准分，但会让整首歌听起来很平。` +
        `注意：这是音量的客观统计，不代表「没有感情」——感情不是算法能测的东西。`,
      refs: [],
    });
  }

  out.sort((a, b) => b.severity - a.severity);

  if (!out.length) {
    const voiced = track.frames.filter((f) => f.voiced).length;
    out.push({
      kind: 'clean',
      severity: 0,
      title: '这次没有发现明显问题',
      evidence:
        intonation.accuracy.score !== null
          ? `平均偏差 ${intonation.accuracy.raw} 音分，命中率 ${intonation.hitRate.raw}%，长音也稳。可以试试更难的歌或者更高的调。`
          : `检测到 ${(voiced / 100).toFixed(1)} 秒发声，各项指标都没有触发告警。`,
      refs: [],
    });
  }
  return out;
}

/** 取偏晚（dir=+1）或偏早（dir=-1）最严重的那几个音，供界面高亮 */
function lateRefs(rhythm: NonNullable<PerformanceReport['rhythm']>, dir: number): number[] {
  const items: { i: number; v: number }[] = [];
  rhythm.offsets.forEach((o, i) => {
    if (o === null) return;
    const adj = (o - rhythm.systematicOffset) * dir;
    if (adj > 0.06) items.push({ i, v: adj });
  });
  items.sort((a, b) => b.v - a.v);
  return items.slice(0, 8).map((x) => x.i);
}

/** 给界面用的小工具：这次演唱里最值得点开看的红色位置 */
export function worstNotes(report: PerformanceReport, limit = 5): number[] {
  const scored = report.intonation.notes
    .filter((n) => n.level === 'red' || n.level === 'miss')
    .map((n) => ({ i: n.ref, v: n.cents === null ? 999 : Math.abs(n.cents) }));
  scored.sort((a, b) => b.v - a.v);
  return scored.slice(0, limit).map((x) => x.i);
}

/** 中位数在报告里也用得上，顺手导出，免得各处重复实现 */
export { medianOf };
