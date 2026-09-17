/**
 * 忌讳与风险数据
 *
 * 这个文件解决的是取名里最容易翻车、AI 又最容易忽略的三件事：
 *   1. 谐音尴尬 —— 名字本身没问题，连着姓一读就出事
 *   2. 爆款重名 —— 寓意都对，但一个班里有三个
 *   3. 负面联想 —— 字义没错，组合起来方向不对
 *
 * 全部按「音节序列」匹配，不依赖声调，因为现实中喊名字时声调经常被忽略。
 */

/** 一读就尴尬的词，按不带声调的音节序列匹配 */
export const AWKWARD_WORDS: { syls: string[]; word: string; level: 'mid' | 'high' }[] = [
  { syls: ['du', 'zi', 'teng'], word: '肚子疼', level: 'high' },
  { syls: ['fan', 'tong'], word: '饭桶', level: 'high' },
  { syls: ['zhu', 'yi', 'qun'], word: '猪一群', level: 'high' },
  { syls: ['shi', 'zhen', 'xiang'], word: '屎真香', level: 'high' },
  { syls: ['yang', 'wei'], word: '阳痿', level: 'high' },
  { syls: ['bai', 'chi'], word: '白痴', level: 'high' },
  { syls: ['fei', 'wu'], word: '废物', level: 'high' },
  { syls: ['sha', 'gua'], word: '傻瓜', level: 'high' },
  { syls: ['ben', 'dan'], word: '笨蛋', level: 'high' },
  { syls: ['liu', 'mang'], word: '流氓', level: 'high' },
  { syls: ['se', 'lang'], word: '色狼', level: 'high' },
  { syls: ['la', 'ji'], word: '垃圾', level: 'high' },
  { syls: ['pi', 'gu'], word: '屁股', level: 'high' },
  { syls: ['bing', 'du'], word: '病毒', level: 'high' },
  { syls: ['si', 'wang'], word: '死亡', level: 'high' },
  { syls: ['shi', 'ti'], word: '尸体', level: 'high' },
  { syls: ['gui', 'hun'], word: '鬼魂', level: 'high' },
  { syls: ['jing', 'zi'], word: '精子', level: 'high' },
  { syls: ['gao', 'chao'], word: '高潮', level: 'high' },
  { syls: ['zhu', 'tou'], word: '猪头', level: 'high' },
  { syls: ['gou', 'dan'], word: '狗蛋', level: 'high' },
  { syls: ['niu', 'fen'], word: '牛粪', level: 'high' },
  { syls: ['yao', 'jing'], word: '妖精', level: 'mid' },
  { syls: ['e', 'xin'], word: '恶心', level: 'high' },
  { syls: ['tao', 'yan'], word: '讨厌', level: 'high' },
  { syls: ['ke', 'lian'], word: '可怜', level: 'mid' },
  { syls: ['bei', 'ju'], word: '悲剧', level: 'high' },
  { syls: ['shi', 'bai'], word: '失败', level: 'high' },
  { syls: ['ma', 'fan'], word: '麻烦', level: 'high' },
  { syls: ['shang', 'xin'], word: '伤心', level: 'mid' },
  { syls: ['ku', 'nan'], word: '苦难', level: 'high' },
  { syls: ['wei', 'xian'], word: '危险', level: 'high' },
  { syls: ['hei', 'an'], word: '黑暗', level: 'mid' },
  { syls: ['lao', 'shu'], word: '老鼠', level: 'high' },
  { syls: ['huai', 'ren'], word: '坏人', level: 'high' },
  { syls: ['qiong', 'ren'], word: '穷人', level: 'mid' },
  { syls: ['chou', 'ren'], word: '丑人', level: 'mid' },
  { syls: ['xia', 'liu'], word: '下流', level: 'high' },
  { syls: ['wu', 'neng'], word: '无能', level: 'high' },
  { syls: ['wu', 'de'], word: '无德', level: 'high' },
  { syls: ['wu', 'li'], word: '无理', level: 'high' },
  { syls: ['wu', 'yong'], word: '无用', level: 'high' },
  { syls: ['wu', 'xin'], word: '无心', level: 'mid' },
  { syls: ['wu', 'qing'], word: '无情', level: 'high' },
  { syls: ['wu', 'liang'], word: '无良', level: 'high' },
  { syls: ['wu', 'zhi'], word: '无知', level: 'high' },
  { syls: ['wu', 'wen'], word: '无闻', level: 'mid' },
  { syls: ['bu', 'xing'], word: '不行', level: 'high' },
  { syls: ['bu', 'an'], word: '不安', level: 'high' },
  { syls: ['bu', 'ping'], word: '不平', level: 'mid' },
  { syls: ['bu', 'ming'], word: '不明', level: 'mid' },
  { syls: ['bu', 'ren'], word: '不仁', level: 'high' },
  { syls: ['jia', 'ren'], word: '假仁', level: 'mid' },
  { syls: ['fu', 'bai'], word: '腐败', level: 'high' },
  { syls: ['cai', 'niao'], word: '菜鸟', level: 'mid' },
  { syls: ['hou', 'zi'], word: '猴子', level: 'mid' },
  { syls: ['duan', 'tui'], word: '断腿', level: 'high' },
  { syls: ['shui', 'jiao'], word: '睡觉', level: 'mid' },
  { syls: ['fan', 'zui'], word: '犯罪', level: 'high' },
  { syls: ['zhi', 'zhang'], word: '智障', level: 'high' },
];

/**
 * 近年爆款名 —— 寓意本身没问题，问题是一个班里可能有三个。
 * 这份表随时间会过期，所以详情页里会写明「这是基于近年用字趋势的判断」。
 */
export const HOT_NAMES = new Set([
  '子涵', '梓涵', '紫涵', '子轩', '梓轩', '紫轩', '宇轩', '梓睿', '沐宸', '沐辰',
  '一诺', '若曦', '浩然', '子墨', '梓墨', '亦辰', '辰逸', '俊熙', '梓晨', '睿泽',
  '欣怡', '雨桐', '雨萱', '梓萱', '紫萱', '诗涵', '可馨', '思涵', '嘉怡', '梓晴',
  '雨欣', '慕辰', '星辰', '奕辰', '语桐', '梓豪', '志远', '博文', '嘉豪', '子怡',
  '若曦', '沐阳', '安然', '亦菲', '梓宁', '语彤', '雨彤', '欣妍', '梦瑶', '诗雨',
]);

/**
 * 爆款用字。freq=3 的字连用会显著推高重名风险。
 * 说明：这是对用字趋势的估计，不是户籍统计。
 */
export const HOT_CHARS = new Set([
  '梓', '涵', '轩', '诺', '宸', '睿', '熙', '萱', '怡', '彤',
  '辰', '浩', '瑶', '欣', '悦', '若', '诗', '沐', '子', '一',
  '晗', '语', '桐', '星', '洛', '玥', '晨', '然',
]);

/**
 * 明显模板化的名字骨架。AI 最爱产出这种：换个姓就是另一个人的名字。
 * 用「首字 + 尾字」的组合来识别。
 */
export const TEMPLATE_PAIRS: [string, string][] = [
  ['子', '涵'], ['子', '轩'], ['梓', '涵'], ['梓', '轩'], ['梓', '睿'],
  ['雨', '桐'], ['雨', '萱'], ['雨', '欣'], ['欣', '怡'], ['诗', '涵'],
  ['浩', '然'], ['博', '文'], ['志', '远'], ['嘉', '豪'], ['俊', '杰'],
];

/**
 * 负面联想组合：两个字分开都没问题，凑在一起方向不对。
 * 用「类别对」而不是穷举字对，这样能覆盖没预见到的组合。
 */
export const BAD_CAT_PAIRS: { a: string; b: string; why: string }[] = [
  { a: '器物', b: '器物', why: '两个字都在说物件，合起来像商品名而不像人名' },
  { a: '时序', b: '时序', why: '两个字都在说时间，组合起来意思重复' },
];

/** 常见多音字：在名字里容易被念错的 */
export const POLYPHONE: Record<string, string> = {
  乐: '可读 lè（快乐）或 yuè（音乐），初见时多半会被念错',
  长: '可读 cháng（长久）或 zhǎng（生长）',
  华: '可读 huá（光华）或 huà（多为姓氏与地名）',
  柏: '可读 bǎi（柏树）或 bó（柏林），人名两读都有',
  燕: '可读 yàn（燕子）或 yān（燕京）',
  重: '可读 zhòng（重要）或 chóng（重复）',
  朝: '可读 zhāo（朝阳）或 cháo（朝代）',
  和: '可读 hé（和气）、hè（唱和）、huó（和面）',
  观: '可读 guān（观看）或 guàn（道观）',
  宁: '可读 níng（安宁）或 nìng（宁可）',
  澄: '可读 chéng（澄清）或 dèng（澄一下）',
  济: '可读 jì（救济）或 jǐ（济南）',
  中: '可读 zhōng（中间）或 zhòng（中奖）',
  盛: '可读 shèng（茂盛）或 chéng（盛饭）',
  筠: '可读 yún 或 jūn，人名里两读都见过',
};

/**
 * 声调相同、只是调不同的常见误读来源。
 * 用于「是否容易读错」判断：名字中的字如果本身就不在常用读音里，风险更高。
 */
export const EASY_MISREAD = new Set([
  '岑', '琛', '烨', '翊', '筠', '蓁', '菡', '霁', '湛', '玖', '瑄', '颐', '磐', '曦',
]);

/** 笔画特别多、小孩学写名字会吃力的字 */
export const HARD_TO_WRITE = new Set(['鑫', '曦', '耀', '馨', '麟', '翰', '璟', '瑾', '德', '毅', '慧', '霖', '薇', '磊', '磐', '墨', '澈', '澜', '澄', '藏']);
