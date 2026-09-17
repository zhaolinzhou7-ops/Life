/**
 * 第五步：解释
 *
 * 用户看到一个名字，真正想知道的是「凭什么是它」。所以这里产出的每句话都必须
 * 挂在具体依据上：哪两个字、什么意思、哪一句原文、哪一处声调。
 *
 * 明令禁止的输出：「寓意美好」「前程似锦」「大气上档次」「聚天地之灵气」。
 * 这类话对决策没有任何帮助，只会让用户觉得所有名字都一样好。
 */

import type { CharInfo, Dimension, NameCandidate, Origin, Risk, StyleTag, SurnameInfo } from '../types';
import { SOURCE_MAP } from '../data/sources';
import type { RawCandidate } from './generate';

/** 「清雅而不柔弱」式的句子，需要每个风格对应一个「过头了会变成什么」 */
const OVERSHOOT: Record<string, string> = {
  清雅: '柔弱',
  大气: '空泛',
  温润: '绵软',
  诗意: '发飘',
  现代: '轻浮',
  古典: '老气',
  智慧: '掉书袋',
  自然: '寡淡',
  简洁: '单薄',
  坚毅: '生硬',
  明朗: '张扬',
  灵动: '跳脱',
  文艺: '做作',
};

/** 稳定的散列，用来在几个句式之间做可复现的选择 */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildOrigin(raw: RawCandidate): Origin {
  if (raw.sourceId) {
    const s = SOURCE_MAP.get(raw.sourceId);
    if (s) {
      return { kind: 'classic', work: s.work, author: s.author, line: s.line, note: s.note };
    }
  }
  return {
    kind: 'modern',
    note: '现代组合名，并无明确的古典原句出处。这不是缺点——大量好名字都是这么来的，只是不必给它编一个来历。',
  };
}

/** 两个字合起来到底在说什么 */
export function buildMeaning(chars: CharInfo[], origin: Origin): string {
  // 只取每个字的第一个义项：完整字义在「逐字来看」里有，塞进这句话会让分号套分号
  const parts = chars.map((c) => `「${c.c}」${c.yi.split(/[；;]/)[0]}`);
  if (chars.length === 1) {
    return `${parts[0]}。单字名，好处是干净、好记，代价是可选的意思少，全压在这一个字上。`;
  }
  const [a, b] = chars;
  const abstract = new Set(['品德', '才智', '志向', '情感']);
  const concrete = new Set(['自然', '器物', '光明', '时序']);

  let joiner: string;
  if (abstract.has(a.cat) && concrete.has(b.cat)) {
    joiner = `前一个字讲的是人该怎么样，后一个字给了一个看得见的东西——不把话说满，意思落在「${b.c}」上。`;
  } else if (concrete.has(a.cat) && abstract.has(b.cat)) {
    joiner = `先用「${a.c}」起了个画面，再用「${b.c}」把话说到人身上，顺序上是由景入情。`;
  } else if (a.cat === b.cat) {
    joiner = `两个字都在说「${a.cat}」，意思是往一个方向叠的，力道集中但覆盖面窄。`;
  } else {
    joiner = `一个字落在${a.cat}上，一个字落在${b.cat}上，两层意思不重复。`;
  }

  const originBit =
    origin.kind === 'classic' && origin.work
      ? `两个字同出${origin.work}的「${origin.line}」，所以这个出处是成立的，不是事后附会的。`
      : '';

  return `${parts.join('，')}。${joiner}${originBit}`;
}

/** 一句话评价。必须是这个名字独有的判断，不能换个名字照样成立 */
export function buildOneLine(
  full: string,
  chars: CharInfo[],
  dims: Dimension[],
  origin: Origin,
  tags: StyleTag[],
): string {
  const byKey = Object.fromEntries(dims.map((d) => [d.key, d])) as Record<string, Dimension>;
  const h = hash(full);

  const top = tags[0];
  const over = top ? OVERSHOOT[top] : null;
  const styleBit = top && over ? `${top}而不${over}` : top ? `整体偏${top}` : '风格中性';

  const hasOrigin = origin.kind === 'classic' && !!origin.work;
  const originBit = hasOrigin ? `出处落在${origin.work}` : '';

  const soundD = byKey.sound;
  const soundBit =
    soundD.level === '优'
      ? '连姓一起念很顺'
      : soundD.level === '良'
        ? '连姓念下来没有卡的地方'
        : '读音上有一处小别扭，详情里写了';

  const uniqD = byKey.unique;
  const uniqBit =
    uniqD.level === '优'
      ? '用字避开了近年的高频名'
      : uniqD.level === '需注意'
        ? '但用字偏热门，重名风险要掂量'
        : '常见度中等';

  const usabD = byKey.usability;
  const usabBit = usabD.level === '需注意' ? '，代价是日常读写会多费点事' : '';

  // 有出处时多一组句式可用；没出处就谈名字本身，而不是反复强调它没有来历
  const charBit = chars.map((c) => `「${c.c}」${c.yi.split(/[；;，,]/)[0]}`).join('，');
  const frames = hasOrigin
    ? [
        `${styleBit}，${originBit}，${soundBit}。`,
        `${originBit}；${styleBit}，${uniqBit}${usabBit}。`,
        `${originBit}，${soundBit}，${styleBit}。`,
        `${styleBit}；${charBit}，${originBit}。`,
      ]
    : [
        `${styleBit}，${soundBit}，${uniqBit}。`,
        `${styleBit}；${charBit}，${soundBit}。`,
        `${soundBit}，${styleBit}，${uniqBit}${usabBit}。`,
        `${charBit}；${styleBit}，${soundBit}。`,
      ];
  return frames[h % frames.length];
}

export function buildProsCons(
  dims: Dimension[],
  risks: Risk[],
): { pros: string[]; cons: string[] } {
  const pros: string[] = [];
  const cons: string[] = [];
  for (const d of dims) {
    // 优点和不足都由打分函数自己指定。没指定就说明这一维没什么可说的，跳过
    // 比硬凑一条要好——「可能的不足」底下出现一句夸奖，比留白伤害大得多。
    if ((d.level === '优' || d.level === '良') && d.highlight) {
      pros.push(`${d.label}：${d.highlight}`);
    } else if ((d.level === '一般' || d.level === '需注意') && d.concern) {
      cons.push(`${d.label}：${d.concern}`);
    }
  }
  for (const r of risks) {
    if (r.kind === 'common') continue; // 常见度单独展示，不重复计入不足
    if (r.level === 'high' || r.level === 'mid') cons.push(r.text);
  }
  if (!cons.length) {
    cons.push('六个维度里没有明显短板。真要挑，就是它足够稳妥，但不够有个性——想要辨识度更强的名字，可以往用字更冷一些的方向找。');
  }
  return { pros: pros.slice(0, 4), cons: cons.slice(0, 4) };
}

/** 这个名字适合什么样的命名偏好 */
export function buildFitFor(
  chars: CharInfo[],
  dims: Dimension[],
  tags: StyleTag[],
  origin: Origin,
  commonness: 'low' | 'mid' | 'high',
): string {
  const byKey = Object.fromEntries(dims.map((d) => [d.key, d])) as Record<string, Dimension>;
  const bits: string[] = [];

  if (origin.kind === 'classic') bits.push('看重出处要经得起追问');
  else bits.push('不介意名字没有古典来历，更在意本身好不好');

  if (commonness === 'low') bits.push('希望孩子在班里不撞名');
  else if (commonness === 'high') bits.push('不排斥用大家都在用的字');

  const strokes = chars.reduce((s, c) => s + c.bh, 0);
  if (strokes <= 16) bits.push('希望名字好写好认');
  else if (strokes >= 26) bits.push('能接受笔画多一点换更足的分量');

  if (byKey.sound.level === '优') bits.push('把「叫起来顺口」放在第一位');

  const styleBit = tags.length ? `偏好${tags.slice(0, 2).join('、')}一路` : '风格上不设限';
  return `适合${styleBit}、${bits.slice(0, 3).join('、')}的家长。`;
}

/** 名字的风格标签：取用字标签里出现次数最多的几个 */
export function buildTags(chars: CharInfo[]): StyleTag[] {
  const count = new Map<StyleTag, number>();
  for (const c of chars) for (const t of c.tags) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([t]) => t);
}

/** 拼音串，带声调符号 */
export function buildPinyin(sur: SurnameInfo | undefined, chars: CharInfo[], mark: (s: string, t: number) => string): string {
  const out: string[] = [];
  if (sur) {
    out.push(mark(sur.syl, sur.tone));
    if (sur.second) out.push(mark(sur.second.syl, sur.second.tone));
  }
  for (const c of chars) out.push(mark(c.syl, c.tone));
  return out.join(' ');
}

export type { NameCandidate };
