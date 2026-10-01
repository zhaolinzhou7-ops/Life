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
  /** 指不出位置的名词（morning/birthday/winter） */
  abstract?: boolean;
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
    abstract: s.abstract,
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
  { en: 'face', zh: '脸', emoji: '😀', tier: 1, syl: 1, group: 'body', s: ['My face.', 'I wash my face.', 'I wash my face with cold water.'] },
  { en: 'arm', zh: '胳膊', emoji: '💪', tier: 1, syl: 1, group: 'body', s: ['My arm.', 'This is my arm.', 'I lift the box with my arm.'] },
  { en: 'leg', zh: '腿', emoji: '🦵', tier: 1, syl: 1, group: 'body', s: ['My leg.', 'I stand on one leg.', 'I hurt my leg, so I sit down.'] },
  { en: 'finger', zh: '手指', emoji: '☝️', tier: 2, syl: 2, group: 'body', s: ['My finger.', 'I have ten fingers.', 'I count to ten on my fingers.'] },
  { en: 'tooth', zh: '牙齿', emoji: '🦷', tier: 2, syl: 1, group: 'body', s: ['My tooth.', 'This is my tooth.', 'My front tooth is loose today.'] },
  { en: 'dress', zh: '连衣裙', emoji: '👗', tier: 1, syl: 1, group: 'clothes', s: ['A dress.', 'This is a dress.', 'She wears a pink dress to the party.'] },
  { en: 'socks', zh: '袜子', emoji: '🧦', tier: 1, syl: 1, plural: true, group: 'clothes', s: ['My socks.', 'These are my socks.', 'I put on my socks before my shoes.'] },
  { en: 'coat', zh: '外套', emoji: '🧥', tier: 2, syl: 1, group: 'clothes', s: ['A coat.', 'This is my coat.', 'I wear my warm coat in winter.'] },
  { en: 'pants', zh: '裤子', emoji: '👖', tier: 2, syl: 1, plural: true, group: 'clothes', s: ['My pants.', 'These are my pants.', 'My blue pants are too long.'] },
  { en: 'gloves', zh: '手套', emoji: '🧤', tier: 2, syl: 1, plural: true, group: 'clothes', s: ['My gloves.', 'I wear my gloves.', 'I wear my gloves when it is cold.'] },
  { en: 'scarf', zh: '围巾', emoji: '🧣', tier: 3, syl: 1, group: 'clothes', s: ['A scarf.', 'This is my scarf.', 'Grandma made this red scarf for me.'] },
  { en: 'glasses', zh: '眼镜', emoji: '👓', tier: 3, syl: 2, plural: true, group: 'clothes', s: ['Glasses.', 'Dad wears glasses.', 'Dad wears glasses when he reads a book.'] },
  { en: 'angry', zh: '生气', emoji: '😠', tier: 2, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am angry.', 'He is angry now.', 'He is angry because his toy is broken.'] },
  { en: 'scared', zh: '害怕', emoji: '😨', tier: 2, syl: 1, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am scared.', 'The cat is scared.', 'The little cat is scared of the big dog.'] },
  { en: 'sleepy', zh: '困', emoji: '😪', tier: 2, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am sleepy.', 'The baby is sleepy.', 'I am sleepy, so I go to bed early.'] },
  { en: 'sick', zh: '生病', emoji: '🤒', tier: 2, syl: 1, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am sick.', 'She is sick today.', 'She is sick, so she stays in bed.'] },
  { en: 'excited', zh: '兴奋', emoji: '🤩', tier: 3, syl: 3, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am excited!', 'We are so excited!', 'I am excited because it is my birthday.'] },
  { en: 'surprised', zh: '惊讶', emoji: '😮', tier: 3, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am surprised!', 'Wow, I am surprised!', 'Mom is surprised when she sees the cake.'] },
  { en: 'heart', zh: '心', emoji: '❤️', tier: 2, syl: 1, group: 'body', s: ['My heart.', 'My heart beats fast.', 'My heart beats fast when I run.'] },
  { en: 'brain', zh: '大脑', emoji: '🧠', tier: 3, syl: 1, group: 'body', s: ['My brain.', 'I think with my brain.', 'My brain helps me learn new words.'] },
  { en: 'bone', zh: '骨头', emoji: '🦴', tier: 3, syl: 1, group: 'body', s: ['A bone.', 'The dog has a bone.', 'The dog hides his bone in the garden.'] },
  { en: 'worried', zh: '担心', emoji: '😟', tier: 3, syl: 2, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am worried.', 'Mom is worried now.', 'Mom is worried because I am late.'] },
  { en: 'calm', zh: '平静', emoji: '😌', tier: 3, syl: 1, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am calm.', 'I feel calm now.', 'I feel calm after a long deep breath.'] },
  { en: 'proud', zh: '自豪', emoji: '🏅', tier: 3, syl: 1, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am proud.', 'Mom is proud of me.', 'I am proud because I finished my picture.'] },
  { en: 'bored', zh: '无聊', emoji: '😒', tier: 3, syl: 1, pos: 'adj', group: 'feeling', ask: 'How do I feel?', s: ['I am bored.', 'The boy is bored.', 'He is bored because it is raining.'] },
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
  { en: 'friend', zh: '朋友', emoji: '🤝', tier: 1, syl: 1, group: 'family', ask: 'Who is this?', s: ['My friend.', 'This is my friend.', 'My friend and I play in the park.'] },
  { en: 'family', zh: '家人', emoji: '👪', tier: 2, syl: 3, group: 'family', ask: 'Who is this?', s: ['My family.', 'I love my family.', 'My family eats dinner together every night.'] },
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
  { en: 'pear', zh: '梨', emoji: '🍐', tier: 1, syl: 1, group: 'fruit', s: ['A pear.', 'This is a pear.', 'The green pear is sweet and soft.'] },
  { en: 'strawberry', zh: '草莓', emoji: '🍓', tier: 2, syl: 3, group: 'fruit', s: ['A strawberry.', 'This is a strawberry.', 'The strawberry is small, red and sweet.'] },
  { en: 'watermelon', zh: '西瓜', emoji: '🍉', tier: 2, syl: 4, group: 'fruit', s: ['A watermelon.', 'This is a watermelon.', 'We eat watermelon on a hot day.'] },
  { en: 'peach', zh: '桃子', emoji: '🍑', tier: 2, syl: 1, group: 'fruit', s: ['A peach.', 'This is a peach.', 'Grandma gives me a big peach.'] },
  { en: 'lemon', zh: '柠檬', emoji: '🍋', tier: 2, syl: 2, group: 'fruit', s: ['A lemon.', 'This is a lemon.', 'The yellow lemon is very sour.'] },
  { en: 'cherry', zh: '樱桃', emoji: '🍒', tier: 2, syl: 2, group: 'fruit', s: ['A cherry.', 'This is a cherry.', 'I eat a red cherry from the tree.'] },
  { en: 'mango', zh: '芒果', emoji: '🥭', tier: 2, syl: 2, group: 'fruit', s: ['A mango.', 'This is a mango.', 'The mango is yellow and very sweet.'] },
  { en: 'pineapple', zh: '菠萝', emoji: '🍍', tier: 2, syl: 3, group: 'fruit', s: ['A pineapple.', 'This is a pineapple.', 'The pineapple is yellow inside.'] },
  { en: 'coconut', zh: '椰子', emoji: '🥥', tier: 3, syl: 3, group: 'fruit', s: ['A coconut.', 'This is a coconut.', 'The coconut is hard on the outside.'] },
  { en: 'carrot', zh: '胡萝卜', emoji: '🥕', tier: 1, syl: 2, group: 'vegetable', s: ['A carrot.', 'This is a carrot.', 'The rabbit eats an orange carrot.'] },
  { en: 'tomato', zh: '番茄', emoji: '🍅', tier: 2, syl: 3, group: 'vegetable', s: ['A tomato.', 'This is a tomato.', 'Mom puts a tomato in the soup.'] },
  { en: 'potato', zh: '土豆', emoji: '🥔', tier: 2, syl: 3, group: 'vegetable', s: ['A potato.', 'This is a potato.', 'Dad cooks potatoes for dinner tonight.'] },
  { en: 'corn', zh: '玉米', emoji: '🌽', tier: 2, syl: 1, mass: true, group: 'vegetable', s: ['Corn.', 'This is corn.', 'The corn is yellow and sweet.'] },
  { en: 'vegetables', zh: '蔬菜', emoji: '🥦', tier: 3, syl: 4, plural: true, group: 'vegetable', s: ['Vegetables.', 'I eat my vegetables.', 'Vegetables help me grow big and strong.'] },
  { en: 'cookie', zh: '饼干', emoji: '🍪', tier: 1, syl: 2, group: 'meal', s: ['A cookie.', 'This is a cookie.', 'I share my cookie with my sister.'] },
  { en: 'ice cream', zh: '冰淇淋', emoji: '🍦', tier: 1, syl: 2, mass: true, group: 'meal', s: ['Ice cream.', 'I like ice cream.', 'We eat ice cream on a hot day.'] },
  { en: 'pizza', zh: '披萨', emoji: '🍕', tier: 1, syl: 2, mass: true, group: 'meal', s: ['Pizza.', 'I like pizza.', 'We eat pizza on Friday night.'] },
  { en: 'noodles', zh: '面条', emoji: '🍜', tier: 2, syl: 2, plural: true, group: 'meal', s: ['Noodles.', 'I like noodles.', 'Grandpa makes hot noodles for lunch.'] },
  { en: 'soup', zh: '汤', emoji: '🍲', tier: 2, syl: 1, mass: true, group: 'meal', s: ['Soup.', 'This is soup.', 'The soup is too hot to eat now.'] },
  { en: 'sandwich', zh: '三明治', emoji: '🥪', tier: 2, syl: 2, group: 'meal', s: ['A sandwich.', 'This is a sandwich.', 'Mom makes a sandwich for my lunch.'] },
  { en: 'cheese', zh: '奶酪', emoji: '🧀', tier: 2, syl: 1, mass: true, group: 'meal', s: ['Cheese.', 'This is cheese.', 'The little mouse likes to eat cheese.'] },
  { en: 'honey', zh: '蜂蜜', emoji: '🍯', tier: 2, syl: 2, mass: true, group: 'meal', s: ['Honey.', 'Bees make honey.', 'The bear likes to eat sweet honey.'] },
  { en: 'popcorn', zh: '爆米花', emoji: '🍿', tier: 2, syl: 2, mass: true, group: 'meal', s: ['Popcorn.', 'I like popcorn.', 'We eat popcorn and watch a movie.'] },
  { en: 'salad', zh: '沙拉', emoji: '🥗', tier: 3, syl: 2, mass: true, group: 'meal', s: ['Salad.', 'I eat salad.', 'I eat a green salad with lunch.'] },
  { en: 'tea', zh: '茶', emoji: '🍵', tier: 2, syl: 1, mass: true, group: 'drink', s: ['Tea.', 'Grandma drinks tea.', 'Grandma drinks hot tea in the morning.'] },
  { en: 'breakfast', zh: '早饭', emoji: '🥞', tier: 3, syl: 2, mass: true, abstract: true, group: 'mealtime', ask: 'What meal is it?', s: ['Breakfast.', 'I eat breakfast.', 'I eat breakfast at seven every morning.'] },
  { en: 'lunch', zh: '午饭', emoji: '🍱', tier: 3, syl: 1, mass: true, abstract: true, group: 'mealtime', ask: 'What meal is it?', s: ['Lunch.', 'It is lunch time.', 'We eat lunch at school at twelve.'] },
  { en: 'dinner', zh: '晚饭', emoji: '🍛', tier: 3, syl: 2, mass: true, abstract: true, group: 'mealtime', ask: 'What meal is it?', s: ['Dinner.', 'Dinner is ready!', 'My family eats dinner at six every night.'] },
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
  { en: 'mouse', zh: '老鼠', emoji: '🐭', tier: 1, syl: 1, group: 'pet', s: ['A mouse.', 'This is a mouse.', 'The little mouse eats some cheese.'] },
  { en: 'hamster', zh: '仓鼠', emoji: '🐹', tier: 3, syl: 2, group: 'pet', s: ['A hamster.', 'This is my hamster.', 'My hamster sleeps in the day.'] },
  { en: 'horse', zh: '马', emoji: '🐴', tier: 1, syl: 1, group: 'farm', s: ['A horse.', 'This is a horse.', 'The brown horse runs on the farm.'] },
  { en: 'chicken', zh: '鸡', emoji: '🐔', tier: 1, syl: 2, group: 'farm', s: ['A chicken.', 'This is a chicken.', 'The chicken lays an egg every day.'] },
  { en: 'sheep', zh: '羊', emoji: '🐑', tier: 2, syl: 1, group: 'farm', s: ['A sheep.', 'This is a sheep.', 'The white sheep eats green grass.'] },
  { en: 'goat', zh: '山羊', emoji: '🐐', tier: 2, syl: 1, group: 'farm', s: ['A goat.', 'This is a goat.', 'The goat likes to climb on rocks.'] },
  { en: 'lion', zh: '狮子', emoji: '🦁', tier: 1, syl: 2, group: 'wild', s: ['A lion.', 'This is a lion.', 'The big lion can roar very loud.'] },
  { en: 'panda', zh: '熊猫', emoji: '🐼', tier: 1, syl: 2, group: 'wild', s: ['A panda.', 'This is a panda.', 'The panda eats green bamboo all day.'] },
  { en: 'frog', zh: '青蛙', emoji: '🐸', tier: 1, syl: 1, group: 'wild', s: ['A frog.', 'This is a frog.', 'The green frog jumps into the water.'] },
  { en: 'giraffe', zh: '长颈鹿', emoji: '🦒', tier: 2, syl: 2, group: 'wild', s: ['A giraffe.', 'This is a giraffe.', 'The giraffe has a very long neck.'] },
  { en: 'zebra', zh: '斑马', emoji: '🦓', tier: 2, syl: 2, group: 'wild', s: ['A zebra.', 'This is a zebra.', 'The zebra is black and white.'] },
  { en: 'snake', zh: '蛇', emoji: '🐍', tier: 2, syl: 1, group: 'wild', s: ['A snake.', 'This is a snake.', 'The long snake moves on the grass.'] },
  { en: 'owl', zh: '猫头鹰', emoji: '🦉', tier: 2, syl: 1, group: 'wild', s: ['An owl.', 'This is an owl.', 'The owl stays awake at night.'] },
  { en: 'penguin', zh: '企鹅', emoji: '🐧', tier: 2, syl: 2, group: 'wild', s: ['A penguin.', 'This is a penguin.', 'The penguin swims in the cold sea.'] },
  { en: 'kangaroo', zh: '袋鼠', emoji: '🦘', tier: 3, syl: 3, group: 'wild', s: ['A kangaroo.', 'This is a kangaroo.', 'The kangaroo carries its baby in a pocket.'] },
  { en: 'parrot', zh: '鹦鹉', emoji: '🦜', tier: 2, syl: 2, group: 'wild', s: ['A parrot.', 'Coco is a parrot!', 'The green parrot can say hello to you.'] },
  { en: 'fox', zh: '狐狸', emoji: '🦊', tier: 2, syl: 1, group: 'wild', s: ['A fox.', 'This is a fox.', 'The red fox runs into the forest.'] },
  { en: 'wolf', zh: '狼', emoji: '🐺', tier: 3, syl: 1, group: 'wild', s: ['A wolf.', 'This is a wolf.', 'The grey wolf lives in the forest.'] },
  { en: 'deer', zh: '鹿', emoji: '🦌', tier: 3, syl: 1, group: 'wild', s: ['A deer.', 'This is a deer.', 'The little deer drinks from the river.'] },
  { en: 'camel', zh: '骆驼', emoji: '🐫', tier: 3, syl: 2, group: 'wild', s: ['A camel.', 'This is a camel.', 'The camel walks in the hot desert.'] },
  { en: 'squirrel', zh: '松鼠', emoji: '🐿️', tier: 3, syl: 2, group: 'wild', s: ['A squirrel.', 'This is a squirrel.', 'The squirrel eats nuts in the tree.'] },
  { en: 'whale', zh: '鲸鱼', emoji: '🐳', tier: 2, syl: 1, group: 'sea', s: ['A whale.', 'This is a whale.', 'The big whale swims in the sea.'] },
  { en: 'dolphin', zh: '海豚', emoji: '🐬', tier: 2, syl: 2, group: 'sea', s: ['A dolphin.', 'This is a dolphin.', 'The dolphin jumps out of the water.'] },
  { en: 'turtle', zh: '乌龟', emoji: '🐢', tier: 2, syl: 2, group: 'sea', s: ['A turtle.', 'This is a turtle.', 'The turtle walks very, very slowly.'] },
  { en: 'crab', zh: '螃蟹', emoji: '🦀', tier: 2, syl: 1, group: 'sea', s: ['A crab.', 'This is a crab.', 'The red crab walks on the beach.'] },
  { en: 'octopus', zh: '章鱼', emoji: '🐙', tier: 3, syl: 3, group: 'sea', s: ['An octopus.', 'This is an octopus.', 'The octopus has eight long arms.'] },
  { en: 'shark', zh: '鲨鱼', emoji: '🦈', tier: 3, syl: 1, group: 'sea', s: ['A shark.', 'This is a shark.', 'The shark has many sharp teeth.'] },
  { en: 'bee', zh: '蜜蜂', emoji: '🐝', tier: 1, syl: 1, group: 'bug', s: ['A bee.', 'This is a bee.', 'The bee flies from flower to flower.'] },
  { en: 'butterfly', zh: '蝴蝶', emoji: '🦋', tier: 2, syl: 3, group: 'bug', s: ['A butterfly.', 'This is a butterfly.', 'The butterfly has very pretty wings.'] },
  { en: 'ant', zh: '蚂蚁', emoji: '🐜', tier: 2, syl: 1, group: 'bug', s: ['An ant.', 'This is an ant.', 'The little ant carries some food.'] },
  { en: 'ladybug', zh: '瓢虫', emoji: '🐞', tier: 3, syl: 3, group: 'bug', s: ['A ladybug.', 'This is a ladybug.', 'The ladybug is red with black spots.'] },
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
  { en: 'pink', zh: '粉色', emoji: '💗', tier: 2, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Pink.', 'It is pink.', 'The little pig is pink.'] },
  { en: 'purple', zh: '紫色', emoji: '🟣', tier: 1, syl: 2, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Purple.', 'It is purple.', 'The grapes are purple and sweet.'] },
  { en: 'brown', zh: '棕色', emoji: '🟤', tier: 1, syl: 1, pos: 'adj', group: 'color', ask: 'What color is it?', s: ['Brown.', 'It is brown.', 'The bear is big and brown.'] },
]);

// ———————————————— 数字 ————————————————

const NUMBER = build('number', [
  { en: 'one', zh: '一', emoji: '1️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['One.', 'I see one cat.', 'I have one red apple.'] },
  { en: 'two', zh: '二', emoji: '2️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Two.', 'I see two dogs.', 'I have two blue hats.'] },
  { en: 'three', zh: '三', emoji: '3️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Three.', 'I see three birds.', 'Three birds sing in the tree.'] },
  { en: 'four', zh: '四', emoji: '4️⃣', tier: 2, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Four.', 'I see four ducks.', 'Four ducks swim in the water.'] },
  { en: 'five', zh: '五', emoji: '5️⃣', tier: 2, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Five.', 'I see five eggs.', 'I eat five grapes.'] },
  { en: 'six', zh: '六', emoji: '6️⃣', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Six.', 'I see six cats.', 'There are six eggs in the box.'] },
  { en: 'ten', zh: '十', emoji: '🔟', tier: 1, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Ten.', 'I have ten fingers.', 'I can count from one to ten.'] },
  { en: 'seven', zh: '七', emoji: '7️⃣', tier: 2, syl: 2, pos: 'num', group: 'number', ask: 'How many?', s: ['Seven.', 'I am seven.', 'There are seven days in a week.'] },
  { en: 'eight', zh: '八', emoji: '8️⃣', tier: 2, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Eight.', 'I see eight ducks.', 'The octopus has eight long arms.'] },
  { en: 'nine', zh: '九', emoji: '9️⃣', tier: 2, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Nine.', 'I have nine balls.', 'Nine birds sit in the tree.'] },
  { en: 'zero', zh: '零', emoji: '0️⃣', tier: 2, syl: 2, pos: 'num', group: 'number', ask: 'How many?', s: ['Zero.', 'I have zero cookies.', 'There are zero cookies left in the box.'] },
  { en: 'twelve', zh: '十二', emoji: '1️⃣2️⃣', tier: 3, syl: 1, pos: 'num', group: 'number', ask: 'How many?', s: ['Twelve.', 'I see twelve eggs.', 'There are twelve months in a year.'] },
  { en: 'twenty', zh: '二十', emoji: '2️⃣0️⃣', tier: 3, syl: 2, pos: 'num', group: 'number', ask: 'How many?', s: ['Twenty.', 'I can count to twenty.', 'There are twenty children in my class.'] },
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
  { en: 'sit', zh: '坐', emoji: '🧘', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Sit.', 'Sit down, please.', 'I sit on the chair and read.'] },
  { en: 'walk', zh: '走', emoji: '🚶', tier: 1, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Walk.', 'I walk to school.', 'I walk to the park with my dog.'] },
  { en: 'swim', zh: '游泳', emoji: '🏊', tier: 1, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Swim.', 'I can swim.', 'The fish swims fast in the water.'] },
  { en: 'dance', zh: '跳舞', emoji: '💃', tier: 1, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Dance.', 'I can dance.', 'We dance to the happy music.'] },
  { en: 'fly', zh: '飞', emoji: '🕊️', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Fly.', 'Birds can fly.', 'The little bird can fly very high.'] },
  { en: 'climb', zh: '爬', emoji: '🧗', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Climb.', 'I can climb.', 'The monkey can climb up the tree.'] },
  { en: 'stand', zh: '站', emoji: '🧍', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Stand up.', 'Please stand up.', 'Stand up and say hello to the class.'] },
  { en: 'throw', zh: '扔', emoji: '🤾', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Throw.', 'Throw the ball.', 'I throw the ball to my friend.'] },
  { en: 'stop', zh: '停', emoji: '🛑', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Stop!', 'Stop at the red light.', 'The car stops when the light is red.'] },
  { en: 'clap', zh: '拍手', emoji: '👏', tier: 1, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Clap.', 'Clap your hands.', 'We clap our hands when we are happy.'] },
  { en: 'wave', zh: '挥手', emoji: '👋', tier: 1, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Wave.', 'Wave your hand.', 'I wave goodbye to my friend.'] },
  { en: 'draw', zh: '画', emoji: '🎨', tier: 1, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Draw.', 'I draw a cat.', 'I draw a big sun with my crayon.'] },
  { en: 'open', zh: '打开', emoji: '🔓', tier: 2, syl: 2, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Open.', 'Open the door.', 'Please open the box for me.'] },
  { en: 'close', zh: '关上', emoji: '🔒', tier: 2, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Close.', 'Close the door.', 'Please close the door when you go out.'] },
  { en: 'write', zh: '写', emoji: '✍️', tier: 2, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Write.', 'I write my name.', 'I write a letter to my grandma.'] },
  { en: 'give', zh: '给', emoji: '🎁', tier: 2, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Give.', 'Give me the ball.', 'I give a gift to my friend.'] },
  { en: 'help', zh: '帮忙', emoji: '🤲', tier: 2, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Help.', 'Can you help me?', 'I help my mom clean the table.'] },
  { en: 'look', zh: '看', emoji: '👀', tier: 1, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Look!', 'Look at the bird.', 'Look at the big red kite in the sky.'] },
  { en: 'listen', zh: '听', emoji: '🎧', tier: 2, syl: 2, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Listen.', 'Listen to me.', 'Listen to the birds in the tree.'] },
  { en: 'cook', zh: '做饭', emoji: '🍳', tier: 2, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Cook.', 'Mom can cook.', 'Dad cooks eggs for breakfast.'] },
  { en: 'smile', zh: '微笑', emoji: '😊', tier: 2, syl: 1, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Smile.', 'Smile at me!', 'My sister smiles when she sees the puppy.'] },
  { en: 'laugh', zh: '大笑', emoji: '😂', tier: 2, syl: 1, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Laugh.', 'We laugh a lot.', 'We laugh at the funny little cat.'] },
  { en: 'cry', zh: '哭', emoji: '😭', tier: 2, syl: 1, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Cry.', 'The baby cries.', 'The baby cries when she is hungry.'] },
  { en: 'think', zh: '想', emoji: '🤔', tier: 3, syl: 1, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Think.', 'Let me think.', 'I think about the story before I sleep.'] },
  { en: 'ride', zh: '骑', emoji: '🚴', tier: 2, syl: 1, pos: 'verb', group: 'move', ask: 'What am I doing?', s: ['Ride.', 'I ride my bike.', 'I ride my bike to the park.'] },
  { en: 'build', zh: '搭', emoji: '🏗️', tier: 2, syl: 1, pos: 'verb', group: 'hand', ask: 'What am I doing?', s: ['Build.', 'I build a house.', 'We build a tall tower with blocks.'] },
  { en: 'grow', zh: '长大', emoji: '🌻', tier: 2, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Grow.', 'Plants grow.', 'The little plant grows every day.'] },
  { en: 'wait', zh: '等', emoji: '⏳', tier: 2, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Wait.', 'Please wait here.', 'We wait for the bus at the stop.'] },
  { en: 'hug', zh: '拥抱', emoji: '🤗', tier: 2, syl: 1, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Hug.', 'Give me a hug!', 'I hug my grandma when I see her.'] },
  { en: 'learn', zh: '学习', emoji: '👩‍🎓', tier: 3, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Learn.', 'I learn English.', 'I learn new words with Coco every day.'] },
  { en: 'finish', zh: '完成', emoji: '🏁', tier: 3, syl: 2, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Finish.', 'I finish my work.', 'I finish my homework before dinner.'] },
  { en: 'start', zh: '开始', emoji: '▶️', tier: 3, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Start!', 'Let us start!', 'We start the game at nine.'] },
  { en: 'win', zh: '赢', emoji: '🏆', tier: 3, syl: 1, pos: 'verb', group: 'action', ask: 'What am I doing?', s: ['Win.', 'We win the game!', 'Our team wins the big race today.'] },
  { en: 'remember', zh: '记得', emoji: '💭', tier: 3, syl: 3, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Remember.', 'I remember you!', 'I remember the story from yesterday.'] },
  { en: 'forget', zh: '忘记', emoji: '🤷', tier: 3, syl: 2, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Forget.', 'Do not forget!', 'Do not forget your hat, it is cold.'] },
  { en: 'shout', zh: '喊', emoji: '📣', tier: 3, syl: 1, pos: 'verb', group: 'express', ask: 'What am I doing?', s: ['Shout.', 'Do not shout.', 'Please do not shout in the library.'] },
]);

// ———————————————— 玩具与自然（第二阶段，故事里会用到） ————————————————

const TOY = build('toy', [
  { en: 'ball', zh: '球', emoji: '⚽', tier: 1, syl: 1, group: 'toy', s: ['A ball.', 'This is a ball.', 'Tom plays with a red ball.'] },
  { en: 'car', zh: '小汽车', emoji: '🚗', tier: 1, syl: 1, group: 'toy', s: ['A car.', 'This is a car.', 'My toy car is blue and fast.'] },
  { en: 'book', zh: '书', emoji: '📕', tier: 1, syl: 1, group: 'toy', s: ['A book.', 'This is a book.', 'I read a book about animals.'] },
  { en: 'teddy bear', zh: '玩具熊', emoji: '🧸', tier: 2, syl: 2, group: 'toy', s: ['A teddy bear.', 'This is my teddy bear.', 'My teddy bear sleeps with me.'] },
  { en: 'kite', zh: '风筝', emoji: '🪁', tier: 2, syl: 1, group: 'toy', s: ['A kite.', 'This is a kite.', 'The kite is high in the sky.'] },
  { en: 'robot', zh: '机器人', emoji: '🤖', tier: 1, syl: 2, group: 'toy', s: ['A robot.', 'This is a robot.', 'My toy robot can walk and talk.'] },
  { en: 'balloon', zh: '气球', emoji: '🎈', tier: 1, syl: 2, group: 'toy', s: ['A balloon.', 'This is a balloon.', 'The red balloon flies up into the sky.'] },
  { en: 'blocks', zh: '积木', emoji: '🧱', tier: 2, syl: 1, plural: true, group: 'toy', s: ['Blocks.', 'I play with blocks.', 'I build a tall tower with my blocks.'] },
  { en: 'drum', zh: '鼓', emoji: '🥁', tier: 2, syl: 1, group: 'toy', s: ['A drum.', 'This is a drum.', 'My brother plays the drum very loudly.'] },
  { en: 'game', zh: '游戏', emoji: '🎮', tier: 2, syl: 1, group: 'toy', s: ['A game.', 'We play a game.', 'We play a fun game after dinner.'] },
]);

const NATURE = build('nature', [
  { en: 'sun', zh: '太阳', emoji: '☀️', tier: 1, syl: 1, group: 'nature', s: ['The sun.', 'This is the sun.', 'The sun is big and hot.'] },
  { en: 'moon', zh: '月亮', emoji: '🌙', tier: 2, syl: 1, group: 'nature', s: ['The moon.', 'This is the moon.', 'The moon comes out at night.'] },
  { en: 'tree', zh: '树', emoji: '🌳', tier: 1, syl: 1, group: 'nature', s: ['A tree.', 'This is a tree.', 'A bird sits in the green tree.'] },
  { en: 'flower', zh: '花', emoji: '🌸', tier: 2, syl: 2, group: 'nature', s: ['A flower.', 'This is a flower.', 'The pink flower is very small.'] },
  { en: 'rain', mass: true, zh: '雨', emoji: '🌧️', tier: 2, syl: 1, group: 'nature', s: ['Rain.', 'It is rain.', 'I stay home when it rains.'] },
  { en: 'star', zh: '星星', emoji: '⭐', tier: 1, syl: 1, group: 'sky', s: ['A star.', 'I see a star.', 'Many stars shine in the night sky.'] },
  { en: 'cloud', zh: '云', emoji: '☁️', tier: 1, syl: 1, group: 'sky', s: ['A cloud.', 'I see a cloud.', 'The white cloud moves across the sky.'] },
  { en: 'rainbow', zh: '彩虹', emoji: '🌈', tier: 2, syl: 2, group: 'sky', s: ['A rainbow.', 'Look, a rainbow!', 'We see a rainbow after the rain.'] },
  { en: 'snow', zh: '雪', emoji: '❄️', tier: 1, syl: 1, mass: true, group: 'weather', s: ['Snow.', 'I see snow.', 'The snow is white and very cold.'] },
  { en: 'wind', zh: '风', emoji: '🌬️', tier: 2, syl: 1, mass: true, abstract: true, group: 'weather', s: ['Wind.', 'The wind is strong.', 'The wind blows my hat off my head.'] },
  { en: 'sea', zh: '大海', emoji: '🌊', tier: 1, syl: 1, group: 'land', s: ['The sea.', 'I see the sea.', 'We swim in the blue sea in summer.'] },
  { en: 'mountain', zh: '山', emoji: '⛰️', tier: 2, syl: 2, group: 'land', s: ['A mountain.', 'This is a mountain.', 'We climb the big mountain with Dad.'] },
  { en: 'river', zh: '河', emoji: '🏞️', tier: 3, syl: 2, group: 'land', s: ['A river.', 'This is a river.', 'The river goes all the way to the sea.'] },
  { en: 'grass', zh: '草', emoji: '🌱', tier: 2, syl: 1, mass: true, group: 'plant', s: ['Grass.', 'The grass is green.', 'The sheep eat the green grass.'] },
  { en: 'leaf', zh: '叶子', emoji: '🍃', tier: 2, syl: 1, group: 'plant', s: ['A leaf.', 'This is a leaf.', 'The leaf falls from the tall tree.'] },
  { en: 'forest', zh: '森林', emoji: '🌲', tier: 2, syl: 2, group: 'land', s: ['A forest.', 'This is a forest.', 'Many animals live in the big forest.'] },
  { en: 'island', zh: '岛', emoji: '🏝️', tier: 3, syl: 2, group: 'land', s: ['An island.', 'This is an island.', 'The little island is in the blue sea.'] },
  { en: 'desert', zh: '沙漠', emoji: '🏜️', tier: 3, syl: 2, group: 'land', s: ['A desert.', 'This is a desert.', 'It is very hot and dry in the desert.'] },
  { en: 'volcano', zh: '火山', emoji: '🌋', tier: 3, syl: 3, group: 'land', s: ['A volcano.', 'This is a volcano.', 'Hot rocks come out of the volcano.'] },
  { en: 'planet', zh: '行星', emoji: '🪐', tier: 3, syl: 2, group: 'sky', s: ['A planet.', 'This is a planet.', 'We live on the planet Earth.'] },
  { en: 'Earth', zh: '地球', emoji: '🌍', tier: 3, syl: 1, mass: true, group: 'sky', s: ['The Earth.', 'This is the Earth.', 'The Earth goes around the sun.'] },
  { en: 'space', zh: '太空', emoji: '🌌', tier: 3, syl: 1, mass: true, abstract: true, group: 'sky', s: ['Space.', 'Rockets go to space.', 'There are many stars in space.'] },
]);

// ———————————————— 家里的东西 ————————————————

const HOUSE = build('house', [
  { en: 'chair', zh: '椅子', emoji: '🪑', tier: 1, syl: 1, group: 'room', s: ['A chair.', 'This is a chair.', 'I sit on the chair and eat.'] },
  { en: 'box', zh: '盒子', emoji: '📦', tier: 1, syl: 1, group: 'room', s: ['A box.', 'This is a box.', 'My toys are in the big box.'] },
  { en: 'TV', zh: '电视', emoji: '📺', tier: 1, syl: 2, group: 'room', s: ['The TV.', 'I watch TV.', 'We watch TV after dinner.'] },
  { en: 'sofa', zh: '沙发', emoji: '🛋️', tier: 2, syl: 2, group: 'room', s: ['A sofa.', 'This is a sofa.', 'We sit on the sofa and read.'] },
  { en: 'lamp', zh: '台灯', emoji: '💡', tier: 2, syl: 1, group: 'room', s: ['A lamp.', 'Turn on the lamp.', 'I read a book under the lamp.'] },
  { en: 'bath', zh: '浴缸', emoji: '🛁', tier: 2, syl: 1, group: 'room', s: ['A bath.', 'I take a bath.', 'I take a warm bath every night.'] },
  { en: 'cup', zh: '杯子', emoji: '☕', tier: 1, syl: 1, group: 'kitchen', s: ['A cup.', 'This is a cup.', 'I drink milk from my cup.'] },
  { en: 'bowl', zh: '碗', emoji: '🥣', tier: 2, syl: 1, group: 'kitchen', s: ['A bowl.', 'This is a bowl.', 'I eat rice from a small bowl.'] },
  { en: 'spoon', zh: '勺子', emoji: '🥄', tier: 2, syl: 1, group: 'kitchen', s: ['A spoon.', 'This is a spoon.', 'I eat my soup with a spoon.'] },
  { en: 'phone', zh: '电话', emoji: '📱', tier: 2, syl: 1, group: 'thing', s: ['A phone.', 'This is a phone.', 'Mom talks to Grandma on the phone.'] },
  { en: 'key', zh: '钥匙', emoji: '🔑', tier: 2, syl: 1, group: 'thing', s: ['A key.', 'This is a key.', 'Dad opens the door with a key.'] },
  { en: 'umbrella', zh: '雨伞', emoji: '☂️', tier: 2, syl: 3, group: 'thing', s: ['An umbrella.', 'This is an umbrella.', 'I take my umbrella when it rains.'] },
  { en: 'camera', zh: '相机', emoji: '📷', tier: 2, syl: 3, group: 'thing', s: ['A camera.', 'This is a camera.', 'Dad takes a photo with his camera.'] },
  { en: 'candle', zh: '蜡烛', emoji: '🕯️', tier: 2, syl: 2, group: 'thing', s: ['A candle.', 'This is a candle.', 'There are six candles on my cake.'] },
  { en: 'map', zh: '地图', emoji: '🗺️', tier: 3, syl: 1, group: 'thing', s: ['A map.', 'This is a map.', 'We look at the map to find the park.'] },
  { en: 'flag', zh: '旗子', emoji: '🚩', tier: 3, syl: 1, group: 'thing', s: ['A flag.', 'This is a flag.', 'The red flag is on the top of the hill.'] },
]);

// ———————————————— 描述 ————————————————
//
// 形容词没法「指一个东西」，配图只能表意。选图的原则：同一组里放在一起时，
// 孩子能一眼看出区别（大方块和小方块、火和冰），而不是靠认识某个物体。

const DESCRIBE = build('describe', [
  { en: 'big', zh: '大', emoji: '⬛', tier: 1, syl: 1, pos: 'adj', group: 'size', ask: 'Is it big or small?', s: ['Big.', 'It is big.', 'The elephant is very big.'] },
  { en: 'small', zh: '小', emoji: '▪️', tier: 1, syl: 1, pos: 'adj', group: 'size', ask: 'Is it big or small?', s: ['Small.', 'It is small.', 'The mouse is small and fast.'] },
  { en: 'tall', zh: '高', emoji: '🗼', tier: 2, syl: 1, pos: 'adj', group: 'size', ask: 'Is it tall?', s: ['Tall.', 'He is tall.', 'My dad is tall like a tree.'] },
  { en: 'long', zh: '长', emoji: '📏', tier: 2, syl: 1, pos: 'adj', group: 'size', ask: 'Is it long?', s: ['Long.', 'It is long.', 'The snake is very, very long.'] },
  { en: 'heavy', zh: '重', emoji: '🏋️', tier: 3, syl: 2, pos: 'adj', group: 'size', ask: 'Is it heavy?', s: ['Heavy.', 'It is heavy.', 'The big box is very heavy.'] },
  { en: 'hot', zh: '热', emoji: '🔥', tier: 1, syl: 1, pos: 'adj', group: 'temp', ask: 'Is it hot or cold?', s: ['Hot.', 'It is hot.', 'The soup is too hot to drink.'] },
  { en: 'cold', zh: '冷', emoji: '🥶', tier: 1, syl: 1, pos: 'adj', group: 'temp', ask: 'Is it hot or cold?', s: ['Cold.', 'It is cold.', 'The ice cream is very cold.'] },
  { en: 'wet', zh: '湿', emoji: '💦', tier: 2, syl: 1, pos: 'adj', group: 'temp', ask: 'Is it wet?', s: ['Wet.', 'It is wet.', 'My shoes are wet from the rain.'] },
  { en: 'fast', zh: '快', emoji: '🏎️', tier: 2, syl: 1, pos: 'adj', group: 'speed', ask: 'Is it fast or slow?', s: ['Fast.', 'It is fast.', 'The red car is very fast.'] },
  { en: 'slow', zh: '慢', emoji: '🐌', tier: 2, syl: 1, pos: 'adj', group: 'speed', ask: 'Is it fast or slow?', s: ['Slow.', 'It is slow.', 'The snail is very, very slow.'] },
  { en: 'new', zh: '新', emoji: '🆕', tier: 2, syl: 1, pos: 'adj', group: 'quality', ask: 'Is it new?', s: ['New.', 'It is new.', 'I have new shoes today.'] },
  { en: 'clean', zh: '干净', emoji: '✨', tier: 2, syl: 1, pos: 'adj', group: 'quality', ask: 'Is it clean?', s: ['Clean.', 'It is clean.', 'My hands are clean now.'] },
  { en: 'loud', zh: '大声', emoji: '📢', tier: 3, syl: 1, pos: 'adj', group: 'quality', ask: 'Is it loud or quiet?', s: ['Loud.', 'It is loud.', 'The drum is very loud.'] },
  { en: 'quiet', zh: '安静', emoji: '🤫', tier: 3, syl: 2, pos: 'adj', group: 'quality', ask: 'Is it loud or quiet?', s: ['Quiet.', 'Please be quiet.', 'Be quiet, the baby is sleeping.'] },
  { en: 'funny', zh: '好笑', emoji: '🤪', tier: 3, syl: 2, pos: 'adj', group: 'quality', ask: 'Is it funny?', s: ['Funny.', 'It is funny!', 'The funny dog makes us all laugh.'] },
  { en: 'beautiful', zh: '美丽', emoji: '🌺', tier: 3, syl: 3, pos: 'adj', group: 'quality', ask: 'Is it beautiful?', s: ['Beautiful.', 'It is beautiful.', 'The garden is beautiful in spring.'] },
  { en: 'easy', zh: '容易', emoji: '👌', tier: 3, syl: 2, pos: 'adj', group: 'quality', ask: 'Is it easy or difficult?', s: ['Easy.', 'It is easy.', 'This puzzle is easy for me.'] },
  { en: 'difficult', zh: '难', emoji: '😓', tier: 3, syl: 3, pos: 'adj', group: 'quality', ask: 'Is it easy or difficult?', s: ['Difficult.', 'It is difficult.', 'This homework is very difficult.'] },
  { en: 'dangerous', zh: '危险', emoji: '⚠️', tier: 3, syl: 3, pos: 'adj', group: 'quality', ask: 'Is it safe or dangerous?', s: ['Dangerous!', 'Fire is dangerous.', 'It is dangerous to play near the road.'] },
  { en: 'safe', zh: '安全', emoji: '🦺', tier: 3, syl: 1, pos: 'adj', group: 'quality', ask: 'Is it safe or dangerous?', s: ['Safe.', 'We are safe.', 'Hold my hand so you are safe.'] },
  { en: 'sweet', zh: '甜', emoji: '🍬', tier: 2, syl: 1, pos: 'adj', group: 'taste', ask: 'How does it taste?', s: ['Sweet.', 'It is sweet.', 'The cake is very sweet.'] },
  { en: 'sour', zh: '酸', emoji: '🍋', tier: 2, syl: 1, pos: 'adj', group: 'taste', ask: 'How does it taste?', s: ['Sour.', 'It is sour.', 'The lemon is very sour.'] },
  { en: 'spicy', zh: '辣', emoji: '🌶️', tier: 3, syl: 2, pos: 'adj', group: 'taste', ask: 'How does it taste?', s: ['Spicy.', 'It is spicy.', 'The red pepper is very spicy.'] },
  { en: 'salty', zh: '咸', emoji: '🧂', tier: 3, syl: 2, pos: 'adj', group: 'taste', ask: 'How does it taste?', s: ['Salty.', 'It is salty.', 'The sea water is very salty.'] },
  { en: 'dark', zh: '黑暗', emoji: '🌑', tier: 3, syl: 1, pos: 'adj', group: 'light', ask: 'Is it dark or bright?', s: ['Dark.', 'It is dark.', 'It is dark outside at night.'] },
  { en: 'bright', zh: '明亮', emoji: '🔆', tier: 3, syl: 1, pos: 'adj', group: 'light', ask: 'Is it dark or bright?', s: ['Bright.', 'It is bright.', 'The sun is very bright today.'] },
]);

// ———————————————— 出行 ————————————————

const TRANSPORT = build('transport', [
  { en: 'bus', zh: '公交车', emoji: '🚌', tier: 1, syl: 1, group: 'vehicle', s: ['A bus.', 'This is a bus.', 'I go to school by bus.'] },
  { en: 'train', zh: '火车', emoji: '🚆', tier: 1, syl: 1, group: 'vehicle', s: ['A train.', 'This is a train.', 'The long train goes very fast.'] },
  { en: 'bike', zh: '自行车', emoji: '🚲', tier: 1, syl: 1, group: 'vehicle', s: ['A bike.', 'This is my bike.', 'I ride my bike in the park.'] },
  { en: 'plane', zh: '飞机', emoji: '✈️', tier: 1, syl: 1, group: 'vehicle', s: ['A plane.', 'This is a plane.', 'The plane flies high in the sky.'] },
  { en: 'boat', zh: '小船', emoji: '⛵', tier: 1, syl: 1, group: 'vehicle', s: ['A boat.', 'This is a boat.', 'We sit in a little boat on the lake.'] },
  { en: 'truck', zh: '卡车', emoji: '🚚', tier: 2, syl: 1, group: 'vehicle', s: ['A truck.', 'This is a truck.', 'The big truck carries many boxes.'] },
  { en: 'taxi', zh: '出租车', emoji: '🚕', tier: 2, syl: 2, group: 'vehicle', s: ['A taxi.', 'This is a taxi.', 'We take a taxi to the station.'] },
  { en: 'ship', zh: '大船', emoji: '🚢', tier: 2, syl: 1, group: 'vehicle', s: ['A ship.', 'This is a ship.', 'The big ship sails across the sea.'] },
  { en: 'rocket', zh: '火箭', emoji: '🚀', tier: 2, syl: 2, group: 'vehicle', s: ['A rocket.', 'This is a rocket.', 'The rocket flies up to the moon.'] },
  { en: 'helicopter', zh: '直升机', emoji: '🚁', tier: 3, syl: 4, group: 'vehicle', s: ['A helicopter.', 'This is a helicopter.', 'The helicopter flies over the city.'] },
  { en: 'fire truck', zh: '消防车', emoji: '🚒', tier: 3, syl: 2, group: 'vehicle', s: ['A fire truck.', 'This is a fire truck.', 'The red fire truck is very loud.'] },
  { en: 'traffic light', zh: '红绿灯', emoji: '🚦', tier: 3, syl: 3, group: 'road', s: ['A traffic light.', 'Look at the traffic light.', 'We stop when the traffic light is red.'] },
]);

// ———————————————— 地方 ————————————————

const PLACE = build('place', [
  { en: 'park', zh: '公园', emoji: '⛲', tier: 1, syl: 1, group: 'place', s: ['The park.', 'We go to the park.', 'We play on the grass in the park.'] },
  { en: 'school', zh: '学校', emoji: '🏫', tier: 1, syl: 1, group: 'place', s: ['My school.', 'I go to school.', 'I go to school from Monday to Friday.'] },
  { en: 'shop', zh: '商店', emoji: '🏪', tier: 2, syl: 1, group: 'place', s: ['A shop.', 'This is a shop.', 'We buy some bread at the shop.'] },
  { en: 'farm', zh: '农场', emoji: '🚜', tier: 2, syl: 1, group: 'place', s: ['A farm.', 'This is a farm.', 'Many cows and pigs live on the farm.'] },
  { en: 'beach', zh: '海滩', emoji: '🏖️', tier: 2, syl: 1, group: 'place', s: ['The beach.', 'We go to the beach.', 'We play in the sand at the beach.'] },
  { en: 'garden', zh: '花园', emoji: '🌷', tier: 2, syl: 2, group: 'place', s: ['A garden.', 'This is a garden.', 'Grandma grows flowers in her garden.'] },
  { en: 'hospital', zh: '医院', emoji: '🏥', tier: 2, syl: 3, group: 'place', s: ['A hospital.', 'This is a hospital.', 'The doctor works in the hospital.'] },
  { en: 'library', zh: '图书馆', emoji: '📚', tier: 3, syl: 3, group: 'place', s: ['A library.', 'This is a library.', 'We read books quietly in the library.'] },
  { en: 'city', zh: '城市', emoji: '🏙️', tier: 3, syl: 2, group: 'place', s: ['A city.', 'This is a city.', 'The city has many tall buildings.'] },
  { en: 'station', zh: '车站', emoji: '🚉', tier: 3, syl: 2, group: 'place', s: ['A station.', 'This is a station.', 'We wait for the train at the station.'] },
  { en: 'museum', zh: '博物馆', emoji: '🏛️', tier: 3, syl: 3, group: 'place', s: ['A museum.', 'This is a museum.', 'We see very old things in the museum.'] },
  { en: 'supermarket', zh: '超市', emoji: '🛒', tier: 3, syl: 4, group: 'place', s: ['A supermarket.', 'We go to the supermarket.', 'We get milk and eggs at the supermarket.'] },
  { en: 'airport', zh: '机场', emoji: '🛫', tier: 3, syl: 2, group: 'place', s: ['An airport.', 'This is an airport.', 'We take a plane at the airport.'] },
  { en: 'bakery', zh: '面包店', emoji: '🥐', tier: 3, syl: 3, group: 'place', s: ['A bakery.', 'This is a bakery.', 'The bakery has fresh bread every morning.'] },
  { en: 'post office', zh: '邮局', emoji: '🏤', tier: 3, syl: 3, group: 'place', s: ['A post office.', 'This is a post office.', 'I send a letter at the post office.'] },
]);

// ———————————————— 学校 ————————————————

const SCHOOL = build('school', [
  { en: 'pen', zh: '钢笔', emoji: '🖊️', tier: 1, syl: 1, group: 'school', s: ['A pen.', 'This is a pen.', 'I write my name with a pen.'] },
  { en: 'pencil', zh: '铅笔', emoji: '✏️', tier: 1, syl: 2, group: 'school', s: ['A pencil.', 'This is a pencil.', 'I draw a cat with my pencil.'] },
  { en: 'crayon', zh: '蜡笔', emoji: '🖍️', tier: 2, syl: 2, group: 'school', s: ['A crayon.', 'This is a crayon.', 'I color the sun with a yellow crayon.'] },
  { en: 'backpack', zh: '书包', emoji: '🎒', tier: 2, syl: 2, group: 'school', s: ['A backpack.', 'This is my backpack.', 'I put my books in my backpack.'] },
  { en: 'paper', zh: '纸', emoji: '📄', tier: 2, syl: 2, mass: true, group: 'school', s: ['Paper.', 'This is paper.', 'I draw a picture on the paper.'] },
  { en: 'scissors', zh: '剪刀', emoji: '✂️', tier: 2, syl: 2, plural: true, group: 'school', s: ['Scissors.', 'These are scissors.', 'I cut the paper with my scissors.'] },
  { en: 'notebook', zh: '本子', emoji: '📓', tier: 2, syl: 2, group: 'school', s: ['A notebook.', 'This is my notebook.', 'I write new words in my notebook.'] },
  { en: 'homework', zh: '作业', emoji: '📝', tier: 3, syl: 2, mass: true, group: 'school', s: ['Homework.', 'I do my homework.', 'I do my homework after school every day.'] },
  { en: 'computer', zh: '电脑', emoji: '💻', tier: 3, syl: 3, group: 'school', s: ['A computer.', 'This is a computer.', 'My dad works on a computer.'] },
  { en: 'letter', zh: '信', emoji: '✉️', tier: 3, syl: 2, group: 'school', s: ['A letter.', 'I write a letter.', 'I send a letter to my grandpa.'] },
  { en: 'question', zh: '问题', emoji: '❓', tier: 3, syl: 2, abstract: true, group: 'school', s: ['A question.', 'I have a question.', 'I put up my hand to ask a question.'] },
  { en: 'music', zh: '音乐课', emoji: '🎵', tier: 2, syl: 2, mass: true, abstract: true, group: 'subject', ask: 'What class is it?', s: ['Music.', 'I like music.', 'We sing songs in music class.'] },
  { en: 'math', zh: '数学', emoji: '➗', tier: 3, syl: 1, mass: true, abstract: true, group: 'subject', ask: 'What class is it?', s: ['Math.', 'I like math.', 'We learn numbers in math class.'] },
  { en: 'art', zh: '美术', emoji: '🖼️', tier: 3, syl: 1, mass: true, abstract: true, group: 'subject', ask: 'What class is it?', s: ['Art.', 'I like art.', 'We draw and paint in art class.'] },
  { en: 'science', zh: '科学', emoji: '🔬', tier: 3, syl: 2, mass: true, abstract: true, group: 'subject', ask: 'What class is it?', s: ['Science.', 'I like science.', 'We learn about plants in science class.'] },
]);

// ———————————————— 时间与季节 ————————————————

const TIME = build('time', [
  { en: 'birthday', zh: '生日', emoji: '🎂', tier: 1, syl: 2, abstract: true, group: 'day', ask: 'What day is it?', s: ['My birthday.', 'Happy birthday to you!', 'I am six years old on my birthday.'] },
  { en: 'morning', zh: '早上', emoji: '🌅', tier: 2, syl: 2, abstract: true, group: 'day', ask: 'Is it morning or night?', s: ['Morning.', 'Good morning!', 'I eat breakfast in the morning.'] },
  { en: 'night', zh: '晚上', emoji: '🌃', tier: 2, syl: 1, abstract: true, group: 'day', ask: 'Is it morning or night?', s: ['Night.', 'Good night!', 'I sleep in my bed at night.'] },
  { en: 'clock', zh: '钟', emoji: '⏰', tier: 2, syl: 1, group: 'day', s: ['A clock.', 'This is a clock.', 'The clock says it is time for bed.'] },
  { en: 'week', zh: '星期', emoji: '📅', tier: 3, syl: 1, abstract: true, group: 'day', ask: 'How many days are in a week?', s: ['A week.', 'A week has seven days.', 'There are seven days in one week.'] },
  { en: 'today', zh: '今天', emoji: '📆', tier: 3, syl: 2, mass: true, abstract: true, group: 'day', ask: 'When is it?', s: ['Today.', 'Today is Monday.', 'Today we have art and music at school.'] },
  { en: 'tomorrow', zh: '明天', emoji: '⏭️', tier: 3, syl: 3, mass: true, abstract: true, group: 'day', ask: 'When is it?', s: ['Tomorrow.', 'See you tomorrow!', 'Tomorrow we will go to the park.'] },
  { en: 'yesterday', zh: '昨天', emoji: '⏮️', tier: 3, syl: 3, mass: true, abstract: true, group: 'day', ask: 'When is it?', s: ['Yesterday.', 'I played yesterday.', 'Yesterday I played with my best friend.'] },
  { en: 'weekend', zh: '周末', emoji: '🎡', tier: 3, syl: 2, abstract: true, group: 'day', ask: 'When is it?', s: ['The weekend.', 'I love the weekend.', 'On the weekend we go to the park.'] },
  { en: 'spring', zh: '春天', emoji: '🌼', tier: 3, syl: 1, abstract: true, group: 'season', ask: 'What season is it?', s: ['Spring.', 'It is spring.', 'Many flowers grow in the spring.'] },
  { en: 'summer', zh: '夏天', emoji: '🌞', tier: 3, syl: 2, abstract: true, group: 'season', ask: 'What season is it?', s: ['Summer.', 'It is summer.', 'It is very hot in the summer.'] },
  { en: 'autumn', zh: '秋天', emoji: '🍂', tier: 3, syl: 2, abstract: true, group: 'season', ask: 'What season is it?', s: ['Autumn.', 'It is autumn.', 'The leaves fall in the autumn.'] },
  { en: 'winter', zh: '冬天', emoji: '⛄', tier: 3, syl: 2, abstract: true, group: 'season', ask: 'What season is it?', s: ['Winter.', 'It is winter.', 'We play in the snow in the winter.'] },
]);

// ———————————————— 职业 ————————————————

const JOB = build('job', [
  { en: 'teacher', zh: '老师', emoji: '👩‍🏫', tier: 1, syl: 2, group: 'job', ask: 'Who is this?', s: ['My teacher.', 'She is my teacher.', 'My teacher reads us a story every day.'] },
  { en: 'doctor', zh: '医生', emoji: '👩‍⚕️', tier: 2, syl: 2, group: 'job', ask: 'Who is this?', s: ['A doctor.', 'She is a doctor.', 'The doctor helps sick people get better.'] },
  { en: 'farmer', zh: '农民', emoji: '👨‍🌾', tier: 2, syl: 2, group: 'job', ask: 'Who is this?', s: ['A farmer.', 'He is a farmer.', 'The farmer has many cows and pigs.'] },
  { en: 'chef', zh: '厨师', emoji: '👨‍🍳', tier: 2, syl: 1, group: 'job', ask: 'Who is this?', s: ['A chef.', 'He is a chef.', 'The chef makes pizza in the kitchen.'] },
  { en: 'police officer', zh: '警察', emoji: '👮', tier: 3, syl: 4, group: 'job', ask: 'Who is this?', s: ['A police officer.', 'She is a police officer.', 'The police officer helps us cross the road.'] },
  { en: 'firefighter', zh: '消防员', emoji: '👩‍🚒', tier: 3, syl: 3, group: 'job', ask: 'Who is this?', s: ['A firefighter.', 'He is a firefighter.', 'The firefighter puts out the big fire.'] },
  { en: 'pilot', zh: '飞行员', emoji: '👨‍✈️', tier: 3, syl: 2, group: 'job', ask: 'Who is this?', s: ['A pilot.', 'She is a pilot.', 'The pilot flies the big plane.'] },
  { en: 'singer', zh: '歌手', emoji: '👩‍🎤', tier: 3, syl: 2, group: 'job', ask: 'Who is this?', s: ['A singer.', 'She is a singer.', 'The singer sings a happy song.'] },
  { en: 'artist', zh: '画家', emoji: '👩‍🎨', tier: 3, syl: 2, group: 'job', ask: 'Who is this?', s: ['An artist.', 'He is an artist.', 'The artist paints a picture of the sea.'] },
  { en: 'scientist', zh: '科学家', emoji: '👩‍🔬', tier: 3, syl: 3, group: 'job', ask: 'Who is this?', s: ['A scientist.', 'She is a scientist.', 'The scientist looks at tiny things.'] },
  { en: 'astronaut', zh: '宇航员', emoji: '👩‍🚀', tier: 3, syl: 3, group: 'job', ask: 'Who is this?', s: ['An astronaut.', 'He is an astronaut.', 'The astronaut flies to the moon.'] },
  { en: 'mechanic', zh: '修理工', emoji: '👩‍🔧', tier: 3, syl: 3, group: 'job', ask: 'Who is this?', s: ['A mechanic.', 'She is a mechanic.', 'The mechanic fixes our old car.'] },
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
  ...HOUSE,
  ...DESCRIBE,
  ...TRANSPORT,
  ...PLACE,
  ...SCHOOL,
  ...TIME,
  ...JOB,
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
  { id: 'house', label: 'At Home', labelZh: '家里的东西', emoji: '🛋️' },
  { id: 'describe', label: 'Big and Small', labelZh: '描述', emoji: '📏' },
  { id: 'transport', label: 'On the Go', labelZh: '出行', emoji: '🚌' },
  { id: 'place', label: 'Places', labelZh: '地方', emoji: '🗺️' },
  { id: 'school', label: 'At School', labelZh: '学校', emoji: '🎒' },
  { id: 'time', label: 'Time', labelZh: '时间与季节', emoji: '⏰' },
  { id: 'job', label: 'Jobs', labelZh: '职业', emoji: '👩‍⚕️' },
];

export function themeLabel(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.labelZh ?? id;
}

export function themeLabelEn(id: ThemeId): string {
  return THEMES.find((t) => t.id === id)?.label ?? id;
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
  if (w.pos === 'adj' || w.pos === 'num' || w.abstract) return `Which one ${beVerb(w)} ${w.en}?`;
  return `Where ${beVerb(w)} the ${w.en}?`;
}

/** 游戏里的「找出来」。§15 的例子就是 Find the cat. */
export function findPrompt(w: Word): string {
  if (w.pos === 'verb' || w.abstract) return `Find: ${w.en}.`;
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
  // 放宽到全库时可能抓到和答案同一张图的词（比如「大」和「大象」都画成大的东西），
  // 那道题就会有两个看起来都对的选项。选项之间的图必须两两不同。
  const clash = (a: Word, b: Word) => a.id === b.id || a.emoji === b.emoji || a.en === b.en;
  const pick = (pool: Word[], out: Word[]) => {
    const rest = pool.filter((w) => !clash(w, word));
    while (out.length < n && rest.length) {
      const i = Math.floor(rnd() * rest.length) % rest.length;
      const w = rest.splice(i, 1)[0];
      // 每放一个都要和已选的比一次：候选池里本身也可能有两张一样的图
      if (!out.some((o) => clash(o, w))) out.push(w);
    }
  };
  const out: Word[] = [];
  pick(WORDS.filter((w) => w.group === word.group), out);
  if (out.length < n) pick(WORDS.filter((w) => w.theme === word.theme), out);
  if (out.length < n) pick(WORDS, out);
  return out;
}
