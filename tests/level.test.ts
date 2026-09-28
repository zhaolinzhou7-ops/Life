/**
 * 水平评估：以实战为准。
 *
 * 用户原话："你给我评的专业级，我怎么可能是专业级？连大师我都下不赢。"
 * 查下来是一串问题叠在一起：测评第一步就加减四百分、没有上限；题库最难才一千六，
 * 做对简单题照样涨分、做过的题再做对也涨分；和天天象棋对照时一千五六就算"专业级以上"；
 * 而且下棋输赢根本不进水平。这里把每一环都钉住。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { memStore } from './setup-dom';
import {
  AI_LEVEL_NAMES,
  AI_LEVEL_RATING,
  firstAttempt,
  getRatings,
  honestLevel,
  recordPlay,
  setRatings,
  suggestLevel,
  ttNear,
  updateRating,
  recordAssessment,
} from '../src/xiangqi/save';
import { STAGES, stageFor } from '../src/xiangqi/curriculum';
import { Assessment } from '../src/xiangqi/assess';
import { ratingRange } from '../src/xiangqi/puzzles';

beforeEach(() => memStore.clear());

const DAMEI = AI_LEVEL_NAMES.indexOf('大师');

describe('实战分', () => {
  it('一直输给"大师"，实战分落到"大师"以下', () => {
    for (let i = 0; i < 6; i++) recordPlay({ opp: AI_LEVEL_RATING[DAMEI], res: 0, w: 1, who: '大师' });
    expect(honestLevel().r).toBeLessThan(AI_LEVEL_RATING[DAMEI]);
    expect(honestLevel().source).toBe('play');
  });

  it('赢了往上、输了往下；开着教练的棋按比例少算', () => {
    const a = recordPlay({ opp: 1150, res: 1, w: 1, who: '中级' });
    expect(a.after).toBeGreaterThan(a.before);
    memStore.clear();
    const full = recordPlay({ opp: 1150, res: 1, w: 1, who: '中级' });
    memStore.clear();
    const coached = recordPlay({ opp: 1150, res: 1, w: 0.5, who: '中级' });
    expect(coached.after - coached.before).toBeLessThan(full.after - full.before);
  });

  it('做题分再高，下够 3 盘之后水平以实战为准，还要说破"题做得来、实战用不出来"', () => {
    const rs = getRatings();
    for (const d of Object.keys(rs) as (keyof typeof rs)[]) rs[d] = { r: 1900, n: 40 };
    setRatings(rs);
    recordAssessment({ safety: 1900, mate: 1900, tactic: 1900, endgame: 1900, opening: 1900 });
    for (let i = 0; i < 4; i++) recordPlay({ opp: AI_LEVEL_RATING[DAMEI], res: 0, w: 1, who: '大师' });
    const lv = honestLevel();
    expect(lv.r).toBeLessThan(1450);
    expect(lv.note).toContain('实战');
  });

  it('还没下够 3 盘：做题分封顶在自报水平往上一点，不会直接定成专业级', () => {
    const rs = getRatings();
    for (const d of Object.keys(rs) as (keyof typeof rs)[]) rs[d] = { r: 1900, n: 40 };
    setRatings(rs);
    recordAssessment({ safety: 1900, mate: 1900, tactic: 1900, endgame: 1900, opening: 1900 });
    const lv = honestLevel();
    expect(lv.source).toBe('puzzle');
    expect(lv.r).toBeLessThanOrEqual(1100 + 150);
  });

  it('推荐的对手在实战分附近', () => {
    expect(AI_LEVEL_NAMES[suggestLevel(1150)]).toBe('中级');
    expect(AI_LEVEL_NAMES[suggestLevel(800)]).toBe('入门');
    expect(suggestLevel(1450)).toBe(DAMEI);
  });
});

describe('和天天象棋的粗对照', () => {
  it('一千五六不再叫"专业级以上"', () => {
    expect(ttNear(1560).id).not.toBe('pro');
    expect(ttNear(1560).id).toBe('y89');
    expect(ttNear(1100).id).toBe('y45');
    expect(ttNear(1800).id).toBe('pro');
  });
});

describe('做题分', () => {
  it('比你低两百五以上的题做对了不加分', () => {
    const rs = getRatings();
    rs.tactic = { r: 1400, n: 30 };
    setRatings(rs);
    const r = updateRating('tactic', 1000, true);
    expect(r.r).toBe(1400);
  });

  it('同一道题只有第一次做算数', () => {
    expect(firstAttempt('tactic-1')).toBe(true);
    expect(firstAttempt('tactic-1')).toBe(false);
  });
});

describe('训练阶段要看实战', () => {
  it('做题分全过线、但没有实战数据：停在阶段一', () => {
    const rs = getRatings();
    for (const d of Object.keys(rs) as (keyof typeof rs)[]) rs[d] = { r: 1800, n: 40 };
    expect(stageFor(rs, { games: 0, blundersPerGame: null }).id).toBe(1);
    // 不给实战证据时（老调用）按分数走
    expect(stageFor(rs).id).toBe(STAGES[STAGES.length - 1].id);
  });

  it('实战每盘漏着多于一次：停在阶段一；降到一次以内才过', () => {
    const rs = getRatings();
    for (const d of Object.keys(rs) as (keyof typeof rs)[]) rs[d] = { r: 1800, n: 40 };
    expect(stageFor(rs, { games: 5, blundersPerGame: 2.4 }).id).toBe(1);
    expect(stageFor(rs, { games: 5, blundersPerGame: 0.8 }).id).toBe(2);
    expect(stageFor(rs, { games: 6, blundersPerGame: 0.4 }).id).toBeGreaterThan(2);
  });
});

describe('测评不会一路冲到专业级', async () => {
  const { loadPuzzles } = await import('../src/xiangqi/puzzles');
  it('全做对，估分也封在题库难度附近', async () => {
    await loadPuzzles();
    const a = new Assessment();
    await a.init();
    for (let q = a.next(); q; q = a.next()) a.answer(true);
    const res = a.result();
    for (const d of Object.keys(res.dims) as (keyof typeof res.dims)[]) {
      const kind = d === 'safety' ? 'safety' : d;
      const [, hi] = ratingRange(kind as never);
      expect(res.dims[d], d).toBeLessThanOrEqual(hi + 100);
    }
  });
});

describe('老存档补算实战分', async () => {
  const { backfillPlay, getPlay } = await import('../src/xiangqi/save');
  it('以前输给大师的棋，打开就算进实战分；练习局和太短的棋不算；只补一次', () => {
    const long = 'x'.repeat(80);
    backfillPlay([
      { ts: 1, level: '大师', result: 'loss', moves: long },
      { ts: 2, level: '大师', result: 'loss', moves: long },
      { ts: 3, level: '大师', result: 'loss', moves: long },
      { ts: 4, level: '中级 · 摆局练习', result: 'win', moves: long },
      { ts: 5, level: '初级', result: 'win', moves: 'x'.repeat(8) },
    ]);
    const p = getPlay()!;
    expect(p.n).toBe(3);
    expect(p.r).toBeLessThan(1450);
    backfillPlay([{ ts: 9, level: '棋王', result: 'win', moves: long }]);
    expect(getPlay()!.n).toBe(3);
  });
});
