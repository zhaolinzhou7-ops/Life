/**
 * 取名引擎自测
 *
 * 跑法：npm run naming:check
 *
 * 这个文件存在的理由很具体：这个产品最容易出的错不是崩溃，而是**悄悄地
 * 说了假话**——编一个出处、漏掉一个禁用字、把生僻字当好字推给用户。
 * 这些错误页面上看不出来，只有断言能拦住。
 *
 * 所以这里的检查分两层：
 *   1. 数据完整性 —— 字库、典籍库、搭配库自身有没有自相矛盾
 *   2. 引擎行为   —— 各种输入下，引擎有没有违反它自己承诺的约束
 */

import { CHARS, CHAR_MAP, getChar } from '../src/naming/data/chars';
import { SOURCES, NAME_SOURCE } from '../src/naming/data/sources';
import { COMBOS } from '../src/naming/data/combos';
import { SURNAMES } from '../src/naming/data/surnames';
import { HOT_NAMES } from '../src/naming/data/taboo';
import { runPipeline } from '../src/naming/engine/index';
import { computeBazi } from '../src/naming/engine/bazi';
import { parseResponse } from '../src/naming/ai/prompt';
import { ALL_STYLES } from '../src/naming/types';
import type { NamingRequest, NamingResult } from '../src/naming/types';

let pass = 0;
const failures: string[] = [];

function ok(cond: boolean, label: string, detail = '') {
  if (cond) {
    pass++;
  } else {
    failures.push(`${label}${detail ? ' —— ' + detail : ''}`);
  }
}

function group(name: string) {
  console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 52 - name.length))}`);
}

function base(over: Partial<NamingRequest> = {}): NamingRequest {
  return {
    surname: '周',
    gender: 'any',
    target: 'baby',
    brief: '',
    likeStyles: [],
    avoidStyles: [],
    mustChars: [],
    banChars: [],
    temperament: [],
    useClassics: true,
    useWuxing: false,
    nameLength: 2,
    count: 10,
    ...over,
  };
}

// ══════════════════════ 1. 数据完整性 ══════════════════════
group('数据完整性');

{
  const styles = new Set<string>(ALL_STYLES);
  const dupes: string[] = [];
  const seen = new Set<string>();
  let badPy = 0;
  let badTag = 0;
  let badStroke = 0;

  for (const c of CHARS) {
    if (seen.has(c.c)) dupes.push(c.c);
    seen.add(c.c);
    if (!/^[a-zü]+[1-4]$/.test(c.py)) badPy++;
    if (!c.tags.length || c.tags.some((t) => !styles.has(t))) badTag++;
    if (!(c.bh >= 1 && c.bh <= 30)) badStroke++;
  }

  ok(CHARS.length >= 250, '字库规模足够', `实际 ${CHARS.length} 字`);
  ok(dupes.length === 0, '字库无重复字', dupes.join(' '));
  ok(badPy === 0, '拼音格式全部合法', `${badPy} 条不合法`);
  ok(badTag === 0, '风格标签全部在枚举内', `${badTag} 条越界`);
  ok(badStroke === 0, '笔画数在合理范围', `${badStroke} 条异常`);
  ok(
    CHARS.every((c) => c.yi && c.yi.length >= 2),
    '每个字都有字义',
    CHARS.filter((c) => !c.yi || c.yi.length < 2).map((c) => c.c).join(' '),
  );
  ok(
    CHARS.every((c) => ['n', 'a', 'v', 'x'].includes(c.pos)),
    '每个字都有词性',
    CHARS.filter((c) => !['n', 'a', 'v', 'x'].includes(c.pos)).map((c) => c.c).join(' '),
  );
  const CATS = ['自然', '品德', '才智', '志向', '文艺', '仪态', '情感', '光明', '时序', '器物'];
  ok(
    CHARS.every((c) => CATS.includes(c.cat)),
    '每个字的语义类别都合法',
    CHARS.filter((c) => !CATS.includes(c.cat)).map((c) => `${c.c}(${c.cat})`).join(' '),
  );
  ok(
    !CHARS.some((c) => /寓意美好|前程似锦|大气上档次/.test(c.yi)),
    '字义里没有空话套话',
  );
}

{
  // 这是全项目最重要的一条断言：出处不能是编的
  const bad: string[] = [];
  for (const s of SOURCES) {
    for (const n of s.names) {
      for (const ch of n) {
        if (!s.line.includes(ch)) bad.push(`${s.id}: 「${n}」的「${ch}」不在原句里`);
        if (!CHAR_MAP.has(ch)) bad.push(`${s.id}: 「${n}」的「${ch}」不在字库里`);
      }
    }
  }
  ok(bad.length === 0, '★ 出处名字的每个字都出自原句', bad.slice(0, 3).join('; '));
  ok(
    SOURCES.every((s) => s.work && s.line && s.note),
    '每条出处都有作品、原句和释义',
  );
  ok(
    SOURCES.every((s) => s.note.length >= 10),
    '出处释义不是一句空话',
  );
  ok(NAME_SOURCE.size >= 20, '有出处的名字数量足够', `实际 ${NAME_SOURCE.size} 个`);
}

{
  const bad = COMBOS.filter((c) => [...c.given].some((ch) => !CHAR_MAP.has(ch)));
  ok(bad.length === 0, '搭配库用字全在字库内', bad.map((b) => b.given).join(' '));
  ok(COMBOS.length >= 400, '搭配库规模足够', `实际 ${COMBOS.length} 条`);
  const hot = COMBOS.filter((c) => HOT_NAMES.has(c.given));
  ok(hot.length === 0, '搭配库里没有已知爆款名', hot.map((h) => h.given).join(' '));
  const dup = COMBOS.length !== new Set(COMBOS.map((c) => c.given)).size;
  ok(!dup, '搭配库无重复');
}

{
  ok(SURNAMES.size >= 120, '姓氏表覆盖足够', `实际 ${SURNAMES.size} 个`);
  ok(!!SURNAMES.get('欧阳')?.second, '复姓有第二个字的读音');
  ok(SURNAMES.get('吴')?.negates === true, '「吴」被标记为否定式谐音姓');
  ok(SURNAMES.get('曾')?.py === 'zeng1', '「曾」作姓读 zēng');
  ok(SURNAMES.get('贾')?.py === 'jia3', '「贾」作姓读 jiǎ');
}

// ══════════════════════ 2. 干支五行 ══════════════════════
group('干支与五行');

{
  const cases: [string, string | undefined, string][] = [
    ['2000-01-01', undefined, '戊午'], // 锚点日
    ['2024-06-01', '10:30', '丙申'],
    ['1990-02-03', undefined, '己亥'],
  ];
  for (const [d, t, expect] of cases) {
    const b = computeBazi(d, t);
    const got = b.pillars ? b.pillars.day.gan + b.pillars.day.zhi : '(失败)';
    ok(got === expect, `${d} 日柱为 ${expect}`, `实际 ${got}`);
  }

  const b1 = computeBazi('2024-06-01');
  ok(b1.pillars?.year.gan + '' + b1.pillars?.year.zhi === '甲辰', '2024 年柱为甲辰');
  const b2 = computeBazi('1990-02-03');
  ok(
    b2.pillars?.year.gan + '' + b2.pillars?.year.zhi === '己巳',
    '立春前出生算上一年（1990-02-03 → 己巳）',
  );
  ok(computeBazi(undefined).ok === false, '没有生日时明确返回不可算');
  ok(!!computeBazi(undefined).reason, '不可算时给出原因');
  ok(computeBazi('1899-01-01').ok === false, '超出覆盖年份时明确拒绝');
  ok(computeBazi('2024-06-01').noHour === true, '没填时间时标记时柱缺失');
}

// ══════════════════════ 3. 引擎行为 ══════════════════════
group('引擎行为 · 功能测试');

function run(over: Partial<NamingRequest>, seed = 42): NamingResult {
  return runPipeline(base(over), { seed });
}

// —— 正常输入 ——
{
  const r = run({ surname: '周', gender: 'girl', brief: '希望文雅一点，不要太常见' });
  ok(r.candidates.length >= 8, '正常输入能出 8 个以上候选', `实际 ${r.candidates.length}`);
  ok(r.candidates.every((c) => c.full.startsWith('周')), '每个名字都带上了姓');
  ok(new Set(r.candidates.map((c) => c.full)).size === r.candidates.length, '结果没有重复名字');
  ok(r.candidates.every((c) => c.oneLine.length > 8), '每个名字都有一句话评价');
  ok(r.candidates.every((c) => c.meaning.length > 15), '每个名字都有寓意解释');
  ok(r.candidates.every((c) => c.dims.length === 6), '每个名字都有完整六维');
  ok(r.candidates.every((c) => c.pros.length > 0 && c.cons.length > 0), '优点和不足都不为空');
  ok(r.funnel.length >= 4, '漏斗记录了各轮情况');
}

// —— 空输入 ——
{
  const r = run({ surname: '李', brief: '' });
  ok(r.candidates.length > 0, '空需求也能生成', `实际 ${r.candidates.length}`);
}

// —— 缺少出生时间 ——
{
  const r = run({ useWuxing: true, birthDate: '2024-06-01', birthTime: '' });
  ok(r.candidates.length > 0, '只有日期没有时间时仍能生成');
  ok(
    r.profile.unknowns.some((u) => u.includes('时柱')),
    '缺时辰时如实告知用户',
  );
  ok(r.candidates.every((c) => !!c.wuxing), '勾选五行后每个名字都有五行说明');
  ok(
    r.candidates.every((c) => /不属于现代科学|传统|参考/.test(c.wuxing!.summary)),
    '五行说明里带了文化边界声明',
  );
}

// —— 完全没有出生信息但勾了五行 ——
{
  const r = run({ useWuxing: true });
  ok(r.candidates.length > 0, '勾了五行却没填生日时照常生成');
  ok(
    r.profile.unknowns.some((u) => u.includes('出生日期')),
    '没填生日时说明五行为何跳过',
  );
}

// —— 特殊字符 ——
{
  const r = run({ surname: '周', brief: '<script>alert(1)</script> 😀 !!!???' });
  ok(r.candidates.length > 0, '需求里有特殊字符也不崩');
  const r2 = runPipeline(base({ surname: '🙂' }), { seed: 1 });
  ok(Array.isArray(r2.candidates), '姓氏是非汉字时不崩溃');
  ok(
    r2.profile.unknowns.some((u) => u.includes('读音表')),
    '未知姓氏时如实说明音律只分析了名字部分',
  );
}

// —— 单姓 / 复姓 ——
{
  const r = run({ surname: '欧阳', gender: 'boy', brief: '大气' });
  ok(r.candidates.length > 0, '复姓能生成');
  ok(r.candidates.every((c) => c.full.startsWith('欧阳')), '复姓完整带出');
  ok(r.candidates.every((c) => c.tones.length === c.full.length), '复姓的声调数和字数对得上');
  ok(r.candidates.every((c) => c.pinyin.split(' ').length === c.full.length), '复姓拼音完整');
}

// —— 男 / 女 / 不指定 ——
for (const [g, label] of [['boy', '男孩'], ['girl', '女孩'], ['any', '不指定性别']] as const) {
  const r = run({ gender: g, surname: '王' });
  ok(r.candidates.length >= 6, `${label}能生成足够候选`, `实际 ${r.candidates.length}`);
  if (g === 'boy') {
    ok(r.candidates.every((c) => c.chars.every((x) => x.g > -2)), '男孩名避开了强偏女用字');
  }
  if (g === 'girl') {
    ok(r.candidates.every((c) => c.chars.every((x) => x.g < 2)), '女孩名避开了强偏男用字');
  }
  if (g === 'any') {
    ok(
      r.candidates.every((c) => c.chars.every((x) => Math.abs(x.g) < 2)),
      '不指定性别时避开了强性别倾向用字',
    );
  }
}

// —— 禁用字 ——
{
  const banned = ['涵', '轩', '梓', '睿', '安'];
  const r = run({ banChars: banned, surname: '陈', count: 12 });
  const violated = r.candidates.filter((c) => banned.some((b) => c.given.includes(b)));
  ok(violated.length === 0, '★ 禁用字绝不出现', violated.map((v) => v.full).join(' '));
  ok(r.candidates.length > 0, '有禁用字时仍能生成');
}

// —— 指定用字 ——
{
  const r = run({ mustChars: ['宁'], surname: '张', count: 10 });
  const violated = r.candidates.filter((c) => !c.given.includes('宁'));
  ok(violated.length === 0, '★ 指定用字一定出现', violated.map((v) => v.full).join(' '));
  ok(r.candidates.length >= 5, '指定用字时候选数量仍然够看', `实际 ${r.candidates.length}`);
}

// —— 辈分字 ——
{
  for (const pos of ['first', 'second'] as const) {
    const r = run({ genChar: { c: '文', pos }, surname: '刘', count: 10 });
    const idx = pos === 'first' ? 0 : 1;
    const violated = r.candidates.filter((c) => c.given[idx] !== '文');
    ok(
      violated.length === 0,
      `★ 辈分字固定在${pos === 'first' ? '第一' : '第二'}个字`,
      violated.map((v) => v.full).join(' '),
    );
    ok(r.candidates.length >= 5, `辈分字在${pos}时仍有足够候选`, `实际 ${r.candidates.length}`);
  }
}

// —— 字库里没有的指定字 ——
{
  const r = run({ mustChars: ['甯'], surname: '张' });
  ok(
    r.profile.unknowns.some((u) => u.includes('甯')),
    '字库里没有的指定字会如实说明，而不是假装分析过',
  );
}

// —— 单字名 ——
{
  const r = run({ nameLength: 1, surname: '林', count: 8 });
  ok(r.candidates.length > 0, '单字名能生成');
  ok(r.candidates.every((c) => c.given.length === 1), '★ 单字名全是一个字');
}

// —— 大量限制条件同时施加 ——
{
  const r = run({
    surname: '李',
    gender: 'girl',
    nameLength: 2,
    banChars: ['涵', '轩', '梓', '悦', '欣', '若', '诗', '桐', '萱', '瑶'],
    mustChars: ['清'],
    likeStyles: ['清雅', '古典'],
    avoidStyles: ['现代'],
    useWuxing: true,
    birthDate: '2024-06-01',
    birthTime: '10:30',
    brief: '文雅、不要太常见、好写',
    count: 10,
  });
  ok(r.candidates.length > 0, '大量限制叠加时仍能给出结果', `实际 ${r.candidates.length}`);
  ok(
    r.candidates.every((c) => c.given.includes('清')),
    '多重限制下指定字仍然生效',
  );
  ok(
    r.candidates.every((c) => !['涵', '轩', '梓', '悦', '欣', '若', '诗', '桐', '萱', '瑶'].some((b) => c.given.includes(b))),
    '多重限制下禁用字仍然生效',
  );
}

// —— 矛盾的限制：应当给出空结果而不是硬凑 ——
{
  const r = run({
    surname: '李',
    nameLength: 2,
    genChar: { c: '文', pos: 'first' },
    banChars: ['文'],
  });
  ok(r.candidates.length === 0, '辈分字和禁用字冲突时给空结果，而不是违规硬凑');
}

group('引擎行为 · 质量约束');

// —— 生僻字 ——
{
  const r = run({ surname: '周', count: 12 });
  const rare = r.candidates.filter((c) => c.chars.some((x) => x.rare));
  ok(rare.length === 0, '★ 结果里没有生僻字', rare.map((x) => x.full).join(' '));
}

// —— 爆款名 ——
{
  for (const sn of ['王', '李', '张', '刘', '陈']) {
    const r = run({ surname: sn, count: 12 });
    const hot = r.candidates.filter((c) => HOT_NAMES.has(c.given));
    ok(hot.length === 0, `${sn} 姓结果里没有已知爆款名`, hot.map((h) => h.full).join(' '));
  }
}

// —— 不虚构出处 ——
{
  const r = run({ surname: '周', count: 12, useClassics: true });
  const bad: string[] = [];
  for (const c of r.candidates) {
    if (c.origin.kind !== 'classic') {
      if (!/现代组合/.test(c.origin.note ?? '')) bad.push(`${c.full} 没出处却没说明`);
      continue;
    }
    const src = SOURCES.find((s) => s.work === c.origin.work && s.line === c.origin.line);
    if (!src) {
      bad.push(`${c.full} 的出处不在典籍库里`);
      continue;
    }
    for (const ch of c.given) if (!src.line.includes(ch)) bad.push(`${c.full} 的「${ch}」不在所引原句里`);
  }
  ok(bad.length === 0, '★ 没有虚构出处', bad.slice(0, 3).join('; '));
}

// —— 不虚构重名数据 ——
{
  const r = run({ surname: '周', count: 12 });
  const all = r.candidates.flatMap((c) => [c.meaning, c.oneLine, c.fitFor, ...c.pros, ...c.cons, ...c.risks.map((x) => x.text)]);
  const fake = all.filter((t) => /(全国|同名|重名)[^。]{0,10}\d+\s*(人|位|个)/.test(t));
  ok(fake.length === 0, '★ 没有编造重名人数', fake.slice(0, 2).join(' | '));
  ok(
    r.candidates.every((c) => c.risks.some((x) => x.kind === 'common' && /估计|趋势/.test(x.text))),
    '常见度明确标注为估计而非统计',
  );
}

// —— 不把命理当科学 ——
{
  const r = run({ useWuxing: true, birthDate: '2024-06-01', birthTime: '08:00', count: 10 });
  const all = r.candidates.flatMap((c) => [c.meaning, c.oneLine, c.fitFor, c.wuxing?.summary ?? '', ...c.pros, ...c.cons]);
  const bad = all.filter((t) => /改变命运|保证健康|一定聪明|必然|旺财|升官发财|逢凶化吉|驱邪/.test(t));
  ok(bad.length === 0, '★ 没有把传统命理当成科学承诺', bad.slice(0, 2).join(' | '));
}

// —— 不为五行牺牲名字 ——
{
  const withWx = run({ surname: '周', useWuxing: true, birthDate: '2024-06-01', birthTime: '08:00', count: 10 });
  const noWx = run({ surname: '周', count: 10 });
  const avg = (r: NamingResult) =>
    r.candidates.reduce((s, c) => s + c.dims.find((d) => d.key === 'sound')!.score, 0) / r.candidates.length;
  ok(
    avg(withWx) >= avg(noWx) - 8,
    '★ 开启五行后音律水平没有明显下滑',
    `有五行 ${avg(withWx).toFixed(1)} vs 无五行 ${avg(noWx).toFixed(1)}`,
  );
}

// —— 不输出套话 ——
{
  const r = run({ surname: '周', count: 12 });
  const all = r.candidates.flatMap((c) => [c.oneLine, c.meaning, ...c.pros, ...c.cons]);
  const empty = all.filter((t) => /寓意美好|前程似锦|大气上档次|聚天地之灵气|人中龙凤/.test(t));
  ok(empty.length === 0, '★ 没有空洞套话', empty.slice(0, 2).join(' | '));
}

// —— 谐音 ——
{
  // 「杜」姓 + 「子腾」应当被谐音检查拦住
  const r = run({ surname: '杜', mustChars: ['子'], count: 12 });
  ok(
    !r.candidates.some((c) => c.given === '子腾'),
    '★ 杜 + 子腾 被谐音检查拦下',
  );
  // 「吴」姓不该配出否定式的名字
  const wu = run({ surname: '吴', count: 12 });
  const negated = wu.candidates.filter((c) => ['德', '能', '理', '用', '良', '情'].includes(c.given[0]));
  ok(negated.length === 0, '★ 吴姓避开了「无X」式否定组合', negated.map((x) => x.full).join(' '));
  // 「史」姓
  const shi = run({ surname: '史', count: 12 });
  ok(shi.candidates.length > 0, '史姓仍能生成结果');
}

// —— 结果多样性 ——
{
  const r = run({ surname: '周', gender: 'girl', count: 10 });
  const firsts = new Set(r.candidates.map((c) => c.given[0]));
  const lasts = new Set(r.candidates.map((c) => c.given[c.given.length - 1]));
  ok(firsts.size >= r.candidates.length - 2, '首字足够分散', `${firsts.size}/${r.candidates.length}`);
  ok(lasts.size >= r.candidates.length - 2, '尾字足够分散', `${lasts.size}/${r.candidates.length}`);
}

// —— 换一批确实换了 ——
{
  const a = run({ surname: '周', gender: 'girl' }, 1);
  const b = run({ surname: '周', gender: 'girl' }, 99999);
  const same = a.candidates.filter((x) => b.candidates.some((y) => y.full === x.full)).length;
  ok(same < a.candidates.length, '换一批能换出不同结果', `重合 ${same}/${a.candidates.length}`);
  const c = run({ surname: '周', gender: 'girl' }, 1);
  ok(
    c.candidates.map((x) => x.full).join() === a.candidates.map((x) => x.full).join(),
    '同一个种子结果可复现',
  );
}

// —— 组合成话 ——
{
  const r = run({ surname: '周', count: 12 });
  const bad = r.candidates.filter((c) => {
    if (c.chars.length !== 2) return false;
    const [x, y] = c.chars;
    return x.pos === 'v' && y.pos === 'v';
  });
  ok(bad.length === 0, '★ 没有「动作+动作」这种不成话的组合', bad.map((x) => x.full).join(' '));
}

// —— 性能 ——
{
  const t = Date.now();
  for (let i = 0; i < 20; i++) run({ surname: '周', gender: 'girl' }, i + 1);
  const per = (Date.now() - t) / 20;
  ok(per < 400, '单次生成耗时可接受', `平均 ${per.toFixed(0)}ms`);
}

// ══════════════════════ 4. AI 层 ══════════════════════
group('AI 层');

{
  // 模型返回经常不守规矩，解析必须扛得住
  const cases: [string, number, string][] = [
    ['{"names":[{"given":"清和"},{"given":"明远"}]}', 2, '标准 JSON'],
    ['```json\n{"names":[{"given":"清和"}]}\n```', 1, 'markdown 代码块'],
    ['好的，这是结果：\n{"names":["清和","明远"]}\n希望有帮助', 2, '前后带废话 + 字符串数组'],
    ['{"names":[{"name":"清和","why":"x"}]}', 1, '用了 name 而不是 given'],
    ['{"names":[]}', 0, '空数组'],
  ];
  for (const [text, n, label] of cases) {
    try {
      const p = parseResponse(text);
      ok(p.names.length === n, `解析模型输出：${label}`, `得到 ${p.names.length} 个`);
    } catch (e) {
      ok(false, `解析模型输出：${label}`, String(e));
    }
  }
  let threw = false;
  try {
    parseResponse('完全不是 JSON');
  } catch {
    threw = true;
  }
  ok(threw, '彻底无法解析时抛错（由调用方降级到本地引擎）');
}

{
  // 模型给的名字必须走同一条流水线，不能绕过禁用字
  const r = runPipeline(base({ surname: '周', banChars: ['涵'] }), {
    seed: 5,
    injected: [{ given: '子涵' }, { given: '清和' }],
  });
  ok(!r.candidates.some((c) => c.given.includes('涵')), '★ 模型给的名字照样过禁用字检查');

  const r2 = runPipeline(base({ surname: '周' }), { seed: 5, injected: [{ given: '龘龘' }] });
  ok(!r2.candidates.some((c) => c.given === '龘龘'), '★ 模型给的字库外用字被挡下');
}

// ══════════════════════ 汇总 ══════════════════════
console.log(`\n${'═'.repeat(58)}`);
if (failures.length === 0) {
  console.log(`✅ 全部通过：${pass} 项断言`);
  process.exit(0);
} else {
  console.log(`❌ ${failures.length} 项未通过（通过 ${pass} 项）：\n`);
  for (const f of failures) console.log(`   · ${f}`);
  process.exit(1);
}
