/**
 * 测试入口：`npm run mj:test`
 *
 * 除了跑用例，还会把「规则分歧登记表」打出来——
 * 哪条规则各地不一样、我们三套方案分别怎么取的，一眼可查。
 */

import { report } from './runner';
import { runRuleTests } from './rules.test';
import { runAnalysisTests } from './analysis.test';
import { runCoachTests } from './coach.test';
import { DIVERGENCES, listVariants } from '../rules/config';

// 这个文件只在 node 里跑（esbuild 打包后执行），仓库没装 @types/node，
// 只用到一个 exit，声明一下比为它拉一整包类型定义划算。
declare const process: { exit(code: number): void };

/**
 * 画像和牌谱是存在 localStorage 里的，node 里没有这个东西。
 * 给个内存版顶替——测的是逻辑，不是浏览器的存储实现。
 */
const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: (i: number) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
} as Storage;

function printVariants() {
  console.log('\n规则方案（Rule Variants）');
  console.log('='.repeat(88));
  for (const v of listVariants()) {
    console.log(`\n● ${v.name}（${v.id}）`);
    console.log(`  ${v.desc}`);
    console.log(`  常见于：${v.source}`);
    console.log(
      `  换三张 ${v.swap.enabled ? `开（${v.swap.count} 张，${v.swap.directionPick === 'random' ? '方向随机' : '方向固定'}）` : '关'}` +
        ` · 定缺 ${v.lack.enabled ? '开' : '关'}` +
        ` · 玩法 ${{ xuezhan: '血战到底', xueliu: '血流成河', single: '一胡即止' }[v.bloody.mode]}` +
        ` · 起胡 ${v.win.minFan} 番 · 封顶 ${v.fan.cap}` +
        ` · 查花猪 ${v.draw.chaHuaZhu ? `赔 ${v.draw.huaZhuPay}` : '关'}`,
    );
    console.log(`  开启的番型：${v.fan.table.filter((f) => f.enabled).map((f) => `${f.name}×${f.value}`).join('、')}`);
  }

  console.log('\n\n规则分歧登记（同一条规则各地打法不同，必须显式选，不能混用）');
  console.log('='.repeat(88));
  for (const d of DIVERGENCES) {
    console.log(`\n● ${d.topic}：${d.question}`);
    for (const c of d.choices) console.log(`    - ${c.variant}：${c.value}`);
  }
}

printVariants();
runRuleTests();
runAnalysisTests();
runCoachTests();
const summary = report('\n四川麻将规则 / 分析 / 教学 测试报告');
if (summary.failed > 0) process.exit(1);
