/**
 * 棋规单元测试。
 *
 * 这是整个产品最不能出错的一层：AI 教学、复盘打分、出题全都建立在
 * "规则是对的"这个前提上。规则错一点，上面所有的教学内容都会变成胡说。
 * 所以这里不测"大致能走"，而是逐条测中国象棋里每一条容易写错的规则。
 */
import { describe, expect, it } from 'vitest';
import {
  COLS,
  ROWS,
  applyMove,
  findKing,
  initialBoard,
  isInCheck,
  kingsFacing,
  legalMoves,
  statusAfter,
  type Board,
} from '../src/xiangqi/rules';
import { board, bare, destsOf, mv, put } from './helpers';

describe('棋盘初始化', () => {
  it('9 列 10 行', () => {
    const b = initialBoard();
    expect(b.length).toBe(ROWS);
    expect(b[0].length).toBe(COLS);
    expect(ROWS).toBe(10);
    expect(COLS).toBe(9);
  });

  it('开局 32 个子，红黑各 16', () => {
    const b = initialBoard();
    const all = b.flat().filter(Boolean);
    expect(all.length).toBe(32);
    expect(all.filter((p) => p!.c === 'r').length).toBe(16);
    expect(all.filter((p) => p!.c === 'b').length).toBe(16);
  });

  it('底线次序是 车马象士将士象马车', () => {
    const b = initialBoard();
    expect(b[0].map((p) => p!.t).join('')).toBe('RHEAKAEHR');
    expect(b[9].map((p) => p!.t).join('')).toBe('RHEAKAEHR');
  });

  it('炮在第 3 线，兵卒在河沿且隔一个', () => {
    const b = initialBoard();
    expect(b[2][1]!.t).toBe('C');
    expect(b[2][7]!.t).toBe('C');
    expect(b[7][1]!.t).toBe('C');
    expect(b[7][7]!.t).toBe('C');
    for (let x = 0; x < COLS; x++) {
      expect(b[3][x] ? 'P' : '.').toBe(x % 2 === 0 ? 'P' : '.');
      expect(b[6][x] ? 'P' : '.').toBe(x % 2 === 0 ? 'P' : '.');
    }
  });

  it('开局红方有 44 种合法走法（象棋公认值）', () => {
    // 车各 2、马各 2、炮各 17（横 9 竖 8，扣掉自己占的）、兵各 1、仕各 2、相各 2、帅 1
    expect(legalMoves(initialBoard(), 'r').length).toBe(44);
    expect(legalMoves(initialBoard(), 'b').length).toBe(44);
  });
});

describe('帅/将：九宫限制与照面', () => {
  /**
   * 测帅的走法时，黑将那一路要先垫一个子。
   * 否则帅一横移就和黑将照面，测出来的是照面规则而不是帅的走法。
   */
  const withBlocker = (kx: number, ky: number): Board => {
    const b = bare(); // 黑将 (3,0)，红帅 (4,9)
    put(b, 4, 9, '.');
    put(b, 3, 5, 'p'); // 挡住三路，让帅可以自由进出三路而不照面
    put(b, kx, ky, 'K');
    return b;
  };

  it('帅在九宫中心有 4 个落点', () => {
    expect(destsOf(legalMoves(withBlocker(4, 8), 'r'), 4, 8)).toEqual(['3,8', '4,7', '4,9', '5,8'].sort());
  });

  it('帅不能走出九宫的横向边界', () => {
    const dests = destsOf(legalMoves(withBlocker(3, 8), 'r'), 3, 8);
    expect(dests).not.toContain('2,8'); // 出宫
    expect(dests).toEqual(['3,7', '3,9', '4,8'].sort());
  });

  it('帅不能过河（九宫纵向边界）', () => {
    const dests = destsOf(legalMoves(withBlocker(4, 7), 'r'), 4, 7);
    expect(dests).not.toContain('4,6'); // y=6 已出宫
    expect(dests).toEqual(['3,7', '4,8', '5,7'].sort());
  });

  it('帅在底线角上只有 2 个落点', () => {
    expect(destsOf(legalMoves(withBlocker(3, 9), 'r'), 3, 9)).toEqual(['3,8', '4,9'].sort());
  });

  it('将帅照面：同列无子时判定为对脸', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    expect(kingsFacing(b)).toBe(true);
  });

  it('将帅照面：中间有子就不算对脸', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . p . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    expect(kingsFacing(b)).toBe(false);
  });

  it('不能走出让双方将帅照面的一手', () => {
    // 红帅 (4,9)、黑将 (4,0)，中间只有一个红兵 (4,5) 挡着。
    // 红兵一旦横移，两个王就对上脸——那一手必须被判非法。
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . P . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    // 兵已过河，本来能横走 (3,4)/(5,4)，但那两手都会造成照面
    expect(destsOf(legalMoves(b, 'r'), 4, 4)).toEqual(['4,3']);
    expect(kingsFacing(applyMove(b, mv(4, 4, 4, 3)))).toBe(false);
  });

  it('对脸时帅只能横移躲开，不能沿着那一路走', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    const dests = destsOf(legalMoves(b, 'r'), 4, 9);
    expect(dests).not.toContain('4,8'); // 还在四路上，照面没解除
    expect(dests).toEqual(['3,9', '5,9'].sort());
  });
});

describe('仕/士：九宫斜走一格', () => {
  it('仕在九宫角上只能回中心', () => {
    const b = bare();
    put(b, 3, 9, 'A');
    expect(destsOf(legalMoves(b, 'r'), 3, 9)).toEqual(['4,8']);
  });

  it('仕在九宫中心有 4 个落点', () => {
    const b = bare(); // 黑将 (3,0)，红帅 (4,9)
    put(b, 4, 8, 'A');
    expect(destsOf(legalMoves(b, 'r'), 4, 8)).toEqual(['3,7', '3,9', '5,7', '5,9'].sort());
  });

  it('仕不能出九宫', () => {
    const b = bare();
    put(b, 4, 8, 'A');
    const dests = destsOf(legalMoves(b, 'r'), 4, 8);
    for (const d of dests) {
      const [x, y] = d.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThanOrEqual(5);
      expect(y).toBeGreaterThanOrEqual(7);
    }
  });
});

describe('相/象：田字走法、不过河、塞象眼', () => {
  it('相走田字，河这边有 4 个落点', () => {
    const b = bare();
    put(b, 4, 7, 'E'); // 红相在河这边中路
    expect(destsOf(legalMoves(b, 'r'), 4, 7)).toEqual(['2,5', '2,9', '6,5', '6,9'].sort());
  });

  it('相不能过河', () => {
    const b = bare();
    put(b, 4, 5, 'E'); // 河沿
    const dests = destsOf(legalMoves(b, 'r'), 4, 5);
    // 红方的"己方"是 y>=5，往 y=3 走就过河了
    for (const d of dests) expect(Number(d.split(',')[1])).toBeGreaterThanOrEqual(5);
    expect(dests).not.toContain('2,3');
    expect(dests).not.toContain('6,3');
  });

  it('塞象眼：田字中心有子就走不过去', () => {
    const b = bare();
    put(b, 4, 7, 'E');
    put(b, 3, 8, 'p'); // 塞住往左下的象眼
    const dests = destsOf(legalMoves(b, 'r'), 4, 7);
    expect(dests).not.toContain('2,9');
    expect(dests).toContain('6,9'); // 另一侧不受影响
  });

  it('象眼上是自己的子一样塞死', () => {
    const b = bare();
    put(b, 4, 7, 'E');
    put(b, 5, 8, 'P');
    expect(destsOf(legalMoves(b, 'r'), 4, 7)).not.toContain('6,9');
  });
});

describe('马：日字走法与蹩马腿', () => {
  it('空盘中心的马有 8 个落点', () => {
    const b = bare();
    put(b, 4, 5, 'H');
    expect(destsOf(legalMoves(b, 'r'), 4, 5).length).toBe(8);
  });

  it('蹩马腿：马腿位置有子，那两个方向都走不了', () => {
    const b = bare();
    put(b, 4, 5, 'H');
    put(b, 4, 4, 'p'); // 挡住"向上"的马腿
    const dests = destsOf(legalMoves(b, 'r'), 4, 5);
    expect(dests).not.toContain('3,3');
    expect(dests).not.toContain('5,3');
    expect(dests).toContain('3,7'); // 向下不受影响
    expect(dests).toContain('5,7');
    expect(dests.length).toBe(6);
  });

  it('马腿是自己的子照样蹩', () => {
    const b = bare();
    put(b, 4, 5, 'H');
    put(b, 3, 5, 'P'); // 挡住"向左"的马腿
    const dests = destsOf(legalMoves(b, 'r'), 4, 5);
    expect(dests).not.toContain('2,4');
    expect(dests).not.toContain('2,6');
    expect(dests.length).toBe(6);
  });

  it('马腿的斜对角有子不影响（那不是马腿）', () => {
    const b = bare();
    put(b, 4, 5, 'H');
    put(b, 3, 4, 'p'); // 斜对角，不是马腿
    expect(destsOf(legalMoves(b, 'r'), 4, 5).length).toBe(8);
  });

  it('马在角落走法受限', () => {
    const b = bare();
    put(b, 0, 9, 'H');
    expect(destsOf(legalMoves(b, 'r'), 0, 9)).toEqual(['1,7', '2,8'].sort());
  });
});

describe('车：直线走到底', () => {
  it('空盘中心的车横竖各扫到边', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    // 横向 8 格 + 纵向 9 格，其中往上只能走到 (4,1)，因为 (4,0) 是黑将（可吃）
    const dests = destsOf(legalMoves(b, 'r'), 4, 4);
    expect(dests).toContain('0,4');
    expect(dests).toContain('8,4');
    expect(dests).toContain('4,9');
    expect(dests).toContain('4,0'); // 吃将
    expect(dests.length).toBe(8 + 9);
  });

  it('车被己方子挡住，停在挡子前一格', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 6, 'P');
    const dests = destsOf(legalMoves(b, 'r'), 0, 9);
    expect(dests).toContain('0,7');
    expect(dests).not.toContain('0,6');
    expect(dests).not.toContain('0,5');
  });

  it('车吃掉对方第一个挡路的子，但不能穿过去', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 6, 'p');
    put(b, 0, 4, 'p');
    const dests = destsOf(legalMoves(b, 'r'), 0, 9);
    expect(dests).toContain('0,6');
    expect(dests).not.toContain('0,4');
  });
});

describe('炮：走直线，吃子必须隔炮架', () => {
  it('不吃子时走法和车一样', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    const dests = destsOf(legalMoves(b, 'r'), 0, 9);
    // 一路整条空着，炮和车一样一路扫到头
    expect(dests).toContain('0,1');
    expect(dests).toContain('0,0');
    // 底线向右走到 (4,9) 的红帅前面为止——炮不吃子时被己方子挡住，和车一个道理
    expect(dests).toContain('3,9');
    expect(dests).not.toContain('4,9'); // 己方的帅，吃不得
    expect(dests).not.toContain('5,9'); // 更不能穿过去
    expect(dests.length).toBe(9 + 3);
  });

  it('紧挨着的敌子吃不到（没有炮架）', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 8, 'p');
    const dests = destsOf(legalMoves(b, 'r'), 0, 9);
    expect(dests).not.toContain('0,8');
    // 整条竖线都被堵死了
    expect(dests.filter((d) => d.startsWith('0,')).length).toBe(0);
  });

  it('隔一个子可以打到后面的敌子', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 7, 'p'); // 炮架
    put(b, 0, 4, 'p'); // 目标
    const dests = destsOf(legalMoves(b, 'r'), 0, 9);
    expect(dests).toContain('0,4'); // 隔着炮架打到目标
    expect(dests).not.toContain('0,7'); // 炮架本身吃不到
    expect(dests).toContain('0,8'); // 炮架前的空格照常可走
    expect(dests).not.toContain('0,6'); // 炮架后面的空格走不过去
  });

  it('炮架后面的第二个子打不到（只能打第一个）', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 7, 'p');
    put(b, 0, 5, 'p');
    put(b, 0, 3, 'p');
    const dests = destsOf(legalMoves(b, 'r'), 0, 9);
    expect(dests).toContain('0,5');
    expect(dests).not.toContain('0,3');
  });

  it('炮架是自己的子也算数', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 7, 'P'); // 自己的兵当炮架
    put(b, 0, 4, 'p');
    expect(destsOf(legalMoves(b, 'r'), 0, 9)).toContain('0,4');
  });

  it('隔炮架打到的是自己的子，不能吃', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 7, 'p');
    put(b, 0, 4, 'P');
    expect(destsOf(legalMoves(b, 'r'), 0, 9)).not.toContain('0,4');
  });
});

describe('兵/卒：过河前后走法不同', () => {
  it('红兵没过河只能直进', () => {
    const b = bare();
    put(b, 0, 6, 'P');
    expect(destsOf(legalMoves(b, 'r'), 0, 6)).toEqual(['0,5']);
  });

  it('红兵过河后可以横走', () => {
    const b = bare();
    put(b, 1, 4, 'P'); // y=4 已过河
    expect(destsOf(legalMoves(b, 'r'), 1, 4)).toEqual(['0,4', '1,3', '2,4'].sort());
  });

  it('兵永远不能后退', () => {
    const b = bare();
    put(b, 1, 3, 'P');
    expect(destsOf(legalMoves(b, 'r'), 1, 3)).not.toContain('1,4');
  });

  it('黑卒方向相反', () => {
    const b = bare();
    put(b, 0, 3, 'p');
    expect(destsOf(legalMoves(b, 'b'), 0, 3)).toEqual(['0,4']);
    put(b, 0, 3, '.');
    put(b, 1, 5, 'p'); // 黑卒过河
    expect(destsOf(legalMoves(b, 'b'), 1, 5)).toEqual(['0,5', '1,6', '2,5'].sort());
  });

  it('兵走到底线只剩横走', () => {
    const b = bare();
    put(b, 1, 0, 'P'); // 红兵顶到黑方底线
    expect(destsOf(legalMoves(b, 'r'), 1, 0)).toEqual(['0,0', '2,0'].sort());
  });
});

describe('将军的判定', () => {
  it('车照将', () => {
    const b = bare(); // 黑将在 (3,0)
    put(b, 3, 5, 'R'); // 红车和黑将同列，中间无子
    expect(isInCheck(b, 'b')).toBe(true);
    expect(isInCheck(b, 'r')).toBe(false);
  });

  it('中间有子就不是将军', () => {
    const b = bare();
    put(b, 3, 5, 'R');
    put(b, 3, 3, 'p');
    expect(isInCheck(b, 'b')).toBe(false);
  });

  it('炮隔子照将', () => {
    const b = bare();
    put(b, 3, 6, 'C');
    put(b, 3, 3, 'p'); // 炮架
    expect(isInCheck(b, 'b')).toBe(true);
  });

  it('炮没有炮架不是将军', () => {
    const b = bare();
    put(b, 3, 6, 'C');
    expect(isInCheck(b, 'b')).toBe(false);
  });

  it('炮的炮架被吃掉，将军就解除了', () => {
    const b = bare();
    put(b, 3, 6, 'C');
    put(b, 3, 3, 'p');
    expect(isInCheck(b, 'b')).toBe(true);
    put(b, 3, 3, '.'); // 炮架没了
    expect(isInCheck(b, 'b')).toBe(false);
  });

  it('马照将，蹩腿就不算', () => {
    // 红马 (3,2) 日字跳到 (4,0) 正好照住黑将
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . H . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(true);
    put(b, 3, 1, 'p'); // 塞住马腿（马向上迈的那一步）
    expect(isInCheck(b, 'b')).toBe(false);
  });

  it('兵照将：顶在头上算，过河后贴在旁边也算', () => {
    const b = bare(); // 黑将 (3,0)
    put(b, 3, 1, 'P'); // 红兵顶在黑将头上
    expect(isInCheck(b, 'b')).toBe(true);
    put(b, 3, 1, '.');
    put(b, 2, 0, 'P'); // 红兵贴在黑将左边，已过河，可以横吃
    expect(isInCheck(b, 'b')).toBe(true);
  });

  it('自己的兵不会把自己将军', () => {
    const b = bare();
    put(b, 3, 1, 'p'); // 黑卒顶在黑将头上
    expect(isInCheck(b, 'b')).toBe(false);
  });

  it('对脸局面下，任何一方的合法着法都必须解除对脸', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    expect(kingsFacing(b)).toBe(true);
    for (const c of ['r', 'b'] as const) {
      const ms = legalMoves(b, c);
      expect(ms.length).toBeGreaterThan(0);
      for (const m of ms) expect(kingsFacing(applyMove(b, m))).toBe(false);
    }
  });
});

describe('应将：被将军时只能走解将的一手', () => {
  it('被车将军，所有合法着法都能解将', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(true);
    const moves = legalMoves(b, 'b');
    expect(moves.length).toBeGreaterThan(0);
    for (const m of moves) expect(isInCheck(applyMove(b, m), 'b')).toBe(false);
  });

  it('可以吃掉将军的子来解将', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . . R . . . .',
      '. . . . r . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(true);
    const texts = legalMoves(b, 'b').map((m) => `${m.fx},${m.fy}->${m.tx},${m.ty}`);
    expect(texts).toContain('4,2->4,1'); // 黑车吃掉红车
  });

  it('可以垫子解将', () => {
    // 红车 (4,5) 沿四路照住黑将 (4,0)；黑车 (1,3) 平到 (4,3) 就能垫上
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. r . . . . . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(true);
    const texts = legalMoves(b, 'b').map((m) => `${m.fx},${m.fy}->${m.tx},${m.ty}`);
    expect(texts).toContain('1,3->4,3'); // 垫车解将
    // 垫上之后确实不被将了
    expect(isInCheck(applyMove(b, mv(1, 3, 4, 3)), 'b')).toBe(false);
  });
});

describe('将死与困毙', () => {
  it('将死：被将军且一步也解不开', () => {
    // 红车 (4,1) 照将，另一只红车 (4,3) 保护它；两个过河兵封住 (3,0)/(5,0)。
    // 黑将三个落点全被控死，吃车也因为车有保护而不行 → 绝杀。
    const b = board(
      '. . . . k . . . .',
      '. . . P R P . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(true);
    expect(legalMoves(b, 'b')).toEqual([]);
    expect(statusAfter(b, 'b')).toBe('red-win');
  });

  it('将死只差封锁：两侧不封死就还有活路', () => {
    // 和上一题同一个杀型，只是拿掉了封住 (3,0)/(5,0) 的两个过河兵。
    // 车照样将军、照样被保护着吃不得，但黑将往旁边一挪就活了。
    // 这一对用例说明将死判定不是"被将军就算死"，而是要逐条走法验完。
    // 红帅摆在四路：黑将往三路或五路一躲就不同列了，不会误触照面规则
    const b = board(
      '. . . . k . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(true);
    const texts = legalMoves(b, 'b').map((m) => `${m.fx},${m.fy}->${m.tx},${m.ty}`).sort();
    expect(texts).toEqual(['4,0->3,0', '4,0->5,0']); // 吃车不行（有保护），只能躲
    expect(statusAfter(b, 'b')).toBe('playing');
  });

  it('困毙：没被将军但一步也走不了，同样判负', () => {
    // 黑将在 (3,0)，红车控住 (3,x) 以外的所有出路且不直接将军
    const b = board(
      '. . . k . . . . .',
      '. . R . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    expect(isInCheck(b, 'b')).toBe(false); // 没被将
    expect(legalMoves(b, 'b').length).toBe(0); // 但走不了：(4,0) 被车控、(3,1) 被车控
    expect(statusAfter(b, 'b')).toBe('red-win'); // 困毙判负（中国象棋规则）
  });

  it('还有走法时是 playing', () => {
    expect(statusAfter(initialBoard(), 'r')).toBe('playing');
    expect(statusAfter(initialBoard(), 'b')).toBe('playing');
  });
});

describe('吃子与落子', () => {
  it('applyMove 不改动原棋盘', () => {
    const b = initialBoard();
    const snapshot = JSON.stringify(b);
    applyMove(b, mv(0, 6, 0, 5));
    expect(JSON.stringify(b)).toBe(snapshot);
  });

  it('吃子后目标格变成吃子方的子，原格清空', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'p');
    const nb = applyMove(b, mv(0, 9, 0, 4));
    expect(nb[4][0]).toEqual({ t: 'R', c: 'r' });
    expect(nb[9][0]).toBeNull();
  });

  it('不能吃自己的子', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 6, 'P');
    expect(destsOf(legalMoves(b, 'r'), 0, 9)).not.toContain('0,6');
  });

  it('findKing 找得到两个王', () => {
    const b = initialBoard();
    expect(findKing(b, 'r')).toEqual([4, 9]);
    expect(findKing(b, 'b')).toEqual([4, 0]);
  });
});

describe('合法性总则：任何合法着法走完，自己都不能处于被将或对脸', () => {
  /** 从开局随机走 40 手，每一手都验证不变量 */
  it('随机对局 300 手全程满足不变量', () => {
    let b: Board = initialBoard();
    let c: 'r' | 'b' = 'r';
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 300; i++) {
      const moves = legalMoves(b, c);
      if (moves.length === 0) break;
      for (const m of moves) {
        const nb = applyMove(b, m);
        expect(isInCheck(nb, c)).toBe(false);
        expect(kingsFacing(nb)).toBe(false);
      }
      b = applyMove(b, moves[(rnd() * moves.length) | 0]);
      c = c === 'r' ? 'b' : 'r';
      // 两个王必须始终在盘上（王被吃掉说明将军判定漏了）
      expect(findKing(b, 'r')).not.toBeNull();
      expect(findKing(b, 'b')).not.toBeNull();
    }
  });
});
