/**
 * 录音质量检查。在出评分之前先跑，避免拿一段没声音的录音去打分。
 *
 * 分两档：blocker 直接挡住评分（数据根本不支持），warn 只提醒。
 * 宁可说「这次录音没法评」，也不要给一个看起来很像回事的假分数。
 */

import type { AudioFeatures } from '../dsp/features';
import type { QualityIssue, QualityReport } from './types';

export function checkQuality(f: AudioFeatures, mode: 'song' | 'free' | 'exercise'): QualityReport {
  const issues: QualityIssue[] = [];
  const minSec = mode === 'exercise' ? 1.2 : 2.5;

  if (f.duration < minSec) {
    issues.push({
      kind: 'tooShort',
      severity: 'blocker',
      message: `录音只有 ${f.duration.toFixed(1)} 秒，太短了`,
      fix: `至少唱满 ${minSec} 秒再停，不然采样点不够，任何结论都不可靠。`,
    });
  }

  if (f.voicedRatio < 0.02 || f.voicedSec < 0.5) {
    issues.push({
      kind: 'silent',
      severity: 'blocker',
      message: '整段录音里几乎没有检测到人声',
      fix: '检查一下是不是麦克风被静音了、或者选错了输入设备，然后离手机近一点重录。',
    });
  } else if (f.voicedRatio < 0.15) {
    issues.push({
      kind: 'lowVoiced',
      severity: 'warn',
      message: `只有 ${(f.voicedRatio * 100).toFixed(0)}% 的时间在发声`,
      fix: '大段空白会让统计样本变少。可以把前后多余的静音剪掉，或者唱得连贯一点。',
    });
  }

  if (f.peakDb < -45) {
    issues.push({
      kind: 'tooQuiet',
      severity: 'blocker',
      message: `音量太小（峰值 ${f.peakDb.toFixed(0)} dBFS）`,
      fix: '离麦克风近一些（20~30 厘米），或者调高系统输入音量再录一次。',
    });
  } else if (f.meanDb < -34) {
    issues.push({
      kind: 'tooQuiet',
      severity: 'warn',
      message: `音量偏小（平均 ${f.meanDb.toFixed(0)} dBFS）`,
      fix: '音量小会让音高检测更容易受噪声影响。离麦克风近一点会好很多。',
    });
  }

  if (f.clipRatio > 0.004) {
    issues.push({
      kind: 'clipping',
      severity: 'warn',
      message: `有 ${(f.clipRatio * 100).toFixed(1)}% 的采样点爆音（削波）`,
      fix: '离麦克风远一点，或者把输入增益调低。爆音的地方波形被削平了，音准读数会偏。',
    });
  }

  if (f.snrDb > 0 && f.snrDb < 10 && f.voicedRatio >= 0.02) {
    issues.push({
      kind: 'noisy',
      severity: 'warn',
      message: `环境噪声偏大（信噪比约 ${f.snrDb.toFixed(0)} dB）`,
      fix: '找个安静点的地方；用耳机放伴奏，避免外放的伴奏被一起录进去。',
    });
  }

  if (f.duration > 480) {
    issues.push({
      kind: 'tooLong',
      severity: 'warn',
      message: `录音时长 ${(f.duration / 60).toFixed(1)} 分钟，偏长`,
      fix: '长录音的分析会慢一些，而且问题会被平均掉。建议一次练一到两段。',
    });
  }

  const blocked = issues.some((i) => i.severity === 'blocker');
  const warns = issues.filter((i) => i.severity === 'warn').length;
  const summary = blocked
    ? '这次录音的质量不足以支撑分析结论，先按提示重录一次。'
    : warns
      ? `录音可用，但有 ${warns} 处需要注意，可能轻微影响读数准确度。`
      : '录音质量良好。';

  return { ok: !blocked && !warns, blocked, issues, summary };
}
