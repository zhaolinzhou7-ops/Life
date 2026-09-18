/**
 * 最终验收：模拟三类用户，走完整的学习闭环，检查四个问题。
 *
 *   ① 用户能不能知道自己哪里有问题？
 *   ② 用户能不能理解为什么？
 *   ③ 用户知道下一步练什么吗？
 *   ④ 练完之后能看到进步吗？
 *
 * 和单元测试的区别：这里跑的是**纵向**的东西——同一个人唱五次，
 * 数据进档案、档案出计划、计划再回到演唱。单次分析对了，
 * 不代表这个闭环是通的。
 *
 *   npm run acceptance
 */

// ---- 先给数据层垫一个内存版 localStorage，好让档案/计划代码原样跑 ----
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  get length() {
    return mem.size;
  },
  key: (i: number) => [...mem.keys()][i] ?? null,
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, String(v)),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
};

import { analyzePerformance } from '../src/vocal/analysis/performance';
import type { Finding } from '../src/vocal/analysis/types';
import { buildReference, SONG_BY_ID } from '../src/vocal/songs/library';
import { ruleFeedback } from '../src/vocal/ai/rules';
import { EXERCISE_BY_ID } from '../src/vocal/training/exercises';
import { addSession } from '../src/vocal/data/store';
import { summarize } from '../src/vocal/data/types';
import { buildProfile, milestones } from '../src/vocal/data/profile';
import { makeDailyPlan } from '../src/vocal/data/plan';
import { SR, singReference, type SingOpts } from './fake-singer';

let pass = 0;
let fail = 0;
const failures: string[] = [];

function check(cond: boolean, q: string, detail = '') {
  if (cond) {
    pass++;
    console.log(`    \x1b[32m✓\x1b[0m ${q}${detail ? `  \x1b[90m${detail}\x1b[0m` : ''}`);
  } else {
    fail++;
    failures.push(`${q}${detail ? ` (${detail})` : ''}`);
    console.log(`    \x1b[31m✗ ${q}\x1b[0m${detail ? `  ${detail}` : ''}`);
  }
}

const BANNED = ['很有潜力', '非常不错', '继续努力', '感情很丰富', '情绪很到位', '未来可期', '加油'];

interface Persona {
  name: string;
  who: string;
  songId: string;
  /** 五次演唱，毛病逐次减轻——模拟真的在进步 */
  runs: SingOpts[];
  /** 这个人的核心问题应该被识别成哪一类 */
  expect: Finding['kind'][];
  /** 期望在进步小结里看到哪一项提高 */
  expectImprove: string;
}

const PERSONAS: Persona[] = [
  {
    name: '新手',
    who: '刚开始学，音准和节奏都不稳，还经常跟不上漏掉几个音',
    songId: 'star',
    expect: ['flat', 'miss', 'unsteady', 'rush', 'drag'],
    expectImprove: '音准',
    runs: [
      { bias: -85, pitchJitter: 70, timeJitter: 0.22, missRate: 0.22, seed: 1 },
      { bias: -70, pitchJitter: 60, timeJitter: 0.19, missRate: 0.16, seed: 2 },
      { bias: -55, pitchJitter: 45, timeJitter: 0.15, missRate: 0.1, seed: 3 },
      { bias: -38, pitchJitter: 34, timeJitter: 0.11, missRate: 0.05, seed: 4 },
      { bias: -22, pitchJitter: 24, timeJitter: 0.07, missRate: 0.02, seed: 5 },
    ],
  },
  {
    name: '普通爱好者',
    who: '平时爱唱，音准大致过得去，但一到高音就塌下去，自己说不清问题在哪',
    songId: 'birthday',
    expect: ['highNoteFlat', 'rangeLimit'],
    expectImprove: '高音',
    runs: [
      { pitchJitter: 30, highBias: -85, timeJitter: 0.07, seed: 11 },
      { pitchJitter: 28, highBias: -72, timeJitter: 0.07, seed: 12 },
      { pitchJitter: 25, highBias: -58, timeJitter: 0.06, seed: 13 },
      { pitchJitter: 22, highBias: -44, timeJitter: 0.05, seed: 14 },
      { pitchJitter: 20, highBias: -30, timeJitter: 0.05, seed: 15 },
    ],
  },
  {
    name: '有基础的',
    who: '音准没大问题，想知道更细的东西——长音稳不稳、高音扎不扎实、音域有没有涨',
    songId: 'amazing',
    expect: ['unstableLongNote', 'highNoteFlat', 'flat', 'sharp'],
    expectImprove: '稳定性',
    runs: [
      { pitchJitter: 14, drift: 85, timeJitter: 0.04, seed: 21 },
      { pitchJitter: 13, drift: 72, timeJitter: 0.04, seed: 22 },
      { pitchJitter: 12, drift: 58, timeJitter: 0.03, seed: 23 },
      { pitchJitter: 11, drift: 42, timeJitter: 0.03, seed: 24 },
      { pitchJitter: 10, drift: 26, timeJitter: 0.03, seed: 25 },
    ],
  },
];

const wrap = (s: string, indent = '      ') =>
  s.replace(/(.{1,62})(\s|$)/g, `${indent}$1\n`).trimEnd();

for (const p of PERSONAS) {
  mem.clear();
  console.log(`\n${'═'.repeat(66)}`);
  console.log(`\x1b[1m用户类型：${p.name}\x1b[0m`);
  console.log(`  ${p.who}`);
  const song = SONG_BY_ID.get(p.songId)!;
  const ref = buildReference(song);
  console.log(`  练的歌：《${song.name}》，共 ${ref.notes.length} 个音\n`);

  let firstFeedback: ReturnType<typeof ruleFeedback> | null = null;
  let lastFeedback: ReturnType<typeof ruleFeedback> | null = null;
  const findingKinds: string[] = [];

  p.runs.forEach((opts, i) => {
    const audio = singReference(ref, opts);
    const { report } = analyzePerformance(audio, SR, ref, { calibrated: true });
    const fb = ruleFeedback(report);
    findingKinds.push(report.findings[0].kind);
    if (i === 0) firstFeedback = fb;
    if (i === p.runs.length - 1) lastFeedback = fb;

    // 每次相隔一天，这样进步曲线才有时间跨度
    const at = Date.now() - (p.runs.length - 1 - i) * 86400_000;
    const summary = summarize({ ...report, at }, `s${p.name}${i}`, false);
    addSession(summary);

    console.log(
      `  第 ${i + 1} 次　综合 ${String(report.overall ?? '—').padStart(3)} ｜ ` +
        `音准 ${String(report.intonation.accuracy.score ?? '—').padStart(3)} ｜ ` +
        `节奏 ${String(report.rhythm?.timing.score ?? '—').padStart(3)} ｜ ` +
        `稳定 ${String(report.intonation.stability.score ?? '—').padStart(3)} ｜ ` +
        `高音 ${String(report.intonation.highNotes.score ?? '—').padStart(3)} ｜ ` +
        `${report.findings[0].title}`,
    );
  });

  const first = firstFeedback! as ReturnType<typeof ruleFeedback>;
  const last = lastFeedback! as ReturnType<typeof ruleFeedback>;

  // ---------------------------------------------------------------- 第一次唱完，用户看到什么
  console.log(`\n  \x1b[1m第一次唱完，屏幕上告诉他：\x1b[0m`);
  console.log(`    ① 好在哪\n${wrap(first.good)}`);
  console.log(`    ② 最大的问题\n${wrap(first.problem)}`);
  console.log(`    ③ 为什么\n${wrap(first.why)}`);
  console.log(`    ④ 怎么练`);
  for (const d of first.drills) {
    console.log(`      · ${d.name}（${d.minutes} 分钟）：${d.reason}`);
  }
  console.log(`    ⑤ 下次目标\n${wrap(first.goal)}`);

  // ---------------------------------------------------------------- 四个验收问题
  console.log(`\n  \x1b[1m验收：\x1b[0m`);

  // ① 知道哪里有问题
  const hitExpected = findingKinds.some((k) => p.expect.includes(k as Finding['kind']));
  check(hitExpected, '① 能不能知道哪里有问题——识别出了这个人真正的毛病',
    `报出：${[...new Set(findingKinds)].join('、')}`);
  check(/\d/.test(first.problem), '　　问题描述里带具体数字，不是「音准不太好」',
    first.problem.slice(0, 40));

  // ② 理解为什么
  const whyOk = first.why.length >= 30 && !BANNED.some((b) => first.why.includes(b));
  check(whyOk, '② 能不能理解为什么——讲了机理，而且没有一句套话',
    `${first.why.length} 字`);
  const noDiagnosis = !/声带(损伤|闭合)|喉炎|你的肺活量|气息支撑不足/.test(
    [first.good, first.problem, first.why, first.goal].join(''),
  );
  check(noDiagnosis, '　　没有对身体状况下任何诊断式判断');

  // ③ 知道练什么
  check(first.drills.length > 0, '③ 知道下一步练什么——给了具体练习',
    first.drills.map((d) => d.name).join('、'));
  check(
    first.drills.every((d) => EXERCISE_BY_ID.has(d.exerciseId) && d.reason.length > 4),
    '　　每条练习都真实存在，并且说明了为什么给你',
  );
  check(/\d/.test(first.goal), '　　下次目标可以用同一套指标验证', first.goal.slice(0, 46));

  const plan = makeDailyPlan();
  check(plan.items.length > 0 && plan.totalMinutes > 0, '　　今日训练计划排得出来',
    `${plan.totalMinutes} 分钟 / ${plan.items.length} 项：${plan.items.map((i) => i.name).join('、')}`);
  check(
    plan.items.every((i) => i.reason.length > 6),
    '　　计划里每一项都写了为什么给你',
    plan.items[0]?.reason.slice(0, 40),
  );
  check(!!plan.recheck, '　　计划最后会让他再唱一遍同一首（闭环的「再检测」）',
    plan.recheck?.title);

  // ④ 看得到进步
  const ms = milestones();
  const profile = buildProfile();
  check(ms.points.length >= 2, '④ 练完能不能看到进步——有第 1 次 / 第 5 次的对比点',
    `${ms.points.length} 个里程碑`);
  check(/提高了|宽了/.test(ms.summary), '　　进步小结说得出具体提高了多少', ms.summary);
  check(
    ms.summary.includes(p.expectImprove),
    `　　这个人练的是${p.expectImprove}，小结里就体现${p.expectImprove}的变化`,
  );
  const improved = profile.abilities.filter((a) => a.delta !== null && a.delta > 0);
  check(improved.length > 0, '　　能力档案里的趋势箭头是向上的',
    improved.map((a) => `${a.label} +${a.delta}`).join('、'));
  check(
    profile.disclaimer.includes('不是专业声乐等级'),
    '　　同时标明了这些是软件内部指标，不是声乐等级',
  );

  // 最后一次的反馈应该跟着变——不能五次都说同一句话
  const changed = first.problem !== last.problem || first.goal !== last.goal;
  check(changed, '　　练好了以后反馈会跟着变，而不是五次都说同一句',
    `最后一次：${last.problem.slice(0, 36)}`);
}

console.log(`\n${'═'.repeat(66)}`);
if (fail === 0) {
  console.log(`\x1b[32m三类用户全部通过：${pass} 项验收\x1b[0m`);
} else {
  console.log(`\x1b[31m验收未通过 ${fail} 项\x1b[0m，通过 ${pass} 项`);
  for (const f of failures) console.log(`  \x1b[31m·\x1b[0m ${f}`);
  process.exitCode = 1;
}
