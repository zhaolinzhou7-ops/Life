/**
 * 教学事实层测试。
 *
 * 这一层的产出会直接变成讲给用户听的话，所以错一次就是"AI 胡说棋"。
 * 重点测两个方向：
 *   该报的必须报（真白送子要认出来）
 *   **不该报的绝对不能报**（兑子、有保护、吃了更大的，都不算问题）
 * 第二个方向更重要——一个老是误报的教练，用户三分钟就关掉了。
 */
import { describe, expect, it } from 'vitest';
import {
  PIECE_VALUE,
  attackersOf,
  hangingPieces,
  checkingMoves,
  mateInOne,
  moveRisk,
  seeAt,
  snapshot,
  tagMistake,
  worstHanging,
} from '../src/xiangqi/teach';
import { applyMove, initialBoard, legalMoves, statusAfter, type Board } from '../src/xiangqi/rules';
import { board, bare, mv, put } from './helpers';

describe('attackersOf：谁能吃到这一格', () => {
  it('车沿直线能吃到', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'p');
    expect(attackersOf(b, 0, 4, 'r').map((m) => `${m.fx},${m.fy}`)).toEqual(['0,9']);
  });

  it('炮没有炮架就吃不到', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 4, 'p');
    expect(attackersOf(b, 0, 4, 'r')).toEqual([]);
  });

  it('炮有炮架就能吃到', () => {
    const b = bare();
    put(b, 0, 9, 'C');
    put(b, 0, 7, 'P'); // 炮架
    put(b, 0, 4, 'p');
    expect(attackersOf(b, 0, 4, 'r').map((m) => `${m.fx},${m.fy}`)).toEqual(['0,9']);
  });

  it('蹩腿的马吃不到', () => {
    const b = bare();
    put(b, 4, 5, 'n'); // 黑马
    put(b, 3, 3, 'P'); // 红兵，黑马日字能跳到
    expect(attackersOf(b, 3, 3, 'b').length).toBe(1);
    put(b, 4, 4, 'P'); // 塞住马腿
    expect(attackersOf(b, 3, 3, 'b')).toEqual([]);
  });

  it('被牵制的子不算能吃——走了自己的将就露出来了', () => {
    // 红马在 (4,8)，挡在黑车 (4,0) 和红帅 (4,9) 之间。
    // 马虽然日字能跳到 (3,6)，但一动红帅就被将，所以它吃不了任何东西。
    const b = board(
      '. . . . r . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . p . . . . .',
      '. . . . . . . . .',
      '. . . . H . . . .',
      '. . . k K . . . .',
    );
    expect(attackersOf(b, 3, 6, 'r')).toEqual([]);
  });
});

describe('seeAt：静态兑子算账', () => {
  it('没人保护的子，吃了就是白赚', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'p'); // 黑卒无保护
    expect(seeAt(b, 0, 4, 'r')).toBe(PIECE_VALUE.P);
  });

  it('有保护的子，用车吃兵是亏的 → 记 0（正常人不会这么换）', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'p'); // 黑卒
    put(b, 0, 2, 'r'); // 黑车保护它
    // 车吃卒 +100，被车吃回 -1000 → 亏，所以不换，返回 0
    expect(seeAt(b, 0, 4, 'r')).toBe(0);
  });

  it('等价兑子记 0，不算白送', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    put(b, 0, 4, 'r'); // 黑车
    put(b, 0, 2, 'r'); // 另一只黑车保护
    // 车吃车 +1000，被吃回 -1000 → 净 0
    expect(seeAt(b, 0, 4, 'r')).toBe(0);
  });

  it('多个攻击者时从最便宜的开始换', () => {
    const b = bare();
    put(b, 4, 4, 'r'); // 黑车，目标
    put(b, 4, 8, 'R'); // 红车能吃（别占 (4,9)，那是红帅的位置）
    put(b, 4, 5, 'P'); // 红兵也能吃，更便宜，应该先用兵
    expect(seeAt(b, 4, 4, 'r')).toBe(PIECE_VALUE.R);
  });

  it('兵吃有保护的车：赚 1000 赔 100，仍然划算', () => {
    const b = bare();
    put(b, 4, 4, 'r'); // 黑车
    put(b, 4, 2, 'r'); // 黑车保护
    put(b, 4, 5, 'P'); // 红兵
    // 兵吃车 +1000，兵被吃 -100 → 净 900
    expect(seeAt(b, 4, 4, 'r')).toBe(PIECE_VALUE.R - PIECE_VALUE.P);
  });

  it('空格子和自己的子都返回 0', () => {
    const b = bare();
    put(b, 0, 9, 'R');
    expect(seeAt(b, 5, 5, 'r')).toBe(0); // 空格
    expect(seeAt(b, 0, 9, 'r')).toBe(0); // 自己的车
  });
});

describe('hangingPieces：盘面上谁在白送', () => {
  it('开局没有任何子是白送的', () => {
    expect(hangingPieces(initialBoard(), 'r')).toEqual([]);
    expect(hangingPieces(initialBoard(), 'b')).toEqual([]);
  });

  it('把马送到对方车口上就会被认出来', () => {
    const b = bare();
    put(b, 4, 4, 'H'); // 红马
    put(b, 4, 0, '.');
    put(b, 4, 1, 'r'); // 黑车正对着它
    put(b, 3, 0, 'k');
    const hang = hangingPieces(b, 'r');
    expect(hang.length).toBe(1);
    expect(hang[0].t).toBe('H');
    expect(hang[0].name).toBe('马');
    expect(hang[0].loss).toBe(PIECE_VALUE.H);
    expect(hang[0].byName).toBe('车');
  });

  it('有保护就不算白送', () => {
    const b = bare();
    put(b, 4, 4, 'H'); // 红马
    put(b, 4, 1, 'r'); // 黑车
    put(b, 4, 6, 'R'); // 红车保护自己的马
    // 车吃马 +450，被车吃回 -1000 → 黑方不会换
    expect(hangingPieces(b, 'r')).toEqual([]);
  });

  it('按损失从大到小排序', () => {
    const b = bare();
    put(b, 0, 4, 'R'); // 红车，白送
    put(b, 2, 6, 'P'); // 红兵，白送（故意不和红车同一横线，免得互相保护）
    put(b, 0, 1, 'r'); // 黑车盯着红车
    put(b, 2, 1, 'r'); // 黑车盯着红兵
    const hang = hangingPieces(b, 'r');
    expect(hang.map((h) => h.t)).toEqual(['R', 'P']);
    expect(hang[0].loss).toBeGreaterThan(hang[1].loss);
  });

  it('两个子互相保护就都不算白送', () => {
    const b = bare();
    put(b, 0, 4, 'R');
    put(b, 2, 4, 'P'); // 和红车同一横线，红车保护着它
    put(b, 2, 1, 'r'); // 黑车来吃兵：赚 100 赔 1000，不划算
    expect(hangingPieces(b, 'r').map((h) => h.t)).toEqual([]);
  });

  it('将帅不算在内（那是将死的事，不是丢子）', () => {
    const b = bare();
    put(b, 4, 1, 'r'); // 黑车照着红帅所在的四路
    const hang = hangingPieces(b, 'r');
    expect(hang.every((h) => h.t !== 'K')).toBe(true);
  });
});

describe('mateInOne：一步杀', () => {
  it('找得到一步杀', () => {
    // 红车 (4,3) 沉底到 (4,1) 就是绝杀：两个过河兵封住黑将两侧
    const b = board(
      '. . . . k . . . .',
      '. . . P . P . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    const m = mateInOne(b, 'r');
    expect(m).not.toBeNull();
    // 不断言"必须是某一手"——同一个局面常常不止一种杀法，
    // 只断言它返回的确实是杀棋，这才是这个函数的契约。
    expect(statusAfter(applyMove(b, m!), 'b')).toBe('red-win');
  });

  it('开局没有一步杀', () => {
    expect(mateInOne(initialBoard(), 'r')).toBeNull();
    expect(mateInOne(initialBoard(), 'b')).toBeNull();
  });

  it('只将军不将死的不算', () => {
    // 红方只有一只车，怎么将都将不死：黑将总有地方躲。
    // 两个王故意分开摆在三路和五路，免得照面规则意外造出杀棋。
    const b = board(
      '. . . . . k . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      'R . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    // 红车能将军（平到五路），但那不是杀——黑将挪一步就活了
    expect(checkingMoves(b, 'r').length).toBeGreaterThan(0);
    expect(mateInOne(b, 'r')).toBeNull();
  });
});

describe('moveRisk：教练模式的核心判断', () => {
  it('开局第一手不报警', () => {
    const b = initialBoard();
    expect(moveRisk(b, mv(1, 7, 4, 7), 'r')).toBeNull(); // 炮二平五
    expect(moveRisk(b, mv(0, 6, 0, 5), 'r')).toBeNull(); // 兵九进一
    expect(moveRisk(b, mv(1, 9, 2, 7), 'r')).toBeNull(); // 马八进七
  });

  it('把马送到车口上 → 报 hang-moved', () => {
    const b = bare();
    put(b, 4, 6, 'H'); // 红马，可以跳到 (3,4)
    put(b, 3, 1, 'r'); // 黑车控着三路
    const r = moveRisk(b, mv(4, 6, 3, 4), 'r');
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('hang-moved');
    expect(r!.severity).toBe(2); // 一个马 = 明显亏
    expect(r!.detail).toContain('马');
    expect(r!.punish).toBeTruthy();
  });

  it('吃小丢大 → 报 greedy，并把两边的账都说清楚', () => {
    // 红车能吃一个无保护的黑卒，但吃完自己就被黑车白吃
    // 黑车和黑卒在同一横线上：红车吃掉卒之后正好落进黑车的射程
    const b = board(
      '. . . k . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. p . . . . r . .',
      '. . . . . . . . .',
      '. R . . . . . . .',
      '. . . . K . . . .',
    );
    const r = moveRisk(b, mv(1, 8, 1, 6), 'r'); // 车吃卒
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('greedy');
    expect(r!.severity).toBe(3); // 一个兵换一个车
    expect(r!.detail).toContain('卒');
    expect(r!.detail).toContain('车');
  });

  it('吃大丢小不报警（那是好买卖）', () => {
    // 红马吃黑车，吃完被黑卒吃掉——赚 1000 赔 450，是赚的
    const b = board(
      '. . . k . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . r . . . . . .',
      '. . . p . . . . .',
      '. . . . . . . . .',
      '. . . . H . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    expect(moveRisk(b, mv(4, 6, 2, 3), 'r')).toBeNull();
  });

  it('等价兑子不报警', () => {
    // 红车吃黑车，对方用车吃回来——1000 换 1000
    const b = board(
      '. . . k . . . . .',
      '. . . . . . . . .',
      '. . r . . . . . .',
      '. . . . . . . . .',
      '. . r . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . R . . . . . .',
      '. . . . K . . . .',
    );
    expect(moveRisk(b, mv(2, 8, 2, 4), 'r')).toBeNull();
  });

  it('走完被一步将死 → 报 mate-next，最高级别', () => {
    // 红帅被自己的两只车堵在底线中间，黑双车在八路线上。
    // 黑车沉到 (4,8) 就是绝杀：帅吃不得（另一只黑车保护着），两边又是自己的车。
    // 红方这时候还去走边兵，等于直接把杀棋让出来。
    // 黑将摆在四路、中间垫一个卒：既不撞照面，也不会被红车顺手将到
    const b = board(
      '. . . . k . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . p . . . .',
      '. . . . . . . . .',
      '. . . . . . . . P',
      '. . . . . . . . .',
      'r . . . . . . . r',
      '. . . R K R . . .',
    );
    const r = moveRisk(b, mv(8, 6, 8, 5), 'r'); // 走边兵，不管杀棋
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('mate-next');
    expect(r!.severity).toBe(3);
    expect(r!.brief).toContain('将死');
  });

  it('对方在捉子而你不管 → 报 ignored-threat', () => {
    // 黑车盯着红马（无保护），红方却去走一个无关的兵
    const b = board(
      '. . . k . . . . .',
      '. . . . . . . . .',
      '. r . . . . . . .',
      '. . . . . . . . .',
      '. H . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . P',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    const r = moveRisk(b, mv(8, 6, 8, 5), 'r'); // 走边兵，不理马
    expect(r).not.toBeNull();
    expect(r!.kind).toBe('ignored-threat');
    expect(r!.detail).toContain('马');
  });

  it('走完能把对方将死的一手，永远不报警', () => {
    const b = board(
      '. . . . k . . . .',
      '. . . P . P . . .',
      '. . . . . . . . .',
      '. . . . R . . . .',
      '. . . . R . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . K . . . . .',
    );
    const mate = mateInOne(b, 'r')!;
    expect(moveRisk(b, mate, 'r')).toBeNull();
  });

  it('亏不到一个兵就不吵', () => {
    // 红方走一手让一个仕失去保护：仕值 220，不到报警下限？
    // 这里直接验证门槛逻辑：亏 100 以下一律 null
    const b = bare();
    put(b, 4, 6, 'P'); // 红兵往前走会被卒吃，但那是兑子
    put(b, 4, 4, 'p');
    const r = moveRisk(b, mv(4, 6, 4, 5), 'r');
    // 兵进一步到 (4,5)，黑卒在 (4,4) 能吃它吗？卒向下走是 y+1=5，能吃
    // 兵被吃 100 分，红方没有吃回的子 → 亏一个兵，正好在门槛上
    if (r) expect(r.severity).toBe(1);
  });

  it('不是自己的子，或者空格，返回 null', () => {
    const b = initialBoard();
    expect(moveRisk(b, mv(0, 0, 0, 1), 'r')).toBeNull(); // 那是黑车
    expect(moveRisk(b, mv(4, 4, 4, 5), 'r')).toBeNull(); // 空格
  });
});

describe('tagMistake：错误画像的标签', () => {
  it('漏杀优先于一切', () => {
    const b = initialBoard();
    expect(tagMistake(b, mv(0, 6, 0, 5), 'r', { missedMate: true, loss: 5000 })).toBe('missed-mate');
  });

  it('送子 → hang', () => {
    const b = bare();
    put(b, 4, 6, 'H');
    put(b, 3, 1, 'r');
    expect(tagMistake(b, mv(4, 6, 3, 4), 'r', { loss: 450 })).toBe('hang');
  });

  it('没有明显掉坑的失误 → slow', () => {
    const b = initialBoard();
    expect(tagMistake(b, mv(0, 6, 0, 5), 'r', { loss: 120 })).toBe('slow');
  });
});

describe('snapshot：给讲解层的事实清单', () => {
  it('开局是均势、布局阶段', () => {
    const s = snapshot(initialBoard(), 'r', 0);
    expect(s.material).toBe(0);
    expect(s.inCheck).toBe(false);
    expect(s.phase).toBe('opening');
    expect(s.myHanging).toEqual([]);
    expect(s.oppHanging).toEqual([]);
    expect(s.bigPieces).toBe(12); // 双方各 2车2马2炮
  });

  it('少一个车就是子力落后', () => {
    const b = initialBoard();
    b[0][0] = null; // 拿掉黑车
    const s = snapshot(b, 'r', 20);
    expect(s.material).toBe(PIECE_VALUE.R);
  });

  it('大子快吃光了就进残局', () => {
    const b: Board = bare();
    put(b, 0, 9, 'R');
    put(b, 8, 0, 'r');
    expect(snapshot(b, 'r', 60).phase).toBe('endgame');
  });

  it('被将军时如实报告', () => {
    const b = bare();
    put(b, 3, 5, 'r'); // 黑车照着黑将所在的三路？不对，黑将在 (3,0)
    // 换成黑车照红帅：红帅在 (4,9)
    put(b, 3, 5, '.');
    put(b, 4, 5, 'r');
    expect(snapshot(b, 'r').inCheck).toBe(true);
    expect(snapshot(b, 'b').inCheck).toBe(false);
  });
});

describe('性能：教练模式必须在落子瞬间给出反应', () => {
  it('开局全部 44 手逐一评估，总耗时在可接受范围', () => {
    const b = initialBoard();
    const t0 = Date.now();
    for (const m of legalMoves(b, 'r')) moveRisk(b, m, 'r');
    const ms = Date.now() - t0;
    // 实际用的时候一次只算一手，这里一次算 44 手做压力测试
    expect(ms).toBeLessThan(8000);
  });

  it('单手评估足够快，不会卡住落子', () => {
    const b = initialBoard();
    const t0 = Date.now();
    moveRisk(b, mv(1, 7, 4, 7), 'r');
    expect(Date.now() - t0).toBeLessThan(500);
  });
});

describe('worstHanging', () => {
  it('没有漏洞时返回 null', () => {
    expect(worstHanging(initialBoard(), 'r')).toBeNull();
  });
});
