/**
 * 布局体系：**讲思路，也要走得够深**。
 *
 * 原来每套只有 6～10 手，用户原话："多走几步，不要只走两三步就草草了事……认真按正常谱路去推演"。
 * 现在每一套：
 *   - 前面几个回合按定式写（openingspecs.ts，人写的着法和说明），
 *   - 之后由皮卡鱼深算延伸到 15 回合左右，每一手配"这一手在干什么"（movenote.ts），
 *   - 双方选择最多的地方补上变化，人写的变化也一样核对、延伸；
 *   - 每一手都记着引擎的评分，谱上的着法比引擎首选差得多的会标出来（江湖攻法的特征着）。
 * 数据由 tools/build-openings.ts 生成（openinglib.json），界面只读这一份。
 *
 * 为什么布局排在后面：业余棋手输棋六成是漏着、两成半是残局走不出结果，布局只占一成；
 * 但到了 1500 以上布局就是真瓶颈，那时候要的不是招法表，是每一手在干什么、对方怎么破。
 */
import lib from './openinglib.json';

export interface LineMove {
  t: string;
  why: string;
  /** 走完这一手，红方视角的局面分（车≈1000） */
  ev: number;
  /** 比引擎首选差多少（只记明显的） */
  loss?: number;
  /** 引擎首选（这一手差得多时） */
  best?: string;
  /** 定式谱上的（人写的）；没有这个标记的是引擎延伸的 */
  book?: boolean;
}

export interface Variation {
  name: string;
  /** 从主线第几手（从 0 数）分出去 */
  at: number;
  moves: LineMove[];
  final: string;
  /** 变招（和主线差不多一样好的另一手）还是错着（看着自然、其实亏）；不填是原来的变化 */
  kind?: 'alt' | 'trap';
}

export interface Opening {
  id: string;
  name: string;
  /** 体系：屏风马、过宫炮、士角炮…… */
  system: string;
  /** 这一套是谁的布局 */
  side: 'red' | 'black';
  tag: string;
  idea: string;
  /** 怎么破 */
  breaks: string;
  traps: string[];
  moves: LineMove[];
  /** 主线走完的局面判断 */
  final: string;
  variations: Variation[];
}

export const OPENINGS: Opening[] = lib as unknown as Opening[];

/** 体系的排列顺序：先中炮对各种应法（屏风马最常见），再是红方不走中炮的各种起手 */
export const SYSTEM_ORDER = ['屏风马', '三步虎', '左炮封车', '单提马', '反宫马', '顺炮', '列炮', '过宫炮', '士角炮', '飞相局', '仙人指路', '起马局'];

export const openingById = (id: string) => OPENINGS.find((o) => o.id === id);

/** 这一手的说明，带上引擎的意见（谱上的着法引擎不认可时说出来） */
export function moveNote(m: LineMove): string {
  if (!m.loss || !m.best) return m.why;
  return `${m.why}<br><span class="dim">引擎：这一手比 ${m.best} 差约 ${(m.loss / 100).toFixed(1)} 个兵。</span>`;
}

/**
 * 变招大扩充的数据（tools/expand-openings.ts 生成的 openingvars.json）：按需加载——
 * 二十套布局几百个变招、几千手讲解，不该塞进首屏的包里。
 *   - 主线、原有变化里引擎延伸的那些手，换成讲意义的说明（防住什么、威胁什么、接下来怎么走、引擎怎么看）；
 *   - 每个分岔点补上变招（和主线差不多一样好的另一手）、错着（看着自然、其实亏的一手），每条往下走十来手。
 * 人写的定式说明不动。
 */
type Extras = Record<string, { main: (LineMove | null)[]; vars: (LineMove | null)[][]; extra: Variation[] }>;
let extras: Promise<void> | null = null;
export function loadOpeningExtras(): Promise<void> {
  extras ??= import('./openingvars.json')
    .then((mod) => {
      const data = (mod as unknown as { default: Extras }).default;
      for (const o of OPENINGS) {
        const d = data[o.id];
        if (!d) continue;
        // 新讲解自己带着引擎的意见（"引擎更想走 X，这一手差约……"），旧的 loss/best 去掉，免得 moveNote 再挂一遍
        d.main.forEach((m, i) => {
          const cur = o.moves[i];
          if (m && cur && !cur.book && cur.t === m.t) o.moves[i] = { ...cur, why: m.why, loss: undefined, best: undefined };
        });
        d.vars.forEach((vs, k) =>
          vs.forEach((m, i) => {
            const cur = o.variations[k]?.moves[i];
            if (m && cur && !cur.book && cur.t === m.t) o.variations[k].moves[i] = { ...cur, why: m.why, loss: undefined, best: undefined };
          }),
        );
        for (const x of d.extra) {
          if (!o.variations.some((v) => v.at === x.at && v.moves[0]?.t === x.moves[0]?.t)) o.variations.push(x);
        }
      }
    })
    .catch(() => {
      // 加载失败（离线、网络断了）：照样用原来的谱，下次再试
      extras = null;
    });
  return extras;
}
