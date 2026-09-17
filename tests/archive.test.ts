/**
 * 棋局存档 + 错误画像测试。
 *
 * 画像这一块最容易出的问题不是算错，而是**在数据不够的时候乱下结论**。
 * 产品规格明写了"这是基于真实棋局数据的行为分析，不是凭空贴标签"，
 * 所以这里有相当一部分用例是在验证"它什么时候闭嘴"。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import {
  archiveFromBoard,
  archiveGame,
  clearArchive,
  decodeMoves,
  encodeMoves,
  gameCount,
  getGame,
  listGames,
  openGame,
  replay,
  setGameReview,
  type ArchivedGame,
} from '../src/xiangqi/archive';
import { behaviourOf, buildProfile, trainingFocus } from '../src/xiangqi/insight';
import { initialBoard, type Move } from '../src/xiangqi/rules';
import { toFen } from '../src/xiangqi/notation';
import { mv } from './helpers';

beforeEach(() => {
  memStore.clear();
  memStore.full = false;
});

describe('着法的紧凑编码', () => {
  it('编码再解码，原样回来', () => {
    const moves: Move[] = [mv(1, 7, 4, 7), mv(7, 2, 4, 2), mv(1, 9, 2, 7), mv(0, 3, 0, 4)];
    expect(decodeMoves(encodeMoves(moves))).toEqual(moves);
  });

  it('一手棋占 4 个字符，一盘 60 手不到 250 字节', () => {
    const moves = Array.from({ length: 60 }, () => mv(1, 7, 4, 7));
    expect(encodeMoves(moves).length).toBe(240);
  });

  it('空着法列表编码成空串', () => {
    expect(encodeMoves([])).toBe('');
    expect(decodeMoves('')).toEqual([]);
  });

  it('存档被写坏时解出已知的部分，不抛错', () => {
    expect(decodeMoves('1747xxxx')).toEqual([mv(1, 7, 4, 7)]);
    expect(decodeMoves('174')).toEqual([]); // 长度不足一手
  });
});

describe('重放', () => {
  it('N 手棋重放出 N+1 个局面', () => {
    const boards = replay(initialBoard(), [mv(1, 7, 4, 7), mv(7, 2, 4, 2)]);
    expect(boards.length).toBe(3);
    expect(boards[0][7][1]!.t).toBe('C'); // 走之前红炮还在原位
    expect(boards[1][7][4]!.t).toBe('C'); // 走完平到中路
    expect(boards[1][7][1]).toBeNull();
  });

  it('重放不改动传进来的棋盘', () => {
    const start = initialBoard();
    const snap = JSON.stringify(start);
    replay(start, [mv(1, 7, 4, 7)]);
    expect(JSON.stringify(start)).toBe(snap);
  });
});

describe('存档读写', () => {
  const sample = (over: Partial<ArchivedGame> = {}) => ({
    fen: toFen(initialBoard(), 'r'),
    moves: encodeMoves([mv(1, 7, 4, 7), mv(7, 2, 4, 2)]),
    side: 'r' as const,
    result: 'win' as const,
    level: '初级',
    ...over,
  });

  it('存进去能读出来', () => {
    const id = archiveGame(sample());
    expect(gameCount()).toBe(1);
    const g = getGame(id)!;
    expect(g.level).toBe('初级');
    expect(g.result).toBe('win');
    expect(g.d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('新的排在前面', () => {
    archiveGame(sample({ level: '第一盘' }));
    archiveGame(sample({ level: '第二盘' }));
    expect(listGames().map((g) => g.level)).toEqual(['第二盘', '第一盘']);
  });

  it('id 不重复', () => {
    const ids = new Set(Array.from({ length: 20 }, () => archiveGame(sample())));
    expect(ids.size).toBe(20);
  });

  it('只留最近 40 盘，不会把 localStorage 撑爆', () => {
    for (let i = 0; i < 50; i++) archiveGame(sample({ level: `第${i}盘` }));
    expect(gameCount()).toBe(40);
    expect(listGames()[0].level).toBe('第49盘'); // 最新的还在
  });

  it('复盘结论能回填', () => {
    const id = archiveGame(sample());
    setGameReview(id, { blunders: 2, mistakes: 1, avgLoss: 180, tags: { greedy: 2 } });
    expect(getGame(id)!.review!.blunders).toBe(2);
    expect(getGame(id)!.review!.tags.greedy).toBe(2);
  });

  it('回填到不存在的 id 上不抛错', () => {
    expect(() => setGameReview('nope', { blunders: 0, mistakes: 0, avgLoss: 0, tags: {} })).not.toThrow();
  });

  it('localStorage 写不进去（配额满 / 隐私模式）也不能崩', () => {
    memStore.full = true;
    expect(() => archiveGame(sample())).not.toThrow();
    expect(listGames()).toEqual([]); // 存不进去就是没有，但界面还活着
  });

  it('存档内容被写坏时当作没有历史', () => {
    memStore.setItem('xq-archive', '{不是JSON');
    expect(listGames()).toEqual([]);
    memStore.setItem('xq-archive', '{"a":1}'); // 是 JSON 但不是数组
    expect(listGames()).toEqual([]);
  });

  it('archiveFromBoard 存的局面能原样还原', () => {
    const moves = [mv(1, 7, 4, 7), mv(7, 2, 4, 2)];
    const id = archiveFromBoard(initialBoard(), 'r', moves, { side: 'r', result: 'loss', level: '高手' });
    const opened = openGame(getGame(id)!)!;
    expect(opened.startColor).toBe('r');
    expect(opened.moves).toEqual(moves);
    expect(opened.start[9][4]!.t).toBe('K');
  });

  it('局面读不出来时 openGame 返回 null 而不是抛错', () => {
    expect(openGame({ ...sample(), id: 'x', d: '2026-01-01', ts: 0, fen: '乱写的' })).toBeNull();
  });

  it('clearArchive 清空', () => {
    archiveGame(sample());
    clearArchive();
    expect(gameCount()).toBe(0);
  });
});

describe('behaviourOf：从棋谱数出行为', () => {
  it('数得出吃子和手数', () => {
    // 红炮二平五，黑炮８平５，红炮五进四吃中卒
    const moves = [mv(1, 7, 4, 7), mv(7, 2, 4, 2), mv(4, 7, 4, 3)];
    const b = behaviourOf(initialBoard(), moves, 'r', 'r');
    expect(b.plies).toBe(2); // 红走了 2 手
    expect(b.captures).toBe(1); // 其中 1 手吃子
  });

  it('对方的吃子算在 lost 上', () => {
    const moves = [mv(1, 7, 4, 7), mv(7, 2, 4, 2), mv(4, 7, 4, 3), mv(4, 2, 4, 6)];
    const b = behaviourOf(initialBoard(), moves, 'r', 'r');
    expect(b.lost).toBe(1); // 黑炮吃回红兵
  });

  it('执黑时视角翻过来', () => {
    const moves = [mv(1, 7, 4, 7), mv(7, 2, 4, 2), mv(4, 7, 4, 3)];
    const b = behaviourOf(initialBoard(), moves, 'r', 'b');
    expect(b.plies).toBe(1);
    expect(b.lost).toBe(1); // 黑方丢了中卒
    expect(b.captures).toBe(0);
  });

  it('空棋谱不炸', () => {
    expect(behaviourOf(initialBoard(), [], 'r', 'r')).toEqual({
      plies: 0, captures: 0, checks: 0, lost: 0, checked: 0,
    });
  });
});

describe('buildProfile：画像必须有证据，没证据就不说话', () => {
  const game = (over: Partial<ArchivedGame> = {}): ArchivedGame => ({
    id: `g${Math.random()}`,
    d: '2026-09-01',
    ts: Date.now(),
    fen: toFen(initialBoard(), 'r'),
    moves: encodeMoves([mv(1, 7, 4, 7), mv(7, 2, 4, 2)]),
    side: 'r',
    result: 'loss',
    level: '初级',
    ...over,
  });

  it('没有对局时不下任何结论', () => {
    const p = buildProfile([]);
    expect(p.enough).toBe(false);
    expect(p.traits).toEqual([]);
    expect(p.habits).toEqual([]);
    expect(p.summary).toContain('还没有对局记录');
  });

  it('样本太少时明确说样本太少，不给棋风标签', () => {
    const p = buildProfile([game(), game()]);
    expect(p.games).toBe(2);
    expect(p.enough).toBe(false);
    expect(p.traits).toEqual([]);
    expect(p.summary).toContain('再下');
  });

  it('有对局但一盘都没复盘过，也不给结论', () => {
    const p = buildProfile([game(), game(), game(), game()]);
    expect(p.reviewed).toBe(0);
    expect(p.enough).toBe(false);
  });

  it('胜负和场次数得准', () => {
    const p = buildProfile([
      game({ result: 'win' }),
      game({ result: 'win' }),
      game({ result: 'loss' }),
      game({ result: 'draw' }),
    ]);
    expect(p.wins).toBe(2);
    expect(p.losses).toBe(1);
    expect(p.draws).toBe(1);
  });

  it('错误标签汇总成习惯，按次数排序', () => {
    const rev = (tags: Record<string, number>) => ({
      blunders: 1, mistakes: 1, avgLoss: 200, tags,
    });
    const p = buildProfile([
      game({ review: rev({ greedy: 3, hang: 1 }) }),
      game({ review: rev({ greedy: 2, 'missed-threat': 1 }) }),
      game({ review: rev({ greedy: 1 }) }),
    ]);
    expect(p.enough).toBe(true);
    expect(p.habits[0].tag).toBe('greedy');
    expect(p.habits[0].count).toBe(6);
    expect(p.habits[0].games).toBe(3);
    expect(p.habits[0].share).toBeGreaterThan(0.5);
    expect(p.habits[0].advice).toContain('算账');
  });

  it('占比太小的毛病不单列，免得画像上全是噪音', () => {
    const p = buildProfile([
      game({ review: { blunders: 0, mistakes: 0, avgLoss: 0, tags: { greedy: 20, slow: 1 } } }),
      game({ review: { blunders: 0, mistakes: 0, avgLoss: 0, tags: { greedy: 20 } } }),
      game({ review: { blunders: 0, mistakes: 0, avgLoss: 0, tags: { greedy: 20 } } }),
    ]);
    expect(p.habits.map((h) => h.tag)).toEqual(['greedy']);
  });

  it('贪吃占比高时画像里点名，并带出证据数字', () => {
    const p = buildProfile([
      game({ review: { blunders: 2, mistakes: 0, avgLoss: 300, tags: { greedy: 5, hang: 1 } } }),
      game({ review: { blunders: 1, mistakes: 1, avgLoss: 250, tags: { greedy: 4 } } }),
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 200, tags: { greedy: 3 } } }),
    ]);
    const t = p.traits.find((x) => x.id === 'greedy');
    expect(t).toBeTruthy();
    expect(t!.evidence).toMatch(/\d+ 次贪吃/);
    expect(p.summary).toContain('贪吃');
  });

  it('漏看威胁占比高时给出"只看自己不看对方"的判断', () => {
    const p = buildProfile([
      game({ review: { blunders: 1, mistakes: 1, avgLoss: 200, tags: { 'missed-threat': 4 } } }),
      game({ review: { blunders: 1, mistakes: 1, avgLoss: 200, tags: { 'missed-threat': 3, hang: 1 } } }),
      game({ review: { blunders: 1, mistakes: 1, avgLoss: 200, tags: { 'missed-threat': 3 } } }),
    ]);
    expect(p.traits.some((t) => t.id === 'self-focused')).toBe(true);
  });

  it('每一条棋风特征都必须带证据，不能是空话', () => {
    const p = buildProfile([
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 200, tags: { greedy: 5 } } }),
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 200, tags: { greedy: 5 } } }),
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 200, tags: { greedy: 5 } } }),
    ]);
    for (const t of p.traits) {
      expect(t.evidence.length).toBeGreaterThan(0);
      expect(/\d/.test(t.evidence)).toBe(true); // 证据里必须有数字
    }
  });

  it('棋谱读不出来的对局跳过，不影响其它统计', () => {
    const p = buildProfile([
      game({ fen: '坏掉的局面' }),
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 100, tags: { hang: 3 } } }),
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 100, tags: { hang: 3 } } }),
      game({ review: { blunders: 1, mistakes: 0, avgLoss: 100, tags: { hang: 3 } } }),
    ]);
    expect(p.games).toBe(4);
    expect(p.habits[0].tag).toBe('hang');
  });
});

describe('trainingFocus：按实战丢分决定练什么', () => {
  it('没有数据时从眼力开始', () => {
    const f = trainingFocus(buildProfile([]));
    expect(f.kind).toBe('safety');
    expect(f.why).toContain('地基');
  });

  it('漏将多就去练杀法与应将', () => {
    const g = (tags: Record<string, number>): ArchivedGame => ({
      id: `g${Math.random()}`, d: '2026-09-01', ts: 1,
      fen: toFen(initialBoard(), 'r'), moves: '', side: 'r', result: 'loss', level: '初级',
      review: { blunders: 1, mistakes: 0, avgLoss: 100, tags },
    });
    const f = trainingFocus(buildProfile([g({ 'walk-into-mate': 3 }), g({ 'walk-into-mate': 3 }), g({ 'walk-into-mate': 2 })]));
    expect(f.kind).toBe('mate');
    expect(f.why).toContain('漏将');
  });

  it('贪吃归到眼力（不送子）这一类', () => {
    const g = (tags: Record<string, number>): ArchivedGame => ({
      id: `g${Math.random()}`, d: '2026-09-01', ts: 1,
      fen: toFen(initialBoard(), 'r'), moves: '', side: 'r', result: 'loss', level: '初级',
      review: { blunders: 1, mistakes: 0, avgLoss: 100, tags },
    });
    expect(trainingFocus(buildProfile([g({ greedy: 4 }), g({ greedy: 4 }), g({ greedy: 4 })])).kind).toBe('safety');
  });
});
