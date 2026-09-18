/**
 * 第一步：需求理解
 *
 * 用户写「希望孩子将来能沉下心做事，别太张扬」，这句话里有信息：偏好沉静、
 * 回避张扬、看重品性胜过看重气势。把这些翻译成引擎能执行的权重和约束，
 * 是整条流水线里最该做好的一步——前面理解错了，后面生成得再多也没用。
 *
 * 这里刻意不做「猜」：拿不准的地方一律记进 unknowns，在结果页如实告诉用户
 * 「这条我没看懂，先按保守方式处理了」。
 */

import type { NamingRequest, NeedProfile, StyleTag, WuXing } from '../types';
import { ALL_STYLES } from '../types';
import { computeBazi, suggestElements } from './bazi';

/** 关键词 → 风格权重。一个词可以同时推高几个风格、压低另一些 */
const KEYWORDS: { words: string[]; up: StyleTag[]; down?: StyleTag[] }[] = [
  { words: ['文雅', '优雅', '雅致', '书卷', '清秀', '秀气'], up: ['清雅', '文艺'] },
  { words: ['大气', '气派', '格局', '大方', '开阔', '有气势'], up: ['大气'], down: ['灵动'] },
  { words: ['温柔', '温和', '柔和', '亲和', '暖'], up: ['温润'], down: ['坚毅'] },
  { words: ['诗意', '有意境', '意境', '浪漫', '唯美'], up: ['诗意', '古典'] },
  { words: ['现代', '洋气', '时尚', '不土', '国际'], up: ['现代', '简洁'], down: ['古典'] },
  { words: ['古典', '古风', '传统', '国学', '古意'], up: ['古典', '诗意'], down: ['现代'] },
  { words: ['聪明', '智慧', '有才', '学问', '读书', '才华'], up: ['智慧'] },
  { words: ['自然', '山水', '草木', '清新', '田园'], up: ['自然', '清雅'] },
  { words: ['简单', '简洁', '好写', '好记', '不复杂', '笔画少'], up: ['简洁'], down: ['古典'] },
  { words: ['坚强', '坚毅', '果断', '有担当', '踏实', '沉稳', '沉下心', '稳重'], up: ['坚毅'], down: ['灵动'] },
  { words: ['阳光', '开朗', '明朗', '乐观', '积极'], up: ['明朗'] },
  { words: ['活泼', '灵动', '机灵', '有灵气', '可爱'], up: ['灵动'], down: ['大气'] },
  { words: ['低调', '不张扬', '内敛', '朴素'], up: ['温润', '简洁'], down: ['大气'] },
  { words: ['独特', '少见', '不撞名', '不重名', '特别'], up: [], down: [] },
];

/** 明确回避的表达 */
const NEGATIVE_MARKERS = ['不要', '别', '不想', '避免', '讨厌', '反感', '忌'];

/** 从自由文本里提取信息。返回权重增量和看不懂的部分 */
function readBrief(text: string): { weight: Record<string, number>; hits: string[]; unique: boolean } {
  const weight: Record<string, number> = {};
  const hits: string[] = [];
  let unique = false;
  if (!text) return { weight, hits, unique };

  // 先按句读切开，逐句判断是正向还是「不要……」
  const clauses = text.split(/[，,。；;！!？?\n、]+/).filter(Boolean);
  for (const cl of clauses) {
    const negated = NEGATIVE_MARKERS.some((n) => cl.includes(n));
    for (const rule of KEYWORDS) {
      const w = rule.words.find((x) => cl.includes(x));
      if (!w) continue;
      hits.push(w);
      if (rule.words === KEYWORDS[KEYWORDS.length - 1].words) {
        unique = !negated;
        continue;
      }
      const sign = negated ? -1 : 1;
      for (const s of rule.up) weight[s] = (weight[s] ?? 0) + 1 * sign;
      for (const s of rule.down ?? []) weight[s] = (weight[s] ?? 0) - 0.6 * sign;
    }
    if (cl.includes('独特') || cl.includes('不重名') || cl.includes('不撞名') || cl.includes('少见')) {
      unique = !negated;
    }
  }
  return { weight, hits, unique };
}

/** 一句话说清用户到底想要什么，结果页会把这句话回显给用户确认 */
function summarizeCore(req: NamingRequest, top: StyleTag[], unique: boolean): string {
  const who =
    req.target === 'baby'
      ? req.gender === 'boy'
        ? '给男孩'
        : req.gender === 'girl'
          ? '给女孩'
          : '给宝宝'
      : req.target === 'rename'
        ? '改名'
        : '起笔名';
  const styleText = top.length ? `偏${top.slice(0, 2).join('、')}` : '风格不设限';
  const lenText = req.nameLength === 1 ? '单字名' : req.nameLength === 2 ? '双字名' : '单双字都可以';
  const extra: string[] = [];
  if (unique) extra.push('尽量避开高频重名');
  if (req.genChar) extra.push(`带辈分字「${req.genChar.c}」`);
  if (req.mustChars.length) extra.push(`必须用「${req.mustChars.join('')}」`);
  if (req.banChars.length) extra.push(`避开「${req.banChars.join('')}」`);
  return `${who}取名，姓${req.surname}，${styleText}，${lenText}${extra.length ? '，' + extra.join('，') : ''}。`;
}

export function understand(req: NamingRequest): NeedProfile {
  const unknowns: string[] = [];
  const weight: Record<string, number> = {};
  for (const s of ALL_STYLES) weight[s] = 0;

  // 1) 显式勾选的风格权重最高——用户点过的按钮比他写的文字更可信
  for (const s of req.likeStyles) weight[s] = (weight[s] ?? 0) + 2;
  for (const s of req.avoidStyles) weight[s] = (weight[s] ?? 0) - 2.5;

  // 2) 自由文本
  const brief = readBrief(req.brief);
  for (const [k, v] of Object.entries(brief.weight)) weight[k] = (weight[k] ?? 0) + v;

  // 3) 气质关键词按同一套词表再过一遍
  const temp = readBrief(req.temperament.join('，'));
  for (const [k, v] of Object.entries(temp.weight)) weight[k] = (weight[k] ?? 0) + v * 0.8;

  // 4) 家庭期望：只用来找风格倾向，不直接变成用字
  const wish = readBrief(req.familyWish ?? '');
  for (const [k, v] of Object.entries(wish.weight)) weight[k] = (weight[k] ?? 0) + v * 0.6;

  // 自由文本里一个关键词都没命中，说明我们没读懂
  const briefText = [req.brief, req.familyWish, ...req.temperament].filter(Boolean).join('');
  if (briefText.length > 4 && brief.hits.length === 0 && temp.hits.length === 0 && wish.hits.length === 0) {
    unknowns.push(
      '你写的要求里没有出现本地引擎认识的风格词，这一轮按通用偏好生成。想更准的话，可以在高级设置里直接勾选风格标签，或者接入 AI 模型来理解这段文字。',
    );
  }

  // 笔名可以更放得开，新生儿名要更保守
  if (req.target === 'penname') {
    weight['诗意'] = (weight['诗意'] ?? 0) + 1;
    weight['古典'] = (weight['古典'] ?? 0) + 0.8;
  }

  const top = ALL_STYLES.filter((s) => (weight[s] ?? 0) > 0).sort((a, b) => weight[b] - weight[a]);

  // 五行：只有用户主动勾选才算，而且必须有出生日期
  let wuxing: WuXing[] | undefined;
  if (req.useWuxing) {
    const b = computeBazi(req.birthDate, req.birthTime);
    if (!b.ok) {
      unknowns.push(b.reason ?? '八字无法推算，五行参考已跳过。');
    } else {
      const sug = suggestElements(b);
      if (sug.length) wuxing = sug;
      else unknowns.push('这个八字里五行分布比较均匀，传统上没有明确要补的方向，所以五行只作展示，不参与排序。');
      if (b.noHour) unknowns.push('没填出生时间，时柱缺失，五行统计基于年月日三柱，会比完整四柱粗一些。');
      if (b.nearBoundary) unknowns.push('出生日期正好在交节前后，月柱可能差一天，五行结论仅供参考。');
    }
  }

  // 笔画上限：想要「好写」的用户，单字笔画压到 12 以内
  const wantsSimple = (weight['简洁'] ?? 0) > 1;
  const maxStroke = wantsSimple ? 12 : req.target === 'baby' ? 17 : 20;

  return {
    req,
    core: summarizeCore(req, top, brief.unique),
    styleWeight: weight,
    hard: {
      banChars: new Set(req.banChars),
      mustChars: req.mustChars.slice(),
      genChar: req.genChar,
      length: req.nameLength,
      gender: req.gender,
    },
    soft: {
      wuxing,
      temperament: req.temperament.slice(),
      preferClassic: req.useClassics,
      maxStroke,
    },
    unknowns,
  };
}

/** 用户是否明确要求避开高频名 */
export function wantsUnique(p: NeedProfile): boolean {
  return readBrief(p.req.brief).unique || readBrief(p.req.familyWish ?? '').unique;
}
