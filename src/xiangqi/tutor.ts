/**
 * 私教：一对一带你练。
 *
 * 用户原话："你要看一下《天天象棋》里的'私教'功能是怎么运转的，思考怎么才能当好一个象棋私教。"
 * 天天象棋是 2025 年 3 月（4.2.7.4 版）上的"私教"，和对局结算的五维图、对局总结一起出的；
 * 公开能查到的只有这一句版本说明，具体怎么运转查不到，所以这里不照抄，按"一个好的私教该干什么"来做：
 *
 *   1. **先看你的棋，再开口**：最近复盘过的实战里，你在哪一类错误上丢分最多——证据是数出来的
 *      （"最近 6 盘里漏看威胁 9 次，每盘 1.5 次"），不是凭印象贴标签；
 *   2. **一节课只讲一件事**：一个主题、三条要点，讲完马上练；
 *   3. **先练你自己走错的局面**：实战里走错的那一手早就存进了错题本，私教先拿它出题，不够再从题库补同一类；
 *   4. **带练一盘**：教练开"教学提示"陪你下一盘，盯着这一课的毛病；
 *   5. **下节课先检查作业**：这一课的毛病在之后的实战里少了没有——
 *      少了三成以上就过关、换下一个主题；没少就换个角度再练一遍；实战不够就先去下棋，不瞎判。
 *
 * 这个文件只管"该上什么课、上得怎么样"（纯计算，单测锁死）；界面在 coach.ts 的 showTutor。
 */
import type { ArchivedGame } from './archive';
import type { ErrTag } from './teach';
import type { Dim } from './save';

/** 一节课的主题：实战里的五种毛病 + 四块按测评补的短板 + 第一次见面 */
export type Skill = 'endgame' | 'opening' | 'kill' | 'tactics';
export type Theme = ErrTag | Skill | 'intro';
const SKILLS: Skill[] = ['endgame', 'opening', 'kill', 'tactics'];
/** 补短板的课（不是改毛病）：没有"每盘几次"可数，作业不按毛病检查 */
export const isSkill = (t: Theme): t is Skill => (SKILLS as Theme[]).includes(t);
/** 补短板的课各补测评里的哪一维 */
const SKILL_DIM: Record<Skill, Dim> = { endgame: 'endgame', opening: 'opening', kill: 'mate', tactics: 'tactic' };

/** 课上的一步 */
export type Step =
  /** 你自己实战里走错的局面（错题本里的实战题），按维度挑 */
  | { kind: 'own'; dims: Dim[]; n: number; label: string }
  /** 题库里同一类的题；lift：比你现在的分再难多少（第二、三个角度往上够） */
  | { kind: 'drill'; dim: Dim; n: number; label: string; lift?: number }
  /** 中局组合题，按主题挑（捉双、抽将、弃子、连将杀……） */
  | { kind: 'combo'; themes: string[]; n: number; label: string }
  /** 残局实战：从实用残局库里挑一局跟引擎下到底（att 你多子要赢，def 你少子要守和） */
  | { kind: 'play'; role: 'att' | 'def'; cats?: string[]; label: string }
  /** 限时计算：限时做一遍，错的再不限时做一遍 */
  | { kind: 'timed'; label: string }
  /** 一条邪门布局：你来破解 */
  | { kind: 'trick'; id: string; label: string }
  /** 绝地反杀闯几关 */
  | { kind: 'counterkill'; n: number; label: string }
  /** 带练一盘：教练开"教学提示" */
  | { kind: 'game'; label: string }
  /** 水平测评 */
  | { kind: 'assess'; label: string };

export interface Lesson {
  theme: Theme;
  title: string;
  /** 为什么今天上这一课：证据 */
  why: string;
  /** 三条要点：这节课要讲的东西 */
  points: string[];
  steps: Step[];
  /** 下节课怎么检查 */
  check: string;
  /** 同一个主题第几次上（换个角度） */
  round: number;
}

/** 存下来的一节课 */
export interface LessonRecord {
  /** 开课时间 */
  ts: number;
  d: string;
  theme: Theme;
  round: number;
  /** 这节课的第几步做完了 */
  done: number[];
  steps: number;
  /** 开课时，这个毛病在之前的实战里每盘几次（复盘过的棋） */
  before: number | null;
  /** 检查结果：之后的实战里每盘几次；过关没有 */
  after?: number | null;
  passed?: boolean;
}

export interface TutorInput {
  /** 最近的实战（新的在前），带复盘结论的才算证据 */
  games: ArchivedGame[];
  /** 测评过没有、各维的分 */
  assessed: boolean;
  ratings: Record<Dim, { r: number }>;
  /** 上过的课（旧的在前） */
  log: LessonRecord[];
  /** 实战错题（错题本里实战来的那些）各维有几道 */
  ownByDim: Partial<Record<Dim, number>>;
}

/**
 * 每个主题三个角度：标题、三条要点、练什么都不一样。
 *
 * 用户原话："私教课重复太多"。原来一个主题只有一套课，没过关就原样再上一遍——同样的三条、同样的题型，
 * 第三次上跟第一次一模一样。现在第 1、2、3 次上分别是三个角度（第 4 次回到第一个角度，套路换一条），
 * 题目也一次比一次往上够（lift）。
 */
interface Angle {
  title: string;
  points: string[];
  /** cycle：这个角度第几轮（第 4 次上是第二轮），用来换套路 */
  steps: (cycle: number) => Step[];
}

const THEMES: Record<Exclude<Theme, 'intro'>, Angle[]> = {
  hang: [
    {
      title: '落子三问：这一步走过去，谁能吃它？',
      points: [
        '每一步落子之前问三句：这个子走过去，对方谁能吃它？我有几个子保护它？被吃了，我吃回来划不划算？',
        '最容易送的是"走过去才没保护"的子：马跳进对方阵地、炮打完兵停在原地、车冲得太深回不来。',
        '还要看"走开以后"：你挪开一个子，可能给对方的炮让出了炮架，或者解开了对方的马腿。',
      ],
      steps: (c) => [
        { kind: 'own', dims: ['safety', 'tactic'], n: 3, label: '先看你自己送过的子' },
        { kind: 'drill', dim: 'safety', n: 6, label: '眼力题：哪个子没保护、哪一步不亏', lift: c * 80 },
        { kind: 'game', label: '带练一盘：每一步落子前三问' },
      ],
    },
    {
      title: '挪子之前，看它原来挡着谁',
      points: [
        '每挪一个子，先看它原来那一格：它本来挡着对方哪条线？挪开以后，对方的车炮会不会直接打到你后面的子？',
        '炮要隔一个子才能吃：你的子走开，可能拆掉对方炮前面的架子，也可能走到一个地方给对方的炮当了架子。马也一样：你挪开的子要是正蹩着对方的马腿，挪开就把马放出来了。',
        '被瞄着的子先别动：对方的车瞄着你一个子、后面还是你的将或车，这个子一动，后面的就露出来了（这叫牵制）。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['捉双', '抽将', '将军抽子'], n: 4, label: '一步吃两个：捉双、抽将——你站在吃子的那一边看' },
        { kind: 'drill', dim: 'safety', n: 6, label: '眼力题（难一档）', lift: 80 + c * 80 },
        { kind: 'own', dims: ['safety'], n: 3, label: '你实战里送掉的那几手' },
        { kind: 'game', label: '带练一盘：挪子之前看它原来挡着谁' },
      ],
    },
    {
      title: '每个子都要有根',
      points: [
        '没有保护的子叫"浮子"（没根）。浮子一多，对方一步棋同时捉两个，你只能救一个。',
        '"车不立险地"：车最值钱，冲进对方阵地却没有退路，常常被马炮围着捉死。冲之前先看回来的路。',
        '时间紧的时候最容易送子：限时做一遍题，看自己急起来会漏掉什么。',
      ],
      steps: (c) => [
        { kind: 'timed', label: '限时计算：急起来也要三问' },
        { kind: 'drill', dim: 'safety', n: 8, label: '眼力题（再难一档）', lift: 140 + c * 80 },
        { kind: 'game', label: '带练一盘：每走一步数一数哪个子没根' },
      ],
    },
  ],
  greedy: [
    {
      title: '吃子先算账：我吃多少，他吃回多少',
      points: [
        '吃之前算一笔账：我吃到的子值多少，对方吃回来的值多少（车 10、炮 5、马 4.5、士象 2.2、兵 1，按兵算）。',
        '送到嘴边的子，先把它后面那条线看到底：龟背炮的 7 卒后面有马有炮，车一吃就被打掉；铁滑车、敢死炮送的子能吃，可吃完马上要看他在捉谁。',
        '吃子也要走一步，吃完那个子常常站在没保护的地方——"宁失一子，不失一先"，反过来说就是：贪一个子，常常丢一步先。',
      ],
      steps: (c) => [
        { kind: 'own', dims: ['safety', 'tactic'], n: 3, label: '先看你自己贪过的子' },
        c % 2 ? { kind: 'trick', id: 'tiehuache', label: '铁滑车：吃了马以后别贪第二个' } : { kind: 'trick', id: 'guibeipao', label: '龟背炮：卒后面藏着炮' },
        { kind: 'drill', dim: 'tactic', n: 6, label: '战术题：算清楚再吃', lift: c * 80 },
        { kind: 'game', label: '带练一盘：吃子之前先算账' },
      ],
    },
    {
      title: '对方送子，先想他要什么',
      points: [
        '对方白送一个子，先想他图什么：打开一条将军的路？吃完以后抽将？还是你吃子的那个子一走开，他就能捉双？',
        '你吃子的那一步没有将军，他就多了一步自由：先看这一步他能不能将军、能不能一下捉你两个子。',
        '他送的子要是跑不掉，先补一手再吃也不迟——子还在那里，漏洞已经补上了。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['弃子', '组合'], n: 5, label: '弃子题：你站在送子的那一边，看他要什么' },
        { kind: 'trick', id: c % 2 ? 'gansipao-black' : 'tiehuache-black', label: c % 2 ? '黑方敢死炮：送炮以后追着捉' : '黑方铁滑车：抬车送马' },
        { kind: 'drill', dim: 'tactic', n: 6, label: '战术题（难一档）', lift: 80 + c * 80 },
        { kind: 'game', label: '带练一盘：对方送子先问他要什么' },
      ],
    },
    {
      title: '算清楚了就吃：该贪的时候别手软',
      points: [
        '算账不是不吃：吃完对方抢不回来、也没有杀，那就吃——多一个子就是多一份胜势。',
        '"他连送两个子肯定有诈"——这种心虚也丢分：双铁滑车就是赌你吃了一个不敢吃第二个。',
        '吃完按部就班出子，该还就还一点：多子的一方最怕急，子力出齐了，多的那个子自然有用。',
      ],
      steps: (c) => [
        { kind: 'trick', id: 'shuang-tiehuache', label: '双铁滑车：送两匹马，算清楚就都吃' },
        { kind: 'timed', label: '限时计算：急着也要算完账' },
        { kind: 'drill', dim: 'tactic', n: 8, label: '战术题（再难一档）', lift: 140 + c * 80 },
        { kind: 'game', label: '带练一盘：算清楚就吃，吃了就稳住' },
      ],
    },
  ],
  'missed-threat': [
    {
      title: '对方每走一步，先问"他想干什么"',
      points: [
        '对方走完，先别想自己的计划：他这一步捉了谁？下一步能不能将军？能吃什么？',
        '扫威胁按顺序：车（直线、横线）→ 炮（隔一个子打）→ 马（先看马腿）→ 过河兵（横着也能吃）。',
        '看见威胁有四种应法：躲开、保护、挡住、反击（比他更凶的威胁）。先选不丢先手的那一种。',
      ],
      steps: (c) => [
        { kind: 'drill', dim: 'safety', n: 6, label: '眼力题：点出被捉的子', lift: c * 80 },
        { kind: 'own', dims: ['safety'], n: 3, label: '你实战里漏看的那几手' },
        { kind: 'trick', id: 'xiayangou', label: '瞎眼狗：车对准的不是兵，是兵后面的马' },
        { kind: 'game', label: '带练一盘：对方每一步先问他想干什么' },
      ],
    },
    {
      title: '威胁不只是"捉"：将军和抽将',
      points: [
        '对方的威胁有三层：捉你一个子（最好看）、下一步将军（要数他能将几次）、将军的同时吃子（抽将，最容易漏）。',
        '抽将的样子：他的车和你的将在一条线上，中间只隔着他自己的一个子——那个子一走开就是将军，它走到哪儿都能顺手吃你一个子。',
        '看到对方的子和你的将排成一线，先把将挪开或者先塞一个子进去，别等他走。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['抽将', '将军抽子'], n: 5, label: '抽将题：你来抽，看清楚它长什么样' },
        { kind: 'trick', id: 'diepao', label: '叠炮：两门炮一条线，谁打谁' },
        { kind: 'drill', dim: 'safety', n: 6, label: '眼力题（难一档）', lift: 80 + c * 80 },
        { kind: 'game', label: '带练一盘：看对方的子和你的将排没排成一线' },
      ],
    },
    {
      title: '急起来也要扫一遍',
      points: [
        '时间一紧最先省掉的就是"看对方"：限时做一遍，再不限时做一遍错的，分清楚是算不出来还是没去看。',
        '扫威胁的顺序急了也不乱：车 → 炮 → 马 → 过河兵，养成手上的习惯。',
        '对方一步有两个威胁（捉双）时，找能同时解掉两个的那一手：保护一个、躲开另一个；或者先将他一军。',
      ],
      steps: (c) => [
        { kind: 'timed', label: '限时计算：先看他想干什么' },
        { kind: 'own', dims: ['safety'], n: 3, label: '你实战里漏看的那几手' },
        { kind: 'drill', dim: 'safety', n: 8, label: '眼力题（再难一档）', lift: 140 + c * 80 },
        { kind: 'game', label: '带练一盘：每一步都先扫一遍' },
      ],
    },
  ],
  'walk-into-mate': [
    {
      title: '进攻之前，先看自己的九宫',
      points: [
        '进攻前先看自己的帅：对方的车、马、炮离九宫有几步？有没有"一步将军、两步杀"的路线？',
        '帅前面的中线别空着（急进中兵就是等你开门，空头炮一架，士象都上不来）；士角别让车占住（弃马十三着就是从士角杀进来的）。',
        '对方的攻势已经到了，先补士、飞象、调子回防——多吃一个子顶不住一步杀。',
      ],
      steps: (c) => [
        c % 2
          ? { kind: 'trick', id: 'jijin-zhongbing', label: '急进中兵：中卒是将的门板' }
          : { kind: 'trick', id: 'qima-shisan', label: '弃马十三着：没补士，十三步被杀' },
        { kind: 'drill', dim: 'mate', n: 6, label: '杀法题：认清楚别人怎么杀你', lift: c * 80 },
        { kind: 'own', dims: ['mate', 'safety'], n: 3, label: '你实战里被将死前的那一手' },
        { kind: 'game', label: '带练一盘：进攻前先看自己的九宫' },
      ],
    },
    {
      title: '认得杀形，才知道哪一步已经危险',
      points: [
        '常见的杀法图形先认熟：马后炮、重炮、闷宫、铁门栓、双车错。认得出来，就知道对方的子摆到哪一步已经危险了。',
        '对方的车占住你的肋道（士角那条线）、马跳到卧槽、炮对着中路——三样占了两样，就该先补防了。',
        '对方有杀的时候，所有计划都排在后面：先解杀，再谈别的。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['连将杀', '杀'], n: 4, label: '连将杀：一路将到底的样子' },
        { kind: 'drill', dim: 'mate', n: 6, label: '杀法题（难一档）', lift: 80 + c * 80 },
        { kind: 'own', dims: ['mate', 'safety'], n: 3, label: '你实战里被将死前的那一手' },
        { kind: 'game', label: '带练一盘：对方的子一靠近九宫就想他的杀形' },
      ],
    },
    {
      title: '守住九宫：士象、帅和兑子',
      points: [
        '士象是九宫的门板：交换的时候别拿士象去换进攻，残局里少一个士象，对方的马炮就钻得进来。',
        '帅自己也能躲：帅挪到对方车炮打不到的一边，常常比补一个子更快。',
        '对方子力压过来的时候用兑子减压：把他最凶的那个进攻子换掉，杀势就没了。',
      ],
      steps: (c) => [
        { kind: 'play', role: 'def', label: '残局实战：少子守和，九宫不能破' },
        { kind: 'drill', dim: 'safety', n: 6, label: '眼力题：先看自己的九宫', lift: 80 + c * 80 },
        { kind: 'game', label: '带练一盘：对方压过来就找兑子' },
      ],
    },
  ],
  'missed-mate': [
    {
      title: '将军优先：能杀先杀',
      points: [
        '每一步先把所有将军的着法过一遍：对方怎么应？应完我还能不能接着将？',
        '杀法有图形：马后炮、重炮、闷宫、双车错、铁门栓……认熟了，看一眼就知道能不能杀。',
        '对方下一步就能杀你的时候，只有连将才能抢在他前面——这就是"绝地反杀"要练的。',
      ],
      steps: (c) => [
        { kind: 'drill', dim: 'mate', n: 6, label: '杀法题', lift: c * 80 },
        { kind: 'counterkill', n: 2, label: '绝地反杀两关：只有连将才能活' },
        { kind: 'own', dims: ['mate'], n: 3, label: '你实战里漏掉的杀' },
        { kind: 'game', label: '带练一盘：每一步先找将军' },
      ],
    },
    {
      title: '杀法的第一步常常不是将军',
      points: [
        '将军的着法过完了没杀，再找"先堵路"的一手：先占住将的退路，下一步再将，对方这一步怎么走都来不及。',
        '弃子将军：送一个子把将引出来，或者把守着要点的士象引开，下一步大子就进来了。',
        '对方的车马炮还在时，每将一步都要看他有没有反将——将不死他，自己先被抽。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['连将杀', '杀'], n: 5, label: '连将杀题' },
        { kind: 'drill', dim: 'mate', n: 8, label: '杀法题（难一档）', lift: 100 + c * 80 },
        { kind: 'counterkill', n: 2, label: '绝地反杀两关' },
        { kind: 'game', label: '带练一盘：将不死的时候想想先堵哪条路' },
      ],
    },
    {
      title: '快的时候也别漏杀；多子要杀下来',
      points: [
        '快棋里的杀最容易漏：限时做一遍，看哪种杀你急了就看不见。',
        '多子的残局，赢的方法常常就是一个杀：别只想着吃光对方的子，先看能不能直接把将困死。',
        '你要杀他之前，先看他能不能先将你：他有将军，你的杀就慢了一步。',
      ],
      steps: (c) => [
        { kind: 'timed', label: '限时计算：先找将军' },
        { kind: 'play', role: 'att', cats: ['车类', '组合'], label: '残局实战：多子把它杀下来' },
        { kind: 'drill', dim: 'mate', n: 6, label: '杀法题（再难一档）', lift: 140 + c * 80 },
        { kind: 'game', label: '带练一盘：每一步先找将军' },
      ],
    },
  ],
  slow: [
    {
      title: '每一步都要有目的：抢先手',
      points: [
        '开局先把车马炮出齐，别一个子连走两三步；兵只动有用的（活马、通车）。',
        '中局每一步问一句：走完之后，对方是不是必须应我？逼着对方应的叫先手，抢到一步就多一步。',
        '"宁失一子，不失一先"：江湖套路就是拿子换先手——反过来，你白走一步，就等于把半个子送给了对方。',
      ],
      steps: (c) => [
        { kind: 'trick', id: c % 2 ? 'gansipao-black' : 'gansipao-red', label: c % 2 ? '黑方敢死炮：吃了炮别恋子' : '敢死炮：吃了炮别恋子，趁他捉你多出子' },
        { kind: 'drill', dim: 'tactic', n: 6, label: '战术题：找最主动的一手', lift: c * 80 },
        { kind: 'own', dims: ['tactic', 'opening'], n: 3, label: '你实战里走软的那几手' },
        { kind: 'game', label: '带练一盘：每一步都要逼他应' },
      ],
    },
    {
      title: '出子的速度：三步不出车',
      points: [
        '开局数一数：十步以内你的车马炮出来几个？一个子连走三步，就有两个子还在家里。',
        '车最要紧——"三步不出车，必定要输棋"。车不出来，别的子再活也只是零敲碎打。',
        '对方抢着出子的时候，你也跟着出子，别只盯着吃他一个兵：吃兵的那几步，他的车已经出来了。',
      ],
      steps: (c) => [
        { kind: 'trick', id: c % 2 ? 'tiehuache-black' : 'tiehuache', label: c % 2 ? '黑方铁滑车：他送马换出车' : '铁滑车：他送马换出车' },
        { kind: 'drill', dim: 'opening', n: 6, label: '布局题：这一步出哪个子', lift: 60 + c * 80 },
        { kind: 'own', dims: ['opening'], n: 3, label: '你实战里开局走慢的那几手' },
        { kind: 'game', label: '带练一盘：十步以内车马炮出齐' },
      ],
    },
    {
      title: '一步两用：逼他应，同时改善自己',
      points: [
        '最好的一手一步两用：捉他一个子，同时把自己的车开出来；将一军，同时占住要点。',
        '对方捉你的子，先看能不能"躲着捉回去"：躲的这一步同时捉他一个子，先手就回到你手里。',
        '实在没有先手可抢，就走一步改善最差的那个子（最不活跃的那个），别乱冲。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['捉双', '组合'], n: 5, label: '组合题：一步两用' },
        { kind: 'timed', label: '限时计算：找最主动的一手' },
        { kind: 'drill', dim: 'tactic', n: 6, label: '战术题（难一档）', lift: 100 + c * 80 },
        { kind: 'game', label: '带练一盘：每一步都想想能不能一步两用' },
      ],
    },
  ],
  endgame: [
    {
      title: '残局：多子要赢下来，少子要守住',
      points: [
        '残局先数子：谁多什么、能不能赢——车对士象全、马炮对单士象这些结论要背下来，别把赢棋走和、把和棋走输。',
        '帅（将）要参战：残局里帅是一个能打的子，占中、助攻、守底线都靠它。',
        '对方下一步就杀你的时候，别想着慢慢赢，只有连将能救命。',
      ],
      steps: (c) => [
        { kind: 'drill', dim: 'endgame', n: 6, label: '残局题', lift: c * 80 },
        { kind: 'play', role: 'att', label: '残局实战：多子下到底赢下来' },
        { kind: 'own', dims: ['endgame'], n: 3, label: '你实战里残局走坏的那几手' },
      ],
    },
    {
      title: '残局：少子守和',
      points: [
        '少子的一方别急着认输：很多残局书上是和棋，前提是守的形状对。',
        '守和先摆形状：士象互相保护，帅不离开九宫中线太远，守子别站在对方一步就能捉到的地方。',
        '守棋最怕急：别为了"反击"把守子派出去，对方等的就是这个空当。',
      ],
      steps: (c) => [
        { kind: 'play', role: 'def', label: '残局实战：少子守和' },
        { kind: 'drill', dim: 'endgame', n: 6, label: '残局题（难一档）', lift: 80 + c * 80 },
        { kind: 'counterkill', n: 1, label: '绝地反杀一关：少子也有杀' },
      ],
    },
    {
      title: '残局：先判断能不能赢，再下',
      points: [
        '同样是单车，对双士能赢、对士象全基本是和——判断错了，就会该兑的不兑、该守的乱攻。',
        '数子力也要看位置：兵过没过河、是高兵还是底兵，结论差很多——兵走到底线（老兵）只能横走，作用小得多。',
        '马炮兵类残局变化多：先把对方的士象拆掉一个，赢面就大很多。',
      ],
      steps: (c) => [
        { kind: 'play', role: 'att', cats: ['兵类', '马类', '炮类'], label: '残局实战：马炮兵残局，先判断再下到底' },
        { kind: 'drill', dim: 'endgame', n: 8, label: '残局题（再难一档）', lift: 140 + c * 80 },
        { kind: 'play', role: 'att', cats: ['车类', '组合'], label: '残局实战：车类残局兑现多子' },
      ],
    },
  ],
  opening: [
    {
      title: '布局：出子、占线，别被套路骗',
      points: [
        '开局十步以内：车马炮出齐、车占通路、中路有保护——做到这三条，布局就不会吃大亏。',
        '江湖套路都是"送你一点东西换先手"：先问他要换什么，送的子能不能吃、吃完他捉谁。',
        '中路只剩一个中卒挡着的时候别动它，士、象、中炮先上来。',
      ],
      steps: (c) => [
        c % 2 ? { kind: 'trick', id: 'jijin-zhongbing', label: '急进中兵' } : { kind: 'trick', id: 'tiehuache', label: '铁滑车' },
        c % 2 ? { kind: 'trick', id: 'gansipao-red', label: '敢死炮' } : { kind: 'trick', id: 'xiayangou', label: '瞎眼狗' },
        { kind: 'drill', dim: 'opening', n: 6, label: '开局题', lift: c * 80 },
      ],
    },
    {
      title: '布局：看清一条线上谁打谁',
      points: [
        '对方两个子排在一条线上（叠炮、车炮同线），先看清这条线谁是架子、谁能打谁，再往线上放子。',
        '开局别贪兵：吃一个边兵要走两三步，对方趁这几步把车马全出来了。',
        '布局要有方向：中炮攻中路、屏风马护中路两翼——先知道你这个布局想干什么，每一步才走得有目的。',
      ],
      steps: (c) => [
        { kind: 'trick', id: 'diepao', label: '叠炮：两门炮叠在一路' },
        { kind: 'trick', id: c % 2 ? 'gansipao-black' : 'tiehuache-black', label: c % 2 ? '黑方敢死炮' : '黑方铁滑车' },
        { kind: 'drill', dim: 'opening', n: 6, label: '开局题（难一档）', lift: 80 + c * 80 },
      ],
    },
    {
      title: '布局：不背谱，问三句',
      points: [
        '开局题做的不是背谱，是每一步问三句：这一步出了哪个子？占了哪条线？给了对方什么？',
        '陌生的开局别慌：照着"先出车马炮、再动兵"的顺序走，不会吃大亏。',
        '布局的好坏要到中局才看得出来：出子快、车占通路、中路稳，进了中局才有棋下。',
      ],
      steps: (c) => [
        { kind: 'drill', dim: 'opening', n: 8, label: '开局题（再难一档）', lift: 140 + c * 80 },
        { kind: 'trick', id: c % 2 ? 'qima-shisan' : 'shuang-tiehuache', label: c % 2 ? '弃马十三着' : '双铁滑车' },
        { kind: 'game', label: '带练一盘：开局每一步问三句' },
      ],
    },
  ],
  kill: [
    {
      title: '杀法专项：先堵路，再将军',
      points: [
        '杀法题先看将能往哪儿跑：把它的出路一条条堵上，最后一步才是将军。',
        '对方的车马炮还在的时候，你每将一步都要看他有没有反将——将不死他，自己先被抽。',
        '一步两用的将军最值钱：将军的同时占住将的退路，或者把对方的守子引开。',
      ],
      steps: (c) => [
        { kind: 'drill', dim: 'mate', n: 8, label: '杀法题', lift: 60 + c * 80 },
        { kind: 'combo', themes: ['连将杀', '杀'], n: 4, label: '连将杀题' },
        { kind: 'counterkill', n: 2, label: '绝地反杀两关' },
      ],
    },
    {
      title: '杀法专项：弃子入局',
      points: [
        '大子进不去的时候，先弃一个子：把士象引开、把将引出来，下一步车炮就进来了。',
        '弃之前把对方每一种应法都过一遍：只要有一种应法将不死，这个弃子就是白送。',
        '杀不死也别慌：弃子将军的过程中常常能顺手抽回一个子。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['弃子', '杀'], n: 5, label: '弃子杀题' },
        { kind: 'drill', dim: 'mate', n: 8, label: '杀法题（难一档）', lift: 120 + c * 80 },
        { kind: 'timed', label: '限时计算' },
      ],
    },
    {
      title: '杀法专项：残局把杀下出来',
      points: [
        '题会做和下得出来是两回事：残局实战里没人告诉你"这里有杀"。',
        '多子的残局别只想着吃子：先看对方的将还能往哪儿跑，能不能直接困死。',
        '下棋时每隔几步就问一句"现在有没有杀"——这是练出来的习惯。',
      ],
      steps: (c) => [
        { kind: 'play', role: 'att', cats: ['车类', '组合'], label: '残局实战：多子把它杀下来' },
        { kind: 'drill', dim: 'mate', n: 8, label: '杀法题（再难一档）', lift: 160 + c * 80 },
        { kind: 'counterkill', n: 2, label: '绝地反杀两关' },
      ],
    },
  ],
  tactics: [
    {
      title: '战术专项：捉双和抽将',
      points: [
        '捉双：一步棋同时捉两个子，对方只能救一个。马最会捉双，车、炮、兵也行。',
        '抽将：先将军，等他应完再吃子——将军的那一步让他没有时间救子。',
        '找组合先找两样东西：对方没保护的子、对方的将。组合多半是冲这两样去的。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['捉双', '抽将', '将军抽子'], n: 6, label: '捉双、抽将题' },
        { kind: 'drill', dim: 'tactic', n: 6, label: '战术题', lift: 60 + c * 80 },
        { kind: 'timed', label: '限时计算' },
      ],
    },
    {
      title: '战术专项：弃子是先给后拿',
      points: [
        '弃子是"先给后拿"：送掉一个子，是为了下一步拿回更多，或者直接杀。',
        '弃之前把对方所有的应法都过一遍：只要有一种应法让你拿不回来，这个弃子就是送。',
        '对方弃子的时候也一样：先想他要拿回什么。',
      ],
      steps: (c) => [
        { kind: 'combo', themes: ['弃子', '组合'], n: 6, label: '弃子组合题' },
        { kind: 'drill', dim: 'tactic', n: 8, label: '战术题（难一档）', lift: 120 + c * 80 },
        { kind: 'game', label: '带练一盘：找一步两用的机会' },
      ],
    },
    {
      title: '战术专项：限时也算得出来',
      points: [
        '实战没有无限的时间：限时做一遍，错的不限时再做一遍，分清楚是算不出来还是来不及算。',
        '算组合有固定顺序：将军 → 吃子 → 捉子，先看最凶的着法。',
        '算到底再走：组合走到一半发现不对，往往已经丢了子。',
      ],
      steps: (c) => [
        { kind: 'timed', label: '限时计算' },
        { kind: 'combo', themes: ['组合', '捉双', '弃子'], n: 5, label: '组合题' },
        { kind: 'drill', dim: 'tactic', n: 8, label: '战术题（再难一档）', lift: 160 + c * 80 },
      ],
    },
  ],
};

/** 同一个主题第 round 次上：用哪个角度、第几轮 */
export function angleOf(theme: Exclude<Theme, 'intro'>, round: number): { angle: Angle; index: number; cycle: number } {
  const list = THEMES[theme];
  const k = Math.max(0, round - 1);
  return { angle: list[k % list.length], index: k % list.length, cycle: Math.floor(k / list.length) };
}
/** 每个主题有几个角度 */
export const angleCount = (theme: Exclude<Theme, 'intro'>) => THEMES[theme].length;

/** 一盘复盘过的棋里某个毛病出现了几次 */
const countIn = (g: ArchivedGame, theme: Theme) => (g.review?.tags?.[theme as ErrTag] ?? 0);

/**
 * 这个毛病在一批复盘过的棋里平均每盘几次；复盘过的不到 minGames 盘返回 null（不够下结论）。
 */
export function ratePerGame(games: ArchivedGame[], theme: Theme, minGames = 1): number | null {
  const rev = games.filter((g) => g.review);
  if (rev.length < minGames) return null;
  return Math.round((rev.reduce((s, g) => s + countIn(g, theme), 0) / rev.length) * 10) / 10;
}

/** 最近复盘过的棋里，各个毛病一共几次（只看最近 8 盘复盘过的） */
export function habitCounts(games: ArchivedGame[]): { tag: ErrTag; count: number; games: number }[] {
  const rev = games.filter((g) => g.review).slice(0, 8);
  const by = new Map<ErrTag, { count: number; games: number }>();
  for (const g of rev) {
    for (const [k, v] of Object.entries(g.review!.tags ?? {})) {
      if (!v) continue;
      const cur = by.get(k as ErrTag) ?? { count: 0, games: 0 };
      cur.count += v;
      cur.games++;
      by.set(k as ErrTag, cur);
    }
  }
  return [...by.entries()].map(([tag, x]) => ({ tag, ...x })).sort((a, b) => b.count - a.count || b.games - a.games);
}

/** 过关的标准：之后的实战里，这个毛病每盘少了三成以上（或者干脆没再出现） */
export const PASS_DROP = 0.3;
/** 检查作业至少要等几盘复盘过的实战 */
export const CHECK_GAMES = 2;
/** 同一个主题最多连着上几节：再没过关就先换一课，过一节再回来 */
export const MAX_STREAK = 2;

/**
 * 检查上一节课：之后的实战够不够、毛病少了没有。
 * 返回 null 表示实战还不够，没法判。
 */
export function checkLesson(rec: LessonRecord, games: ArchivedGame[]): { after: number; passed: boolean; n: number } | null {
  if (rec.theme === 'intro' || isSkill(rec.theme)) return null;
  const later = games.filter((g) => g.ts > rec.ts && g.review);
  if (later.length < CHECK_GAMES) return null;
  const after = ratePerGame(later, rec.theme)!;
  const before = rec.before ?? 0;
  const passed = after === 0 || (before > 0 && after <= before * (1 - PASS_DROP));
  return { after, passed, n: later.length };
}

const NAMES: Record<Theme, string> = {
  hang: '送子',
  greedy: '贪吃',
  'missed-threat': '漏看威胁',
  'walk-into-mate': '漏将',
  'missed-mate': '漏杀',
  slow: '走软',
  endgame: '残局',
  opening: '布局',
  kill: '杀法',
  tactics: '战术组合',
  intro: '见面课',
};
export const themeName = (t: Theme) => NAMES[t];

/** 课表末尾连着几节是同一个主题 */
function streak(log: LessonRecord[], theme: Theme): number {
  let n = 0;
  for (let i = log.length - 1; i >= 0 && log[i].theme === theme; i--) n++;
  return n;
}

/**
 * 补短板挑哪一块：测评四块（残局、布局、杀法、战术组合）里分最低的——
 * 但最近两节上过的先跳过。原来只在残局、布局两块里挑，实战没毛病的时候就是残局、残局、残局。
 */
function pickSkill(inp: TutorInput): { side: Skill; weakest: Skill } {
  const lastAt = (t: Skill) => {
    for (let i = inp.log.length - 1; i >= 0; i--) if (inp.log[i].theme === t) return i;
    return -1;
  };
  const order = [...SKILLS].sort((a, b) => inp.ratings[SKILL_DIM[a]].r - inp.ratings[SKILL_DIM[b]].r || lastAt(a) - lastAt(b));
  const recent = new Set(inp.log.slice(-2).map((r) => r.theme));
  const side = order.find((t) => !recent.has(t)) ?? [...order].sort((a, b) => lastAt(a) - lastAt(b))[0];
  return { side, weakest: order[0] };
}

/**
 * 今天上什么课。
 *
 * 次序：
 *   1. 上一节课没上完 → 接着上；
 *   2. 什么证据都没有（没测评、没有复盘过的实战）→ 见面课：先测一下、下一盘让教练看看；
 *   3. 上一节课的毛病还没过关（之后的实战里没少）→ 同一个主题换个角度再上一遍；
 *      已经连着上了 MAX_STREAK 节还没过 → 先换一课，过一节再回来；
 *   4. 最近实战里出现最多、而且还没过关的毛病；
 *   5. 实战里没什么毛病了（或者都过关了）→ 测评里哪块弱补哪块，最近两节上过的先跳过。
 */
export function planLesson(inp: TutorInput): Lesson {
  const last = inp.log[inp.log.length - 1];
  if (last && last.done.length < last.steps) return buildLesson(last.theme, last.round, inp, '上节课还没上完，接着来。');

  const reviewed = inp.games.filter((g) => g.review);
  if (!inp.assessed && !reviewed.length) return buildLesson('intro', 1, inp, '我们第一次见面：我还不知道你的棋是什么样，先测一下、再下一盘给我看看。');

  // 上一节课的作业检查
  const passedThemes = new Set(inp.log.filter((r) => r.passed).map((r) => r.theme));
  /** 上一节课的作业还没法检查（之后的实战不够）：今天先上别的，不重复上同一课 */
  let pending: Theme | null = null;
  /** 连着上了几节还没过关：今天先放一放 */
  let resting: Theme | null = null;
  let note = '';
  if (last && last.theme !== 'intro') {
    const c = checkLesson(last, inp.games);
    if (c && !c.passed) {
      const run = streak(inp.log, last.theme);
      if (run < MAX_STREAK) {
        return buildLesson(
          last.theme,
          last.round + 1,
          inp,
          `上节课练的是「${NAMES[last.theme]}」。之后 ${c.n} 盘实战里每盘还有 ${c.after} 次（上课前每盘 ${last.before ?? 0} 次），没怎么少——换个角度再练一遍。`,
        );
      }
      resting = last.theme;
      note = `（「${NAMES[last.theme]}」已经连着上了 ${run} 节，之后的实战里每盘还有 ${c.after} 次。先换一课，下节再回来——换着练比一直钻一个点更记得住。）`;
    }
    if (c?.passed) passedThemes.add(last.theme);
    else if (!c && last.passed === undefined && !isSkill(last.theme)) pending = last.theme;
  }

  const habits = habitCounts(inp.games).filter((h) => !passedThemes.has(h.tag) && h.tag !== pending && h.tag !== resting);
  if (pending) note = `（上节课「${NAMES[pending]}」的作业还没法检查：之后复盘过的实战不到 ${CHECK_GAMES} 盘。）`;
  if (habits.length) {
    const h = habits[0];
    const n = reviewed.slice(0, 8).length;
    const rounds = inp.log.filter((r) => r.theme === h.tag).length;
    return buildLesson(
      h.tag,
      rounds + 1,
      inp,
      `最近 ${n} 盘复盘过的实战里，「${NAMES[h.tag]}」一共 ${h.count} 次，出现在 ${h.games} 盘里——这是你现在丢分最多的地方。${note}`,
    );
  }
  const { side, weakest } = pickSkill(inp);
  const rounds = inp.log.filter((r) => r.theme === side).length;
  const pick =
    side === weakest
      ? `测评里「${NAMES[side]}」是你相对弱的一块，今天补它。`
      : `测评里最弱的「${NAMES[weakest]}」最近刚上过，今天换一块：「${NAMES[side]}」。`;
  return buildLesson(
    side,
    rounds + 1,
    inp,
    reviewed.length
      ? `最近的实战里没有哪一种毛病特别突出${passedThemes.size ? '（练过的都过关了）' : ''}。${pick}${note}`
      : `还没有复盘过的实战，先按测评来：${pick}${note}`,
  );
}

/** 某个主题第 round 次上的那一课（换角度、换套路都在这里） */
export function buildLesson(theme: Theme, round: number, inp: TutorInput, why: string): Lesson {
  if (theme === 'intro') {
    return {
      theme,
      title: '见面课：先让我看看你的棋',
      why,
      points: [
        '私教不是题库：我得先知道你在哪里丢分，才知道该教什么。',
        '测评量的是"会不会做题"，实战量的是"下棋时看不看得见"——两样我都要看。',
        '下完那盘棋记得看复盘：复盘的结论（哪一手亏、是什么毛病）就是我下节课的教案。',
      ],
      // 两步都一直列着（测过了界面上就打勾）：步数一变，已经打的勾就对不上了
      steps: [
        { kind: 'assess', label: '水平测评（约 20 分钟）' },
        { kind: 'game', label: '下一盘给我看看（下完看复盘）' },
      ],
      check: '下节课我会看这盘棋的复盘：你在哪一类错误上丢分最多，就从哪一课开始。',
      round,
    };
  }
  const { angle, index, cycle } = angleOf(theme, round);
  const steps = angle.steps(cycle).filter((s) => s.kind !== 'own' || s.dims.some((d) => (inp.ownByDim[d] ?? 0) > 0));
  return {
    theme,
    title: round > 1 ? `${angle.title}（第 ${round} 次，${index ? '换个角度' : '换一批题'}）` : angle.title,
    why,
    points: angle.points,
    steps,
    check: !isSkill(theme)
      ? `作业：接下来下 ${CHECK_GAMES} 盘以上实战，下完都看一下复盘。下节课我先数「${NAMES[theme]}」每盘还有几次——少了三成以上就过关，换下一课。`
      : `作业：把今天的题做完，再下一盘实战。下节课看实战里有没有新的毛病；没有的话换一块接着补。`,
    round,
  };
}

/**
 * 残局实战这一步挑哪一局：分类、攻守对得上；没下过关的先出；难度贴近你的残局分（宁难勿易）。
 */
export function pickPlayout<G extends { category: string; items: { id: string; role?: string; rating: number }[] }>(
  groups: G[],
  st: Extract<Step, { kind: 'play' }>,
  cleared: Set<string>,
  rating: number,
  rnd = Math.random,
): { g: G; i: number } | null {
  const cand: { g: G; i: number; r: number; fresh: boolean }[] = [];
  for (const g of groups) {
    if (st.cats && !st.cats.includes(g.category)) continue;
    g.items.forEach((e, i) => {
      if (e.role === st.role) cand.push({ g, i, r: e.rating, fresh: !cleared.has(e.id) });
    });
  }
  if (!cand.length) return null;
  const fresh = cand.filter((c) => c.fresh);
  const dist = (r: number) => (r < rating ? (rating - r) * 1.6 : r - rating);
  const pool = (fresh.length ? fresh : cand).sort((a, b) => dist(a.r) - dist(b.r)).slice(0, 6);
  const c = pool[Math.floor(rnd() * pool.length)];
  return { g: c.g, i: c.i };
}

// ───────────────────────── 存档 ─────────────────────────

const KEY = 'xq-tutor';

export function getLessonLog(): LessonRecord[] {
  try {
    const raw = localStorage.getItem(KEY);
    const v = raw ? (JSON.parse(raw) as LessonRecord[]) : [];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveLog(log: LessonRecord[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(log.slice(-60)));
  } catch {
    /* 存不下就算了，课照上 */
  }
}

/** 开一节课（同一节课没上完就不重复开） */
export function startLesson(l: Lesson, games: ArchivedGame[], now = Date.now()): LessonRecord[] {
  const log = getLessonLog();
  const last = log[log.length - 1];
  if (last && last.done.length < last.steps && last.theme === l.theme) return log;
  // 上一节课的检查结果落档（新开一课之前）
  if (last && last.passed === undefined) {
    const c = checkLesson(last, games);
    if (c) {
      last.after = c.after;
      last.passed = c.passed;
    }
  }
  const before = l.theme === 'intro' || isSkill(l.theme) ? null : ratePerGame(games.filter((g) => g.ts <= now).slice(0, 8), l.theme);
  log.push({ ts: now, d: new Date(now).toLocaleDateString('sv'), theme: l.theme, round: l.round, done: [], steps: l.steps.length, before });
  saveLog(log);
  return log;
}

/** 这节课的第 i 步做完了 */
export function markStep(i: number): LessonRecord[] {
  const log = getLessonLog();
  const last = log[log.length - 1];
  if (last && !last.done.includes(i)) {
    last.done.push(i);
    saveLog(log);
  }
  return log;
}

/** 第一次见面课上完就算"过了"——它没有毛病可检查 */
export function closeIntro(): void {
  const log = getLessonLog();
  const last = log[log.length - 1];
  if (last && last.theme === 'intro' && last.done.length >= last.steps) {
    last.passed = true;
    saveLog(log);
  }
}
