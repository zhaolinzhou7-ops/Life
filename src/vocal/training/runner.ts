/**
 * 训练执行器：把一条练习展开成一串「示范 → 你唱 → 评分」的步骤。
 *
 * 评分不另起炉灶——每一步都用和唱歌完全相同的那套分析代码
 * （trackPitch / segmentNotes / analyzeIntonation）。这样「练习里的音准」
 * 和「唱歌里的音准」是同一把尺子量出来的，闭环才成立：
 * 练习进步了，唱歌的分数才应该跟着动。
 */

import { trackPitch } from '../dsp/pitch';
import { midiToName } from '../dsp/notes';
import { analyzeIntonation } from '../analysis/intonation';
import { segmentNotes } from '../analysis/segment';
import { medianOf, stddev, type Reference, type RefNote } from '../analysis/types';
import { playClick, playTone, playGlide } from '../audio/synth';
import type { Anchor, Exercise } from './exercises';

export interface ExpectNote {
  midi: number;
  /** 相对「听音窗口开始」的秒数 */
  start: number;
  dur: number;
}

export interface StepDef {
  /** 屏幕正中显示的大字（目标音名 / 拍号） */
  big: string;
  /** 这一步要做什么 */
  label: string;
  kind: 'pitch' | 'rhythm';
  /** 播放示范；返回示范时长（秒） */
  demo: () => number;
  /** 示范结束后给多久让用户唱 */
  listenSec: number;
  expect: ExpectNote[];
}

export interface StepResult {
  score: number | null;
  /** 一句话讲清这一步的结果 */
  detail: string;
  /** 这一步唱到的最高音，用来画音域成长 */
  peakMidi: number | null;
  /** 是否唱得太吃力，建议停（高音类练习用） */
  shouldStop: boolean;
}

/** 声部：影响练习起始音。测过音域就用音域，没测过用这个粗分 */
export type VoiceType = 'low' | 'high';

/**
 * 决定练习从哪个音起。
 *
 * 关于 'bridge'：真正的换声点需要专业判断，录音测不了。
 * 这里用「舒适区上沿」作为一个可操作的近似，界面上也是这么写的——
 * 不会声称「我们测出了你的换声点」。
 */
export function anchorMidi(
  anchor: Anchor,
  range: { comfortLo: number; comfortHi: number } | null,
  voice: VoiceType,
): number {
  if (!range) {
    // 没有音域数据时的缺省：男声以 G3 为中，女声以 D4 为中
    const mid = voice === 'low' ? 55 : 62;
    return anchor === 'low' ? mid - 4 : anchor === 'high' || anchor === 'bridge' ? mid + 5 : mid;
  }
  const { comfortLo, comfortHi } = range;
  switch (anchor) {
    case 'low':
      return Math.round(comfortLo + 1);
    case 'high':
      return Math.round(comfortHi - 2);
    case 'bridge':
      return Math.round(comfortHi - 3);
    default:
      return Math.round((comfortLo + comfortHi) / 2);
  }
}

/** 把一条练习展开成步骤 */
export function buildSteps(ex: Exercise, base: number): StepDef[] {
  const run = ex.run;
  const steps: StepDef[] = [];

  switch (run.type) {
    case 'match': {
      for (const rel of run.rel) {
        const m = base + rel;
        steps.push({
          big: midiToName(m),
          label: '听完这个音，等它停了再唱出来',
          kind: 'pitch',
          demo: () => {
            playTone(m, 1.1, 0, 0.32);
            return 1.3;
          },
          listenSec: run.holdSec + 1.2,
          expect: [{ midi: m, start: 0.4, dur: run.holdSec }],
        });
      }
      break;
    }

    case 'scale': {
      for (let s = 0; s < run.steps; s++) {
        const root = base + s * run.dir;
        const notes = run.pattern.map((p) => root + p);
        const demoSec = notes.length * run.noteSec;
        steps.push({
          big: `${midiToName(root)} 起`,
          label: `跟着琴唱这条音型（第 ${s + 1} / ${run.steps} 轮）`,
          kind: 'pitch',
          demo: () => {
            notes.forEach((m, i) => playTone(m, run.noteSec * 0.85, i * run.noteSec, 0.26));
            return demoSec + 0.25;
          },
          listenSec: demoSec + 1.2,
          expect: notes.map((m, i) => ({
            midi: m,
            start: 0.35 + i * run.noteSec,
            dur: run.noteSec * 0.85,
          })),
        });
      }
      break;
    }

    case 'interval': {
      for (const iv of run.intervals) {
        const root = base;
        const target = base + iv;
        steps.push({
          big: midiToName(target),
          label: `先听主音 ${midiToName(root)}，再听目标音，然后把目标音唱出来`,
          kind: 'pitch',
          demo: () => {
            playTone(root, 0.8, 0, 0.3);
            playTone(target, 0.9, 0.95, 0.3);
            return 2.0;
          },
          listenSec: run.holdSec + 1.2,
          expect: [{ midi: target, start: 0.4, dur: run.holdSec }],
        });
      }
      break;
    }

    case 'glide': {
      const pts = run.shape.map((rel, i) => ({
        midi: base + rel,
        at: ((i + 1) / run.shape.length) * run.sec,
      }));
      steps.push({
        big: '跟着线唱',
        label: '用「呜」跟着这条线唱，让你的线贴住它',
        kind: 'pitch',
        demo: () => {
          playGlide(pts, 0.2);
          return run.sec + 0.3;
        },
        listenSec: run.sec + 0.8,
        expect: run.shape.map((rel, i) => ({
          midi: base + rel,
          start: (i / run.shape.length) * run.sec + 0.15,
          dur: (run.sec / run.shape.length) * 0.8,
        })),
      });
      break;
    }

    case 'sustain': {
      for (let i = 0; i < run.reps; i++) {
        // 半音上行类练习：每一轮升半音
        const m = base + run.rel + (run.anchor === 'bridge' ? i : 0);
        steps.push({
          big: midiToName(m),
          label: `撑满 ${run.sec} 秒，目标是一条又平又直的线（第 ${i + 1} / ${run.reps} 次）`,
          kind: 'pitch',
          demo: () => {
            playTone(m, 1.0, 0, 0.3);
            return 1.2;
          },
          listenSec: run.sec + 1.5,
          expect: [{ midi: m, start: 0.4, dur: run.sec }],
        });
      }
      break;
    }

    case 'metronome': {
      const spb = 60 / run.bpm;
      const n = run.beats;
      steps.push({
        big: `${run.bpm} BPM`,
        label: '听两小节，然后在每一拍上发一个「哒」',
        kind: 'rhythm',
        demo: () => {
          for (let b = 0; b < 8; b++) playClick(b * spb, b % 4 === 0);
          return 8 * spb;
        },
        listenSec: n * spb + 0.8,
        expect: Array.from({ length: n }, (_, i) => ({
          midi: base,
          start: i * spb,
          dur: spb * 0.4,
        })),
      });
      break;
    }

    case 'rhythmEcho': {
      const spb = 60 / run.bpm;
      for (const pat of run.patterns) {
        let t = 0;
        const onsets = pat.map((d) => {
          const s = t;
          t += d * spb;
          return { start: s, dur: d * spb * 0.6 };
        });
        const total = t;
        steps.push({
          big: pat.map((d) => (d >= 1 ? '—' : '·')).join(' '),
          label: '听这条节奏，空一小节，然后原样唱回来',
          kind: 'rhythm',
          demo: () => {
            for (const o of onsets) playClick(o.start, false);
            return total + 0.2;
          },
          // 示范后空一小节再开始听
          listenSec: total + 4 * spb + 0.6,
          expect: onsets.map((o) => ({ midi: base, start: o.start + 4 * spb, dur: o.dur })),
        });
      }
      break;
    }

    case 'entry': {
      const spb = 60 / run.bpm;
      for (let i = 0; i < run.reps; i++) {
        steps.push({
          big: '第 3 小节第 1 拍',
          label: `节拍器走两小节，第三小节的第一拍准点进（第 ${i + 1} / ${run.reps} 次）`,
          kind: 'rhythm',
          demo: () => {
            for (let b = 0; b < run.leadBeats; b++) playClick(b * spb, b % 4 === 0);
            return run.leadBeats * spb;
          },
          listenSec: 2.2,
          expect: [{ midi: base, start: 0, dur: spb * 0.6 }],
        });
      }
      break;
    }
  }

  return steps;
}

/** 把一步的期望应答包装成 Reference，好复用分析层 */
function stepReference(step: StepDef): Reference {
  const notes: RefNote[] = step.expect.map((e) => ({
    midi: e.midi,
    start: e.start,
    dur: e.dur,
    lyric: '',
    section: 0,
    phrase: 0,
  }));
  const end = notes.length ? notes[notes.length - 1].start + notes[notes.length - 1].dur : 1;
  return {
    id: 'exercise',
    title: '练习',
    bpm: null,
    // 练习里不做抢拍/拖拍的绝对判断，节奏类另有专门的算法（见 scoreStep）
    beatReliable: false,
    notes,
    playback: [],
    sections: [{ kind: 'verse', name: '练习', from: 0, to: notes.length, startSec: 0, endSec: end }],
    phrases: [{ from: 0, to: notes.length, text: '', startSec: 0, endSec: end }],
    transpose: 0,
    totalSec: end,
  };
}

/** 给一步打分 */
export function scoreStep(step: StepDef, samples: Float32Array, sampleRate: number): StepResult {
  const track = trackPitch(samples, sampleRate);
  const voiced = track.frames.filter((f) => f.voiced);
  const peakMidi = voiced.length ? Math.max(...voiced.map((f) => f.midi)) : null;

  if (voiced.length < 8) {
    return {
      score: null,
      detail: '这一次几乎没听到你的声音——离麦克风近一点，大声一些再来。',
      peakMidi: null,
      shouldStop: false,
    };
  }

  if (step.kind === 'rhythm') {
    const sung = segmentNotes(track);
    if (sung.length < Math.max(1, Math.floor(step.expect.length * 0.5))) {
      return {
        score: null,
        detail: `只检测到 ${sung.length} 个音，少于要求的 ${step.expect.length} 个。用短促有力的「哒」，别拖长。`,
        peakMidi,
        shouldStop: false,
      };
    }
    // 逐个配对，算「扣掉整体偏移之后」的一致性——这部分与设备延迟无关
    const offsets: number[] = [];
    const used = new Set<number>();
    for (const e of step.expect) {
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < sung.length; i++) {
        if (used.has(i)) continue;
        const d = sung[i].start - e.start;
        if (Math.abs(d) < Math.abs(bestD)) {
          best = i;
          bestD = d;
        }
      }
      if (best >= 0 && Math.abs(bestD) < 0.6) {
        used.add(best);
        offsets.push(bestD);
      }
    }
    if (offsets.length < 2) {
      return { score: null, detail: '对不上拍子——先跟着节拍器数几遍再试。', peakMidi, shouldStop: false };
    }
    const sys = medianOf(offsets);
    const adj = offsets.map((o) => o - sys);
    const sd = stddev(adj) * 1000;
    const score = Math.max(0, Math.min(100, Math.round(100 - sd * 0.55)));
    return {
      score,
      detail:
        `打中 ${offsets.length}/${step.expect.length} 拍，快慢的浮动是 ±${Math.round(sd)} 毫秒。` +
        (Math.abs(sys) > 0.12
          ? `整体${sys > 0 ? '偏晚' : '偏早'} ${Math.abs(Math.round(sys * 1000))} 毫秒——这里面也包含设备延迟，所以只看浮动那个数就好。`
          : ''),
      peakMidi,
      shouldStop: false,
    };
  }

  // 音高类：直接复用歌唱那套音准分析
  const ref = stepReference(step);
  const into = analyzeIntonation(track, ref);
  if (into.accuracy.score === null) {
    return {
      score: null,
      detail: into.accuracy.unavailable ?? '这次数据不够，再来一遍。',
      peakMidi,
      shouldStop: false,
    };
  }
  const acc = into.accuracy;
  const accScore = acc.score ?? 0;
  const stab = into.stability;
  // 音准占七成、稳定性占三成：唱得准但一直在飘，也不算练到位
  const score = Math.round(
    stab.score !== null ? accScore * 0.7 + stab.score * 0.3 : accScore,
  );
  const sungMid = medianOf(into.notes.filter((n) => n.cents !== null).map((n) => n.cents!));
  const dirTxt =
    Math.abs(sungMid) < 20 ? '基本唱在点上' : `整体${sungMid > 0 ? '偏高' : '偏低'} ${Math.abs(Math.round(sungMid))} 音分`;

  // 高音练习的停止信号：唱得明显吃力就该停，不该鼓励硬顶
  const shouldStop =
    score < 40 || (stab.raw !== null && stab.raw > 70) || (acc.raw !== null && acc.raw > 110);

  return {
    score,
    detail:
      `${dirTxt}；平均偏 ${acc.raw} 音分` +
      (stab.raw !== null ? `，音高浮动 ±${stab.raw} 音分` : '') +
      '。',
    peakMidi,
    shouldStop,
  };
}
