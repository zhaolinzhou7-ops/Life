/**
 * 第三步：第一轮过滤（硬淘汰）
 *
 * 这一轮只做「一票否决」的判断——凡是留下来还得让用户自己去发现问题的，
 * 都不该留下来。被淘汰的理由会统计进漏斗，结果页会告诉用户「本轮筛掉了多少、
 * 为什么」，而不是假装候选池本来就这么小。
 */

import type { CharInfo, NeedProfile, SurnameInfo } from '../types';
import type { RawCandidate } from './generate';
import { AWKWARD_WORDS, BAD_CAT_PAIRS, HOT_NAMES } from '../data/taboo';
import { MOTION_VERBS, NEEDS_OBJECT, getChar, sameGroup } from '../data/chars';

/**
 * 组合是否成话。
 *
 * 中文名的骨架就那么几种：性状+名物（清风）、名物+性状（志远）、动作+名物
 * （怀瑾）、性状+性状（温良）。剩下的搭法多半会产出「看着像名字、念着不是话」
 * 的东西——这正是 AI 取名最常翻车的地方，也是普通用户说不出哪里怪但就是觉得
 * 怪的原因。
 *
 * 返回 null 表示这个组合站得住。
 */
export function checkCombo(chars: CharInfo[]): string | null {
  if (chars.length !== 2) return null;
  const [a, b] = chars;

  if (a.pos === 'v' && b.pos === 'v') {
    return `「${a.c}」「${b.c}」都是动作字，两个动作接在一起不成话`;
  }
  if (a.pos === 'x' && b.pos === 'x') {
    return `「${a.c}」「${b.c}」都是虚字，撑不起一个名字`;
  }
  if (NEEDS_OBJECT.has(a.c) && b.pos !== 'n') {
    return `「${a.c}」后面要跟一个具体的东西才成话，「${b.c}」接不上`;
  }
  if (a.pos === 'n' && b.pos === 'v' && !MOTION_VERBS.has(b.c)) {
    return `「${a.c}」是名物、「${b.c}」是动作，这个顺序读起来不像名字`;
  }
  if (a.pos === 'n' && b.pos === 'n' && !sameGroup(a.c, b.c)) {
    return `「${a.c}」和「${b.c}」是两样不相干的东西，并列起来不成话`;
  }
  return null;
}

export interface DropReason {
  given: string;
  why: string;
}

export interface FilterOutput {
  kept: RawCandidate[];
  dropped: DropReason[];
  /** 按原因归并的统计，给漏斗用 */
  stats: Record<string, number>;
}

/** 姓名的完整音节序列（不带声调），谐音判断全部基于它 */
export function fullSyllables(sur: SurnameInfo | undefined, chars: CharInfo[]): string[] {
  const s: string[] = [];
  if (sur) {
    s.push(sur.syl);
    if (sur.second) s.push(sur.second.syl);
  }
  for (const c of chars) s.push(c.syl);
  return s;
}

/** 在音节序列里找尴尬词。把姓的谐音读法也代入试一遍 */
export function findAwkward(
  sur: SurnameInfo | undefined,
  chars: CharInfo[],
): { word: string; level: 'mid' | 'high'; how: string }[] {
  const out: { word: string; level: 'mid' | 'high'; how: string }[] = [];
  const syls = fullSyllables(sur, chars);
  for (const w of AWKWARD_WORDS) {
    for (let i = 0; i + w.syls.length <= syls.length; i++) {
      let ok = true;
      for (let k = 0; k < w.syls.length; k++) if (syls[i + k] !== w.syls[k]) ok = false;
      if (ok) {
        const span = syls.slice(i, i + w.syls.length).join('');
        out.push({
          word: w.word,
          level: w.level,
          how: `连读「${span}」与「${w.word}」同音`,
        });
      }
    }
  }
  return out;
}

/**
 * 否定式姓氏（吴→无、卜→不）。这类姓最容易翻车的地方是：
 * 名字第一个字越是褒义，被否定之后越难听。「吴德」「卜仁」都是这么来的。
 */
export function findNegation(sur: SurnameInfo | undefined, chars: CharInfo[]): string | null {
  if (!sur?.negates || !sur.puns?.length || !chars.length) return null;
  const first = chars[0];
  const risky = ['品德', '才智', '志向', '情感'];
  if (!risky.includes(first.cat)) return null;
  return `姓「${sur.c}」读音同「${sur.puns[0]}」，「${sur.c}${first.c}」听起来像在否定「${first.c}」这个字本身的意思`;
}

export function filterHard(
  cands: RawCandidate[],
  p: NeedProfile,
  sur: SurnameInfo | undefined,
): FilterOutput {
  const kept: RawCandidate[] = [];
  const dropped: DropReason[] = [];
  const stats: Record<string, number> = {};
  const drop = (c: RawCandidate, why: string, tag: string) => {
    dropped.push({ given: c.given, why });
    stats[tag] = (stats[tag] ?? 0) + 1;
  };

  for (const c of cands) {
    // —— 用户的硬性要求，违反即出局 ——
    if ([...c.given].some((ch) => p.hard.banChars.has(ch))) {
      drop(c, '含有禁用字', '违反禁用字');
      continue;
    }
    if (p.hard.length && c.given.length !== p.hard.length) {
      drop(c, '字数不符合要求', '字数不符');
      continue;
    }
    if (p.hard.genChar) {
      const idx = p.hard.genChar.pos === 'first' ? 0 : c.given.length - 1;
      if (c.given[idx] !== p.hard.genChar.c) {
        drop(c, '辈分字位置不对', '辈分字不符');
        continue;
      }
    }
    if (p.hard.mustChars.length) {
      const hit = p.hard.mustChars.some((m) => c.given.includes(m));
      if (!hit) {
        drop(c, '没有用到指定用字', '未用指定字');
        continue;
      }
    }

    // —— 名字与姓氏重字：叫起来像绕口令 ——
    if (sur && (c.given.includes(sur.c) || (sur.second && c.given.includes(sur.second.c)))) {
      drop(c, '名字里出现了姓氏本身', '与姓重字');
      continue;
    }

    // —— 生僻字：认不出、打不出、一辈子解释不完 ——
    const rare = c.chars.find((x) => x.rare);
    if (rare) {
      drop(c, `「${rare.c}」偏生僻`, '生僻字');
      continue;
    }

    // —— 谐音：高风险直接淘汰，中风险留到评分环节提示 ——
    const awk = findAwkward(sur, c.chars);
    const high = awk.find((a) => a.level === 'high');
    if (high) {
      drop(c, `${high.how}`, '谐音尴尬');
      continue;
    }
    const neg = findNegation(sur, c.chars);
    if (neg) {
      drop(c, neg, '姓氏谐音否定');
      continue;
    }

    // —— 组合本身说不通 ——
    if (c.chars.length === 2) {
      const [a, b] = c.chars;
      if (a.c === b.c) {
        drop(c, '两个字重复', '叠字');
        continue;
      }
      const bad = BAD_CAT_PAIRS.find((x) => x.a === a.cat && x.b === b.cat);
      if (bad) {
        drop(c, bad.why, '组合不自然');
        continue;
      }
      const combo = checkCombo(c.chars);
      if (combo) {
        drop(c, combo, '组合不成话');
        continue;
      }
      // 同音字连用：「思斯」「一亦」这类，写出来是两个字，念出来是一个
      if (a.syl === b.syl) {
        drop(c, '两个字同音，连读分不开', '组合不自然');
        continue;
      }
    }

    // —— 明显的网红爆款名 ——
    if (HOT_NAMES.has(c.given)) {
      drop(c, '近年高频名，重名风险很高', '爆款名');
      continue;
    }

    kept.push(c);
  }

  return { kept, dropped, stats };
}

/**
 * 指定用字/辈分字如果字库里没有，引擎无法分析它的读音字义。
 * 这种情况必须如实说明，不能假装分析过了。
 */
export function unknownChars(p: NeedProfile): string[] {
  const out: string[] = [];
  for (const c of p.hard.mustChars) if (!getChar(c)) out.push(c);
  if (p.hard.genChar && !getChar(p.hard.genChar.c)) out.push(p.hard.genChar.c);
  return out;
}
