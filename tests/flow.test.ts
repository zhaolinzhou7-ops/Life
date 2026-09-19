/**
 * 端到端验收：模拟三种用户走完整个学习闭环。
 *
 * 规格第二十四条要求实际模拟三种用户：
 *   用户A 完全新手，很多棋规都不知道
 *   用户B 会下棋但水平一般
 *   用户C 有一定水平，需要复盘和战术训练
 *
 * 这里不测界面像素，测的是**这三种人走完流程之后，软件给他们的东西
 * 是不是真的对、真的有用**：
 *   A 会不会被一堆看不懂的术语劝退、会不会被误导
 *   B 下完一盘能不能知道自己错在哪
 *   C 的画像是不是建立在真实数据上、训练是不是真按短板排的
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import { applyMove, initialBoard, legalMoves, statusAfter, type Board, type Color, type Move } from '../src/xiangqi/rules';
import { bestMove, judgeMove, resetEngine } from '../src/xiangqi/ai';
import { headlineOf, reviewMove, summarize, tagCounts } from '../src/xiangqi/analysis';
import { archiveFromBoard, clearArchive, getGame, listGames, openGame, setGameReview } from '../src/xiangqi/archive';
import { buildProfile, trainingFocus } from '../src/xiangqi/insight';
import { checkMove, getHintLevel, warnText } from '../src/xiangqi/livecoach';
import { factsFor } from '../src/xiangqi/chat';
import { offlineText, verifyExplanation } from '../src/xiangqi/llm';
import { DIM_INFO } from '../src/xiangqi/save';
import { moveToText } from '../src/xiangqi/notation';
import { ERR_INFO } from '../src/xiangqi/teach';
import { board, mv } from './helpers';

beforeEach(() => {
  memStore.clear();
  clearArchive();
  resetEngine();
});

/** 下一盘：红方按给定策略走，黑方用引擎。返回棋谱 */
function playGame(
  redPolicy: (b: Board) => Move,
  opts: { maxPlies?: number; blackDepth?: number } = {},
): { moves: Move[]; result: 'win' | 'loss' | 'draw' } {
  const maxPlies = opts.maxPlies ?? 60;
  let b = initialBoard();
  const moves: Move[] = [];
  let c: Color = 'r';
  for (let i = 0; i < maxPlies; i++) {
    if (statusAfter(b, c) !== 'playing') {
      return { moves, result: c === 'r' ? 'loss' : 'win' };
    }
    const m = c === 'r' ? redPolicy(b) : bestMove(b, 'b', opts.blackDepth ?? 3, 40, 100)!;
    if (!m) break;
    moves.push(m);
    b = applyMove(b, m);
    c = c === 'r' ? 'b' : 'r';
  }
  return { moves, result: 'draw' };
}

/** 复盘一盘棋，返回逐手评价（用较浅的深度，测试要跑得快） */
function reviewGame(start: Board, moves: Move[], depth = 3) {
  const reviewed = [];
  let cur = start;
  let c: Color = 'r';
  for (let i = 0; i < moves.length; i++) {
    const j = judgeMove(cur, c, moves[i], { maxDepth: depth, timeMs: 120, jitter: 0 });
    if (j) reviewed.push(reviewMove(cur, i, c, j));
    cur = applyMove(cur, moves[i]);
    c = c === 'r' ? 'b' : 'r';
  }
  return summarize(reviewed);
}

// ─────────────────────────────────────────────────────────────
describe('用户A：完全新手，很多棋规都不知道', () => {
  it('第一次打开，首页不会拿一堆数字吓人——所有地方都说"还没有"', () => {
    const p = buildProfile(listGames());
    expect(p.games).toBe(0);
    expect(p.summary).toContain('还没有对局记录');
    // 没有任何编造的标签
    expect(p.traits).toEqual([]);
    expect(p.habits).toEqual([]);
  });

  it('教练模式默认开着——新手最需要它，不能让他自己去设置里找', () => {
    expect(getHintLevel()).toBe(2);
  });

  it('新手把马送到对方车口上，教练会拦住，而且话里没有术语', () => {
    const b = board(
      '. . . k . . . . .',
      '. . . . . . . . .',
      '. . . r . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . H . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    // 传 null 表示引擎分析还没回来——这种时候教练也必须拦得住，
    // 不能因为后台还在算就放人掉坑
    const v = checkMove(2, b, mv(4, 6, 3, 4), 'r', null);
    expect(v).not.toBeNull();
    const words = `${warnText(2, v!)} ${v!.risk?.detail ?? ''}`;
    for (const jargon of ['牵制', '兑子', '先手', '闪击', '子力价值', '局面评估']) {
      expect(words).not.toContain(jargon);
    }
    expect(words).toContain('马');
    expect(words).toContain('吃');
  });


  it('教练只提醒，不替他走——被拦下的那一手仍然是合法的，走不走由他定', () => {
    const b = board(
      '. . . k . . . . .',
      '. . . . . . . . .',
      '. . . r . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . H . . . .',
      '. . . . . . . . .',
      '. . . . . . . . .',
      '. . . . K . . . .',
    );
    const m = mv(4, 6, 3, 4);
    expect(checkMove(2, b, m, 'r', null)).not.toBeNull();
    // 规则层面这一手完全合法，教练无权禁止
    expect(legalMoves(b, 'r').some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)).toBe(true);
  });

  it('新手乱走一盘，AI 全程守规矩，不会因为对手乱走就出错', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const { moves } = playGame((b) => {
      const ms = legalMoves(b, 'r');
      return ms[(rnd() * ms.length) | 0];
    }, { maxPlies: 40 });
    // 整盘重放一遍，每一手都必须合法
    let b = initialBoard();
    let c: Color = 'r';
    for (const m of moves) {
      expect(legalMoves(b, c).some((x) => x.fx === m.fx && x.fy === m.fy && x.tx === m.tx && x.ty === m.ty)).toBe(true);
      b = applyMove(b, m);
      c = c === 'r' ? 'b' : 'r';
    }
  });

  it('训练入口给新手的建议是最基础的一条，而且解释了为什么', () => {
    const f = trainingFocus(buildProfile([]));
    expect(f.kind).toBe('safety');
    expect(DIM_INFO[f.kind].name).toBe('眼力');
    expect(f.why.length).toBeGreaterThan(10); // 必须说明理由，不能光给个题型
  });
});

// ─────────────────────────────────────────────────────────────
describe('用户B：会下棋，水平一般', () => {
  it('下完一盘 → 自动存档 → 复盘 → 知道自己最该改哪一手', () => {
    let seed = 99;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    // "水平一般"：大部分时候走引擎前几名，偶尔走一手随机的
    const { moves, result } = playGame(
      (b) => {
        const ms = legalMoves(b, 'r');
        if (rnd() < 0.3) return ms[(rnd() * ms.length) | 0];
        return bestMove(b, 'r', 2, 60, 60) ?? ms[0];
      },
      { maxPlies: 40 },
    );
    expect(moves.length).toBeGreaterThan(10);

    // 存档
    const id = archiveFromBoard(initialBoard(), 'r', moves, {
      side: 'r',
      result,
      level: '初级',
      rival: '阿棋',
    });
    expect(listGames().length).toBe(1);

    // 复盘
    const rep = reviewGame(initialBoard(), moves);
    expect(rep.moves.length).toBeGreaterThan(0);

    // 每一手都有人话点评，没有一条是空的或者裸数字
    for (const m of rep.moves) {
      expect(m.comment.length).toBeGreaterThan(4);
      expect(m.text.length).toBeGreaterThan(0);
      expect(/^-?\d+$/.test(m.comment)).toBe(false);
    }

    // 回填结论
    const me = rep.stats.r;
    setGameReview(id, {
      blunders: me.blunders,
      mistakes: me.mistakes,
      avgLoss: me.avgLoss,
      tags: tagCounts(rep.moves, 'r'),
      headline: headlineOf(rep.moves, 'r'),
    });
    const saved = getGame(id)!;
    expect(saved.review).toBeTruthy();
    expect(saved.review!.headline!.length).toBeGreaterThan(0);
  });

  it('复盘里标出来的"更好的一手"必须是真的能走的棋', () => {
    const { moves } = playGame((b) => bestMove(b, 'r', 1, 300, 40) ?? legalMoves(b, 'r')[0], { maxPlies: 24 });
    const rep = reviewGame(initialBoard(), moves);
    let cur = initialBoard();
    let c: Color = 'r';
    for (let i = 0; i < moves.length; i++) {
      const r = rep.moves.find((x) => x.ply === i);
      if (r?.bestMove) {
        const ok = legalMoves(cur, c).some(
          (x) => x.fx === r.bestMove!.fx && x.fy === r.bestMove!.fy && x.tx === r.bestMove!.tx && x.ty === r.bestMove!.ty,
        );
        expect(ok, `第 ${i} 手推荐了一手走不了的棋`).toBe(true);
        // 记谱也必须对得上
        expect(r.bestText).toBe(moveToText(cur, r.bestMove));
      }
      cur = applyMove(cur, moves[i]);
      c = c === 'r' ? 'b' : 'r';
    }
  });

  it('下完之后问教练"为什么我输了"，答的是这一局的真实数据，且不编着法', () => {
    const { moves } = playGame((b) => bestMove(b, 'r', 1, 300, 40) ?? legalMoves(b, 'r')[0], { maxPlies: 24 });
    const rep = reviewGame(initialBoard(), moves);
    const wi = rep.worst.r;
    const f = factsFor(
      {
        side: '红',
        stats: { ...rep.stats.r, won: false },
        problem: wi >= 0 ? rep.moves[wi].comment : undefined,
      },
      '为什么我输了？',
    );
    const text = offlineText(f);
    expect(text.length).toBeGreaterThan(10);
    expect(verifyExplanation(text, f).ok, 'AI 讲解里出现了棋局中不存在的着法').toBe(true);
  });

  it('存档 → 读回来 → 重放，得到的局面和当时一模一样', () => {
    const { moves } = playGame((b) => bestMove(b, 'r', 2, 0, 50) ?? legalMoves(b, 'r')[0], { maxPlies: 20 });
    const id = archiveFromBoard(initialBoard(), 'r', moves, { side: 'r', result: 'loss', level: '初级' });
    const opened = openGame(getGame(id)!)!;
    expect(opened.moves).toEqual(moves);
    // 重放出来的最终局面要和当时对局的最终局面一致
    let a = initialBoard();
    for (const m of moves) a = applyMove(a, m);
    let b2 = opened.start;
    for (const m of opened.moves) b2 = applyMove(b2, m);
    expect(JSON.stringify(b2)).toBe(JSON.stringify(a));
  });
});

// ─────────────────────────────────────────────────────────────
describe('用户C：有一定水平，要复盘和专项训练', () => {
  /** 造几盘带明确毛病的棋，模拟"这个人就是老贪吃" */
  const gamesWithHabit = (tag: string, n = 4) => {
    for (let i = 0; i < n; i++) {
      const id = archiveFromBoard(initialBoard(), 'r', [mv(1, 7, 4, 7), mv(7, 2, 4, 2)], {
        side: 'r',
        result: i % 3 === 0 ? 'win' : 'loss',
        level: '高级',
      });
      setGameReview(id, {
        blunders: 2,
        mistakes: 1,
        avgLoss: 260,
        tags: { [tag]: 3 } as never,
        headline: '中局贪吃',
      });
    }
  };

  it('几盘下来，画像点出真实存在的毛病，并且附带证据', () => {
    gamesWithHabit('greedy');
    const p = buildProfile(listGames());
    expect(p.enough).toBe(true);
    expect(p.habits[0].name).toBe('贪吃');
    expect(p.habits[0].count).toBe(12);
    const t = p.traits.find((x) => x.id === 'greedy');
    expect(t).toBeTruthy();
    expect(/\d/.test(t!.evidence), '棋风特征必须带数出来的证据').toBe(true);
  });

  it('训练计划跟着画像走，不是按做题分排的', () => {
    gamesWithHabit('walk-into-mate');
    const p = buildProfile(listGames());
    const f = trainingFocus(p);
    expect(f.kind).toBe('mate'); // 老漏将 → 练杀法与应将
    expect(f.why).toContain('漏将');
    expect(f.why).toMatch(/\d+ 次/); // 理由里必须有具体次数
  });

  it('换一种毛病，训练方向跟着变——闭环是活的', () => {
    gamesWithHabit('greedy');
    expect(trainingFocus(buildProfile(listGames())).kind).toBe('safety');
    clearArchive();
    gamesWithHabit('missed-mate');
    expect(trainingFocus(buildProfile(listGames())).kind).toBe('mate');
  });

  it('问"我这种错误是不是经常出现"，答的是历史统计不是当场编的', () => {
    gamesWithHabit('greedy');
    const f = factsFor({ side: '红' }, '我这个毛病是不是经常犯？');
    expect(f.habits).toBeTruthy();
    const text = offlineText(f);
    expect(text).toContain('贪吃');
    expect(text).toContain('12');
    expect(verifyExplanation(text, f).ok).toBe(true);
  });

  it('每条毛病都配得上一条能照着做的建议', () => {
    gamesWithHabit('missed-threat');
    const p = buildProfile(listGames());
    for (const h of p.habits) {
      expect(h.advice.length).toBeGreaterThan(8);
      expect(ERR_INFO[h.tag].desc.length).toBeGreaterThan(5);
    }
  });

  it('高水平用户下出没有失误的一局，软件不会硬找毛病', () => {
    const id = archiveFromBoard(initialBoard(), 'r', [mv(1, 7, 4, 7), mv(7, 2, 4, 2)], {
      side: 'r',
      result: 'win',
      level: '大师',
    });
    setGameReview(id, { blunders: 0, mistakes: 0, avgLoss: 30, tags: {}, headline: '全程没有明显失误' });
    const p = buildProfile(listGames());
    expect(p.habits).toEqual([]);
    const text = offlineText({
      kind: 'game-summary',
      side: '红',
      stats: { total: 40, blunders: 0, mistakes: 0, avgLoss: 30, won: true },
    });
    expect(text).toContain('没有明显失误');
    expect(text).not.toContain('漏着');
  });
});

// ─────────────────────────────────────────────────────────────
describe('整套闭环：实战 → 找问题 → 出题 → 训练 → 再实战', () => {
  it('一盘真棋走完整条链路，每个环节的产出都对得上', () => {
    // 1. 实战
    const { moves, result } = playGame((b) => bestMove(b, 'r', 1, 250, 50) ?? legalMoves(b, 'r')[0], {
      maxPlies: 30,
    });
    expect(moves.length).toBeGreaterThan(8);

    // 2. 存档
    const id = archiveFromBoard(initialBoard(), 'r', moves, { side: 'r', result, level: '初级' });

    // 3. 复盘找问题
    const rep = reviewGame(initialBoard(), moves);
    const tags = tagCounts(rep.moves, 'r');
    setGameReview(id, {
      blunders: rep.stats.r.blunders,
      mistakes: rep.stats.r.mistakes,
      avgLoss: rep.stats.r.avgLoss,
      tags,
      headline: headlineOf(rep.moves, 'r'),
    });

    // 4. 画像（一盘还不够下结论，这一条本身就是要验证的）
    const p1 = buildProfile(listGames());
    expect(p1.enough).toBe(false);

    // 5. 再下两盘，画像才成立
    for (let i = 0; i < 2; i++) {
      const g = playGame((b) => bestMove(b, 'r', 1, 250, 50) ?? legalMoves(b, 'r')[0], { maxPlies: 30 });
      const gid = archiveFromBoard(initialBoard(), 'r', g.moves, { side: 'r', result: g.result, level: '初级' });
      const r = reviewGame(initialBoard(), g.moves);
      setGameReview(gid, {
        blunders: r.stats.r.blunders,
        mistakes: r.stats.r.mistakes,
        avgLoss: r.stats.r.avgLoss,
        tags: tagCounts(r.moves, 'r'),
        headline: headlineOf(r.moves, 'r'),
      });
    }
    const p2 = buildProfile(listGames());
    expect(p2.games).toBe(3);
    expect(p2.reviewed).toBe(3);

    // 6. 出题方向
    const focus = trainingFocus(p2);
    expect(['safety', 'mate', 'tactic', 'endgame', 'opening']).toContain(focus.kind);

    // 7. 教练回答基于以上全部真实数据，且不编棋
    const f = factsFor({ side: '红', stats: { ...rep.stats.r, won: result === 'win' } }, '我最近常犯什么错？');
    expect(verifyExplanation(offlineText(f), f).ok).toBe(true);
  });
});
