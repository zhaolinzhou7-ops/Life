/**
 * 规则引擎教练。
 *
 * 它有两个身份：
 *   1. Mock 模式下的教练本体——没有任何 AI API 时，产品依然完整可用；
 *   2. AI 输出不合格时的兜底——宁可给一份朴素但准确的反馈，
 *      也不给一段「你很有潜力，继续努力」的废话。
 *
 * 所有结论都由 PerformanceReport 里的数字直接推出，不猜、不抒情。
 */

import { midiToName } from '../dsp/notes';
import type { Finding, PerformanceReport } from '../analysis/types';
import { EXERCISE_BY_ID, exercisesFor } from '../training/exercises';

export interface Drill {
  exerciseId: string;
  name: string;
  minutes: number;
  /** 为什么给你这条练习 */
  reason: string;
}

export interface CoachFeedback {
  /** ① 你唱得好的地方 */
  good: string;
  /** ② 最大的问题 */
  problem: string;
  /** ③ 为什么会这样 */
  why: string;
  /** ④ 怎么练 */
  drills: Drill[];
  /** ⑤ 下一次的目标（必须可验证） */
  goal: string;
  /** 反馈来源 */
  source: string;
  /** 从 AI 回退到规则引擎时，说明原因 */
  fallbackReason?: string;
}

/**
 * 「为什么会这样」的解释库。
 *
 * 这里是产品真正的教学内容，写的时候守两条线：
 * 说人话（不用「声门下压」这种词），以及只解释发声机理，
 * 不对用户的身体状况下任何判断。
 */
const WHY: Record<Finding['kind'], string> = {
  flat:
    '整体偏低通常是「从下面摸上去」造成的：你心里其实没有先把目标音想清楚，' +
    '而是靠嗓子往上滑着找，摸到差不多就停了——停的位置几乎总是偏低一点。' +
    '另一个常见原因是支撑不足，声音撑不住就会往下坠。',
  sharp:
    '整体偏高多半是用力过度。音量一大，喉部张力跟着上来，音就被顶上去了。' +
    '唱得起劲的时候尤其容易发生，自己当下听不出来。',
  highNoteFlat:
    '高音够不上，绝大多数时候不是力气不够，恰恰是用力太多。' +
    '一到高音就本能地加音量、抬喉咙、把声带挤紧，' +
    '结果声带反而振不到那么高的频率，声音就卡在目标音下面一点。' +
    '真正能上去的路子是反过来的：音量放小、喉咙放松，先让位置对，再慢慢加音量。',
  unstableLongNote:
    '长音飘，说明送气不匀——气一阵多一阵少，音高就跟着晃。' +
    '这在唱到一句尾巴、气快用完的时候最明显。' +
    '（说明：软件测的是音高的稳定度，这是能从录音里客观读出来的；' +
    '至于呼吸肌肉具体怎么用力，录音测不了，我们也不做这个判断。）',
  drag:
    '拖拍最常出在句子开头，尤其是需要换气的位置。' +
    '原因往往不是「反应慢」，而是没有提前准备：等到该唱了才开始吸气，' +
    '那口气还没到位，音自然就晚了。',
  rush:
    '抢拍通常来自紧张，或者对后面的旋律不熟——心里没底就会往前赶。' +
    '快歌里还有一种情况：换气太急，一口气吸得又浅又快，整个人的节奏就跟着提前了。',
  unsteady:
    '忽快忽慢说明你是跟着「感觉」在唱，而不是跟着拍子。' +
    '简单的地方就自然慢下来，难的地方反而赶——这是拍感还没有变成身体反应的典型表现。',
  miss:
    '大段没唱出来，一般是三个原因之一：歌还不熟、换气点没安排好、或者音太高够不着。' +
    '先确认是哪一个——不熟就分句慢练，气不够就重新安排换气，够不着就先降调。',
  rangeLimit:
    '这首歌的音高超出了你现在够得着的范围。音域是可以练宽的，' +
    '但增长速度大概是「几周涨一两个半音」这个量级，' +
    '硬顶不会加快这个过程，只会让嗓子疲劳，反而拖慢进度。',
  dynamicsFlat:
    '从头到尾一个音量，听感上会很平。' +
    '这不影响音准，但会让人觉得「唱得对但没味道」。' +
    '音量控制是可以单独练的，练的是把音量和音高解耦——' +
    '很多人一加音量音高就跟着往上跑。',
  clean:
    '这次的各项指标都在正常范围内，没有触发任何告警。' +
    '可以往上加难度了：换更难的歌、或者把当前这首升一两个调再唱。',
};

/** 找出一件**有数字支撑**的好事。找不到就说实话，不编 */
function pickGood(r: PerformanceReport): string {
  // 1) 某个段落唱得明显好
  const best = r.sections
    .filter((s) => s.hitRate !== null && s.accuracy !== null)
    .sort((a, b) => (b.hitRate ?? 0) - (a.hitRate ?? 0))[0];
  if (best && (best.hitRate ?? 0) >= 75) {
    return `${best.name}这一段唱得最稳：${best.hitRate}% 的时间落在容差内，平均只偏 ${best.accuracy} 音分。`;
  }

  // 2) 某个维度分数不错
  const metrics: [string, number | null, string][] = [
    ['音准', r.intonation.accuracy.score, r.intonation.accuracy.why],
    ['节奏', r.rhythm?.timing.score ?? null, r.rhythm?.timing.why ?? ''],
    ['稳定性', r.intonation.stability.score, r.intonation.stability.why],
    ['高音', r.intonation.highNotes.score, r.intonation.highNotes.why],
  ];
  const good = metrics.filter((m) => m[1] !== null && m[1]! >= 72).sort((a, b) => b[1]! - a[1]!)[0];
  if (good) return `${good[0]}这一项是你这次的强项（${good[1]} 分）：${good[2]}`;

  // 3) 连续发声能力
  if (r.voice.longestNoteSec >= 3) {
    return `你最长一次连续发声撑了 ${r.voice.longestNoteSec} 秒，音高没有断——这是个可以往上搭的基础。`;
  }

  // 4) 音域
  if (r.intonation.range) {
    const g = r.intonation.range;
    return `这次实际唱到的范围是 ${midiToName(g.lo)} 到 ${midiToName(g.hi)}，跨度 ${Math.round(g.span)} 个半音，够用来唱不少歌了。`;
  }

  // 5) 实在没有就直说——不说假话是这个产品的底线
  return '这次录音的数据还不够多，先按下面的建议再唱一次，下次就能给出更有把握的判断。';
}

/** 下一次的目标：必须是能用同一套指标验证的 */
function makeGoal(r: PerformanceReport, top: Finding): string {
  const acc = r.intonation.accuracy.raw;
  const hit = r.intonation.hitRate.raw;
  switch (top.kind) {
    case 'flat':
    case 'sharp': {
      if (acc === null) return '下次把整首唱完整，让软件能算出平均偏差。';
      const target = Math.max(15, Math.round(acc * 0.65));
      return `下次的目标只有一个：把平均偏差从 ${acc} 音分压到 ${target} 音分以内。别管音量和感情，先把音唱到位。`;
    }
    case 'highNoteFlat': {
      const raw = r.intonation.highNotes.raw;
      const cur = raw === null ? 60 : Math.abs(raw);
      return `下次先不要追求音量，把目标放在高音的音准：让高音区的平均偏差从 ${cur} 音分降到 ${Math.max(25, Math.round(cur * 0.6))} 音分以内。唱轻一点没关系。`;
    }
    case 'unstableLongNote': {
      const sd = r.intonation.stability.raw ?? 40;
      return `下次盯住长音：让长音的音高浮动从 ±${sd} 音分收到 ±${Math.max(12, Math.round(sd * 0.6))} 音分以内。宁可唱短一点也要唱稳。`;
    }
    case 'drag':
    case 'rush':
    case 'unsteady': {
      const sd = r.rhythm?.steadiness.raw ?? 100;
      return `下次的目标是节奏一致性：把入拍偏差的离散度从 ±${sd} 毫秒收到 ±${Math.max(35, Math.round(sd * 0.6))} 毫秒以内。可以先把速度放慢到 80%。`;
    }
    case 'miss': {
      const missed = r.intonation.notes.filter((n) => n.level === 'miss').length;
      return `下次的目标是唱完整：把漏掉的音从 ${missed} 个减到 ${Math.max(0, Math.floor(missed / 2))} 个以内。唱慢一点、降调都行，先做到一个不漏。`;
    }
    case 'rangeLimit': {
      const t = r.transpose;
      return `下次把这首歌降到 ${t - 3 > -6 ? t - 3 : -6} 调再唱一遍，目标是全程不出现「没唱上去」的音。等唱熟了再一个半音一个半音往回升。`;
    }
    case 'dynamicsFlat':
      return `下次试着让副歌比主歌明显响一些，目标是动态范围从 ${r.voice.dynamicRangeDb} dB 拉到 8 dB 以上，同时音准分不下降。`;
    default:
      return hit === null
        ? '下次挑一首更难的歌，看看指标还稳不稳。'
        : `这次命中率 ${hit}%，下次换首更难的或者升一个调，目标是命中率仍然保持在 ${Math.max(60, Math.round(hit - 8))}% 以上。`;
  }
}

/** 按问题挑练习，并说明为什么挑这条 */
function pickDrills(findings: Finding[]): Drill[] {
  const out: Drill[] = [];
  const used = new Set<string>();

  for (const f of findings.slice(0, 3)) {
    if (f.kind === 'clean') continue;
    for (const ex of exercisesFor(f.kind)) {
      if (used.has(ex.id)) continue;
      used.add(ex.id);
      out.push({
        exerciseId: ex.id,
        name: ex.name,
        minutes: ex.minutes,
        reason: `针对「${f.title}」：${ex.goal}。`,
      });
      break; // 每个问题先给一条，避免一上来堆十条练习
    }
    if (out.length >= 3) break;
  }

  // 一条都没挑出来（比如 clean），给一条维持性的
  if (!out.length) {
    const ex = EXERCISE_BY_ID.get('scale-major')!;
    out.push({
      exerciseId: ex.id,
      name: ex.name,
      minutes: ex.minutes,
      reason: '这次没有明显问题，用音阶保持手感，同时可以往上探音域。',
    });
  }
  return out;
}

/** 生成规则引擎反馈 */
export function ruleFeedback(r: PerformanceReport, fallbackReason?: string): CoachFeedback {
  const top = r.findings[0] ?? {
    kind: 'clean' as const,
    severity: 0,
    title: '没有发现明显问题',
    evidence: '',
    refs: [],
  };

  const problem =
    top.kind === 'clean'
      ? '这次没有找出明显短板。'
      : `${top.title}。${top.evidence}`;

  return {
    good: pickGood(r),
    problem,
    why: WHY[top.kind],
    drills: pickDrills(r.findings),
    goal: makeGoal(r, top),
    source: '内置教练（规则引擎，未联网）',
    fallbackReason,
  };
}
