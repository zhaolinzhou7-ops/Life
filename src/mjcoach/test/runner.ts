/**
 * 零依赖测试运行器。
 *
 * 为什么不装 vitest：本仓库的 tools/ 一直是「esbuild 打包 + node 跑」的路子，
 * 加一个测试框架只为了跑几百个纯函数断言，不划算。
 * 更重要的是，产品需求要的输出格式很具体——
 * 规则名称 / 测试案例 / 预期结果 / 实际结果 / PASS·FAIL 一行一条，
 * 自己写反而比改框架的 reporter 简单。
 */

export interface CaseResult {
  suite: string;
  name: string;
  expected: string;
  actual: string;
  pass: boolean;
  error?: string;
}

const results: CaseResult[] = [];
let currentSuite = '未分组';

export function suite(name: string, fn: () => void) {
  const prev = currentSuite;
  currentSuite = name;
  try {
    fn();
  } finally {
    currentSuite = prev;
  }
}

const show = (v: unknown): string => {
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.map(show).join(', ')}]`;
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** 一条用例：期望值 vs 实际值 */
export function check(name: string, expected: unknown, actual: () => unknown) {
  let got: unknown;
  let error: string | undefined;
  try {
    got = actual();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  results.push({
    suite: currentSuite,
    name,
    expected: show(expected),
    actual: error ? `抛错：${error}` : show(got),
    pass: !error && same(expected, got),
    error,
  });
}

/** 期望抛错（非法动作必须被引擎拒绝） */
export function checkThrows(name: string, fn: () => unknown) {
  let threw = false;
  let msg = '';
  try {
    fn();
  } catch (e) {
    threw = true;
    msg = e instanceof Error ? e.message : String(e);
  }
  results.push({
    suite: currentSuite,
    name,
    expected: '拒绝该动作（抛错）',
    actual: threw ? `已拒绝：${msg.slice(0, 40)}` : '竟然通过了',
    pass: threw,
  });
}

/** 只要为真即可的轻断言，说明里写清楚在验什么 */
export function checkTrue(name: string, expected: string, actual: () => boolean) {
  check(name, expected, () => (actual() ? expected : '不成立'));
}

const pad = (s: string, n: number) => {
  // 中文按两个宽度算，不然表格会歪
  let w = 0;
  for (const ch of s) w += ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
  return s + ' '.repeat(Math.max(0, n - w));
};

const clip = (s: string, n: number) => {
  let w = 0;
  let out = '';
  for (const ch of s) {
    const cw = ch.charCodeAt(0) > 0x2e80 ? 2 : 1;
    if (w + cw > n - 1) return out + '…';
    out += ch;
    w += cw;
  }
  return out;
};

export interface RunSummary {
  total: number;
  passed: number;
  failed: number;
  results: CaseResult[];
}

export function report(title: string): RunSummary {
  const failed = results.filter((r) => !r.pass);
  const bySuite = new Map<string, CaseResult[]>();
  for (const r of results) {
    if (!bySuite.has(r.suite)) bySuite.set(r.suite, []);
    bySuite.get(r.suite)!.push(r);
  }

  const W = { name: 46, exp: 26, act: 26 };
  console.log(`\n${title}`);
  console.log('='.repeat(W.name + W.exp + W.act + 10));
  for (const [s, rs] of bySuite) {
    const bad = rs.filter((r) => !r.pass).length;
    console.log(`\n【${s}】 ${rs.length} 例${bad ? `，${bad} 例失败` : '，全部通过'}`);
    console.log(
      `  ${pad('测试案例', W.name)}${pad('预期结果', W.exp)}${pad('实际结果', W.act)}结果`,
    );
    console.log('  ' + '-'.repeat(W.name + W.exp + W.act + 6));
    for (const r of rs) {
      console.log(
        `  ${pad(clip(r.name, W.name), W.name)}${pad(clip(r.expected, W.exp), W.exp)}${pad(
          clip(r.actual, W.act),
          W.act,
        )}${r.pass ? 'PASS' : 'FAIL'}`,
      );
    }
  }

  console.log('\n' + '='.repeat(W.name + W.exp + W.act + 10));
  console.log(`合计 ${results.length} 例：PASS ${results.length - failed.length} · FAIL ${failed.length}`);
  if (failed.length) {
    console.log('\n失败明细：');
    for (const r of failed) {
      console.log(`  ✗ [${r.suite}] ${r.name}`);
      console.log(`      预期：${r.expected}`);
      console.log(`      实际：${r.actual}`);
    }
  }
  return { total: results.length, passed: results.length - failed.length, failed: failed.length, results };
}

export function reset() {
  results.length = 0;
}
