/**
 * 取名引擎自测。
 *
 * 这个产品最容易出的错不是崩溃，而是**悄悄地说了假话**——编一个出处、漏掉一个
 * 禁用字、把生僻字当好字推给用户。这些错误页面上看不出来，只有断言能拦住。
 *
 * 分两层：
 *   1. 数据完整性 —— 字库、典籍库、搭配库自身有没有自相矛盾
 *   2. 引擎行为   —— 各种输入下，引擎有没有违反它自己承诺的约束
 *
 * 标 ★ 的是产品底线，红了就不能发。
 */
import { describe, expect, it } from 'vitest';
import { CHARS, CHAR_MAP } from '../src/naming/data/chars';
import { SOURCES, NAME_SOURCE } from '../src/naming/data/sources';
import { COMBOS } from '../src/naming/data/combos';
import { SURNAMES } from '../src/naming/data/surnames';
import { HOT_NAMES } from '../src/naming/data/taboo';
import { runPipeline } from '../src/naming/engine/index';
import { computeBazi } from '../src/naming/engine/bazi';
import { parseResponse } from '../src/naming/ai/prompt';
import { ALL_STYLES } from '../src/naming/types';
import type { NamingRequest, NamingResult } from '../src/naming/types';

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

function run(over: Partial<NamingRequest>, seed = 42): NamingResult {
  return runPipeline(base(over), { seed });
}

// ══════════════════════ 1. 数据完整性 ══════════════════════

describe('字库', () => {
  it('规模足够', () => expect(CHARS.length).toBeGreaterThanOrEqual(250));

  it('无重复字', () => {
    const seen = new Set<string>();
    const dupes = CHARS.filter((c) => (seen.has(c.c) ? true : (seen.add(c.c), false)));
    expect(dupes.map((c) => c.c), '重复字').toEqual([]);
  });

  it('拼音格式全部合法', () => {
    expect(CHARS.filter((c) => !/^[a-zü]+[1-4]$/.test(c.py)).map((c) => c.c)).toEqual([]);
  });

  it('风格标签全部在枚举内', () => {
    const styles = new Set<string>(ALL_STYLES);
    const bad = CHARS.filter((c) => !c.tags.length || c.tags.some((t) => !styles.has(t)));
    expect(bad.map((c) => c.c)).toEqual([]);
  });

  it('语义类别全部合法（类别写成风格标签是真实发生过的错）', () => {
    const CATS = ['自然', '品德', '才智', '志向', '文艺', '仪态', '情感', '光明', '时序', '器物'];
    expect(CHARS.filter((c) => !CATS.includes(c.cat)).map((c) => `${c.c}(${c.cat})`)).toEqual([]);
  });

  it('笔画数在合理范围', () => {
    expect(CHARS.filter((c) => !(c.bh >= 1 && c.bh <= 30)).map((c) => c.c)).toEqual([]);
  });

  it('每个字都有字义，且不是空话', () => {
    expect(CHARS.filter((c) => !c.yi || c.yi.length < 2).map((c) => c.c)).toEqual([]);
    expect(CHARS.filter((c) => /寓意美好|前程似锦|大气上档次/.test(c.yi)).map((c) => c.c)).toEqual([]);
  });

  it('每个字都有词性', () => {
    expect(CHARS.filter((c) => !['n', 'a', 'v', 'x'].includes(c.pos)).map((c) => c.c)).toEqual([]);
  });
});

describe('典籍库', () => {
  it('★ 出处名字的每个字都出自原句、都在字库里', () => {
    const bad: string[] = [];
    for (const s of SOURCES) {
      for (const n of s.names) {
        for (const ch of n) {
          if (!s.line.includes(ch)) bad.push(`${s.id}: 「${n}」的「${ch}」不在原句里`);
          if (!CHAR_MAP.has(ch)) bad.push(`${s.id}: 「${n}」的「${ch}」不在字库里`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('每条出处都有作品、原句和一句像样的释义', () => {
    expect(SOURCES.every((s) => s.work && s.line && s.note && s.note.length >= 10)).toBe(true);
  });

  it('有出处的名字数量足够', () => expect(NAME_SOURCE.size).toBeGreaterThanOrEqual(20));
});

describe('搭配库', () => {
  it('用字全在字库内', () => {
    expect(COMBOS.filter((c) => [...c.given].some((ch) => !CHAR_MAP.has(ch))).map((c) => c.given)).toEqual([]);
  });
  it('规模足够', () => expect(COMBOS.length).toBeGreaterThanOrEqual(400));
  it('没有已知爆款名', () => {
    expect(COMBOS.filter((c) => HOT_NAMES.has(c.given)).map((c) => c.given)).toEqual([]);
  });
  it('无重复', () => expect(new Set(COMBOS.map((c) => c.given)).size).toBe(COMBOS.length));
});

describe('姓氏表', () => {
  it('覆盖足够', () => expect(SURNAMES.size).toBeGreaterThanOrEqual(120));
  it('复姓有第二个字的读音', () => expect(SURNAMES.get('欧阳')?.second).toBeTruthy());
  it('「吴」被标记为否定式谐音姓', () => expect(SURNAMES.get('吴')?.negates).toBe(true));
  it('「曾」作姓读 zēng', () => expect(SURNAMES.get('曾')?.py).toBe('zeng1'));
  it('「贾」作姓读 jiǎ', () => expect(SURNAMES.get('贾')?.py).toBe('jia3'));
});

// ══════════════════════ 2. 干支五行 ══════════════════════

describe('干支与五行', () => {
  const day = (d: string, t?: string) => {
    const b = computeBazi(d, t);
    return b.pillars ? b.pillars.day.gan + b.pillars.day.zhi : '(失败)';
  };
  it('日柱对照已知值', () => {
    expect(day('2000-01-01')).toBe('戊午'); // 锚点日
    expect(day('2024-06-01', '10:30')).toBe('丙申');
    expect(day('1990-02-03')).toBe('己亥');
  });
  it('2024 年柱为甲辰', () => {
    const b = computeBazi('2024-06-01');
    expect(b.pillars!.year.gan + b.pillars!.year.zhi).toBe('甲辰');
  });
  it('立春前出生算上一年（1990-02-03 → 己巳）', () => {
    const b = computeBazi('1990-02-03');
    expect(b.pillars!.year.gan + b.pillars!.year.zhi).toBe('己巳');
  });
  it('没有生日时明确返回不可算并给出原因', () => {
    const b = computeBazi(undefined);
    expect(b.ok).toBe(false);
    expect(b.reason).toBeTruthy();
  });
  it('超出覆盖年份时明确拒绝', () => expect(computeBazi('1899-01-01').ok).toBe(false));
  it('没填时间时标记时柱缺失', () => expect(computeBazi('2024-06-01').noHour).toBe(true));
});

// ══════════════════════ 3. 引擎行为 · 功能 ══════════════════════

describe('正常输入', () => {
  const r = run({ surname: '周', gender: 'girl', brief: '希望文雅一点，不要太常见' });
  it('能出 8 个以上候选', () => expect(r.candidates.length).toBeGreaterThanOrEqual(8));
  it('每个名字都带上了姓', () => expect(r.candidates.every((c) => c.full.startsWith('周'))).toBe(true));
  it('结果没有重复名字', () => {
    expect(new Set(r.candidates.map((c) => c.full)).size).toBe(r.candidates.length);
  });
  it('每个名字都有一句话评价、寓意、完整六维、优点和不足', () => {
    for (const c of r.candidates) {
      expect(c.oneLine.length, c.full).toBeGreaterThan(8);
      expect(c.meaning.length, c.full).toBeGreaterThan(15);
      expect(c.dims.length, c.full).toBe(6);
      expect(c.pros.length, c.full).toBeGreaterThan(0);
      expect(c.cons.length, c.full).toBeGreaterThan(0);
    }
  });
  it('漏斗记录了各轮情况', () => expect(r.funnel.length).toBeGreaterThanOrEqual(4));
});

describe('空输入与缺失信息', () => {
  it('空需求也能生成', () => expect(run({ surname: '李', brief: '' }).candidates.length).toBeGreaterThan(0));

  it('只有日期没有时间时仍能生成，并如实告知时柱缺失', () => {
    const r = run({ useWuxing: true, birthDate: '2024-06-01', birthTime: '' });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.profile.unknowns.some((u) => u.includes('时柱'))).toBe(true);
    expect(r.candidates.every((c) => !!c.wuxing)).toBe(true);
    expect(r.candidates.every((c) => /不属于现代科学|传统|参考/.test(c.wuxing!.summary))).toBe(true);
  });

  it('勾了五行却没填生日时照常生成，并说明五行为何跳过', () => {
    const r = run({ useWuxing: true });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.profile.unknowns.some((u) => u.includes('出生日期'))).toBe(true);
  });
});

describe('特殊输入', () => {
  it('需求里有特殊字符也不崩', () => {
    expect(run({ surname: '周', brief: '<script>alert(1)</script> 😀 !!!???' }).candidates.length).toBeGreaterThan(0);
  });
  it('姓氏是非汉字时不崩溃，并如实说明音律只分析了名字部分', () => {
    const r = runPipeline(base({ surname: '🙂' }), { seed: 1 });
    expect(Array.isArray(r.candidates)).toBe(true);
    expect(r.profile.unknowns.some((u) => u.includes('读音表'))).toBe(true);
  });
});

describe('复姓', () => {
  const r = run({ surname: '欧阳', gender: 'boy', brief: '大气' });
  it('能生成且完整带出', () => {
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.full.startsWith('欧阳'))).toBe(true);
  });
  it('声调数和拼音数都和字数对得上', () => {
    expect(r.candidates.every((c) => c.tones.length === c.full.length)).toBe(true);
    expect(r.candidates.every((c) => c.pinyin.split(' ').length === c.full.length)).toBe(true);
  });
});

describe('性别', () => {
  it('男孩名避开了强偏女用字', () => {
    const r = run({ gender: 'boy', surname: '王' });
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
    expect(r.candidates.every((c) => c.chars.every((x) => x.g > -2))).toBe(true);
  });
  it('女孩名避开了强偏男用字', () => {
    const r = run({ gender: 'girl', surname: '王' });
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
    expect(r.candidates.every((c) => c.chars.every((x) => x.g < 2))).toBe(true);
  });
  it('不指定性别时避开了强性别倾向用字', () => {
    const r = run({ gender: 'any', surname: '王' });
    expect(r.candidates.length).toBeGreaterThanOrEqual(6);
    expect(r.candidates.every((c) => c.chars.every((x) => Math.abs(x.g) < 2))).toBe(true);
  });
});

describe('用户的硬性约束', () => {
  it('★ 禁用字绝不出现', () => {
    const banned = ['涵', '轩', '梓', '睿', '安'];
    const r = run({ banChars: banned, surname: '陈', count: 12 });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.filter((c) => banned.some((b) => c.given.includes(b))).map((c) => c.full)).toEqual([]);
  });

  it('★ 指定用字一定出现，且候选数量仍然够看', () => {
    const r = run({ mustChars: ['宁'], surname: '张', count: 10 });
    expect(r.candidates.filter((c) => !c.given.includes('宁')).map((c) => c.full)).toEqual([]);
    expect(r.candidates.length).toBeGreaterThanOrEqual(5);
  });

  for (const pos of ['first', 'second'] as const) {
    it(`★ 辈分字固定在第${pos === 'first' ? '一' : '二'}个字`, () => {
      const r = run({ genChar: { c: '文', pos }, surname: '刘', count: 10 });
      const idx = pos === 'first' ? 0 : 1;
      expect(r.candidates.filter((c) => c.given[idx] !== '文').map((c) => c.full)).toEqual([]);
      expect(r.candidates.length).toBeGreaterThanOrEqual(5);
    });
  }

  it('字库里没有的指定字会如实说明，而不是假装分析过', () => {
    expect(run({ mustChars: ['甯'], surname: '张' }).profile.unknowns.some((u) => u.includes('甯'))).toBe(true);
  });

  it('★ 单字名全是一个字', () => {
    const r = run({ nameLength: 1, surname: '林', count: 8 });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.given.length === 1)).toBe(true);
  });

  it('大量限制叠加时仍能给出结果，且每条限制都生效', () => {
    const banned = ['涵', '轩', '梓', '悦', '欣', '若', '诗', '桐', '萱', '瑶'];
    const r = run({
      surname: '李',
      gender: 'girl',
      nameLength: 2,
      banChars: banned,
      mustChars: ['清'],
      likeStyles: ['清雅', '古典'],
      avoidStyles: ['现代'],
      useWuxing: true,
      birthDate: '2024-06-01',
      birthTime: '10:30',
      brief: '文雅、不要太常见、好写',
      count: 10,
    });
    expect(r.candidates.length).toBeGreaterThan(0);
    expect(r.candidates.every((c) => c.given.includes('清'))).toBe(true);
    expect(r.candidates.every((c) => !banned.some((b) => c.given.includes(b)))).toBe(true);
  });

  it('辈分字和禁用字冲突时给空结果，而不是违规硬凑', () => {
    const r = run({ surname: '李', nameLength: 2, genChar: { c: '文', pos: 'first' }, banChars: ['文'] });
    expect(r.candidates).toEqual([]);
  });
});

// ══════════════════════ 4. 引擎行为 · 质量底线 ══════════════════════

describe('质量底线', () => {
  it('★ 结果里没有生僻字', () => {
    const r = run({ surname: '周', count: 12 });
    expect(r.candidates.filter((c) => c.chars.some((x) => x.rare)).map((c) => c.full)).toEqual([]);
  });

  it('★ 五个大姓的结果里都没有已知爆款名', () => {
    for (const sn of ['王', '李', '张', '刘', '陈']) {
      const r = run({ surname: sn, count: 12 });
      expect(r.candidates.filter((c) => HOT_NAMES.has(c.given)).map((c) => c.full), sn).toEqual([]);
    }
  });

  it('★ 没有虚构出处：有出处的名字，每个字都在所引原句里；没出处的明说', () => {
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
    expect(bad).toEqual([]);
  });

  it('★ 没有编造重名人数；常见度明确标注为估计', () => {
    const r = run({ surname: '周', count: 12 });
    const all = r.candidates.flatMap((c) => [c.meaning, c.oneLine, c.fitFor, ...c.pros, ...c.cons, ...c.risks.map((x) => x.text)]);
    expect(all.filter((t) => /(全国|同名|重名)[^。]{0,10}\d+\s*(人|位|个)/.test(t))).toEqual([]);
    expect(r.candidates.every((c) => c.risks.some((x) => x.kind === 'common' && /估计|趋势/.test(x.text)))).toBe(true);
  });

  it('★ 没有把传统命理当成科学承诺', () => {
    const r = run({ useWuxing: true, birthDate: '2024-06-01', birthTime: '08:00', count: 10 });
    const all = r.candidates.flatMap((c) => [c.meaning, c.oneLine, c.fitFor, c.wuxing?.summary ?? '', ...c.pros, ...c.cons]);
    expect(all.filter((t) => /改变命运|保证健康|一定聪明|必然|旺财|升官发财|逢凶化吉|驱邪/.test(t))).toEqual([]);
  });

  it('★ 开启五行后音律水平没有明显下滑（不为补五行牺牲名字）', () => {
    const avg = (r: NamingResult) =>
      r.candidates.reduce((s, c) => s + c.dims.find((d) => d.key === 'sound')!.score, 0) / r.candidates.length;
    const withWx = run({ surname: '周', useWuxing: true, birthDate: '2024-06-01', birthTime: '08:00', count: 10 });
    const noWx = run({ surname: '周', count: 10 });
    expect(avg(withWx), `有五行 ${avg(withWx).toFixed(1)} vs 无五行 ${avg(noWx).toFixed(1)}`).toBeGreaterThanOrEqual(avg(noWx) - 8);
  });

  it('★ 没有空洞套话', () => {
    const r = run({ surname: '周', count: 12 });
    const all = r.candidates.flatMap((c) => [c.oneLine, c.meaning, ...c.pros, ...c.cons]);
    expect(all.filter((t) => /寓意美好|前程似锦|大气上档次|聚天地之灵气|人中龙凤/.test(t))).toEqual([]);
  });

  it('优点里没有负面话，不足里没有正面话', () => {
    const POS = /命中你想要|念起来有高低|轻重相当|结构不同|比例平稳|省事|不在近年的高频|没有冲突|有画面也有寄托|呼应了你/;
    const NEG = /不在一条线上|想避开|一头沉|头轻脚重|单调|吃力|多音字|读错|偏累|高频用字|模板化|含糊|偏硬|偏急|拖长|发飘|没有起伏|同音|发黏|内敛|偏窄/;
    const bad: string[] = [];
    for (const [sn, g, b] of [['李', 'boy', '古典，有出处，大气'], ['周', 'girl', '文雅'], ['吴', 'boy', '简单好写']] as const) {
      for (const c of run({ surname: sn, gender: g, brief: b }, 99).candidates) {
        for (const p of c.pros) if (NEG.test(p)) bad.push(`优点里出现负面话 ${c.full}: ${p}`);
        for (const q of c.cons) if (POS.test(q)) bad.push(`不足里出现正面话 ${c.full}: ${q}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('谐音', () => {
  it('★ 杜 + 子腾 被谐音检查拦下', () => {
    expect(run({ surname: '杜', mustChars: ['子'], count: 12 }).candidates.some((c) => c.given === '子腾')).toBe(false);
  });
  it('★ 吴姓避开了「无X」式否定组合', () => {
    const r = run({ surname: '吴', count: 12 });
    expect(r.candidates.filter((c) => ['德', '能', '理', '用', '良', '情'].includes(c.given[0])).map((c) => c.full)).toEqual([]);
  });
  it('史姓仍能生成结果', () => expect(run({ surname: '史', count: 12 }).candidates.length).toBeGreaterThan(0));
});

describe('结果多样性与可复现', () => {
  it('首字和尾字都足够分散', () => {
    const r = run({ surname: '周', gender: 'girl', count: 10 });
    const n = r.candidates.length;
    expect(new Set(r.candidates.map((c) => c.given[0])).size).toBeGreaterThanOrEqual(n - 2);
    expect(new Set(r.candidates.map((c) => c.given[c.given.length - 1])).size).toBeGreaterThanOrEqual(n - 2);
  });
  it('换一批能换出不同结果；同一个种子结果可复现', () => {
    const a = run({ surname: '周', gender: 'girl' }, 1);
    const b = run({ surname: '周', gender: 'girl' }, 99999);
    const same = a.candidates.filter((x) => b.candidates.some((y) => y.full === x.full)).length;
    expect(same).toBeLessThan(a.candidates.length);
    const c = run({ surname: '周', gender: 'girl' }, 1);
    expect(c.candidates.map((x) => x.full)).toEqual(a.candidates.map((x) => x.full));
  });
  it('★ 没有「动作+动作」这种不成话的组合', () => {
    const r = run({ surname: '周', count: 12 });
    expect(r.candidates.filter((c) => c.chars.length === 2 && c.chars[0].pos === 'v' && c.chars[1].pos === 'v').map((c) => c.full)).toEqual([]);
  });
  it('单次生成耗时可接受', () => {
    const t = Date.now();
    for (let i = 0; i < 20; i++) run({ surname: '周', gender: 'girl' }, i + 1);
    expect((Date.now() - t) / 20).toBeLessThan(400);
  });
});

// ══════════════════════ 5. AI 层 ══════════════════════

describe('AI 层', () => {
  it.each([
    ['{"names":[{"given":"清和"},{"given":"明远"}]}', 2, '标准 JSON'],
    ['```json\n{"names":[{"given":"清和"}]}\n```', 1, 'markdown 代码块'],
    ['好的，这是结果：\n{"names":["清和","明远"]}\n希望有帮助', 2, '前后带废话 + 字符串数组'],
    ['{"names":[{"name":"清和","why":"x"}]}', 1, '用了 name 而不是 given'],
    ['{"names":[]}', 0, '空数组'],
  ])('解析模型输出：%s → %i 个（%s）', (text, n) => {
    expect(parseResponse(text).names.length).toBe(n);
  });

  it('彻底无法解析时抛错（由调用方降级到本地引擎）', () => {
    expect(() => parseResponse('完全不是 JSON')).toThrow();
  });

  it('★ 模型给的名字照样过禁用字检查', () => {
    const r = runPipeline(base({ surname: '周', banChars: ['涵'] }), { seed: 5, injected: [{ given: '子涵' }, { given: '清和' }] });
    expect(r.candidates.some((c) => c.given.includes('涵'))).toBe(false);
  });

  it('★ 模型给的字库外用字被挡下', () => {
    const r = runPipeline(base({ surname: '周' }), { seed: 5, injected: [{ given: '龘龘' }] });
    expect(r.candidates.some((c) => c.given === '龘龘')).toBe(false);
  });
});
