/**
 * 发育预警对照
 *
 * 能力项据国家卫健委《儿童心理行为发育问题预警征象筛查表》整理（4–6 岁部分），
 * 与儿保门诊版本不一致时以门诊为准。
 *
 * 设计红线：只有"能做到 / 还做不到 / 不确定"三种状态；不算达成率、不打分、
 * 不和任何人比较。任何一项"还做不到"就提示去儿保门诊复查，仅此而已。
 *
 * 年龄段怎么对：表里"5 岁"那一列是"满 5 岁还做不到才需要注意"。所以 4 岁的
 * 孩子只对照 4 岁那一列；更大的年龄段先灰着，不参与提醒，免得误报。
 * 已经过了的年龄段照样有效（5 岁了还做不到 4 岁那几项，当然也该去看看）。
 */

import type { MarkStatus, MilestoneMark } from './types';

export interface MilestoneItem {
  id: string;
  text: string;
}

export interface MilestoneGroup {
  age: number;
  items: MilestoneItem[];
}

export const GROUPS: readonly MilestoneGroup[] = [
  {
    age: 4,
    items: [
      { id: 'a4-adjective', text: '会说带形容词的句子' },
      { id: 'a4-wait', text: '能按要求等待或轮流' },
      { id: 'a4-dress', text: '能自己穿衣服' },
      { id: 'a4-stand', text: '能单脚站立' },
    ],
  },
  {
    age: 5,
    items: [
      { id: 'a5-narrate', text: '能简单讲清一件事的经过' },
      { id: 'a5-gender', text: '知道自己是男孩还是女孩' },
      { id: 'a5-chopsticks', text: '会用筷子吃饭' },
      { id: 'a5-hop', text: '会单脚跳' },
    ],
  },
  {
    age: 6,
    items: [
      { id: 'a6-feelings', text: '能说出自己的感受或想法' },
      { id: 'a6-roleplay', text: '会和小伙伴玩角色扮演游戏' },
      { id: 'a6-square', text: '会画正方形' },
      { id: 'a6-run', text: '会跑' },
    ],
  },
];

/** 任何年龄都要问的一项：语言或社交能力倒退。yes = 出现了倒退 */
export const REGRESSION_ID = 'regression';

export const ALL_MILESTONE_IDS = new Set<string>([REGRESSION_ID, ...GROUPS.flatMap((g) => g.items.map((i) => i.id))]);

export type GroupPhase = 'past' | 'current' | 'future';

/**
 * 某个年龄段相对孩子现在的年龄处在哪儿。
 * 当前段 = 不超过孩子周岁的最大一段（7 岁以后仍以 6 岁那段为当前段，表只到 6 岁）。
 */
export function phaseOf(groupAge: number, ageYears: number): GroupPhase {
  const current = Math.max(...GROUPS.filter((g) => g.age <= ageYears).map((g) => g.age), -1);
  if (groupAge === current) return 'current';
  return groupAge < current ? 'past' : 'future';
}

export interface Evaluation {
  /** 标了"还做不到"、且已到年龄的项 → 建议去儿保门诊复查 */
  needVisit: MilestoneItem[];
  /** 标了"不确定"、且已到年龄的项 */
  unsure: MilestoneItem[];
  /** 倒退那一问的回答 */
  regression: MarkStatus | null;
}

export function evaluate(marks: ReadonlyMap<string, MilestoneMark>, ageYears: number | null): Evaluation {
  const needVisit: MilestoneItem[] = [];
  const unsure: MilestoneItem[] = [];
  if (ageYears !== null) {
    for (const g of GROUPS) {
      if (phaseOf(g.age, ageYears) === 'future') continue;
      for (const item of g.items) {
        const s = marks.get(item.id)?.status;
        if (s === 'no') needVisit.push(item);
        else if (s === 'unsure') unsure.push(item);
      }
    }
  }
  return { needVisit, unsure, regression: marks.get(REGRESSION_ID)?.status ?? null };
}
