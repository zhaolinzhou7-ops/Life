/**
 * 高音训练营 · 练习库与课程表
 *
 * 全部是国际声乐教学里通用的练声曲(vocalise)，按"先省力、再找头声、
 * 再打通换声点、最后混声高音"的顺序编排。指导语一律说人话，不用术语。
 *
 * 音型用相对起始音的半音数表示，训练时会逐半音向上模进。
 */

export type ExKind =
  | 'scale' // 离散音阶/琶音，逐个音跟唱
  | 'glide' // 连续滑音（警笛），跟着曲线滑
  | 'hold' // 长音保持
  | 'staccato'; // 断音跳跃

export interface Exercise {
  id: string;
  name: string;
  emoji: string;
  stage: 1 | 2 | 3 | 4;
  kind: ExKind;
  /** 音型：相对起始音的半音数 */
  pattern: number[];
  /** 每个音的拍数，缺省为全 1 拍 */
  beats?: number[];
  /** 滑音参数：从相对半音 from 滑到 to，各占几秒 */
  glide?: { from: number; to: number; upSec: number; downSec: number };
  /** 长音保持秒数 */
  holdSec?: number;
  bpm: number;
  /** 唱什么音 */
  sound: string;
  /** 怎么做（口语化，一步到位） */
  how: string;
  /** 为什么有用（一句话，给信心） */
  why: string;
  /** 最容易做错的地方 */
  watch: string;
  /** 起始音相对"你的舒适低音"的偏移半音 */
  startOffset: number;
  /** 最多向上模进几组 */
  rounds: number;
  /** true = 半闭合类练习，几乎不伤嗓，可以放心冲高 */
  safe: boolean;
  /** true = 无固定音高（如嘶音），按「有没有在持续发声」判定，不判音准 */
  unpitched?: boolean;
}

// —— 常用音型 ——
const FIVE_UP_DOWN = [0, 2, 4, 5, 7, 5, 4, 2, 0]; // 1-2-3-4-5-4-3-2-1
const FIVE_DOWN = [7, 5, 4, 2, 0]; // 5-4-3-2-1
const OCTAVE_ARP = [0, 4, 7, 12, 7, 4, 0]; // 1-3-5-8-5-3-1
const ARP_15 = [0, 4, 7, 12, 16, 19, 16, 12, 7, 4, 0]; // 一个半八度琶音
const THIRD = [0, 2, 4, 2, 0]; // 1-2-3-2-1
const OCT_JUMP = [0, 12, 0]; // 1-8-1
const NINTH = [0, 2, 4, 5, 7, 9, 11, 12, 14, 12, 11, 9, 7, 5, 4, 2, 0];
const YODEL = [0, 7, 0, 7, 0]; // 真假声来回翻

export const EXERCISES: Exercise[] = [
  // ============ 阶段一：先学会「不费嗓」地发声 ============
  {
    id: 'lip-five',
    name: '嘟嘴五度',
    emoji: '🤐',
    stage: 1,
    kind: 'scale',
    pattern: FIVE_UP_DOWN,
    bpm: 108,
    sound: '嘟噜噜噜（嘴唇打颤）',
    how: '双唇轻轻闭上放松，像小孩学摩托车"嘟——"地吹气让嘴唇自己颤起来。颤起来之后再带上音高，跟着琴走。嘴唇颤不起来就用两根手指轻轻托住嘴角两边。',
    why: '嘴唇挡住一半气流，声带就不用死扛，是全世界声乐老师第一个教的省力发声法。用它冲高音，喉咙几乎不会累。',
    watch: '别为了颤而用力吹气。气要细、要匀，颤动应该是轻松自然的。',
    startOffset: 0,
    rounds: 14,
    safe: true,
  },
  {
    id: 'lip-arp',
    name: '嘟嘴八度琶音',
    emoji: '🤐',
    stage: 1,
    kind: 'scale',
    pattern: OCTAVE_ARP,
    bpm: 116,
    sound: '嘟噜噜噜',
    how: '还是嘟嘴，但这次音跳得更开（1-3-5-高音1-5-3-1）。跳到最高那个音时，想象是"飘上去"而不是"顶上去"。',
    why: '八度跳跃能把高音区提前叫醒，而嘟嘴保证你不会用蛮力。',
    watch: '跳到高音时下巴别往前伸、脖子别绷紧，肩膀保持塌下来。',
    startOffset: 0,
    rounds: 14,
    safe: true,
  },
  {
    id: 'tongue-five',
    name: '弹舌五度',
    emoji: '👅',
    stage: 1,
    kind: 'scale',
    pattern: FIVE_UP_DOWN,
    bpm: 108,
    sound: '嘞嘞嘞（弹舌 rrrr）',
    how: '舌尖轻抵上齿龈，送气让舌尖弹起来"rrrr"，像西班牙语的大舌音。弹不出来就先练气流，或者直接跳过用嘟嘴代替。',
    why: '和嘟嘴一个原理，但更能放松舌根——舌根紧是高音卡住的头号元凶。',
    watch: '弹不出来别硬憋，憋反而更紧。做不了就换嘟嘴。',
    startOffset: 0,
    rounds: 12,
    safe: true,
  },
  {
    id: 'hum-five',
    name: '哼鸣五度',
    emoji: '🎵',
    stage: 1,
    kind: 'scale',
    pattern: FIVE_UP_DOWN,
    bpm: 100,
    sound: '嗯——（闭嘴哼）',
    how: '嘴巴闭上、牙齿微微分开、舌头放平，用鼻子哼出声。手指按在鼻梁两侧，感觉到麻麻的振动就对了。',
    why: '哼鸣把声音送到面部，找到这个"麻麻的位置"，高音就有了着力点，不用嗓子使劲。',
    watch: '哼的时候喉咙应该是松的。如果喉咙发紧发痒，说明音起太高了，降回去。',
    startOffset: 0,
    rounds: 12,
    safe: true,
  },
  {
    id: 'breath-hiss',
    name: '嘶音控气',
    emoji: '💨',
    stage: 1,
    kind: 'hold',
    pattern: [0],
    holdSec: 20,
    bpm: 60,
    sound: 'ssss（像轮胎漏气）',
    how: '手放在肚子上，鼻子吸气 4 秒让肚子鼓起来，然后细细地"ssss"往外漏气，越久越好，全程肚子慢慢收。目标先做到 20 秒。',
    why: '高音需要的是稳定的气，不是大力的气。气稳了，嗓子就不用替气使劲。',
    watch: '别耸肩吸气。吸气时肩膀不动、肚子鼓，这才是对的。',
    startOffset: 0,
    rounds: 3,
    safe: true,
    unpitched: true,
  },
  {
    id: 'straw',
    name: '吸管发声',
    emoji: '🥤',
    stage: 1,
    kind: 'glide',
    pattern: [0],
    glide: { from: 0, to: 14, upSec: 3, downSec: 3 },
    bpm: 60,
    sound: '呜——（含着吸管哼）',
    how: '找一根普通的塑料吸管（奶茶粗吸管更省力），含在嘴里、嘴唇包紧不漏气，然后哼着往里发声，跟着屏幕的线上下滑。没有吸管就用嘟嘴代替。',
    why: '这是国际上公认最有效的护嗓练习，声乐医生用它给唱哑的歌手做康复。吸管把气压反推回声带，声带几乎不用自己使劲，唱多高都不累。',
    watch: '嘴唇要包紧吸管别漏气。腮帮子会有点鼓，是正常的。',
    startOffset: 0,
    rounds: 10,
    safe: true,
  },
  {
    id: 'yawn-sigh',
    name: '打哈欠叹气',
    emoji: '🥱',
    stage: 1,
    kind: 'glide',
    pattern: [0],
    glide: { from: 16, to: 0, upSec: 3.5, downSec: 0.5 },
    bpm: 60,
    sound: '啊——（像刚睡醒那声长叹）',
    how: '真的打一个哈欠（装的也行），在哈欠最舒服的那一刻发出声，从高往低一路叹下来，像"唉——"。全程别控制，就是放松地掉下来。',
    why: '打哈欠时你的喉咙是天然打开、喉结自然下沉的——这正是唱高音需要的状态。用它开场，能让身体先记住"松"是什么感觉。',
    watch: '叹下来时别刹车、别修饰。越随便越对。',
    startOffset: 0,
    rounds: 5,
    safe: true,
  },

  // ============ 阶段二：找到那个「轻飘飘的高音」 ============
  {
    id: 'siren-up',
    name: '警笛滑音',
    emoji: '🚨',
    stage: 2,
    kind: 'glide',
    pattern: [0],
    glide: { from: 0, to: 19, upSec: 3, downSec: 3 },
    bpm: 60,
    sound: '呜——（像救护车）',
    how: '用"呜"，从你最舒服的低音一路平滑地滑到很高再滑回来，像救护车的警笛。高的地方声音变虚变细完全没关系，就是要那个虚的。',
    why: '这是找"头声"最快的办法。你现在的高音费嗓，就是因为一直在用低音那套硬顶；头声是另一套，轻得像假的，但它才是真高音的原料。',
    watch: '中间会有一个"卡壳"的坎，声音突然变虚或者破掉——很正常，别停，滑过去。',
    startOffset: 0,
    rounds: 8,
    safe: true,
  },
  {
    id: 'puppy-whine',
    name: '小狗哼唧',
    emoji: '🐶',
    stage: 2,
    kind: 'glide',
    pattern: [0],
    glide: { from: 12, to: 24, upSec: 2, downSec: 2 },
    bpm: 60,
    sound: '嗯~嗯~（小狗撒娇那种）',
    how: '学小狗想出门时那种细细的哼唧声，或者学小婴儿的"咦~"。声音很小、很尖、很轻松，在很高的位置晃来晃去。',
    why: '这个声音天然就是头声，而且没人会用蛮力去哼唧。做几次你就知道"轻松的高音"是什么感觉了。',
    watch: '音量一定要小。这个练习越轻越有效，大声就没意义了。',
    startOffset: 0,
    rounds: 6,
    safe: true,
  },
  {
    id: 'oo-down',
    name: '呜音下行',
    emoji: '🌙',
    stage: 2,
    kind: 'scale',
    pattern: FIVE_DOWN,
    bpm: 92,
    sound: '呜——（嘴唇撮圆）',
    how: '嘴唇撮成小圆，从高往低唱 5-4-3-2-1。从高音开始起，这样一开口就是头声，不容易用错力气。',
    why: '从上往下唱，是把高音的轻松感"带下来"；很多人反过来从下往上唱，就把低音的蛮力"带上去"了。',
    watch: '往下唱时不要越唱越用力、越唱越响。保持一样的轻。',
    startOffset: 5,
    rounds: 12,
    safe: false,
  },
  {
    id: 'hoo-owl',
    name: '猫头鹰',
    emoji: '🦉',
    stage: 2,
    kind: 'scale',
    pattern: THIRD,
    bpm: 80,
    sound: 'hoo~（猫头鹰叫）',
    how: '学猫头鹰"hoo~ hoo~"，声音圆圆的、空空的、有点像在山洞里。想象嘴里含着一个鸡蛋，喉咙里空间很大。',
    why: '这个"空"的感觉就是喉头放松、喉咙打开，高音需要的空间就是这么来的。',
    watch: '喉结应该是往下沉或者不动的。如果一唱高音喉结就往上跑，说明在挤——降低音高重来。',
    startOffset: 3,
    rounds: 10,
    safe: false,
  },

  // ============ 阶段三：打通中间那道「坎」 ============
  {
    id: 'mee-five',
    name: '咪音五度',
    emoji: '😁',
    stage: 3,
    kind: 'scale',
    pattern: FIVE_UP_DOWN,
    bpm: 104,
    sound: '咪——（mee）',
    how: '发"咪"，嘴角微微向两边，但别咧太开。跟着音阶上下，上行时想象声音是往前、往眉心走，而不是往上顶。',
    why: '"咪"这个音天生就容易带你进头声，是打通换声点最经典的元音。',
    watch: '上到最高两个音时最容易突然加力。那一瞬间反而要"松一点、小一点"。',
    startOffset: 0,
    rounds: 14,
    safe: false,
  },
  {
    id: 'goo-arp',
    name: '咕音琶音',
    emoji: '👻',
    stage: 3,
    kind: 'scale',
    pattern: OCTAVE_ARP,
    bpm: 112,
    sound: '咕——（goo）',
    how: '"咕"，嘴唇撮圆、舌头放松。八度琶音上下行。"g"这个音头能帮你把声带轻轻合上，不漏气也不挤。',
    why: '这是打通换声点的黄金练习，几乎所有流行唱法老师都在用。撮圆的嘴唇会自动帮你降喉位。',
    watch: '跳到高八度那个音，不要"够"上去。想象它就在原地，你只是换了个位置发声。',
    startOffset: 0,
    rounds: 14,
    safe: false,
  },
  {
    id: 'mum-third',
    name: '妈音三度',
    emoji: '👄',
    stage: 3,
    kind: 'scale',
    pattern: THIRD,
    bpm: 96,
    sound: '妈——（mum）',
    how: '"m"起头带一点哼鸣的振动，然后打开成"啊"再收回"m"。三度小范围来回，重点是找那个振动感。',
    why: '把哼鸣的省力感觉带进真正的元音里，这是从"练习"过渡到"唱歌"的桥。',
    watch: '张嘴唱"啊"的瞬间最容易漏掉振动感。张嘴前后应该是同一个位置。',
    startOffset: 0,
    rounds: 12,
    safe: false,
  },
  {
    id: 'yodel',
    name: '真假声翻转',
    emoji: '🏔️',
    stage: 3,
    kind: 'scale',
    pattern: YODEL,
    beats: [1, 1, 1, 1, 2],
    bpm: 88,
    sound: '喔——咦——喔——咦（低真声↔高假声）',
    how: '低音用正常说话的声音"喔"，高音故意用假声"咦"，来回翻，翻得越干脆越好，像瑞士约德尔唱法。',
    why: '故意在两种声音之间来回，能让身体记住切换的位置。练熟了，这个坎会越来越平滑，最后就"混"起来了。',
    watch: '一开始破音很明显，这是对的、是练习的目的。练一阵子后自然会变顺。',
    startOffset: 0,
    rounds: 10,
    safe: false,
  },
  {
    id: 'ney-five',
    name: '呢音五度',
    emoji: '😾',
    stage: 3,
    kind: 'scale',
    pattern: FIVE_UP_DOWN,
    bpm: 108,
    sound: '奈——（nay，有点欠揍的鼻音）',
    how: '发"nay"，带一点点像小孩故意惹人烦的那种鼻音、甚至有点巫婆笑的感觉。听着难听没关系，这是练习不是表演。',
    why: '这个"贼"的音色能自动把声带调整到高音需要的状态，是快速找到混声最有效的偏方之一。',
    watch: '难听是正常的。但如果喉咙痛就是做错了——应该是鼻子附近使劲，不是喉咙。',
    startOffset: 0,
    rounds: 12,
    safe: false,
  },

  // ============ 阶段四：混声高音，唱歌里能用 ============
  {
    id: 'goo-15',
    name: '咕音一个半八度',
    emoji: '🚀',
    stage: 4,
    kind: 'scale',
    pattern: ARP_15,
    bpm: 120,
    sound: '咕——（goo）',
    how: '还是"咕"，但音域拉到一个半八度。上行时越高越要"收"，想象声音变细变尖但不变大。',
    why: '这是真正的高音扩展练习。能轻松唱完这条，流行歌里的高音基本都够用了。',
    watch: '到顶点那两个音如果开始喊，立刻停，退回低两个半音重来。宁可少练不要练坏。',
    startOffset: 0,
    rounds: 12,
    safe: false,
  },
  {
    id: 'oct-jump',
    name: '八度跳跃',
    emoji: '⛰️',
    stage: 4,
    kind: 'scale',
    pattern: OCT_JUMP,
    beats: [1, 2, 1],
    bpm: 84,
    sound: '啊——（ah）',
    how: '低音"啊"，直接跳一个八度到高音"啊"，停住 2 拍，再回来。跳的瞬间不要预备、不要用力，就像开关一样直接切。',
    why: '训练在没有铺垫的情况下直接抓住高音——唱歌时高音往往就是这样突然来的。',
    watch: '跳上去之前深吸一口气但别憋着。憋气再冲＝喊。',
    startOffset: 0,
    rounds: 10,
    safe: false,
  },
  {
    id: 'staccato-ha',
    name: '断音哈哈',
    emoji: '😆',
    stage: 4,
    kind: 'staccato',
    pattern: [0, 4, 7, 12, 7, 4, 0],
    beats: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    bpm: 120,
    sound: '哈！哈！哈！（短促）',
    how: '每个音都短促地"哈"一下，手放在肚子上，每"哈"一下肚子应该弹一下。像被戳了痒痒肉那样笑出来。',
    why: '用肚子发力代替嗓子发力。找到这个感觉，高音就有了"底座"，不用嗓子硬撑。',
    watch: '嗓子应该是完全放松的，只有肚子在动。如果喉咙跟着一顿一顿，说明还在用嗓子。',
    startOffset: 0,
    rounds: 10,
    safe: false,
  },
  {
    id: 'nine-scale',
    name: '九度大音阶',
    emoji: '🎹',
    stage: 4,
    kind: 'scale',
    pattern: NINTH,
    bpm: 132,
    sound: '咪——或 啊——',
    how: '一口气唱完九个音上去再下来。速度较快，重点是全程保持同一个松弛度，不要唱到高处就变紧。',
    why: '综合检验：气息、换声、耐力一起考。能顺下来说明前面三个阶段真的练到位了。',
    watch: '一口气不够就中间偷偷换气，不要憋到最后硬挤。',
    startOffset: 0,
    rounds: 10,
    safe: false,
  },
  {
    id: 'swell',
    name: '强弱控制长音',
    emoji: '🌊',
    stage: 4,
    kind: 'hold',
    pattern: [7],
    holdSec: 8,
    bpm: 60,
    sound: '啊——（由小变大再变小）',
    how: '在一个较高的音上，从很轻开始，慢慢变响，再慢慢变轻，全程音高不能晃。',
    why: '这是高音真正"能用"的标志——不光唱得上去，还能控制大小。唱歌的感情全在这上面。',
    watch: '变响时最容易升调、变轻时最容易掉调。盯住屏幕上的音高线别让它跑。',
    startOffset: 7,
    rounds: 8,
    safe: false,
  },
];

export const byId = (id: string) => EXERCISES.find((e) => e.id === id)!;

// ============ 30 天课程表 ============

export interface DayPlan {
  day: number;
  stage: 1 | 2 | 3 | 4;
  title: string;
  goal: string;
  exercises: string[];
}

export const STAGES = [
  { n: 1, name: '省力发声', desc: '先学会不费嗓子地出声，把"喊"的习惯改掉', emoji: '🌱' },
  { n: 2, name: '找到头声', desc: '找到那个轻飘飘的高音——它才是真高音的原料', emoji: '🪶' },
  { n: 3, name: '打通换声', desc: '把低音和高音之间那道坎磨平，不再破音', emoji: '🌉' },
  { n: 4, name: '混声高音', desc: '高音变得结实好听，唱歌里真能用上', emoji: '🔥' },
] as const;

/** 30 天计划：每天 3~4 条，10~15 分钟 */
export const PLAN: DayPlan[] = [
  // 阶段一 · 省力发声（1-7）
  { day: 1, stage: 1, title: '认识"不费嗓"', goal: '第一次体会到出声可以完全不累', exercises: ['yawn-sigh', 'breath-hiss', 'lip-five'] },
  { day: 2, stage: 1, title: '嘴唇颤起来', goal: '嘟嘴能连续颤 5 秒不断', exercises: ['breath-hiss', 'lip-five', 'lip-arp'] },
  { day: 3, stage: 1, title: '找面部振动', goal: '哼鸣时鼻梁明显发麻', exercises: ['yawn-sigh', 'hum-five', 'tongue-five'] },
  { day: 4, stage: 1, title: '气要稳', goal: '嘶音撑到 20 秒', exercises: ['breath-hiss', 'straw', 'hum-five'] },
  { day: 5, stage: 1, title: '带着颤音冲高', goal: '嘟嘴能比平时唱得高 3 个音', exercises: ['lip-five', 'lip-arp', 'straw'] },
  { day: 6, stage: 1, title: '放松舌根', goal: '弹舌或嘟嘴时舌头不再硬邦邦', exercises: ['yawn-sigh', 'tongue-five', 'lip-arp'] },
  { day: 7, stage: 1, title: '阶段小结', goal: '整套热身连做不觉得累', exercises: ['breath-hiss', 'lip-five', 'straw', 'lip-arp'] },
  // 阶段二 · 找到头声（8-14）
  { day: 8, stage: 2, title: '第一次警笛', goal: '滑上去时听到声音变虚——那就是头声', exercises: ['lip-five', 'siren-up', 'puppy-whine'] },
  { day: 9, stage: 2, title: '越轻越高', goal: '哼唧声轻到几乎没音量', exercises: ['hum-five', 'puppy-whine', 'siren-up'] },
  { day: 10, stage: 2, title: '从上往下带', goal: '呜音下行不越唱越用力', exercises: ['lip-arp', 'oo-down', 'siren-up'] },
  { day: 11, stage: 2, title: '打开喉咙', goal: '猫头鹰音有"山洞"般的空', exercises: ['hum-five', 'hoo-owl', 'oo-down'] },
  { day: 12, stage: 2, title: '喉结别上跑', goal: '唱高音时摸着喉结基本不动', exercises: ['lip-five', 'hoo-owl', 'siren-up'] },
  { day: 13, stage: 2, title: '扩大滑音范围', goal: '警笛能滑过一个半八度', exercises: ['siren-up', 'puppy-whine', 'oo-down'] },
  { day: 14, stage: 2, title: '阶段小结', goal: '能主动切到头声，不再只会硬顶', exercises: ['lip-arp', 'siren-up', 'oo-down', 'hoo-owl'] },
  // 阶段三 · 打通换声（15-22）
  { day: 15, stage: 3, title: '咪音上路', goal: '咪音过换声点不破', exercises: ['lip-five', 'mee-five', 'siren-up'] },
  { day: 16, stage: 3, title: '咕音降喉位', goal: '咕音八度跳跃不"够"', exercises: ['hum-five', 'goo-arp', 'mee-five'] },
  { day: 17, stage: 3, title: '故意破给它看', goal: '真假声翻转翻得干脆', exercises: ['siren-up', 'yodel', 'goo-arp'] },
  { day: 18, stage: 3, title: '把振动带进元音', goal: '妈音张嘴后振动不丢', exercises: ['hum-five', 'mum-third', 'mee-five'] },
  { day: 19, stage: 3, title: '难听但有效', goal: '呢音找到"贼"的音色', exercises: ['lip-five', 'ney-five', 'goo-arp'] },
  { day: 20, stage: 3, title: '坎变平了吗', goal: '咪音上下行听不出明显接缝', exercises: ['mee-five', 'yodel', 'goo-arp'] },
  { day: 21, stage: 3, title: '综合过坎', goal: '三种元音都能顺过换声点', exercises: ['goo-arp', 'mee-five', 'ney-five'] },
  { day: 22, stage: 3, title: '阶段小结', goal: '高音不再"断层"', exercises: ['lip-arp', 'goo-arp', 'mee-five', 'mum-third'] },
  // 阶段四 · 混声高音（23-30）
  { day: 23, stage: 4, title: '往上再推一截', goal: '一个半八度琶音能顺下来', exercises: ['lip-arp', 'goo-15', 'mee-five'] },
  { day: 24, stage: 4, title: '直接抓高音', goal: '八度跳跃不预备也能抓准', exercises: ['goo-arp', 'oct-jump', 'goo-15'] },
  { day: 25, stage: 4, title: '用肚子唱', goal: '断音时只有肚子在动', exercises: ['breath-hiss', 'staccato-ha', 'oct-jump'] },
  { day: 26, stage: 4, title: '耐力考验', goal: '九度音阶一口气顺下来', exercises: ['goo-15', 'nine-scale', 'mee-five'] },
  { day: 27, stage: 4, title: '高音也能轻', goal: '高音上做出由弱到强再到弱', exercises: ['hum-five', 'swell', 'goo-15'] },
  { day: 28, stage: 4, title: '全面拉高', goal: '今天的最高音比第 1 天高 3 个以上', exercises: ['lip-arp', 'goo-15', 'oct-jump', 'nine-scale'] },
  { day: 29, stage: 4, title: '稳定输出', goal: '连续三条高音练习都不费嗓', exercises: ['goo-15', 'swell', 'staccato-ha'] },
  { day: 30, stage: 4, title: '毕业检验', goal: '完整热身＋高音扩展，喉咙依然舒服', exercises: ['lip-five', 'siren-up', 'goo-arp', 'goo-15', 'swell'] },
];

export const dayPlan = (day: number): DayPlan => PLAN[Math.min(PLAN.length, Math.max(1, day)) - 1];

/** 单条练习的估计时长（秒），用于显示。每组之间还有准备与讲评的间隔 */
const ROUND_GAP = 2.2;

export function exerciseSeconds(ex: Exercise, rounds: number): number {
  if (ex.kind === 'glide' && ex.glide) return (ex.glide.upSec + ex.glide.downSec + ROUND_GAP) * rounds;
  if (ex.kind === 'hold') return ((ex.holdSec ?? 8) + ROUND_GAP) * rounds;
  const beats = ex.beats ?? ex.pattern.map(() => 1);
  const total = beats.reduce((a, b) => a + b, 0) * (60 / ex.bpm);
  return (total + ROUND_GAP) * rounds;
}
