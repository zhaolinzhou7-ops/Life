/**
 * 词库
 *
 * 选词标准（不是从词频表里切前 500 个）：
 *  1. 孩子在真实生活里当天就能用上——身体、家人、吃的、动物、颜色、数字、动作。
 *  2. 能画出来。抽象词在启蒙阶段没法「看图说词」，只能翻译，那就退化成背单词了。
 *  3. 有干扰组。选择题的错项必须是同类（apple vs banana），
 *     否则孩子靠排除法就能全对，测不出真实识别能力。
 *
 * 配图用 emoji：离线可用、任何设备都能渲染、没有版权问题、不需要图片流水线。
 * 代价是表现力有限，所以动词类尽量选 emoji 能表意的（eat/drink/sleep/run/jump）。
 *
 * 例句分三级：
 *   level 1 —— 3~4 个词，给零基础，重复目标词
 *   level 2 —— 完整简单句
 *   level 3 —— 带修饰或两个信息点
 * 学习引擎按孩子当前水平取对应一级，不是所有孩子都看同一句。
 */

import type { ThemeId, Word } from '../types';

interface Seed {
  /**
   * 显式 id。默认按 en 生成，但有些词的英文写法会撞车——
   * 橙子和橙色都是 orange，自动生成的话两个词会共用一个 id，
   * 学习记录就会串在一起。
   */
  id?: string;
  en: string;
  zh: string;
  emoji: string;
  tier: 1 | 2 | 3;
  syl: number;
  pos?: Word['pos'];
  group: string;
  ask?: string;
  /** 词本身是复数（shoes/grapes） */
  plural?: boolean;
  /** 不可数（milk/water/bread） */
  mass?: boolean;
  s: [string, string, string];
}

function build(theme: ThemeId, seeds: Seed[]): Word[] {
  return seeds.map((s) => ({
    id: s.id ?? `w-${s.en.toLowerCase().replace(/\s+/g, '-')}`,
    en: s.en,
    zh: s.zh,
    emoji: s.emoji,
    theme,
    tier: s.tier,
    syllables: s.syl,
    pos: s.pos ?? 'noun',
    plural: s.plural,
    mass: s.mass,
    group: s.group,
    ask: s.ask ?? 'What is this?',
    sentences: [
      { level: 1, text: s.s[0] },
      { level: 2, text: s.s[1] },
      { level: 3, text: s.s[2] },
    ],
  }));
}

// ———————————————— 我自己 ————————————————

const SELF = build('self', [
  { en: 'head', zh: '头', emoji: '🙂', tier: 1, syl: 1, group: 'body', s: ['My head.', 'This is my head.', 'I can move my head up and down.'] },
  { en: 'hand', zh: '手', emoji: '✋', tier: 1, syl: 1, group: 'body', s: ['My hand.', 'This is my hand.', 'I wash my hands before I eat.'] },
  { en: 'foot', zh: '脚', emoji: '🦶', tier: 1, syl: 1, group: 'body', s: ['My foot.', 'This is my foot.', 'I put my foot in the shoe.'] },
  { en: 'eye', zh: '眼睛', emoji: '👁️', tier: 1, syl: 1, group: 'face', s: ['My eyes.', 'I see with my eyes.', 'I close my eyes when I sleep.'] },
  { en: 'ear', zh: '耳朵', emoji: '👂', tier: 1, syl: 1, group: 'face', s: ['My ears.', 'I hear with my ears.', 'I hear the bird with my ears.'] },
  { en: 'nose', zh: '鼻子', emoji: '👃', tier: 1, syl: 1, group: 'face', s: ['My nose.', 'This is my nose.', 'I smell the bread with my nose.'] },
  { en: 'mouth', zh: '嘴', emoji: '👄', tier: 1, syl: 1, group: 'face', s: ['My mouth.', 'I eat with my mouth.', 'I open my mouth and say hello.'] },
  { en: 'hair', mass: true, zh: '头发', emoji: '💇', tier: 2, syl: 1, group: 'face', s: ['My hair.', 'My hair is black.', 'My hair is long and black.'] },
  { en: 'hat', zh: '帽子', emoji: '🧢', tier: 1, syl: 1, group: 'clothes', s: ['A hat.', 'This is a hat.', 'I wear a blue hat to school.'] },
  { en: 'shoes', plural: true, zh: '鞋', emoji: '👟', tier: 1, syl: 1, group: 'clothes', s: ['My shoes.', 'These are my shoes.', 'My shoes are red and new.'] },
  { en: 'shirt', zh: '上衣', emoji: '👕', tier: 2, syl: 1, group: 'clothes', s: ['A shirt.', 'This is my shirt.', 'My shirt is green today.'] },
  { en: 'happy', zh: '开心', emoji: '😄', tier: 1, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am happy.', 'I am happy today.', 'I am happy because I can play.'] },
  { en: 'sad', zh: '难过', emoji: '😢', tier: 1, syl: 1, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am sad.', 'She is sad.', 'She is sad because her cat is gone.'] },
  { en: 'hungry', zh: '饿', emoji: '🍽️', tier: 2, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am hungry.', 'I am hungry now.', 'I am hungry, so I eat some bread.'] },
  { en: 'tired', zh: '累', emoji: '🥱', tier: 2, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am tired.', 'I am very tired.', 'I am tired, so I go to bed.'] },
]);

// ———————————————— 家庭 ————————————————

const FAMILY = build('family', [
  { en: 'mom', zh: '妈妈', emoji: '👩', tier: 1, syl: 1, group: 'family', ask: 'Who is this?', s: ['My mom.', 'This is my mom.', 'My mom makes bread for me.'] },
  { en: 'dad', zh: '爸爸', emoji: '👨', tier: 1, syl: 1, group: 'family', ask: 'Who is this?', s: ['My dad.', 'This is my dad.', 'My dad plays ball with me.'] },
  { en: 'brother', zh: '哥哥/弟弟', emoji: '👦', tier: 2, syl: 2, group: 'family', ask: 'Who is this?', s: ['My brother.', 'This is my brother.', 'My brother is six years old.'] },
  { en: 'sister', zh: '姐姐/妹妹', emoji: '👧', tier: 2, syl: 2, group: 'family', ask: 'Who is this?', s: ['My sister.', 'This is my sister.', 'My sister likes to sing songs.'] },
  { en: 'baby', zh: '宝宝', emoji: '👶', tier: 1, syl: 2, group: 'family', ask: 'Who is this?', s: ['A baby.', 'This is a baby.', 'The baby is sleeping now.'] },
  { en: 'grandma', zh: '奶奶/外婆', emoji: '👵', tier: 2, syl: 2, group: 'family', ask: 'Who is this?', s: ['My grandma.', 'This is my grandma.', 'My grandma tells me a story.'] },
  { en: 'grandpa', zh: '爷爷/外公', emoji: '👴', tier: 2, syl: 2, group: 'family', ask: 'Who is this?', s: ['My grandpa.', 'This is my grandpa.', 'My grandpa walks in the park.'] },
  { en: 'home', zh: '家', emoji: '🏠', tier: 1, syl: 1, group: 'place', s: ['My home.', 'This is my home.', 'I go home and see my mom.'] },
  { en: 'bed', zh: '床', emoji: '🛏️', tier: 1, syl: 1, group: 'place', s: ['A bed.', 'This is my bed.', 'I sleep in my bed at night.'] },
  { en: 'door', zh: '门', emoji: '🚪', tier: 2, syl: 1, group: 'place', s: ['A door.', 'This is a door.', 'I open the door and go in.'] },
]);

// ———————————————— 食物 ————————————————

const FOOD = build('food', [
  { en: 'apple', zh: '苹果', emoji: '🍎', tier: 1, syl: 2, group: 'fruit', s: ['An apple.', 'This is an apple.', 'I eat a red apple every day.'] },
  { en: 'banana', zh: '香蕉', emoji: '🍌', tier: 1, syl: 3, group: 'fruit', s: ['A banana.', 'This is a banana.', 'The banana is long and yellow.'] },
  { en: 'orange', zh: '橙子', emoji: '🍊', tier: 2, syl: 2, group: 'fruit', s: ['An orange.', 'This is an orange.', 'I like orange juice in the morning.'] },
  { en: 'grapes', zh: '葡萄', emoji: '🍇', tier: 2, syl: 1, plural: true, group: 'fruit', s: ['Grapes.', 'These are grapes.', 'The grapes are small and sweet.'] },
  { en: 'milk', mass: true, zh: '牛奶', emoji: '🥛', tier: 1, syl: 1, group: 'drink', s: ['Milk.', 'This is milk.', 'I drink milk before I go to bed.'] },
  { en: 'water', mass: true, zh: '水', emoji: '💧', tier: 1, syl: 2, group: 'drink', s: ['Water.', 'This is water.', 'I drink water when I am hot.'] },
  { en: 'juice', mass: true, zh: '果汁', emoji: '🧃', tier: 2, syl: 1, group: 'drink', s: ['Juice.', 'This is juice.', 'My mom gives me apple juice.'] },
  { en: 'bread', mass: true, zh: '面包', emoji: '🍞', tier: 1, syl: 1, group: 'meal', s: ['Bread.', 'This is bread.', 'I eat bread and drink milk.'] },
  { en: 'rice', mass: true, zh: '米饭', emoji: '🍚', tier: 1, syl: 1, group: 'meal', s: ['Rice.', 'This is rice.', 'We eat rice with our family.'] },
  { en: 'egg', zh: '鸡蛋', emoji: '🥚', tier: 1, syl: 1, group: 'meal', s: ['An egg.', 'This is an egg.', 'I eat one egg in the morning.'] },
  { en: 'cake', zh: '蛋糕', emoji: '🍰', tier: 2, syl: 1, group: 'meal', s: ['A cake.', 'This is a cake.', 'We eat cake on my birthday.'] },
  { en: 'fish', mass: true, zh: '鱼（吃的）', emoji: '🍣', tier: 2, syl: 1, group: 'meal', s: ['Fish.', 'This is fish.', 'My dad cooks fish for dinner.'] },
]);

// ———————————————— 动物 ————————————————

const ANIMAL = build('animal', [
  { en: 'cat', zh: '猫', emoji: '🐱', tier: 1, syl: 1, group: 'pet', s: ['A cat.', 'This is a cat.', 'The black cat is on the bed.'] },
  { en: 'dog', zh: '狗', emoji: '🐶', tier: 1, syl: 1, group: 'pet', s: ['A dog.', 'This is a dog.', 'The big dog runs in the park.'] },
  { en: 'bird', zh: '鸟', emoji: '🐦', tier: 1, syl: 1, group: 'wild', s: ['A bird.', 'This is a bird.', 'A little bird sings in the tree.'] },
  { en: 'rabbit', zh: '兔子', emoji: '🐰', tier: 2, syl: 2, group: 'pet', s: ['A rabbit.', 'This is a rabbit.', 'The white rabbit can jump high.'] },
  { en: 'elephant', zh: '大象', emoji: '🐘', tier: 2, syl: 3, group: 'wild', s: ['An elephant.', 'This is an elephant.', 'The elephant is very big and grey.'] },
  { en: 'monkey', zh: '猴子', emoji: '🐵', tier: 2, syl: 2, group: 'wild', s: ['A monkey.', 'This is a monkey.', 'The monkey eats a banana.'] },
  { en: 'tiger', zh: '老虎', emoji: '🐯', tier: 2, syl: 2, group: 'wild', s: ['A tiger.', 'This is a tiger.', 'The tiger is orange and black.'] },
  { en: 'duck', zh: '鸭子', emoji: '🦆', tier: 1, syl: 1, group: 'farm', s: ['A duck.', 'This is a duck.', 'The duck swims in the water.'] },
  { en: 'pig', zh: '猪', emoji: '🐷', tier: 1, syl: 1, group: 'farm', s: ['A pig.', 'This is a pig.', 'The pink pig is eating.'] },
  { en: 'cow', zh: '牛', emoji: '🐮', tier: 2, syl: 1, group: 'farm', s: ['A cow.', 'This is a cow.', 'The cow gives us milk.'] },
  { en: 'bear', zh: '熊', emoji: '🐻', tier: 2, syl: 1, group: 'wild', s: ['A bear.', 'This is a bear.', 'The brown bear is sleeping.'] },
  { en: 'goldfish', zh: '金鱼', emoji: '🐟', tier: 1, syl: 2, group: 'pet', s: ['A fish.', 'This is a fish.', 'The little fish swims in the water.'] },
]);

// ———————————————— 颜色 ————————————————

const COLOR = build('color', [
  { en: 'red', zh: '红色', emoji: '🔴', tier: 1, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Red.', 'It is red.', 'The apple is red and round.'] },
  { en: 'blue', zh: '蓝色', emoji: '🔵', tier: 1, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Blue.', 'It is blue.', 'The sky is blue today.'] },
  { en: 'yellow', zh: '黄色', emoji: '🟡', tier: 1, syl: 2, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Yellow.', 'It is yellow.', 'The banana is yellow and long.'] },
  { en: 'green', zh: '绿色', emoji: '🟢', tier: 1, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Green.', 'It is green.', 'The tree is green in summer.'] },
  { en: 'black', zh: '黑色', emoji: '⚫', tier: 1, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Black.', 'It is black.', 'The black cat has green eyes.'] },
  { en: 'white', zh: '白色', emoji: '⚪', tier: 1, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['White.', 'It is white.', 'The milk is white and cold.'] },
  { id: 'w-orange-color', en: 'orange', zh: '橙色', emoji: '🟠', tier: 2, syl: 2, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Orange.', 'It is orange.', 'The tiger is orange and black.'] },
  { en: 'pink', zh: '粉色', emoji: '🩷', tier: 2, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Pink.', 'It is pink.', 'The little pig is pink.'] },
]);

// ———————————————— 数字 ————————————————

const NUMBER = build('number', [
  { en: 'one', zh: '一', emoji: '1️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['One.', 'I see one cat.', 'I have one red apple.'] },
  { en: 'two', zh: '二', emoji: '2️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Two.', 'I see two dogs.', 'I have two blue hats.'] },
  { en: 'three', zh: '三', emoji: '3️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Three.', 'I see three birds.', 'Three birds sing in the tree.'] },
  { en: 'four', zh: '四', emoji: '4️⃣', tier: 2, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Four.', 'I see four ducks.', 'Four ducks swim in the water.'] },
  { en: 'five', zh: '五', emoji: '5️⃣', tier: 2, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Five.', 'I see five eggs.', 'I eat five grapes.'] },
]);

// ———————————————— 日常动作 ————————————————

const ACTION = build('action', [
  { en: 'eat', zh: '吃', emoji: '🍴', tier: 1, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Eat.', 'I eat an apple.', 'I eat rice with my family.'] },
  { en: 'drink', zh: '喝', emoji: '🥤', tier: 1, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Drink.', 'I drink milk.', 'I drink water after I run.'] },
  { en: 'sleep', zh: '睡觉', emoji: '😴', tier: 1, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Sleep.', 'I sleep in my bed.', 'The baby sleeps at night.'] },
  { en: 'play', zh: '玩', emoji: '🧩', tier: 1, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Play.', 'I play with my ball.', 'I play with my brother after school.'] },
  { en: 'run', zh: '跑', emoji: '🏃', tier: 1, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Run.', 'I can run.', 'The dog runs very fast.'] },
  { en: 'jump', zh: '跳', emoji: '🤸', tier: 1, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Jump.', 'I can jump.', 'The rabbit jumps up and down.'] },
  { en: 'go', zh: '去', emoji: '➡️', tier: 1, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Go.', 'I go home.', 'I go to school with my mom.'] },
  { en: 'come', zh: '来', emoji: '⬅️', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Come.', 'Come here.', 'Come and play with me.'] },
  { en: 'sing', zh: '唱', emoji: '🎤', tier: 2, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Sing.', 'I can sing.', 'My sister sings a happy song.'] },
  { en: 'read', zh: '读', emoji: '📖', tier: 2, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Read.', 'I read a book.', 'I read a story with my dad.'] },
  { en: 'wash', zh: '洗', emoji: '🧼', tier: 2, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Wash.', 'I wash my hands.', 'I wash my hands before I eat.'] },
  { en: 'sit', zh: '坐', emoji: '🪑', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Sit.', 'Sit down, please.', 'I sit on the chair and read.'] },
]);

// ———————————————— 玩具与自然（第二阶段，故事里会用到） ————————————————

const TOY = build('toy', [
  { en: 'ball', zh: '球', emoji: '⚽', tier: 1, syl: 1, group: 'toy', s: ['A ball.', 'This is a ball.', 'Tom plays with a red ball.'] },
  { en: 'car', zh: '小汽车', emoji: '🚗', tier: 1, syl: 1, group: 'toy', s: ['A car.', 'This is a car.', 'My toy car is blue and fast.'] },
  { en: 'book', zh: '书', emoji: '📕', tier: 1, syl: 1, group: 'toy', s: ['A book.', 'This is a book.', 'I read a book about animals.'] },
  { en: 'teddy bear', zh: '玩具熊', emoji: '🧸', tier: 2, syl: 2, group: 'toy', s: ['A teddy bear.', 'This is my teddy bear.', 'My teddy bear sleeps with me.'] },
  { en: 'kite', zh: '风筝', emoji: '🪁', tier: 2, syl: 1, group: 'toy', s: ['A kite.', 'This is a kite.', 'The kite is high in the sky.'] },
]);

const NATURE = build('nature', [
  { en: 'sun', zh: '太阳', emoji: '☀️', tier: 1, syl: 1, group: 'nature', s: ['The sun.', 'This is the sun.', 'The sun is big and hot.'] },
  { en: 'moon', zh: '月亮', emoji: '🌙', tier: 2, syl: 1, group: 'nature', s: ['The moon.', 'This is the moon.', 'The moon comes out at night.'] },
  { en: 'tree', zh: '树', emoji: '🌳', tier: 1, syl: 1, group: 'nature', s: ['A tree.', 'This is a tree.', 'A bird sits in the green tree.'] },
  { en: 'flower', zh: '花', emoji: '🌸', tier: 2, syl: 2, group: 'nature', s: ['A flower.', 'This is a flower.', 'The pink flower is very small.'] },
  { en: 'rain', mass: true, zh: '雨', emoji: '🌧️', tier: 2, syl: 1, group: 'nature', s: ['Rain.', 'It is rain.', 'I stay home when it rains.'] },
]);

export const WORDS: Word[] = [
  ...SELF,
  ...FAMILY,
  ...FOOD,
  ...ANIMAL,
  ...COLOR,
  ...NUMBER,
  ...ACTION,
  ...TOY,
  ...NATURE,
];

const BY_ID = new Map(WORDS.map((w) => [w.id, w]));

export function getWord(id: string): Word | undefined {
  return BY_ID.get(id);
}

/** 找不到就抛。调用方要么先 getWord 判空，要么确信 id 来自词库本身 */
export function mustWord(id: string): Word {
  const w = BY_ID.get(id);
  if (!w) throw new Error(`词库里没有这个词：${id}`);
  return w;
}

export function wordsByTheme(theme: ThemeId): Word[] {
  return WORDS.filter((w) => w.theme === theme);
}

export const THEMES: { id: ThemeId; label: string; labelZh: string; emoji: string }[] = [
  { id: 'self', label: 'All About Me', labelZh: '我自己', emoji: '🙋' },
  { id: 'family', label: 'My Family', labelZh: '家人', emoji: '👨‍👩‍👧' },
  { id: 'food', label: 'Yummy Food', labelZh: '食物', emoji: '🍎' },
  { id: 'animal', label: 'Animals', labelZh: '动物', emoji: '🐱' },
  { id: 'color', label: 'Colors', labelZh: '颜色', emoji: '🎨' },
  { id: 'number', label: 'Numbers', labelZh: '数字', emoji: '🔢' },
  { id: 'action', label: 'I Can Do It', labelZh: '日常动作', emoji: '🏃' },
  { id: 'toy', label: 'My Toys', labelZh: '玩具', emoji: '🧸' },
  { id: 'nature', label: 'Outside', labelZh: '大自然', emoji: '🌳' },
];

export function themeLabel(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.labelZh ?? id;
}

// ———————————————— 英语语法拼装 ————————————————
//
// 界面上不少句子是拼出来的（"Where is the ___?"、"Tom sees a ___."）。
// 一个教英语的产品拼出 "Where is the shoes?" 或者 "sees a milk" 是不能接受的——
// 孩子会当成范句记住。所以拼句子一律走下面这几个函数，不要在视图里手写模板。

/** a / an / 无冠词。复数和不可数都不加 */
export function withArticle(w: Word): string {
  if (w.plural || w.mass) return w.en;
  return `${/^[aeiou]/i.test(w.en) ? 'an' : 'a'} ${w.en}`;
}

/** 主谓一致：复数用 are，其余用 is */
export function beVerb(w: Word): string {
  return w.plural ? 'are' : 'is';
}

/**
 * 「听声音点图」的问法。
 *
 * 名词才问 where；颜色、数字这类形容词问 which one；动词问不了位置，
 * 用 "Show me: run." 这种祈使句——老师在课堂上本来也是这么说的。
 */
export function pointPrompt(w: Word): string {
  if (w.pos === 'verb') return `Show me: ${w.en}.`;
  if (w.pos === 'adj' || w.pos === 'num') return `Which one ${beVerb(w)} ${w.en}?`;
  return `Where ${beVerb(w)} the ${w.en}?`;
}

/** 游戏里的「找出来」。§15 的例子就是 Find the cat. */
export function findPrompt(w: Word): string {
  if (w.pos === 'verb') return `Find: ${w.en}.`;
  if (w.pos === 'adj' || w.pos === 'num') return `Find ${w.en}.`;
  return `Find the ${w.en}.`;
}

/**
 * 给一个词挑干扰项。
 *
 * 优先同一 group（apple/banana/orange），不够再放宽到同主题，最后才全库兜底。
 * 这个顺序很重要：干扰项太容易，选择题就变成了看图找唯一认识的那个。
 */
export function distractors(word: Word, n: number, rnd: () => number): Word[] {
  const pick = (pool: Word[], out: Word[]) => {
    const rest = pool.filter((w) => w.id !== word.id && !out.some((o) => o.id === w.id));
    while (out.length < n && rest.length) {
      const i = Math.floor(rnd() * rest.length) % rest.length;
      out.push(rest.splice(i, 1)[0]);
    }
  };
  const out: Word[] = [];
  pick(WORDS.filter((w) => w.group === word.group), out);
  if (out.length < n) pick(WORDS.filter((w) => w.theme === word.theme), out);
  if (out.length < n) pick(WORDS, out);
  return out;
}
