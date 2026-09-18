/**
 * 教学事实层：把"这一手有什么问题"算成**结构化事实**。
 *
 * 这是整个产品最关键的一层，原因是产品规格里那条铁律：
 * 语言模型只负责解释，不负责判断。所以"你这个马没人保护、对方车能白吃"
 * 这种结论必须由规则算出来，而不是让模型看着棋盘感觉。
 * 模型拿到的永远是这里产出的事实，它只负责把事实讲成人话。
 *
 * 为什么不用搜索引擎（ai.ts）来做这件事：
 *   1. **快**。教练模式要在你落子那一瞬间给反应，搜索要几百毫秒到几秒。
 *   2. **说得清**。搜索只会给一个分数，"-320"没法教学；而静态兑子算出来的
 *      是"你的马值 450，对方车吃它你只能拿回 100"，这句话能直接讲给人听。
 *   3. **可测**。纯函数、无随机、无超时，能写成确定性单元测试。
 *
 * 搜索引擎负责的是"最佳着法是什么"，这一层负责的是"你这手错在哪"。
 * 两件事不一样，用两套工具。
 */
import {
  applyMove,
  isInCheck,
  kingsFacing,
  legalMoves,
  pseudoMoves,
  statusAfter,
  type Board,
  type Color,
  type Move,
  type PType,
} from './rules';
import { moveToText, pieceName } from './notation';

/** 子力价值，和引擎 ai.ts 的 VAL 保持一致（兵=100，车=1000） */
export const PIECE_VALUE: Record<PType, number> = {
  K: 60000,
  A: 220,
  E: 220,
  H: 450,
  R: 1000,
  C: 500,
  P: 100,
};

export const other = (c: Color): Color => (c === 'r' ? 'b' : 'r');

/** 把分数换算成"约等于几个子"，给不认识数字的人看 */
export function inPieces(v: number): string {
  const n = Math.abs(v);
  if (n >= 1900) return '两个车';
  if (n >= 900) return '一个车';
  if (n >= 420) return '一个马或炮';
  if (n >= 200) return '一个士象';
  if (n >= 90) return '一个兵';
  return '一点点';
}

// ───────────────────────── 静态兑子计算（SEE） ─────────────────────────

/**
 * 能吃到 (x,y) 的所有 side 方着法，且走完之后自己不违规。
 *
 * 直接复用规则引擎的走子生成，而不是另写一套"谁攻击谁"的判断——
 * 另写一套就等于把马腿、炮架、象眼这些规则再实现一遍，
 * 迟早和主引擎对不上，那时候教学内容就开始胡说了。
 */
export function attackersOf(b: Board, x: number, y: number, side: Color): Move[] {
  const out: Move[] = [];
  for (const m of pseudoMoves(b, side)) {
    if (m.tx !== x || m.ty !== y) continue;
    const nb = applyMove(b, m);
    if (isInCheck(nb, side) || kingsFacing(nb)) continue; // 走完自己挂了，不算能吃
    out.push(m);
  }
  return out;
}

/** 攻击者里最便宜的那个——兑子永远从最小的子开始换 */
function cheapestAttacker(b: Board, x: number, y: number, side: Color): Move | null {
  let best: Move | null = null;
  let bestVal = Infinity;
  for (const m of attackersOf(b, x, y, side)) {
    const v = PIECE_VALUE[b[m.fy][m.fx]!.t];
    if (v < bestVal) {
      bestVal = v;
      best = m;
    }
  }
  return best;
}

/**
 * 静态兑子：side 方在 (x,y) 上一路吃下去，最后**净赚**多少分（不会是负数）。
 *
 * 每一层双方都可以选择"不吃了"，所以取 max(0, …)：兑子兑到亏本的时候，
 * 正常人会停手，不会硬换。这一条是整个算法的关键——少了它，
 * 会把"对方可以吃你的车但要赔一个车加一个马"也算成你在白送车。
 *
 * 返回 0 表示"这个子是安全的"：要么没人能吃，要么吃了不划算。
 */
export function seeAt(b: Board, x: number, y: number, side: Color): number {
  const victim = b[y][x];
  if (!victim || victim.c === side) return 0;
  if (victim.t === 'K') return PIECE_VALUE.K; // 理论上不会走到这里，兜底
  const att = cheapestAttacker(b, x, y, side);
  if (!att) return 0;
  const nb = applyMove(b, att);
  const gain = PIECE_VALUE[victim.t] - seeAt(nb, x, y, other(side));
  return Math.max(0, gain);
}

// ───────────────────────── 白送的子 ─────────────────────────

export interface Hanging {
  x: number;
  y: number;
  t: PType;
  /** 「马」「车」这样的中文名，直接进文案 */
  name: string;
  /** 对方把这个子吃掉能净赚多少 */
  loss: number;
  /** 对方用哪一手来吃 */
  by: Move;
  /** 「车八进五」这样的记谱 */
  byText: string;
  /** 吃你的是对方的什么子 */
  byName: string;
}

/**
 * 现在盘面上，me 方有哪些子是**对方下一手就能白吃**的。
 *
 * 注意这里问的是净赚：对方吃你的马你能吃回他的车，那不叫白送，不列进来。
 * 业余棋手输棋六成是这一条没看见，所以这是教练模式最主要的报警来源。
 */
export function hangingPieces(b: Board, me: Color): Hanging[] {
  const opp = other(me);
  const out: Hanging[] = [];
  for (let y = 0; y < b.length; y++) {
    for (let x = 0; x < b[y].length; x++) {
      const p = b[y][x];
      if (!p || p.c !== me || p.t === 'K') continue;
      const loss = seeAt(b, x, y, opp);
      if (loss <= 0) continue;
      const by = cheapestAttacker(b, x, y, opp)!;
      out.push({
        x,
        y,
        t: p.t,
        name: pieceName(p.t, me),
        loss,
        by,
        byText: moveToText(b, by),
        byName: pieceName(b[by.fy][by.fx]!.t, opp),
      });
    }
  }
  return out.sort((a, b2) => b2.loss - a.loss);
}

/** 盘面上 me 方最大的一处漏洞，没有就返回 null */
export function worstHanging(b: Board, me: Color): Hanging | null {
  return hangingPieces(b, me)[0] ?? null;
}

// ───────────────────────── 一步杀 ─────────────────────────

/**
 * side 方有没有**一步就能将死**对方的着法。
 *
 * 先用"这手有没有将军"过滤，再去验有没有解法：不将军的着法不可能是杀棋，
 * 这一层过滤能把候选从四十几手砍到三五手，足够在落子瞬间跑完。
 */
export function mateInOne(b: Board, side: Color): Move | null {
  const opp = other(side);
  for (const m of legalMoves(b, side)) {
    const nb = applyMove(b, m);
    if (!isInCheck(nb, opp)) continue; // 不将军就不可能是一步杀
    if (statusAfter(nb, opp) !== 'playing') return m;
  }
  return null;
}

/** side 方有没有能直接将军的着法（不一定是杀） */
export function checkingMoves(b: Board, side: Color): Move[] {
  const opp = other(side);
  return legalMoves(b, side).filter((m) => isInCheck(applyMove(b, m), opp));
}

// ───────────────────────── 一手棋的风险评估 ─────────────────────────

/** 风险类型。顺序就是严重程度，前面的优先报 */
export type RiskKind =
  /** 走完之后对方一步就能把你将死 */
  | 'mate-next'
  /** 你刚走过去的那个子直接被白吃 */
  | 'hang-moved'
  /** 吃了小的，丢了大的 */
  | 'greedy'
  /** 对方本来就在威胁你的子，这一手没管它 */
  | 'ignored-threat'
  /** 这一手让别的子失去了保护 */
  | 'hang-other';

export interface MoveRisk {
  kind: RiskKind;
  /** 1 小问题 · 2 明显亏 · 3 严重（丢车级或被将死） */
  severity: 1 | 2 | 3;
  /** 净亏多少分（吃到的子已经扣掉了） */
  net: number;
  /** 一句话警告，轻提示级别用这个 */
  brief: string;
  /** 具体到子和着法，标准提示级别用这个 */
  detail: string;
  /** 涉及的那个子在哪，界面要把它高亮出来 */
  spot?: { x: number; y: number };
  /** 对方的惩罚着法，界面要画箭头 */
  punish?: Move;
}

/** 报警门槛：亏不到一个兵就别吵，不然全程都在弹提示，用户会直接关掉 */
const RISK_MIN = 90;

/**
 * 评估"如果我走这一手，会出什么事"。这是教练模式的核心。
 *
 * 只用静态计算，不搜索：落子那一刻必须立刻有反应。
 * 算法就是把对方接下来能做的**最狠的一件事**找出来：
 *   要么一步将死你，要么白吃你最贵的那个子。
 * 然后减去你这一手吃到的东西，得到净账。净账亏得多才报警。
 *
 * 返回 null = 这一手没有明显问题（注意：不等于这是好棋，
 * 「好不好」要问搜索引擎，这里只管「有没有掉坑」）。
 */
export function moveRisk(before: Board, m: Move, me: Color): MoveRisk | null {
  const opp = other(me);
  const moved = before[m.fy][m.fx];
  if (!moved || moved.c !== me) return null;
  const after = applyMove(before, m);

  // 走完就把对方将死了，那当然没风险
  if (statusAfter(after, opp) !== 'playing') return null;

  // ① 最严重：对方一步杀
  const mate = mateInOne(after, opp);
  if (mate) {
    return {
      kind: 'mate-next',
      severity: 3,
      net: -PIECE_VALUE.K,
      brief: '小心，走完这一步对方就能把你将死。',
      detail: `走完这一步，对方走 ${moveToText(after, mate)} 就是绝杀，你没有解法。`,
      punish: mate,
    };
  }

  // ② 算净账：我这手吃到多少，对方接下来最多能白吃我多少
  const captured = before[m.ty][m.tx];
  const gain = captured ? PIECE_VALUE[captured.t] : 0;
  const worst = worstHanging(after, me);
  const threat = worst?.loss ?? 0;
  const net = gain - threat;
  if (!worst || net > -RISK_MIN) return null;

  const severity: 1 | 2 | 3 = -net >= 900 ? 3 : -net >= 420 ? 2 : 1;
  const spot = { x: worst.x, y: worst.y };
  const movedHere = worst.x === m.tx && worst.y === m.ty;

  // ③ 分类。分类决定讲给用户听的那句话，也决定错误画像往哪一栏记。
  //
  // 顺序有讲究：**只要这一手吃了子而且吃亏，一律算贪吃**，哪怕被吃的
  // 正是刚吃完的那个子。对用户来说这两种情况是同一个毛病——"看见能吃就吃，
  // 没算账"，给的建议也一样。分成两类只会让画像上的数字没人看得懂。
  let kind: RiskKind;
  if (captured && gain < threat) kind = 'greedy';
  else if (movedHere) kind = 'hang-moved';
  else if (wasAlreadyThreatened(before, me, worst)) kind = 'ignored-threat';
  else kind = 'hang-other';

  // 文案按需拼，不要写成一整张表。
  // 写成表的话每个分支的模板串都会被求值一遍，而 greedy 那条要读 captured——
  // 没吃子的时候 captured 是 null，整个函数直接崩在这里。
  let brief: string;
  let detail: string;
  switch (kind) {
    case 'greedy': {
      const got = pieceName(captured!.t, opp);
      brief = `这里有风险：吃到的不如丢掉的多。`;
      detail = movedHere
        ? `你吃掉了对方的${got}（${gain} 分），但你的${worst.name}停在那里没有保护，对方走 ${worst.byText} 就用${worst.byName}吃回去（${PIECE_VALUE[worst.t]} 分），这笔买卖净亏约${inPieces(net)}。`
        : `你吃到了对方的${got}（${gain} 分），但忽略了自己的${worst.name}——对方走 ${worst.byText} 就能把它吃掉（${PIECE_VALUE[worst.t]} 分），净亏约${inPieces(net)}。`;
      break;
    }
    case 'hang-moved':
      brief = `这里有风险：你的${worst.name}走过去会被吃。`;
      detail = `你的${worst.name}走到这里没有足够的保护，对方走 ${worst.byText}，用${worst.byName}就能把它吃掉，净亏约${inPieces(threat)}。`;
      break;
    case 'ignored-threat':
      brief = `这里有风险：对方正在捉你的${worst.name}，这一手没管它。`;
      detail = `对方的${worst.byName}本来就盯着你的${worst.name}，这一手没有解决它。对方走 ${worst.byText} 就能吃掉，净亏约${inPieces(threat)}。`;
      break;
    default:
      brief = `这里有风险：你的${worst.name}会失去保护。`;
      detail = `走完这一步，你的${worst.name}就没人保护了，对方走 ${worst.byText} 可以直接吃掉，净亏约${inPieces(threat)}。`;
  }

  return { kind, severity, net, brief, detail, spot, punish: worst.by };
}

/** 这个子在我走这一手**之前**就已经被对方盯上了吗 */
function wasAlreadyThreatened(before: Board, me: Color, h: Hanging): boolean {
  const p = before[h.y]?.[h.x];
  if (!p || p.c !== me || p.t !== h.t) return false; // 这个子刚才不在那儿
  return seeAt(before, h.x, h.y, other(me)) > 0;
}

// ───────────────────────── 错误画像用的标签 ─────────────────────────

/**
 * 错误类型标签。和复盘的五维（safety/mate/tactic/endgame/opening）是两回事：
 * 五维回答"该练哪一块"，标签回答"你是个什么毛病的棋手"。
 *
 * 比如同样归到 safety，"贪吃"和"只顾自己不看对方"是完全不同的两种人，
 * 给的建议也完全不同——前者要学会算兑子账，后者要养成落子前看一眼对方的习惯。
 */
export type ErrTag = 'hang' | 'greedy' | 'missed-threat' | 'walk-into-mate' | 'missed-mate' | 'slow';

export const ERR_INFO: Record<ErrTag, { name: string; desc: string; advice: string }> = {
  hang: {
    name: '送子',
    desc: '把子走到没有保护的地方，被对方直接吃掉',
    advice: '落子前先看一眼：这个子走过去，谁能吃它？我能不能吃回来？',
  },
  greedy: {
    name: '贪吃',
    desc: '为了吃对方一个小子，丢了自己更大的子',
    advice: '吃子之前先算账：我吃到多少分，对方能吃回多少分。亏本的子宁可不吃。',
  },
  'missed-threat': {
    name: '漏看威胁',
    desc: '对方已经在捉你的子了，你还在忙自己的事',
    advice: '对方每走一手，先问："他这一步想干什么？"再想自己要干什么。',
  },
  'walk-into-mate': {
    name: '漏将',
    desc: '走完一步之后被对方直接将死',
    advice: '自己的将帅周围空了几个口子，心里要有数。尤其是底线和中路。',
  },
  'missed-mate': {
    name: '漏杀',
    desc: '眼前就有杀棋，没看见',
    advice: '对方老将周围子力少的时候，先花五秒钟找一遍将军的着法。',
  },
  slow: {
    name: '走软',
    desc: '没有明显失误，但错过了更主动的下法',
    advice: '这是水平问题不是习惯问题，多做战术题会慢慢变好。',
  },
};

/**
 * 给复盘里的一手失误打标签。
 *
 * 输入是**引擎已经判定这手亏了分**之后的局面，这里只负责回答"亏在哪种毛病上"。
 * 判断依据全是规则算出来的事实，没有一处是"看起来像"。
 */
export function tagMistake(
  before: Board,
  m: Move,
  me: Color,
  opts: { missedMate?: boolean; loss: number },
): ErrTag {
  if (opts.missedMate) return 'missed-mate';
  const r = moveRisk(before, m, me);
  if (!r) return 'slow';
  if (r.kind === 'mate-next') return 'walk-into-mate';
  if (r.kind === 'greedy') return 'greedy';
  if (r.kind === 'ignored-threat') return 'missed-threat';
  return 'hang';
}

// ───────────────────────── 局面速览（讲解层要用的事实） ─────────────────────────

export interface Snapshot {
  /** 我方子力减对方子力（不含将帅） */
  material: number;
  /** 我在被将军吗 */
  inCheck: boolean;
  /** 我有没有一步杀 */
  myMateInOne: Move | null;
  /** 对方有没有一步杀（轮到我走，所以这是我必须挡的） */
  oppMateInOne: Move | null;
  /** 我这边白送的子 */
  myHanging: Hanging[];
  /** 对方白送的子（我可以去吃） */
  oppHanging: Hanging[];
  /** 还剩多少大子（车马炮），用来判断进没进残局 */
  bigPieces: number;
  phase: 'opening' | 'middle' | 'endgame';
}

/**
 * 把当前局面整理成一份**事实清单**。
 *
 * 讲解层（llm.ts）拿到的就是这个，它不会拿到棋盘本身。
 * 这样做的目的很直接：模型看不到棋盘，就编不出"你的车在二路"这种假话。
 */
export function snapshot(b: Board, me: Color, ply = 0): Snapshot {
  const opp = other(me);
  let material = 0;
  let big = 0;
  for (const row of b) {
    for (const p of row) {
      if (!p || p.t === 'K') continue;
      material += p.c === me ? PIECE_VALUE[p.t] : -PIECE_VALUE[p.t];
      if (p.t === 'R' || p.t === 'H' || p.t === 'C') big++;
    }
  }
  const phase: Snapshot['phase'] = ply < 24 ? 'opening' : big <= 4 ? 'endgame' : 'middle';
  return {
    material,
    inCheck: isInCheck(b, me),
    myMateInOne: mateInOne(b, me),
    oppMateInOne: mateInOne(b, opp),
    myHanging: hangingPieces(b, me),
    oppHanging: hangingPieces(b, opp),
    bigPieces: big,
    phase,
  };
}
