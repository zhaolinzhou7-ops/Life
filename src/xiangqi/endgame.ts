/**
 * 残局知识：这是什么残局、书上怎么说、该怎么走。
 *
 * 原来教练到了残局和中局一个样：只会说"这一手亏了多少"。可残局最要紧的恰恰是
 * 中局里用不上的那些东西——
 *   这个子力组合**书上是赢还是和**？（多一个车也可能是和棋：单车对士象全）
 *   赢的一方**怎么赢**、守的一方**怎么守**？（帅要助攻、士象不能散……）
 * 不知道这些，多子的一方走半天走不出结果，少子的一方早早就放弃了。
 *
 * 结论的来源，按可信度：
 *   1. 残局库（endgamelib.json）：引擎双方实战下到底验证过的局面和书上结论；
 *   2. 下面这张表：只收**最常见、没有争议**的定论（单车例和士象全这一类）。
 *      拿不准的组合一律不写，宁缺毋滥——错的定论比没有定论更糟；
 *   3. 具体这个局面到底怎样，永远以引擎算出来的为准。书上说例胜，局面可能已经走坏了。
 */
import type { Board, Color } from './rules';
import { fromFen } from './notation';
import { allEndgames, type EndgamePos } from './library';

// ───────────────────────── 子力 ─────────────────────────

export interface SideMaterial {
  R: number;
  H: number;
  C: number;
  P: number;
  A: number;
  E: number;
  /** 过了河、还没沉底的兵（高兵/低兵） */
  liveP: number;
  /** 沉到底线的兵（老兵）：只能横走，威力最小 */
  bottomP: number;
}

export function sideMaterial(b: Board, c: Color): SideMaterial {
  const m: SideMaterial = { R: 0, H: 0, C: 0, P: 0, A: 0, E: 0, liveP: 0, bottomP: 0 };
  b.forEach((row, y) =>
    row.forEach((p) => {
      if (!p || p.c !== c || p.t === 'K') return;
      m[p.t]++;
      if (p.t === 'P') {
        const bottom = c === 'r' ? y === 0 : y === 9;
        const crossed = c === 'r' ? y <= 4 : y >= 5;
        if (bottom) m.bottomP++;
        else if (crossed) m.liveP++;
      }
    }),
  );
  return m;
}

/** 进攻子力（车马炮兵）的个数 */
const attackers = (m: SideMaterial) => m.R + m.H + m.C + m.P;

/** 粗略的进攻子力价值：判断谁是进攻方用 */
const attackValue = (m: SideMaterial) => m.R * 1000 + m.H * 450 + m.C * 500 + m.P * 100;

/**
 * 是不是残局：双方车马炮兵加起来不超过 6 个。
 * 和复盘分阶段（analysis.phaseAt）用同一条线，教练和复盘说的"残局"是同一个东西。
 */
export function isEndgame(b: Board): boolean {
  return attackers(sideMaterial(b, 'r')) + attackers(sideMaterial(b, 'b')) <= 6;
}

const NUM = ['', '', '双', '三', '四', '五'];

/** 进攻子力的叫法：车马炮兵，两个的叫"双车" */
export function attackLabel(m: SideMaterial): string {
  const part = (n: number, name: string) => (n ? `${n > 1 ? NUM[n] ?? n : ''}${name}` : '');
  return [part(m.R, '车'), part(m.H, '马'), part(m.C, '炮'), part(m.P, '兵')].join('');
}

/** 士象的叫法：士象全、单缺象、双士、光将…… */
export function guardLabel(m: SideMaterial): string {
  const { A, E } = m;
  if (A >= 2 && E >= 2) return '士象全';
  if (A >= 2 && E === 1) return '单缺象';
  if (A === 1 && E >= 2) return '单缺士';
  if (A >= 2) return '双士';
  if (E >= 2) return '双象';
  if (A === 1 && E === 1) return '单士象';
  if (A === 1) return '单士';
  if (E === 1) return '单象';
  return '';
}

/** 一方的全称：进攻子力 + 士象。什么都没有叫"光将" */
export function fullLabel(m: SideMaterial): string {
  const a = attackLabel(m);
  const g = guardLabel(m);
  return a + g || '光将';
}

// ───────────────────────── 书上的定论 ─────────────────────────

export type BookResult = 'win' | 'draw';

interface BookEntry {
  result: BookResult;
  /** 书上的说法 */
  book: string;
  /** 补充：要什么条件、难在哪 */
  note?: string;
}

/**
 * 最常见、没有争议的残局定论。键是"进攻方的进攻子力|守方全称"。
 * 进攻方的士象不进键：书上说"车兵对士象全"时不管进攻方有没有士象（炮类除外，炮要炮架，不收）。
 */
const BOOK: Record<string, BookEntry> = {
  '车|光将': { result: 'win', book: '单车例胜光将' },
  '车|单士': { result: 'win', book: '单车例胜单士' },
  '车|单象': { result: 'win', book: '单车例胜单象' },
  '车|双士': { result: 'win', book: '单车例胜双士' },
  '车|双象': { result: 'win', book: '单车例胜双象' },
  '车|单士象': { result: 'win', book: '单车例胜单士象' },
  '车|单缺士': { result: 'win', book: '单车胜单缺士', note: '要先破象，技术要求不低' },
  '车|单缺象': { result: 'win', book: '单车胜单缺象', note: '要先破士，技术要求不低' },
  '车|士象全': { result: 'draw', book: '单车例和士象全', note: '多一个车也赢不了：守方士象连环，车打不进去' },
  '车|马': { result: 'win', book: '单车例胜单马' },
  '车|炮': { result: 'win', book: '单车例胜单炮' },
  '车|马士象全': { result: 'draw', book: '单车例和马士象全' },
  '车|炮士象全': { result: 'draw', book: '单车例和炮士象全' },
  '车|炮双士': { result: 'draw', book: '单车例和炮双士', note: '炮躲在士后面当"炮架"，车拿它没办法' },
  '双车|士象全': { result: 'win', book: '双车例胜士象全' },
  '车马|士象全': { result: 'win', book: '车马例胜士象全' },
  '车炮|士象全': { result: 'win', book: '车炮例胜士象全' },
  '车兵|士象全': { result: 'win', book: '车兵例胜士象全' },
  '马炮|士象全': { result: 'win', book: '马炮例胜士象全', note: '公认的胜势，技术要求很高' },
  '马|光将': { result: 'win', book: '单马例胜光将', note: '要帅配合' },
  '马|双士': { result: 'draw', book: '单马例和双士' },
  '兵|双士': { result: 'draw', book: '单兵例和双士' },
  '三兵|士象全': { result: 'win', book: '三兵例胜士象全', note: '要三个高兵；兵沉了底就赢不了' },
};

export interface EndgameInfo {
  /** "车兵对士象全"；双方子力相当时是"车对车" */
  name: string;
  /** 进攻方（子力多的一方）；子力相当为 null */
  attacker: Color | null;
  /** 书上的结论（查得到才有） */
  book?: BookEntry;
  /** 残局库里同一个子力组合的练习（可以直接去练） */
  practice?: { name: string; items: EndgamePos[] };
  /** 要领：进攻方怎么赢 / 守方怎么守 */
  tips: string[];
}

/** 残局库里每一组的子力签名，第一次用时算一遍 */
let libIndex: Map<string, { name: string; items: EndgamePos[] }> | null = null;
let libSize = -1;

function signature(b: Board): { key: string; attacker: Color | null } {
  const r = sideMaterial(b, 'r');
  const k = sideMaterial(b, 'b');
  const vr = attackValue(r);
  const vb = attackValue(k);
  if (vr === vb && attackLabel(r) === attackLabel(k)) return { key: `${fullLabel(r)}=${fullLabel(k)}`, attacker: null };
  const attacker: Color = vr > vb ? 'r' : vr < vb ? 'b' : attackers(r) >= attackers(k) ? 'r' : 'b';
  const [a, d] = attacker === 'r' ? [r, k] : [k, r];
  return { key: `${attackLabel(a)}|${fullLabel(d)}`, attacker };
}

function libraryIndex(): Map<string, { name: string; items: EndgamePos[] }> {
  const all = allEndgames();
  if (libIndex && libSize === all.length) return libIndex;
  const map = new Map<string, { name: string; items: EndgamePos[] }>();
  for (const e of all) {
    const p = fromFen(e.fen);
    if (!p) continue;
    const { key } = signature(p.board);
    // 同一个子力组合可能有"进攻"和"守和"两组（单车对马双士 / 马双士守单车）：按名字分开存，查的时候挑对应的那一组
    const k = `${key}#${e.name}`;
    const g = map.get(k) ?? { name: e.name, items: [] };
    g.items.push(e);
    map.set(k, g);
  }
  libIndex = map;
  libSize = all.length;
  return map;
}

/** 残局库里和这个局面子力组合相同的那一组。me 用来挑"你是进攻方"还是"你是守方"的那一组 */
function practiceFor(key: string, me: Color, attacker: Color | null): { name: string; items: EndgamePos[] } | undefined {
  const groups = [...libraryIndex().entries()].filter(([k]) => k.startsWith(key + '#')).map(([, g]) => g);
  if (!groups.length) return undefined;
  const iAttack = attacker === me;
  // 库里的 you 是练习者执的一方；进攻组里练习者是进攻方
  const fit = groups.find((g) => {
    const e = g.items[0];
    const p = fromFen(e.fen);
    if (!p) return false;
    return (signature(p.board).attacker === e.you) === iAttack;
  });
  return fit ?? groups[0];
}

/** 进攻方的要领：按手里有什么子来说 */
function attackTips(a: SideMaterial): string[] {
  const out: string[] = [];
  if (a.R) {
    out.push('车占中路或肋道，把对方的将逼到一边，再用帅控制中路');
    out.push('先破士象：砍掉一个，防守就连不起来了');
  }
  if (a.H) {
    out.push('马要靠近九宫才有威力——卧槽、挂角是马的杀点；小心被士象蹩马腿');
  }
  if (a.C) {
    out.push('炮要炮架才能将军：自己的帅、士都能当炮架，炮宜退在后面配合');
  }
  if (a.P) {
    out.push('兵不要急着沉底：停在对方二三路的高兵最有用，沉底的老兵只能横走');
    if (a.P >= 2) out.push('几个兵要连在一起推进，散开了各自都没威力');
  }
  out.push('帅也是进攻的子：走到中路或肋道，帮着控制对方的将');
  return out;
}

/** 守方的要领 */
function defendTips(d: SideMaterial): string[] {
  const out: string[] = [];
  if (d.A + d.E >= 2) out.push('士象不要散：连在一起互相保护，对方就很难打进来');
  out.push('将尽量待在九宫中间，别被赶到边上——边上最容易被将死');
  if (attackers(d)) out.push('能兑掉对方最后一个进攻子就是和棋，找机会兑');
  out.push('不要急：守和的一方只要不走错，60 回合不吃子就判和');
  return out;
}

/**
 * 这是什么残局。不是残局返回 null。
 * me 决定要领站在哪一边讲：你是进攻方就讲怎么赢，你是守方就讲怎么守。
 */
export function classifyEndgame(b: Board, me: Color): EndgameInfo | null {
  if (!isEndgame(b)) return null;
  const { key, attacker } = signature(b);
  const r = sideMaterial(b, 'r');
  const k = sideMaterial(b, 'b');
  if (!attacker) {
    const same = attackLabel(r) || '光将';
    return {
      name: `${same}对${same}`,
      attacker: null,
      tips: [
        '子力相当：谁先把帅（将）走到好位置、谁的兵先过河，谁就占先',
        '不要随便兑子：子力相当的残局，兑到最后多半是和棋',
        ...(r.P + k.P ? ['兵在残局里很值钱：保住自己的兵，找机会吃对方的兵'] : []),
      ],
    };
  }
  const [a, d] = attacker === 'r' ? [r, k] : [k, r];
  const name = `${attackLabel(a)}对${fullLabel(d)}`;
  const bookKey = key;
  return {
    name,
    attacker,
    book: BOOK[bookKey],
    practice: practiceFor(key, me, attacker),
    tips: attacker === me ? attackTips(a) : defendTips(d),
  };
}

/**
 * 一句话：这是什么残局、书上怎么说、这个局面引擎怎么看。
 * engineWin：引擎对这个局面的判断（你的视角，分数）。书上和引擎说法不一样时要说破，
 * 不然用户会以为有一方算错了——多子不等于能赢，这本身就是要学的。
 */
export function endgameHeadline(info: EndgameInfo, me: Color, myScore?: number, myMate?: number, short = false): string {
  const side = info.attacker === null ? '' : info.attacker === me ? '（你是进攻方）' : '（你是守方）';
  let s = `进入残局：${info.name}${side}。`;
  if (info.book) s += `书上：${info.book.book}${info.book.note && !short ? `——${info.book.note}` : ''}。`;
  if (short) return s;
  if (myMate !== undefined) {
    s += myMate > 0 ? `引擎已经算到 ${myMate} 步杀。` : `引擎算到对方 ${-myMate} 步杀，要顽强防守。`;
  } else if (myScore !== undefined) {
    const a = Math.abs(myScore);
    const word = a < 150 ? '和势' : myScore > 0 ? (a >= 900 ? '你大优' : '你占优') : a >= 900 ? '你大劣' : '你稍劣';
    s += `这个局面引擎看是「${word}」。`;
  }
  // 书上的结论和"子力多少"不一致时，一定要说破：多子的以为稳赢，少子的以为没救，两种都会走坏
  if (info.book?.result === 'draw' && info.attacker === me) s += '多子不等于能赢：这是书上的和棋，要看守方会不会守。';
  if (info.book?.result === 'draw' && info.attacker !== null && info.attacker !== me) s += '别灰心：这是书上的和棋，守住士象就有和。';
  if (info.book?.result === 'win' && info.attacker !== null && info.attacker !== me) {
    s += '书上是对方能赢的残局：尽量拖，等对方走软，60 回合不吃子就是和。';
  }
  return s;
}

// ───────────────────────── 残局练习：每一手的反馈 ─────────────────────────

export type DrillKind = 'best' | 'good' | 'slow' | 'threw-win' | 'lost-hold' | 'mistake';

export interface DrillVerdict {
  kind: DrillKind;
  /** 一句话，给练习的人看 */
  text: string;
  /** 严重到应该悔棋重走 */
  bad: boolean;
}

/** 分数到了这个数就算"赢定了的优势"（约多一个车） */
const WINNING = 700;

interface Scored {
  score: number;
  mateIn?: number;
}

const winning = (x: Scored) => (x.mateIn !== undefined ? x.mateIn > 0 : x.score >= WINNING);
const losing = (x: Scored) => (x.mateIn !== undefined ? x.mateIn < 0 : x.score <= -WINNING);

/**
 * 残局练习里你这一手走得怎么样——**按这一局的目标来判**。
 *
 * 残局和中局不一样：要赢的一方，只要还是赢棋，多绕几步不要紧；
 * 真正要命的是把"能赢"走成"赢不了"。要守和的一方反过来，只要还守得住就行，
 * 一步让对方有杀，前面守得再好也白费。所以不看"差了多少分"，看**结果变没变**。
 *
 * best/played 都是你的视角（走之前这个局面的首选 / 你走的这一手）。
 */
export function drillVerdict(target: 'win' | 'draw', best: Scored, played: Scored, isBest: boolean): DrillVerdict {
  const loss = Math.max(0, best.score - played.score);
  if (target === 'win') {
    if (winning(best) && !winning(played)) {
      const now = played.mateIn !== undefined && played.mateIn < 0
        ? `反而要被对方 ${-played.mateIn} 步杀`
        : losing(played)
          ? '局面反而落了下风'
          : '现在只剩和势了';
      return { kind: 'threw-win', bad: true, text: `这一手把胜势走丢了：${now}。悔一步，换一手再试。` };
    }
    if (best.mateIn !== undefined && best.mateIn > 0 && played.mateIn !== undefined && played.mateIn > best.mateIn + 1) {
      return {
        kind: 'slow',
        bad: false,
        text: `还是赢棋，但走软了：原来 ${best.mateIn} 步就能杀，现在要 ${played.mateIn} 步。残局里多走的每一步，都是给对方的机会。`,
      };
    }
  } else {
    if (!losing(best) && losing(played)) {
      const now = played.mateIn !== undefined && played.mateIn < 0 ? `对方 ${-played.mateIn} 步就能杀` : '对方的优势已经大到守不住';
      return { kind: 'lost-hold', bad: true, text: `这一手守不住了：${now}。悔一步，换一手再试。` };
    }
    if (best.mateIn !== undefined && best.mateIn < 0 && played.mateIn !== undefined && played.mateIn < 0 && -played.mateIn < -best.mateIn - 1) {
      return {
        kind: 'slow',
        bad: false,
        text: `被杀得更快了：原来还能撑 ${-best.mateIn} 步，现在只剩 ${-played.mateIn} 步。输棋的局面也要尽量拖，等对方走错。`,
      };
    }
  }
  if (isBest || loss <= 30) return { kind: 'best', bad: false, text: '好棋，和引擎的首选一样。' };
  if (loss < 300 || (winning(best) && winning(played))) {
    return { kind: 'good', bad: false, text: target === 'win' ? '可以，还是赢棋。' : '可以，还守得住。' };
  }
  return { kind: 'mistake', bad: loss >= 600, text: `这一手亏了约${loss >= 900 ? '一个车' : loss >= 420 ? '一个马炮' : `${Math.round(loss / 100)}个兵`}。` };
}
