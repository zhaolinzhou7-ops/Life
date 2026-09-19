/**
 * 听力材料
 *
 * 全部是为这个产品写的原创文本，**不抓取任何有版权的音频或文稿**（第 13 节）。
 * 播放靠浏览器自带的语音合成（speechSynthesis），所以：
 *   · 不需要音频文件，打包体积不变
 *   · 语速可以真的调（slow / normal / fast 是传给合成器的真实参数）
 *   · 代价是合成音不等于真人录音，界面上要如实说明这一点
 *
 * 内容偏向成年人真实会听到的东西：语音留言、同事闲聊、会议片段、播客独白。
 * 刻意保留了口语里的 filler（yeah、I mean、you know），因为"听得懂教材、
 * 听不懂真人"的根源就是教材把这些都删干净了。
 */

import type { ListeningClip } from '../types';

export const CLIPS: ListeningClip[] = [
  {
    id: 'cl-voicemail',
    title: '一条语音留言',
    category: 'daily',
    level: 'A2',
    lines: [
      {
        speaker: 'Voicemail',
        text: "Hi, this is Daniel from Greenfield Dental. I'm calling about your appointment next Tuesday at three. Unfortunately the doctor has to reschedule, so we've moved you to Wednesday at four thirty. If that doesn't work for you, just give us a call back. Thanks!",
        cn: '你好，我是 Greenfield 牙科的 Daniel。关于你下周二三点的预约——医生临时有事要改期，我们把你调到了周三四点半。如果这个时间不合适，回电话给我们就行。谢谢！',
      },
    ],
    questions: [
      {
        prompt: 'What happened to the appointment?',
        options: ['It was cancelled', 'It was moved to Wednesday', 'It was moved one hour earlier', 'Nothing changed'],
        answer: 1,
      },
      {
        prompt: 'What should you do if the new time does not work?',
        options: ['Come anyway', 'Call them back', 'Send an email', 'Wait for another call'],
        answer: 1,
      },
    ],
    focusWords: ['appointment', 'reschedule', "doesn't work"],
  },
  {
    id: 'cl-coffee',
    title: '同事在茶水间闲聊',
    category: 'daily',
    level: 'A2',
    lines: [
      { speaker: 'Ben', text: "Morning. You look like you need that coffee.", cn: '早。你这样子是真需要那杯咖啡。' },
      { speaker: 'You', text: "Yeah, I barely slept. My neighbour was moving furniture at midnight.", cn: '是啊，我几乎没睡。我邻居半夜在搬家具。' },
      { speaker: 'Ben', text: "Seriously? That's rough. Did you say anything to them?", cn: '真的假的？那挺难受的。你跟他们说了吗？' },
      { speaker: 'You', text: "Not yet. I'll probably mention it if it happens again.", cn: '还没。要是再有一次我可能会说一下。' },
    ],
    questions: [
      {
        prompt: 'Why is the speaker tired?',
        options: ['They worked late', 'Their neighbour was noisy at night', 'They have a new baby', 'They drank too much coffee'],
        answer: 1,
      },
      {
        prompt: 'Have they talked to the neighbour?',
        options: ['Yes, this morning', 'Yes, last night', 'No, not yet', 'No, they moved out'],
        answer: 2,
      },
    ],
    focusWords: ['barely', "that's rough", 'mention'],
  },
  {
    id: 'cl-standup',
    title: '早会上的一段汇报',
    category: 'work',
    level: 'B1',
    lines: [
      {
        speaker: 'Priya',
        text: "Okay, quick update from my side. The good news is the design is signed off. The not-so-good news is we're still waiting on the API from the platform team, so end-to-end testing hasn't started yet. Realistically I'd say we're looking at another week. I'll chase them again today.",
        cn: '好，我这边简单说一下。好消息是设计已经确认了。不太好的消息是我们还在等平台组的接口，所以端到端测试还没开始。实际估计还得再要一周。我今天会再去催他们。',
      },
    ],
    questions: [
      {
        prompt: 'What is finished?',
        options: ['The testing', 'The API', 'The design', 'The whole project'],
        answer: 2,
      },
      {
        prompt: 'What does "I\'ll chase them" mean here?',
        options: ['She will run after them', 'She will follow up with them', 'She will replace them', 'She will complain to the boss'],
        answer: 1,
      },
    ],
    focusWords: ['signed off', 'waiting on', 'chase', 'realistically'],
  },
  {
    id: 'cl-checkin',
    title: '酒店前台对话',
    category: 'travel',
    level: 'A2',
    lines: [
      { speaker: 'Front desk', text: "Good evening. Checking in?", cn: '晚上好，是办入住吗？' },
      { speaker: 'Guest', text: "Yes, I have a reservation under Chen.", cn: '是的，有一个姓陈的预订。' },
      { speaker: 'Front desk', text: "Let me see… Chen, two nights, a king room. Could I see your passport?", cn: '我看一下……陈，两晚，大床房。能看一下您的护照吗？' },
      { speaker: 'Guest', text: "Here you are. Is breakfast included?", cn: '给您。含早餐吗？' },
      { speaker: 'Front desk', text: "It is, from six thirty to ten, on the second floor.", cn: '含的，六点半到十点，在二楼。' },
    ],
    questions: [
      {
        prompt: 'How many nights is the guest staying?',
        options: ['One', 'Two', 'Three', 'It is not mentioned'],
        answer: 1,
      },
      {
        prompt: 'When does breakfast end?',
        options: ['At six thirty', 'At nine', 'At ten', 'At ten thirty'],
        answer: 2,
      },
    ],
    focusWords: ['reservation', 'included', 'Here you are'],
  },
  {
    id: 'cl-airport',
    title: '机场广播',
    category: 'travel',
    level: 'B1',
    lines: [
      {
        speaker: 'Announcement',
        text: "Attention passengers on flight BA two seven one to London. Due to a late incoming aircraft, boarding will now begin at seven forty-five from gate C twelve, instead of gate C four. We apologise for the delay and thank you for your patience.",
        cn: '飞往伦敦的 BA271 航班旅客请注意。由于飞机晚到，登机时间推迟到七点四十五，登机口由 C4 改为 C12。对于延误我们深表歉意，感谢您的耐心等待。',
      },
    ],
    questions: [
      {
        prompt: 'What has changed?',
        options: [
          'Only the boarding time',
          'Only the gate',
          'Both the boarding time and the gate',
          'The destination',
        ],
        answer: 2,
      },
      {
        prompt: 'Why is there a delay?',
        options: ['Bad weather', 'The plane arrived late', 'A crew problem', 'A security issue'],
        answer: 1,
      },
    ],
    focusWords: ['due to', 'boarding', 'instead of', 'apologise'],
  },
  {
    id: 'cl-pushback',
    title: '会议上的分歧',
    category: 'work',
    level: 'B2',
    lines: [
      { speaker: 'Marco', text: "Honestly, I think we should just ship it Friday and clean up afterwards.", cn: '说实话，我觉得我们周五直接上线，之后再收拾。' },
      {
        speaker: 'Lena',
        text: "I get where you're coming from, and I do want this out the door. But if something breaks Saturday morning, nobody's on call. I'd rather lose two days than spend the weekend firefighting.",
        cn: '我理解你的想法，我也希望尽快上线。但如果周六早上出问题，没人值班。我宁愿损失两天，也不想整个周末都在救火。',
      },
      { speaker: 'Marco', text: "Fair enough. What if we do a limited rollout instead?", cn: '有道理。那我们做个小范围灰度上线怎么样？' },
    ],
    questions: [
      {
        prompt: "What is Lena's main worry?",
        options: [
          'The feature is not good enough',
          'There will be nobody available if it breaks at the weekend',
          'Marco is working too hard',
          'The rollout will cost too much money',
        ],
        answer: 1,
      },
      {
        prompt: 'How does Marco react at the end?',
        options: ['He gets angry', 'He accepts her point and suggests a compromise', 'He ignores her', 'He repeats his original plan'],
        answer: 1,
      },
    ],
    focusWords: ["I get where you're coming from", 'on call', 'firefighting', 'Fair enough', 'rollout'],
  },
  {
    id: 'cl-podcast',
    title: '播客片段：为什么成年人学得慢',
    category: 'story',
    level: 'B2',
    lines: [
      {
        speaker: 'Host',
        text: "So people often ask me, why is it harder as an adult? And the honest answer is, it usually isn't your memory. It's your standards. A five-year-old will happily say a broken sentence forty times a day. An adult would rather say nothing than say something wrong. And that instinct, which serves you well everywhere else, is exactly what slows you down here.",
        cn: '经常有人问我，为什么成年之后学得更难？老实说，问题一般不在记忆力，而在你的标准。五岁小孩一天可以高高兴兴地说四十遍破句子。成年人宁可不说，也不愿说错。而这种在别的地方都对你有好处的本能，恰恰是在这里拖慢你的东西。',
      },
    ],
    questions: [
      {
        prompt: 'According to the speaker, what mainly slows adults down?',
        options: ['A weaker memory', 'Less free time', 'Being unwilling to make mistakes', 'Bad teachers'],
        answer: 2,
      },
      {
        prompt: 'What does the speaker say about that instinct?',
        options: [
          'It is useless everywhere',
          'It helps in other areas of life but hurts here',
          'It only affects children',
          'It disappears with age',
        ],
        answer: 1,
      },
    ],
    focusWords: ['standards', 'would rather', 'instinct', 'serves you well'],
  },
  {
    id: 'cl-news',
    title: '一则短新闻',
    category: 'news',
    level: 'B1',
    lines: [
      {
        speaker: 'Reporter',
        text: "City officials announced today that the new bus line will open three months earlier than planned. The route connects the eastern suburbs to the main station and is expected to cut the average commute by about twenty minutes. Fares will stay the same for the first year.",
        cn: '市政府今天宣布，新的公交线路将比原计划提前三个月开通。该线路连接东部郊区和火车总站，预计可将平均通勤时间缩短约二十分钟。第一年票价维持不变。',
      },
    ],
    questions: [
      {
        prompt: 'What is the news about?',
        options: [
          'A bus line opening earlier than planned',
          'A bus line being cancelled',
          'Higher ticket prices',
          'A new train station',
        ],
        answer: 0,
      },
      {
        prompt: 'What will happen to fares in the first year?',
        options: ['They will rise', 'They will fall', 'They will stay the same', 'They are not mentioned'],
        answer: 2,
      },
    ],
    focusWords: ['announced', 'route', 'commute', 'fares'],
  },
];

export const CLIP_MAP: Record<string, ListeningClip> = Object.fromEntries(CLIPS.map((c) => [c.id, c]));

export const getClip = (id: string): ListeningClip | undefined => CLIP_MAP[id];

/** 语速档位 → 传给 speechSynthesis 的真实倍率 */
export const SPEED_RATE: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 0.72,
  normal: 0.95,
  fast: 1.18,
};

export const SPEED_LABEL: Record<'slow' | 'normal' | 'fast', string> = {
  slow: '慢速',
  normal: '正常',
  fast: '快速',
};
