/**
 * 一手棋在干什么——给引擎延伸出来的布局谱、破解谱配说明。
 *
 * 布局谱前面几个回合按定式写、说明是人写的；后面由皮卡鱼深算延伸，
 * 每一手都要配一句"这一手在干什么"，不然就是一串看不懂的招法。
 * 这里只说**看得出来的事**：哪个子出动了、过没过河、巡河还是骑河、
 * 吃了什么（是白吃还是兑子）、捉了谁、将没将军、补没补士象。不猜意图。
 */
import { applyMove, isInCheck, type Board, type Color, type Move, type PType } from './rules';
import { hangingPieces, PIECE_VALUE, attackersOf, other } from './teach';
import { pieceName } from './notation';
import { intentsOf } from './deepcoach';

/** 这一格在走棋方看来是第几排（0 = 自己的底线，9 = 对方底线） */
const rankOf = (y: number, c: Color) => (c === 'r' ? 9 - y : y);

export function noteMove(before: Board, m: Move, mover: Color): string {
  const p = before[m.fy][m.fx];
  if (!p) return '';
  const opp = other(mover);
  const took = before[m.ty][m.tx];
  const after = applyMove(before, m);
  const intents = intentsOf(before, m, mover);
  const from = rankOf(m.fy, mover);
  const to = rankOf(m.ty, mover);
  const fwd = to - from;
  const parts: string[] = [];
  const nm = (t: PType, c: Color) => pieceName(t, c);

  // 吃子：对方能不能吃回来——能吃回来、价值相当的叫兑子
  if (took) {
    const back = attackersOf(after, m.tx, m.ty, opp).length > 0;
    const v = PIECE_VALUE[took.t];
    const mine = PIECE_VALUE[p.t];
    if (back && Math.abs(v - mine) <= 60) parts.push(`兑${nm(took.t, took.c)}`);
    else if (back && mine > v) parts.push(`吃${nm(took.t, took.c)}（对方能吃回来，用${nm(p.t, mover)}换${nm(took.t, took.c)}）`);
    else parts.push(`吃掉${nm(took.t, took.c)}`);
  }

  if (!took) {
    switch (p.t) {
      case 'R':
        if (from === 0 && to === 0) parts.push('车横出，抢占要道');
        else if (from === 0 && fwd > 0 && to < 5) parts.push(to === 4 ? '出车巡河，控制河口' : '出直车');
        else if (from < 5 && to >= 5) parts.push(to >= 8 ? '车直插底线' : '车过河，压到对方阵地');
        else if (to === 4 && m.fy !== m.ty) parts.push('车退到河口，进可攻退可守');
        else if (m.fy === m.ty) parts.push('车平移，换一条线施压');
        else if (fwd < 0) parts.push('车退守');
        else parts.push('车进一步');
        break;
      case 'H':
        if (from === 0) parts.push(m.tx === 0 || m.tx === 8 ? '跳边马' : '跳正马出动');
        else if (m.tx === 4 && to <= 4) parts.push('盘头马，支援中路');
        else if (to === 4) parts.push('马跃河口');
        else if (from < 5 && to >= 5) parts.push('马过河，伺机踩卒、卧槽');
        else if (to >= 7) parts.push('马深入对方九宫附近');
        else if (fwd < 0) parts.push('马退回，加强防守');
        else parts.push('马调整位置');
        break;
      case 'C':
        if (m.tx === 4 && m.fx !== 4) parts.push('架中炮，瞄住中路');
        else if (from <= 2 && to === 4) parts.push('炮巡河，控制河沿');
        else if (from < 5 && to >= 5) parts.push(to >= 7 ? '炮沉到对方底线附近' : '炮过河骚扰');
        else if ((m.tx === 0 || m.tx === 8) && m.fy === m.ty) parts.push('平边炮，让出车路、准备兑车');
        else if (m.fy === m.ty && (m.tx === 3 || m.tx === 5)) parts.push('炮平到士角');
        else if (fwd < 0) parts.push('退炮，调整炮位');
        else if (m.fy === m.ty) parts.push('炮平移，换一条线');
        else parts.push('炮进一步');
        break;
      case 'P': {
        const pw = nm('P', mover);
        if (m.tx === 4 && fwd > 0) parts.push(to >= 5 ? `中${pw}过河，强攻中路` : `挺中${pw}，准备冲中路`);
        else if (from < 5 && to >= 5) parts.push(`${pw}过河`);
        else if (fwd > 0) parts.push(to >= 5 ? `${pw}往前拱` : `挺${pw}活马`);
        else parts.push(`${pw}横走`);
        break;
      }
      case 'A':
        parts.push(`补${nm('A', mover)}，巩固九宫`);
        break;
      case 'E':
        if (m.tx === 4) parts.push(`飞${nm('E', mover)}到中路，巩固中防`);
        else if (m.tx === 0 || m.tx === 8) parts.push(`飞边${nm('E', mover)}，让开中路`);
        else parts.push(fwd > 0 ? `飞${nm('E', mover)}` : `落${nm('E', mover)}`);
        break;
      case 'K':
        parts.push(`${nm('K', mover)}挪一步`);
        break;
    }
  }

  if (intents.includes('check')) parts.push('将军');
  else if (intents.includes('mate-threat')) parts.push('下一步有杀');
  // 捉子：走完之后对方新出现的被捉的子
  const before2 = new Set(hangingPieces(before, opp).map((h) => `${h.x},${h.y}`));
  const caught = hangingPieces(after, opp).filter((h) => !before2.has(`${h.x},${h.y}`));
  if (caught.length >= 3) parts.push(`同时捉住${caught.map((h) => nm(after[h.y][h.x]!.t, opp)).join('、')}`);
  else if (caught.length === 2) parts.push(`一手捉住${caught.map((h) => nm(after[h.y][h.x]!.t, opp)).join('和')}`);
  else if (caught.length === 1) parts.push(`捉${nm(after[caught[0].y][caught[0].x]!.t, opp)}`);
  if (intents.includes('escape')) parts.push('把被捉的子挪开');
  else if (intents.includes('defend')) parts.push('顺手保护了被捉的子');
  if (isInCheck(before, mover) && !parts.includes('将军')) parts.push('应将');
  return parts.join('，') + '。';
}
