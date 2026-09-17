/**
 * 把连续的音高轨迹切成一个个「唱出来的音」。
 *
 * 为什么需要切：节奏分析要知道每个音是什么时候起的，
 * 长音稳定性要知道哪一段是同一个音。光有逐帧音高是不够的。
 *
 * 切法是变点检测：在一段连续发声里，如果音高相对当前段的中位数
 * 持续偏离超过阈值若干帧，就认为换音了。用「持续若干帧」而不是
 * 「单帧超阈值」，是因为颤音和滑音会让单帧频繁越界。
 */

import type { PitchTrack } from '../dsp/pitch';
import type { SungNote } from './types';
import { medianOf, stddev } from './types';

/** 认定「换了一个音」的音高变化（半音） */
const CHANGE = 0.9;
/** 需要连续超阈值多少帧才确认换音（帧移 10ms → 5 帧 = 50ms） */
const CONFIRM = 5;
/** 短于这个时长的段丢弃（秒）——多半是滑音的中间态或咳嗽 */
const MIN_DUR = 0.07;

export function segmentNotes(track: PitchTrack): SungNote[] {
  const f = track.frames;
  const out: SungNote[] = [];

  let i = 0;
  while (i < f.length) {
    if (!f[i].voiced) {
      i++;
      continue;
    }
    // 找到这一整段连续发声
    let end = i;
    while (end < f.length && f[end].voiced) end++;
    splitRun(f, i, end, track.hop, out);
    i = end;
  }
  return out;
}

/** 在一段连续发声里做变点切分 */
function splitRun(
  f: PitchTrack['frames'],
  from: number,
  to: number,
  hop: number,
  out: SungNote[],
): void {
  let segStart = from;
  const buf: number[] = [];
  let pending = 0;

  const flush = (endIdx: number) => {
    if (endIdx - segStart < Math.round(MIN_DUR / hop)) return;
    out.push(makeNote(f, segStart, endIdx));
  };

  for (let i = from; i < to; i++) {
    const m = f[i].midi;
    if (buf.length < CONFIRM) {
      buf.push(m);
      continue;
    }
    // 拿最近 20 帧（200ms）的中位数当这一段的当前音高，比整段均值跟得上转调
    const ref = medianOf(buf.slice(-20));
    if (Math.abs(m - ref) > CHANGE) {
      pending++;
      if (pending >= CONFIRM) {
        // 变点回退到刚开始偏离的地方
        const cut = i - CONFIRM + 1;
        flush(cut);
        segStart = cut;
        buf.length = 0;
        pending = 0;
        for (let k = cut; k <= i; k++) buf.push(f[k].midi);
      }
    } else {
      pending = 0;
      buf.push(m);
    }
  }
  flush(to);
}

function makeNote(f: PitchTrack['frames'], from: number, to: number): SungNote {
  const vals: number[] = [];
  const rms: number[] = [];
  for (let i = from; i < to; i++) {
    vals.push(f[i].midi);
    rms.push(f[i].rms);
  }
  // 音高取「稳定段」的中位数：掐掉起音的前 25%，
  // 因为起音那一下几乎总是从下面滑上来的，会把整个音的读数拉低
  const skip = Math.min(vals.length - 1, Math.max(1, Math.floor(vals.length * 0.25)));
  const body = vals.slice(skip);
  return {
    start: f[from].t,
    end: f[to - 1].t,
    midi: medianOf(body.length ? body : vals),
    onsetMidi: medianOf(vals.slice(0, Math.min(6, vals.length))),
    sd: stddev(body.length > 2 ? body : vals),
    rms: rms.reduce((a, b) => a + b, 0) / Math.max(1, rms.length),
  };
}

/** 最长一个连续发声段有多久（秒）——长音持续能力的可观测代理指标 */
export function longestVoicedRun(track: PitchTrack): number {
  let best = 0;
  let cur = 0;
  for (const f of track.frames) {
    if (f.voiced) {
      cur += track.hop;
      if (cur > best) best = cur;
    } else cur = 0;
  }
  return best;
}
