/**
 * 第四步：第二轮评价（六维分析）
 *
 * ⚠️ 关于分数：这里算出来的每一个数字都只服务于一件事——**把候选排个序**。
 * 它不是「这个名字客观上值 87 分」。名字好不好最终是人的判断，模型能做的是
 * 把判断需要的依据摆清楚。所以每一维除了分数，都必须给出具体的 notes；
 * 界面上展示的是档位和依据，分数只在内部用。
 */

import type { CharInfo, Dimension, Level, NeedProfile, Risk, SurnameInfo } from '../types';
import { checkRepeat, readTones, sonority } from './pinyin';
import { findAwkward } from './filter';
import { EASY_MISREAD, HARD_TO_WRITE, HOT_CHARS, POLYPHONE, TEMPLATE_PAIRS } from '../data/taboo';

function level(score: number): Level {
  if (score >= 78) return '优';
  if (score >= 62) return '良';
  if (score >= 45) return '一般';
  return '需注意';
}

/**
 * @param good 这一维站得住的地方
 * @param bad  这一维需要提醒的地方
 */
function dim(
  key: Dimension['key'],
  label: string,
  score: number,
  notes: string[],
  good: string[] = [],
  bad: string[] = [],
): Dimension {
  const s = Math.max(0, Math.min(100, Math.round(score)));
  return {
    key,
    label,
    score: s,
    level: level(s),
    notes,
    highlight: good[0],
    concern: bad[0],
  };
}

interface Unit {
  c: string;
  sm: string;
  ym: string;
  syl: string;
  tone: number;
}

function units(sur: SurnameInfo | undefined, chars: CharInfo[]): Unit[] {
  const u: Unit[] = [];
  if (sur) {
    u.push({ c: sur.c, sm: sur.sm, ym: sur.ym, syl: sur.syl, tone: sur.tone });
    if (sur.second) {
      const s2 = sur.second;
      u.push({ c: s2.c, sm: s2.sm, ym: s2.ym, syl: s2.syl, tone: s2.tone });
    }
  }
  for (const c of chars) u.push({ c: c.c, sm: c.sm, ym: c.ym, syl: c.syl, tone: c.tone });
  return u;
}

// ——————————————————— A. 音律 ———————————————————
export function scoreSound(
  sur: SurnameInfo | undefined,
  chars: CharInfo[],
): { d: Dimension; risks: Risk[] } {
  const notes: string[] = [];
  const good: string[] = [];
  const bad: string[] = [];
  const risks: Risk[] = [];
  const u = units(sur, chars);

  if (!sur) {
    notes.push('这个姓不在内置读音表里，下面的分析只针对名字部分，姓名整体是否顺口需要你自己念一遍确认。');
  }

  const tr = readTones(u.map((x) => x.tone));
  notes.push(...tr.notes);
  // readTones 的措辞里，带「不」「容易」「没有」的是提醒，其余是优点
  for (const n of tr.notes) {
    if (/没有起伏|含糊|偏硬|偏急|拖长|发飘/.test(n)) bad.push(n);
    else good.push(n);
  }
  let score = tr.score;

  const reps = checkRepeat(u);
  for (const r of reps) {
    score -= r.penalty;
    notes.push(r.text);
    bad.push(r.text);
    if (r.penalty >= 14) risks.push({ kind: 'homophone', level: 'mid', text: r.text });
  }

  // 收尾的开口度：末字韵母开口越大，喊起来越传得出去
  const last = u[u.length - 1];
  const son = sonority(last.ym);
  if (son >= 5) {
    score += 5;
    const t = `末字「${last.c}」收在开口大的韵母上，叫起来响亮`;
    notes.push(t);
    good.push(t);
  } else if (son <= 2) {
    score -= 4;
    const t = `末字「${last.c}」收在闭口音上，语感偏内敛，喊远了不太传`;
    notes.push(t);
    bad.push(t);
  }

  // 中等风险的谐音在这里提示（高风险的已经在上一轮淘汰了）
  const awk = findAwkward(sur, chars);
  for (const a of awk) {
    score -= 12;
    notes.push(a.how);
    bad.push(a.how);
    risks.push({ kind: 'homophone', level: 'mid', text: `${a.how}，日常称呼时可能被拿来开玩笑` });
  }

  if (notes.length === 0) {
    notes.push('声调与声韵母都没有冲突，念起来顺');
    good.push('声调与声韵母都没有冲突，念起来顺');
  }
  return { d: dim('sound', '音律', score, notes, good, bad), risks };
}

// ——————————————————— B. 字形 ———————————————————
export function scoreGlyph(
  sur: SurnameInfo | undefined,
  chars: CharInfo[],
): { d: Dimension; risks: Risk[] } {
  const notes: string[] = [];
  const good: string[] = [];
  const bad: string[] = [];
  const risks: Risk[] = [];
  let score = 72;

  const strokes = chars.map((c) => c.bh);
  const total = strokes.reduce((a, b) => a + b, 0);
  const surBh = sur ? sur.bh + (sur.second?.bh ?? 0) : 0;

  const maxS = Math.max(...strokes);
  const minS = Math.min(...strokes);

  if (chars.length === 2) {
    const gap = maxS - minS;
    if (gap <= 4) {
      score += 8;
      const t = `两个字笔画 ${strokes.join('、')} 画，轻重相当，写出来不偏`;
      notes.push(t);
      good.push(t);
    } else if (gap >= 10) {
      score -= 10;
      const t = `「${chars[0].c}」${strokes[0]} 画、「${chars[1].c}」${strokes[1]} 画，一密一疏，写出来会一头沉`;
      notes.push(t);
      bad.push(t);
    } else {
      notes.push(`笔画 ${strokes.join('、')} 画，疏密还算能接住`);
    }

    // 结构：两个字结构全一样时字形单调
    if (chars[0].shape === chars[1].shape) {
      const name = { L: '左右', S: '上下', D: '独体', B: '半包围', W: '全包围', P: '品字' }[chars[0].shape];
      score -= 5;
      const t = `两个字都是${name}结构，并排看略显单调`;
      notes.push(t);
      bad.push(t);
    } else {
      score += 5;
      notes.push('两个字结构不同，并排有变化');
      good.push('两个字结构不同，并排有变化');
    }
  }

  if (sur) {
    if (surBh <= 5 && total >= 28) {
      score -= 8;
      const t = `姓「${sur.c}」只有 ${surBh} 画，名字合计 ${total} 画，整体头轻脚重`;
      notes.push(t);
      bad.push(t);
    } else if (surBh >= 12 && total <= 8) {
      score -= 6;
      const t = `姓「${sur.c}」${surBh} 画偏重，名字只有 ${total} 画，整体头重脚轻`;
      notes.push(t);
      bad.push(t);
    } else {
      const t = `姓 ${surBh} 画、名 ${total} 画，整体比例平稳`;
      notes.push(t);
      good.push(t);
    }
  }

  const hard = chars.filter((c) => HARD_TO_WRITE.has(c.c) || c.bh >= 18);
  for (const h of hard) {
    score -= h.bh >= 20 ? 14 : 8;
    notes.push(`「${h.c}」${h.bh} 画，小孩刚学写名字时会比较吃力`);
    bad.push(`「${h.c}」${h.bh} 画，小孩刚学写名字时会比较吃力`);
    risks.push({
      kind: 'stroke',
      level: h.bh >= 20 ? 'high' : 'mid',
      text: `「${h.c}」有 ${h.bh} 画，考试填名字、签字都要多花时间`,
    });
  }

  return { d: dim('glyph', '字形', score, notes, good, bad), risks };
}

// ——————————————————— C. 字义 ———————————————————
export function scoreMeaning(
  chars: CharInfo[],
  p: NeedProfile,
): { d: Dimension; risks: Risk[] } {
  const notes: string[] = [];
  const good: string[] = [];
  const bad: string[] = [];
  const risks: Risk[] = [];
  let score = 70;

  for (const c of chars) notes.push(`「${c.c}」：${c.yi}`);

  if (chars.length === 2) {
    const [a, b] = chars;
    if (a.cat === b.cat) {
      // 同类叠加不一定是坏事，但语义会窄
      score -= 4;
      const t = `两个字都在说「${a.cat}」，含义集中但也偏窄`;
      notes.push(t);
      bad.push(t);
    } else {
      score += 8;
      const t = `「${a.cat}」配「${b.cat}」，两层意思能叠起来，不是同义反复`;
      notes.push(t);
      good.push(t);
    }
    // 一虚一实是中文名里最耐读的搭法
    const abstract = new Set(['品德', '才智', '志向', '情感']);
    const concrete = new Set(['自然', '器物', '光明', '时序']);
    if (
      (abstract.has(a.cat) && concrete.has(b.cat)) ||
      (concrete.has(a.cat) && abstract.has(b.cat))
    ) {
      score += 7;
      notes.push('一个字写实一个字写意，读起来有画面也有寄托');
      good.unshift('一个字写实一个字写意，读起来有画面也有寄托');
    }
  }

  // 家庭期望里出现的词，如果字义能对上，加分并说明
  const wish = p.req.familyWish ?? '';
  if (wish) {
    const hit = chars.filter((c) => wish.includes(c.c) || c.yi.split(/[；;，,]/).some((seg) => seg && wish.includes(seg)));
    if (hit.length) {
      score += 6;
      const t = `「${hit.map((h) => h.c).join('」「')}」正好呼应了你写的家庭期望`;
      notes.push(t);
      good.unshift(t);
    }
  }

  return { d: dim('meaning', '字义', score, notes, good, bad), risks };
}

// ——————————————————— D. 风格 ———————————————————
export function scoreStyle(chars: CharInfo[], p: NeedProfile): Dimension {
  const notes: string[] = [];
  const w = p.styleWeight;
  const tags = new Set<string>();
  for (const c of chars) for (const t of c.tags) tags.add(t);

  let raw = 0;
  let maxPossible = 0;
  const liked: string[] = [];
  const disliked: string[] = [];
  for (const t of tags) {
    const v = w[t] ?? 0;
    raw += v;
    if (v > 0) liked.push(t);
    if (v < 0) disliked.push(t);
  }
  for (const v of Object.values(w)) if (v > 0) maxPossible += v;

  // 没有任何风格偏好时，这一维不该拉开差距
  let score = maxPossible <= 0 ? 68 : 55 + (raw / Math.max(1, maxPossible)) * 40;

  const good: string[] = [];
  const bad: string[] = [];
  if (liked.length) {
    notes.push(`命中你想要的风格：${liked.join('、')}`);
    good.push(`命中你想要的风格：${liked.join('、')}`);
  }
  if (disliked.length) {
    notes.push(`带有你想避开的风格：${disliked.join('、')}`);
    bad.push(`带有你想避开的风格：${disliked.join('、')}`);
    score -= 8;
  }
  if (!liked.length && !disliked.length) {
    const t = [...tags].slice(0, 2).join('、');
    // 用户明确说了想要什么、这个名字却没接上，那是实打实的不足，要说出来；
    // 用户什么都没说时，只是客观描述，不该被当成缺点摆进「可能的不足」里
    const line = maxPossible > 0 ? `整体气质偏${t}，和你说的偏好不在一条线上` : `整体气质偏${t}`;
    notes.push(line);
    if (maxPossible > 0) bad.push(line);
  }

  // 性别适配
  const g = chars.reduce((s, c) => s + c.g, 0) / chars.length;
  if (p.hard.gender === 'boy' && g < -0.8) {
    notes.push('用字偏柔，男孩名里算是偏中性的一路');
    bad.push('用字偏柔，男孩名里算是偏中性的一路');
  }
  if (p.hard.gender === 'girl' && g > 0.8) {
    notes.push('用字偏刚，女孩名里算是偏中性的一路');
    bad.push('用字偏刚，女孩名里算是偏中性的一路');
  }

  // 用户没说偏好时，这一维只是描述，不该被当成优点或缺点摆出来
  return dim('style', '风格', score, notes, good, bad);
}

// ——————————————————— E. 易用性 ———————————————————
export function scoreUsability(
  sur: SurnameInfo | undefined,
  chars: CharInfo[],
): { d: Dimension; risks: Risk[] } {
  const notes: string[] = [];
  const good: string[] = [];
  const bad: string[] = [];
  const risks: Risk[] = [];
  let score = 80;

  for (const c of chars) {
    if (POLYPHONE[c.c]) {
      score -= 12;
      notes.push(`「${c.c}」是多音字：${POLYPHONE[c.c]}`);
      bad.push(`「${c.c}」是多音字，自我介绍时大概率要纠正一次`);
      risks.push({ kind: 'polyphone', level: 'mid', text: `「${c.c}」是多音字，自我介绍时大概率要纠正一次` });
    }
    if (EASY_MISREAD.has(c.c)) {
      score -= 10;
      notes.push(`「${c.c}」不算生僻，但第一次见到的人有不小概率读错`);
      bad.push(`「${c.c}」不算生僻，但第一次见到的人有不小概率读错`);
      risks.push({ kind: 'rare', level: 'mid', text: `「${c.c}」容易被读错` });
    }
    if (c.note) notes.push(`「${c.c}」：${c.note}`);
  }

  if (sur?.note) notes.push(`姓氏提示：${sur.note}`);

  // 姓氏本身有谐音倾向时提醒一次
  if (sur?.puns?.length) {
    notes.push(`姓「${sur.c}」读音接近「${sur.puns.join('」「')}」，搭配用字时已经避开了明显冲突`);
  }

  const totalStroke = chars.reduce((s, c) => s + c.bh, 0);
  if (totalStroke <= 16) {
    score += 6;
    const t = `名字合计 ${totalStroke} 画，签名、填表都省事`;
    notes.push(t);
    good.push(t);
  } else if (totalStroke >= 30) {
    score -= 8;
    const t = `名字合计 ${totalStroke} 画，日常书写偏累`;
    notes.push(t);
    bad.push(t);
  }

  if (notes.length === 0) {
    notes.push('读音写法都没有坑，日常用起来省心');
    good.push('读音写法都没有坑，日常用起来省心');
  }
  return { d: dim('usability', '易用性', score, notes, good, bad), risks };
}

// ——————————————————— F. 独特性 ———————————————————
export function scoreUnique(
  chars: CharInfo[],
): { d: Dimension; risks: Risk[]; commonness: 'low' | 'mid' | 'high' } {
  const notes: string[] = [];
  const good: string[] = [];
  const bad: string[] = [];
  const risks: Risk[] = [];
  let score = 70;

  const hot = chars.filter((c) => HOT_CHARS.has(c.c));
  const freqSum = chars.reduce((s, c) => s + c.freq, 0);
  const avgFreq = freqSum / chars.length;

  if (hot.length === chars.length && chars.length === 2) {
    score -= 34;
    const t = `「${chars[0].c}」「${chars[1].c}」都是近几年的高频用字，两个撞一起很容易重名`;
    notes.push(t);
    bad.push(t);
  } else if (hot.length === 1) {
    score -= 14;
    const t = `「${hot[0].c}」这几年用得多，另一个字把整体拉开了一些`;
    notes.push(t);
    bad.push(t);
  } else if (hot.length === 0) {
    score += 12;
    notes.push('用字都不在近年的高频名单里');
    good.push('用字都不在近年的高频名单里');
  }

  if (chars.length === 2) {
    const isTemplate = TEMPLATE_PAIRS.some(([a, b]) => chars[0].c === a && chars[1].c === b);
    if (isTemplate) {
      score -= 22;
      notes.push('属于模板化组合，换个姓就是另一个常见名字');
      bad.unshift('属于模板化组合，换个姓就是另一个常见名字');
    }
  }

  if (avgFreq <= 0.5) {
    score += 8;
    notes.push('用字偏冷门一些，但都在常用字范围内，不影响读写');
    good.push('用字偏冷门一些，但都在常用字范围内，不影响读写');
  }

  let commonness: 'low' | 'mid' | 'high';
  if (score >= 74) commonness = 'low';
  else if (score >= 52) commonness = 'mid';
  else commonness = 'high';

  const label = { low: '低', mid: '中', high: '高' }[commonness];
  risks.push({
    kind: 'common',
    level: commonness === 'high' ? 'high' : commonness === 'mid' ? 'mid' : 'low',
    text: `常见度风险：${label}。这是基于近年取名用字趋势的估计，不是户籍数据统计——任何人都拿不到真实的全国重名人数。`,
  });

  return { d: dim('unique', '独特性', score, notes, good, bad), risks, commonness };
}

export interface ScoreResult {
  dims: Dimension[];
  risks: Risk[];
  overall: number;
  commonness: 'low' | 'mid' | 'high';
}

/** 六维加权。权重按「用户实际会后悔什么」来定，不是平均分配 */
const WEIGHTS: Record<Dimension['key'], number> = {
  sound: 0.25, // 名字每天都要被念出来，权重最高
  meaning: 0.2,
  style: 0.18,
  usability: 0.17, // 多音字、难写字是长期成本
  unique: 0.12,
  glyph: 0.08,
};

export function scoreCandidate(
  sur: SurnameInfo | undefined,
  chars: CharInfo[],
  p: NeedProfile,
): ScoreResult {
  const sound = scoreSound(sur, chars);
  const glyph = scoreGlyph(sur, chars);
  const meaning = scoreMeaning(chars, p);
  const style = scoreStyle(chars, p);
  const usab = scoreUsability(sur, chars);
  const uniq = scoreUnique(chars);

  const dims = [sound.d, meaning.d, glyph.d, style, usab.d, uniq.d];
  const risks = [...sound.risks, ...glyph.risks, ...meaning.risks, ...usab.risks, ...uniq.risks];

  let overall = 0;
  for (const d of dims) overall += d.score * WEIGHTS[d.key];

  // 五行只在这里，以一个很小的权重参与——它永远翻不动音律和字义的盘
  if (p.soft.wuxing?.length) {
    const hit = chars.filter((c) => p.soft.wuxing!.includes(c.wx)).length;
    overall += hit * 1.5;
  }

  return { dims, risks, overall, commonness: uniq.commonness };
}
