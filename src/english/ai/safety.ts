/**
 * 儿童内容安全边界
 *
 * 这一层站在模型和孩子之间，两个方向都要管：
 *
 *   孩子 → 模型：孩子会毫无防备地说出住址、学校、爸爸的电话。
 *                这些内容**在离开这个函数之前就被抹掉**，不进 prompt，
 *                不进存档，不发给任何网关。
 *
 *   模型 → 孩子：模型可能问不该问的、聊不该聊的、吓唬孩子、引导消费。
 *                任何一条命中，这句话都不会被念出来，而是换成一句安全的话，
 *                并在家长端留一条记录。
 *
 * 为什么是关键词 + 规则而不是再调一次模型来做审核：
 *  1. 审核必须在没有网络、没有 API Key 时照样生效，否则 Mock 模式就是裸奔的。
 *  2. 审核结果必须确定、可测试、可解释。家长问「为什么这句被拦了」，
 *     答案应该是一条能指出来的规则。
 *
 * 这套规则不完备，也不可能完备。它是底线，不是全部——
 * 真正的安全还依赖 prompt 约束（见 prompt.ts）和内容本身的范围限定。
 */

/** 模型绝对不能向孩子索取的信息 */
const ASK_PII = [
  /\b(where do you live|what'?s your address|your home address)\b/i,
  /\b(phone|telephone|mobile)\s*(number)?\b/i,
  /\b(what school|which school|school name|your school is)\b/i,
  /\b(send me a photo|send a picture of you|upload your)\b/i,
  /\b(id card|passport|credit card|bank)\b/i,
  /\b(full name|last name|family name|surname)\b/i,
  /(家住|住哪|地址|几号楼|电话号码|手机号|身份证|哪个学校|学校在哪)/,
];

/** 引导线下接触陌生人 */
const STRANGER = [
  /\b(meet me|come to my|see you in person|let'?s meet)\b/i,
  /\b(don'?t tell your (mom|dad|parents))\b/i,
  /\b(our secret|keep it a secret)\b/i,
  /(别告诉爸爸妈妈|我们的秘密|见面吧)/,
];

/** 引导消费 */
const MONEY = [
  /\b(buy|purchase|subscribe|pay|upgrade|premium|discount|only \$?\d)\b/i,
  /(购买|付费|充值|订阅|开通会员|优惠|折扣)/,
];

/** 不适合年龄的内容 */
const UNSAFE_TOPIC = [
  /\b(kill|die|dead|blood|gun|knife|war|drug|alcohol|beer|wine|smoke|sex|kiss)\b/i,
  /\b(scary|nightmare|monster will|ghost will get)\b/i,
  /(死|杀|血|枪|刀|战争|毒品|酒|抽烟)/,
];

/** 恐吓式激励 */
const FEAR = [
  /\b(you will fail|you are (stupid|dumb|bad)|no one will like you|you'?ll be punished)\b/i,
  /\b(if you don'?t .{0,30}, you (will|'ll) (lose|fail|be))\b/i,
  /(笨|蠢|没人喜欢你|会被罚|考不上|别人都比你)/,
];

export type SafetyRule = 'ask-pii' | 'stranger' | 'money' | 'unsafe-topic' | 'fear';

export interface SafetyVerdict {
  ok: boolean;
  rule?: SafetyRule;
  /** 被拦下时用这句代替。永远是一句能把对话拉回学习的话 */
  replacement?: string;
  /** 给家长端看的说明，不给孩子看 */
  note?: string;
}

const RULES: { id: SafetyRule; pats: RegExp[]; note: string }[] = [
  { id: 'ask-pii', pats: ASK_PII, note: 'AI 试图询问住址/电话/学校等个人信息，已拦截。' },
  { id: 'stranger', pats: STRANGER, note: 'AI 出现了引导线下接触或"保密"的说法，已拦截。' },
  { id: 'money', pats: MONEY, note: 'AI 出现了引导消费的内容，已拦截。' },
  { id: 'unsafe-topic', pats: UNSAFE_TOPIC, note: 'AI 提到了不适合这个年龄的内容，已拦截。' },
  { id: 'fear', pats: FEAR, note: 'AI 使用了贬低或恐吓式的说法，已拦截。' },
];

/** 被拦下时换上的话。按规则给不同的转场，但都回到学习本身 */
const SAFE_REPLY: Record<SafetyRule, string> = {
  'ask-pii': "Let's look at the picture! What is this?",
  stranger: "Let's play a game instead! Are you ready?",
  money: "Let's keep learning! Listen to this word.",
  'unsafe-topic': "Let's talk about something fun! Do you like animals?",
  fear: "Good try! Let's do it together. Listen.",
};

/** 检查 AI 要对孩子说的话 */
export function checkOutbound(text: string): SafetyVerdict {
  for (const r of RULES) {
    if (r.pats.some((p) => p.test(text))) {
      return { ok: false, rule: r.id, replacement: SAFE_REPLY[r.id], note: r.note };
    }
  }
  return { ok: true };
}

// ———————————————— 孩子说的话 ————————————————

/** 孩子可能脱口而出的敏感信息 */
const CHILD_PII: { pat: RegExp; label: string }[] = [
  { pat: /\b\d[\d\s-]{6,}\b/g, label: '号码' },
  { pat: /\b\d{1,4}\s+\w+\s+(street|road|avenue|ave|st|rd|lane)\b/gi, label: '地址' },
  { pat: /[一-龥]{2,}(省|市|区|县|路|街|号楼|小区|幼儿园|小学)/g, label: '地址或学校' },
  { pat: /\b[\w.]+@[\w.]+\.\w+\b/g, label: '邮箱' },
];

export interface ScrubResult {
  /** 抹掉敏感信息之后的文本。这是唯一允许继续往下传的版本 */
  text: string;
  /** 是否命中过敏感信息 */
  found: boolean;
  labels: string[];
}

/**
 * 抹掉孩子话里的敏感信息。
 *
 * 命中之后不做任何追问，也不提醒孩子「你不该说这个」——
 * 那只会让孩子困惑或者害怕。正确的做法是安静地丢掉，然后把话题带回学习。
 */
export function scrubChildInput(text: string): ScrubResult {
  let out = text;
  const labels: string[] = [];
  for (const { pat, label } of CHILD_PII) {
    if (pat.test(out)) {
      labels.push(label);
      out = out.replace(pat, ' ');
    }
    pat.lastIndex = 0;
  }
  return { text: out.replace(/\s+/g, ' ').trim(), found: labels.length > 0, labels };
}

/** 孩子说了敏感信息之后，教练该说的话。不追问，不评判，直接换话题 */
export const DEFLECT = [
  "Okay! Let's look at this picture. What is it?",
  "Got it! Now, can you say this word with me?",
  "Nice! Let's play a word game now.",
];
