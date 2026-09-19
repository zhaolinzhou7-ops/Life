/**
 * 老师话术库
 *
 * 为什么要把话术抽出来单独放一层：儿童纠错的措辞是**产品决策**，不是文案润色。
 * 一句 "No, wrong!" 和一句 "Almost! Listen again." 带来的是两种完全不同的孩子——
 * 一种下次不敢开口，一种下次还敢试。所以这些句子必须集中管理、能被测试断言，
 * 而不是散落在各个视图里靠写的时候记得。
 *
 * 三条硬规则（tests/english-ai.test.ts 会逐条断言）：
 *  1. 任何反馈里不出现 "wrong" / "no" / "bad" / "错" 这类否定判词
 *  2. 答错时必须给「下一步怎么做」，不能只说「再试一次」
 *  3. 提示分级：先给音头 → 再给选项 → 最后才给答案。不跳级公布答案
 */

/** 答对时的反馈。随机取，避免每次都是同一句 */
export const PRAISE = [
  'Yes! Great job!',
  'That\'s right!',
  'Wow, you got it!',
  'Perfect!',
  'Yes! Well done!',
  'Super!',
];

/** 接近但不完全对 */
export const ALMOST = [
  'Almost! Listen again.',
  'So close! One more time.',
  'Good try! Listen and say it with me.',
  'Nearly there! Try again with me.',
];

/** 答错时。注意每一句都带下一步动作，不是单纯的「再试试」 */
export const TRY_AGAIN = [
  'Good try! Let\'s listen again.',
  'Nice try! Look at the picture and listen.',
  'Let\'s do it together. Listen.',
  'Hmm, let\'s hear it one more time.',
];

/** 孩子跳过 / 不回答时。不能让沉默变成压力 */
export const ON_SKIP = [
  'That\'s okay! Let\'s try another one.',
  'No problem. Listen to this one.',
  'Let\'s come back to it later.',
];

/** 鼓励开口 */
export const INVITE_SPEAK = [
  'Your turn! Say it.',
  'Now you say it.',
  'Can you say it with me?',
  'Let\'s say it together.',
];

/** 活动之间的过渡语，让流程有人在陪的感觉 */
export const TRANSITION = [
  'Nice! Let\'s go on.',
  'Great! Next one.',
  'You are doing well. Keep going!',
  'Awesome! Here comes the next one.',
];

/** 一次学习结束 */
export const FINISH = [
  'You did it! See you tomorrow!',
  'Great work today! Bye bye!',
  'You learned a lot today! See you!',
];

/**
 * 分级提示。
 *
 * level 1：只给第一个音，"It's b..."
 * level 2：给音节数或首字母 + 选项范围
 * level 3：给答案，但要求孩子跟读一次，避免「看到答案就过」
 */
export function hintFor(answer: string, level: 1 | 2 | 3): string {
  const w = answer.trim();
  if (!w) return 'Listen again.';
  if (level === 1) {
    const head = w.slice(0, 1);
    return `It's ${head}...`;
  }
  if (level === 2) {
    const head = w.length > 3 ? w.slice(0, 2) : w.slice(0, 1);
    return `It starts with "${head}". Listen: ${w}`;
  }
  return `It's "${w}". Say it with me: ${w}.`;
}

/** 从数组里按种子取一句，保证同一次渲染稳定、跨次有变化 */
export function pick(list: string[], seed: number): string {
  if (!list.length) return '';
  const i = Math.abs(Math.floor(seed)) % list.length;
  return list[i];
}

/**
 * 中文辅助说明。
 *
 * 儿童端正文尽量不出现中文（§3：不要让孩子长时间阅读说明文字），
 * 但有些操作提示必须让孩子看懂，所以这里保留极少量、极短的中文，
 * 且永远配着图标和语音一起出现。
 */
export const ZH = {
  tapWhatYouHear: '点你听到的那个',
  tapToHear: '点一下听声音',
  // 交互是点一下就开始录，不是按住。写成"按住说话"会让孩子一直按着，
  // 松手时录音早就结束了，然后他以为是自己说错了。
  sayIt: '点麦克风，然后说',
  tapWhenDone: '说完了点这里',
  micDenied: '没有麦克风也能学：点「我说啦」继续',
  listenFirst: '先听一遍',
};
