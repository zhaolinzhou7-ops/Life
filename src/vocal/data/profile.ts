/**
 * 个人唱歌档案（User Profile 层）。
 *
 * 必须说清楚的一件事：这里的五个数字是**软件内部的训练指标**，
 * 用来和你自己的过去比较。它们不是声乐等级，不能拿去和别人比，
 * 也不等同于任何专业考级或老师的评估。这句话会原样显示在界面上。
 */

import { midiToName } from '../dsp/notes';
import { getSessions, getTraining, streakDays, todayMinutes } from './store';
import type { SessionSummary } from './types';

export type AbilityKey = 'accuracy' | 'rhythm' | 'range' | 'stability' | 'high';

export interface Ability {
  key: AbilityKey;
  label: string;
  /** 0~100；数据不足为 null */
  value: number | null;
  /** 参与计算的次数 */
  n: number;
  /** 和最早几次相比的变化；样本不足为 null */
  delta: number | null;
  /** 这个数是怎么来的 */
  why: string;
}

export interface Profile {
  abilities: Ability[];
  range: {
    lo: number;
    hi: number;
    /** 舒适音域：取各次舒适区的中位数，比取极值稳得多 */
    comfortLo: number;
    comfortHi: number;
    span: number;
    /** 最早记录的跨度，用来说明「涨了几个半音」 */
    firstSpan: number | null;
    firstLo: number | null;
    firstHi: number | null;
  } | null;
  totalSessions: number;
  totalTrainings: number;
  todayMinutes: number;
  streak: number;
  /** 反复出现的问题 */
  commonProblems: { kind: string; title: string; count: number }[];
  disclaimer: string;
}

export const DISCLAIMER =
  '以上五项是本软件内部的训练指标，只用于和你自己的历史做对比，' +
  '不是专业声乐等级，也不等同于声乐老师的评估。';

const LABEL: Record<AbilityKey, string> = {
  accuracy: '音准',
  rhythm: '节奏',
  range: '音域',
  stability: '稳定性',
  high: '高音',
};

/** 近期加权平均：越近的一次权重越高，但老数据不会完全不算 */
function weightedRecent(values: (number | null)[]): { value: number | null; n: number } {
  const xs = values.filter((v): v is number => v !== null);
  if (!xs.length) return { value: null, n: 0 };
  let sum = 0;
  let w = 0;
  // xs[0] 是最新的
  for (let i = 0; i < Math.min(xs.length, 8); i++) {
    const weight = Math.pow(0.82, i);
    sum += xs[i] * weight;
    w += weight;
  }
  return { value: Math.round(sum / w), n: xs.length };
}

/** 进步幅度：最近 3 次的均值减去最早 3 次的均值 */
function trend(values: (number | null)[]): number | null {
  const xs = values.filter((v): v is number => v !== null);
  if (xs.length < 5) return null;
  const recent = xs.slice(0, 3);
  const early = xs.slice(-3);
  const avg = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
  return Math.round(avg(recent) - avg(early));
}

/** 把音域跨度折算成 0~100 的内部指标 */
function rangeScore(span: number): number {
  // 锚点参考的是一般未受训成年人的舒适音域（约 13~19 个半音）
  const anchors: [number, number][] = [
    [8, 30], [11, 45], [14, 60], [17, 72], [20, 82], [24, 92], [28, 100],
  ];
  if (span <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (span >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (span <= x1) return Math.round(y0 + ((y1 - y0) * (span - x0)) / (x1 - x0));
  }
  return last[1];
}

export function buildProfile(): Profile {
  const all = getSessions();
  const desc = [...all].sort((a, b) => b.at - a.at); // 最新在前
  const asc = [...all].sort((a, b) => a.at - b.at);

  const pick = (f: (s: SessionSummary) => number | null) => desc.map(f);

  const acc = weightedRecent(pick((s) => s.accuracy));
  const rhy = weightedRecent(pick((s) => s.rhythm));
  const sta = weightedRecent(pick((s) => s.stability));
  const hig = weightedRecent(pick((s) => s.highNotes));

  // 音域：取近 10 次的并集，比单次更能代表真实能力
  const recent10 = desc.slice(0, 10).filter((s) => s.rangeLo !== null && s.rangeHi !== null);
  let range: Profile['range'] = null;
  if (recent10.length) {
    const lo = Math.min(...recent10.map((s) => s.rangeLo!));
    const hi = Math.max(...recent10.map((s) => s.rangeHi!));
    const med = (xs: number[]) => {
      const a = [...xs].sort((x, y) => x - y);
      return a.length ? a[a.length >> 1] : 0;
    };
    const cLo = med(recent10.map((s) => s.comfortLo).filter((x): x is number => x !== null));
    const cHi = med(recent10.map((s) => s.comfortHi).filter((x): x is number => x !== null));
    const early = asc.filter((s) => s.rangeLo !== null && s.rangeHi !== null).slice(0, 3);
    const firstLo = early.length ? Math.min(...early.map((s) => s.rangeLo!)) : null;
    const firstHi = early.length ? Math.max(...early.map((s) => s.rangeHi!)) : null;
    range = {
      lo,
      hi,
      comfortLo: cLo || lo,
      comfortHi: cHi || hi,
      span: hi - lo,
      firstSpan: firstLo !== null && firstHi !== null ? firstHi - firstLo : null,
      firstLo,
      firstHi,
    };
  }

  const abilities: Ability[] = [
    {
      key: 'accuracy',
      label: LABEL.accuracy,
      value: acc.value,
      n: acc.n,
      delta: trend(pick((s) => s.accuracy)),
      why: acc.n ? `取自最近 ${Math.min(acc.n, 8)} 次演唱的音准分，越近的一次权重越大。` : '还没有可用于计算的演唱记录。',
    },
    {
      key: 'rhythm',
      label: LABEL.rhythm,
      value: rhy.value,
      n: rhy.n,
      delta: trend(pick((s) => s.rhythm)),
      why: rhy.n ? `取自最近 ${Math.min(rhy.n, 8)} 次有节拍参考的演唱。自由演唱不计入。` : '还没有带节拍参考的演唱记录。',
    },
    {
      key: 'range',
      label: LABEL.range,
      value: range ? rangeScore(range.span) : null,
      n: recent10.length,
      delta:
        range && range.firstSpan !== null
          ? rangeScore(range.span) - rangeScore(range.firstSpan)
          : null,
      why: range
        ? `近 10 次实际唱到 ${midiToName(range.lo)}~${midiToName(range.hi)}，跨度 ${Math.round(range.span)} 个半音。`
        : '还没有测到音域。',
    },
    {
      key: 'stability',
      label: LABEL.stability,
      value: sta.value,
      n: sta.n,
      delta: trend(pick((s) => s.stability)),
      why: sta.n ? `取自最近 ${Math.min(sta.n, 8)} 次的长音稳定度（音高浮动越小分越高）。` : '还没有足够长的长音可供统计。',
    },
    {
      key: 'high',
      label: LABEL.high,
      value: hig.value,
      n: hig.n,
      delta: trend(pick((s) => s.highNotes)),
      why: hig.n ? `取自最近 ${Math.min(hig.n, 8)} 次里高音区的准确度与稳定度。` : '还没有唱到足够多的高音。',
    },
  ];

  // 常见问题：统计每次的首要问题
  const counter = new Map<string, { title: string; count: number }>();
  for (const s of desc.slice(0, 20)) {
    if (!s.topFinding || s.topFinding === 'clean') continue;
    const cur = counter.get(s.topFinding);
    if (cur) cur.count++;
    else counter.set(s.topFinding, { title: s.topFindingTitle ?? s.topFinding, count: 1 });
  }
  const commonProblems = [...counter.entries()]
    .map(([kind, v]) => ({ kind, title: v.title, count: v.count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 4);

  return {
    abilities,
    range,
    totalSessions: all.length,
    totalTrainings: getTraining().length,
    todayMinutes: todayMinutes(),
    streak: streakDays(),
    commonProblems,
    disclaimer: DISCLAIMER,
  };
}

/** 进步曲线的数据点 */
export interface ProgressPoint {
  at: number;
  title: string;
  accuracy: number | null;
  rhythm: number | null;
  stability: number | null;
  high: number | null;
  rangeSpan: number | null;
  overall: number | null;
}

export function progressSeries(refId?: string): ProgressPoint[] {
  return getSessions()
    .filter((s) => (refId ? s.refId === refId : true))
    .sort((a, b) => a.at - b.at)
    .map((s) => ({
      at: s.at,
      title: s.title,
      accuracy: s.accuracy,
      rhythm: s.rhythm,
      stability: s.stability,
      high: s.highNotes,
      rangeSpan: s.rangeLo !== null && s.rangeHi !== null ? Math.round(s.rangeHi - s.rangeLo) : null,
      overall: s.overall,
    }));
}

/**
 * 「我到底有没有变好」——把第 1 次、第 5 次、第 10 次拿出来对比。
 * 用户最关心这个，所以要专门做，而不是让他自己去看折线。
 */
export interface Milestone {
  index: number;
  at: number;
  title: string;
  accuracy: number | null;
  rhythm: number | null;
  stability: number | null;
  high: number | null;
  rangeSpan: number | null;
}

export function milestones(refId?: string): { points: Milestone[]; summary: string } {
  const series = progressSeries(refId);
  if (series.length < 2) {
    return {
      points: [],
      summary: `目前只有 ${series.length} 次记录，至少唱 2 次才能对比。同一首歌多唱几次，趋势最准。`,
    };
  }
  const idx = [0];
  if (series.length >= 5) idx.push(4);
  if (series.length >= 10) idx.push(9);
  if (!idx.includes(series.length - 1)) idx.push(series.length - 1);

  const points: Milestone[] = idx.map((i) => ({
    index: i + 1,
    at: series[i].at,
    title: series[i].title,
    accuracy: series[i].accuracy,
    rhythm: series[i].rhythm,
    stability: series[i].stability,
    high: series[i].high,
    rangeSpan: series[i].rangeSpan,
  }));

  const first = points[0];
  const last = points[points.length - 1];
  const bits: string[] = [];
  const cmp = (a: number | null, b: number | null, name: string, unit = ' 分') => {
    if (a === null || b === null) return;
    const d = b - a;
    if (Math.abs(d) >= 3) bits.push(`${name}${d > 0 ? '提高' : '下降'}了 ${Math.abs(d)}${unit}`);
  };
  cmp(first.accuracy, last.accuracy, '音准');
  cmp(first.rhythm, last.rhythm, '节奏');
  cmp(first.stability, last.stability, '稳定性');
  cmp(first.high, last.high, '高音');
  if (first.rangeSpan !== null && last.rangeSpan !== null) {
    const d = last.rangeSpan - first.rangeSpan;
    if (Math.abs(d) >= 2) bits.push(`音域${d > 0 ? '宽了' : '窄了'} ${Math.abs(d)} 个半音`);
  }

  const summary = bits.length
    ? `从第 1 次到第 ${last.index} 次：${bits.join('，')}。`
    : `从第 1 次到第 ${last.index} 次各项基本持平——变化不到 3 分，属于正常波动，还看不出趋势。`;
  return { points, summary };
}
