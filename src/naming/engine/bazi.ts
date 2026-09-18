/**
 * 传统文化模块：干支与五行
 *
 * ⚠️ 边界声明（这条边界在代码里、在 UI 上都必须守住）：
 *
 *   八字、五行、周易是**传统文化中的命名参考方法**，不是现代科学验证过的
 *   因果预测。这里计算的是一套有明确规则的历法符号，它能告诉你「按传统规则
 *   这个字属什么」，不能告诉你孩子将来会怎样。
 *
 *   所以这个模块产出的一切，在引擎里只作为**软加权**参与排序，永远不会为了
 *   补一个五行而把一个难听、难写、有谐音问题的名字排到前面。
 *
 * 精度说明：节气用通用寿星公式推算，绝大多数年份准确，但在交节当天可能有
 * ±1 天偏差。命中这种情况时会如实标出来，而不是假装精确。
 */

import type { WuXing } from '../types';

const GAN = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];
const ZHI = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];

const GAN_WX: WuXing[] = ['木', '木', '火', '火', '土', '土', '金', '金', '水', '水'];
const ZHI_WX: WuXing[] = ['水', '土', '木', '木', '土', '火', '火', '土', '金', '金', '土', '水'];

/** 十二节（月令分界），按公历月份顺序：小寒起算 */
const JIE = [
  { name: '小寒', m: 1, zhi: 1 }, // 丑月起
  { name: '立春', m: 2, zhi: 2 }, // 寅月起
  { name: '惊蛰', m: 3, zhi: 3 },
  { name: '清明', m: 4, zhi: 4 },
  { name: '立夏', m: 5, zhi: 5 },
  { name: '芒种', m: 6, zhi: 6 },
  { name: '小暑', m: 7, zhi: 7 },
  { name: '立秋', m: 8, zhi: 8 },
  { name: '白露', m: 9, zhi: 9 },
  { name: '寒露', m: 10, zhi: 10 },
  { name: '立冬', m: 11, zhi: 11 },
  { name: '大雪', m: 12, zhi: 0 }, // 子月起
];

/** 寿星公式的 C 常数。索引与 JIE 对应 */
const C20: Record<string, number> = {
  小寒: 6.11, 立春: 4.6295, 惊蛰: 6.3826, 清明: 5.59, 立夏: 6.318, 芒种: 6.5,
  小暑: 7.928, 立秋: 8.35, 白露: 8.44, 寒露: 9.098, 立冬: 8.218, 大雪: 7.9,
};
const C21: Record<string, number> = {
  小寒: 5.4055, 立春: 3.87, 惊蛰: 5.63, 清明: 4.81, 立夏: 5.52, 芒种: 5.678,
  小暑: 7.108, 立秋: 7.5, 白露: 7.646, 寒露: 8.318, 立冬: 7.438, 大雪: 7.18,
};

/** 某年某个节气落在公历几号 */
function jieDay(year: number, name: string): number {
  const c21 = year >= 2000;
  const C = c21 ? C21[name] : C20[name];
  // 2000 年的 1、2 月节气按 20 世纪常数、Y 取 100 计算（寿星公式的已知修正）
  let y = year % 100;
  let cc = C;
  if (year === 2000 && (name === '小寒' || name === '立春')) {
    y = 100;
    cc = C20[name];
  }
  return Math.floor(y * 0.2422 + cc) - Math.floor((y - 1) / 4);
}

export interface Pillar {
  gan: string;
  zhi: string;
  ganWx: WuXing;
  zhiWx: WuXing;
}

export interface BaziResult {
  ok: boolean;
  /** 无法计算时的原因，会原样展示给用户 */
  reason?: string;
  pillars?: { year: Pillar; month: Pillar; day: Pillar; hour?: Pillar };
  /** 五行计数 */
  count?: Record<WuXing, number>;
  /** 完全没有出现的五行 */
  missing?: WuXing[];
  /** 出现最少的五行（不含完全缺失的） */
  weak?: WuXing[];
  /** 日主（日干）的五行 */
  dayMaster?: WuXing;
  /** 交节日附近，月柱可能有一天偏差 */
  nearBoundary?: boolean;
  /** 没填出生时间，时柱缺失 */
  noHour?: boolean;
}

function pillar(ganIdx: number, zhiIdx: number): Pillar {
  const g = ((ganIdx % 10) + 10) % 10;
  const z = ((zhiIdx % 12) + 12) % 12;
  return { gan: GAN[g], zhi: ZHI[z], ganWx: GAN_WX[g], zhiWx: ZHI_WX[z] };
}

/**
 * 排四柱。date 为 YYYY-MM-DD，time 为 HH:mm（可空）
 */
export function computeBazi(date?: string, time?: string): BaziResult {
  if (!date) return { ok: false, reason: '没有填出生日期，无法推算八字。五行参考这一项会跳过。' };
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return { ok: false, reason: '出生日期格式无法识别，五行参考这一项会跳过。' };
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (y < 1901 || y > 2099) {
    return { ok: false, reason: '内置的节气推算只覆盖 1901–2099 年，超出范围就不做推算了。' };
  }

  // —— 月柱：先定这一天属于哪个「月令」 ——
  // 从当月对应的节气看起：没到节气就还算上一个月令
  let zhiIdx = 0;
  let boundaryDay = 0;
  const thisJie = JIE.find((j) => j.m === mo)!;
  const td = jieDay(y, thisJie.name);
  boundaryDay = td;
  if (d >= td) {
    zhiIdx = thisJie.zhi;
  } else {
    const prevM = mo === 1 ? 12 : mo - 1;
    zhiIdx = JIE.find((j) => j.m === prevM)!.zhi;
  }
  const nearBoundary = Math.abs(d - boundaryDay) <= 1;

  // —— 年柱：以立春为界，不是以元旦为界 ——
  const lichun = jieDay(y, '立春');
  const solarYear = mo < 2 || (mo === 2 && d < lichun) ? y - 1 : y;
  const yearIdx = ((solarYear - 1984) % 60 + 60) % 60;
  const yearP = pillar(yearIdx, yearIdx);

  // —— 月干：五虎遁，由年干推正月（寅月）的天干 ——
  const yGan = yearIdx % 10;
  const yinGan = (yGan % 5) * 2 + 2;
  const monthGan = (yinGan + ((zhiIdx - 2 + 12) % 12)) % 10;
  const monthP = pillar(monthGan, zhiIdx);

  // —— 日柱：以 2000-01-01（戊午日，六十甲子第 54）为锚点数天数 ——
  const days = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(2000, 0, 1)) / 86400000);
  let dayIdx = ((54 + days) % 60 + 60) % 60;

  // —— 时柱：五鼠遁 ——
  let hourP: Pillar | undefined;
  let noHour = true;
  const tm = time ? /^(\d{1,2}):(\d{2})$/.exec(time) : null;
  if (tm) {
    noHour = false;
    const hh = Number(tm[1]);
    // 23:00 起算次日子时，日柱进一位（这是目前最通行的做法，也有流派不这样算）
    if (hh === 23) dayIdx = (dayIdx + 1) % 60;
    const hourZhi = Math.floor(((hh + 1) % 24) / 2);
    const dGan = dayIdx % 10;
    const ziGan = (dGan % 5) * 2;
    hourP = pillar(ziGan + hourZhi, hourZhi);
  }
  const dayP = pillar(dayIdx, dayIdx);

  const count: Record<WuXing, number> = { 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 };
  const all = [yearP, monthP, dayP, ...(hourP ? [hourP] : [])];
  for (const p of all) {
    count[p.ganWx]++;
    count[p.zhiWx]++;
  }

  const els: WuXing[] = ['金', '木', '水', '火', '土'];
  const missing = els.filter((e) => count[e] === 0);
  const present = els.filter((e) => count[e] > 0);
  const min = Math.min(...present.map((e) => count[e]));
  const weak = present.filter((e) => count[e] === min);

  return {
    ok: true,
    pillars: { year: yearP, month: monthP, day: dayP, hour: hourP },
    count,
    missing,
    weak,
    dayMaster: dayP.ganWx,
    nearBoundary,
    noHour,
  };
}

/** 传统上常被建议补的五行。返回空数组表示「没有明确指向，不必强补」 */
export function suggestElements(b: BaziResult): WuXing[] {
  if (!b.ok || !b.count) return [];
  if (b.missing && b.missing.length > 0 && b.missing.length <= 2) return b.missing;
  if (b.weak && b.weak.length <= 2) return b.weak;
  return [];
}

/** 一段给用户看的说明。措辞必须守住文化与科学的边界 */
export function describeBazi(b: BaziResult): string[] {
  if (!b.ok) return [b.reason ?? ''];
  const p = b.pillars!;
  const out: string[] = [];
  out.push(
    `按传统干支历，四柱为 ${p.year.gan}${p.year.zhi}年 ${p.month.gan}${p.month.zhi}月 ${p.day.gan}${p.day.zhi}日${
      p.hour ? ` ${p.hour.gan}${p.hour.zhi}时` : ''
    }。`,
  );
  const c = b.count!;
  out.push(`五行分布：金 ${c.金}、木 ${c.木}、水 ${c.水}、火 ${c.火}、土 ${c.土}。`);
  if (b.missing && b.missing.length) out.push(`其中${b.missing.join('、')}未出现。`);
  if (b.noHour) out.push('没有填出生时间，时柱缺失，五行统计只基于年月日三柱，结论会更粗。');
  if (b.nearBoundary) {
    out.push('出生日期正好在交节前后一天，月柱可能有一天的偏差——节气时刻是按通用公式推算的，不是精确天文数据。');
  }
  out.push(
    '说明：民间常讲「缺什么补什么」，专业命理讲的是「扶抑用神」，两者结论经常不一样。这里只给出分布，作为文化层面的参考，不构成对孩子性格、健康、运势的任何预测。',
  );
  return out;
}
