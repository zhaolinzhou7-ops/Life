/**
 * 规则配置层（Rule Configuration Layer）。
 *
 * 这是本项目最重要的一条架构约束：**四川麻将的规则只能写在这里**。
 * 引擎、AI、教学层一律从 RuleConfig 读取，不许在别处写 `if (番 === '清一色') fan *= 4`
 * 这种东西。原因很实际——四川麻将没有全国统一规则，成都/绵阳/重庆、
 * 腾讯欢乐麻将/微乐/闲来，每家的换三张方向、起胡番数、杠分、查花猪赔法都不一样。
 * 一旦硬编码成「唯一正确」，以后想支持第二套玩法就得翻遍全部代码。
 *
 * 所以这里给出三套预置方案（A/B/C），并且可以用 registerVariant() 继续加。
 * 每一条「各平台不一致」的规则，都在 DIVERGENCES 里写明分歧点和各方案的取值，
 * 避免以后有人把两套规则混着用还以为是 bug。
 */

import type { Suit } from './tiles';

// ==================== 番型 ====================

/**
 * 番型 id。番型「怎么判定」是引擎的事（win.ts），
 * 「算不算、算几倍」是配置的事（下面的 FanRule）。两者分开，才谈得上换规则。
 */
export type FanId =
  | 'pinghu' // 平胡：没有任何特殊牌型
  | 'duidui' // 对对胡：全是刻子 + 一对
  | 'qingyise' // 清一色：一门到底
  | 'qidui' // 七对：七个对子，必须门清
  | 'longqidui' // 龙七对：七对里含四张相同
  | 'shuanglong' // 双龙七对：七对里含两组四张
  | 'jingoudiao' // 金钩钓：四副露单吊
  | 'menqing' // 门清：全程没碰没明杠
  | 'zimo' // 自摸
  | 'gangshanghua' // 杠上花：杠后补牌自摸
  | 'gangshangpao' // 杠上炮：杠后打出的牌被胡
  | 'qianggang' // 抢杠胡
  | 'haidilao' // 海底捞月：摸最后一张自摸
  | 'haidipao' // 海底炮：最后一张打出点炮
  | 'gen' // 根：每四张相同 ×2
  | 'tianhu' // 天胡：庄家起手即胡
  | 'dihu'; // 地胡：闲家第一轮胡

export interface FanRule {
  id: FanId;
  name: string;
  /** 给用户看的解释，教学面板直接用 */
  desc: string;
  /**
   * 计分权重。
   * scoring='multiply' 时是倍数（清一色 ×4）；
   * scoring='addFan' 时是番数（清一色 +2，最后算 2^番）。
   */
  value: number;
  enabled: boolean;
}

export type ScoringMode = 'multiply' | 'addFan';

// ==================== 各分区配置 ====================

export interface TilesConfig {
  /** 用哪几门牌。四川麻将固定万条筒，留着是为了将来支持别的玩法 */
  suits: Suit[];
  /** 每种牌几张 */
  copies: number;
  /** 起手张数 */
  handSize: number;
}

/** 换三张的方向：对家 / 下家（顺时针）/ 上家（逆时针） */
export type SwapDir = 'opposite' | 'next' | 'prev';

export interface SwapConfig {
  enabled: boolean;
  /** 换几张 */
  count: number;
  /** 是否必须同花色（四川标准玩法：必须） */
  sameSuit: boolean;
  /** 允许出现的方向 */
  directions: SwapDir[];
  /** random=开局随机定方向（标准）；fixed=固定用 fixedDir */
  directionPick: 'random' | 'fixed';
  fixedDir: SwapDir;
}

export interface LackConfig {
  enabled: boolean;
  /** 胡牌时手上不能有缺门牌 */
  winRequiresNoLack: boolean;
  /** 手上还有缺门牌时，必须优先打缺门 */
  discardLackFirst: boolean;
  /** 能不能碰/杠缺门牌（标准：不能，碰了也胡不了） */
  claimLackAllowed: boolean;
  /** 流局时手上还有缺门牌 = 花猪 */
  huaZhuOnLack: boolean;
}

export interface WinConfig {
  /** 4 面子 + 1 将 */
  standard: boolean;
  /** 七对（必须门清） */
  sevenPairs: boolean;
  /** 起胡番数：算出来的番数低于它不能胡 */
  minFan: number;
  /** 一炮多响：一张牌可以同时被多家胡 */
  multiWin: boolean;
  /** 抢杠胡：别人补杠时可以胡那张牌 */
  robKong: boolean;
  /** 抢暗杠（绝大多数四川玩法不允许） */
  robConcealedKong: boolean;
  /**
   * 过手不胡（过水）：放弃了一次胡之后，在自己再次摸牌前不能再胡同一张。
   * 各平台差异很大，所以做成开关。
   */
  passLock: boolean;
  /** 只能自摸（教学关卡里可能用到，正常玩法为 false） */
  selfDrawOnly: boolean;
}

export interface GangConfig {
  concealed: boolean; // 暗杠
  exposed: boolean; // 明杠（点杠）
  added: boolean; // 补杠（碰后再摸到第四张）
  /** 暗杠：每家赔多少 */
  payConcealed: number;
  /** 明杠：点杠那家赔多少 */
  payExposed: number;
  /** 补杠：每家赔多少 */
  payAdded: number;
  /** 杠后补一张 */
  replacementDraw: boolean;
  /** 牌墙剩几张以下不许杠 */
  minWallToGang: number;
  /**
   * 呼叫转移：胡牌者之前收的杠分，改由点炮者承担。
   * 四川玩法特色，但不是所有平台都有。
   */
  transferOnWin: boolean;
}

export type BloodyMode = 'xuezhan' | 'xueliu' | 'single';

export interface BloodyConfig {
  /** xuezhan=血战到底（胡了下桌）; xueliu=血流成河（胡了继续）; single=一胡即止 */
  mode: BloodyMode;
  /** 几家胡完结束（血战到底为 3） */
  winnersToEnd: number;
  /** 血流成河里每家最多胡几次 */
  maxWinPerPlayer: number;
}

export interface FanConfig {
  table: FanRule[];
  scoring: ScoringMode;
  /** 封顶倍数 */
  cap: number;
  /** 底分 */
  base: number;
  /**
   * 番型互斥表：[a, b] 表示成立了 a 就不再算 b。
   * 做成数据而不是写在判定代码里，因为「金钩钓还算不算对对胡」这类问题
   * 各平台答案不同，属于规则分歧，必须留在配置层。
   */
  exclusions: [FanId, FanId][];
}

export interface DrawConfig {
  /** 牌墙留底张数（剩这么多张时流局）。四川玩法通常不留底 */
  reserve: number;
  /** 查大叔：流局时未听牌的赔听牌家 */
  chaJiao: boolean;
  /** 查花猪：流局时手上还有缺门牌的重罚 */
  chaHuaZhu: boolean;
  /** 花猪赔每家多少（固定罚） */
  huaZhuPay: number;
  /** 查叫赔付按听牌家的最大可能番数，封顶 */
  chaJiaoCap: number;
  /** 花猪是否要退还自己收过的杠分 */
  huaZhuReturnGang: boolean;
}

export interface RuleConfig {
  id: string;
  name: string;
  /** 一句话说明这是哪儿的打法 */
  desc: string;
  /** 常见于哪些平台，帮用户对上号 */
  source: string;
  tiles: TilesConfig;
  swap: SwapConfig;
  lack: LackConfig;
  win: WinConfig;
  gang: GangConfig;
  bloody: BloodyConfig;
  fan: FanConfig;
  draw: DrawConfig;
}

// ==================== 番型表 ====================

/** 番型的默认说明文案。各方案只改 value/enabled，不重复抄文案 */
const FAN_TEXT: Record<FanId, { name: string; desc: string }> = {
  pinghu: { name: '平胡', desc: '四个面子加一对将，没有额外牌型。' },
  duidui: { name: '对对胡', desc: '四个面子全是刻子（碰/杠也算），加一对将。' },
  qingyise: { name: '清一色', desc: '整副牌只有一门花色。定缺之后只剩两门，清一色比想象中好做。' },
  qidui: { name: '七对', desc: '七个对子，必须门清（碰过、明杠过就不算）。' },
  longqidui: { name: '龙七对', desc: '七对里有四张一样的牌，那四张算两对。' },
  shuanglong: { name: '双龙七对', desc: '七对里有两组四张一样的牌。' },
  jingoudiao: { name: '金钩钓', desc: '四个面子全靠碰杠亮在外面，手里只剩一张单吊。' },
  menqing: { name: '门清', desc: '全程没有碰、没有明杠。' },
  zimo: { name: '自摸', desc: '自己摸到胡牌张。' },
  gangshanghua: { name: '杠上花', desc: '杠了之后补摸的那张牌正好自摸。' },
  gangshangpao: { name: '杠上炮', desc: '杠了之后打出的牌被别人胡。' },
  qianggang: { name: '抢杠胡', desc: '别人碰后补杠，那张牌正好是你要胡的。' },
  haidilao: { name: '海底捞月', desc: '摸到牌墙最后一张并自摸。' },
  haidipao: { name: '海底炮', desc: '牌墙最后一张打出去点了炮。' },
  gen: { name: '根', desc: '四张相同的牌（含杠）算一根，每根翻一倍。' },
  tianhu: { name: '天胡', desc: '庄家起手 14 张直接成胡。' },
  dihu: { name: '地胡', desc: '闲家第一轮摸牌即胡。' },
};

function fanTable(values: Partial<Record<FanId, number | false>>): FanRule[] {
  return (Object.keys(FAN_TEXT) as FanId[]).map((id) => {
    const v = values[id];
    return {
      id,
      name: FAN_TEXT[id].name,
      desc: FAN_TEXT[id].desc,
      value: v === false || v === undefined ? 1 : v,
      enabled: v !== false && v !== undefined,
    };
  });
}

// ==================== 三套预置方案 ====================

/**
 * 方案 A：成都血战到底（默认）
 * 最常见的一套，也是大多数人说「四川麻将」时指的那一套。
 */
export const VARIANT_CHENGDU: RuleConfig = {
  id: 'chengdu-xuezhan',
  name: '成都血战到底',
  desc: '换三张 + 定缺 + 血战到底，倍数制封顶 64，带呼叫转移与查大叔查花猪。',
  source: '成都及周边线下打法，腾讯欢乐麻将「血战到底」亦大体如此',
  tiles: { suits: [0, 1, 2], copies: 4, handSize: 13 },
  swap: { enabled: true, count: 3, sameSuit: true, directions: ['opposite', 'next', 'prev'], directionPick: 'random', fixedDir: 'opposite' },
  lack: { enabled: true, winRequiresNoLack: true, discardLackFirst: true, claimLackAllowed: false, huaZhuOnLack: true },
  win: { standard: true, sevenPairs: true, minFan: 1, multiWin: true, robKong: true, robConcealedKong: false, passLock: false, selfDrawOnly: false },
  gang: {
    concealed: true, exposed: true, added: true,
    payConcealed: 2, payExposed: 2, payAdded: 1,
    replacementDraw: true, minWallToGang: 1, transferOnWin: true,
  },
  bloody: { mode: 'xuezhan', winnersToEnd: 3, maxWinPerPlayer: 1 },
  fan: {
    scoring: 'multiply',
    cap: 64,
    base: 1,
    table: fanTable({
      pinghu: 1, duidui: 2, qingyise: 4, qidui: 4, longqidui: 8, shuanglong: 16,
      jingoudiao: 4, zimo: 2, gangshanghua: 2, gangshangpao: 2, qianggang: 2,
      haidilao: 2, haidipao: 2, gen: 2,
      menqing: false, tianhu: false, dihu: false,
    }),
    exclusions: [
      ['longqidui', 'qidui'],
      ['shuanglong', 'longqidui'],
      ['shuanglong', 'qidui'],
      ['jingoudiao', 'duidui'],
    ],
  },
  draw: { reserve: 0, chaJiao: true, chaHuaZhu: true, huaZhuPay: 16, chaJiaoCap: 64, huaZhuReturnGang: true },
};

/**
 * 方案 B：血流成河
 * 胡了不下桌，可以反复胡，牌墙摸完才结束。牌局更长，教学上更适合练「胡完之后怎么打」。
 */
export const VARIANT_XUELIU: RuleConfig = {
  ...VARIANT_CHENGDU,
  id: 'xueliu',
  name: '血流成河',
  desc: '胡了继续打，可以反复胡，摸完牌墙才结束；每家最多胡 3 次。',
  source: '重庆 / 四川通用「血流成河」，各家主要差异在最多胡几次',
  bloody: { mode: 'xueliu', winnersToEnd: 4, maxWinPerPlayer: 3 },
  fan: {
    ...VARIANT_CHENGDU.fan,
    table: fanTable({
      pinghu: 1, duidui: 2, qingyise: 4, qidui: 4, longqidui: 8, shuanglong: 16,
      jingoudiao: 4, zimo: 2, gangshanghua: 2, gangshangpao: 2, qianggang: 2,
      haidilao: 2, haidipao: 2, gen: 2, menqing: 2,
      tianhu: false, dihu: false,
    }),
    exclusions: [...VARIANT_CHENGDU.fan.exclusions],
  },
};

/**
 * 方案 C：教学简化版
 * 给第一次接触四川麻将的人。关掉换三张（一上来就换牌，新手根本不知道在换什么），
 * 关掉花猪重罚（新手最容易在这里被罚哭），一家胡就结束，番型只留最基础的几种。
 * 定缺保留——那是四川麻将的灵魂，必须第一天就学。
 */
export const VARIANT_TEACH: RuleConfig = {
  ...VARIANT_CHENGDU,
  id: 'teach-simple',
  name: '教学简化版',
  desc: '不换三张、一家胡即结束、不罚花猪，番型只留平胡/对对胡/清一色/七对，专给新手入门。',
  source: '本产品自定义的教学规则，不对应任何线下打法',
  swap: { ...VARIANT_CHENGDU.swap, enabled: false },
  lack: { ...VARIANT_CHENGDU.lack, huaZhuOnLack: false },
  win: { ...VARIANT_CHENGDU.win, multiWin: false, robKong: false },
  gang: { ...VARIANT_CHENGDU.gang, added: true, transferOnWin: false },
  bloody: { mode: 'single', winnersToEnd: 1, maxWinPerPlayer: 1 },
  fan: {
    scoring: 'multiply',
    cap: 16,
    base: 1,
    table: fanTable({
      pinghu: 1, duidui: 2, qingyise: 4, qidui: 4, zimo: 2, gen: 2,
      longqidui: false, shuanglong: false, jingoudiao: false, menqing: false,
      gangshanghua: false, gangshangpao: false, qianggang: false,
      haidilao: false, haidipao: false, tianhu: false, dihu: false,
    }),
    exclusions: [],
  },
  draw: { reserve: 0, chaJiao: false, chaHuaZhu: false, huaZhuPay: 0, chaJiaoCap: 0, huaZhuReturnGang: false },
};

// ==================== 注册表 ====================

const VARIANTS = new Map<string, RuleConfig>();
for (const v of [VARIANT_CHENGDU, VARIANT_XUELIU, VARIANT_TEACH]) VARIANTS.set(v.id, v);

/** 新增规则方案。以后加「绵阳玩法」「自贡玩法」走这里，不要改引擎 */
export function registerVariant(cfg: RuleConfig) {
  VARIANTS.set(cfg.id, cfg);
}

export function listVariants(): RuleConfig[] {
  return [...VARIANTS.values()];
}

export function getVariant(id: string): RuleConfig {
  const v = VARIANTS.get(id);
  if (!v) throw new Error(`没有这套规则方案：${id}`);
  return v;
}

export const DEFAULT_VARIANT_ID = VARIANT_CHENGDU.id;

/** 查表：某个番型在当前规则下算几倍；没开启返回 null */
export function fanRule(cfg: RuleConfig, id: FanId): FanRule | null {
  const r = cfg.fan.table.find((f) => f.id === id);
  return r && r.enabled ? r : null;
}

/**
 * 基于某套方案改几项，生成新方案。
 * 教学关卡经常需要「就这一局关掉换三张」，用它比复制整份配置安全。
 */
export function deriveVariant(base: RuleConfig, patch: DeepPartial<RuleConfig>, id: string, name: string): RuleConfig {
  const merged = deepMerge(base, patch) as RuleConfig;
  return { ...merged, id, name };
}

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

function deepMerge<T>(base: T, patch: DeepPartial<T>): T {
  if (patch === undefined) return base;
  const out: Record<string, unknown> = Array.isArray(base) ? [...(base as unknown[])] as never : { ...(base as object) };
  for (const k of Object.keys(patch as object)) {
    const bv = (base as Record<string, unknown>)[k];
    const pv = (patch as Record<string, unknown>)[k];
    out[k] = bv && pv && typeof bv === 'object' && typeof pv === 'object' && !Array.isArray(pv)
      ? deepMerge(bv, pv as never)
      : pv;
  }
  return out as T;
}

// ==================== 规则分歧登记 ====================

/**
 * 「这条规则各地不一样」的登记表。
 *
 * 为什么要专门写一份：四川麻将没有权威规则书，网上每篇攻略讲的都不完全一样。
 * 与其在代码里假装某个取值是「正确答案」，不如把分歧点摊开写清楚，
 * 让用户自己选，也让以后维护的人知道这里不是随手写的。
 * 测试报告会把这张表打出来。
 */
export interface Divergence {
  topic: string;
  /** 分歧是什么 */
  question: string;
  /** 各方案怎么取的 */
  choices: { variant: string; value: string }[];
}

export const DIVERGENCES: Divergence[] = [
  {
    topic: '换三张方向',
    question: '换三张是固定给对家，还是开局随机决定对家/下家/上家？',
    choices: [
      { variant: '成都血战到底', value: '开局随机三选一（多数线上平台的做法）' },
      { variant: '血流成河', value: '同上，随机' },
      { variant: '教学简化版', value: '关闭换三张' },
    ],
  },
  {
    topic: '起胡番数',
    question: '平胡（1 番）能不能胡？有些地方要求 2 番起。',
    choices: [
      { variant: '成都血战到底', value: '1 番起，平胡可胡' },
      { variant: '血流成河', value: '1 番起' },
      { variant: '教学简化版', value: '1 番起' },
    ],
  },
  {
    topic: '过手不胡（过水）',
    question: '放弃一次胡之后，再摸牌前还能不能胡同一张？',
    choices: [
      { variant: '成都血战到底', value: '不限制（passLock=false）' },
      { variant: '血流成河', value: '不限制' },
      { variant: '教学简化版', value: '不限制' },
    ],
  },
  {
    topic: '杠分',
    question: '暗杠/明杠/补杠各赔多少，是否有人赔或每家赔。',
    choices: [
      { variant: '成都血战到底', value: '暗杠每家 2，明杠点杠者 2，补杠每家 1' },
      { variant: '血流成河', value: '同成都' },
      { variant: '教学简化版', value: '同成都，但不做呼叫转移' },
    ],
  },
  {
    topic: '呼叫转移',
    question: '胡牌者先前收的杠分，是否改由点炮者承担？',
    choices: [
      { variant: '成都血战到底', value: '有（transferOnWin=true）' },
      { variant: '血流成河', value: '有' },
      { variant: '教学简化版', value: '没有，避免新手被连环扣分' },
    ],
  },
  {
    topic: '是否强制先打缺门',
    question:
      '手上还有缺门牌时，能不能先打别的？这条直接决定「花猪」还有没有可能发生——' +
      '强制先打缺门时，牌几乎不可能留到最后，花猪基本绝迹；不强制时，花猪是新手最大的坑。',
    choices: [
      { variant: '成都血战到底', value: '强制（discardLackFirst=true），多数线上平台如此' },
      { variant: '血流成河', value: '强制' },
      { variant: '教学简化版', value: '强制，且不罚花猪' },
    ],
  },
  {
    topic: '花猪罚分',
    question: '流局时手上还有缺门牌，赔多少。',
    choices: [
      { variant: '成都血战到底', value: '每家固定 16，且要退杠分' },
      { variant: '血流成河', value: '同上' },
      { variant: '教学简化版', value: '不查花猪' },
    ],
  },
  {
    topic: '血流成河胡牌次数',
    question: '血流成河里一家最多能胡几次。',
    choices: [
      { variant: '成都血战到底', value: '不适用（胡了下桌）' },
      { variant: '血流成河', value: '每家最多 3 次' },
      { variant: '教学简化版', value: '不适用' },
    ],
  },
  {
    topic: '七对与根的关系',
    question: '龙七对里那四张牌，还要不要再算一根？',
    choices: [
      { variant: '成都血战到底', value: '不重复算：龙七对已经把四张计入番型' },
      { variant: '血流成河', value: '同上' },
      { variant: '教学简化版', value: '不做龙七对' },
    ],
  },
];
