/**
 * 可视化。
 *
 * 最重要的一张图是「目标音高 vs 实际音高」——产品需求里画的那个示意图。
 * 它要做到的事只有一件：让一个完全不懂音乐的人**一眼**看出
 * 自己是唱高了还是唱低了，以及高/低在哪一句。
 *
 * 所以配色只做一件事：按偏差上色。绿=准、黄=有点偏、红=明显偏。
 * 不加发光、不加渐变、不加装饰性动画——那些只会让曲线更难读。
 */

import { midiToName } from '../dsp/notes';
import type { PitchFrame } from '../dsp/pitch';
import type { NoteReview, Reference } from '../analysis/types';
import type { View } from './components';

const C = {
  bg: '#181d25',
  grid: '#232b36',
  gridStrong: '#2f3947',
  label: '#667283',
  target: '#6b7a8d',
  targetFill: 'rgba(107,122,141,0.22)',
  green: '#35c46b',
  yellow: '#edb443',
  red: '#f05a4f',
  accent: '#4d9fff',
  text: '#e9edf3',
};

/** 偏差（音分）→ 颜色 */
export function centsColor(cents: number): string {
  const a = Math.abs(cents);
  if (a <= 50) return C.green;
  if (a <= 100) return C.yellow;
  return C.red;
}

interface Bounds {
  loMidi: number;
  hiMidi: number;
  t0: number;
  t1: number;
}

/** 根据目标与实唱一起决定纵轴范围，保证两条线都在画面里 */
function bounds(ref: Reference | null, frames: PitchFrame[], t0: number, t1: number): Bounds {
  let lo = 999;
  let hi = -999;
  if (ref) {
    for (const n of ref.notes) {
      if (n.start + n.dur < t0 || n.start > t1) continue;
      lo = Math.min(lo, n.midi);
      hi = Math.max(hi, n.midi);
    }
  }
  for (const f of frames) {
    if (!f.voiced || f.t < t0 || f.t > t1) continue;
    lo = Math.min(lo, f.midi);
    hi = Math.max(hi, f.midi);
  }
  if (lo > hi) {
    lo = 55;
    hi = 72;
  }
  // 上下各留 2 个半音，别让线贴着边框
  lo = Math.floor(lo) - 2;
  hi = Math.ceil(hi) + 2;
  if (hi - lo < 12) {
    const mid = (hi + lo) / 2;
    lo = mid - 6;
    hi = mid + 6;
  }
  return { loMidi: lo, hiMidi: hi, t0, t1 };
}

function gridAndAxis(g: CanvasRenderingContext2D, w: number, h: number, b: Bounds, padL: number) {
  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);

  const y = (m: number) => h - ((m - b.loMidi) / (b.hiMidi - b.loMidi)) * h;

  // 横线：每个半音一条细线，C 音加粗并标音名
  for (let m = Math.ceil(b.loMidi); m <= b.hiMidi; m++) {
    const isC = ((m % 12) + 12) % 12 === 0;
    g.strokeStyle = isC ? C.gridStrong : C.grid;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(padL, Math.round(y(m)) + 0.5);
    g.lineTo(w, Math.round(y(m)) + 0.5);
    g.stroke();
    if (isC || b.hiMidi - b.loMidi < 16) {
      g.fillStyle = C.label;
      g.font = '10px system-ui, sans-serif';
      g.textAlign = 'right';
      g.textBaseline = 'middle';
      g.fillText(midiToName(m), padL - 5, y(m));
    }
  }
}

export interface ComparisonOpts {
  ref: Reference | null;
  frames: PitchFrame[];
  notes: NoteReview[];
  /** 时间窗口，不给就画整段 */
  window?: { t0: number; t1: number };
  /** 高亮的目标音下标 */
  selected?: number | null;
  /** 播放头位置（秒），不给就不画 */
  playhead?: number | null;
}

/**
 * 目标音高 vs 实际音高 对比图。分析页的主图。
 */
export function drawComparison(view: View, o: ComparisonOpts): void {
  const { g, w, h } = view;
  if (w < 10 || h < 10) return;
  const padL = 34;

  let t0 = o.window?.t0 ?? 0;
  let t1 = o.window?.t1 ?? 0;
  if (!o.window) {
    const lastRef = o.ref?.notes[o.ref.notes.length - 1];
    const lastFrame = o.frames[o.frames.length - 1];
    t1 = Math.max(lastRef ? lastRef.start + lastRef.dur : 0, lastFrame ? lastFrame.t : 0) + 0.3;
    t0 = o.ref?.notes[0] ? Math.max(0, o.ref.notes[0].start - 0.5) : 0;
  }
  if (t1 - t0 < 0.5) t1 = t0 + 0.5;

  const b = bounds(o.ref, o.frames, t0, t1);
  gridAndAxis(g, w, h, b, padL);

  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * (w - padL);
  const y = (m: number) => h - ((m - b.loMidi) / (b.hiMidi - b.loMidi)) * h;
  const semi = h / (b.hiMidi - b.loMidi);

  // ---- 目标音：灰色横条 ----
  if (o.ref) {
    for (let i = 0; i < o.ref.notes.length; i++) {
      const n = o.ref.notes[i];
      if (n.start + n.dur < t0 || n.start > t1) continue;
      const x0 = x(n.start);
      const x1 = Math.max(x0 + 2, x(n.start + n.dur));
      const yy = y(n.midi);
      const barH = Math.max(3, Math.min(11, semi * 0.55));
      const sel = o.selected === i;
      g.fillStyle = sel ? 'rgba(77,159,255,0.3)' : C.targetFill;
      g.fillRect(x0, yy - barH / 2, x1 - x0, barH);
      g.strokeStyle = sel ? C.accent : C.target;
      g.lineWidth = sel ? 2 : 1;
      g.strokeRect(x0 + 0.5, yy - barH / 2 + 0.5, x1 - x0 - 1, barH - 1);
    }
  }

  // ---- 实际音高：按偏差着色的折线 ----
  // 逐段画而不是一条 path 走到底，因为每一段颜色可能不同
  let prev: PitchFrame | null = null;
  for (const f of o.frames) {
    if (f.t < t0 || f.t > t1) {
      prev = null;
      continue;
    }
    if (!f.voiced) {
      prev = null;
      continue;
    }
    if (prev) {
      // 该帧对应的目标音（用于决定颜色）
      let dev = 0;
      if (o.ref) {
        const target = noteAt(o.ref, f.t);
        if (target !== null) {
          const folded = f.midi - Math.round((f.midi - target) / 12) * 12;
          dev = (folded - target) * 100;
        }
      }
      g.strokeStyle = o.ref ? centsColor(dev) : C.accent;
      g.lineWidth = 2.5;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x(prev.t), y(prev.midi));
      g.lineTo(x(f.t), y(f.midi));
      g.stroke();
    }
    prev = f;
  }

  // ---- 播放头 ----
  if (o.playhead !== null && o.playhead !== undefined && o.playhead >= t0 && o.playhead <= t1) {
    g.strokeStyle = C.text;
    g.lineWidth = 1.5;
    g.beginPath();
    g.moveTo(x(o.playhead), 0);
    g.lineTo(x(o.playhead), h);
    g.stroke();
  }
}

/** 某个时刻的目标音高，落在休止或区间外返回 null */
function noteAt(ref: Reference, t: number): number | null {
  // 音符按时间有序，用二分找
  let lo = 0;
  let hi = ref.notes.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = ref.notes[mid];
    if (t < n.start) hi = mid - 1;
    else if (t > n.start + n.dur) lo = mid + 1;
    else return n.midi;
  }
  return null;
}

export interface RollOpts {
  ref: Reference;
  /** 当前时间（秒，参考时间轴） */
  now: number;
  /** 用户最近的音高轨迹（时间, midi），只保留最近几秒 */
  trail: { t: number; midi: number }[];
  /** 当前检测到的音高，没测到为 null */
  current: number | null;
  /** 提示强度 */
  guide: 'novice' | 'normal' | 'exam';
  /** 画面显示多少秒 */
  span?: number;
}

/**
 * 跟唱用的钢琴卷帘：从右往左滚，当前时刻固定在左侧 30% 处。
 *
 * 新手模式会把「你现在偏高/偏低」直接画成一根箭头——
 * 因为新手看不懂卷帘，但看得懂箭头往哪指。
 */
export function drawRoll(view: View, o: RollOpts): void {
  const { g, w, h } = view;
  if (w < 10 || h < 10) return;
  const padL = 30;
  const span = o.span ?? 5;
  const nowX = padL + (w - padL) * 0.3;
  const t0 = o.now - span * 0.3;
  const t1 = o.now + span * 0.7;

  const framesForBounds: PitchFrame[] = o.trail.map((p) => ({
    t: p.t,
    midi: p.midi,
    f0: 0,
    clarity: 1,
    rms: 0,
    voiced: true,
  }));
  const b = bounds(o.ref, framesForBounds, t0, t1);
  gridAndAxis(g, w, h, b, padL);

  const x = (t: number) => padL + ((t - t0) / (t1 - t0)) * (w - padL);
  const y = (m: number) => h - ((m - b.loMidi) / (b.hiMidi - b.loMidi)) * h;
  const semi = h / (b.hiMidi - b.loMidi);
  const barH = Math.max(6, Math.min(18, semi * 0.6));

  // ---- 目标音条 ----
  let currentTarget: number | null = null;
  for (const n of o.ref.notes) {
    if (n.start + n.dur < t0 || n.start > t1) continue;
    const x0 = x(n.start);
    const x1 = Math.max(x0 + 3, x(n.start + n.dur));
    const yy = y(n.midi);
    const active = o.now >= n.start && o.now <= n.start + n.dur;
    if (active) currentTarget = n.midi;
    g.fillStyle = active ? 'rgba(77,159,255,0.5)' : 'rgba(107,122,141,0.3)';
    g.beginPath();
    g.roundRect(x0, yy - barH / 2, x1 - x0, barH, 3);
    g.fill();
    if (active) {
      g.strokeStyle = C.accent;
      g.lineWidth = 2;
      g.stroke();
    }
    // 歌词贴在音符条上（新手/普通模式）
    if (o.guide !== 'exam' && n.lyric && x1 - x0 > 12) {
      g.fillStyle = active ? C.text : C.label;
      g.font = '11px system-ui, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillText(n.lyric, (x0 + x1) / 2, yy - barH / 2 - 3);
    }
  }

  // ---- 用户音高轨迹 ----
  let prev: { t: number; midi: number } | null = null;
  for (const p of o.trail) {
    if (p.t < t0) {
      prev = null;
      continue;
    }
    if (prev) {
      let dev = 0;
      const tgt = noteAt(o.ref, p.t);
      if (tgt !== null) {
        const folded = p.midi - Math.round((p.midi - tgt) / 12) * 12;
        dev = (folded - tgt) * 100;
      }
      g.strokeStyle = tgt === null ? C.accent : centsColor(dev);
      g.lineWidth = 3;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(x(prev.t), y(prev.midi));
      g.lineTo(x(p.t), y(p.midi));
      g.stroke();
    }
    prev = p;
  }

  // ---- 当前时刻竖线 ----
  g.strokeStyle = 'rgba(233,237,243,0.45)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.moveTo(nowX, 0);
  g.lineTo(nowX, h);
  g.stroke();

  // ---- 当前音高的小圆点 ----
  if (o.current !== null) {
    const folded =
      currentTarget !== null
        ? o.current - Math.round((o.current - currentTarget) / 12) * 12
        : o.current;
    const dev = currentTarget !== null ? (folded - currentTarget) * 100 : 0;
    const cy = y(folded);
    g.fillStyle = currentTarget === null ? C.accent : centsColor(dev);
    g.beginPath();
    g.arc(nowX, cy, 6, 0, Math.PI * 2);
    g.fill();

    // 新手模式：把「往上/往下」画成箭头，比曲线直观得多
    if (o.guide === 'novice' && currentTarget !== null && Math.abs(dev) > 35) {
      const ty = y(currentTarget);
      g.strokeStyle = centsColor(dev);
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(nowX + 16, cy);
      g.lineTo(nowX + 16, ty);
      g.stroke();
      const dir = ty < cy ? -1 : 1;
      g.beginPath();
      g.moveTo(nowX + 16, ty);
      g.lineTo(nowX + 11, ty + dir * 8);
      g.lineTo(nowX + 21, ty + dir * 8);
      g.closePath();
      g.fillStyle = centsColor(dev);
      g.fill();
      g.font = '600 12px system-ui, sans-serif';
      g.textAlign = 'left';
      g.textBaseline = 'middle';
      g.fillText(dev > 0 ? '唱低一点' : '唱高一点', nowX + 27, (cy + ty) / 2);
    }
  }
}

export interface SeriesSpec {
  key: string;
  label: string;
  color: string;
  values: (number | null)[];
}

/**
 * 进步曲线。重点是趋势，所以纵轴固定 0~100，
 * 并且把「第一次」和「最近一次」标出来——用户真正想知道的是这两点的差。
 */
export function drawProgress(view: View, labels: string[], series: SeriesSpec[]): void {
  const { g, w, h } = view;
  if (w < 10 || h < 10) return;
  const padL = 28;
  const padB = 18;
  const padT = 8;

  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);

  const plotH = h - padB - padT;
  const y = (v: number) => padT + (1 - v / 100) * plotH;
  const n = labels.length;
  const x = (i: number) => padL + (n <= 1 ? (w - padL) / 2 : (i / (n - 1)) * (w - padL - 8));

  for (const v of [0, 25, 50, 75, 100]) {
    g.strokeStyle = v === 0 || v === 100 ? C.gridStrong : C.grid;
    g.beginPath();
    g.moveTo(padL, Math.round(y(v)) + 0.5);
    g.lineTo(w, Math.round(y(v)) + 0.5);
    g.stroke();
    g.fillStyle = C.label;
    g.font = '9px system-ui, sans-serif';
    g.textAlign = 'right';
    g.textBaseline = 'middle';
    g.fillText(String(v), padL - 4, y(v));
  }

  for (const s of series) {
    g.strokeStyle = s.color;
    g.lineWidth = 2;
    g.lineJoin = 'round';
    let started = false;
    g.beginPath();
    s.values.forEach((v, i) => {
      if (v === null) {
        started = false;
        return;
      }
      if (!started) {
        g.moveTo(x(i), y(v));
        started = true;
      } else g.lineTo(x(i), y(v));
    });
    g.stroke();
    // 点
    g.fillStyle = s.color;
    s.values.forEach((v, i) => {
      if (v === null) return;
      g.beginPath();
      g.arc(x(i), y(v), 2.5, 0, Math.PI * 2);
      g.fill();
    });
  }

  // 首尾标注
  g.fillStyle = C.label;
  g.font = '10px system-ui, sans-serif';
  g.textBaseline = 'top';
  if (n > 0) {
    g.textAlign = 'left';
    g.fillText('第 1 次', padL, h - padB + 4);
    if (n > 1) {
      g.textAlign = 'right';
      g.fillText(`第 ${n} 次`, w - 2, h - padB + 4);
    }
  }
}

/** 音域条：画出你的音域，以及这首歌要求的音域，一眼看出够不够得着 */
export function drawRange(
  view: View,
  mine: { lo: number; hi: number; comfortLo: number; comfortHi: number } | null,
  song: { lo: number; hi: number } | null,
): void {
  const { g, w, h } = view;
  if (w < 10 || h < 10) return;
  g.fillStyle = C.bg;
  g.fillRect(0, 0, w, h);

  const all: number[] = [];
  if (mine) all.push(mine.lo, mine.hi);
  if (song) all.push(song.lo, song.hi);
  if (!all.length) return;
  const lo = Math.floor(Math.min(...all)) - 2;
  const hi = Math.ceil(Math.max(...all)) + 2;
  const x = (m: number) => 8 + ((m - lo) / (hi - lo)) * (w - 16);

  // 八度刻度
  for (let m = Math.ceil(lo / 12) * 12; m <= hi; m += 12) {
    g.strokeStyle = C.grid;
    g.beginPath();
    g.moveTo(x(m), 0);
    g.lineTo(x(m), h - 14);
    g.stroke();
    g.fillStyle = C.label;
    g.font = '9px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'bottom';
    g.fillText(midiToName(m), x(m), h - 3);
  }

  const barH = 13;
  let top = 8;
  if (mine) {
    g.fillStyle = 'rgba(77,159,255,0.22)';
    g.fillRect(x(mine.lo), top, x(mine.hi) - x(mine.lo), barH);
    g.fillStyle = C.accent;
    g.fillRect(x(mine.comfortLo), top, x(mine.comfortHi) - x(mine.comfortLo), barH);
    g.fillStyle = C.text;
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('你', 10, top + barH / 2);
    top += barH + 6;
  }
  if (song) {
    g.fillStyle = 'rgba(237,180,67,0.45)';
    g.fillRect(x(song.lo), top, x(song.hi) - x(song.lo), barH);
    g.fillStyle = C.text;
    g.font = '10px system-ui, sans-serif';
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('歌', 10, top + barH / 2);
  }
}
