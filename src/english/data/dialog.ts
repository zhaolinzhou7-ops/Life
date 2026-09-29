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
 *
 * 每一级有多条话题链（start 标记链头）。第一版每级只有一条，孩子每天听到的
 * 都是一模一样的对话——到第三天就只剩背台词了。现在由任务生成器按当天学的词
 * 挑一条最相关的链，并且避开最近聊过的（见 engine/mission.ts 的 pickTalk）。
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
  /**
   * 唯一正确答案。只有设了它，答不上来时才给音头提示（"It's r..."）。
   *
   * 以前直接拿 expect[0] 当答案：问 "How old are you?" 时 expect[0] 是 one，
   * 一个五岁孩子答不上来，听到的提示是 "It's o..."——等于告诉他自己一岁。
   * 问 "Do you like cats?" 答不上来，提示是 "It's y..."——替孩子决定了喜好。
   * 没有唯一答案的问题，只用 hint 给句型，不给音头。
   */
  answer?: string;
  /** 答不上来时的句型提示 */
  hint: string;
  /** 答对后教练的回应。{a} 会被替换成孩子说的内容 */
  echo: string;
  /** 这一轮练到的词，用于回写学习记录 */
  wordIds?: string[];
  /** 同一话题内的下一问 */
  next?: string;
  /** 链头 */
  start?: boolean;
  /** 自我介绍链：只在孩子第一次和 Coco 说话时用。天天说 "I am Coco" 很怪 */
  intro?: boolean;
  /** 链头才有：这条链聊什么（家长端显示） */
  title?: string;
  /** 链头才有：聊完之后孩子能做到什么（§21） */
  outcome?: string;
}

const YES_NO = ['yes', 'no', 'yeah', 'yep', 'nope', 'i do', 'i like'];
const COLORS = ['red', 'blue', 'yellow', 'green', 'black', 'white', 'pink', 'orange', 'purple', 'brown'];
const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

export const TALK_NODES: TalkNode[] = [
  // ════════════════ Level 1 ════════════════

  // —— 认识 Coco（只在第一次用） ——
  {
    id: 't1-hello',
    level: 1,
    start: true,
    intro: true,
    title: '认识 Coco',
    outcome: '能回答 name / age / what is this / what color 这类问题',
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
    expect: NUMBERS,
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
    answer: 'apple',
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
    answer: 'red',
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
    expect: YES_NO,
    hint: 'Say: yes or no.',
    echo: 'Okay! Cats are nice.',
    wordIds: ['w-cat'],
  },

  // —— 吃的 ——
  {
    id: 't1f-hungry',
    level: 1,
    start: true,
    title: '聊吃的',
    outcome: '能说出常见水果的名字和颜色，能用 yes / no 回答喜不喜欢',
    ask: 'Hi! Are you hungry?',
    askZh: '你饿了吗？',
    emoji: '🍽️',
    expect: YES_NO,
    hint: 'Say: yes or no.',
    echo: 'Me too! Let us look at some food.',
    wordIds: ['w-hungry'],
    next: 't1f-banana',
  },
  {
    id: 't1f-banana',
    level: 1,
    ask: 'What is this? 🍌',
    askZh: '这是什么？',
    emoji: '🍌',
    expect: ['banana', 'a banana'],
    answer: 'banana',
    hint: "It's a b...",
    echo: 'Yes! A banana!',
    wordIds: ['w-banana'],
    next: 't1f-yellow',
  },
  {
    id: 't1f-yellow',
    level: 1,
    ask: 'What color is the banana?',
    askZh: '香蕉是什么颜色？',
    emoji: '🍌',
    expect: ['yellow', 'green'],
    answer: 'yellow',
    hint: 'Yellow? Blue?',
    echo: 'Yes! The banana is {a}.',
    wordIds: ['w-yellow'],
    next: 't1f-like',
  },
  {
    id: 't1f-like',
    level: 1,
    ask: 'Do you like bananas?',
    askZh: '你喜欢香蕉吗？',
    emoji: '😋',
    expect: YES_NO,
    hint: 'Say: yes or no.',
    echo: 'Okay! Thank you for telling me.',
    wordIds: ['w-banana'],
  },

  // —— 动物 ——
  {
    id: 't1a-dog',
    level: 1,
    start: true,
    title: '聊动物',
    outcome: '能说出常见动物的名字，能用 big / small 描述',
    ask: 'Look at this animal! What is it? 🐶',
    askZh: '这是什么动物？',
    emoji: '🐶',
    expect: ['dog', 'a dog', 'puppy'],
    answer: 'dog',
    hint: "It's a d...",
    echo: 'Yes! A dog! Woof woof!',
    wordIds: ['w-dog'],
    next: 't1a-cat',
  },
  {
    id: 't1a-cat',
    level: 1,
    ask: 'And this one? 🐱',
    askZh: '这一个呢？',
    emoji: '🐱',
    expect: ['cat', 'a cat', 'kitty'],
    answer: 'cat',
    hint: "It's a c...",
    echo: 'Yes! A cat! Meow!',
    wordIds: ['w-cat'],
    next: 't1a-big',
  },
  {
    id: 't1a-big',
    level: 1,
    ask: 'Is an elephant big or small? 🐘',
    askZh: '大象是大的还是小的？',
    emoji: '🐘',
    expect: ['big', 'very big', 'large'],
    answer: 'big',
    hint: 'Big? Small?',
    echo: 'Yes! The elephant is very big!',
    wordIds: ['w-elephant', 'w-big'],
    next: 't1a-like',
  },
  {
    id: 't1a-like',
    level: 1,
    ask: 'Which animal do you like?',
    askZh: '你喜欢哪个动物？',
    emoji: '🐾',
    expect: [],
    open: true,
    hint: 'Say: a dog, a cat, a panda...',
    echo: 'Nice! I like {a} too!',
    wordIds: ['w-dog', 'w-cat'],
  },

  // —— 颜色 ——
  {
    id: 't1c-sun',
    level: 1,
    start: true,
    title: '聊颜色',
    outcome: '能说出身边东西的颜色，会说自己喜欢的颜色',
    ask: 'What color is the sun? ☀️',
    askZh: '太阳是什么颜色？',
    emoji: '☀️',
    expect: ['yellow', 'orange', 'red'],
    answer: 'yellow',
    hint: "It's y...",
    echo: 'Yes! The sun is {a}!',
    wordIds: ['w-yellow', 'w-sun'],
    next: 't1c-grass',
  },
  {
    id: 't1c-grass',
    level: 1,
    ask: 'What color is the tree? 🌳',
    askZh: '树是什么颜色？',
    emoji: '🌳',
    expect: ['green', 'brown'],
    answer: 'green',
    hint: "It's g...",
    echo: 'Yes! The tree is green.',
    wordIds: ['w-green', 'w-tree'],
    next: 't1c-fav',
  },
  {
    id: 't1c-fav',
    level: 1,
    ask: 'What color do you like?',
    askZh: '你喜欢什么颜色？',
    emoji: '🎨',
    expect: COLORS,
    hint: 'Red? Blue? Pink?',
    echo: '{a}! What a nice color!',
    wordIds: ['w-red', 'w-blue', 'w-pink'],
  },

  // —— 数数 ——
  {
    id: 't1n-apples',
    level: 1,
    start: true,
    title: '一起数数',
    outcome: '能数出 1~5 个东西，能说出自己的年龄',
    ask: "Let's count! How many apples? 🍎🍎🍎",
    askZh: '有几个苹果？',
    emoji: '🍎',
    expect: ['three', '3'],
    answer: 'three',
    hint: 'One, two... th...',
    echo: 'Yes! Three apples!',
    wordIds: ['w-three', 'w-apple'],
    next: 't1n-cats',
  },
  {
    id: 't1n-cats',
    level: 1,
    ask: 'How many cats? 🐱🐱',
    askZh: '有几只猫？',
    emoji: '🐱',
    expect: ['two', '2'],
    answer: 'two',
    hint: "It's t...",
    echo: 'Yes! Two cats!',
    wordIds: ['w-two', 'w-cat'],
    next: 't1n-age',
  },
  {
    id: 't1n-age',
    level: 1,
    ask: 'How old are you?',
    askZh: '你几岁了？',
    emoji: '🎂',
    expect: NUMBERS,
    hint: 'Say a number: four, five, six...',
    echo: '{a}! Great!',
    wordIds: ['w-four', 'w-five', 'w-six'],
  },

  // —— 身体 ——
  {
    id: 't1b-nose',
    level: 1,
    start: true,
    title: '我的身体',
    outcome: '能指着说出 nose / ear / eye，会数自己的眼睛',
    ask: 'Touch your nose! What is this? 👃',
    askZh: '摸摸你的鼻子，这是什么？',
    emoji: '👃',
    expect: ['nose', 'my nose', 'a nose'],
    answer: 'nose',
    hint: "It's n...",
    echo: 'Yes! Your nose!',
    wordIds: ['w-nose'],
    next: 't1b-ear',
  },
  {
    id: 't1b-ear',
    level: 1,
    ask: 'And this? 👂',
    askZh: '这个呢？',
    emoji: '👂',
    expect: ['ear', 'my ear', 'ears'],
    answer: 'ear',
    hint: "It's e...",
    echo: 'Yes! An ear! We hear with our ears.',
    wordIds: ['w-ear'],
    next: 't1b-eyes',
  },
  {
    id: 't1b-eyes',
    level: 1,
    ask: 'How many eyes do you have?',
    askZh: '你有几只眼睛？',
    emoji: '👀',
    expect: ['two', '2', 'two eyes'],
    answer: 'two',
    hint: 'One, t...',
    echo: 'Yes! Two eyes! Great job!',
    wordIds: ['w-eye', 'w-two'],
  },

  // ════════════════ Level 2 ════════════════

  // —— 今天 ——
  {
    id: 't2-hello',
    level: 2,
    start: true,
    title: '今天过得怎样',
    outcome: '能说出今天吃了什么、做了什么',
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
    expect: COLORS,
    hint: 'Red? Blue? Yellow?',
    echo: 'Nice! I like {a} too.',
    wordIds: ['w-red', 'w-blue'],
  },

  // —— 天气 ——
  {
    id: 't2w-weather',
    level: 2,
    start: true,
    title: '聊天气',
    outcome: '能说出今天的天气和冷热，能说出下雨天穿什么',
    ask: 'Look outside! Is it sunny or rainy today?',
    askZh: '看看外面，今天是晴天还是下雨？',
    emoji: '🌤️',
    expect: ['sunny', 'rainy', 'cloudy', 'snowy', 'windy', 'sun', 'rain', 'snow', 'cloud'],
    hint: 'Say: It is sunny. Or: It is rainy.',
    echo: '{a}! Thank you for telling me.',
    wordIds: ['w-sun', 'w-rain', 'w-cloud'],
    next: 't2w-hot',
  },
  {
    id: 't2w-hot',
    level: 2,
    ask: 'Is it hot or cold?',
    askZh: '今天热还是冷？',
    emoji: '🌡️',
    expect: ['hot', 'cold', 'warm', 'cool', 'not hot', 'not cold'],
    hint: 'Say: It is hot. Or: It is cold.',
    echo: 'Okay, it is {a} today.',
    wordIds: ['w-hot', 'w-cold'],
    next: 't2w-wear',
  },
  {
    id: 't2w-wear',
    level: 2,
    ask: 'What do you wear on a rainy day?',
    askZh: '下雨天你穿什么、带什么？',
    emoji: '☂️',
    expect: [],
    open: true,
    hint: 'Say: I wear a coat. Or: I take an umbrella.',
    echo: 'Good idea! Then you stay dry.',
    wordIds: ['w-umbrella', 'w-coat'],
  },

  // —— 学校与朋友 ——
  {
    id: 't2s-school',
    level: 2,
    start: true,
    title: '学校和朋友',
    outcome: '能说出书包里有什么、和朋友一起做什么',
    ask: 'Do you go to school?',
    askZh: '你上学吗？',
    emoji: '🏫',
    expect: YES_NO,
    hint: 'Say: yes or no.',
    echo: 'Great! School is fun.',
    wordIds: ['w-school'],
    next: 't2s-bag',
  },
  {
    id: 't2s-bag',
    level: 2,
    ask: 'What is in your backpack?',
    askZh: '你的书包里有什么？',
    emoji: '🎒',
    expect: [],
    open: true,
    hint: 'Say: a book, a pencil, a crayon...',
    echo: '{a}! That is very useful.',
    wordIds: ['w-backpack', 'w-pencil', 'w-book'],
    next: 't2s-friend',
  },
  {
    id: 't2s-friend',
    level: 2,
    ask: 'What do you like to do with your friend?',
    askZh: '你喜欢和朋友一起做什么？',
    emoji: '🤝',
    expect: [],
    open: true,
    hint: 'Say: We play. Or: We draw.',
    echo: 'That sounds like fun!',
    wordIds: ['w-friend', 'w-play', 'w-draw'],
  },

  // —— 小动物 ——
  {
    id: 't2p-pet',
    level: 2,
    start: true,
    title: '聊小动物',
    outcome: '能说出喜欢的动物，描述它的颜色和吃什么',
    ask: 'Do you have a pet at home?',
    askZh: '你家里有小动物吗？',
    emoji: '🐾',
    expect: YES_NO,
    hint: 'Say: yes or no.',
    echo: 'Okay! Let us talk about animals.',
    wordIds: ['w-dog', 'w-cat'],
    next: 't2p-which',
  },
  {
    id: 't2p-which',
    level: 2,
    ask: 'What animal do you like best?',
    askZh: '你最喜欢什么动物？',
    emoji: '🐼',
    expect: [],
    open: true,
    hint: 'Say: I like pandas. Or: I like rabbits.',
    echo: '{a}! Good choice!',
    wordIds: ['w-panda', 'w-rabbit', 'w-dog'],
    next: 't2p-color',
  },
  {
    id: 't2p-color',
    level: 2,
    ask: 'What color is it?',
    askZh: '它是什么颜色的？',
    emoji: '🎨',
    expect: COLORS,
    hint: 'Say: It is white. Or: It is brown.',
    echo: 'A {a} one! I can see it in my head.',
    wordIds: ['w-white', 'w-brown'],
    next: 't2p-eat',
  },
  {
    id: 't2p-eat',
    level: 2,
    ask: 'What does it eat?',
    askZh: '它吃什么？',
    emoji: '🥕',
    expect: [],
    open: true,
    hint: 'Say: It eats carrots. Or: It eats fish.',
    echo: 'Yummy! Thank you for telling me.',
    wordIds: ['w-carrot', 'w-eat'],
  },

  // —— 喜欢吃什么 ——
  {
    id: 't2e-fruit',
    level: 2,
    start: true,
    title: '最喜欢的食物',
    outcome: '能说出喜欢的水果、早饭吃什么，会用 I like ...',
    ask: 'What is your favorite fruit?',
    askZh: '你最喜欢什么水果？',
    emoji: '🍓',
    expect: [],
    open: true,
    hint: 'Say: I like apples. Or: I like grapes.',
    echo: '{a}! So sweet and yummy!',
    wordIds: ['w-apple', 'w-strawberry', 'w-grapes'],
    next: 't2e-breakfast',
  },
  {
    id: 't2e-breakfast',
    level: 2,
    ask: 'What do you eat in the morning?',
    askZh: '你早上吃什么？',
    emoji: '🥣',
    expect: [],
    open: true,
    hint: 'Say: I eat eggs and bread.',
    echo: 'That is a good breakfast!',
    wordIds: ['w-egg', 'w-bread', 'w-milk'],
    next: 't2e-veg',
  },
  {
    id: 't2e-veg',
    level: 2,
    ask: 'Do you like carrots? 🥕',
    askZh: '你喜欢胡萝卜吗？',
    emoji: '🥕',
    expect: YES_NO,
    hint: 'Say: yes or no.',
    echo: 'Okay! Carrots help you see well.',
    wordIds: ['w-carrot'],
  },

  // ════════════════ Level 3 ════════════════

  // —— 我的一天 ——
  {
    id: 't3-hello',
    level: 3,
    start: true,
    title: '我的一天',
    outcome: '能就一天的生活连续说几句完整的话',
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

  // —— 长大想做什么 ——
  {
    id: 't3j-grow',
    level: 3,
    start: true,
    title: '长大想做什么',
    outcome: '会说 I want to be a ... because ...，能描述一个职业做什么',
    ask: 'What do you want to be when you grow up?',
    askZh: '你长大想做什么？',
    emoji: '🌟',
    expect: [],
    open: true,
    hint: 'Say: I want to be a doctor. Or: a teacher, a pilot...',
    echo: 'A {a}! That is a wonderful dream.',
    wordIds: ['w-doctor', 'w-teacher', 'w-pilot'],
    next: 't3j-why',
  },
  {
    id: 't3j-why',
    level: 3,
    ask: 'Why do you want to do that job?',
    askZh: '为什么想做这个？',
    emoji: '🤔',
    expect: [],
    open: true,
    hint: 'Say: Because I want to help people.',
    echo: 'That is a very good reason.',
    wordIds: ['w-help'],
    next: 't3j-day',
  },
  {
    id: 't3j-day',
    level: 3,
    ask: 'What does a doctor do every day?',
    askZh: '医生每天做什么？',
    emoji: '👩‍⚕️',
    expect: [],
    open: true,
    hint: 'Say: A doctor helps sick people.',
    echo: 'Yes! You know a lot about jobs.',
    wordIds: ['w-doctor', 'w-sick'],
  },

  // —— 季节 ——
  {
    id: 't3s-season',
    level: 3,
    start: true,
    title: '最喜欢的季节',
    outcome: '能说出喜欢的季节，并说出这个季节做什么、穿什么',
    ask: 'Which season do you like best: spring, summer, autumn or winter?',
    askZh: '你最喜欢哪个季节？',
    emoji: '🍂',
    expect: ['spring', 'summer', 'autumn', 'winter', 'fall'],
    hint: 'Say: I like summer best.',
    echo: '{a}! That is a lovely season.',
    wordIds: ['w-spring', 'w-summer', 'w-autumn', 'w-winter'],
    next: 't3s-do',
  },
  {
    id: 't3s-do',
    level: 3,
    ask: 'What do you like to do in that season?',
    askZh: '那个季节你喜欢做什么？',
    emoji: '⛄',
    expect: [],
    open: true,
    hint: 'Say: I like to swim. Or: I like to play in the snow.',
    echo: 'That sounds like so much fun!',
    wordIds: ['w-swim', 'w-snow', 'w-play'],
    next: 't3s-wear',
  },
  {
    id: 't3s-wear',
    level: 3,
    ask: 'What do you wear then?',
    askZh: '那时候你穿什么？',
    emoji: '🧥',
    expect: [],
    open: true,
    hint: 'Say: I wear a coat and gloves.',
    echo: 'Good choice! You will feel great.',
    wordIds: ['w-coat', 'w-gloves', 'w-hat'],
  },

  // —— 出去玩 ——
  {
    id: 't3t-trip',
    level: 3,
    start: true,
    title: '想去哪里玩',
    outcome: '能说出想去的地方、怎么去、会看到什么',
    ask: 'If you could go on a trip, where would you go?',
    askZh: '如果去旅行，你想去哪里？',
    emoji: '🗺️',
    expect: [],
    open: true,
    hint: 'Say: I want to go to the beach. Or: the zoo, the city...',
    echo: 'Wow, {a}! That sounds exciting.',
    wordIds: ['w-beach', 'w-city', 'w-park'],
    next: 't3t-how',
  },
  {
    id: 't3t-how',
    level: 3,
    ask: 'How would you get there? By bus, by train or by plane?',
    askZh: '你怎么去？坐公交、火车还是飞机？',
    emoji: '🚆',
    expect: ['bus', 'train', 'plane', 'car', 'boat', 'bike', 'walk', 'ship', 'taxi'],
    hint: 'Say: By train.',
    echo: 'By {a}! What a fun way to travel.',
    wordIds: ['w-bus', 'w-train', 'w-plane'],
    next: 't3t-see',
  },
  {
    id: 't3t-see',
    level: 3,
    ask: 'What do you want to see there?',
    askZh: '你想在那里看到什么？',
    emoji: '👀',
    expect: [],
    open: true,
    hint: 'Say: I want to see the sea and the boats.',
    echo: 'I hope you see it one day!',
    wordIds: ['w-sea', 'w-boat', 'w-look'],
  },

  // —— 帮忙与心情 ——
  {
    id: 't3h-help',
    level: 3,
    start: true,
    title: '帮忙和心情',
    outcome: '能说出自己在家怎么帮忙、什么让自己开心',
    ask: 'How do you help at home?',
    askZh: '你在家里怎么帮忙？',
    emoji: '🤲',
    expect: [],
    open: true,
    hint: 'Say: I help my mom cook. Or: I clean my room.',
    echo: 'You are a great helper!',
    wordIds: ['w-help', 'w-cook', 'w-clean'],
    next: 't3h-sad',
  },
  {
    id: 't3h-sad',
    level: 3,
    ask: 'When you feel sad, what makes you feel better?',
    askZh: '难过的时候，什么会让你好起来？',
    emoji: '🌈',
    expect: [],
    open: true,
    hint: 'Say: A hug from my mom makes me feel better.',
    echo: 'That is really nice.',
    wordIds: ['w-sad', 'w-mom'],
    next: 't3h-happy',
  },
  {
    id: 't3h-happy',
    level: 3,
    ask: 'What makes you happy?',
    askZh: '什么让你开心？',
    emoji: '😄',
    expect: [],
    open: true,
    hint: 'Say: Playing with my friends makes me happy.',
    echo: 'I am happy to hear that!',
    wordIds: ['w-happy', 'w-friend', 'w-play'],
  },
];

const BY_ID = new Map(TALK_NODES.map((n) => [n.id, n]));

export function getNode(id: string): TalkNode | undefined {
  return BY_ID.get(id);
}

/** 某一级的默认链头：优先自我介绍链，保证第一次和 Coco 说话时有开场 */
export function firstNode(level: 1 | 2 | 3): TalkNode {
  const n =
    TALK_NODES.find((x) => x.level === level && x.start && x.intro) ??
    TALK_NODES.find((x) => x.level === level && x.start) ??
    TALK_NODES.find((x) => x.level === level);
  return n ?? TALK_NODES[0];
}

/** 某一级所有的链头 */
export function talkStarts(level: 1 | 2 | 3): TalkNode[] {
  return TALK_NODES.filter((n) => n.level === level && n.start);
}

/** 从链头顺着 next 走完整条链。最多走 12 步，防止数据写错成环时死循环 */
export function chainOf(startId: string): TalkNode[] {
  const out: TalkNode[] = [];
  let cur = getNode(startId);
  while (cur && out.length < 12) {
    if (out.includes(cur)) break;
    out.push(cur);
    cur = cur.next ? getNode(cur.next) : undefined;
  }
  return out;
}
