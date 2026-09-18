/**
 * 专项训练目录。
 *
 * 每条练习都要回答四个问题：练什么、怎么做、为什么有用、最容易做错哪里。
 * 只说「多练练高音」是没有用的，所以这里每条都写清楚具体动作。
 *
 * 关于「气息」——必须说在前面：
 * 普通手机录音测不出横膈膜怎么动、肺活量多大、声带闭合如何。
 * 所以本目录里没有任何一条声称在「测气息」。
 * 我们测的是三个**能观测到**的代理指标：长音能撑多久、音量稳不稳、音高飘不飘。
 * 它们和气息支撑相关，但不等于气息本身。界面上也必须这么说。
 */

import type { Finding } from '../analysis/types';

export type ExerciseKind = 'pitch' | 'rhythm' | 'high' | 'stability';

export const KIND_LABEL: Record<ExerciseKind, string> = {
  pitch: '音准',
  rhythm: '节奏',
  high: '高音',
  stability: '稳定性',
};

/** 练习音高的锚点：相对用户音域的哪个位置起音 */
export type Anchor = 'low' | 'mid' | 'high' | 'bridge';

export type ExerciseRun =
  /** 单音模唱：听一个音，唱出来并保持 */
  | { type: 'match'; rel: number[]; holdSec: number; anchor: Anchor }
  /** 音阶 / 模进：一条音型，每轮升/降半音 */
  | { type: 'scale'; pattern: number[]; steps: number; dir: 1 | -1; anchor: Anchor; noteSec: number }
  /** 音程：先听主音再听目标音，唱出目标音 */
  | { type: 'interval'; intervals: number[]; anchor: Anchor; holdSec: number }
  /** 音高跟踪：跟着一条连续移动的线唱 */
  | { type: 'glide'; shape: number[]; sec: number; anchor: Anchor }
  /** 长音：一个音撑住若干秒 */
  | { type: 'sustain'; rel: number; sec: number; reps: number; anchor: Anchor }
  /** 节拍跟随：跟着节拍器在每拍上发一个音 */
  | { type: 'metronome'; bpm: number; beats: number; anchor: Anchor }
  /** 节奏模仿：听一条节奏型再打/唱回来 */
  | { type: 'rhythmEcho'; bpm: number; patterns: number[][]; anchor: Anchor }
  /** 入拍训练：空两拍后准点进入 */
  | { type: 'entry'; bpm: number; reps: number; leadBeats: number; anchor: Anchor };

export interface Exercise {
  id: string;
  name: string;
  kind: ExerciseKind;
  /** 练完能改善什么 */
  goal: string;
  /** 具体怎么做 */
  how: string;
  /** 为什么这样练有用 */
  why: string;
  /** 最容易做错的地方 */
  pitfall: string;
  /** 建议时长（分钟） */
  minutes: number;
  /** 嗓音负担：1 几乎不累，2 一般，3 偏累（高音类） */
  load: 1 | 2 | 3;
  /** 这条练习针对哪些问题 */
  targets: Finding['kind'][];
  run: ExerciseRun;
}

export const EXERCISES: Exercise[] = [
  // ------------------------------------------------------------ 音准
  {
    id: 'match-single',
    name: '单音模唱',
    kind: 'pitch',
    goal: '把「听到的音」和「唱出来的音」对上——这是音准的地基',
    how: '听一个钢琴音，等它放完，再用「啊」把它唱出来，保持 3 秒。屏幕上的横线是目标，你的线落在上面就对了。',
    why: '跑调的人大多不是嗓子不行，是听到的音在脑子里没形成准确的目标。先听后唱、中间留空，是为了逼你在心里先「想」出这个音，而不是跟着声音溜。',
    pitfall: '别跟着伴奏一起唱——那是在模仿，不是在建立音高记忆。一定要等参考音停了再开口。',
    minutes: 4,
    load: 1,
    targets: ['flat', 'sharp', 'miss'],
    run: { type: 'match', rel: [0, 4, 7, 5, 2, 9, 0], holdSec: 3, anchor: 'mid' },
  },
  {
    id: 'scale-major',
    name: '大调音阶',
    kind: 'pitch',
    goal: '把音与音之间的距离唱准，尤其是半音关系',
    how: '跟着琴唱 do-re-mi-fa-sol-la-si-do 上行再下行。每唱完一轮，起始音升高半音。',
    why: '单个音唱准不难，难的是**音和音之间的距离**。音阶里 mi-fa 和 si-do 是半音、其余是全音，唱跑的人通常就是把半音唱成了全音。',
    pitfall: '下行比上行难。很多人下行时会越唱越低（每个音都塌一点，累积下来差半个音），下行时要有意识地「往上托着」。',
    minutes: 5,
    load: 2,
    targets: ['flat', 'sharp'],
    run: { type: 'scale', pattern: [0, 2, 4, 5, 7, 9, 11, 12, 11, 9, 7, 5, 4, 2, 0], steps: 5, dir: 1, anchor: 'low', noteSec: 0.45 },
  },
  {
    id: 'interval-basic',
    name: '音程模唱',
    kind: 'pitch',
    goal: '练跳进——歌里最容易唱错的就是「跳着走」的地方',
    how: '先听主音，再听第二个音，然后把第二个音唱出来。从三度、五度开始，逐渐加入六度和八度。',
    why: '级进（挨着走）靠惯性就能唱对，跳进必须心里先有目标。歌曲里最容易跑的位置几乎都是大跳。',
    pitfall: '大跳时别用「滑上去」的方式找音，那样中间会经过一堆错音。要直接「跳」到位。',
    minutes: 4,
    load: 2,
    targets: ['flat', 'sharp', 'miss'],
    run: { type: 'interval', intervals: [4, 7, 5, 9, 12, 3, 8], anchor: 'mid', holdSec: 2.5 },
  },
  {
    id: 'glide-track',
    name: '音高跟踪',
    kind: 'pitch',
    goal: '练「实时听自己」的能力，边唱边修正',
    how: '屏幕上有一条缓慢移动的线，用「呜」跟着它唱，让你的线始终贴住它。',
    why: '唱歌时的音准修正是实时发生的。这条练习把这个过程放慢、可视化，让你建立「偏了 → 调回来」的肌肉反应。',
    pitfall: '别盯着屏幕硬追，那样会变成手眼协调练习。先听，屏幕只是用来确认。',
    minutes: 3,
    load: 1,
    targets: ['flat', 'sharp', 'unstableLongNote'],
    run: { type: 'glide', shape: [0, 3, 5, 3, 7, 5, 2, 0], sec: 12, anchor: 'mid' },
  },
  {
    id: 'sustain-pitch',
    name: '长音保持',
    kind: 'pitch',
    goal: '一个音唱出去以后能不能稳住',
    how: '唱一个舒服的音，撑满 6 秒，目标是整条线又平又直。',
    why: '很多人起音是准的，唱着唱着就掉下去了。这条练习专门暴露这个问题。',
    pitfall: '不要越唱越响去「撑住」——音量涨上去，音高反而更容易顶高。保持一个平稳的中等音量。',
    minutes: 3,
    load: 1,
    targets: ['unstableLongNote', 'flat'],
    run: { type: 'sustain', rel: 0, sec: 6, reps: 4, anchor: 'mid' },
  },

  // ------------------------------------------------------------ 节奏
  {
    id: 'metro-follow',
    name: '节拍跟随',
    kind: 'rhythm',
    goal: '把「拍子」这件事变成身体反应，而不是数出来的',
    how: '跟着节拍器，在每一拍上用「哒」发一个短音。先 4 拍一组，稳了再加速。',
    why: '节奏不稳的人通常是在「听完这一拍再反应」，所以永远慢半拍。要练到能**预判**下一拍什么时候来。',
    pitfall: '跟着脚打拍子，但别让脚带着嗓子走——脚是节拍器的替身，不是发声的开关。',
    minutes: 3,
    load: 1,
    targets: ['drag', 'rush', 'unsteady'],
    run: { type: 'metronome', bpm: 80, beats: 16, anchor: 'mid' },
  },
  {
    id: 'rhythm-echo',
    name: '节奏模仿',
    kind: 'rhythm',
    goal: '练复杂节奏型的还原能力',
    how: '听一小节节奏（有长有短），空一小节，然后原样唱回来。',
    why: '歌里的节奏很少是整齐的四分音符。这条练习练的是把听到的节奏「记住并复现」。',
    pitfall: '记不住就说明这条太长了，降到 2 拍一组。硬跟着蒙没有意义。',
    minutes: 4,
    load: 1,
    targets: ['unsteady', 'drag', 'rush'],
    run: {
      type: 'rhythmEcho',
      bpm: 84,
      patterns: [
        [1, 1, 1, 1],
        [1, 0.5, 0.5, 1, 1],
        [0.5, 0.5, 1, 0.5, 0.5, 1],
        [1.5, 0.5, 1, 1],
      ],
      anchor: 'mid',
    },
  },
  {
    id: 'entry-timing',
    name: '入拍训练',
    kind: 'rhythm',
    goal: '专治「每句都晚半拍进」',
    how: '节拍器走两小节，第三小节的第一拍准点进入，唱一个音。反复练到不用想就能进对。',
    why: '拖拍最常发生在句子开头——尤其是需要换气的地方。入拍是可以单独练的，练的是「提前准备好」而不是「听到拍子再动」。',
    pitfall: '进之前那一下要提前吸气。等到该唱了才吸，必然晚。',
    minutes: 3,
    load: 1,
    targets: ['drag', 'rush'],
    run: { type: 'entry', bpm: 84, reps: 8, leadBeats: 8, anchor: 'mid' },
  },

  // ------------------------------------------------------------ 高音
  {
    id: 'high-ladder',
    name: '渐进音阶（五度模进）',
    kind: 'high',
    goal: '一层一层往上挪，而不是一步跨到高音',
    how: '唱 do-mi-sol-mi-do 这个短音型，每唱完一轮整体升半音。唱到开始费劲就停，别硬上。',
    why: '高音不是"用力就能唱上去"的。一次升半音，是让发声状态有机会跟着一点点调整；直接去够高音，身体只会用蛮力代偿。',
    pitfall: '感觉要"喊"出来的那一刻就是上限，到此为止。今天的上限不是永远的上限，硬顶反而会让明天更差。',
    minutes: 5,
    load: 3,
    targets: ['highNoteFlat', 'rangeLimit'],
    run: { type: 'scale', pattern: [0, 4, 7, 4, 0], steps: 8, dir: 1, anchor: 'mid', noteSec: 0.4 },
  },
  {
    id: 'high-semitone',
    name: '半音上行',
    kind: 'high',
    goal: '在换声区附近，把每半音都唱扎实',
    how: '从舒适区偏上的音开始，一个半音一个半音往上唱长音，每个音撑 3 秒。',
    why: '大多数人的高音问题集中在一个很窄的区间（换声点附近）。把这个区间拆成半音逐个过，比整体拔高有效得多。',
    pitfall: '这条要用**小音量**做。音量一大就会本能地挤喉咙，练的就变成挤嗓子了。',
    minutes: 4,
    load: 3,
    targets: ['highNoteFlat', 'rangeLimit'],
    run: { type: 'sustain', rel: 0, sec: 3, reps: 8, anchor: 'bridge' },
  },
  {
    id: 'high-stretch',
    name: '小范围音域扩展',
    kind: 'high',
    goal: '每次只往上探一两个半音，慢慢把天花板抬高',
    how: '先在舒适区唱一条八度琶音，稳了以后整体升两个半音再唱一遍，最多往上探三轮。',
    why: '音域是练出来的，但增长是以「半音/周」为单位的，不是一次课就能加五个音。每次只探一点，是为了让进步能累积而不是把嗓子练伤。',
    pitfall: '别拿今天状态最好的一嗓子当成新音域。连续三天都能轻松唱到，才算真的拿下。',
    minutes: 4,
    load: 3,
    targets: ['rangeLimit', 'highNoteFlat'],
    run: { type: 'scale', pattern: [0, 4, 7, 12, 7, 4, 0], steps: 3, dir: 1, anchor: 'mid', noteSec: 0.5 },
  },
  {
    id: 'high-soft',
    name: '轻声高音',
    kind: 'high',
    goal: '用最小的力气唱到高音，把「喊」和「唱」分开',
    how: '用气声偏多的小音量唱 sol-do-sol（八度来回），音量控制在说话的一半。',
    why: '高音唱不上去，往往不是力气不够，而是用力过度：喉位顶上去、声带挤住，反而张不开。先用轻声把「位置」找到，再慢慢加音量，是声乐课上的常规路径。',
    pitfall: '轻声不等于虚着唱。声音要小但要有芯，屏幕上的音高线不该是断断续续的。',
    minutes: 4,
    load: 2,
    targets: ['highNoteFlat', 'rangeLimit'],
    run: { type: 'interval', intervals: [12, 7, 12, 5], anchor: 'mid', holdSec: 2.5 },
  },

  // ------------------------------------------------------------ 稳定性（气息的可观测代理）
  {
    id: 'steady-long',
    name: '长音稳定',
    kind: 'stability',
    goal: '让一个长音从头到尾音高不飘',
    how: '选一个舒服的音，撑 8 秒。屏幕会画出你的音高线，目标是一条直线。',
    why: '音高飘几乎总是支撑不匀造成的。注意：我们测的是**音高的稳定度**，这是可观测的；至于横膈膜怎么用力，录音测不了，也不该由软件下结论。',
    pitfall: '最后两秒最容易塌。快没气时宁可提前收，也别硬挤那一下——挤出来的尾巴既飘又伤嗓。',
    minutes: 4,
    load: 2,
    targets: ['unstableLongNote', 'flat'],
    run: { type: 'sustain', rel: 0, sec: 8, reps: 4, anchor: 'mid' },
  },
  {
    id: 'steady-duration',
    name: '持续时间',
    kind: 'stability',
    goal: '看看一口气能稳定地唱多久（可观测指标，不等于肺活量）',
    how: '吸一口气，用中等音量唱一个音，能唱多久唱多久。软件记录**音高保持稳定**的时长，而不是出声的时长。',
    why: '很多人「唱不动一整句」，其实是后半段已经在漏气硬撑了。只统计稳定段，才反映真实的可用时长。',
    pitfall: '别为了数字好看而憋着。数字是给你看趋势的，不是用来破纪录的。',
    minutes: 3,
    load: 2,
    targets: ['unstableLongNote', 'miss'],
    run: { type: 'sustain', rel: 0, sec: 20, reps: 2, anchor: 'mid' },
  },
  {
    id: 'steady-volume',
    name: '音量稳定',
    kind: 'stability',
    goal: '把音量控制成你想要的样子，而不是声音自己忽大忽小',
    how: '一个音撑 6 秒：前 2 秒小声、中间 2 秒中等、最后 2 秒回到小声，音高全程不变。',
    why: '音量和音高天生耦合——一响就容易顶高，一轻就容易掉。能把两者解耦，唱歌才有强弱可言。',
    pitfall: '加音量时音高会不自觉地往上跑，这正是这条练习要治的。盯着音高线，别让它跟着音量一起动。',
    minutes: 4,
    load: 2,
    targets: ['dynamicsFlat', 'unstableLongNote'],
    run: { type: 'sustain', rel: 0, sec: 6, reps: 4, anchor: 'mid' },
  },
];

export const EXERCISE_BY_ID = new Map(EXERCISES.map((e) => [e.id, e]));

/** 按问题类型挑练习，按相关度排序 */
export function exercisesFor(kind: Finding['kind']): Exercise[] {
  return EXERCISES.filter((e) => e.targets.includes(kind));
}

export function exercisesOfKind(kind: ExerciseKind): Exercise[] {
  return EXERCISES.filter((e) => e.kind === kind);
}
