/**
 * 测评题库
 *
 * 设计目标是**轻量**：十四道题，六到八分钟，第一次打开产品的人愿意做完。
 * 不是考试，是诊断——所以题目要能分辨出"哪一项拖后腿"，而不是给一个总分。
 *
 * 三段结构对应第 3 节：
 *   输入能力 → 阅读 / 听力 / 词汇辨认
 *   输出能力 → 词汇运用 / 翻译 / 写作
 *   实际交流 → 自由表达（说或打）
 *
 * 词汇特意分成"认得出"和"用得上"两组题。成年人最典型的画像就是
 * 前者远高于后者，而只考前者的产品永远测不出这件事。
 *
 * 所有短文都是为这个产品写的，不抓取任何有版权的内容。
 */

import type { ChoiceItem, OpenItem } from '../types';

// ══════════════════ 输入能力 ══════════════════

export const READING: ChoiceItem[] = [
  {
    id: 'r-b1',
    kind: 'reading',
    level: 'B1',
    passage:
      "Mei had been putting off the conversation for weeks. Her manager kept saying the project was " +
      "\"on track,\" but everyone on the team knew the deadline had stopped being realistic back in March. " +
      "On Monday she finally asked for ten minutes. She did not complain. Instead she brought a one-page " +
      "list: what was finished, what was not, and what would have to move. Her manager looked at it for a " +
      "long moment and said, \"Why didn't anyone tell me this sooner?\"",
    prompt: 'Why did the manager seem surprised?',
    options: [
      'Because Mei complained about her workload',
      'Because no one had told him the project was behind',
      'Because Mei wanted to leave the team',
      'Because the project had already finished',
    ],
    answer: 1,
    explain:
      '最后一句 "Why didn\'t anyone tell me this sooner?" 说明他此前不知道进度落后。注意题干问的是"为什么惊讶"，不是"发生了什么"。',
  },
  {
    id: 'r-b2',
    kind: 'reading',
    level: 'B2',
    passage:
      "There is a common assumption that people who hesitate when speaking a second language simply " +
      "lack vocabulary. In practice, the opposite is often true. Many adult learners know far more words " +
      "than they can reach in real time. The bottleneck is not storage but retrieval: under the pressure " +
      "of a live conversation, the brain is still busy assembling a sentence in the first language and " +
      "translating it, a process that is far too slow for ordinary speech. Learners who practise producing " +
      "short, imperfect sentences quickly tend to improve faster than those who wait until they can " +
      "produce a correct one.",
    prompt: 'According to the passage, what mainly causes hesitation?',
    options: [
      'A limited vocabulary',
      'Poor pronunciation',
      'Difficulty retrieving known words fast enough',
      'A lack of grammar knowledge',
    ],
    answer: 2,
    explain:
      '"The bottleneck is not storage but retrieval" 是全文的核心句。storage（存着多少）对应词汇量，retrieval（取得出来）才是问题。',
  },
];

export const LISTENING: ChoiceItem[] = [
  {
    id: 'l-a2',
    kind: 'listening',
    level: 'A2',
    speed: 'slow',
    passage: "Hi, this is Anna from the dentist's office. Your appointment on Thursday has been moved to Friday at ten. Please call us back if that doesn't work.",
    prompt: '这段话的重点是什么？',
    options: ['预约取消了', '预约从周四改到了周五十点', '需要提前付款', '医生要换人了'],
    answer: 1,
    explain: '关键信息是 "moved to Friday at ten"。moved to 是"改到"，不是"取消"。',
  },
  {
    id: 'l-b1',
    kind: 'listening',
    level: 'B1',
    speed: 'normal',
    passage:
      "So the good news is the design is basically done. The bad news is we're still waiting on the API " +
      "from the platform team, and until that lands we can't really test anything end to end. " +
      "I'd say we're looking at another week, maybe ten days.",
    prompt: 'What is blocking the team?',
    options: [
      'The design is not finished',
      'They are waiting for the API from another team',
      'They have no budget left',
      'Testing has already failed',
    ],
    answer: 1,
    explain: '"we\'re still waiting on the API from the platform team" 是卡点。注意 design 那句说的是好消息。',
  },
  {
    id: 'l-b2',
    kind: 'listening',
    level: 'B2',
    speed: 'fast',
    passage:
      "Yeah, I mean, I get where she's coming from, but I don't think shipping on Friday is worth the risk. " +
      "If something breaks over the weekend there's literally no one around to fix it. I'd rather push it to " +
      "Monday and sleep properly, honestly.",
    prompt: "What is the speaker's position?",
    options: [
      'He fully agrees with shipping on Friday',
      'He understands her view but prefers to wait until Monday',
      'He thinks the project should be cancelled',
      'He wants someone to work over the weekend',
    ],
    answer: 1,
    explain:
      '"I get where she\'s coming from, but…" 是典型的"先认可再反对"。这种结构在真实工作对话里极常见，听不出 but 前后的关系就会理解反。',
  },
];

export const VOCAB_RECOGNIZE: ChoiceItem[] = [
  {
    id: 'v-r-a2',
    kind: 'vocab-recognize',
    level: 'A2',
    prompt: '“available” 在 "Are you available on Friday?" 里是什么意思？',
    options: ['可用的、有空的', '昂贵的', '必需的', '可靠的'],
    answer: 0,
    explain: 'available 问的是"有没有空"，是约时间时最常用的说法。',
  },
  {
    id: 'v-r-b1',
    kind: 'vocab-recognize',
    level: 'B1',
    prompt: '“I’ll follow up with them tomorrow.” 里的 follow up 是什么意思？',
    options: ['跟在他们后面走', '跟进、后续联系', '模仿他们的做法', '向上级汇报'],
    answer: 1,
    explain: 'follow up 是工作里最高频的短语动词之一：把一件没完的事继续推进。',
  },
  {
    id: 'v-r-b2',
    kind: 'vocab-recognize',
    level: 'B2',
    prompt: '“Thanks for the heads-up.” 是在谢什么？',
    options: ['谢谢对方抬头看', '谢谢对方提前告知', '谢谢对方的鼓励', '谢谢对方帮忙完成'],
    answer: 1,
    explain: 'heads-up 指"提前打个招呼"，让你有准备。同事之间极常用。',
  },
];

export const VOCAB_USE: ChoiceItem[] = [
  {
    id: 'v-u-1',
    kind: 'vocab-use',
    level: 'A2',
    prompt: '选一个最自然的：同事问你周五能不能开会，你想说"我看一下日程"。',
    options: [
      'Let me see see my time.',
      'Let me check my schedule.',
      'I will look my schedule.',
      'Wait, I see my time table.',
    ],
    answer: 1,
    explain: 'check my schedule 是固定说法。其它三个都能猜出意思，但没有人这么说。',
  },
  {
    id: 'v-u-2',
    kind: 'vocab-use',
    level: 'B1',
    prompt: '你想礼貌地表示不同意，哪一句最合适？',
    options: [
      'You are wrong about this.',
      'I am not agree with you.',
      'I see your point, but I have one concern.',
      'No, impossible.',
    ],
    answer: 2,
    explain:
      '"I see your point, but…" 是工作场合表达异议的标准开场：先接住对方，再提问题。第二个选项还有语法错误（I am agree）。',
  },
];

export const CHOICE_ITEMS: ChoiceItem[] = [...READING, ...LISTENING, ...VOCAB_RECOGNIZE, ...VOCAB_USE];

// ══════════════════ 输出能力 ══════════════════

export const OPEN_ITEMS: OpenItem[] = [
  {
    id: 'o-t1',
    kind: 'translate',
    level: 'A2',
    prompt: '我今天上班迟到了，因为地铁坏了。',
    hint: '用英语写出来。不用逐字对应，意思到了就行。',
    reference: ['I was late for work today because the subway broke down.', 'I got to work late today — the metro broke down.'],
    targets: ['be late for', '过去时', '原因从句'],
  },
  {
    id: 'o-t2',
    kind: 'translate',
    level: 'B1',
    prompt: '这个方案我基本同意，不过时间上我有点担心。',
    hint: '注意"基本同意"和"有点担心"的语气，不要变成生硬的 I agree / I worry。',
    reference: [
      "I mostly agree with this plan, but I'm a little worried about the timeline.",
      "I'm on board with the plan overall, though I do have some concerns about the timing.",
    ],
    targets: ['程度副词', '转折', 'be worried about'],
  },
  {
    id: 'o-w1',
    kind: 'write',
    level: 'B1',
    prompt: 'Write 3–4 sentences about what you did last weekend.',
    hint: '写 3~4 句关于上周末的事。写完整的句子，不要只写词组。',
    reference: [],
    targets: ['过去时', '句子长度', '连接词'],
  },
  {
    id: 'o-s1',
    kind: 'speak',
    level: 'A2',
    prompt: 'Introduce yourself: who you are, what you do, and one thing you like.',
    hint: '介绍一下自己：你是谁、做什么的、喜欢什么。能说就说出来，不方便说话可以打字。',
    reference: [],
    targets: ['自我介绍', '流利度', '表达完整度'],
  },
];

/** 完整题目顺序。先易后难，最后才是开放题——一上来就让人自由表达会劝退 */
export const ASSESSMENT_ORDER: (ChoiceItem | OpenItem)[] = [
  VOCAB_RECOGNIZE[0],
  LISTENING[0],
  READING[0],
  VOCAB_RECOGNIZE[1],
  LISTENING[1],
  VOCAB_USE[0],
  READING[1],
  VOCAB_RECOGNIZE[2],
  LISTENING[2],
  VOCAB_USE[1],
  OPEN_ITEMS[0],
  OPEN_ITEMS[1],
  OPEN_ITEMS[2],
  OPEN_ITEMS[3],
];

export const isChoice = (i: ChoiceItem | OpenItem): i is ChoiceItem => 'options' in i;
