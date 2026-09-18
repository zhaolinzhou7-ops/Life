/**
 * 发给 AI 的结构化数据。
 *
 * 隐私原则（对应产品需求里的「API 调用尽量减少不必要的数据传输」）：
 *   · 不传音频，一秒都不传；
 *   · 不传逐帧音高轨迹（几千个数，对教学没用，还平白增加传输量）；
 *   · 不传设备信息、不传任何可以标识个人的东西；
 *   · 只传**指标**和**问题清单**——也就是屏幕上已经显示给用户看的那些数字。
 *
 * 换句话说：AI 看到的东西，不比用户自己在分析页看到的多。
 */

import { midiToName } from '../dsp/notes';
import type { PerformanceReport } from '../analysis/types';
import type { SessionSummary } from '../data/types';
import { EXERCISES } from '../training/exercises';

export interface CoachPayload {
  歌曲: string;
  移调: number;
  时长秒: number;
  综合分: number | null;
  录音质量: string;
  指标: Record<string, { 分数: number | null; 原始值: string; 依据: string }>;
  音域: string | null;
  节奏说明: string | null;
  问题清单: { 类型: string; 严重度: number; 问题: string; 证据: string }[];
  段落表现: { 段落: string; 平均偏差音分: number | null; 命中率: number | null }[];
  最差的几个音: { 歌词: string; 目标: string; 实唱: string; 偏差音分: number | null; 入拍偏差毫秒: number | null }[];
  声音特征: Record<string, number>;
  历史对比: { 次数: number; 上次综合分: number | null; 音准趋势: string } | null;
}

const m = (x: { score: number | null; raw: number | null; unit: string; why: string; unavailable?: string }) => ({
  分数: x.score,
  原始值: x.raw === null ? (x.unavailable ?? '数据不足') : `${x.raw} ${x.unit}`,
  依据: x.why,
});

export function buildPayload(r: PerformanceReport, history: SessionSummary[]): CoachPayload {
  const notes = r.intonation.notes;
  const worst = [...notes]
    .filter((n) => n.level === 'red' || n.level === 'miss')
    .sort((a, b) => Math.abs(b.cents ?? 999) - Math.abs(a.cents ?? 999))
    .slice(0, 6)
    .map((n) => ({
      歌词: n.lyric || '（无词）',
      目标: midiToName(n.targetMidi),
      实唱: n.sungMidi === null ? '没唱' : midiToName(n.sungMidi),
      偏差音分: n.cents === null ? null : Math.round(n.cents),
      入拍偏差毫秒: n.timing === null ? null : Math.round(n.timing * 1000),
    }));

  const prev = history[0];
  const accs = history.map((h) => h.accuracy).filter((x): x is number => x !== null);
  let trend = '还没有足够的历史数据';
  if (accs.length >= 2) {
    const d = (r.intonation.accuracy.score ?? accs[0]) - accs[accs.length - 1];
    trend = d > 4 ? `比最早一次高了 ${Math.round(d)} 分` : d < -4 ? `比最早一次低了 ${Math.round(-d)} 分` : '基本持平';
  }

  return {
    歌曲: r.refTitle,
    移调: r.transpose,
    时长秒: Math.round(r.duration),
    综合分: r.overall,
    录音质量: r.quality.summary,
    指标: {
      音准: m(r.intonation.accuracy),
      命中率: m(r.intonation.hitRate),
      稳定性: m(r.intonation.stability),
      高音: m(r.intonation.highNotes),
      ...(r.rhythm ? { 节奏一致性: m(r.rhythm.timing), 节奏离散度: m(r.rhythm.steadiness) } : {}),
    },
    音域: r.intonation.range
      ? `${midiToName(r.intonation.range.lo)}~${midiToName(r.intonation.range.hi)}（舒适区 ${midiToName(r.intonation.range.comfortLo)}~${midiToName(r.intonation.range.comfortHi)}）`
      : null,
    节奏说明: r.rhythm?.notice ?? null,
    问题清单: r.findings.map((f) => ({
      类型: f.kind,
      严重度: Math.round(f.severity * 100) / 100,
      问题: f.title,
      证据: f.evidence,
    })),
    段落表现: r.sections.map((s) => ({
      段落: s.name,
      平均偏差音分: s.accuracy,
      命中率: s.hitRate,
    })),
    最差的几个音: worst,
    声音特征: {
      最长连续发声秒: r.voice.longestNoteSec,
      动态范围dB: r.voice.dynamicRangeDb,
      信噪比dB: r.voice.snrDb,
    },
    历史对比: history.length
      ? { 次数: history.length, 上次综合分: prev?.overall ?? null, 音准趋势: trend }
      : null,
  };
}

/** 系统提示词：告诉模型它的角色、边界和输出格式 */
export function systemPrompt(): string {
  const list = EXERCISES.map((e) => `${e.id}（${e.name}，${e.kind}，${e.minutes}分钟）`).join('、');
  return `你是一位声乐教练，正在给一位业余学唱歌的人讲解他刚才那次演唱的分析结果。

【你的位置】
音频分析已经由算法完成了，所有数字都在输入数据里。你的工作是**解释**，不是测量。
绝对不要自己编造任何数字——凡是出现在你回答里的数值，必须能在输入数据里找到。

【必须遵守的边界】
- 不得判断用户的声带健康、声带闭合、喉部状况、呼吸系统或任何身体状况。这些从一段录音里判断不了。
- 不得承诺「练了就一定能唱到某个音」。
- 不得暗示这份分析等同于专业声乐老师的评估。
- 提到气息时，只能说「长音稳定度」这类可观测的指标，不能说「你的气息支撑不足」这种诊断式判断。

【严禁的表达】
禁止出现这些没有信息量的话：很有潜力、非常不错、继续努力、加油、感情很丰富、情绪很到位、
未来可期、相信自己、天赋不错、整体还可以。
每一句话都要么带着具体数字，要么给出具体动作。做不到就删掉那句话。

【可选练习】
${list}

【输出格式】
只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块标记：
{
  "good": "他这次唱得好的地方，必须引用输入数据里的具体数字",
  "problem": "最大的那个问题，必须带数字",
  "why": "为什么会这样，用大白话讲发声或节奏上的原因，不要术语，2~4 句",
  "drills": [
    {"exerciseId": "上面列表里的 id", "minutes": 建议分钟数, "reason": "为什么给他这条，要对应到上面的问题"}
  ],
  "goal": "下一次的目标，必须是能用同样的指标验证的，带具体数值"
}
drills 给 2~3 条，总时长控制在 15 分钟以内。
全部用中文，语气像一个说话直接、不绕弯子的教练。`;
}
