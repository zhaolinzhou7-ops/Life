/**
 * 命名引擎 · 流水线编排
 *
 *   需求理解 → 候选生成 → 第一轮硬过滤 → 六维评价 → 多样性优选 → 解释
 *
 * 每一轮淘汰了多少、为什么，都记进 funnel 交给界面展示。用户有权知道
 * 「你只给我看 10 个」背后是从多少个里挑的。
 */

import type {
  CharInfo,
  NameCandidate,
  NamingRequest,
  NamingResult,
  NeedProfile,
  WuxingView,
} from '../types';
import { getChar } from '../data/chars';
import { getSurname } from '../data/surnames';
import { understand } from './understand';
import { generate, type RawCandidate } from './generate';
import { filterHard, unknownChars } from './filter';
import { scoreCandidate } from './score';
import { selectDiverse, balanceOrigins } from './select';
import { buildFitFor, buildMeaning, buildOneLine, buildOrigin, buildPinyin, buildProsCons, buildTags } from './explain';
import { toneMark } from './pinyin';
import { computeBazi, describeBazi } from './bazi';

function buildWuxing(chars: CharInfo[], p: NeedProfile): WuxingView | undefined {
  if (!p.req.useWuxing) return undefined;
  const b = computeBazi(p.req.birthDate, p.req.birthTime);
  const lines = describeBazi(b);
  const want = p.soft.wuxing ?? [];
  const hit = want.length > 0 && chars.some((c) => want.includes(c.wx));
  const charPart = chars.map((c) => `${c.c}(${c.wx})`).join('、');
  const relation = want.length
    ? hit
      ? `名字用字${charPart}，其中有字属${want.filter((w) => chars.some((c) => c.wx === w)).join('、')}，与传统上说的「宜补」方向一致。`
      : `名字用字${charPart}，没有落在传统上说的「宜补」的${want.join('、')}上。引擎没有因此把它排到后面——为了补五行牺牲读音和字义，是本末倒置。`
    : `名字用字${charPart}。`;
  return {
    chars: chars.map((c) => ({ c: c.c, wx: c.wx })),
    summary: [relation, ...lines].join(' '),
    hit,
  };
}

/**
 * 「换一批」用的抖动。
 *
 * 主料是一份固定的搭配库，评分也是确定的，所以不加干预的话每次算出来的前十名
 * 都一模一样——「换一批」按钮会变成一个骗人的按钮。
 *
 * 幅度压在 ±3.5 分：足够让分数咬得很紧的一批名字换着露面，又不足以把一个真正
 * 差一截的名字顶上来。抖动只和「名字 + 种子」有关，所以同一个种子结果可复现。
 */
function jitter(full: string, seed: number): number {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < full.length; i++) {
    h ^= full.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) / 0x100000000 - 0.5) * 7;
}

function assemble(
  raw: RawCandidate,
  p: NeedProfile,
  sur: ReturnType<typeof getSurname>,
  seed: number,
): NameCandidate {
  const chars = raw.chars;
  const origin = buildOrigin(raw);
  const sc = scoreCandidate(sur, chars, p);
  const tags = buildTags(chars);
  const full = p.req.surname + raw.given;
  const tones = [
    ...(sur ? [sur.tone, ...(sur.second ? [sur.second.tone] : [])] : []),
    ...chars.map((c) => c.tone),
  ];
  const { pros, cons } = buildProsCons(sc.dims, sc.risks);

  return {
    id: `${full}-${raw.from}`,
    surname: p.req.surname,
    given: raw.given,
    full,
    pinyin: buildPinyin(sur, chars, toneMark),
    tones,
    chars,
    origin,
    meaning: buildMeaning(chars, origin),
    oneLine: buildOneLine(full, chars, sc.dims, origin, tags),
    tags,
    dims: sc.dims,
    risks: sc.risks,
    pros,
    cons,
    fitFor: buildFitFor(chars, sc.dims, tags, origin, sc.commonness),
    wuxing: buildWuxing(chars, p),
    commonness: sc.commonness,
    overall: sc.overall + jitter(full, seed),
  };
}

export interface RunOptions {
  /** 换一批时传不同的 seed */
  seed?: number;
  /** 由 AI 层提供的候选名（只给名，分析仍然走本地引擎） */
  injected?: { given: string; sourceId?: string }[];
}

export function runPipeline(req: NamingRequest, opts: RunOptions = {}): NamingResult {
  const seed = opts.seed ?? Date.now() & 0xffff;
  const profile = understand(req);
  const sur = getSurname(req.surname);
  const funnel: NamingResult['funnel'] = [];

  if (!sur) {
    profile.unknowns.push(
      `姓「${req.surname}」不在内置读音表里，音律分析只做了名字部分。姓名整体顺不顺口，建议你连姓念三遍确认。`,
    );
  }
  const unknown = unknownChars(profile);
  if (unknown.length) {
    profile.unknowns.push(
      `「${unknown.join('」「')}」不在内置字库里，它的读音、笔画、字义都无法分析。这一轮没有强行用它生成名字——与其给你一个分析不了的结果，不如说清楚。`,
    );
  }

  // Step 2：生成
  let raws = generate(profile, seed);

  // AI 层给的候选也要走同一条流水线，不给它开后门
  if (opts.injected?.length) {
    for (const inj of opts.injected) {
      const chars = [...inj.given].map((c) => getChar(c));
      if (chars.some((c) => !c)) continue;
      raws.unshift({
        given: inj.given,
        chars: chars as CharInfo[],
        sourceId: inj.sourceId,
        from: 'combo',
      });
    }
    const seen = new Set<string>();
    raws = raws.filter((r) => (seen.has(r.given) ? false : (seen.add(r.given), true)));
  }
  funnel.push({ stage: '候选生成', kept: raws.length, dropped: 0, why: '按风格、性别、约束从字库和典籍里组合' });

  // Step 3：硬过滤
  const f = filterHard(raws, profile, sur);
  const dropDesc = Object.entries(f.stats)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${v}`)
    .join('、');
  funnel.push({
    stage: '第一轮过滤',
    kept: f.kept.length,
    dropped: raws.length - f.kept.length,
    why: dropDesc || '没有需要淘汰的',
  });

  // Step 4：评分。候选太多时先按一个便宜的口径砍一刀，避免白算
  let pool = f.kept;
  if (pool.length > 1400) {
    pool = pool
      .map((c) => ({ c, v: c.chars.reduce((s, x) => s + (x.freq <= 1 ? 1 : 0), 0) + (c.sourceId ? 1 : 0) }))
      .sort((a, b) => b.v - a.v)
      .slice(0, 1400)
      .map((x) => x.c);
  }
  const scored = pool.map((r) => assemble(r, profile, sur, seed)).sort((a, b) => b.overall - a.overall);

  // 六维里有任何一维「需注意」且综合分不高的，不该出现在首屏
  const worthy = scored.filter((c) => {
    const bad = c.dims.filter((d) => d.level === '需注意').length;
    return bad === 0 || (bad === 1 && c.overall >= 66);
  });
  const finalPool = worthy.length >= req.count ? worthy : scored;
  funnel.push({
    stage: '第二轮评价',
    kept: finalPool.length,
    dropped: scored.length - finalPool.length,
    why: '筛掉了六维里有明显短板的组合',
  });

  // Step 5：多样性挑选
  let picked = selectDiverse(finalPool, req.count);
  picked = balanceOrigins(picked, finalPool, req.count);
  funnel.push({
    stage: '最终输出',
    kept: picked.length,
    dropped: finalPool.length - picked.length,
    why: '在高分候选里挑风格、用字、声调各不相同的一组，避免十个名字一个味道',
  });

  return { profile, candidates: picked, funnel, engine: 'local' };
}
