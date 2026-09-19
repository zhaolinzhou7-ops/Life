/**
 * 故事库
 *
 * 这是整个产品最重要的输入渠道。看图 + 听故事是启蒙阶段唯一能大量提供
 * 「可理解输入」的形式——比单词卡有情节，比对话有掌控感。
 *
 * 每个故事的硬约束（写的时候逐条对照，不是写完再说）：
 *  · 新词不超过 3 个，且这 3 个必须在故事里出现 3 次以上
 *  · 句子长度按 level 卡死：L1 ≤ 4 词，L2 ≤ 6 词，L3 ≤ 9 词，L4 ≤ 12 词
 *  · 有明确情节：出现 → 发生变化 → 解决。没有情节的「单词串烧」不算故事
 *  · 每页一张图，图要能单独看懂，因为孩子会先看图再听句子
 *  · 结尾必有互动问题，且问题答案就在故事里，不需要额外知识
 *
 * 为什么内置而不是全靠 AI 生成：没有 API Key 时产品必须照样能用（§27），
 * 而且内置故事的质量可控。AI 的价值在于**在这些之上**按孩子的薄弱点现编，
 * 见 ai/mock.ts 和 ai/remote.ts 的 story 能力。
 */

import type { Story } from '../types';

export const STORIES: Story[] = [
  // ———————————————— Level 1 ————————————————
  {
    id: 'st-red-ball',
    title: 'Tom and the Red Ball',
    level: 1,
    theme: 'toy',
    coverEmoji: '⚽',
    words: ['w-ball', 'w-red', 'w-play'],
    learningOutcome: '能听懂并说出 ball / red，理解 "play with" 的用法。',
    pages: [
      { text: 'This is Tom.', emoji: '👦' },
      { text: 'Tom has a ball.', emoji: '⚽', highlight: 'ball' },
      { text: 'The ball is red.', emoji: '🔴', highlight: 'red' },
      { text: 'Tom plays with the ball.', emoji: '🤾', highlight: 'play' },
      { text: 'Tom plays and plays.', emoji: '🏃', highlight: 'play' },
      { text: 'The red ball goes up!', emoji: '🙌', highlight: 'red' },
      { text: 'Dad gets the red ball.', emoji: '👨', highlight: 'red' },
      { text: 'Now Tom can play again!', emoji: '😄', highlight: 'play' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What color is the ball?',
        askZh: '球是什么颜色？',
        wordId: 'w-red',
        options: [
          { label: 'red', emoji: '🔴', correct: true },
          { label: 'blue', emoji: '🔵', correct: false },
          { label: 'green', emoji: '🟢', correct: false },
        ],
      },
      {
        kind: 'choice',
        ask: 'Who gets the ball?',
        askZh: '谁把球拿下来的？',
        wordId: 'w-dad',
        options: [
          { label: 'dad', emoji: '👨', correct: true },
          { label: 'mom', emoji: '👩', correct: false },
          { label: 'cat', emoji: '🐱', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Say: a red ball.', askZh: '说一说：a red ball', expect: ['red ball', 'a red ball', 'red'], wordId: 'w-ball' },
    ],
  },
  {
    id: 'st-hungry-cat',
    title: 'The Hungry Cat',
    level: 1,
    theme: 'animal',
    coverEmoji: '🐱',
    words: ['w-cat', 'w-hungry', 'w-eat'],
    learningOutcome: '能听懂 hungry / eat，能回答 "What does the cat eat?"。',
    pages: [
      { text: 'This is a cat.', emoji: '🐱', highlight: 'cat' },
      { text: 'The cat is hungry.', emoji: '🥺', highlight: 'hungry' },
      { text: 'Hungry, hungry cat!', emoji: '😿', highlight: 'hungry' },
      { text: 'The cat drinks milk.', emoji: '🥛' },
      { text: 'The cat eats bread.', emoji: '🍞', highlight: 'eat' },
      { text: 'The cat eats fish.', emoji: '🐟', highlight: 'eat' },
      { text: 'Eat, eat, eat!', emoji: '😋', highlight: 'eat' },
      { text: 'Now the cat is happy.', emoji: '😌' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What does the cat drink?',
        askZh: '猫喝了什么？',
        wordId: 'w-milk',
        options: [
          { label: 'milk', emoji: '🥛', correct: true },
          { label: 'water', emoji: '💧', correct: false },
          { label: 'juice', emoji: '🧃', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Say: the cat is hungry.', askZh: '说一说：the cat is hungry', expect: ['cat is hungry', 'hungry', 'the cat is hungry'], wordId: 'w-hungry' },
    ],
  },
  {
    id: 'st-three-birds',
    title: 'Three Little Birds',
    level: 1,
    theme: 'number',
    coverEmoji: '🐦',
    words: ['w-three', 'w-bird', 'w-tree'],
    learningOutcome: '能数到三，能听懂 one / two / three 与 bird。',
    pages: [
      { text: 'One bird.', emoji: '🐦', highlight: 'one' },
      { text: 'Two birds.', emoji: '🐦🐦', highlight: 'two' },
      { text: 'Three birds!', emoji: '🐦🐦🐦', highlight: 'three' },
      { text: 'A big tree.', emoji: '🌳', highlight: 'tree' },
      { text: 'Three birds in the tree.', emoji: '🌳', highlight: 'three' },
      { text: 'Three birds sing!', emoji: '🎶', highlight: 'three' },
      { text: 'One bird flies away.', emoji: '🕊️' },
      { text: 'Two birds in the tree.', emoji: '🐦🐦', highlight: 'tree' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'How many birds are in the tree at first?',
        askZh: '一开始树上有几只鸟？',
        wordId: 'w-three',
        options: [
          { label: 'three', emoji: '3️⃣', correct: true },
          { label: 'two', emoji: '2️⃣', correct: false },
          { label: 'five', emoji: '5️⃣', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Count with me: one, two, three.', askZh: '一起数：one, two, three', expect: ['one two three', 'one, two, three', 'three'], wordId: 'w-three' },
    ],
  },

  // ———————————————— Level 2 ————————————————
  {
    id: 'st-breakfast',
    title: "Mia's Breakfast",
    level: 2,
    theme: 'food',
    coverEmoji: '🍞',
    words: ['w-bread', 'w-egg', 'w-milk'],
    learningOutcome: '能说出三种早餐食物，能用 "I eat / I drink" 造句。',
    pages: [
      { text: 'Mia wakes up in the morning.', emoji: '🌅' },
      { text: 'She is hungry.', emoji: '😖' },
      { text: 'Mom makes bread and eggs.', emoji: '🍞🥚', highlight: 'bread' },
      { text: '"I like bread," says Mia.', emoji: '😋', highlight: 'bread' },
      { text: 'Mia eats the bread.', emoji: '🍞', highlight: 'bread' },
      { text: 'She eats one egg.', emoji: '🥚', highlight: 'egg' },
      { text: 'The egg is very good.', emoji: '😊', highlight: 'egg' },
      { text: 'Mia drinks her milk.', emoji: '🥛', highlight: 'milk' },
      { text: 'Milk is good. More milk!', emoji: '🥛', highlight: 'milk' },
      { text: 'Now Mia is not hungry.', emoji: '🎒' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What does Mia drink?',
        askZh: 'Mia 喝了什么？',
        wordId: 'w-milk',
        options: [
          { label: 'milk', emoji: '🥛', correct: true },
          { label: 'juice', emoji: '🧃', correct: false },
          { label: 'water', emoji: '💧', correct: false },
        ],
      },
      {
        kind: 'choice',
        ask: 'How many eggs does Mia eat?',
        askZh: 'Mia 吃了几个鸡蛋？',
        wordId: 'w-one',
        options: [
          { label: 'one', emoji: '1️⃣', correct: true },
          { label: 'two', emoji: '2️⃣', correct: false },
          { label: 'three', emoji: '3️⃣', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Tell me one thing Mia eats.', askZh: '说一个 Mia 吃的东西', expect: ['bread', 'egg', 'an egg', 'eggs'], wordId: 'w-bread' },
    ],
  },
  {
    id: 'st-lost-dog',
    title: 'Where Is My Dog?',
    level: 2,
    theme: 'animal',
    coverEmoji: '🐶',
    words: ['w-dog', 'w-black', 'w-home'],
    learningOutcome: '能听懂表示位置的句子，能回答 "What color is the dog?"。',
    pages: [
      { text: 'Ben has a little dog.', emoji: '🐶', highlight: 'dog' },
      { text: 'The dog is black.', emoji: '🐕', highlight: 'black' },
      { text: 'A black nose, black ears.', emoji: '👃', highlight: 'black' },
      { text: 'Today Ben cannot find him.', emoji: '😟' },
      { text: '"Is it under the bed?" No.', emoji: '🛏️' },
      { text: '"Is it in the box?" No.', emoji: '📦' },
      { text: 'Ben hears a small sound.', emoji: '👂' },
      { text: 'The black dog is on his hat!', emoji: '🧢', highlight: 'black' },
      { text: 'Ben takes the dog home.', emoji: '🏠', highlight: 'home' },
      { text: 'Home! They are home now.', emoji: '😄', highlight: 'home' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What color is the dog?',
        askZh: '狗是什么颜色？',
        wordId: 'w-black',
        options: [
          { label: 'black', emoji: '⚫', correct: true },
          { label: 'red', emoji: '🔴', correct: false },
          { label: 'yellow', emoji: '🟡', correct: false },
        ],
      },
      {
        kind: 'choice',
        ask: 'Where is the dog?',
        askZh: '狗在哪里？',
        wordId: 'w-hat',
        options: [
          { label: 'on the hat', emoji: '🧢', correct: true },
          { label: 'under the bed', emoji: '🛏️', correct: false },
          { label: 'in the box', emoji: '📦', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Tell me one thing about the dog.', askZh: '说一句关于这只狗的话', expect: ['black', 'white', 'little', 'small', 'dog', 'sleeping'], wordId: 'w-dog' },
    ],
  },
  {
    id: 'st-rainy-day',
    title: 'A Rainy Day',
    level: 2,
    theme: 'nature',
    coverEmoji: '🌧️',
    words: ['w-rain', 'w-play', 'w-sad'],
    learningOutcome: '能听懂表达心情的句子，理解 rain 与 play 的因果关系。',
    pages: [
      { text: 'Lily wants to play outside.', emoji: '🙋', highlight: 'play' },
      { text: 'But look! Rain, rain, rain.', emoji: '🌧️', highlight: 'rain' },
      { text: 'Lily is sad.', emoji: '😢', highlight: 'sad' },
      { text: '"I am sad," says Lily.', emoji: '😞', highlight: 'sad' },
      { text: 'Sad, sad Lily.', emoji: '😔', highlight: 'sad' },
      { text: '"We can play inside," says Dad.', emoji: '👨', highlight: 'play' },
      { text: 'They play with a red ball.', emoji: '⚽', highlight: 'play' },
      { text: 'Then the rain stops.', emoji: '🌤️', highlight: 'rain' },
      { text: 'Lily plays outside again.', emoji: '🏃', highlight: 'play' },
      { text: 'Now Lily is happy!', emoji: '😄' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'Why is Lily sad?',
        askZh: 'Lily 为什么难过？',
        wordId: 'w-rain',
        options: [
          { label: 'it is raining', emoji: '🌧️', correct: true },
          { label: 'she is hungry', emoji: '🍽️', correct: false },
          { label: 'she is tired', emoji: '🥱', correct: false },
        ],
      },
      { kind: 'speak', ask: 'How does Lily feel at the end?', askZh: '最后 Lily 心情怎么样？', expect: ['happy', 'she is happy', 'good'], wordId: 'w-happy' },
    ],
  },

  // ———————————————— Level 3 ————————————————
  {
    id: 'st-zoo-day',
    title: 'A Day at the Zoo',
    level: 3,
    theme: 'animal',
    coverEmoji: '🐘',
    words: ['w-elephant', 'w-monkey', 'w-tiger'],
    learningOutcome: '能识别并说出三种动物，能用 big / small 描述动物。',
    pages: [
      { text: 'Today Sam goes to the zoo with his sister.', emoji: '🚌' },
      { text: 'First they see a very big elephant.', emoji: '🐘', highlight: 'elephant' },
      { text: 'The elephant is grey and has a long nose.', emoji: '👃' },
      { text: 'Next they see a monkey in a tree.', emoji: '🐵', highlight: 'monkey' },
      { text: 'The monkey is eating a yellow banana.', emoji: '🍌' },
      { text: 'Then they see a tiger behind the glass.', emoji: '🐯', highlight: 'tiger' },
      { text: 'The tiger is orange and black, and it is sleeping.', emoji: '😴' },
      { text: '"The elephant is my favorite," says Sam.', emoji: '🙋' },
      { text: '"I like the monkey," says his sister.', emoji: '👧' },
      { text: 'At home they draw the tiger.', emoji: '🎨', highlight: 'tiger' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What is the monkey eating?',
        askZh: '猴子在吃什么？',
        wordId: 'w-banana',
        options: [
          { label: 'a banana', emoji: '🍌', correct: true },
          { label: 'an apple', emoji: '🍎', correct: false },
          { label: 'some rice', emoji: '🍚', correct: false },
        ],
      },
      {
        kind: 'choice',
        ask: 'What color is the tiger?',
        askZh: '老虎是什么颜色？',
        wordId: 'w-orange-color',
        options: [
          { label: 'orange and black', emoji: '🐯', correct: true },
          { label: 'grey', emoji: '🐘', correct: false },
          { label: 'green', emoji: '🟢', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Which animal do you like? Say: I like the ___.', askZh: '你喜欢哪个动物？说：I like the ___', expect: ['elephant', 'monkey', 'tiger', 'i like'], wordId: 'w-elephant' },
    ],
  },
  {
    id: 'st-new-shoes',
    title: 'My New Shoes',
    level: 3,
    theme: 'self',
    coverEmoji: '👟',
    words: ['w-shoes', 'w-run', 'w-blue'],
    learningOutcome: '能描述自己的衣物颜色，能用 "I can run" 表达能力。',
    pages: [
      { text: 'Anna gets new shoes for her birthday.', emoji: '👟', highlight: 'shoes' },
      { text: 'The shoes are blue with white stars.', emoji: '🔵', highlight: 'blue' },
      { text: 'Blue shoes for her left foot.', emoji: '🦶', highlight: 'blue' },
      { text: 'Blue shoes for her right foot.', emoji: '🦶', highlight: 'blue' },
      { text: '"Now I can run very fast!" she says.', emoji: '🏃', highlight: 'run' },
      { text: 'She runs in the park with her dog.', emoji: '🐶' },
      { text: 'The dog runs fast, but Anna runs faster.', emoji: '💨' },
      { text: 'At night her shoes are a little dirty.', emoji: '🧼' },
      { text: 'Mom washes them, and they are blue again.', emoji: '✨' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What color are the new shoes?',
        askZh: '新鞋是什么颜色？',
        wordId: 'w-blue',
        options: [
          { label: 'blue', emoji: '🔵', correct: true },
          { label: 'red', emoji: '🔴', correct: false },
          { label: 'black', emoji: '⚫', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Say: I can run fast.', askZh: '说一说：I can run fast', expect: ['i can run', 'run fast', 'i can run fast'], wordId: 'w-run' },
    ],
  },

  // ———————————————— Level 4 ————————————————
  {
    id: 'st-helping-grandma',
    title: 'Helping Grandma',
    level: 4,
    theme: 'family',
    coverEmoji: '👵',
    words: ['w-grandma', 'w-flower', 'w-wash'],
    learningOutcome: '能读懂 4~5 句的短段落，能回答 why 类问题。',
    pages: [
      { text: 'On Saturday morning, Leo goes to his grandma\'s home.', emoji: '🏠' },
      { text: 'Grandma is old, so some work is hard for her.', emoji: '👵', highlight: 'grandma' },
      { text: 'Leo washes the cups and puts them on the table.', emoji: '🧼', highlight: 'wash' },
      { text: 'Then he gives water to the flowers by the window.', emoji: '🌸', highlight: 'flower' },
      { text: 'The pink flowers are small, but they smell very good.', emoji: '👃' },
      { text: '"You are a big helper now," Grandma says with a smile.', emoji: '😊' },
      { text: 'Leo washes his hands before the cake.', emoji: '🍰', highlight: 'wash' },
      { text: 'They eat cake and then wash the plates.', emoji: '🍵', highlight: 'wash' },
      { text: 'Before Leo goes home, he waters the flowers one more time.', emoji: '💧' },
      { text: '"See you next Saturday, Grandma!" he says.', emoji: '👋' },
    ],
    questions: [
      {
        kind: 'choice',
        ask: 'What does Leo do first?',
        askZh: 'Leo 先做了什么？',
        wordId: 'w-wash',
        options: [
          { label: 'washes the cups', emoji: '🧼', correct: true },
          { label: 'eats the cake', emoji: '🍰', correct: false },
          { label: 'reads a book', emoji: '📕', correct: false },
        ],
      },
      {
        kind: 'choice',
        ask: 'Why does Leo help Grandma?',
        askZh: 'Leo 为什么帮奶奶？',
        wordId: 'w-grandma',
        options: [
          { label: 'some work is hard for her', emoji: '👵', correct: true },
          { label: 'he wants a new toy', emoji: '🧸', correct: false },
          { label: 'he is hungry', emoji: '🍽️', correct: false },
        ],
      },
      { kind: 'speak', ask: 'Tell me one thing Leo does for Grandma.', askZh: '说一件 Leo 为奶奶做的事', expect: ['wash', 'washes', 'cups', 'water', 'flower', 'flowers'], wordId: 'w-wash' },
    ],
  },
];

const BY_ID = new Map(STORIES.map((s) => [s.id, s]));

export function getStory(id: string): Story | undefined {
  return BY_ID.get(id);
}

export function storiesByLevel(level: 1 | 2 | 3 | 4): Story[] {
  return STORIES.filter((s) => s.level === level);
}
