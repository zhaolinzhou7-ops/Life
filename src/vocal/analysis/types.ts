/**
 * 分析层共用的数据模型。
 *
 * 一条贯穿全应用的原则：**任何指标都可能「数据不足」**。
 * 所以指标不是裸 number，而是 Metric——它可以明确说「这次没法评」，
 * 并且永远带着 why（凭什么是这个结果）。产品里不允许出现
 * 一个没有解释的分数。
 */

/** 段落类型 */
export type SectionKind = 'intro' | 'verse' | 'prechorus' | 'chorus' | 'bridge' | 'outro';

export const SECTION_LABEL: Record<SectionKind, string> = {
  intro: 'Intro 前奏',
  verse: 'Verse 主歌',
  prechorus: 'Pre-chorus 导歌',
  chorus: 'Chorus 副歌',
  bridge: 'Bridge 桥段',
  outro: 'Outro 尾声',
};

/** 目标旋律里的一个音 */
export interface RefNote {
  /** 目标 MIDI 音高（已含移调） */
  midi: number;
  /** 起始时间（秒，相对录音起点） */
  start: number;
  /** 时长（秒） */
  dur: number;
  /** 对应歌词字 */
  lyric: string;
  /** 所属段落下标 */
  section: number;
  /** 所属乐句下标 */
  phrase: number;
}

/** 一段可跟唱的参考（歌曲或练习） */
export interface Reference {
  id: string;
  title: string;
  /** 每分钟拍数；null 表示没有可靠节拍参考 */
  bpm: number | null;
  /**
   * 节拍参考是否可靠。
   * 内置曲库是我们自己编的时值，当然可靠；
   * 用户导入的音频没有节拍标注，就必须置 false——
   * 那种情况下节奏分析只做基础统计，绝不编造精确结论。
   */
  beatReliable: boolean;
  /** 需要用户唱的音（评分只看这些）。纯伴奏段落不在里面 */
  notes: RefNote[];
  /** 伴奏要播的全部音（含前奏/间奏），只给合成器用 */
  playback: { midi: number; start: number; dur: number }[];
  /**
   * 段落。from/to 是 notes 的下标区间 [from, to)，
   * 纯伴奏段落的 from === to；startSec/endSec 才是分段练习用的时间范围。
   */
  sections: { kind: SectionKind; name: string; from: number; to: number; startSec: number; endSec: number }[];
  /** 乐句：from/to 是音符下标区间 [from, to) */
  phrases: { from: number; to: number; text: string; startSec: number; endSec: number }[];
  /** 相对原调移了几个半音 */
  transpose: number;
  /** 整段参考的总时长（秒），含前奏与尾声 */
  totalSec: number;
}

/** 用户唱出来的一个音（从音高轨迹切出来的） */
export interface SungNote {
  start: number;
  end: number;
  /** 稳定段的中位音高 */
  midi: number;
  /** 起音瞬间的音高（用来看是不是「滑上去的」） */
  onsetMidi: number;
  /** 段内音高标准差（半音），衡量这个音稳不稳 */
  sd: number;
  /** 平均音量 */
  rms: number;
}

/**
 * 一个指标。score 与 raw 都可能是 null——「测不了」是合法结果，
 * 强行给个数字才是产品事故。
 */
export interface Metric {
  /** 0~100，null = 本次数据不足 */
  score: number | null;
  /** 支撑分数的原始量（音分、毫秒、半音……） */
  raw: number | null;
  /** raw 的单位，用于显示 */
  unit: string;
  /** 参与统计的样本量 */
  n: number;
  /** 为什么是这个结果（人话，一句） */
  why: string;
  /** 数据不足时的说明；有值时 score 必为 null */
  unavailable?: string;
}

export const NO_METRIC = (unit: string, reason: string): Metric => ({
  score: null,
  raw: null,
  unit,
  n: 0,
  why: reason,
  unavailable: reason,
});

/** 逐音复盘：绿 / 黄 / 红 / 没唱 */
export type NoteLevel = 'green' | 'yellow' | 'red' | 'miss';

export interface NoteReview {
  /** 对应 Reference.notes 的下标 */
  ref: number;
  start: number;
  end: number;
  targetMidi: number;
  lyric: string;
  section: number;
  phrase: number;
  /** 用户实际唱的音高（已折八度）；没唱为 null */
  sungMidi: number | null;
  /** 音高偏差（音分），正 = 唱高了 */
  cents: number | null;
  /** 入拍偏差（秒），正 = 晚（拖拍）；无法判定为 null */
  timing: number | null;
  /** 该音符时间窗内命中容差的帧占比 0~1 */
  hit: number;
  level: NoteLevel;
  /** 具体问题标签，如「偏低 62 音分」「起音晚了 0.28 秒」 */
  issues: string[];
}

/** 录音质量问题 */
export interface QualityIssue {
  kind: 'silent' | 'tooShort' | 'tooQuiet' | 'clipping' | 'noisy' | 'lowVoiced' | 'tooLong';
  /** 严重程度：blocker 会阻止出评分 */
  severity: 'blocker' | 'warn';
  message: string;
  /** 怎么办 */
  fix: string;
}

export interface QualityReport {
  ok: boolean;
  /** 有 blocker 时为 true，此时不应展示评分 */
  blocked: boolean;
  issues: QualityIssue[];
  /** 一句话总结 */
  summary: string;
}

/** 音域 */
export interface RangeInfo {
  lo: number;
  hi: number;
  /** 跨度（半音） */
  span: number;
  /** 舒适区（去掉最极端 5% 后的范围），比绝对音域更有参考价值 */
  comfortLo: number;
  comfortHi: number;
  n: number;
}

/** 节奏分析结果 */
export interface RhythmReport {
  /** 节拍参考不可靠时为 true——此时只有基础统计 */
  degraded: boolean;
  /** 降级说明，展示给用户看 */
  notice: string | null;
  /** 系统性偏移（秒）：整体偏早/偏晚，多半是设备延迟 */
  systematicOffset: number;
  /**
   * 抢拍/拖拍这类「绝对」结论是否可信。
   *
   * 没做过延迟校准、而且整体偏移又很大时为 false：这时候在数学上
   * 根本分不清「你在拖拍」和「你的蓝牙耳机晚了 200 毫秒」，
   * 所以我们不下这个结论。一致性类指标（timing/steadiness）不受影响，
   * 因为它们是扣掉整体偏移之后算的。
   */
  absoluteTrustworthy: boolean;
  /** 去掉系统偏移后的入拍偏差 */
  timing: Metric;
  /** 节奏稳定性（偏差的离散程度） */
  steadiness: Metric;
  /** 抢拍次数 */
  rushCount: number;
  /** 拖拍次数 */
  dragCount: number;
  /** 准点次数 */
  onTimeCount: number;
  /** 句尾处理：早收 / 拖长 的句数 */
  phraseEnd: { early: number; late: number; ok: number; note: string };
  /** 每个音符的入拍偏差（秒），与 Reference.notes 同序；null = 没唱 */
  offsets: (number | null)[];
}

/** 音准分析结果 */
export interface IntonationReport {
  accuracy: Metric;
  hitRate: Metric;
  stability: Metric;
  highNotes: Metric;
  /** 系统性偏高/偏低（音分），正 = 整体偏高 */
  bias: number | null;
  /** 唱到的音域 */
  range: RangeInfo | null;
  /** 逐音复盘 */
  notes: NoteReview[];
}

/** 一次演唱的完整分析报告 */
export interface PerformanceReport {
  /** 本次录音的时间戳 */
  at: number;
  mode: 'song' | 'free' | 'exercise';
  refId: string | null;
  refTitle: string;
  transpose: number;
  duration: number;
  quality: QualityReport;
  intonation: IntonationReport;
  rhythm: RhythmReport | null;
  /** 声音特征（带边界说明的辅助指标） */
  voice: {
    dynamicRangeDb: number;
    meanDb: number;
    centroidHz: number;
    flatness: number;
    jitterPct: number;
    shimmerPct: number;
    perturbationBasisSec: number;
    snrDb: number;
    /** 长音持续能力：最长一个连续发声段的秒数 */
    longestNoteSec: number;
  };
  /** 综合分（各维度加权，仅作辅助） */
  overall: number | null;
  /** 段落小结 */
  sections: {
    kind: SectionKind;
    name: string;
    accuracy: number | null;
    hitRate: number | null;
    worstNote: number | null;
  }[];
  /** 本次最突出的问题（按严重度排序，供 AI 层与 UI 使用） */
  findings: Finding[];
}

/** 一条可执行的发现：问题 + 证据 + 建议练什么 */
export interface Finding {
  /** 问题类型，训练推荐按它选练习 */
  kind:
    | 'flat'
    | 'sharp'
    | 'highNoteFlat'
    | 'unstableLongNote'
    | 'drag'
    | 'rush'
    | 'unsteady'
    | 'miss'
    | 'rangeLimit'
    | 'dynamicsFlat'
    | 'clean';
  /** 严重度 0~1，用来排序 */
  severity: number;
  /** 一句话讲清问题（带数字） */
  title: string;
  /** 证据：具体在哪几处、偏了多少 */
  evidence: string;
  /** 关联的音符下标，供 UI 高亮 */
  refs: number[];
}

/**
 * 把原始量按锚点分段线性映射成 0~100 的分。锚点需按 x 升序。
 *
 * 用锚点而不是一条公式，是为了让每个分数都能讲清楚：
 * 「平均偏差 30 音分 → 80 分」是查表查出来的，不是玄学。
 */
export function scoreByAnchors(x: number, anchors: [number, number][]): number {
  const first = anchors[0];
  const last = anchors[anchors.length - 1];
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return Math.round(y0 + ((y1 - y0) * (x - x0)) / (x1 - x0));
  }
  return last[1];
}

/** 数组均值 */
export const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** 标准差 */
export function stddev(a: number[]): number {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length);
}

/** 中位数（不改动入参） */
export function medianOf(a: number[]): number {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y);
  const h = s.length >> 1;
  return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2;
}
