/**
 * AI 对话脚本
 *
 * 低龄孩子不能直接面对开放式提问（"Tell me about your life."）——他们不是不想说，
 * 是不知道从哪儿开始。所以对话做成**有骨架的**：每一轮都有明确的问题、可接受的
 * 回答范围、以及答不上来时的提示。
 *
 * 这个脚本树同时是 Mock 模式的对话引擎，也是接真实模型时的护栏：
 * 模型负责把话说得自然、根据孩子的回答做个性化回应，但「现在该问什么」
 * 依然由这里决定。这样即使模型跑偏，对话也不会跑到孩子听不懂的地方去。
 *
 * 分级（§16）：
 *   L1 —— 名字、年龄、这是什么、什么颜色、喜不喜欢。全是一个词就能答的。
 *   L2 —— 今天吃了什么、做了什么、最喜欢的玩具。要短语。
 *   L3 —— 连续追问，要完整句子。
 */

export interface TalkNode {
  id: string;
  level: 1 | 2 | 3;
  ask: string;
  askZh: string;
  emoji: string;
  /**
   * 可接受的回答片段。命中任意一个即算答对。
   * open=true 时不检查内容，只要开口就算——用于「说说你今天做了什么」这种
   * 本来就没有标准答案的问题。
   */
  expect: string[];
  open?: boolean;
  /** 第一级提示。永远先给音头或选项，不直接给答案 */
  hint: string;
  /** 答对后教练的回应。{a} 会被替换成孩子说的内容 */
  echo: string;
  /** 这一轮练到的词，用于回写学习记录 */
  wordIds?: string[];
  /** 同一话题内的下一问 */
  next?: string;
}

export const TALK_NODES: TalkNode[] = [
  // ———————————————— Level 1 ————————————————
  {
    id: 't1-hello',
    level: 1,
    ask: 'Hello! I am Coco. Can you say hello?',
    askZh: '打个招呼吧',
    emoji: '🦜',
    expect: ['hello', 'hi', 'hey'],
    hint: 'Say: hello!',
    echo: 'Hello! Nice to meet you!',
    next: 't1-name',
  },
  {
    id: 't1-name',
    level: 1,
    ask: 'What is your name?',
    askZh: '你叫什么名字？',
    emoji: '😊',
    expect: [],
    open: true,
    hint: 'Say: My name is ...',
    echo: 'Nice to meet you, {a}!',
    next: 't1-age',
  },
  {
    id: 't1-age',
    level: 1,
    ask: 'How old are you?',
    askZh: '你几岁了？',
    emoji: '🎂',
    expect: ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'],
    hint: 'Say a number: four, five, six...',
    echo: 'Wow, {a}! That is great!',
    wordIds: ['w-four', 'w-five'],
    next: 't1-this',
  },
  {
    id: 't1-this',
    level: 1,
    ask: 'Look! What is this? 🍎',
    askZh: '这是什么？',
    emoji: '🍎',
    expect: ['apple', 'an apple', 'a apple'],
    hint: "It's a...",
    echo: 'Yes! An apple! Good!',
    wordIds: ['w-apple'],
    next: 't1-color',
  },
  {
    id: 't1-color',
    level: 1,
    ask: 'What color is the apple?',
    askZh: '苹果是什么颜色？',
    emoji: '🔴',
    expect: ['red', 'green'],
    hint: "It's r...",
    echo: 'Yes! A {a} apple!',
    wordIds: ['w-red'],
    next: 't1-like',
  },
  {
    id: 't1-like',
    level: 1,
    ask: 'Do you like cats? 🐱',
    askZh: '你喜欢猫吗？',
    emoji: '🐱',
    expect: ['yes', 'no', 'like', 'i like'],
    hint: 'Say: yes or no.',
    echo: 'Okay! Cats are nice.',
    wordIds: ['w-cat'],
  },

  // ———————————————— Level 2 ————————————————
  {
    id: 't2-hello',
    level: 2,
    ask: 'Hi! How are you today?',
    askZh: '今天怎么样？',
    emoji: '🦜',
    expect: ['good', 'fine', 'happy', 'ok', 'okay', 'great', 'tired', 'sad'],
    hint: 'Say: I am good.',
    echo: 'I am glad to hear that!',
    wordIds: ['w-happy'],
    next: 't2-eat',
  },
  {
    id: 't2-eat',
    level: 2,
    ask: 'What did you eat today?',
    askZh: '你今天吃了什么？',
    emoji: '🍽️',
    expect: [],
    open: true,
    hint: 'Say: I ate rice. Or: bread, eggs, apple...',
    echo: 'Yummy! I like {a} too!',
    wordIds: ['w-eat', 'w-rice', 'w-bread'],
    next: 't2-do',
  },
  {
    id: 't2-do',
    level: 2,
    ask: 'What did you do today?',
    askZh: '你今天做了什么？',
    emoji: '🏃',
    expect: [],
    open: true,
    hint: 'Say: I played. Or: I read a book.',
    echo: 'That sounds fun!',
    wordIds: ['w-play', 'w-read'],
    next: 't2-toy',
  },
  {
    id: 't2-toy',
    level: 2,
    ask: 'What is your favorite toy?',
    askZh: '你最喜欢的玩具是什么？',
    emoji: '🧸',
    expect: [],
    open: true,
    hint: 'Say: My favorite toy is a ball.',
    echo: 'A {a}! That is a great toy!',
    wordIds: ['w-ball', 'w-car', 'w-teddy-bear'],
    next: 't2-color',
  },
  {
    id: 't2-color',
    level: 2,
    ask: 'What color is it?',
    askZh: '它是什么颜色？',
    emoji: '🎨',
    expect: ['red', 'blue', 'yellow', 'green', 'black', 'white', 'pink', 'orange'],
    hint: 'Red? Blue? Yellow?',
    echo: 'Nice! I like {a} too.',
    wordIds: ['w-red', 'w-blue'],
  },

  // ———————————————— Level 3 ————————————————
  {
    id: 't3-hello',
    level: 3,
    ask: 'Hi there! Tell me, how was your day?',
    askZh: '今天过得怎么样？',
    emoji: '🦜',
    expect: [],
    open: true,
    hint: 'Say: My day was good because...',
    echo: 'Thanks for telling me!',
    next: 't3-family',
  },
  {
    id: 't3-family',
    level: 3,
    ask: 'Who do you live with? Tell me about your family.',
    askZh: '说说你的家人',
    emoji: '👨‍👩‍👧',
    expect: [],
    open: true,
    hint: 'Say: I live with my mom and dad.',
    echo: 'That is a nice family!',
    wordIds: ['w-mom', 'w-dad', 'w-brother', 'w-sister'],
    next: 't3-animal',
  },
  {
    id: 't3-animal',
    level: 3,
    ask: 'If you could have any animal, which one would you choose? Why?',
    askZh: '你想养什么动物？为什么？',
    emoji: '🐾',
    expect: [],
    open: true,
    hint: 'Say: I want a dog because it is fun.',
    echo: 'Good idea! I would like that too.',
    wordIds: ['w-dog', 'w-cat', 'w-rabbit'],
    next: 't3-tomorrow',
  },
  {
    id: 't3-tomorrow',
    level: 3,
    ask: 'What do you want to do tomorrow?',
    askZh: '明天想做什么？',
    emoji: '🌤️',
    expect: [],
    open: true,
    hint: 'Say: Tomorrow I want to play outside.',
    echo: 'That sounds great! Have fun!',
    wordIds: ['w-play', 'w-go'],
  },
];

const BY_ID = new Map(TALK_NODES.map((n) => [n.id, n]));

export function getNode(id: string): TalkNode | undefined {
  return BY_ID.get(id);
}

export function firstNode(level: 1 | 2 | 3): TalkNode {
  const n = TALK_NODES.find((x) => x.level === level);
  // 三个等级都有起始节点，这里的兜底只为满足类型
  return n ?? TALK_NODES[0];
}
