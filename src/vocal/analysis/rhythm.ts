/**
 * 节奏分析。
 *
 * 一条硬规则写在最前面：**没有可靠的 BPM/节拍参考，就不输出精确结论。**
 * 用户自己导入的音频我们不知道它的拍在哪儿，这时候还报「你抢拍 0.12 秒」
 * 是在编数字。那种情况下只做基础统计，并且明确告诉用户为什么。
 *
 * 另一件容易骗人的事是**设备延迟**：耳机/蓝牙/浏览器缓冲会让录到的声音
 * 整体晚几十到几百毫秒。所以这里把偏差拆成两部分——
 *   系统性偏移（整体偏早/偏晚，多半是设备）单独报出来；
 *   去掉它之后的离散程度才是真正的节奏能力。
 */

import type { RhythmReport, Metric, Reference, SungNote } from './types';
import { NO_METRIC, medianOf, scoreByAnchors, stddev } from './types';

/** 超过这个偏差算抢/拖（秒） */
const SLOP = 0.06;
/** 句尾早收/拖长的判定门槛（秒） */
const PHRASE_SLOP = 0.25;

const TIMING_ANCHORS: [number, number][] = [
  [0, 100], [30, 92], [50, 85], [80, 74], [120, 60], [180, 44], [250, 28], [400, 8], [600, 0],
];
const STEADY_ANCHORS: [number, number][] = [
  [0, 100], [25, 93], [40, 86], [60, 76], [90, 63], [130, 48], [200, 28], [300, 10], [450, 0],
];

export interface RhythmOptions {
  /** 用户校准过的设备延迟（秒）；没校准就是 0 */
  latency?: number;
  /** 用户是否真的做过延迟校准 */
  calibrated?: boolean;
}

/** 整体偏移超过这个值又没校准过，就不下抢拍/拖拍的结论（秒） */
const TRUST_LIMIT = 0.12;

export function analyzeRhythm(
  sung: SungNote[],
  ref: Reference | null,
  opts: RhythmOptions = {},
): RhythmReport {
  const empty: RhythmReport = {
    degraded: true,
    notice: null,
    systematicOffset: 0,
    absoluteTrustworthy: false,
    timing: NO_METRIC('毫秒', '没有参考旋律，无法分析节奏'),
    steadiness: NO_METRIC('毫秒', '没有参考旋律，无法分析节奏'),
    rushCount: 0,
    dragCount: 0,
    onTimeCount: 0,
    phraseEnd: { early: 0, late: 0, ok: 0, note: '没有乐句参考' },
    offsets: [],
  };

  if (!ref || !ref.notes.length) {
    return { ...empty, notice: '本次是自由演唱，没有参考旋律，因此不做节奏评分。' };
  }

  if (!ref.beatReliable || ref.bpm === null) {
    // 降级：只报能确定的东西——用户自己唱了多少个音、每个音多长
    const durations = sung.map((s) => s.end - s.start);
    const ioi: number[] = [];
    for (let i = 1; i < sung.length; i++) ioi.push(sung[i].start - sung[i - 1].start);
    const cv = ioi.length >= 4 ? stddev(ioi) / Math.max(0.001, medianOf(ioi)) : null;
    return {
      ...empty,
      notice:
        '当前歌曲缺少可靠节拍参考，因此本项只进行基础节奏分析：' +
        '只统计你自己唱的音符数量与长短，不判断抢拍/拖拍。',
      timing: NO_METRIC('毫秒', '缺少可靠节拍参考，入拍偏差无法计算'),
      steadiness:
        cv === null
          ? NO_METRIC('毫秒', '音符太少（不足 5 个），连基础节奏统计都做不了')
          : {
              score: null,
              raw: Math.round(cv * 100),
              unit: '%（起音间隔的离散度）',
              n: ioi.length,
              why:
                `你唱了 ${sung.length} 个音，平均每个 ${(medianOf(durations) * 1000).toFixed(0)} 毫秒，` +
                `相邻起音间隔的离散度 ${(cv * 100).toFixed(0)}%。` +
                `没有节拍参考时这个数只能自己和自己比，不构成节奏评分。`,
              unavailable: '缺少可靠节拍参考，不折算成分数',
            },
      offsets: ref.notes.map(() => null),
    };
  }

  // ---- 正常路径：有可靠节拍 ----
  const latency = opts.latency ?? 0;
  const beat = 60 / ref.bpm;
  const window = Math.min(0.45, beat * 0.7);
  const offsets: (number | null)[] = new Array(ref.notes.length).fill(null);
  const used = new Set<number>();

  ref.notes.forEach((rn, i) => {
    let best = -1;
    let bestD = Infinity;
    for (let j = 0; j < sung.length; j++) {
      if (used.has(j)) continue;
      const d = sung[j].start - rn.start - latency;
      if (Math.abs(d) <= window && Math.abs(d) < Math.abs(bestD)) {
        best = j;
        bestD = d;
      }
    }
    if (best >= 0) {
      used.add(best);
      offsets[i] = bestD;
    }
  });

  const matched = offsets.filter((o): o is number => o !== null);
  if (matched.length < 4) {
    return {
      ...empty,
      degraded: false,
      absoluteTrustworthy: false,
      notice: '匹配上的音符太少（不足 4 个），节奏这一项这次不评。',
      timing: NO_METRIC('毫秒', '匹配上的音符不足 4 个'),
      steadiness: NO_METRIC('毫秒', '匹配上的音符不足 4 个'),
      offsets,
    };
  }

  // 系统性偏移 = 偏差的中位数。用中位数而不是均值，免得被几个漏唱带偏
  const systematic = medianOf(matched);
  // 扣掉整体偏移之后的残差：它衡量的是「稳不稳」，与设备延迟无关，永远可信
  const adj = matched.map((o) => o - systematic);

  const meanAbsMs = (adj.reduce((a, b) => a + Math.abs(b), 0) / adj.length) * 1000;
  const sdMs = stddev(adj) * 1000;

  // 抢拍/拖拍是「绝对」结论，必须用没扣偏移的原始偏差来数
  let rush = 0;
  let drag = 0;
  let onTime = 0;
  for (const o of matched) {
    if (o < -SLOP) rush++;
    else if (o > SLOP) drag++;
    else onTime++;
  }

  const sysMs = Math.round(systematic * 1000);
  const trustworthy = (opts.calibrated ?? false) || Math.abs(systematic) <= TRUST_LIMIT;
  const sysNote = !trustworthy
    ? `注意：你的演唱整体${sysMs > 0 ? '偏晚' : '偏早'} ${Math.abs(sysMs)} 毫秒。` +
      `没做过延迟校准的话，这既可能是你${sysMs > 0 ? '拖拍' : '抢拍'}，也可能只是设备延迟` +
      `（蓝牙耳机常有 100~300 毫秒）。两者在数据上分不开，所以这次不下抢拍/拖拍的结论。` +
      `去「我的 → 延迟校准」花十秒校一次，以后就能分清了。`
    : Math.abs(sysMs) > 40
      ? `整体${sysMs > 0 ? '偏晚' : '偏早'} ${Math.abs(sysMs)} 毫秒。`
      : '';

  const timing: Metric = {
    score: scoreByAnchors(meanAbsMs, TIMING_ANCHORS),
    raw: Math.round(meanAbsMs),
    unit: '毫秒',
    n: adj.length,
    why:
      `${adj.length} 个音的入拍一致性：扣掉整体偏移后平均还差 ${Math.round(meanAbsMs)} 毫秒。` +
      (trustworthy ? `其中抢拍 ${rush} 处、拖拍 ${drag} 处、准点 ${onTime} 处。` : '') +
      sysNote,
  };

  const steadiness: Metric = {
    score: scoreByAnchors(sdMs, STEADY_ANCHORS),
    raw: Math.round(sdMs),
    unit: '毫秒',
    n: adj.length,
    why:
      `入拍偏差的离散程度是 ±${Math.round(sdMs)} 毫秒。` +
      `这个数比平均偏差更能说明问题——它小说明你节奏是稳的（哪怕整体偏了一点），` +
      `大说明忽快忽慢。`,
  };

  const phraseEnd = analyzePhraseEnds(sung, ref);

  return {
    degraded: false,
    notice: trustworthy ? null : sysNote,
    systematicOffset: systematic,
    absoluteTrustworthy: trustworthy,
    timing,
    steadiness,
    rushCount: rush,
    dragCount: drag,
    onTimeCount: onTime,
    phraseEnd,
    offsets,
  };
}

/** 句尾：早收还是拖长。唱歌里句尾处理是很显功力的地方 */
function analyzePhraseEnds(sung: SungNote[], ref: Reference): RhythmReport['phraseEnd'] {
  let early = 0;
  let late = 0;
  let ok = 0;
  for (const ph of ref.phrases) {
    const notes = ref.notes.slice(ph.from, ph.to);
    if (!notes.length) continue;
    const phStart = notes[0].start;
    const phEnd = notes[notes.length - 1].start + notes[notes.length - 1].dur;
    // 该乐句时间范围内用户最后一次发声的结束点
    const inside = sung.filter((s) => s.end > phStart && s.start < phEnd + 0.5);
    if (!inside.length) continue;
    const userEnd = Math.max(...inside.map((s) => s.end));
    const d = userEnd - phEnd;
    if (d < -PHRASE_SLOP) early++;
    else if (d > PHRASE_SLOP) late++;
    else ok++;
  }
  const total = early + late + ok;
  let note = '句尾处理基本到位。';
  if (!total) note = '没有足够的乐句可以分析句尾。';
  else if (early > total * 0.4) note = `${early}/${total} 句在句尾提前收声了——多半是气不够或者急着换气。`;
  else if (late > total * 0.4) note = `${late}/${total} 句的尾音拖过了——尾音拖长会把下一句的起拍挤掉。`;
  return { early, late, ok, note };
}
