/**
 * AI 智能取名 · 领域类型
 *
 * 一条原则贯穿整个模块：**评分是产品内部的筛选工具，不是客观科学结论**。
 * 所以对外展示用「优/良/一般/需注意」这样的档位和具体依据，而不是把一个
 * 小数点后两位的分数摆到用户脸上假装精确。
 */

/** 命名对象。三者共用一套引擎，只是风格权重和用字偏好不同 */
export type Target = 'baby' | 'rename' | 'penname';

export type Gender = 'boy' | 'girl' | 'any';

/** 风格标签。既用于描述字，也用于描述用户偏好 */
export type StyleTag =
  | '清雅'
  | '大气'
  | '温润'
  | '诗意'
  | '现代'
  | '古典'
  | '智慧'
  | '自然'
  | '简洁'
  | '坚毅'
  | '明朗'
  | '灵动'
  | '文艺';

export const ALL_STYLES: StyleTag[] = [
  '清雅',
  '大气',
  '温润',
  '诗意',
  '现代',
  '古典',
  '智慧',
  '自然',
  '简洁',
  '坚毅',
  '明朗',
  '灵动',
  '文艺',
];

/** 字的语义类别，用于组合寓意与谐音风险判断 */
export type Category =
  | '自然'
  | '品德'
  | '才智'
  | '志向'
  | '文艺'
  | '仪态'
  | '情感'
  | '光明'
  | '时序'
  | '器物';

export type WuXing = '金' | '木' | '水' | '火' | '土';

/**
 * 词性。这是解决「字好看但组合很奇怪」的关键一维：
 * 中文名的骨架是「性状 + 名物」（清风、明月、志远），两个不相干的名物硬凑
 * 在一起就会变成「荷野」「茗泓」这种看着像名字、念着不是话的东西。
 *   n 名物  a 性状  v 动作  x 虚词
 */
export type Pos = 'n' | 'a' | 'v' | 'x';

/** 汉字结构：左右 / 上下 / 独体 / 半包围 / 全包围 / 品字 */
export type Shape = 'L' | 'S' | 'D' | 'B' | 'W' | 'P';

export interface CharInfo {
  c: string;
  /** 带声调数字的拼音，如 yi4；多音字取取名时的常用读音 */
  py: string;
  /** 不带声调的音节 */
  syl: string;
  /** 声母，零声母为空串 */
  sm: string;
  /** 韵母 */
  ym: string;
  /** 声调 1~4 */
  tone: number;
  /** 简体笔画 */
  bh: number;
  shape: Shape;
  wx: WuXing;
  cat: Category;
  pos: Pos;
  /** 是否允许参与自由组合。false 表示这个字只在典籍原句里取用 */
  comboOk: boolean;
  /** 性别倾向：-2 明显偏女 … 0 中性 … 2 明显偏男 */
  g: number;
  /** 作为名字用字的常见度：0 少见 1 不常见 2 常见 3 近年烂大街 */
  freq: number;
  tags: StyleTag[];
  /** 字义（一句话，必须具体） */
  yi: string;
  /** 使用提示：多音、易错、笔画多等。没有就是没有 */
  note?: string;
  /** 生僻字标记，默认参与硬过滤 */
  rare?: boolean;
}

export interface SurnameInfo {
  c: string;
  py: string;
  syl: string;
  sm: string;
  ym: string;
  tone: number;
  bh: number;
  /** 复姓时为第二个字的信息 */
  second?: Omit<SurnameInfo, 'second'>;
  /** 该姓氏的谐音读法，如 吴→无、史→死 */
  puns?: string[];
  /** 谐音后会把后面的字否定掉（无X、不X） */
  negates?: boolean;
  note?: string;
}

/**
 * 真实典籍出处。
 *
 * names 是「这句话支持哪些名字」，而不是「这句话里有哪些字」——后者会让引擎
 * 把一句长诗里随便两个字拼起来也声称有出处（明江、帆沧）。
 * **names 里每个名字的每个字都必须出现在 line 中**，这条由自测强制校验。
 */
export interface SourceEntry {
  id: string;
  era: '诗经' | '楚辞' | '唐诗' | '宋词' | '古文' | '诗文';
  work: string;
  author?: string;
  line: string;
  /** 这句话在说什么，用于详情页解释，不能是空话 */
  note: string;
  names: string[];
  tags: StyleTag[];
}

/** 用户输入的命名需求 */
export interface NamingRequest {
  surname: string;
  gender: Gender;
  target: Target;
  /** 基本命名要求，自由文本 */
  brief: string;

  birthDate?: string;
  birthTime?: string;
  birthPlace?: string;

  likeStyles: StyleTag[];
  avoidStyles: StyleTag[];
  mustChars: string[];
  banChars: string[];
  /** 辈分字与它在名字中的位置 */
  genChar?: { c: string; pos: 'first' | 'second' };
  temperament: string[];
  familyWish?: string;
  useClassics: boolean;
  useWuxing: boolean;
  /** 名字字数：1 单字、2 双字、0 不限 */
  nameLength: 0 | 1 | 2;
  count: number;
}

/** 需求理解的产物：把自由输入翻译成引擎能执行的约束 */
export interface NeedProfile {
  req: NamingRequest;
  /** 用户真正的核心诉求，一句话 */
  core: string;
  /** 风格权重，键为 StyleTag，值 -2~2 */
  styleWeight: Record<string, number>;
  /** 硬约束：违反即淘汰 */
  hard: {
    banChars: Set<string>;
    mustChars: string[];
    genChar?: { c: string; pos: 'first' | 'second' };
    length: 0 | 1 | 2;
    gender: Gender;
  };
  /** 可妥协的偏好，用于排序而非淘汰 */
  soft: {
    /** 期望的五行补益，空表示不参考 */
    wuxing?: WuXing[];
    /** 期望气质关键词 */
    temperament: string[];
    /** 是否偏好有典籍出处 */
    preferClassic: boolean;
    /** 用户可接受的最大笔画（单字） */
    maxStroke: number;
  };
  /** 理解过程中拿不准、已经按保守方式处理的地方，如实告诉用户 */
  unknowns: string[];
}

export type DimKey = 'sound' | 'meaning' | 'glyph' | 'style' | 'usability' | 'unique';

export type Level = '优' | '良' | '一般' | '需注意';

export interface Dimension {
  key: DimKey;
  label: string;
  /** 0~100，内部排序用 */
  score: number;
  level: Level;
  /** 具体依据，每条都要说人话 */
  notes: string[];
  /**
   * 这一维最值得拿出来说的优点 / 最该提醒的不足。
   *
   * 由各个打分函数自己指定，而不是让展示层从 notes 里猜——猜的结果就是
   * 「可能的不足」底下出现一条「命中你想要的风格」。
   */
  highlight?: string;
  concern?: string;
}

export interface Risk {
  kind: 'homophone' | 'rare' | 'common' | 'stroke' | 'polyphone' | 'meaning' | 'gender';
  level: 'low' | 'mid' | 'high';
  text: string;
}

export interface Origin {
  kind: 'classic' | 'modern';
  work?: string;
  author?: string;
  line?: string;
  note?: string;
}

export interface WuxingView {
  /** 每个名字用字的五行 */
  chars: { c: string; wx: WuXing }[];
  /** 与八字的关系说明；没有生日则说明缺少依据 */
  summary: string;
  /** 是否命中了用户希望补的五行 */
  hit: boolean;
}

export interface NameCandidate {
  id: string;
  surname: string;
  given: string;
  full: string;
  /** 带声调的完整拼音，如 zhōu yì chén */
  pinyin: string;
  tones: number[];
  chars: CharInfo[];
  origin: Origin;
  /** 两字组合后的整体寓意 */
  meaning: string;
  /** 一句话评价 */
  oneLine: string;
  tags: StyleTag[];
  dims: Dimension[];
  /** 综合分，内部排序用，不直接当成绝对分展示 */
  overall: number;
  risks: Risk[];
  pros: string[];
  cons: string[];
  /** 适合什么样的命名偏好 */
  fitFor: string;
  wuxing?: WuxingView;
  /** 该名字的常见度风险档位 */
  commonness: 'low' | 'mid' | 'high';
}

export interface NamingResult {
  profile: NeedProfile;
  candidates: NameCandidate[];
  /** 生成过程的透明说明：候选池多大、各轮淘汰了多少 */
  funnel: { stage: string; kept: number; dropped: number; why: string }[];
  /** 数据来源：本地引擎还是远端模型 */
  engine: 'local' | 'remote';
  /** 远端模型失败时的降级说明 */
  fallbackNote?: string;
}

/** 收藏条目 */
export interface FavoriteItem {
  id: string;
  name: NameCandidate;
  note: string;
  savedAt: number;
}
