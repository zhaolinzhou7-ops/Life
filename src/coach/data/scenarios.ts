/**
 * 场景库
 *
 * 每个场景都是**一件要办成的事**，不是一个聊天话题。这是第 7 节的核心要求：
 * 用户说 "Hello." 的时候，前台应该继续当前台，而不是突然开始讲语法。
 *
 * 所以每个 stage 都带一个 `advance(text)` 纯函数：用户这句话有没有把事情
 * 往前推，由它说了算。**不交给模型判断**——否则复盘里那句"你完成了入住"
 * 就是一句不可验证的话，而这恰恰是用户唯一真正在意的结论。
 *
 * 四级提示 (hint) 是"不会说"模式的弹药。设计原则是每一级都只多给一点点：
 *   关键词 → 句子骨架 → 半句 → 整句
 * 目的是让用户尽量在前两级就自己说出来，而不是直接抄第四级。
 */

import type { HintLadder, Scenario, ScenarioStage } from '../types';

/** 归一化：全部转小写，非字母数字变空格。"I'd like" → " i d like " */
const norm = (t: string): string => ` ${t.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()} `;

/** 命中任意一个就算推进 */
const any =
  (...pats: (string | RegExp)[]) =>
  (t: string): boolean => {
    const s = norm(t);
    return pats.some((p) => (typeof p === 'string' ? s.includes(` ${p} `) || s.includes(`${p} `) : p.test(s)));
  };

/** 必须同时命中。用于"既要说出诉求，又要给出信息"这种一步两件事的场合 */
const all =
  (...matchers: ((t: string) => boolean)[]) =>
  (t: string): boolean =>
    matchers.every((m) => m(t));

/** 说了足够长的一段话就算推进，用于自由表达型的 stage */
const saysSomething =
  (minWords: number) =>
  (t: string): boolean =>
    norm(t).trim().split(/\s+/).filter(Boolean).length >= minWords;

const hint = (intentCn: string, keywords: string[], frame: string, half: string, full: string): HintLadder => ({
  intentCn,
  keywords,
  frame,
  half,
  full,
});

const stage = (
  id: string,
  npc: string,
  goal: string,
  advance: (t: string) => boolean,
  nudge: string[],
  h: HintLadder,
): ScenarioStage => ({ id, npc, goal, advance, nudge, hint: h });

// ══════════════════════════════════════════════════════════════
//  日常
// ══════════════════════════════════════════════════════════════

const selfIntro: Scenario = {
  id: 'daily-intro',
  category: 'daily',
  title: '自我介绍',
  titleEn: 'Introducing yourself',
  setting: '一个行业交流活动的茶歇时间，旁边的人主动和你打招呼。',
  role: 'Sam，一个刚认识的同行',
  userRole: '你自己',
  level: 'A2',
  mission: '让对方知道你是谁、做什么的，并把话题接下去',
  keyPhrases: [
    { en: "I'm a designer at a software company.", cn: '我在一家软件公司做设计。' },
    { en: "I've been doing this for about five years.", cn: '我做这行大概五年了。' },
    { en: 'What about you? / How about yourself?', cn: '你呢？' },
  ],
  keywords: ['work', 'company', 'years', 'based', 'actually'],
  stages: [
    stage(
      'greet',
      "Hi there! I don't think we've met. I'm Sam.",
      '回应问候并说出自己的名字',
      any('i m', 'im ', 'my name', 'nice to meet', 'hi', 'hello', 'hey'),
      ["Sorry, I didn't catch your name?", "I'm Sam, by the way. And you are…?"],
      hint(
        '你好，我是……，很高兴认识你',
        ['Hi', "I'm + 名字", 'Nice to meet you'],
        "Hi, I'm ___. Nice to meet you.",
        "Hi, I'm ___. Nice to ___ you.",
        "Hi, I'm Lin. Nice to meet you, Sam.",
      ),
    ),
    stage(
      'job',
      'Nice to meet you too. So what do you do?',
      '说清楚你的工作',
      any('i work', 'i m a', 'im a', 'i am a', 'designer', 'engineer', 'teacher', 'manager', 'i do', 'developer', 'sales', 'student'),
      ['Sorry, what field are you in?', 'What kind of work do you do exactly?'],
      hint(
        '我是做……的 / 我在……公司工作',
        ['I work', 'as a', 'at a company'],
        'I work as a ___ at a ___ company.',
        'I work as a ___ at ___.',
        'I work as a product designer at a software company.',
      ),
    ),
    stage(
      'detail',
      "Oh nice. How long have you been doing that?",
      '补充一点细节，比如做了多久、喜欢哪部分',
      saysSomething(4),
      ['A few years? Or is it pretty new for you?', 'And do you enjoy it?'],
      hint(
        '做了大概几年了 / 我挺喜欢这份工作的',
        ['about', 'years', 'enjoy'],
        "I've been doing it for about ___ years.",
        "I've been doing it for about ___ years, and I really ___ it.",
        "I've been doing it for about five years, and I really enjoy the problem-solving part.",
      ),
    ),
    stage(
      'bounce',
      "That sounds interesting. I'm in marketing myself — been at it for ages.",
      '把问题抛回去，让对话继续',
      any('what about you', 'how about you', 'and you', 'what do you', 'how long have you', 'do you'),
      ['…', 'So, yeah. That’s me in a nutshell.'],
      hint(
        '那你呢？你做这行多久了？',
        ['What about you', 'How long'],
        'What about you? How long ___?',
        'What about you? How long have you ___?',
        "What about you? How long have you been in marketing?",
      ),
    ),
  ],
  rubric: ['能说出身份和工作', '能补充一句细节而不是只答三个词', '主动把问题抛回去'],
};

const coffee: Scenario = {
  id: 'daily-coffee',
  category: 'daily',
  title: '咖啡店点单',
  titleEn: 'Ordering at a café',
  setting: '一家忙碌的连锁咖啡店，轮到你点单了。',
  role: '咖啡店店员',
  userRole: '顾客',
  level: 'A1',
  mission: '点到想要的饮品，并完成付款',
  keyPhrases: [
    { en: "Can I get a medium latte, please?", cn: '我要一杯中杯拿铁。' },
    { en: 'For here, please. / To go, please.', cn: '在这儿喝 / 带走。' },
    { en: 'Card, please.', cn: '刷卡。' },
  ],
  keywords: ['latte', 'medium', 'to go', 'card', 'oat milk'],
  stages: [
    stage(
      'order',
      'Hi, what can I get for you?',
      '说出你要喝什么',
      any('coffee', 'latte', 'americano', 'cappuccino', 'tea', 'espresso', 'mocha', 'can i get', 'i d like', 'i ll have'),
      ['Take your time.', 'What can I get started for you?'],
      hint(
        '我要一杯中杯拿铁',
        ['Can I get', 'a medium latte', 'please'],
        'Can I get a ___ ___, please?',
        'Can I get a medium ___, please?',
        'Can I get a medium latte, please?',
      ),
    ),
    stage(
      'size',
      'Sure. What size would you like?',
      '说出杯型',
      any('small', 'medium', 'large', 'regular', 'tall', 'grande'),
      ['Small, medium or large?', 'We have three sizes.'],
      hint('中杯', ['Medium'], 'Medium, please.', 'Medium, ___.', 'Medium, please.'),
    ),
    stage(
      'here',
      'Got it. For here or to go?',
      '说明堂食还是带走',
      any('to go', 'for here', 'take away', 'takeaway', 'here', 'go'),
      ['Are you staying or taking it with you?'],
      hint('带走', ['To go'], 'To go, please.', 'To ___, please.', 'To go, please.'),
    ),
    stage(
      'pay',
      "That'll be four fifty. How would you like to pay?",
      '完成付款',
      any('card', 'cash', 'credit', 'apple pay', 'phone', 'here you are', 'here you go'),
      ['Cash or card?'],
      hint('刷卡', ['Card', 'please'], 'Card, please.', '___, please.', 'Card, please. Here you go.'),
    ),
  ],
  rubric: ['能主动说出需求而不是只回答是/否', '用 Can I get / I’d like 而不是 I want', '完成整笔交易'],
};

const restaurant: Scenario = {
  id: 'daily-restaurant',
  category: 'daily',
  title: '餐厅点餐',
  titleEn: 'At a restaurant',
  setting: '一家不算太正式的餐厅，服务员过来点单。',
  role: '餐厅服务员',
  userRole: '顾客',
  level: 'A2',
  mission: '点一份主菜，问清一个细节，最后结账',
  keyPhrases: [
    { en: 'What would you recommend?', cn: '你推荐什么？' },
    { en: "I'm allergic to peanuts.", cn: '我对花生过敏。' },
    { en: 'Could we get the bill, please?', cn: '能结账吗？' },
  ],
  keywords: ['recommend', 'allergic', 'bill', 'starter', 'medium rare'],
  stages: [
    stage(
      'drinks',
      'Good evening. Can I start you off with something to drink?',
      '点一杯喝的，或者说先不用',
      any('water', 'beer', 'wine', 'juice', 'coke', 'tea', 'coffee', 'just water', 'nothing', 'not yet', 'i ll have', 'can i get'),
      ['Still or sparkling water, maybe?', 'No rush.'],
      hint(
        '先来杯水就好',
        ['Just water', 'thanks'],
        'Just ___, thanks.',
        'Just water, ___.',
        'Just water for now, thanks.',
      ),
    ),
    stage(
      'ask',
      'Sure. Are you ready to order, or do you need another minute?',
      '问一个问题，比如推荐什么',
      any('recommend', 'what is', 'what s', 'popular', 'specialty', 'special', 'suggest', 'good here', 'difference'),
      ['Happy to answer any questions about the menu.', 'Anything I can explain?'],
      hint(
        '你推荐什么？',
        ['What', 'recommend'],
        'What would you ___?',
        'What would you recommend?',
        "What would you recommend? It's my first time here.",
      ),
    ),
    stage(
      'order',
      'The grilled salmon is really popular, and the mushroom risotto is a favourite too.',
      '点一道主菜',
      any('i ll have', 'i ll take', 'i d like', 'can i get', 'salmon', 'risotto', 'the chicken', 'steak', 'i ll go with'),
      ['Either one is a great choice.', 'Which one sounds good?'],
      hint(
        '那我要三文鱼吧',
        ["I'll have", 'the salmon'],
        "I'll have the ___, please.",
        "I'll ___ the salmon, please.",
        "I'll have the salmon, please.",
      ),
    ),
    stage(
      'bill',
      'Excellent choice. … Here you are. Can I get you anything else?',
      '要求结账',
      any('bill', 'check', 'pay', 'that s all', 'that ll be all', 'nothing else'),
      ['Any dessert or coffee?', 'Take your time.'],
      hint(
        '麻烦结账',
        ['the bill', 'please'],
        'Could we get the ___, please?',
        'Could we get the bill, ___?',
        'No thanks — could we get the bill, please?',
      ),
    ),
  ],
  rubric: ['主动提问而不是被动回答', '用 I’ll have / Could we 这类自然句式', '完成点餐到结账的全流程'],
};

const weekend: Scenario = {
  id: 'daily-smalltalk',
  category: 'daily',
  title: '周末闲聊',
  titleEn: 'Weekend small talk',
  setting: '周一早上，同事在茶水间碰到你。',
  role: 'Alex，你的同事',
  userRole: '你自己',
  level: 'A2',
  mission: '把"周末过得怎么样"这个话题聊满三个来回，不冷场',
  keyPhrases: [
    { en: 'Pretty quiet, actually.', cn: '其实挺闲的。' },
    { en: 'I ended up staying in.', cn: '我最后就待在家了。' },
    { en: 'How about you?', cn: '你呢？' },
  ],
  keywords: ['weekend', 'stayed in', 'hang out', 'ended up', 'nothing much'],
  stages: [
    stage(
      'howwas',
      'Morning! How was your weekend?',
      '回答并给一点内容，不要只说 good',
      all(saysSomething(3), any('i ', 'it was', 'pretty', 'quite', 'nothing', 'good', 'nice', 'busy', 'quiet')),
      ['Yeah? Anything fun?', 'Did you get up to much?'],
      hint(
        '挺不错的，我出去吃了顿饭',
        ['Pretty good', 'I went'],
        'Pretty good. I ___ on Saturday.',
        'Pretty good — I ___ out for dinner on Saturday.',
        'Pretty good, thanks. I went out for dinner with some friends on Saturday.',
      ),
    ),
    stage(
      'detail',
      'Oh nice. Anywhere good?',
      '补一个具体细节',
      saysSomething(4),
      ['Was it any good?', 'Somewhere new?'],
      hint(
        '一家新开的川菜馆，挺好吃的',
        ['a new place', 'really good'],
        'A new ___ place. It was really ___.',
        'A new Sichuan place near my flat. It was really ___.',
        'A new Sichuan place near my flat. The food was really good, actually.',
      ),
    ),
    stage(
      'bounce',
      'Sounds great. I should try it sometime.',
      '把话题抛回去',
      any('how about you', 'what about you', 'and you', 'did you', 'what did you', 'how was yours'),
      ['…', 'Anyway, I should get back to my desk.'],
      hint(
        '你周末呢？',
        ['How about you'],
        'How about you? ___?',
        'How about you? Did you ___ anything?',
        'How about you? Did you do anything fun?',
      ),
    ),
  ],
  rubric: ['不用一个词打发对方', '能主动补充细节', '把问题抛回去让对话继续'],
};

const shopping: Scenario = {
  id: 'daily-return',
  category: 'daily',
  title: '退换商品',
  titleEn: 'Returning something',
  setting: '你买的一件衣服尺码不对，回到店里想换。',
  role: '店员',
  userRole: '顾客',
  level: 'B1',
  mission: '说清问题、提出诉求、拿到解决方案',
  keyPhrases: [
    { en: "I'd like to exchange this for a larger size.", cn: '我想换一件大一号的。' },
    { en: 'I bought it last week.', cn: '我上周买的。' },
    { en: 'Do you have it in medium?', cn: '有中码的吗？' },
  ],
  keywords: ['exchange', 'refund', 'receipt', 'size', 'fit'],
  stages: [
    stage(
      'problem',
      'Hi, how can I help you today?',
      '说明来意和问题',
      any('return', 'exchange', 'refund', 'too small', 'too big', 'doesn t fit', 'wrong size', 'change this', 'bought'),
      ['Is there a problem with it?', 'What seems to be the issue?'],
      hint(
        '我想换一件，这件太小了',
        ['exchange', 'too small'],
        "I'd like to ___ this. It's too ___.",
        "I'd like to exchange this — it's too ___.",
        "Hi, I'd like to exchange this shirt. It's a bit too small.",
      ),
    ),
    stage(
      'receipt',
      'No problem. Do you have the receipt with you?',
      '回应收据的问题',
      any('yes', 'yeah', 'here', 'no', 'i don t', 'i dont', 'receipt', 'on my phone', 'email'),
      ['Even a digital one works.', 'Did you pay by card?'],
      hint(
        '有的，在我手机上',
        ['Yes', 'on my phone'],
        'Yes, ___.',
        "Yes, it's ___ my phone.",
        "Yes, I've got it here on my phone.",
      ),
    ),
    stage(
      'size',
      'Great. What size would you like instead?',
      '说出你要的尺码并确认有没有货',
      any('medium', 'large', 'small', 'bigger', 'larger', 'do you have', 'size'),
      ['We might have it out back.', 'Which size works for you?'],
      hint(
        '要中码，有吗？',
        ['medium', 'Do you have'],
        'Do you have it in ___?',
        'A medium, please. Do you ___ it in stock?',
        'A medium, please. Do you have it in stock?',
      ),
    ),
  ],
  rubric: ['能说清问题而不是只说"这个不行"', '能提出明确诉求', '能追问关键信息'],
};

// ══════════════════════════════════════════════════════════════
//  旅行
// ══════════════════════════════════════════════════════════════

const hotel: Scenario = {
  id: 'travel-hotel',
  category: 'travel',
  title: '酒店入住',
  titleEn: 'Hotel check-in',
  setting: '晚上十点，你拖着行李到了酒店前台。',
  role: '酒店前台',
  userRole: '住客',
  level: 'A2',
  mission: '成功办理入住，并问清早餐时间',
  keyPhrases: [
    { en: "I have a reservation under Zhou.", cn: '我有一个姓周的预订。' },
    { en: 'Could I get a room on a higher floor?', cn: '能给我高层的房间吗？' },
    { en: 'What time is breakfast?', cn: '早餐几点？' },
  ],
  keywords: ['reservation', 'check in', 'passport', 'breakfast', 'floor'],
  stages: [
    stage(
      'checkin',
      'Good evening, welcome. How may I help you?',
      '说明你要办理入住，并报上预订信息',
      any('check in', 'checking in', 'reservation', 'booking', 'booked', 'i have a room'),
      // 用户只说 Hello 时，前台继续当前台——不跳出来讲语法
      ['Good evening. Are you checking in with us tonight?', 'Do you have a reservation with us?'],
      hint(
        '我要办入住，姓周的预订',
        ['check in', 'reservation', 'under'],
        "I'd like to ___, please. I have a reservation under ___.",
        "I'd like to check in. I have a ___ under Zhou.",
        "Good evening. I'd like to check in — I have a reservation under Zhou.",
      ),
    ),
    stage(
      'id',
      'Of course. Could I see your passport, please?',
      '把证件给对方',
      any('here', 'sure', 'of course', 'yes', 'passport', 'here you are', 'here you go', 'no problem'),
      ['I just need it for a moment.', 'Any photo ID works.'],
      hint(
        '给你',
        ['Here you are'],
        'Here you ___.',
        'Here you are.',
        'Sure, here you are.',
      ),
    ),
    stage(
      'request',
      "Thank you. You're in room 412. Is there anything else you need?",
      '提一个要求，比如换高层或者要安静的房间',
      any('could i', 'can i', 'is it possible', 'would it be possible', 'higher', 'quiet', 'upgrade', 'late checkout', 'do you have'),
      ['We do have a few rooms available if you prefer something different.'],
      hint(
        '能换个安静一点的房间吗？',
        ['Could I', 'quieter room'],
        'Could I ___ a quieter room?',
        'Could I get a ___ room, if possible?',
        'Could I get a quieter room, if possible? I’m a light sleeper.',
      ),
    ),
    stage(
      'breakfast',
      "Certainly, let me move you to 812. Anything else?",
      '问清早餐时间',
      any('breakfast', 'what time', 'when is', 'wifi', 'gym', 'checkout'),
      ['Happy to help with anything else.'],
      hint(
        '早餐几点开始？',
        ['What time', 'breakfast'],
        'What time ___ breakfast?',
        'What time ___ breakfast start?',
        'What time does breakfast start?',
      ),
    ),
  ],
  rubric: ['开口就说明来意，不停在 Hello', '能用 Could I 提出请求', '主动问清自己需要的信息'],
};

const airport: Scenario = {
  id: 'travel-airport',
  category: 'travel',
  title: '机场值机',
  titleEn: 'Airport check-in',
  setting: '机场值机柜台，你要飞往伦敦。',
  role: '航司地勤',
  userRole: '旅客',
  level: 'A2',
  mission: '完成值机、托运行李、拿到想要的座位',
  keyPhrases: [
    { en: "I'm checking in for the flight to London.", cn: '我要办理飞伦敦的值机。' },
    { en: 'Just one bag to check.', cn: '只有一件托运行李。' },
    { en: 'Could I get an aisle seat?', cn: '能给我靠过道的座位吗？' },
  ],
  keywords: ['check in', 'luggage', 'aisle', 'window', 'boarding pass'],
  stages: [
    stage(
      'where',
      'Good morning. Where are you flying today?',
      '说出目的地',
      any('london', 'to ', 'flying to', 'i m going', 'paris', 'tokyo', 'new york'),
      ['Which destination?', 'Can I see your booking?'],
      hint(
        '我飞伦敦',
        ['London'],
        "I'm flying to ___.",
        "I'm flying to London ___.",
        "I'm flying to London — here's my passport.",
      ),
    ),
    stage(
      'bags',
      'Thank you. Any bags to check today?',
      '说明行李情况',
      any('one', 'two', 'just one', 'no', 'none', 'carry on', 'this one', 'bag', 'suitcase'),
      ['Just carry-on?', 'How many pieces?'],
      hint(
        '托运一件',
        ['Just one'],
        'Just ___, please.',
        'Just one ___, please.',
        'Just this one, please.',
      ),
    ),
    stage(
      'seat',
      "Perfect. I've got you in 23B, a middle seat. Is that okay?",
      '提出换座位的要求',
      any('aisle', 'window', 'could i', 'can i', 'is there', 'prefer', 'would rather', 'any chance'),
      ['I might be able to move you.', 'Would you prefer something else?'],
      hint(
        '能换靠过道的吗？',
        ['Could I', 'aisle seat'],
        'Could I get an ___ seat instead?',
        'Could I ___ an aisle seat instead?',
        'Could I get an aisle seat instead, if there’s one available?',
      ),
    ),
  ],
  rubric: ['主动说出目的地和诉求', '能礼貌地提出换座', '听懂并回应对方的追问'],
};

const directions: Scenario = {
  id: 'travel-directions',
  category: 'travel',
  title: '问路',
  titleEn: 'Asking for directions',
  setting: '你在一个陌生城市迷路了，想找地铁站。',
  role: '路人',
  userRole: '游客',
  level: 'A2',
  mission: '问清怎么走，并确认自己听懂了',
  keyPhrases: [
    { en: 'Excuse me, how do I get to the station?', cn: '请问车站怎么走？' },
    { en: 'Sorry, could you say that again?', cn: '抱歉，能再说一遍吗？' },
    { en: 'So I go straight and then turn left?', cn: '所以我直走然后左转？' },
  ],
  keywords: ['excuse me', 'straight', 'turn left', 'block', 'how far'],
  stages: [
    stage(
      'ask',
      '（路人正好路过，你叫住他）',
      '开口问路',
      any('excuse me', 'sorry', 'how do i get', 'where is', 'could you tell me', 'do you know', 'is there'),
      ['（路人没听见，继续往前走）', '（另一个路人走过来了）'],
      hint(
        '请问地铁站怎么走？',
        ['Excuse me', 'how do I get to'],
        'Excuse me, how do I ___ to the ___?',
        'Excuse me, how do I get to the ___ station?',
        'Excuse me, how do I get to the nearest metro station?',
      ),
    ),
    stage(
      'clarify',
      'Sure — go straight down this road, take the second left, and it’s just past the bank.',
      '确认你听懂了，或者请对方再说一遍',
      any('so i', 'you mean', 'say that again', 'repeat', 'sorry', 'second left', 'straight', 'got it', 'past the bank'),
      ['Does that make sense?', 'I can say it again if you like.'],
      hint(
        '所以是直走，第二个路口左转？',
        ['So', 'straight', 'second left'],
        'So I go ___, then take the ___ left?',
        'So I go straight and then take the ___ left?',
        'So I go straight down this road, then take the second left?',
      ),
    ),
    stage(
      'howfar',
      "That's right. You can't miss it.",
      '问一个补充问题，比如多远、要走多久',
      any('how far', 'how long', 'walk', 'minutes', 'thank', 'thanks', 'appreciate'),
      ['Anything else?'],
      hint(
        '大概要走多久？',
        ['How long', 'walk'],
        'How long ___ it take to walk?',
        'How long does it ___ to walk there?',
        'Great, thanks. How long does it take to walk there?',
      ),
    ),
  ],
  rubric: ['敢主动叫住陌生人', '听不懂时会请对方重复，而不是装懂', '会复述确认'],
};

const taxi: Scenario = {
  id: 'travel-taxi',
  category: 'travel',
  title: '打车',
  titleEn: 'Taking a taxi',
  setting: '你在酒店门口上了一辆出租车。',
  role: '出租车司机',
  userRole: '乘客',
  level: 'A2',
  mission: '说清目的地、确认价格、顺利下车',
  keyPhrases: [
    { en: 'Could you take me to the airport, please?', cn: '麻烦去机场。' },
    { en: 'How much will it be, roughly?', cn: '大概多少钱？' },
    { en: 'Can I pay by card?', cn: '可以刷卡吗？' },
  ],
  keywords: ['airport', 'how much', 'card', 'here is fine', 'traffic'],
  stages: [
    stage(
      'dest',
      'Hi there. Where to?',
      '说出目的地',
      any('airport', 'station', 'hotel', 'to ', 'take me', 'could you', 'i m going'),
      ['Where are you headed?', 'Which address?'],
      hint(
        '麻烦去机场',
        ['the airport', 'please'],
        'The ___, please.',
        'Could you take me to the ___, please?',
        'Could you take me to the airport, please?',
      ),
    ),
    stage(
      'price',
      'Sure thing. Should take about forty minutes with this traffic.',
      '问一下大概多少钱',
      any('how much', 'cost', 'fare', 'price', 'roughly', 'about how much'),
      ['Traffic’s not too bad today.'],
      hint(
        '大概多少钱？',
        ['How much', 'roughly'],
        'How much ___ it be, roughly?',
        'How much will it ___, roughly?',
        'How much will it be, roughly?',
      ),
    ),
    stage(
      'pay',
      "Around thirty-five. … Okay, here we are.",
      '完成付款',
      any('card', 'cash', 'pay', 'keep the change', 'thank', 'here you'),
      ['Cash or card is fine.'],
      hint(
        '可以刷卡吗？',
        ['Can I pay', 'by card'],
        'Can I pay ___ card?',
        'Can I ___ by card?',
        'Thanks. Can I pay by card?',
      ),
    ),
  ],
  rubric: ['能主动说出目的地', '敢问价格而不是硬着头皮', '完成整个乘车流程'],
};

// ══════════════════════════════════════════════════════════════
//  工作
// ══════════════════════════════════════════════════════════════

const interview: Scenario = {
  id: 'work-interview',
  category: 'work',
  title: '英语面试',
  titleEn: 'Job interview',
  setting: '一家外企的视频面试，面试官是你未来的直属上级。',
  role: 'Rachel，招聘方的团队负责人',
  userRole: '候选人',
  level: 'B1',
  mission: '说清自己的经历、举一个具体例子、反问一个好问题',
  keyPhrases: [
    { en: "I've been working in this field for about six years.", cn: '我在这个领域做了大概六年。' },
    { en: 'For example, last year I led a project that…', cn: '举个例子，去年我带了一个项目……' },
    { en: 'Could you tell me more about the team?', cn: '能多介绍一下团队吗？' },
  ],
  keywords: ['experience', 'responsible for', 'for example', 'challenge', 'role'],
  stages: [
    stage(
      'tellme',
      "Thanks for joining. So, tell me a bit about yourself.",
      '做一个 30 秒的自我介绍',
      saysSomething(12),
      ['Take your time — just a quick overview is fine.', 'Maybe start with your current role?'],
      hint(
        '简单介绍一下背景、现在做什么、做了多久',
        ['currently', 'I work as', 'for about ... years'],
        "I'm currently a ___ at ___, and I've been ___ for about ___ years.",
        "I'm currently a ___ at ___. I've been in this field for about ___ years, mostly working on ___.",
        "Sure. I'm currently a product designer at a software company, and I've been in this field for about six years, mostly working on mobile apps.",
      ),
    ),
    stage(
      'example',
      "Great. Can you give me an example of a challenge you've faced recently?",
      '举一个具体例子，不要空谈',
      all(saysSomething(12), any('for example', 'last', 'we ', 'i ', 'project', 'when', 'once', 'recently')),
      ['Anything concrete comes to mind?', 'A recent project would be perfect.'],
      hint(
        '讲一个具体的项目：情况是什么、你做了什么、结果如何',
        ['Last year', 'we had to', 'In the end'],
        'Last ___, we had to ___. I ___, and in the end ___.',
        'Last year we had to ___ in a very short time. I ___, and in the end we ___.',
        "Last year we had to redesign our checkout flow in about six weeks. I ran the user testing and cut the steps from five to three, and in the end the drop-off rate went down by about twenty percent.",
      ),
    ),
    stage(
      'ask',
      "That's really helpful, thank you. Do you have any questions for me?",
      '反问一个有分量的问题',
      any('could you tell me', 'what', 'how', 'i d like to know', 'i was wondering', 'can you tell me', 'do you'),
      ['Anything you’d like to know about the role or the team?'],
      hint(
        '问团队怎么协作，或者这个岗位最大的挑战是什么',
        ['Could you tell me', 'the team', 'the biggest challenge'],
        'Could you tell me more about ___?',
        'Could you tell me more about how the ___ works together?',
        "Yes — could you tell me what the biggest challenge is for this role in the first six months?",
      ),
    ),
  ],
  rubric: ['自我介绍有结构，不是流水账', '能举出具体例子和数字', '反问的问题说明做过功课'],
};

const statusUpdate: Scenario = {
  id: 'work-standup',
  category: 'work',
  title: '会上汇报进度',
  titleEn: 'Giving a status update',
  setting: '周一的团队例会，轮到你汇报。',
  role: 'David，你的项目经理',
  userRole: '团队成员',
  level: 'B1',
  mission: '讲清进展、卡点和下一步',
  keyPhrases: [
    { en: "So far we've finished the first two parts.", cn: '目前我们完成了前两部分。' },
    { en: "We've run into an issue with…", cn: '我们在……上遇到了一个问题。' },
    { en: "I'll follow up with them this week.", cn: '我这周会跟进。' },
  ],
  keywords: ['so far', 'on track', 'blocked', 'follow up', 'by Friday'],
  stages: [
    stage(
      'progress',
      "Okay, let's go around. What's the status on your side?",
      '说清目前进展',
      all(saysSomething(6), any('finished', 'done', 'so far', 'completed', 'working on', 'started', 'on track', 'we ve', 'i ve')),
      ['Where are we at?', 'How far along are you?'],
      hint(
        '目前完成了哪些部分',
        ['So far', "we've finished", 'still working on'],
        "So far we've ___, and we're still working on ___.",
        "So far we've finished ___, and we're still ___ on ___.",
        "So far we've finished the design and the first round of testing, and we're still working on the backend integration.",
      ),
    ),
    stage(
      'blocker',
      'Good. Anything blocking you?',
      '说清卡在哪里',
      saysSomething(5),
      ['Any dependencies?', 'Anything you need from the rest of us?'],
      hint(
        '在等另一个团队给接口文档',
        ['waiting on', 'the API', 'before we can'],
        "We're waiting on ___ before we can ___.",
        "We're waiting on the ___ team for ___, so we can't ___ yet.",
        "We're waiting on the platform team for the API docs, so we can't finish the integration yet.",
      ),
    ),
    stage(
      'next',
      "Got it. I'll chase them. What's next on your list?",
      '说清下一步和时间点',
      all(saysSomething(5), any('next', 'i ll', 'we ll', 'by ', 'this week', 'tomorrow', 'plan to', 'going to')),
      ['And roughly when?', 'What’s the timeline looking like?'],
      hint(
        '这周先把测试写完，周五之前给你结果',
        ["I'll", 'by Friday', 'finish'],
        "I'll ___ this week and have it ready by ___.",
        "Next I'll ___, and I should have it done by ___.",
        "Next I'll finish the test cases, and I should have results for you by Friday.",
      ),
    ),
  ],
  rubric: ['进展说得具体，不是"还行"', '敢说卡点而不是掩盖', '给出明确的时间点'],
};

const disagree: Scenario = {
  id: 'work-disagree',
  category: 'work',
  title: '表达不同意见',
  titleEn: 'Pushing back politely',
  setting: '同事提了一个方案，你觉得有问题，但不想把关系搞僵。',
  role: 'Priya，你的同事',
  userRole: '团队成员',
  level: 'B2',
  mission: '说出顾虑、给出理由、提出替代方案，全程保持合作语气',
  keyPhrases: [
    { en: 'I see what you mean, but I have one concern.', cn: '我明白你的意思，不过我有一个顾虑。' },
    { en: 'The risk is that…', cn: '风险在于……' },
    { en: 'What if we tried … instead?', cn: '我们不如试试……？' },
  ],
  keywords: ['concern', 'risk', 'what if', 'instead', 'I see your point'],
  stages: [
    stage(
      'soften',
      "So I think we should just ship it this Friday and fix the bugs later. Sounds good?",
      '先接住对方，再表达不同意见',
      any('i see', 'i understand', 'that makes sense', 'good point', 'i agree', 'but', 'however', 'concern', 'not sure', 'i think'),
      ['You’re on board, right?', 'Any thoughts?'],
      hint(
        '我理解你的想法，不过我有个顾虑',
        ['I see what you mean', 'one concern'],
        'I see what you ___, but I do have one ___.',
        'I see what you mean, but I have one ___ about ___.',
        "I see what you mean — shipping early would help. But I do have one concern about the timing.",
      ),
    ),
    stage(
      'reason',
      "Okay, go on. What's the concern?",
      '给出具体理由',
      all(saysSomething(6), any('because', 'the risk', 'if we', 'it might', 'we could end up', 'the problem', 'last time')),
      ['Can you be more specific?', 'What’s the worst case?'],
      hint(
        '风险是上线后出问题，用户会流失',
        ['The risk is that', 'if we ship'],
        'The risk is that if we ___, we might ___.',
        'The risk is that if we ship before ___, we could ___.',
        "The risk is that if we ship before the payment flow is tested, we could end up with failed orders over the weekend when no one's on call.",
      ),
    ),
    stage(
      'alt',
      "Hmm. That's fair. So what would you suggest?",
      '提出一个替代方案',
      any('what if', 'how about', 'we could', 'maybe we', 'i suggest', 'instead', 'another option', 'why don t we'),
      ['I’m open to alternatives.', 'What would you do differently?'],
      hint(
        '不如先小范围上线，下周再全量',
        ['What if we', 'a small group', 'then'],
        'What if we ___ first, and then ___?',
        'What if we released it to ___ first, and then ___ next week?',
        "What if we released it to ten percent of users on Friday, and then rolled it out fully on Monday once we've seen the numbers?",
      ),
    ),
  ],
  rubric: ['先认可对方再提异议', '理由具体，有可能的后果', '提出可执行的替代方案而不是只反对'],
};

const phoneHelp: Scenario = {
  id: 'work-askhelp',
  category: 'work',
  title: '请求帮助',
  titleEn: 'Asking a colleague for help',
  setting: '你卡在一个问题上，想找同事帮忙，但对方看起来很忙。',
  role: 'Tom，隔壁组的工程师',
  userRole: '你自己',
  level: 'B1',
  mission: '礼貌开口、说清问题、约定一个时间',
  keyPhrases: [
    { en: 'Do you have a minute?', cn: '你现在方便吗？' },
    { en: "I'm stuck on something and could use your help.", cn: '我卡住了，想请你帮个忙。' },
    { en: 'Would later today work for you?', cn: '今天晚些时候方便吗？' },
  ],
  keywords: ['a minute', 'stuck', 'could use', 'work for you', 'appreciate'],
  stages: [
    stage(
      'open',
      "(Tom is typing, headphones on. He looks up.) Hey — what's up?",
      '礼貌地开口，先问对方方不方便',
      any('do you have', 'are you free', 'is now a good time', 'sorry to bother', 'quick question', 'got a minute', 'a minute', 'busy'),
      ['I’ve got a few minutes before my next call.', 'What do you need?'],
      hint(
        '打扰一下，你现在有空吗？',
        ['Sorry to bother you', 'a minute'],
        'Sorry to bother you — do you have ___?',
        'Sorry to bother you — do you have a ___?',
        'Sorry to bother you — do you have a minute?',
      ),
    ),
    stage(
      'problem',
      'Sure, go ahead.',
      '说清你卡在哪里',
      all(saysSomething(6), any('stuck', 'problem', 'issue', 'can t', 'cannot', 'trying to', 'not working', 'error', 'help')),
      ['What have you tried so far?', 'Which part exactly?'],
      hint(
        '我在做……的时候卡住了，试过……但还是不行',
        ["I'm stuck on", "I've tried", "but it still"],
        "I'm stuck on ___. I've tried ___, but it still ___.",
        "I'm stuck on the ___. I've tried ___, but ___.",
        "I'm stuck on the login redirect. I've tried clearing the session and checking the config, but it still sends users back to the home page.",
      ),
    ),
    stage(
      'time',
      "Ah, I've seen that before. I can't look at it right now though — I'm heading into a meeting.",
      '约一个具体时间',
      any('later', 'after', 'tomorrow', 'this afternoon', 'when', 'what time', 'would', 'does', 'work for you', 'free'),
      ['Ping me whenever.', 'When suits you?'],
      hint(
        '那今天下午方便吗？',
        ['Would', 'this afternoon', 'work for you'],
        'Would ___ work for you?',
        'Would this ___ work for you?',
        'No problem. Would this afternoon work for you? Even fifteen minutes would help.',
      ),
    ),
  ],
  rubric: ['先确认对方方便再说事', '问题描述具体，包含"我试过什么"', '主动约定下一步时间'],
};

const workIntro: Scenario = {
  id: 'work-newteam',
  category: 'work',
  title: '和新同事聊天',
  titleEn: 'Chatting with a new colleague',
  setting: '你调到一个新团队，午饭时和新同事坐在一起。',
  role: 'Maya，新团队的同事',
  userRole: '新成员',
  level: 'A2',
  mission: '介绍自己、问对方、找到一个共同话题',
  keyPhrases: [
    { en: "I just moved over from the design team.", cn: '我刚从设计组调过来。' },
    { en: 'How long have you been on this team?', cn: '你在这个组多久了？' },
    { en: 'Oh, me too!', cn: '我也是！' },
  ],
  keywords: ['just joined', 'moved over', 'how long', 'me too', 'same here'],
  stages: [
    stage(
      'intro',
      "Hey, you're new here, right? I'm Maya.",
      '介绍自己和你的来历',
      any('i m', 'im ', 'i am', 'my name', 'just joined', 'moved', 'started', 'yes', 'yeah'),
      ['Which team did you come from?', 'When did you start?'],
      hint(
        '我是……，上周刚从设计组调过来',
        ["I'm", 'just moved over from'],
        "I'm ___. I just ___ over from the ___ team.",
        "I'm ___. I just moved over from ___ last week.",
        "Hi, I'm Lin. I just moved over from the design team last week.",
      ),
    ),
    stage(
      'askback',
      "Oh nice, welcome! We've been needing someone on that side.",
      '问对方一个问题',
      any('how long', 'what do you', 'and you', 'how about you', 'do you', 'have you', 'what s your'),
      ['…', 'Anyway, let me know if you need anything.'],
      hint(
        '你在这个组多久了？',
        ['How long', 'have you been'],
        'How long ___ you been on this team?',
        'How long have you ___ on this team?',
        "Thanks! How long have you been on this team?",
      ),
    ),
    stage(
      'common',
      "About three years now. I actually started in support and moved into engineering.",
      '接住对方的话，找一个共同点或追问',
      saysSomething(5),
      ['It’s a pretty common path here, actually.'],
      hint(
        '那挺有意思的，转岗难吗？',
        ['That sounds', 'Was it hard to'],
        'That sounds ___. Was it hard to ___?',
        'That sounds interesting. Was it hard to ___?',
        "That sounds interesting — was it hard to make that switch?",
      ),
    ),
  ],
  rubric: ['能说清自己的来历', '主动提问而不是等着被问', '能接住对方的话继续聊'],
};

// ══════════════════════════════════════════════════════════════

export const SCENARIOS: Scenario[] = [
  selfIntro,
  coffee,
  restaurant,
  weekend,
  shopping,
  hotel,
  airport,
  directions,
  taxi,
  workIntro,
  statusUpdate,
  phoneHelp,
  interview,
  disagree,
];

export const SCENARIO_MAP: Record<string, Scenario> = Object.fromEntries(SCENARIOS.map((s) => [s.id, s]));

export const getScenario = (id: string): Scenario | undefined => SCENARIO_MAP[id];

export const byCategory = (c: Scenario['category']): Scenario[] => SCENARIOS.filter((s) => s.category === c);
