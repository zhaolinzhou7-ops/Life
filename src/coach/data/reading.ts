/**
 * 阅读材料
 *
 * 成年人不能只练口语（第 14 节）。但成年人的阅读练习也不该是"读一篇说明文
 * 然后做四道细节题"——那是应试训练，和"能用英语做事"关系不大。
 *
 * 所以这里的短文都是**工作和生活里真的会读到的东西**：邮件、公告、
 * 产品说明、一段带观点的短文。题目也偏向"读懂了没有"和"言外之意"，
 * 而不是"第三段第二行的 it 指代什么"。
 *
 * 全部原创，不抓取任何有版权的内容。
 */

import type { ReadingPiece } from '../types';

export const PIECES: ReadingPiece[] = [
  {
    id: 'rd-email',
    title: '一封改期的邮件',
    level: 'A2',
    paragraphs: [
      'Hi Lin,',
      "Thanks for sending the draft over — it looks good overall. I've left a few comments in the doc, mostly small things.",
      "One thing though: I won't be able to make our call on Thursday after all, something came up on my end. Could we push it to Friday morning instead? I'm free any time before eleven.",
      "Sorry for the short notice. Let me know what works.",
      'Best,\nDavid',
    ],
    questions: [
      {
        prompt: 'What does David mainly want?',
        options: [
          'To cancel the project',
          'To move the meeting to Friday morning',
          'To get a new version of the draft',
          'To meet on Thursday as planned',
        ],
        answer: 1,
        explain: '"Could we push it to Friday morning instead?" 是全信的核心诉求。push it to 是"往后挪"。',
      },
      {
        prompt: 'What does David think of the draft?',
        options: ['It needs a full rewrite', 'It is good overall with small comments', 'He has not read it', 'He dislikes it'],
        answer: 1,
        explain: '"it looks good overall… mostly small things" — overall 是"总体上"，是很常见的缓冲词。',
      },
    ],
    glossary: [
      { word: 'overall', meaning: '总体上' },
      { word: 'something came up', meaning: '临时有事' },
      { word: 'push it to', meaning: '（把时间）往后挪到' },
      { word: 'short notice', meaning: '通知得太晚' },
    ],
  },
  {
    id: 'rd-notice',
    title: '办公楼的一则通知',
    level: 'A2',
    paragraphs: [
      'NOTICE — Lift maintenance',
      'Lifts B and C will be out of service from Monday 14th to Wednesday 16th while annual maintenance is carried out.',
      'Lift A will run as usual, but expect longer waits during peak hours. If you are able, please consider using the stairs for trips of two floors or fewer.',
      'We apologise for the inconvenience and appreciate your patience.',
    ],
    questions: [
      {
        prompt: 'Which lift can you still use?',
        options: ['None of them', 'Lift A only', 'Lifts B and C', 'All of them'],
        answer: 1,
        explain: '"Lift A will run as usual" — B 和 C 停用，A 照常。',
      },
      {
        prompt: 'What are people asked to do?',
        options: [
          'Work from home',
          'Take the stairs for short trips if they can',
          'Arrive earlier than usual',
          'Use lift A only at peak hours',
        ],
        answer: 1,
        explain: '"please consider using the stairs for trips of two floors or fewer" 是一个礼貌的请求，不是硬性规定。',
      },
    ],
    glossary: [
      { word: 'out of service', meaning: '停用、不可用' },
      { word: 'carry out', meaning: '实施、进行' },
      { word: 'peak hours', meaning: '高峰时段' },
      { word: 'inconvenience', meaning: '不便' },
    ],
  },
  {
    id: 'rd-habit',
    title: '为什么"学了很多年还是不会说"',
    level: 'B1',
    paragraphs: [
      "Most adults who say they 'cannot speak English' can actually read it reasonably well. They can follow an email, get through an article, and understand most of a film with subtitles. The gap is not knowledge. It is practice of a very specific kind.",
      "Reading and listening let you take your time. You can go back, re-read, pause. Speaking does not. You have somewhere between one and two seconds to produce something, and if you spend that time translating from your first language, the moment is gone.",
      "The fix is boring but reliable: produce short, imperfect sentences, out loud, often. Not perfect ones. Short ones. The goal at first is not accuracy — it is getting used to starting a sentence before you know how it ends.",
    ],
    questions: [
      {
        prompt: 'According to the text, what is the real gap?',
        options: [
          'Not knowing enough words',
          'Not having practised producing language under time pressure',
          'Not watching enough films',
          'Not knowing grammar rules',
        ],
        answer: 1,
        explain: '"The gap is not knowledge. It is practice of a very specific kind." 后面解释了这种练习是什么：在时间压力下产出。',
      },
      {
        prompt: 'What does the writer suggest doing at first?',
        options: [
          'Memorising more vocabulary',
          'Writing perfect sentences slowly',
          'Saying short, imperfect sentences out loud often',
          'Reading more articles',
        ],
        answer: 2,
        explain: '"produce short, imperfect sentences, out loud, often" —— 注意 imperfect（不完美）是刻意强调的。',
      },
    ],
    glossary: [
      { word: 'reasonably well', meaning: '还算不错' },
      { word: 'get through', meaning: '读完、撑过' },
      { word: 'the moment is gone', meaning: '时机已经过去了' },
      { word: 'get used to', meaning: '习惯于（后接 -ing）' },
    ],
  },
  {
    id: 'rd-review',
    title: '一条产品评价',
    level: 'B2',
    paragraphs: [
      "I'll be honest: I almost returned this thing in the first week. The setup instructions are genuinely bad — three pages of diagrams and not one sentence explaining what you're actually meant to end up with.",
      "That said, once it was running, it more or less did what I needed. Battery life is nowhere near the advertised figure, but it comfortably lasts a working day, which is all I really wanted. Build quality is better than I expected at this price.",
      "Would I buy it again? Probably, but only because the alternatives are worse. If the manual were half decent this would be an easy recommendation instead of a reluctant one.",
    ],
    questions: [
      {
        prompt: "What is the reviewer's overall verdict?",
        options: [
          'Enthusiastic recommendation',
          'A reluctant recommendation, mainly because alternatives are worse',
          'Strongly against buying it',
          'No clear opinion',
        ],
        answer: 1,
        explain:
          '"a reluctant one" 是最后一句的落点。reluctant recommendation 意思是"勉强推荐"。整段都是先抑后扬再收回一点。',
      },
      {
        prompt: 'What does the reviewer say about battery life?',
        options: [
          'It matches the advertisement',
          'It is far below the advertised figure but still enough for a work day',
          'It lasts several days',
          'It is the worst part of the product',
        ],
        answer: 1,
        explain: 'nowhere near = 差得远。但后半句 "comfortably lasts a working day" 又说够用，这种转折是英语评价里的常见结构。',
      },
    ],
    glossary: [
      { word: "I'll be honest", meaning: '说实话' },
      { word: 'that said', meaning: '话虽如此' },
      { word: 'nowhere near', meaning: '远远达不到' },
      { word: 'reluctant', meaning: '勉强的、不情愿的' },
    ],
  },
];

export const PIECE_MAP: Record<string, ReadingPiece> = Object.fromEntries(PIECES.map((p) => [p.id, p]));

export const getPiece = (id: string): ReadingPiece | undefined => PIECE_MAP[id];
