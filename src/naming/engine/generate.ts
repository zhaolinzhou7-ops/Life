/**
 * 第二步：候选生成
 *
 * 刻意不做「一次生成一百个」。一百个名字对用户是负担不是福利——真正的工作量
 * 在后面的筛选，生成这一步只负责把「有可能成立」的组合摆到桌面上。
 *
 * 四条来源，按可信度排序：
 *   1. 搭配库   —— 人工筛过的成话组合，是主料
 *   2. 典籍取字 —— 两个字来自同一句真实原文，出处因此是真的
 *   3. 单字名   —— 干净好记，但意思全压在一个字上
 *   4. 自由组合 —— 只在前三条不够用时兜底（比如辈分字把一个位置占死了），
 *                  并且必须过组合成话规则
 */

import type { CharInfo, NeedProfile } from '../types';
import { CHARS, getChar } from '../data/chars';
import { COMBOS, COMBO_CHAR_COUNT, HEAD_CHARS, TAIL_CHARS } from '../data/combos';
import { NAME_SOURCE, SOURCES } from '../data/sources';

export interface RawCandidate {
  given: string;
  chars: CharInfo[];
  /** 来自哪条出处；没有就是纯组合 */
  sourceId?: string;
  from: 'lexicon' | 'classic' | 'combo' | 'must' | 'gen' | 'single';
}

/** 可复现的伪随机，让「换一批」每次不同但同一个种子结果稳定 */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x100000000;
  };
}

/** 这个字和用户的风格偏好有多合。可能为负 */
export function styleAffinity(c: CharInfo, w: Record<string, number>): number {
  let v = 0;
  for (const t of c.tags) v += w[t] ?? 0;
  return v;
}

/** 性别适配：返回 false 表示这个字不该出现在这个性别的名字里 */
function genderOk(c: CharInfo, g: NeedProfile['hard']['gender']): boolean {
  if (g === 'boy') return c.g > -2;
  if (g === 'girl') return c.g < 2;
  return Math.abs(c.g) < 2; // 不指定性别时避开强性别倾向的字
}

/** 挑出这次自由组合可以用的字 */
export function buildPool(p: NeedProfile, rng: () => number): CharInfo[] {
  const { hard, soft, styleWeight } = p;
  const scored: { c: CharInfo; v: number }[] = [];
  for (const c of CHARS) {
    if (hard.banChars.has(c.c)) continue;
    if (c.rare) continue; // 生僻字默认不进池子
    if (!c.comboOk) continue; // 只在原句里取用的字，不参与自由组合
    if (!genderOk(c, hard.gender)) continue;
    if (c.bh > soft.maxStroke) continue;

    let v = styleAffinity(c, styleWeight);
    // 五行只是加分项，绝不做成准入条件——补五行不该以牺牲名字本身为代价
    if (soft.wuxing?.includes(c.wx)) v += 1.2;
    // 高频字不禁用，但要压一压，给冷一点的好字让位
    v -= c.freq * 0.5;
    if (hard.gender === 'boy') v += c.g * 0.25;
    if (hard.gender === 'girl') v += -c.g * 0.25;
    v += rng() * 1.5;
    scored.push({ c, v });
  }
  scored.sort((a, b) => b.v - a.v);
  return scored.slice(0, 96).map((x) => x.c);
}

function pushUnique(map: Map<string, RawCandidate>, cand: RawCandidate) {
  if (!map.has(cand.given)) map.set(cand.given, cand);
}

/** 把一个两字搭配变成候选；字库里查不到字就放弃（不能分析的名字不该给用户） */
function makeFromGiven(
  given: string,
  from: RawCandidate['from'],
  sourceId?: string,
): RawCandidate | null {
  const chars = [...given].map((c) => getChar(c));
  if (chars.some((c) => !c)) return null;
  // 搭配库里的名字如果本来就有真实出处，在这里接上
  return { given, chars: chars as CharInfo[], sourceId: sourceId ?? NAME_SOURCE.get(given), from };
}

/** 主料：搭配库 */
function fromLexicon(p: NeedProfile, out: Map<string, RawCandidate>) {
  const { hard, soft } = p;
  if (hard.length === 1) return;
  for (const entry of COMBOS) {
    // 性别初筛：明显偏另一个性别的搭配先不出
    if (hard.gender === 'boy' && entry.lean === -1) continue;
    if (hard.gender === 'girl' && entry.lean === 1) continue;
    if (hard.gender === 'any' && entry.lean !== 0) continue;

    const cand = makeFromGiven(entry.given, 'lexicon');
    if (!cand) continue;
    if (cand.chars.some((c) => hard.banChars.has(c.c))) continue;
    if (cand.chars.some((c) => c.bh > soft.maxStroke)) continue;
    pushUnique(out, cand);
  }
}

/**
 * 典籍取名。
 *
 * 只取每条出处明确列出的名字，不在一句长诗里随便捡两个字拼。
 * 后者会造出「明江」「帆沧」这种字都在原文里、组合却不是话的东西，
 * 而且会让「有出处」这三个字变得不值钱。
 */
function fromClassics(p: NeedProfile, out: Map<string, RawCandidate>, rng: () => number) {
  const { hard, soft, styleWeight } = p;
  if (hard.length === 1) return;
  const sources = SOURCES.slice().sort((a, b) => {
    const sa = a.tags.reduce((s, t) => s + (styleWeight[t] ?? 0), 0) + rng();
    const sb = b.tags.reduce((s, t) => s + (styleWeight[t] ?? 0), 0) + rng();
    return sb - sa;
  });

  for (const src of sources) {
    for (const name of src.names) {
      const cand = makeFromGiven(name, 'classic', src.id);
      if (!cand) continue;
      if (cand.chars.some((c) => hard.banChars.has(c.c))) continue;
      if (cand.chars.some((c) => c.bh > soft.maxStroke)) continue;
      if (!cand.chars.every((c) => genderOk(c, hard.gender))) continue;
      pushUnique(out, cand);
    }
  }
}

/**
 * 单字名。
 *
 * 一个字要独自撑起一个名字，门槛比配对时高得多：动作字和虚字不行（林望、林之），
 * 冷到在搭配库里都没怎么出现过的字也不行。用「在搭配库里出现过至少两次」当门槛，
 * 等于借用了已经筛过的那批数据来判断这个字够不够格。
 */
function fromSingles(p: NeedProfile, pool: CharInfo[], out: Map<string, RawCandidate>) {
  if (p.hard.length === 2) return;
  for (const c of pool) {
    if (c.pos === 'v' || c.pos === 'x') continue;
    if ((COMBO_CHAR_COUNT.get(c.c) ?? 0) < 2) continue;
    pushUnique(out, { given: c.c, chars: [c], from: 'single' });
  }
}

/** 兜底：自由组合。只在主料不够时用，组合成话规则在 filter 环节统一把关 */
function fromFreeCombos(p: NeedProfile, pool: CharInfo[], out: Map<string, RawCandidate>) {
  if (p.hard.length === 1) return;
  const heads = pool.filter((c) => HEAD_CHARS.has(c.c)).slice(0, 55);
  const tails = pool.filter((c) => TAIL_CHARS.has(c.c)).slice(0, 55);
  for (const a of heads) {
    for (const b of tails) {
      if (a.c === b.c) continue;
      pushUnique(out, { given: a.c + b.c, chars: [a, b], from: 'combo' });
    }
  }
}

/** 一个位置被占死之后，另一个位置能挑的字 */
function partnersFor(pool: CharInfo[], slot: 'head' | 'tail'): CharInfo[] {
  const set = slot === 'head' ? HEAD_CHARS : TAIL_CHARS;
  const fit = pool.filter((c) => set.has(c.c));
  // 位置合适的字太少时放宽，宁可多给几个选择，也不要让用户面对一个空页面
  return fit.length >= 12 ? fit : pool;
}

/** 指定用字：先在搭配库和典籍里找含这个字的，找不够再自由组合 */
function fromMustChars(p: NeedProfile, pool: CharInfo[], out: Map<string, RawCandidate>, rng: () => number) {
  const { hard } = p;
  if (!hard.mustChars.length) return;

  // 1) 搭配库里本来就含这个字的组合，质量最高
  const lex = new Map<string, RawCandidate>();
  fromLexicon(p, lex);
  for (const [, cand] of lex) {
    if (hard.mustChars.some((m) => cand.given.includes(m))) pushUnique(out, cand);
  }
  // 2) 典籍里含这个字的
  const cls = new Map<string, RawCandidate>();
  fromClassics(p, cls, rng);
  for (const [, cand] of cls) {
    if (hard.mustChars.some((m) => cand.given.includes(m))) pushUnique(out, cand);
  }

  // 3) 两个指定字正好凑成一个名字
  const fixedInfos = hard.mustChars.map((c) => getChar(c));
  if (hard.mustChars.length >= 2 && hard.length !== 1) {
    const [a, b] = fixedInfos;
    if (a && b) {
      pushUnique(out, { given: a.c + b.c, chars: [a, b], from: 'must' });
      pushUnique(out, { given: b.c + a.c, chars: [b, a], from: 'must' });
    }
  }

  // 4) 兜底：固定一个位置遍历字池
  for (let k = 0; k < hard.mustChars.length; k++) {
    const raw = hard.mustChars[k];
    const info = fixedInfos[k];
    if (!info) continue; // 字库里没有这个字，交给 filter 环节统一说明
    if (hard.length !== 2) pushUnique(out, { given: raw, chars: [info], from: 'must' });
    if (hard.length === 1) continue;
    for (const o of partnersFor(pool, 'tail')) {
      if (o.c === raw) continue;
      pushUnique(out, { given: raw + o.c, chars: [info, o], from: 'must' });
    }
    for (const o of partnersFor(pool, 'head')) {
      if (o.c === raw) continue;
      pushUnique(out, { given: o.c + raw, chars: [o, info], from: 'must' });
    }
  }
}

/** 辈分字：位置是定死的，只能在另一个位置想办法 */
function fromGenChar(p: NeedProfile, pool: CharInfo[], out: Map<string, RawCandidate>, rng: () => number) {
  const g = p.hard.genChar;
  if (!g) return;
  const info = getChar(g.c);
  if (!info) return;

  // 先看搭配库和典籍里有没有现成的、辈分字正好在对的位置上
  const ready = new Map<string, RawCandidate>();
  fromLexicon(p, ready);
  fromClassics(p, ready, rng);
  const idx = g.pos === 'first' ? 0 : 1;
  for (const [, cand] of ready) {
    if (cand.given.length === 2 && cand.given[idx] === g.c) pushUnique(out, cand);
  }

  // 辈分字占了一头，另一头只能挑站得住那个位置的字
  for (const o of partnersFor(pool, g.pos === 'first' ? 'tail' : 'head')) {
    if (o.c === g.c) continue;
    if (g.pos === 'first') pushUnique(out, { given: g.c + o.c, chars: [info, o], from: 'gen' });
    else pushUnique(out, { given: o.c + g.c, chars: [o, info], from: 'gen' });
  }
}

export function generate(p: NeedProfile, seed: number): RawCandidate[] {
  const rng = makeRng(seed);
  const pool = buildPool(p, rng);
  const out = new Map<string, RawCandidate>();

  // 辈分字是最硬的约束，它把一个位置占死了，别的来源都得给它让路
  if (p.hard.genChar) {
    fromGenChar(p, pool, out, rng);
    return [...out.values()];
  }
  if (p.hard.mustChars.length) {
    fromMustChars(p, pool, out, rng);
    return [...out.values()];
  }

  fromLexicon(p, out);
  if (p.soft.preferClassic) fromClassics(p, out, rng);
  fromSingles(p, pool, out);

  // 主料不够（限制很多、或者用户要单字名）时才启用自由组合
  if (out.size < 120) fromFreeCombos(p, pool, out);

  return [...out.values()];
}
