/**
 * 成长观察 · 纯逻辑测试：日期、健康节点到期、发育对照年龄段、备份读取与合并、
 * 时间线筛选。存储和界面在 tests/ui/grow.mjs 里用真浏览器测。
 */
import { describe, expect, it } from 'vitest';
import { addDays, addMonths, ageOn, daysBetween, formatDay, isValidDate, shiftMonth, todayStr } from '../src/grow/dates';
import { dueInfo, markDone, PRESET_HEALTH, sortHealth } from '../src/grow/health';
import { evaluate, GROUPS, phaseOf, REGRESSION_ID } from '../src/grow/milestones';
import { BackupError, buildBackup, describe as describeBackup, mergeData, parseBackup, shouldRemind } from '../src/grow/backup';
import { filterEntries } from '../src/grow/query';
import type { Entry, HealthItem, JournalData, MilestoneMark } from '../src/grow/types';

const entry = (over: Partial<Entry>): Entry => ({
  id: 'e1',
  date: '2026-09-10',
  text: '自己穿好了鞋',
  tags: ['selfcare'],
  first: false,
  createdAt: 1000,
  updatedAt: 1000,
  ...over,
});

const health = (over: Partial<HealthItem>): HealthItem => ({
  id: 'h1',
  name: '牙科',
  mode: 'interval',
  lastDate: '',
  intervalMonths: null,
  nextDate: '',
  note: '',
  updatedAt: 1,
  ...over,
});

const empty = (): JournalData => ({ entries: [], health: [], milestones: [], profile: null });

describe('日期', () => {
  it('校验日期', () => {
    expect(isValidDate('2026-02-28')).toBe(true);
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2028-02-29')).toBe(true);
    expect(isValidDate('2026-13-01')).toBe(false);
    expect(isValidDate('2026-9-1')).toBe(false);
    expect(isValidDate('')).toBe(false);
  });

  it('加月份遇到月底取月底', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15');
  });

  it('天数差、加天数跨月跨年', () => {
    expect(daysBetween('2026-09-28', '2026-10-01')).toBe(3);
    expect(daysBetween('2026-10-01', '2026-09-28')).toBe(-3);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('月份切换与格式', () => {
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(formatDay('2026-09-28')).toBe('9月28日 周一');
    expect(todayStr(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('周岁按日子算，没到生日不算满', () => {
    expect(ageOn('2022-06-15', '2026-06-14')).toEqual({ years: 3, months: 11 });
    expect(ageOn('2022-06-15', '2026-06-15')).toEqual({ years: 4, months: 0 });
    expect(ageOn('2022-06-15', '2026-09-28')).toEqual({ years: 4, months: 3 });
    expect(ageOn('2026-10-01', '2026-09-28')).toBeNull();
  });
});

describe('健康节点', () => {
  const today = '2026-09-28';

  it('按间隔算下次日期；信息不全就是"没填"', () => {
    expect(dueInfo(health({ lastDate: '2026-04-10', intervalMonths: 6 }), today)).toEqual({ due: '2026-10-10', days: 12, state: 'soon' });
    expect(dueInfo(health({ lastDate: '2026-04-10' }), today).state).toBe('unknown');
    expect(dueInfo(health({ intervalMonths: 6 }), today).state).toBe('unknown');
  });

  it('直接填下次日期（疫苗）', () => {
    expect(dueInfo(health({ mode: 'date', nextDate: '2026-09-20' }), today)).toMatchObject({ days: -8, state: 'overdue' });
    expect(dueInfo(health({ mode: 'date', nextDate: '2026-09-28' }), today)).toMatchObject({ days: 0, state: 'soon' });
    expect(dueInfo(health({ mode: 'date', nextDate: '2026-12-28' }), today).state).toBe('later');
    // 直接填日期模式下，间隔字段不起作用
    expect(dueInfo(health({ mode: 'date', lastDate: '2026-01-01', intervalMonths: 1 }), today).state).toBe('unknown');
  });

  it('30 天是"快到期"的边界', () => {
    expect(dueInfo(health({ mode: 'date', nextDate: addDays(today, 30) }), today).state).toBe('soon');
    expect(dueInfo(health({ mode: 'date', nextDate: addDays(today, 31) }), today).state).toBe('later');
  });

  it('排序：已过期（越久越前）→ 快到期 → 以后 → 没填', () => {
    const items = [
      health({ id: 'unknown', name: 'U' }),
      health({ id: 'later', mode: 'date', nextDate: '2027-03-01' }),
      health({ id: 'soon', mode: 'date', nextDate: '2026-10-05' }),
      health({ id: 'over1', mode: 'date', nextDate: '2026-09-20' }),
      health({ id: 'over2', mode: 'date', nextDate: '2026-08-01' }),
    ];
    expect(sortHealth(items, today).map((h) => h.id)).toEqual(['over2', 'over1', 'soon', 'later', 'unknown']);
  });

  it('"今天做过了"：间隔模式改上次日期；日期模式还要清掉下次日期等重填', () => {
    expect(markDone(health({ lastDate: '2026-01-01', intervalMonths: 6 }), today, 5)).toMatchObject({ lastDate: today, updatedAt: 5 });
    expect(markDone(health({ mode: 'date', nextDate: '2026-09-20' }), today, 5)).toMatchObject({ lastDate: today, nextDate: '' });
  });

  it('预置四项 id 固定、时间为 0（任何真实修改都比它新）', () => {
    expect(PRESET_HEALTH.map((h) => h.name)).toEqual(['体检', '视力', '牙科', '疫苗']);
    expect(PRESET_HEALTH.every((h) => h.updatedAt === 0 && h.id.startsWith('preset-'))).toBe(true);
    expect(PRESET_HEALTH.find((h) => h.name === '疫苗')!.mode).toBe('date');
  });
});

describe('发育对照', () => {
  const marks = (list: [string, MilestoneMark['status']][]) => new Map(list.map(([id, status]) => [id, { id, status, updatedAt: 1 }]));

  it('内置 4/5/6 岁各 4 项，文字与筛查表一致', () => {
    expect(GROUPS.map((g) => g.age)).toEqual([4, 5, 6]);
    expect(GROUPS.every((g) => g.items.length === 4)).toBe(true);
    expect(GROUPS[0].items.map((i) => i.text)).toEqual(['会说带形容词的句子', '能按要求等待或轮流', '能自己穿衣服', '能单脚站立']);
  });

  it('年龄段：只对照到当前年龄，以后的不参与', () => {
    expect([4, 5, 6].map((a) => phaseOf(a, 4))).toEqual(['current', 'future', 'future']);
    expect([4, 5, 6].map((a) => phaseOf(a, 5))).toEqual(['past', 'current', 'future']);
    expect([4, 5, 6].map((a) => phaseOf(a, 8))).toEqual(['past', 'past', 'current']);
    expect([4, 5, 6].map((a) => phaseOf(a, 3))).toEqual(['future', 'future', 'future']);
  });

  it('任何一项"还做不到"就建议复查；以后年龄段的不算（避免误报）', () => {
    expect(evaluate(marks([['a4-stand', 'yes']]), 4).needVisit).toEqual([]);
    expect(evaluate(marks([['a4-stand', 'no']]), 4).needVisit.map((i) => i.id)).toEqual(['a4-stand']);
    expect(evaluate(marks([['a5-hop', 'no']]), 4).needVisit).toEqual([]);
    // 5 岁了还做不到 4 岁那项，照样提示
    expect(evaluate(marks([['a4-stand', 'no']]), 5).needVisit.map((i) => i.id)).toEqual(['a4-stand']);
    // 不知道年龄时不下结论
    expect(evaluate(marks([['a4-stand', 'no']]), null).needVisit).toEqual([]);
  });

  it('"不确定"单独列出；倒退那一问任何年龄都看', () => {
    const ev = evaluate(marks([['a4-wait', 'unsure'], [REGRESSION_ID, 'yes']]), null);
    expect(ev.unsure).toEqual([]);
    expect(ev.regression).toBe('yes');
    expect(evaluate(marks([['a4-wait', 'unsure']]), 4).unsure.map((i) => i.id)).toEqual(['a4-wait']);
  });
});

describe('备份', () => {
  const data: JournalData = {
    entries: [entry({}), entry({ id: 'gone', text: '', tags: [], deletedAt: 3000, updatedAt: 3000 })],
    health: [health({ lastDate: '2026-04-10', intervalMonths: 6 })],
    milestones: [{ id: 'a4-stand', status: 'yes', updatedAt: 2 }],
    profile: { birthDate: '2022-06-15', updatedAt: 2 },
  };

  it('导出再读回来，内容不变', () => {
    const text = buildBackup(data, new Date('2026-09-28T02:00:00Z'));
    const parsed = parseBackup(text);
    expect(parsed.data).toEqual(data);
    expect(parsed.exportedAt).toBe('2026-09-28T02:00:00.000Z');
    expect(parsed.skipped).toBe(0);
    expect(describeBackup(parsed.data)).toEqual({ entries: 1, from: '2026-09-10', to: '2026-09-10' });
  });

  it('坏文件、别的文件、新版本文件，都给出人话错误', () => {
    expect(() => parseBackup('{"entries": [')).toThrow(BackupError);
    expect(() => parseBackup('{"hello": 1}')).toThrow('不是"成长观察"的备份文件');
    expect(() => parseBackup(JSON.stringify({ app: 'grow-journal', format: 99 }))).toThrow('更新的版本');
  });

  it('容忍 BOM 和首尾空白（从微信复制回来的文字）', () => {
    const text = '﻿\n  ' + buildBackup(data, new Date()) + '\n\n';
    expect(parseBackup(text).data.entries).toHaveLength(2);
  });

  it('跳过格式不对的条目，未知标签去掉', () => {
    const raw = {
      app: 'grow-journal',
      format: 1,
      entries: [
        entry({ id: 'ok', tags: ['selfcare', 'nope' as never, 'selfcare'] }),
        { id: 'bad-date', date: '2026/09/01', text: 'x', updatedAt: 1 },
        { id: 'no-time', date: '2026-09-01', text: 'x' },
        'junk',
      ],
      milestones: [{ id: 'unknown-item', status: 'yes', updatedAt: 1 }],
    };
    const parsed = parseBackup(JSON.stringify(raw));
    expect(parsed.data.entries.map((e) => e.id)).toEqual(['ok']);
    expect(parsed.data.entries[0].tags).toEqual(['selfcare']);
    expect(parsed.skipped).toBe(4);
  });

  it('合并：缺的补上、较新的覆盖、重复的不变', () => {
    const local: JournalData = { ...empty(), entries: [entry({ id: 'a', text: '旧', updatedAt: 10 }), entry({ id: 'b', updatedAt: 10 })] };
    const incoming: JournalData = {
      ...empty(),
      entries: [entry({ id: 'a', text: '新', updatedAt: 20 }), entry({ id: 'b', updatedAt: 5 }), entry({ id: 'c', updatedAt: 1 })],
    };
    const m = mergeData(local, incoming);
    expect(m.entries.map((e) => [e.id, e.text])).toEqual([
      ['a', '新'],
      ['c', '自己穿好了鞋'],
    ]);
    expect(m.stats).toEqual({ added: 1, updated: 1, removed: 0, others: 0 });
  });

  it('合并：删掉的记录不会因为恢复旧备份又冒出来', () => {
    const local: JournalData = { ...empty(), entries: [entry({ id: 'a', text: '', deletedAt: 50, updatedAt: 50 })] };
    const oldBackup: JournalData = { ...empty(), entries: [entry({ id: 'a', updatedAt: 10 })] };
    expect(mergeData(local, oldBackup).entries).toEqual([]);
    // 反过来：在别处删了，恢复过来这边也删
    const m = mergeData({ ...empty(), entries: [entry({ id: 'a', updatedAt: 10 })] }, local);
    expect(m.stats.removed).toBe(1);
  });

  it('合并：预置健康项不会变成两份；出生日期取较新的', () => {
    const local: JournalData = { ...empty(), health: [...PRESET_HEALTH], profile: { birthDate: '2022-06-15', updatedAt: 5 } };
    const incoming: JournalData = {
      ...empty(),
      health: [{ ...PRESET_HEALTH[2], lastDate: '2026-04-10', intervalMonths: 6, updatedAt: 9 }],
      profile: { birthDate: '2022-06-16', updatedAt: 3 },
    };
    const m = mergeData(local, incoming);
    expect(m.health.map((h) => h.id)).toEqual(['preset-dental']);
    expect(m.profile).toBeNull();
    expect(m.stats.others).toBe(1);
  });

  it('每月提醒：本月导出过或点过"不再提醒"就不提醒；没记录也不提醒', () => {
    const exportedSep = new Date(2026, 8, 3, 10).getTime();
    expect(shouldRemind('2026-09-28', 0, '', true)).toBe(true);
    expect(shouldRemind('2026-09-28', 0, '', false)).toBe(false);
    expect(shouldRemind('2026-09-28', exportedSep, '', true)).toBe(false);
    expect(shouldRemind('2026-10-01', exportedSep, '', true)).toBe(true);
    expect(shouldRemind('2026-10-01', exportedSep, '2026-10', true)).toBe(false);
    expect(shouldRemind('2026-11-01', exportedSep, '2026-10', true)).toBe(true);
  });
});

describe('时间线筛选', () => {
  const list = [
    entry({ id: '1', date: '2026-09-20', text: '第一次自己刷牙', tags: ['selfcare'], first: true }),
    entry({ id: '2', date: '2026-09-18', text: '睡前哭了', tags: ['emotion', 'sleep'] }),
    entry({ id: '3', date: '2026-08-15', text: '和小姐姐轮流玩滑梯', tags: ['social'] }),
    entry({ id: '4', date: '2026-09-10', text: '', deletedAt: 5 }),
  ];
  const f = (over: Partial<Parameters<typeof filterEntries>[1]>) =>
    filterEntries(list, { month: '2026-09', tags: new Set(), firstOnly: false, query: '', ...over }).map((e) => e.id);

  it('按月，不含已删除', () => expect(f({})).toEqual(['1', '2']));
  it('标签多选是"含任一"', () => expect(f({ tags: new Set(['emotion', 'selfcare'] as const) })).toEqual(['1', '2']));
  it('只看第一次', () => expect(f({ firstOnly: true })).toEqual(['1']));
  it('搜索跨月份，也能搜标签名', () => {
    expect(f({ query: '滑梯' })).toEqual(['3']);
    expect(f({ query: '睡眠' })).toEqual(['2']);
    expect(f({ query: '第一次' })).toEqual(['1']);
    expect(f({ query: '哭 睡前' })).toEqual(['2']);
  });
});
