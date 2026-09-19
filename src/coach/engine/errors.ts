/**
 * 个人错误档案
 *
 * 这是"AI 教练"和"AI 聊天机器人"的分界线。
 *
 * 聊天机器人每次都把你当新用户：你上周在 be 动词上栽过，这周再栽，它还是
 * 用同样的语气讲同样的话。教练会说"这是这个月第四次了，今天专门练这个"。
 * 差别不在模型多聪明，在于有没有把每一次错误落成结构化数据。
 *
 * 所以这一层只做一件事：把散落在测评、对话、写作、口语里的纠错，
 * 按规则 id 聚合成"你反复犯的毛病"，并决定什么时候算"改掉了"。
 */

import type { Correction, ErrorProfile, ErrorRecord } from '../types';
import { RULE_BY_ID } from '../data/patterns';

/** 连续答对几次算改掉了。3 次是个折中：1 次可能是蒙的，5 次又太久看不到进步 */
export const CLEAR_THRESHOLD = 3;

export function emptyProfile(userId: string): ErrorProfile {
  return { userId, records: [], updatedAt: Date.now() };
}

/**
 * 把一批纠错记进档案。
 *
 * 纯函数，返回新的档案对象——这样测试可以直接比对前后两份，
 * 也不会出现"某个页面偷偷改了档案"的情况。
 */
export function recordErrors(profile: ErrorProfile, corrections: Correction[], now = Date.now()): ErrorProfile {
  const records = profile.records.map((r) => ({ ...r, samples: [...r.samples] }));

  for (const c of corrections) {
    let rec = records.find((r) => r.ruleId === c.ruleId);
    if (!rec) {
      rec = {
        ruleId: c.ruleId,
        kind: c.kind,
        label: RULE_BY_ID[c.ruleId]?.label ?? c.problem,
        count: 0,
        firstAt: now,
        lastAt: now,
        samples: [],
        clearedStreak: 0,
      };
      records.push(rec);
    }
    rec.count += 1;
    rec.lastAt = now;
    rec.clearedStreak = 0; // 又犯了，连对清零
    // 只留最近 5 条原话。用用户自己的错句来出练习题，比用教材例句有效得多
    rec.samples.unshift({ original: c.original, fixed: c.fixed, at: now });
    rec.samples = rec.samples.slice(0, 5);
  }

  return { ...profile, records, updatedAt: now };
}

/** 某条规则这次没再犯（专项练习答对了），连对 +1 */
export function recordCleared(profile: ErrorProfile, ruleIds: string[], now = Date.now()): ErrorProfile {
  const records = profile.records.map((r) =>
    ruleIds.includes(r.ruleId) ? { ...r, clearedStreak: r.clearedStreak + 1 } : r,
  );
  return { ...profile, records, updatedAt: now };
}

/** 已经改掉的：连对达到阈值 */
export const isCleared = (r: ErrorRecord): boolean => r.clearedStreak >= CLEAR_THRESHOLD;

/**
 * 当前最该练的毛病。
 *
 * 排序依据（都是真实记录下来的）：
 *   · 犯得多的优先
 *   · 最近犯的优先（三个月前的毛病可能已经自己好了）
 *   · 严重的优先
 * 已经改掉的排除在外——一直拿早就改掉的错误来烦用户，是最容易让人
 * 觉得"这产品不懂我"的设计。
 */
export function topErrors(profile: ErrorProfile, limit = 5, now = Date.now()): ErrorRecord[] {
  const DAY = 24 * 60 * 60 * 1000;
  const score = (r: ErrorRecord): number => {
    const daysAgo = (now - r.lastAt) / DAY;
    const recency = daysAgo <= 3 ? 6 : daysAgo <= 7 ? 4 : daysAgo <= 30 ? 2 : 0;
    const sev = RULE_BY_ID[r.ruleId]?.severity ?? 2;
    return r.count * 2 + recency + sev * 2;
  };
  return profile.records
    .filter((r) => !isCleared(r))
    .sort((a, b) => score(b) - score(a))
    .slice(0, limit);
}

/** 最近改掉的毛病。进步页要展示——只讲问题不讲进步，用户撑不过两周 */
export function clearedErrors(profile: ErrorProfile): ErrorRecord[] {
  return profile.records.filter(isCleared).sort((a, b) => b.lastAt - a.lastAt);
}

/** 按类型统计，用于画"你的错误主要集中在哪" */
export function errorsByKind(profile: ErrorProfile): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of profile.records) out[r.kind] = (out[r.kind] ?? 0) + r.count;
  return out;
}

/**
 * 一句话总结这个人的英语毛病。
 *
 * 显示在首页和能力报告上。必须基于真实统计，不能是"你的语法有待提高"
 * 这种放到谁身上都对的废话。
 */
export function summarize(profile: ErrorProfile): string | undefined {
  const top = topErrors(profile, 3);
  if (!top.length) return undefined;
  const total = profile.records.reduce((s, r) => s + r.count, 0);
  const kinds = errorsByKind(profile);
  const chinglish = (kinds.chinglish ?? 0) + (kinds['word-choice'] ?? 0);
  const grammar = kinds.grammar ?? 0;

  const lead =
    chinglish > grammar
      ? '你的语法基本没问题，卡住你的是"中文思路直接翻过来"'
      : grammar > chinglish * 2
        ? '你的表达意思能到，主要丢分在基础语法形式上'
        : '语法和表达习惯两边都还各有几个固定的坑';

  return `${lead}。累计记录到 ${total} 次，其中最常犯的是「${top[0].label}」（${top[0].count} 次）。`;
}
